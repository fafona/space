-- Merchant workflow automations. Rules are merchant-scoped, pin one immutable
-- published workflow revision, and turn future order/booking events into a
-- task, workflow checklist and assignee notifications in one transaction.

begin;

alter table public.merchant_enterprise_roles
  drop constraint if exists merchant_enterprise_roles_permissions_check;
alter table public.merchant_enterprise_roles
  add constraint merchant_enterprise_roles_permissions_check
  check (
    permissions <@ array[
      'enterprise.view',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.assign',
      'tasks.archive',
      'orders.linked.view',
      'boards.manage',
      'employees.view',
      'employees.manage',
      'roles.view',
      'roles.manage',
      'audit.view',
      'workflows.view',
      'workflows.manage',
      'workflows.publish',
      'automations.view',
      'automations.manage'
    ]::text[]
  );

create or replace function public.faolla_valid_merchant_enterprise_permissions_v1(
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    p_permissions is not null
    and p_permissions <@ array[
      'enterprise.view',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.assign',
      'tasks.archive',
      'orders.linked.view',
      'boards.manage',
      'employees.view',
      'employees.manage',
      'roles.view',
      'roles.manage',
      'audit.view',
      'workflows.view',
      'workflows.manage',
      'workflows.publish',
      'automations.view',
      'automations.manage'
    ]::text[]
    and (not ('tasks.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions))
    and (not ('tasks.create' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('tasks.update' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('tasks.assign' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('tasks.archive' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('orders.linked.view' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('boards.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'tasks.view' = any(p_permissions)
    ))
    and (not ('roles.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions))
    and (not ('employees.view' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'roles.view' = any(p_permissions)
    ))
    and (not ('employees.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions)
      and 'employees.view' = any(p_permissions)
      and 'roles.view' = any(p_permissions)
    ))
    and (not ('roles.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'roles.view' = any(p_permissions)
    ))
    and (not ('audit.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions))
    and (not ('workflows.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions))
    and (not ('workflows.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'workflows.view' = any(p_permissions)
    ))
    and (not ('workflows.publish' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions) and 'workflows.view' = any(p_permissions)
    ))
    and (not ('automations.view' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions)
      and 'tasks.view' = any(p_permissions)
      and 'workflows.view' = any(p_permissions)
    ))
    and (not ('automations.manage' = any(p_permissions)) or (
      'enterprise.view' = any(p_permissions)
      and 'tasks.view' = any(p_permissions)
      and 'tasks.create' = any(p_permissions)
      and 'tasks.assign' = any(p_permissions)
      and 'workflows.view' = any(p_permissions)
      and 'automations.view' = any(p_permissions)
      and 'roles.view' = any(p_permissions)
      and 'employees.view' = any(p_permissions)
    ));
$$;

-- Extend the existing future-bootstrap trigger without backfilling or changing
-- any merchant-created role.
create or replace function public.faolla_add_default_workflow_permissions_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_system and new.system_key = 'administrator' then
    new.permissions := array_append(new.permissions, 'workflows.view');
    new.permissions := array_append(new.permissions, 'workflows.manage');
    new.permissions := array_append(new.permissions, 'workflows.publish');
    new.permissions := array_append(new.permissions, 'automations.view');
    new.permissions := array_append(new.permissions, 'automations.manage');
  elsif new.is_system and new.system_key = 'supervisor' then
    new.permissions := array_append(new.permissions, 'workflows.view');
    new.permissions := array_append(new.permissions, 'workflows.manage');
    new.permissions := array_append(new.permissions, 'automations.view');
    new.permissions := array_append(new.permissions, 'automations.manage');
  elsif new.is_system and new.system_key = 'employee' then
    new.permissions := array_append(new.permissions, 'workflows.view');
  end if;
  select array_agg(distinct permission order by permission)
    into new.permissions
    from unnest(new.permissions) as item(permission);
  if not public.faolla_valid_merchant_enterprise_permissions_v1(new.permissions) then
    raise exception 'invalid_enterprise_permissions';
  end if;
  return new;
end;
$$;

create table public.merchant_enterprise_automation_rules (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  source_type text not null check (source_type in ('order', 'booking')),
  event_type text not null check (event_type in ('created', 'status_changed')),
  from_status text null,
  to_status text null,
  board_id uuid not null,
  column_id uuid not null,
  workflow_id uuid not null,
  workflow_revision_id uuid not null,
  task_title text not null check (char_length(btrim(task_title)) between 1 and 240),
  task_description text not null default '' check (char_length(task_description) <= 10000),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_offset_minutes integer null
    check (due_offset_minutes is null or due_offset_minutes between 0 and 525600),
  status text not null default 'paused'
    check (status in ('active', 'paused', 'archived')),
  enabled_at timestamptz not null default statement_timestamp(),
  archived_at timestamptz null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint merchant_enterprise_automation_rules_merchant_id_id_unique
    unique (merchant_id, id),
  constraint merchant_enterprise_automation_rules_board_fk
    foreign key (merchant_id, board_id)
    references public.merchant_task_boards(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_automation_rules_column_fk
    foreign key (merchant_id, board_id, column_id)
    references public.merchant_task_columns(merchant_id, board_id, id)
    on delete restrict,
  constraint merchant_enterprise_automation_rules_revision_fk
    foreign key (merchant_id, workflow_id, workflow_revision_id)
    references public.merchant_enterprise_workflow_revisions(
      merchant_id, workflow_id, id
    ) on delete restrict,
  constraint merchant_enterprise_automation_rules_event_shape_check check (
    (event_type = 'created' and from_status is null and to_status is null)
    or (event_type = 'status_changed' and to_status is not null)
  ),
  constraint merchant_enterprise_automation_rules_status_values_check check (
    (
      source_type = 'order'
      and (from_status is null or from_status in ('pending', 'confirmed', 'completed', 'cancelled'))
      and (to_status is null or to_status in ('pending', 'confirmed', 'completed', 'cancelled'))
    )
    or (
      source_type = 'booking'
      and (from_status is null or from_status in ('active', 'confirmed', 'completed', 'no_show', 'cancelled'))
      and (to_status is null or to_status in ('active', 'confirmed', 'completed', 'no_show', 'cancelled'))
    )
  ),
  constraint merchant_enterprise_automation_rules_archive_state_check check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  )
);

create index merchant_enterprise_automation_rules_match_idx
  on public.merchant_enterprise_automation_rules(
    merchant_id, source_type, event_type, status, enabled_at, id
  );
create index merchant_enterprise_automation_rules_board_idx
  on public.merchant_enterprise_automation_rules(merchant_id, board_id, updated_at desc, id);

create table public.merchant_enterprise_automation_rule_assignees (
  merchant_id text not null,
  rule_id uuid not null,
  employee_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (merchant_id, rule_id, employee_id),
  constraint merchant_enterprise_automation_rule_assignees_rule_fk
    foreign key (merchant_id, rule_id)
    references public.merchant_enterprise_automation_rules(merchant_id, id)
    on delete cascade,
  constraint merchant_enterprise_automation_rule_assignees_employee_fk
    foreign key (merchant_id, employee_id)
    references public.merchant_enterprise_employees(merchant_id, id)
    on delete restrict
);

create index merchant_enterprise_automation_rule_assignees_employee_idx
  on public.merchant_enterprise_automation_rule_assignees(merchant_id, employee_id, rule_id);

create table public.merchant_enterprise_automation_runs (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  rule_id uuid not null,
  rule_version bigint not null check (rule_version > 0),
  board_id uuid not null,
  source_type text not null check (source_type in ('order', 'booking')),
  source_event_key text not null check (char_length(source_event_key) between 1 and 200),
  event_ref text not null check (
    event_ref ~ '^(order|booking)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  event_type text not null check (event_type in ('created', 'status_changed')),
  from_status text null,
  to_status text null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed', 'skipped')),
  task_id uuid null,
  workflow_id uuid not null,
  workflow_revision_id uuid not null,
  error_code text not null default '' check (char_length(error_code) <= 80),
  attempt_count integer not null default 1 check (attempt_count between 1 and 50),
  last_attempt_at timestamptz not null default statement_timestamp(),
  source_event_at timestamptz not null,
  completed_at timestamptz null,
  created_at timestamptz not null default statement_timestamp(),
  constraint merchant_enterprise_automation_runs_rule_fk
    foreign key (merchant_id, rule_id)
    references public.merchant_enterprise_automation_rules(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_automation_runs_board_fk
    foreign key (merchant_id, board_id)
    references public.merchant_task_boards(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_automation_runs_task_fk
    foreign key (merchant_id, task_id)
    references public.merchant_tasks(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_automation_runs_revision_fk
    foreign key (merchant_id, workflow_id, workflow_revision_id)
    references public.merchant_enterprise_workflow_revisions(merchant_id, workflow_id, id)
    on delete restrict,
  constraint merchant_enterprise_automation_runs_event_unique
    unique (merchant_id, rule_id, source_event_key),
  constraint merchant_enterprise_automation_runs_terminal_check check (
    (status = 'processing' and completed_at is null and task_id is null and error_code = '')
    or (status = 'completed' and completed_at is not null and task_id is not null and error_code = '')
    or (status = 'failed' and completed_at is not null and task_id is null and error_code <> '')
    or (status = 'skipped' and completed_at is not null and task_id is null and error_code <> '')
  )
);

create index merchant_enterprise_automation_runs_recent_idx
  on public.merchant_enterprise_automation_runs(merchant_id, created_at desc, id desc);
create index merchant_enterprise_automation_runs_rule_idx
  on public.merchant_enterprise_automation_runs(merchant_id, rule_id, created_at desc, id desc);

create index merchant_outbox_automation_due_merchants_idx
  on public.merchant_outbox_events(
    merchant_id, priority, available_at, created_at, id
  )
  where event_type = 'enterprise.workflow_automation.process'
    and status in ('pending', 'failed')
    and dead_lettered_at is null;
create index merchant_outbox_automation_expired_leases_idx
  on public.merchant_outbox_events(merchant_id, lease_expires_at, id)
  where event_type = 'enterprise.workflow_automation.process'
    and status = 'processing';

-- Automation tasks intentionally do not use source_type='order': doing so
-- would collide with the existing one-order/one-manual-task contract.
create unique index merchant_tasks_automation_source_unique_idx
  on public.merchant_tasks(merchant_id, source_type, source_id)
  where source_type = 'automation' and source_id <> '';

alter table public.merchant_enterprise_automation_rules enable row level security;
alter table public.merchant_enterprise_automation_rule_assignees enable row level security;
alter table public.merchant_enterprise_automation_runs enable row level security;
revoke all on public.merchant_enterprise_automation_rules
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_automation_rule_assignees
  from public, anon, authenticated, service_role;
revoke all on public.merchant_enterprise_automation_runs
  from public, anon, authenticated, service_role;

drop trigger if exists merchant_enterprise_automation_rules_touch
  on public.merchant_enterprise_automation_rules;
create trigger merchant_enterprise_automation_rules_touch
before update on public.merchant_enterprise_automation_rules
for each row execute function public.faolla_touch_versioned_row();

-- Task bindings made by the internal automation runner are attributable to the
-- system and never persist an owner authentication UUID.
alter table public.merchant_task_workflow_bindings
  drop constraint merchant_task_workflow_bindings_bound_by_actor_type_check;
alter table public.merchant_task_workflow_bindings
  add constraint merchant_task_workflow_bindings_bound_by_actor_type_check
  check (bound_by_actor_type in ('owner', 'employee', 'system'));
alter table public.merchant_task_workflow_bindings
  drop constraint merchant_task_workflow_bindings_actor_identity_check;
alter table public.merchant_task_workflow_bindings
  add constraint merchant_task_workflow_bindings_actor_identity_check
  check (
    (bound_by_actor_type in ('owner', 'system') and bound_by_actor_id is null)
    or (bound_by_actor_type = 'employee' and bound_by_actor_id is not null)
  );

create or replace function public.faolla_authorize_merchant_enterprise_automation_actor_v1(
  p_input jsonb,
  p_required_permission text,
  p_target_board_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_merchant public.merchants%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype;
begin
  if p_input is null
     or coalesce(jsonb_typeof(p_input), '') <> 'object'
     or p_required_permission not in (
       'automations.view', 'automations.manage', 'audit.view'
     ) then
    raise exception 'permission_denied';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_actor_type is null
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id_text is null
     or v_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
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
  if v_actor_type = 'owner' then
    if not coalesce(
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
    return jsonb_build_object(
      'actor_type', 'owner',
      'actor_id', null,
      'access_scope', 'all',
      'role_id', null
    );
  end if;

  select * into v_employee
    from public.merchant_enterprise_employees
   where merchant_id = v_site_id
     and id = v_actor_id
   for share;
  if not found or v_employee.status <> 'active' or v_employee.role_id is null then
    raise exception 'permission_denied';
  end if;
  select * into v_role
    from public.merchant_enterprise_roles
   where merchant_id = v_site_id
     and id = v_employee.role_id
   for share;
  if not found
     or v_role.status <> 'active'
     or not public.faolla_valid_merchant_enterprise_permissions_v1(v_role.permissions)
     or not (p_required_permission = any(v_role.permissions)) then
    raise exception 'permission_denied';
  end if;
  if p_target_board_id is not null
     and v_role.access_scope = 'restricted'
     and not exists (
       select 1
         from public.merchant_enterprise_role_boards as role_board
        where role_board.merchant_id = v_site_id
          and role_board.role_id = v_role.id
          and role_board.board_id = p_target_board_id
     ) then
    raise exception 'board_not_found';
  end if;
  return jsonb_build_object(
    'actor_type', 'employee',
    'actor_id', v_employee.id,
    'access_scope', v_role.access_scope,
    'role_id', v_role.id
  );
end;
$$;

create or replace function public.faolla_build_merchant_enterprise_automation_rule_v1(
  p_merchant_id text,
  p_rule_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.merchant_enterprise_automation_rules%rowtype;
  v_revision_no integer;
  v_assignee_ids jsonb;
begin
  select * into v_rule
    from public.merchant_enterprise_automation_rules
   where merchant_id = p_merchant_id
     and id = p_rule_id;
  if not found then
    raise exception 'automation_rule_not_found';
  end if;
  select revision_no into v_revision_no
    from public.merchant_enterprise_workflow_revisions
   where merchant_id = v_rule.merchant_id
     and workflow_id = v_rule.workflow_id
     and id = v_rule.workflow_revision_id;
  if not found then
    raise exception 'automation_workflow_unavailable';
  end if;
  select coalesce(
    jsonb_agg(assignee.employee_id::text order by assignee.employee_id::text),
    '[]'::jsonb
  ) into v_assignee_ids
    from public.merchant_enterprise_automation_rule_assignees as assignee
   where assignee.merchant_id = v_rule.merchant_id
     and assignee.rule_id = v_rule.id;
  return jsonb_build_object(
    'id', v_rule.id,
    'merchant_id', v_rule.merchant_id,
    'name', v_rule.name,
    'source_type', v_rule.source_type,
    'event_type', v_rule.event_type,
    'from_status', v_rule.from_status,
    'to_status', v_rule.to_status,
    'board_id', v_rule.board_id,
    'column_id', v_rule.column_id,
    'workflow_id', v_rule.workflow_id,
    'workflow_revision_id', v_rule.workflow_revision_id,
    'workflow_revision_no', v_revision_no,
    'task_title', v_rule.task_title,
    'task_description', v_rule.task_description,
    'priority', v_rule.priority,
    'due_offset_minutes', v_rule.due_offset_minutes,
    'status', v_rule.status,
    'assignee_ids', v_assignee_ids,
    'version', v_rule.version,
    'enabled_at', v_rule.enabled_at,
    'archived_at', v_rule.archived_at,
    'created_at', v_rule.created_at,
    'updated_at', v_rule.updated_at
  );
end;
$$;

create or replace function public.faolla_list_merchant_enterprise_automation_rules_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_auth jsonb;
  v_rules jsonb;
  v_runs jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'actor_type', 'actor_id']::text[]
  ) then
    raise exception 'invalid_automation_query';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_automation_query';
  end if;
  v_auth := public.faolla_authorize_merchant_enterprise_automation_actor_v1(
    p_input, 'automations.view', null
  );

  select coalesce(
    jsonb_agg(
      public.faolla_build_merchant_enterprise_automation_rule_v1(
        v_site_id, visible_rule.id
      ) order by visible_rule.updated_at desc, visible_rule.id
    ),
    '[]'::jsonb
  ) into v_rules
  from (
    select rule_row.id, rule_row.updated_at
      from public.merchant_enterprise_automation_rules as rule_row
     where rule_row.merchant_id = v_site_id
       and rule_row.status <> 'archived'
       and (
         v_auth ->> 'access_scope' = 'all'
         or exists (
           select 1
             from public.merchant_enterprise_role_boards as role_board
            where role_board.merchant_id = v_site_id
              and role_board.role_id = (v_auth ->> 'role_id')::uuid
              and role_board.board_id = rule_row.board_id
         )
       )
     order by rule_row.updated_at desc, rule_row.id
     limit 100
  ) as visible_rule;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'merchant_id', recent.merchant_id,
        'rule_id', recent.rule_id,
        'rule_version', recent.rule_version,
        'source_type', recent.source_type,
        'event_ref', recent.event_ref,
        'event_type', recent.event_type,
        'from_status', recent.from_status,
        'to_status', recent.to_status,
        'status', recent.status,
        'task_id', recent.task_id,
        'workflow_id', recent.workflow_id,
        'workflow_revision_id', recent.workflow_revision_id,
        'error_code', recent.error_code,
        'attempt_count', recent.attempt_count,
        'source_event_at', recent.source_event_at,
        'completed_at', recent.completed_at,
        'created_at', recent.created_at
      ) order by recent.created_at desc, recent.id desc
    ),
    '[]'::jsonb
  ) into v_runs
  from (
    select run.*
      from public.merchant_enterprise_automation_runs as run
     where run.merchant_id = v_site_id
       and (
         v_auth ->> 'access_scope' = 'all'
         or exists (
           select 1
             from public.merchant_enterprise_role_boards as role_board
            where role_board.merchant_id = v_site_id
              and role_board.role_id = (v_auth ->> 'role_id')::uuid
               and role_board.board_id = run.board_id
         )
       )
     order by run.created_at desc, run.id desc
     limit 100
  ) as recent;

  return jsonb_build_object(
    'merchantId', v_site_id,
    'rules', v_rules,
    'runs', v_runs
  );
end;
$$;

create or replace function public.faolla_mutate_merchant_enterprise_automation_rule_v1(
  p_input jsonb,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_rule_id_text text;
  v_rule_id uuid;
  v_expected_version bigint;
  v_name text;
  v_source_type text;
  v_event_type text;
  v_from_status text;
  v_to_status text;
  v_board_id_text text;
  v_board_id uuid;
  v_column_id_text text;
  v_column_id uuid;
  v_workflow_id_text text;
  v_workflow_id uuid;
  v_revision_id_text text;
  v_revision_id uuid;
  v_task_title text;
  v_task_description text;
  v_priority text;
  v_due_offset_minutes integer;
  v_status text;
  v_operation_id text;
  v_assignee_ids uuid[] := '{}'::uuid[];
  v_existing_assignee_ids uuid[] := '{}'::uuid[];
  v_execution_config_changed boolean := false;
  v_existing_board_id uuid;
  v_existing public.merchant_enterprise_automation_rules%rowtype;
  v_rule public.merchant_enterprise_automation_rules%rowtype;
  v_workflow public.merchant_enterprise_workflows%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_key text;
  v_claim jsonb;
  v_response jsonb;
  v_audit_event text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
begin
  if p_mode not in ('create', 'update')
     or p_input is null
     or coalesce(jsonb_typeof(p_input), '') <> 'object'
     or not public.faolla_merchant_workflow_object_has_only_keys_v1(
       p_input,
       case when p_mode = 'create' then
         array[
           'merchant_id', 'name', 'source_type', 'event_type', 'from_status',
           'to_status', 'board_id', 'column_id', 'workflow_id',
           'workflow_revision_id', 'task_title', 'task_description', 'priority',
           'due_offset_minutes', 'status', 'assignee_ids', 'operation_id',
           'actor_type', 'actor_id'
         ]::text[]
       else
         array[
           'merchant_id', 'rule_id', 'expected_version', 'name', 'source_type',
           'event_type', 'from_status', 'to_status', 'board_id', 'column_id',
           'workflow_id', 'workflow_revision_id', 'task_title',
           'task_description', 'priority', 'due_offset_minutes', 'status',
           'assignee_ids', 'operation_id', 'actor_type', 'actor_id'
         ]::text[]
       end
     ) then
    raise exception 'invalid_automation_rule';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_rule_id_text := nullif(btrim(p_input ->> 'rule_id'), '');
  v_name := nullif(btrim(p_input ->> 'name'), '');
  v_source_type := nullif(btrim(p_input ->> 'source_type'), '');
  v_event_type := nullif(btrim(p_input ->> 'event_type'), '');
  v_from_status := nullif(btrim(p_input ->> 'from_status'), '');
  v_to_status := nullif(btrim(p_input ->> 'to_status'), '');
  v_board_id_text := nullif(btrim(p_input ->> 'board_id'), '');
  v_column_id_text := nullif(btrim(p_input ->> 'column_id'), '');
  v_workflow_id_text := nullif(btrim(p_input ->> 'workflow_id'), '');
  v_revision_id_text := nullif(btrim(p_input ->> 'workflow_revision_id'), '');
  v_task_title := nullif(btrim(p_input ->> 'task_title'), '');
  v_task_description := coalesce(p_input ->> 'task_description', '');
  v_priority := coalesce(nullif(btrim(p_input ->> 'priority'), ''), 'normal');
  v_status := nullif(btrim(p_input ->> 'status'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');

  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_name is null or char_length(v_name) > 160
     or v_source_type not in ('order', 'booking')
     or v_event_type not in ('created', 'status_changed')
     or (v_event_type = 'created' and (
       v_from_status is not null or v_to_status is not null
     ))
     or (v_event_type = 'status_changed' and v_to_status is null)
     or v_board_id_text is null
     or v_board_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_column_id_text is null
     or v_column_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_workflow_id_text is null
     or v_workflow_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_revision_id_text is null
     or v_revision_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_task_title is null or char_length(v_task_title) > 240
     or char_length(v_task_description) > 10000
     or v_priority not in ('low', 'normal', 'high', 'urgent')
     or v_status not in ('active', 'paused')
     or v_operation_id is null or char_length(v_operation_id) > 120
     or coalesce(jsonb_typeof(p_input -> 'assignee_ids'), '') <> 'array'
     or jsonb_array_length(p_input -> 'assignee_ids') > 50 then
    raise exception 'invalid_automation_rule';
  end if;
  if v_source_type = 'order' and (
    (v_from_status is not null and v_from_status not in ('pending', 'confirmed', 'completed', 'cancelled'))
    or (v_to_status is not null and v_to_status not in ('pending', 'confirmed', 'completed', 'cancelled'))
  ) then
    raise exception 'invalid_automation_rule';
  end if;
  if v_source_type = 'booking' and (
    (v_from_status is not null and v_from_status not in ('active', 'confirmed', 'completed', 'no_show', 'cancelled'))
    or (v_to_status is not null and v_to_status not in ('active', 'confirmed', 'completed', 'no_show', 'cancelled'))
  ) then
    raise exception 'invalid_automation_rule';
  end if;
  if regexp_replace(
    v_task_title || E'\n' || v_task_description,
    '\{(eventRef|fromStatus|toStatus)\}',
    '',
    'g'
  ) ~ '\{[^{}]*\}' then
    raise exception 'invalid_automation_rule';
  end if;
  if p_input ? 'due_offset_minutes'
     and coalesce(jsonb_typeof(p_input -> 'due_offset_minutes'), '') <> 'null' then
    if coalesce(jsonb_typeof(p_input -> 'due_offset_minutes'), '') <> 'number'
       or (p_input ->> 'due_offset_minutes') !~ '^[0-9]+$' then
      raise exception 'invalid_automation_rule';
    end if;
    begin
      v_due_offset_minutes := (p_input ->> 'due_offset_minutes')::integer;
    exception when numeric_value_out_of_range then
      raise exception 'invalid_automation_rule';
    end;
    if v_due_offset_minutes not between 0 and 525600 then
      raise exception 'invalid_automation_rule';
    end if;
  else
    v_due_offset_minutes := null;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_input -> 'assignee_ids') as item(value)
     where coalesce(jsonb_typeof(item.value), '') <> 'string'
        or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'invalid_automation_assignees';
  end if;
  select coalesce(array_agg(distinct employee_id order by employee_id), '{}'::uuid[])
    into v_assignee_ids
    from (
      select (item.value #>> '{}')::uuid as employee_id
        from jsonb_array_elements(p_input -> 'assignee_ids') as item(value)
    ) as requested;

  begin
    v_board_id := v_board_id_text::uuid;
    v_column_id := v_column_id_text::uuid;
    v_workflow_id := v_workflow_id_text::uuid;
    v_revision_id := v_revision_id_text::uuid;
    if p_mode = 'update' then
      if v_rule_id_text is null
         or v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
         or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$' then
        raise exception 'invalid_automation_rule';
      end if;
      v_rule_id := v_rule_id_text::uuid;
      v_expected_version := (p_input ->> 'expected_version')::bigint;
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_automation_rule';
  end;

  if p_mode = 'update' then
    select * into v_existing
      from public.merchant_enterprise_automation_rules
     where merchant_id = v_site_id
       and id = v_rule_id;
    if not found then
      raise exception 'automation_rule_not_found';
    end if;
    v_existing_board_id := v_existing.board_id;
    perform public.faolla_authorize_merchant_enterprise_automation_actor_v1(
      p_input, 'automations.manage', v_existing_board_id
    );
  end if;
  perform public.faolla_authorize_merchant_enterprise_automation_actor_v1(
    p_input, 'automations.manage', v_board_id
  );
  perform public.faolla_authorize_merchant_task_write_v1(
    p_input,
    null,
    v_board_id,
    array['tasks.create', 'tasks.assign']::text[],
    v_assignee_ids,
    'board_not_found'
  );

  -- A rule must be executable at save time. Task write authorization confirms
  -- that the employees are active; automation additionally requires every
  -- assignee's active role to retain task visibility for the target board.
  if exists (
    select 1
      from unnest(v_assignee_ids) as requested(employee_id)
      left join public.merchant_enterprise_employees as employee
        on employee.merchant_id = v_site_id
       and employee.id = requested.employee_id
      left join public.merchant_enterprise_roles as role_row
        on role_row.merchant_id = employee.merchant_id
       and role_row.id = employee.role_id
     where employee.id is null
        or employee.status <> 'active'
        or role_row.id is null
        or role_row.status <> 'active'
        or not public.faolla_valid_merchant_enterprise_permissions_v1(
          role_row.permissions
        )
        or not ('tasks.view' = any(role_row.permissions))
        or (
          role_row.access_scope = 'restricted'
          and not exists (
            select 1
              from public.merchant_enterprise_role_boards as role_board
             where role_board.merchant_id = v_site_id
               and role_board.role_id = role_row.id
               and role_board.board_id = v_board_id
          )
        )
  ) then
    raise exception 'automation_assignee_unavailable';
  end if;

  perform 1
    from public.merchant_task_boards as board
    join public.merchant_task_columns as column_row
      on column_row.merchant_id = board.merchant_id
     and column_row.board_id = board.id
     and column_row.id = v_column_id
   where board.merchant_id = v_site_id
     and board.id = v_board_id
     and board.status = 'active'
     and column_row.status = 'active'
     and not column_row.is_done
   for share of board, column_row;
  if not found then
    raise exception 'automation_target_unavailable';
  end if;

  select * into v_workflow
    from public.merchant_enterprise_workflows
   where merchant_id = v_site_id
     and id = v_workflow_id
    for share;
  if not found then
    raise exception 'automation_workflow_unavailable';
  end if;
  -- A saved rule deliberately pins its immutable revision. Publishing a newer
  -- revision must not force an unrelated edit (especially pausing the rule) to
  -- upgrade it. New rules and explicit revision switches still require the
  -- currently published revision.
  if (
    p_mode = 'create'
    or v_existing.workflow_id is distinct from v_workflow_id
    or v_existing.workflow_revision_id is distinct from v_revision_id
  ) and v_workflow.status <> 'published' then
    raise exception 'workflow_not_published';
  end if;
  if (
    p_mode = 'create'
    or v_existing.workflow_id is distinct from v_workflow_id
    or v_existing.workflow_revision_id is distinct from v_revision_id
  ) and v_workflow.current_revision_id <> v_revision_id then
    raise exception 'workflow_revision_changed';
  end if;
  if v_status = 'active' and v_workflow.status = 'archived' then
    raise exception 'automation_workflow_unavailable';
  end if;
  select * into v_revision
    from public.merchant_enterprise_workflow_revisions
   where merchant_id = v_site_id
     and workflow_id = v_workflow_id
     and id = v_revision_id
   for share;
  if not found
     or not public.faolla_valid_merchant_workflow_steps_v1(v_revision.snapshot -> 'steps')
     or jsonb_array_length(v_revision.snapshot -> 'steps') not between 1 and 50 then
    raise exception 'automation_workflow_unavailable';
  end if;

  v_key := 'enterprise-automation:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_key,
    case when p_mode = 'create'
      then 'enterprise_automation_create_v1'
      else 'enterprise_automation_update_v1'
    end,
    md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;
  if p_mode = 'create' then
    perform pg_advisory_xact_lock(hashtextextended(
      'faolla-enterprise-automation-total:' || v_site_id,
      0
    ));
    if (
      select count(*) >= 100
        from public.merchant_enterprise_automation_rules as merchant_rule
       where merchant_rule.merchant_id = v_site_id
         and merchant_rule.status <> 'archived'
    ) then
      raise exception 'automation_rule_limit_reached';
    end if;
  end if;
  if v_status = 'active' then
    perform pg_advisory_xact_lock(hashtextextended(
      'faolla-enterprise-automation-active:' || v_site_id || ':'
        || v_source_type || ':' || v_event_type,
      0
    ));
    if (
      select count(*) >= 20
        from public.merchant_enterprise_automation_rules as active_rule
       where active_rule.merchant_id = v_site_id
         and active_rule.source_type = v_source_type
         and active_rule.event_type = v_event_type
         and active_rule.status = 'active'
         and (p_mode = 'create' or active_rule.id <> v_rule_id)
    ) then
      raise exception 'automation_active_rule_limit_reached';
    end if;
  end if;
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input,
    case when p_mode = 'create' then 'automation.create' else 'automation.update' end,
    'input'
  );

  if p_mode = 'create' then
    insert into public.merchant_enterprise_automation_rules (
      merchant_id, name, source_type, event_type, from_status, to_status,
      board_id, column_id, workflow_id, workflow_revision_id, task_title,
      task_description, priority, due_offset_minutes, status, enabled_at
    ) values (
      v_site_id, v_name, v_source_type, v_event_type, v_from_status, v_to_status,
      v_board_id, v_column_id, v_workflow_id, v_revision_id, v_task_title,
      v_task_description, v_priority, v_due_offset_minutes, v_status,
      statement_timestamp()
    ) returning * into v_rule;
    v_audit_event := 'automation.created';
  else
    select * into v_existing
      from public.merchant_enterprise_automation_rules
     where merchant_id = v_site_id
       and id = v_rule_id
     for update;
    if not found then
      raise exception 'automation_rule_not_found';
    end if;
    if v_existing.version <> v_expected_version then
      raise exception 'enterprise_version_conflict';
    end if;
    if v_existing.status = 'archived' then
      raise exception 'automation_rule_archived';
    end if;
    select coalesce(
      array_agg(rule_assignee.employee_id order by rule_assignee.employee_id),
      '{}'::uuid[]
    ) into v_existing_assignee_ids
      from public.merchant_enterprise_automation_rule_assignees as rule_assignee
     where rule_assignee.merchant_id = v_site_id
       and rule_assignee.rule_id = v_rule_id;
    -- enabled_at is the execution-configuration boundary used by the async
    -- consumer. Every persisted field that can affect a generated task is
    -- compared, including name because it is the empty-render fallback title.
    -- Request metadata (actor, CAS version and operation id) is not persisted;
    -- a full no-op save therefore preserves enabled_at.
    v_execution_config_changed :=
      v_existing.name is distinct from v_name
      or v_existing.source_type is distinct from v_source_type
      or v_existing.event_type is distinct from v_event_type
      or v_existing.from_status is distinct from v_from_status
      or v_existing.to_status is distinct from v_to_status
      or v_existing.board_id is distinct from v_board_id
      or v_existing.column_id is distinct from v_column_id
      or v_existing.workflow_id is distinct from v_workflow_id
      or v_existing.workflow_revision_id is distinct from v_revision_id
      or v_existing.task_title is distinct from v_task_title
      or v_existing.task_description is distinct from v_task_description
      or v_existing.priority is distinct from v_priority
      or v_existing.due_offset_minutes is distinct from v_due_offset_minutes
      or v_existing_assignee_ids is distinct from v_assignee_ids;
    v_before := jsonb_build_object(
      'name', v_existing.name,
      'source_type', v_existing.source_type,
      'event_type', v_existing.event_type,
      'from_status', v_existing.from_status,
      'to_status', v_existing.to_status,
      'board_id', v_existing.board_id,
      'column_id', v_existing.column_id,
      'workflow_id', v_existing.workflow_id,
      'workflow_revision_id', v_existing.workflow_revision_id,
      'priority', v_existing.priority,
      'due_offset_minutes', v_existing.due_offset_minutes,
      'status', v_existing.status
    );
    update public.merchant_enterprise_automation_rules
       set name = v_name,
           source_type = v_source_type,
           event_type = v_event_type,
           from_status = v_from_status,
           to_status = v_to_status,
           board_id = v_board_id,
           column_id = v_column_id,
           workflow_id = v_workflow_id,
           workflow_revision_id = v_revision_id,
           task_title = v_task_title,
           task_description = v_task_description,
           priority = v_priority,
           due_offset_minutes = v_due_offset_minutes,
           status = v_status,
           enabled_at = case
             when v_status = 'active' and (
               v_existing.status <> 'active'
               or v_execution_config_changed
             ) then greatest(
               clock_timestamp(),
               v_existing.enabled_at + interval '1 microsecond'
             )
             else v_existing.enabled_at
           end
     where merchant_id = v_site_id
       and id = v_rule_id
     returning * into v_rule;
    v_audit_event := case
      when v_existing.status = 'active' and v_rule.status = 'paused'
        then 'automation.paused'
      when v_existing.status = 'paused' and v_rule.status = 'active'
        then 'automation.resumed'
      else 'automation.updated'
    end;
    delete from public.merchant_enterprise_automation_rule_assignees
     where merchant_id = v_site_id and rule_id = v_rule.id;
  end if;

  insert into public.merchant_enterprise_automation_rule_assignees (
    merchant_id, rule_id, employee_id
  )
  select v_site_id, v_rule.id, employee_id
    from unnest(v_assignee_ids) as assignee(employee_id);

  v_after := jsonb_build_object(
    'name', v_rule.name,
    'source_type', v_rule.source_type,
    'event_type', v_rule.event_type,
    'from_status', v_rule.from_status,
    'to_status', v_rule.to_status,
    'board_id', v_rule.board_id,
    'column_id', v_rule.column_id,
    'workflow_id', v_rule.workflow_id,
    'workflow_revision_id', v_rule.workflow_revision_id,
    'priority', v_rule.priority,
    'due_offset_minutes', v_rule.due_offset_minutes,
    'status', v_rule.status,
    'assignee_count', cardinality(v_assignee_ids)
  );
  perform public.faolla_append_merchant_enterprise_audit_event_v1(
    v_site_id,
    v_audit_event,
    'automation',
    v_rule.id,
    v_rule.name,
    v_before,
    v_after,
    'automation:' || v_operation_id,
    null,
    null,
    null
  );
  v_response := jsonb_build_object(
    'merchantId', v_site_id,
    'rule', public.faolla_build_merchant_enterprise_automation_rule_v1(
      v_site_id, v_rule.id
    )
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_key, v_response
  );
end;
$$;

create or replace function public.faolla_create_merchant_enterprise_automation_rule_v1(
  p_input jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.faolla_mutate_merchant_enterprise_automation_rule_v1(
    p_input, 'create'
  );
$$;

create or replace function public.faolla_update_merchant_enterprise_automation_rule_v1(
  p_input jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.faolla_mutate_merchant_enterprise_automation_rule_v1(
    p_input, 'update'
  );
$$;

create or replace function public.faolla_archive_merchant_enterprise_automation_rule_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_rule_id_text text;
  v_rule_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_key text;
  v_claim jsonb;
  v_existing public.merchant_enterprise_automation_rules%rowtype;
  v_rule public.merchant_enterprise_automation_rules%rowtype;
  v_response jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array[
      'merchant_id', 'rule_id', 'expected_version', 'operation_id',
      'actor_type', 'actor_id'
    ]::text[]
  ) then
    raise exception 'invalid_automation_rule';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_rule_id_text := nullif(btrim(p_input ->> 'rule_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_rule_id_text is null
     or v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_input -> 'expected_version'), '') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_automation_rule';
  end if;
  begin
    v_rule_id := v_rule_id_text::uuid;
    v_expected_version := (p_input ->> 'expected_version')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_automation_rule';
  end;

  select * into v_existing
    from public.merchant_enterprise_automation_rules
   where merchant_id = v_site_id
     and id = v_rule_id;
  if not found then
    raise exception 'automation_rule_not_found';
  end if;
  perform public.faolla_authorize_merchant_enterprise_automation_actor_v1(
    p_input, 'automations.manage', v_existing.board_id
  );

  v_key := 'enterprise-automation:' || v_operation_id;
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_key,
    'enterprise_automation_archive_v1',
    md5(p_input::text)
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select * into v_existing
    from public.merchant_enterprise_automation_rules
   where merchant_id = v_site_id
     and id = v_rule_id
   for update;
  if not found then
    raise exception 'automation_rule_not_found';
  end if;
  if v_existing.version <> v_expected_version then
    raise exception 'enterprise_version_conflict';
  end if;
  if v_existing.status = 'archived' then
    raise exception 'automation_rule_archived';
  end if;

  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input, 'automation.archive', 'input'
  );
  update public.merchant_enterprise_automation_rules
     set status = 'archived',
         archived_at = clock_timestamp()
   where merchant_id = v_site_id
     and id = v_rule_id
   returning * into v_rule;
  perform public.faolla_append_merchant_enterprise_audit_event_v1(
    v_site_id,
    'automation.archived',
    'automation',
    v_rule.id,
    v_rule.name,
    jsonb_build_object('status', v_existing.status),
    jsonb_build_object('status', 'archived'),
    'automation:' || v_operation_id,
    null,
    null,
    null
  );
  v_response := jsonb_build_object(
    'merchantId', v_site_id,
    'rule', public.faolla_build_merchant_enterprise_automation_rule_v1(
      v_site_id, v_rule.id
    )
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id, v_key, v_response
  );
end;
$$;

create or replace function public.faolla_apply_merchant_enterprise_automation_rule_v1(
  p_rule_id uuid,
  p_source_type text,
  p_source_event_key text,
  p_event_ref text,
  p_event_type text,
  p_from_status text,
  p_to_status text,
  p_source_event_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.merchant_enterprise_automation_rules%rowtype;
  v_run_id uuid := gen_random_uuid();
  v_run public.merchant_enterprise_automation_runs%rowtype;
  v_revision public.merchant_enterprise_workflow_revisions%rowtype;
  v_step jsonb;
  v_step_id uuid;
  v_step_position integer;
  v_task public.merchant_tasks%rowtype;
  v_assignee_id uuid;
  v_assignee_count integer;
  v_valid_assignee_count integer;
  v_task_title text;
  v_task_description text;
  v_due_at timestamptz;
  v_error_code text;
  v_terminal_failure boolean := false;
  v_paused_rule public.merchant_enterprise_automation_rules%rowtype;
  v_task_operation_id text;
  v_binding_operation_id text;
begin
  if p_rule_id is null
     or p_source_type not in ('order', 'booking')
     or p_source_event_key is null
     or char_length(p_source_event_key) not between 1 and 200
     or p_event_ref is null
     or p_event_ref !~ '^(order|booking)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_event_type not in ('created', 'status_changed')
     or p_source_event_at is null then
    raise exception 'invalid_automation_event';
  end if;

  select * into v_rule
    from public.merchant_enterprise_automation_rules
   where id = p_rule_id
   for update;
  if not found then
    raise exception 'automation_rule_not_found';
  end if;
  insert into public.merchant_enterprise_automation_runs (
    id, merchant_id, rule_id, rule_version, board_id, source_type,
    source_event_key, event_ref,
    event_type, from_status, to_status, status, workflow_id,
    workflow_revision_id, source_event_at
  ) values (
    v_run_id, v_rule.merchant_id, v_rule.id, v_rule.version, v_rule.board_id,
    p_source_type,
    p_source_event_key, p_event_ref, p_event_type, nullif(p_from_status, ''),
    nullif(p_to_status, ''), 'processing', v_rule.workflow_id,
    v_rule.workflow_revision_id, p_source_event_at
  )
  on conflict (merchant_id, rule_id, source_event_key) do nothing
  returning * into v_run;
  if not found then
    select * into v_run
      from public.merchant_enterprise_automation_runs
     where merchant_id = v_rule.merchant_id
       and rule_id = v_rule.id
       and source_event_key = p_source_event_key
     for update;
    if v_run.status = 'failed' and v_run.attempt_count < 50 then
      v_run_id := v_run.id;
      update public.merchant_enterprise_automation_runs
         set rule_version = v_rule.version,
             board_id = v_rule.board_id,
             source_type = p_source_type,
             event_ref = p_event_ref,
             event_type = p_event_type,
             from_status = nullif(p_from_status, ''),
             to_status = nullif(p_to_status, ''),
             status = 'processing',
             task_id = null,
             workflow_id = v_rule.workflow_id,
             workflow_revision_id = v_rule.workflow_revision_id,
             error_code = '',
             source_event_at = p_source_event_at,
             completed_at = null,
             attempt_count = v_run.attempt_count + 1,
             last_attempt_at = statement_timestamp()
       where id = v_run_id
       returning * into v_run;
    else
      return jsonb_build_object(
        'runId', v_run.id,
        'status', v_run.status,
        'errorCode', v_run.error_code,
        'retryable', case
          when v_run.status = 'failed' then v_run.error_code not in (
            'automation_target_unavailable',
            'automation_assignee_unavailable',
            'automation_workflow_unavailable'
          )
          else false
        end,
        'deduplicated', true
      );
    end if;
  end if;

  if v_rule.status <> 'active'
     or p_source_event_at < v_rule.enabled_at
     or v_rule.source_type <> p_source_type
     or v_rule.event_type <> p_event_type
     or (v_rule.from_status is not null and v_rule.from_status is distinct from nullif(p_from_status, ''))
     or (v_rule.to_status is not null and v_rule.to_status is distinct from nullif(p_to_status, '')) then
    update public.merchant_enterprise_automation_runs
       set status = 'skipped',
           error_code = 'automation_rule_not_matched',
           completed_at = statement_timestamp()
     where id = v_run_id;
    return jsonb_build_object(
      'runId', v_run_id,
      'status', 'skipped',
      'deduplicated', false
    );
  end if;

  begin
    perform 1
      from public.merchant_task_boards as board
      join public.merchant_task_columns as column_row
        on column_row.merchant_id = board.merchant_id
       and column_row.board_id = board.id
       and column_row.id = v_rule.column_id
     where board.merchant_id = v_rule.merchant_id
       and board.id = v_rule.board_id
       and board.status = 'active'
       and column_row.status = 'active'
       and not column_row.is_done
     for share of board, column_row;
    if not found then
      raise exception 'automation_target_unavailable';
    end if;

    select revision.* into v_revision
      from public.merchant_enterprise_workflow_revisions as revision
      join public.merchant_enterprise_workflows as workflow
        on workflow.merchant_id = revision.merchant_id
       and workflow.id = revision.workflow_id
     where revision.merchant_id = v_rule.merchant_id
       and revision.workflow_id = v_rule.workflow_id
       and revision.id = v_rule.workflow_revision_id
       and workflow.status <> 'archived'
     for share of revision, workflow;
    if not found
       or not public.faolla_valid_merchant_workflow_steps_v1(v_revision.snapshot -> 'steps')
       or jsonb_array_length(v_revision.snapshot -> 'steps') not between 1 and 50 then
      raise exception 'automation_workflow_unavailable';
    end if;

    select count(*)::integer into v_assignee_count
      from public.merchant_enterprise_automation_rule_assignees as rule_assignee
     where rule_assignee.merchant_id = v_rule.merchant_id
       and rule_assignee.rule_id = v_rule.id;
    select count(*)::integer into v_valid_assignee_count
      from public.merchant_enterprise_automation_rule_assignees as rule_assignee
      join public.merchant_enterprise_employees as employee
        on employee.merchant_id = rule_assignee.merchant_id
       and employee.id = rule_assignee.employee_id
       and employee.status = 'active'
      join public.merchant_enterprise_roles as role_row
        on role_row.merchant_id = employee.merchant_id
       and role_row.id = employee.role_id
       and role_row.status = 'active'
     where rule_assignee.merchant_id = v_rule.merchant_id
       and rule_assignee.rule_id = v_rule.id
       and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
       and 'tasks.view' = any(role_row.permissions)
       and (
         role_row.access_scope = 'all'
         or exists (
           select 1
             from public.merchant_enterprise_role_boards as role_board
            where role_board.merchant_id = role_row.merchant_id
              and role_board.role_id = role_row.id
              and role_board.board_id = v_rule.board_id
         )
       );
    if v_assignee_count <> v_valid_assignee_count then
      raise exception 'automation_assignee_unavailable';
    end if;

    v_task_title := left(btrim(
      replace(
        replace(
          replace(v_rule.task_title, '{eventRef}', p_event_ref),
          '{fromStatus}', coalesce(nullif(p_from_status, ''), '')
        ),
        '{toStatus}', coalesce(nullif(p_to_status, ''), '')
      )
    ), 240);
    if v_task_title = '' then
      v_task_title := left(v_rule.name, 240);
    end if;
    v_task_description := left(
      replace(
        replace(
          replace(v_rule.task_description, '{eventRef}', p_event_ref),
          '{fromStatus}', coalesce(nullif(p_from_status, ''), '')
        ),
        '{toStatus}', coalesce(nullif(p_to_status, ''), '')
      ),
      10000
    );
    v_due_at := case
      when v_rule.due_offset_minutes is null then null
      else p_source_event_at + make_interval(mins => v_rule.due_offset_minutes)
    end;
    v_task_operation_id := 'auto:' || v_run_id::text || ':created';
    v_binding_operation_id := 'auto:' || v_run_id::text || ':bind';

    insert into public.merchant_tasks (
      merchant_id, board_id, column_id, title, description, priority, due_at,
      completed_at, position, source_type, source_id, created_by_employee_id
    ) values (
      v_rule.merchant_id, v_rule.board_id, v_rule.column_id, v_task_title,
      v_task_description, v_rule.priority, v_due_at, null,
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'automation', v_run_id::text, null
    ) returning * into v_task;

    insert into public.merchant_task_assignees (
      merchant_id, task_id, employee_id, assigned_by_employee_id
    )
    select v_rule.merchant_id, v_task.id, rule_assignee.employee_id, null
      from public.merchant_enterprise_automation_rule_assignees as rule_assignee
     where rule_assignee.merchant_id = v_rule.merchant_id
       and rule_assignee.rule_id = v_rule.id;

    insert into public.merchant_task_events (
      merchant_id, task_id, operation_id, event_type, actor_type, actor_id, payload
    ) values (
      v_rule.merchant_id,
      v_task.id,
      v_task_operation_id,
      'created',
      'system',
      '',
      jsonb_build_object(
        'automationRuleId', v_rule.id,
        'sourceType', p_source_type,
        'eventRef', p_event_ref,
        'assigneeIds', coalesce((
          select jsonb_agg(rule_assignee.employee_id::text order by rule_assignee.employee_id::text)
            from public.merchant_enterprise_automation_rule_assignees as rule_assignee
           where rule_assignee.merchant_id = v_rule.merchant_id
             and rule_assignee.rule_id = v_rule.id
        ), '[]'::jsonb)
      )
    );

    insert into public.merchant_task_workflow_bindings (
      merchant_id, task_id, workflow_id, workflow_revision_id, operation_id,
      bound_by_actor_type, bound_by_actor_id
    ) values (
      v_rule.merchant_id, v_task.id, v_rule.workflow_id,
      v_rule.workflow_revision_id, v_binding_operation_id, 'system', null
    );

    for v_step in
      select step.value
        from jsonb_array_elements(v_revision.snapshot -> 'steps') as step(value)
       order by (step.value ->> 'position')::integer
    loop
      v_step_id := (v_step ->> 'id')::uuid;
      v_step_position := (v_step ->> 'position')::integer;
      insert into public.merchant_task_checklist_items (
        merchant_id, task_id, text, position, source_workflow_id,
        source_workflow_revision_id, source_workflow_step_id
      ) values (
        v_rule.merchant_id, v_task.id, btrim(v_step ->> 'title'),
        v_step_position::bigint * 1024::bigint, v_rule.workflow_id,
        v_rule.workflow_revision_id, v_step_id
      );
    end loop;

    insert into public.merchant_task_events (
      merchant_id, task_id, operation_id, event_type, actor_type, actor_id, payload
    ) values (
      v_rule.merchant_id,
      v_task.id,
      v_binding_operation_id,
      'workflow_bound',
      'system',
      '',
      jsonb_build_object(
        'workflowId', v_rule.workflow_id,
        'revisionId', v_rule.workflow_revision_id,
        'revisionNo', v_revision.revision_no,
        'generatedChecklistCount', jsonb_array_length(v_revision.snapshot -> 'steps'),
        'automationRuleId', v_rule.id
      )
    );

    for v_assignee_id in
      select rule_assignee.employee_id
        from public.merchant_enterprise_automation_rule_assignees as rule_assignee
       where rule_assignee.merchant_id = v_rule.merchant_id
         and rule_assignee.rule_id = v_rule.id
       order by rule_assignee.employee_id
    loop
      perform public.faolla_insert_merchant_task_notification_v1(
        v_rule.merchant_id,
        v_assignee_id,
        v_task.id,
        'task_assigned',
        v_task_operation_id || ':assigned:' || v_assignee_id::text,
        'system',
        '',
        '{}'::jsonb,
        false
      );
    end loop;

    update public.merchant_enterprise_automation_runs
       set status = 'completed',
           task_id = v_task.id,
           completed_at = statement_timestamp()
     where id = v_run_id;
    perform public.faolla_append_merchant_enterprise_audit_event_v1(
      v_rule.merchant_id,
      'automation.fired',
      'automation',
      v_rule.id,
      v_rule.name,
      '{}'::jsonb,
      jsonb_build_object(
        'source_type', p_source_type,
        'event_type', p_event_type,
        'event_ref', p_event_ref,
        'task_id', v_task.id,
        'workflow_revision_id', v_rule.workflow_revision_id,
        'status', 'completed'
      ),
      'automation-run:' || v_run_id::text || ':attempt:'
        || v_run.attempt_count::text || ':completed',
      'system',
      null,
      'System automation'
    );
    return jsonb_build_object(
      'runId', v_run_id,
      'status', 'completed',
      'taskId', v_task.id,
      'deduplicated', false
    );
  exception when others then
    v_error_code := case
      when sqlerrm like '%automation_target_unavailable%' then 'automation_target_unavailable'
      when sqlerrm like '%automation_assignee_unavailable%' then 'automation_assignee_unavailable'
      when sqlerrm like '%task_assignee_board_access_denied%' then 'automation_assignee_unavailable'
      when sqlerrm like '%automation_workflow_unavailable%' then 'automation_workflow_unavailable'
      when sqlerrm like '%task_workflow_checklist_source_exists%' then 'task_workflow_checklist_source_exists'
      when sqlerrm like '%task_checklist_limit_reached%' then 'task_checklist_limit_reached'
      else 'automation_execution_failed'
    end;
    v_terminal_failure := v_error_code in (
      'automation_target_unavailable',
      'automation_assignee_unavailable',
      'automation_workflow_unavailable'
    );
    update public.merchant_enterprise_automation_runs
       set status = 'failed',
           error_code = v_error_code,
           completed_at = statement_timestamp()
     where id = v_run_id;
    if v_terminal_failure then
      update public.merchant_enterprise_automation_rules
         set status = 'paused'
       where merchant_id = v_rule.merchant_id
         and id = v_rule.id
         and status = 'active'
       returning * into v_paused_rule;
      if found then
        perform public.faolla_append_merchant_enterprise_audit_event_v1(
          v_rule.merchant_id,
          'automation.paused',
          'automation',
          v_rule.id,
          v_rule.name,
          jsonb_build_object('status', 'active'),
          jsonb_build_object(
            'status', 'paused',
            'reason_code', 'execution_configuration_invalid',
            'error_code', v_error_code,
            'run_id', v_run_id
          ),
          'automation-run:' || v_run_id::text || ':attempt:'
            || v_run.attempt_count::text || ':configuration-paused',
          'system',
          null,
          'System automation guard'
        );
      end if;
    end if;
    begin
      perform public.faolla_append_merchant_enterprise_audit_event_v1(
        v_rule.merchant_id,
        'automation.failed',
        'automation',
        v_rule.id,
        v_rule.name,
        '{}'::jsonb,
        jsonb_build_object(
          'source_type', p_source_type,
          'event_type', p_event_type,
          'workflow_revision_id', v_rule.workflow_revision_id,
          'status', 'failed',
          'error_code', v_error_code,
          'event_ref', p_event_ref
        ),
        'automation-run:' || v_run_id::text || ':attempt:'
          || v_run.attempt_count::text || ':failed',
        'system',
        null,
        'System automation'
      );
    exception when others then
      null;
    end;
    return jsonb_build_object(
      'runId', v_run_id,
      'status', 'failed',
      'errorCode', v_error_code,
      'retryable', not v_terminal_failure,
      'deduplicated', false
    );
  end;
end;
$$;

create or replace function public.faolla_pause_merchant_enterprise_automations_for_entitlement_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_reason_code text;
  v_rule public.merchant_enterprise_automation_rules%rowtype;
  v_paused_rule public.merchant_enterprise_automation_rules%rowtype;
  v_paused_count integer := 0;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'reason_code']::text[]
  ) then
    raise exception 'invalid_automation_entitlement_pause';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_reason_code := nullif(btrim(p_input ->> 'reason_code'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_reason_code <> 'entitlement_revoked' then
    raise exception 'invalid_automation_entitlement_pause';
  end if;

  for v_rule in
    select rule_row.*
      from public.merchant_enterprise_automation_rules as rule_row
     where rule_row.merchant_id = v_site_id
       and rule_row.status = 'active'
     order by rule_row.id
     for update
  loop
    update public.merchant_enterprise_automation_rules
       set status = 'paused'
     where merchant_id = v_site_id
       and id = v_rule.id
       and status = 'active'
     returning * into v_paused_rule;
    if found then
      v_paused_count := v_paused_count + 1;
      perform public.faolla_append_merchant_enterprise_audit_event_v1(
        v_site_id,
        'automation.paused',
        'automation',
        v_rule.id,
        v_rule.name,
        jsonb_build_object('status', 'active'),
        jsonb_build_object(
          'status', 'paused',
          'reason_code', v_reason_code
        ),
        'automation-entitlement-pause:' || v_rule.id::text || ':'
          || v_rule.version::text,
        'system',
        null,
        'System entitlement guard'
      );
    end if;
  end loop;
  return jsonb_build_object(
    'merchantId', v_site_id,
    'pausedCount', v_paused_count
  );
end;
$$;

-- Keep the established audit endpoint compatible with automation filters.
-- Authorization remains audit.view; automation permissions do not imply audit access.
create or replace function public.faolla_list_merchant_enterprise_audit_events_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_limit integer := 50;
  v_before_created_at timestamptz := null;
  v_before_id uuid := null;
  v_before_id_text text;
  v_entity_type text := null;
  v_event_type text := null;
  v_events jsonb;
  v_last_created_at timestamptz;
  v_last_id uuid;
begin
  if p_input is null or coalesce(jsonb_typeof(p_input), '') <> 'object' then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$' then
    raise exception 'permission_denied';
  end if;
  if p_input ? 'limit' then
    if coalesce(jsonb_typeof(p_input -> 'limit'), '') <> 'number'
       or (p_input ->> 'limit') !~ '^[0-9]+$' then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    begin
      v_limit := (p_input ->> 'limit')::integer;
    exception when numeric_value_out_of_range then
      raise exception 'invalid_enterprise_audit_query';
    end;
  end if;
  if v_limit not between 1 and 100 then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  v_entity_type := nullif(btrim(p_input ->> 'entity_type'), '');
  v_event_type := nullif(btrim(p_input ->> 'event_type'), '');
  if v_entity_type is not null
     and v_entity_type not in (
       'workspace', 'role', 'board', 'column', 'employee', 'invitation',
       'workflow', 'automation'
     ) then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  if v_event_type is not null
     and v_event_type not in (
       'workspace.bootstrapped',
       'role.created', 'role.updated', 'role.board_scope_changed',
       'board.created', 'board.updated',
       'column.created', 'column.updated',
       'employee.created', 'employee.updated', 'employee.renamed',
       'employee.role_changed', 'employee.disabled', 'employee.restored',
       'employee.removed',
       'invitation.reserved', 'invitation.revoked', 'invitation.removed',
       'invitation.accepted', 'invitation.delivery_finalized',
       'invitation.auth_bound',
       'workflow.created', 'workflow.updated', 'workflow.published',
       'workflow.archived', 'workflow.restored',
       'automation.created', 'automation.updated', 'automation.paused',
       'automation.resumed', 'automation.archived', 'automation.fired',
       'automation.failed'
     ) then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  if (p_input ? 'before_created_at') <> (p_input ? 'before_id') then
    raise exception 'invalid_enterprise_audit_cursor';
  end if;
  if p_input ? 'before_created_at' then
    begin
      v_before_created_at := nullif(
        btrim(p_input ->> 'before_created_at'), ''
      )::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid_enterprise_audit_cursor';
    end;
    v_before_id_text := nullif(btrim(p_input ->> 'before_id'), '');
    if v_before_created_at is null
       or v_before_id_text is null
       or v_before_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_enterprise_audit_cursor';
    end if;
    v_before_id := v_before_id_text::uuid;
  end if;

  perform public.faolla_authorize_merchant_enterprise_automation_actor_v1(
    p_input, 'audit.view', null
  );
  select coalesce(
    jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc),
    '[]'::jsonb
  ) into v_events
  from (
    select audit_event.*
      from public.merchant_enterprise_audit_events as audit_event
     where audit_event.merchant_id = v_site_id
       and (v_entity_type is null or audit_event.entity_type = v_entity_type)
       and (v_event_type is null or audit_event.event_type = v_event_type)
       and (
         v_before_created_at is null
         or (audit_event.created_at, audit_event.id)
           < (v_before_created_at, v_before_id)
       )
     order by audit_event.created_at desc, audit_event.id desc
     limit v_limit
  ) as page;
  select page.created_at, page.id into v_last_created_at, v_last_id
    from (
      select audit_event.created_at, audit_event.id
        from public.merchant_enterprise_audit_events as audit_event
       where audit_event.merchant_id = v_site_id
         and (v_entity_type is null or audit_event.entity_type = v_entity_type)
         and (v_event_type is null or audit_event.event_type = v_event_type)
         and (
           v_before_created_at is null
           or (audit_event.created_at, audit_event.id)
             < (v_before_created_at, v_before_id)
         )
       order by audit_event.created_at desc, audit_event.id desc
       offset greatest(jsonb_array_length(v_events) - 1, 0)
       limit 1
    ) as page;
  return jsonb_build_object(
    'events', v_events,
    'next_cursor', case
      when jsonb_array_length(v_events) = v_limit then jsonb_build_object(
        'before_created_at', v_last_created_at,
        'before_id', v_last_id
      )
      else null
    end
  );
end;
$$;

create or replace function public.faolla_process_merchant_enterprise_automation_event_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_source_type text;
  v_event_id_text text;
  v_event_id uuid;
  v_source_event_key text;
  v_event_ref text;
  v_event_type text;
  v_from_status text;
  v_to_status text;
  v_source_event_at timestamptz;
  v_rule record;
  v_runs jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not public.faolla_merchant_workflow_object_has_only_keys_v1(
    p_input,
    array['merchant_id', 'source_type', 'event_id']::text[]
  ) then
    raise exception 'invalid_automation_event';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_source_type := nullif(btrim(p_input ->> 'source_type'), '');
  v_event_id_text := nullif(btrim(p_input ->> 'event_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_source_type not in ('order', 'booking')
     or v_event_id_text is null
     or v_event_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_automation_event';
  end if;
  v_event_id := v_event_id_text::uuid;

  if v_source_type = 'order' then
    select
      'order:' || event.id::text,
      'order-' || event.id::text,
      event.event_type,
      event.from_status,
      event.to_status,
      event.created_at
    into
      v_source_event_key,
      v_event_ref,
      v_event_type,
      v_from_status,
      v_to_status,
      v_source_event_at
    from public.merchant_order_events as event
    where event.merchant_id = v_site_id
      and event.id = v_event_id;
  else
    select
      'booking:' || event.id::text,
      'booking-' || event.id::text,
      event.event_type,
      event.from_status,
      event.to_status,
      event.created_at
    into
      v_source_event_key,
      v_event_ref,
      v_event_type,
      v_from_status,
      v_to_status,
      v_source_event_at
    from public.merchant_booking_events as event
    where event.merchant_id = v_site_id
      and event.id = v_event_id;
  end if;
  if not found then
    raise exception 'automation_source_event_not_found';
  end if;
  if v_event_type not in ('created', 'status_changed') then
    return jsonb_build_object(
      'merchantId', v_site_id,
      'runs', v_runs
    );
  end if;

  for v_rule in
    select rule_row.id
      from public.merchant_enterprise_automation_rules as rule_row
     where rule_row.merchant_id = v_site_id
       and rule_row.status = 'active'
       and rule_row.source_type = v_source_type
       and rule_row.event_type = v_event_type
       and rule_row.enabled_at <= v_source_event_at
       and (rule_row.from_status is null or rule_row.from_status is not distinct from v_from_status)
       and (rule_row.to_status is null or rule_row.to_status is not distinct from v_to_status)
     order by rule_row.id
  loop
    v_result := public.faolla_apply_merchant_enterprise_automation_rule_v1(
      v_rule.id,
      v_source_type,
      v_source_event_key,
      v_event_ref,
      v_event_type,
      v_from_status,
      v_to_status,
      v_source_event_at
    );
    v_runs := v_runs || jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object(
    'merchantId', v_site_id,
    'runs', v_runs
  );
end;
$$;

create or replace function public.faolla_dispatch_merchant_enterprise_order_automation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.merchant_enterprise_automation_rules as rule_row
     where rule_row.merchant_id = new.merchant_id
       and rule_row.status = 'active'
       and rule_row.source_type = 'order'
       and rule_row.event_type = new.event_type
       and rule_row.enabled_at <= new.created_at
       and (rule_row.from_status is null or rule_row.from_status is not distinct from new.from_status)
       and (rule_row.to_status is null or rule_row.to_status is not distinct from new.to_status)
  ) then
    return new;
  end if;
  insert into public.merchant_outbox_events (
    merchant_id, event_key, event_type, aggregate_type, aggregate_id, payload,
    available_at, max_attempts, priority, correlation_id
  ) values (
    new.merchant_id,
    'enterprise-automation:order:' || new.id::text,
    'enterprise.workflow_automation.process',
    'merchant_order_event',
    new.id::text,
    jsonb_build_object('sourceType', 'order', 'eventId', new.id::text),
    statement_timestamp(),
    12,
    40,
    new.id::text
  )
  on conflict (merchant_id, event_key) do nothing;
  return new;
end;
$$;

create or replace function public.faolla_dispatch_merchant_enterprise_booking_automation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.merchant_enterprise_automation_rules as rule_row
     where rule_row.merchant_id = new.merchant_id
       and rule_row.status = 'active'
       and rule_row.source_type = 'booking'
       and rule_row.event_type = new.event_type
       and rule_row.enabled_at <= new.created_at
       and (rule_row.from_status is null or rule_row.from_status is not distinct from new.from_status)
       and (rule_row.to_status is null or rule_row.to_status is not distinct from new.to_status)
  ) then
    return new;
  end if;
  insert into public.merchant_outbox_events (
    merchant_id, event_key, event_type, aggregate_type, aggregate_id, payload,
    available_at, max_attempts, priority, correlation_id
  ) values (
    new.merchant_id,
    'enterprise-automation:booking:' || new.id::text,
    'enterprise.workflow_automation.process',
    'merchant_booking_event',
    new.id::text,
    jsonb_build_object('sourceType', 'booking', 'eventId', new.id::text),
    statement_timestamp(),
    12,
    40,
    new.id::text
  )
  on conflict (merchant_id, event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists merchant_order_events_enterprise_automation
  on public.merchant_order_events;
create trigger merchant_order_events_enterprise_automation
after insert on public.merchant_order_events
for each row
when (new.event_type in ('created', 'status_changed'))
execute function public.faolla_dispatch_merchant_enterprise_order_automation_v1();

drop trigger if exists merchant_booking_events_enterprise_automation
  on public.merchant_booking_events;
create trigger merchant_booking_events_enterprise_automation
after insert on public.merchant_booking_events
for each row
when (new.event_type in ('created', 'status_changed'))
execute function public.faolla_dispatch_merchant_enterprise_booking_automation_v1();

-- Discover distinct eligible tenants through a lexicographic cursor. The CASE
-- ordering wraps to the smallest merchant in the same call when the cursor is
-- at the end, so a worker never becomes stuck on an empty tail page.
create or replace function public.faolla_discover_merchant_enterprise_automation_merchants_v1(
  p_after_merchant_id text default null,
  p_limit integer default 10
)
returns table(merchant_id text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_after_merchant_id text := nullif(btrim(p_after_merchant_id), '');
  v_limit integer := least(50, greatest(1, coalesce(p_limit, 10)));
begin
  if p_after_merchant_id is not null
     and coalesce(v_after_merchant_id, '') !~ '^[0-9]{8}$' then
    raise exception 'invalid_automation_outbox_discovery_cursor';
  end if;

  return query
  with eligible_merchants as materialized (
    select event.merchant_id
      from public.merchant_outbox_events as event
     where event.event_type = 'enterprise.workflow_automation.process'
       and (
         (
           event.status in ('pending', 'failed')
           and event.dead_lettered_at is null
           and event.attempts < event.max_attempts
           and event.available_at <= now()
         )
         or (
           event.status = 'processing'
           and event.lease_expires_at <= now()
         )
       )
     group by event.merchant_id
  )
  select eligible.merchant_id
    from eligible_merchants as eligible
   order by
     case
       when v_after_merchant_id is null
         or eligible.merchant_id > v_after_merchant_id then 0
       else 1
     end,
     eligible.merchant_id
   limit v_limit;
end;
$$;

-- Dedicated automation claim surface. The worker supplies no more merchants
-- than its batch limit; this RPC enforces that invariant and takes one event
-- from every eligible merchant before beginning a second round. A noisy tenant
-- therefore cannot consume another tenant's whole scoped batch.
create or replace function public.faolla_claim_merchant_enterprise_automation_outbox_v1(
  p_worker_id text,
  p_merchant_ids text[],
  p_event_types text[],
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns setof public.merchant_outbox_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker_id text := nullif(btrim(p_worker_id), '');
  v_limit integer := least(50, greatest(1, coalesce(p_limit, 10)));
  v_lease_seconds integer := least(900, greatest(15, coalesce(p_lease_seconds, 60)));
  v_now timestamptz := now();
  v_merchant_ids text[];
  v_merchant_id text;
  v_event public.merchant_outbox_events%rowtype;
  v_claimed integer := 0;
  v_progress boolean;
begin
  if v_worker_id is null
     or length(v_worker_id) > 120
     or v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' then
    raise exception 'invalid_outbox_worker_id';
  end if;
  if coalesce(cardinality(p_merchant_ids), 0) = 0
     or cardinality(p_merchant_ids) > 50
     or exists (
       select 1
         from unnest(p_merchant_ids) as requested(merchant_id)
        where requested.merchant_id is null
           or btrim(requested.merchant_id) !~ '^[0-9]{8}$'
     ) then
    raise exception 'invalid_outbox_merchant_scope';
  end if;
  if coalesce(cardinality(p_event_types), 0) <> 1
     or btrim(p_event_types[1])
       <> 'enterprise.workflow_automation.process' then
    raise exception 'invalid_outbox_event_type_scope';
  end if;

  select array_agg(scope_value order by scope_value)
    into v_merchant_ids
    from (
      select distinct btrim(requested.merchant_id) as scope_value
        from unnest(p_merchant_ids) as requested(merchant_id)
    ) as normalized_merchants;
  if cardinality(v_merchant_ids) <> cardinality(p_merchant_ids)
     or cardinality(v_merchant_ids) > v_limit then
    raise exception 'invalid_outbox_merchant_scope';
  end if;

  update public.merchant_outbox_attempts as attempt
     set outcome = 'lease_expired',
         finished_at = v_now,
         error_code = 'lease_expired'
    from public.merchant_outbox_events as event
   where event.id = attempt.event_id
     and event.merchant_id = any(v_merchant_ids)
     and event.event_type = 'enterprise.workflow_automation.process'
     and event.status = 'processing'
     and event.lease_expires_at <= v_now
     and attempt.outcome = 'processing'
     and attempt.attempt_number = event.total_attempts;

  update public.merchant_outbox_events as event
     set status = 'failed',
         available_at = case
           when event.attempts >= event.max_attempts then event.available_at
           else v_now
         end,
         locked_at = null,
         locked_by = null,
         lease_expires_at = null,
         dead_lettered_at = case
           when event.attempts >= event.max_attempts then v_now
           else null
         end,
         last_error = 'lease_expired',
         last_error_code = 'lease_expired'
   where event.merchant_id = any(v_merchant_ids)
     and event.event_type = 'enterprise.workflow_automation.process'
     and event.status = 'processing'
     and event.lease_expires_at <= v_now;

  while v_claimed < v_limit loop
    v_progress := false;
    foreach v_merchant_id in array v_merchant_ids loop
      select event.* into v_event
        from public.merchant_outbox_events as event
       where event.merchant_id = v_merchant_id
         and event.event_type = 'enterprise.workflow_automation.process'
         and event.status in ('pending', 'failed')
         and event.dead_lettered_at is null
         and event.attempts < event.max_attempts
         and event.available_at <= v_now
       order by event.priority, event.available_at, event.created_at, event.id
       for update skip locked
       limit 1;
      if found then
        update public.merchant_outbox_events as event
           set status = 'processing',
               attempts = event.attempts + 1,
               total_attempts = event.total_attempts + 1,
               locked_at = v_now,
               locked_by = v_worker_id,
               lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
               last_attempt_at = v_now,
               completed_at = null,
               result = null
         where event.id = v_event.id
         returning event.* into v_event;

        insert into public.merchant_outbox_attempts (
          event_id, attempt_number, cycle_attempt, worker_id, started_at,
          lease_expires_at
        ) values (
          v_event.id, v_event.total_attempts, v_event.attempts, v_worker_id,
          v_now, v_event.lease_expires_at
        );
        v_claimed := v_claimed + 1;
        v_progress := true;
        return next v_event;
        exit when v_claimed >= v_limit;
      end if;
    end loop;
    exit when not v_progress;
  end loop;
  return;
end;
$$;

-- Keep operational monitoring in sync with the newly registered handler. This
-- is the 007 health RPC verbatim except for the single additional known event
-- type, preserving its signature, aggregation semantics and service role ACL.
create or replace function public.faolla_get_merchant_outbox_health_v1(
  p_merchant_id text default null,
  p_window_hours integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_merchant_id text := nullif(btrim(p_merchant_id), '');
  v_window_hours integer := least(168, greatest(1, coalesce(p_window_hours, 24)));
  v_result jsonb;
begin
  if v_merchant_id is not null and v_merchant_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_outbox_health_merchant_id';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'merchant_scope', coalesce(v_merchant_id, 'all'),
    'window_hours', v_window_hours,
    'pending_count', count(*) filter (
      where event.status = 'pending'
        and event.dead_lettered_at is null
    ),
    'retry_scheduled_count', count(*) filter (
      where event.status = 'failed'
        and event.dead_lettered_at is null
    ),
    'processing_count', count(*) filter (
      where event.status = 'processing'
    ),
    'completed_count', count(*) filter (
      where event.status = 'completed'
    ),
    'dead_letter_count', count(*) filter (
      where event.dead_lettered_at is not null
    ),
    'due_count', count(*) filter (
      where event.status in ('pending', 'failed')
        and event.dead_lettered_at is null
        and event.available_at <= now()
    ),
    'scheduled_count', count(*) filter (
      where event.status in ('pending', 'failed')
        and event.dead_lettered_at is null
        and event.available_at > now()
    ),
    'expired_lease_count', count(*) filter (
      where event.status = 'processing'
        and coalesce(event.lease_expires_at <= now(), true)
    ),
    'attempt_limit_risk_count', count(*) filter (
      where event.status in ('pending', 'failed')
        and event.dead_lettered_at is null
        and event.attempts >= greatest(1, event.max_attempts - 1)
    ),
    'unknown_event_type_count', count(*) filter (
      where event.event_type not in (
        'merchant.notification.deliver',
        'google.reviews.sync',
        'asset.convert',
        'site.publish.follow_up',
        'backup.create',
        'webhook.deliver',
        'enterprise.workflow_automation.process'
      )
    ),
    'oldest_due_age_seconds', coalesce(
      extract(epoch from (
        now() - min(event.available_at) filter (
          where event.status in ('pending', 'failed')
            and event.dead_lettered_at is null
            and event.available_at <= now()
        )
      ))::bigint,
      0
    ),
    'attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    ),
    'completed_attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and attempt.outcome = 'completed'
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    ),
    'retry_attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and attempt.outcome = 'retry_scheduled'
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    ),
    'dead_letter_attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and attempt.outcome = 'dead_lettered'
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    ),
    'lease_expired_attempts_in_window', (
      select count(*)
        from public.merchant_outbox_attempts attempt
        join public.merchant_outbox_events attempt_event
          on attempt_event.id = attempt.event_id
       where attempt.started_at >= now() - make_interval(hours => v_window_hours)
         and attempt.outcome = 'lease_expired'
         and (v_merchant_id is null or attempt_event.merchant_id = v_merchant_id)
    )
  )
    into v_result
    from public.merchant_outbox_events event
   where v_merchant_id is null or event.merchant_id = v_merchant_id;

  return v_result;
end;
$$;

-- The append helper intentionally relies on immutable table constraints for
-- its vocabulary. Preserve the complete existing audit vocabulary and add the
-- automation events before any rule can be called through PostgREST.
alter table public.merchant_enterprise_audit_events
  drop constraint if exists merchant_enterprise_audit_events_event_type_check;
alter table public.merchant_enterprise_audit_events
  add constraint merchant_enterprise_audit_events_event_type_check
  check (event_type in (
    'workspace.bootstrapped',
    'role.created',
    'role.updated',
    'role.board_scope_changed',
    'board.created',
    'board.updated',
    'column.created',
    'column.updated',
    'employee.created',
    'employee.updated',
    'employee.renamed',
    'employee.role_changed',
    'employee.disabled',
    'employee.restored',
    'employee.removed',
    'invitation.reserved',
    'invitation.revoked',
    'invitation.removed',
    'invitation.accepted',
    'invitation.delivery_finalized',
    'invitation.auth_bound',
    'workflow.created',
    'workflow.updated',
    'workflow.published',
    'workflow.archived',
    'workflow.restored',
    'automation.created',
    'automation.updated',
    'automation.paused',
    'automation.resumed',
    'automation.archived',
    'automation.fired',
    'automation.failed'
  ));
alter table public.merchant_enterprise_audit_events
  drop constraint if exists merchant_enterprise_audit_events_entity_type_check;
alter table public.merchant_enterprise_audit_events
  add constraint merchant_enterprise_audit_events_entity_type_check
  check (entity_type in (
    'workspace', 'role', 'board', 'column', 'employee', 'invitation',
    'workflow', 'automation'
  ));

revoke all on function public.faolla_valid_merchant_enterprise_permissions_v1(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_add_default_workflow_permissions_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_authorize_merchant_enterprise_automation_actor_v1(
  jsonb, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.faolla_build_merchant_enterprise_automation_rule_v1(
  text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.faolla_mutate_merchant_enterprise_automation_rule_v1(
  jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.faolla_apply_merchant_enterprise_automation_rule_v1(
  uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.faolla_dispatch_merchant_enterprise_order_automation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_dispatch_merchant_enterprise_booking_automation_v1()
  from public, anon, authenticated, service_role;

revoke all on function public.faolla_list_merchant_enterprise_automation_rules_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_create_merchant_enterprise_automation_rule_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_enterprise_automation_rule_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_archive_merchant_enterprise_automation_rule_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_process_merchant_enterprise_automation_event_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_pause_merchant_enterprise_automations_for_entitlement_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_list_merchant_enterprise_audit_events_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_discover_merchant_enterprise_automation_merchants_v1(
  text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.faolla_claim_merchant_enterprise_automation_outbox_v1(
  text, text[], text[], integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.faolla_get_merchant_outbox_health_v1(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.faolla_list_merchant_enterprise_automation_rules_v1(jsonb)
  to service_role;
grant execute on function public.faolla_create_merchant_enterprise_automation_rule_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_enterprise_automation_rule_v1(jsonb)
  to service_role;
grant execute on function public.faolla_archive_merchant_enterprise_automation_rule_v1(jsonb)
  to service_role;
grant execute on function public.faolla_process_merchant_enterprise_automation_event_v1(jsonb)
  to service_role;
grant execute on function public.faolla_pause_merchant_enterprise_automations_for_entitlement_v1(jsonb)
  to service_role;
grant execute on function public.faolla_list_merchant_enterprise_audit_events_v1(jsonb)
  to service_role;
grant execute on function public.faolla_discover_merchant_enterprise_automation_merchants_v1(
  text, integer
) to service_role;
grant execute on function public.faolla_claim_merchant_enterprise_automation_outbox_v1(
  text, text[], text[], integer, integer
) to service_role;
grant execute on function public.faolla_get_merchant_outbox_health_v1(text, integer)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608040026, 'merchant_enterprise_workflow_automations')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
