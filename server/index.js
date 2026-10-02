const { configureGoalWork } = require('./agents/goal-work');
/* Lingon real backend — Express.
   Auth: Supabase JWT required on all stateful routes (user_id comes from the
   verified token, never from the client). Health + plans are public.
   Billing: credits (1 credit = $0.50 face, margin built in — users never see
   raw API costs). Free: 20 starter credits. Pro $50/mo → 60 credits/mo.
   Max $100/mo → 100 credits/mo. Real Stripe subscriptions + webhooks;
   gift redeem adds credits.
   Harness: Microsoft Foundry Responses API + our own tool boundary.
*/
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { transcribeAudio, isConfigured, MODEL_DEFAULT, REASONING_EFFORT, TRANSCRIPTION_MODEL, IMAGE_MODEL } = require('./foundry');
const { PLANS, PRELANDER_OFFERS, CREDIT_PACKS, TOKEN_PACKS, GIFT_AMOUNTS, costOf, creditsForGiftUsd, REFERRAL_TOKENS_EACH } = require('./plans');
const store = require('./store');
const stripeMod = require('./stripe');
const { pubClient, adminClient, requireAuth } = require('./auth');
// Agents-API-shaped harness backed by Microsoft Foundry + extras
const Runner = require('./agents/runner');
const { checkPrompt } = require('./agents/guardrails');
const { entry } = require('./agents/tracing');
const { fetchAllowlisted } = require('./agents/sandbox');
const { normalizeSubAgent, nextRunAt } = require('./agents/triggers');
const Automations = require('./agents/automations');
const composio = require('./composio');
const connectors = require('./connectors');
const mail = require('./mail');
const shoppay = require('./shoppay');
const privateCheckout = require('./private-checkout-client').createPrivateCheckoutClient({exportCheckout:require('./agents/azure-vm').exportCheckout});
const belnaWallet = require('./belna-wallet').createBelnaWallet({ store,secureCheckout:privateCheckout.factory });
const { saveSupportSubmission } = require('./support');

const app = express();
const PORT = Number(process.env.PORT || 8000);
function requestSignal(req) {
  if (req.signal) return req.signal;
  const controller = new AbortController();
  if (req.aborted) controller.abort();
  else req.once?.('aborted', () => controller.abort());
  return controller.signal;
}
// Set BEHIND_PROXY=1 in production (Caddy/Nginx/Traefik in front) so req.ip,
// protocol and rate limiting see the real client instead of the proxy.
if (process.env.BEHIND_PROXY === '1') app.set('trust proxy', 1);
app.use(cors());
// Stripe webhook needs the RAW body for signature verification — register it
// before express.json() so the payload is untouched.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] || '';
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  const s = stripeMod.client();
  if (!s || !secret) return res.status(500).json({ error: 'Stripe webhook not configured.' });
  let event;
  try {
    event = s.webhooks.constructEvent(req.body, sig, secret);
  } catch (e) {
    return res.status(400).json({ error: 'Bad signature: ' + e.message });
  }
  try {
    if (await store.stripeEventSeen(event.id)) return res.json({ ok: true, dup: true });
    await handleStripeEvent(s, event);
    await store.markStripeEvent(event.id);
    res.json({ ok: true });
  } catch (e) {
    console.warn('[stripe] webhook handler failed:', e.message);
    res.status(500).json({ error: 'Handler failed: ' + e.message });
  }
});
app.post('/api/mail/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const result = await mail.ingestWebhook(req.body, req.headers);
    res.json(result);
  } catch (e) {
    const code = e.code === 'BAD_SIGNATURE' ? 400 : 500;
    res.status(code).json({ error: e.message });
  }
});
app.post('/api/composio/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  try {
    const event = await composio.parseWebhook(req.body, req.headers);
    if (event.type && event.type !== 'composio.trigger.message') return res.json({ ok: true, matched: 0 });
    if (!event.toolkit || !event.trigger) return res.json({ ok: true, matched: 0 });
    const results = await Automations.dispatchAppEvent(event.ownerId, {
      type: 'app', app: event.toolkit, event: event.trigger, connectedAccountId:event.connectedAccountId, eventId:event.id, payload: event.payload,
    });
    res.json({ ok: true, matched: results.length });
  } catch (e) {
    const status = e.code === 'BAD_SIGNATURE' ? 401 : e.code === 'BAD_INPUT' ? 400 : 500;
    res.status(status).json({ error: status === 500 ? 'Webhook handler failed.' : e.message });
  }
});
app.use((req, res, next) => {
  if ((req.method === 'POST' && (req.path === '/api/voice/transcribe' || req.path === '/api/chat' || req.path === '/api/chat/stream' || req.path === '/api/agent/conversation' || req.path === '/api/library' || req.path === '/api/support/submissions')) || (req.method === 'PUT' && req.path.startsWith('/api/client-state/')) || (req.method==='PATCH' && req.path.startsWith('/api/library/'))) {
    const limit=['/api/chat','/api/chat/stream','/api/agent/conversation'].includes(req.path)?'72mb':req.path.startsWith('/api/library')?'15mb':'12mb';
    return express.json({ limit })(req, res, next);
  }
  next();
});
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

const azure = require('./agents/azure-vm');
const vmHarness = require('./agents/vm-harness');
const conversation = require('./agents/conversation');
app.post('/api/internal/tasks-tick', rateLimit(120, 60000), async (req, res) => {
  if (!(await azure.verifySweepToken(req.headers.authorization))) return res.status(401).json({ error:'Unauthorized.' });
  try { res.json(await conversation.tasks.tick({drain:true})); } catch { res.status(503).json({ error:'Task worker unavailable.' }); }
});
app.post('/api/internal/automations-tick', rateLimit(120, 60000), async (req,res)=>{
  if (!(await azure.verifySweepToken(req.headers.authorization))) return res.status(401).json({ error:'Unauthorized.' });
  try { await Automations.tick(); res.json({ok:true}); } catch { res.status(503).json({ error:'Automation worker unavailable.' }); }
});
app.use('/api/agent/conversation', rateLimit(120, 60000), requireAuth(conversation.handle));
app.use('/api/agent/tasks', rateLimit(240, 60000), requireAuth(conversation.handle));
app.post('/api/internal/vm-sweep', rateLimit(10, 60000), async (req, res) => {
  if (!(await azure.verifySweepToken(req.headers.authorization))) return res.status(401).json({ error: 'Unauthorized.' });
  try { return res.json({ ok: true, ...(await azure.sweepLeases({ limit: 20 })) }); }
  catch { return res.status(502).json({ error: 'VM sweep failed.' }); }
});
app.use('/api/agent', rateLimit(120, 60000), requireAuth(vmHarness.handle));
app.use('/api/sandbox', rateLimit(30, 60000), requireAuth(vmHarness.handle));
app.post('/api/chat', rateLimit(60, 60000), requireAuth(vmHarness.handle));
app.post('/api/chat/stream', rateLimit(60, 60000), requireAuth(vmHarness.handle));
app.post('/api/voice/transcribe', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try {
    await Runner.ensureCredit(req.user.id);
    const sub = await store.getSubscription(req.user.id);
    const paid = ['active','canceling','trialing'].includes(sub.status)
      && (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now());
    const plan = paid && PLANS[sub.plan] ? sub.plan : 'free';
    const claimId = await store.claimTokenDaily(req.user.id, 'transcription', PLANS[plan].transcriptionsPerDay);
    if (!claimId) throw Object.assign(new Error('Your daily transcription limit is used up.'), { code: 'NO_CREDIT' });
    let out;
    try { out = await transcribeAudio({ audio: req.body?.audio, mime: req.body?.mime, signal: requestSignal(req) }); }
    catch (error) { await store.releaseTokenDaily(req.user.id, claimId); throw error; }
    await store.logUsage(req.user.id, { model: out.model, usage: out.usage, cost: out.costUsd,
      usageEstimated: out.usageEstimated, claimId });
    res.json({ text: out.text || '' });
  } catch (e) {
    const status = e.code === 'NO_CREDIT' ? 402 : e.code === 'BAD_INPUT' ? 400 : e.code === 'NO_KEY' ? 503 : 502;
    res.status(status).json({ error: e.code === 'BAD_INPUT' || e.code === 'NO_CREDIT' ? e.message : 'Couldn’t transcribe that.' });
  }
}));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    foundry: isConfigured(),
    model: MODEL_DEFAULT,
    reasoningEffort: REASONING_EFFORT,
    transcriptionModel: TRANSCRIPTION_MODEL,
    imageModel: IMAGE_MODEL,
    azure: azure.isAzureConfigured(),
    durableVmLeases: azure.isLeaseStoreConfigured(),
    supabase: store.supaConfigured(),
    google: googleConfigured(),
    composio: composio.configured(),
    shopPay: shoppay.configured(),
    resend: mail.configured(),
    mailDomain: mail.mailDomain(),
    harness: 'foundry-azure-vm-harness',
    sandbox: azure.isAzureConfigured() ? 'azure-vm-per-user' : 'local-per-user-fallback',
    plans: Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, price: p.price, was: p.was, tokens: p.tokens, imagesPerDay: p.imagesPerDay, transcriptionsPerDay: p.transcriptionsPerDay, giftUsd: p.giftUsd, interval: p.interval })),
    prelander: PRELANDER_OFFERS,
    creditPacks: CREDIT_PACKS,
    giftAmounts: GIFT_AMOUNTS,
    stripe: stripeMod.isConfigured(),
    time: new Date().toISOString(),
  });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ google: googleConfigured() });
});

app.get('/api/plans', (req, res) => {
  res.json({ plans: Object.values(PLANS), prelander: PRELANDER_OFFERS, creditPacks: CREDIT_PACKS, giftAmounts: GIFT_AMOUNTS, referral: { eachTokens: REFERRAL_TOKENS_EACH, maxRedemptions: 1 } });
});

app.post('/api/support/submissions', rateLimit(5, 60000), requireAuth(async (req, res) => {
  const admin = adminClient();
  if (!admin) return res.status(503).json({ error:'Support submissions are temporarily unavailable.' });
  try {
    res.status(201).json(await saveSupportSubmission(admin, req.user, req.body));
  } catch (error) {
    if (error.code === 'BAD_INPUT') return res.status(400).json({ error:error.message });
    console.error('[support] submission failed:', error);
    res.status(503).json({ error:'Could not save your submission. Please try again.' });
  }
}));

