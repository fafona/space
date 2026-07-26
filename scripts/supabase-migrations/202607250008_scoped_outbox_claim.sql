begin;

-- A rollout worker must claim only explicitly allowlisted merchants and event
-- types. The original V1 claim RPC remains available for compatibility, while
-- this scoped RPC is the only claim surface used by the application worker.
create or replace function public.faolla_claim_merchant_outbox_scoped_v1(
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
  v_event_types text[];
  v_event public.merchant_outbox_events%rowtype;
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
         from unnest(p_merchant_ids) as merchant_id
        where merchant_id is null
           or btrim(merchant_id) !~ '^[0-9]{8}$'
     ) then
    raise exception 'invalid_outbox_merchant_scope';
  end if;

  if coalesce(cardinality(p_event_types), 0) = 0
     or cardinality(p_event_types) > 20
     or exists (
       select 1
         from unnest(p_event_types) as event_type
        where event_type is null
           or btrim(event_type) !~ '^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_-]*)+$'
     ) then
    raise exception 'invalid_outbox_event_type_scope';
  end if;

  select array_agg(scope_value order by scope_value)
    into v_merchant_ids
    from (
      select distinct btrim(merchant_id) as scope_value
        from unnest(p_merchant_ids) as merchant_id
    ) normalized_merchants;

  select array_agg(scope_value order by scope_value)
    into v_event_types
    from (
      select distinct btrim(event_type) as scope_value
        from unnest(p_event_types) as event_type
    ) normalized_event_types;

  update public.merchant_outbox_attempts attempt
     set outcome = 'lease_expired',
         finished_at = v_now,
         error_code = 'lease_expired'
    from public.merchant_outbox_events event
   where event.id = attempt.event_id
     and event.merchant_id = any(v_merchant_ids)
     and event.event_type = any(v_event_types)
     and event.status = 'processing'
     and event.lease_expires_at <= v_now
     and attempt.outcome = 'processing'
     and attempt.attempt_number = event.total_attempts;

  update public.merchant_outbox_events event
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
     and event.event_type = any(v_event_types)
     and event.status = 'processing'
     and event.lease_expires_at <= v_now;

  for v_event in
    select event.*
      from public.merchant_outbox_events event
     where event.merchant_id = any(v_merchant_ids)
       and event.event_type = any(v_event_types)
       and event.status in ('pending', 'failed')
       and event.dead_lettered_at is null
       and event.attempts < event.max_attempts
       and event.available_at <= v_now
     order by event.priority asc, event.available_at asc, event.created_at asc
     for update skip locked
     limit v_limit
  loop
    update public.merchant_outbox_events event
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
      event_id,
      attempt_number,
      cycle_attempt,
      worker_id,
      started_at,
      lease_expires_at
    )
    values (
      v_event.id,
      v_event.total_attempts,
      v_event.attempts,
      v_worker_id,
      v_now,
      v_event.lease_expires_at
    );

    return next v_event;
  end loop;
end;
$$;

revoke all on function public.faolla_claim_merchant_outbox_scoped_v1(
  text,
  text[],
  text[],
  integer,
  integer
) from public;
grant execute on function public.faolla_claim_merchant_outbox_scoped_v1(
  text,
  text[],
  text[],
  integer,
  integer
) to service_role;

insert into public.faolla_schema_migrations(version, name)
values (202607250008, 'scoped_outbox_claim')
on conflict (version) do nothing;

commit;
