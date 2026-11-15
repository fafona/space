-- Additive, isolated visitor messaging. Never changes the account peer inbox,
-- membership tables, published pages or prior local-only visitor messages.
begin;

create table public.merchant_guest_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  guest_number text not null unique check (guest_number ~ '^[1-9][0-9]{7}$'),
  creation_ip_hash text not null check (creation_ip_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);
create index merchant_guest_chat_session_rate_idx on public.merchant_guest_chat_sessions(creation_ip_hash, created_at);
create table public.merchant_guest_chat_threads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.merchant_guest_chat_sessions(id) on delete restrict,
  site_id text not null check (site_id ~ '^[0-9]{8}$'),
  guest_read_through bigint not null default 0,
  merchant_read_through bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, site_id)
);
create index merchant_guest_chat_threads_site_idx on public.merchant_guest_chat_threads(site_id, updated_at desc, id);
create table public.merchant_guest_chat_messages (
  sequence bigint generated always as identity primary key,
  thread_id uuid not null references public.merchant_guest_chat_threads(id) on delete restrict,
  sender text not null check (sender in ('guest','merchant')),
  request_id uuid not null,
  text text not null check (length(btrim(text)) between 1 and 5000),
  sender_principal text null,
  created_at timestamptz not null default now(),
  unique(thread_id, sender, request_id),
  check ((sender = 'guest' and sender_principal is null) or (sender = 'merchant' and length(sender_principal) between 1 and 160))
);
create index merchant_guest_chat_messages_thread_idx on public.merchant_guest_chat_messages(thread_id, sequence desc);
create index merchant_guest_chat_messages_rate_idx on public.merchant_guest_chat_messages(thread_id, sender, created_at);

alter table public.merchant_guest_chat_sessions enable row level security;
alter table public.merchant_guest_chat_threads enable row level security;
alter table public.merchant_guest_chat_messages enable row level security;
revoke all on public.merchant_guest_chat_sessions, public.merchant_guest_chat_threads, public.merchant_guest_chat_messages from public, anon, authenticated;
grant select on public.merchant_guest_chat_sessions, public.merchant_guest_chat_threads, public.merchant_guest_chat_messages to service_role;

