-- Merchant-scoped, in-app task notifications. Notifications are emitted by
-- the existing authorized task RPCs in the same transaction as the task
-- mutation. No comment text, email, auth token, or other PII is copied here.

begin;

create table if not exists public.merchant_enterprise_notifications (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  recipient_employee_id uuid not null,
  task_id uuid not null,
  notification_type text not null
    check (notification_type in (
      'task_assigned',
      'task_unassigned',
      'task_commented',
      'task_due_changed'
    )),
  event_key text not null check (char_length(event_key) between 1 and 200),
  actor_type text not null check (actor_type in ('owner', 'employee', 'system')),
  actor_id text not null default '' check (char_length(actor_id) <= 120),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint merchant_enterprise_notifications_recipient_fk
    foreign key (merchant_id, recipient_employee_id)
    references public.merchant_enterprise_employees(merchant_id, id)
    on delete cascade,
  constraint merchant_enterprise_notifications_task_fk
    foreign key (merchant_id, task_id)
    references public.merchant_tasks(merchant_id, id)
    on delete restrict,
  constraint merchant_enterprise_notifications_event_unique
    unique (merchant_id, recipient_employee_id, event_key)
);

create index if not exists merchant_enterprise_notifications_recipient_created_idx
  on public.merchant_enterprise_notifications(
    merchant_id,
    recipient_employee_id,
    created_at desc,
    id desc
  );
create index if not exists merchant_enterprise_notifications_unread_idx
  on public.merchant_enterprise_notifications(merchant_id, recipient_employee_id)
  where read_at is null;

alter table public.merchant_enterprise_notifications enable row level security;
revoke all on public.merchant_enterprise_notifications
  from public, anon, authenticated, service_role;

