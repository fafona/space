-- Merchant enterprise-management foundation.
-- This migration is additive. It introduces merchant-scoped workforce and task
-- tables without changing any existing owner authentication or business route.

begin;

create table if not exists public.merchant_enterprise_roles (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  system_key text null,
  description text not null default '',
  permissions text[] not null default '{}'::text[],
  status text not null default 'active'
    check (status in ('active', 'archived')),
  is_system boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_enterprise_roles_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_enterprise_roles_system_key_unique
    unique (merchant_id, system_key),
  constraint merchant_enterprise_roles_permissions_check
    check (
      permissions <@ array[
        'enterprise.view',
        'tasks.view',
        'tasks.create',
        'tasks.update',
        'tasks.assign',
        'tasks.archive',
        'boards.manage',
        'employees.view',
        'employees.manage',
        'roles.view',
        'roles.manage'
      ]::text[]
    )
);

create unique index if not exists merchant_enterprise_roles_active_name_unique_idx
  on public.merchant_enterprise_roles(merchant_id, lower(name))
  where status = 'active';
create index if not exists merchant_enterprise_roles_merchant_updated_idx
  on public.merchant_enterprise_roles(merchant_id, updated_at desc);

create table if not exists public.merchant_enterprise_employees (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  auth_user_id uuid null,
  email text not null check (char_length(email) between 3 and 320),
  display_name text not null check (char_length(display_name) between 1 and 120),
  role_id uuid null,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'disabled')),
  invited_at timestamptz null,
  accepted_at timestamptz null,
  last_active_at timestamptz null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_enterprise_employees_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_enterprise_employees_role_fk
    foreign key (merchant_id, role_id)
    references public.merchant_enterprise_roles(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_employees_active_binding_check
    check (status <> 'active' or (auth_user_id is not null and role_id is not null))
);

create unique index if not exists merchant_enterprise_employees_email_unique_idx
  on public.merchant_enterprise_employees(merchant_id, lower(email));
create unique index if not exists merchant_enterprise_employees_auth_user_unique_idx
  on public.merchant_enterprise_employees(merchant_id, auth_user_id)
  where auth_user_id is not null;
create index if not exists merchant_enterprise_employees_status_updated_idx
  on public.merchant_enterprise_employees(merchant_id, status, updated_at desc);

create table if not exists public.merchant_task_boards (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  system_key text null,
  description text not null default '',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_task_boards_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_task_boards_system_key_unique
    unique (merchant_id, system_key)
);

create index if not exists merchant_task_boards_merchant_updated_idx
  on public.merchant_task_boards(merchant_id, updated_at desc);
create table if not exists public.merchant_task_columns (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  board_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  system_key text null,
  color text not null default '#64748b',
  position integer not null default 0,
  is_done boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_task_columns_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_task_columns_board_id_id_unique
    unique (merchant_id, board_id, id),
  constraint merchant_task_columns_system_key_unique
    unique (merchant_id, board_id, system_key),
  constraint merchant_task_columns_board_fk
    foreign key (merchant_id, board_id)
    references public.merchant_task_boards(merchant_id, id)
    on delete cascade
);

create unique index if not exists merchant_task_columns_position_unique_idx
  on public.merchant_task_columns(merchant_id, board_id, position)
  where status = 'active';
create index if not exists merchant_task_columns_board_idx
  on public.merchant_task_columns(merchant_id, board_id, position);