// Public withdrawal function for eligible online purchases. A request is a notice,
// not an automatic refund; staff can review eligibility from the saved record.
app.post('/api/legal/withdrawal', rateLimit(5, 60000), async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const purchaseReference = String(req.body?.purchase_reference || '').trim();
    const purchaseKind = String(req.body?.purchase_kind || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254
      || !purchaseReference || purchaseReference.length > 160
      || !['subscription', 'token_pack', 'other'].includes(purchaseKind)) {
      return res.status(400).json({ error: 'Enter a valid email, purchase type and purchase reference.' });
    }
    const admin = adminClient();
    if (!admin) return res.status(503).json({ error: 'Withdrawal requests are temporarily unavailable. Please email hej@belna.se.' });
    const { data, error } = await admin.from('withdrawal_requests')
      .insert({ email, purchase_reference: purchaseReference, purchase_kind: purchaseKind })
      .select('id,received_at').single();
    if (error || !data) return res.status(503).json({ error: 'Could not save your request. Please email hej@belna.se.' });
    let emailSent = false;
    const resendKey = String(process.env.RESEND_API_KEY || '').trim();
    if (resendKey) {
      const receipt = 'Belna withdrawal request received\n\n'
        + 'Receipt: ' + data.id + '\n'
        + 'Received (UTC): ' + data.received_at + '\n'
        + 'Purchase type: ' + purchaseKind + '\n'
        + 'Purchase reference: ' + purchaseReference + '\n'
        + 'Account email: ' + email + '\n\n'
        + 'This confirms receipt of your withdrawal notice. Eligibility and any refund will be reviewed under applicable law. Contact hej@belna.se with this receipt if needed.';
      try {
        const sent = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: String(process.env.LEGAL_EMAIL_FROM || 'Belna <legal@mail.belna.se>'),
            to: [email],
            subject: 'Belna withdrawal request received',
            text: receipt,
          }),
        });
        emailSent = sent.ok;
        if (emailSent) await admin.from('withdrawal_requests').update({ receipt_sent_at: new Date().toISOString() }).eq('id', data.id);
      } catch (sendError) {
        console.error('Withdrawal receipt email failed:', sendError);
      }
    }
    res.status(202).json({ id: data.id, received_at: data.received_at, purchase_kind: purchaseKind, purchase_reference: purchaseReference, email, email_sent: emailSent });
  } catch (error) {
    console.error('Withdrawal request failed:', error);
    res.status(503).json({ error: 'Could not save your request. Please email hej@belna.se.' });
  }
});

// ---------- auth (proxy so keys stay server-side) ----------
const TERMS_VERSION = '2026-09-24';
const termsAccepted = (value) => value === TERMS_VERSION;
app.post('/api/auth/signup', rateLimit(10, 60000), async (req, res) => {
  try {
    const { email, password, terms_version } = req.body || {};
    if (!termsAccepted(terms_version)) return res.status(400).json({ error: 'Please accept the current Terms of Service and acknowledge the Privacy Policy.' });
    if (!email || !password || String(password).length < 8) return res.status(400).json({ error: 'Valid email + 8-char password required.' });
    const admin = adminClient();
    const pub = pubClient();
    if (!admin || !pub) return res.status(500).json({ error: 'Auth not configured on server.' });
    // SECURITY: never auto-confirm emails on public sign-up. A normal sign-up
    // requires the user to prove control of the address before it is trusted.
    const { data, error } = await pub.auth.signUp({ email: String(email), password: String(password), options: { data: { terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() } } });
    if (error) return res.status(400).json({ error: error.message });
    if (!data.session || !data.user) return res.json({ ok: true, confirm_email: true, message: 'Check your inbox to confirm your email, then sign in.' });
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
// ---------- Google sign-in via our OWN OAuth bridge ----------
// The browser only ever sees belna.se + accounts.google.com — no third-party
// hosted auth pages. Google verifies the email; we then bridge it into an app
// session server-side (generateLink + verifyOtp), so billing, vault, memories
// and RLS keep working unchanged.
const OAUTH_STATE = new Map(); // state -> { next, redirectUri, exp }
function googleEnv(name) {
  return String(process.env[name] || process.env['LINGON_' + name] || '').trim();
}
function googleConfigured() {
  return !!(googleEnv('GOOGLE_CLIENT_ID') && googleEnv('GOOGLE_CLIENT_SECRET'));
}
function siteOrigin(req) {
  const env = googleEnv('SITE_URL').replace(/\/$/, '');
  if (env) return env;
  if (req.headers.origin) return String(req.headers.origin).replace(/\/$/, '');
  const host = (req.get && req.get('host')) || req.headers.host || '';
  if (host) return ((req.protocol || 'https') + '://' + host).replace(/\/$/, '');
  return '';
}
function safeNext(n) {
  const s = String(n || '/');
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}
function pruneOAuthState() {
  if (OAUTH_STATE.size <= 500) return;
  const now = Date.now();
  for (const [k, v] of OAUTH_STATE) if (v.exp < now) OAUTH_STATE.delete(k);
}
app.get('/api/auth/oauth-url', rateLimit(15, 60000), async (req, res) => {
  try {
    if (!termsAccepted(req.query.terms_version)) return res.status(400).json({ error: 'Please accept the current Terms of Service and acknowledge the Privacy Policy.' });
    const provider = String(req.query.provider || 'google');
    if (provider !== 'google') return res.status(400).json({ error: 'Unsupported provider.' });
    const clientId = googleEnv('GOOGLE_CLIENT_ID');
    if (!clientId) return res.status(500).json({ error: 'Google sign-in is not configured.' });
    const crypto = require('crypto');
    const state = crypto.randomBytes(32).toString('hex');
    const redirectUri = siteOrigin(req) + '/api/auth/google/callback';
    OAUTH_STATE.set(state, { next: safeNext(req.query.next), redirectUri, termsVersion: TERMS_VERSION, exp: Date.now() + 10 * 60e3 });
    pruneOAuthState();
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    }).toString();
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'OAuth failed: ' + e.message });
  }
});
app.get('/api/auth/google/callback', rateLimit(15, 60000), async (req, res) => {
  const back = (msg) => res.redirect('/?auth_error=' + encodeURIComponent(msg || 'Sign-in failed'));
  try {
    const { code, state, error } = req.query;
    if (error) return back(req.query.error_description || error || 'Sign-in cancelled.');
    const saved = state ? OAUTH_STATE.get(String(state)) : null;
    if (state) OAUTH_STATE.delete(String(state)); // one-time use (CSRF protection)
    if (!code || !saved || saved.exp < Date.now()) return back('Sign-in expired — please try again.');
    const clientId = googleEnv('GOOGLE_CLIENT_ID');
    const clientSecret = googleEnv('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) return back('Google sign-in is not configured.');
    // code -> tokens, server to server (secret never touches the browser)
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: saved.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tj = await tok.json().catch(() => ({}));
    if (!tok.ok || !tj.access_token) return back((tj && (tj.error_description || tj.error)) || 'Google token exchange failed.');
    const me = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + tj.access_token },
    });
    const prof = await me.json().catch(() => ({}));
    const email = String((prof && prof.email) || '').toLowerCase();
    if (!me.ok || !email || (prof && prof.email_verified === false)) return back('Google did not verify an email address.');
    // bridge the Google-verified email into an app session (same account as password/OTP)
    const admin = adminClient();
    const pub = pubClient();
    if (!admin || !pub) return back('Auth not configured on server.');
    const name = String((prof && prof.name) || email.split('@')[0]);
    const created = await admin.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: { name, provider: 'google', google_sub: prof && prof.sub, terms_version: saved.termsVersion, terms_accepted_at: new Date().toISOString() },
    });
    if (created.error && !/already exists|already been registered/i.test(created.error.message || '')) return back(created.error.message);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const otp = link.data && link.data.properties && link.data.properties.email_otp;
    if (link.error || !otp) return back((link.error && link.error.message) || 'Could not start session.');
    const sess = await pub.auth.verifyOtp({ email, token: otp, type: 'magiclink' });
    if (sess.error || !sess.data.session) return back((sess.error && sess.error.message) || 'Could not complete sign-in.');
    const frag = '#access_token=' + encodeURIComponent(sess.data.session.access_token)
      + '&refresh_token=' + encodeURIComponent(sess.data.session.refresh_token || '');
    res.redirect(saved.next.split('#')[0].split('?')[0] + frag);
  } catch (e) {
    return back(e.message);
  }
});
// Email one-time code (passwordless)
app.post('/api/auth/otp', rateLimit(10, 60000), async (req, res) => {
  try {
    const { email, terms_version } = req.body || {};
    if (!termsAccepted(terms_version)) return res.status(400).json({ error: 'Please accept the current Terms of Service and acknowledge the Privacy Policy.' });
    if (!email || !/.+@.+\..+/.test(String(email))) return res.status(400).json({ error: 'Enter a valid email.' });
    const pub = pubClient();
    if (!pub) return res.status(500).json({ error: 'Auth not configured on server.' });
    const { error } = await pub.auth.signInWithOtp({ email: String(email), options: { data: { terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() } } });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not send code: ' + e.message });
  }
});
app.post('/api/auth/verify', rateLimit(10, 60000), async (req, res) => {
  try {
    const { email, token } = req.body || {};
    const pub = pubClient();
    if (!pub) return res.status(500).json({ error: 'Auth not configured on server.' });
    const { data, error } = await pub.auth.verifyOtp({ email: String(email || ''), token: String(token || '').trim(), type: 'email' });
    if (error || !data.session) return res.status(400).json({ error: (error && error.message) || 'Invalid or expired code.' });
    res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: { id: data.user.id, email: data.user.email } });
  } catch (e) {
    res.status(500).json({ error: 'Verify failed: ' + e.message });
  }
});