create or replace function public.faolla_insert_merchant_task_notification_v1(
  p_site_id text,
  p_recipient_employee_id uuid,
  p_task_id uuid,
  p_notification_type text,
  p_event_key text,
  p_actor_type text,
  p_actor_id text,
  p_payload jsonb,
  p_suppress_actor boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_site_id is null
     or p_site_id !~ '^[0-9]{8}$'
     or p_recipient_employee_id is null
     or p_task_id is null
     or p_notification_type not in (
       'task_assigned',
       'task_unassigned',
       'task_commented',
       'task_due_changed'
     )
     or p_event_key is null
     or char_length(p_event_key) > 200
     or p_actor_type not in ('owner', 'employee', 'system')
     or p_actor_id is null
     or char_length(p_actor_id) > 120
     or p_suppress_actor is null then
    raise exception 'invalid_notification_event';
  end if;

  insert into public.merchant_enterprise_notifications (
    merchant_id,
    recipient_employee_id,
    task_id,
    notification_type,
    event_key,
    actor_type,
    actor_id,
    payload
  )
  select
    p_site_id,
    employee.id,
    p_task_id,
    p_notification_type,
    p_event_key,
    p_actor_type,
    p_actor_id,
    case
      when p_notification_type = 'task_due_changed' then
        jsonb_build_object('dueAt', coalesce(p_payload, '{}'::jsonb) -> 'dueAt')
      else '{}'::jsonb
    end
  from public.merchant_enterprise_employees as employee
  where employee.merchant_id = p_site_id
    and employee.id = p_recipient_employee_id
    and employee.status = 'active'
    and not (
      p_suppress_actor
      and p_actor_type = 'employee'
      and p_actor_id = employee.id::text
    )
  on conflict (merchant_id, recipient_employee_id, event_key) do nothing;
end;
$$;

revoke all on function public.faolla_insert_merchant_task_notification_v1(
  text, uuid, uuid, text, text, text, text, jsonb, boolean
) from public, anon, authenticated, service_role;

create or replace function public.faolla_emit_employee_assignment_notifications_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id_text text;
  v_replacement_employee_id_text text;
begin
  if new.event_type not in ('employee_role_transitioned', 'employee_offboarded') then
    return new;
  end if;

  -- A role transition can leave the employee active while removing task or
  -- board access, so retain a generic unassignment notice. An offboarded
  -- employee is disabled later in the same atomic RPC and intentionally does
  -- not receive a notification that can no longer be read.
  if new.event_type = 'employee_role_transitioned' then
    v_employee_id_text := nullif(btrim(new.payload ->> 'employeeId'), '');
    if v_employee_id_text is not null
       and v_employee_id_text ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform public.faolla_insert_merchant_task_notification_v1(
        new.merchant_id,
        v_employee_id_text::uuid,
        new.task_id,
        'task_unassigned',
        new.operation_id || ':lifecycle-unassigned:' || v_employee_id_text,
        new.actor_type,
        new.actor_id,
        '{}'::jsonb,
        false
      );
    end if;
  end if;

  v_replacement_employee_id_text := nullif(
    btrim(new.payload ->> 'replacementEmployeeId'),
    ''
  );
  if v_replacement_employee_id_text is not null
     and v_replacement_employee_id_text ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform public.faolla_insert_merchant_task_notification_v1(
      new.merchant_id,
      v_replacement_employee_id_text::uuid,
      new.task_id,
      'task_assigned',
      new.operation_id || ':lifecycle-assigned:' || v_replacement_employee_id_text,
      new.actor_type,
      new.actor_id,
      '{}'::jsonb,
      false
    );
  end if;
  return new;
end;
$$;

revoke all on function public.faolla_emit_employee_assignment_notifications_v1()
  from public, anon, authenticated, service_role;
drop trigger if exists merchant_task_events_employee_assignment_notifications
  on public.merchant_task_events;
create trigger merchant_task_events_employee_assignment_notifications
after insert on public.merchant_task_events
for each row execute function public.faolla_emit_employee_assignment_notifications_v1();

alter function public.faolla_create_merchant_task_v1(jsonb)
  rename to faolla_create_merchant_task_v1_core_018;
alter function public.faolla_update_merchant_task_v1(jsonb)
  rename to faolla_update_merchant_task_v1_core_018;
alter function public.faolla_add_merchant_task_comment_v1(jsonb)
  rename to faolla_add_merchant_task_comment_v1_core_018;

revoke all on function public.faolla_create_merchant_task_v1_core_018(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_update_merchant_task_v1_core_018(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_add_merchant_task_comment_v1_core_018(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.faolla_create_merchant_task_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_response jsonb;
  v_event public.merchant_task_events%rowtype;
  v_recipient_id uuid;
begin
  -- The delegated function performs the authoritative owner/employee,
  -- permission, role, board-scope, and assignee authorization first.
  v_response := public.faolla_create_merchant_task_v1_core_018(p_input);

  select *
    into v_event
    from public.merchant_task_events
   where merchant_id = nullif(btrim(p_input ->> 'merchant_id'), '')
     and operation_id = nullif(btrim(p_input ->> 'operation_id'), '');
  if not found then
    raise exception 'invalid_notification_event';
  end if;

  for v_recipient_id in
    select distinct value::uuid
      from jsonb_array_elements_text(
        coalesce(v_response -> 'assignee_ids', '[]'::jsonb)
      ) as assignee(value)
  loop
    perform public.faolla_insert_merchant_task_notification_v1(
      v_event.merchant_id,
      v_recipient_id,
      v_event.task_id,
      'task_assigned',
      v_event.operation_id || ':assigned:' || v_recipient_id::text,
      v_event.actor_type,
      v_event.actor_id,
      '{}'::jsonb,
      false
    );
  end loop;
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
  v_task_id_text text;
  v_task_id uuid;
  v_expected_version bigint;
  v_replace_assignees boolean := false;
  v_previous_due_at timestamptz;
  v_next_due_at timestamptz;
  v_previous_assignee_ids uuid[] := '{}'::uuid[];
  v_next_assignee_ids uuid[] := '{}'::uuid[];
  v_response jsonb;
  v_event public.merchant_task_events%rowtype;
  v_recipient_id uuid;
begin
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  if v_task_id_text is not null
     and v_task_id_text ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and coalesce(jsonb_typeof(p_input -> 'expected_version'), '') in ('number', 'string') then
    begin
      v_task_id := v_task_id_text::uuid;
      v_expected_version := (p_input ->> 'expected_version')::bigint;
      select task.due_at
        into v_previous_due_at
        from public.merchant_tasks as task
       where task.merchant_id = v_site_id
         and task.id = v_task_id
         and task.version = v_expected_version;
      select coalesce(array_agg(assignee.employee_id order by assignee.employee_id), '{}'::uuid[])
        into v_previous_assignee_ids
        from public.merchant_task_assignees as assignee
       where assignee.merchant_id = v_site_id
         and assignee.task_id = v_task_id;
    exception when invalid_text_representation or numeric_value_out_of_range then
      null;
    end;
  end if;
  if jsonb_typeof(p_input -> 'replace_assignees') = 'boolean' then
    v_replace_assignees := (p_input ->> 'replace_assignees')::boolean;
  end if;

  -- CAS and authorization remain inside the delegated atomic task RPC. If a
  -- concurrent writer changed the captured version, delegation fails and this
  -- transaction emits no notification.
  v_response := public.faolla_update_merchant_task_v1_core_018(p_input);

  select *
    into v_event
    from public.merchant_task_events
   where merchant_id = v_site_id
     and operation_id = nullif(btrim(p_input ->> 'operation_id'), '');
  if not found then
    raise exception 'invalid_notification_event';
  end if;

  select coalesce(array_agg(value::uuid order by value::uuid), '{}'::uuid[])
    into v_next_assignee_ids
    from jsonb_array_elements_text(
      coalesce(v_response -> 'assignee_ids', '[]'::jsonb)
    ) as assignee(value);

  if v_replace_assignees then
    for v_recipient_id in
      select employee_id
        from unnest(v_next_assignee_ids) as next_assignee(employee_id)
      except
      select employee_id
        from unnest(v_previous_assignee_ids) as previous_assignee(employee_id)
    loop
      perform public.faolla_insert_merchant_task_notification_v1(
        v_event.merchant_id,
        v_recipient_id,
        v_event.task_id,
        'task_assigned',
        v_event.operation_id || ':assigned:' || v_recipient_id::text,
        v_event.actor_type,
        v_event.actor_id,
        '{}'::jsonb,
        false
      );
    end loop;

    for v_recipient_id in
      select employee_id
        from unnest(v_previous_assignee_ids) as previous_assignee(employee_id)
      except
      select employee_id
        from unnest(v_next_assignee_ids) as next_assignee(employee_id)
    loop
      perform public.faolla_insert_merchant_task_notification_v1(
        v_event.merchant_id,
        v_recipient_id,
        v_event.task_id,
        'task_unassigned',
        v_event.operation_id || ':unassigned:' || v_recipient_id::text,
        v_event.actor_type,
        v_event.actor_id,
        '{}'::jsonb,
        false
      );
    end loop;
  end if;

  if p_input ? 'due_at' then
    v_next_due_at := nullif(v_response -> 'task' ->> 'due_at', '')::timestamptz;
    if v_previous_due_at is distinct from v_next_due_at then
      for v_recipient_id in
        select employee_id from unnest(v_next_assignee_ids) as assignee(employee_id)
      loop
        perform public.faolla_insert_merchant_task_notification_v1(
          v_event.merchant_id,
          v_recipient_id,
          v_event.task_id,
          'task_due_changed',
          v_event.operation_id || ':due:' || v_recipient_id::text,
          v_event.actor_type,
          v_event.actor_id,
          jsonb_build_object('dueAt', to_jsonb(v_next_due_at)),
          true
        );
      end loop;
    end if;
  end if;
  return v_response;
end;
$$;

create or replace function public.faolla_add_merchant_task_comment_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_response jsonb;
  v_event public.merchant_task_events%rowtype;
  v_recipient_id uuid;
begin
  v_response := public.faolla_add_merchant_task_comment_v1_core_018(p_input);

  select *
    into v_event
    from public.merchant_task_events
   where merchant_id = nullif(btrim(p_input ->> 'merchant_id'), '')
     and operation_id = nullif(btrim(p_input ->> 'operation_id'), '');
  if not found then
    raise exception 'invalid_notification_event';
  end if;

  for v_recipient_id in
    select assignee.employee_id
      from public.merchant_task_assignees as assignee
     where assignee.merchant_id = v_event.merchant_id
       and assignee.task_id = v_event.task_id
     order by assignee.employee_id
  loop
    perform public.faolla_insert_merchant_task_notification_v1(
      v_event.merchant_id,
      v_recipient_id,
      v_event.task_id,
      'task_commented',
      v_event.operation_id || ':comment:' || v_recipient_id::text,
      v_event.actor_type,
      v_event.actor_id,
      '{}'::jsonb,
      true
    );
  end loop;
  return v_response;
end;
$$;

revoke all on function public.faolla_create_merchant_task_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_update_merchant_task_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_add_merchant_task_comment_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_create_merchant_task_v1(jsonb)
  to service_role;
grant execute on function public.faolla_update_merchant_task_v1(jsonb)
  to service_role;
grant execute on function public.faolla_add_merchant_task_comment_v1(jsonb)
  to service_role;

create or replace function public.faolla_authorize_merchant_notification_actor_v1(
  p_input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_id_text text;
  v_actor_id uuid;
  v_role_id uuid;
begin
  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or jsonb_typeof(p_input -> 'merchant_id') <> 'string'
     or jsonb_typeof(p_input -> 'actor_type') <> 'string'
     or jsonb_typeof(p_input -> 'actor_id') <> 'string' then
    raise exception 'invalid_notification_actor';
  end if;
  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_actor_id_text := nullif(btrim(p_input ->> 'actor_id'), '');
  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or p_input ->> 'actor_type' <> 'employee'
     or v_actor_id_text is null
     or v_actor_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_notification_actor';
  end if;
  v_actor_id := v_actor_id_text::uuid;

  select employee.role_id
    into v_role_id
    from public.merchant_enterprise_employees as employee
   where employee.merchant_id = v_site_id
     and employee.id = v_actor_id
     and employee.status = 'active'
   for share of employee;
  if not found then
    raise exception 'permission_denied';
  end if;

  perform 1
    from public.merchant_enterprise_roles as role_row
   where role_row.merchant_id = v_site_id
     and role_row.id = v_role_id
     and role_row.status = 'active'
     and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
     and 'enterprise.view' = any(role_row.permissions)
     and 'tasks.view' = any(role_row.permissions)
   for share of role_row;
  if not found then
    raise exception 'permission_denied';
  end if;
  return v_actor_id;
end;
$$;

create or replace function public.faolla_list_merchant_enterprise_notifications_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_id uuid;
  v_limit integer;
  v_cursor_created_at_text text;
  v_cursor_created_at timestamptz;
  v_cursor_id_text text;
  v_cursor_id uuid;
  v_notifications jsonb;
  v_unread_count bigint;
begin
  v_actor_id := public.faolla_authorize_merchant_notification_actor_v1(p_input);
  v_site_id := btrim(p_input ->> 'merchant_id');
  if jsonb_typeof(p_input -> 'limit') <> 'number' then
    raise exception 'invalid_notification_request';
  end if;
  begin
    v_limit := (p_input ->> 'limit')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_notification_request';
  end;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'invalid_notification_request';
  end if;

  v_cursor_created_at_text := nullif(btrim(p_input ->> 'cursor_created_at'), '');
  v_cursor_id_text := nullif(btrim(p_input ->> 'cursor_id'), '');
  if (v_cursor_created_at_text is null) <> (v_cursor_id_text is null) then
    raise exception 'invalid_notification_request';
  end if;
  if v_cursor_created_at_text is not null then
    if v_cursor_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_notification_request';
    end if;
    begin
      v_cursor_created_at := v_cursor_created_at_text::timestamptz;
      v_cursor_id := v_cursor_id_text::uuid;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid_notification_request';
    end;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'merchant_id', page.merchant_id,
        'task_id', page.task_id,
        'notification_type', page.notification_type,
        'actor_type', page.actor_type,
        'actor_id', page.actor_id,
        'payload', page.payload,
        'read_at', page.read_at,
        'created_at', page.created_at
      ) order by page.created_at desc, page.id desc
    ),
    '[]'::jsonb
  )
    into v_notifications
    from (
      select notification.*
        from public.merchant_enterprise_notifications as notification
       where notification.merchant_id = v_site_id
         and notification.recipient_employee_id = v_actor_id
         and (
           v_cursor_created_at is null
           or (notification.created_at, notification.id)
             < (v_cursor_created_at, v_cursor_id)
         )
       order by notification.created_at desc, notification.id desc
       limit v_limit + 1
    ) as page;

  select count(*)
    into v_unread_count
    from public.merchant_enterprise_notifications as notification
   where notification.merchant_id = v_site_id
     and notification.recipient_employee_id = v_actor_id
     and notification.read_at is null;

  return jsonb_build_object(
    'notifications', v_notifications,
    'unread_count', v_unread_count
  );
end;
$$;

create or replace function public.faolla_mark_merchant_enterprise_notifications_read_v1(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_actor_id uuid;
  v_mark_all boolean;
  v_notification_id_text text;
  v_notification_id uuid;
  v_marked_count integer := 0;
  v_unread_count bigint;
begin
  v_actor_id := public.faolla_authorize_merchant_notification_actor_v1(p_input);
  v_site_id := btrim(p_input ->> 'merchant_id');
  if jsonb_typeof(p_input -> 'mark_all') <> 'boolean' then
    raise exception 'invalid_notification_request';
  end if;
  v_mark_all := (p_input ->> 'mark_all')::boolean;
  v_notification_id_text := nullif(btrim(p_input ->> 'notification_id'), '');
  if v_mark_all = (v_notification_id_text is not null) then
    raise exception 'invalid_notification_request';
  end if;
  if v_notification_id_text is not null then
    if v_notification_id_text !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_notification_request';
    end if;
    v_notification_id := v_notification_id_text::uuid;
  end if;

  update public.merchant_enterprise_notifications as notification
     set read_at = coalesce(notification.read_at, now())
   where notification.merchant_id = v_site_id
     and notification.recipient_employee_id = v_actor_id
     and notification.read_at is null
     and (v_mark_all or notification.id = v_notification_id);
  get diagnostics v_marked_count = row_count;

  select count(*)
    into v_unread_count
    from public.merchant_enterprise_notifications as notification
   where notification.merchant_id = v_site_id
     and notification.recipient_employee_id = v_actor_id
     and notification.read_at is null;
  return jsonb_build_object(
    'marked_count', v_marked_count,
    'unread_count', v_unread_count
  );
end;
$$;

revoke all on function public.faolla_authorize_merchant_notification_actor_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.faolla_list_merchant_enterprise_notifications_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.faolla_mark_merchant_enterprise_notifications_read_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_list_merchant_enterprise_notifications_v1(jsonb)
  to service_role;
grant execute on function public.faolla_mark_merchant_enterprise_notifications_read_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608020018, 'merchant_enterprise_notifications')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
