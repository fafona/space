-- Reliable outbox runtime foundation.
-- This migration is additive. No current notification, publishing, sync,
-- conversion, backup, or webhook path is switched to the outbox here.

begin;

alter table public.merchant_outbox_events
  add column if not exists max_attempts integer not null default 8
    check (max_attempts between 1 and 50),
  add column if not exists total_attempts integer not null default 0
    check (total_attempts >= 0),
  add column if not exists priority smallint not null default 100
    check (priority between 0 and 1000),
  add column if not exists correlation_id text not null default '',
  add column if not exists lease_expires_at timestamptz null,
  add column if not exists last_attempt_at timestamptz null,
  add column if not exists dead_lettered_at timestamptz null,
  add column if not exists last_error_code text null,
  add column if not exists result jsonb null,
  add column if not exists replay_count integer not null default 0
    check (replay_count >= 0),
  add column if not exists last_replayed_at timestamptz null,
  add column if not exists last_replay_reason text null;

update public.merchant_outbox_events
set total_attempts = greatest(total_attempts, attempts)
where total_attempts < attempts;

update public.merchant_outbox_events
set lease_expires_at = coalesce(locked_at, updated_at, now())
where status = 'processing'
  and lease_expires_at is null;

update public.merchant_outbox_events
set dead_lettered_at = coalesce(updated_at, now()),
    last_error_code = coalesce(last_error_code, 'attempt_limit_reached'),
    last_error = coalesce(last_error, 'attempt_limit_reached')
where status = 'failed'
  and attempts >= max_attempts
  and dead_lettered_at is null;

create index if not exists merchant_outbox_claim_v1_idx
  on public.merchant_outbox_events(priority asc, available_at asc, created_at asc)
  where status in ('pending', 'failed') and dead_lettered_at is null;

create index if not exists merchant_outbox_lease_v1_idx
  on public.merchant_outbox_events(lease_expires_at asc)
  where status = 'processing';

create index if not exists merchant_outbox_dead_letter_v1_idx
  on public.merchant_outbox_events(dead_lettered_at desc, merchant_id)
  where dead_lettered_at is not null;

