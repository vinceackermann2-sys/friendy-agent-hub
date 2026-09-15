/* Lingon real backend — Express.
   Auth: Supabase JWT required on all stateful routes (user_id comes from the
   verified token, never from the client). Health + plans are public.
   Billing: Free $10 credit; Pro $30 (was $50) → $20 + $50 gift; Max $50
   (was $100) → $50 + $100 gift. No fake charges — upgrades are requests.
   Harness: NOT Codex API — our own Gemini tool boundary (see harness.js).
*/
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { callGemini, isConfigured, MODEL_DEFAULT } = require('./gemini');
const { realResearch } = require('./research');
const { hostAllowed } = require('./harness');
const { PLANS, costOf } = require('./plans');
const store = require('./store');
const { pubClient, adminClient, requireAuth } = require('./auth');

const app = express();
const PORT = Number(process.env.PORT || 8000);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---- safety headers ----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// ---- rate limit (in-memory, per IP) ----
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const k = (req.ip || 'ip') + ':' + (req.path || '');
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(k, arr);
    if (arr.length > max) return res.status(429).json({ error: 'Too many requests — slow down.' });
    next();
  };
}

// never log secrets/tokens/keys
function safeLog(...a) {
  const s = a.map(String).join(' ');
  if (/ghp_|github_pat_|sk-|AQ\.|sb_secret|sb_publishable|Bearer [A-Za-z0-9]/.test(s)) {
    console.log('[redacted]');
    return;
  }
  console.log(...a);
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gemini: isConfigured(),
    model: MODEL_DEFAULT,
    supabase: store.supaConfigured(),
    harness: 'gemini-custom (not Codex API)',
    plans: Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, price: p.price, was: p.was, credit: p.credit, gift: p.gift })),
    time: new Date().toISOString(),
  });
});

app.get('/api/plans', (req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

// ---------- auth (proxy so keys stay server-side) ----------
app.post('/api/auth/signup', rateLimit(10, 60000), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || String(password).length < 8) return res.status(400).json({ error: 'Valid email + 8-char password required.' });
    const admin = adminClient();
    const pub = pubClient();
    if (!admin || !pub) return res.status(500).json({ error: 'Auth not configured on server.' });
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email: String(email), password: String(password), email_confirm: true });
    if (cErr && !/already exists/i.test(cErr.message)) return res.status(400).json({ error: cErr.message });
    const { data, error } = await pub.auth.signInWithPassword({ email: String(email), password: String(password) });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: { id: data.user.id, email: data.user.email } });
  } catch (e) {
    res.status(500).json({ error: 'Signup failed: ' + e.message });
  }
});
app.post('/api/auth/signin', rateLimit(15, 60000), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const pub = pubClient();
    if (!pub) return res.status(500).json({ error: 'Auth not configured on server.' });
    const { data, error } = await pub.auth.signInWithPassword({ email: String(email || ''), password: String(password || '') });
    if (error) return res.status(401).json({ error: error.message });
    res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: { id: data.user.id, email: data.user.email } });
  } catch (e) {
    res.status(500).json({ error: 'Signin failed: ' + e.message });
  }
});
app.post('/api/auth/refresh', rateLimit(15, 60000), async (req, res) => {
  try {
    const { refresh_token } = req.body || {};
    const pub = pubClient();
    if (!pub) return res.status(500).json({ error: 'Auth not configured.' });
    const { data, error } = await pub.auth.refreshSession({ refresh_token });
    if (error) return res.status(401).json({ error: error.message });
    res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: { id: data.user.id, email: data.user.email } });
  } catch (e) {
    res.status(500).json({ error: 'Refresh failed: ' + e.message });
  }
});
app.get('/api/auth/me', async (req, res) => {
  const { getUserFromRequest } = require('./auth');
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in required.' });
  res.json({ user: { id: user.id, email: user.email } });
});

