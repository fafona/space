-- Immutable, merchant-scoped enterprise administration audit trail.
-- Every audited write is appended by a transaction-local trigger after the
-- existing atomic authorization wrapper has accepted the operation.

begin;

create table if not exists public.merchant_enterprise_audit_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  event_type text not null check (event_type in (
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
    'invitation.auth_bound'
  )),
  entity_type text not null check (entity_type in (
    'workspace', 'role', 'board', 'column', 'employee', 'invitation'
  )),
  entity_id uuid null,
  actor_type text not null check (actor_type in ('owner', 'employee', 'system')),
  actor_id uuid null,
  actor_label text not null check (char_length(actor_label) between 1 and 160),
  target_label text not null check (char_length(target_label) between 1 and 160),
  before_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(before_data) = 'object'),
  after_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(after_data) = 'object'),
  operation_id text not null default '' check (char_length(operation_id) <= 160),
  dedupe_key text null check (
    dedupe_key is null or char_length(dedupe_key) between 1 and 200
  ),
  created_at timestamptz not null default statement_timestamp(),
  constraint merchant_enterprise_audit_events_actor_identity_check
    check (
      (actor_type = 'employee' and actor_id is not null)
      or (actor_type in ('owner', 'system') and actor_id is null)
    )
);

create index if not exists merchant_enterprise_audit_events_merchant_created_idx
  on public.merchant_enterprise_audit_events(merchant_id, created_at desc, id desc);
create index if not exists merchant_enterprise_audit_events_entity_created_idx
  on public.merchant_enterprise_audit_events(
    merchant_id, entity_type, entity_id, created_at desc
  );
create unique index if not exists merchant_enterprise_audit_events_dedupe_idx
  on public.merchant_enterprise_audit_events(merchant_id, dedupe_key)
  where dedupe_key is not null;

alter table public.merchant_enterprise_audit_events enable row level security;
revoke all on public.merchant_enterprise_audit_events
  from public, anon, authenticated, service_role;

create or replace function public.faolla_reject_merchant_enterprise_audit_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'enterprise_audit_events_append_only';
end;
$$;

drop trigger if exists merchant_enterprise_audit_events_append_only
  on public.merchant_enterprise_audit_events;
create trigger merchant_enterprise_audit_events_append_only
before update or delete on public.merchant_enterprise_audit_events
for each row execute function public.faolla_reject_merchant_enterprise_audit_mutation_v1();

