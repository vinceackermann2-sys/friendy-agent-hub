/* Belna <-> Privy agent wallet + attached card (server-side only).
   App secret never leaves this process. Private keys stay in Privy TEEs.
   Card issuing is licensed through Privy → Bridge + Stripe Issuing.
   The agent may read status; every spend requires the owner's approval. */
import crypto from 'node:crypto';
import * as store from './store.js';

const PRIVY_API = 'https://api.privy.io';
const ETH_ADDR = /^0x[a-fA-F0-9]{40}$/;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MAX_USDC_TX = 500;
const MAX_ETH_TX = 0.05;
const DEFAULT_DAILY_USDC = 50;

function env(name, fallback = '') {
  return String(process.env[name] || process.env['LINGON_' + name] || fallback).trim();
}
function appId() { return env('PRIVY_APP_ID'); }
function appSecret() { return env('PRIVY_APP_SECRET'); }
function configured() { return appId().length > 8 && appSecret().length > 8; }
function cardsReady() { return configured() && env('BRIDGE_API_KEY').length > 8; }
function chainName() { return env('PRIVY_WALLET_CHAIN', 'base') || 'base'; }
function caip2() { return env('PRIVY_WALLET_CAIP2', 'eip155:8453') || 'eip155:8453'; }
function usdcAddress() { return env('PRIVY_USDC_ADDRESS', USDC_BASE) || USDC_BASE; }

function externalIdFor(userId) {
  const id = String(userId || '').trim();
  if (!id) {
    const e = new Error('Signed-in user required for an agent wallet.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  return ('b_' + crypto.createHash('sha256').update(id).digest('hex').slice(0, 40));
}

function ownsRemote(userId, remote) {
  if (!remote || typeof remote !== 'object') return false;
  const ext = externalIdFor(userId);
  if (remote.external_id && String(remote.external_id) !== ext) return false;
  return true;
}

function publicCard(card) {
  const c = card && typeof card === 'object' ? card : {};
  return {
    status: c.status || 'none',
    last4: c.last4 ? String(c.last4).replace(/\D/g, '').slice(-4) : null,
    brand: c.brand || 'visa',
    network: c.network || 'visa',
    expMonth: c.expMonth || null,
    expYear: c.expYear || null,
    holderName: c.holderName || null,
    requestedAt: c.requestedAt || null,
    issuedAt: c.issuedAt || null,
  };
}

function publicWallet(row, extra = {}) {
  const daily = Number(row && row.dailyLimitUsd != null ? row.dailyLimitUsd : DEFAULT_DAILY_USDC);
  const spent = Number(extra.spentTodayUsd || 0);
  return {
    configured: configured(),
    cardsReady: cardsReady(),
    address: row && row.address ? row.address : null,
    chain: (row && row.chain) || chainName(),
    walletId: row && row.privyWalletId ? row.privyWalletId : null,
    balances: Array.isArray(extra.balances) ? extra.balances : [],
    card: publicCard(row && row.card),
    dailyLimitUsd: daily,
    spentTodayUsd: spent,
    remainingTodayUsd: Math.max(0, Math.round((daily - spent) * 100) / 100),
    activity: Array.isArray(extra.activity) ? extra.activity : [],
    custody: 'privy-tee',
    isolated: true,
    ownerUserId: row && row.userId ? row.userId : null,
    externalId: row && row.externalId ? row.externalId : null,
    purchases: publicPurchases(row && row.envelopes),
  };
}

function publicPurchases(list) {
  const now = Date.now();
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && (e.status === 'authorized' || e.status === 'used') && (!e.exp || e.exp > now - 86400e3))
    .slice(0, 8)
    .map((e) => ({
      id: e.id,
      merchant: e.merchant,
      amount: e.amount,
      method: e.method || 'card',
      kind: e.kind || 'one_time_spend',
      last4: e.last4 || null,
      status: e.status,
      reason: e.reason || null,
      exp: e.exp || null,
      at: e.at || null,
    }));
}

async function pfetch(path, { method = 'GET', body, idempotency } = {}) {
  if (!configured()) {
    const e = new Error('Agent wallet is not configured (PRIVY_APP_ID / PRIVY_APP_SECRET).');
    e.code = 'NO_PRIVY';
    throw e;
  }
  const token = Buffer.from(appId() + ':' + appSecret()).toString('base64');
  const headers = {
    Authorization: 'Basic ' + token,
    'privy-app-id': appId(),
    'Content-Type': 'application/json',
  };
  if (idempotency) headers['privy-idempotency-key'] = String(idempotency).slice(0, 64);
  const r = await fetch(PRIVY_API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!r.ok) {
    const msg = (json && (json.error || json.message)) || ('Privy HTTP ' + r.status);
    const e = new Error(String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 400));
    e.code = r.status === 404 ? 'NOT_FOUND' : 'PRIVY_HTTP';
    e.status = r.status;
    throw e;
  }
  return json;
}

