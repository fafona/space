-- Versioned task checklist items for the enterprise workspace.
--
-- Checklist writes are serialized per parent task. This keeps the active-item
-- limit and append positions deterministic while item versions provide CAS for
-- edits. Every mutation is idempotent and records a task event for auditing.

begin;

create table if not exists public.merchant_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  task_id uuid not null,
  text text not null check (char_length(btrim(text)) between 1 and 500),
  position bigint not null default 0 check (position >= 0),
  completed_at timestamptz null,
  archived_at timestamptz null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_task_checklist_items_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_task_checklist_items_task_fk
    foreign key (merchant_id, task_id)
    references public.merchant_tasks(merchant_id, id)
    on delete cascade
);

create index if not exists merchant_task_checklist_items_task_position_idx
  on public.merchant_task_checklist_items(
    merchant_id,
    task_id,
    position,
    created_at,
    id
  )
  where archived_at is null;

drop trigger if exists merchant_task_checklist_items_touch
  on public.merchant_task_checklist_items;
create trigger merchant_task_checklist_items_touch
before update on public.merchant_task_checklist_items
for each row execute function public.faolla_touch_versioned_row();

create or replace function public.faolla_create_merchant_task_checklist_item_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_task_id_text text;
  v_task_id uuid;
  v_text text;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claimed integer := 0;
  v_existing public.merchant_idempotency_keys%rowtype;
  v_actor_type text;
  v_actor_id text;
  v_task public.merchant_tasks%rowtype;
  v_active_count integer;
  v_next_position bigint;
  v_item public.merchant_task_checklist_items%rowtype;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_checklist_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  v_text := nullif(btrim(p_input ->> 'text'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id := nullif(btrim(p_input ->> 'actor_id'), '');

  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_task_id_text is null
     or v_task_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not (p_input ? 'text')
     or jsonb_typeof(p_input -> 'text') <> 'string'
     or v_text is null
     or char_length(v_text) > 500
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id is null
     or v_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_checklist_create';
  end if;

  v_task_id := v_task_id_text::uuid;

  -- One lock domain per parent task serializes the active-item limit, append
  -- position calculation and all subsequent item CAS writes.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'faolla-enterprise-task-checklist:' || v_site_id || ':' || v_task_id_text,
      0
    )
  );

  perform 1
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'invalid_site_id';
  end if;

  v_idempotency_key := 'enterprise-task:' || v_operation_id;
  v_request_hash := md5(p_input::text);
  insert into public.merchant_idempotency_keys (
    merchant_id,
    idempotency_key,
    operation,
    request_hash,
    status,
    expires_at
  )
  values (
    v_site_id,
    v_idempotency_key,
    'enterprise_task_checklist_create_v1',
    v_request_hash,
    'processing',
    now() + interval '30 days'
  )
  on conflict (merchant_id, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    select *
      into v_existing
      from public.merchant_idempotency_keys
     where merchant_id = v_site_id
       and idempotency_key = v_idempotency_key;
    if not found
       or v_existing.operation <> 'enterprise_task_checklist_create_v1'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'enterprise_idempotency_conflict';
    end if;
    if v_existing.status = 'completed' and v_existing.response_body is not null then
      return v_existing.response_body;
    end if;
    raise exception 'enterprise_operation_in_progress';
  end if;

  select *
    into v_task
    from public.merchant_tasks
   where merchant_id = v_site_id
     and id = v_task_id
   for update;
  if not found then
    raise exception 'task_not_found';
  end if;
  if v_task.archived_at is not null then
    raise exception 'invalid_task_archived';
  end if;

  perform 1
    from public.merchant_task_boards
   where merchant_id = v_site_id
     and id = v_task.board_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'invalid_task_board';
  end if;

  if v_actor_type = 'employee' then
    perform 1
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id::uuid
       and status = 'active'
     for share;
    if not found then
      raise exception 'invalid_task_actor';
    end if;
  end if;

  select count(*)::integer,
         coalesce(max(item.position) + 1024::bigint, 0::bigint)
    into v_active_count, v_next_position
    from public.merchant_task_checklist_items as item
   where item.merchant_id = v_site_id
     and item.task_id = v_task_id
     and item.archived_at is null;

  if v_active_count >= 100 then
    raise exception 'task_checklist_limit_reached';
  end if;

  insert into public.merchant_task_checklist_items (
    merchant_id,
    task_id,
    text,
    position
  )
  values (
    v_site_id,
    v_task_id,
    v_text,
    v_next_position
  )
  returning * into v_item;

  insert into public.merchant_task_events (
    merchant_id,
    task_id,
    operation_id,
    event_type,
    actor_type,
    actor_id,
    payload
  )
  values (
    v_site_id,
    v_task_id,
    v_operation_id,
    'checklist_item_created',
    v_actor_type,
    v_actor_id,
    jsonb_build_object(
      'checklistItemId', v_item.id::text,
      'position', v_item.position,
      'completed', false,
      'archived', false
    )
  );

  v_response := jsonb_build_object('item', to_jsonb(v_item));
  update public.merchant_idempotency_keys
     set status = 'completed',
         response_status = 200,
         response_body = v_response,
         locked_until = null
   where merchant_id = v_site_id
     and idempotency_key = v_idempotency_key;

  return v_response;
end;
$$;

create or replace function public.faolla_update_merchant_task_checklist_item_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_task_id_text text;
  v_task_id uuid;
  v_item_id_text text;
  v_item_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claimed integer := 0;
  v_existing public.merchant_idempotency_keys%rowtype;
  v_actor_type text;
  v_actor_id text;
  v_task public.merchant_tasks%rowtype;
  v_item public.merchant_task_checklist_items%rowtype;
  v_active_count integer;
  v_previous_completed boolean;
  v_previous_archived boolean;
  v_event_type text;
  v_changed_fields jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_checklist_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  v_item_id_text := nullif(btrim(p_input ->> 'item_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id := nullif(btrim(p_input ->> 'actor_id'), '');

  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_task_id_text is null
     or v_task_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_item_id_text is null
     or v_item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not (p_input ? 'expected_version')
     or jsonb_typeof(p_input -> 'expected_version') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or char_length(p_input ->> 'expected_version') > 18
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id is null
     or v_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not (
       (p_input ? 'text')
       or (p_input ? 'completed')
       or (p_input ? 'archived')
     ) then
    raise exception 'invalid_task_checklist_update';
  end if;

  if p_input ? 'text' and (
    jsonb_typeof(p_input -> 'text') <> 'string'
    or char_length(btrim(p_input ->> 'text')) < 1
    or char_length(btrim(p_input ->> 'text')) > 500
  ) then
    raise exception 'invalid_task_checklist_item';
  end if;
  if p_input ? 'completed'
     and jsonb_typeof(p_input -> 'completed') <> 'boolean' then
    raise exception 'invalid_task_checklist_completed';
  end if;
  if p_input ? 'archived'
     and jsonb_typeof(p_input -> 'archived') <> 'boolean' then
    raise exception 'invalid_task_checklist_archived';
  end if;

  v_task_id := v_task_id_text::uuid;
  v_item_id := v_item_id_text::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'faolla-enterprise-task-checklist:' || v_site_id || ':' || v_task_id_text,
      0
    )
  );

  perform 1
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'invalid_site_id';
  end if;

  v_idempotency_key := 'enterprise-task:' || v_operation_id;
  v_request_hash := md5(p_input::text);
  insert into public.merchant_idempotency_keys (
    merchant_id,
    idempotency_key,
    operation,
    request_hash,
    status,
    expires_at
  )
  values (
    v_site_id,
    v_idempotency_key,
    'enterprise_task_checklist_update_v1',
    v_request_hash,
    'processing',
    now() + interval '30 days'
  )
  on conflict (merchant_id, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    select *
      into v_existing
      from public.merchant_idempotency_keys
     where merchant_id = v_site_id
       and idempotency_key = v_idempotency_key;
    if not found
       or v_existing.operation <> 'enterprise_task_checklist_update_v1'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'enterprise_idempotency_conflict';
    end if;
    if v_existing.status = 'completed' and v_existing.response_body is not null then
      return v_existing.response_body;
    end if;
    raise exception 'enterprise_operation_in_progress';
  end if;

  select *
    into v_task
    from public.merchant_tasks
   where merchant_id = v_site_id
     and id = v_task_id
   for update;
  if not found then
    raise exception 'task_not_found';
  end if;
  if v_task.archived_at is not null then
    raise exception 'invalid_task_archived';
  end if;

  perform 1
    from public.merchant_task_boards
   where merchant_id = v_site_id
     and id = v_task.board_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'invalid_task_board';
  end if;

  if v_actor_type = 'employee' then
    perform 1
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id::uuid
       and status = 'active'
     for share;
    if not found then
      raise exception 'invalid_task_actor';
    end if;
  end if;

  select *
    into v_item
    from public.merchant_task_checklist_items
   where merchant_id = v_site_id
     and task_id = v_task_id
     and id = v_item_id
   for update;
  if not found then
    raise exception 'task_checklist_item_not_found';
  end if;
  if v_item.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;
  if v_item.archived_at is not null and not (
    p_input ? 'archived'
    and not (p_input ->> 'archived')::boolean
    and not (p_input ? 'text')
    and not (p_input ? 'completed')
  ) then
    raise exception 'invalid_task_checklist_archived';
  end if;
  if v_item.archived_at is not null
     and p_input ? 'archived'
     and not (p_input ->> 'archived')::boolean then
    select count(*)::integer
      into v_active_count
      from public.merchant_task_checklist_items as active_item
     where active_item.merchant_id = v_site_id
       and active_item.task_id = v_task_id
       and active_item.archived_at is null;
    if v_active_count >= 100 then
      raise exception 'task_checklist_limit_reached';
    end if;
  end if;

  v_previous_completed := v_item.completed_at is not null;
  v_previous_archived := v_item.archived_at is not null;

  if p_input ? 'text' then
    v_changed_fields := v_changed_fields || '"text"'::jsonb;
  end if;
  if p_input ? 'completed' then
    v_changed_fields := v_changed_fields || '"completed"'::jsonb;
  end if;
  if p_input ? 'archived' then
    v_changed_fields := v_changed_fields || '"archived"'::jsonb;
  end if;

  update public.merchant_task_checklist_items
     set text = case
           when p_input ? 'text' then btrim(p_input ->> 'text')
           else text
         end,
         completed_at = case
           when p_input ? 'completed' and (p_input ->> 'completed')::boolean
             then coalesce(completed_at, now())
           when p_input ? 'completed' then null
           else completed_at
         end,
         archived_at = case
           when p_input ? 'archived' and (p_input ->> 'archived')::boolean
             then coalesce(archived_at, now())
           when p_input ? 'archived' then null
           else archived_at
         end,
         updated_at = updated_at
   where merchant_id = v_site_id
     and task_id = v_task_id
     and id = v_item_id
     and version = v_expected_version
  returning * into v_item;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  v_event_type := case
    when p_input ? 'archived' and (p_input ->> 'archived')::boolean
      then 'checklist_item_archived'
    when p_input ? 'archived'
      then 'checklist_item_restored'
    when p_input ? 'completed' and (p_input ->> 'completed')::boolean
      then 'checklist_item_completed'
    when p_input ? 'completed'
      then 'checklist_item_reopened'
    else 'checklist_item_updated'
  end;

  insert into public.merchant_task_events (
    merchant_id,
    task_id,
    operation_id,
    event_type,
    actor_type,
    actor_id,
    payload
  )
  values (
    v_site_id,
    v_task_id,
    v_operation_id,
    v_event_type,
    v_actor_type,
    v_actor_id,
    jsonb_build_object(
      'checklistItemId', v_item.id::text,
      'fields', v_changed_fields,
      'completed', v_item.completed_at is not null,
      'previousCompleted', v_previous_completed,
      'archived', v_item.archived_at is not null,
      'previousArchived', v_previous_archived,
      'completedAt', v_item.completed_at
    )
  );

  v_response := jsonb_build_object('item', to_jsonb(v_item));
  update public.merchant_idempotency_keys
     set status = 'completed',
         response_status = 200,
         response_body = v_response,
         locked_until = null
   where merchant_id = v_site_id
     and idempotency_key = v_idempotency_key;

  return v_response;
end;
$$;

alter table public.merchant_task_checklist_items enable row level security;

revoke all on public.merchant_task_checklist_items from anon, authenticated;
grant select, insert, update on public.merchant_task_checklist_items to service_role;

revoke all on function public.faolla_create_merchant_task_checklist_item_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_checklist_item_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_create_merchant_task_checklist_item_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_task_checklist_item_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310008, 'merchant_enterprise_task_checklists')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
