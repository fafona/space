-- Conversation V1 shadow-write foundation.
-- Legacy JSON snapshots remain the only application read source. This migration
-- is additive and intentionally provides no authenticated direct-read policy.

begin;

create table if not exists public.merchant_conversation_threads (
  id text primary key,
  conversation_kind text not null
    check (conversation_kind in ('peer', 'support')),
  state text not null default 'active'
    check (state in ('active', 'archived')),
  site_id text null references public.merchants(id) on delete restrict,
  source_snapshot jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists merchant_conversation_threads_site_updated_idx
  on public.merchant_conversation_threads(site_id, updated_at desc)
  where site_id is not null;
create index if not exists merchant_conversation_threads_kind_state_idx
  on public.merchant_conversation_threads(conversation_kind, state, updated_at desc);

create table if not exists public.merchant_conversation_participants (
  thread_id text not null
    references public.merchant_conversation_threads(id) on delete restrict,
  account_id text not null,
  participant_role text not null
    check (participant_role in ('account', 'platform')),
  display_name text not null default '',
  email text not null default '',
  source_snapshot jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,
  primary key (thread_id, account_id)
);

create index if not exists merchant_conversation_participants_account_idx
  on public.merchant_conversation_participants(account_id, updated_at desc);

create table if not exists public.merchant_conversation_messages (
  thread_id text not null
    references public.merchant_conversation_threads(id) on delete restrict,
  id text not null,
  sender_account_id text not null,
  sender_role text not null
    check (sender_role in ('account', 'platform')),
  body text not null check (length(body) > 0),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  source_updated_at timestamptz not null,
  primary key (thread_id, id),
  constraint merchant_conversation_messages_sender_fk
    foreign key (thread_id, sender_account_id)
    references public.merchant_conversation_participants(thread_id, account_id)
    on delete restrict
);

create index if not exists merchant_conversation_messages_thread_created_idx
  on public.merchant_conversation_messages(thread_id, created_at asc, id asc);

create table if not exists public.merchant_conversation_contacts (
  owner_merchant_id text not null
    references public.merchants(id) on delete restrict,
  contact_account_id text not null,
  customer_id uuid null,
  contact_name text not null default '',
  contact_email text not null default '',
  source_snapshot jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,
  primary key (owner_merchant_id, contact_account_id),
  constraint merchant_conversation_contacts_customer_fk
    foreign key (owner_merchant_id, customer_id)
    references public.merchant_customers(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_conversation_contacts_customer_idx
  on public.merchant_conversation_contacts(owner_merchant_id, customer_id)
  where customer_id is not null;
create index if not exists merchant_conversation_contacts_saved_idx
  on public.merchant_conversation_contacts(owner_merchant_id, saved_at desc);

create table if not exists public.merchant_conversation_read_cursors (
  thread_id text not null
    references public.merchant_conversation_threads(id) on delete restrict,
  account_id text not null,
  last_read_at timestamptz not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,
  primary key (thread_id, account_id),
  constraint merchant_conversation_read_cursors_participant_fk
    foreign key (thread_id, account_id)
    references public.merchant_conversation_participants(thread_id, account_id)
    on delete restrict
);

create index if not exists merchant_conversation_read_cursors_account_idx
  on public.merchant_conversation_read_cursors(account_id, updated_at desc);

alter table public.merchant_conversation_threads enable row level security;
alter table public.merchant_conversation_participants enable row level security;
alter table public.merchant_conversation_messages enable row level security;
alter table public.merchant_conversation_contacts enable row level security;
alter table public.merchant_conversation_read_cursors enable row level security;

revoke all on table public.merchant_conversation_threads from anon, authenticated;
revoke all on table public.merchant_conversation_participants from anon, authenticated;
revoke all on table public.merchant_conversation_messages from anon, authenticated;
revoke all on table public.merchant_conversation_contacts from anon, authenticated;
revoke all on table public.merchant_conversation_read_cursors from anon, authenticated;

grant select, insert, update on table public.merchant_conversation_threads to service_role;
grant select, insert, update on table public.merchant_conversation_participants to service_role;
grant select, insert on table public.merchant_conversation_messages to service_role;
grant select, insert, update on table public.merchant_conversation_contacts to service_role;
grant select, insert, update on table public.merchant_conversation_read_cursors to service_role;

create or replace function public.faolla_upsert_merchant_conversations_v1(
  p_mutations jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_mutation jsonb;
  v_thread jsonb;
  v_participant jsonb;
  v_message jsonb;
  v_contact jsonb;
  v_cursor jsonb;
  v_archive jsonb;
  v_thread_id text;
  v_account_id text;
  v_owner_merchant_id text;
  v_contact_account_id text;
  v_customer_id uuid;
  v_source_updated_at timestamptz;
  v_created_at timestamptz;
  v_existing_sender_account_id text;
  v_existing_sender_role text;
  v_existing_body text;
  v_existing_created_at timestamptz;
  v_count integer := 0;
begin
  if p_mutations is null then
    return 0;
  end if;
  if jsonb_typeof(p_mutations) <> 'object' then
    raise exception 'invalid_conversation_mutation';
  end if;
  if p_mutations ? 'threads'
     and jsonb_typeof(p_mutations -> 'threads') <> 'array' then
    raise exception 'invalid_conversation_threads';
  end if;
  if p_mutations ? 'contacts'
     and jsonb_typeof(p_mutations -> 'contacts') <> 'array' then
    raise exception 'invalid_conversation_contacts';
  end if;
  if p_mutations ? 'read_cursors'
     and jsonb_typeof(p_mutations -> 'read_cursors') <> 'array' then
    raise exception 'invalid_conversation_read_cursors';
  end if;
  if p_mutations ? 'archived_threads'
     and jsonb_typeof(p_mutations -> 'archived_threads') <> 'array' then
    raise exception 'invalid_conversation_archived_threads';
  end if;

  for v_thread_mutation in
    select value
      from jsonb_array_elements(
        coalesce(p_mutations -> 'threads', '[]'::jsonb)
      )
  loop
    if jsonb_typeof(v_thread_mutation) <> 'object'
       or jsonb_typeof(v_thread_mutation -> 'thread') <> 'object' then
      raise exception 'invalid_conversation_thread_mutation';
    end if;
    v_thread := v_thread_mutation -> 'thread';
    v_thread_id := nullif(btrim(v_thread ->> 'id'), '');
    if v_thread_id is null then
      raise exception 'invalid_conversation_thread_id';
    end if;
    if coalesce(v_thread ->> 'conversation_kind', '') not in ('peer', 'support') then
      raise exception 'invalid_conversation_kind:%', v_thread_id;
    end if;
    if coalesce(v_thread ->> 'state', 'active') <> 'active' then
      raise exception 'invalid_conversation_active_state:%', v_thread_id;
    end if;
    if (v_thread ->> 'conversation_kind') = 'support'
       and nullif(btrim(v_thread ->> 'site_id'), '') is null then
      raise exception 'conversation_support_site_required:%', v_thread_id;
    end if;
    if (v_thread ->> 'conversation_kind') = 'peer'
       and nullif(btrim(v_thread ->> 'site_id'), '') is not null then
      raise exception 'conversation_peer_site_must_be_null:%', v_thread_id;
    end if;

    v_source_updated_at := coalesce(
      nullif(v_thread ->> 'source_updated_at', '')::timestamptz,
      now()
    );
    v_created_at := coalesce(
      nullif(v_thread ->> 'created_at', '')::timestamptz,
      v_source_updated_at
    );
    perform pg_advisory_xact_lock(
      hashtextextended('faolla-conversation:' || v_thread_id, 0)
    );

    insert into public.merchant_conversation_threads (
      id,
      conversation_kind,
      state,
      site_id,
      source_snapshot,
      source_updated_at,
      created_at,
      updated_at
    )
    values (
      v_thread_id,
      v_thread ->> 'conversation_kind',
      'active',
      nullif(btrim(v_thread ->> 'site_id'), ''),
      coalesce(v_thread -> 'source_snapshot', '{}'::jsonb),
      v_source_updated_at,
      v_created_at,
      coalesce(
        nullif(v_thread ->> 'updated_at', '')::timestamptz,
        v_source_updated_at
      )
    )
    on conflict (id) do update
    set
      conversation_kind = excluded.conversation_kind,
      state = 'active',
      site_id = excluded.site_id,
      source_snapshot = excluded.source_snapshot,
      source_updated_at = excluded.source_updated_at,
      created_at = least(
        merchant_conversation_threads.created_at,
        excluded.created_at
      ),
      updated_at = excluded.updated_at
    where excluded.source_updated_at >=
      merchant_conversation_threads.source_updated_at;

    if v_thread_mutation ? 'participants'
       and jsonb_typeof(v_thread_mutation -> 'participants') <> 'array' then
      raise exception 'invalid_conversation_participants:%', v_thread_id;
    end if;
    for v_participant in
      select value
        from jsonb_array_elements(
          coalesce(v_thread_mutation -> 'participants', '[]'::jsonb)
        )
    loop
      v_account_id := nullif(btrim(v_participant ->> 'account_id'), '');
      if v_account_id is null
         or nullif(btrim(v_participant ->> 'thread_id'), '') is distinct from v_thread_id then
        raise exception 'invalid_conversation_participant:%', v_thread_id;
      end if;
      if coalesce(v_participant ->> 'participant_role', '') not in ('account', 'platform') then
        raise exception 'invalid_conversation_participant_role:%', v_thread_id;
      end if;
      v_source_updated_at := coalesce(
        nullif(v_participant ->> 'source_updated_at', '')::timestamptz,
        now()
      );
      insert into public.merchant_conversation_participants (
        thread_id,
        account_id,
        participant_role,
        display_name,
        email,
        source_snapshot,
        joined_at,
        source_updated_at,
        updated_at
      )
      values (
        v_thread_id,
        v_account_id,
        v_participant ->> 'participant_role',
        coalesce(v_participant ->> 'display_name', ''),
        coalesce(v_participant ->> 'email', ''),
        coalesce(v_participant -> 'source_snapshot', '{}'::jsonb),
        coalesce(
          nullif(v_participant ->> 'joined_at', '')::timestamptz,
          v_source_updated_at
        ),
        v_source_updated_at,
        v_source_updated_at
      )
      on conflict (thread_id, account_id) do update
      set
        participant_role = excluded.participant_role,
        display_name = excluded.display_name,
        email = excluded.email,
        source_snapshot = excluded.source_snapshot,
        joined_at = least(
          merchant_conversation_participants.joined_at,
          excluded.joined_at
        ),
        source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at
      where excluded.source_updated_at >=
        merchant_conversation_participants.source_updated_at;
    end loop;

    if v_thread_mutation ? 'messages'
       and jsonb_typeof(v_thread_mutation -> 'messages') <> 'array' then
      raise exception 'invalid_conversation_messages:%', v_thread_id;
    end if;
    for v_message in
      select value
        from jsonb_array_elements(
          coalesce(v_thread_mutation -> 'messages', '[]'::jsonb)
        )
    loop
      if nullif(btrim(v_message ->> 'id'), '') is null
         or nullif(btrim(v_message ->> 'thread_id'), '') is distinct from v_thread_id
         or nullif(btrim(v_message ->> 'sender_account_id'), '') is null
         or nullif(v_message ->> 'body', '') is null then
        raise exception 'invalid_conversation_message:%', v_thread_id;
      end if;
      if coalesce(v_message ->> 'sender_role', '') not in ('account', 'platform') then
        raise exception 'invalid_conversation_sender_role:%', v_thread_id;
      end if;
      if not exists (
        select 1
          from public.merchant_conversation_participants participant
         where participant.thread_id = v_thread_id
           and participant.account_id =
             btrim(v_message ->> 'sender_account_id')
      ) then
        raise exception 'conversation_sender_not_participant:%', v_thread_id;
      end if;
      v_created_at := coalesce(
        nullif(v_message ->> 'created_at', '')::timestamptz,
        now()
      );

      select
        message.sender_account_id,
        message.sender_role,
        message.body,
        message.created_at
        into
          v_existing_sender_account_id,
          v_existing_sender_role,
          v_existing_body,
          v_existing_created_at
        from public.merchant_conversation_messages message
       where message.thread_id = v_thread_id
         and message.id = btrim(v_message ->> 'id');

      if found then
        if v_existing_sender_account_id is distinct from
             btrim(v_message ->> 'sender_account_id')
           or v_existing_sender_role is distinct from
             v_message ->> 'sender_role'
           or v_existing_body is distinct from v_message ->> 'body'
           or v_existing_created_at is distinct from v_created_at then
          raise exception 'conversation_message_conflict:%:%',
            v_thread_id,
            btrim(v_message ->> 'id');
        end if;
      else
        insert into public.merchant_conversation_messages (
          thread_id,
          id,
          sender_account_id,
          sender_role,
          body,
          source_snapshot,
          created_at,
          source_updated_at
        )
        values (
          v_thread_id,
          btrim(v_message ->> 'id'),
          btrim(v_message ->> 'sender_account_id'),
          v_message ->> 'sender_role',
          v_message ->> 'body',
          coalesce(v_message -> 'source_snapshot', '{}'::jsonb),
          v_created_at,
          coalesce(
            nullif(v_message ->> 'source_updated_at', '')::timestamptz,
            v_created_at
          )
        );
      end if;
    end loop;
    v_count := v_count + 1;
  end loop;

  for v_contact in
    select value
      from jsonb_array_elements(
        coalesce(p_mutations -> 'contacts', '[]'::jsonb)
      )
  loop
    v_owner_merchant_id :=
      nullif(btrim(v_contact ->> 'owner_merchant_id'), '');
    v_contact_account_id :=
      nullif(btrim(v_contact ->> 'contact_account_id'), '');
    if v_owner_merchant_id is null
       or v_contact_account_id is null
       or v_owner_merchant_id !~ '^[0-9]{8}$'
       or v_contact_account_id !~ '^[0-9]{8}$' then
      raise exception 'invalid_conversation_contact_identity';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended(
        'faolla-conversation-contact:' ||
          v_owner_merchant_id || ':' || v_contact_account_id,
        0
      )
    );
    v_source_updated_at := coalesce(
      nullif(v_contact ->> 'source_updated_at', '')::timestamptz,
      now()
    );
    v_customer_id := public.faolla_resolve_merchant_customer_v1(
      v_owner_merchant_id,
      coalesce(v_contact -> 'customer', '{}'::jsonb),
      'conversation-contact'
    );
    if v_customer_id is null then
      raise exception 'conversation_contact_customer_unresolved:%:%',
        v_owner_merchant_id,
        v_contact_account_id;
    end if;

    insert into public.merchant_conversation_contacts (
      owner_merchant_id,
      contact_account_id,
      customer_id,
      contact_name,
      contact_email,
      source_snapshot,
      saved_at,
      source_updated_at,
      updated_at
    )
    values (
      v_owner_merchant_id,
      v_contact_account_id,
      v_customer_id,
      coalesce(v_contact ->> 'contact_name', ''),
      coalesce(v_contact ->> 'contact_email', ''),
      coalesce(v_contact -> 'source_snapshot', '{}'::jsonb),
      coalesce(
        nullif(v_contact ->> 'saved_at', '')::timestamptz,
        v_source_updated_at
      ),
      v_source_updated_at,
      v_source_updated_at
    )
    on conflict (owner_merchant_id, contact_account_id) do update
    set
      customer_id = coalesce(
        excluded.customer_id,
        merchant_conversation_contacts.customer_id
      ),
      contact_name = excluded.contact_name,
      contact_email = excluded.contact_email,
      source_snapshot = excluded.source_snapshot,
      saved_at = excluded.saved_at,
      source_updated_at = excluded.source_updated_at,
      updated_at = excluded.updated_at
    where excluded.source_updated_at >=
      merchant_conversation_contacts.source_updated_at;
    v_count := v_count + 1;
  end loop;

  for v_cursor in
    select value
      from jsonb_array_elements(
        coalesce(p_mutations -> 'read_cursors', '[]'::jsonb)
      )
  loop
    v_thread_id := nullif(btrim(v_cursor ->> 'thread_id'), '');
    v_account_id := nullif(btrim(v_cursor ->> 'account_id'), '');
    if v_thread_id is null or v_account_id is null then
      raise exception 'invalid_conversation_read_cursor';
    end if;
    if not exists (
      select 1
        from public.merchant_conversation_participants participant
       where participant.thread_id = v_thread_id
         and participant.account_id = v_account_id
    ) then
      raise exception 'conversation_read_cursor_participant_not_found:%:%',
        v_thread_id,
        v_account_id;
    end if;
    v_source_updated_at := coalesce(
      nullif(v_cursor ->> 'source_updated_at', '')::timestamptz,
      now()
    );
    v_created_at := coalesce(
      nullif(v_cursor ->> 'last_read_at', '')::timestamptz,
      v_source_updated_at
    );
    insert into public.merchant_conversation_read_cursors (
      thread_id,
      account_id,
      last_read_at,
      source_snapshot,
      source_updated_at,
      updated_at
    )
    values (
      v_thread_id,
      v_account_id,
      v_created_at,
      coalesce(v_cursor -> 'source_snapshot', '{}'::jsonb),
      v_source_updated_at,
      v_source_updated_at
    )
    on conflict (thread_id, account_id) do update
    set
      last_read_at = greatest(
        merchant_conversation_read_cursors.last_read_at,
        excluded.last_read_at
      ),
      source_snapshot = case
        when excluded.source_updated_at >=
          merchant_conversation_read_cursors.source_updated_at
          then excluded.source_snapshot
        else merchant_conversation_read_cursors.source_snapshot
      end,
      source_updated_at = greatest(
        merchant_conversation_read_cursors.source_updated_at,
        excluded.source_updated_at
      ),
      updated_at = greatest(
        merchant_conversation_read_cursors.updated_at,
        excluded.updated_at
      );
    v_count := v_count + 1;
  end loop;

  for v_archive in
    select value
      from jsonb_array_elements(
        coalesce(p_mutations -> 'archived_threads', '[]'::jsonb)
      )
  loop
    v_thread_id := nullif(btrim(v_archive ->> 'id'), '');
    if v_thread_id is null then
      raise exception 'invalid_conversation_archive';
    end if;
    v_source_updated_at := coalesce(
      nullif(v_archive ->> 'archived_at', '')::timestamptz,
      now()
    );
    perform pg_advisory_xact_lock(
      hashtextextended('faolla-conversation:' || v_thread_id, 0)
    );
    update public.merchant_conversation_threads thread
       set state = 'archived',
           source_updated_at = v_source_updated_at,
           updated_at = greatest(thread.updated_at, v_source_updated_at)
     where thread.id = v_thread_id
       and thread.source_updated_at <= v_source_updated_at;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.faolla_upsert_merchant_conversations_v1(jsonb)
  from public;
grant execute on function public.faolla_upsert_merchant_conversations_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607250006, 'conversation_shadow_write_rpc')
on conflict (version) do nothing;

commit;
