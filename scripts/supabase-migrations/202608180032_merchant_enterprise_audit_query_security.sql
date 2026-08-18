-- Extend the existing audit-list RPC without changing its name, cursor shape,
-- caller authorization contract, or legacy inputs. Audit filters are separate
-- from the caller actor fields and are enforced before any audit rows are read.

begin;

create index if not exists merchant_enterprise_audit_events_actor_created_idx
  on public.merchant_enterprise_audit_events(
    merchant_id, actor_type, actor_id, created_at desc, id desc
  );

create or replace function public.faolla_reject_merchant_task_event_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'merchant_task_events_append_only';
end;
$$;

revoke all on function public.faolla_reject_merchant_task_event_mutation_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists merchant_task_events_append_only
  on public.merchant_task_events;
create trigger merchant_task_events_append_only
before update or delete on public.merchant_task_events
for each row execute function public.faolla_reject_merchant_task_event_mutation_v1();
alter table public.merchant_task_events
  enable always trigger merchant_task_events_append_only;

drop trigger if exists merchant_task_events_reject_truncate
  on public.merchant_task_events;
create trigger merchant_task_events_reject_truncate
before truncate on public.merchant_task_events
for each statement execute function public.faolla_reject_merchant_task_event_mutation_v1();
alter table public.merchant_task_events
  enable always trigger merchant_task_events_reject_truncate;

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
  v_before_created_at_text text;
  v_before_id uuid := null;
  v_before_id_text text;
  v_entity_type text := null;
  v_event_type text := null;
  v_filter_actor_type text := null;
  v_filter_actor_id uuid := null;
  v_filter_actor_id_text text;
  v_created_from timestamptz := null;
  v_created_from_text text;
  v_created_to_exclusive timestamptz := null;
  v_created_to_exclusive_text text;
  v_normalized_timestamp text;
  v_events jsonb;
  v_last_created_at text;
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

  if p_input ? 'filter_actor_type' then
    if coalesce(jsonb_typeof(p_input -> 'filter_actor_type'), '') <> 'string' then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    v_filter_actor_type := nullif(btrim(p_input ->> 'filter_actor_type'), '');
    if v_filter_actor_type is null
       or v_filter_actor_type <> (p_input ->> 'filter_actor_type')
       or v_filter_actor_type not in ('owner', 'employee', 'system') then
      raise exception 'invalid_enterprise_audit_query';
    end if;
  end if;
  if p_input ? 'filter_actor_id' then
    if coalesce(jsonb_typeof(p_input -> 'filter_actor_id'), '') <> 'string' then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    v_filter_actor_id_text := nullif(btrim(p_input ->> 'filter_actor_id'), '');
    if v_filter_actor_id_text is null
       or v_filter_actor_id_text <> (p_input ->> 'filter_actor_id')
       or v_filter_actor_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_filter_actor_type in ('owner', 'system') then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    v_filter_actor_id := v_filter_actor_id_text::uuid;
  end if;

  if p_input ? 'created_from' then
    if coalesce(jsonb_typeof(p_input -> 'created_from'), '') <> 'string' then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    v_created_from_text := nullif(btrim(p_input ->> 'created_from'), '');
    if v_created_from_text is null
       or v_created_from_text <> (p_input ->> 'created_from')
       or v_created_from_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    begin
      v_created_from := v_created_from_text::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid_enterprise_audit_query';
    end;
    v_normalized_timestamp := to_char(
      v_created_from at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    if v_created_from_text <> v_normalized_timestamp
       and v_created_from_text <> replace(v_normalized_timestamp, '.000Z', 'Z') then
      raise exception 'invalid_enterprise_audit_query';
    end if;
  end if;
  if p_input ? 'created_to_exclusive' then
    if coalesce(jsonb_typeof(p_input -> 'created_to_exclusive'), '') <> 'string' then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    v_created_to_exclusive_text := nullif(
      btrim(p_input ->> 'created_to_exclusive'), ''
    );
    if v_created_to_exclusive_text is null
       or v_created_to_exclusive_text <> (p_input ->> 'created_to_exclusive')
       or v_created_to_exclusive_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' then
      raise exception 'invalid_enterprise_audit_query';
    end if;
    begin
      v_created_to_exclusive := v_created_to_exclusive_text::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid_enterprise_audit_query';
    end;
    v_normalized_timestamp := to_char(
      v_created_to_exclusive at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    if v_created_to_exclusive_text <> v_normalized_timestamp
       and v_created_to_exclusive_text <> replace(
         v_normalized_timestamp, '.000Z', 'Z'
       ) then
      raise exception 'invalid_enterprise_audit_query';
    end if;
  end if;
  if v_created_from is not null
     and v_created_to_exclusive is not null
     and v_created_from >= v_created_to_exclusive then
    raise exception 'invalid_enterprise_audit_query';
  end if;

  if (p_input ? 'before_created_at') <> (p_input ? 'before_id') then
    raise exception 'invalid_enterprise_audit_cursor';
  end if;
  if p_input ? 'before_created_at' then
    v_before_id_text := nullif(btrim(p_input ->> 'before_id'), '');
    v_before_created_at_text := nullif(
      btrim(p_input ->> 'before_created_at'), ''
    );
    if v_before_created_at_text is null
       or v_before_created_at_text <> (p_input ->> 'before_created_at')
       or v_before_created_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3}|\.[0-9]{6})Z$'
       or v_before_id_text is null
       or v_before_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_enterprise_audit_cursor';
    end if;
    begin
      v_before_created_at := v_before_created_at_text::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid_enterprise_audit_cursor';
    end;
    v_normalized_timestamp := to_char(
      v_before_created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    );
    if v_before_created_at_text <> v_normalized_timestamp
       and v_before_created_at_text <> left(v_normalized_timestamp, 23) || 'Z' then
      raise exception 'invalid_enterprise_audit_cursor';
    end if;
    v_before_id := v_before_id_text::uuid;
  end if;

  perform public.faolla_authorize_merchant_enterprise_automation_actor_v1(
    p_input, 'audit.view', null
  );
  select coalesce(
    jsonb_agg(
      to_jsonb(page) || jsonb_build_object(
        'created_at',
        to_char(
          page.created_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      )
      order by page.created_at desc, page.id desc
    ),
    '[]'::jsonb
  ) into v_events
  from (
    select audit_event.*
      from public.merchant_enterprise_audit_events as audit_event
     where audit_event.merchant_id = v_site_id
       and (v_entity_type is null or audit_event.entity_type = v_entity_type)
       and (v_event_type is null or audit_event.event_type = v_event_type)
       and (
         v_filter_actor_type is null
         or audit_event.actor_type = v_filter_actor_type
       )
       and (
         v_filter_actor_id is null
         or audit_event.actor_id = v_filter_actor_id
       )
       and (
         v_created_from is null
         or audit_event.created_at >= v_created_from
       )
       and (
         v_created_to_exclusive is null
         or audit_event.created_at < v_created_to_exclusive
       )
       and (
         v_before_created_at is null
         or (audit_event.created_at, audit_event.id)
           < (v_before_created_at, v_before_id)
       )
     order by audit_event.created_at desc, audit_event.id desc
     limit v_limit
  ) as page;
  if jsonb_array_length(v_events) > 0 then
    v_last_created_at := v_events -> -1 ->> 'created_at';
    v_last_id := (v_events -> -1 ->> 'id')::uuid;
  end if;
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

revoke all on function public.faolla_list_merchant_enterprise_audit_events_v1(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.faolla_list_merchant_enterprise_audit_events_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202608180032, 'merchant_enterprise_audit_query_security')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
