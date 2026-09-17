/* Lingon persistence.
   - If SUPABASE_URL + key are set, uses Supabase tables (see supabase/schema.sql).
   - Otherwise uses local JSON file server/data.json (gitignored) so the app is
     fully real + persistent today, and migrates cleanly to Supabase later.
   Secrets are AES-256-GCM encrypted at rest when ENCRYPTION_KEY is set.
   Otherwise they are base64-obscured (still never sent to the model). */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Edge runtime has no writable app filesystem: the local fallback store lives
// in memory for the lifetime of the worker. Supabase is the durable store.
let LOCAL = { memories: [], secrets: [], apps: [], approvals: [], chats: [], subAgents: [], automationRuns: [] };

function loadLocal() {
  return LOCAL;
}
function saveLocal(d) {
  LOCAL = d;
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
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LINGON_SUPABASE_SERVICE_ROLE_KEY || '').trim() ||
    (process.env.SUPABASE_SECRET_KEY || process.env.LINGON_SUPABASE_SECRET_KEY || '').trim() ||
    (process.env.SUPABASE_ANON_KEY || process.env.LINGON_SUPABASE_ANON_KEY || '').trim() ||
    (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.LINGON_SUPABASE_PUBLISHABLE_KEY || '').trim()
  );
}
function supa() {
  if (sb !== undefined && sb !== null) return sb;
  const url = (process.env.SUPABASE_URL || process.env.LINGON_SUPABASE_URL || '').trim();
  const token = supaKey();
  if (!url || !token) {
    sb = null;
    return sb;
  }
  try {
    sb = createClient(url, token);
  } catch {
    sb = null;
  }
  return sb;
}
function supaConfigured() {
  return !!(process.env.SUPABASE_URL || process.env.LINGON_SUPABASE_URL || '').trim() && !!supaKey();
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

// ---------- billing: subscriptions, credit grants, usage, gift cards ----------
// Credits: 1 credit = $0.50 face. Usage USD is marked up 2.5x into credits
// (CREDITS_USED = usd * 5). Gifts keep dollar face, redeem at 2 credits/$1.
const CREDIT_GRANT_FREE = 20;
function creditsForUsageUsd(usd) { return Number(usd || 0) * 2.5 * 2; }
function creditsForGift(usd) { return Number(usd || 0) * 2; }
async function getSubscription(userId) {
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { data, error } = await s.from('subscriptions').select('*').eq('user_id', userId).single();
      if (!error && data) return data;
      if (error && error.code !== 'PGRST116') throw error;
    } catch (e) {
      console.warn('[store] subscription fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.subs || []).find((x) => x.userId === userId) || { user_id: userId, plan: 'free', status: 'active' };
}
function subCols(m) {
  const out = {};
  for (const k of ['stripe_customer_id', 'stripe_subscription_id', 'current_period_end', 'gift_issued']) {
    if (m[k] !== undefined) out[k] = m[k];
  }
  return out;
}
async function setSubscription(userId, plan, status, extra) {
  const merged = { ...(extra || {}), plan, status: status || 'active' };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const row = { user_id: userId, plan, status: status || 'active', ...subCols(merged) };
      const { error } = await s.from('subscriptions').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
      return { user_id: userId, plan, status: status || 'active', ...merged };
    } catch (e) {
      console.warn('[store] set subscription fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.subs = d.subs || [];
  const i = d.subs.findIndex((x) => x.userId === userId);
  const row = { userId, user_id: userId, plan, status: status || 'active', ...merged };
  if (i >= 0) d.subs[i] = { ...d.subs[i], ...row }; else d.subs.push(row);
  saveLocal(d);
  return { user_id: userId, plan, status: status || 'active', ...merged };
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
async function addGrant(userId, credits, reason, ref) {
  const row = { id: 'gr_' + uid(), user_id: userId, credits: Number(credits || 0), reason: reason || 'grant', ref: ref || null };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('credit_grants').insert(row);
      if (error) throw error;
      return row;
    } catch (e) {
      console.warn('[store] grant fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.grants = d.grants || [];
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
    } catch {}
  }
  const d = loadLocal();
  return (d.grants || []).filter((r) => r.user_id === userId || r.userId === userId).reduce((n, r) => n + Number(r.credits || 0), 0);
}
async function hasGrantRef(userId, ref) {
  if (!ref) return false;
  const s = supa();
  if (s) {
    try {
      const { data } = await s.from('credit_grants').select('id').eq('user_id', userId).eq('ref', ref).limit(1);
      if (data && data.length) return true;
    } catch {}
  }
  const d = loadLocal();
  return !!((d.grants || []).some((g) => (g.user_id === userId || g.userId === userId) && g.ref === ref));
}
async function ensureFreeGrant(userId) {
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { data, error } = await s.from('credit_grants').select('id').eq('user_id', userId).eq('reason', 'free_starter').limit(1);
      if (!error) {
        if (data && data.length) return false;
        await addGrant(userId, CREDIT_GRANT_FREE, 'free_starter', 'free');
        return true;
      }
    } catch {}
    // Supabase unreachable or table missing — fall through to the local
    // fallback below, which grants at most once.
  }
  const d = loadLocal();
  if ((d.grants || []).some((g) => (g.user_id === userId || g.userId === userId) && g.reason === 'free_starter')) return false;
  await addGrant(userId, CREDIT_GRANT_FREE, 'free_starter', 'free');
  return true;
}
async function stripeEventSeen(eventId) {
  if (!eventId) return false;
  const s = supa();
  if (s) {
    try {
      const { data } = await s.from('stripe_events').select('id').eq('id', eventId).limit(1);
      if (data && data.length) return true;
    } catch {}
  }
  const d = loadLocal();
  return !!((d.stripeEvents || []).includes(eventId));
}
async function markStripeEvent(eventId) {
  if (!eventId) return;
  const s = supa();
  if (s) {
    try {
      await s.from('stripe_events').insert({ id: eventId });
    } catch {}
  }
  const d = loadLocal();
  d.stripeEvents = d.stripeEvents || [];
  if (!d.stripeEvents.includes(eventId)) d.stripeEvents.push(eventId);
  saveLocal(d);
}
async function logUsage(userId, { model, usage, cost }) {
  const costUsd = Number(cost || 0);
  const row = {
    id: 'use_' + uid(), user_id: userId, model: model || 'gemini-3.5-flash',
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
      let { error } = await s.from('api_usage').insert(row);
      if (error && /credits_charged|column/i.test(error.message || '')) {
        const { credits_charged, ...legacy } = row;
        ({ error } = await s.from('api_usage').insert(legacy));
      }
      if (error) throw error;
      return row;
    } catch (e) {
      console.warn('[store] usage fallback:', e.message);
    }
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
  for (let i = 0; i < 12; i++) c += abc[Math.floor(Math.random() * abc.length)];
  return 'LNG-' + c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8, 12);
}
async function createGift(fromUser, amountUsd) {
  const code = giftCode();
  const row = { code, amount_usd: Number(amountUsd), from_user: fromUser, to_user: null, redeemed_by: null };
  const s = supa();
  if (s) {
    try {
      const { error } = await s.from('gift_cards').insert(row);
      if (error) throw error;
      return row;
    } catch (e) {
      console.warn('[store] gift fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.gifts = d.gifts || [];
  d.gifts.unshift(row);
  saveLocal(d);
  return row;
}
async function redeemGift(userId, code) {
  const c = String(code || '').trim().toUpperCase();
  const grantRedeem = async (amountUsd) => {
    const credits = creditsForGift(amountUsd);
    await ensureFreeGrant(userId);
    await addGrant(userId, credits, 'gift_redeem', c);
    return { ok: true, amount: Number(amountUsd), credits };
  };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { data, error } = await s.from('gift_cards').select('*').eq('code', c).single();
      if (error || !data) return { ok: false, error: 'Code not found.' };
      if (data.redeemed_by) return { ok: false, error: 'Code already redeemed.' };
      const { error: e2 } = await s.from('gift_cards').update({ redeemed_by: userId, redeemed_at: new Date().toISOString(), to_user: userId }).eq('code', c);
      if (e2) throw e2;
      return await grantRedeem(data.amount_usd);
    } catch (e) {
      console.warn('[store] redeem fallback:', e.message);
    }
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
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  };
}

async function listSubAgents(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('sub_agents').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(fromSubAgentRow);
    } catch (e) { console.warn('[store] sub-agents fallback:', e.message); }
  }
  return (loadLocal().subAgents || []).filter((row) => row.userId === userId).map(fromSubAgentRow);
}

