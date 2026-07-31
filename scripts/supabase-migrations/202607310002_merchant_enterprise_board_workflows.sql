begin;

alter table public.merchant_task_boards
  add column if not exists position integer;

with ranked_boards as (
  select
    id,
    row_number() over (
      partition by merchant_id
      order by created_at, id
    ) - 1 as stable_position
  from public.merchant_task_boards
)
update public.merchant_task_boards as board
   set position = ranked.stable_position::integer
  from ranked_boards as ranked
 where board.id = ranked.id
   and board.position is distinct from ranked.stable_position::integer;

alter table public.merchant_task_boards
  alter column position set default 0,
  alter column position set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.merchant_task_boards'::regclass
      and conname = 'merchant_task_boards_position_nonnegative'
  ) then
    alter table public.merchant_task_boards
      add constraint merchant_task_boards_position_nonnegative
      check (position >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.merchant_task_columns'::regclass
      and conname = 'merchant_task_columns_position_nonnegative'
  ) then
    alter table public.merchant_task_columns
      add constraint merchant_task_columns_position_nonnegative
      check (position >= 0);
  end if;
end;
$$;

create unique index if not exists merchant_task_boards_position_unique_idx
  on public.merchant_task_boards(merchant_id, position)
  where status = 'active';

create or replace function public.faolla_claim_enterprise_structure_operation_v1(
  p_merchant_id text,
  p_idempotency_key text,
  p_operation text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed integer := 0;
  v_existing public.merchant_idempotency_keys%rowtype;
begin
  insert into public.merchant_idempotency_keys (
    merchant_id,
    idempotency_key,
    operation,
    request_hash,
    status,
    expires_at
  )
  values (
    p_merchant_id,
    p_idempotency_key,
    p_operation,
    p_request_hash,
    'processing',
    now() + interval '30 days'
  )
  on conflict (merchant_id, idempotency_key) do nothing;
  get diagnostics v_claimed = row_count;

  if v_claimed = 1 then
    return jsonb_build_object('claimed', true);
  end if;

  select *
    into v_existing
    from public.merchant_idempotency_keys
   where merchant_id = p_merchant_id
     and idempotency_key = p_idempotency_key;

  if not found
     or v_existing.operation <> p_operation
     or v_existing.request_hash <> p_request_hash then
    raise exception 'enterprise_idempotency_conflict';
  end if;

  if v_existing.status = 'completed' and v_existing.response_body is not null then
    return jsonb_build_object(
      'claimed', false,
      'response', v_existing.response_body
    );
  end if;

  raise exception 'enterprise_operation_in_progress';
end;
$$;

create or replace function public.faolla_complete_enterprise_structure_operation_v1(
  p_merchant_id text,
  p_idempotency_key text,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.merchant_idempotency_keys
     set status = 'completed',
         response_status = 200,
         response_body = p_response,
         locked_until = null
   where merchant_id = p_merchant_id
     and idempotency_key = p_idempotency_key
     and status = 'processing';

  if not found then
    raise exception 'enterprise_operation_in_progress';
  end if;

  return p_response;
end;
$$;

create or replace function public.faolla_reposition_merchant_task_board_v1(
  p_merchant_id text,
  p_board_id uuid,
  p_target_position integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_target_position integer;
  v_offset bigint;
begin
  select count(*)::integer
    into v_count
    from public.merchant_task_boards
   where merchant_id = p_merchant_id
     and status = 'active';

  if v_count < 1 or not exists (
    select 1
    from public.merchant_task_boards
    where merchant_id = p_merchant_id
      and id = p_board_id
      and status = 'active'
  ) then
    raise exception 'inactive_board';
  end if;

  v_target_position := least(greatest(p_target_position, 0), v_count - 1);

  select coalesce(max(position), 0)::bigint + v_count + 1
    into v_offset
    from public.merchant_task_boards
   where merchant_id = p_merchant_id
     and status = 'active';

  if v_offset > 2000000000 then
    raise exception 'invalid_board_position';
  end if;

  update public.merchant_task_boards
     set position = (position::bigint + v_offset)::integer
   where merchant_id = p_merchant_id
     and status = 'active';

  with other_boards as (
    select
      id,
      (row_number() over (order by position, id) - 1)::integer as other_position
    from public.merchant_task_boards
    where merchant_id = p_merchant_id
      and status = 'active'
      and id <> p_board_id
  ),
  desired_positions as (
    select
      id,
      case
        when other_position < v_target_position then other_position
        else other_position + 1
      end as desired_position
    from other_boards
    union all
    select p_board_id, v_target_position
  )
  update public.merchant_task_boards as board
     set position = desired.desired_position
    from desired_positions as desired
   where board.merchant_id = p_merchant_id
     and board.id = desired.id
     and board.status = 'active';
end;
$$;

create or replace function public.faolla_reposition_merchant_task_column_v1(
  p_merchant_id text,
  p_board_id uuid,
  p_column_id uuid,
  p_target_position integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_target_position integer;
  v_offset bigint;
begin
  select count(*)::integer
    into v_count
    from public.merchant_task_columns
   where merchant_id = p_merchant_id
     and board_id = p_board_id
     and status = 'active';

  if v_count < 1 or not exists (
    select 1
    from public.merchant_task_columns
    where merchant_id = p_merchant_id
      and board_id = p_board_id
      and id = p_column_id
      and status = 'active'
  ) then
    raise exception 'inactive_column';
  end if;

  v_target_position := least(greatest(p_target_position, 0), v_count - 1);

  select coalesce(max(position), 0)::bigint + v_count + 1
    into v_offset
    from public.merchant_task_columns
   where merchant_id = p_merchant_id
     and board_id = p_board_id
     and status = 'active';

  if v_offset > 2000000000 then
    raise exception 'invalid_column_position';
  end if;

  update public.merchant_task_columns
     set position = (position::bigint + v_offset)::integer
   where merchant_id = p_merchant_id
     and board_id = p_board_id
     and status = 'active';

  with other_columns as (
    select
      id,
      (row_number() over (order by position, id) - 1)::integer as other_position
    from public.merchant_task_columns
    where merchant_id = p_merchant_id
      and board_id = p_board_id
      and status = 'active'
      and id <> p_column_id
  ),
  desired_positions as (
    select
      id,
      case
        when other_position < v_target_position then other_position
        else other_position + 1
      end as desired_position
    from other_columns
    union all
    select p_column_id, v_target_position
  )
  update public.merchant_task_columns as task_column
     set position = desired.desired_position
    from desired_positions as desired
   where task_column.merchant_id = p_merchant_id
     and task_column.board_id = p_board_id
     and task_column.id = desired.id
     and task_column.status = 'active';
end;
$$;

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
      '[
        "enterprise.view",
        "tasks.view",
        "tasks.create",
        "tasks.update",
        "tasks.assign",
        "tasks.archive",
        "boards.manage",
        "employees.view",
        "employees.manage",
        "roles.view",
        "roles.manage"
      ]'::jsonb,
      'active',
      true
    ),
    (
      v_site_id,
      '主管',
      'supervisor',
      '查看团队并负责创建、分派和推进任务。',
      '[
        "enterprise.view",
        "tasks.view",
        "tasks.create",
        "tasks.update",
        "tasks.assign",
        "employees.view",
        "roles.view"
      ]'::jsonb,
      'active',
      true
    ),
    (
      v_site_id,
      '员工',
      'employee',
      '查看协作看板，并创建和推进团队任务。',
      '[
        "enterprise.view",
        "tasks.view",
        "tasks.create",
        "tasks.update"
      ]'::jsonb,
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

create or replace function public.faolla_create_merchant_task_board_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_name text;
  v_description text;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claim jsonb;
  v_active_board_count integer;
  v_next_position integer;
  v_requested_position integer;
  v_board public.merchant_task_boards%rowtype;
  v_columns jsonb;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_board_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_name := btrim(coalesce(p_input ->> 'name', ''));
  v_description := coalesce(p_input ->> 'description', '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or jsonb_typeof(p_input -> 'name') <> 'string'
     or char_length(v_name) < 1
     or char_length(v_name) > 120
     or (p_input ? 'description' and jsonb_typeof(p_input -> 'description') <> 'string')
     or char_length(v_description) > 2000
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_board';
  end if;

  if p_input ? 'position' then
    if jsonb_typeof(p_input -> 'position') <> 'number'
       or (p_input ->> 'position') !~ '^[0-9]+$'
       or char_length(p_input ->> 'position') > 7
       or (p_input ->> 'position')::integer > 1000000 then
      raise exception 'invalid_board_position';
    end if;
    v_requested_position := (p_input ->> 'position')::integer;
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

  v_idempotency_key := 'enterprise-board-create:' || v_operation_id;
  v_request_hash := md5(p_input::text);
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_board_create_v1',
    v_request_hash
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

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
    description,
    status,
    position
  )
  values (
    v_site_id,
    v_name,
    v_description,
    'active',
    v_next_position
  )
  returning * into v_board;

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
  values
    (v_site_id, v_board.id, '待处理', 'todo', '#64748b', 0, false, 'active'),
    (v_site_id, v_board.id, '进行中', 'in_progress', '#2563eb', 1, false, 'active'),
    (v_site_id, v_board.id, '受阻', 'blocked', '#dc2626', 2, false, 'active'),
    (v_site_id, v_board.id, '已完成', 'done', '#16a34a', 3, true, 'active');

  if v_requested_position is not null then
    perform public.faolla_reposition_merchant_task_board_v1(
      v_site_id,
      v_board.id,
      v_requested_position
    );
    select *
      into v_board
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and id = v_board.id;
  end if;

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
     and column_row.board_id = v_board.id;

  v_response := jsonb_build_object(
    'board', to_jsonb(v_board) - 'system_key',
    'columns', v_columns
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    v_response
  );
end;
$$;

create or replace function public.faolla_update_merchant_task_board_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_board_id_text text;
  v_board_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claim jsonb;
  v_board public.merchant_task_boards%rowtype;
  v_next_status text;
  v_requested_position integer;
  v_active_count integer;
  v_next_position integer;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_board_update_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_board_id_text := nullif(btrim(p_input ->> 'board_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_board_id_text is null
     or v_board_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p_input -> 'expected_version') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or char_length(p_input ->> 'expected_version') > 18
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or not (
       (p_input ? 'name')
       or (p_input ? 'description')
       or (p_input ? 'status')
       or (p_input ? 'position')
     ) then
    raise exception 'invalid_board_update';
  end if;

  if p_input ? 'name' and (
    jsonb_typeof(p_input -> 'name') <> 'string'
    or char_length(btrim(p_input ->> 'name')) < 1
    or char_length(btrim(p_input ->> 'name')) > 120
  ) then
    raise exception 'invalid_board';
  end if;
  if p_input ? 'description' and (
    jsonb_typeof(p_input -> 'description') <> 'string'
    or char_length(p_input ->> 'description') > 2000
  ) then
    raise exception 'invalid_board_description';
  end if;
  if p_input ? 'status' and (
    jsonb_typeof(p_input -> 'status') <> 'string'
    or (p_input ->> 'status') not in ('active', 'archived')
  ) then
    raise exception 'invalid_board_status';
  end if;
  if p_input ? 'position' then
    if jsonb_typeof(p_input -> 'position') <> 'number'
       or (p_input ->> 'position') !~ '^[0-9]+$'
       or char_length(p_input ->> 'position') > 7
       or (p_input ->> 'position')::integer > 1000000 then
      raise exception 'invalid_board_position';
    end if;
    v_requested_position := (p_input ->> 'position')::integer;
  end if;

  v_board_id := v_board_id_text::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;

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
  v_idempotency_key := 'enterprise-board-update:' || v_operation_id;
  v_request_hash := md5(p_input::text);
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_board_update_v1',
    v_request_hash
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select *
    into v_board
    from public.merchant_task_boards
   where merchant_id = v_site_id
     and id = v_board_id
     and version = v_expected_version
   for update;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  v_next_status := case
    when p_input ? 'status' then p_input ->> 'status'
    else v_board.status
  end;

  if v_board.status = 'active' and v_next_status = 'archived' then
    if exists (
      select 1
      from public.merchant_tasks
      where merchant_id = v_site_id
        and board_id = v_board_id
        and archived_at is null
    ) then
      raise exception 'board_in_use';
    end if;

    select count(*)::integer
      into v_active_count
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and status = 'active';
    if v_active_count <= 1 then
      raise exception 'last_active_board';
    end if;

    update public.merchant_task_boards
       set name = case
             when p_input ? 'name' then btrim(p_input ->> 'name')
             else name
           end,
           description = case
             when p_input ? 'description' then p_input ->> 'description'
             else description
           end,
           status = 'archived',
           position = case
             when p_input ? 'position' then v_requested_position
             else position
           end
     where merchant_id = v_site_id
       and id = v_board_id;
  elsif v_board.status = 'archived' and v_next_status = 'active' then
    select count(*)::integer
      into v_active_count
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and status = 'active';
    if v_active_count >= 50 then
      raise exception 'board_limit_reached';
    end if;
    if not exists (
      select 1
      from public.merchant_task_columns
      where merchant_id = v_site_id
        and board_id = v_board_id
        and status = 'active'
    ) then
      raise exception 'board_has_no_active_columns';
    end if;

    select coalesce(max(position), -1) + 1
      into v_next_position
      from public.merchant_task_boards
     where merchant_id = v_site_id
       and status = 'active';

    update public.merchant_task_boards
       set name = case
             when p_input ? 'name' then btrim(p_input ->> 'name')
             else name
           end,
           description = case
             when p_input ? 'description' then p_input ->> 'description'
             else description
           end,
           status = 'active',
           position = v_next_position
     where merchant_id = v_site_id
       and id = v_board_id;

    if v_requested_position is not null then
      perform public.faolla_reposition_merchant_task_board_v1(
        v_site_id,
        v_board_id,
        v_requested_position
      );
    end if;
  elsif v_board.status = 'active' then
    if (p_input ? 'name') or (p_input ? 'description') or (p_input ? 'status') then
      update public.merchant_task_boards
         set name = case
               when p_input ? 'name' then btrim(p_input ->> 'name')
               else name
             end,
             description = case
               when p_input ? 'description' then p_input ->> 'description'
               else description
             end,
             status = v_next_status
       where merchant_id = v_site_id
         and id = v_board_id;
    end if;
    if v_requested_position is not null then
      perform public.faolla_reposition_merchant_task_board_v1(
        v_site_id,
        v_board_id,
        v_requested_position
      );
    end if;
  else
    update public.merchant_task_boards
       set name = case
             when p_input ? 'name' then btrim(p_input ->> 'name')
             else name
           end,
           description = case
             when p_input ? 'description' then p_input ->> 'description'
             else description
           end,
           status = v_next_status,
           position = case
             when p_input ? 'position' then v_requested_position
             else position
           end
     where merchant_id = v_site_id
       and id = v_board_id;
  end if;

  select *
    into v_board
    from public.merchant_task_boards
   where merchant_id = v_site_id
     and id = v_board_id;

  v_response := jsonb_build_object(
    'board', to_jsonb(v_board) - 'system_key'
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    v_response
  );
end;
$$;

create or replace function public.faolla_create_merchant_task_column_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_board_id_text text;
  v_board_id uuid;
  v_name text;
  v_color text;
  v_is_done boolean;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claim jsonb;
  v_board public.merchant_task_boards%rowtype;
  v_active_column_count integer;
  v_next_position integer;
  v_requested_position integer;
  v_column public.merchant_task_columns%rowtype;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_column_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_board_id_text := nullif(btrim(p_input ->> 'board_id'), '');
  v_name := btrim(coalesce(p_input ->> 'name', ''));
  v_color := coalesce(p_input ->> 'color', '#64748b');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');

  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_board_id_text is null
     or v_board_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p_input -> 'name') <> 'string'
     or char_length(v_name) < 1
     or char_length(v_name) > 80
     or (p_input ? 'color' and jsonb_typeof(p_input -> 'color') <> 'string')
     or v_color !~ '^#[0-9A-Fa-f]{6}$'
     or (p_input ? 'is_done' and jsonb_typeof(p_input -> 'is_done') <> 'boolean')
     or v_operation_id is null
     or char_length(v_operation_id) > 120 then
    raise exception 'invalid_column';
  end if;

  v_is_done := case
    when p_input ? 'is_done' then (p_input ->> 'is_done')::boolean
    else false
  end;

  if p_input ? 'position' then
    if jsonb_typeof(p_input -> 'position') <> 'number'
       or (p_input ->> 'position') !~ '^[0-9]+$'
       or char_length(p_input ->> 'position') > 7
       or (p_input ->> 'position')::integer > 1000000 then
      raise exception 'invalid_column_position';
    end if;
    v_requested_position := (p_input ->> 'position')::integer;
  end if;

  v_board_id := v_board_id_text::uuid;
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
  v_idempotency_key := 'enterprise-column-create:' || v_operation_id;
  v_request_hash := md5(p_input::text);
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_column_create_v1',
    v_request_hash
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select *
    into v_board
    from public.merchant_task_boards
   where merchant_id = v_site_id
     and id = v_board_id
     and status = 'active'
   for update;
  if not found then
    raise exception 'inactive_board';
  end if;

  select count(*)::integer
    into v_active_column_count
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_board_id
     and status = 'active';
  if v_active_column_count >= 30 then
    raise exception 'column_limit_reached';
  end if;

  select coalesce(max(position), -1) + 1
    into v_next_position
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_board_id
     and status = 'active';

  insert into public.merchant_task_columns (
    merchant_id,
    board_id,
    name,
    color,
    position,
    is_done,
    status
  )
  values (
    v_site_id,
    v_board_id,
    v_name,
    v_color,
    v_next_position,
    v_is_done,
    'active'
  )
  returning * into v_column;

  if v_requested_position is not null then
    perform public.faolla_reposition_merchant_task_column_v1(
      v_site_id,
      v_board_id,
      v_column.id,
      v_requested_position
    );
    select *
      into v_column
      from public.merchant_task_columns
     where merchant_id = v_site_id
       and board_id = v_board_id
       and id = v_column.id;
  end if;

  v_response := jsonb_build_object(
    'column', to_jsonb(v_column) - 'system_key'
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    v_response
  );
end;
$$;

create or replace function public.faolla_update_merchant_task_column_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_board_id_text text;
  v_column_id_text text;
  v_board_id uuid;
  v_column_id uuid;
  v_expected_version bigint;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claim jsonb;
  v_board public.merchant_task_boards%rowtype;
  v_column public.merchant_task_columns%rowtype;
  v_next_status text;
  v_next_is_done boolean;
  v_requested_position integer;
  v_active_count integer;
  v_next_position integer;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_column_update_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_board_id_text := nullif(btrim(p_input ->> 'board_id'), '');
  v_column_id_text := nullif(btrim(p_input ->> 'column_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_board_id_text is null
     or v_board_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_column_id_text is null
     or v_column_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p_input -> 'expected_version') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or char_length(p_input ->> 'expected_version') > 18
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or not (
       (p_input ? 'name')
       or (p_input ? 'color')
       or (p_input ? 'is_done')
       or (p_input ? 'status')
       or (p_input ? 'position')
     ) then
    raise exception 'invalid_column_update';
  end if;

  if p_input ? 'name' and (
    jsonb_typeof(p_input -> 'name') <> 'string'
    or char_length(btrim(p_input ->> 'name')) < 1
    or char_length(btrim(p_input ->> 'name')) > 80
  ) then
    raise exception 'invalid_column';
  end if;
  if p_input ? 'color' and (
    jsonb_typeof(p_input -> 'color') <> 'string'
    or (p_input ->> 'color') !~ '^#[0-9A-Fa-f]{6}$'
  ) then
    raise exception 'invalid_column_color';
  end if;
  if p_input ? 'is_done' and jsonb_typeof(p_input -> 'is_done') <> 'boolean' then
    raise exception 'invalid_column_done_state';
  end if;
  if p_input ? 'status' and (
    jsonb_typeof(p_input -> 'status') <> 'string'
    or (p_input ->> 'status') not in ('active', 'archived')
  ) then
    raise exception 'invalid_column_status';
  end if;
  if p_input ? 'position' then
    if jsonb_typeof(p_input -> 'position') <> 'number'
       or (p_input ->> 'position') !~ '^[0-9]+$'
       or char_length(p_input ->> 'position') > 7
       or (p_input ->> 'position')::integer > 1000000 then
      raise exception 'invalid_column_position';
    end if;
    v_requested_position := (p_input ->> 'position')::integer;
  end if;

  v_board_id := v_board_id_text::uuid;
  v_column_id := v_column_id_text::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;
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
  v_idempotency_key := 'enterprise-column-update:' || v_operation_id;
  v_request_hash := md5(p_input::text);
  v_claim := public.faolla_claim_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    'enterprise_column_update_v1',
    v_request_hash
  );
  if not coalesce((v_claim ->> 'claimed')::boolean, false) then
    return v_claim -> 'response';
  end if;

  select *
    into v_board
    from public.merchant_task_boards
   where merchant_id = v_site_id
     and id = v_board_id
   for update;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  select *
    into v_column
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_board_id
     and id = v_column_id
     and version = v_expected_version
   for update;
  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  v_next_status := case
    when p_input ? 'status' then p_input ->> 'status'
    else v_column.status
  end;
  v_next_is_done := case
    when p_input ? 'is_done' then (p_input ->> 'is_done')::boolean
    else v_column.is_done
  end;

  if v_next_is_done is distinct from v_column.is_done and exists (
    select 1
    from public.merchant_tasks
    where merchant_id = v_site_id
      and board_id = v_board_id
      and column_id = v_column_id
  ) then
    raise exception 'column_in_use';
  end if;

  if v_column.status = 'active' and v_next_status = 'archived' then
    if exists (
      select 1
      from public.merchant_tasks
      where merchant_id = v_site_id
        and board_id = v_board_id
        and column_id = v_column_id
        and archived_at is null
    ) then
      raise exception 'column_in_use';
    end if;

    select count(*)::integer
      into v_active_count
      from public.merchant_task_columns
     where merchant_id = v_site_id
       and board_id = v_board_id
       and status = 'active';
    if v_active_count <= 1 then
      raise exception 'last_active_column';
    end if;

    update public.merchant_task_columns
       set name = case
             when p_input ? 'name' then btrim(p_input ->> 'name')
             else name
           end,
           color = case
             when p_input ? 'color' then p_input ->> 'color'
             else color
           end,
           is_done = v_next_is_done,
           status = 'archived',
           position = case
             when p_input ? 'position' then v_requested_position
             else position
           end
     where merchant_id = v_site_id
       and board_id = v_board_id
       and id = v_column_id;
  elsif v_column.status = 'archived' and v_next_status = 'active' then
    if v_board.status <> 'active' then
      raise exception 'inactive_board';
    end if;

    select count(*)::integer
      into v_active_count
      from public.merchant_task_columns
     where merchant_id = v_site_id
       and board_id = v_board_id
       and status = 'active';
    if v_active_count >= 30 then
      raise exception 'column_limit_reached';
    end if;

    select coalesce(max(position), -1) + 1
      into v_next_position
      from public.merchant_task_columns
     where merchant_id = v_site_id
       and board_id = v_board_id
       and status = 'active';

    update public.merchant_task_columns
       set name = case
             when p_input ? 'name' then btrim(p_input ->> 'name')
             else name
           end,
           color = case
             when p_input ? 'color' then p_input ->> 'color'
             else color
           end,
           is_done = v_next_is_done,
           status = 'active',
           position = v_next_position
     where merchant_id = v_site_id
       and board_id = v_board_id
       and id = v_column_id;

    if v_requested_position is not null then
      perform public.faolla_reposition_merchant_task_column_v1(
        v_site_id,
        v_board_id,
        v_column_id,
        v_requested_position
      );
    end if;
  elsif v_column.status = 'active' then
    if (p_input ? 'name')
       or (p_input ? 'color')
       or (p_input ? 'is_done')
       or (p_input ? 'status') then
      update public.merchant_task_columns
         set name = case
               when p_input ? 'name' then btrim(p_input ->> 'name')
               else name
             end,
             color = case
               when p_input ? 'color' then p_input ->> 'color'
               else color
             end,
             is_done = v_next_is_done,
             status = v_next_status
       where merchant_id = v_site_id
         and board_id = v_board_id
         and id = v_column_id;
    end if;
    if v_requested_position is not null then
      perform public.faolla_reposition_merchant_task_column_v1(
        v_site_id,
        v_board_id,
        v_column_id,
        v_requested_position
      );
    end if;
  else
    update public.merchant_task_columns
       set name = case
             when p_input ? 'name' then btrim(p_input ->> 'name')
             else name
           end,
           color = case
             when p_input ? 'color' then p_input ->> 'color'
             else color
           end,
           is_done = v_next_is_done,
           status = v_next_status,
           position = case
             when p_input ? 'position' then v_requested_position
             else position
           end
     where merchant_id = v_site_id
       and board_id = v_board_id
       and id = v_column_id;
  end if;

  select *
    into v_column
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_board_id
     and id = v_column_id;

  v_response := jsonb_build_object(
    'column', to_jsonb(v_column) - 'system_key'
  );
  return public.faolla_complete_enterprise_structure_operation_v1(
    v_site_id,
    v_idempotency_key,
    v_response
  );
end;
$$;

create or replace function public.faolla_guard_active_merchant_task_structure_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board_status text;
  v_column_status text;
begin
  if new.archived_at is not null then
    return new;
  end if;

  select status
    into v_board_status
    from public.merchant_task_boards
   where merchant_id = new.merchant_id
     and id = new.board_id
   for share;
  if not found or v_board_status <> 'active' then
    raise exception 'invalid_task_board';
  end if;

  select status
    into v_column_status
    from public.merchant_task_columns
   where merchant_id = new.merchant_id
     and board_id = new.board_id
     and id = new.column_id
   for share;
  if not found or v_column_status <> 'active' then
    raise exception 'invalid_task_column';
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.merchant_tasks'::regclass
      and tgname = 'merchant_tasks_active_structure_guard'
      and not tgisinternal
  ) then
    create trigger merchant_tasks_active_structure_guard
    before insert or update on public.merchant_tasks
    for each row
    execute function public.faolla_guard_active_merchant_task_structure_v1();
  end if;
end;
$$;

revoke all on function public.faolla_claim_enterprise_structure_operation_v1(text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_complete_enterprise_structure_operation_v1(text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_reposition_merchant_task_board_v1(text, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_reposition_merchant_task_column_v1(text, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_guard_active_merchant_task_structure_v1()
  from public, anon, authenticated, service_role;

revoke all on function public.faolla_bootstrap_merchant_enterprise_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_task_board_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_board_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_create_merchant_task_column_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_column_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.faolla_bootstrap_merchant_enterprise_v2(jsonb)
  to service_role;
grant execute on function public.faolla_create_merchant_task_board_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_task_board_v1(jsonb)
  to service_role;
grant execute on function public.faolla_create_merchant_task_column_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_task_column_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310002, 'merchant_enterprise_board_workflows')
on conflict (version) do nothing;

commit;
