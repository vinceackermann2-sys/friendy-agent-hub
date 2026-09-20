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
    return { memories: [], secrets: [], apps: [], approvals: [], chats: [], subAgents: [], automationRuns: [], wallets: [], walletTx: [], mailboxes: [], mailMessages: [], mailDrafts: [] };
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
// ---- Stripe webhook idempotency ----
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
        // Older DB without the new column — retry without it.
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
async function findGiftByFrom(fromUser) {
  const from = String(fromUser || '');
  if (!from) return null;
  const s = supa();
  if (s) {
    try {
      const { data } = await s.from('gift_cards').select('*').eq('from_user', from).limit(1).maybeSingle();
      if (data) return data;
    } catch {}
  }
  const d = loadLocal();
  return (d.gifts || []).find((g) => g.from_user === from) || null;
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
    } catch (e) { console.warn('[store] create sub-agent fallback:', e.message); }
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
    } catch (e) { console.warn('[store] update sub-agent fallback:', e.message); }
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
    } catch (e) { console.warn('[store] delete sub-agent fallback:', e.message); }
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
    } catch (e) { console.warn('[store] due sub-agents fallback:', e.message); }
  }
  const when = new Date(now).getTime();
  const d = loadLocal();
  return (d.subAgents || []).filter((row) => row.enabled && row.trigger?.type === 'schedule' && row.nextRunAt && new Date(row.nextRunAt).getTime() <= when).slice(0, limit).map(fromSubAgentRow);
}

async function markSubAgentRun(userId, id, status, errorText, nextRunAt) {
  const patch = { last_run_at: new Date().toISOString(), last_status: status, last_error: errorText ? String(errorText).slice(0, 500) : null, next_run_at: nextRunAt || null, updated_at: new Date().toISOString() };
  const s = supa();
  if (s) {
    try {
      const { error } = await s.from('sub_agents').update(patch).eq('id', id).eq('user_id', userId);
      if (error) throw error;
      return;
    } catch (e) { console.warn('[store] mark sub-agent fallback:', e.message); }
  }
  const d = loadLocal();
  const row = (d.subAgents || []).find((item) => item.id === id && item.userId === userId);
  if (row) Object.assign(row, { lastRunAt: patch.last_run_at, lastStatus: status, lastError: patch.last_error, nextRunAt: patch.next_run_at });
  saveLocal(d);
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
    } catch (e) { console.warn('[store] automation run fallback:', e.message); }
  }
  const d = loadLocal();
  d.automationRuns = d.automationRuns || [];
  if (d.automationRuns.some((item) => item.dedupe_key === dedupeKey)) return null;
  d.automationRuns.unshift({ ...row, started_at: new Date().toISOString() });
  saveLocal(d);
  return { id: row.id };
}

async function finishAutomationRun(userId, id, status, result, errorText) {
  const patch = { status, result: result || null, error: errorText ? String(errorText).slice(0, 1000) : null, finished_at: new Date().toISOString() };
  const s = supa();
  if (s) {
    try {
      const { error } = await s.from('automation_runs').update(patch).eq('id', id).eq('user_id', userId);
      if (error) throw error;
      return;
    } catch (e) { console.warn('[store] finish automation fallback:', e.message); }
  }
  const d = loadLocal();
  const row = (d.automationRuns || []).find((item) => item.id === id && (item.user_id === userId || item.userId === userId));
  if (row) Object.assign(row, patch);
  saveLocal(d);
}

async function listAutomationRuns(userId, limit = 30) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('automation_runs').select('*').eq('user_id', userId).order('started_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    } catch (e) { console.warn('[store] automation runs fallback:', e.message); }
  }
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
    try {
      const { data, error } = await s.from('messages').select('id,role,kind,text,metadata,created_at').eq('user_id', userId).eq('chat_id', chatId).order('created_at', { ascending: true }).limit(limit);
      if (error) throw error;
      return data || [];
    } catch (e) { console.warn('[store] chat messages fallback:', e.message); }
  }
  return (loadLocal().turns || []).filter((row) => (row.user_id === userId || row.userId === userId) && row.chat_id === chatId).sort((a, b) => Number(a.at || 0) - Number(b.at || 0)).slice(-limit);
}

