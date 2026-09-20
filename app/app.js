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
  stop:'<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>',
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
  easel:'<path d="M12 3V1M5 4h14l2 13H3L5 4Z"/><path d="M8 17l-2 6M16 17l2 6M8 9h8M7 13h10"/>',
  left:'<path d="M19 12H5M12 19l-7-7 7-7"/>',
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
  chev:'<path d="M6 9l6 6 6-6"/>',
  attach:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/>',
  folder:'<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2-2Z"/>',
  pencil:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
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
  syncComposerActions(chat());
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
  composioApps:[], composioLoading:false, appQuery:'', appFilter:'all', appOpen:null, appDetails:{},
  // right-side canvas: canvasTab 'canvas' | 'subagents' | 'mail' | 'payments' | 'approvals'
  agentEdit:false, mailTab:'inbox',
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
if (state.agentPanel) state.canvasTab = 'approvals';
delete state.agentPanel;
if (state.canvasTab === 'agent') state.canvasTab = 'approvals';
if (state.canvasTab === 'trace' || state.canvasTab === 'wallet' || state.canvasTab === 'live') state.canvasTab = 'canvas';
if (!['canvas', 'subagents', 'mail', 'payments', 'approvals'].includes(state.canvasTab)) state.canvasTab = 'canvas';
delete state.agentTab;
delete state.walletTab;
if (!state.mailTab) state.mailTab = 'inbox';
if (!state.settingsTab) state.settingsTab = 'profiles';
if (state.settingsTab === 'theme') state.settingsTab = 'profiles';
if (!state.browserProfile) state.browserProfile = fresh().browserProfile;
if (!Array.isArray(state.subAgents)) state.subAgents = [];
if (!state.triggerOptions) state.triggerOptions = fresh().triggerOptions;
if (!Array.isArray(state.composioApps)) state.composioApps = [];
state.composioLoading = false;
  if (typeof state.appQuery !== 'string') state.appQuery = '';
  if (!state.appFilter || state.appFilter === 'available') state.appFilter = 'all';
  if (typeof state.appOpen !== 'string') state.appOpen = null;
  if (!state.appDetails || typeof state.appDetails !== 'object') state.appDetails = {};
  // Honest apps: no fake OAuth connections exist — always empty.
  state.vault.apps = [];
  const save = () => { localStorage.setItem(LS, JSON.stringify(state)); };
const taskRuns = new Map();

