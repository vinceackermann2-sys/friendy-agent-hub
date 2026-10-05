/* Real Supabase Auth — backend verification.
   Frontend authenticates via POST /api/auth/* (proxy, so Supabase keys stay
   server-side). All stateful endpoints require a valid Supabase JWT and derive
   user_id from the verified token — client-supplied userId is ignored. */
const { createClient } = require('@supabase/supabase-js');
const { accountDeletionPending } = require('./account-deletion');

function url() { return (process.env.SUPABASE_URL || '').trim(); }
function pubKey() {
  return (process.env.SUPABASE_ANON_KEY || '').trim() || (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
}
function secKey() {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || (process.env.SUPABASE_SECRET_KEY || '').trim();
}
function pubClient() {
  if (!url() || !pubKey()) return null;
  return createClient(url(), pubKey());
}
function adminClient() {
  if (!url() || !secKey()) return null;
  return createClient(url(), secKey());
}

async function getUserFromRequest(req) {
  const h = req.headers.authorization || '';
  const token = h.replace(/^Bearer\s+/i, '').trim();
  // GitHub PATs (ghp_/github_pat_) are NOT Supabase JWTs — skip auth for those routes.
  if (!token || /^(ghp_|github_pat_)/.test(token)) return null;
  // Short local ids (u_xxx, local) are not JWTs.
  if (!token.includes('.')) return null;
  const c = pubClient() || adminClient();
  if (!c) return null;
  try {
    const { data, error } = await c.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

function requireAuth(handler, { allowDeleting = false } = {}) {
  return async (req, res, next) => {
    try {
      const user = await getUserFromRequest(req);
      if (!user) return res.status(401).json({ error: 'Sign in required.' });
      if (!allowDeleting) {
        let deleting;
        try { deleting = await accountDeletionPending(user.id, adminClient()); }
        catch { return res.status(503).json({error:'Account cleanup status unavailable. Please try again.'}); }
        if (deleting) return res.status(409).json({error:'Account deletion is pending. Retry deletion or contact support@belna.se.'});
      }
      req.user = user;
      // The edge shim defers large uploads until authentication succeeds.
      await req.readBody?.();
      return await handler(req, res);
    } catch (error) {
      // Express 4 does not catch rejected route promises.
      return next(error);
    }
  };
}

module.exports = { pubClient, adminClient, getUserFromRequest, requireAuth };
