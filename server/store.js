/* Lingon persistence.
   - If SUPABASE_URL + key are set, uses Supabase tables (see supabase/schema.sql).
   - Otherwise uses local JSON file server/data.json (gitignored) so the app is
     fully real + persistent today, and migrates cleanly to Supabase later.
   Secrets are AES-256-GCM encrypted at rest when ENCRYPTION_KEY is set.
   Otherwise they are base64-obscured (still never sent to the model). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data.json');

function loadLocal() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { memories: [], secrets: [], apps: [], approvals: [], chats: [] };
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
function encryptValue(plain) {
  const k = encKey();
  if (!k) return { alg: 'b64', data: Buffer.from(String(plain), 'utf8').toString('base64') };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: ct.toString('hex') };
}
function decryptValue(obj) {
  try {
    if (!obj) return '';
    if (obj.alg === 'b64') return Buffer.from(obj.data, 'base64').toString('utf8');
    const k = encKey();
    if (!k || obj.alg !== 'aes-256-gcm') return '';
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(obj.iv, 'hex'));
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

async function listMemories(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('memories').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []).map((r) => ({ id: r.id, text: r.text, src: r.src, at: new Date(r.created_at).getTime() }));
    } catch (e) {
      console.warn('[store] supabase memories fallback to local:', e.message);
    }
  }
  const d = loadLocal();
  return d.memories.filter((m) => !userId || m.userId === userId).sort((a, b) => b.at - a.at);
}
async function addMemory(userId, text, src) {
  const s = supa();
  const row = { id: `mem_${uid()}`, user_id: userId, text: String(text).slice(0, 2000), src: src || 'chat' };
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('memories').insert(row);
      if (error) throw error;
      return { id: row.id, text: row.text, src: row.src, at: Date.now() };
    } catch (e) {
      console.warn('[store] supabase insert memory fallback:', e.message);
    }
  }
  const d = loadLocal();
  const m = { id: row.id, userId, text: row.text, src: row.src, at: Date.now() };
  d.memories.unshift(m);
  saveLocal(d);
  return m;
}
async function delMemory(userId, id) {
  const s = supa();
  if (s) {
    try { await s.from('memories').delete().eq('id', id).eq('user_id', userId); } catch {}
  }
  const d = loadLocal();
  d.memories = d.memories.filter((m) => m.id !== id);
  saveLocal(d);
}

async function listSecrets(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('vault_secrets').select('id,ref,name,created_at').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((r) => ({ id: r.id, ref: r.ref, name: r.name, at: new Date(r.created_at).getTime() }));
    } catch (e) {
      console.warn('[store] supabase secrets fallback:', e.message);
    }
  }
  const d = loadLocal();
  return d.secrets.filter((x) => x.userId === userId).map(({ value, ...rest }) => rest);
}
async function addSecret(userId, name, value) {
  const ref = 'sec_' + uid().slice(0, 4);
  const id = ref + '_' + uid();
  const sealed = encryptValue(value);
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('vault_secrets').insert({ id, user_id: userId, name, ref, encrypted_value: sealed });
      if (error) throw error;
      return { id, ref, name, at: Date.now() };
    } catch (e) {
      console.warn('[store] supabase insert secret fallback:', e.message);
    }
  }
  const d = loadLocal();
  const row = { id, ref, userId, name, value: sealed, at: Date.now() };
  d.secrets.unshift(row);
  saveLocal(d);
  return { id, ref, name, at: Date.now() };
}
async function revealSecret(userId, id) {
  // owner-only reveal; server logs access, value never goes to the model
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('vault_secrets').select('*').eq('id', id).eq('user_id', userId).single();
      if (error) throw error;
      return decryptValue(data.encrypted_value);
    } catch (e) {
      console.warn('[store] supabase reveal fallback:', e.message);
    }
  }
  const d = loadLocal();
  const row = d.secrets.find((x) => x.id === id && x.userId === userId);
  return row ? decryptValue(row.value) : '';
}
async function delSecret(userId, id) {
  const s = supa();
  if (s) {
    try { await s.from('vault_secrets').delete().eq('id', id).eq('user_id', userId); } catch {}
  }
  const d = loadLocal();
  d.secrets = d.secrets.filter((x) => x.id !== id);
  saveLocal(d);
}

module.exports = {
  listMemories, addMemory, delMemory,
  listSecrets, addSecret, revealSecret, delSecret,
  supaConfigured,
};
