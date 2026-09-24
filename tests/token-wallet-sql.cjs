const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.profiles(id text primary key);
    create table public.api_usage(
      id text primary key,user_id text not null references public.profiles(id),
      model text,prompt_tokens bigint,candidates_tokens bigint,total_tokens bigint,
      cost_usd double precision,credits_charged double precision
    );
    create table public.credit_grants(
      id text primary key,user_id text not null references public.profiles(id),
      credits double precision,reason text,ref text,created_at timestamptz default now(),unique(user_id,ref)
    );
    create table public.subscriptions(
      user_id text primary key references public.profiles(id),plan text,status text,current_period_end timestamptz
    );
    create table public.gift_cards(
      code text primary key,amount_usd double precision,redeemed_by text,to_user text,redeemed_at timestamptz
    );
    create table public.referral_codes(user_id text primary key,code text unique);
    create table public.referrals(
      id text primary key,code text,inviter_id text,redeemer_id text unique,
      inviter_credits double precision,redeemer_credits double precision
    );
    create table public.agent_vm_instances(
      user_id text primary key references public.profiles(id),power_state text,last_metered_at timestamptz
    );
    insert into public.profiles values('u1'),('u2'),('u3'),('u4');
    insert into public.gift_cards(code,amount_usd) values('GIFT50',50);
    insert into public.credit_grants(id,user_id,credits,reason,ref)
      values('legacy-gift','u3',100,'gift_redeem','backfill:legacy');
    insert into public.referral_codes(user_id,code) values('u1','REF-U1'),('u3','REF-U3');
  `);
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260923095000_monthly_token_wallet.sql'), 'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260923120000_invite_tokens_once.sql'), 'utf8'));
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  await q(`insert into public.token_grants(id,user_id,tokens,remaining,reason,ref,expires_at)
    values('plan1','u1',50000000,50000000,'plan','free:2026-09',now()+interval '1 day')`);
  assert.equal((await q("select remaining from public.token_wallet_status('u1')"))[0].remaining, 50000000);
  assert.equal((await q("select public.claim_token_daily('u1','image',1,'img1') ok"))[0].ok, true);
  assert.equal((await q("select public.claim_token_daily('u1','image',1,'img2') ok"))[0].ok, false);
  await q("select public.charge_raw_tokens('usage1','u1','gpt-image-2',100,15000,15100,0.225,false,'img1')");
  assert.equal((await q("select remaining,images_today from public.token_wallet_status('u1')"))[0].remaining, 49984900);
  await q("select public.charge_raw_tokens('usage1','u1','gpt-image-2',100,15000,15100,0.225,false,'img1')");
  assert.equal((await q("select remaining from public.token_wallet_status('u1')"))[0].remaining, 49984900,
    'replayed provider usage cannot charge twice');
  assert.equal((await q("select ok from public.redeem_gift_card('u2','GIFT50')"))[0].ok, true);
  assert.equal((await q("select remaining from public.token_wallet_status('u2')"))[0].remaining, 1000000);
  assert.equal((await q("select remaining from public.token_wallet_status('u3')"))[0].remaining, 1000000,
    'legacy gift credit grant without a redeemed card converts to tokens');
  await q("select public.charge_raw_tokens('overage','u3','gpt-6-luna',0,1000001,1000001,0.51,false,null)");
  assert.equal((await q("select remaining from public.token_wallet_status('u3')"))[0].remaining, 0);
  assert.equal((await q("select public.claim_token_daily('u3','image',5,'blocked') ok"))[0].ok, false,
    'a depleted account cannot start another image request');
  const referral = (await q("select public.redeem_referral('u2','REF-U1') result"))[0].result;
  assert.equal(referral.ok, true);
  assert.equal(referral.tokens, 10000000);
  assert.equal(referral.inviterTokens, 10000000);
  assert.equal((await q("select remaining from public.token_wallet_status('u2')"))[0].remaining, 11000000);
  assert.equal((await q("select tokens from public.token_grants where user_id='u1' and reason='referral'"))[0].tokens, 10000000);
  assert.equal((await q("select count(*)::int n from public.credit_grants where reason like 'referral_%'"))[0].n, 0,
    'new invites add tokens without legacy credits');
  assert.match((await q("select public.redeem_referral('u4','REF-U1') result"))[0].result.error, /already been used/,
    'one code can reward only one friend');
  assert.match((await q("select public.redeem_referral('u2','REF-U3') result"))[0].result.error, /already redeemed/,
    'one account cannot claim another invite');
  await q("insert into public.agent_vm_instances(user_id,power_state,last_metered_at) values('u1','running',now()-interval '1 hour')");
  const vmTokens = (await q("select public.meter_agent_vm_runtime('u1',0.06,false) tokens"))[0].tokens;
  assert.ok(vmTokens >= 300000 && vmTokens < 301000, 'one VM hour uses roughly 300k tokens');
  assert.equal((await q("select tokens_charged from public.api_usage where model='azure-vm'"))[0].tokens_charged, vmTokens);
  await db.close();
  console.log('token wallet SQL: monthly grants, daily caps, idempotent charges, gifts and referrals: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