// Remove implementation details left in conversations by older app versions.
const legacyInternalCopy = /(?:powered by \*\*Arche|live backend|through (?:my|the) backend|backend vault|Supabase Auth|Supabase-backed|Agents-API|asking Gemini|summarized with Gemini|generated by Gemini|sandboxed harness|model context)/i;
const neutralInternalReply = `I can't provide or speculate about internal implementation, system, or provider details. I can explain my capabilities and privacy protections at a high level, or help with your task.`;
let scrubbedLegacyChat = false;
for (const c of state.chats || []) {
  c.messages = c.messages || [];
  const wasCompleted = c.managedStatus === 'completed';
  if (c.managedStatus === 'running' || c.managedProgress) {
    if (c.managedStatus === 'running') c.managedStatus = 'interrupted';
    c.managedProgress = null;
    scrubbedLegacyChat = true;
  }
  for (const m of c.messages) {
    if (m.card?.type === 'progress' && m.card.status === 'running') {
      m.card.status = wasCompleted ? 'done' : 'interrupted';
      scrubbedLegacyChat = true;
    }
  }
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
let backendSyncPending = null;
let backendSyncOwner = null;
let backendSyncedAt = 0;
const BACKEND_SYNC_MS = 30000;
async function syncFromBackend(force = false) {
  const owner = billingIdentity();
  if (!owner) return false;
  if (owner !== backendSyncOwner) {
    backendSyncOwner = owner;
    backendSyncedAt = 0;
    backendSyncPending = null;
  }
  if (backendSyncPending) {
    if (!force) return backendSyncPending;
    await backendSyncPending;
  }
  if (!force && Date.now() - backendSyncedAt < BACKEND_SYNC_MS) return false;
  const request = (async () => {
    const [memories, secrets, automationChats] = await Promise.allSettled([
      window.LingonAuth.api('/api/memories'),
      window.LingonAuth.api('/api/secrets'),
      window.LingonAuth.api('/api/automation-chats'),
    ]);
    if (owner !== billingIdentity()) return false;
    const value = (result) => result.status === 'fulfilled' ? result.value : null;
    const m = value(memories);
    if (m) {
      const seen = new Set(state.memory.map((x) => x.text));
      (m.memories || []).forEach((r) => {
        if (!seen.has(r.text)) state.memory.unshift({ id: r.id, text: r.text, src: 'account', at: r.at });
      });
    }
    const s = value(secrets);
    if (s) {
      const have = new Set(state.vault.secrets.map((x) => x.id));
      (s.secrets || []).forEach((r) => {
        if (!have.has(r.id)) state.vault.secrets.unshift({ id: r.id, ref: r.ref, name: r.name, at: r.at, backend: true });
      });
    }
    for (const remote of (value(automationChats)?.chats || [])) {
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
    await ensureMailbox();
    if (owner === billingIdentity()) save();
    return owner === billingIdentity();
  })().finally(() => {
    if (backendSyncPending === request) {
      backendSyncPending = null;
      backendSyncedAt = Date.now();
    }
  });
  backendSyncPending = request;
  return request;
}

let subAgentsPending = null;
let subAgentsOwner = null;
let subAgentsCheckedAt = 0;
const SUB_AGENTS_CACHE_MS = 30000;
function refreshSubAgents(repaint = true) {
  const owner = billingIdentity();
  if (!owner) return Promise.resolve();
  if (owner !== subAgentsOwner) {
    subAgentsOwner = owner;
    subAgentsCheckedAt = 0;
    subAgentsPending = null;
  }
  if (subAgentsPending) return subAgentsPending;
  if (Date.now() - subAgentsCheckedAt < SUB_AGENTS_CACHE_MS) return Promise.resolve();
  const request = (async () => {
    try {
      const [agents, options] = await Promise.all([
        window.LingonAuth.api('/api/sub-agents'),
        window.LingonAuth.api('/api/trigger-options'),
      ]);
      if (owner !== billingIdentity()) return;
      state.subAgents = Array.isArray(agents.subAgents) ? agents.subAgents : [];
      state.triggerOptions = options || state.triggerOptions;
      subAgentsCheckedAt = Date.now();
      if (state.subAgentComposer) {
        const nameInput = $('#subname');
        const promptInput = $('#subprompt');
        if (nameInput) state.subAgentDraftName = nameInput.value;
        if (promptInput) state.subAgentDraft = promptInput.value;
      }
      save();
      if (repaint && state.canvasOpen && state.canvasTab === 'subagents') paintCanvas();
    } catch (e) { if (owner === billingIdentity()) toast(e.message || 'Could not load sub-agents.'); }
  })().finally(() => { if (subAgentsPending === request) subAgentsPending = null; });
  subAgentsPending = request;
  return request;
}

/* ---------------- Belna Apps via Composio (per-user OAuth) ---------------- */
let composioRefreshPending = null;
let composioRefreshOwner = null;
let composioCheckedAt = 0;
const COMPOSIO_CACHE_MS = 30000;
function refreshComposioApps(force = false) {
  const owner = billingIdentity();
  if (!owner) return Promise.resolve();
  if (owner !== composioRefreshOwner) {
    composioRefreshOwner = owner;
    composioCheckedAt = 0;
    composioRefreshPending = null;
  }
  if (composioRefreshPending) return composioRefreshPending;
  if (!force && Date.now() - composioCheckedAt < COMPOSIO_CACHE_MS) return Promise.resolve();
  // Mark the attempt before painting; an empty Apps result must not start a loop.
  composioCheckedAt = Date.now();
  state.composioLoading = true;
  if (state.view === 'apps' && $('#main')) paintApps($('#main'));
  const request = (async () => {
    try {
      const j = await window.LingonAuth.api('/api/composio/apps');
      if (owner === billingIdentity() && Array.isArray(j.apps)) state.composioApps = j.apps;
    } catch (e) {
      if (owner === billingIdentity()) toast(e.message || 'Could not load apps.');
    } finally {
      if (owner === billingIdentity()) {
        state.composioLoading = false;
        save();
        if (state.view === 'apps' && $('#main')) paintApps($('#main'));
        if (state.canvasOpen && state.canvasTab === 'payments' && $('#cbody')) $('#cbody').innerHTML = paymentsTabContent();
        if (force) {
          try {
            const o = await window.LingonAuth.api('/api/trigger-options');
            if (owner === billingIdentity()) { state.triggerOptions = o || state.triggerOptions; save(); }
          } catch {}
        }
      }
    }
  })().finally(() => { if (composioRefreshPending === request) composioRefreshPending = null; });
  composioRefreshPending = request;
  return request;
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

function patchConnectorAccounts(toolkit, accounts) {
  const next = Array.isArray(accounts) ? accounts : [];
  state.composioApps = (state.composioApps || []).map((a) => {
    if (a.toolkit !== toolkit) return a;
    return {
      ...a,
      accounts: next,
      accountCount: next.length,
      connected: next.length > 0,
      connectedAccountId: next[0] ? next[0].id : null,
      status: next[0] ? next[0].status : 'NOT_CONNECTED',
    };
  });
  if (state.appDetails && state.appDetails[toolkit]) {
    state.appDetails[toolkit] = { ...state.appDetails[toolkit], accounts: next, accountCount: next.length };
  }
}

async function disconnectComposioApp(app, accountId) {
  const id = accountId || (app && app.connectedAccountId);
  if (!app || !id) return;
  const acc = ((app.accounts || []).find((a) => a.id === id)) || {};
  const who = acc.email || acc.name || app.name || 'this account';
  if (!window.confirm(`Disconnect ${who}? Your agent will lose access until you reconnect.`)) return;
  try {
    await window.LingonAuth.api('/api/composio/disconnect', {
      method: 'POST',
      body: JSON.stringify({ connectedAccountId: id }),
    });
    const left = (app.accounts || []).filter((a) => a.id !== id);
    patchConnectorAccounts(app.toolkit, left);
    save();
    paintApps($('#main'));
    toast(`${who} disconnected.`);
  } catch (e) {
    toast(e.message || 'Could not disconnect.');
  }
}

async function openConnector(toolkit, force) {
  const tk = String(toolkit || '').toLowerCase();
  if (!tk) return;
  if (!force && state.appOpen === tk) {
    state.appOpen = null;
    save();
    paintApps($('#main'));
    return;
  }
  state.appOpen = tk;
  if (!state.appDetails) state.appDetails = {};
  const prev = state.appDetails[tk] || {};
  if (force || !prev.permissions) state.appDetails[tk] = { ...prev, loading: true };
  save();
  paintApps($('#main'));
  try {
    const j = await window.LingonAuth.api('/api/composio/toolkit?toolkit=' + encodeURIComponent(tk));
    state.appDetails[tk] = { loading: false, ...j };
    if (Array.isArray(j.accounts)) patchConnectorAccounts(tk, j.accounts);
  } catch (e) {
    state.appDetails[tk] = { loading: false, error: e.message || 'Could not open connector.' };
    toast(e.message || 'Could not open connector.');
  }
  save();
  if (state.view === 'apps' && $('#main')) paintApps($('#main'));
}

async function saveConnectorPermissions(toolkit, permissions) {
  const disabled = (permissions || []).filter((p) => !p.enabled).map((p) => p.slug);
  await window.LingonAuth.api('/api/composio/permissions', {
    method: 'POST',
    body: JSON.stringify({ toolkit, disabled }),
  });
}

async function toggleConnectorPermission(toolkit, slug, enabled) {
  const d = state.appDetails && state.appDetails[toolkit];
  if (!d || !Array.isArray(d.permissions)) return;
  d.permissions = d.permissions.map((p) => p.slug === slug ? { ...p, enabled } : p);
  save();
  paintApps($('#main'));
  try { await saveConnectorPermissions(toolkit, d.permissions); }
  catch (e) { toast(e.message || 'Could not save permission.'); openConnector(toolkit, true); }
}

async function toggleConnectorKind(toolkit, kind, enabled) {
  const d = state.appDetails && state.appDetails[toolkit];
  if (!d || !Array.isArray(d.permissions)) return;
  d.permissions = d.permissions.map((p) => p.kind === kind ? { ...p, enabled } : p);
  save();
  paintApps($('#main'));
  try { await saveConnectorPermissions(toolkit, d.permissions); }
  catch (e) { toast(e.message || 'Could not save permissions.'); openConnector(toolkit, true); }
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
    if (m.kind === 'card' && m.card.status === 'pending' && !m.card.onboarding) m.card.status = 'expired';
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

let root = document.getElementById('root');
const chat = () => state.chats.find(c => c.id === state.activeChat);
const isActive = c => state.view === 'chat' && state.activeChat === c.id;

/* ---------------- real-account guards (no fake/demo accounts) ----------------
   The agent (Engine.run / /api/*) only ever runs for a verified Supabase
   session. Local `lingon.v1` state is scoped per ownerId so one device never
   leaks chats/agents between real accounts, and no code path can claim or
   chat without a signed-in user. */
const signedIn = () => !!(window.LingonAuth && window.LingonAuth.signedIn());
const needsOnboarding = () => !state.onboarded || !state.agent || state.agent.provisional;
const currentUserId = () => {
  try { return (window.LingonAuth && window.LingonAuth.get() && window.LingonAuth.get().user && window.LingonAuth.get().user.id) || null; }
  catch { return null; }
};
let sandboxLeaseId = null;
let sandboxLeaseTimer = null;
let sandboxVmState = 'disconnected';
function vmConnectionView(){
  const work = statusFor(chat());
  if (work && work !== 'Available') return { label:work, tone:'busy' };
  if (sandboxVmState === 'connected') return { label:'Connected', tone:'' };
  if (sandboxVmState === 'connecting') return { label:'Connecting…', tone:'busy' };
  return { label:'Disconnected', tone:'offline' };
}
function refreshVmConnectionView(){
  const badge = document.querySelector('.agent-hero-status');
  if (!badge) return;
  const view = vmConnectionView();
  badge.classList.toggle('busy', view.tone === 'busy');
  badge.classList.toggle('offline', view.tone === 'offline');
  const label = badge.querySelector('span');
  if (label) label.textContent = view.label;
}
function setSandboxVmState(next){
  if (sandboxVmState === next) return;
  sandboxVmState = next;
  refreshVmConnectionView();
}
async function sandboxLeaseRequest(action) {
  if (!sandboxLeaseId || !window.LingonAuth || !window.LingonAuth.signedIn()) {
    setSandboxVmState('disconnected');
    return null;
  }
  if (action === 'acquire') setSandboxVmState('connecting');
  try {
    const result = await window.LingonAuth.api('/api/sandbox/lease', {
      method: 'POST',
      body: JSON.stringify({ action, leaseId: sandboxLeaseId, kind: 'app' }),
    });
    if (action !== 'release') {
      const trulyConnected = result?.power === 'running' && !!result?.vmName;
      setSandboxVmState(trulyConnected ? 'connected' : 'disconnected');
    }
    return result;
  } catch {
    setSandboxVmState('disconnected');
    return null;
  }
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
  setSandboxVmState('disconnected');
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
  if (needsOnboarding()) return startPendingPromptFlow();
  return renderApp();
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
     (name / color / passport) runs BEFORE the agent starts the task.
   - Otherwise normal render. */
async function afterSignIn(user){
  try {
    ensureOwnerScope();
    if (user && user.id && state.ownerId !== user.id){ state.ownerId = user.id; }
    state.view = 'chat';
    save();
    const owner = billingIdentity();
    syncFromBackend(true).then(() => {
      if (owner === billingIdentity() && $('#side')) paintSide();
    }).catch(() => {});
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
let billingOwner = null;
let billingFetchedAt = 0;
let billingPending = null;
let billingGeneration = 0;
const BILLING_CACHE_MS = 10000;
function billingIdentity(){
  const session = window.LingonAuth.get();
  return session && session.access_token ? (session.user && session.user.id) || session.access_token : null;
}
function setBillingCache(billing){
  billingOwner = billingIdentity();
  billingCache = billing || null;
  billingFetchedAt = Date.now();
  billingGeneration++;
  billingPending = null;
}
function invalidateBilling(){
  billingFetchedAt = 0;
  billingGeneration++;
  billingPending = null;
}
async function getBilling(){
  const owner = billingIdentity();
  if (!owner) { setBillingCache(null); return null; }
  if (owner !== billingOwner) { setBillingCache(null); billingOwner = owner; billingFetchedAt = 0; }
  if (billingCache && Date.now() - billingFetchedAt < BILLING_CACHE_MS) return billingCache;
  if (billingPending) return billingPending;
  const generation = billingGeneration;
  const request = window.LingonAuth.api('/api/billing').then((billing) => {
    if (billingOwner !== owner || billingGeneration !== generation) return null;
    billingCache = billing;
    billingFetchedAt = Date.now();
    return billing;
  }).catch(() => billingOwner === owner ? billingCache : null).finally(() => {
    if (billingPending === request) billingPending = null;
  });
  billingPending = request;
  return request;
}
function fmtC(n){ return (Math.round(Number(n || 0) * 100) / 100).toString(); }
function creditView(b){
  const amount = n => Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
  const remaining = amount(b.credits), used = amount(b.creditsUsed), granted = amount(b.creditsGranted);
  return { remaining, used, granted, percent: granted ? Math.min(100, remaining / granted * 100) : 0,
    tone: remaining <= 0 ? 'empty' : remaining <= 5 ? 'low' : 'ready' };
}
function creditMeterHtml(v){
  return `<div class="credit-meter" role="meter" aria-label="Credits remaining" aria-valuemin="0" aria-valuemax="${Math.max(v.granted, v.remaining, 1)}" aria-valuenow="${v.remaining}" aria-valuetext="${fmtC(v.remaining)} credits left; ${fmtC(v.used)} used"><span style="width:${v.percent}%"></span></div>`;
}
function billingPlanName(b){
  const plans = Array.isArray(b.plans) ? b.plans : Object.values(b.plans || {});
  const plan = plans.find(p => p.id === b.plan);
  return (plan && plan.name) || ({ free:'Free', pro:'Pro', max:'Max' })[b.plan] || b.plan || 'Free';
}
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
function billingShopHtml(){
  const packOpts = EXTRA_CREDIT_TIERS.filter((t) => t.credits).map((t) =>
    `<option value="${t.credits}">${t.credits} credits — $${t.price}</option>`
  ).join('');
  return `<div class="billing-shop">
    <section class="billing-extra" aria-labelledby="topup-title">
      <span class="billing-extra-icon" aria-hidden="true">${icon('spark',20)}</span>
      <h3 id="topup-title">A little extra goes a long way</h3>
      <p>Have something bigger in mind? Add credits whenever you need them.</p>
      <label class="billing-label" for="buypack">Choose your credit pack</label>
      <select class="field" id="buypack">${packOpts}</select>
      <button class="btn billing-primary" data-act="buycredits">Add credits ${icon('plus',14)}</button>
      <span class="billing-fine">One-time purchase · your plan stays the same</span>
    </section>
    <section class="billing-extra billing-gifts" aria-labelledby="gift-title">
      <span class="billing-extra-icon" aria-hidden="true">${icon('gift',20)}</span>
      <h3 id="gift-title">Good ideas are better shared</h3>
      <p>Give someone a little help with their next big idea.</p>
      <div class="billing-gift-buttons">
        <button class="btn ghost" data-act="buygift" data-amt="50">Gift $50 ${icon('aur',14)}</button>
        <button class="btn ghost" data-act="buygift" data-amt="100">Gift $100 ${icon('aur',14)}</button>
      </div>
      <div class="billing-redeem">
        <label class="billing-label" for="giftcode">Have a gift code? This one's for you.</label>
        <div class="billing-redeem-form"><input class="field mono" id="giftcode" placeholder="LNG-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">
        <button class="btn ghost small" data-act="redeem">Redeem</button></div>
      </div>
    </section>
  </div>`;
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
  const list = Array.isArray(b && b.plans) ? b.plans : Object.values((b && b.plans) || {});
  const byId = {};
  list.forEach((p) => { if (p && p.id) byId[p.id] = p; });
  const pFree = byId.free || { id: 'free', name: 'Free', price: 0, was: null, credits: 20, giftUsd: 0 };
  const pPro = byId.pro || { id: 'pro', name: 'Pro', price: 50, was: null, credits: 60, giftUsd: 0, interval: 'month' };
  const pMax = byId.max || { id: 'max', name: 'Max', price: 100, was: null, credits: 100, giftUsd: 0, interval: 'month' };
  const descriptions = { free:'A little space to get acquainted.', pro:'For your everyday ideas and ambitions.', max:'For the bigger things you have in mind.' };
  const features = { free:['Your own personal agent', 'Make yourself at home'], pro:['Everything in Free', 'Priority capacity for your agent'], max:['Everything in Pro', 'Our highest agent capacity'] };
  return `<div class="pcards">${[pFree,pPro,pMax].map((p, i) => {
    const id = ids[i], current = b && b.plan === id;
    const action = current ? `<span class="plan-state">${icon('check',14)} Your current plan</span>`
      : id === 'free' ? '<span class="plan-state plan-included">Your starting point</span>'
      : `<button class="btn ${id === 'pro' ? 'billing-primary' : 'ghost'}" data-act="checkout" data-p="${id}">Choose ${esc(p.name)} ${icon('aur',14)}</button>`;
    return `<article class="pcard${current ? ' is-current' : ''}${id === 'pro' ? ' is-featured' : ''}">
      <div class="billing-plan-heading"><h3 class="pname">${esc(p.name)}</h3>${current ? '<span class="billing-plan-tag">Your plan</span>' : id === 'pro' ? '<span class="billing-plan-tag">A little more room</span>' : ''}</div>
      <p class="pdesc">${descriptions[id]}</p>
      <div class="pprice">$${fmtC(p.price)}${p.was ? ` <s>$${fmtC(p.was)}</s>` : ''}<span>${id === 'free' ? '/ forever' : '/ month'}</span></div>${pctOff(p)}
      <div class="billing-plan-credits">${icon('spark',16)} <b>${fmtC(p.credits)}</b> ${id === 'free' ? 'starter credits' : 'credits / month'}</div>
      <ul>${features[id].map(text => `<li>${icon('check',13)} ${text}</li>`).join('')}</ul>
      ${id !== 'free' && !current ? `<div class="billing-plan-extras">${creditSliderHtml(p)}</div>` : ''}
      ${action}${giftCardHtml(p)}
    </article>`;
  }).join('')}</div>`;
}
function billSummary(b){
  const v = creditView(b);
  const firstName = currentUser().name.trim().split(/\s+/)[0];
  const manage = b && b.plan !== 'free'
    ? `<button class="billing-manage" data-act="portal">Manage subscription ${icon('aur',14)}</button>`
    : '';
  const note = v.tone === 'empty' ? 'A fresh start is a top-up away.' : v.tone === 'low' ? 'Running a little low. Top up whenever you’re ready.' : `Ready for your next idea${firstName && firstName !== 'Guest' ? ', ' + esc(firstName) : ''}.`;
  return `<section class="billing-balance credit-tone-${v.tone}" aria-label="Credit balance">
    <div class="billing-balance-top"><span class="billing-status">${esc(b.status || 'active')}</span>${manage}</div>
    <div class="billing-balance-main">
      <div class="billing-balance-copy">
        <div class="billing-balance-number"><strong>${fmtC(v.remaining)}</strong><span>credits left</span></div>
        <p class="billing-balance-note">${note}</p>
      </div>
      <div class="billing-companion" aria-hidden="true"><span class="billing-companion-orbit"></span>${Mascot.svg('lingon',v.tone === 'ready' ? 'happy' : 'idle',116)}</div>
    </div>
    <div class="billing-balance-bottom"><div class="billing-balance-meter">
      <div class="billing-meter-label"><span><b>${fmtC(v.used)}</b> of ${fmtC(v.granted)} credits used</span><span>${Math.round(v.percent)}% left</span></div>${creditMeterHtml(v)}
    </div><button class="btn billing-primary small" data-act="billing-topup">${icon('plus',14)} Add credits</button></div>
  </section>`;
}
function billingLoadingHtml(){
  return `<div class="billing-loading" role="status"><span class="billing-extra-icon" aria-hidden="true">${icon('spark',20)}</span><span>Getting your credits ready…</span></div>`;
}
function billingBodyHtml(){
  const b = billingOwner === billingIdentity() ? billingCache : null;
  return `<div class="billing-content">
    <header class="billing-intro"><span class="billing-eyebrow">Billing & credits</span><h2>A little fuel for big ideas.</h2><p>For everything you and ${esc((state.agent && state.agent.name) || 'your agent')} want to do next.</p></header>
    <div id="billbody">${b ? billSummary(b) : billingLoadingHtml()}</div>
    <section class="billing-plans" aria-labelledby="billing-plans-title"><div class="billing-section-heading"><h3 id="billing-plans-title">Find your kind of room</h3><p>Start small. Grow when you’re ready.</p></div><div id="plancards">${b ? planCards(b) : ''}</div></section>
    ${billingShopHtml()}
  </div>`;
}
function loadBillingContent(){
  wireBillingSliders($('#plancards'));
  const body = $('#billbody'), cards = $('#plancards');
  getBilling().then(b => {
    if (!body || !body.isConnected) return;
    if (!b) {
      body.innerHTML = `<div class="billing-loading" role="status"><span>We couldn’t load your balance just now.</span><button class="btn ghost small" data-act="billing-refresh">Try again</button></div>`;
      return;
    }
    body.innerHTML = billSummary(b);
    if (cards && cards.isConnected) { cards.innerHTML = planCards(b); wireBillingSliders(cards); }
  });
}
function paintBilling(M){
  M.innerHTML = `<div class="page"><div class="pageinner">${billingBodyHtml()}</div></div>`;
  loadBillingContent();
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

function landingLifeBento(){
  const ask = 'Do my taxes';
  const apps = [
    { n:'WhatsApp', t:'whatsapp', d:'whatsapp.com', bg:'#fff' },
    { n:'Teams', t:'microsoftteams', d:'teams.microsoft.com', bg:'#fff' },
    { n:'Slack', t:'slack', d:'slack.com', bg:'#4A154B' },
    { n:'GitHub', t:'github', d:'github.com', bg:'#fff' },
    { n:'Notion', t:'notion', d:'notion.so', bg:'#fff' },
    { n:'Outlook', t:'outlook', d:'outlook.com', bg:'#0F6CBD' },
    { n:'Linear', t:'linear', d:'linear.app', bg:'#5E6AD2' },
    { n:'Canva', t:'canva', d:'canva.com', bg:'#fff' },
    { n:'HubSpot', t:'hubspot', d:'hubspot.com', bg:'#FF7A59' },
    { n:'Jira', t:'jira', d:'atlassian.com', bg:'#1868DB' },
    { n:'Stripe', t:'stripe', d:'stripe.com', bg:'#635BFF' },
    { n:'Asana', t:'asana', d:'asana.com', bg:'#F06A6A' },
    { n:'Instagram', t:'instagram', d:'instagram.com', bg:'#E1306C' },
    { n:'Dropbox', t:'dropbox', d:'dropbox.com', bg:'#0061FF' },
    { n:'Figma', t:'figma', d:'figma.com', bg:'#1E1E1E' },
    { n:'Zoom', t:'zoom', d:'zoom.us', bg:'#2D8CFF' },
    { n:'Salesforce', t:'salesforce', d:'salesforce.com', bg:'#00A1E0' },
    { n:'Airtable', t:'airtable', d:'airtable.com', bg:'#18BFFF' },
    { n:'LinkedIn', t:'linkedin', d:'linkedin.com', bg:'#0A66C2' },
    { n:'Monday', t:'monday', d:'monday.com', bg:'#6161FF' },
    { n:'Discord', t:'discord', d:'discord.com', bg:'#5865F2' },
    { n:'Spotify', t:'spotify', d:'spotify.com', bg:'#1DB954' },
    { n:'Shopify', t:'shopify', d:'shopify.com', bg:'#96BF48' },
    { n:'ClickUp', t:'clickup', d:'clickup.com', bg:'#7B68EE' },
    { n:'X', t:'twitter', d:'x.com', bg:'#fff' },
  ];
  const tile = a => `<span class="life-app-tile" title="${esc(a.n)}"><img src="https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(a.d)}" alt="${esc(a.n)}"></span>`;
  return `<section class="asection life-section" id="agent" aria-label="Bring anything to life">
      <div class="life-head">
        <h2>Bring anything to life</h2>
        <p class="lede">If you can think of it, your agent can make it real life.</p>
      </div>
      <div class="life-bento">
        <article class="life-card life-outcome">
          <div class="life-copy">
            <h3>Describe the outcome</h3>
            <p>Say what you want done. Your agent figures out the steps.</p>
          </div>
          <div class="life-visual">
            <button type="button" class="life-prompt" data-act="life-ask" data-prompt="${esc(ask)}" aria-label="${esc(ask)}">
              <span class="life-ph">${esc(ask)}...</span>
            </button>
          </div>
        </article>
        <article class="life-card life-apps">
          <div class="life-copy">
            <h3>Connect your life and apps</h3>
            <p>Mail, calendar, bills, files — your agent works where you already live.</p>
          </div>
          <div class="life-visual">
            <div class="life-apps-stage" aria-hidden="true">
              <div class="life-apps-grid">${apps.map(tile).join('')}</div>
            </div>
          </div>
        </article>
        <article class="life-card life-approve">
          <div class="life-copy">
            <h3>Approve every action</h3>
            <p>Sensitive work pauses until you say yes. Nothing runs without you.</p>
          </div>
          <div class="life-visual">
            <div class="life-chat-frame" aria-hidden="true">
              <div class="msg agent">
                <div class="body">
                  <div class="acard life-acard">
                    <div class="hd">
                      <div class="tile" style="background:var(--acc-soft);color:var(--acc)">${icon('shieldcheck',20)}</div>
                      <div><b>Allow Alva: ${esc(ask)}</b><div class="sub">Action approval</div></div>
                      <div class="st"><span class="chip">waiting for you</span></div>
                    </div>
                    <div class="bd">
                      <div class="life-drive">
                        <div class="life-drive-h"><b>Drive</b></div>
                        <div class="life-drive-path">My Drive › Taxes 2025</div>
                        <div class="life-drive-list">
                          <div class="life-drive-row"><span class="life-pdf">PDF</span><span>Declaration_2025.pdf</span></div>
                          <div class="life-drive-row"><span class="life-pdf">PDF</span><span>Income_statement.pdf</span></div>
                          <div class="life-drive-row"><span class="life-pdf">PDF</span><span>Dentist_receipt.pdf</span></div>
                          <div class="life-drive-row"><span class="life-pdf">PDF</span><span>Interest_statement.pdf</span></div>
                        </div>
                      </div>
                    </div>
                    <div class="stack">
                      <span class="btn">${icon('check',15)} Allow</span>
                      <span class="btn green">Always allow</span>
                      <span class="btn soft">Deny</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>
        <article class="life-card life-secure">
          <div class="life-copy">
            <h3>Data is kept secure and private</h3>
            <p>Its own isolated VM and credential store. Secrets never land in chat.</p>
          </div>
          <div class="life-visual">
            <div class="life-appframe" aria-hidden="true">
              <div class="phead"><h1>Vault</h1><span class="chip green">${icon('lock',12)} encrypted at rest</span></div>
              <div class="seg">
                <span>${icon('box',14)} Apps</span>
                <span class="on">${icon('key',14)} Secrets</span>
                <span>${icon('shieldcheck',14)} Approved</span>
              </div>
              <div class="warnband">${icon('shieldcheck',18)}<div><b>Your secrets remain protected.</b>Values are masked in chat and activity history. Reveal below is for your eyes alone, on this device.</div></div>
              <div class="kv">
                <div class="row"><span style="color:var(--mut)">${icon('laptop',16)}</span><div><b>Alva’s computer</b><div class="sub">Isolated VM · Sweden</div></div><div class="rgt"><span class="chip green">running</span></div></div>
                <div class="row"><span style="color:var(--mut)">${icon('lock',16)}</span><div><b class="mono">GMAIL_APP_PASSWORD</b><div class="sub">sec_mail · added 2h</div></div><div class="rgt"><span class="mono mut" style="letter-spacing:.08em">•••• •••• ••••</span><span class="iconbtn">${icon('eye',14)}</span></div></div>
                <div class="row"><span style="color:var(--mut)">${icon('lock',16)}</span><div><b class="mono">STRIPE_SECRET_KEY</b><div class="sub">sec_pay · added 1d</div></div><div class="rgt"><span class="mono mut" style="letter-spacing:.08em">•••• •••• ••••</span><span class="iconbtn">${icon('eye',14)}</span></div></div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>`;
}
function landingAgentPassport(){
  const agent = Mascot.svg('lingon', 'idle', 118);
  return `<div class="landing-passport-card" aria-label="Your secure agent passport">
    <div class="landing-phone-shell">
      <span class="landing-phone-island" aria-hidden="true"></span>
      <div class="landing-phone-screen">
        <div class="landing-passport-hero">
          <div class="landing-passport-mascot">${agent}</div>
          <b>Alva</b>
        </div>
        <div class="landing-passport-tabs" role="tablist" aria-label="Agent passport details">
          <button class="on" type="button" role="tab" aria-selected="true" aria-controls="landing-passport-name" data-act="landing-passport-tab" data-passport-tab="name">Name</button>
          <button type="button" role="tab" aria-selected="false" aria-controls="landing-passport-mail" data-act="landing-passport-tab" data-passport-tab="mail">Mail</button>
          <button type="button" role="tab" aria-selected="false" aria-controls="landing-passport-wallet" data-act="landing-passport-tab" data-passport-tab="wallet">Wallet</button>
          <button type="button" role="tab" aria-selected="false" aria-controls="landing-passport-computer" data-act="landing-passport-tab" data-passport-tab="computer">Computer</button>
        </div>
        <div class="landing-passport-slider">
          <section class="landing-passport-panel on" id="landing-passport-name" role="tabpanel" data-passport-panel="name">
            <label class="landing-passport-label">Agent name</label>
            <div class="landing-passport-input"><strong>Alva</strong>${icon('pencil',14)}</div>
            <label class="landing-passport-label">Appearance</label>
            <div class="landing-passport-swatches" aria-label="Appearance colours">${Mascot.keys.map(k => `<i class="${k === 'lingon' ? 'on' : ''}" title="${Mascot.PALETTE[k].name}" style="--swatch:${Mascot.PALETTE[k].body}"></i>`).join('')}</div>
          </section>
          <section class="landing-passport-panel" id="landing-passport-mail" role="tabpanel" data-passport-panel="mail" hidden>
            <div class="landing-passport-mail-head"><span>${icon('mail',16)}</span><div><strong>Alva’s mail</strong><small>alva@mail.belna.se</small></div>${icon('refresh',14)}</div>
            <div class="landing-passport-mail-tabs"><span class="on">Inbox</span><span>Sent</span><span>Drafts</span><span>Write</span></div>
            <div class="landing-passport-mail-row"><i></i><div><strong>Welcome to your inbox</strong><small>Belna team</small><small>Your agent’s mailbox is ready.</small></div><time>now</time></div>
          </section>
          <section class="landing-passport-panel" id="landing-passport-wallet" role="tabpanel" data-passport-panel="wallet" hidden>
            <div class="landing-passport-payment-card" aria-label="Sample agent wallet card">
              <div class="landing-passport-card-top"><span>belna</span><small>AGENT WALLET</small></div>
              <span class="landing-passport-card-chip" aria-hidden="true"></span>
              <div class="landing-passport-card-number" aria-hidden="true">•••• &nbsp;•••• &nbsp;•••• &nbsp;2048</div>
              <div class="landing-passport-card-bottom"><span>ALVA</span><span>PREVIEW</span></div>
            </div>
          </section>
          <section class="landing-passport-panel" id="landing-passport-computer" role="tabpanel" data-passport-panel="computer" hidden>
            <div class="landing-passport-computer-card">
              <span class="landing-passport-computer-icon">${icon('laptop',30)}</span>
              <strong>Alva’s computer</strong>
              <p>A private workspace for browsing, files and the work you ask your agent to do.</p>
            </div>
          </section>
        </div>
      </div>
      <div class="landing-phone-composer" aria-hidden="true">
        <span class="landing-phone-plus">+</span>
        <span class="landing-phone-message">Message Alva</span>
        <span class="landing-phone-mic">${icon('mic',16)}</span>
        <span class="landing-phone-bars"><i></i><i></i><i></i><i></i></span>
      </div>
      <span class="landing-phone-home" aria-hidden="true"></span>
    </div>
  </div>`;
}

function renderLanding(){
  root.innerHTML = `
  <div class="fadeup">
    <div class="anav"><nav class="nav">
      <a class="abrand" href="/" data-act="top">${Mascot.logo(28)}belna</a>
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

    <section class="asection secure-agent-section" id="secure-agent" aria-label="Your own secure agent">
      <div class="secure-agent-layout">
        <div class="secure-agent-copy">
          <h2>Your own secure agent</h2>
          <p>Your agent gets a personal identity, private mailbox, secure wallet and its own computer — all in one place, always under your control.</p>
        </div>
        ${landingAgentPassport()}
      </div>
    </section>

    ${landingLifeBento()}

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

    <section class="asection" id="safety" aria-label="Safe Swedish AI">
      <div class="safety-layout">
        <div class="safety-copy">
          <h2>Safe Swedish AI</h2>
          <p class="lede">Arche 1.0 is built on the open source Kimi K3 model, with an Agentic harness optimized for privacy and safety.</p>
        </div>
        <div class="panel model-card">
          <div class="mc-viz" aria-hidden="true">
            <svg viewBox="0 0 640 88" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="8" y="18" width="118" height="52" rx="12" fill="#ECECF0" stroke="#E7E7EA"/>
              <text x="67" y="49" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="13" font-weight="800" fill="#17181A">Kimi K3</text>
              <path d="M126 44H162" stroke="#17181A" stroke-width="2"/><polygon points="162,40 172,44 162,48" fill="#17181A"/>
              <rect x="172" y="12" width="296" height="64" rx="14" fill="#fff" stroke="#E7E7EA"/>
              <text x="320" y="36" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="10" font-weight="800" letter-spacing="1.2" fill="#17181A">BELNA HARNESS</text>
              <text x="320" y="56" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="12" font-weight="700" fill="#17181A">Approve · Vault · Sandbox · Trace</text>
              <path d="M468 44H504" stroke="#17181A" stroke-width="2"/><polygon points="504,40 514,44 504,48" fill="#17181A"/>
              <rect x="514" y="18" width="118" height="52" rx="12" fill="#E9F4EE" stroke="#BFE0CC"/>
              <text x="573" y="49" text-anchor="middle" font-family="Hanken Grotesk,sans-serif" font-size="13" font-weight="800" fill="#3E8E5A">Work</text>
            </svg>
          </div>
          <div class="mc-title">Arche 1.0 vs frontier models</div>
          <div class="mc-table"><table class="btable">
            <thead><tr><th>Benchmark</th><th class="star">Arche 1.0</th><th>GPT-5.6 Sol</th><th>Claude Opus 5</th><th>Claude Fable 5</th></tr></thead>
            <tbody>
              <tr><td>GPQA Diamond</td><td class="star">93.5</td><td>94.1</td><td>93.8</td><td>92.6</td></tr>
              <tr><td>Terminal-Bench 2.1</td><td class="star">88.3</td><td>88.8</td><td>87.5</td><td>88.0</td></tr>
              <tr><td>BrowseComp</td><td class="star">91.2</td><td>90.4</td><td>89.1</td><td>88.0</td></tr>
              <tr><td>OSWorld-Verified</td><td class="star">84.8</td><td>83.0</td><td>84.2</td><td>85.0</td></tr>
              <tr><td>SWE-Marathon</td><td class="star">42.0</td><td>39.0</td><td>41.0</td><td>35.0</td></tr>
            </tbody>
          </table></div>
          <div class="fineprint mc-foot"><span>Full results and methodology in <a href="/research-arche-1-0">Research → Arche 1.0</a></span></div>
        </div>
      </div>
    </section>

    <footer class="afooter"><div class="fin">
      <div><div class="abrand">${Mascot.logo(28)}belna</div></div>
      <div><h4>Product</h4><a href="/research">Research</a><a href="/pricing">Pricing</a></div>
      <div><h4>Company</h4><a href="/#cta" data-act="open-app">Get started</a><a href="/" data-act="signin-nav">Sign in</a></div>
      <div><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/security">Security</a><a href="/cookies">Cookie Policy</a></div>
    </div><div class="base"><span>© 2026 Belna — Swedish Safe AI Agents</span></div></footer>
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

/* One persisted onboarding chat for every new account, with or without a request. */
function startPendingPromptFlow(pendingOverride){
  if (!signedIn()) { renderAuth(); return; }
  ensureOwnerScope();
  if (typeof pendingOverride === 'string' && pendingOverride.trim()) state.pendingPrompt = pendingOverride.trim();
  if (!state.agent) state.agent = { name:'Your agent', color:'lingon', pers:'Playful', provisional:true };
  state.agent.provisional = true;
  let c = state.chats.find(item => item.onboarding);
  if (!c) {
    c = { id:uid(), title:'Meet your agent', messages:[], trace:[], artifact:null, createdAt:Date.now(), onboarding:true };
    state.chats.unshift(c);
  }
  if (state.pendingPrompt && !c.messages.some(m => m.role === 'user' && m.text === state.pendingPrompt)) {
    c.messages.push({ id:uid(), role:'user', kind:'text', text:state.pendingPrompt });
  }
  state.activeChat = c.id; state.view = 'chat'; state.canvasOpen = false;
  mobileNavOpen = false;
  runInChatOnboarding(c);
  save(); renderApp();
}

function pendingQuestion(c){
  return c && (c.messages || []).slice().reverse().map(m => ({c,m})).find(({m}) => m.card?.type === 'question' && m.card.status === 'pending');
}

function runInChatOnboarding(c){
  c.busy = false;
  // Migrate interrupted setup from the previous question flow.
  if (!c.onboardingAnswers) {
    c.onboardingAnswers = {};
    for (const m of c.messages) {
      if (!m.card?.onboarding) continue;
      if (m.card.status === 'answered' && m.card.choice) {
        if (/look|color/i.test(m.card.q)) c.onboardingAnswers.color = Mascot.keys.find(k => Mascot.PALETTE[k].name === m.card.choice);
        else if (/name/i.test(m.card.q)) c.onboardingAnswers.name = String(m.card.choice).trim().slice(0,18);
      }
    }
    c.messages = c.messages.filter(m => !m.card?.onboarding || m.card.status === 'answered');
  }
  const answers = c.onboardingAnswers;
  if (c.messages.some(m => m.card?.onboarding && m.card.status === 'pending')) return;
  const say = text => c.messages.push({ id:uid(), role:'agent', kind:'text', text, mood:'happy' });
  const card = data => c.messages.push({ id:uid(), kind:'card', card:{...data, onboarding:true, status:'pending'} });
  if (!answers.name) {
    if (!c.onboardingWelcomed) {
      say(state.pendingPrompt ? 'Hej! I’ve saved your request. Let’s make your agent yours before I get started.' : 'Hej! Let’s set up your personal agent. First, give me a name.');
      c.onboardingWelcomed = true;
    }
    card({ type:'question', step:'name', q:'What should I call myself?', options:['Alex','Rosa','Tao'], customName:true });
  } else if (!answers.color) {
    state.agent.name = answers.name;
    card({ type:'question', step:'color', q:'Pick a color for ' + answers.name, options:Mascot.keys.map(k => Mascot.PALETTE[k].name), mascotColors:true });
  } else {
    state.agent.name = answers.name; state.agent.color = answers.color;
    say('Hej ' + currentUser().name + '! I’m ' + answers.name + ', your personal agent. I have my own secure computer and can work on your behalf: browse the web, research, write, code, create files, and help manage tasks across your connected apps. Tell me what you want done, and I’ll take it from there. I’ll ask for access or approval when needed.');
    card({ type:'passport', title:'Your agent is ready', note:'Finish setup and start chatting.' });
  }
}

function answerOnboarding(c, m, value){
  if (!signedIn() || !needsOnboarding() || !c?.onboarding || !m?.card?.onboarding || m.card.status !== 'pending' || m.card.type !== 'question') return;
  const choice = String(value || '').trim().slice(0, m.card.step === 'name' ? 18 : 60);
  if (!choice) { toast('Type a name or choose a suggestion.'); return; }
  if (m.card.step === 'color') {
    const key = Mascot.keys.find(k => k.toLowerCase() === choice.toLowerCase() || Mascot.PALETTE[k].name.toLowerCase() === choice.toLowerCase());
    if (!key) { toast('Choose one of the colors shown.'); return; }
    c.onboardingAnswers.color = key;
  } else c.onboardingAnswers.name = choice;
  m.card.choice = choice; m.card.status = 'answered';
  runInChatOnboarding(c); save(); renderApp();
}

async function openOnboardingPassport(c, m){
  if (!signedIn() || !c?.onboarding || m?.card?.type !== 'passport' || m.card.status !== 'pending') return;
  const answers = c.onboardingAnswers;
  if (!answers?.name || !Mascot.PALETTE[answers.color]) return;
  const ownerId = currentUserId();
  state.agent = { name:answers.name, color:answers.color, pers:'Playful', ownerId, claimedAt:Date.now() };
  state.onboarded = true; c.onboarding = false; c.busy = false; m.card.status = 'done';
  state.memory.unshift({ id:uid(), text:'Agent named “' + answers.name + '” — ' + Mascot.PALETTE[answers.color].name + '.', src:'onboarding', at:Date.now() });
  const pending = state.pendingPrompt;
  state.pendingPrompt = null;
  state.canvasOpen = true; state.canvasTab = 'canvas';
  save(); renderApp();
  ensureMailbox(answers.name).catch(() => {});
  if (pending) await runAgentOn(c, pending);
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

function openOnboarding(){ return startPendingPromptFlow(); }

/* ================================================================
   APP SHELL
================================================================ */
function renderApp(){
  if (!signedIn()){ renderAuth(); return; }
  ensureOwnerScope();
  if (needsOnboarding()) {
    if (!chat()?.onboarding) return startPendingPromptFlow();
    state.view = 'chat';
  }
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
      if (m.kind === 'card' && (m.card.type === 'file' || m.card.type === 'canvas')) rows.push({ title: m.card.name || m.card.title, kind: m.card.type, chat: c.title, chatId: c.id, messageId:m.id, card: m.card });
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
      <div class="usagecard" id="usagecard">${billingOwner === billingIdentity() && billingCache ? usageCardHtml(billingCache) : '<span class="usage-loading" role="status">Getting your credits ready…</span>'}</div>
      <div class="userwrap">
        ${state.userMenuOpen ? `<div class="usermenu pop">
          <button class="sitem" data-act="nav" data-view="settings">${icon('gear',15)} Settings</button>
          <button class="sitem" data-act="nav" data-view="apps">${icon('box',15)} Connectors</button>
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
      box.innerHTML = b ? usageCardHtml(b) : `<button class="usage-unavailable" data-act="nav" data-view="billing">View billing ${icon('aur',14)}</button>`;
    }).catch(() => {});
  } catch {}
}
function themeMascotColor(){
  return ({ grey:'charcoal', brick:'lingon', blue:'blueberry', yellow:'sun', green:'moss', pink:'rose' })[state.theme] || 'lingon';
}
function usageCardHtml(b){
  const v = creditView(b);
  const note = v.tone === 'empty' ? 'Ready for a top-up' : v.tone === 'low' ? 'A little low on credits' : `${fmtC(v.used)} of ${fmtC(v.granted)} used`;
  return `<div class="usage-content credit-tone-${v.tone}">
    <div class="usage-balance"><strong>${fmtC(v.remaining)}</strong><span>credits left</span></div>
    ${creditMeterHtml(v)}<div class="usage-caption">${note}</div>
    <div class="usage-footer"><span class="usage-companion">${Mascot.svg(themeMascotColor(),'happy',28)}</span>${icon('aur',14)}</div>
    <button class="usage-link" data-act="nav" data-view="billing" aria-label="View billing and credits" title="View billing and credits"></button>
  </div>`;
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
  if (Engine.managed && Object.values(c.managedTasks || {}).some(t=>['queued','running','waiting_approval','stopping'].includes(t.status))) return Engine.isRunning(c.id) ? 'Replying' : 'Working · available';
  if (Engine.managed && c.managedStatus === 'completed') return 'Available';
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
function syncComposerActions(c){
  const input = $('#cprompt');
  const send = $('#csend');
  const stop = $('#cstop');
  if (!input || !send || !stop) return;
  const running = !!(Engine.managed && Engine.isRunning?.(c?.id));
  const hasDraft = !!input.value.trim() || pendingFiles.length > 0;
  stop.hidden = !running || hasDraft;
  send.hidden = running && !hasDraft;
}

/* ---------------- chat view ---------------- */
function paintChat(M){
  const c = chat();
  if (!c){
    M.innerHTML = `<div class="empty" style="margin:auto">${Mascot.svg(state.agent.color,'idle',90,'mascot-bob')}<div style="margin-top:14px;font-weight:700">No chat open</div><div class="t2">Start one and ${esc(state.agent.name)} is on it.</div><button class="btn" data-act="newchat">${icon('plus',15)} New chat</button></div>`;
    return;
  }
  const oldPrompt = M.dataset.chatId === c.id ? M.querySelector('#cprompt') : null;
  const draft = oldPrompt?.value || '';
  const focused = oldPrompt && document.activeElement === oldPrompt;
  const selectionStart = focused ? oldPrompt.selectionStart : 0;
  const selectionEnd = focused ? oldPrompt.selectionEnd : 0;
  M.innerHTML = `
    <div class="floathead"><div class="fav">${Mascot.svg(state.agent.color,'idle',40)}</div><div class="pill">${esc(state.agent.name)}<span class="st" id="floatstatus"></span></div></div>
    <div class="chathead">
      <span class="ttl">${esc(c.title)}</span>
      ${c.source === 'automation' ? `<span class="chip">${icon('clock',12)} sub-agent</span>` : ''}
      ${runningTask(c) ? '<span class="chip green">' + icon('box',12) + ' delegated · agent available</span>' : (c.coordinatorRuns ? '<span class="chip">' + icon('refresh',12) + ' replying…</span>' : '')}
      <span class="sp"></span>
      ${Engine.managed && c.managedStatus === 'paused' ? `<button class="btn ghost tiny" data-act="managed-resume">Reconnect</button>` : ''}
      <button class="iconbtn" data-act="togglecanvas" title="Toggle canvas">${icon('easel',16)}</button>
    </div>
    <div class="thread" id="thread"><div class="threadinner" id="tinner">
      ${c.messages.map(m => msgNode(c, m).outerHTML).join('')}
    </div></div>
    <div class="composerwrap"><div class="composer">
      ${c.taskReply ? `<div class="reply-draft"><span><b>${c.taskReplyScope==='team'?'Updating the shared goal':'Changing this task'}</b><small>${esc(c.managedTasks?.[c.taskReply]?.title || 'Task')}</small></span><button type="button" class="iconbtn" data-act="task-change-cancel" data-chat="${c.id}" aria-label="Cancel task change">${icon('x',14)}</button></div>` : ''}
      ${c.replyingTo ? `<div class="reply-draft"><span><b>Replying to ${c.replyingTo.role === 'user' ? 'yourself' : esc(state.agent.name)}</b><small>${esc(c.replyingTo.text)}</small></span><button type="button" class="iconbtn" data-act="cancelreply" data-chat="${c.id}" title="Cancel reply" aria-label="Cancel reply">${icon('x',14)}</button></div>` : ''}
      <form class="promptbox" id="cform">
        <textarea id="cprompt" rows="1" placeholder="Ask ${esc(state.agent.name)} anything…"></textarea>
        <div class="attach-pills"></div>
        <div class="pb-row">
          <span class="iconbtn" data-act="attach" title="Attach files">${icon('plus',16)}</span>
          <span style="display:flex;gap:10px;align-items:center">
            <button type="button" class="micbtn" id="cstop" data-act="managed-stop" title="Stop response" aria-label="Stop response">${icon('stop',17)}</button>
            <button type="submit" class="micbtn" id="csend" title="Send" aria-label="Send">${icon('up',17)}</button>
          </span>
        </div>
      </form>
    </div></div>`;
  M.dataset.chatId = c.id;
  const th = $('#thread'); th.scrollTop = th.scrollHeight;
  updateFloat();
  const prompt = $('#cprompt');
  prompt.value = draft;
  if (focused) { prompt.focus({ preventScroll:true }); prompt.setSelectionRange(selectionStart, selectionEnd); }
  $('#cform').addEventListener('submit', e => { e.preventDefault(); const v = $('#cprompt').value.trim(); if (v || pendingFiles.length){ $('#cprompt').value = ''; sendPrompt(v, pendingFiles.slice()); clearFiles(); } });
  $('#cprompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); $('#cform').requestSubmit(); } });
  prompt.addEventListener('input', () => syncComposerActions(c));
  wirePromptBox($('#cform'), $('#cprompt'));
  paintAttachPills();
  if (Engine.managed && signedIn() && !needsOnboarding()) void Engine.recoverTasks?.(makeRT(c));
}

const APPLE_EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/';
const REACTIONS = [
  { id:'up', emoji:'👍', code:'1f44d', label:'Thumbs up' },
  { id:'down', emoji:'👎', code:'1f44e', label:'Thumbs down' },
  { id:'heart', emoji:'❤️', code:'2764-fe0f', label:'Heart' },
  { id:'poop', emoji:'💩', code:'1f4a9', label:'Poop' },
];
function normalizeReaction(value){
  return String(value || '').replace(/\uFE0F|\uFE0E/g, '');
}
function findReaction(value){
  const raw = String(value || '');
  const norm = normalizeReaction(raw);
  return REACTIONS.find((r) => r.id === raw || r.emoji === raw || normalizeReaction(r.emoji) === norm) || null;
}
function appleEmojiHTML(emoji, code){
  const unified = code || [...String(emoji)].map((ch) => ch.codePointAt(0).toString(16)).join('-');
  const fallback = unified.split('-').filter((p) => p !== 'fe0f' && p !== 'fe0e').join('-');
  return `<img class="imessage-emoji" src="${APPLE_EMOJI_CDN}${unified}.png" alt="${esc(emoji)}" draggable="false" data-fallback="${APPLE_EMOJI_CDN}${fallback}.png" onerror="if(!this.dataset.tried&&this.getAttribute('src')!==this.dataset.fallback){this.dataset.tried=1;this.src=this.dataset.fallback}else{this.replaceWith(document.createTextNode(this.alt))}">`;
}
function paintAppleEmoji(html){
  return String(html).replace(/\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*/gu, (emoji) => appleEmojiHTML(emoji));
}
function replyPreviewHTML(m){
  if (!m.replyTo) return '';
  const who = m.replyTo.role === 'user' ? 'You' : state.agent.name;
  return `<div class="reply-preview"><b>${esc(who)}</b><span>${paintAppleEmoji(esc(m.replyTo.text))}</span></div>`;
}
function messageChromeHTML(c, m){
  const active = new Set((Array.isArray(m.reactions) ? m.reactions : []).map((r) => findReaction(r)?.id).filter(Boolean));
  const attrs = `data-chat="${c.id}" data-msg="${m.id}"`;
  const chosen = REACTIONS.filter((r) => active.has(r.id)).map((r) => `<button type="button" class="reaction-pill on" data-act="reactmsg" ${attrs} data-reaction="${r.id}" title="Remove ${r.label}" aria-label="Remove ${r.label}">${appleEmojiHTML(r.emoji, r.code)}</button>`).join('');
  return {
    has: active.size > 0,
    reactions: chosen ? `<div class="message-reactions">${chosen}</div>` : '',
    actions: `<div class="message-actions" aria-label="Message actions">
    <button type="button" data-act="replymsg" ${attrs} title="Reply">${icon('chatb',13)}<span>Reply</span></button>
    <button type="button" data-act="copymsg" ${attrs} title="Copy">${icon('copy',13)}<span>Copy</span></button>
    <span class="reaction-options">${REACTIONS.map((r) => `<button type="button" class="reaction-choice ${active.has(r.id) ? 'on' : ''}" data-act="reactmsg" ${attrs} data-reaction="${r.id}" title="${r.label}" aria-label="${r.label}">${appleEmojiHTML(r.emoji, r.code)}</button>`).join('')}</span>
  </div>`,
  };
}
function msgNode(c, m){
  const chrome = (m.kind === 'text') ? messageChromeHTML(c, m) : { has:false, reactions:'', actions:'' };
  if (m.kind === 'text' && m.role === 'user'){
    const filesHtml = (m.files && m.files.length) ? `<div class="msg-files">${m.files.map((f,i) => `<button class="attach-pill sent" data-act="canvas-upload" data-chat="${c.id}" data-msg="${m.id}" data-i="${i}" title="View in Canvas">${icon('file',12)}<span class="ap-name">${esc(f.name.length > 24 ? f.name.slice(0,21)+'…' : f.name)}</span><span class="ap-size">${fmtBytes(f.size)}</span></button>`).join('')}</div>` : '';
    return el(`<div class="msg user" data-mid="${m.id}"><div class="message-stack${chrome.has ? ' has-reactions' : ''}"><div class="bub-wrap"><div class="bub">${replyPreviewHTML(m)}${filesHtml}${paintAppleEmoji(esc(m.text))}</div>${chrome.reactions}</div>${chrome.actions}</div></div>`);
  }
  if (m.kind === 'text')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava">${Mascot.svg(state.agent.color, m.mood || 'idle', 30)}</div><div class="body message-stack${chrome.has ? ' has-reactions' : ''}"><div class="bub-wrap"><div class="bub md">${replyPreviewHTML(m)}${paintAppleEmoji(md(m.text))}</div>${chrome.reactions}</div>${chrome.actions}</div></div>`);
  if (m.kind === 'tools')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava" style="visibility:hidden">${Mascot.svg(state.agent.color,'idle',30)}</div><div class="body"><div class="tools">${m.items.map(t => tlineHTML(t)).join('')}</div></div></div>`);
  if (m.kind === 'chips')
    return el('<div style="display:none"></div>');
  if (m.kind === 'card')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava" style="visibility:hidden">${Mascot.svg(state.agent.color,'idle',30)}</div><div class="body">${cardNode(c, m)}${['progress','browser','computer','file','artifact','canvas'].includes(m.card.type) ? '' : `<button class="canvas-card-link" data-act="canvas-card" data-chat="${c.id}" data-msg="${m.id}">${icon('easel',14)} Show in Canvas</button>`}</div></div>`);
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

  if (cd.type === 'task') {
    const ongoing=['queued','running','waiting_approval','stopping'].includes(cd.status);
    const teamId=c.managedTasks?.[cd.taskId]?.teamId;
    const hasPeers=teamId && Object.values(c.managedTasks || {}).filter(t=>t.teamId===teamId).length>1;
    const labels={queued:'Queued',running:'Working',waiting_approval:'Needs approval',stopping:'Stopping',stopped:'Stopped',completed:'Completed',partial:'Work limit reached · findings saved',failed:'Could not finish',needs_review:'Check outcome'};
    return `<div class="acard">${hd(icon('box',20),'var(--acc-soft)','var(--acc)',esc(cd.title),'You can keep chatting here')}
      <div class="bd"><b>${esc(labels[cd.status] || cd.status)}</b>${cd.connectionLost ? '<div class="mut">Reconnecting to your saved task…</div>' : ''}${cd.summary ? `<p>${esc(cd.summary)}</p>` : ''}</div>
      ${cd.status==='partial' ? `<div class="stack"><button class="btn ghost" data-act="task-continue" data-chat="${k}" data-msg="${mid}">Continue task</button></div>` : ''}
      ${hasPeers ? `<div class="stack"><button class="btn ghost" data-act="task-change-team" data-chat="${k}" data-msg="${mid}">Update shared goal</button></div>` : ''}
      ${ongoing ? `<div class="stack"><button class="btn ghost" data-act="task-change" data-chat="${k}" data-msg="${mid}">Change task</button><button class="btn ghost" data-act="task-stop" data-chat="${k}" data-msg="${mid}" ${cd.status==='stopping'?'disabled':''}>Stop task</button></div>` : ''}</div>`;
  }

  if (cd.type === 'progress') return `<div class="acard progress-card ${cd.status === 'running' ? 'is-running' : 'is-finished'} is-${cd.status || 'done'}" ${cd.status === 'running' ? 'role="status" aria-live="polite"' : ''}>
    <span class="progress-card-icon">${icon(cd.status === 'running' ? 'spark' : cd.status === 'done' ? 'check' : 'x',16)}</span>
    <span>${esc(cd.label || 'Working on it')}</span>
    ${cd.status === 'running' ? '<span class="progress-card-dots"><i></i><i></i><i></i></span>' : ''}
    ${cd.status === 'interrupted' || cd.status === 'failed' ? `<span class="progress-card-state">${esc(cd.status)}</span>` : ''}
  </div>`;

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

  if (cd.type === 'passport') return `<div class="acard">
    ${hd(icon('user',20),'var(--acc-soft)','var(--acc)','Your agent is ready',state.agent.name)}
    <div class="bd">${esc(cd.note)}</div>
    <div class="stack"><button class="btn" data-act="open-passport" data-chat="${k}" data-msg="${mid}">Start chatting ${icon('aur',15)}</button></div></div>`;

  if (cd.type === 'question') return `<div class="acard">
    ${hd(icon('spark',20),'var(--acc-soft)','var(--acc)','Question', state.agent.name + ' is asking')}
    <div class="bd"><b>${esc(cd.q)}</b>
    <div class="qopts" style="margin-top:10px">${cd.options.map(o => {
      const on = cd.status === 'answered' && cd.choice === o;
      const dim = cd.status === 'answered' && cd.choice !== o;
      const color = cd.mascotColors && Mascot.keys.find(k => Mascot.PALETTE[k].name === o);
      const label = (color ? Mascot.svg(color,'happy',44) : '') + esc(o);
      return pending
        ? `<button class="qopt" data-act="qopt" data-chat="${k}" data-msg="${mid}" data-o="${esc(o)}">${label}<span class="tick">${icon('check',12)}</span></button>`
        : `<span class="qopt ${on ? 'on' : 'dim'}" style="cursor:default">${label}<span class="tick">${icon('check',12)}</span></span>`;
    }).join('')}${cd.customName ? (pending ? `<form class="qopt qcustom" data-onboarding-name data-chat="${k}" data-msg="${mid}"><input name="agentName" aria-label="Type your own name" placeholder="Type your own" maxlength="18" required value="${esc(cd.draft || '')}"><button class="btn small" type="submit">Use name</button></form>` : (!cd.options.includes(cd.choice) ? `<span class="qopt on">${esc(cd.choice)}<span class="tick">${icon('check',12)}</span></span>` : '')) : ''}</div></div></div>`;

  if (cd.type === 'subagents') return `<div class="acard">
    ${hd(icon('box',20),'var(--line2)','var(--mut)',cd.agents.length === 1 ? 'Delegated task' : 'Parallel tasks',cd.agents.length === 1 ? 'main agent remains available' : 'working concurrently')}
    <div class="bd">${cd.agents.map(a => `<div class="subrow">
      <div><span class="nm">${esc(a.name)}</span><div class="ds">${esc(a.desc)}</div></div>
      <span class="stt">${a.status === 'running' ? `<span class="spin">${icon('refresh',13)}</span> running` : a.status === 'done' ? `<span style="color:var(--green)">${icon('check',13)}</span> ${esc(a.note || 'done')}` : a.status === 'interrupted' || a.status === 'failed' ? `<span style="color:var(--soft)">${icon('x',13)}</span> ${esc(a.note || a.status)}` : `<span style="color:var(--soft)">${icon('clock',13)}</span> queued`}</span>
    </div>`).join('')}</div></div>`;

  if (cd.type === 'browser') return `<div class="acard">
    ${hd(icon('globe',20),'var(--ink)','#fff','Browser', esc(cd.note || ''))}
    <div class="bd"><span class="rurl">${esc(cd.url || 'Browser session')}</span></div>
    <div class="stack"><button class="btn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">${cd.liveId || cd.status === 'running' ? 'Open live view' : 'View in Canvas'}</button></div></div>`;

  if (cd.type === 'computer') return `<div class="acard">
    ${hd(icon('term',20),'var(--ink)','#fff',cd.managed ? 'Agent tool output' : 'Read-only tool output',cd.managed ? 'Actual managed sandbox or search result' : 'Computed from the approved API response')}
    <div class="bd mut">${cd.status === 'running' ? 'Computer is working…' : `${(cd.lines || []).length} output lines ready`}</div>
    <div class="stack"><button class="btn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">${cd.pcId || cd.status === 'running' ? 'Open live view' : 'View in Canvas'}</button></div></div>`;

  if (cd.type === 'file') return `<div class="acard"><div class="filrow">
    <div class="fic">${icon('file',17)}</div>
    <div><b>${esc(cd.name)}</b><div class="sz">${fmtBytes(cd.size || 0)} · saved to Files</div></div>
    <div class="acts"><button class="iconbtn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}" title="View in Canvas">${icon('easel',15)}</button><button class="iconbtn" data-act="download" data-chat="${k}" data-msg="${mid}" title="Download">${icon('down',15)}</button></div>
  </div></div>`;

  if (cd.type === 'canvas') return `<div class="acard">${hd(icon('easel',20),'var(--acc-soft)','var(--acc)',esc(cd.title || 'Canvas item'),esc(cd.format || 'document'))}
    <div class="bd mut">${esc(String(cd.content || '').slice(0, 180))}</div><div class="stack"><button class="btn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}">Open in Canvas</button></div></div>`;

  if (cd.type === 'artifact') return `<div class="acard">
    <div class="bd" style="padding-top:14px">${prevFor(c, cd)}</div>
    <div class="filrow" style="border-top:1px solid var(--line2);padding-top:12px">
      <div class="fic" style="background:var(--green-soft);color:var(--green)">${icon('spark',16)}</div>
      <div><b>${esc(cd.title)}</b><div class="sz">Artifact</div></div>
      <div class="acts"><button class="iconbtn" data-act="canvas-card" data-chat="${k}" data-msg="${mid}" title="View on canvas">${icon('easel',14)}</button><button class="dotmenu" data-act="artmenu" title="More">•••</button></div>
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
const managedRunTokens = new WeakMap();
function makeRT(c){
  const active = () => isActive(c);
  const threadInner = () => $('#tinner');
  const scroll = () => { const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight; };
  const append = n => { if (active() && threadInner()){ const t=$('#thread');const atBottom=!t || t.scrollHeight-t.scrollTop-t.clientHeight<100;threadInner().appendChild(n); if(atBottom)scroll(); updateFloat(); } };
  const runToken = uid();
  let answerReady = false;
  let currentProgress = null;
  const finishProgress = (status = 'done') => {
    if (currentProgress?.card.status === 'running') {
      currentProgress.card.status = status;
      replaceNode(c, currentProgress);
      save();
    }
    currentProgress = null;
  };


  const rt = {
    chat: c, agent: state.agent, vault: state.vault,
    isFirst: c.messages.filter(m => m.role === 'user').length <= 1,
    managedTask(task){
      c.managedTasks=c.managedTasks || {};
      const previous=c.managedTasks[task.id];
      const cursor=previous?.sequence || 0;
      const newer=!previous || Number(task.revision)>=Number(previous.revision);
      const snapshot=newer ? {...task} : {...previous};
      delete snapshot.events;
      // Events are immutable and ordered. A late advance response cannot
      // overwrite a newer control decision or replay an already shown card.
      let sequence=cursor;
      for(const event of (task.events || []).slice().sort((a,b)=>a.seq-b.seq)) {
        if(event.seq<=sequence)continue;
        if(event.seq!==sequence+1)break;
        rt.managedEvent(event,{id:task.id,version:event.version || task.version});sequence=event.seq;
      }
      snapshot.sequence=sequence;c.managedTasks[task.id]=snapshot;
      let m=c.messages.find(x=>x.managedId===`task_${task.id}`);
      const card={type:'task',taskId:task.id,title:snapshot.title,status:snapshot.status,summary:snapshot.summary};
      if(!m) {m={id:uid(),managedId:`task_${task.id}`,kind:'card',card};c.messages.push(m);append(msgNode(c,m));}
      else {m.card=card;replaceNode(c,m);}
      save();if(active()){updateFloat();syncComposerActions(c);}
    },
    taskConnection(taskId,connected){
      const m=c.messages.find(x=>x.managedId===`task_${taskId}`);
      if(m){m.card.connectionLost=!connected;replaceNode(c,m);save();}
    },
    managedEvent(event, task){
      if (event.type === 'heartbeat') return;
      if (event.type === 'session' && event.status === 'running') {
        if (managedRunTokens.get(c) !== runToken) {
          for (const m of c.messages) {
            if (!m.card?.taskId && m.card?.type === 'progress' && m.card.status === 'running') {
              m.card.status = 'interrupted';
              replaceNode(c,m);
            }
          }
        }
        managedRunTokens.set(c, runToken);
        c.managedStatus = 'running';
      }
      if (!task && managedRunTokens.get(c) !== runToken && !(answerReady && ['card', 'artifact', 'trace'].includes(event.type))) return;
      if (event.type === 'progress' && typeof event.label === 'string') {
        // Internal stages do not create user updates. Published cards stay in
        // history; new task updates arrive as evidence-backed milestone cards.
        return;
      }
      if (event.type === 'stopped') c.managedStatus = 'stopped';
      if (event.type === 'paused') c.managedStatus = 'paused';
      if (event.type === 'done') c.managedStatus = event.status;
      if (['stopped', 'paused', 'done', 'error'].includes(event.type)) finishProgress(event.type === 'error' ? 'failed' : event.type === 'stopped' ? 'interrupted' : 'done');
      if (event.type === 'trace') { rt.trace(event.trace.ic || 'box', event.trace.t); return; }
      if (event.type === 'artifact') { rt.artifact(event.artifact,{background:!!task}); return; }
      if (event.type === 'decision') {
        const m = c.messages.find(x => x.card?.managedCallId === event.callId && (!task || x.card.taskId===task.id));
        if (m) { m.card.status = event.status; m.card.choice = event.answer; if(event.ref)m.card.ref=event.ref; replaceNode(c,m); }
      }
      if (event.type === 'message' || event.type === 'message_delta') {
        if (!task && event.phase === 'final_answer') {
          answerReady = true;
          c.managedStatus = 'completed';
          finishProgress();
          if (active()) { updateFloat(); syncComposerActions(c); }
        }
        let m = c.messages.find(x => x.managedId === event.id);
        if (!m) { m = { id:uid(), managedId:event.id, role:'agent', kind:'text', text:'' }; c.messages.push(m); append(msgNode(c,m)); }
        m.text = event.type === 'message_delta' ? m.text + event.delta : event.text;
        replaceNode(c,m);
      }
      if (event.type === 'card') {
        let m = c.messages.find(x => x.managedId === event.id);
        const card = { ...event.card, managedCallId:event.callId, taskId:task?.id, taskVersion:task?.version };
        if (!m) { m = { id:uid(), managedId:event.id, kind:'card', card }; c.messages.push(m); append(msgNode(c,m)); }
        else { m.card = card; replaceNode(c,m); }
        if (card.type === 'memory' && !state.memory.some(x => x.text === card.text)) rt.remember(card.text, 'account');
        if (card.type === 'canvas' && active() && !task) {
          c.canvasSelectedMessageId = m.id;
          state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = false;
          $('#app')?.classList.remove('nocanvas');
          paintCanvas();
        }
        else if (active() && state.canvasOpen && c.canvasSelectedMessageId && ['browser','computer'].includes(card.type)) paintCanvas();
      }
      if (event.type === 'error') {
        c.managedStatus = 'failed';
        const m = { id:uid(), role:'agent', kind:'text', text:event.error, mood:'think' };
        c.messages.push(m); append(msgNode(c,m));
        rt.trace('alert', event.error);
      }
      save();
      if (event.type === 'session' && active()) syncComposerActions(c);
      if (['done','paused','error','stopped'].includes(event.type) && active()) { invalidateBilling(); paintMain(); paintSide(); }
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
      save();
    },
    artifact(a,opts={}){
      c.artifact = a;
      if(!opts.background){c.canvasSelectedMessageId = null; delete c.canvasSelectedFileIndex;}
      if(active()) {
        if(!opts.background){state.canvasOpen = true;state.canvasTab = 'canvas';const app = $('#app');if(app)app.classList.remove('nocanvas');}
        if(state.canvasOpen && state.canvasTab==='canvas')paintCanvas();
      }
      save();
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
  if (m.kind === 'card' && state.canvasOpen && (state.canvasTab || 'canvas') === 'canvas' && isActive(c)) paintCanvas();
}

/* Visual browser and computer activity lives in the canvas. Older chats may
   still contain these cards in their message history. */
function runTimelineHTML(c){
  if (!c) return '';
  const shown = new Set((c.messages || []).map(m => m.managedId).filter(Boolean));
  const runs = (c.canvasRuns || []).filter(run => !shown.has(run.id));
  if (!runs.length) return '';
  return `<div class="runbox"><div class="runhead">${icon('box',14)} Live run — browser &amp; computer use</div>` + runs.map(m => {
    const cd = m.card;
    if (cd.type === 'browser') return `<div class="runrow"><span class="rtile">${icon('globe',14)}</span><div class="rbody">
      <div class="rurl">${esc(cd.url || 'VM browser')}</div><div class="rnote">${cd.status === 'done' ? 'rendered' : cd.status === 'failed' ? 'failed' : 'working…'} · ${esc(cd.note)}</div>
      ${cd.screenshot ? `<div class="shot"><img src="${cd.screenshot}" alt="Rendered page screenshot" loading="lazy"></div>` : ''}
      ${cd.liveId ? `<button class="btn ghost small" data-act="watchlive">Watch live</button>` : ''}</div></div>`;
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
  const c = chat();
  if (needsOnboarding()) {
    if (c?.onboarding) {
      const pq = pendingQuestion(c);
      if (pq) answerOnboarding(c, pq.m, text);
      else toast('Finish setup from the agent card.');
    } else startPendingPromptFlow(text);
    return;
  }
  if (!c) return;
  const currentTask = runningTask(c);
  const taskReply=c.taskReply;
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
  if (Engine.managed && taskReply) {
    try {await Engine.controlTask(makeRT(c),taskReply,c.taskReplyScope==='team'?'steer_team':'steer',{instruction:text});c.taskReply=null;c.taskReplyScope=null;save();paintMain();}
    catch(error){toast(error.message);}
    return;
  }
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
function agentAppearanceForm(a){
  return `<div class="agent-edit-form">
    <label class="alabel">Agent name</label>
    <input class="field" id="agentname" maxlength="18" value="${esc(a.name)}">
    <label class="alabel">Mascot appearance</label>
    <div class="swatches" style="justify-content:flex-start;margin-top:8px">${Mascot.keys.map(k => `<button class="swatch ${k === a.color ? 'on' : ''}" data-act="p-color" data-c="${k}" title="${Mascot.PALETTE[k].name}"><span style="width:26px;height:26px;border-radius:50%;background:${Mascot.PALETTE[k].body};display:block"></span></button>`).join('')}</div>
    <label class="alabel">Personality</label>
    <div class="persrow" style="justify-content:flex-start">${PERS.map(p => `<button class="pers ${p === a.pers ? 'on' : ''}" data-act="p-pers" data-p="${p}">${p}</button>`).join('')}</div>
  </div>`;
}
function canvasHeroHTML(){
  const a = state.agent;
  if (!a) return '';
  const editing = !!state.agentEdit;
  const connection = vmConnectionView();
  return `<div class="agent-hero">
    <div class="agent-hero-fig">
      ${Mascot.svg(a.color, editing ? 'happy' : 'idle', 84)}
      <button class="iconbtn agent-hero-edit${editing ? ' on' : ''}" data-act="agent-edit" title="Edit appearance">${icon('pencil',14)}</button>
    </div>
    <b class="agent-hero-name">${esc(a.name)}</b>
    <span class="agent-hero-status${connection.tone ? ' ' + connection.tone : ''}"><i></i><span>${esc(connection.label)}</span></span>
    ${mailCache && mailCache.address ? `<div class="sub mono agent-hero-mail">${esc(mailCache.address)}</div>` : ''}
    ${editing ? agentAppearanceForm(a) : ''}
  </div>`;
}
function libraryTabContent(){
  const arts = artifactRows();
  return `<div class="aslider-sec"><label class="alabel">Artifacts &amp; files (${arts.length})</label>
    <div class="kv">${arts.map(r => `<div class="row"><span style="color:var(--mut)">${icon(r.kind === 'file' ? 'file' : 'spark',15)}</span><div><b>${esc(r.title)}</b><div class="sub">${esc(r.kind)} · from “${esc(r.chat)}”</div></div><div class="rgt"><button class="btn ghost small" data-act="library-open" data-chat="${r.chatId}"${r.messageId ? ` data-msg="${r.messageId}"` : ''}>Open</button></div></div>`).join('') || '<div class="row mut">No artifacts or files yet.</div>'}</div>
    </div>`;
}
function approvalsTabContent(){
  const ap = approvalRows();
  return `<div class="aslider-sec"><label class="alabel">Approval history (${ap.length + state.vault.approvals.length})</label>
    <div class="kv">
      ${state.vault.approvals.map(x => `<div class="row"><span style="color:var(--green)">${icon('check',15)}</span><div><b>${esc(x.label)}</b><div class="sub">always allowed · ${fmtWhen(x.at)}</div></div><div class="rgt"><button class="btn ghost small" data-act="revoke" data-id="${x.id}">Revoke</button></div></div>`).join('')}
      ${ap.map(x => `<div class="row"><span style="color:var(--mut)">${icon('shieldcheck',15)}</span><div><b>${esc(x.title)}</b><div class="sub">${esc(x.status)} · “${esc(x.chat)}”</div></div></div>`).join('') || (state.vault.approvals.length ? '' : '<div class="row mut">No approvals yet — sensitive actions will pause for you here.</div>')}
    </div></div>`;
}

function paymentsTabContent(){
  const stripe = composioAppByToolkit('stripe');
  const connected = !!stripe?.connected;
  const checking = state.composioLoading;
  const status = checking ? 'Checking…' : connected ? 'Connected' : stripe ? 'Ready to connect' : 'Unavailable';
  return `<div class="payments-panel">
    <div class="payments-intro">
      <span class="payments-intro-icon">${icon('wallet',24)}</span>
      <h2>Let your agent earn for you</h2>
      <p>Connect payment tools so your agent can help with the work that brings in revenue.</p>
    </div>
    <article class="payments-option">
      <div class="payments-option-head">
        <span class="payments-option-icon stripe-mark">${stripe ? appLogoHtml(stripe) : 'S'}</span>
        <div><h3>Stripe</h3><p>Connect Stripe for payment and revenue tasks.</p></div>
        <span class="chip ${connected ? 'green' : ''}">${status}</span>
      </div>
      <div class="payments-option-actions">
        ${connected
          ? `<button class="btn ghost small" data-act="payments-stripe-apps">Manage connection</button>`
          : stripe
            ? `<button class="btn small" data-act="connect-app" data-toolkit="stripe" data-auth="${esc(stripe.authConfigId || '')}">Connect Stripe</button>`
            : `<button class="btn small" disabled>Connect Stripe</button><span class="payments-note">${checking ? 'Checking Stripe availability…' : 'Stripe connection is not available on this server yet.'}</span>`}
        <button class="btn ghost small" data-act="refresh-apps" aria-label="Refresh Stripe connection">${icon('refresh',14)} Refresh</button>
      </div>
    </article>
    <article class="payments-option payments-option-soon">
      <div class="payments-option-head">
        <span class="payments-option-icon">${icon('card',20)}</span>
        <div><h3>Card</h3><p>Let your agent spend for you.</p></div>
        <span class="chip">Coming soon</span>
      </div>
    </article>
  </div>`;
}

/* Sub Agents / Automations panel. */
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
  for (let i = (c.canvasRuns || []).length - 1; i >= 0; i--){
    const card = c.canvasRuns[i].card;
    if (card.type === 'browser' && card.liveId) return card.liveId;
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
function paintLive(body, c, selectedId){
  const id = selectedId || liveIdFor(c);
  const terms = computerLinesFor(c);
  if (!id){
    if (liveIdShown) liveClose();
    body.innerHTML = `<div class="cempty">${Mascot.svg(state.agent.color,'idle',80,'mascot-bob')}<div style="font-weight:700;margin-top:12px">No live session</div><div class="mut2">Ask for research and the agent's real browser appears here — watch it, take over, hand back.</div></div>`;
    return;
  }
  const browserCards = [...(c.messages || []).filter(m => m.kind === 'card'), ...(c.canvasRuns || [])];
  const poster = browserCards.filter(m => !selectedId || m.card.liveId === selectedId).reduce((acc, m) => (m.card.type === 'browser' && m.card.screenshot) ? m.card.screenshot : acc, '');
  window.__liveFrames = 0;
  body.innerHTML = `
    <button class="canvas-back" data-act="canvas-back">${icon('left',14)} All Canvas items</button>
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
        <button class="btn ghost small" data-act="canvas-back">Back</button>
      </div>
    </div>`;
  liveConnect(id);
}
function liveConnect(id){
  if (liveWS && liveIdShown === id){ bindLiveInput(liveWS); liveState(liveControl ? 'user' : 'idle'); pcConnect(); return; }
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
  bindLiveInput(ws);
  pcConnect();
}

function bindLiveInput(ws){
  const view = $('#liveview'), cur = $('#bigcursor');
  if (!view || !cur) return;
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
}
/* Computer stream: appends real sandbox output lines as runs happen. */
function pcConnect(selectedId){
  const c = chat();
  const pcId = selectedId || pcIdFor(c);
  const out = () => $('#pcout');
  if (!pcId || !out()) return;
  if (pcWS && pcIdShown === pcId) return;
  try { pcWS && pcWS.close(); } catch {}
  const sess = window.LingonAuth && window.LingonAuth.get();
  if (!sess || !sess.access_token) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/ws/pc/' + pcId + '?token=' + encodeURIComponent(sess.access_token));
  pcWS = ws; pcIdShown = pcId;
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.hello && m.log && out()) out().innerHTML = m.log.map(L => `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`).join('');
    if (Array.isArray(m.out) && out()){
      if (out().querySelector('.mut') && out().children.length <= 1) out().innerHTML = '';
      m.out.forEach(L => { out().insertAdjacentHTML('beforeend', `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`); });
      out().scrollTop = out().scrollHeight;
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
let mailOwner = null;
let mailboxEnsuredName = null;
let mailboxPending = null;
let mailFetchPending = null;
let mailFetchSeq = 0;
function scopeMailCache(){
  const owner = billingIdentity();
  if (owner !== mailOwner) {
    mailOwner = owner;
    mailCache = null;
    mailboxEnsuredName = null;
    mailboxPending = null;
    mailFetchPending = null;
    mailFetchSeq++;
  }
  return owner;
}
async function ensureMailbox(name){
  const owner = scopeMailCache();
  if (!owner) return null;
  const agentName = String(name || (state.agent && state.agent.name) || 'Agent').trim();
  if (mailboxEnsuredName === agentName && mailCache) return mailCache;
  if (mailboxPending) {
    if (mailboxPending.name === agentName) return mailboxPending.promise;
    await mailboxPending.promise;
    if (owner !== billingIdentity()) return null;
  }
  const seq = mailFetchSeq;
  const request = window.LingonAuth.api('/api/mail/ensure', { method:'POST', body: JSON.stringify({ agentName }) })
    .then((data) => {
      if (owner !== billingIdentity()) return null;
      if (seq === mailFetchSeq) mailCache = data;
      mailboxEnsuredName = agentName;
      return data;
    }).catch((e) => {
      if (owner !== billingIdentity()) return null;
      if (seq === mailFetchSeq) mailCache = { configured:false, address:null, messages:[], drafts:[], unread:0, ...(mailCache || {}), error:e.message };
      return mailCache;
    }).finally(() => { if (mailboxPending?.promise === request) mailboxPending = null; });
  mailboxPending = { name: agentName, promise: request };
  return request;
}
async function getMail(force, folder){
  const owner = scopeMailCache();
  if (!owner) return null;
  const tab = folder || state.mailTab || 'inbox';
  if (mailCache && !force && mailCache.folder === tab && tab !== 'write') return mailCache;
  if (mailFetchPending?.owner === owner && mailFetchPending.tab === tab) return mailFetchPending.promise;
  const seq = ++mailFetchSeq;
  const request = (async () => {
    try {
      const name = (state.agent && state.agent.name) || '';
      let result;
      if (tab === 'write') {
        result = await window.LingonAuth.api('/api/mail?folder=inbox&name=' + encodeURIComponent(name));
        result.folder = 'write';
      } else {
        result = await window.LingonAuth.api('/api/mail?folder=' + encodeURIComponent(tab) + '&name=' + encodeURIComponent(name));
      }
      if (owner === billingIdentity() && seq === mailFetchSeq) mailCache = result;
      return result;
    } catch (e) {
      if (owner !== billingIdentity()) return null;
      const fallback = { configured:false, address:null, messages:[], drafts:[], unread:0, ...(mailCache || {}), error:e.message, folder:tab };
      if (seq === mailFetchSeq) mailCache = fallback;
      return fallback;
    }
  })().finally(() => { if (mailFetchPending?.promise === request) mailFetchPending = null; });
  mailFetchPending = { owner, tab, promise: request };
  return request;
}
async function openMailMessage(id){
  const owner = scopeMailCache();
  if (!owner) return null;
  const j = await window.LingonAuth.api('/api/mail/messages/' + encodeURIComponent(id));
  if (owner !== billingIdentity()) return null;
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
  scopeMailCache();
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

const canvasFileCache = new Map();
function canvasFileContent(c, m){
  const card = m.card;
  if (typeof card.content === 'string') return card.content;
  if (card.dataUrl) return card.dataUrl;
  if (!card.managedArtifactId) return '';
  const key = `${c.id}:${card.managedArtifactId}`;
  if (!canvasFileCache.has(key)) {
    canvasFileCache.set(key, { loading:true });
    window.LingonAuth.apiStream(`/api/agent/artifact?chatId=${encodeURIComponent(c.id)}&id=${encodeURIComponent(card.managedArtifactId)}`)
      .then(async response => {
        if (!response.ok) throw new Error('File preview could not be loaded.');
        const blob = await response.blob();
        if (blob.size > 10 * 1024 * 1024) throw new Error('This file is too large to preview.');
        const content = /^(text\/|application\/(json|xml|javascript))/.test(blob.type) ? await blob.text() : await new Promise((resolve,reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
        });
        canvasFileCache.set(key, { content });
      })
      .catch(error => canvasFileCache.set(key, { error:error.message }))
      .finally(() => { if (state.activeChat === c.id && c.canvasSelectedMessageId === m.id && state.canvasOpen) paintCanvas(); });
  }
  return canvasFileCache.get(key);
}
function canvasDocumentHTML(file, value){
  const name = String(file.name || file.title || 'File');
  const format = String(file.format || name.split('.').pop() || 'text').toLowerCase();
  const raw = typeof value === 'string' ? value : value?.content || '';
  const header = `<div class="arti-head"><b>${esc(name)}</b><span class="chip">${esc(format)}</span></div>`;
  if (value?.loading) return header + '<div class="canvas-file-note">Loading preview…</div>';
  if (value?.error) return header + `<div class="canvas-file-note">${esc(value.error)}</div>`;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(raw)) return header + `<img class="canvas-file-image" src="${esc(raw)}" alt="${esc(name)}">`;
  if (/^data:application\/pdf;base64,/i.test(raw)) return header + `<iframe class="canvas-file-pdf" title="${esc(name)}" src="${esc(raw)}"></iframe>`;
  let content = raw;
  if (/^data:[^,]*;base64,/i.test(raw)) {
    try { content = new TextDecoder().decode(Uint8Array.from(atob(raw.slice(raw.indexOf(',') + 1)), c => c.charCodeAt(0))); }
    catch { return header + '<div class="canvas-file-note">Preview unavailable. Download this file to open it.</div>'; }
  }
  if (format === 'html' || format === 'htm' || format === 'svg') return header + `<div class="arti-frame"><iframe sandbox="allow-scripts" title="${esc(name)}" srcdoc="${esc(content)}"></iframe></div>`;
  if (format === 'md' || format === 'markdown') return header + `<div class="canvas-document">${md(content)}</div>`;
  return header + `<pre class="canvas-file-text">${esc(content || 'No preview available for this file.')}</pre>`;
}
function canvasGalleryHTML(c){
  if (!c) return '';
  const items = [];
  for (const m of c.messages || []) {
    if (m.kind === 'card') items.push({m, label:m.card.title || m.card.name || m.card.q || m.card.note || m.card.label || m.card.type, kind:m.card.type});
    for (const [i,file] of (m.files || []).entries()) items.push({m, i, label:file.name, kind:'file'});
  }
  if (!items.length) return '';
  return `<div class="canvas-gallery"><div class="runhead">${icon('easel',14)} From this chat</div>${items.slice(-30).reverse().map(item => `<button class="canvas-gallery-item" data-act="${item.i === undefined ? 'canvas-card' : 'canvas-upload'}" data-chat="${c.id}" data-msg="${item.m.id}"${item.i === undefined ? '' : ` data-i="${item.i}"`}><span>${icon(item.kind === 'browser' ? 'globe' : item.kind === 'file' ? 'file' : item.kind === 'computer' ? 'term' : 'easel',15)}</span><b>${esc(item.label)}</b><small>${esc(item.kind)}</small></button>`).join('')}</div>`;
}
function paintCanvasSelection(body, c, m){
  const file = c.canvasSelectedFileIndex !== undefined ? m.files?.[c.canvasSelectedFileIndex] : null;
  if (file) {
    body.innerHTML = `<button class="canvas-back" data-act="canvas-back">${icon('left',14)} All Canvas items</button>${canvasDocumentHTML(file, file.dataUrl || file.content || '')}`;
    return;
  }
  const cd = m.card;
  if (cd.type === 'browser' && cd.liveId) { paintLive(body, c, cd.liveId); return; }
  const back = `<button class="canvas-back" data-act="canvas-back">${icon('left',14)} All Canvas items</button>`;
  if (cd.type === 'browser') {
    const index = c.messages.indexOf(m);
    const related = c.messages.slice(index).filter(item => item.card?.type === 'browser' && (!cd.taskId || item.card.taskId === cd.taskId));
    const latest = related.at(-1)?.card || cd;
    const screenshot = [...related].reverse().find(item => item.card.screenshot)?.card.screenshot || cd.screenshot;
    body.innerHTML = back + `<div class="arti-head"><b>Browser view</b><span class="chip">${esc(latest.status || '')}</span></div><div class="rurl">${esc(latest.url || cd.url || '')}</div><p class="rnote">${esc(latest.note || '')}</p>${screenshot ? `<img class="canvas-file-image" src="${esc(screenshot)}" alt="Browser screenshot">` : '<div class="canvas-file-note">Waiting for the browser image…</div>'}`;
    return;
  }
  if (cd.type === 'computer') {
    const index = c.messages.indexOf(m);
    const related = c.messages.slice(index).filter(item => item.card?.type === 'computer' && (!cd.taskId || item.card.taskId === cd.taskId));
    const latest = related.at(-1)?.card || cd;
    const lines = related.flatMap(item => item.card.lines || []).slice(-40);
    body.innerHTML = back + `<div class="arti-head"><b>Computer output</b><span class="chip">${esc(latest.status || '')}</span></div><div class="term mini" id="pcout">${lines.map(L => `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`).join('')}${latest.status === 'running' ? '<div class="tdots"><i></i><i></i><i></i></div>' : ''}</div>`;
    if (cd.pcId) pcConnect(cd.pcId);
    return;
  }
  if (cd.type === 'file' || cd.type === 'canvas') {
    body.innerHTML = back + canvasDocumentHTML(cd, cd.type === 'file' ? canvasFileContent(c,m) : cd.content);
    return;
  }
  body.innerHTML = back + `<div class="canvas-selected-card">${cardNode(c,m)}</div>`;
}

function paintCanvas(){
  const cv = $('#canvas'); if (!cv) return;
  scopeMailCache();
  if (state.canvasTab === 'agent') state.canvasTab = 'approvals';
  if (state.canvasTab === 'trace' || state.canvasTab === 'wallet' || state.canvasTab === 'live') state.canvasTab = 'canvas';
  if (!['canvas', 'subagents', 'mail', 'payments', 'approvals'].includes(state.canvasTab)) state.canvasTab = 'canvas';
  if (!state._showLiveInCanvas) state._showLiveInCanvas = false;
  const c = chat();
  const top = state.canvasTab || 'canvas';
  const selected = c && (c.messages || []).find(m => m.id === c.canvasSelectedMessageId);
  if (!(top === 'canvas' && (state._showLiveInCanvas || selected?.card?.liveId)) && (liveWS || pcWS)) liveClose();
  const liveId = liveIdFor(c);
  cv.innerHTML = `
    <div class="canvas-resize" id="canvasResize"></div>
    <div class="canvas-head">
      ${canvasHeroHTML()}
      <div class="canvas-head-row">
        <div class="seg canvas-seg">
          <button class="${top === 'canvas' ? 'on' : ''}" data-act="ctab" data-t="canvas">${icon('easel',14)} Canvas${liveId ? '<span class="livedot"></span>' : ''}</button>
          <button class="${top === 'subagents' ? 'on' : ''}" data-act="ctab" data-t="subagents">${icon('clock',14)} Automations <span class="cnt">${(state.subAgents || []).length}</span></button>
          <button class="${top === 'mail' ? 'on' : ''}" data-act="ctab" data-t="mail">${icon('mail',14)} Mail${mailCache && mailCache.unread ? ` <span class="cnt">${mailCache.unread}</span>` : ''}</button>
          <button class="${top === 'payments' ? 'on' : ''}" data-act="ctab" data-t="payments">${icon('wallet',14)} Payments</button>
          <button class="${top === 'approvals' ? 'on' : ''}" data-act="ctab" data-t="approvals">${icon('shieldcheck',14)} Approvals</button>
        </div>
        <button class="canvas-close" data-act="togglecanvas" aria-label="Close canvas">${icon('x',16)}</button>
      </div>
    </div>
    <div class="cbody" id="cbody"></div>`;
  initCanvasResize();
  centerActiveSeg(cv);
  const an = $('#agentname');
  if (an) an.addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.agent.name = v; save(); paintSide(); paintMain(); paintCanvas();
    ensureMailbox(v).then(() => { if ($('#cbody')) paintCanvas(); });
    toast('Renamed — they answer to ' + v + ' now.');
  });
  const body = $('#cbody');
  if (top === 'mail'){
    paintMail(body);
    return;
  }
  if (top === 'payments'){
    body.innerHTML = paymentsTabContent();
    if (!state.composioLoading && signedIn()) refreshComposioApps();
    return;
  }
  if (top === 'approvals'){
    body.innerHTML = approvalsTabContent();
    return;
  }
  if (state.canvasTab === 'subagents'){
    body.innerHTML = subAgentsTabContent();
    refreshSubAgents();
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
  if (selected && (selected.card || selected.files?.[c.canvasSelectedFileIndex])) {
    paintCanvasSelection(body, c, selected);
    return;
  }
  const a = c && c.artifact;
  const run = canvasGalleryHTML(c) + runTimelineHTML(c);
  if (!a){
    body.innerHTML = run || `<div class="cempty">${Mascot.svg(state.agent.color,'idle',80,'mascot-bob')}<div style="font-weight:700;margin-top:12px">The canvas</div><div class="mut2">Charts, live pages, diffs and plans I create will render here while we chat.</div></div>`;
    return;
  }
  if (a.kind === 'chart'){
    const max = Math.max.apply(null, a.data.map(d => d.v));
    body.innerHTML = run + `<div class="chartbox"><div class="ct">${esc(a.title)}</div><div class="cs">n = 1,392 qualifying comments · last 30 days</div>
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
    if (m.kind === 'card' && m.card.type === 'file') rows.push({ ...m.card, chat: c.title, chatId:c.id, messageId:m.id });
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
    const stack = connected.slice(0, 6).map((a) =>
      `<span class="apps-stack-logo on" title="${esc(a.name || a.toolkit)}">${appLogoHtml(a)}</span>`
    ).join('') || `<span class="apps-stack-logo ghost">${icon('box',16)}</span>`;
    body = `<div class="apps-jump">
      <div class="apps-stack">${stack}</div>
      <div><b>${connected.length ? connected.length + ' live' : 'No connected apps'}</b></div>
      <button class="btn small" data-act="nav" data-view="apps">Open Connectors</button>
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
      <div class="rgt"><button class="btn ghost small" data-act="library-open" data-chat="${f.chatId}" data-msg="${f.messageId}">View</button><button class="btn ghost small" data-act="dlfile" data-i="${i}">${icon('down',14)} Download</button></div></div>`).join('') || '<div class="row mut">No files yet — artifacts the agent produces land here.</div>'}</div>`;
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
  const curTheme = THEMES.find(t => t.id === (state.theme || 'grey')) || THEMES[0];
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
    <div class="psec"><h3>${icon('star',15)} Theme</h3>
      <div class="kv"><div class="row" style="align-items:flex-start"><span style="color:var(--mut)">${icon('star',16)}</span>
        <div style="flex:1"><b>Accent color</b><div class="sub">Current: ${esc(curTheme.name)} · applies instantly</div>
          <div class="swatches" style="justify-content:flex-start;margin-top:12px">${THEMES.map(t => `<button class="swatch ${curTheme.id === t.id ? 'on' : ''}" data-act="theme" data-v="${t.id}" title="${t.name}"><span style="width:26px;height:26px;border-radius:50%;background:${t.c};display:block"></span></button>`).join('')}</div>
        </div></div></div>
    </div>
    <div class="psec"><h3 style="color:var(--acc)">${icon('alert',15)} Danger zone</h3>
      <div class="kv"><div class="row"><div><b>Release this agent</b><div class="sub">Deletes chats, vault, memory and the claim on this device.</div></div>
      <div class="rgt"><button class="btn soft small" data-act="reset">Release</button></div></div></div>
    </div>`;
  } else if (tab === 'secrets'){
    body = settingsSecretsBody(state.vault);
  } else if (tab === 'memory'){
    body = settingsMemoryBody();
  } else if (tab === 'library'){
    body = libraryTabContent();
  } else if (tab === 'browser'){
    const bp = state.browserProfile || { profile:'Default', sandbox:true, allowlist:true };
    body = `<div class="kv">
      <div class="row"><span style="color:var(--mut)">${icon('globe',16)}</span><div><b>Profile</b><div class="sub">Sandboxed browser identity for this device</div></div>
      <div class="rgt"><input class="field" id="bprof" value="${esc(bp.profile)}" style="max-width:180px"></div></div>
    </div>`;
  } else if (tab === 'billing'){
    body = billingBodyHtml();
  }
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Settings</h1><span style="display:flex;gap:8px;align-items:center"><span class="chip">${icon('gear',12)} Arche 1.0</span><button class="btn ghost small" data-act="nav" data-view="chat">Back to chat</button></span></div>
    <p class="psub">${tab === 'billing' ? 'A space for you, your agent, and what comes next.' : 'Profiles, theme, secrets, memory, library, browser and billing — all scoped to your account, never shared.'}</p>
    <div class="seg">
      <button class="${tab === 'profiles' ? 'on' : ''}" data-act="stab" data-t="profiles">${icon('user',14)} Profiles</button>
      <button class="${tab === 'secrets' ? 'on' : ''}" data-act="stab" data-t="secrets">${icon('key',14)} Secrets</button>
      <button class="${tab === 'memory' ? 'on' : ''}" data-act="stab" data-t="memory">${icon('book',14)} Memory</button>
      <button class="${tab === 'library' ? 'on' : ''}" data-act="stab" data-t="library">${icon('file',14)} Library</button>
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
    loadBillingContent();
  }
}

/* ---------------- Apps — Belna connected apps via Composio ---------------- */
function appLogoHtml(a){
  return a && a.logo
    ? `<img src="${esc(a.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<span class="app-fallback">${esc(String((a && (a.name || a.toolkit)) || '?').slice(0, 1).toUpperCase())}</span>`;
}
function appsStackList(apps){
  const featured = ['gmail','googlecalendar','slack','github','notion','outlook','linear','googledrive','jira','hubspot'];
  const connected = apps.filter((a) => a.connected);
  const extras = featured.map((t) => apps.find((a) => a.toolkit === t && !a.connected)).filter(Boolean);
  const more = apps.filter((a) => !connected.includes(a) && !extras.includes(a));
  return [...connected, ...extras, ...more].slice(0, 7);
}
function accountFace(acc, app){
  if (acc && acc.picture) return `<img src="${esc(acc.picture)}" alt="" loading="lazy" onerror="this.style.display='none'">`;
  const letter = String((acc && (acc.name || acc.email)) || (app && (app.name || app.toolkit)) || '?').replace(/^[^A-Za-z0-9]+/, '').slice(0, 1).toUpperCase() || '?';
  return `<span>${esc(letter)}</span>`;
}
function switchHtml(on, attrs){
  return `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" ${attrs}><i></i></button>`;
}
function connectorBodyHtml(a){
  const detail = (state.appDetails && state.appDetails[a.toolkit]) || {};
  const accounts = Array.isArray(detail.accounts) ? detail.accounts : (Array.isArray(a.accounts) ? a.accounts : []);
  const perms = Array.isArray(detail.permissions) ? detail.permissions : [];
  if (detail.loading && !perms.length) {
    return `<div class="conn-body"><div class="conn-skel"></div><div class="conn-skel"></div></div>`;
  }
  if (detail.error && !perms.length && !accounts.length) {
    return `<div class="conn-body"><div class="conn-empty">${esc(detail.error)}</div></div>`;
  }
  const connectLabel = accounts.length ? 'Add account' : 'Connect';
  const accountRows = accounts.map((acc) => {
    const mail = acc.email || acc.alias || acc.wordId || 'Connected account';
    const nm = acc.name && acc.name !== acc.email ? acc.name : '';
    return `<div class="conn-account">
      <span class="conn-ava">${accountFace(acc, a)}</span>
      <div class="conn-who"><b>${esc(mail)}</b>${nm ? `<span>${esc(nm)}</span>` : ''}</div>
      <button class="btn ghost tiny" data-act="disconnect-app" data-toolkit="${esc(a.toolkit)}" data-account="${esc(acc.id)}">Disconnect</button>
    </div>`;
  }).join('') || `<div class="conn-empty">No accounts yet. Connect one to let your agent use ${esc(a.name || a.toolkit)}.</div>`;
  const kindBlock = (kind, label) => {
    const rows = perms.filter((p) => p.kind === kind);
    if (!rows.length) return '';
    const allOn = rows.every((p) => p.enabled);
    return `<div class="conn-kind">
      <div class="conn-kind-h">
        <b>${label}</b>
        <span>${rows.filter((p) => p.enabled).length}/${rows.length}</span>
        ${switchHtml(allOn, `data-act="perm-kind" data-toolkit="${esc(a.toolkit)}" data-kind="${kind}"`)}
      </div>
      ${rows.map((p) => `<div class="conn-perm">
        <div><b>${esc(p.name || p.slug)}</b><span>${esc(p.description || p.slug)}</span></div>
        ${switchHtml(!!p.enabled, `data-act="perm-toggle" data-toolkit="${esc(a.toolkit)}" data-slug="${esc(p.slug)}"`)}
      </div>`).join('')}
    </div>`;
  };
  return `<div class="conn-body">
    <div class="conn-actions">
      <button class="btn small" data-act="connect-app" data-toolkit="${esc(a.toolkit)}" data-auth="${esc(a.authConfigId || '')}">${icon('plus',14)} ${connectLabel}</button>
      ${a.connected ? `<button class="btn ghost small" data-act="automate-app" data-toolkit="${esc(a.toolkit)}">Automate</button>` : ''}
    </div>
    <div class="conn-sec"><h3>Accounts</h3>${accountRows}</div>
    <div class="conn-sec">
      <h3>Permissions</h3>
      <p class="conn-hint">Read and write access your agent may use. Turn any off to block it.</p>
      ${detail.loading ? `<div class="conn-skel"></div>` : (perms.length ? `${kindBlock('read', 'Read')}${kindBlock('write', 'Write')}` : `<div class="conn-empty">No permissions listed for this connector.</div>`)}
    </div>
  </div>`;
}
function paintApps(M){
  const apps = Array.isArray(state.composioApps) ? state.composioApps : [];
  const q = String(state.appQuery || '').toLowerCase().trim();
  const filter = state.appFilter === 'connected' ? 'connected' : 'all';
  const connectedCount = apps.filter((a) => a.connected).length;

  let list = apps.slice();
  if (filter === 'connected') list = list.filter((a) => a.connected);
  if (q) {
    list = list.filter((a) =>
      String(a.name || '').toLowerCase().includes(q) ||
      String(a.toolkit || '').toLowerCase().includes(q) ||
      String(a.description || '').toLowerCase().includes(q) ||
      (a.accounts || []).some((acc) => String(acc.email || acc.name || '').toLowerCase().includes(q))
    );
  }
  list.sort((a, b) => (Number(b.connected) - Number(a.connected)) || String(a.name || a.toolkit).localeCompare(String(b.name || b.toolkit)));

  const rows = list.map((a) => {
    const open = state.appOpen === a.toolkit;
    const n = Number(a.accountCount || (a.accounts && a.accounts.length) || (a.connected ? 1 : 0));
    const sub = a.connected ? (n === 1 ? '1 account' : `${n} accounts`) : 'Not connected';
    return `<article class="conn-row ${a.connected ? 'is-connected' : ''} ${open ? 'is-open' : ''}" data-toolkit="${esc(a.toolkit)}">
      <button type="button" class="conn-head" data-act="toggle-connector" data-toolkit="${esc(a.toolkit)}">
        <span class="app-logo">${appLogoHtml(a)}${a.connected ? `<i class="app-pip">${icon('check',10)}</i>` : ''}</span>
        <span class="conn-meta"><b>${esc(a.name || a.toolkit)}</b><span>${esc(sub)}</span></span>
        ${a.connected ? `<span class="chip green">Connected</span>` : ''}
        <span class="conn-chev">${icon('chev',16)}</span>
      </button>
      ${open ? connectorBodyHtml(a) : ''}
    </article>`;
  }).join('');

  let board = `<div class="conn-list">${rows}</div>`;
  if (state.composioLoading && !list.length) board = `<div class="conn-list">${'<article class="conn-row skel"></article>'.repeat(6)}</div>`;
  else if (!state.composioLoading && !apps.length) board = `<div class="apps-empty">${icon('box',22)}<b>No connectors yet</b><span>Connections aren't configured on this server.</span></div>`;
  else if (!state.composioLoading && !list.length) board = `<div class="apps-empty">${icon('search',22)}<b>No match</b></div>`;

  M.innerHTML = `<div class="page"><div class="pageinner apps-page">
    <div class="apps-toolbar">
      <h1>Connectors</h1>
      <label class="apps-search-wrap">${icon('search',16)}<input class="field apps-search" id="appquery" placeholder="Search connectors" value="${esc(state.appQuery || '')}"></label>
      <div class="seg apps-filter">
        <button class="${filter === 'connected' ? 'on' : ''}" data-act="app-filter" data-f="connected">Connected${connectedCount ? ` ${connectedCount}` : ''}</button>
        <button class="${filter === 'all' ? 'on' : ''}" data-act="app-filter" data-f="all">All</button>
      </div>
      <button class="iconbtn" data-act="refresh-apps" title="Refresh">${icon('refresh',16)}</button>
    </div>
    ${board}
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
  if (!state.composioLoading && signedIn()) refreshComposioApps();
}

/* ================================================================
   GLOBAL EVENTS
================================================================ */
window.addEventListener('resize', () => {
  if (state.view === 'settings' && $('#main')) centerActiveSettingsTab($('#main'));
});
window.addEventListener('focus', () => {
  startSandboxLease();
  if (signedIn() && state.onboarded) syncFromBackend().then((updated) => { if (updated && $('#side')) paintSide(); });
  if (signedIn() && state.canvasOpen && state.canvasTab === 'payments') refreshComposioApps(true);
});
window.addEventListener('pagehide', () => stopSandboxLease());
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-onboarding-name]');
  if (!form) return;
  e.preventDefault();
  const c = state.chats.find(c => c.id === form.dataset.chat);
  const m = c?.messages.find(m => m.id === form.dataset.msg);
  answerOnboarding(c, m, form.elements.agentName.value);
});
document.addEventListener('input', e => {
  const form = e.target.closest('[data-onboarding-name]');
  if (!form) return;
  const c = state.chats.find(c => c.id === form.dataset.chat);
  const m = c?.messages.find(m => m.id === form.dataset.msg);
  if (m?.card.status === 'pending') { m.card.draft = e.target.value; save(); }
});
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

  if (signedIn() && needsOnboarding() && !['qopt','open-passport','togglemenu','usermenu','signout'].includes(act)) {
    e.preventDefault(); toast('Finish setting up your agent first.'); return;
  }
  if (act === 'qopt' && m?.card?.onboarding) { answerOnboarding(c, m, b.dataset.o); return; }
  if (act === 'life-ask'){
    e.preventDefault();
    const prompt = (b.dataset.prompt || '').trim();
    if (prompt) landingRun(prompt);
    return;
  }
  if (act === 'landing-passport-tab') {
    const card = b.closest('.landing-passport-card');
    const selected = b.dataset.passportTab;
    if (!card || !selected) return;
    card.querySelectorAll('[data-passport-tab]').forEach(tab => {
      const active = tab.dataset.passportTab === selected;
      tab.classList.toggle('on', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    card.querySelectorAll('[data-passport-panel]').forEach(panel => {
      const active = panel.dataset.passportPanel === selected;
      panel.hidden = !active;
      panel.classList.toggle('on', active);
    });
    return;
  }
  if (act === 'open-passport') {
    if (!signedIn()) { renderAuth(); return; }
    if (needsOnboarding()) { await openOnboardingPassport(c, m); return; }
    state.canvasOpen = false; state.view = 'settings'; state.settingsTab = 'profiles'; save(); renderApp(); return;
  }

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
      else { startPendingPromptFlow(); }
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

  /* navigation */
  if (act === 'togglemenu'){ mobileNavOpen = !mobileNavOpen; renderApp(); return; }
  if (act === 'nav'){
    if (!signedIn()){ renderAuth(); return; }
    mobileNavOpen = false; state.view = b.dataset.view; state.userMenuOpen = false; save(); renderApp();
    if (state.view === 'apps') refreshComposioApps();
    return;
  }
  if (act === 'refresh-apps'){
    refreshComposioApps(true).then(() => { if (state.appOpen) openConnector(state.appOpen, true); });
    return;
  }
  if (act === 'payments-stripe-apps'){
    state.appQuery = 'stripe'; state.appFilter = 'all'; state.view = 'apps';
    save(); renderApp(); refreshComposioApps(true); return;
  }
  if (act === 'app-filter'){ state.appFilter = b.dataset.f === 'connected' ? 'connected' : 'all'; save(); paintApps(document.getElementById('main')); return; }
  if (act === 'app-focus'){
    const tk = String(b.dataset.toolkit || '');
    openConnector(tk, true);
    return;
  }
  if (act === 'toggle-connector'){ openConnector(b.dataset.toolkit); return; }
  if (act === 'perm-toggle'){
    const on = b.getAttribute('aria-checked') !== 'true';
    toggleConnectorPermission(b.dataset.toolkit, b.dataset.slug, on);
    return;
  }
  if (act === 'perm-kind'){
    const on = b.getAttribute('aria-checked') !== 'true';
    toggleConnectorKind(b.dataset.toolkit, b.dataset.kind, on);
    return;
  }
  if (act === 'connect-app'){ connectComposioApp(b.dataset.toolkit, b.dataset.auth); return; }
  if (act === 'disconnect-app'){ disconnectComposioApp(composioAppByToolkit(b.dataset.toolkit), b.dataset.account); return; }
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
    state.canvasTab = 'canvas';
    state.canvasOpen = true; const app = $('#app'); if (app) app.classList.remove('nocanvas');
    save(); paintCanvas(); return;
  }
  if (act === 'agent-edit'){
    state.agentEdit = !state.agentEdit;
    state.canvasOpen = true;
    const app = $('#app'); if (app) app.classList.remove('nocanvas');
    save(); paintCanvas();
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
      await syncFromBackend(true);
      state.activeChat = result.chatId || agent.chatId; state.view = 'chat'; save(); renderApp();
      toast(`${agent.name} completed its run.`);
    } catch (err) { b.disabled = false; toast(err.message); }
    return;
  }
  if (act === 'open-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    await syncFromBackend(true);
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
  if (act === 'ctab'){
    const next = b.dataset.t === 'agent' || b.dataset.t === 'trace' || b.dataset.t === 'wallet' ? 'canvas' : b.dataset.t;
    state.canvasTab = ['canvas', 'subagents', 'mail', 'payments', 'approvals'].includes(next) ? next : 'canvas';
    if (next !== 'canvas') state._showLiveInCanvas = false;
    save(); paintCanvas();
    if (next === 'mail') getMail(true, state.mailTab).then(() => { if (state.canvasTab === 'mail' && $('#cbody')) paintMail($('#cbody')); });
    if (next === 'payments') refreshComposioApps(true);
    return;
  }
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
  if (act === 'library-open' && c){
    state.activeChat = c.id; state.view = 'chat'; state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = false;
    c.canvasSelectedMessageId = m?.card ? m.id : null; delete c.canvasSelectedFileIndex;
    save(); renderApp(); return;
  }
  if (act === 'canvas-card' && c && m?.card){
    state.activeChat = c.id;
    c.canvasSelectedMessageId = m.card.type === 'artifact' && c.artifact?.title === m.card.title ? null : m.id;
    delete c.canvasSelectedFileIndex;
    state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = false;
    $('#app')?.classList.remove('nocanvas'); save(); paintCanvas(); return;
  }
  if (act === 'canvas-upload' && c && m?.files?.[Number(b.dataset.i)]){
    state.activeChat = c.id; c.canvasSelectedMessageId = m.id; c.canvasSelectedFileIndex = Number(b.dataset.i);
    state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = false;
    $('#app')?.classList.remove('nocanvas'); save(); paintCanvas(); return;
  }
  if (act === 'canvas-back'){
    const current = chat(); if (current) { current.canvasSelectedMessageId = null; delete current.canvasSelectedFileIndex; }
    state._showLiveInCanvas = false; liveClose(); save(); paintCanvas(); return;
  }
  if (act === 'viewcanvas'){ const current = chat(); if (current) { current.canvasSelectedMessageId = null; delete current.canvasSelectedFileIndex; } state._showLiveInCanvas = false; state.canvasOpen = true; state.canvasTab = 'canvas'; $('#app') && $('#app').classList.remove('nocanvas'); paintCanvas(); return; }
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
    const reaction = findReaction(b.dataset.reaction || b.dataset.emoji);
    if (!reaction) return;
    const reactions = new Set((Array.isArray(m.reactions) ? m.reactions : []).map((r) => findReaction(r)?.id).filter(Boolean));
    reactions.has(reaction.id) ? reactions.delete(reaction.id) : reactions.add(reaction.id);
    m.reactions = [...reactions]; save(); replaceNode(c, m); return;
  }
  if (act === 'copycode'){ const t = $('#codebox'); if (t) await copyText(t.textContent); toast('Copied'); return; }

  /* card resolutions (real accounts only — no anonymous approvals) */
  if (act === 'task-change-cancel' && c) {c.taskReply=null;c.taskReplyScope=null;save();paintMain();return;}
  if (['task-change','task-change-team'].includes(act) && m?.card?.taskId) {c.taskReply=m.card.taskId;c.taskReplyScope=act==='task-change-team'?'team':'task';save();paintMain();$('#cprompt')?.focus();return;}
  if (['task-stop','task-continue'].includes(act) && m?.card?.taskId) {
    b.disabled=true;
    try {await Engine.controlTask(makeRT(c),m.card.taskId,act==='task-stop'?'cancel':'continue');}catch(error){toast(error.message);}
    finally{b.disabled=false;}return;
  }
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
    try {
      if(m.card.taskId) await Engine.controlTask(makeRT(c),m.card.taskId,'decide',{callId:m.card.managedCallId,allow,version:m.card.taskVersion});
      else await Engine.resume(makeRT(c), { callId:m.card.managedCallId, allow, answer:act === 'qopt' ? b.dataset.o : undefined });
    }catch(error){toast(error.message);}
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
  if (act === 'billing-topup'){
    const pack = $('#buypack');
    if (pack) { pack.scrollIntoView({ block:'center', behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); pack.focus({ preventScroll:true }); }
    return;
  }
  if (act === 'billing-refresh'){
    invalidateBilling(); paintSide();
    if (state.view === 'settings') paintSettings($('#main')); else paintBilling($('#main'));
    return;
  }
  if (act === 'redeem'){
    const code = (($('#giftcode') || {}).value || '').trim();
    if (!code){ toast('Paste a gift code first.'); return; }
    const owner = billingIdentity();
    try {
      const j = await window.LingonAuth.api('/api/billing/redeem', { method: 'POST', body: JSON.stringify({ code }) });
      if (owner !== billingIdentity()) return;
      setBillingCache(j.billing);
      toast(`Redeemed ${fmtC(j.credits)} credits ($${j.amount} gift).`);
      if (state.view === 'settings') paintSettings($('#main')); else paintBilling($('#main'));
      paintSide();
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'buycredits'){
    try {
      const pack = Number((($('#buypack') || {}).value) || 0);
      if (!pack){ toast('Pick a credit pack.'); return; }
      const j = await window.LingonAuth.api('/api/billing/credits', { method: 'POST', body: JSON.stringify({ extraCredits: pack }) });
      if (j.url) { window.location.href = j.url; return; }
      toast(j.note || 'Checkout started.');
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'buygift'){
    try {
      const j = await window.LingonAuth.api('/api/billing/gift', { method: 'POST', body: JSON.stringify({ amount: Number(b.dataset.amt || 0) }) });
      if (j.url) { window.location.href = j.url; return; }
      toast(j.note || 'Checkout started.');
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

function handleBillingReturn(flag, q){
  const sid = q && q.get('session_id');
  if (flag === 'cancelled') { setTimeout(() => toast('Checkout cancelled — no charge made.'), 800); return; }
  if (flag === 'portal') { setTimeout(() => toast('Subscription updated.'), 800); return; }
  if ((flag === 'gift' || flag === 'credits' || flag === 'success') && sid && window.LingonAuth.signedIn()) {
    const owner = billingIdentity();
    window.LingonAuth.api('/api/billing/checkout-result?session_id=' + encodeURIComponent(sid)).then((j) => {
      if (owner !== billingIdentity()) return;
      if (j.billing) { setBillingCache(j.billing); if ($('#side')) paintSide(); }
      if (j.gift && j.gift.code) toast('Gift card ready: ' + j.gift.code + ' — redeem or share it.');
      else if (j.kind === 'credits') toast('Credits added. See Billing.');
      else toast('Payment complete — your credits are on the way. See Billing.');
    }).catch((e) => toast(e.message || 'Payment complete. See Billing.'));
    return;
  }
  if (flag === 'success') setTimeout(() => toast('Payment complete — your monthly credits are on the way. See Billing.'), 800);
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
        // Scope persisted state before the background sync can merge remote data.
        try { ensureOwnerScope(); if (me.user && me.user.id) { state.ownerId = me.user.id; state.view = 'chat'; save(); } } catch {}
        const owner = billingIdentity();
        syncFromBackend(true).then(() => {
          if (owner === billingIdentity() && $('#side')) paintSide();
        }).catch(() => {});
        setTimeout(() => toast('Signed in as ' + me.user.email), 400);
        return 'google';
      } catch {
        window.LingonAuth.set(null);
        return 'error:Could not complete sign-in. Please try again.';
      }
    }
  } catch {}
  return 'none';
}
const bootReady = bootHash().then((st) => {
  expirePending();
  applyTheme();
  // Navigation can remove the React host while the scripts/auth are loading.
  // A later mount will attach the already initialized app to its new host.
  root = document.getElementById('root');
  if (!root) return;
  if (st && String(st).startsWith('error:')) {
    const msg = String(st).slice(6);
    // Land on the auth card so the failure is visible in context.
    renderAuth();
    const m = document.getElementById('amsg');
    if (m) m.textContent = 'Sign-in failed: ' + msg;
    else setTimeout(() => toast('Sign-in failed: ' + msg), 400);
    return;
  }
  render();
  try {
    const q = new URLSearchParams(window.location.search);
    const f = q.get('billing');
    if (f) {
      window.history.replaceState(null, '', window.location.pathname);
      handleBillingReturn(f, q);
    }
  } catch {}
});
window.LingonAppRuntime = {
  async mount(element){
    await bootReady;
    if (root === element && root.childElementCount) return;
    root = element;
    render();
  },
};
})();