create table if not exists public.merchant_outbox_attempts (
  id bigint generated always as identity primary key,
  event_id uuid not null
    references public.merchant_outbox_events(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  cycle_attempt integer not null check (cycle_attempt > 0),
  worker_id text not null,
  outcome text not null default 'processing'
    check (outcome in (
      'processing',
      'completed',
      'retry_scheduled',
      'dead_lettered',
      'lease_expired'
    )),
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  finished_at timestamptz null,
  error_code text null,
  error_message text null,
  next_available_at timestamptz null,
  constraint merchant_outbox_attempts_event_attempt_unique
    unique (event_id, attempt_number)
);

create index if not exists merchant_outbox_attempts_event_started_idx
  on public.merchant_outbox_attempts(event_id, started_at desc);

create index if not exists merchant_outbox_attempts_outcome_started_idx
  on public.merchant_outbox_attempts(outcome, started_at desc);

create table if not exists public.merchant_outbox_replays (
  id bigint generated always as identity primary key,
  event_id uuid not null
    references public.merchant_outbox_events(id) on delete restrict,
  replay_number integer not null check (replay_number > 0),
  replayed_by text not null,
  reason_code text not null,
  replayed_at timestamptz not null default now(),
  constraint merchant_outbox_replays_event_replay_unique
    unique (event_id, replay_number)
);

create index if not exists merchant_outbox_replays_event_time_idx
  on public.merchant_outbox_replays(event_id, replayed_at desc);

alter table public.merchant_outbox_attempts enable row level security;
alter table public.merchant_outbox_replays enable row level security;

revoke all on table public.merchant_outbox_events from anon, authenticated;
revoke all on table public.merchant_outbox_attempts from anon, authenticated;
revoke all on table public.merchant_outbox_replays from anon, authenticated;

grant select, insert, update on table public.merchant_outbox_events to service_role;
grant select, insert, update on table public.merchant_outbox_attempts to service_role;
grant select, insert on table public.merchant_outbox_replays to service_role;
grant usage, select on sequence public.merchant_outbox_attempts_id_seq to service_role;
grant usage, select on sequence public.merchant_outbox_replays_id_seq to service_role;

create or replace function public.faolla_enqueue_merchant_outbox_v1(
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant_id text;
  v_event_key text;
  v_event_type text;
  v_aggregate_type text;
  v_aggregate_id text;
  v_payload jsonb;
  v_available_at timestamptz;
  v_max_attempts integer;
  v_priority integer;
  v_correlation_id text;
  v_existing public.merchant_outbox_events%rowtype;
  v_id uuid;
begin
  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'outbox_event_must_be_object';
  end if;

  v_merchant_id := nullif(btrim(p_event ->> 'merchant_id'), '');
  v_event_key := nullif(btrim(p_event ->> 'event_key'), '');
  v_event_type := nullif(btrim(p_event ->> 'event_type'), '');
  v_aggregate_type := nullif(btrim(p_event ->> 'aggregate_type'), '');
  v_aggregate_id := nullif(btrim(p_event ->> 'aggregate_id'), '');
  v_payload := coalesce(p_event -> 'payload', '{}'::jsonb);
  v_available_at := coalesce(
    nullif(p_event ->> 'available_at', '')::timestamptz,
    now()
  );
  v_max_attempts := coalesce((p_event ->> 'max_attempts')::integer, 8);
  v_priority := coalesce((p_event ->> 'priority')::integer, 100);
  v_correlation_id := coalesce(btrim(p_event ->> 'correlation_id'), '');

  if v_merchant_id is null or v_merchant_id !~ '^[0-9]{8}$' then
    raise exception 'invalid_outbox_merchant_id';
  end if;
  if v_event_key is null
     or length(v_event_key) > 180
     or v_event_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' then
    raise exception 'invalid_outbox_event_key';
  end if;
  if v_event_type is null
     or length(v_event_type) > 80
     or v_event_type !~ '^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9_-]*)+$' then
    raise exception 'invalid_outbox_event_type';
  end if;
  if v_aggregate_type is null
     or length(v_aggregate_type) > 80
     or v_aggregate_type !~ '^[a-z][a-z0-9_-]*$' then
    raise exception 'invalid_outbox_aggregate_type';
  end if;
  if v_aggregate_id is null or length(v_aggregate_id) > 180 then
    raise exception 'invalid_outbox_aggregate_id';
  end if;
  if jsonb_typeof(v_payload) <> 'object' or pg_column_size(v_payload) > 131072 then
    raise exception 'invalid_outbox_payload';
  end if;
  if v_max_attempts < 1 or v_max_attempts > 50 then
    raise exception 'invalid_outbox_max_attempts';
  end if;
  if v_priority < 0 or v_priority > 1000 then
    raise exception 'invalid_outbox_priority';
  end if;
  if length(v_correlation_id) > 120
     or (v_correlation_id <> '' and v_correlation_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$') then
    raise exception 'invalid_outbox_correlation_id';
  end if;
  if v_available_at > now() + interval '366 days' then
    raise exception 'invalid_outbox_available_at';
  end if;
  if not exists (
    select 1 from public.merchants merchant where merchant.id = v_merchant_id
  ) then
    raise exception 'outbox_merchant_not_found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('faolla-outbox:' || v_merchant_id || ':' || v_event_key, 0)
  );

  select event.*
    into v_existing
    from public.merchant_outbox_events event
   where event.merchant_id = v_merchant_id
     and event.event_key = v_event_key
   for update;

  if found then
    if v_existing.event_type <> v_event_type
       or v_existing.aggregate_type <> v_aggregate_type
       or v_existing.aggregate_id <> v_aggregate_id
       or v_existing.payload <> v_payload then
      raise exception 'outbox_event_conflict';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'deduplicated', true
    );
  end if;

  insert into public.merchant_outbox_events (
    merchant_id,
    event_key,
    event_type,
    aggregate_type,
    aggregate_id,
    payload,
    available_at,
    max_attempts,
    priority,
    correlation_id
  )
  values (
    v_merchant_id,
    v_event_key,
    v_event_type,
    v_aggregate_type,
    v_aggregate_id,
    v_payload,
    v_available_at,
    v_max_attempts,
    v_priority,
    v_correlation_id
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'status', 'pending',
    'deduplicated', false
  );
end;
$$;

create or replace function public.faolla_claim_merchant_outbox_v1(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 60,
  p_event_types text[] default null
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
  v_event public.merchant_outbox_events%rowtype;
begin
  if v_worker_id is null
     or length(v_worker_id) > 120
     or v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' then
    raise exception 'invalid_outbox_worker_id';
  end if;
  if coalesce(cardinality(p_event_types), 0) > 20 then
    raise exception 'too_many_outbox_event_types';
  end if;

  update public.merchant_outbox_attempts attempt
     set outcome = 'lease_expired',
         finished_at = v_now,
         error_code = 'lease_expired'
    from public.merchant_outbox_events event
   where event.id = attempt.event_id
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
   where event.status = 'processing'
     and event.lease_expires_at <= v_now;

  for v_event in
    select event.*
      from public.merchant_outbox_events event
     where event.status in ('pending', 'failed')
       and event.dead_lettered_at is null
       and event.attempts < event.max_attempts
       and event.available_at <= v_now
       and (
         coalesce(cardinality(p_event_types), 0) = 0
         or event.event_type = any(p_event_types)
       )
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

create or replace function public.faolla_renew_merchant_outbox_lease_v1(
  p_event_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker_id text := nullif(btrim(p_worker_id), '');
  v_lease_seconds integer := least(900, greatest(15, coalesce(p_lease_seconds, 60)));
  v_lease_expires_at timestamptz;
  v_attempt_number integer;
begin
  update public.merchant_outbox_events event
     set lease_expires_at = now() + make_interval(secs => v_lease_seconds)
   where event.id = p_event_id
     and event.status = 'processing'
     and event.locked_by = v_worker_id
     and coalesce(event.lease_expires_at > now(), false)
  returning event.lease_expires_at, event.total_attempts
       into v_lease_expires_at, v_attempt_number;

  if not found then
    return false;
  end if;

  update public.merchant_outbox_attempts attempt
     set lease_expires_at = v_lease_expires_at
   where attempt.event_id = p_event_id
     and attempt.attempt_number = v_attempt_number
     and attempt.outcome = 'processing';

  return true;
end;
$$;

create or replace function public.faolla_complete_merchant_outbox_v1(
  p_event_id uuid,
  p_worker_id text,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.merchant_outbox_events%rowtype;
  v_result jsonb := coalesce(p_result, '{}'::jsonb);
begin
  if jsonb_typeof(v_result) <> 'object' or pg_column_size(v_result) > 65536 then
    raise exception 'invalid_outbox_result';
  end if;

  select event.*
    into v_event
    from public.merchant_outbox_events event
   where event.id = p_event_id
   for update;

  if not found then
    return false;
  end if;
  if v_event.status = 'completed' then
    return true;
  end if;
  if v_event.status <> 'processing'
     or v_event.locked_by <> nullif(btrim(p_worker_id), '')
     or not coalesce(v_event.lease_expires_at > now(), false) then
    return false;
  end if;

  update public.merchant_outbox_attempts attempt
     set outcome = 'completed',
         finished_at = now()
   where attempt.event_id = v_event.id
     and attempt.attempt_number = v_event.total_attempts
     and attempt.outcome = 'processing';

  update public.merchant_outbox_events event
     set status = 'completed',
         completed_at = now(),
         locked_at = null,
         locked_by = null,
         lease_expires_at = null,
         dead_lettered_at = null,
         last_error = null,
         last_error_code = null,
         result = v_result
   where event.id = v_event.id;

  return true;
end;
$$;

create or replace function public.faolla_fail_merchant_outbox_v1(
  p_event_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text default null,
  p_retryable boolean default true,
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.merchant_outbox_events%rowtype;
  v_error_code text := lower(coalesce(nullif(btrim(p_error_code), ''), 'task_failed'));
  v_error_message text := left(coalesce(nullif(btrim(p_error_message), ''), v_error_code), 500);
  v_retryable boolean;
  v_delay_seconds integer;
  v_next_available_at timestamptz;
  v_previous_outcome text;
begin
  if length(v_error_code) > 80 or v_error_code !~ '^[a-z][a-z0-9_:-]*$' then
    raise exception 'invalid_outbox_error_code';
  end if;

  select event.*
    into v_event
    from public.merchant_outbox_events event
   where event.id = p_event_id
   for update;

  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  if v_event.status = 'failed' and v_event.locked_by is null then
    select attempt.outcome
      into v_previous_outcome
      from public.merchant_outbox_attempts attempt
     where attempt.event_id = v_event.id
       and attempt.attempt_number = v_event.total_attempts
       and attempt.worker_id = nullif(btrim(p_worker_id), '');
    if found and v_previous_outcome in ('retry_scheduled', 'dead_lettered') then
      return jsonb_build_object(
        'status', case
          when v_event.dead_lettered_at is null then 'retry_scheduled'
          else 'dead_lettered'
        end,
        'available_at', v_event.available_at
      );
    end if;
  end if;

  if v_event.status <> 'processing'
     or v_event.locked_by <> nullif(btrim(p_worker_id), '')
     or not coalesce(v_event.lease_expires_at > now(), false) then
    return jsonb_build_object('status', 'lease_lost');
  end if;

  v_retryable := coalesce(p_retryable, true)
    and v_event.attempts < v_event.max_attempts;
  v_delay_seconds := case
    when p_retry_after_seconds is not null
      then least(86400, greatest(5, p_retry_after_seconds))
    else least(
      3600,
      (5 * power(2, least(greatest(v_event.attempts - 1, 0), 10)))::integer
        + mod(get_byte(digest(v_event.id::text, 'sha256'), 0), 11)
    )
  end;
  v_next_available_at := now() + make_interval(secs => v_delay_seconds);

  update public.merchant_outbox_attempts attempt
     set outcome = case
           when v_retryable then 'retry_scheduled'
           else 'dead_lettered'
         end,
         finished_at = now(),
         error_code = v_error_code,
         error_message = v_error_message,
         next_available_at = case
           when v_retryable then v_next_available_at
           else null
         end
   where attempt.event_id = v_event.id
     and attempt.attempt_number = v_event.total_attempts
     and attempt.outcome = 'processing';

  update public.merchant_outbox_events event
     set status = 'failed',
         available_at = case
           when v_retryable then v_next_available_at
           else event.available_at
         end,
         locked_at = null,
         locked_by = null,
         lease_expires_at = null,
         dead_lettered_at = case
           when v_retryable then null
           else now()
         end,
         last_error = v_error_message,
         last_error_code = v_error_code
   where event.id = v_event.id;

  return jsonb_build_object(
    'status', case
      when v_retryable then 'retry_scheduled'
      else 'dead_lettered'
    end,
    'available_at', case
      when v_retryable then v_next_available_at
      else null
    end
  );
end;
$$;

create or replace function public.faolla_replay_merchant_outbox_v1(
  p_event_id uuid,
  p_replayed_by text,
  p_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replayed_by text := nullif(btrim(p_replayed_by), '');
  v_reason_code text := lower(coalesce(nullif(btrim(p_reason_code), ''), 'manual_replay'));
  v_replay_number integer;
begin
  if v_replayed_by is null
     or length(v_replayed_by) > 120
     or v_replayed_by !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]*$' then
    raise exception 'invalid_outbox_replay_actor';
  end if;
  if length(v_reason_code) > 80 or v_reason_code !~ '^[a-z][a-z0-9_:-]*$' then
    raise exception 'invalid_outbox_replay_reason';
  end if;

  update public.merchant_outbox_events event
     set status = 'pending',
         attempts = 0,
         available_at = now(),
         locked_at = null,
         locked_by = null,
         lease_expires_at = null,
         dead_lettered_at = null,
         completed_at = null,
         result = null,
         replay_count = event.replay_count + 1,
         last_replayed_at = now(),
         last_replay_reason = v_reason_code
   where event.id = p_event_id
     and event.status = 'failed'
     and event.dead_lettered_at is not null
  returning event.replay_count into v_replay_number;

  if not found then
    return false;
  end if;

  insert into public.merchant_outbox_replays (
    event_id,
    replay_number,
    replayed_by,
    reason_code
  )
  values (
    p_event_id,
    v_replay_number,
    v_replayed_by,
    v_reason_code
  );

  return true;
end;
$$;

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
        'webhook.deliver'
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

revoke all on function public.faolla_enqueue_merchant_outbox_v1(jsonb)
  from public;
revoke all on function public.faolla_claim_merchant_outbox_v1(text, integer, integer, text[])
  from public;
revoke all on function public.faolla_renew_merchant_outbox_lease_v1(uuid, text, integer)
  from public;
revoke all on function public.faolla_complete_merchant_outbox_v1(uuid, text, jsonb)
  from public;
revoke all on function public.faolla_fail_merchant_outbox_v1(uuid, text, text, text, boolean, integer)
  from public;
revoke all on function public.faolla_replay_merchant_outbox_v1(uuid, text, text)
  from public;
revoke all on function public.faolla_get_merchant_outbox_health_v1(text, integer)
  from public;

grant execute on function public.faolla_enqueue_merchant_outbox_v1(jsonb)
  to service_role;
grant execute on function public.faolla_claim_merchant_outbox_v1(text, integer, integer, text[])
  to service_role;
grant execute on function public.faolla_renew_merchant_outbox_lease_v1(uuid, text, integer)
  to service_role;
grant execute on function public.faolla_complete_merchant_outbox_v1(uuid, text, jsonb)
  to service_role;
grant execute on function public.faolla_fail_merchant_outbox_v1(uuid, text, text, text, boolean, integer)
  to service_role;
grant execute on function public.faolla_replay_merchant_outbox_v1(uuid, text, text)
  to service_role;
grant execute on function public.faolla_get_merchant_outbox_health_v1(text, integer)
  to service_role;

insert into public.faolla_schema_migrations (version, name)
values (202607250007, 'reliable_outbox_runtime')
on conflict (version) do nothing;

commit;
