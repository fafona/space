-- Transactional task reordering for the enterprise workspace.
--
-- The public API supplies a zero-based target index. The database owns the
-- resulting bigint positions so browser number precision, clock collisions and
-- concurrent drag operations cannot decide the persisted order.

begin;

create or replace function public.faolla_move_merchant_task_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_task_id_text text;
  v_task_id uuid;
  v_expected_version bigint;
  v_target_column_id_text text;
  v_target_column_id uuid;
  v_requested_target_index integer;
  v_target_index integer;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claimed integer := 0;
  v_existing public.merchant_idempotency_keys%rowtype;
  v_task public.merchant_tasks%rowtype;
  v_source_column_id uuid;
  v_source_is_done boolean;
  v_target_is_done boolean;
  v_target_task_count integer;
  v_actor_type text;
  v_actor_id text;
  v_assignee_ids jsonb := '[]'::jsonb;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_move_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  v_target_column_id_text := nullif(btrim(p_input ->> 'target_column_id'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_actor_type := coalesce(nullif(btrim(p_input ->> 'actor_type'), ''), 'owner');
  v_actor_id := coalesce(btrim(p_input ->> 'actor_id'), '');

  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_task_id_text is null
     or v_task_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_target_column_id_text is null
     or v_target_column_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not (p_input ? 'expected_version')
     or jsonb_typeof(p_input -> 'expected_version') <> 'number'
     or (p_input ->> 'expected_version') !~ '^[1-9][0-9]*$'
     or char_length(p_input ->> 'expected_version') > 18
     or not (p_input ? 'target_index')
     or jsonb_typeof(p_input -> 'target_index') <> 'number'
     or (p_input ->> 'target_index') !~ '^(0|[1-9][0-9]*)$'
     or char_length(p_input ->> 'target_index') > 5
     or (p_input ->> 'target_index')::integer > 10000
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or v_actor_type not in ('owner', 'employee')
     or char_length(v_actor_id) > 160 then
    raise exception 'invalid_task_move';
  end if;

  v_task_id := v_task_id_text::uuid;
  v_target_column_id := v_target_column_id_text::uuid;
  v_expected_version := (p_input ->> 'expected_version')::bigint;
  v_requested_target_index := (p_input ->> 'target_index')::integer;

  -- Every task move for one merchant is serialized before any task row lock is
  -- taken. This gives all callers one lock order and prevents two drag requests
  -- from calculating conflicting orders for different tasks.
  perform pg_advisory_xact_lock(
    hashtextextended('faolla-enterprise-task-order:' || v_site_id, 0)
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
    'enterprise_task_move_v1',
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
       or v_existing.operation <> 'enterprise_task_move_v1'
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
  if v_task.archived_at is not null then
    raise exception 'invalid_task_archived';
  end if;

  v_source_column_id := v_task.column_id;

  perform 1
    from public.merchant_task_boards
   where merchant_id = v_site_id
     and id = v_task.board_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'invalid_task_board';
  end if;

  select is_done
    into v_source_is_done
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_task.board_id
     and id = v_source_column_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'invalid_task_column';
  end if;

  select is_done
    into v_target_is_done
    from public.merchant_task_columns
   where merchant_id = v_site_id
     and board_id = v_task.board_id
     and id = v_target_column_id
     and status = 'active'
   for share;
  if not found then
    raise exception 'invalid_task_column';
  end if;

  -- Lock existing active tasks in one deterministic order. The moved task was
  -- already locked by its CAS read; re-locking it in this scan is harmless.
  perform 1
    from public.merchant_tasks
   where merchant_id = v_site_id
     and board_id = v_task.board_id
     and archived_at is null
     and column_id in (v_source_column_id, v_target_column_id)
   order by column_id, position, created_at, id
   for update;

  select count(*)::integer
    into v_target_task_count
    from public.merchant_tasks
   where merchant_id = v_site_id
     and board_id = v_task.board_id
     and column_id = v_target_column_id
     and archived_at is null
     and id <> v_task_id;

  v_target_index := least(v_requested_target_index, v_target_task_count);

  -- Build the target list without the moved task, insert it at the zero-based
  -- requested index, compact the source list when columns differ, and update all
  -- affected active tasks in one SQL statement. Positions remain exact bigint
  -- integers and use a deterministic 1024 interval.
  with target_tasks as (
    select
      task.id,
      row_number() over (
        order by task.position, task.created_at, task.id
      ) - 1 as source_index
    from public.merchant_tasks as task
    where task.merchant_id = v_site_id
      and task.board_id = v_task.board_id
      and task.column_id = v_target_column_id
      and task.archived_at is null
      and task.id <> v_task_id
  ),
  source_tasks as (
    select
      task.id,
      row_number() over (
        order by task.position, task.created_at, task.id
      ) - 1 as source_index
    from public.merchant_tasks as task
    where v_source_column_id <> v_target_column_id
      and task.merchant_id = v_site_id
      and task.board_id = v_task.board_id
      and task.column_id = v_source_column_id
      and task.archived_at is null
      and task.id <> v_task_id
  ),
  desired_positions as (
    select
      target.id,
      v_target_column_id as column_id,
      case
        when target.source_index < v_target_index then target.source_index
        else target.source_index + 1
      end as target_order
    from target_tasks as target
    union all
    select
      v_task_id,
      v_target_column_id,
      v_target_index::bigint
    union all
    select
      source.id,
      v_source_column_id,
      source.source_index
    from source_tasks as source
  ),
  updated_tasks as (
    update public.merchant_tasks as task
       set column_id = desired.column_id,
           position = desired.target_order::bigint * 1024::bigint,
           completed_at = case
             when task.id <> v_task_id then task.completed_at
             when v_target_is_done then coalesce(task.completed_at, now())
             else null
           end
      from desired_positions as desired
     where task.merchant_id = v_site_id
       and task.board_id = v_task.board_id
       and task.id = desired.id
       and task.archived_at is null
    returning task.*
  )
  select *
    into v_task
    from updated_tasks
   where id = v_task_id;

  if not found then
    raise exception 'enterprise_version_conflict';
  end if;

  select coalesce(
    jsonb_agg(assignee.employee_id::text order by assignee.employee_id::text),
    '[]'::jsonb
  )
    into v_assignee_ids
    from public.merchant_task_assignees as assignee
   where assignee.merchant_id = v_site_id
     and assignee.task_id = v_task_id;

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
    'moved',
    v_actor_type,
    v_actor_id,
    jsonb_build_object(
      'fromColumnId', v_source_column_id::text,
      'toColumnId', v_target_column_id::text,
      'requestedTargetIndex', v_requested_target_index,
      'targetIndex', v_target_index,
      'position', v_task.position,
      'completedAt', v_task.completed_at
    )
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

revoke all on function public.faolla_move_merchant_task_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_move_merchant_task_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310005, 'merchant_enterprise_task_reordering')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