create or replace function public.faolla_set_merchant_enterprise_audit_context_v1(
  p_input jsonb,
  p_action text,
  p_actor_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text := 'system';
  v_actor_id text := '';
  v_operation_id text := '';
begin
  if p_action is null or char_length(p_action) not between 1 and 80 then
    raise exception 'invalid_enterprise_audit_context';
  end if;
  if p_actor_mode not in ('input', 'accepting_employee', 'system') then
    raise exception 'invalid_enterprise_audit_context';
  end if;

  if p_actor_mode = 'input' then
    v_actor_type := coalesce(nullif(btrim(p_input ->> 'actor_type'), ''), 'system');
    v_actor_id := coalesce(nullif(btrim(p_input ->> 'actor_id'), ''), '');
  elsif p_actor_mode = 'accepting_employee' then
    v_actor_type := 'employee';
  end if;
  v_operation_id := left(
    coalesce(nullif(btrim(p_input ->> 'operation_id'), ''), ''),
    160
  );

  perform set_config('faolla.enterprise_audit_action', p_action, true);
  perform set_config('faolla.enterprise_audit_actor_type', v_actor_type, true);
  perform set_config('faolla.enterprise_audit_actor_id', v_actor_id, true);
  perform set_config('faolla.enterprise_audit_operation_id', v_operation_id, true);
end;
$$;

create or replace function public.faolla_append_merchant_enterprise_audit_event_v1(
  p_merchant_id text,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_target_label text,
  p_before_data jsonb,
  p_after_data jsonb,
  p_dedupe_key text,
  p_actor_type text,
  p_actor_id uuid,
  p_actor_label text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_actor_label text;
  v_operation_id text;
begin
  v_actor_type := coalesce(
    nullif(p_actor_type, ''),
    nullif(current_setting('faolla.enterprise_audit_actor_type', true), ''),
    'system'
  );
  if v_actor_type not in ('owner', 'employee', 'system') then
    v_actor_type := 'system';
  end if;

  v_actor_id := p_actor_id;
  if v_actor_id is null then
    v_actor_id_text := nullif(
      current_setting('faolla.enterprise_audit_actor_id', true),
      ''
    );
    if v_actor_id_text is not null
       and v_actor_id_text ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_actor_id := v_actor_id_text::uuid;
    end if;
  end if;
  -- Owner authorization UUIDs are credentials metadata, not business entity
  -- identifiers. Keep the immutable owner snapshot label but never persist the
  -- underlying auth UUID. Employee IDs are enterprise-domain identifiers.
  if v_actor_type in ('owner', 'system') then
    v_actor_id := null;
  end if;

  v_actor_label := nullif(btrim(p_actor_label), '');
  if v_actor_label is null and v_actor_type = 'employee' and v_actor_id is not null then
    select nullif(btrim(employee.display_name), '')
      into v_actor_label
      from public.merchant_enterprise_employees as employee
     where employee.merchant_id = p_merchant_id
       and employee.id = v_actor_id;
  end if;
  v_actor_label := left(coalesce(
    v_actor_label,
    case v_actor_type
      when 'owner' then '企业负责人'
      when 'employee' then '员工'
      else '系统'
    end
  ), 160);
  v_operation_id := left(coalesce(
    current_setting('faolla.enterprise_audit_operation_id', true),
    ''
  ), 160);

  insert into public.merchant_enterprise_audit_events (
    id,
    merchant_id,
    event_type,
    entity_type,
    entity_id,
    actor_type,
    actor_id,
    actor_label,
    target_label,
    before_data,
    after_data,
    operation_id,
    dedupe_key
  )
  values (
    v_id,
    p_merchant_id,
    p_event_type,
    p_entity_type,
    p_entity_id,
    v_actor_type,
    v_actor_id,
    v_actor_label,
    left(coalesce(nullif(btrim(p_target_label), ''), '企业对象'), 160),
    coalesce(p_before_data, '{}'::jsonb),
    coalesce(p_after_data, '{}'::jsonb),
    v_operation_id,
    p_dedupe_key
  )
  on conflict (merchant_id, dedupe_key) where dedupe_key is not null
  do nothing;

  if not found then
    select audit_event.id
      into v_id
      from public.merchant_enterprise_audit_events as audit_event
     where audit_event.merchant_id = p_merchant_id
       and audit_event.dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end;
$$;

create or replace function public.faolla_capture_merchant_enterprise_audit_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_context_action text := coalesce(
    current_setting('faolla.enterprise_audit_action', true),
    ''
  );
  v_merchant_id text;
  v_event_type text;
  v_entity_type text;
  v_entity_id uuid;
  v_target_label text;
  v_actor_type text := null;
  v_actor_id uuid := null;
  v_actor_label text := null;
  v_changed_count integer := 0;
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;
  v_merchant_id := coalesce(v_new ->> 'merchant_id', v_old ->> 'merchant_id');

  -- Bootstrap is represented by one workspace event appended by its wrapper.
  if v_context_action = 'workspace.bootstrap' then
    perform set_config('faolla.enterprise_audit_mutated', '1', true);
    return null;
  end if;

  if tg_table_name = 'merchant_enterprise_roles' then
    v_before := case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object(
      'name', v_old -> 'name',
      'description', v_old -> 'description',
      'permissions', v_old -> 'permissions',
      'status', v_old -> 'status',
      'is_system', v_old -> 'is_system',
      'access_scope', v_old -> 'access_scope',
      'system_key', v_old -> 'system_key'
    ) end;
    v_after := case when tg_op = 'DELETE' then '{}'::jsonb else jsonb_build_object(
      'name', v_new -> 'name',
      'description', v_new -> 'description',
      'permissions', v_new -> 'permissions',
      'status', v_new -> 'status',
      'is_system', v_new -> 'is_system',
      'access_scope', v_new -> 'access_scope',
      'system_key', v_new -> 'system_key'
    ) end;
    v_event_type := case when tg_op = 'INSERT' then 'role.created' else 'role.updated' end;
    v_entity_type := 'role';
    v_entity_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
    v_target_label := coalesce(v_new ->> 'name', v_old ->> 'name', '角色');
  elsif tg_table_name = 'merchant_enterprise_role_boards' then
    v_before := case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object(
      'board_id', v_old -> 'board_id'
    ) end;
    v_after := case when tg_op = 'DELETE' then '{}'::jsonb else jsonb_build_object(
      'board_id', v_new -> 'board_id'
    ) end;
    v_event_type := 'role.board_scope_changed';
    v_entity_type := 'role';
    v_entity_id := coalesce(v_new ->> 'role_id', v_old ->> 'role_id')::uuid;
    select role_row.name
      into v_target_label
      from public.merchant_enterprise_roles as role_row
     where role_row.merchant_id = v_merchant_id
       and role_row.id = v_entity_id;
    v_target_label := coalesce(v_target_label, '角色');
  elsif tg_table_name = 'merchant_task_boards' then
    v_before := case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object(
      'name', v_old -> 'name',
      'description', v_old -> 'description',
      'status', v_old -> 'status',
      'position', v_old -> 'position',
      'system_key', v_old -> 'system_key'
    ) end;
    v_after := case when tg_op = 'DELETE' then '{}'::jsonb else jsonb_build_object(
      'name', v_new -> 'name',
      'description', v_new -> 'description',
      'status', v_new -> 'status',
      'position', v_new -> 'position',
      'system_key', v_new -> 'system_key'
    ) end;
    v_event_type := case when tg_op = 'INSERT' then 'board.created' else 'board.updated' end;
    v_entity_type := 'board';
    v_entity_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
    v_target_label := coalesce(v_new ->> 'name', v_old ->> 'name', '任务看板');
  elsif tg_table_name = 'merchant_task_columns' then
    v_before := case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object(
      'board_id', v_old -> 'board_id',
      'name', v_old -> 'name',
      'color', v_old -> 'color',
      'position', v_old -> 'position',
      'is_done', v_old -> 'is_done',
      'status', v_old -> 'status',
      'system_key', v_old -> 'system_key'
    ) end;
    v_after := case when tg_op = 'DELETE' then '{}'::jsonb else jsonb_build_object(
      'board_id', v_new -> 'board_id',
      'name', v_new -> 'name',
      'color', v_new -> 'color',
      'position', v_new -> 'position',
      'is_done', v_new -> 'is_done',
      'status', v_new -> 'status',
      'system_key', v_new -> 'system_key'
    ) end;
    v_event_type := case when tg_op = 'INSERT' then 'column.created' else 'column.updated' end;
    v_entity_type := 'column';
    v_entity_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
    v_target_label := coalesce(v_new ->> 'name', v_old ->> 'name', '工作列');
  elsif tg_table_name = 'merchant_enterprise_employees' then
    -- Whitelist only display/lifecycle fields. Email, auth UUIDs, invitation
    -- token hashes and all authentication metadata never enter the audit row.
    v_before := case when tg_op = 'INSERT' then '{}'::jsonb else jsonb_build_object(
      'display_name', v_old -> 'display_name',
      'role_id', v_old -> 'role_id',
      'status', v_old -> 'status',
      'auth_bound', coalesce((v_old ->> 'auth_user_id') <> '', false),
      'invitation_version', v_old -> 'invitation_version',
      'invitation_delivery_status', v_old -> 'invitation_delivery_status',
      'invitation_sent_at', v_old -> 'invitation_sent_at',
      'invitation_expires_at', v_old -> 'invitation_expires_at',
      'invitation_revoked_at', v_old -> 'invitation_revoked_at',
      'accepted_at', v_old -> 'accepted_at'
    ) end;
    v_after := case when tg_op = 'DELETE' then '{}'::jsonb else jsonb_build_object(
      'display_name', v_new -> 'display_name',
      'role_id', v_new -> 'role_id',
      'status', v_new -> 'status',
      'auth_bound', coalesce((v_new ->> 'auth_user_id') <> '', false),
      'invitation_version', v_new -> 'invitation_version',
      'invitation_delivery_status', v_new -> 'invitation_delivery_status',
      'invitation_sent_at', v_new -> 'invitation_sent_at',
      'invitation_expires_at', v_new -> 'invitation_expires_at',
      'invitation_revoked_at', v_new -> 'invitation_revoked_at',
      'accepted_at', v_new -> 'accepted_at'
    ) end;
    v_entity_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
    v_target_label := coalesce(
      v_new ->> 'display_name',
      v_old ->> 'display_name',
      '员工'
    );
    if tg_op = 'INSERT' then
      v_event_type := 'employee.created';
      v_entity_type := 'employee';
    elsif tg_op = 'DELETE' then
      v_event_type := case
        when v_context_action = 'invitation.remove' then 'invitation.removed'
        else 'employee.removed'
      end;
      v_entity_type := case
        when v_context_action = 'invitation.remove' then 'invitation'
        else 'employee'
      end;
    elsif v_context_action = 'invitation.reserve' then
      v_event_type := 'invitation.reserved';
      v_entity_type := 'invitation';
    elsif v_context_action = 'invitation.revoke' then
      v_event_type := 'invitation.revoked';
      v_entity_type := 'invitation';
    elsif v_context_action = 'invitation.accept' then
      v_event_type := 'invitation.accepted';
      v_entity_type := 'invitation';
      v_actor_type := 'employee';
      v_actor_id := (v_new ->> 'id')::uuid;
      v_actor_label := v_new ->> 'display_name';
    elsif v_context_action = 'invitation.finalize' then
      v_event_type := 'invitation.delivery_finalized';
      v_entity_type := 'invitation';
    elsif v_context_action = 'invitation.bind' then
      v_event_type := 'invitation.auth_bound';
      v_entity_type := 'invitation';
    else
      v_entity_type := 'employee';
      v_changed_count :=
        case when v_old -> 'display_name' is distinct from v_new -> 'display_name' then 1 else 0 end
        + case when v_old -> 'role_id' is distinct from v_new -> 'role_id' then 1 else 0 end
        + case when v_old -> 'status' is distinct from v_new -> 'status' then 1 else 0 end;
      v_event_type := case
        when v_changed_count <> 1 then 'employee.updated'
        when v_old -> 'display_name' is distinct from v_new -> 'display_name'
          then 'employee.renamed'
        when v_old -> 'role_id' is distinct from v_new -> 'role_id'
          then 'employee.role_changed'
        when v_new ->> 'status' = 'disabled' then 'employee.disabled'
        when v_old ->> 'status' = 'disabled' and v_new ->> 'status' = 'active'
          then 'employee.restored'
        else 'employee.updated'
      end;
    end if;
  else
    raise exception 'unsupported_enterprise_audit_table';
  end if;

  if v_before is not distinct from v_after then
    return null;
  end if;
  perform set_config('faolla.enterprise_audit_mutated', '1', true);
  perform public.faolla_append_merchant_enterprise_audit_event_v1(
    v_merchant_id,
    v_event_type,
    v_entity_type,
    v_entity_id,
    v_target_label,
    v_before,
    v_after,
    null,
    v_actor_type,
    v_actor_id,
    v_actor_label
  );
  return null;
end;
$$;

drop trigger if exists merchant_enterprise_roles_audit
  on public.merchant_enterprise_roles;
create trigger merchant_enterprise_roles_audit
after insert or update on public.merchant_enterprise_roles
for each row execute function public.faolla_capture_merchant_enterprise_audit_v1();

drop trigger if exists merchant_enterprise_role_boards_audit
  on public.merchant_enterprise_role_boards;
create trigger merchant_enterprise_role_boards_audit
after insert or delete on public.merchant_enterprise_role_boards
for each row execute function public.faolla_capture_merchant_enterprise_audit_v1();

drop trigger if exists merchant_task_boards_enterprise_audit
  on public.merchant_task_boards;
create trigger merchant_task_boards_enterprise_audit
after insert or update on public.merchant_task_boards
for each row execute function public.faolla_capture_merchant_enterprise_audit_v1();

drop trigger if exists merchant_task_columns_enterprise_audit
  on public.merchant_task_columns;
create trigger merchant_task_columns_enterprise_audit
after insert or update on public.merchant_task_columns
for each row execute function public.faolla_capture_merchant_enterprise_audit_v1();

drop trigger if exists merchant_enterprise_employees_audit
  on public.merchant_enterprise_employees;
create trigger merchant_enterprise_employees_audit
after insert or update or delete on public.merchant_enterprise_employees
for each row execute function public.faolla_capture_merchant_enterprise_audit_v1();

-- Prepare the database permission catalog for the audit screen. The
-- application can expose this permission independently without weakening any
-- existing role dependency.
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
      'audit.view'
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
      'audit.view'
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
    and (not ('audit.view' = any(p_permissions)) or 'enterprise.view' = any(p_permissions));
$$;

-- Preserve every existing public RPC name. The renamed implementations retain
-- all prior authorization and locking; these wrappers add only transaction-
-- local audit context before delegating.
alter function public.faolla_create_merchant_enterprise_role_v1(jsonb)
  rename to faolla_create_merchant_enterprise_role_v1_preaudit_019;
alter function public.faolla_update_merchant_enterprise_role_v1(jsonb)
  rename to faolla_update_merchant_enterprise_role_v1_preaudit_019;
alter function public.faolla_create_merchant_enterprise_role_v2(jsonb)
  rename to faolla_create_merchant_enterprise_role_v2_preaudit_019;
alter function public.faolla_update_merchant_enterprise_role_v2(jsonb)
  rename to faolla_update_merchant_enterprise_role_v2_preaudit_019;
alter function public.faolla_bootstrap_merchant_enterprise_v2(jsonb)
  rename to faolla_bootstrap_merchant_enterprise_v2_preaudit_019;
alter function public.faolla_create_merchant_task_board_v1(jsonb)
  rename to faolla_create_merchant_task_board_v1_preaudit_019;
alter function public.faolla_update_merchant_task_board_v1(jsonb)
  rename to faolla_update_merchant_task_board_v1_preaudit_019;
alter function public.faolla_create_merchant_task_column_v1(jsonb)
  rename to faolla_create_merchant_task_column_v1_preaudit_019;
alter function public.faolla_update_merchant_task_column_v1(jsonb)
  rename to faolla_update_merchant_task_column_v1_preaudit_019;
alter function public.faolla_create_merchant_enterprise_employee_v1(jsonb)
  rename to faolla_create_merchant_enterprise_employee_v1_preaudit_019;
alter function public.faolla_update_merchant_enterprise_employee_v1(jsonb)
  rename to faolla_update_merchant_enterprise_employee_v1_preaudit_019;
alter function public.faolla_reserve_merchant_employee_invitation_v1(jsonb)
  rename to faolla_reserve_merchant_employee_invitation_v1_preaudit_019;
alter function public.faolla_revoke_merchant_employee_invitation_v1(jsonb)
  rename to faolla_revoke_merchant_employee_invitation_v1_preaudit_019;
alter function public.faolla_remove_merchant_employee_invitation_v1(jsonb)
  rename to faolla_remove_merchant_employee_invitation_v1_preaudit_019;
alter function public.faolla_accept_merchant_employee_invitation_v1(jsonb)
  rename to faolla_accept_merchant_employee_invitation_v1_preaudit_019;
alter function public.faolla_finalize_merchant_employee_invitation_v1(jsonb)
  rename to faolla_finalize_merchant_employee_invitation_v1_preaudit_019;
alter function public.faolla_bind_merchant_employee_auth_user_v1(jsonb)
  rename to faolla_bind_merchant_employee_auth_user_v1_preaudit_019;

revoke all on function public.faolla_create_merchant_enterprise_role_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_enterprise_role_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_create_merchant_enterprise_role_v2_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_enterprise_role_v2_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_bootstrap_merchant_enterprise_v2_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_create_merchant_task_board_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_task_board_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_create_merchant_task_column_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_task_column_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_create_merchant_enterprise_employee_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_enterprise_employee_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_reserve_merchant_employee_invitation_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_revoke_merchant_employee_invitation_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_remove_merchant_employee_invitation_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_accept_merchant_employee_invitation_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_finalize_merchant_employee_invitation_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.faolla_bind_merchant_employee_auth_user_v1_preaudit_019(jsonb) from public, anon, authenticated, service_role;

create or replace function public.faolla_create_merchant_enterprise_role_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'role.create', 'input');
  return public.faolla_create_merchant_enterprise_role_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_update_merchant_enterprise_role_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'role.update', 'input');
  return public.faolla_update_merchant_enterprise_role_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_create_merchant_enterprise_role_v2(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'role.create', 'input');
  return public.faolla_create_merchant_enterprise_role_v2_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_update_merchant_enterprise_role_v2(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'role.update', 'input');
  return public.faolla_update_merchant_enterprise_role_v2_preaudit_019(p_input);