create function public.merchant_guest_chat_create_session(p_token_hash text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.merchant_guest_chat_sessions; i integer;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'guest_chat_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('guest-chat-create:' || p_ip_hash, 0));
  select * into s from public.merchant_guest_chat_sessions where token_hash = p_token_hash and expires_at > now();
  if found then return jsonb_build_object('id',s.id,'guestNumber',s.guest_number); end if;
  if (select count(*) from public.merchant_guest_chat_sessions where creation_ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 20 then raise exception 'guest_chat_rate_limited'; end if;
  for i in 1..12 loop
    insert into public.merchant_guest_chat_sessions(token_hash, guest_number, creation_ip_hash)
      values(p_token_hash, (10000000 + floor(random() * 90000000)::integer)::text, p_ip_hash)
      on conflict do nothing returning * into s;
    if found then return jsonb_build_object('id',s.id,'guestNumber',s.guest_number); end if;
  end loop;
  raise exception 'guest_chat_allocation_failed';
end $$;

create function public.merchant_guest_chat_send(p_site_id text, p_thread_id uuid, p_token_hash text, p_sender text, p_request_id uuid, p_text text, p_principal text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.merchant_guest_chat_sessions; t public.merchant_guest_chat_threads; old_text text;
begin
  if p_site_id !~ '^[0-9]{8}$' or p_request_id is null or p_text is null or length(btrim(p_text)) not between 1 and 5000 then raise exception 'guest_chat_invalid'; end if;
  if p_sender = 'guest' then
    select * into s from public.merchant_guest_chat_sessions where token_hash = p_token_hash and expires_at > now() for update;
    if not found then raise exception 'guest_chat_unauthorized'; end if;
    insert into public.merchant_guest_chat_threads(session_id, site_id) values(s.id,p_site_id) on conflict do nothing;
    select * into t from public.merchant_guest_chat_threads where session_id = s.id and site_id = p_site_id for update;
  elsif p_sender = 'merchant' and length(p_principal) between 1 and 160 then
    select * into t from public.merchant_guest_chat_threads where id = p_thread_id and site_id = p_site_id for update;
    if not found then raise exception 'guest_chat_not_found'; end if;
  else raise exception 'guest_chat_unauthorized'; end if;
  select text into old_text from public.merchant_guest_chat_messages where thread_id=t.id and sender=p_sender and request_id=p_request_id;
  if found then
    if old_text is distinct from btrim(p_text) then raise exception 'guest_chat_idempotency_conflict'; end if;
    return t.id;
  end if;
  if (select count(*) from public.merchant_guest_chat_messages where thread_id=t.id and sender=p_sender and created_at > now()-interval '1 minute') >= 20 then raise exception 'guest_chat_rate_limited'; end if;
  if p_sender='guest' and (select count(*) from public.merchant_guest_chat_messages m join public.merchant_guest_chat_threads th on th.id=m.thread_id where th.session_id=s.id and m.sender='guest' and m.created_at > now()-interval '1 day') >= 200 then raise exception 'guest_chat_rate_limited'; end if;
  insert into public.merchant_guest_chat_messages(thread_id,sender,request_id,text,sender_principal)
    values(t.id,p_sender,p_request_id,btrim(p_text),case when p_sender='merchant' then p_principal else null end);
  update public.merchant_guest_chat_threads set updated_at=now() where id=t.id;
  return t.id;
end $$;

create function public.merchant_guest_chat_mark_read(p_site_id text, p_thread_id uuid, p_token_hash text, p_reader text, p_through bigint)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare t public.merchant_guest_chat_threads; n bigint;
begin
  select * into t from public.merchant_guest_chat_threads where id=p_thread_id and site_id=p_site_id for update;
  if not found then raise exception 'guest_chat_not_found'; end if;
  if p_reader='guest' then
    if not exists(select 1 from public.merchant_guest_chat_sessions where id=t.session_id and token_hash=p_token_hash and expires_at>now()) then raise exception 'guest_chat_unauthorized'; end if;
  elsif p_reader is distinct from 'merchant' then raise exception 'guest_chat_unauthorized'; end if;
  select coalesce(max(sequence),0) into n from public.merchant_guest_chat_messages where thread_id=t.id and sequence<=p_through;
  if p_reader='guest' then update public.merchant_guest_chat_threads set guest_read_through=greatest(guest_read_through,n) where id=t.id;
  else update public.merchant_guest_chat_threads set merchant_read_through=greatest(merchant_read_through,n) where id=t.id; end if;
end $$;

create function public.merchant_guest_chat_list(p_site_id text, p_session_id uuid, p_thread_id uuid, p_reader text, p_offset integer)
returns table(id uuid, site_id text, guest_number text, updated_at timestamptz, unread bigint, last_message jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  select t.id,t.site_id,s.guest_number,t.updated_at,
    (select count(*) from public.merchant_guest_chat_messages m where m.thread_id=t.id
      and m.sender=case when p_reader='guest' then 'merchant' else 'guest' end
      and m.sequence>case when p_reader='guest' then t.guest_read_through else t.merchant_read_through end),
    (select jsonb_build_object('id',m.sequence::text,'requestId',m.request_id,'sender',m.sender,'text',m.text,'createdAt',m.created_at)
      from public.merchant_guest_chat_messages m where m.thread_id=t.id order by m.sequence desc limit 1)
  from public.merchant_guest_chat_threads t join public.merchant_guest_chat_sessions s on s.id=t.session_id
  where t.site_id=p_site_id and (p_session_id is null or t.session_id=p_session_id)
    and (p_thread_id is null or t.id=p_thread_id)
  order by t.updated_at desc,t.id limit 51 offset least(greatest(p_offset,0),10000)
$$;
revoke all on function public.merchant_guest_chat_create_session(text,text), public.merchant_guest_chat_send(text,uuid,text,text,uuid,text,text), public.merchant_guest_chat_mark_read(text,uuid,text,text,bigint), public.merchant_guest_chat_list(text,uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.merchant_guest_chat_create_session(text,text), public.merchant_guest_chat_send(text,uuid,text,text,uuid,text,text), public.merchant_guest_chat_mark_read(text,uuid,text,text,bigint), public.merchant_guest_chat_list(text,uuid,uuid,text,integer) to service_role;
insert into public.faolla_schema_migrations(version,name) values (202611160215,'merchant_guest_chat');
notify pgrst, 'reload schema';
commit;
