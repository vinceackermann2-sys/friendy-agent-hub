const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

(async()=>{
  const db=new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create function auth.uid() returns text language sql stable as $$ select 'user-a'::text $$; create table public.profiles(id text primary key); create table public.chats(id text primary key,user_id text not null references public.profiles(id),created_at timestamptz not null default now()); create table public.messages(id text primary key,chat_id text not null references public.chats(id),created_at timestamptz not null default now()); insert into public.profiles values('user-a');");
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260917213746_sub_agent_automations.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260922103000_agent_upkeep.sql'),'utf8'));
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const first=await q("select system_kind,enabled from public.sub_agents where user_id='user-a' order by system_kind");
  assert.equal(first.length,7);
  assert.deepEqual(first.map(row=>row.system_kind),['ideas','memory','quiet','reflection','relationships','skills','study']);
  await q("update public.sub_agents set enabled=false where user_id='user-a' and system_kind='memory'");
  await q("select public.seed_agent_upkeep('user-a')");
  assert.equal((await q("select enabled from public.sub_agents where user_id='user-a' and system_kind='memory'"))[0].enabled,false,'reseeding preserves user pause state');
  await q("insert into public.profiles values('user-b')");
  assert.equal((await q("select count(*)::integer n from public.sub_agents where user_id='user-b'"))[0].n,7,'new accounts receive upkeep automatically');
  await db.close();
  console.log('agent upkeep SQL: existing and new accounts get seven protected system routines: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
