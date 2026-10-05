import crypto from 'node:crypto';
import { adminClient } from './auth.js';

/* Rate limits that hold across edge instances (the in-memory limiter in index.js
   only sees one instance). Each check is one database call, so it guards only the
   public sign-in and form endpoints. Keys are hashed: they can contain an email.
   Until the hit_rate_limit migration is applied this allows the request. */
async function durableAllow(key, max, windowSeconds, { client = adminClient } = {}) {
  const admin = client();
  if (!admin) return true;
  const hashed = crypto.createHash('sha256').update(String(key)).digest('hex');
  try {
    const { data, error } = await admin.rpc('hit_rate_limit', { p_key: hashed, p_window_seconds: windowSeconds, p_max: max });
    if (error) throw error;
    return data !== false;
  } catch (error) {
    console.warn('[rate-limit] durable limit unavailable:', String(error?.code || error?.message || error).slice(0, 120));
    return true;
  }
}

// Every limit must pass; all are counted, so a blocked request still counts.
async function durableLimited(limits, options) {
  const results = await Promise.all(limits.map(([key, max, windowSeconds]) => durableAllow(key, max, windowSeconds, options)));
  return results.includes(false);
}

const normalEmail = (value) => String(value || '').trim().toLowerCase().slice(0, 254);

export { durableAllow, durableLimited, normalEmail };
