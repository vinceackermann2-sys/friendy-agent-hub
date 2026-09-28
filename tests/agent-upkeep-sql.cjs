const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

(async()=>{
  const db=new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create function auth.uid() returns text language sql stable as $$ select 'user-a'::text $$; create table public.profiles(id text primary key); create table public.chats(id text primary key,user_id text not null references public.profiles(id),created_at timestamptz not null default now()); create table public.messages(id text primary key,chat_id text not null references public.chats(id),created_at timestamptz not null default now()); insert into public.profiles values('user-a');");
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260917213746_sub_agent_automations.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260922103000_agent_upkeep.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260927140000_personal_check_in.sql'),'utf8'));
  // The check-in was first seeded on; one that already ran keeps its setting, the rest are paused.
  await db.exec("insert into public.profiles values('user-ran'); update public.sub_agents set last_run_at=now() where user_id='user-ran' and system_kind='personal_email';");
  await db.exec(fs.readFileSync(require.resolve('../supabase/migrations/20260928160000_personal_check_in_opt_in.sql'),'utf8'));
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const first=await q("select system_kind,enabled from public.sub_agents where user_id='user-a' order by system_kind");
  assert.equal(first.length,8);
  assert.deepEqual(first.filter(row=>!row.enabled).map(row=>row.system_kind),['personal_email'],'the personal check-in is off until the owner turns it on');
  assert.equal((await q("select enabled from public.sub_agents where user_id='user-ran' and system_kind='personal_email'"))[0].enabled,true);
  assert.deepEqual(first.map(row=>row.system_kind),['ideas','memory','personal_email','quiet','reflection','relationships','skills','study']);
  await q("update public.sub_agents set enabled=false where user_id='user-a' and system_kind='memory'");
  await q("select public.seed_agent_upkeep('user-a')");
  assert.equal((await q("select enabled from public.sub_agents where user_id='user-a' and system_kind='memory'"))[0].enabled,false,'reseeding preserves user pause state');
  await q("insert into public.profiles values('user-b')");
  assert.equal((await q("select count(*)::integer n from public.sub_agents where user_id='user-b'"))[0].n,8,'new accounts receive upkeep automatically');
  assert.equal((await q("select enabled from public.sub_agents where user_id='user-b' and system_kind='personal_email'"))[0].enabled,false,'and their personal check-in starts off');
  await q("update public.sub_agents set enabled=false where user_id='user-a' and system_kind='personal_email'");
  await q("select public.seed_personal_check_in('user-a')");
  const personal=(await q("select enabled,trigger_config,next_run_at > now() + interval '47 hours' as delayed from public.sub_agents where user_id='user-a' and system_kind='personal_email'"))[0];
  assert.equal(personal.enabled,false);
  assert.equal(personal.trigger_config.intervalMinutes,2880);
  assert.equal(personal.delayed,true);
  await db.close();
  console.log('agent upkeep SQL: existing and new accounts get eight protected system routines: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
