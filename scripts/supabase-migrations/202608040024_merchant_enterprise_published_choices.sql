-- Read-only task/SOP picker plus immutable task binding. Every displayed or
-- generated value comes from a published revision snapshot; mutable draft
-- columns and working steps are deliberately outside both projections.

begin;

create table if not exists public.merchant_task_workflow_bindings (
  merchant_id text not null,
  task_id uuid not null,
  workflow_id uuid not null,
  workflow_revision_id uuid not null,
  operation_id text not null check (char_length(operation_id) between 1 and 120),
  bound_by_actor_type text not null check (bound_by_actor_type in ('owner', 'employee')),
  -- Owner auth UUIDs are authentication secrets/identifiers and must never be
  -- copied into business tables. Employee actors retain the tenant-scoped
  -- employee row UUID so the binding remains attributable without persisting
  -- the employee's auth_user_id either.
  bound_by_actor_id uuid null,
  bound_at timestamptz not null default statement_timestamp(),
  primary key (merchant_id, task_id),
  constraint merchant_task_workflow_bindings_revision_unique
    unique (merchant_id, task_id, workflow_id, workflow_revision_id),
  constraint merchant_task_workflow_bindings_task_fk
    foreign key (merchant_id, task_id)
    references public.merchant_tasks(merchant_id, id)
    on delete restrict,
  constraint merchant_task_workflow_bindings_revision_fk
    foreign key (merchant_id, workflow_id, workflow_revision_id)
    references public.merchant_enterprise_workflow_revisions(
      merchant_id, workflow_id, id
    )
    on delete restrict,
  constraint merchant_task_workflow_bindings_actor_identity_check
    check (
      (bound_by_actor_type = 'owner' and bound_by_actor_id is null)
      or (bound_by_actor_type = 'employee' and bound_by_actor_id is not null)
    ),
  constraint merchant_task_workflow_bindings_actor_employee_fk
    foreign key (merchant_id, bound_by_actor_id)
    references public.merchant_enterprise_employees(merchant_id, id)
    on delete restrict
);

create index if not exists merchant_task_workflow_bindings_workflow_idx
  on public.merchant_task_workflow_bindings(
    merchant_id, workflow_id, workflow_revision_id, bound_at desc, task_id
  );

alter table public.merchant_task_checklist_items
  add column if not exists source_workflow_id uuid null,
  add column if not exists source_workflow_revision_id uuid null,
  add column if not exists source_workflow_step_id uuid null;

alter table public.merchant_task_checklist_items
  add constraint merchant_task_checklist_items_workflow_source_pair_check
  check (
    (
      source_workflow_id is null
      and source_workflow_revision_id is null
      and source_workflow_step_id is null
    )
    or (
      source_workflow_id is not null
      and source_workflow_revision_id is not null
      and source_workflow_step_id is not null
    )
  ),
  add constraint merchant_task_checklist_items_workflow_binding_fk
  foreign key (
    merchant_id,
    task_id,
    source_workflow_id,
    source_workflow_revision_id
  )
  references public.merchant_task_workflow_bindings(
    merchant_id,
    task_id,
    workflow_id,
    workflow_revision_id
  )
  on delete restrict;

create unique index if not exists merchant_task_checklist_items_workflow_step_unique_idx
  on public.merchant_task_checklist_items(
    merchant_id,
    task_id,
    source_workflow_revision_id,
    source_workflow_step_id
  )
  where source_workflow_revision_id is not null;

alter table public.merchant_task_workflow_bindings enable row level security;
revoke all on public.merchant_task_workflow_bindings
  from public, anon, authenticated, service_role;

create or replace function public.faolla_reject_merchant_task_workflow_binding_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'task_workflow_binding_immutable';
end;
$$;

drop trigger if exists merchant_task_workflow_bindings_append_only
  on public.merchant_task_workflow_bindings;
create trigger merchant_task_workflow_bindings_append_only
before update or delete on public.merchant_task_workflow_bindings
for each row execute function public.faolla_reject_merchant_task_workflow_binding_mutation_v1();
alter table public.merchant_task_workflow_bindings
  enable always trigger merchant_task_workflow_bindings_append_only;

drop trigger if exists merchant_task_workflow_bindings_reject_truncate
  on public.merchant_task_workflow_bindings;
create trigger merchant_task_workflow_bindings_reject_truncate
before truncate on public.merchant_task_workflow_bindings
for each statement execute function public.faolla_reject_merchant_task_workflow_binding_mutation_v1();
alter table public.merchant_task_workflow_bindings
  enable always trigger merchant_task_workflow_bindings_reject_truncate;