create table if not exists public.merchant_tasks (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  board_id uuid not null,
  column_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  description text not null default '',
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz null,
  completed_at timestamptz null,
  archived_at timestamptz null,
  position bigint not null default 0,
  source_type text not null default '',
  source_id text not null default '',
  created_by_employee_id uuid null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_tasks_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_tasks_board_fk
    foreign key (merchant_id, board_id)
    references public.merchant_task_boards(merchant_id, id)
    on delete cascade,
  constraint merchant_tasks_column_fk
    foreign key (merchant_id, board_id, column_id)
    references public.merchant_task_columns(merchant_id, board_id, id)
    on delete restrict,
  constraint merchant_tasks_creator_fk
    foreign key (merchant_id, created_by_employee_id)
    references public.merchant_enterprise_employees(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_tasks_board_column_position_idx
  on public.merchant_tasks(merchant_id, board_id, column_id, position, created_at)
  where archived_at is null;
create index if not exists merchant_tasks_due_idx
  on public.merchant_tasks(merchant_id, due_at)
  where archived_at is null and due_at is not null;
create index if not exists merchant_tasks_source_idx
  on public.merchant_tasks(merchant_id, source_type, source_id)
  where archived_at is null and source_id <> '';

create table if not exists public.merchant_task_assignees (
  merchant_id text not null,
  task_id uuid not null,
  employee_id uuid not null,
  assigned_at timestamptz not null default now(),
  assigned_by_employee_id uuid null,
  primary key (merchant_id, task_id, employee_id),
  constraint merchant_task_assignees_task_fk
    foreign key (merchant_id, task_id)
    references public.merchant_tasks(merchant_id, id)
    on delete cascade,
  constraint merchant_task_assignees_employee_fk
    foreign key (merchant_id, employee_id)
    references public.merchant_enterprise_employees(merchant_id, id)
    on delete cascade,
  constraint merchant_task_assignees_assigner_fk
    foreign key (merchant_id, assigned_by_employee_id)
    references public.merchant_enterprise_employees(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_task_assignees_employee_idx
  on public.merchant_task_assignees(merchant_id, employee_id, assigned_at desc);

create table if not exists public.merchant_task_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  task_id uuid not null,
  operation_id text not null check (char_length(operation_id) between 1 and 160),
  event_type text not null check (char_length(event_type) between 1 and 80),
  actor_type text not null default 'owner'
    check (actor_type in ('owner', 'employee', 'system')),
  actor_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint merchant_task_events_operation_unique
    unique (merchant_id, operation_id),
  constraint merchant_task_events_task_fk
    foreign key (merchant_id, task_id)
    references public.merchant_tasks(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_task_events_task_created_idx
  on public.merchant_task_events(merchant_id, task_id, created_at desc);

create or replace function public.faolla_create_merchant_task_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_board_id uuid;
  v_column_id uuid;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claimed integer := 0;
  v_existing public.merchant_idempotency_keys%rowtype;
  v_target_is_done boolean;
  v_actor_type text;
  v_actor_id text;
  v_assignee_id uuid;
  v_task public.merchant_tasks%rowtype;
  v_assignee_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_board_id := nullif(btrim(p_input ->> 'board_id'), '')::uuid;
  v_column_id := nullif(btrim(p_input ->> 'column_id'), '')::uuid;
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_actor_type := coalesce(nullif(btrim(p_input ->> 'actor_type'), ''), 'owner');
  v_actor_id := coalesce(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_board_id is null
     or v_column_id is null
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or nullif(btrim(p_input ->> 'title'), '') is null then
    raise exception 'invalid_task';
  end if;
  if v_actor_type not in ('owner', 'employee') then
    raise exception 'invalid_task_actor';
  end if;
  if coalesce(nullif(btrim(p_input ->> 'priority'), ''), 'normal')
     not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_task_priority';
  end if;
  if jsonb_typeof(coalesce(p_input -> 'assignee_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_task_assignees';
  end if;
  if p_input ? 'event_payload' and jsonb_typeof(p_input -> 'event_payload') <> 'object' then
    raise exception 'invalid_task_event_payload';
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
    'enterprise_task_create_v1',
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
       or v_existing.operation <> 'enterprise_task_create_v1'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'enterprise_idempotency_conflict';
    end if;
    if v_existing.status = 'completed' and v_existing.response_body is not null then
      return v_existing.response_body;
    end if;
    raise exception 'enterprise_operation_in_progress';
  end if;

  select is_done
    into v_target_is_done
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_board_id
     and id = v_column_id
     and status = 'active';
  if not found then
    raise exception 'invalid_task_column';
  end if;

  insert into public.merchant_tasks (
    merchant_id,
    board_id,
    column_id,
    title,
    description,
    priority,
    due_at,
    completed_at,
    position,
    source_type,
    source_id,
    created_by_employee_id
  )
  values (
    v_site_id,
    v_board_id,
    v_column_id,
    btrim(p_input ->> 'title'),
    coalesce(p_input ->> 'description', ''),
    coalesce(nullif(btrim(p_input ->> 'priority'), ''), 'normal'),
    nullif(p_input ->> 'due_at', '')::timestamptz,
    case when v_target_is_done then now() else null end,
    greatest(
      0,
      coalesce(
        (p_input ->> 'position')::bigint,
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint
      )
    ),
    coalesce(p_input ->> 'source_type', ''),
    coalesce(p_input ->> 'source_id', ''),
    nullif(btrim(p_input ->> 'created_by_employee_id'), '')::uuid
  )
  returning * into v_task;

  for v_assignee_id in
    select distinct nullif(btrim(value), '')::uuid
    from jsonb_array_elements_text(coalesce(p_input -> 'assignee_ids', '[]'::jsonb))
    where nullif(btrim(value), '') is not null
  loop
    perform 1
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_assignee_id
       and status = 'active'
     for share;
    if not found then
      raise exception 'invalid_task_assignees';
    end if;
  end loop;

  insert into public.merchant_task_assignees (
    merchant_id,
    task_id,
    employee_id,
    assigned_by_employee_id
  )
  select
    v_site_id,
    v_task.id,
    candidate.employee_id,
    case when v_actor_type = 'employee' then nullif(v_actor_id, '')::uuid else null end
  from (
    select distinct nullif(btrim(value), '')::uuid as employee_id
    from jsonb_array_elements_text(coalesce(p_input -> 'assignee_ids', '[]'::jsonb))
  ) as candidate
  where candidate.employee_id is not null;

  select coalesce(
    jsonb_agg(assignee.employee_id::text order by assignee.employee_id::text),
    '[]'::jsonb
  )
    into v_assignee_ids
    from public.merchant_task_assignees as assignee
   where assignee.merchant_id = v_site_id
     and assignee.task_id = v_task.id;

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
    v_task.id,
    v_operation_id,
    'created',
    v_actor_type,
    v_actor_id,
    coalesce(p_input -> 'event_payload', '{}'::jsonb)
  );

  v_response := jsonb_build_object(
    'task', to_jsonb(v_task),
    'assignee_ids', v_assignee_ids
  );
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

create or replace function public.faolla_update_merchant_task_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_task_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claimed integer := 0;
  v_existing public.merchant_idempotency_keys%rowtype;
  v_task public.merchant_tasks%rowtype;
  v_target_column_id uuid;
  v_current_is_done boolean;
  v_target_is_done boolean;
  v_completed_at timestamptz;
  v_replace_assignees boolean;
  v_actor_type text;
  v_actor_id text;
  v_event_type text;
  v_assignee_id uuid;
  v_assignee_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id := nullif(btrim(p_input ->> 'task_id'), '')::uuid;
  v_expected_version := nullif(btrim(p_input ->> 'expected_version'), '')::bigint;
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_actor_type := coalesce(nullif(btrim(p_input ->> 'actor_type'), ''), 'owner');
  v_actor_id := coalesce(btrim(p_input ->> 'actor_id'), '');
  v_replace_assignees := coalesce((p_input ->> 'replace_assignees')::boolean, false);
  if v_site_id is null
     or v_task_id is null
     or v_expected_version is null
     or v_expected_version <= 0
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_task_update';
  end if;
  if v_actor_type not in ('owner', 'employee') then
    raise exception 'invalid_task_actor';
  end if;
  if p_input ? 'priority'
     and coalesce(p_input ->> 'priority', '') not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_task_priority';
  end if;
  if v_replace_assignees
     and jsonb_typeof(coalesce(p_input -> 'assignee_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_task_assignees';
  end if;
  if p_input ? 'event_payload' and jsonb_typeof(p_input -> 'event_payload') <> 'object' then
    raise exception 'invalid_task_event_payload';
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
    'enterprise_task_update_v1',
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
       or v_existing.operation <> 'enterprise_task_update_v1'
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
     and version = v_expected_version
   for update;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  select is_done
    into v_current_is_done
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_task.board_id
     and id = v_task.column_id;
  if not found then
    raise exception 'invalid_task_column';
  end if;

  v_target_column_id := v_task.column_id;
  v_target_is_done := v_current_is_done;
  v_completed_at := v_task.completed_at;
  if p_input ? 'column_id' then
    v_target_column_id := nullif(btrim(p_input ->> 'column_id'), '')::uuid;
    select is_done
      into v_target_is_done
      from public.merchant_task_columns
     where merchant_id = v_site_id
       and board_id = v_task.board_id
       and id = v_target_column_id
       and status = 'active';
    if not found then
      raise exception 'invalid_task_column';
    end if;
    if v_target_column_id <> v_task.column_id then
      if v_target_is_done and not v_current_is_done then
        v_completed_at := coalesce(v_task.completed_at, now());
      elsif not v_target_is_done and v_current_is_done then
        v_completed_at := null;
      end if;
    end if;
  end if;

  update public.merchant_tasks
     set column_id = v_target_column_id,
         title = case when p_input ? 'title' then p_input ->> 'title' else title end,
         description = case when p_input ? 'description' then coalesce(p_input ->> 'description', '') else description end,
         priority = case when p_input ? 'priority' then p_input ->> 'priority' else priority end,
         due_at = case
           when p_input ? 'due_at' then nullif(p_input ->> 'due_at', '')::timestamptz
           else due_at
         end,
         completed_at = v_completed_at,
         archived_at = case
           when p_input ? 'archived' and (p_input ->> 'archived')::boolean
             then coalesce(archived_at, now())
           when p_input ? 'archived' then null
           else archived_at
         end,
         position = case
           when p_input ? 'position' then greatest(0, (p_input ->> 'position')::bigint)
           else position
         end,
         updated_at = updated_at
   where merchant_id = v_site_id
     and id = v_task_id
     and version = v_expected_version
  returning * into v_task;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  if v_replace_assignees then
    for v_assignee_id in
      select distinct nullif(btrim(value), '')::uuid
      from jsonb_array_elements_text(coalesce(p_input -> 'assignee_ids', '[]'::jsonb))
      where nullif(btrim(value), '') is not null
    loop
      perform 1
        from public.merchant_enterprise_employees
       where merchant_id = v_site_id
         and id = v_assignee_id
         and status = 'active'
       for share;
      if not found then
        raise exception 'invalid_task_assignees';
      end if;
    end loop;

    delete from public.merchant_task_assignees
     where merchant_id = v_site_id
       and task_id = v_task_id;
    insert into public.merchant_task_assignees (
      merchant_id,
      task_id,
      employee_id,
      assigned_by_employee_id
    )
    select
      v_site_id,
      v_task_id,
      candidate.employee_id,
      case when v_actor_type = 'employee' then nullif(v_actor_id, '')::uuid else null end
    from (
      select distinct nullif(btrim(value), '')::uuid as employee_id
      from jsonb_array_elements_text(coalesce(p_input -> 'assignee_ids', '[]'::jsonb))
    ) as candidate
    where candidate.employee_id is not null;
  end if;

  select coalesce(
    jsonb_agg(assignee.employee_id::text order by assignee.employee_id::text),
    '[]'::jsonb
  )
    into v_assignee_ids
    from public.merchant_task_assignees as assignee
   where assignee.merchant_id = v_site_id
     and assignee.task_id = v_task_id;

  v_event_type := coalesce(
    nullif(btrim(p_input ->> 'event_type'), ''),
    case
      when p_input ? 'archived' and (p_input ->> 'archived')::boolean then 'archived'
      when p_input ? 'archived' then 'restored'
      when p_input ? 'column_id' then 'moved'
      else 'updated'
    end
  );
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
    coalesce(p_input -> 'event_payload', '{}'::jsonb)
  );

  v_response := jsonb_build_object(
    'task', to_jsonb(v_task),
    'assignee_ids', v_assignee_ids
  );
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

revoke all on function public.faolla_create_merchant_task_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_v1(jsonb) from public, anon, authenticated;
grant execute on function public.faolla_create_merchant_task_v1(jsonb) to service_role;
grant execute on function public.faolla_update_merchant_task_v1(jsonb) to service_role;

drop trigger if exists merchant_enterprise_roles_touch on public.merchant_enterprise_roles;
create trigger merchant_enterprise_roles_touch
before update on public.merchant_enterprise_roles
for each row execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_enterprise_employees_touch on public.merchant_enterprise_employees;
create trigger merchant_enterprise_employees_touch
before update on public.merchant_enterprise_employees
for each row execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_task_boards_touch on public.merchant_task_boards;
create trigger merchant_task_boards_touch
before update on public.merchant_task_boards
for each row execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_task_columns_touch on public.merchant_task_columns;
create trigger merchant_task_columns_touch
before update on public.merchant_task_columns
for each row execute function public.faolla_touch_versioned_row();

drop trigger if exists merchant_tasks_touch on public.merchant_tasks;
create trigger merchant_tasks_touch
before update on public.merchant_tasks
for each row execute function public.faolla_touch_versioned_row();

alter table public.merchant_enterprise_roles enable row level security;
alter table public.merchant_enterprise_employees enable row level security;
alter table public.merchant_task_boards enable row level security;
alter table public.merchant_task_columns enable row level security;
alter table public.merchant_tasks enable row level security;
alter table public.merchant_task_assignees enable row level security;
alter table public.merchant_task_events enable row level security;

revoke all on public.merchant_enterprise_roles from anon, authenticated;
revoke all on public.merchant_enterprise_employees from anon, authenticated;
revoke all on public.merchant_task_boards from anon, authenticated;
revoke all on public.merchant_task_columns from anon, authenticated;
revoke all on public.merchant_tasks from anon, authenticated;
revoke all on public.merchant_task_assignees from anon, authenticated;
revoke all on public.merchant_task_events from anon, authenticated;

grant select, insert, update on public.merchant_enterprise_roles to service_role;
grant select, insert, update, delete on public.merchant_enterprise_employees to service_role;
grant select, insert, update on public.merchant_task_boards to service_role;
grant select, insert, update on public.merchant_task_columns to service_role;
grant select on public.merchant_tasks to service_role;
grant select on public.merchant_task_assignees to service_role;
grant select on public.merchant_task_events to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310001, 'merchant_enterprise_foundation')
on conflict (version) do nothing;

commit;
