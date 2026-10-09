-- User-approved single-worker seal gate. Only fresh correction/revision/missing
-- submissions and effects are guarded; exact RPC replays do not INSERT again.
-- No raw-clock trigger, old RPC replacement, global-period unlock or deadline
-- exemption. All existing writers and 149 seal/reopen hold settings UPDATE
-- before worker locks, so the saved sealed projection cannot change mid-write.
begin;
set local lock_timeout='3s';

do $period_seal_guard_prerequisites$
declare installed boolean;t regclass;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610050149 and name='merchant_attendance_period_closure')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610010103 and name='merchant_attendance_missing_revisions')
    or to_regclass('public.merchant_attendance_period_closures') is null
    or to_regclass('public.merchant_attendance_effect_current_v2') is null
    or to_regprocedure('public.faolla_attendance_effect_version_guard_v1()') is null then
    raise exception 'merchant_attendance_period_seal_guards_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050150 and name='merchant_attendance_period_seal_guards') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050150 and name<>'merchant_attendance_period_seal_guards') then
    raise exception 'merchant_attendance_period_seal_guards_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)',
    'public.faolla_attendance_period_seal_insert_guard_v1()'] loop
    if installed<>(to_regprocedure(p) is not null) then
      raise exception 'merchant_attendance_period_seal_guards_installation_conflict';end if;
  end loop;
  foreach t in array array['public.merchant_attendance_correction_entries'::regclass,
    'public.merchant_attendance_revision_requests'::regclass,'public.merchant_attendance_correction_effects'::regclass,
    'public.merchant_attendance_effect_versions'::regclass,'public.merchant_attendance_missing_requests'::regclass,
    'public.merchant_attendance_missing_entries'::regclass] loop
    if installed<>exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_period_seal_guard' and not tgisinternal) then
      raise exception 'merchant_attendance_period_seal_guards_installation_conflict';end if;
    if installed and exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_period_seal_guard'
      and (tgfoid<>to_regprocedure('public.faolla_attendance_period_seal_insert_guard_v1()') or tgtype<>7
        or tgenabled<>'O' or tgnargs<>0 or tgqual is not null)) then
      raise exception 'merchant_attendance_period_seal_guards_installation_conflict';end if;
  end loop;
end;
$period_seal_guard_prerequisites$;