-- A task may receive workflow-derived checklist rows from exactly one of the
-- two supported entry points: a manager binding (this migration) or an
-- employee workflow execution (022). Both public RPCs already lock the parent
-- task FOR UPDATE. These ALWAYS triggers repeat that lock at the storage
-- boundary so direct/internal inserts and concurrent calls cannot write-skew
-- across the two source tables.
create or replace function public.faolla_guard_merchant_task_workflow_checklist_source_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_kind text := nullif(tg_argv[0], '');
  v_merchant_id text;
  v_task_id uuid;
begin
  if v_source_kind = 'binding' then
    v_merchant_id := new.merchant_id;
    v_task_id := new.task_id;
  elsif v_source_kind = 'execution' then
    if new.task_id is null or new.generated_checklist_count = 0 then
      return new;
    end if;
    v_merchant_id := new.merchant_id;
    v_task_id := new.task_id;
  else
    raise exception 'invalid_task_workflow_checklist_source_guard';
  end if;

  perform 1
    from public.merchant_tasks as task
   where task.merchant_id = v_merchant_id
     and task.id = v_task_id
   for update;
  if not found then
    raise exception 'task_not_found';
  end if;

  if v_source_kind = 'binding' and exists (
    select 1
      from public.merchant_enterprise_workflow_executions as execution
     where execution.merchant_id = v_merchant_id
       and execution.task_id = v_task_id
       and execution.generated_checklist_count > 0
  ) then
    raise exception 'task_workflow_checklist_source_exists';
  end if;
  if v_source_kind = 'execution' and exists (
    select 1
      from public.merchant_task_workflow_bindings as binding
     where binding.merchant_id = v_merchant_id
       and binding.task_id = v_task_id
  ) then
    raise exception 'task_workflow_checklist_source_exists';
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_task_workflow_bindings_source_exclusive
  on public.merchant_task_workflow_bindings;
create trigger merchant_task_workflow_bindings_source_exclusive
before insert on public.merchant_task_workflow_bindings
for each row execute function public.faolla_guard_merchant_task_workflow_checklist_source_v1(
  'binding'
);
alter table public.merchant_task_workflow_bindings
  enable always trigger merchant_task_workflow_bindings_source_exclusive;

drop trigger if exists merchant_enterprise_workflow_executions_task_source_exclusive
  on public.merchant_enterprise_workflow_executions;
create trigger merchant_enterprise_workflow_executions_task_source_exclusive
before insert on public.merchant_enterprise_workflow_executions
for each row execute function public.faolla_guard_merchant_task_workflow_checklist_source_v1(
  'execution'
);
alter table public.merchant_enterprise_workflow_executions
  enable always trigger merchant_enterprise_workflow_executions_task_source_exclusive;

create or replace function public.faolla_guard_merchant_task_checklist_workflow_source_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
begin
  if tg_op = 'UPDATE' and row(
    new.source_workflow_id,
    new.source_workflow_revision_id,
    new.source_workflow_step_id
  ) is distinct from row(
    old.source_workflow_id,
    old.source_workflow_revision_id,
    old.source_workflow_step_id
  ) then
    raise exception 'task_checklist_workflow_source_immutable';
  end if;

  if new.source_workflow_revision_id is not null then
    select revision.snapshot
      into v_snapshot
      from public.merchant_task_workflow_bindings as binding
      join public.merchant_enterprise_workflow_revisions as revision
        on revision.merchant_id = binding.merchant_id
       and revision.workflow_id = binding.workflow_id
       and revision.id = binding.workflow_revision_id
     where binding.merchant_id = new.merchant_id
       and binding.task_id = new.task_id
       and binding.workflow_id = new.source_workflow_id
       and binding.workflow_revision_id = new.source_workflow_revision_id;
    if not found
       or not (case
         when coalesce(jsonb_typeof(v_snapshot -> 'steps'), '') = 'array' then
           exists (
             select 1
               from jsonb_array_elements(v_snapshot -> 'steps') as step(value)
              where step.value ->> 'id' = new.source_workflow_step_id::text
           )
         else false
       end) then
      raise exception 'invalid_task_checklist_workflow_source';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists merchant_task_checklist_items_workflow_source_guard
  on public.merchant_task_checklist_items;
