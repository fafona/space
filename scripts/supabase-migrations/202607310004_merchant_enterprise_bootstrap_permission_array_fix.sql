begin;

-- 202607310002 created the transactional bootstrap RPC with JSONB permission
-- literals, while merchant_enterprise_roles.permissions is a text[] column.
-- PostgreSQL validates that mismatch when the RPC is first executed, so replace
-- the function forward-only and keep the already-applied migration immutable.
create or replace function public.faolla_bootstrap_merchant_enterprise_v2(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claim jsonb;
  v_board public.merchant_task_boards%rowtype;
  v_active_board_count integer;
  v_active_column_count integer;
  v_missing_column_count integer;
  v_next_position integer;
  v_roles jsonb;
  v_columns jsonb;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_enterprise_bootstrap_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_enterprise_bootstrap';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('faolla-enterprise-structure:' || v_site_id, 0)
  );
  perform 1
    from public.merchants
   where id = v_site_id
   for share;
  if not found then
    raise exception 'invalid_site_id';
  end if;

  v_idempotency_key := 'enterprise-bootstrap-v2:' || v_operation_id;
  v_request_hash := md5(p_input::text);
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_bootstrap_v2',
    v_request_hash
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  insert into public.merchant_enterprise_roles (
    merchant_id,
    name,
    system_key,
    description,
    permissions,
    status,
    is_system
  )
  values
    (
      v_site_id,
      '管理员',
      'administrator',
      '管理企业协作模块内的员工、角色、看板和任务。',
      array[
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
      ]::text[],
      'active',
      true
    ),
    (
      v_site_id,
      '主管',
      'supervisor',
      '查看团队并负责创建、分派和推进任务。',
      array[
        'enterprise.view',
        'tasks.view',
        'tasks.create',
        'tasks.update',
        'tasks.assign',
        'employees.view',
        'roles.view'
      ]::text[],
      'active',
      true
    ),
    (
      v_site_id,
      '员工',
      'employee',
      '查看协作看板，并创建和推进团队任务。',
      array[
        'enterprise.view',
        'tasks.view',
        'tasks.create',
        'tasks.update'
      ]::text[],
      'active',
      true
    )
  on conflict (merchant_id, system_key) do nothing;

  select *
    into v_board
    from public.merchant_task_boards
   where merchant_id = v_site_id
     and system_key = 'default'
   for update;

  if not found then
    select count(*)::integer
      into v_active_board_count
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and status = 'active';
    if v_active_board_count >= 50 then
      raise exception 'board_limit_reached';
    end if;

    select coalesce(max(position), -1) + 1
      into v_next_position
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and status = 'active';

    insert into public.merchant_task_boards (
      merchant_id,
      name,
      system_key,
      description,
      status,
      position
    )
    values (
      v_site_id,
      '团队任务',
      'default',
      '集中安排和推进团队工作。',
      'active',
      v_next_position
    )
    returning * into v_board;
  end if;

  select count(*)::integer
    into v_missing_column_count
    from (
      values ('todo'), ('in_progress'), ('blocked'), ('done')
    ) as defaults(system_key)
   where not exists (
     select 1
     from public.merchant_task_columns as task_column
     where task_column.merchant_id = v_site_id
       and task_column.board_id = v_board.id
       and task_column.system_key = defaults.system_key
   );

  select count(*)::integer
    into v_active_column_count
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_board.id
     and status = 'active';

  if v_active_column_count + v_missing_column_count > 30 then
    raise exception 'column_limit_reached';
  end if;

  select coalesce(max(position), -1) + 1
    into v_next_position
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_board.id
     and status = 'active';

  insert into public.merchant_task_columns (
    merchant_id,
    board_id,
    name,
    system_key,
    color,
    position,
    is_done,
    status
  )
  select
    v_site_id,
    v_board.id,
    defaults.name,
    defaults.system_key,
    defaults.color,
    v_next_position
      + (row_number() over (order by defaults.default_position) - 1)::integer,
    defaults.is_done,
    'active'
  from (
    values
      ('待处理', 'todo', '#64748b', 0, false),
      ('进行中', 'in_progress', '#2563eb', 1, false),
      ('受阻', 'blocked', '#dc2626', 2, false),
      ('已完成', 'done', '#16a34a', 3, true)
  ) as defaults(name, system_key, color, default_position, is_done)
  where not exists (
    select 1
    from public.merchant_task_columns as task_column
    where task_column.merchant_id = v_site_id
      and task_column.board_id = v_board.id
      and task_column.system_key = defaults.system_key
  )
  on conflict (merchant_id, board_id, system_key) do nothing;

  select coalesce(
           jsonb_agg(
             (to_jsonb(role_row) - 'system_key')
             order by role_row.created_at, role_row.id
           ),
           '[]'::jsonb
         )
    into v_roles
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.system_key in ('administrator', 'supervisor', 'employee');

  select coalesce(
           jsonb_agg(
             (to_jsonb(column_row) - 'system_key')
             order by column_row.position, column_row.id
           ),
           '[]'::jsonb
         )
    into v_columns
    from public.merchant_task_columns as column_row
   where column_row.merchant_id = v_site_id
     and column_row.board_id = v_board.id
     and column_row.system_key in ('todo', 'in_progress', 'blocked', 'done');

  v_response := jsonb_build_object(
    'board', to_jsonb(v_board) - 'system_key',
    'columns', v_columns,
    'roles', v_roles
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    v_response
  );
end;
$$;

revoke all on function public.faolla_bootstrap_merchant_enterprise_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_bootstrap_merchant_enterprise_v2(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310004, 'merchant_enterprise_bootstrap_permission_array_fix')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