// ---------- billing: raw token allowances and legacy credit history ----------
async function billingFor(userId) {
  const subPromise = store.getSubscription(userId);
  await store.ensureFreeGrant(userId);
  const [sub, totals, purchasedGifts] = await Promise.all([subPromise, store.billingTotals(userId), store.listPurchasedGifts(userId)]);
  const plan = PLANS[sub.plan] || PLANS.free;
  // Backfill: gift codes redeemed before the credit ledger existed granted no
  // credits — top them up once at face value (2 credits per $1).
  try {
    const expected = creditsForGiftUsd(totals.giftsUsd);
    if (expected > totals.giftGranted + 1e-9) {
      const difference = expected - totals.giftGranted;
      await store.addGrant(userId, difference, 'gift_redeem', 'backfill:legacy');
      totals.granted += difference;
    }
  } catch {}
  const granted = totals.granted;
  const usedCredits = totals.used;
  const giftsRedeemedUsd = totals.giftsUsd;
  const total = granted;
  const remaining = Math.max(0, total - usedCredits);
  const paid = ['active','canceling','trialing'].includes(sub.status)
    && (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now());
  const effectivePlan = paid && PLANS[sub.plan] ? sub.plan : 'free';
  const wallet = await store.getTokenWallet(userId, effectivePlan, sub.current_period_end);
  return {
    plan: effectivePlan, status: sub.status,
    tokens: wallet.remaining, tokensGranted: wallet.granted, tokensUsed: wallet.used,
    planTokens: wallet.planGranted, planTokensUsed: wallet.planUsed,
    packTokens: wallet.packGranted, packTokensUsed: wallet.packUsed,
    imagesToday: wallet.imagesToday, imagesPerDay: wallet.imagesPerDay,
    transcriptionsToday: wallet.transcriptionsToday, transcriptionsPerDay: wallet.transcriptionsPerDay,
    resetAt: wallet.resetAt,
    credits: Math.round(remaining * 100) / 100,
    creditsGranted: Math.round(total * 100) / 100,
    creditsUsed: Math.round(usedCredits * 100) / 100,
    giftsRedeemedUsd,
    purchasedGifts,
    currentPeriodEnd: sub.current_period_end || null,
    stripe: stripeMod.isConfigured(),
    plans: Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, price: p.price, was: p.was, tokens: p.tokens, imagesPerDay: p.imagesPerDay, transcriptionsPerDay: p.transcriptionsPerDay, giftUsd: p.giftUsd, interval: p.interval, blurb: p.blurb })),
    prelander: PRELANDER_OFFERS,
    creditPacks: CREDIT_PACKS,
    tokenPacks: TOKEN_PACKS,
    giftAmounts: GIFT_AMOUNTS,
    // Legacy dollar fields (kept for old clients, derived — not shown in UI):
    credit: plan.credits / 2, gifts: giftsRedeemedUsd, used: usedCredits / 2, total: total / 2, remaining: remaining / 2,
    plansLegacy: PLANS,
  };
}
app.get('/api/billing', requireAuth(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(await billingFor(req.user.id));
}));
app.post('/api/billing/redeem', requireAuth(async (req, res) => {
  const r = await store.redeemGift(req.user.id, (req.body || {}).code);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, amount: r.amount, credits: r.credits, tokens: r.tokens, billing: await billingFor(req.user.id) });
}));
// ---------- referrals: one friend per code, 10M tokens per account ----------
function referralLink(req, code) {
  const origin = (process.env.SITE_URL || 'https://belna.se').replace(/\/$/, '');
  return origin + '/app?ref=' + encodeURIComponent(code);
}
app.get('/api/referrals/mine', requireAuth(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const stats = await store.referralStats(req.user.id);
    res.json({ ok: true, code: stats.code, link: referralLink(req, stats.code), invited: stats.invited, earnedTokens: stats.earnedTokens, rewardEachTokens: stats.rewardEachTokens, maxRedemptions: 1 });
  } catch { res.status(503).json({ error: 'Referral service is unavailable.' }); }
}));
app.post('/api/referrals/redeem', requireAuth(async (req, res) => {
  try {
    const r = await store.redeemReferral(req.user.id, (req.body || {}).code);
    if (!r.ok) return res.status(400).json({ error: r.error });
    let billing = null;
    try { billing = await billingFor(req.user.id); } catch {}
    res.json({ ok: true, code: r.code, credits: r.credits, inviterCredits: r.inviterCredits,
      tokens: r.tokens, inviterTokens: r.inviterTokens, billing });
  } catch { res.status(503).json({ error: 'Referral service is unavailable.' }); }
}));
// Real Stripe Checkout: returns a hosted payment URL for a monthly subscription.
app.post('/api/billing/checkout', requireAuth(async (req, res) => {
  try {
    const { plan, extraCredits, extraTokens, promo } = req.body || {};
    const email = req.user.email || undefined;
    const session = await stripeMod.createCheckout({ userId: req.user.id, email, plan, extraCredits, extraTokens, promo, req });
    res.json({ ok: true, url: session.url });
  } catch (e) {
    const code = e.code === 'BAD_PLAN' ? 400 : e.code === 'NO_STRIPE' || e.code === 'NO_PRICE' ? 503 : 502;
    res.status(code).json({ error: e.message });
  }
}));
app.post('/api/billing/credits', requireAuth(async (req, res) => {
  try {
    const extraCredits = (req.body || {}).extraCredits || (req.body || {}).packCredits;
    const session = await stripeMod.createCreditsCheckout({ userId: req.user.id, email: req.user.email, packCredits: extraCredits, req });
    res.json({ ok: true, url: session.url });
  } catch (e) {
    const code = e.code === 'BAD_PLAN' ? 400 : e.code === 'NO_STRIPE' || e.code === 'NO_PRICE' ? 503 : 502;
    res.status(code).json({ error: e.message });
  }
}));
app.post('/api/billing/tokens', requireAuth(async (req, res) => {
  try {
    const session = await stripeMod.createTokenCheckout({ userId: req.user.id, email: req.user.email,
      packTokens: (req.body || {}).packTokens, req });
    res.json({ ok: true, url: session.url });
  } catch (e) {
    const code = e.code === 'BAD_PLAN' ? 400 : e.code === 'NO_STRIPE' || e.code === 'NO_PRICE' ? 503 : 502;
    res.status(code).json({ error: e.message });
  }
}));
app.post('/api/billing/gift', requireAuth(async (req, res) => {
  try {
    const session = await stripeMod.createGiftCheckout({ userId: req.user.id, email: req.user.email, amountUsd: (req.body || {}).amount, req });
    res.json({ ok: true, url: session.url });
  } catch (e) {
    const code = e.code === 'BAD_PLAN' ? 400 : e.code === 'NO_STRIPE' || e.code === 'NO_PRICE' ? 503 : 502;
    res.status(code).json({ error: e.message });
  }
}));
app.get('/api/billing/checkout-result', requireAuth(async (req, res) => {
  try {
    const sessionId = String(req.query.session_id || req.query.sessionId || '');
    const session = await stripeMod.loadSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Checkout not found.' });
    if ((session.client_reference_id && session.client_reference_id !== req.user.id)
      || (session.metadata?.user_id && session.metadata.user_id !== req.user.id)
      || (!session.client_reference_id && !session.metadata?.user_id)) {
      return res.status(403).json({ error: 'This checkout belongs to another account.' });
    }
    // SECURITY: fulfillment only happens in the signature-verified Stripe
    // webhook. The return page just reports status; it never grants anything.
    const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required' || session.status === 'complete';
    res.json({ ok: true, pending: !paid, status: session.status || null, payment_status: session.payment_status || null, billing: await billingFor(req.user.id) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));
// Stripe customer portal (manage / cancel subscription).
app.post('/api/billing/portal', requireAuth(async (req, res) => {
  try {
    const portal = await stripeMod.createPortal({ userId: req.user.id, req });
    res.json({ ok: true, url: portal.url });
  } catch (e) {
    const code = e.code === 'NO_CUSTOMER' ? 400 : 502;
    res.status(code).json({ error: e.message });
  }
}));
// Legacy endpoint (pre-Stripe): upgrades now go through Stripe Checkout.
app.post('/api/billing/upgrade', requireAuth(async (req, res) => {
  const { plan, extraCredits, extraTokens, promo } = req.body || {};
  if (!PLANS[plan] || plan === 'free') return res.status(400).json({ error: 'Choose pro or max.' });
  if (stripeMod.isConfigured() && stripeMod.priceFor(plan, promo)) {
    try {
      const session = await stripeMod.createCheckout({ userId: req.user.id, email: req.user.email, plan, extraCredits, extraTokens, promo, req });
      return res.json({ ok: true, status: 'checkout', url: session.url, note: `Continue to Stripe to start ${PLANS[plan].name}.` });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  const r = await store.requestUpgrade(req.user.id, plan);
  res.json({ ok: true, status: 'requested', request: r.id, note: `Payments aren't connected yet — your ${PLANS[plan].name} request is recorded, no charge made. You keep your current credits.` });
}));
/* Staff allowlist for privileged actions (gift-code issuance).
   Set LINGON_ADMIN_USER_IDS and/or LINGON_ADMIN_EMAILS (comma-separated).
   Empty config = nobody is admin (deny by default). */
function adminList(name) {
  return String(process.env[name] || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}
function isAdmin(user) {
  if (!user) return false;
  const ids = adminList('LINGON_ADMIN_USER_IDS');
  const emails = adminList('LINGON_ADMIN_EMAILS');
  return ids.includes(String(user.id || '').toLowerCase()) || (!!user.email && !!user.email_confirmed_at && emails.includes(String(user.email).toLowerCase()));
}

app.post('/api/gifts/create', requireAuth(async (req, res) => {
  // SECURITY: manual gift issuance mints real, redeemable credits, so it is
  // restricted to staff. Without an explicit admin allowlist nobody may issue.
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Gift codes can only be issued by staff. Buy a gift card via Billing.' });
  const amount = Number((req.body || {}).amount || 0);
  if (![50, 100].includes(amount)) return res.status(400).json({ error: 'Gift amount must be 50 or 100.' });
  const g = await store.createGift(req.user.id, amount);
  const giftCredits = Number(g.amount_usd) * 2;
  res.json({ gift: { code: g.code, amount_usd: g.amount_usd, credits: giftCredits }, note: `Share this code — the redeemer gets ${giftCredits} credits. Redeem via Billing.` });
}));

async function checkCredit(userId) {
  const b = await billingFor(userId);
  if (b.tokens <= 0) {
    const e = new Error('You have used your available tokens. Upgrade or add a token pack under Billing.');
    e.code = 'NO_CREDIT';
    throw e;
  }
  return b;
}

// Stripe webhook events → subscriptions, monthly credit grants, first-invoice gifts.
async function handleStripeEvent(s, event) {
  const t = event.type;
  const obj = event.data && event.data.object ? event.data.object : {};
  if (t === 'checkout.session.completed' || t === 'checkout.session.async_payment_succeeded') {
    await stripeMod.fulfillCheckout(obj);
    return;
  }
  if (t === 'invoice.paid' || t === 'invoice.payment_succeeded') {
    await stripeMod.fulfillInvoice(s, obj);
    return;
  }
  if (t === 'customer.subscription.updated' || t === 'customer.subscription.created') {
    const customerId = typeof obj.customer === 'string' ? obj.customer : null;
    const uid = customerId && await store.findUserByStripeCustomer(customerId);
    if (!uid) return;
    const priceId = obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
    const plan = stripeMod.planForPrice(priceId);
    const prev = await store.getSubscription(uid);
    if (prev.stripe_subscription_id && prev.stripe_subscription_id !== obj.id) return;
    const status = obj.cancel_at_period_end ? 'canceling' : (obj.status === 'active' || obj.status === 'trialing' ? 'active' : prev.status || 'active');
    await store.setSubscription(uid, plan || prev.plan || 'free', status, {
      stripe_customer_id: customerId || prev.stripe_customer_id,
      stripe_subscription_id: obj.id,
      current_period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : (prev.current_period_end || null),
      gift_issued: prev.gift_issued,
    });
    return;
  }
  if (t === 'customer.subscription.deleted') {
    const customerId = typeof obj.customer === 'string' ? obj.customer : null;
    const uid = customerId && await store.findUserByStripeCustomer(customerId);
    if (!uid) return;
    const prev = await store.getSubscription(uid);
    if (prev.stripe_subscription_id && prev.stripe_subscription_id !== obj.id) return;
    // Downgrade to Free at period end — already-granted credits stay.
    await store.setSubscription(uid, 'free', 'active', {
      stripe_customer_id: customerId || prev.stripe_customer_id,
      stripe_subscription_id: null,
      current_period_end: prev.current_period_end,
      gift_issued: prev.gift_issued,
    });
    return;
  }
}

// ---------- triggers + sub-agents (isolated automation chats) ----------
// App triggers are powered by Composio connected apps (per-user OAuth), not by
// vault PATs. See /api/composio/* for the connection flow.
app.get('/api/trigger-options', requireAuth(async (req, res) => {
  try {
    res.json(await composio.triggerOptionsForUser(req.user.id));
  } catch {
    res.json({ schedules: [5, 15, 30, 60, 360, 1440, 10080], apps: [] });
  }
}));

app.get('/api/sub-agents', requireAuth(async (req, res) => {
  await store.ensureSystemSubAgents(req.user.id);
  res.json({ subAgents: await store.listSubAgents(req.user.id) });
}));

app.post('/api/sub-agents', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    const input = normalizeSubAgent(req.body || {});
    const current = await store.listSubAgents(req.user.id);
    if (current.filter(agent=>!agent.systemKind).length >= 25) return res.status(400).json({ error: 'A maximum of 25 sub-agents is allowed per account.' });
    if (input.trigger.type === 'app') {
      const ok = await composio.isToolkitConnected(req.user.id, input.trigger.app);
      if (!ok) return res.status(409).json({ error: 'Choose an app that is connected under Apps.' });
      await composio.ensureAppTrigger(req.user.id, input.trigger.app, input.trigger.event, input.trigger.connectedAccountId);
    }
    if (input.trigger.type === 'subagent' && !current.some((agent) => agent.id === input.trigger.sourceAgentId)) return res.status(400).json({ error: 'Source sub-agent was not found.' });
    const subAgent = await store.createSubAgent(req.user.id, input, nextRunAt(input.trigger));
    res.status(201).json({ subAgent });
  } catch (e) { res.status(e.code === 'BAD_INPUT' ? 400 : 500).json({ error: e.message }); }
}));

app.patch('/api/sub-agents/:id', rateLimit(60, 60000), requireAuth(async (req, res) => {
  try {
    const current = await store.getSubAgent(req.user.id, req.params.id);
    if (!current) return res.status(404).json({ error: 'Sub-agent not found.' });
    if(current.systemKind){
      const enabled=req.body?.enabled!==false;
      const subAgent=await store.updateSubAgent(req.user.id,current.id,{name:current.name,prompt:current.prompt,enabled,trigger:current.trigger},enabled?nextRunAt(current.trigger):null);
      return res.json({subAgent});
    }
    const input = normalizeSubAgent({ ...current, ...req.body, trigger: req.body?.trigger || current.trigger }, current.id);
    const all = await store.listSubAgents(req.user.id);
    if (input.trigger.type === 'app') {
      const ok = await composio.isToolkitConnected(req.user.id, input.trigger.app);
      if (!ok) return res.status(409).json({ error: 'Choose an app that is connected under Apps.' });
      if (input.enabled) await composio.ensureAppTrigger(req.user.id, input.trigger.app, input.trigger.event, input.trigger.connectedAccountId);
    }
    if (input.trigger.type === 'subagent' && !all.some((agent) => agent.id === input.trigger.sourceAgentId)) return res.status(400).json({ error: 'Source sub-agent was not found.' });
    const subAgent = await store.updateSubAgent(req.user.id, current.id, input, input.enabled ? nextRunAt(input.trigger) : null);
    res.json({ subAgent });
  } catch (e) { res.status(e.code === 'BAD_INPUT' ? 400 : 500).json({ error: e.message }); }
}));

app.delete('/api/sub-agents/:id', requireAuth(async (req, res) => {
  const current = await store.getSubAgent(req.user.id, req.params.id);
  if (!current) return res.status(404).json({ error: 'Sub-agent not found.' });
  if (current.systemKind) return res.status(403).json({ error: 'Built-in agent upkeep cannot be deleted. Pause it instead.' });
  await store.deleteSubAgent(req.user.id, current.id);
  res.json({ ok: true });
}));

app.post('/api/sub-agents/:id/run', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try {
    const subAgent = await store.getSubAgent(req.user.id, req.params.id);
    if (!subAgent) return res.status(404).json({ error: 'Sub-agent not found.' });
    if (!subAgent.enabled) return res.status(409).json({ error: 'Enable this sub-agent before running it.' });
    const result = await Automations.executeSubAgent({ userId: req.user.id, subAgent, event: { type: 'manual', payload: { requestedAt: new Date().toISOString() } } });
    if (result.status === 'error') return res.status(502).json({ error:result.error || 'Automation run failed.' });
    res.json(result);
  } catch (e) {
    if (e.code === 'NO_CREDIT') return res.status(402).json({ error: e.message, upgrade_required: true });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    safeLog('[sub-agent] run failed', e.message);
    res.status(502).json({ error: 'Sub-agent run failed.' });
  }
}));

app.get('/api/automation-runs', requireAuth(async (req, res) => {
  res.json({ runs: await store.listAutomationRuns(req.user.id) });
}));

app.get('/api/automation-chats', requireAuth(async (req, res) => {
  res.json({ chats: await store.listAutomationChats(req.user.id) });
}));

app.post('/api/app-events', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    const appName = String(req.body?.app || '').trim().toLowerCase();
    const eventName = String(req.body?.event || '').trim().toUpperCase();
    if (!/^[a-z0-9_-]+$/.test(appName) || !/^[A-Z0-9_.:-]+$/.test(eventName)) return res.status(400).json({ error: 'Valid app and event are required.' });
    const ok = await composio.isToolkitConnected(req.user.id, appName);
    if (!ok) return res.status(409).json({ error: 'That app is not connected.' });
    const results = await Automations.dispatchAppEvent(req.user.id, { type: 'app', app: appName, event: eventName, payload: req.body?.payload || {} });
    res.json({ matched: results.length, results });
  } catch (e) { res.status(502).json({ error: 'App trigger failed.' }); }
}));

