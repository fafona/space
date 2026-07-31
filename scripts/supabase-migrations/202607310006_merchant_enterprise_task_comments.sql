-- Append-only task comments recorded in the existing enterprise task event log.

begin;

create or replace function public.faolla_add_merchant_task_comment_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_id text;
  v_task_id_text text;
  v_task_id uuid;
  v_comment_text text;
  v_operation_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_claimed integer := 0;
  v_existing public.merchant_idempotency_keys%rowtype;
  v_actor_type text;
  v_actor_id text;
  v_task public.merchant_tasks%rowtype;
  v_event public.merchant_task_events%rowtype;
  v_response jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid_task_comment_payload';
  end if;

  v_site_id := nullif(btrim(p_input ->> 'merchant_id'), '');
  v_task_id_text := nullif(btrim(p_input ->> 'task_id'), '');
  v_comment_text := nullif(btrim(p_input ->> 'text'), '');
  v_operation_id := nullif(btrim(p_input ->> 'operation_id'), '');
  v_actor_type := nullif(btrim(p_input ->> 'actor_type'), '');
  v_actor_id := nullif(btrim(p_input ->> 'actor_id'), '');

  if v_site_id is null
     or v_site_id !~ '^[0-9]{8}$'
     or v_task_id_text is null
     or v_task_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not (p_input ? 'text')
     or jsonb_typeof(p_input -> 'text') <> 'string'
     or v_comment_text is null
     or char_length(v_comment_text) > 2000
     or v_operation_id is null
     or char_length(v_operation_id) > 120
     or v_actor_type not in ('owner', 'employee')
     or v_actor_id is null
     or v_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_task_comment';
  end if;

  v_task_id := v_task_id_text::uuid;

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
    'enterprise_task_comment_v1',
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
       or v_existing.operation <> 'enterprise_task_comment_v1'
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
    'commented',
    v_actor_type,
    v_actor_id,
    jsonb_build_object('text', v_comment_text)
  )
  returning * into v_event;

  v_response := jsonb_build_object('event', to_jsonb(v_event));
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

revoke all on function public.faolla_add_merchant_task_comment_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.faolla_add_merchant_task_comment_v1(jsonb)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607310006, 'merchant_enterprise_task_comments')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
