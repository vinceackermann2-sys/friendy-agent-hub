-- The personal check-in emails quotes from the owner's conversations, so it is off until
-- the owner turns it on in Automations. New accounts get it paused; the routines seeded on
-- for existing accounts are paused unless they have already run.
create or replace function public.seed_personal_check_in(p_user_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.sub_agents(id,user_id,chat_id,name,prompt,enabled,trigger_type,trigger_config,next_run_at,system_kind,description)
  values ('upkeep_personal_email_'||substr(md5(p_user_id),1,20),p_user_id,
    'upkeep_personal_email_'||substr(md5(p_user_id),1,12),'Personal check-in','Write a short personal email from the owner’s agent using ONLY the supplied recent user-authored excerpts. Notice one specific goal, interest, effort, or milestone and offer a thoughtful, useful next step or encouragement grounded in what the owner actually said. Match the owner’s language. Be warm and concrete, never generic flattery, invented progress, intrusive speculation, guilt, or claims of intimacy. Do not mention secrets, credentials, medical, financial, sexual, or other sensitive details. Avoid repeating previous check-ins. Return ONLY valid JSON: {"subject":"short personal subject","body":"40–100 words including a short exact quote from the owner’s excerpt","evidence":"that exact quote"}. The evidence must be at least 12 characters and appear verbatim in both the body and a supplied excerpt. If no meaningful, non-sensitive observation is supported, return {"skip":true}. Do not send email or claim it was sent; the app handles delivery to the account owner only.',false,'schedule',
    jsonb_build_object('type','schedule','intervalMinutes',2880,'label','Every other day · a personal email from your agent'),
    now()+interval '2 days','personal_email','Your agent emails your account address with one thoughtful observation from recent conversations. Off until you turn it on; skips when there is nothing meaningful to share.')
  on conflict (id) do nothing;
end;
$$;
revoke all on function public.seed_personal_check_in(text) from public,anon,authenticated;
grant execute on function public.seed_personal_check_in(text) to service_role;

update public.sub_agents
set enabled = false,
    description = 'Your agent emails your account address with one thoughtful observation from recent conversations. Off until you turn it on; skips when there is nothing meaningful to share.'
where system_kind = 'personal_email' and last_run_at is null;