create trigger merchant_task_checklist_items_workflow_source_guard
before insert or update on public.merchant_task_checklist_items
for each row execute function public.faolla_guard_merchant_task_checklist_workflow_source_v1();
alter table public.merchant_task_checklist_items
  enable always trigger merchant_task_checklist_items_workflow_source_guard;

create or replace function public.faolla_build_merchant_task_workflow_binding_v1(
  p_merchant_id text,
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_binding public.merchant_task_workflow_bindings%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_generated_count integer;
begin
  select * into v_binding
    from public.merchant_task_workflow_bindings as binding
   where binding.merchant_id = p_merchant_id
     and binding.task_id = p_task_id;
  if not found then
    return null;
  end if;

  select * into v_revision
    from public.merchant_enterprise_workflow_revisions as revision
   where revision.merchant_id = v_binding.merchant_id
     and revision.workflow_id = v_binding.workflow_id
     and revision.id = v_binding.workflow_revision_id;
  if not found
     or coalesce(jsonb_typeof(v_revision.snapshot -> 'title'), '') <> 'string'
     or char_length(btrim(v_revision.snapshot ->> 'title')) not between 1 and 160
     or coalesce(jsonb_typeof(v_revision.snapshot -> 'scenario'), '') <> 'string'
     or char_length(btrim(v_revision.snapshot ->> 'scenario')) not between 1 and 500
     or coalesce(jsonb_typeof(v_revision.snapshot -> 'description'), '') <> 'string'
     or char_length(v_revision.snapshot ->> 'description') > 5000
     or coalesce(jsonb_typeof(v_revision.snapshot -> 'category'), '') <> 'string'
     or char_length(v_revision.snapshot ->> 'category') > 80
     or not public.faolla_valid_merchant_workflow_tags_v1(v_revision.snapshot -> 'tags')
     or not (case
       when public.faolla_valid_merchant_workflow_steps_v1(
         v_revision.snapshot -> 'steps'
       ) then jsonb_array_length(v_revision.snapshot -> 'steps') between 1 and 50
       else false
     end) then
    raise exception 'workflow_revision_invalid';
  end if;

  select count(*)::integer into v_generated_count
    from public.merchant_task_checklist_items as item
   where item.merchant_id = p_merchant_id
     and item.task_id = p_task_id
     and item.source_workflow_id = v_binding.workflow_id
     and item.source_workflow_revision_id = v_binding.workflow_revision_id;

  return jsonb_build_object(
    'merchant_id', v_binding.merchant_id,
    'task_id', v_binding.task_id,
    'workflow_id', v_binding.workflow_id,
    'revision_id', v_revision.id,
    'revision_no', v_revision.revision_no,
    'title', v_revision.snapshot ->> 'title',
    'scenario', v_revision.snapshot ->> 'scenario',
    'description', v_revision.snapshot ->> 'description',
    'category', v_revision.snapshot ->> 'category',
    'tags', v_revision.snapshot -> 'tags',
    'steps', v_revision.snapshot -> 'steps',
    'bound_at', v_binding.bound_at,
    'generated_checklist_count', v_generated_count
  );
end;
$$;

create or replace function public.faolla_authorize_merchant_task_workflow_read_v1(
  p_input jsonb,
  p_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_board_id uuid;
  v_merchant public.merchants%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype;
begin
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id_text is null
     or v_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_task_id is null then
    raise exception 'permission_denied';
  end if;
  v_actor_id := v_actor_id_text::uuid;

  select * into v_merchant
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'permission_denied';
  end if;
  if v_actor_type = 'owner' and not coalesce(
    v_actor_id = any(array_remove(array[
      v_merchant.user_id,
      v_merchant.auth_user_id,
      v_merchant.owner_user_id,
      v_merchant.owner_id,
      v_merchant.auth_id,
      v_merchant.created_by,
      v_merchant.created_by_user_id
    ]::uuid[], null::uuid)),
    false
  ) then
    raise exception 'permission_denied';
  end if;

  -- Keep task-before-employee lock order aligned with task writes and employee
  -- offboarding/role transitions.
  select task.board_id into v_board_id
    from public.merchant_tasks as task
   where task.merchant_id = v_site_id
     and task.id = p_task_id
   for share;
  if not found then
    raise exception 'task_not_found';
  end if;
  if v_actor_type = 'owner' then
    return v_board_id;
  end if;

  select * into v_employee
    from public.merchant_enterprise_employees as employee
   where employee.merchant_id = v_site_id
     and employee.id = v_actor_id
   for share;
  if not found or v_employee.status <> 'active' then
    raise exception 'permission_denied';
  end if;
  select * into v_role
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = v_employee.role_id
   for share;
  if not found
     or v_role.status <> 'active'
     or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
     or not (
       v_role.permissions @> array[
         'enterprise.view', 'tasks.view', 'workflows.view'
       ]::text[]
     ) then
    raise exception 'permission_denied';
  end if;
  perform 1
    from public.merchant_enterprise_role_boards as role_board
   where role_board.merchant_id = v_site_id
     and role_board.role_id = v_role.id
   order by role_board.board_id
   for share of role_board;
  if v_role.access_scope = 'restricted' and not exists (
    select 1
      from public.merchant_enterprise_role_boards as role_board
     where role_board.merchant_id = v_site_id
       and role_board.role_id = v_role.id
       and role_board.board_id = v_board_id
  ) then
    raise exception 'permission_denied';
  end if;
  return v_board_id;
end;
$$;

create or replace function public.faolla_get_merchant_task_workflow_binding_v1(
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
  v_binding jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'task_id', 'actor_type', 'actor_id']::text[]
  ) then
    raise exception 'invalid_task_workflow_request';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or coalesce(jsonb_typeof(p_input -> 'task_id'), '') <> 'string'
     or v_task_id_text is null
     or v_task_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_workflow_request';
  end if;
  v_task_id := v_task_id_text::uuid;
  perform public.faolla_authorize_merchant_task_workflow_read_v1(
    p_input, v_task_id
  );
  v_binding := public.faolla_build_merchant_task_workflow_binding_v1(
    v_site_id, v_task_id
  );
  return jsonb_build_object(
    'merchantId', v_site_id,
    'binding', v_binding
  );
end;
$$;

create or replace function public.faolla_bind_merchant_task_workflow_v1(
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
  v_workflow_id_text text;
  v_revision_id_text text;
  v_operation_id text;
  v_task_id uuid;
  v_workflow_id uuid;
  v_revision_id uuid;
  v_expected_task_version bigint;
  v_task public.merchant_tasks%rowtype;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_step jsonb;
  v_step_id uuid;
  v_step_position integer;
  v_step_count integer;
  v_active_count integer;
  v_next_position bigint;
  v_item public.merchant_task_checklist_items%rowtype;
  v_created_items jsonb := '[]'::jsonb;
  v_binding jsonb;
  v_response jsonb;
  v_key text;
  v_claim jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'task_id', 'workflow_id', 'expected_task_version',
      'expected_revision_id', 'operation_id', 'actor_type', 'actor_id'
    ]::text[]
  ) then
    raise exception 'invalid_task_workflow_request';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  v_workflow_id_text := nullif(btrim(p_input ->> 'workflow_id'), '');
  v_revision_id_text := nullif(btrim(p_input ->> 'expected_revision_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or coalesce(jsonb_typeof(p_input -> 'task_id'), '') <> 'string'
     or v_task_id_text is null
     or v_task_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'workflow_id'), '') <> 'string'
     or v_workflow_id_text is null
     or v_workflow_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'expected_revision_id'), '') <> 'string'
     or v_revision_id_text is null
     or v_revision_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'expected_task_version'), '') <> 'number'
     or (p_input ->> 'expected_task_version') !~ '^[1-9][0-9]*$'
     or coalesce(jsonb_typeof(p_input -> 'operation_id'), '') <> 'string'
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_task_workflow_request';
  end if;
  begin
    v_task_id := v_task_id_text::uuid;
    v_workflow_id := v_workflow_id_text::uuid;
    v_revision_id := v_revision_id_text::uuid;
    v_expected_task_version := (p_input ->> 'expected_task_version')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_task_workflow_request';
  end;

  -- This authorization locks the task before employee/role rows and enforces
  -- the employee's current board scope. It also verifies owner identity.
  perform public.faolla_authorize_merchant_task_write_v1(
    p_input,
    v_task_id,
    null,
    array['tasks.update']::text[],
    '{}'::uuid[],
    'task_not_found'
  );
  perform public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view']::text[]
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'faolla-enterprise-task-checklist:' || v_site_id || ':' || v_task_id::text,
      0
    )
  );

  v_key := 'enterprise-task:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_key,
    'enterprise_task_workflow_bind_v1',
    md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select * into v_task
    from public.merchant_tasks as task
   where task.merchant_id = v_site_id
     and task.id = v_task_id
   for update;
  if not found then
    raise exception 'task_not_found';
  end if;
  if v_task.version <> v_expected_task_version then
    raise exception 'enterprise_version_conflict';
  end if;
  if v_task.archived_at is not null then
    raise exception 'invalid_task_archived';
  end if;
  if exists (
    select 1
      from public.merchant_task_workflow_bindings as binding
     where binding.merchant_id = v_site_id
       and binding.task_id = v_task_id
  ) then
    raise exception 'task_workflow_already_bound';
  end if;

  select * into v_workflow
    from public.merchant_enterprise_workflows as workflow
   where workflow.merchant_id = v_site_id
     and workflow.id = v_workflow_id
   for share;
  if not found then
    raise exception 'workflow_not_found';
  end if;
  if v_workflow.status <> 'published' or v_workflow.current_revision_id is null then
    raise exception 'workflow_not_published';
  end if;
  if v_workflow.current_revision_id <> v_revision_id then
    raise exception 'workflow_revision_changed';
  end if;
  select * into v_revision
    from public.merchant_enterprise_workflow_revisions as revision
   where revision.merchant_id = v_site_id
     and revision.workflow_id = v_workflow_id
     and revision.id = v_revision_id
   for share;
  if not found
     or coalesce(jsonb_typeof(v_revision.snapshot -> 'title'), '') <> 'string'
     or char_length(btrim(v_revision.snapshot ->> 'title')) not between 1 and 160
     or coalesce(jsonb_typeof(v_revision.snapshot -> 'scenario'), '') <> 'string'
     or char_length(btrim(v_revision.snapshot ->> 'scenario')) not between 1 and 500
     or coalesce(jsonb_typeof(v_revision.snapshot -> 'description'), '') <> 'string'
     or char_length(v_revision.snapshot ->> 'description') > 5000
     or coalesce(jsonb_typeof(v_revision.snapshot -> 'category'), '') <> 'string'
     or char_length(v_revision.snapshot ->> 'category') > 80
     or not public.faolla_valid_merchant_workflow_tags_v1(v_revision.snapshot -> 'tags')
     or not (case
       when public.faolla_valid_merchant_workflow_steps_v1(
         v_revision.snapshot -> 'steps'
       ) then jsonb_array_length(v_revision.snapshot -> 'steps') between 1 and 50
       else false
     end) then
    raise exception 'workflow_revision_invalid';
  end if;
  v_step_count := jsonb_array_length(v_revision.snapshot -> 'steps');

  select count(*)::integer,
         coalesce(max(item.position) + 1024::bigint, 0::bigint)
    into v_active_count, v_next_position
    from public.merchant_task_checklist_items as item
   where item.merchant_id = v_site_id
     and item.task_id = v_task_id
     and item.archived_at is null;
  if v_active_count + v_step_count > 100 then
    raise exception 'task_checklist_limit_reached';
  end if;

  insert into public.merchant_task_workflow_bindings (
    merchant_id,
    task_id,
    workflow_id,
    workflow_revision_id,
    operation_id,
    bound_by_actor_type,
    bound_by_actor_id
  ) values (
    v_site_id,
    v_task_id,
    v_workflow_id,
    v_revision_id,
    v_operation_id,
    btrim(p_input ->> 'actor_type'),
    case
      when btrim(p_input ->> 'actor_type') = 'employee'
        then btrim(p_input ->> 'actor_id')::uuid
      else null
    end
  );

  for v_step in
    select step.value
      from jsonb_array_elements(v_revision.snapshot -> 'steps') as step(value)
     order by (step.value ->> 'position')::integer
  loop
    begin
      v_step_id := nullif(btrim(v_step ->> 'id'), '')::uuid;
      v_step_position := (v_step ->> 'position')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'workflow_revision_invalid';
    end;
    if v_step_id is null then
      raise exception 'workflow_revision_invalid';
    end if;
    insert into public.merchant_task_checklist_items (
      merchant_id,
      task_id,
      text,
      position,
      source_workflow_id,
      source_workflow_revision_id,
      source_workflow_step_id
    ) values (
      v_site_id,
      v_task_id,
      btrim(v_step ->> 'title'),
      v_next_position + v_step_position::bigint * 1024::bigint,
      v_workflow_id,
      v_revision_id,
      v_step_id
    ) returning * into v_item;
    v_created_items := v_created_items || jsonb_build_array(to_jsonb(v_item));
  end loop;

  insert into public.merchant_task_events (
    merchant_id,
    task_id,
    operation_id,
    event_type,
    actor_type,
    actor_id,
    payload
  ) values (
    v_site_id,
    v_task_id,
    v_operation_id,
    'workflow_bound',
    btrim(p_input ->> 'actor_type'),
    -- merchant_task_events.actor_id predates the nullable actor identity
    -- convention and is NOT NULL. Use its established owner-safe empty-string
    -- sentinel; only employee business-row UUIDs are persisted here.
    case
      when btrim(p_input ->> 'actor_type') = 'employee'
        then btrim(p_input ->> 'actor_id')
      else ''
    end,
    jsonb_build_object(
      'workflowId', v_workflow_id,
      'revisionId', v_revision_id,
      'revisionNo', v_revision.revision_no,
      'generatedChecklistCount', v_step_count
    )
  );

  v_binding := public.faolla_build_merchant_task_workflow_binding_v1(
    v_site_id, v_task_id
  );
  v_response := jsonb_build_object(
    'binding', v_binding,
    'created_items', v_created_items
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_key, v_response
  );