// ---------- Composio connected apps (Belna branding, per-user OAuth) ----------
app.get('/api/composio/apps', requireAuth(async (req, res) => {
  try {
    if (!composio.configured()) return res.status(503).json({ error: 'App connections are not configured.' });
    res.json({ apps: await composio.appsForUser(req.user.id) });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not load apps.' });
  }
}));

app.post('/api/composio/connect', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    const { authConfigId, toolkit } = req.body || {};
    const origin = composio.siteOrigin(req);
    const callbackUrl = origin ? `${origin}/?connected_app=${encodeURIComponent(String(toolkit || authConfigId || 'app'))}` : undefined;
    const link = await composio.createLink(req.user.id, { authConfigId, toolkit, callbackUrl });
    if (!link.redirectUrl) return res.status(502).json({ error: 'Could not start the connection flow.' });
    res.json(link);
  } catch (e) {
    res.status(e.code === 'BAD_INPUT' ? 400 : 502).json({ error: e.message || 'Could not start the connection flow.' });
  }
}));

app.post('/api/composio/disconnect', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    const { connectedAccountId, id } = req.body || {};
    await composio.deleteConnected(req.user.id, connectedAccountId || id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.code === 'BAD_INPUT' ? 400 : 502).json({ error: e.message || 'Could not remove the connection.' });
  }
}));

app.get('/api/composio/toolkit', requireAuth(async (req, res) => {
  try {
    if (!composio.configured()) return res.status(503).json({ error: 'App connections are not configured.' });
    res.json(await composio.toolkitForUser(req.user.id, req.query.toolkit));
  } catch (e) {
    res.status(e.code === 'BAD_INPUT' ? 400 : 502).json({ error: e.message || 'Could not load connector.' });
  }
}));

app.post('/api/composio/permissions', rateLimit(60, 60000), requireAuth(async (req, res) => {
  try {
    const { toolkit, disabled } = req.body || {};
    const list = await composio.setToolkitPermissions(req.user.id, toolkit, disabled);
    res.json({ ok: true, disabled: list });
  } catch (e) {
    res.status(e.code === 'BAD_INPUT' ? 400 : 502).json({ error: e.message || 'Could not save permissions.' });
  }
}));