async function getSubAgent(userId, id) {
  const agents = await listSubAgents(userId);
  return agents.find((row) => row.id === id) || null;
}

async function createSubAgent(userId, input, nextRunAt) {
  const now = new Date().toISOString();
  const agent = { id: 'sub_' + uid(), userId, chatId: 'auto_' + uid(), name: input.name, prompt: input.prompt, enabled: input.enabled, trigger: input.trigger, nextRunAt: nextRunAt || null, lastRunAt: null, lastStatus: null, lastError: null, createdAt: now };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('sub_agents').insert({ id: agent.id, user_id: userId, chat_id: agent.chatId, name: agent.name, prompt: agent.prompt, enabled: agent.enabled, trigger_type: agent.trigger.type, trigger_config: agent.trigger, next_run_at: agent.nextRunAt });
      if (error) throw error;
      return agent;
    } catch (e) { console.warn('[store] create sub-agent fallback:', e.message); }
  }
  const d = loadLocal(); d.subAgents = d.subAgents || []; d.subAgents.unshift(agent); saveLocal(d); return agent;
}

async function updateSubAgent(userId, id, input, nextRunAt) {
  const patch = { name: input.name, prompt: input.prompt, enabled: input.enabled, trigger_type: input.trigger.type, trigger_config: input.trigger, next_run_at: nextRunAt || null, updated_at: new Date().toISOString() };
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('sub_agents').update(patch).eq('id', id).eq('user_id', userId).select('*').maybeSingle();
      if (error) throw error;
      if (data) return fromSubAgentRow(data);
    } catch (e) { console.warn('[store] update sub-agent fallback:', e.message); }
  }
  const d = loadLocal(); d.subAgents = d.subAgents || [];
  const idx = d.subAgents.findIndex((row) => row.id === id && row.userId === userId);
  if (idx < 0) return null;
  d.subAgents[idx] = { ...d.subAgents[idx], ...input, nextRunAt: nextRunAt || null }; saveLocal(d); return fromSubAgentRow(d.subAgents[idx]);
}