create or replace function public.faolla_attendance_period_assert_open_v1(p_site text,p_worker uuid,p_spans jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare span jsonb;a timestamptz;b timestamptz;k text;
begin
  -- Private ABI: 1..3 canonical UTC6 half-open spans. A zero-duration original
  -- fact protects its one-microsecond point; touching nonzero endpoints is OK.
  if p_site is null or length(p_site)<>8 or p_site!~'^[0-9]{8}$' or p_worker is null
    or p_spans is null or jsonb_typeof(p_spans) is distinct from 'array'
    or octet_length(p_spans::text)>1024 then raise exception 'attendance_period_closure_invalid';end if;
  if jsonb_array_length(p_spans) not between 1 and 3 then raise exception 'attendance_period_closure_invalid';end if;
  for span in select value from jsonb_array_elements(p_spans) loop
    if jsonb_typeof(span) is distinct from 'object' then raise exception 'attendance_period_closure_invalid';end if;
    if (select count(*) from jsonb_object_keys(span))<>2 or not(span ?& array['startAt','endAt']) then
      raise exception 'attendance_period_closure_invalid';end if;
    foreach k in array array['startAt','endAt'] loop
      if jsonb_typeof(span->k) is distinct from 'string' or length(span->>k)<>27
        or (span->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
        or to_char((span->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') is distinct from span->>k then
        raise exception 'attendance_period_closure_invalid';end if;
    end loop;
    a:=(span->>'startAt')::timestamptz;b:=(span->>'endAt')::timestamptz;
    if not isfinite(a) or not isfinite(b) or b<a then raise exception 'attendance_period_closure_invalid';end if;
    if b=a then b:=b+interval '1 microsecond';end if;
    if exists(select 1 from public.merchant_attendance_period_closures c
      where c.merchant_id=p_site and c.worker_id=p_worker and c.sealed and c.start_at<b and c.end_at>a) then
      raise exception 'attendance_period_sealed';end if;
  end loop;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'attendance_period_closure_invalid';
end;
$$;

create or replace function public.faolla_attendance_period_seal_insert_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare
  site text;worker uuid;start_id uuid;root_id uuid;basis jsonb;proposal jsonb;
  original public.merchant_attendance_correction_entries%rowtype;
  revision_request public.merchant_attendance_revision_requests%rowtype;
  current_effect public.merchant_attendance_effect_current_v2%rowtype;
  missing_request public.merchant_attendance_missing_requests%rowtype;
  missing_parent public.merchant_attendance_missing_requests%rowtype;
  original_start timestamptz;original_end timestamptz;current_start timestamptz;current_end timestamptz;
  proposed_start timestamptz;proposed_end timestamptz;spans jsonb:='[]'::jsonb;
begin
  if tg_op<>'INSERT' or tg_when<>'BEFORE' or tg_level<>'ROW' then raise exception 'attendance_period_closure_invalid';end if;
  -- Skip administrative terminal actions before doing any seal/source reads.
  if tg_relid in('public.merchant_attendance_correction_entries'::regclass,'public.merchant_attendance_revision_requests'::regclass) then
    if new.action<>'submit' then return new;end if;
  elsif tg_relid='public.merchant_attendance_missing_entries'::regclass then
    if new.action<>'approve' then return new;end if;
  elsif tg_relid not in('public.merchant_attendance_correction_effects'::regclass,
    'public.merchant_attendance_effect_versions'::regclass,'public.merchant_attendance_missing_requests'::regclass) then
    raise exception 'attendance_period_closure_invalid';
  end if;
  site:=new.merchant_id;
  if tg_relid='public.merchant_attendance_missing_entries'::regclass then
    select * into missing_request from public.merchant_attendance_missing_requests
      where merchant_id=site and request_id=new.request_id;
    if missing_request.request_id is null then raise exception 'attendance_period_closure_invalid';end if;
    worker:=missing_request.worker_id;
  else worker:=new.worker_id;end if;
  if site is null or worker is null then raise exception 'attendance_period_closure_invalid';end if;
  -- Existing settings UPDATE is already held; no worker->settings upgrade here.
  -- Unsealed workers retain the exact old write and validation path.
  if not exists(select 1 from public.merchant_attendance_period_closures
    where merchant_id=site and worker_id=worker and sealed) then return new;end if;

  if tg_relid='public.merchant_attendance_missing_requests'::regclass
    or tg_relid='public.merchant_attendance_missing_entries'::regclass then
    if tg_relid='public.merchant_attendance_missing_requests'::regclass then missing_request:=new;end if;
    proposed_start:=missing_request.start_at;proposed_end:=missing_request.end_at;
    if missing_request.supersedes_request_id is not null then
      select * into missing_parent from public.merchant_attendance_missing_requests
        where merchant_id=site and request_id=missing_request.supersedes_request_id;
      if missing_parent.request_id is null or missing_parent.worker_id is distinct from worker then
        raise exception 'attendance_period_closure_invalid';end if;
      current_start:=missing_parent.start_at;current_end:=missing_parent.end_at;
    end if;
  else
    if tg_relid='public.merchant_attendance_correction_entries'::regclass then
      basis:=new.basis;proposal:=new.proposal;start_id:=new.start_event_id;
    elsif tg_relid='public.merchant_attendance_correction_effects'::regclass then
      select * into original from public.merchant_attendance_correction_entries
        where merchant_id=site and operation_id=new.request_id and action='submit';
      if original.operation_id is null or original.worker_id is distinct from worker
        or original.start_event_id is distinct from new.start_event_id then raise exception 'attendance_period_closure_invalid';end if;
      basis:=original.basis;proposal:=new.proposal;start_id:=new.start_event_id;
    else
      if tg_relid='public.merchant_attendance_revision_requests'::regclass then
        root_id:=new.base_request_id;proposal:=new.command->'proposal';
      else
        root_id:=new.root_request_id;
        select * into revision_request from public.merchant_attendance_revision_requests
          where merchant_id=site and operation_id=new.request_id and action='submit';
        if revision_request.operation_id is null or revision_request.worker_id is distinct from worker
          or revision_request.base_request_id is distinct from root_id then raise exception 'attendance_period_closure_invalid';end if;
        -- Do not rely on NEW.start_at/end_at being filled by the older BEFORE
        -- guard. The immutable submitted proposal is authoritative here.
        proposal:=revision_request.command->'proposal';
      end if;
      select * into original from public.merchant_attendance_correction_entries
        where merchant_id=site and operation_id=root_id and action='submit';
      if original.operation_id is null or original.worker_id is distinct from worker then
        raise exception 'attendance_period_closure_invalid';end if;
      basis:=original.basis;start_id:=original.start_event_id;
    end if;
    if basis is null or jsonb_typeof(basis->'events') is distinct from 'array'
      or proposal is null or jsonb_typeof(proposal) is distinct from 'object' then
      raise exception 'attendance_period_closure_invalid';end if;
    if jsonb_array_length(basis->'events')<1 or basis->'events'->0->>'id' is distinct from start_id::text then
      raise exception 'attendance_period_closure_invalid';end if;
    original_start:=(basis->'events'->0->>'occurredAt')::timestamptz;
    original_end:=(basis->'events'->-1->>'occurredAt')::timestamptz;
    if basis->'events'->-1->>'action'<>'clock_out' and original_end is not null then
      original_end:=original_end+interval '1 microsecond';end if;
    proposed_start:=(proposal->>'startAt')::timestamptz;proposed_end:=(proposal->>'endAt')::timestamptz;
    if original_start is null or original_end is null or original_end<original_start then
      raise exception 'attendance_period_closure_invalid';end if;
    select * into current_effect from public.merchant_attendance_effect_current_v2
      where merchant_id=site and worker_id=worker and start_event_id=start_id;
    if root_id is not null and (current_effect.request_id is null or current_effect.root_request_id is distinct from root_id) then
      raise exception 'attendance_period_closure_invalid';end if;
    if current_effect.request_id is not null then current_start:=current_effect.start_at;current_end:=current_effect.end_at;end if;
    spans:=spans||jsonb_build_array(jsonb_build_object(
      'startAt',to_char(original_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'endAt',to_char(original_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end if;
  if proposed_start is null or proposed_end is null then raise exception 'attendance_period_closure_invalid';end if;
  if current_start is not null or current_end is not null then
    if current_start is null or current_end is null then raise exception 'attendance_period_closure_invalid';end if;
    spans:=spans||jsonb_build_array(jsonb_build_object(
      'startAt',to_char(current_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'endAt',to_char(current_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end if;
  spans:=spans||jsonb_build_array(jsonb_build_object(
    'startAt',to_char(proposed_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char(proposed_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  perform public.faolla_attendance_period_assert_open_v1(site,worker,spans);
  return new;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'attendance_period_closure_invalid';
end;
$$;

revoke all on function public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_seal_insert_guard_v1() from public,anon,authenticated,service_role;

do $period_seal_guard_install$
begin
  -- One name per table, no trigger replacement/drop and no dynamic SQL. Reapply
  -- validates the existing six attachments instead of changing their identity.
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_correction_entries'::regclass and tgname='attendance_period_seal_guard') then
    create trigger attendance_period_seal_guard before insert on public.merchant_attendance_correction_entries for each row execute function public.faolla_attendance_period_seal_insert_guard_v1();
    create trigger attendance_period_seal_guard before insert on public.merchant_attendance_revision_requests for each row execute function public.faolla_attendance_period_seal_insert_guard_v1();
    create trigger attendance_period_seal_guard before insert on public.merchant_attendance_correction_effects for each row execute function public.faolla_attendance_period_seal_insert_guard_v1();
    create trigger attendance_period_seal_guard before insert on public.merchant_attendance_effect_versions for each row execute function public.faolla_attendance_period_seal_insert_guard_v1();
    create trigger attendance_period_seal_guard before insert on public.merchant_attendance_missing_requests for each row execute function public.faolla_attendance_period_seal_insert_guard_v1();
    create trigger attendance_period_seal_guard before insert on public.merchant_attendance_missing_entries for each row execute function public.faolla_attendance_period_seal_insert_guard_v1();
  end if;
end;
$period_seal_guard_install$;
insert into public.faolla_schema_migrations(version,name) values(202610050150,'merchant_attendance_period_seal_guards') on conflict(version) do nothing;

do $period_seal_guard_postconditions$
declare t regclass;p regprocedure;role_name text;
begin
  foreach t in array array['public.merchant_attendance_correction_entries'::regclass,
    'public.merchant_attendance_revision_requests'::regclass,'public.merchant_attendance_correction_effects'::regclass,
    'public.merchant_attendance_effect_versions'::regclass,'public.merchant_attendance_missing_requests'::regclass,
    'public.merchant_attendance_missing_entries'::regclass] loop
    if (select count(*) from pg_trigger where tgrelid=t and tgname='attendance_period_seal_guard' and not tgisinternal
      and tgfoid='public.faolla_attendance_period_seal_insert_guard_v1()'::regprocedure and tgtype=7
      and tgenabled='O' and tgnargs=0 and tgqual is null)<>1 then
      raise exception 'merchant_attendance_period_seal_guards_trigger_postcondition_failed';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)'::regprocedure,
    'public.faolla_attendance_period_seal_insert_guard_v1()'::regprocedure] loop
    if (select prosecdef from pg_proc where oid=p) then raise exception 'merchant_attendance_period_seal_guards_acl_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,p,'EXECUTE') then raise exception 'merchant_attendance_period_seal_guards_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_events'::regclass
    and tgfoid='public.faolla_attendance_period_seal_insert_guard_v1()'::regprocedure) then
    raise exception 'merchant_attendance_period_seal_guards_clock_postcondition_failed';end if;
end;
$period_seal_guard_postconditions$;
commit;