app.get('/api/composio/tools', requireAuth(async (req, res) => {
  try {
    const { toolkit, q, query, limit } = req.query;
    res.json({ tools: await composio.listTools(toolkit, { limit: Number(limit) || 30, query: q || query || '' }) });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not list tools.' });
  }
}));

app.get('/api/composio/triggers', requireAuth(async (req, res) => {
  try {
    const { toolkit } = req.query;
    res.json({ triggers: await composio.listTriggerTypes(toolkit) });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not list triggers.' });
  }
}));

app.post('/api/composio/execute', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    await Runner.ensureCredit(req.user.id);
    const { tool, toolSlug, args, arguments: args2, connectedAccountId, version } = req.body || {};
    const slug = String(tool || toolSlug || '').toUpperCase().trim();
    if (!/^[A-Z0-9_]+$/.test(slug)) return res.status(400).json({ error: 'tool required (e.g. GMAIL_FETCH_EMAILS).' });
    const result = await composio.executeTool(req.user.id, {
      tool: slug, args: args || args2 || {}, connectedAccountId, version,
    });
    try {
      await store.logToolRun({ userId: req.user.id, sessionId: req.body?.sessionId || null, kind: 'tool', name: slug.toLowerCase(), status: result.successful === false ? 'error' : 'done', detail: `composio ${slug}` });
    } catch {}
    res.json({ ok: result.successful !== false, result });
  } catch (e) {
    if (e.code === 'NO_CREDIT') return res.status(402).json({ error: e.message, upgrade_required: true });
    if (e.code === 'PERMISSION_OFF') return res.status(403).json({ error: e.message });
    const msg = String(e.message || 'Tool run failed.');
    if (/No connected account|not connected|connect your/i.test(msg)) {
      return res.status(409).json({ error: 'Connect that app under Apps first, then retry.', needsConnection: true });
    }
    res.status(502).json({ error: msg.slice(0, 500) });
  }
}));

// Agent uses connected apps: picks a real tool for the prompt, runs it via
// Composio as the signed-in user, then summarizes honestly. No simulation.
app.post('/api/composio/agent-run', rateLimit(20, 60000), requireAuth(async (req, res) => {
  const trace = [];
  try {
    await Runner.ensureCredit(req.user.id);
    const prompt = String(req.body?.prompt || '').slice(0, 2000);
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    checkPrompt(prompt);
    const apps = await composio.appsForUser(req.user.id);
    const connected = apps.filter((a) => a.connected);
    if (!connected.length) {
      return res.status(409).json({ error: 'No apps connected yet. Connect one under Apps, then ask again.', needsConnection: true });
    }
    // Gather candidate tools from connected toolkits (top tools each).
    const candidates = [];
    for (const app of connected.slice(0, 6)) {
      try {
        const tools = await composio.listTools(app.toolkit, { limit: 12 });
        for (const t of tools) candidates.push(t);
      } catch {}
    }
    if (!candidates.length) return res.status(502).json({ error: 'Could not list tools for your connected apps.' });
    const toolLines = candidates.slice(0, 40).map((t) => `- ${t.slug}: ${t.description || t.name}`.slice(0, 220)).join('\n');
    const picker = await Runner.modelAnswer({
      agent: { instructions: 'You map a user request to one Composio tool call. Output ONLY JSON: {"tool":"TOOL_SLUG","args":{}}. Use only tools from the list. Keep args minimal and valid. Never invent a tool slug.' },
      task: `User request: ${prompt}\n\nConnected toolkits: ${connected.map((a) => a.toolkit).join(', ')}\n\nAvailable tools:\n${toolLines}`,
      history: [],
      model: MODEL_DEFAULT,
    });
    let choice = null;
    try {
      const txt = String(picker.text || '').replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      choice = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    } catch {}
    const slug = String(choice?.tool || '').toUpperCase().trim();
    if (!/^[A-Z0-9_]+$/.test(slug) || !candidates.some((t) => t.slug === slug)) {
      return res.status(422).json({ error: 'I could not map that request to a supported app action. Try a more specific request.', trace });
    }
    trace.push(entry('box', `composio: ${slug} via ${connected.find((a) => slug.startsWith(a.toolkit.toUpperCase() + '_'))?.toolkit || 'connected app'}`));
    const exec = await composio.executeTool(req.user.id, { tool: slug, args: choice.args || {} });
    await Runner.logModelUsage(req.user.id, picker.model || MODEL_DEFAULT, [picker.usage]);
    if (exec.successful === false) {
      return res.status(502).json({ error: String(exec.error || 'The app action failed.').slice(0, 500), trace });
    }
    const summary = await Runner.modelAnswer({
      agent: { instructions: 'You summarize a real app tool result for the owner. Never invent data — only report what the result contains. Be concise.' },
      task: `User request: ${prompt}\nTool: ${slug}\nResult (truncated):\n${JSON.stringify(exec.data || exec).slice(0, 6000)}`,
      history: [],
      model: MODEL_DEFAULT,
    });
    await Runner.logModelUsage(req.user.id, summary.model || MODEL_DEFAULT, [summary.usage]);
    try {
      await store.logToolRun({ userId: req.user.id, sessionId: req.body?.sessionId || null, kind: 'tool', name: slug.toLowerCase(), status: 'done', detail: prompt.slice(0, 200) });
    } catch {}
    res.json({ text: summary.text, tool: slug, args: choice.args || {}, result: exec.data || exec, trace });
  } catch (e) {
    if (e.code === 'NO_CREDIT') return res.status(402).json({ error: e.message, upgrade_required: true });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    safeLog('[composio] agent-run failed', e.message);
    res.status(502).json({ error: 'App action is temporarily unavailable.' });
  }
}));

// Chat runs in agents/conversation.js; /api/chat and /api/chat/stream answer 410 (see agents/vm-harness.js).