// ---------- billing ----------
async function billingFor(userId) {
  const sub = await store.getSubscription(userId);
  const plan = PLANS[sub.plan] || PLANS.free;
  const used = await store.usageTotal(userId);
  const gifts = await store.giftsCredit(userId);
  const total = plan.credit + gifts;
  return { plan: sub.plan, status: sub.status, credit: plan.credit, gifts, used, total, remaining: Math.max(0, total - used), plans: PLANS };
}
app.get('/api/billing', requireAuth(async (req, res) => {
  res.json(await billingFor(req.user.id));
}));
app.post('/api/billing/redeem', requireAuth(async (req, res) => {
  const r = await store.redeemGift(req.user.id, (req.body || {}).code);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, amount: r.amount, billing: await billingFor(req.user.id) });
}));
app.post('/api/billing/upgrade', requireAuth(async (req, res) => {
  const { plan } = req.body || {};
  if (!PLANS[plan] || plan === 'free') return res.status(400).json({ error: 'Choose pro or max.' });
  // Honest: no Stripe connected → record request, keep Free until paid.
  const r = await store.requestUpgrade(req.user.id, plan);
  res.json({ ok: true, status: 'requested', request: r.id, note: `Payments aren't connected yet — your ${PLANS[plan].name} request is recorded, no charge made. You stay on Free with your current credit.` });
}));
app.post('/api/gifts/create', requireAuth(async (req, res) => {
  // Admin/demo issuance: allowed but audited with from_user. Real customer gifts
  // are issued automatically after payment once Stripe is connected.
  const amount = Number((req.body || {}).amount || 0);
  if (![50, 100].includes(amount)) return res.status(400).json({ error: 'Gift amount must be 50 or 100.' });
  const g = await store.createGift(req.user.id, amount);
  res.json({ gift: { code: g.code, amount_usd: g.amount_usd }, note: 'Share this code — the redeemer gets API credit. redeem via Billing.' });
}));

async function checkCredit(userId) {
  const b = await billingFor(userId);
  if (b.remaining <= 0.0001) {
    const e = new Error(`API credit exhausted ($${b.used.toFixed(4)} used of $${b.total.toFixed(2)}). Upgrade or redeem a gift card under Billing.`);
    e.code = 'NO_CREDIT';
    throw e;
  }
  return b;
}

// ---------- chat (auth + credit enforced, usage logged) ----------
app.post('/api/chat', rateLimit(60, 60000), requireAuth(async (req, res) => {
  try {
    await checkCredit(req.user.id);
    const { prompt, history, agent, memories } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });
    if (String(prompt).length > 6000) return res.status(400).json({ error: 'prompt too long (6000 chars).' });
    const memTxt = Array.isArray(memories) && memories.length
      ? '\n\nWhat you remember about this user (use when relevant):\n' + memories.slice(0, 10).map((m) => `- ${m.text}`).join('\n')
      : '';
    const system = `You are ${agent?.name || 'Lingon'}, a personal AI agent (${agent?.pers || 'Playful'} style). Answer helpfully and concisely. You run with a sandboxed harness, a sealed vault (you only ever receive secret REFERENCES like sec_xxxx, never values), and approvals for sensitive actions. Never claim to have browsed, run code, or read email unless the harness trace shows it. Never invent vote counts, PR numbers, or inbox contents.${memTxt}`;
    const r = await callGemini({ prompt: String(prompt), system, history: history || [] });
    const cost = costOf(r.usage);
    await store.logUsage(req.user.id, { model: MODEL_DEFAULT, usage: r.usage, cost });
    res.json({ text: r.text, model: MODEL_DEFAULT, trace: [{ ic: 'spark', t: `gemini ${MODEL_DEFAULT} · $${cost.toFixed(5)}` }] });
  } catch (e) {
    if (e.code === 'NO_CREDIT') return res.status(402).json({ error: e.message, upgrade_required: true });
    if (e.code === 'NO_KEY') return res.status(500).json({ error: 'AI key missing on server.' });
    safeLog('[chat] error', e.message);
    res.status(502).json({ error: 'AI request failed: ' + e.message });
  }
}));

// ---------- build ----------
app.post('/api/build', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try {
    await checkCredit(req.user.id);
    const { brief, style, agent } = req.body || {};
    const system = 'You generate a complete, single dependency-free HTML file. Output ONLY the HTML (no markdown fences, no explanation). Keep it under 12KB, mobile-friendly, no external requests except Google Fonts.';
    const prompt = `Build a landing one-pager.\nStyle: ${style || 'Minimal & calm'}\nMade by agent: ${agent?.name || 'Lingon'}\nBrief: ${String(brief || 'A personal agent that researches, builds and remembers.').slice(0, 2000)}\nInclude: hero with headline + sub + CTA button, 3 feature bullets, footer. Inline <style> only.`;
    const r = await callGemini({ prompt, system });
    const cost = costOf(r.usage);
    await store.logUsage(req.user.id, { model: MODEL_DEFAULT, usage: r.usage, cost });
    let html = r.text.trim().replace(/^```html/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    if (!/<html/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Made by ${(agent?.name || 'Lingon')}</title></head><body>${html}</body></html>`;
    res.json({ html: html.slice(0, 60000) });
  } catch (e) {
    if (e.code === 'NO_CREDIT') return res.status(402).json({ error: e.message, upgrade_required: true });
    if (e.code === 'NO_KEY') return res.status(500).json({ error: 'AI key missing on server.' });
    res.status(502).json({ error: 'Build failed: ' + e.message });
  }
}));

