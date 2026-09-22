-- Belna referral gift migration: dual-sided FREE $50 gift card ($25 each as credits).
-- Tracked migration for `supabase db push`; DDL is safe to re-run manually.
--
-- How it works (matches server/store.js):
--   1. referral_codes holds one stable code per user (BELNA-XXXXXX).
--   2. referrals records each unique friend redeem (code + redeemer).
--   3. Friend redeem grants 50 credits to the friend + 50 credits to the
--      inviter (2 credits per $1 face, same rate as Stripe $50 gift cards).
--   4. Inviter is credited ONLY after the friend redeems; one reward per
--      unique friend (UNIQUE(code, redeemer_id)); no self-redeem (API-level).

create table if not exists referral_codes (
  user_id text primary key references profiles(id) on delete cascade,
  code text unique not null,
  created_at timestamptz default now()
);
create index if not exists referral_codes_code_idx on referral_codes(code);

create table if not exists referrals (
  id text primary key,
  code text not null,
  inviter_id text not null references profiles(id) on delete cascade,
  redeemer_id text not null references profiles(id) on delete cascade,
  inviter_credits double precision not null default 50,
  redeemer_credits double precision not null default 50,
  created_at timestamptz default now(),
  unique(code, redeemer_id)
);
create index if not exists referrals_inviter_idx on referrals(inviter_id, created_at desc);
create index if not exists referrals_redeemer_idx on referrals(redeemer_id);

alter table referral_codes enable row level security;
alter table referrals enable row level security;