end;
$$;

create or replace function public.faolla_list_merchant_enterprise_published_workflow_choices_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_choices jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'actor_type', 'actor_id']::text[]
  ) then
    raise exception 'invalid_published_workflow_choice_query';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_published_workflow_choice_query';
  end if;

  -- Reauthorize against the employee and role rows on every request. The API
  -- service role alone is never sufficient to read another tenant's choices.
  perform public.faolla_authorize_merchant_enterprise_workflow_actor_v1(
    p_input,
    array['enterprise.view', 'workflows.view']::text[]
  );

  -- Published snapshots are created by the validated publish RPC. Fail closed
  -- if an operator has nevertheless introduced a malformed current revision.
  if exists (
    select 1
      from public.merchant_enterprise_workflows as workflow
      join public.merchant_enterprise_workflow_revisions as revision
        on revision.merchant_id = workflow.merchant_id
       and revision.workflow_id = workflow.id
       and revision.id = workflow.current_revision_id
     where workflow.merchant_id = v_site_id
       and workflow.status = 'published'
       and (
         coalesce(jsonb_typeof(revision.snapshot -> 'title'), '') <> 'string'
         or char_length(btrim(revision.snapshot ->> 'title')) not between 1 and 160
         or coalesce(jsonb_typeof(revision.snapshot -> 'scenario'), '') <> 'string'
         or char_length(btrim(revision.snapshot ->> 'scenario')) not between 1 and 500
         or not (case
           when coalesce(jsonb_typeof(revision.snapshot -> 'steps'), '') = 'array'
             then jsonb_array_length(revision.snapshot -> 'steps') between 1 and 50
           else false
         end)
       )
  ) then
    raise exception 'workflow_revision_invalid';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', choice.workflow_id,
        'title', choice.snapshot ->> 'title',
        'scenario', choice.snapshot ->> 'scenario',
        'revision_id', choice.revision_id,
        'revision_no', choice.revision_no,
        'step_count', jsonb_array_length(choice.snapshot -> 'steps')
      ) order by choice.published_at desc, choice.workflow_id
    ),
    '[]'::jsonb
  ) into v_choices
  from (
    select
      workflow.id as workflow_id,
      revision.id as revision_id,
      revision.revision_no,
      revision.published_at,
      revision.snapshot
    from public.merchant_enterprise_workflows as workflow
    join public.merchant_enterprise_workflow_revisions as revision
      on revision.merchant_id = workflow.merchant_id
     and revision.workflow_id = workflow.id
     and revision.id = workflow.current_revision_id
    where workflow.merchant_id = v_site_id
      and workflow.status = 'published'
    order by revision.published_at desc, workflow.id
    limit 200
  ) as choice;

  return jsonb_build_object(
    'merchantId', v_site_id,
    'choices', v_choices
  );
end;
$$;

revoke all on function public.faolla_list_merchant_enterprise_published_workflow_choices_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_list_merchant_enterprise_published_workflow_choices_v1(jsonb)
  to service_role;

revoke all on function public.faolla_reject_merchant_task_workflow_binding_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_guard_merchant_task_workflow_checklist_source_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_guard_merchant_task_checklist_workflow_source_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_build_merchant_task_workflow_binding_v1(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_authorize_merchant_task_workflow_read_v1(jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_get_merchant_task_workflow_binding_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_bind_merchant_task_workflow_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_get_merchant_task_workflow_binding_v1(jsonb)
  to service_role;
grant execute on function public.faolla_bind_merchant_task_workflow_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608040024, 'merchant_enterprise_published_choices_and_task_binding')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
