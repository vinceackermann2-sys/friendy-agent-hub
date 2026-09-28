// Public Whop endpoint. Authentication is the Standard Webhooks HMAC, never a
// browser session. Store only identifiers, then let the recovery worker read
// current card state from Whop before changing purchase status.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { verifyWhopWebhook } from '../../../src/lingon-server/whop-webhook.js';

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status:405 });
  const secret = Deno.env.get('WHOP_WEBHOOK_SECRET') || '';
  if (!secret) return new Response('Wallet webhook is not configured', { status:503 });
  let event;
  try {
    const raw = await req.text();
    event = await verifyWhopWebhook(raw, Object.fromEntries(req.headers), secret);
  } catch { return new Response('Invalid signature', { status:401 }); }
  if (!/^card_transaction\.(created|completed|declined|updated|reversed)$/.test(event.type))
    return Response.json({ ok:true, ignored:true });
  const accountId = event.account_id || event.company_id;
  const cardId = event.data?.card_id;
  if (!/^biz_[A-Za-z0-9]+$/.test(accountId || '') || !/^icrd_[A-Za-z0-9]+$/.test(cardId || ''))
    return new Response('Incomplete card event', { status:400 });
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('Wallet queue is not configured', { status:503 });
  const db = createClient(url,key,{ auth:{ persistSession:false, autoRefreshToken:false } });
  const { error } = await db.from('belna_wallet_webhook_events').insert({
    id:event.id, account_id:accountId, card_id:cardId
  });
  if (error && error.code !== '23505') return new Response('Wallet queue unavailable', { status:503 });
  return Response.json({ ok:true });
});
