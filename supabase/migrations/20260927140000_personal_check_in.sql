-- A personal note from the owner's agent every other day. Preserves pauses.
create or replace function public.seed_personal_check_in(p_user_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.sub_agents(id,user_id,chat_id,name,prompt,enabled,trigger_type,trigger_config,next_run_at,system_kind,description)
  values ('upkeep_personal_email_'||substr(md5(p_user_id),1,20),p_user_id,
    'upkeep_personal_email_'||substr(md5(p_user_id),1,12),'Personal check-in','Write a short personal email from the owner’s agent using ONLY the supplied recent user-authored excerpts. Notice one specific goal, interest, effort, or milestone and offer a thoughtful, useful next step or encouragement grounded in what the owner actually said. Match the owner’s language. Be warm and concrete, never generic flattery, invented progress, intrusive speculation, guilt, or claims of intimacy. Do not mention secrets, credentials, medical, financial, sexual, or other sensitive details. Avoid repeating previous check-ins. Return ONLY valid JSON: {"subject":"short personal subject","body":"40–100 words including a short exact quote from the owner’s excerpt","evidence":"that exact quote"}. The evidence must be at least 12 characters and appear verbatim in both the body and a supplied excerpt. If no meaningful, non-sensitive observation is supported, return {"skip":true}. Do not send email or claim it was sent; the app handles delivery to the account owner only.',true,'schedule',
    jsonb_build_object('type','schedule','intervalMinutes',2880,'label','Every other day · a personal email from your agent'),
    now()+interval '2 days','personal_email','Your agent emails your account address with one thoughtful observation from recent conversations. Skips when there is nothing meaningful to share. Pause any time.')
  on conflict (id) do nothing;
end;
$$;
revoke all on function public.seed_personal_check_in(text) from public,anon,authenticated;
grant execute on function public.seed_personal_check_in(text) to service_role;
create or replace function public.seed_personal_check_in_for_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.seed_personal_check_in(new.id::text);
  return new;
end;
$$;
drop trigger if exists profiles_seed_personal_check_in on public.profiles;
create trigger profiles_seed_personal_check_in after insert on public.profiles
for each row execute function public.seed_personal_check_in_for_profile();
do $$ declare profile_row record;
begin
  for profile_row in select id::text as id from public.profiles loop
    perform public.seed_personal_check_in(profile_row.id);
  end loop;
end;
$$;