end;
$$;

create or replace function public.faolla_bootstrap_merchant_enterprise_v2(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_response jsonb;
  v_site_id text;
  v_operation_id text;
begin
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input, 'workspace.bootstrap', 'input'
  );
  perform set_config('faolla.enterprise_audit_mutated', '0', true);
  v_response := public.faolla_bootstrap_merchant_enterprise_v2_preaudit_019(p_input);
  if current_setting('faolla.enterprise_audit_mutated', true) = '1' then
    perform public.faolla_append_merchant_enterprise_audit_event_v1(
      v_site_id,
      'workspace.bootstrapped',
      'workspace',
      null,
      '企业工作区',
      '{}'::jsonb,
      jsonb_build_object('initialized', true),
      'workspace.bootstrap:' || v_operation_id,
      null,
      null,
      null
    );
  end if;
  return v_response;
end;
$$;

create or replace function public.faolla_create_merchant_task_board_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'board.create', 'input');
  return public.faolla_create_merchant_task_board_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_update_merchant_task_board_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'board.update', 'input');
  return public.faolla_update_merchant_task_board_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_create_merchant_task_column_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'column.create', 'input');
  return public.faolla_create_merchant_task_column_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_update_merchant_task_column_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'column.update', 'input');
  return public.faolla_update_merchant_task_column_v1_preaudit_019(p_input);