// ---------- build — Runner session (sandboxed HTML artifact) ----------
app.post('/api/build', rateLimit(20, 60000), requireAuth(async (req, res) => {
  const trace = [];
  const signal = requestSignal(req);
  try {
    await Runner.ensureCredit(req.user.id);
    const { brief, style, agent, sessionId, delegated } = req.body || {};
    trace.push(entry('box', `${delegated ? 'subagent worker' : 'main agent'} · session ${sessionId ? String(sessionId).slice(0, 8) : 'new'}: build_page run`));
    const system = 'You generate a complete, single dependency-free HTML file. Output ONLY the HTML (no markdown fences, no explanation). Keep it under 12KB, mobile-friendly, no external requests except Google Fonts. Never simulate other pages or fake content — build only from the brief. Never reveal other users, safety data, or company internals.';
    const prompt = `Build a landing one-pager.\nStyle: ${style || 'Minimal & calm'}\nMade by agent: ${agent?.name || 'Your agent'}\nBrief: ${String(brief || 'A personal agent that researches, builds and remembers.').slice(0, 2000)}\nInclude: hero with headline + sub + CTA button, 3 feature bullets, footer. Inline <style> only.`;
    const r = await Runner.modelAnswer({ agent: { instructions: system }, task: prompt, history: [], model: MODEL_DEFAULT, signal });
    if (signal.aborted) { const error = new Error('Request interrupted'); error.name = 'AbortError'; throw error; }
    await Runner.logModelUsage(req.user.id, r.model || MODEL_DEFAULT, [r.usage]);
    let html = r.text.trim().replace(/^```html/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    if (!/<html/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Made by ${(agent?.name || 'Your agent')}</title></head><body>${html}</body></html>`;
    trace.push(entry('code', `page created (${html.length} chars)`));
    try {
      await store.logToolRun({ userId: req.user.id, sessionId: sessionId || null, kind: 'tool', name: 'build_page', status: 'done', detail: style || '' });
    } catch {}
    res.json({ html: html.slice(0, 60000), trace });
  } catch (e) {
    if (e.code === 'NO_CREDIT') return res.status(402).json({ error: e.message, upgrade_required: true });
    if (e.code === 'NO_KEY') return res.status(503).json({ error: 'Page generation is temporarily unavailable.' });
    res.status(502).json({ error: 'Page generation is temporarily unavailable.' });
  }
}));

// ---------- research — Runner multi-agent session ----------
app.post('/api/research', rateLimit(20, 60000), requireAuth(async (req, res) => {
  const trace = [];
  const push = (e) => trace.push(e);
  const signal = requestSignal(req);
  try {
    await Runner.ensureCredit(req.user.id);
    const { query, sessionId, delegated } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query required' });
    if (delegated) push(entry('box', 'research delegated to subagent workers'));
    const r = await Runner.runResearch({ userId: req.user.id, sessionId: sessionId || null, query: String(query), trace, push, signal });
    const cost = costOf(r.usage);
    if (cost > 0) await store.logUsage(req.user.id, { model: MODEL_DEFAULT, usage: r.usage, cost });
    res.json({ ...r, trace });
  } catch (e) {
    if (e.code === 'NO_CREDIT') return res.status(402).json({ error: e.message, upgrade_required: true });
    res.status(502).json({ error: 'Research is temporarily unavailable.' });
  }
}));

// ---------- GitHub (auth + approval handled client-side, PAT per-request) ----------
app.get('/api/github/prs', rateLimit(30, 60000), requireAuth(async (req, res) => {
  const signal = requestSignal(req);
  try {
    const token = (req.headers['x-github-token'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    // Authorization header carries the Supabase JWT (handled by requireAuth);
    // GitHub PAT comes via X-GitHub-Token only — never confused.
    const pat = (req.headers['x-github-token'] || '').trim();
    if (!pat) return res.status(401).json({ error: 'GitHub token required (paste a fine-grained PAT; sent per-request, never stored).' });
    const gh = async (url) => {
      const r = await fetchAllowlisted(url, { headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' }, signal });
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
    // Publish deterministic stats from the live API response. No user or model
    // supplied code is evaluated in the application process.
    const toolTrace = [];
    const sessionId = String(req.query.sessionId || req.body?.sessionId || 'unsorted');
    const pcs = pc.getOrCreate(req.user.id, sessionId);
    const byRepo = {};
    for (const pr of prs) byRepo[pr.repo] = (byRepo[pr.repo] || 0) + 1;
    const statsLines = [
      `repos checked: ${repos.length}`,
      `open PRs: ${prs.length}`,
      ...Object.entries(byRepo).slice(0, 5).map(([repo, n]) => `${repo}: ${n} open`),
      ...(prs.length ? [] : ['nothing to review']),
    ];
    const statsRun = pc.report(pcs, { lines: statsLines, who: 'agent', trace: (e) => toolTrace.push(e) });
    Automations.dispatchAppEvent(req.user.id, { type: 'app', app: 'github', event: 'pull_request.checked', payload: { reposChecked: repos.length, pullRequests: prs.slice(0, 20) } }).catch((e) => safeLog('[trigger] github event failed', e.message));
    res.json({ repos: repos.map((r) => r.full_name), prs, stdout: statsRun.stdout, pcId: statsRun.pcId, trace: [{ ic: 'git', t: `github_prs: ${repos.length} repos, ${prs.length} open PRs (read-only)` }, ...toolTrace] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

app.get('/api/github/diff', rateLimit(30, 60000), requireAuth(async (req, res) => {
  const signal = requestSignal(req);
  try {
    const pat = (req.headers['x-github-token'] || '').trim();
    const { repo, number } = req.query;
    if (!pat || !repo || !number) return res.status(400).json({ error: 'token + repo + number required' });
    const r = await fetchAllowlisted(`https://api.github.com/repos/${repo}/pulls/${number}`, {
      headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github.diff' }, signal,
    });
    res.json({ diff: (await r.text()).slice(0, 30000) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}));

function shopPayErr(e) {
  return e.code === 'BAD_INPUT' || e.code === 'NEED_CONFIRM' || e.code === 'LIMIT' || e.code === 'NO_SHOP_LINK' ? 400
    : e.code === 'NO_SHOP' || e.code === 'SHOP_CONFIG' ? 503
    : 502;
}
function belnaWalletErr(e) {
  return e.code === 'BAD_INPUT' ? 400 : e.code === 'NOT_SET_UP' ? 503 : e.code === 'VERIFY' || e.code === 'REVIEW' ? 409 : 502;
}
app.get('/api/wallet-history',requireAuth(async(req,res)=>{res.setHeader('Cache-Control','no-store');try{res.json(await belnaWallet.existingHistory(req.user.id));}catch(e){res.status(belnaWalletErr(e)).json({error:e.message});}}));
app.get('/api/wallet-preferences',requireAuth(async(req,res)=>{res.setHeader('Cache-Control','no-store');try{res.json(await belnaWallet.preferences(req.user.id));}catch(e){res.status(belnaWalletErr(e)).json({error:e.message});}}));
app.post('/api/wallet-preferences',rateLimit(20,60000),requireAuth(async(req,res)=>{res.setHeader('Cache-Control','no-store');try{res.json(await belnaWallet.savePreferences(req.user.id,req.body||{}));}catch(e){res.status(belnaWalletErr(e)).json({error:e.message});}}));
app.get('/api/shipping-addresses',requireAuth(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{res.json(await belnaWallet.addresses(req.user.id));}catch(e){res.status(belnaWalletErr(e)).json({error:e.message});}
}));
for(const action of ['save','delete'])app.post('/api/shipping-addresses/'+action,rateLimit(20,60000),requireAuth(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{res.json(await belnaWallet[action==='save'?'saveAddress':'deleteAddress'](req.user.id,req.body||{}));}catch(e){res.status(belnaWalletErr(e)).json({error:e.message});}
}));
for (const action of ['owner-state','owner-input']) app.post('/api/belna-wallet/purchases/:id/'+action,rateLimit(90,60000),requireAuth(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try {
    if(!/^[a-f0-9-]{36}$/.test(req.params.id))return res.status(404).json({error:'Purchase not found.'});
    const purchase=await store.getWalletPurchase(req.user.id,req.params.id);
    if(!purchase || purchase.status!=='submitted' || purchase.canceled_at || Date.parse(purchase.expires_at)<=Date.now())return res.status(409).json({error:'This payment verification is no longer available. Check wallet activity before purchasing again.'});
    res.json(action==='owner-state'?await privateCheckout.ownerState(purchase.id,req.user.id):await privateCheckout.ownerInput(purchase.id,req.user.id,req.body?.event));
  }catch{res.status(409).json({error:'No private bank verification is available. Check wallet activity before purchasing again.'});}
}));
app.get('/api/belna-wallet/card-waitlist',requireAuth(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{res.json(await belnaWallet.cardWaitlist(req.user.id));}catch(e){res.status(belnaWalletErr(e)).json({error:e.message});}
}));
app.post('/api/belna-wallet/card-waitlist',rateLimit(10,60000),requireAuth(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{res.json(await belnaWallet.joinCardWaitlist(req.user.id));}catch(e){res.status(belnaWalletErr(e)).json({error:e.message});}
}));
app.get('/api/belna-wallet', requireAuth(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(await belnaWallet.snapshot(req.user.id)); }
  catch (e) { res.status(belnaWalletErr(e)).json({ error:e.message }); }
}));
for (const action of ['setup', 'oauth-finish', 'verify', 'verification-session', 'card-connect', 'card-session', 'controls', 'deposit', 'deposit-session', 'withdraw-session', 'legacy', 'legacy-withdraw-session', 'payment-request', 'receive', 'quote', 'send']) {
  app.post('/api/belna-wallet/' + action, rateLimit(10, 60000), requireAuth(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = action === 'setup' ? await belnaWallet.setup(req.user, req.body || {})
        : action === 'oauth-finish' ? await belnaWallet.finishConnect(req.user, req.body || {})
        : action === 'legacy' ? await belnaWallet.legacySnapshot(req.user.id)
        : action === 'legacy-withdraw-session' ? await belnaWallet.legacyWithdrawalSession(req.user.id)
        : action === 'payment-request' ? await belnaWallet.paymentRequest(req.user.id,req.body?.requestId)
        : action === 'verify' ? await belnaWallet.verify(req.user.id)
        : action === 'card-connect' ? await belnaWallet.connectCard(req.user.id)
        : action === 'controls' ? await belnaWallet.updateCard(req.user.id, req.body || {})
        : action === 'deposit' ? await belnaWallet.deposit(req.user.id)
        : action === 'deposit-session' ? await belnaWallet.depositSession(req.user.id)
        : action === 'verification-session' ? await belnaWallet.verificationSession(req.user.id)
        : action === 'withdraw-session' ? await belnaWallet.withdrawalSession(req.user.id)
        : action === 'card-session' ? await belnaWallet.cardSession(req.user.id)
        : action === 'quote' ? await belnaWallet.transferQuote(req.user.id, req.body || {})
        : action === 'send' ? await belnaWallet.confirmTransfer(req.user.id, req.body || {})
        : await belnaWallet.receive(req.user.id, req.body || {});
      res.json(result);
    } catch (e) { res.status(belnaWalletErr(e)).json({ error:e.message }); }
  }));
}
app.get('/.well-known/ucp', (req, res) => {
  res.json(shoppay.platformProfile(siteOrigin(req)));
});
app.get('/profiles/lingon-agent.json', (req, res) => {
  res.json(shoppay.platformProfile(siteOrigin(req)));
});
app.get('/api/shop-pay', requireAuth(async (req, res) => {
  try { res.json(await shoppay.snapshot(req.user.id)); }
  catch (e) { res.status(shopPayErr(e)).json({ error: e.message }); }
}));
app.post('/api/shop-pay/connect', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try { res.json(await shoppay.startConnect(req.user.id, { origin: siteOrigin(req) })); }
  catch (e) { res.status(shopPayErr(e)).json({ error: e.message }); }
}));
app.get('/api/shop-pay/callback', rateLimit(20, 60000), async (req, res) => {
  const back = (ok, msg) => res.redirect('/app?shop_pay=' + (ok ? 'connected' : 'error') + (msg ? '&shop_pay_msg=' + encodeURIComponent(String(msg).slice(0, 160)) : ''));
  try {
    await shoppay.finishConnect(req.query || {});
    back(true);
  } catch (e) {
    back(false, e.message || 'Shop Pay connect failed.');
  }
});
app.post('/api/shop-pay/disconnect', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try { res.json(await shoppay.disconnect(req.user.id)); }
  catch (e) { res.status(shopPayErr(e)).json({ error: e.message }); }
}));
app.post('/api/shop-pay/limit', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try { res.json(await shoppay.setDailyLimit(req.user.id, (req.body || {}).dailyLimitUsd)); }
  catch (e) { res.status(shopPayErr(e)).json({ error: e.message }); }
}));

