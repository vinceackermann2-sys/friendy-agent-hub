/* Lingon persistence.
   - If SUPABASE_URL + key are set, uses Supabase tables (see supabase/schema.sql).
   - Otherwise uses local JSON file server/data.json (gitignored) so the app is
     fully real + persistent today, and migrates cleanly to Supabase later.
   Vault secrets are AES-256-GCM encrypted at rest and need ENCRYPTION_KEY to
   be saved; values are never sent to the model. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { upkeepRows } = require('./agents/upkeep');
const { forbiddenPaymentSecret } = require('./agents/payment-safety');
const { createClientStateStore } = require('./client-state');

const DATA_FILE = path.join(__dirname, 'data.json');

function loadLocal() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { memories: [], secrets: [], apps: [], approvals: [], chats: [], subAgents: [], automationRuns: [], mailboxes: [], mailMessages: [], mailDrafts: [], connectorPermissions: [], agentContexts: [], shopPayAccounts: [], shopPayOrders: [] };
  }
}
function saveLocal(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// ---- encryption ----
function encKey() {
  const h = (process.env.ENCRYPTION_KEY || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(h)) return Buffer.from(h, 'hex');
  if (h.length >= 16) return crypto.createHash('sha256').update(h).digest();
  return null; // no key -> obfuscation fallback
}
const secretsEncrypted = () => !!encKey();
function encryptValue(plain, aad) {
  const k = encKey();
  if (!k) return { alg: 'b64', data: Buffer.from(String(plain), 'utf8').toString('base64') };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  if (aad) c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: ct.toString('hex'), ...(aad ? { aad: true } : {}) };
}
function decryptValue(obj, aad) {
  try {
    if (!obj) return '';
    if (obj.alg === 'b64') return Buffer.from(obj.data, 'base64').toString('utf8');
    const k = encKey();
    if (!k || obj.alg !== 'aes-256-gcm') return '';
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(obj.iv, 'hex'));
    // Values sealed with an owner/row binding only open for that same row.
    if (obj.aad) { if (!aad) return ''; d.setAAD(Buffer.from(aad, 'utf8')); }
    d.setAuthTag(Buffer.from(obj.tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(obj.data, 'hex')), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// ---- Supabase (optional, supports old + new key names) ----
let sb = null;
function supaKey() {
  return (
    (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() ||
    (process.env.SUPABASE_SECRET_KEY || '').trim() ||
    (process.env.SUPABASE_ANON_KEY || '').trim() ||
    (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim()
  );
}
function supa() {
  if (sb !== undefined && sb !== null) return sb;
  const url = (process.env.SUPABASE_URL || '').trim();
  const token = supaKey();
  if (!url || !token) {
    sb = null;
    return sb;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    sb = createClient(url, token);
  } catch {
    sb = null;
  }
  return sb;
}
function supaConfigured() {
  return !!(process.env.SUPABASE_URL || '').trim() && !!supaKey();
}
async function ensureProfile(userId) {
  const s = supa();
  if (!s || !userId) return;
  try {
    await s.from('profiles').upsert({ id: userId }, { onConflict: 'id' });
  } catch {}
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const AGENT_DOC_KEYS = ['identity', 'soul', 'user', 'agents'];
function cleanAgent(agent = {}) {
  const style = ['Playful', 'Precise', 'Calm', 'Bold'].includes(agent.pers) ? agent.pers : 'Playful';
  const rawName = String(agent.name || '').trim().slice(0, 40);
  return {
    name: !rawName || /^lingon$/i.test(rawName) ? 'Your agent' : rawName,
    color: String(agent.color || 'lingon').trim().slice(0, 30) || 'lingon',
    pers: style,
  };
}
function defaultAgentDocuments(agent = {}) {
  const a = cleanAgent(agent);
  return {
    identity: `# Identity\n\nName: ${a.name}\nStyle: ${a.pers}`,
    soul: '# Soul\n\nBe warm, candid, practical, and reliable. Adapt detail to the user and keep promises explicit.',
    user: '# User\n\nAdd stable preferences, background, language, and timezone here.',
    agents: '# Working agreement\n\nPlan substantial work, verify results with evidence, surface uncertainty, and ask before irreversible external actions.',
  };
}
function cleanAgentDocuments(documents = {}, agent = {}) {
  const defaults = defaultAgentDocuments(agent);
  return Object.fromEntries(AGENT_DOC_KEYS.map((key) => [key,
    String(documents?.[key] || defaults[key]).replace(/\u0000/g, '').replace(key === 'identity' ? /^(Name:[ \t]*)Lingon[ \t]*$/im : /$^/, `$1${agent.name || 'Your agent'}`).slice(0, key === 'user' ? 4000 : 8000),
  ]));
}
function contextView(row, hint = {}) {
  const agent = cleanAgent({ ...(row?.agent || {}), ...(hint || {}) });
  return { agent, documents: cleanAgentDocuments(row?.documents, agent), revision: Number(row?.revision || 0) };
}
async function getAgentContext(userId, hint = {}) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('agent_contexts').select('agent,documents,revision,updated_at').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return contextView(data, hint);
    } catch (e) { console.warn('[store] agent context fallback:', e.message); }
  }
  const row = (loadLocal().agentContexts || []).find((item) => item.userId === userId);
  return contextView(row, hint);
}
async function saveAgentContext(userId, input = {}) {
  const previous = await getAgentContext(userId);
  const agent = cleanAgent({ ...previous.agent, ...(input.agent || {}) });
  const documents = cleanAgentDocuments({ ...previous.documents, ...(input.documents || {}) }, agent);
  const expected = input.revision == null ? null : Number(input.revision);
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { data, error } = await s.rpc('write_agent_context', {
        p_user_id:userId, p_agent:agent, p_documents:documents, p_revision:expected,
      });
      if (error) throw error;
      return contextView(Array.isArray(data) ? data[0] : data);
    } catch (e) {
      if (String(e.code || '') === '40001' || /changed/i.test(e.message)) {
        throw Object.assign(new Error('Agent settings changed on another device. Refresh and try again.'), { code:'CONFLICT' });
      }
      console.warn('[store] save agent context failed:', e.message);
      throw Object.assign(new Error('Agent context could not be saved. Try again.'), { code:'PERSISTENCE' });
    }
  }
  const d = loadLocal();
  d.agentContexts = d.agentContexts || [];
  const row = d.agentContexts.find((item) => item.userId === userId);
  if (row && expected != null && expected !== Number(row.revision || 0)) {
    throw Object.assign(new Error('Agent settings changed on another device. Refresh and try again.'), { code:'CONFLICT' });
  }
  if (row) Object.assign(row, { agent, documents, revision:Number(row.revision || 0) + 1, updatedAt:Date.now() });
  else d.agentContexts.push({ userId, agent, documents, revision:1, updatedAt:Date.now() });
  saveLocal(d);
  return contextView(row || d.agentContexts[d.agentContexts.length - 1]);
}
async function syncAgentContext(userId, hint = {}) {
  const current = await getAgentContext(userId);
  const next = cleanAgent({ ...current.agent, ...hint });
  if (current.revision && JSON.stringify(next) === JSON.stringify(current.agent)) return current;
  return saveAgentContext(userId, { agent:next, documents:current.documents, revision:current.revision });
}

function memoryCategory(value) {
  return ['user','long_term','daily'].includes(value) ? value : 'long_term';
}
function memoryImportance(value,fallback=1){const n=Number(value);return Number.isFinite(n)?Math.min(Math.max(Math.round(n),0),3):fallback;}
function memoryView(row) {
  return {
    id:row.id, text:row.text, src:row.src || 'chat', category:memoryCategory(row.category),
    status:row.status || 'active', importance:Number(row.importance ?? 1),
    at:new Date(row.updated_at || row.observed_at || row.created_at || row.at || Date.now()).getTime(),
    observedAt:new Date(row.observed_at || row.created_at || row.at || Date.now()).getTime(),
    supersededBy:row.superseded_by || null, sourceChatId:row.source_chat_id || null,
    sourceMessageId:row.source_message_id || null, score:Number(row.score || 0),
  };
}
function memoryWords(value) {
  return String(value || '').toLowerCase().replace(/[^a-zåäö0-9\s]/g,' ').split(/\s+/).filter((word)=>word.length>2);
}
function rankStoredMemories(rows, query, limit=12) {
  const wanted=new Set(memoryWords(query));
  return rows.map((row)=>{const words=memoryWords(row.text),hits=words.filter(word=>wanted.has(word)).length,coverage=words.length?hits/words.length:0;
    return {row,hits,score:hits*10+coverage*4+Number(row.importance ?? 1)*2+(row.category==='user'?2:row.category==='long_term'?1:0)};
  }).filter(item=>!wanted.size || item.hits>0).sort((a,b)=>b.score-a.score || b.row.at-a.row.at).slice(0,limit).map(item=>({...item.row,score:item.score}));
}
async function listMemories(userId, options = {}) {
  const status=options.status || 'active',limit=Math.min(Math.max(Number(options.limit) || 250,1),1000),offset=Math.max(Number(options.offset) || 0,0);
  const s = supa();
  if (s) {
    try {
      let query=s.from('memories').select('*').eq('user_id',userId).eq('status',status).order('updated_at',{ascending:false}).range(offset,offset+limit-1);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(memoryView);
    } catch (e) {
      console.warn('[store] supabase memories read failed:', e.message);
      throw Object.assign(new Error('Memory could not be loaded. Try again.'),{code:'PERSISTENCE'});
    }
  }
  const d = loadLocal();
  return d.memories.filter((m) => (!userId || m.userId === userId) && (m.status || 'active') === status).sort((a,b)=>b.at-a.at).slice(offset,offset+limit).map(memoryView);
}
async function memoryStats(userId) {
  const s=supa();
  if(s){try{const {count,error}=await s.from('memories').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('status','active');if(error)throw error;return {active:Number(count || 0)};}catch(e){console.warn('[store] memory stats failed:',e.message);throw Object.assign(new Error('Memory count could not be loaded. Try again.'),{code:'PERSISTENCE'});}}
  return {active:(loadLocal().memories || []).filter(m=>m.userId===userId&&(m.status || 'active')==='active').length};
}
async function searchMemories(userId, query, limit = 12, includeCore = false) {
  const size=Math.min(Math.max(Number(limit) || 12,1),100),s=supa();
  if(s){try{const {data,error}=await s.rpc('search_agent_memories',{p_user_id:userId,p_query:String(query || '').slice(0,300),p_limit:size,p_include_core:includeCore});if(error)throw error;return (data || []).map(memoryView);}catch(e){console.warn('[store] memory search failed:',e.message);throw Object.assign(new Error('Memory search could not complete. Try again.'),{code:'PERSISTENCE'});}}
  const rows=(loadLocal().memories || []).filter(m=>m.userId===userId&&(m.status || 'active')==='active').map(memoryView);
  const ranked=rankStoredMemories(rows,query,size);
  if(!includeCore)return ranked;
  const seen=new Set(ranked.map(m=>m.id));
  return [...ranked,...rows.filter(m=>m.category==='user'&&m.importance>=2&&!seen.has(m.id)).sort((a,b)=>b.at-a.at)].slice(0,size);
}
async function getMemory(userId,id) {
  const s=supa();
  if(s){const {data,error}=await s.from('memories').select('*').eq('user_id',userId).eq('id',id).maybeSingle();if(error)throw error;return data?memoryView(data):null;}
  const row=(loadLocal().memories || []).find(m=>m.userId===userId&&m.id===id);return row?memoryView(row):null;
}
async function addMemory(userId, text, src, meta = {}) {
  const cleaned = String(text || '').replace(/\u0000/g, '').trim().slice(0, 2000);
  if (!cleaned) throw Object.assign(new Error('Memory text required.'), { code:'BAD_INPUT' });
  if (/(ghp_|github_pat_|sk-|bearer\s+|password\s*[:=]|api[_-]?key\s*[:=][A-Za-z0-9_-]{8,}|AQ\.[A-Za-z0-9_-]+|sb_secret)/i.test(cleaned)) {
    throw Object.assign(new Error('Secrets cannot be saved to memory.'), { code:'BAD_INPUT' });
  }
  const s = supa();
  const now=new Date().toISOString(),category=memoryCategory(meta.category);
  const row = { id:`mem_${uid()}`,user_id:userId,text:cleaned,src:src || 'chat',category,status:'active',importance:memoryImportance(meta.importance ?? 1),observed_at:meta.observedAt || now,updated_at:now,source_chat_id:meta.chatId || null,source_message_id:meta.messageId || null };
  if (s) {
    try {
      await ensureProfile(userId);
      const {data:existing,error:findError}=await s.from('memories').select('*').eq('user_id',userId).eq('status','active').eq('text',cleaned).limit(1);if(findError)throw findError;
      if(existing?.length)return memoryView(existing[0]);
      const { error } = await s.from('memories').insert(row);
      if (error) throw error;
      return memoryView(row);
    } catch (e) {
      console.warn('[store] supabase insert memory failed:', e.message);
      throw Object.assign(new Error('Memory could not be saved. Try again.'), { code:'PERSISTENCE' });
    }
  }
  const d = loadLocal();
  const existing=(d.memories || []).find(m=>m.userId===userId&&(m.status || 'active')==='active'&&String(m.text).toLowerCase()===cleaned.toLowerCase());if(existing)return memoryView(existing);
  const m = { ...row,userId,at:Date.now(),observedAt:Date.parse(row.observed_at) };
  d.memories.unshift(m);
  saveLocal(d);
  return memoryView(m);
}
async function updateMemory(userId,id,input={}) {
  const prior=await getMemory(userId,id);if(!prior || prior.status!=='active')throw Object.assign(new Error('Active memory not found.'),{code:'NOT_FOUND'});
  const cleaned=String(input.text || '').replace(/\u0000/g,'').trim().slice(0,2000);if(!cleaned)throw Object.assign(new Error('Memory text required.'),{code:'BAD_INPUT'});
  if (/(ghp_|github_pat_|sk-|bearer\s+|password\s*[:=]|api[_-]?key\s*[:=][A-Za-z0-9_-]{8,}|AQ\.[A-Za-z0-9_-]+|sb_secret)/i.test(cleaned))throw Object.assign(new Error('Secrets cannot be saved to memory.'),{code:'BAD_INPUT'});
  const newId=`mem_${uid()}`,category=memoryCategory(input.category || prior.category),importance=memoryImportance(input.importance ?? prior.importance),s=supa();
  if(s){const {data,error}=await s.rpc('supersede_agent_memory',{p_user_id:userId,p_memory_id:id,p_new_id:newId,p_text:cleaned,p_category:category,p_src:input.src || 'user_edit',p_importance:importance});if(error)throw Object.assign(new Error(error.message),{code:error.code==='P0002'?'NOT_FOUND':'PERSISTENCE'});return memoryView(Array.isArray(data)?data[0]:data);}
  const d=loadLocal(),row=d.memories.find(m=>m.userId===userId&&m.id===id&&(m.status || 'active')==='active');if(!row)throw Object.assign(new Error('Active memory not found.'),{code:'NOT_FOUND'});
  row.status='superseded';row.superseded_by=newId;row.updated_at=new Date().toISOString();const next={id:newId,userId,text:cleaned,src:input.src || 'user_edit',category,status:'active',importance,observed_at:new Date().toISOString(),updated_at:new Date().toISOString(),at:Date.now()};d.memories.unshift(next);saveLocal(d);return memoryView(next);
}
async function delMemory(userId, id) {
  const s = supa();
  if (s) {
    const {data,error}=await s.rpc('forget_agent_memory',{p_user_id:userId,p_memory_id:id});if(error)throw Object.assign(new Error('Memory could not be deleted. Try again.'),{code:'PERSISTENCE'});return Number(data || 0);
  }
  const d = loadLocal();
  const family=new Set([id]);let changed=true;
  while(changed){changed=false;for(const m of d.memories || []){if(m.userId!==userId)continue;if(family.has(m.id)||family.has(m.superseded_by)){if(!family.has(m.id)){family.add(m.id);changed=true;}if(m.superseded_by&&!family.has(m.superseded_by)){family.add(m.superseded_by);changed=true;}}}}
  const before=d.memories.length;
  d.memories = d.memories.filter((m) => !(m.userId===userId&&family.has(m.id)));
  saveLocal(d);
  return before-d.memories.length;
}

// Vault secrets. With Supabase configured it is the only store: a failed read
// or write surfaces as an error instead of landing in a non-durable fallback.
// New values are only sealed with a real key (AES-256-GCM, bound to the owner
// and row id), never base64-obscured.
const vaultError = (message, code = 'PERSISTENCE') => Object.assign(new Error(message), { code });
const secretAad = (userId, id) => `vault:${userId}:${id}`;
async function listSecrets(userId) {
  const s = supa();
  if (s) {
    const { data, error } = await s.from('vault_secrets').select('id,ref,name,created_at').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) { console.warn('[store] vault list failed:', error.message); throw vaultError('Your vault could not be loaded. Try again.'); }
    return (data || []).map((r) => ({ id: r.id, ref: r.ref, name: r.name, at: new Date(r.created_at).getTime() }));
  }
  const d = loadLocal();
  return d.secrets.filter((x) => x.userId === userId).map(({ value, userId: _owner, ...rest }) => rest);
}
async function addSecret(userId, name, value) {
  if (forbiddenPaymentSecret(name, value)) throw vaultError('Payment card details and identity codes cannot be saved in the agent vault. For purchases, keep the card saved in your merchant account or Shop Pay; the agent selects it at checkout without seeing it.', 'BAD_INPUT');
  if (!secretsEncrypted()) throw vaultError('The vault is locked: ENCRYPTION_KEY is not set on the server, so nothing was saved.', 'NOT_ENCRYPTED');
  const ref = 'sec_' + uid().slice(0, 4);
  const id = ref + '_' + uid();
  const sealed = encryptValue(value, secretAad(userId, id));
  const s = supa();
  if (s) {
    await ensureProfile(userId);
    const { error } = await s.from('vault_secrets').insert({ id, user_id: userId, name, ref, encrypted_value: sealed });
    if (error) { console.warn('[store] vault insert failed:', error.message); throw vaultError('The secret could not be saved. Try again.'); }
    return { id, ref, name, at: Date.now() };
  }
  const d = loadLocal();
  const row = { id, ref, userId, name, value: sealed, at: Date.now() };
  d.secrets.unshift(row);
  saveLocal(d);
  return { id, ref, name, at: row.at };
}
async function revealSecret(userId, id) {
  // Owner-only: the value goes to the owner's own screen or straight into the
  // approved field on the agent computer, never to the model.
  const s = supa();
  if (s) {
    const { data, error } = await s.from('vault_secrets').select('encrypted_value').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) { console.warn('[store] vault reveal failed:', error.message); throw vaultError('The secret could not be read. Try again.'); }
    return data ? decryptValue(data.encrypted_value, secretAad(userId, id)) : '';
  }
  const d = loadLocal();
  const row = d.secrets.find((x) => x.id === id && x.userId === userId);
  return row ? decryptValue(row.value, secretAad(userId, id)) : '';
}
async function delSecret(userId, id) {
  const s = supa();
  if (s) {
    const { error } = await s.from('vault_secrets').delete().eq('id', id).eq('user_id', userId);
    if (error) { console.warn('[store] vault delete failed:', error.message); throw vaultError('The secret could not be deleted. Try again.'); }
    return;
  }
  const d = loadLocal();
  d.secrets = d.secrets.filter((x) => !(x.id === id && x.userId === userId));
  saveLocal(d);
}

// ---------- billing: subscriptions, credit grants, usage, gift cards ----------
// Usage pricing comes from plans, including the cheapest credit pack.
const { creditsForCost } = require('./plans');
const CREDIT_GRANT_FREE = 20;
function creditsForUsageUsd(usd) { return creditsForCost(usd); }
function creditsForGift(usd) { return Number(usd || 0) * 2; }
async function getSubscription(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('subscriptions').select('*').eq('user_id', userId).single();
      if (!error && data) return data;
      if (error && error.code !== 'PGRST116') throw error;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  return (d.subs || []).find((x) => x.userId === userId) || { user_id: userId, plan: 'free', status: 'active' };
}
async function setSubscription(userId, plan, status, extra) {
  const merged = { ...(extra || {}), plan, status: status || 'active' };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const row = { user_id: userId, plan, status: status || 'active', ...cols(merged) };
      const { error } = await s.from('subscriptions').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      return { user_id: userId, plan, status: status || 'active', ...merged };
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  d.subs = d.subs || [];
  const i = d.subs.findIndex((x) => x.userId === userId);
  const row = { userId, user_id: userId, plan, status: status || 'active', ...merged };
  if (i >= 0) d.subs[i] = { ...d.subs[i], ...row }; else d.subs.push(row);
  saveLocal(d);
  return { user_id: userId, plan, status: status || 'active', ...merged };
}
// Only pass known subscription columns to Supabase (older DBs may lack new cols).
function cols(m) {
  const out = {};
  for (const k of ['stripe_customer_id', 'stripe_subscription_id', 'current_period_end', 'gift_issued']) {
    if (m[k] !== undefined) out[k] = m[k];
  }
  return out;
}
async function findUserByStripeCustomer(customerId) {
  if (!customerId) return null;
  const s = supa();
  if (s) {
    try {
      const { data } = await s.from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).limit(1).single();
      if (data) return data.user_id;
    } catch {}
  }
  const d = loadLocal();
  const r = (d.subs || []).find((x) => x.stripe_customer_id === customerId);
  return r ? (r.user_id || r.userId) : null;
}
// ---- credit grants ledger (monthly subscription credits + gifts + free starter) ----
async function addGrant(userId, credits, reason, ref) {
  const row = { id: 'gr_' + uid(), user_id: userId, credits: Number(credits || 0), reason: reason || 'grant', ref: ref || null };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = ref
        ? await s.from('credit_grants').upsert(row, { onConflict: 'user_id,ref', ignoreDuplicates: true })
        : await s.from('credit_grants').insert(row);
      if (error) throw error;
      return row;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  d.grants = d.grants || [];
  if (ref && d.grants.some((g) => (g.user_id === userId || g.userId === userId) && g.ref === ref)) return null;
  d.grants.unshift({ ...row, userId });
  saveLocal(d);
  return row;
}
async function grantsTotal(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('credit_grants').select('credits').eq('user_id', userId);
      if (error) throw error;
      return (data || []).reduce((n, r) => n + Number(r.credits || 0), 0);
    } catch {
      // fall through to local
    }
  }
  const d = loadLocal();
  return (d.grants || []).filter((r) => r.user_id === userId || r.userId === userId).reduce((n, r) => n + Number(r.credits || 0), 0);
}
async function hasGrantRef(userId, ref) {
  if (!ref) return false;
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('credit_grants').select('id').eq('user_id', userId).eq('ref', ref).limit(1);
      if (error) throw error;
      if (data && data.length) return true;
      return false;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  return !!((d.grants || []).some((g) => (g.user_id === userId || g.userId === userId) && g.ref === ref));
}
// Once Supabase confirms the starter grant it can never be un-granted, so skip the
// profile upsert + lookup (two serial round trips) on every later chat turn.
const freeGrantConfirmed = new Set();
async function ensureFreeGrant(userId) {
  if (freeGrantConfirmed.has(userId)) return false;
  const s = supa();
  if (s) {
    await ensureProfile(userId);
    const { data, error } = await s.from('credit_grants').select('id').eq('user_id', userId).eq('reason', 'free_starter').limit(1);
    if (error) throw error;
    if (data && data.length) { freeGrantConfirmed.add(userId); return false; }
    await addGrant(userId, CREDIT_GRANT_FREE, 'free_starter', 'free');
    freeGrantConfirmed.add(userId);
    return true;
  }
  const d = loadLocal();
  if ((d.grants || []).some((g) => (g.user_id === userId || g.userId === userId) && g.reason === 'free_starter')) return false;
  await addGrant(userId, CREDIT_GRANT_FREE, 'free_starter', 'free');
  return true;
}
// ---- Stripe webhook idempotency ----
async function stripeEventSeen(eventId) {
  if (!eventId) return false;
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('stripe_events').select('id').eq('id', eventId).limit(1);
      if (error) throw error;
      if (data && data.length) return true;
      return false;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  return !!((d.stripeEvents || []).includes(eventId));
}
async function markStripeEvent(eventId) {
  if (!eventId) return;
  const s = supa();
  if (s) {
    const { error } = await s.from('stripe_events').upsert({ id: eventId }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    return;
  }
  const d = loadLocal();
  d.stripeEvents = d.stripeEvents || [];
  if (!d.stripeEvents.includes(eventId)) d.stripeEvents.push(eventId);
  saveLocal(d);
}
async function logUsage(userId, payload) {
  return tokenWallet.chargeRawTokens(userId, payload);
}
async function logLegacyUsage(userId, { model, usage, cost }) {
  const costUsd = Number(cost || 0);
  const row = {
    id: 'use_' + uid(), user_id: userId, model: model || 'gpt-6-luna',
    prompt_tokens: (usage && (usage.promptTokenCount || 0)) || 0,
    candidates_tokens: (usage && (usage.candidatesTokenCount || 0)) || 0,
    total_tokens: (usage && (usage.totalTokenCount || 0)) || 0,
    cost_usd: costUsd,
    credits_charged: creditsForUsageUsd(costUsd),
  };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('api_usage').insert(row);
      if (error) throw error;
      return row;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  d.usage = d.usage || [];
  d.usage.unshift(row);
  saveLocal(d);
  return row;
}
async function usageTotal(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('api_usage').select('cost_usd').eq('user_id', userId);
      if (error) throw error;
      return (data || []).reduce((n, r) => n + Number(r.cost_usd || 0), 0);
    } catch (e) {
      console.warn('[store] usage total fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.usage || []).filter((r) => r.user_id === userId || r.userId === userId).reduce((n, r) => n + Number(r.cost_usd || r.cost || 0), 0);
}
function giftCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 12; i++) c += abc[crypto.randomInt(abc.length)];
  return 'LNG-' + c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8, 12);
}
async function findGiftByFrom(fromUser) {
  const from = String(fromUser || '');
  if (!from) return null;
  const s = supa();
  if (s) {
    const { data, error } = await s.from('gift_cards').select('*').eq('from_user', from).limit(1).maybeSingle();
    if (error) throw error;
    return data || null;
  }
  const d = loadLocal();
  return (d.gifts || []).find((g) => g.from_user === from) || null;
}
async function createGift(fromUser, amountUsd, purchasedBy = null) {
  const code = giftCode();
  const row = { code, amount_usd: Number(amountUsd), from_user: fromUser, purchased_by: purchasedBy, to_user: null, redeemed_by: null };
  const s = supa();
  if (s) {
    try {
      const { error } = await s.from('gift_cards').insert(row);
      if (error) throw error;
      return row;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  d.gifts = d.gifts || [];
  d.gifts.unshift(row);
  saveLocal(d);
  return row;
}
async function listPurchasedGifts(userId) {
  const s = supa();
  if (s) {
    const { data, error } = await s.from('gift_cards').select('code,amount_usd,redeemed_by').eq('purchased_by', userId).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return data || [];
  }
  return (loadLocal().gifts || []).filter((g) => g.purchased_by === userId).slice(0, 50);
}
async function redeemGift(userId, code) {
  const c = String(code || '').trim().toUpperCase();
  const grantRedeem = async (amountUsd) => {
    const credits = creditsForGift(amountUsd);
    await ensureFreeGrant(userId);
    await addGrant(userId, credits, 'gift_redeem', c);
    const tokens = Math.round(Number(amountUsd) * 20000);
    await tokenWallet.addTokenGrant(userId, tokens, 'gift', 'gift:' + c);
    return { ok: true, amount: Number(amountUsd), credits, tokens };
  };
  const s = supa();
  if (s) {
    await ensureProfile(userId);
    const { data, error } = await s.rpc('redeem_gift_card', { p_user_id: userId, p_code: c });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    return result?.ok ? { ok: true, amount: Number(result.amount), credits: Number(result.credits), tokens: Math.round(Number(result.amount) * 20000) }
      : { ok: false, error: result?.error || 'Code not found.' };
  }
  const d = loadLocal();
  d.gifts = d.gifts || [];
  const g = d.gifts.find((x) => x.code === c);
  if (!g) return { ok: false, error: 'Code not found.' };
  if (g.redeemed_by) return { ok: false, error: 'Code already redeemed.' };
  g.redeemed_by = userId;
  g.to_user = userId;
  g.redeemed_at = new Date().toISOString();
  saveLocal(d);
  return await grantRedeem(g.amount_usd);
}
async function giftsCredit(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('gift_cards').select('amount_usd').eq('redeemed_by', userId);
      if (error) throw error;
      return (data || []).reduce((n, r) => n + Number(r.amount_usd || 0), 0);
    } catch {
      // fall through
    }
  }
  const d = loadLocal();
  return (d.gifts || []).filter((g) => g.redeemed_by === userId).reduce((n, g) => n + Number(g.amount_usd || 0), 0);
}
// ---------- referrals: one invite, 10M tokens for each account ----------
// A code can be redeemed by one friend, and an account can redeem one code.
// Supabase tables (see supabase/migrations/20260922110000_referrals.sql): referral_codes +
// referrals. Local data.json fallback keeps the same guarantees.
const { REFERRAL_TOKENS_EACH } = require('./plans');
function referralCodeGen() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (const byte of crypto.randomBytes(6)) c += abc[byte % abc.length];
  return 'BELNA-' + c;
}
function normReferralCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}
async function getReferralCode(userId) {
  if (!userId) return null;
  const s = supa();
  if (s) {
    await ensureProfile(userId);
    const { data: existing, error: readError } = await s.from('referral_codes').select('code').eq('user_id', userId).maybeSingle();
    if (readError) throw readError;
    if (existing?.code) return existing.code;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = referralCodeGen();
      const { error } = await s.from('referral_codes').upsert({ user_id:userId, code }, { onConflict:'user_id', ignoreDuplicates:true });
      if (!error || /duplicate|unique/i.test(error.message || '')) {
        const { data, error: lookupError } = await s.from('referral_codes').select('code').eq('user_id', userId).maybeSingle();
        if (lookupError) throw lookupError;
        if (data?.code) return data.code;
        if (!error) continue;
      } else throw error;
    }
    throw new Error('Could not create a referral code.');
  }
  const d = loadLocal();
  d.referralCodes = d.referralCodes || [];
  let row = d.referralCodes.find((r) => r.user_id === userId || r.userId === userId);
  if (row && row.code) return row.code;
  row = { user_id: userId, code: referralCodeGen(), created_at: new Date().toISOString() };
  // Avoid collisions in the local file (Supabase has a UNIQUE on code).
  let guard = 0;
  while (d.referralCodes.some((r) => r.code === row.code) && guard++ < 5) row.code = referralCodeGen();
  d.referralCodes.unshift(row);
  saveLocal(d);
  return row.code;
}
async function findReferralInviter(code) {
  const c = normReferralCode(code);
  if (!c) return null;
  const s = supa();
  if (s) {
    try {
      const { data } = await s.from('referral_codes').select('user_id,code').eq('code', c).limit(1).maybeSingle();
      if (data) return { inviterId: data.user_id, code: data.code };
    } catch {}
  }
  const d = loadLocal();
  const row = (d.referralCodes || []).find((r) => String(r.code || '').toUpperCase() === c);
  return row ? { inviterId: row.user_id || row.userId, code: row.code } : null;
}
async function referralStats(userId) {
  const code = await getReferralCode(userId);
  const d = loadLocal();
  const local = (d.referrals || []).filter((r) => (r.inviter_id || r.inviterId) === userId);
  const s = supa();
  if (s) {
    const { count, error } = await s.from('referrals').select('id', { count:'exact', head:true }).eq('inviter_id', userId);
    if (error) throw error;
    const { data: grants, error: grantsError } = await s.from('token_grants').select('tokens').eq('user_id', userId).eq('reason', 'referral').like('ref', 'referral-inviter:%');
    if (grantsError) throw grantsError;
    return { code, invited: count || 0, earnedTokens: (grants || []).reduce((total, row) => total + Number(row.tokens || 0), 0), rewardEachTokens: REFERRAL_TOKENS_EACH };
  }
  const earnedTokens = (d.tokenGrants || []).filter((g) => g.user_id === userId && g.reason === 'referral' && String(g.ref || '').startsWith('referral-inviter:')).reduce((total, g) => total + Number(g.tokens || 0), 0);
  return { code, invited: local.length, earnedTokens, rewardEachTokens: REFERRAL_TOKENS_EACH };
}
async function redeemReferral(userId, code) {
  const c = normReferralCode(code);
  if (!c) return { ok: false, error: 'Enter your friend’s invite code.' };
  const s = supa();
  if (s) {
    await ensureProfile(userId);
    const { data, error } = await s.rpc('redeem_referral', { p_user_id:userId, p_code:c });
    if (error) throw error;
    return data;
  }
  const found = await findReferralInviter(c);
  if (!found) return { ok: false, error: 'Code not found. Check the code and try again.' };
  if (String(found.inviterId) === String(userId)) return { ok: false, error: 'You can’t redeem your own invite code.' };
  const d = loadLocal();
  d.referrals = d.referrals || [];
  d.referralCodes = d.referralCodes || [];
  if (d.referrals.some((r) => String(r.redeemer_id || r.redeemerId) === String(userId))) return { ok: false, error: 'You already redeemed a free invite.' };
  if (d.referrals.some((r) => r.code === found.code)) return { ok: false, error: 'This invite code has already been used.' };
  d.referrals.unshift({ id: 'rf_' + uid(), code: found.code, inviter_id: found.inviterId, redeemer_id: userId, inviter_credits: 0, redeemer_credits: 0, created_at: new Date().toISOString() });
  d.tokenGrants = d.tokenGrants || [];
  for (const [recipient, ref] of [[userId, 'referral:' + found.code + ':' + userId], [found.inviterId, 'referral-inviter:' + found.code + ':' + userId]]) {
    d.tokenGrants.push({ id: 'tg_' + uid(), user_id: recipient, tokens: REFERRAL_TOKENS_EACH, remaining: REFERRAL_TOKENS_EACH, reason: 'referral', ref, expires_at: null, created_at: new Date().toISOString() });
  }
  saveLocal(d);
  return { ok: true, credits: 0, inviterCredits: 0, tokens: REFERRAL_TOKENS_EACH, inviterTokens: REFERRAL_TOKENS_EACH, code: found.code };
}
async function requestUpgrade(userId, plan) {
  const row = { id: 'up_' + uid(), user_id: userId, plan, status: 'requested' };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('upgrade_requests').insert(row);
      if (error) throw error;
      return row;
    } catch (e) {
      console.warn('[store] upgrade fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.upgrades = d.upgrades || [];
  d.upgrades.unshift(row);
  saveLocal(d);
  return row;
}

function fromSubAgentRow(row) {
  return {
    id: row.id,
    userId: row.user_id || row.userId,
    chatId: row.chat_id || row.chatId,
    name: row.name,
    prompt: row.prompt,
    enabled: row.enabled !== false,
    trigger: { type: row.trigger_type || row.trigger?.type, ...(row.trigger_config || row.trigger || {}) },
    nextRunAt: row.next_run_at || row.nextRunAt || null,
    lastRunAt: row.last_run_at || row.lastRunAt || null,
    lastStatus: row.last_status || row.lastStatus || null,
    lastError: row.last_error || row.lastError || null,
    description: row.description || '',
    systemKind: row.system_kind || row.systemKind || null,
    lastResult: row.last_result || row.lastResult || null,
    lastSignalAt: row.last_signal_at || row.lastSignalAt || null,
    triggerSyncAt: row.trigger_sync_at || row.triggerSyncAt || null,
    triggerSyncError: row.trigger_sync_error || row.triggerSyncError || null,
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  };
}

async function ensureSystemSubAgents(userId) {
  const wanted = upkeepRows(userId);
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      for (const agent of wanted) {
        const row = {
          id:agent.id,user_id:userId,chat_id:agent.chatId,name:agent.name,prompt:agent.prompt,
          description:agent.description,system_kind:agent.systemKind,enabled:true,
          trigger_type:'schedule',trigger_config:agent.trigger,next_run_at:agent.nextRunAt,
        };
        const { error:insertError } = await s.from('sub_agents').upsert(row,{onConflict:'id',ignoreDuplicates:true});
        if (insertError) throw insertError;
        const { error:updateError } = await s.from('sub_agents').update({
          name:agent.name,prompt:agent.prompt,description:agent.description,system_kind:agent.systemKind,
          trigger_type:'schedule',trigger_config:agent.trigger,updated_at:new Date().toISOString(),
        }).eq('id',agent.id).eq('user_id',userId);
        if (updateError) throw updateError;
      }
      return;
    } catch (e) { throw e; }
  }
  const d=loadLocal();d.subAgents=d.subAgents || [];
  for(const agent of wanted){
    const index=d.subAgents.findIndex(row=>row.id===agent.id&&row.userId===userId);
    if(index<0)d.subAgents.push(agent);
    else Object.assign(d.subAgents[index],{name:agent.name,prompt:agent.prompt,description:agent.description,systemKind:agent.systemKind,trigger:agent.trigger});
  }
  saveLocal(d);
}

async function listSubAgents(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('sub_agents').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(fromSubAgentRow);
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  return (d.subAgents || []).filter((row) => row.userId === userId).map(fromSubAgentRow);
}

async function getSubAgent(userId, id) {
  const agents = await listSubAgents(userId);
  return agents.find((row) => row.id === id) || null;
}

async function createSubAgent(userId, input, nextRunAt) {
  const now = new Date().toISOString();
  const agent = {
    id: 'sub_' + uid(), userId, chatId: 'auto_' + uid(), name: input.name,
    prompt: input.prompt, enabled: input.enabled, trigger: input.trigger,
    nextRunAt: nextRunAt || null, lastRunAt: null, lastStatus: null, lastError: null, createdAt: now,
  };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('sub_agents').insert({
        id: agent.id, user_id: userId, chat_id: agent.chatId, name: agent.name, prompt: agent.prompt,
        enabled: agent.enabled, trigger_type: agent.trigger.type, trigger_config: agent.trigger,
        next_run_at: agent.nextRunAt,
      });
      if (error) throw error;
      return agent;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  d.subAgents = d.subAgents || [];
  d.subAgents.unshift(agent);
  saveLocal(d);
  return agent;
}

async function updateSubAgent(userId, id, input, nextRunAt) {
  const patch = {
    name: input.name, prompt: input.prompt, enabled: input.enabled,
    trigger_type: input.trigger.type, trigger_config: input.trigger,
    next_run_at: nextRunAt || null, updated_at: new Date().toISOString(),
  };
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('sub_agents').update(patch).eq('id', id).eq('user_id', userId).select('*').maybeSingle();
      if (error) throw error;
      if (data) return fromSubAgentRow(data);
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  d.subAgents = d.subAgents || [];
  const idx = d.subAgents.findIndex((row) => row.id === id && row.userId === userId);
  if (idx < 0) return null;
  d.subAgents[idx] = { ...d.subAgents[idx], ...input, nextRunAt: nextRunAt || null };
  saveLocal(d);
  return fromSubAgentRow(d.subAgents[idx]);
}

async function deleteSubAgent(userId, id) {
  const s = supa();
  if (s) {
    try {
      const { error } = await s.from('sub_agents').delete().eq('id', id).eq('user_id', userId);
      if (error) throw error;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  d.subAgents = (d.subAgents || []).filter((row) => row.id !== id || row.userId !== userId);
  saveLocal(d);
}

async function listDueSubAgents(now, limit = 5) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('sub_agents').select('*').eq('enabled', true).eq('trigger_type', 'schedule').not('next_run_at', 'is', null).lte('next_run_at', now).order('next_run_at').limit(limit);
      if (error) throw error;
      return (data || []).map(fromSubAgentRow);
    } catch (e) { throw e; }
  }
  const when = new Date(now).getTime();
  const d = loadLocal();
  return (d.subAgents || []).filter((row) => row.enabled && row.trigger?.type === 'schedule' && row.nextRunAt && new Date(row.nextRunAt).getTime() <= when).slice(0, limit).map(fromSubAgentRow);
}

async function markSubAgentRun(userId, id, status, errorText, nextRunAt, details = {}) {
  const patch = { last_run_at: new Date().toISOString(), last_status: status, last_error: errorText ? String(errorText).slice(0, 500) : null, next_run_at: nextRunAt || null, updated_at: new Date().toISOString() };
  if (details.result !== undefined) patch.last_result=details.result==null?null:String(details.result).slice(0,4000);
  if (details.signalAt) patch.last_signal_at=details.signalAt;
  const s = supa();
  if (s) {
    try {
      const { error } = await s.from('sub_agents').update(patch).eq('id', id).eq('user_id', userId);
      if (error) throw error;
      return;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  const row = (d.subAgents || []).find((item) => item.id === id && item.userId === userId);
  if (row) Object.assign(row, { lastRunAt: patch.last_run_at, lastStatus: status, lastError: patch.last_error, nextRunAt: patch.next_run_at, ...(patch.last_result!==undefined?{lastResult:patch.last_result}:{}), ...(patch.last_signal_at?{lastSignalAt:patch.last_signal_at}:{}) });
  saveLocal(d);
}

async function listUpkeepSignals(userId, since, limit = 24) {
  const size=Math.min(Math.max(Number(limit)||24,1),50),s=supa();
  if(s){
    try{
      const {data:chats,error:chatError}=await s.from('chats').select('id').eq('user_id',userId).eq('source','user').order('updated_at',{ascending:false}).limit(100);
      if(chatError)throw chatError;
      const ids=(chats || []).map(row=>row.id);if(!ids.length)return [];
      let query=s.from('messages').select('id,role,text,created_at').eq('user_id',userId).eq('role','user').in('chat_id',ids).order('created_at',{ascending:false}).limit(size);
      if(since)query=query.gt('created_at',since);
      const {data,error}=await query;if(error)throw error;return (data || []).reverse();
    }catch(e){throw e;}
  }
  const d=loadLocal(),userChats=new Set((d.chats || []).filter(row=>row.userId===userId&&(row.source || 'user')==='user').map(row=>row.id)),after=since?Date.parse(since):0;
  return (d.turns || []).filter(row=>(row.user_id===userId||row.userId===userId)&&row.role==='user'&&userChats.has(row.chat_id)&&(!after||Number(row.at || Date.parse(row.created_at || 0))>after)).sort((a,b)=>Number(a.at || Date.parse(a.created_at || 0))-Number(b.at || Date.parse(b.created_at || 0))).slice(-size);
}

async function beginAutomationRun(userId, subAgentId, chatId, dedupeKey, event) {
  const row = { id: 'arun_' + uid(), user_id: userId, sub_agent_id: subAgentId, chat_id: chatId, dedupe_key: dedupeKey, status: 'running', event: event || {} };
  const s = supa();
  if (s) {
    try {
      const { error } = await s.from('automation_runs').insert(row);
      if (error?.code === '23505') return null;
      if (error) throw error;
      return { id: row.id };
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  d.automationRuns = d.automationRuns || [];
  if (d.automationRuns.some((item) => item.dedupe_key === dedupeKey)) return null;
  d.automationRuns.unshift({ ...row, started_at: new Date().toISOString() });
  saveLocal(d);
  return { id: row.id };
}

async function listAppSubAgentsForSync(now, limit = 5) {
  const before = new Date(Date.parse(now) - 60 * 60_000).toISOString();
  const s = supa();
  if (s) {
    const {data,error}=await s.from('sub_agents').select('*').eq('enabled',true).eq('trigger_type','app')
      .or(`trigger_sync_at.is.null,trigger_sync_at.lte.${before}`).order('trigger_sync_at',{ascending:true,nullsFirst:true}).limit(limit);
    if (error) throw error;
    return (data || []).map(fromSubAgentRow);
  }
  return (loadLocal().subAgents || []).filter(row=>row.enabled && row.trigger?.type==='app' && (!row.triggerSyncAt || Date.parse(row.triggerSyncAt)<=Date.parse(before))).slice(0,limit).map(fromSubAgentRow);
}

async function markAppTriggerSync(userId,id,errorText) {
  const at=new Date().toISOString(),message=errorText?String(errorText).slice(0,500):null;
  const s=supa();
  if(s){const {error}=await s.from('sub_agents').update({trigger_sync_at:at,trigger_sync_error:message}).eq('id',id).eq('user_id',userId);if(error)throw error;return;}
  const d=loadLocal(),row=(d.subAgents || []).find(item=>item.id===id&&item.userId===userId);
  if(row){row.triggerSyncAt=at;row.triggerSyncError=message;saveLocal(d);}
}

async function attachAutomationTask(userId, id, taskId) {
  const s = supa();
  if (s) {
    const { error } = await s.from('automation_runs').update({ result: { taskId } }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return;
  }
  const d = loadLocal();
  const row = (d.automationRuns || []).find(item => item.id === id && item.user_id === userId);
  if (!row) throw new Error('Automation run was not found.');
  row.result = { taskId };
  saveLocal(d);
}

async function getAutomationRunByDedupeKey(userId,dedupeKey){
  const s=supa();
  if(s){const {data,error}=await s.from('automation_runs').select('*').eq('user_id',userId).eq('dedupe_key',dedupeKey).maybeSingle();if(error)throw error;return data || null;}
  return (loadLocal().automationRuns || []).find(row=>row.user_id===userId&&row.dedupe_key===dedupeKey) || null;
}

async function listPendingAutomationRuns(limit = 30) {
  const s = supa();
  if (s) {
    const { data, error } = await s.from('automation_runs').select('*').in('status', ['running', 'waiting_approval']).order('status').order('started_at').limit(limit);
    if (error) throw error;
    return data || [];
  }
  return (loadLocal().automationRuns || []).filter(row => ['running', 'waiting_approval'].includes(row.status)).slice(0, limit);
}

async function finishAutomationRun(userId, id, status, result, errorText) {
  const patch = { status, result: result || null, error: errorText ? String(errorText).slice(0, 1000) : null, finished_at: status === 'waiting_approval' ? null : new Date().toISOString() };
  const s = supa();
  if (s) {
    const { data, error } = await s.from('automation_runs').update(patch).eq('id', id).eq('user_id', userId).in('status', ['running', 'waiting_approval']).select('id');
    if (error) throw error;
    return !!data?.length;
  }
  const d = loadLocal();
  const row = (d.automationRuns || []).find((item) => item.id === id && (item.user_id === userId || item.userId === userId));
  if (!row || !['running', 'waiting_approval'].includes(row.status)) return false;
  Object.assign(row, patch);
  saveLocal(d);
  return true;
}

async function listAutomationRuns(userId, limit = 30) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('automation_runs').select('*').eq('user_id', userId).order('started_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    } catch (e) { throw e; }
  }
  return (loadLocal().automationRuns || []).filter((row) => row.user_id === userId || row.userId === userId).slice(0, limit);
}

// ---------- conversation history (Strawberry-style transcripts, per-user) ----------
async function saveTurn(userId, chatId, role, text, options = {}) {
  const row = { id: 'msg_' + uid(), chat_id: chatId || 'unsorted', user_id: userId, role, kind: options.kind || 'text', text: String(text || '').slice(0, 6000), metadata: options.metadata || {} };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { data: existing, error: findError } = await s.from('chats').select('user_id').eq('id', row.chat_id).maybeSingle();
      if (findError) throw findError;
      if (existing && existing.user_id !== userId) throw Object.assign(new Error('Chat belongs to another account.'), { code: 'FORBIDDEN' });
      if (!existing) {
        const { error: chatError } = await s.from('chats').insert({ id: row.chat_id, user_id: userId, title: String(options.title || row.chat_id).slice(0, 60), source: options.source || 'user', sub_agent_id: options.subAgentId || null, updated_at: new Date().toISOString() });
        // Two saves for a new chat race to create it; the loser checks the owner and saves its message.
        if (chatError && chatError.code === '23505') {
          const { data: raced } = await s.from('chats').select('user_id').eq('id', row.chat_id).maybeSingle();
          if (!raced || raced.user_id !== userId) throw Object.assign(new Error('Chat belongs to another account.'), { code: 'FORBIDDEN' });
        } else if (chatError) throw chatError;
      } else {
        const chatPatch = { updated_at: new Date().toISOString() };
        if (options.title) chatPatch.title = String(options.title).slice(0, 60);
        if (options.source) chatPatch.source = options.source;
        if (options.subAgentId) chatPatch.sub_agent_id = options.subAgentId;
        const { error: chatError } = await s.from('chats').update(chatPatch).eq('id', row.chat_id).eq('user_id', userId);
        if (chatError) throw chatError;
      }
      const { error } = await s.from('messages').insert(row);
      if (error) throw error;
      return row;
    } catch (e) {
      if (e.code === 'FORBIDDEN' || options.source === 'automation') throw e;
      console.warn('[store] save turn fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.chats = d.chats || [];
  const existingChat = d.chats.find((item) => item.id === row.chat_id && item.userId === userId);
  if (existingChat) Object.assign(existingChat, { title: options.title || existingChat.title, source: options.source || existingChat.source || 'user', subAgentId: options.subAgentId || existingChat.subAgentId || null, updatedAt: Date.now() });
  else d.chats.unshift({ id: row.chat_id, userId, title: options.title || row.chat_id.slice(0, 42), source: options.source || 'user', subAgentId: options.subAgentId || null, createdAt: Date.now(), updatedAt: Date.now() });
  d.turns = d.turns || [];
  d.turns.unshift({ ...row, at: Date.now() });
  saveLocal(d);
  return row;
}
async function listChatMessages(userId, chatId, limit = 100) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('messages').select('id,role,kind,text,metadata,created_at').eq('user_id', userId).eq('chat_id', chatId).order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return (data || []).reverse();
    } catch (e) { console.warn('[store] chat messages fallback:', e.message); }
  }
  return (loadLocal().turns || []).filter((row) => (row.user_id === userId || row.userId === userId) && row.chat_id === chatId).sort((a, b) => Number(a.at || 0) - Number(b.at || 0)).slice(-limit);
}

// The running summary of a chat's older messages; its metadata.throughAt marks the
// newest message it covers. Summary rows never render as chat messages.
async function latestChatSummary(userId, chatId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('messages').select('id,text,metadata,created_at').eq('user_id', userId).eq('chat_id', chatId).eq('role', 'summary').order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      return data?.[0] || null;
    } catch (e) { console.warn('[store] chat summary fallback:', e.message); }
  }
  return (loadLocal().turns || []).find((row) => (row.user_id === userId || row.userId === userId) && row.chat_id === chatId && row.role === 'summary') || null;
}

async function listAutomationChats(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('chats').select('*').eq('user_id', userId).eq('source', 'automation').order('updated_at', { ascending: false }).limit(50);
      if (error) throw error;
      const chats = [];
      for (const row of data || []) chats.push({ ...row, messages: (await listChatMessages(userId, row.id, 100)).filter((m) => m.role !== 'summary') });
      return chats;
    } catch (e) { throw e; }
  }
  const d = loadLocal();
  const chats = (d.chats || []).filter((row) => row.userId === userId && row.source === 'automation').sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  return chats.map((row) => ({ ...row, messages: (d.turns || []).filter((turn) => (turn.user_id === userId || turn.userId === userId) && turn.chat_id === row.id).sort((a, b) => Number(a.at || 0) - Number(b.at || 0)) }));
}
async function searchTurns(userId, query, limit = 6) {
  const q = String(query || '').toLowerCase().split(/[^a-zåäö0-9]+/).filter((w) => w.length > 3);
  if (!q.length) return [];
  const s = supa();
  if (s) {
    try {
      const ors = q.slice(0, 4).map((w) => `text.ilike.%${w}%`).join(',');
      const { data, error } = await s.from('messages').select('chat_id,role,text,created_at').eq('user_id', userId).neq('role', 'summary').or(ors).order('created_at', { ascending: false }).limit(limit * 3);
      if (error) throw error;
      return (data || []).slice(0, limit);
    } catch (e) {
      console.warn('[store] search turns fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.turns || [])
    .filter((t) => (t.userId === userId || t.user_id === userId) && t.role !== 'summary')
    .map((t) => ({ score: q.filter((w) => String(t.text).toLowerCase().includes(w)).length, t }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}

async function logToolRun({ userId, sessionId, kind, name, status, detail, ms }) {
  const row = {
    id: 'run_' + uid(), user_id: userId || 'local', session_id: sessionId || null,
    kind: kind || 'tool', name: name || '', status: status || 'done',
    detail: String(detail || '').slice(0, 2000), ms: ms || 0,
  };
  const s = supa();
  if (s) {
    try {
      if (userId) await ensureProfile(userId);
      const { error } = await s.from('tool_runs').insert(row);
      if (error) throw error;
      return row;
    } catch (e) {
      console.warn('[store] tool run fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.runs = d.runs || [];
  d.runs.unshift(row);
  saveLocal(d);
  return row;
}

let billingTotalsRpcMissingUntil = 0;
async function billingTotals(userId) {
  const s = supa();
  if (s) {
    if (Date.now() >= billingTotalsRpcMissingUntil) {
      const { data, error } = await s.rpc('billing_totals', { p_user_id: userId });
      if (!error && data && data[0]) {
        const row = data[0];
        return {
          granted: Number(row.granted || 0), used: Number(row.used || 0),
          giftGranted: Number(row.gift_granted || 0), giftsUsd: Number(row.gifts_usd || 0),
        };
      }
      if (error && error.code !== 'PGRST202') throw error;
      // Deploys can briefly run before the migration. Retry the RPC later.
      billingTotalsRpcMissingUntil = Date.now() + 60_000;
    }
    const page = async (table, columns, key, cursorColumn, visit) => {
      let cursor = null;
      for (;;) {
        let query = s.from(table).select(`${cursorColumn},${columns}`).eq(key, userId)
          .order(cursorColumn, { ascending: true }).limit(1000);
        if (cursor !== null) query = query.gt(cursorColumn, cursor);
        const { data, error } = await query;
        if (error) throw error;
        for (const row of data || []) visit(row);
        if (!data || data.length < 1000) break;
        cursor = data[data.length - 1][cursorColumn];
      }
    };
    const totals = { granted: 0, used: 0, giftGranted: 0, giftsUsd: 0 };
    await Promise.all([
      page('credit_grants', 'credits,reason', 'user_id', 'id', (row) => {
        const credits = Number(row.credits || 0);
        totals.granted += credits;
        if (row.reason === 'gift_redeem') totals.giftGranted += credits;
      }),
      page('api_usage', 'cost_usd,credits_charged', 'user_id', 'id', (row) => {
        totals.used += row.credits_charged == null ? Number(row.cost_usd || 0) * 2 : Number(row.credits_charged || 0);
      }),
      page('gift_cards', 'amount_usd', 'redeemed_by', 'code', (row) => {
        totals.giftsUsd += Number(row.amount_usd || 0);
      }),
    ]);
    return totals;
  }
  const d = loadLocal();
  const owned = (row) => row.user_id === userId || row.userId === userId;
  const grants = (d.grants || []).filter(owned);
  return {
    granted: grants.reduce((sum, row) => sum + Number(row.credits || 0), 0),
    giftGranted: grants.filter((row) => row.reason === 'gift_redeem').reduce((sum, row) => sum + Number(row.credits || 0), 0),
    used: (d.usage || []).filter(owned).reduce((sum, row) => sum + (row.credits_charged == null
      ? Number(row.cost_usd || row.cost || 0) * 2 : Number(row.credits_charged || 0)), 0),
    giftsUsd: (d.gifts || []).filter((row) => row.redeemed_by === userId).reduce((sum, row) => sum + Number(row.amount_usd || 0), 0),
  };
}

async function creditsUsed(userId) {
  // New rows carry credits_charged (with margin). Pre-migration rows only
  // have cost_usd — honor them at face rate (x2, no margin) so old balances
  // carry over exactly instead of shrinking under the new markup.
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('api_usage').select('cost_usd,credits_charged').eq('user_id', userId);
      if (error) throw error;
      return (data || []).reduce((n, r) => n + (r.credits_charged != null && r.credits_charged !== undefined
        ? Number(r.credits_charged || 0)
        : Number(r.cost_usd || 0) * 2), 0);
    } catch (e) {
      console.warn('[store] credits used fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.usage || [])
    .filter((r) => r.user_id === userId || r.userId === userId)
    .reduce((n, r) => n + (r.credits_charged != null && r.credits_charged !== undefined
      ? Number(r.credits_charged || 0)
      : Number(r.cost_usd || r.cost || 0) * 2), 0);
}
async function grantsTotalByReason(userId, reason) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('credit_grants').select('credits').eq('user_id', userId).eq('reason', reason);
      if (error) throw error;
      return (data || []).reduce((n, r) => n + Number(r.credits || 0), 0);
    } catch {}
  }
  const d = loadLocal();
  return (d.grants || [])
    .filter((r) => (r.user_id === userId || r.userId === userId) && r.reason === reason)
    .reduce((n, r) => n + Number(r.credits || 0), 0);
}

function mapMailbox(r, userId) {
  return {
    userId: r.user_id || r.userId || userId,
    localPart: r.local_part || r.localPart || '',
    address: r.address || '',
    displayName: r.display_name || r.displayName || '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : (r.createdAt || Date.now()),
  };
}
function mapMailMessage(r, userId) {
  const to = r.to_addresses || r.toAddresses || [];
  const cc = r.cc_addresses || r.ccAddresses || [];
  return {
    id: r.id,
    userId: r.user_id || r.userId || userId,
    mailboxAddress: r.mailbox_address || r.mailboxAddress || '',
    direction: r.direction || 'inbound',
    folder: r.folder || 'inbox',
    fromAddress: r.from_address || r.fromAddress || '',
    fromName: r.from_name || r.fromName || '',
    toAddresses: Array.isArray(to) ? to : [],
    ccAddresses: Array.isArray(cc) ? cc : [],
    subject: r.subject || '',
    bodyText: r.body_text || r.bodyText || '',
    bodyHtml: r.body_html || r.bodyHtml || '',
    messageId: r.message_id || r.messageId || null,
    inReplyTo: r.in_reply_to || r.inReplyTo || null,
    threadId: r.thread_id || r.threadId || null,
    resendId: r.resend_id || r.resendId || null,
    isRead: r.is_read != null ? !!r.is_read : !!r.isRead,
    at: r.created_at ? new Date(r.created_at).getTime() : (r.at || Date.now()),
  };
}
function mapMailDraft(r, userId) {
  const to = r.to_addresses || r.toAddresses || [];
  return {
    id: r.id,
    userId: r.user_id || r.userId || userId,
    toAddresses: Array.isArray(to) ? to : [],
    subject: r.subject || '',
    bodyText: r.body_text || r.bodyText || '',
    inReplyTo: r.in_reply_to || r.inReplyTo || null,
    at: r.updated_at ? new Date(r.updated_at).getTime() : (r.at || Date.now()),
  };
}

async function getMailboxByUser(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('agent_mailboxes').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (data) return mapMailbox(data, userId);
    } catch (e) {
      console.warn('[store] supabase mailbox fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailboxes || []).find((m) => m.userId === userId) || null;
}
async function getMailboxByAddress(address) {
  const addr = String(address || '').trim().toLowerCase();
  if (!addr) return null;
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('agent_mailboxes').select('*').ilike('address', addr).maybeSingle();
      if (error) throw error;
      if (data) return mapMailbox(data, data.user_id);
    } catch (e) {
      console.warn('[store] supabase mailbox-by-address fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailboxes || []).find((m) => String(m.address || '').toLowerCase() === addr) || null;
}
async function mailLocalPartTaken(part, exceptUserId) {
  const local = String(part || '').toLowerCase();
  const s = supa();
  if (s) {
    try {
      let q = s.from('agent_mailboxes').select('user_id').eq('local_part', local);
      if (exceptUserId) q = q.neq('user_id', exceptUserId);
      const { data, error } = await q.maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return !!data;
    } catch (e) {
      console.warn('[store] supabase local-part fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailboxes || []).some((m) => m.localPart === local && m.userId !== exceptUserId);
}
async function upsertMailbox(userId, patch) {
  const prev = await getMailboxByUser(userId);
  const next = Object.assign({
    userId,
    localPart: '',
    address: '',
    displayName: '',
    createdAt: Date.now(),
  }, prev || {}, patch || {}, { userId });
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('agent_mailboxes').upsert({
        user_id: userId,
        local_part: next.localPart,
        address: next.address,
        display_name: next.displayName,
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return next;
    } catch (e) {
      console.warn('[store] supabase upsert mailbox fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.mailboxes = d.mailboxes || [];
  const i = d.mailboxes.findIndex((m) => m.userId === userId);
  if (i >= 0) d.mailboxes[i] = next; else d.mailboxes.unshift(next);
  saveLocal(d);
  return next;
}
async function listMailMessages(userId, { folder, q, limit } = {}) {
  const cap = Math.min(80, Number(limit) || 40);
  // SECURITY: allowlist characters so the search text can never alter the
  // PostgREST filter expression (commas, parentheses, wildcards, quotes).
  const needle = String(q || '').toLowerCase().replace(/[^\p{L}\p{N}\s@._+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const s = supa();
  if (s) {
    try {
      let query = s.from('agent_mail_messages').select('*').eq('user_id', userId);
      if (folder && folder !== 'all') query = query.eq('folder', folder);
      if (needle) query = query.or('subject.ilike.%' + needle + '%,from_address.ilike.%' + needle + '%,body_text.ilike.%' + needle + '%');
      const { data, error } = await query.order('created_at', { ascending: false }).limit(cap);
      if (error) throw error;
      return (data || []).map((r) => mapMailMessage(r, userId));
    } catch (e) {
      console.warn('[store] supabase mail list fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailMessages || [])
    .filter((m) => m.userId === userId)
    .filter((m) => !folder || folder === 'all' || m.folder === folder)
    .filter((m) => !needle || [m.subject, m.fromAddress, m.bodyText].some((x) => String(x || '').toLowerCase().includes(needle)))
    .sort((a, b) => b.at - a.at)
    .slice(0, cap);
}
async function getMailMessage(userId, id) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('agent_mail_messages').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (data) return mapMailMessage(data, userId);
    } catch (e) {
      console.warn('[store] supabase mail get fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailMessages || []).find((m) => m.id === id && m.userId === userId) || null;
}
async function getMailMessageByResendId(resendId) {
  const id = String(resendId || '');
  if (!id) return null;
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('agent_mail_messages').select('*').eq('resend_id', id).maybeSingle();
      if (error) throw error;
      if (data) return mapMailMessage(data, data.user_id);
    } catch (e) {
      console.warn('[store] supabase mail resend-id fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailMessages || []).find((m) => m.resendId === id) || null;
}
async function insertMailMessage(userId, msg) {
  const row = {
    id: 'msg_' + uid(),
    userId,
    mailboxAddress: msg.mailboxAddress || '',
    direction: msg.direction || 'inbound',
    folder: msg.folder || (msg.direction === 'outbound' ? 'sent' : 'inbox'),
    fromAddress: msg.fromAddress || '',
    fromName: msg.fromName || '',
    toAddresses: msg.toAddresses || [],
    ccAddresses: msg.ccAddresses || [],
    subject: msg.subject || '',
    bodyText: msg.bodyText || '',
    bodyHtml: msg.bodyHtml || '',
    messageId: msg.messageId || null,
    inReplyTo: msg.inReplyTo || null,
    threadId: msg.threadId || null,
    resendId: msg.resendId || null,
    isRead: !!msg.isRead,
    at: Date.now(),
  };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('agent_mail_messages').insert({
        id: row.id,
        user_id: userId,
        mailbox_address: row.mailboxAddress,
        direction: row.direction,
        folder: row.folder,
        from_address: row.fromAddress,
        from_name: row.fromName,
        to_addresses: row.toAddresses,
        cc_addresses: row.ccAddresses,
        subject: row.subject,
        body_text: row.bodyText,
        body_html: row.bodyHtml,
        message_id: row.messageId,
        in_reply_to: row.inReplyTo,
        thread_id: row.threadId,
        resend_id: row.resendId,
        is_read: row.isRead,
      });
      if (error) throw error;
      return row;
    } catch (e) {
      console.warn('[store] supabase insert mail fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.mailMessages = d.mailMessages || [];
  d.mailMessages.unshift(row);
  saveLocal(d);
  return row;
}
async function updateMailMessage(userId, id, patch) {
  const s = supa();
  if (s) {
    try {
      const upd = {};
      if (patch.isRead != null) upd.is_read = !!patch.isRead;
      const { error } = await s.from('agent_mail_messages').update(upd).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    } catch (e) {
      console.warn('[store] supabase update mail fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.mailMessages = (d.mailMessages || []).map((m) => m.id === id && m.userId === userId ? Object.assign({}, m, patch) : m);
  saveLocal(d);
  return (d.mailMessages || []).find((m) => m.id === id) || { id, userId, ...patch };
}
async function countUnreadMail(userId) {
  const s = supa();
  if (s) {
    try {
      const { count, error } = await s.from('agent_mail_messages').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('folder', 'inbox').eq('is_read', false);
      if (error) throw error;
      return Number(count || 0);
    } catch (e) {
      console.warn('[store] supabase unread mail fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailMessages || []).filter((m) => m.userId === userId && m.folder === 'inbox' && !m.isRead).length;
}
async function countOutboundMailToday(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();
  const s = supa();
  if (s) {
    try {
      const { count, error } = await s.from('agent_mail_messages').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('direction', 'outbound').gte('created_at', since);
      if (error) throw error;
      return Number(count || 0);
    } catch (e) {
      console.warn('[store] supabase outbound mail fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailMessages || []).filter((m) => m.userId === userId && m.direction === 'outbound' && m.at >= start.getTime()).length;
}
async function listMailDrafts(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('agent_mail_drafts').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20);
      if (error) throw error;
      return (data || []).map((r) => mapMailDraft(r, userId));
    } catch (e) {
      console.warn('[store] supabase drafts fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.mailDrafts || []).filter((x) => x.userId === userId).sort((a, b) => b.at - a.at).slice(0, 20);
}
async function upsertMailDraft(userId, input) {
  const row = {
    id: input.id || ('dft_' + uid()),
    userId,
    toAddresses: input.toAddresses || [],
    subject: input.subject || '',
    bodyText: input.bodyText || '',
    inReplyTo: input.inReplyTo || null,
    at: Date.now(),
  };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      // SECURITY: a caller-supplied draft id may only update the caller's own draft.
      if (input.id) {
        const { data: existing, error: exErr } = await s.from('agent_mail_drafts').select('user_id').eq('id', row.id).maybeSingle();
        if (exErr) throw exErr;
        if (existing && existing.user_id !== userId) row.id = 'dft_' + crypto.randomBytes(9).toString('hex');
      }
      const { error } = await s.from('agent_mail_drafts').upsert({
        id: row.id,
        user_id: userId,
        to_addresses: row.toAddresses,
        subject: row.subject,
        body_text: row.bodyText,
        in_reply_to: row.inReplyTo,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
      return row;
    } catch (e) {
      console.warn('[store] supabase upsert draft fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.mailDrafts = d.mailDrafts || [];
  const i = d.mailDrafts.findIndex((x) => x.id === row.id && x.userId === userId);
  if (i >= 0) d.mailDrafts[i] = row; else d.mailDrafts.unshift(row);
  saveLocal(d);
  return row;
}
async function deleteMailDraft(userId, id) {
  const s = supa();
  if (s) {
    try { await s.from('agent_mail_drafts').delete().eq('id', id).eq('user_id', userId); } catch {}
  }
  const d = loadLocal();
  d.mailDrafts = (d.mailDrafts || []).filter((x) => !(x.id === id && x.userId === userId));
  saveLocal(d);
}

function normalizeDisabled(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((s) => String(s || '').toUpperCase().trim()).filter((s) => /^[A-Z0-9_]+$/.test(s)))];
}
async function getConnectorPermissions(userId, toolkit) {
  const tk = String(toolkit || '').toLowerCase();
  if (!userId || !tk) return [];
  const s = supa();
  if (s) {
    const { data, error } = await s.from('connector_permissions').select('disabled').eq('user_id', userId).eq('toolkit', tk).maybeSingle();
    if (error) throw error;
    return normalizeDisabled(data && data.disabled);
  }
  const d = loadLocal();
  const row = (d.connectorPermissions || []).find((r) => r.userId === userId && r.toolkit === tk);
  return normalizeDisabled(row && row.disabled);
}
async function setConnectorPermissions(userId, toolkit, disabled) {
  const tk = String(toolkit || '').toLowerCase();
  if (!userId || !tk) return [];
  const list = normalizeDisabled(disabled);
  const s = supa();
  if (s) {
    await ensureProfile(userId);
    const { error } = await s.from('connector_permissions').upsert({
      user_id: userId, toolkit: tk, disabled: list, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return list;
  }
  const d = loadLocal();
  d.connectorPermissions = (d.connectorPermissions || []).filter((r) => !(r.userId === userId && r.toolkit === tk));
  d.connectorPermissions.push({ userId, toolkit: tk, disabled: list, at: Date.now() });
  saveLocal(d);
  return list;
}

const DEFAULT_AGENT_PERMISSIONS = Object.freeze({ web:'ask_some', connectors:'ask_some', knownHosts:[] });
function cleanAgentPermissions(input = {}) {
  const modes = ['ask_some','always_ask'];
  return {
    web: modes.includes(input.web) ? input.web : DEFAULT_AGENT_PERMISSIONS.web,
    connectors: modes.includes(input.connectors) ? input.connectors : DEFAULT_AGENT_PERMISSIONS.connectors,
    knownHosts: [...new Set((Array.isArray(input.knownHosts) ? input.knownHosts : []).map(h => String(h).toLowerCase()).filter(h => /^[a-z0-9.-]{1,253}$/.test(h)))].slice(-200),
  };
}
async function getAgentPermissions(userId) {
  const s=supa();
  if(s){const {data,error}=await s.from('agent_permissions').select('web_mode,connector_mode,known_hosts').eq('user_id',userId).maybeSingle();if(error){if(['42P01','PGRST205'].includes(error.code))return cleanAgentPermissions();throw error;}return cleanAgentPermissions(data ? {web:data.web_mode,connectors:data.connector_mode,knownHosts:data.known_hosts} : {});}
  const row=(loadLocal().agentPermissions || []).find(r=>r.userId===userId);
  return cleanAgentPermissions(row || {});
}
async function setAgentPermissions(userId, patch) {
  const current=await getAgentPermissions(userId), next=cleanAgentPermissions({...current,...(patch.web!==undefined?{web:patch.web}:{}),...(patch.connectors!==undefined?{connectors:patch.connectors}:{}),knownHosts:current.knownHosts});
  const s=supa();
  if(s){await ensureProfile(userId);const {error}=await s.from('agent_permissions').upsert({user_id:userId,web_mode:next.web,connector_mode:next.connectors,known_hosts:next.knownHosts,updated_at:new Date().toISOString()});if(error)throw error;}
  else {const d=loadLocal();d.agentPermissions=(d.agentPermissions || []).filter(r=>r.userId!==userId);d.agentPermissions.push({userId,...next});saveLocal(d);}
  return next;
}
async function rememberBrowserHost(userId, host) {
  const clean=String(host || '').toLowerCase();
  if(!/^[a-z0-9.-]{1,253}$/.test(clean))return;
  const current=await getAgentPermissions(userId);
  if(!current.knownHosts.includes(clean)){
    const next={...current,knownHosts:[...current.knownHosts,clean].slice(-200)},s=supa();
    if(s){
      await ensureProfile(userId);
      const {data,error}=await s.from('agent_permissions').update({known_hosts:next.knownHosts,updated_at:new Date().toISOString()}).eq('user_id',userId).select('user_id');
      if(error)throw error;
      if(!data?.length){const inserted=await s.from('agent_permissions').insert({user_id:userId,known_hosts:next.knownHosts});if(inserted.error){if(inserted.error.code!=='23505')throw inserted.error;const retry=await s.from('agent_permissions').update({known_hosts:next.knownHosts}).eq('user_id',userId);if(retry.error)throw retry.error;}}
    }
    else {const d=loadLocal(),latest=cleanAgentPermissions((d.agentPermissions || []).find(r=>r.userId===userId) || {});d.agentPermissions=(d.agentPermissions || []).filter(r=>r.userId!==userId);d.agentPermissions.push({userId,...latest,knownHosts:[...new Set([...latest.knownHosts,clean])].slice(-200)});saveLocal(d);}
  }
}

function mapShopPayAccount(r, userId) {
  return {
    userId: r.user_id || r.userId || userId,
    shopSubject: r.shop_subject || r.shopSubject || null,
    email: r.email || null,
    displayName: r.display_name || r.displayName || null,
    scopes: r.scopes || '',
    encryptedShopToken: r.encrypted_shop_token || r.encryptedShopToken || null,
    encryptedRefreshToken: r.encrypted_refresh_token || r.encryptedRefreshToken || null,
    shopTokenExpiresAt: r.shop_token_expires_at ? new Date(r.shop_token_expires_at).getTime() : (r.shopTokenExpiresAt || null),
    dailyLimitUsd: r.daily_limit_usd != null ? Number(r.daily_limit_usd) : (r.dailyLimitUsd != null ? Number(r.dailyLimitUsd) : 200),
    oauthState: r.oauth_state || r.oauthState || null,
    oauthVerifier: r.oauth_verifier || r.oauthVerifier || null,
    oauthRedirect: r.oauth_redirect || r.oauthRedirect || null,
    oauthNonce: r.oauth_nonce || r.oauthNonce || null,
    oauthExp: r.oauth_exp ? new Date(r.oauth_exp).getTime() : (r.oauthExp || null),
    connectedAt: r.connected_at ? new Date(r.connected_at).getTime() : (r.connectedAt || null),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : (r.updatedAt || Date.now()),
  };
}

async function getShopPayAccount(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('shop_pay_accounts').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (data) return mapShopPayAccount(data, userId);
    } catch (e) {
      console.warn('[store] supabase shop pay fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.shopPayAccounts || []).find((a) => a.userId === userId) || null;
}

async function findShopPayByOAuthState(state) {
  const st = String(state || '');
  if (!st) return null;
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('shop_pay_accounts').select('*').eq('oauth_state', st).maybeSingle();
      if (error) throw error;
      if (data) return mapShopPayAccount(data, data.user_id);
    } catch (e) {
      console.warn('[store] supabase shop pay oauth fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.shopPayAccounts || []).find((a) => a.oauthState === st) || null;
}

async function upsertShopPayAccount(userId, patch) {
  const prev = await getShopPayAccount(userId);
  const next = Object.assign({
    userId,
    shopSubject: null,
    email: null,
    displayName: null,
    scopes: '',
    encryptedShopToken: null,
    encryptedRefreshToken: null,
    shopTokenExpiresAt: null,
    dailyLimitUsd: 200,
    oauthState: null,
    oauthVerifier: null,
    oauthRedirect: null,
    oauthNonce: null,
    oauthExp: null,
    connectedAt: null,
    updatedAt: Date.now(),
  }, prev || {}, patch || {}, { userId, updatedAt: Date.now() });
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('shop_pay_accounts').upsert({
        user_id: userId,
        shop_subject: next.shopSubject,
        email: next.email,
        display_name: next.displayName,
        scopes: next.scopes,
        encrypted_shop_token: next.encryptedShopToken,
        encrypted_refresh_token: next.encryptedRefreshToken,
        shop_token_expires_at: next.shopTokenExpiresAt ? new Date(next.shopTokenExpiresAt).toISOString() : null,
        daily_limit_usd: next.dailyLimitUsd,
        oauth_state: next.oauthState,
        oauth_verifier: next.oauthVerifier,
        oauth_redirect: next.oauthRedirect,
        oauth_nonce: next.oauthNonce,
        oauth_exp: next.oauthExp ? new Date(next.oauthExp).toISOString() : null,
        connected_at: next.connectedAt ? new Date(next.connectedAt).toISOString() : null,
        updated_at: new Date(next.updatedAt).toISOString(),
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return next;
    } catch (e) {
      console.warn('[store] supabase upsert shop pay fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.shopPayAccounts = d.shopPayAccounts || [];
  const i = d.shopPayAccounts.findIndex((a) => a.userId === userId);
  if (i >= 0) d.shopPayAccounts[i] = next; else d.shopPayAccounts.unshift(next);
  saveLocal(d);
  return next;
}

async function deleteShopPayAccount(userId) {
  const s = supa();
  if (s) {
    try { await s.from('shop_pay_accounts').delete().eq('user_id', userId); } catch {}
  }
  const d = loadLocal();
  d.shopPayAccounts = (d.shopPayAccounts || []).filter((a) => a.userId !== userId);
  saveLocal(d);
}

function mapShopPayOrder(r, userId) {
  return {
    id: r.id,
    userId: r.user_id || r.userId || userId,
    merchant: r.merchant_domain || r.merchant || null,
    checkoutId: r.checkout_id || r.checkoutId || null,
    cartId: r.cart_id || r.cartId || null,
    orderId: r.order_id || r.orderId || null,
    status: r.status,
    amount: Number(r.amount || 0),
    currency: r.currency || 'USD',
    title: r.title || null,
    continueUrl: r.continue_url || r.continueUrl || null,
    error: r.error || null,
    at: r.created_at ? new Date(r.created_at).getTime() : (r.at || Date.now()),
  };
}

async function listShopPayOrders(userId, limit) {
  const cap = Math.min(80, Number(limit) || 20);
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('shop_pay_orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(cap);
      if (error) throw error;
      return (data || []).map((r) => mapShopPayOrder(r, userId));
    } catch (e) {
      console.warn('[store] supabase shop pay orders fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.shopPayOrders || []).filter((t) => t.userId === userId).sort((a, b) => b.at - a.at).slice(0, cap);
}

async function getShopPayOrder(userId, id) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('shop_pay_orders').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (data) return mapShopPayOrder(data, userId);
    } catch (e) {
      console.warn('[store] supabase shop pay order fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.shopPayOrders || []).find((t) => t.id === id && t.userId === userId) || null;
}

async function reserveShopPaySpend(userId, order, dailyLimitUsd) {
  const id = order.id || ('spo_' + uid());
  const s = supa();
  if (s) {
    await ensureProfile(userId);
    const { data, error } = await s.rpc('reserve_shop_pay_spend', {
      p_user_id: userId,
      p_order_id: id,
      p_merchant: order.merchant || '',
      p_checkout_id: order.checkoutId || null,
      p_cart_id: order.cartId || null,
      p_amount: Number(order.amount || 0),
      p_currency: order.currency || 'USD',
      p_title: order.title || null,
      p_daily_limit: Number(dailyLimitUsd || 0),
      p_status: order.status || 'pending',
    });
    if (error) {
      const code = String(error.message || '');
      const e = new Error(code.includes('DAILY_LIMIT') ? 'Daily Shop Pay spend limit exceeded.' : code.includes('CHECKOUT_CHANGED') ? 'Checkout changed after a previous purchase attempt.' : 'Could not reserve Shop Pay spend.');
      e.code = code.includes('DAILY_LIMIT') ? 'LIMIT' : code.includes('CHECKOUT_CHANGED') ? 'NEED_CONFIRM' : 'SHOP_STORE';
      throw e;
    }
    return mapShopPayOrder(data, userId);
  }
  if (supaConfigured()) throw Object.assign(new Error('Shop Pay database is unavailable.'), { code: 'SHOP_STORE' });
  const previous = (loadLocal().shopPayOrders || []).find((t) => t.userId === userId && t.merchant === order.merchant && t.checkoutId === order.checkoutId);
  if (previous) {
    if (Number(previous.amount) !== Number(order.amount) || previous.currency !== order.currency) throw Object.assign(new Error('Checkout changed after a previous purchase attempt.'), { code: 'NEED_CONFIRM' });
    return previous;
  }
  const start = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const spent = (loadLocal().shopPayOrders || [])
    .filter((t) => t.userId === userId && t.at >= start && ['pending', 'authorized', 'escalated', 'completed'].includes(t.status))
    .reduce((n, t) => n + Number(t.amount || 0), 0);
  if (spent + Number(order.amount || 0) > Number(dailyLimitUsd || 0)) {
    throw Object.assign(new Error('Daily Shop Pay spend limit exceeded.'), { code: 'LIMIT' });
  }
  const row = {
    id, userId,
    merchant: order.merchant || null,
    checkoutId: order.checkoutId || null,
    cartId: order.cartId || null,
    orderId: null,
    status: order.status || 'pending',
    amount: Number(order.amount || 0),
    currency: order.currency || 'USD',
    title: order.title || null,
    continueUrl: null,
    error: null,
    at: Date.now(),
  };
  const d = loadLocal();
  d.shopPayOrders = d.shopPayOrders || [];
  d.shopPayOrders.unshift(row);
  saveLocal(d);
  return row;
}

async function updateShopPayOrder(userId, id, patch) {
  const s = supa();
  if (s) {
    try {
      const upd = {};
      if (patch.status) upd.status = patch.status;
      if (patch.orderId !== undefined) upd.order_id = patch.orderId;
      if (patch.checkoutId !== undefined) upd.checkout_id = patch.checkoutId;
      if (patch.continueUrl !== undefined) upd.continue_url = patch.continueUrl;
      if (patch.error !== undefined) upd.error = patch.error;
      if (patch.title !== undefined) upd.title = patch.title;
      if (patch.amount !== undefined) upd.amount = patch.amount;
      const { error } = await s.from('shop_pay_orders').update(upd).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    } catch (e) {
      throw Object.assign(new Error('Could not save Shop Pay order status.'), { code: 'SHOP_STORE', cause: e });
    }
  }
  const d = loadLocal();
  d.shopPayOrders = (d.shopPayOrders || []).map((t) => t.id === id && t.userId === userId ? Object.assign({}, t, patch) : t);
  saveLocal(d);
  return (d.shopPayOrders || []).find((t) => t.id === id) || { id, userId, ...patch };
}

function sealSecret(plain) { return encryptValue(plain); }
function openSecret(obj) { return decryptValue(obj); }
const { createTokenWallet } = require('./token-wallet');
const signupDates = new Map();
async function getSignupAt(userId) {
  if (signupDates.has(userId)) return signupDates.get(userId);
  const s = supa();
  if (s) {
    const { data, error } = await s.auth.admin.getUserById(userId);
    if (error || !data?.user?.created_at) throw error || new Error('Could not load account signup date.');
    signupDates.set(userId, data.user.created_at);
    return data.user.created_at;
  }
  const d = loadLocal();
  d.signupDates = d.signupDates || {};
  if (!d.signupDates[userId]) { d.signupDates[userId] = new Date().toISOString(); saveLocal(d); }
  return d.signupDates[userId];
}
const tokenWallet = createTokenWallet({ supa, loadLocal, saveLocal, ensureProfile, getSignupAt, uid, plans: require('./plans').PLANS });
const { createPersonalStore } = require('./personal-store');
const personalStore = createPersonalStore({ supa, loadLocal, saveLocal, ensureProfile, uid });
const getTokenWallet = tokenWallet.tokenWallet;
const clientState = createClientStateStore({ supa, loadLocal, saveLocal, ensureProfile, listChatMessages });

module.exports = {
  getAgentContext, saveAgentContext, syncAgentContext, defaultAgentDocuments,
  listMemories, memoryStats, searchMemories, getMemory, addMemory, updateMemory, delMemory,
  listSecrets, addSecret, revealSecret, delSecret, secretsEncrypted,
  supaConfigured,
  getSubscription, setSubscription, findUserByStripeCustomer,
  logUsage, usageTotal, creditsUsed, billingTotals, creditsForUsageUsd, creditsForGift,
  logLegacyUsage, ...tokenWallet, getTokenWallet,
  ...personalStore,
  addGrant, grantsTotal, grantsTotalByReason, ensureFreeGrant, hasGrantRef,
  stripeEventSeen, markStripeEvent,
  createGift, findGiftByFrom, listPurchasedGifts, redeemGift, giftsCredit, requestUpgrade,
  getReferralCode, findReferralInviter, referralStats, redeemReferral,
  logToolRun,
  saveTurn, searchTurns, listChatMessages, latestChatSummary, listAutomationChats,
  listClientState: clientState.list, saveClientState: clientState.save, deleteClientChat: clientState.removeChat,
  listSubAgents, getSubAgent, createSubAgent, updateSubAgent, deleteSubAgent, ensureSystemSubAgents,
  listDueSubAgents, listAppSubAgentsForSync, markAppTriggerSync, markSubAgentRun, listUpkeepSignals, beginAutomationRun, getAutomationRunByDedupeKey, attachAutomationTask, listPendingAutomationRuns, finishAutomationRun, listAutomationRuns,
  getMailboxByUser, getMailboxByAddress, mailLocalPartTaken, upsertMailbox,
  listMailMessages, getMailMessage, getMailMessageByResendId, insertMailMessage, updateMailMessage,
  countUnreadMail, countOutboundMailToday, listMailDrafts, upsertMailDraft, deleteMailDraft,
  getConnectorPermissions, setConnectorPermissions,
  getAgentPermissions, setAgentPermissions, rememberBrowserHost,
  getShopPayAccount, findShopPayByOAuthState, upsertShopPayAccount, deleteShopPayAccount,
  listShopPayOrders, getShopPayOrder, reserveShopPaySpend, updateShopPayOrder,
  sealSecret, openSecret,
  CREDIT_GRANT_FREE,
};