end;
$$;

create or replace function public.faolla_create_merchant_enterprise_employee_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'employee.create', 'input');
  return public.faolla_create_merchant_enterprise_employee_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_update_merchant_enterprise_employee_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'employee.update', 'input');
  return public.faolla_update_merchant_enterprise_employee_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_reserve_merchant_employee_invitation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'invitation.reserve', 'input');
  return public.faolla_reserve_merchant_employee_invitation_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_revoke_merchant_employee_invitation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'invitation.revoke', 'input');
  return public.faolla_revoke_merchant_employee_invitation_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_remove_merchant_employee_invitation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'invitation.remove', 'input');
  return public.faolla_remove_merchant_employee_invitation_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_accept_merchant_employee_invitation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input, 'invitation.accept', 'accepting_employee'
  );
  return public.faolla_accept_merchant_employee_invitation_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_finalize_merchant_employee_invitation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input, 'invitation.finalize', 'system'
  );
  return public.faolla_finalize_merchant_employee_invitation_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_bind_merchant_employee_auth_user_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(
    p_input, 'invitation.bind', 'system'
  );
  return public.faolla_bind_merchant_employee_auth_user_v1_preaudit_019(p_input);
end;
$$;

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
  v_actor_type text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_limit integer := 50;
  v_before_created_at timestamptz := null;
  v_before_id uuid := null;
  v_entity_type text := null;
  v_event_type text := null;
  v_merchant public.merchants%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_role public.merchant_enterprise_roles%rowtype;
  v_events jsonb;
  v_last_created_at timestamptz;
  v_last_id uuid;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null or v_site_id !~ '^[0-9]{8}$'
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id_text is null
     or v_actor_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'permission_denied';
  end if;
  v_actor_id := v_actor_id_text::uuid;
  if p_input ? 'limit' then
    v_limit := (p_input ->> 'limit')::integer;
  end if;
  if v_limit not between 1 and 100 then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  v_entity_type := nullif(btrim(p_input ->> 'entity_type'), '');
  v_event_type := nullif(btrim(p_input ->> 'event_type'), '');
  if v_entity_type is not null
     and v_entity_type not in ('workspace', 'role', 'board', 'column', 'employee', 'invitation') then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  if v_event_type is not null
     and v_event_type not in (
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
       'invitation.auth_bound'
     ) then
    raise exception 'invalid_enterprise_audit_query';
  end if;
  if (p_input ? 'before_created_at') <> (p_input ? 'before_id') then
    raise exception 'invalid_enterprise_audit_cursor';
  end if;
  if p_input ? 'before_created_at' then
    v_before_created_at := nullif(btrim(p_input ->> 'before_created_at'), '')::timestamptz;
    v_actor_id_text := nullif(btrim(p_input ->> 'before_id'), '');
    if v_before_created_at is null
       or v_actor_id_text is null
       or v_actor_id_text !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_enterprise_audit_cursor';
    end if;
    v_before_id := v_actor_id_text::uuid;
  end if;

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
  else
    select * into v_employee
      from public.merchant_enterprise_employees
     where merchant_id = v_site_id
       and id = v_actor_id
     for share;
    if not found or v_employee.status <> 'active' then
      raise exception 'permission_denied';
    end if;
    select * into v_role
      from public.merchant_enterprise_roles
     where merchant_id = v_site_id
       and id = v_employee.role_id
     for share;
    if not found
       or v_role.status <> 'active'
       or not ('audit.view' = any(v_role.permissions)) then
      raise exception 'permission_denied';
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc), '[]'::jsonb)
    into v_events
    from (
      select audit_event.*
        from public.merchant_enterprise_audit_events as audit_event
       where audit_event.merchant_id = v_site_id
         and (v_entity_type is null or audit_event.entity_type = v_entity_type)
         and (v_event_type is null or audit_event.event_type = v_event_type)
         and (
           v_before_created_at is null
           or (audit_event.created_at, audit_event.id) < (v_before_created_at, v_before_id)
         )
       order by audit_event.created_at desc, audit_event.id desc
       limit v_limit
    ) as page;

  select page.created_at, page.id
    into v_last_created_at, v_last_id
    from (
      select audit_event.created_at, audit_event.id
        from public.merchant_enterprise_audit_events as audit_event
       where audit_event.merchant_id = v_site_id
         and (v_entity_type is null or audit_event.entity_type = v_entity_type)
         and (v_event_type is null or audit_event.event_type = v_event_type)
         and (
           v_before_created_at is null
           or (audit_event.created_at, audit_event.id) < (v_before_created_at, v_before_id)
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

revoke all on function public.faolla_reject_merchant_enterprise_audit_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_set_merchant_enterprise_audit_context_v1(jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_append_merchant_enterprise_audit_event_v1(
  text, text, text, uuid, text, jsonb, jsonb, text, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.faolla_capture_merchant_enterprise_audit_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_valid_merchant_enterprise_permissions_v1(text[])
  from public, anon, authenticated, service_role;

revoke all on function public.faolla_create_merchant_enterprise_role_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_role_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_enterprise_role_v2(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_role_v2(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_bootstrap_merchant_enterprise_v2(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_task_board_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_board_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_task_column_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_column_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_enterprise_employee_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_enterprise_employee_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_reserve_merchant_employee_invitation_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_revoke_merchant_employee_invitation_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_remove_merchant_employee_invitation_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_accept_merchant_employee_invitation_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_finalize_merchant_employee_invitation_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_bind_merchant_employee_auth_user_v1(jsonb) from public, anon, authenticated;
revoke all on function public.faolla_list_merchant_enterprise_audit_events_v1(jsonb) from public, anon, authenticated;

grant execute on function public.faolla_create_merchant_enterprise_role_v1(jsonb) to service_role;
grant execute on function public.faolla_update_merchant_enterprise_role_v1(jsonb) to service_role;
grant execute on function public.faolla_create_merchant_enterprise_role_v2(jsonb) to service_role;
grant execute on function public.faolla_update_merchant_enterprise_role_v2(jsonb) to service_role;
grant execute on function public.faolla_bootstrap_merchant_enterprise_v2(jsonb) to service_role;
grant execute on function public.faolla_create_merchant_task_board_v1(jsonb) to service_role;
grant execute on function public.faolla_update_merchant_task_board_v1(jsonb) to service_role;
grant execute on function public.faolla_create_merchant_task_column_v1(jsonb) to service_role;
grant execute on function public.faolla_update_merchant_task_column_v1(jsonb) to service_role;
grant execute on function public.faolla_create_merchant_enterprise_employee_v1(jsonb) to service_role;
grant execute on function public.faolla_update_merchant_enterprise_employee_v1(jsonb) to service_role;
grant execute on function public.faolla_reserve_merchant_employee_invitation_v1(jsonb) to service_role;
grant execute on function public.faolla_revoke_merchant_employee_invitation_v1(jsonb) to service_role;
grant execute on function public.faolla_remove_merchant_employee_invitation_v1(jsonb) to service_role;
grant execute on function public.faolla_accept_merchant_employee_invitation_v1(jsonb) to service_role;
grant execute on function public.faolla_finalize_merchant_employee_invitation_v1(jsonb) to service_role;
grant execute on function public.faolla_bind_merchant_employee_auth_user_v1(jsonb) to service_role;
grant execute on function public.faolla_list_merchant_enterprise_audit_events_v1(jsonb) to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608020019, 'merchant_enterprise_audit')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