function mailErr(e) {
  return e.code === 'BAD_INPUT' || e.code === 'NEED_CONFIRM' || e.code === 'LIMIT' || e.code === 'NOT_FOUND' ? 400
    : e.code === 'NO_RESEND' ? 503
    : e.code === 'BAD_SIGNATURE' ? 400
    : 502;
}
app.get('/api/mail', requireAuth(async (req, res) => {
  try {
    res.json(await mail.snapshot(req.user.id, {
      folder: req.query.folder || 'inbox',
      q: req.query.q || '',
      ensureName: req.query.name || '',
    }));
  } catch (e) { res.status(mailErr(e)).json({ error: e.message }); }
}));
app.post('/api/mail/ensure', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    const box = await mail.ensureMailbox(req.user.id, (req.body || {}).agentName || req.body?.name);
    res.json(await mail.snapshot(req.user.id, { mailbox: box }));
  } catch (e) { res.status(mailErr(e)).json({ error: e.message }); }
}));
app.get('/api/mail/messages/:id', requireAuth(async (req, res) => {
  try { res.json({ message: await mail.readMessage(req.user.id, req.params.id) }); }
  catch (e) { res.status(mailErr(e)).json({ error: e.message }); }
}));
app.post('/api/mail/messages/:id/read', rateLimit(60, 60000), requireAuth(async (req, res) => {
  try { res.json(await mail.markRead(req.user.id, req.params.id, (req.body || {}).isRead !== false)); }
  catch (e) { res.status(mailErr(e)).json({ error: e.message }); }
}));
app.post('/api/mail/send', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try {
    const body = req.body || {};
    const sent = await mail.send(req.user.id, Object.assign({}, body, { confirm: body.confirm === true }));
    res.json({ ok: true, message: sent, mailbox: await mail.snapshot(req.user.id, { folder: 'sent' }) });
  } catch (e) { res.status(mailErr(e)).json({ error: e.message }); }
}));
app.post('/api/mail/drafts', rateLimit(40, 60000), requireAuth(async (req, res) => {
  try { res.json({ draft: await mail.saveDraft(req.user.id, req.body || {}) }); }
  catch (e) { res.status(mailErr(e)).json({ error: e.message }); }
}));
app.delete('/api/mail/drafts/:id', requireAuth(async (req, res) => {
  try { await store.deleteMailDraft(req.user.id, req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(mailErr(e)).json({ error: e.message }); }
}));

// ---------- transcript search (auth-derived user) ----------
app.get('/api/client-state', requireAuth(async (req, res) => {
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await store.listClientState(req.user.id)); }
  catch (e) { res.status(503).json({ error:e.message }); }
}));
app.put('/api/client-state/:key', rateLimit(180, 60000), requireAuth(async (req, res) => {
  try { res.json({ value:await store.saveClientState(req.user.id, req.params.key, req.body?.value) }); }
  catch (e) { res.status(e.code === 'BAD_INPUT' ? 400 : 503).json({ error:e.message }); }
}));
app.delete('/api/client-state/chats/:id', requireAuth(async (req, res) => {
  try { await store.deleteClientChat(req.user.id, req.params.id); res.json({ ok:true }); }
  catch (e) { res.status(e.code === 'BAD_INPUT' ? 400 : 503).json({ error:e.message }); }
}));

// ---------- transcript search (auth-derived user) ----------
app.get('/api/history/search', requireAuth(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  if (!q) return res.status(400).json({ error: 'q required' });
  res.json({ turns: await store.searchTurns(req.user.id, q) });
}));

// ---------- durable personal-agent identity and editable context ----------
app.get('/api/agent-context', requireAuth(async (req, res) => {
  res.json(await store.getAgentContext(req.user.id));
}));
app.put('/api/agent-context', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try {
    const body = req.body || {};
    res.json(await store.saveAgentContext(req.user.id, {
      agent: body.agent, documents: body.documents, revision: body.revision,
    }));
  } catch (e) {
    res.status(e.code === 'CONFLICT' ? 409 : e.code === 'PERSISTENCE' ? 503 : 400).json({ error:e.message });
  }
}));

// ---------- safe system files for Library → System files ----------
// Only the owner-editable agent context and the generated memory view. The
// runtime capability registry stays server-side; it is not a user file.
app.get('/api/system-files', requireAuth(async (req, res) => {
  const context = await store.getAgentContext(req.user.id);
  res.json({
    revision: context.revision,
    documents: context.documents,
    folders: [
      { id:'agent', path:'/agent', editable:true, files:['IDENTITY.md','SOUL.md','AGENTS.md'] },
      { id:'user', path:'/user', editable:true, files:['USER.md'] },
      { id:'memory', path:'/memory', editable:false, files:['MEMORY.md'] },
    ],
  });
}));