async function listAutomationChats(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('chats').select('*').eq('user_id', userId).eq('source', 'automation').order('updated_at', { ascending: false }).limit(50);
      if (error) throw error;
      const chats = [];
      for (const row of data || []) chats.push({ ...row, messages: await listChatMessages(userId, row.id, 100) });
      return chats;
    } catch (e) { console.warn('[store] automation chats fallback:', e.message); }
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

function mapWallet(r, userId) {
  return {
    userId: r.user_id || r.userId || userId,
    privyWalletId: r.privy_wallet_id || r.privyWalletId || null,
    address: r.address || null,
    chain: r.chain || 'base',
    externalId: r.external_id || r.externalId || null,
    card: r.card && typeof r.card === 'object' ? r.card : { status: 'none' },
    dailyLimitUsd: r.daily_limit_usd != null ? Number(r.daily_limit_usd) : (r.dailyLimitUsd != null ? Number(r.dailyLimitUsd) : 50),
    envelopes: Array.isArray(r.envelopes) ? r.envelopes : [],
    stripeCardholderId: r.stripe_cardholder_id || r.stripeCardholderId || null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : (r.createdAt || Date.now()),
  };
}

async function getAgentWallet(userId) {
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('agent_wallets').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (data) return mapWallet(data, userId);
    } catch (e) {
      console.warn('[store] supabase wallet fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.wallets || []).find((w) => w.userId === userId) || null;
}

async function upsertAgentWallet(userId, patch) {
  const prev = await getAgentWallet(userId);
  const next = Object.assign({
    userId,
    privyWalletId: null,
    address: null,
    chain: 'base',
    externalId: null,
    card: { status: 'none' },
    dailyLimitUsd: 50,
    envelopes: [],
    stripeCardholderId: null,
    createdAt: Date.now(),
  }, prev || {}, patch || {}, { userId });
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('agent_wallets').upsert({
        user_id: userId,
        privy_wallet_id: next.privyWalletId,
        address: next.address,
        chain: next.chain,
        external_id: next.externalId || null,
        card: next.card,
        daily_limit_usd: next.dailyLimitUsd,
        envelopes: next.envelopes || [],
        stripe_cardholder_id: next.stripeCardholderId || null,
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return next;
    } catch (e) {
      console.warn('[store] supabase upsert wallet fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.wallets = d.wallets || [];
  const i = d.wallets.findIndex((w) => w.userId === userId);
  if (i >= 0) d.wallets[i] = next; else d.wallets.unshift(next);
  saveLocal(d);
  return next;
}

function mapWalletTx(r, userId) {
  return {
    id: r.id,
    userId: r.user_id || r.userId || userId,
    kind: r.kind,
    asset: r.asset,
    amount: Number(r.amount || 0),
    to: r.to_address || r.to || null,
    status: r.status,
    hash: r.tx_hash || r.hash || null,
    error: r.error || null,
    at: r.created_at ? new Date(r.created_at).getTime() : (r.at || Date.now()),
  };
}

async function listWalletTx(userId, limit) {
  const cap = Math.min(80, Number(limit) || 20);
  const s = supa();
  if (s) {
    try {
      const { data, error } = await s.from('agent_wallet_tx').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(cap);
      if (error) throw error;
      return (data || []).map((r) => mapWalletTx(r, userId));
    } catch (e) {
      console.warn('[store] supabase wallet tx fallback:', e.message);
    }
  }
  const d = loadLocal();
  return (d.walletTx || []).filter((t) => t.userId === userId).sort((a, b) => b.at - a.at).slice(0, cap);
}

async function addWalletTx(userId, tx) {
  const row = {
    id: 'wtx_' + uid(),
    userId,
    kind: tx.kind || 'transfer',
    asset: tx.asset || 'usdc',
    amount: Number(tx.amount || 0),
    to: tx.to || null,
    status: tx.status || 'pending',
    hash: tx.hash || null,
    error: tx.error || null,
    at: Date.now(),
  };
  const s = supa();
  if (s) {
    try {
      await ensureProfile(userId);
      const { error } = await s.from('agent_wallet_tx').insert({
        id: row.id,
        user_id: userId,
        kind: row.kind,
        asset: row.asset,
        amount: row.amount,
        to_address: row.to,
        status: row.status,
        tx_hash: row.hash,
        error: row.error,
      });
      if (error) throw error;
      return row;
    } catch (e) {
      console.warn('[store] supabase insert wallet tx fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.walletTx = d.walletTx || [];
  d.walletTx.unshift(row);
  saveLocal(d);
  return row;
}

async function reserveWalletSpend(userId, tx, dailyLimitUsd) {
  const id = 'wtx_' + uid();
  const s = supa();
  if (s) {
    await ensureProfile(userId);
    const { data, error } = await s.rpc('reserve_agent_wallet_spend', {
      p_user_id: userId,
      p_tx_id: id,
      p_kind: tx.kind || 'transfer',
      p_asset: tx.asset || 'usdc',
      p_amount: Number(tx.amount || 0),
      p_to_address: tx.to || null,
      p_daily_limit: Number(dailyLimitUsd || 0),
      p_status: tx.status || 'pending',
    });
    if (error) {
      const e = new Error(String(error.message || '').includes('DAILY_LIMIT') ? 'Daily wallet spend limit exceeded.' : 'Could not reserve wallet spend.');
      e.code = String(error.message || '').includes('DAILY_LIMIT') ? 'LIMIT' : 'WALLET_STORE';
      throw e;
    }
    return mapWalletTx(data, userId);
  }
  if (supaConfigured()) throw Object.assign(new Error('Wallet database is unavailable.'), { code: 'WALLET_STORE' });
  return addWalletTx(userId, { ...tx, id });
}

async function updateWalletTx(userId, id, patch) {
  const s = supa();
  if (s) {
    try {
      const upd = {};
      if (patch.status) upd.status = patch.status;
      if (patch.hash !== undefined) upd.tx_hash = patch.hash;
      if (patch.error !== undefined) upd.error = patch.error;
      const { error } = await s.from('agent_wallet_tx').update(upd).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    } catch (e) {
      console.warn('[store] supabase update wallet tx fallback:', e.message);
    }
  }
  const d = loadLocal();
  d.walletTx = (d.walletTx || []).map((t) => t.id === id && t.userId === userId ? Object.assign({}, t, patch) : t);
  saveLocal(d);
  return (d.walletTx || []).find((t) => t.id === id) || { id, userId, ...patch };
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
  const needle = String(q || '').trim().toLowerCase();
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

module.exports = {
  listMemories, addMemory, delMemory,
  listSecrets, addSecret, revealSecret, delSecret,
  supaConfigured,
  getSubscription, setSubscription, findUserByStripeCustomer,
  logUsage, usageTotal, creditsUsed, billingTotals, creditsForUsageUsd, creditsForGift,
  addGrant, grantsTotal, grantsTotalByReason, ensureFreeGrant, hasGrantRef,
  stripeEventSeen, markStripeEvent,
  createGift, findGiftByFrom, redeemGift, giftsCredit, requestUpgrade,
  logToolRun,
  saveTurn, searchTurns, listChatMessages, listAutomationChats,
  listSubAgents, getSubAgent, createSubAgent, updateSubAgent, deleteSubAgent,
  listDueSubAgents, markSubAgentRun, beginAutomationRun, finishAutomationRun, listAutomationRuns,
  getAgentWallet, upsertAgentWallet, listWalletTx, addWalletTx, reserveWalletSpend, updateWalletTx,
  getMailboxByUser, getMailboxByAddress, mailLocalPartTaken, upsertMailbox,
  listMailMessages, getMailMessage, getMailMessageByResendId, insertMailMessage, updateMailMessage,
  countUnreadMail, countOutboundMailToday, listMailDrafts, upsertMailDraft, deleteMailDraft,
  CREDIT_GRANT_FREE,
};