function pad64(hex) {
  return String(hex || '').replace(/^0x/i, '').toLowerCase().padStart(64, '0');
}
function toRaw(amount, decimals) {
  const n = String(amount || '').trim();
  if (!/^\d+(\.\d+)?$/.test(n)) {
    const e = new Error('Amount must be a positive number.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const [w, f = ''] = n.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(w || '0') * (10n ** BigInt(decimals)) + BigInt(frac || '0');
}
function toHex(bi) { return '0x' + BigInt(bi).toString(16); }
function encodeErc20Transfer(to, amountRaw) {
  return '0x' + 'a9059cbb' + pad64(to) + pad64(toHex(amountRaw));
}

async function lookupWallet(userId) {
  const ext = externalIdFor(userId);
  try {
    return await pfetch('/v1/wallets/ext_wal_' + encodeURIComponent(ext));
  } catch (e) {
    if (e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

async function createWallet(userId) {
  return pfetch('/v1/wallets', {
    method: 'POST',
    idempotency: 'wal_' + externalIdFor(userId),
    body: {
      chain_type: 'ethereum',
      external_id: externalIdFor(userId),
      display_name: 'Belna agent ' + externalIdFor(userId).slice(0, 12),
    },
  });
}

function rowFromPrivy(userId, w, prev) {
  return {
    userId,
    privyWalletId: w.id || (prev && prev.privyWalletId) || null,
    address: w.address || (prev && prev.address) || null,
    chain: chainName(),
    externalId: externalIdFor(userId),
    card: Object.assign({ status: 'none', ownerUserId: userId }, (prev && prev.card) || {}, { ownerUserId: userId }),
    dailyLimitUsd: prev && prev.dailyLimitUsd != null ? prev.dailyLimitUsd : DEFAULT_DAILY_USDC,
    createdAt: (prev && prev.createdAt) || Date.now(),
  };
}

async function ensureWallet(userId) {
  if (!userId) {
    const e = new Error('Signed-in user required for an agent wallet.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const prev = await store.getAgentWallet(userId);
  if (prev && prev.userId && prev.userId !== userId) {
    const e = new Error('Wallet does not belong to this account.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  if (!configured()) {
    if (prev && prev.address && prev.userId === userId) return prev;
    const e = new Error('Agent wallet is not configured (PRIVY_APP_ID / PRIVY_APP_SECRET).');
    e.code = 'NO_PRIVY';
    throw e;
  }
  let remote = null;
  if (prev && prev.privyWalletId) {
    try {
      const found = await pfetch('/v1/wallets/' + encodeURIComponent(prev.privyWalletId));
      if (ownsRemote(userId, found)) remote = found;
    } catch {}
  }
  if (!remote) remote = await lookupWallet(userId);
  if (remote && !ownsRemote(userId, remote)) remote = null;
  if (!remote) remote = await createWallet(userId);
  if (!ownsRemote(userId, remote)) {
    const e = new Error('Wallet does not belong to this account.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  const row = rowFromPrivy(userId, remote, prev);
  return store.upsertAgentWallet(userId, row);
}

async function fetchBalances(walletId) {
  if (!walletId) return [];
  const out = [];
  try {
    const eth = await pfetch('/v1/wallets/' + encodeURIComponent(walletId) + '/balance?asset=eth&chain=' + encodeURIComponent(chainName()) + '&include_currency=usd');
    (eth.balances || []).forEach((b) => out.push({
      asset: 'eth',
      chain: b.chain || chainName(),
      amount: (b.display_values && (b.display_values.eth || b.display_values.token)) || '0',
      usd: b.display_values && b.display_values.usd ? b.display_values.usd : null,
    }));
  } catch {}
  try {
    const usdc = await pfetch('/v1/wallets/' + encodeURIComponent(walletId) + '/balance?asset=usdc&chain=' + encodeURIComponent(chainName()) + '&include_currency=usd');
    (usdc.balances || []).forEach((b) => out.push({
      asset: 'usdc',
      chain: b.chain || chainName(),
      amount: (b.display_values && (b.display_values.usdc || b.display_values.token)) || '0',
      usd: b.display_values && b.display_values.usd ? b.display_values.usd : null,
    }));
  } catch {}
  return out;
}

function startOfUtcDay(ts) {
  const d = new Date(ts || Date.now());
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function spentTodayUsd(userId) {
  const rows = await store.listWalletTx(userId, 80);
  const start = startOfUtcDay();
  return rows
    .filter((t) => t.at >= start && ['usdc', 'usd'].includes(t.asset) && ['sent', 'pending', 'issued', 'authorized'].includes(t.status))
    .reduce((n, t) => n + Number(t.amount || 0), 0);
}

function publicActivity(rows) {
  return (rows || []).slice(0, 12).map((t) => ({
    id: t.id,
    kind: t.kind,
    asset: t.asset,
    amount: t.amount,
    to: t.to ? String(t.to).slice(0, 6) + '…' + String(t.to).slice(-4) : null,
    status: t.status,
    hash: t.hash || null,
    at: t.at,
  }));
}

async function snapshot(userId, { ensure = false } = {}) {
  let row = ensure && configured() ? await ensureWallet(userId) : await store.getAgentWallet(userId);
  const activity = publicActivity(await store.listWalletTx(userId, 12));
  const spent = await spentTodayUsd(userId);
  let balances = [];
  if (row && row.privyWalletId && configured()) {
    try { balances = await fetchBalances(row.privyWalletId); } catch {}
  }
  return publicWallet(row, { balances, activity, spentTodayUsd: spent });
}

function assertAddress(to) {
  if (!ETH_ADDR.test(String(to || ''))) {
    const e = new Error('Destination must be a valid 0x address.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  return String(to);
}

async function transfer(userId, { to, amount, asset, confirm }) {
  if (!confirm) {
    const e = new Error('Owner confirmation is required before any spend.');
    e.code = 'NEED_CONFIRM';
    throw e;
  }
  const row = await ensureWallet(userId);
  if (row.userId && row.userId !== userId) {
    const e = new Error('Wallet does not belong to this account.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  if (!row || !row.privyWalletId || !row.address) {
    const e = new Error('Create the agent wallet first.');
    e.code = 'NO_WALLET';
    throw e;
  }
  const dest = assertAddress(to);
  if (dest.toLowerCase() === String(row.address).toLowerCase()) {
    const e = new Error('Cannot send to the same wallet.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const kind = String(asset || 'usdc').toLowerCase() === 'eth' ? 'eth' : 'usdc';
  const n = Number(amount);
  if (!(n > 0) || !isFinite(n)) {
    const e = new Error('Amount must be greater than zero.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (kind === 'eth' && n > MAX_ETH_TX) {
    const e = new Error('ETH transfers are capped at ' + MAX_ETH_TX + ' per payment.');
    e.code = 'LIMIT';
    throw e;
  }
  if (kind === 'usdc') {
    if (n > MAX_USDC_TX) {
      const e = new Error('USDC transfers are capped at $' + MAX_USDC_TX + ' per payment.');
      e.code = 'LIMIT';
      throw e;
    }
    const left = Number((row.dailyLimitUsd != null ? row.dailyLimitUsd : DEFAULT_DAILY_USDC)) - await spentTodayUsd(userId);
    if (n > left + 1e-9) {
      const e = new Error('That would exceed today’s remaining spend limit ($' + Math.max(0, left).toFixed(2) + ').');
      e.code = 'LIMIT';
      throw e;
    }
  }
  const tx = kind === 'usdc' ? await store.reserveWalletSpend(userId, {
    kind: 'transfer',
    asset: kind,
    amount: n,
    to: dest,
    status: 'pending',
  }, row.dailyLimitUsd != null ? row.dailyLimitUsd : DEFAULT_DAILY_USDC) : await store.addWalletTx(userId, {
    kind: 'transfer', asset: kind, amount: n, to: dest, status: 'pending',
  });
  let hash = null;
  try {
    const rpcBody = kind === 'eth'
      ? {
          method: 'eth_sendTransaction',
          caip2: caip2(),
          sponsor: true,
          params: { transaction: { to: dest, value: toHex(toRaw(n, 18)) } },
        }
      : {
          method: 'eth_sendTransaction',
          caip2: caip2(),
          sponsor: true,
          params: { transaction: { to: usdcAddress(), value: '0x0', data: encodeErc20Transfer(dest, toRaw(n, 6)) } },
        };
    const sent = await pfetch('/v1/wallets/' + encodeURIComponent(row.privyWalletId) + '/rpc', {
      method: 'POST',
      idempotency: tx.id,
      body: rpcBody,
    });
    hash = sent.hash || sent.data || (sent.transaction && sent.transaction.hash) || null;
    if (hash && typeof hash === 'object') hash = hash.hash || null;
    await store.updateWalletTx(userId, tx.id, { status: 'sent', hash: hash ? String(hash) : null });
  } catch (e) {
    await store.updateWalletTx(userId, tx.id, { status: 'failed', error: String(e.message || 'send failed').slice(0, 240) });
    throw e;
  }
  return { id: tx.id, status: 'sent', hash, to: dest, amount: n, asset: kind };
}

async function requestCard(userId, { holderName } = {}) {
  const row = await ensureWallet(userId);
  if (!row || !row.address) {
    const e = new Error('Create the agent wallet first.');
    e.code = 'NO_WALLET';
    throw e;
  }
  const card = Object.assign({}, row.card || {}, {
    status: cardsReady() ? 'pending_kyc' : 'pending',
    brand: 'visa',
    network: 'visa',
    holderName: String(holderName || '').slice(0, 80) || null,
    ownerUserId: userId,
    walletAddress: row.address,
    requestedAt: Date.now(),
  });
  const next = await store.upsertAgentWallet(userId, { card });
  return publicCard(next.card);
}

async function setDailyLimit(userId, usd) {
  const n = Number(usd);
  if (!(n >= 1) || n > 500 || !isFinite(n)) {
    const e = new Error('Daily limit must be between $1 and $500.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const row = await store.getAgentWallet(userId);
  if (!row) {
    const e = new Error('Create the agent wallet first.');
    e.code = 'NO_WALLET';
    throw e;
  }
  await store.upsertAgentWallet(userId, { dailyLimitUsd: Math.round(n * 100) / 100 });
  return snapshot(userId);
}

async function purchase(userId, { amount, merchant, reason, method, to, confirm }) {
  if (!confirm) {
    const e = new Error('Owner confirmation is required before any purchase.');
    e.code = 'NEED_CONFIRM';
    throw e;
  }
  let row;
  try { row = await ensureWallet(userId); }
  catch (e) {
    if (e.code === 'NO_PRIVY' && String(method || 'card').toLowerCase() !== 'wallet') {
      row = await store.getAgentWallet(userId) || await store.upsertAgentWallet(userId, { userId, card: { status: 'none' } });
    } else throw e;
  }
  if (!row || (row.userId && row.userId !== userId)) {
    const e = new Error('Wallet does not belong to this account.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  const n = Number(amount);
  const who = String(merchant || '').trim().slice(0, 80);
  const why = String(reason || '').trim().slice(0, 200);
  const via = String(method || 'card').toLowerCase() === 'wallet' ? 'wallet' : 'card';
  if (!(n > 0) || !isFinite(n) || n > MAX_USDC_TX) {
    const e = new Error('Purchase amount must be between $0.01 and $' + MAX_USDC_TX + '.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (!who) {
    const e = new Error('Merchant or payee name is required.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const left = Number(row.dailyLimitUsd != null ? row.dailyLimitUsd : DEFAULT_DAILY_USDC) - await spentTodayUsd(userId);
  if (n > left + 1e-9) {
    const e = new Error('That would exceed today’s remaining spend limit ($' + Math.max(0, left).toFixed(2) + ').');
    e.code = 'LIMIT';
    throw e;
  }
  if (via === 'wallet') {
    const sent = await transfer(userId, { to, amount: n, asset: 'usdc', confirm: true });
    return { status: sent.status, method: 'wallet', merchant: who, amount: n, hash: sent.hash };
  }
  const env = {
    id: 'buy_' + Date.now().toString(36),
    ownerUserId: userId,
    walletAddress: row.address,
    merchant: who,
    reason: why || null,
    amount: n,
    method: 'card',
    kind: 'one_time_card',
    status: 'authorized',
    last4: row.card && row.card.last4 ? row.card.last4 : null,
    stripeCardId: null,
    issuingError: null,
    at: Date.now(),
    exp: Date.now() + 24 * 3600e3,
  };
  const spendTx = await store.reserveWalletSpend(userId, {
    kind: 'purchase', asset: 'usd', amount: n, to: who, status: 'authorized',
  }, row.dailyLimitUsd != null ? row.dailyLimitUsd : DEFAULT_DAILY_USDC);
  const issuing = await import('./issuing.js');
  if (issuing.configured()) {
    try {
      const issued = await issuing.createOneTimeCard(userId, {
        amountUsd: n,
        merchant: who,
        purchaseId: env.id,
        name: (row.card && row.card.holderName) || null,
      });
      env.stripeCardId = issued.stripeCardId;
      env.last4 = issued.last4 || env.last4;
      env.brand = issued.brand;
    } catch (e) {
      env.issuingError = String(e.message || 'Issuing failed').slice(0, 240);
    }
  } else {
    env.issuingError = 'Add STRIPE_SECRET_KEY and enable Stripe Issuing to mint a real one-time virtual card.';
  }
  const envelopes = [env].concat(Array.isArray(row.envelopes) ? row.envelopes : []).slice(0, 20);
  await store.upsertAgentWallet(userId, { envelopes });
  if (env.stripeCardId) await store.updateWalletTx(userId, spendTx.id, { status: 'issued' });
  return {
    status: env.stripeCardId ? 'issued' : 'authorized',
    method: 'card',
    kind: 'one_time_card',
    merchant: who,
    amount: n,
    last4: env.last4,
    expiresAt: env.exp,
    cardNumberGivenToAgent: false,
    note: env.stripeCardId
      ? 'Stripe issued a one-time virtual card. The agent only sees last four. The owner can reveal digits in Wallet → Card.'
      : (env.issuingError || 'Spend pass saved. Enable Stripe Issuing to mint a real virtual card.'),
  };
}

async function saveCardBilling(userId, billing, holderName) {
  let row;
  try { row = await ensureWallet(userId); }
  catch (e) {
    if (e.code !== 'NO_PRIVY') throw e;
    row = await store.getAgentWallet(userId) || await store.upsertAgentWallet(userId, { userId, card: { status: 'none' } });
  }
  const card = Object.assign({}, row.card || {}, {
    holderName: String(holderName || (row.card && row.card.holderName) || '').slice(0, 80) || null,
    billing: {
      line1: String((billing || {}).line1 || '').slice(0, 120),
      city: String((billing || {}).city || '').slice(0, 80),
      state: String((billing || {}).state || '').slice(0, 40),
      postal: String((billing || {}).postal || (billing || {}).postal_code || '').slice(0, 20),
      country: String((billing || {}).country || 'US').slice(0, 2).toUpperCase(),
    },
  });
  await store.upsertAgentWallet(userId, { card });
  return snapshot(userId);
}

async function markPurchaseUsed(userId, cardId) {
  if (!userId || !cardId) return null;
  const row = await store.getAgentWallet(userId);
  if (!row) return null;
  const envelopes = (row.envelopes || []).map((e) => (e && e.stripeCardId === cardId ? Object.assign({}, e, { status: 'used' }) : e));
  await store.upsertAgentWallet(userId, { envelopes });
  try { const issuing = await import('./issuing.js'); await issuing.cancelCard(cardId); } catch {}
  return true;
}

function matchCardCharge(userId, { amount, merchant }, envelopes) {
  const n = Number(amount);
  const who = String(merchant || '').toLowerCase();
  const now = Date.now();
  return (envelopes || []).find((e) =>
    e && e.ownerUserId === userId && e.method === 'card' && e.status === 'authorized'
    && e.exp > now && Number(e.amount) + 0.05 >= n && String(e.merchant || '').toLowerCase().includes(who.slice(0, 24))
  ) || null;
}

async function agentStatus(userId) {
  const snap = await snapshot(userId, { ensure: false });
  return {
    address: snap.address,
    chain: snap.chain,
    balances: snap.balances,
    card: { status: snap.card.status, last4: snap.card.last4, brand: snap.card.brand },
    remainingTodayUsd: snap.remainingTodayUsd,
    dailyLimitUsd: snap.dailyLimitUsd,
    purchases: snap.purchases || [],
    ready: !!(snap.configured && snap.address),
  };
}

export {
  configured,
  cardsReady,
  publicWallet,
  publicCard,
  snapshot,
  ensureWallet,
  transfer,
  purchase,
  matchCardCharge,
  saveCardBilling,
  markPurchaseUsed,
  requestCard,
  setDailyLimit,
  agentStatus,
  ETH_ADDR,
  assertAddress,
  toRaw,
  encodeErc20Transfer,
  externalIdFor,
};
