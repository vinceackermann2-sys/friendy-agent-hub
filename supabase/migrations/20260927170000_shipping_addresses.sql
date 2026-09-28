create table if not exists public.belna_shipping_addresses (
 id text primary key,
 user_id text not null references public.profiles(id) on delete cascade,
 label text not null,
 recipient text not null,
 line1 text not null,
 line2 text not null default '',
 city text not null,
 region text not null default '',
 postal_code text not null,
 country text not null check (country ~ '^[A-Z]{2}$'),
 is_default boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.belna_shipping_addresses enable row level security;
revoke all on public.belna_shipping_addresses from anon, authenticated;
grant all on public.belna_shipping_addresses to service_role;
create index if not exists shipping_address_owner on public.belna_shipping_addresses(user_id);
create unique index if not exists shipping_address_default on public.belna_shipping_addresses(user_id) where is_default;
create or replace function public.save_shipping_address(p_user_id text,p_address jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_count integer; v_owner text; v_default boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id,492120));
 select user_id into v_owner from public.belna_shipping_addresses where id=p_address->>'id';
 if found and v_owner<>p_user_id then raise exception 'ADDRESS_NOT_FOUND'; end if;
 select count(*) into v_count from public.belna_shipping_addresses where user_id=p_user_id;
 if v_owner is null and v_count>=10 then raise exception 'ADDRESS_LIMIT'; end if;
 v_default := coalesce((p_address->>'is_default')::boolean,false) or v_count=0
   or not exists(select 1 from public.belna_shipping_addresses where user_id=p_user_id and is_default and id<>p_address->>'id');
 if v_default then update public.belna_shipping_addresses set is_default=false where user_id=p_user_id; end if;
 insert into public.belna_shipping_addresses(id,user_id,label,recipient,line1,line2,city,region,postal_code,country,is_default)
 values(p_address->>'id',p_user_id,p_address->>'label',p_address->>'recipient',p_address->>'line1',coalesce(p_address->>'line2',''),p_address->>'city',coalesce(p_address->>'region',''),p_address->>'postal_code',p_address->>'country',v_default)
 on conflict(id) do update set label=excluded.label,recipient=excluded.recipient,line1=excluded.line1,line2=excluded.line2,city=excluded.city,region=excluded.region,postal_code=excluded.postal_code,country=excluded.country,is_default=excluded.is_default
 where belna_shipping_addresses.user_id=p_user_id;
end $$;
create or replace function public.delete_shipping_address(p_user_id text,p_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id,492120));
 delete from public.belna_shipping_addresses where user_id=p_user_id and id=p_id;
 if not exists(select 1 from public.belna_shipping_addresses where user_id=p_user_id and is_default) then
  update public.belna_shipping_addresses set is_default=true where id=(select id from public.belna_shipping_addresses where user_id=p_user_id order by created_at,id limit 1);
 end if;
end $$;
revoke all on function public.save_shipping_address(text,jsonb),public.delete_shipping_address(text,text) from public,anon,authenticated;
grant execute on function public.save_shipping_address(text,jsonb),public.delete_shipping_address(text,text) to service_role;