// ---------- goals + library (shared with the agent's goal_* and library_* tools) ----------
const personalStatus = (e) => e.code === 'NOT_FOUND' ? 404 : e.code === 'PERSISTENCE' ? 503 : 400;
app.get('/api/goals', requireAuth(async (req, res) => {
  try { res.json({ goals: await store.listGoals(req.user.id) }); }
  catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));
app.post('/api/goals', rateLimit(60, 60000), requireAuth(async (req, res) => {
  const { title, category, steps, status, createdAt } = req.body || {};
  try { res.json({ goal: await store.createGoal(req.user.id, { title, category, steps, status, createdAt }) }); }
  catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));
app.patch('/api/goals/:id', rateLimit(120, 60000), requireAuth(async (req, res) => {
  const { title, category, status, steps, addSteps, completeSteps, reopenSteps, removeSteps } = req.body || {};
  try { res.json({ goal: await store.updateGoal(req.user.id, req.params.id, { title, category, status, steps, addSteps, completeSteps, reopenSteps, removeSteps }) }); }
  catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));
app.put('/api/goals/:id/work', rateLimit(30,60000), requireAuth(async(req,res)=>{try{res.json({goal:await configureGoalWork(store,req.user.id,req.params.id,req.body || {})});}catch(e){res.status(400).json({error:e.message});}}));
app.delete('/api/goals/:id', requireAuth(async (req, res) => {
  try {
    if (!await store.deleteGoal(req.user.id, req.params.id)) return res.status(404).json({ error: 'Goal not found.' });
    res.json({ ok: true });
  } catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));
app.get('/api/library', requireAuth(async (req, res) => {
  try { res.json({ items: await store.listLibrary(req.user.id, { kind: req.query.kind, query: req.query.q, limit: req.query.limit }) }); }
  catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));
app.get('/api/library/:id/versions', requireAuth(async(req,res)=>{try{res.json({versions:await store.listLibraryVersions(req.user.id,req.params.id)});}catch(e){res.status(personalStatus(e)).json({error:e.message});}}));
app.get('/api/library/:id', requireAuth(async (req, res) => {
  try {
    const item = await store.getLibraryItem(req.user.id, req.params.id,req.query.revision);
    if (!item) return res.status(404).json({ error: 'Library item not found.' });
    res.json({ item });
  } catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));
app.post('/api/library', rateLimit(30, 60000), requireAuth(async (req, res) => {
  const { title, mime, content } = req.body || {};
  try { res.json({ item: await store.saveLibraryItem(req.user.id, { title, mime, content, source: 'upload' }) }); }
  catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));
app.patch('/api/library/:id', rateLimit(60, 60000), requireAuth(async (req, res) => {
  try { res.json({ item: await (req.body?.content!==undefined?store.saveLibraryItem(req.user.id,{...req.body,id:req.params.id,source:'upload'}):store.renameLibraryItem(req.user.id, req.params.id, req.body?.title)) }); }
  catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));
app.delete('/api/library/:id', requireAuth(async (req, res) => {
  try {
    if (!await store.deleteLibraryItem(req.user.id, req.params.id)) return res.status(404).json({ error: 'Library item not found.' });
    res.json({ ok: true });
  } catch (e) { res.status(personalStatus(e)).json({ error: e.message }); }
}));

// ---------- memories (auth-derived user) ----------
app.get('/api/permission-grants', requireAuth(async(req,res)=>{try{res.json({grants:await store.listPermissionGrants(req.user.id)});}catch{res.status(503).json({error:'Could not load permission grants.'});}}));
app.post('/api/permission-grants', rateLimit(30,60000), requireAuth(async(req,res)=>{try{res.json({grant:await store.createPermissionGrant(req.user.id,req.body || {})});}catch(e){res.status(400).json({error:e.message});}}));
app.delete('/api/permission-grants/:id', requireAuth(async(req,res)=>{try{res.json(await store.revokePermissionGrant(req.user.id,req.params.id));}catch{res.status(503).json({error:'Could not revoke grant.'});}}));
app.get('/api/agent-permissions', requireAuth(async (req,res) => {
  try {res.json({permissions:await store.getAgentPermissions(req.user.id)});}
  catch(e){res.status(503).json({error:'Could not load permission settings.'});}
}));
app.put('/api/agent-permissions', requireAuth(async (req,res) => {
  const {web,connectors}=req.body || {};
  if((web!==undefined && !['ask_some','always_ask'].includes(web)) || (connectors!==undefined && !['ask_some','always_ask'].includes(connectors)))return res.status(400).json({error:'Invalid permission mode.'});
  try {res.json({permissions:await store.setAgentPermissions(req.user.id,{web,connectors})});}
  catch(e){res.status(503).json({error:'Could not save permission settings.'});}
}));
app.get('/api/memories', requireAuth(async (req, res) => {
  const query=String(req.query.q || '').slice(0,300),limit=Math.min(Math.max(Number(req.query.limit) || 250,1),1000),offset=Math.max(Number(req.query.offset) || 0,0);
  const [memories,stats]=await Promise.all([query?store.searchMemories(req.user.id,query,limit):store.listMemories(req.user.id,{limit,offset}),store.memoryStats(req.user.id)]);
  res.json({ memories, total:stats.active, query, offset });
}));
app.post('/api/memories', rateLimit(30,60000), requireAuth(async (req, res) => {
  const { text, category, importance } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  try { res.json({ memory: await store.addMemory(req.user.id,String(text),'user',{category,importance}) }); }
  catch(e) { res.status(e.code === 'PERSISTENCE' ? 503 : 400).json({ error:e.message }); }
}));
app.post('/api/memories/import', rateLimit(5,60000), requireAuth(async (req,res) => {
  const entries=req.body?.memories;
  if(!Array.isArray(entries) || entries.length<1 || entries.length>100)return res.status(400).json({error:'Choose 1 to 100 memories to import.'});
  try {
    const saved=[],seen=new Set();
    for(const item of entries){
      const text=String(typeof item==='string'?item:item?.text || '').trim().slice(0,2000);
      const key=text.toLowerCase();if(!text || seen.has(key))continue;seen.add(key);
      const category=['user','long_term','daily'].includes(item?.category)?item.category:'long_term';
      saved.push(await store.addMemory(req.user.id,text,'user_import',{category,importance:2}));
    }
    res.json({imported:saved.length});
  } catch(e){res.status(e.code==='PERSISTENCE'?503:400).json({error:e.message});}
}));
app.patch('/api/memories/:id', rateLimit(30,60000), requireAuth(async(req,res)=>{
  try{res.json({memory:await store.updateMemory(req.user.id,req.params.id,{text:req.body?.text,category:req.body?.category,importance:req.body?.importance,src:'user_edit'})});}
  catch(e){res.status(e.code==='NOT_FOUND'?404:e.code==='PERSISTENCE'?503:400).json({error:e.message});}
}));
app.delete('/api/memories/:id', requireAuth(async (req, res) => {
  try{const count=await store.delMemory(req.user.id,req.params.id);if(!count)return res.status(404).json({error:'Memory not found.'});res.json({ok:true,deleted:count});}
  catch(e){res.status(e.code==='PERSISTENCE'?503:400).json({error:e.message});}
}));

// ---------- the owner's own connectors: APIs and MCP servers they add ----------
// The credential is saved to the vault; responses carry only its ref.
const connectorFailure = (res, e) => {
  const status = ['BAD_INPUT', 'AUTH_FAILED', 'HOST_BLOCKED', 'CHECK_FAILED', 'MCP_ERROR', 'UNREACHABLE'].includes(e.code) ? 400
    : e.code === 'NOT_FOUND' ? 404 : ['NOT_ENCRYPTED', 'PERSISTENCE', 'NOT_SET_UP'].includes(e.code) ? 503 : 502;
  res.status(status).json({ error: e.message || 'Connector request failed.' });
};
app.get('/api/connectors', requireAuth(async (req, res) => {
  try { res.json({ connectors: await connectors.list(req.user.id), available: true }); }
  catch (e) {
    if (e.code === 'NOT_SET_UP') return res.json({ connectors: [], available: false, error: e.message });
    connectorFailure(res, e);
  }
}));
app.post('/api/connectors', rateLimit(10, 60000), requireAuth(async (req, res) => {
  try { res.json(await connectors.create(req.user.id, req.body || {}, { signal: requestSignal(req) })); }
  catch (e) { connectorFailure(res, e); }
}));
app.post('/api/connectors/:id/check', rateLimit(20, 60000), requireAuth(async (req, res) => {
  try { res.json({ connector: await connectors.refresh(req.user.id, req.params.id, { signal: requestSignal(req) }) }); }
  catch (e) { connectorFailure(res, e); }
}));
app.put('/api/connectors/:id/secret', rateLimit(10, 60000), requireAuth(async (req, res) => {
  try { res.json(await connectors.replaceSecret(req.user.id, req.params.id, req.body?.secret, { signal: requestSignal(req) })); }
  catch (e) { connectorFailure(res, e); }
}));
app.put('/api/connectors/:id/permissions', rateLimit(60, 60000), requireAuth(async (req, res) => {
  try { res.json({ connector: await connectors.setPermissions(req.user.id, req.params.id, req.body?.disabled) }); }
  catch (e) { connectorFailure(res, e); }
}));
app.delete('/api/connectors/:id', rateLimit(30, 60000), requireAuth(async (req, res) => {
  try { res.json({ ok: true, ...(await connectors.remove(req.user.id, req.params.id)) }); }
  catch (e) { connectorFailure(res, e); }
}));

// ---------- vault secrets ----------
const vaultFailure = (res, e) => res.status(e.code === 'NOT_ENCRYPTED' || e.code === 'PERSISTENCE' ? 503 : 400).json({ error: e.message || 'Vault request failed.' });
app.get('/api/secrets', requireAuth(async (req, res) => {
  try { res.json({ secrets: await store.listSecrets(req.user.id), encrypted: store.secretsEncrypted() }); }
  catch (e) { vaultFailure(res, e); }
}));
app.post('/api/secrets', requireAuth(async (req, res) => {
  const { name, value } = req.body || {};
  // Collapse whitespace so an agent vault_request finds the name it asked for.
  const label = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!label || typeof value !== 'string' || !value) return res.status(400).json({ error: 'name + value required' });
  if (value.length > 4000) return res.status(400).json({ error: 'That value is too long to store (4,000 characters max).' });
  try { res.json({ secret: await store.addSecret(req.user.id, label, value) }); }
  catch (e) { vaultFailure(res, e); }
}));
app.post('/api/secrets/:id/reveal', requireAuth(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const v = await store.revealSecret(req.user.id, req.params.id);
    if (!v) return res.status(404).json({ error: 'not found' });
    res.json({ value: v });
  } catch (e) { vaultFailure(res, e); }
}));
app.delete('/api/secrets/:id', requireAuth(async (req, res) => {
  try { await store.delSecret(req.user.id, req.params.id); res.json({ ok: true }); }
  catch (e) { vaultFailure(res, e); }
}));

// ---------- live browser: REST + WS frame stream ----------
const live = require('./agents/live');
const pc = require('./agents/pc');
app.post('/api/live/takeover', requireAuth(async (req, res) => {
  const { liveId, id, on } = req.body || {};
  const key = String(liveId || id || '');
  const bs = live.owned(key, req.user.id);
  if (bs) return res.json(live.takeOver(bs, on));
  return res.status(404).json({ error: 'live session not found (expired?)' });
}));
app.post('/api/live/input', requireAuth(async (req, res) => {
  const { liveId, ev } = req.body || {};
  const s = live.owned(String(liveId || ''), req.user.id);
  if (!s) return res.status(404).json({ error: 'live session not found (expired?)' });
  try {
    res.json(await live.input(s, ev || {}));
  } catch (e) {
    res.status(e.code === 'NO_CONTROL' ? 409 : 500).json({ error: e.message });
  }
}));
app.post('/api/live/stop', requireAuth(async (req, res) => {
  const { liveId } = req.body || {};
  const s = live.owned(String(liveId || ''), req.user.id);
  if (s) await live.stop(s);
  res.json({ ok: true });
}));

// ---------- live computer: read-only terminal compatibility endpoints ----------
// SECURITY: user-supplied code is never executed — node:vm is not a sandbox.
app.post('/api/pc/run', rateLimit(30, 60000), requireAuth(async (req, res) => {
  res.status(501).json({ error: 'Code execution is disabled on this deployment.' });
}));
app.post('/api/pc/input', rateLimit(30, 60000), requireAuth(async (req, res) => {
  res.status(501).json({ error: 'Code execution is disabled on this deployment.' });
}));

// ---------- static frontend ----------
const APP_DIR = path.join(__dirname, '..', 'app');
app.use('/lingon', express.static(APP_DIR));
app.use(express.static(APP_DIR, { extensions: ['html'] }));
// SEO pretty URLs for landing sub-pages (also served as *.html via static).
for (const p of ['terms', 'privacy', 'security', 'cookies', 'models', 'pricing', 'promo']) {
  app.get('/' + p, (req, res) => res.sendFile(path.join(APP_DIR, p + '.html')));
}
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(APP_DIR, 'index.html'));
});

const http = require('http');
const { WebSocketServer } = require('ws');
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  try {
    const u = new URL(req.url, 'http://x');
    // The VM relay authenticates with a short-lived, session-scoped token,
    // not a user JWT. It only connects outbound from the private VM; the
    // server never opens a port on the VM.
    if (u.pathname.startsWith('/ws/live-vm/')) {
      const id = decodeURIComponent(u.pathname.split('/').pop() || '');
      const relay = live.get(id);
      const relayToken = u.searchParams.get('token') || '';
      if (!relay || !live.relayAuthorized(id, relayToken)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return socket.destroy();
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        // attachRelay is called again with the actual ws after the upgrade so
        // the relay message handlers can bind to this exact connection.
        live.attachRelay(id, relayToken, ws);
        ws.on('message', (data, isBinary) => live.onRelayMessage(relay, ws, data, isBinary));
        ws.on('close', () => live.relayClosed(relay, ws));
        ws.on('error', () => live.relayClosed(relay, ws));
      });
      return;
    }
    const { getUserFromRequest } = require('./auth');
    const token = u.searchParams.get('token') || '';
    const user = await getUserFromRequest({ headers: { authorization: 'Bearer ' + token } });
    if (u.pathname.startsWith('/ws/pc/')) {
      const id = u.pathname.split('/').pop();
      const s = user && pc.owned(id, user.id);
      if (!s) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
      wss.handleUpgrade(req, socket, head, (ws) => {
        s.viewers.add(ws);
        s.lastActive = Date.now();
        ws.on('close', () => s.viewers.delete(ws));
        ws.send(JSON.stringify({ hello: s.pcId, log: s.log.slice(-14) }));
      });
      return;
    }
    if (!u.pathname.startsWith('/ws/live/')) return socket.destroy();
    const id = u.pathname.split('/').pop();
    const s = user && live.owned(id, user.id);
    if (!s) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
      wss.handleUpgrade(req, socket, head, (ws) => {
        s.viewers.add(ws);
        s.lastActive = Date.now();
        ws.on('close', () => s.viewers.delete(ws));
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          let msg;
          try { msg = JSON.parse(String(data)); } catch { return; }
          if (msg.type !== 'input' || !msg.ev) return;
          // Browser input is still account-scoped and takeover-gated inside
          // live.input. WS input avoids a REST round-trip for every pointer
          // move while the REST endpoint remains a compatibility path.
          live.input(s, msg.ev).then((out) => {
            try { ws.readyState === 1 && ws.send(JSON.stringify({ type: 'input_ack', url: out?.url || s.url, title: out?.title || s.title })); } catch {}
          }).catch((error) => {
            try { ws.readyState === 1 && ws.send(JSON.stringify({ type: 'input_error', error: String(error.message || error).slice(0, 240) })); } catch {}
          });
        });
        ws.send(JSON.stringify({ hello: s.id, url: s.url, title: s.title, kind: s.kind || 'browser', transport: s.transport }));
      // Compatibility only: a live relay sends binary screencast frames as
      // soon as it connects. This poster helps older/fallback sessions paint.
      live.screenshot(s).then(
        (buf) => { try { buf && ws.readyState === 1 && ws.send(JSON.stringify({ frame: buf.toString('base64') })); } catch {} },
        () => {}
      );
    });
  } catch {
    try { socket.destroy(); } catch {}
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Lingon real backend on http://localhost:${PORT}`);
  console.log(`- Foundry: ${isConfigured() ? 'configured (' + MODEL_DEFAULT + ', reasoning ' + REASONING_EFFORT + ')' : 'MISSING — set AZURE_FOUNDRY_PROJECT_ENDPOINT and AZURE_FOUNDRY_API_KEY in .env'}`);
  console.log(`- Supabase: ${store.supaConfigured() ? 'configured' : 'local JSON fallback (server/data.json)'}`);
  Automations.startAutomationWorker();
  conversation.startWorker();
  azure.startIdleWatcher();
});