async function deleteSubAgent(userId, id) {
  const s = supa();
  if (s) { try { const { error } = await s.from('sub_agents').delete().eq('id', id).eq('user_id', userId); if (error) throw error; } catch (e) { console.warn('[store] delete sub-agent fallback:', e.message); } }
  const d = loadLocal(); d.subAgents = (d.subAgents || []).filter((row) => row.id !== id || row.userId !== userId); saveLocal(d);
}

async function listDueSubAgents(now, limit = 5) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('sub_agents').select('*').eq('enabled', true).eq('trigger_type', 'schedule').not('next_run_at', 'is', null).lte('next_run_at', now).order('next_run_at').limit(limit);
      if (error) throw error;
      return (data || []).map(fromSubAgentRow);
    } catch (e) { console.warn('[store] due sub-agents fallback:', e.message); }
  }
  const when = new Date(now).getTime();
  return (loadLocal().subAgents || []).filter((row) => row.enabled && row.trigger?.type === 'schedule' && row.nextRunAt && new Date(row.nextRunAt).getTime() <= when).slice(0, limit).map(fromSubAgentRow);
}

async function markSubAgentRun(userId, id, status, errorText, nextRunAt) {
  const patch = { last_run_at: new Date().toISOString(), last_status: status, last_error: errorText ? String(errorText).slice(0, 500) : null, next_run_at: nextRunAt || null, updated_at: new Date().toISOString() };
  const s = supa();
  if (s) { try { const { error } = await s.from('sub_agents').update(patch).eq('id', id).eq('user_id', userId); if (error) throw error; return; } catch (e) { console.warn('[store] mark sub-agent fallback:', e.message); } }
  const d = loadLocal(); const row = (d.subAgents || []).find((item) => item.id === id && item.userId === userId);
  if (row) Object.assign(row, { lastRunAt: patch.last_run_at, lastStatus: status, lastError: patch.last_error, nextRunAt: patch.next_run_at }); saveLocal(d);
}

async function beginAutomationRun(userId, subAgentId, chatId, dedupeKey, event) {
  const row = { id: 'arun_' + uid(), user_id: userId, sub_agent_id: subAgentId, chat_id: chatId, dedupe_key: dedupeKey, status: 'running', event: event || {} };
  const s = supa();
  if (s) {
    try { const { error } = await s.from('automation_runs').insert(row); if (error?.code === '23505') return null; if (error) throw error; return { id: row.id }; }
    catch (e) { console.warn('[store] automation run fallback:', e.message); }
  }
  const d = loadLocal(); d.automationRuns = d.automationRuns || [];
  if (d.automationRuns.some((item) => item.dedupe_key === dedupeKey)) return null;
  d.automationRuns.unshift({ ...row, started_at: new Date().toISOString() }); saveLocal(d); return { id: row.id };
}