// ---------- research ----------
app.post('/api/research', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try {
    await checkCredit(req.user.id);
    const { query } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query required' });
    const r = await realResearch(String(query));
    const cost = costOf(r.usage);
    if (cost > 0) await store.logUsage(req.user.id, { model: MODEL_DEFAULT, usage: r.usage, cost });
    res.json(r);
  } catch (e) {
    if (e.code === 'NO_CREDIT') return res.status(402).json({ error: e.message, upgrade_required: true });
    res.status(502).json({ error: 'Research failed: ' + e.message });
  }
}));

// ---------- GitHub (auth + approval handled client-side, PAT per-request) ----------
app.get('/api/github/prs', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    const token = (req.headers['x-github-token'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    // Authorization header carries the Supabase JWT (handled by requireAuth);
    // GitHub PAT comes via X-GitHub-Token only — never confused.
    const pat = (req.headers['x-github-token'] || '').trim();
    if (!pat) return res.status(401).json({ error: 'GitHub token required (paste a fine-grained PAT; sent per-request, never stored).' });
    if (!hostAllowed('https://api.github.com/')) return res.status(500).json({ error: 'host blocked' });
    const gh = async (url) => {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Lingon/1.0' } });
      if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 300)}`);
      return r.json();
    };
    const repos = await gh('https://api.github.com/user/repos?per_page=10&sort=updated');
    const prs = [];
    for (const repo of repos.slice(0, 5)) {
      try {
        const list = await gh(`https://api.github.com/repos/${repo.full_name}/pulls?state=open&per_page=5`);
        for (const pr of list) prs.push({ repo: repo.full_name, number: pr.number, title: pr.title, url: pr.html_url, user: pr.user?.login, created_at: pr.created_at, diff_url: pr.diff_url });
      } catch {}
    }
    res.json({ repos: repos.map((r) => r.full_name), prs, trace: [{ ic: 'git', t: `github_prs: ${repos.length} repos, ${prs.length} open PRs (read-only)` }] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

app.get('/api/github/diff', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    const pat = (req.headers['x-github-token'] || '').trim();
    const { repo, number } = req.query;
    if (!pat || !repo || !number) return res.status(400).json({ error: 'token + repo + number required' });
    const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
      headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github.diff', 'User-Agent': 'Lingon/1.0' },
    });
    res.json({ diff: (await r.text()).slice(0, 30000) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

// ---------- memories (auth-derived user) ----------
app.get('/api/memories', requireAuth(async (req, res) => {
  res.json({ memories: await store.listMemories(req.user.id) });
}));
app.post('/api/memories', requireAuth(async (req, res) => {
  const { text, src } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  res.json({ memory: await store.addMemory(req.user.id, String(text), String(src || 'chat')) });
}));
app.delete('/api/memories/:id', requireAuth(async (req, res) => {
  await store.delMemory(req.user.id, req.params.id);
  res.json({ ok: true });
}));

// ---------- vault secrets ----------
app.get('/api/secrets', requireAuth(async (req, res) => {
  res.json({ secrets: await store.listSecrets(req.user.id) });
}));
app.post('/api/secrets', requireAuth(async (req, res) => {
  const { name, value } = req.body || {};
  if (!name || !value) return res.status(400).json({ error: 'name + value required' });
  res.json({ secret: await store.addSecret(req.user.id, String(name).slice(0, 80), String(value).slice(0, 4000)) });
}));
app.post('/api/secrets/:id/reveal', requireAuth(async (req, res) => {
  const v = await store.revealSecret(req.user.id, req.params.id);
  if (!v) return res.status(404).json({ error: 'not found' });
  res.json({ value: v });
}));
app.delete('/api/secrets/:id', requireAuth(async (req, res) => {
  await store.delSecret(req.user.id, req.params.id);
  res.json({ ok: true });
}));

// ---------- static frontend ----------
const APP_DIR = path.join(__dirname, '..', 'app');
app.use(express.static(APP_DIR, { extensions: ['html'] }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(APP_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lingon real backend on http://localhost:${PORT}`);
  console.log(`- Gemini: ${isConfigured() ? 'configured (' + MODEL_DEFAULT + ')' : 'MISSING — set GEMINI_API_KEY in .env'}`);
  console.log(`- Supabase: ${store.supaConfigured() ? 'configured' : 'local JSON fallback (server/data.json)'}`);
});