async function finishAutomationRun(userId, id, status, result, errorText) {
  const patch = { status, result: result || null, error: errorText ? String(errorText).slice(0, 1000) : null, finished_at: new Date().toISOString() };
  const s = supa();
  if (s) { try { const { error } = await s.from('automation_runs').update(patch).eq('id', id).eq('user_id', userId); if (error) throw error; return; } catch (e) { console.warn('[store] finish automation fallback:', e.message); } }
  const d = loadLocal(); const row = (d.automationRuns || []).find((item) => item.id === id && (item.user_id === userId || item.userId === userId)); if (row) Object.assign(row, patch); saveLocal(d);
}

async function listAutomationRuns(userId, limit = 30) {
  const s = supa();
  if (s) { try { const { data, error } = await s.from('automation_runs').select('*').eq('user_id', userId).order('started_at', { ascending: false }).limit(limit); if (error) throw error; return data || []; } catch (e) { console.warn('[store] automation runs fallback:', e.message); } }
  return (loadLocal().automationRuns || []).filter((row) => row.user_id === userId || row.userId === userId).slice(0, limit);
}

// ---------- conversation history (Strawberry-style transcripts, per-user) ----------
async function saveTurn(userId, chatId, role, text, options = {}) {
  const row = { id: 'msg_' + uid(), chat_id: chatId || 'unsorted', user_id: userId, role, kind: 'text', text: String(text || '').slice(0, 6000), metadata: options.metadata || {} };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { data: existing, error: findError } = await s.from('chats').select('user_id').eq('id', row.chat_id).maybeSingle();
      if (findError) throw findError;
      if (existing && existing.user_id !== userId) throw Object.assign(new Error('Chat belongs to another account.'), { code: 'FORBIDDEN' });
      if (!existing) {
        const { error: chatError } = await s.from('chats').insert({ id: row.chat_id, user_id: userId, title: String(options.title || row.chat_id).slice(0, 60), source: options.source || 'user', sub_agent_id: options.subAgentId || null, updated_at: new Date().toISOString() });
        if (chatError) throw chatError;
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
      if (e.code === 'FORBIDDEN') throw e;
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
    try { const { data, error } = await s.from('messages').select('id,role,kind,text,metadata,created_at').eq('user_id', userId).eq('chat_id', chatId).order('created_at', { ascending: true }).limit(limit); if (error) throw error; return data || []; }
    catch (e) { console.warn('[store] chat messages fallback:', e.message); }
  }
  return (loadLocal().turns || []).filter((row) => (row.user_id === userId || row.userId === userId) && row.chat_id === chatId).sort((a, b) => Number(a.at || 0) - Number(b.at || 0)).slice(-limit);
}

async function listAutomationChats(userId) {
  const s = supa();
  if (s) {
    try { const { data, error } = await s.from('chats').select('*').eq('user_id', userId).eq('source', 'automation').order('updated_at', { ascending: false }).limit(50); if (error) throw error; const chats = []; for (const row of data || []) chats.push({ ...row, messages: await listChatMessages(userId, row.id, 100) }); return chats; }
    catch (e) { console.warn('[store] automation chats fallback:', e.message); }
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
      const { data, error } = await s.from('messages').select('chat_id,role,text,created_at').eq('user_id', userId).or(ors).order('created_at', { ascending: false }).limit(limit * 3);
      if (error) throw error;
      return (data || []).slice(0, limit);
    } catch (e) {
      console.warn('[store] search turns fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.turns || [])
    .filter((t) => t.userId === userId || t.user_id === userId)
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

export {
  listMemories, addMemory, delMemory,
  listSecrets, addSecret, revealSecret, delSecret,
  supaConfigured,
  getSubscription, setSubscription, findUserByStripeCustomer,
  logUsage, usageTotal, creditsUsed, creditsForUsageUsd, creditsForGift,
  addGrant, grantsTotal, grantsTotalByReason, ensureFreeGrant, hasGrantRef,
  stripeEventSeen, markStripeEvent,
  createGift, redeemGift, giftsCredit, requestUpgrade,
  logToolRun,
  saveTurn, searchTurns, listChatMessages, listAutomationChats,
  listSubAgents, getSubAgent, createSubAgent, updateSubAgent, deleteSubAgent,
  listDueSubAgents, markSubAgentRun, beginAutomationRun, finishAutomationRun, listAutomationRuns,
  CREDIT_GRANT_FREE,
};
