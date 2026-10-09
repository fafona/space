--231 single-worker period continuation. No archive rewrite, quota increase,
--deletion, source-policy change or automatic replay. Existing PKs remain global.
--Only short-lock installation is specified here; production rollout is not run.
begin;
set local lock_timeout='3s';

do $continuation_preflight$
declare installed boolean;row_item record;function_name text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610070179 and name='merchant_attendance_outage_periods')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610070182 and name='merchant_attendance_retention')
    or to_regprocedure('public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)') is null
    or to_regprocedure('public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)') is null then
    raise exception 'merchant_attendance_period_continuation_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610080183 and name='merchant_attendance_period_continuation') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610080183 and name<>'merchant_attendance_period_continuation')
    or installed<>(to_regclass('public.merchant_attendance_period_storage') is not null)
    or installed<>(to_regclass('public.merchant_attendance_period_artifact_metadata') is not null)
    or installed<>(to_regprocedure('public.faolla_attendance_period_closure_v2(jsonb,uuid,jsonb,jsonb,boolean)') is not null) then
    raise exception 'merchant_attendance_period_continuation_installation_conflict';end if;
  foreach function_name in array array['faolla_attendance_period_closure_command_v2','faolla_attendance_period_entry_v2',
    'faolla_attendance_period_summary_v2','faolla_attendance_period_storage_insert_v2','faolla_attendance_period_closure_v2'] loop
    if (select count(*) from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
      and p.proname=function_name)<>(case when installed then 1 else 0 end) then
      raise exception 'merchant_attendance_period_continuation_installation_conflict';end if;
    if installed then
      select * into row_item from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=function_name;
      if row_item.proowner<>(select oid from pg_roles where rolname=current_user) or row_item.prokind<>'f' or row_item.proretset
        or row_item.proargmodes is not null or row_item.proconfig is distinct from array['search_path=pg_catalog']
        or row_item.prosecdef<>(function_name in('faolla_attendance_period_storage_insert_v2','faolla_attendance_period_closure_v2'))
        or exists(select 1 from aclexplode(coalesce(row_item.proacl,acldefault('f',row_item.proowner))) a where a.grantee<>row_item.proowner
          and not(a.grantee=(select oid from pg_roles where rolname='service_role') and function_name='faolla_attendance_period_closure_v2')) then
        raise exception 'merchant_attendance_period_continuation_function_conflict';end if;
    end if;
  end loop;
  if installed then
    for row_item in select c.* from pg_class c where c.oid in('public.merchant_attendance_period_storage'::regclass,'public.merchant_attendance_period_artifact_metadata'::regclass) loop
      if row_item.relkind<>'r' or not row_item.relrowsecurity or row_item.relowner<>(select oid from pg_roles where rolname=current_user)
        or exists(select 1 from pg_policy where polrelid=row_item.oid)
        or exists(select 1 from aclexplode(coalesce(row_item.relacl,acldefault('r',row_item.relowner))) a where a.grantee<>row_item.relowner) then
        raise exception 'merchant_attendance_period_continuation_permission_conflict';end if;
    end loop;
  end if;
end;
$continuation_preflight$;

--Serialize the one-time projection with old and new artifact writers. A busy
--installation fails lock_timeout; no successful caller is silently retried.
lock table public.merchant_attendance_settings in share row exclusive mode;
lock table public.merchant_attendance_period_closures,public.merchant_attendance_period_artifacts,
  public.merchant_attendance_period_versions,public.merchant_attendance_period_entries in share row exclusive mode;
do $continuation_existing_facts$
begin
  if exists(select 1 from (select start_at,lag(end_at) over(partition by merchant_id,worker_id order by start_at,period_id) prior_end
      from public.merchant_attendance_period_closures) ordered where prior_end>start_at) then
    raise exception 'merchant_attendance_period_continuation_overlap_conflict';end if;
  if exists(select 1 from public.merchant_attendance_period_artifacts group by merchant_id having sum(artifact_bytes)>67108864) then
    raise exception 'attendance_period_storage_limit';end if;
end;
$continuation_existing_facts$;



create or replace function public.faolla_attendance_period_closure_command_v2(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;action_name text;
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','periodId','expectedRevision','expectedVersion','expectedFingerprint','reason']) is distinct from true
    or octet_length(p::text)>8192 then return false;end if;
  action_name:=p->>'action';
  if action_name is null or action_name not in('send','confirm','dispute','respond','seal','reopen') then return false;end if;
  foreach k in array array['operationId','periodId'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)<>36 or (p->>k)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false;end if;
  end loop;
  foreach k in array array['expectedRevision','expectedVersion'] loop
    if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)!~'^(0|[1-9][0-9]{0,9})$' then return false;end if;
  end loop;
  if (p->>'expectedRevision')::numeric>=2147483647 or (p->>'expectedVersion')::numeric>(p->>'expectedRevision')::numeric
    or action_name<>'send' and ((p->>'expectedRevision')::integer=0 or (p->>'expectedVersion')::integer=0)
    or jsonb_typeof(p->'reason') is distinct from 'string' or p->>'reason'<>btrim(p->>'reason')
    or char_length(p->>'reason')>500 or p->>'reason'~'[[:cntrl:]]'
    or action_name not in('send','confirm') and char_length(p->>'reason')=0 then return false;end if;
  if p->'expectedFingerprint'='null'::jsonb then return action_name not in('send','confirm','seal');end if;
  return jsonb_typeof(p->'expectedFingerprint')='string' and length(p->>'expectedFingerprint')=64 and p->>'expectedFingerprint'~'^[0-9a-f]{64}$';
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create or replace function public.faolla_attendance_period_entry_v2(p public.merchant_attendance_period_entries)
returns jsonb language plpgsql set search_path=pg_catalog as $$
begin
  if p.operation_id is null then return null;end if;
  if public.faolla_attendance_period_closure_command_v2(p.command) is distinct from true
    or p.operation_id::text is distinct from p.command->>'operationId' or p.period_id::text is distinct from p.command->>'periodId'
    or p.action is distinct from p.command->>'action' or p.revision::bigint<>(p.command->>'expectedRevision')::bigint+1
    or (p.version<>(p.command->>'expectedVersion')::integer and
      (p.action<>'send' or p.version::bigint<>(p.command->>'expectedVersion')::bigint+1)) then raise exception 'attendance_period_closure_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'action',p.action,'version',p.version,
    'actorId',p.actor_auth_user_id,'reason',p.command->'reason','recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'command',p.command);
end;
$$;


--Match the five149 checks by the database's own deparser, not generated
--constraint-name guesses or parenthesis-stripping rewrites.
do $continuation_numeric_constraints$
declare installed boolean;spec record;old_name text;found_count integer;
begin
  select exists(select 1 from public.faolla_schema_migrations where version=202610080183 and name='merchant_attendance_period_continuation') into installed;
  create temporary table attendance_period_continuation_check_probe(
      revision integer,current_version integer,version integer,sealed boolean,recorded_at timestamptz,
      action text,command jsonb,operation_id uuid,period_id uuid,
      constraint expected_head check(revision between 1 and 100 and current_version between 1 and 20),
      constraint expected_terminal check(not sealed or revision<100),
      constraint expected_version check(version between 1 and 20 and isfinite(recorded_at)),
      constraint expected_entry check(revision between 1 and 100 and version between 1 and 20 and isfinite(recorded_at)),
      constraint expected_command check(public.faolla_attendance_period_closure_command_v1(command) is true
        and action=command->>'action' and operation_id=(command->>'operationId')::uuid and period_id=(command->>'periodId')::uuid
        and revision=(command->>'expectedRevision')::integer+1),
      constraint current_head check(revision between 1 and 2147483647 and current_version between 1 and 2147483647),
      constraint current_terminal check(not sealed or revision<2147483647),
      constraint current_version check(version between 1 and 2147483647 and isfinite(recorded_at)),
      constraint current_entry check(revision between 1 and 2147483647 and version between 1 and 2147483647 and isfinite(recorded_at)),
      constraint current_command check((public.faolla_attendance_period_closure_command_v2(command) is true
        and action=command->>'action' and operation_id=(command->>'operationId')::uuid and period_id=(command->>'periodId')::uuid
        and revision::bigint=(command->>'expectedRevision')::bigint+1) is true)
    ) on commit drop;
  if not installed then
    for spec in select * from (values
      ('public.merchant_attendance_period_closures'::regclass,'expected_head'),
      ('public.merchant_attendance_period_closures'::regclass,'expected_terminal'),
      ('public.merchant_attendance_period_versions'::regclass,'expected_version'),
      ('public.merchant_attendance_period_entries'::regclass,'expected_entry'),
      ('public.merchant_attendance_period_entries'::regclass,'expected_command')) target(table_id,check_name) loop
      select count(*),min(c.conname::text) into found_count,old_name from pg_constraint c
        where c.conrelid=spec.table_id and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid,true)=
          (select pg_get_constraintdef(p.oid,true) from pg_constraint p
            where p.conrelid='pg_temp.attendance_period_continuation_check_probe'::regclass and p.conname=spec.check_name);
      if found_count<>1 then raise exception 'merchant_attendance_period_continuation_constraint_conflict';end if;
      execute format('alter table %s drop constraint %I',spec.table_id,old_name);
    end loop;
    alter table public.merchant_attendance_period_closures
      add constraint attendance_period_continuation_head_numbers check(revision between 1 and 2147483647 and current_version between 1 and 2147483647),
      add constraint attendance_period_continuation_terminal_open check(not sealed or revision<2147483647);
    alter table public.merchant_attendance_period_versions
      add constraint attendance_period_continuation_version_numbers check(version between 1 and 2147483647 and isfinite(recorded_at));
    alter table public.merchant_attendance_period_entries
      add constraint attendance_period_continuation_entry_numbers check(revision between 1 and 2147483647 and version between 1 and 2147483647 and isfinite(recorded_at)),
      add constraint attendance_period_continuation_entry_command check((public.faolla_attendance_period_closure_command_v2(command) is true
        and action=command->>'action' and operation_id=(command->>'operationId')::uuid and period_id=(command->>'periodId')::uuid
        and revision::bigint=(command->>'expectedRevision')::bigint+1) is true);
  end if;
  for spec in select * from (values
    ('public.merchant_attendance_period_closures'::regclass,'attendance_period_continuation_head_numbers','current_head'),
    ('public.merchant_attendance_period_closures'::regclass,'attendance_period_continuation_terminal_open','current_terminal'),
    ('public.merchant_attendance_period_versions'::regclass,'attendance_period_continuation_version_numbers','current_version'),
    ('public.merchant_attendance_period_entries'::regclass,'attendance_period_continuation_entry_numbers','current_entry'),
    ('public.merchant_attendance_period_entries'::regclass,'attendance_period_continuation_entry_command','current_command')) target(table_id,check_name,probe_name) loop
    if not exists(select 1 from pg_constraint c where c.conrelid=spec.table_id and c.conname=spec.check_name and c.contype='c' and c.convalidated
      and pg_get_constraintdef(c.oid,true)=(select pg_get_constraintdef(p.oid,true) from pg_constraint p
        where p.conrelid='pg_temp.attendance_period_continuation_check_probe'::regclass and p.conname=spec.probe_name)) then
      raise exception 'merchant_attendance_period_continuation_constraint_conflict';end if;
  end loop;
end;
$continuation_numeric_constraints$;

create table if not exists public.merchant_attendance_period_storage(
  merchant_id text primary key references public.merchant_attendance_settings(merchant_id),
  used_bytes bigint not null check(used_bytes between 0 and 67108864)
);
create table if not exists public.merchant_attendance_period_artifact_metadata(
  merchant_id text not null,artifact_id uuid not null,worker_name text not null,worker_no text not null,
  primary key(merchant_id,artifact_id),
  foreign key(merchant_id,artifact_id) references public.merchant_attendance_period_artifacts(merchant_id,artifact_id),
  check(char_length(worker_name) between 1 and 120 and char_length(worker_no) between 1 and 40)
);
alter table public.merchant_attendance_period_storage enable row level security;
alter table public.merchant_attendance_period_artifact_metadata enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_period_storage'::regclass,
      'public.merchant_attendance_period_artifact_metadata'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_period_storage,public.merchant_attendance_period_artifact_metadata from public,anon,authenticated,service_role;

do $continuation_initial_projection$
declare artifact_row public.merchant_attendance_period_artifacts%rowtype;
  period_row public.merchant_attendance_period_closures%rowtype;body jsonb;installed boolean;
begin
  select exists(select 1 from public.faolla_schema_migrations migration_record
    where migration_record.version=202610080183 and migration_record.name='merchant_attendance_period_continuation') into installed;
  if not installed then
    insert into public.merchant_attendance_period_storage(merchant_id,used_bytes)
      select initial_artifact.merchant_id,sum(initial_artifact.artifact_bytes)
      from public.merchant_attendance_period_artifacts initial_artifact group by initial_artifact.merchant_id;
    for artifact_row in select source_artifact.* from public.merchant_attendance_period_artifacts source_artifact
      order by source_artifact.merchant_id,source_artifact.artifact_id loop
      body:=public.faolla_attendance_period_artifact_checked_v1(artifact_row);
      select source_period.* into period_row from public.merchant_attendance_period_closures source_period
        where source_period.merchant_id=artifact_row.merchant_id and source_period.period_id=artifact_row.period_id;
      if period_row.period_id is null then raise exception 'attendance_period_closure_invalid';end if;
      perform public.faolla_attendance_period_summary_v1(period_row,body);
      insert into public.merchant_attendance_period_artifact_metadata(merchant_id,artifact_id,worker_name,worker_no)
        values(artifact_row.merchant_id,artifact_row.artifact_id,body->'worker'->>'workerName',body->'worker'->>'workerNo');
    end loop;
  else
    if exists(select 1 from public.merchant_attendance_period_storage quota_current full join
        (select counted_artifact.merchant_id,sum(counted_artifact.artifact_bytes) used_bytes
          from public.merchant_attendance_period_artifacts counted_artifact group by counted_artifact.merchant_id) quota_totals using(merchant_id)
      where coalesce(quota_current.used_bytes,0)<>coalesce(quota_totals.used_bytes,0)) then raise exception 'merchant_attendance_period_continuation_storage_conflict';end if;
    if exists(select 1 from public.merchant_attendance_period_artifacts persisted_artifact
      left join public.merchant_attendance_period_artifact_metadata metadata_row using(merchant_id,artifact_id)
      where metadata_row.artifact_id is null or metadata_row.worker_name is distinct from persisted_artifact.artifact_text::jsonb->'worker'->>'workerName'
        or metadata_row.worker_no is distinct from persisted_artifact.artifact_text::jsonb->'worker'->>'workerNo') then
      raise exception 'merchant_attendance_period_continuation_metadata_conflict';end if;
  end if;
end;
$continuation_initial_projection$;

create or replace function public.faolla_attendance_period_storage_insert_v2()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare body jsonb;c public.merchant_attendance_period_closures%rowtype;
begin
  if tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' or tg_relid<>'public.merchant_attendance_period_artifacts'::regclass then
    raise exception 'attendance_period_closure_invalid';end if;
  --Every old/new period writer holds this lock before worker/employee locks.
  --Only a genuinely new artifact INSERT reaches this atomic charge.
  perform 1 from public.merchant_attendance_settings where merchant_id=new.merchant_id for update;
  if not found then raise exception 'attendance_settings_required';end if;
  body:=public.faolla_attendance_period_artifact_checked_v1(new);
  select * into c from public.merchant_attendance_period_closures where merchant_id=new.merchant_id and period_id=new.period_id;
  if c.period_id is null then raise exception 'attendance_period_closure_invalid';end if;
  perform public.faolla_attendance_period_summary_v1(c,body);
  insert into public.merchant_attendance_period_storage(merchant_id,used_bytes) values(new.merchant_id,0) on conflict(merchant_id) do nothing;
  update public.merchant_attendance_period_storage set used_bytes=used_bytes+new.artifact_bytes
    where merchant_id=new.merchant_id and used_bytes<=67108864-new.artifact_bytes;
  if not found then raise exception 'attendance_period_storage_limit';end if;
  insert into public.merchant_attendance_period_artifact_metadata(merchant_id,artifact_id,worker_name,worker_no)
    values(new.merchant_id,new.artifact_id,body->'worker'->>'workerName',body->'worker'->>'workerNo');
  return new;
end;
$$;

do $continuation_projection_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_period_artifacts'::regclass and tgname='attendance_period_storage_insert') then
    create trigger attendance_period_storage_insert after insert on public.merchant_attendance_period_artifacts
      for each row execute function public.faolla_attendance_period_storage_insert_v2();
    create trigger attendance_period_metadata_immutable before update or delete on public.merchant_attendance_period_artifact_metadata
      for each row execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_period_metadata_no_truncate before truncate on public.merchant_attendance_period_artifact_metadata
      for each statement execute function public.faolla_attendance_events_append_only_v1();
  end if;
end;
$continuation_projection_triggers$;

create index if not exists attendance_period_continuation_start_idx on public.merchant_attendance_period_closures(merchant_id,worker_id,start_at desc,period_id desc) include(end_at);
create index if not exists attendance_period_continuation_sealed_idx on public.merchant_attendance_period_closures(merchant_id,worker_id,start_at desc,period_id desc) include(end_at) where sealed;
create index if not exists attendance_period_continuation_dates_idx on public.merchant_attendance_period_closures(merchant_id,worker_id,from_date,through_date,opened_at desc,period_id desc);




create or replace function public.faolla_attendance_period_summary_v2(p public.merchant_attendance_period_closures)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare m public.merchant_attendance_period_artifact_metadata%rowtype;v public.merchant_attendance_period_versions%rowtype;
  head public.merchant_attendance_period_entries%rowtype;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p.period_id is null then return null;end if;
  select * into head from public.merchant_attendance_period_entries where merchant_id=p.merchant_id and period_id=p.period_id and revision=p.revision;
  perform public.faolla_attendance_period_entry_v2(head);
  select * into v from public.merchant_attendance_period_versions where merchant_id=p.merchant_id and period_id=p.period_id and version=p.current_version;
  select * into m from public.merchant_attendance_period_artifact_metadata where merchant_id=p.merchant_id and artifact_id=v.artifact_id;
  if head.operation_id is null or head.version is distinct from p.current_version or head.recorded_at is distinct from p.updated_at or m.artifact_id is null then
    raise exception 'attendance_period_closure_invalid';end if;
  return public.faolla_attendance_period_summary_v1(p,jsonb_build_object(
    'worker',jsonb_build_object('workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'workerName',m.worker_name,'workerNo',m.worker_no),
    'period',jsonb_build_object('fromDate',p.from_date,'throughDate',p.through_date,'timeZone',p.time_zone,
      'startAt',to_char(p.start_at at time zone 'UTC',fmt),'endAt',to_char(p.end_at at time zone 'UTC',fmt))));
end;
$$;


--Narrow150 compatibility: same spans/errors, indexed predecessor under the proved non-overlap invariant.
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
    --183 installation proved all worker periods non-overlapping. Among sealed
    --periods starting before b, only the nearest predecessor can overlap.
    if exists(select 1 from (select c.end_at from public.merchant_attendance_period_closures c
      where c.merchant_id=p_site and c.worker_id=p_worker and c.sealed and c.start_at<b
      order by c.start_at desc,c.period_id desc limit 1) predecessor where predecessor.end_at>a) then
      raise exception 'attendance_period_sealed';end if;
  end loop;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'attendance_period_closure_invalid';
end;
$$;

--Narrow182 compatibility: only the fixed artifact-reference proof changes.
create or replace function public.faolla_attendance_retention_source_v1(p_site text,p_category text,p_record uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog set extra_float_digits=3 as $$
declare ev public.merchant_attendance_events%rowtype;loc public.merchant_attendance_location_results%rowtype;
  ar public.merchant_attendance_period_artifacts%rowtype;cl public.merchant_attendance_period_closures%rowtype;
  body jsonb;src jsonb;event_item jsonb;result jsonb;version_row record;n integer:=0;k text;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_category in('events','location_results') then
    select * into ev from public.merchant_attendance_events where merchant_id=p_site and id=p_record;
    if ev.id is null then raise exception 'attendance_retention_not_found';end if;
    if ev.sequence not between 1 and 9007199254740991 or not isfinite(ev.occurred_at) or not isfinite(ev.received_at) then raise exception 'attendance_retention_invalid';end if;
    event_item:=jsonb_build_object('kind','event','eventId',ev.id,'workerId',ev.worker_id,'locationId',ev.location_id,'operationId',ev.operation_id,
      'sequence',ev.sequence,'action',ev.action,'rawSource',ev.source,'breakPaid',ev.break_paid,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC',fmt),'receivedAt',to_char(ev.received_at at time zone 'UTC',fmt),'timeZone',ev.time_zone,'actorEmployeeId',ev.actor_employee_id);
    if p_category='events' then result:=event_item;
    else
      select * into loc from public.merchant_attendance_location_results where event_id=ev.id;
      if loc.event_id is null then raise exception 'attendance_retention_not_found';end if;
      if loc.settings_version not between 1 and 9007199254740991 or loc.worker_version not between 1 and 9007199254740991
        or loc.location_version not between 1 and 9007199254740991 then raise exception 'attendance_retention_invalid';end if;
      result:=jsonb_build_object('kind','location_summary','event',event_item,'settingsVersion',loc.settings_version,'workerVersion',loc.worker_version,'locationVersion',loc.location_version,
        'algorithmVersion',loc.algorithm_version,'reason',loc.reason,'needsReview',loc.needs_review,'capturedAt',to_char(loc.captured_at at time zone 'UTC',fmt),
        'accuracyMeters',loc.accuracy_meters,'distanceMeters',loc.distance_meters);
    end if;
  elsif p_category='period_artifact' then
    select * into ar from public.merchant_attendance_period_artifacts where merchant_id=p_site and artifact_id=p_record;
    if ar.artifact_id is null then raise exception 'attendance_retention_not_found';end if;
    begin body:=public.faolla_attendance_period_artifact_checked_v1(ar);
    exception when raise_exception then
      if sqlerrm='attendance_period_closure_invalid' then raise exception 'attendance_retention_invalid';else raise;end if;
    end;
    src:=body->'source';
    select * into cl from public.merchant_attendance_period_closures where merchant_id=p_site and period_id=ar.period_id;
    if cl.period_id is null or body->'worker'->>'workerId' is distinct from cl.worker_id::text
      or body->'worker'->>'employeeId' is distinct from cl.employee_id::text or body->'worker'->>'employeeAuthUserId' is distinct from cl.employee_auth_user_id::text
      or src->>'siteId' is distinct from p_site or src->>'workerId' is distinct from cl.worker_id::text
      or src->>'employeeId' is distinct from cl.employee_id::text or src->>'employeeAuthUserId' is distinct from cl.employee_auth_user_id::text
      or src->>'sourceFingerprint' is not null or ar.source_fingerprint is distinct from encode(sha256(convert_to(src::text,'UTF8')),'hex')
      or coalesce(src->>'sourceVersion','') not in('attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3','attendance-period-source-v4')
      or body->'period' is distinct from jsonb_build_object('fromDate',cl.from_date,'throughDate',cl.through_date,'timeZone',cl.time_zone,
        'startAt',to_char(cl.start_at at time zone 'UTC',fmt),'endAt',to_char(cl.end_at at time zone 'UTC',fmt))
      or src->>'fromDate' is distinct from cl.from_date::text or src->>'throughDate' is distinct from cl.through_date::text or src->>'timeZone' is distinct from cl.time_zone
      or src->>'fromAt' is distinct from to_char(cl.start_at at time zone 'UTC',fmt) or src->>'toAt' is distinct from to_char(cl.end_at at time zone 'UTC',fmt)
      or body->'dayBoundaries' is distinct from src->'dayBoundaries' then raise exception 'attendance_retention_invalid';end if;
    --183: arbitrary later versions may reuse this immutable artifact. Its
    --creation send/version is a fixed point proof, not a lifetime ref listing.
    select v.*,e.action,e.command,e.version as entry_version,e.recorded_at as entry_recorded_at into version_row
      from public.merchant_attendance_period_versions v join public.merchant_attendance_period_entries e
        on e.merchant_id=v.merchant_id and e.period_id=v.period_id and e.operation_id=v.operation_id
      where v.merchant_id=p_site and v.operation_id=ar.artifact_id;
    if not found or version_row.period_id is distinct from ar.period_id or version_row.artifact_id is distinct from ar.artifact_id
      or version_row.action is distinct from 'send' or version_row.entry_version is distinct from version_row.version
      or version_row.recorded_at is distinct from ar.recorded_at or version_row.entry_recorded_at is distinct from ar.recorded_at
      or version_row.command->>'periodId' is distinct from ar.period_id::text
      or version_row.command->>'operationId' is distinct from ar.artifact_id::text
      or version_row.command->>'expectedFingerprint' is distinct from ar.source_fingerprint then
      raise exception 'attendance_retention_invalid';end if;
    result:=jsonb_build_object('kind','period_artifact','artifactId',ar.artifact_id,'periodId',ar.period_id,'workerId',cl.worker_id,'employeeId',cl.employee_id,
      'fromDate',cl.from_date,'throughDate',cl.through_date,'timeZone',cl.time_zone,'startAt',to_char(cl.start_at at time zone 'UTC',fmt),
      'endAt',to_char(cl.end_at at time zone 'UTC',fmt),'recordedAt',to_char(ar.recorded_at at time zone 'UTC',fmt),
      'artifactSha256',ar.artifact_sha256,'artifactBytes',ar.artifact_bytes,'sourceFingerprint',ar.source_fingerprint);
  else raise exception 'attendance_invalid_request';end if;
  if octet_length(convert_to(result::text,'UTF8'))>8192 then raise exception 'attendance_retention_too_large';end if;
  --No current timezone lookup: saved UTC and timezone text are immutable data.
  foreach k in array array['occurredAt','receivedAt','capturedAt','startAt','endAt','recordedAt'] loop
    if result ? k and result->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(result->k,'stamp6') is distinct from true then raise exception 'attendance_retention_invalid';end if;
  end loop;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_retention_invalid';
end;
$$;

--179 business writer retained for legacy safe heads; only protocol guard and shared quota lookup change.
create or replace function public.faolla_attendance_period_closure_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_artifact jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;access_name text;mode_name text;wid uuid;pid uuid;op uuid;requested_version integer;first_day date;last_day date;action_name text;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  c public.merchant_attendance_period_closures%rowtype;listed public.merchant_attendance_period_closures%rowtype;
  saved public.merchant_attendance_period_entries%rowtype;entry_row public.merchant_attendance_period_entries%rowtype;
  a public.merchant_attendance_period_artifacts%rowtype;v public.merchant_attendance_period_versions%rowtype;
  source_result jsonb;source_query jsonb;artifact_json jsonb;artifact_text text;artifact_size integer;common jsonb;history jsonb:='[]';items jsonb:='[]';summary jsonb;
  replayed boolean:=false;changed boolean;is_new boolean;new_version boolean;now_at timestamptz;prior_at timestamptz;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
  n integer;bytes_total bigint;k text;self_employee uuid;expected_worker jsonb;expected_period jsonb;
begin
  if p_auth_user_id is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate','mode','periodId','operationId','version']) is distinct from true
    or octet_length(p_query::text)>2048 then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  if jsonb_typeof(p_query->'siteId') is distinct from 'string' or jsonb_typeof(p_query->'access') is distinct from 'string'
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or length(site)<>8 or site!~'^[0-9]{8}$'
    or access_name not in('owner','self') or mode_name not in('list','preview','detail','recover','export') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['workerId','periodId','operationId'] loop
    if k<>'workerId' and p_query->k='null'::jsonb then continue;end if;
    if jsonb_typeof(p_query->k) is distinct from 'string' or length(p_query->>k)<>36
      or (p_query->>k)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'attendance_invalid_request';end if;
  end loop;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(p_query->k) is distinct from 'string' or length(p_query->>k)<>10 or (p_query->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (p_query->>k)::date::text is distinct from p_query->>k then raise exception 'attendance_invalid_request';end if;
  end loop;
  wid:=(p_query->>'workerId')::uuid;pid:=(p_query->>'periodId')::uuid;op:=(p_query->>'operationId')::uuid;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  if p_query->'version'<>'null'::jsonb then
    if jsonb_typeof(p_query->'version') is distinct from 'number' or (p_query->>'version')!~'^[1-9][0-9]?$' then raise exception 'attendance_invalid_request';end if;
    requested_version:=(p_query->>'version')::integer;
    if requested_version>20 then raise exception 'attendance_invalid_request';end if;
  end if;
  if mode_name='list' and (pid is not null or op is not null or requested_version is not null)
    or mode_name='preview' and (op is not null or requested_version is not null)
    or mode_name in('detail','recover','export') and pid is null
    or (mode_name='recover')<>(op is not null) or mode_name='export' and requested_version is null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_period_closure_command_v1(p_command) is distinct from true or mode_name<>'detail' or requested_version is not null
      or p_command->>'periodId' is distinct from pid::text then raise exception 'attendance_invalid_request';end if;
    action_name:=p_command->>'action';op:=(p_command->>'operationId')::uuid;
    if (access_name='self')<>(action_name in('confirm','dispute')) then raise exception 'attendance_access_denied';end if;
  end if;
  if p_artifact is not null and action_name is distinct from 'send' then raise exception 'attendance_invalid_request';end if;

  -- Same serialization boundary as every correction/missing writer and150.
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  --175 current-source reads must take settings UPDATE before worker UPDATE.
  --Fixed export, recovery, historical detail and list keep their old read lock.
  if p_command is null and mode_name<>'preview' and not(mode_name='detail' and p_query->'version'='null'::jsonb) then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    select id into self_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if self_employee is null then raise exception 'attendance_access_denied';end if;
  end if;
  --148 itself uses worker UPDATE. Acquire that mode up front, never upgrade a
  --held worker SHARE when preview/detail subsequently call148.
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then if access_name='self' then raise exception 'attendance_access_denied';else raise exception 'attendance_worker_not_found';end if;end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_period_identity_changed';end if;
  if access_name='self' then
    if e.id<>self_employee or e.auth_user_id<>p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if r.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('enterprise.view'=any(r.permissions)) or not('attendance.self.view'=any(r.permissions))
      or mode_name='export' and not('attendance.self.export'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
  end if;
  source_query:=jsonb_build_object('siteId',site,'access',access_name,'workerId',wid,'fromDate',first_day,'throughDate',last_day,'periodId',pid);
  if pid is not null then
    select * into c from public.merchant_attendance_period_closures where merchant_id=site and period_id=pid;
    if c.period_id is not null then
      if c.worker_id<>wid or c.from_date<>first_day or c.through_date<>last_day then raise exception 'attendance_access_denied';end if;
      if c.employee_id<>e.id or c.employee_auth_user_id<>e.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
    end if;
  end if;
  if op is not null then
    select * into saved from public.merchant_attendance_period_entries where merchant_id=site and operation_id=op;
    if saved.operation_id is not null then
      if saved.period_id<>pid or saved.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if c.period_id is null then raise exception 'attendance_period_closure_invalid';end if;
      if p_command is not null and saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      replayed:=true;
    elsif mode_name='recover' then raise exception 'attendance_operation_not_found';end if;
  end if;

  --183: never return a truncated v1 history or write a head v1 cannot parse.
  --Existing safe heads retain the original v1 result and operation ordering.
  if c.period_id is not null and (c.revision>100 or c.current_version>20) then
    raise exception 'attendance_period_protocol_required';end if;
  if mode_name='list' then
    for listed in select * from public.merchant_attendance_period_closures where merchant_id=site and worker_id=wid
      and from_date=first_day and through_date=last_day order by opened_at desc,period_id desc limit 21 loop
      if listed.revision>100 or listed.current_version>20 then raise exception 'attendance_period_protocol_required';end if;
      if jsonb_array_length(items)>=20 then raise exception 'attendance_period_limit';end if;
      if listed.employee_id<>e.id or listed.employee_auth_user_id<>e.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=listed.period_id
        and artifact_id=(select artifact_id from public.merchant_attendance_period_versions where merchant_id=site and period_id=listed.period_id and version=listed.current_version);
      items:=items||jsonb_build_array(public.faolla_attendance_period_summary_v1(listed,public.faolla_attendance_period_artifact_checked_v1(a)));
    end loop;
    return jsonb_build_object('protocol','period-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
      'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','list','items',items);
  end if;
  if mode_name='preview' then
    if pid is not null and c.period_id is null then raise exception 'attendance_period_not_found';end if;
    if c.period_id is not null then
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid
        and artifact_id=(select artifact_id from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version);
      summary:=public.faolla_attendance_period_summary_v1(c,public.faolla_attendance_period_artifact_checked_v1(a));
    end if;
    source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
    return jsonb_build_object('protocol','period-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
      'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','preview','period',summary,'source',source_result);
  end if;

  if p_command is not null and saved.operation_id is null then
    -- Reopen only removes this independent gate, not084 or the old deadline.
    -- It remains available to the current owner when the module is paused.
    if action_name<>'reopen' and (not coalesce(p_allow_write,false) or not s.enabled) then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not('attendance.self.request'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    is_new:=c.period_id is null;
    if is_new and action_name<>'send' then raise exception 'attendance_period_not_found';end if;
    if (p_command->>'expectedRevision')::integer<>coalesce(c.revision,0) or (p_command->>'expectedVersion')::integer<>coalesce(c.current_version,0) then raise exception 'attendance_version_conflict';end if;
    if coalesce(c.revision,0)>=100 or coalesce(c.revision,0)>=99 and action_name<>'reopen' then raise exception 'attendance_period_limit';end if;
    if action_name='send' then
      if c.sealed then raise exception 'attendance_period_sealed';end if;
      if p_artifact is null then raise exception 'attendance_invalid_request';end if;
      source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
      --179 also blocks relevant unresolved outage reviews before a fresh send.
      --Other old blockers retain their old review/seal semantics.
      if (source_result->'blockers' ? 'period_in_progress' or source_result->'blockers' ? 'unresolved_outage') then raise exception 'attendance_period_blocked';end if;
      if source_result->>'sourceFingerprint' is distinct from p_command->>'expectedFingerprint'
        or p_artifact->>'sourceFingerprint' is distinct from source_result->>'sourceFingerprint'
        or p_artifact->'source' is distinct from source_result->'sourceCanonical' then raise exception 'attendance_period_source_changed';end if;
      expected_worker:=jsonb_build_object('workerId',wid,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'workerName',w.display_name,'workerNo',w.worker_no);
      expected_period:=jsonb_build_object('fromDate',first_day,'throughDate',last_day,'timeZone',source_result->'timeZone','startAt',source_result->'fromAt','endAt',source_result->'toAt');
      if p_artifact->'worker' is distinct from expected_worker or p_artifact->'period' is distinct from expected_period
        or p_artifact->'dayBoundaries' is distinct from source_result->'dayBoundaries'
        or p_artifact->'report'->>'access' is distinct from 'owner'
        or p_artifact->'report'->'base'->>'workerId' is distinct from wid::text
        or p_artifact->'report'->'base'->>'employeeId' is distinct from e.id::text
        or p_artifact->'report'->'base'->>'fromAt' is distinct from source_result->>'fromAt'
        or p_artifact->'report'->'base'->>'toAt' is distinct from source_result->>'toAt' then raise exception 'attendance_period_closure_invalid';end if;
      -- Validate every fresh supplied body, even if this source fingerprint can
      -- reuse an existing immutable artifact (or need no new logical version).
      artifact_text:=p_artifact::text;artifact_size:=octet_length(convert_to(artifact_text,'UTF8'));
      if artifact_size>2097152 then raise exception 'attendance_period_source_too_large';end if;
      a.merchant_id:=site;a.period_id:=pid;a.artifact_id:=op;a.source_fingerprint:=source_result->>'sourceFingerprint';
      a.artifact_text:=artifact_text;a.artifact_sha256:=encode(sha256(convert_to(artifact_text,'UTF8')),'hex');a.artifact_bytes:=artifact_size;
      perform public.faolla_attendance_period_artifact_checked_v1(a);
      if not is_new and expected_period is distinct from jsonb_build_object('fromDate',c.from_date,'throughDate',c.through_date,'timeZone',c.time_zone,
        'startAt',to_char(c.start_at at time zone 'UTC',fmt),'endAt',to_char(c.end_at at time zone 'UTC',fmt)) then raise exception 'attendance_period_source_changed';end if;
      now_at:=clock_timestamp();
      if now_at<(source_result->>'readAt')::timestamptz or c.updated_at>now_at then raise exception 'attendance_version_conflict';end if;
      if is_new then
        if exists(select 1 from (select x.end_at from public.merchant_attendance_period_closures x
          where x.merchant_id=site and x.worker_id=wid and x.start_at<(source_result->>'toAt')::timestamptz
          order by x.start_at desc,x.period_id desc limit 1) predecessor
          where predecessor.end_at>(source_result->>'fromAt')::timestamptz) then raise exception 'attendance_period_overlap';end if;
        select count(*) into n from (select 1 from public.merchant_attendance_period_closures where merchant_id=site limit 1000) bounded;
        if n>=1000 then raise exception 'attendance_period_limit';end if;
        select count(*) into n from (select 1 from public.merchant_attendance_period_closures where merchant_id=site and worker_id=wid limit 200) bounded;
        if n>=200 then raise exception 'attendance_period_limit';end if;
        insert into public.merchant_attendance_period_closures(merchant_id,period_id,worker_id,employee_id,employee_auth_user_id,from_date,through_date,time_zone,start_at,end_at,
          revision,current_version,state,sealed,confirmed_version,unresolved_dispute,opened_at,updated_at)
          values(site,pid,wid,e.id,e.auth_user_id,first_day,last_day,source_result->>'timeZone',(source_result->>'fromAt')::timestamptz,(source_result->>'toAt')::timestamptz,
            1,1,'review',false,null,false,now_at,now_at) returning * into c;
        new_version:=true;
      else
        select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version;
        select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and artifact_id=v.artifact_id;
        artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
        if a.source_fingerprint=source_result->>'sourceFingerprint' and artifact_json->'source' is distinct from source_result->'sourceCanonical' then
          raise exception 'attendance_period_closure_invalid';end if;
        new_version:=c.state='open' or a.source_fingerprint<>source_result->>'sourceFingerprint';
        if new_version and c.current_version>=20 then raise exception 'attendance_period_limit';end if;
      end if;
      if new_version then
        select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and source_fingerprint=source_result->>'sourceFingerprint';
        if a.artifact_id is null then
          --183 INSERT trigger charges the unchanged shared64MiB budget atomically.
          a.merchant_id:=site;a.period_id:=pid;a.artifact_id:=op;a.source_fingerprint:=source_result->>'sourceFingerprint';
          a.artifact_text:=artifact_text;a.artifact_sha256:=encode(sha256(convert_to(artifact_text,'UTF8')),'hex');a.artifact_bytes:=artifact_size;a.recorded_at:=now_at;
          perform public.faolla_attendance_period_artifact_checked_v1(a);
          --Keep the v1 client's existing definite-rejection code; v2 exposes the new storage-specific code.
          begin
            insert into public.merchant_attendance_period_artifacts select (a).*;
          exception when raise_exception then
            if sqlerrm='attendance_period_storage_limit' then raise exception 'attendance_period_limit';else raise;end if;
          end;
        else
          artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
          if artifact_json->'source' is distinct from source_result->'sourceCanonical' then raise exception 'attendance_period_closure_invalid';end if;
        end if;
        if not is_new then c.current_version:=c.current_version+1;end if;
        insert into public.merchant_attendance_period_versions(merchant_id,period_id,version,artifact_id,operation_id,recorded_at)
          values(site,pid,c.current_version,a.artifact_id,op,now_at);
        c.confirmed_version:=null;c.state:=case when c.unresolved_dispute then 'disputed' else 'review' end;
      end if;
    else
      select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version;
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and artifact_id=v.artifact_id;
      artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
      if action_name in('confirm','seal') then
        if c.sealed then raise exception 'attendance_period_sealed';end if;
        if c.state='open' then raise exception 'attendance_period_not_confirmed';end if;
        if p_command->>'expectedFingerprint' is distinct from a.source_fingerprint then raise exception 'attendance_period_source_changed';end if;
        source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
        if source_result->>'sourceFingerprint' is distinct from a.source_fingerprint
          or source_result->'sourceCanonical' is distinct from artifact_json->'source' then raise exception 'attendance_period_source_changed';end if;
        if action_name='confirm' then c.confirmed_version:=c.current_version;c.unresolved_dispute:=false;c.state:='confirmed';
        else
          if source_result->>'validation' is distinct from 'owner_checked' or source_result->'blockers' is distinct from '[]'::jsonb then raise exception 'attendance_period_blocked';end if;
          if c.confirmed_version is distinct from c.current_version or c.unresolved_dispute then raise exception 'attendance_period_not_confirmed';end if;
          c.sealed:=true;c.state:='sealed';
        end if;
      elsif action_name='dispute' then
        c.unresolved_dispute:=true;if not c.sealed then c.state:='disputed';end if;
      elsif action_name='reopen' then
        if not c.sealed then raise exception 'attendance_period_not_sealed';end if;
        c.sealed:=false;c.state:='open';c.confirmed_version:=null;
      end if;
      -- respond appends an owner explanation only; it cannot clear a dispute,
      -- invent the employee's confirmation or rewrite a sealed version.
      now_at:=clock_timestamp();
      if c.updated_at>now_at or source_result is not null and now_at<(source_result->>'readAt')::timestamptz then raise exception 'attendance_version_conflict';end if;
    end if;
    c.revision:=(p_command->>'expectedRevision')::integer+1;c.updated_at:=now_at;
    insert into public.merchant_attendance_period_entries(merchant_id,period_id,operation_id,revision,version,actor_auth_user_id,action,command,recorded_at)
      values(site,pid,op,c.revision,c.current_version,p_auth_user_id,action_name,p_command,now_at) returning * into saved;
    update public.merchant_attendance_period_closures set revision=c.revision,current_version=c.current_version,state=c.state,sealed=c.sealed,
      confirmed_version=c.confirmed_version,unresolved_dispute=c.unresolved_dispute,updated_at=c.updated_at where merchant_id=site and period_id=pid;
  end if;

  if c.period_id is null then raise exception 'attendance_period_not_found';end if;
  if requested_version is null then requested_version:=case when replayed then saved.version else c.current_version end;end if;
  if replayed and requested_version<>saved.version then raise exception 'attendance_invalid_request';end if;
  select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=requested_version;
  if v.version is null then raise exception 'attendance_period_not_found';end if;
  select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and artifact_id=v.artifact_id;
  artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
  summary:=public.faolla_attendance_period_summary_v1(c,artifact_json);
  for entry_row in select * from public.merchant_attendance_period_entries where merchant_id=site and period_id=pid order by revision limit 101 loop
    if entry_row.revision<>jsonb_array_length(history)+1 or entry_row.version>c.current_version or entry_row.recorded_at<c.opened_at
      or entry_row.recorded_at>c.updated_at or prior_at>entry_row.recorded_at then raise exception 'attendance_period_closure_invalid';end if;
    history:=history||jsonb_build_array(public.faolla_attendance_period_entry_v1(entry_row));prior_at:=entry_row.recorded_at;
  end loop;
  if jsonb_array_length(history)<>c.revision then raise exception 'attendance_period_closure_invalid';end if;
  select count(*) into n from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid;
  if n<>c.current_version then raise exception 'attendance_period_closure_invalid';end if;
  -- Recovery, export, historical version reads and all completed writes return
  -- the stored bytes without collecting current sources or consulting tzdata.
  if p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb then
    begin
      source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
      changed:=source_result->>'sourceFingerprint' is distinct from a.source_fingerprint;
    exception when raise_exception then
      -- A current source that cannot now be collected does not erase a saved
      -- archive or strand reopening. Authorization and unknown errors still fail.
      if sqlerrm=any(array['attendance_period_source_invalid','attendance_period_source_too_large',
        'attendance_period_source_identity_changed','attendance_period_identity_unproven',
        'attendance_period_source_identity_unproven','attendance_report_invalid_data',
        'attendance_report_too_large','attendance_report_reconciliation_required','attendance_session_invalid_records']) then
        changed:=null;
      else raise;end if;
    end;
  end if;
  common:=jsonb_build_object('protocol','period-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  return common||jsonb_build_object('kind','detail','period',summary,'artifact',artifact_json,'artifactText',a.artifact_text,
    'artifactSha256',a.artifact_sha256,'artifactBytes',a.artifact_bytes,'artifactVersion',requested_version,'history',history,
    'sourceChanged',changed,'operation',public.faolla_attendance_period_entry_v1(saved),'replayed',replayed);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'attendance_invalid_request';
end;
$$;

--V2 preserves179 write semantics; dedicated bounded reads replace whole-history aggregation.
create or replace function public.faolla_attendance_period_closure_v2(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_artifact jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;access_name text;mode_name text;wid uuid;pid uuid;op uuid;requested_version integer;first_day date;last_day date;action_name text;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  c public.merchant_attendance_period_closures%rowtype;listed public.merchant_attendance_period_closures%rowtype;
  saved public.merchant_attendance_period_entries%rowtype;entry_row public.merchant_attendance_period_entries%rowtype;
  a public.merchant_attendance_period_artifacts%rowtype;v public.merchant_attendance_period_versions%rowtype;
  source_result jsonb;source_query jsonb;artifact_json jsonb;artifact_text text;artifact_size integer;common jsonb;history jsonb:='[]';items jsonb:='[]';summary jsonb;
  replayed boolean:=false;changed boolean;is_new boolean;new_version boolean;now_at timestamptz;prior_at timestamptz;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
  n integer;k text;self_employee uuid;expected_worker jsonb;expected_period jsonb;
  cursor_value jsonb;next_cursor jsonb;cursor_scope jsonb;at_revision integer;before_revision integer;at_version integer;before_version integer;
  at_opened timestamptz;before_opened timestamptz;at_pid uuid;before_pid uuid;last_revision integer;last_version integer;
  last_opened timestamptz;last_pid uuid;version_meta jsonb;page_entry jsonb;page_top integer;
begin
  if p_auth_user_id is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate','mode','periodId','operationId','version','cursor']) is distinct from true
    or octet_length(p_query::text)>4096 then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  if jsonb_typeof(p_query->'siteId') is distinct from 'string' or jsonb_typeof(p_query->'access') is distinct from 'string'
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or length(site)<>8 or site!~'^[0-9]{8}$'
    or access_name not in('owner','self') or mode_name not in('list','preview','detail','recover','export','history','versions') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['workerId','periodId','operationId'] loop
    if k<>'workerId' and p_query->k='null'::jsonb then continue;end if;
    if jsonb_typeof(p_query->k) is distinct from 'string' or length(p_query->>k)<>36
      or (p_query->>k)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'attendance_invalid_request';end if;
  end loop;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(p_query->k) is distinct from 'string' or length(p_query->>k)<>10 or (p_query->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (p_query->>k)::date::text is distinct from p_query->>k then raise exception 'attendance_invalid_request';end if;
  end loop;
  wid:=(p_query->>'workerId')::uuid;pid:=(p_query->>'periodId')::uuid;op:=(p_query->>'operationId')::uuid;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  if p_query->'version'<>'null'::jsonb then
    if jsonb_typeof(p_query->'version') is distinct from 'number' or (p_query->>'version')!~'^[1-9][0-9]{0,9}$' or (p_query->>'version')::numeric>2147483647 then raise exception 'attendance_invalid_request';end if;
    requested_version:=(p_query->>'version')::integer;
  end if;
  if mode_name='list' and (pid is not null or op is not null or requested_version is not null)
    or mode_name='preview' and (op is not null or requested_version is not null)
    or mode_name in('detail','recover','export','history','versions') and pid is null
    or (mode_name='recover')<>(op is not null) or mode_name='export' and requested_version is null
    or mode_name in('history','versions','recover') and requested_version is not null then raise exception 'attendance_invalid_request';end if;
  cursor_value:=p_query->'cursor';
  if cursor_value<>'null'::jsonb then
    if mode_name not in('list','history','versions')
      or public.faolla_attendance_shift_rule_binding_object_v1(cursor_value,
        (case mode_name when 'list' then array['kind','siteId','access','workerId','fromDate','throughDate','periodId','atOpenedAt','atPeriodId','beforeOpenedAt','beforePeriodId']
          when 'history' then array['kind','siteId','access','workerId','fromDate','throughDate','periodId','atRevision','beforeRevision']
          else array['kind','siteId','access','workerId','fromDate','throughDate','periodId','atVersion','beforeVersion'] end)) is distinct from true then raise exception 'attendance_invalid_request';end if;
    if cursor_value->>'kind' is distinct from mode_name then raise exception 'attendance_invalid_request';end if;
    foreach k in array array['siteId','access','workerId','fromDate','throughDate','periodId'] loop
      if cursor_value->k is distinct from p_query->k then raise exception 'attendance_invalid_request';end if;
    end loop;
    if mode_name='list' then
      if public.faolla_attendance_shift_rule_binding_scalar_v1(cursor_value->'atOpenedAt','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(cursor_value->'beforeOpenedAt','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(cursor_value->'atPeriodId','uuid') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(cursor_value->'beforePeriodId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
      at_opened:=(cursor_value->>'atOpenedAt')::timestamptz;at_pid:=(cursor_value->>'atPeriodId')::uuid;
      before_opened:=(cursor_value->>'beforeOpenedAt')::timestamptz;before_pid:=(cursor_value->>'beforePeriodId')::uuid;
      if (before_opened,before_pid)>(at_opened,at_pid) then raise exception 'attendance_invalid_request';end if;
    else
      foreach k in array (case when mode_name='history' then array['atRevision','beforeRevision'] else array['atVersion','beforeVersion'] end) loop
        if jsonb_typeof(cursor_value->k) is distinct from 'number' or (cursor_value->>k)!~'^[1-9][0-9]{0,9}$'
          or (cursor_value->>k)::numeric>2147483647 then raise exception 'attendance_invalid_request';end if;
      end loop;
      if mode_name='history' then
        at_revision:=(cursor_value->>'atRevision')::integer;before_revision:=(cursor_value->>'beforeRevision')::integer;
        if before_revision>at_revision then raise exception 'attendance_invalid_request';end if;
      else
        at_version:=(cursor_value->>'atVersion')::integer;before_version:=(cursor_value->>'beforeVersion')::integer;
        if before_version>at_version then raise exception 'attendance_invalid_request';end if;
      end if;
    end if;
  end if;
  if p_command is not null and cursor_value<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_period_closure_command_v2(p_command) is distinct from true or mode_name<>'detail' or requested_version is not null
      or p_command->>'periodId' is distinct from pid::text then raise exception 'attendance_invalid_request';end if;
    action_name:=p_command->>'action';op:=(p_command->>'operationId')::uuid;
    if (access_name='self')<>(action_name in('confirm','dispute')) then raise exception 'attendance_access_denied';end if;
  end if;
  if p_artifact is not null and action_name is distinct from 'send' then raise exception 'attendance_invalid_request';end if;

  -- Same serialization boundary as every correction/missing writer and150.
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  --175 current-source reads must take settings UPDATE before worker UPDATE.
  --Fixed export, recovery, historical detail and list keep their old read lock.
  if p_command is null and mode_name<>'preview' and not(mode_name='detail' and p_query->'version'='null'::jsonb) then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    select id into self_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if self_employee is null then raise exception 'attendance_access_denied';end if;
  end if;
  --148 itself uses worker UPDATE. Acquire that mode up front, never upgrade a
  --held worker SHARE when preview/detail subsequently call148.
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then if access_name='self' then raise exception 'attendance_access_denied';else raise exception 'attendance_worker_not_found';end if;end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_period_identity_changed';end if;
  if access_name='self' then
    if e.id<>self_employee or e.auth_user_id<>p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if r.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('enterprise.view'=any(r.permissions)) or not('attendance.self.view'=any(r.permissions))
      or mode_name='export' and not('attendance.self.export'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
  end if;
  source_query:=jsonb_build_object('siteId',site,'access',access_name,'workerId',wid,'fromDate',first_day,'throughDate',last_day,'periodId',pid);
  if pid is not null then
    select * into c from public.merchant_attendance_period_closures where merchant_id=site and period_id=pid;
    if c.period_id is not null then
      if c.worker_id<>wid or c.from_date<>first_day or c.through_date<>last_day then raise exception 'attendance_access_denied';end if;
      if c.employee_id<>e.id or c.employee_auth_user_id<>e.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
    end if;
  end if;
  if op is not null then
    select * into saved from public.merchant_attendance_period_entries where merchant_id=site and operation_id=op;
    if saved.operation_id is not null then
      if saved.period_id<>pid or saved.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if c.period_id is null then raise exception 'attendance_period_closure_invalid';end if;
      if p_command is not null and saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      replayed:=true;
    elsif mode_name='recover' then raise exception 'attendance_operation_not_found';end if;
  end if;

  common:=jsonb_build_object('protocol','period-closure-v2','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  cursor_scope:=jsonb_build_object('kind',mode_name,'siteId',site,'access',access_name,'workerId',wid,'fromDate',first_day,'throughDate',last_day,'periodId',pid);
  if mode_name='list' then
    if cursor_value<>'null'::jsonb and (not exists(select 1 from public.merchant_attendance_period_closures x
        where x.merchant_id=site and x.worker_id=wid and x.period_id=at_pid and x.opened_at=at_opened
          and x.from_date between first_day-30 and last_day and x.through_date>=first_day)
      or not exists(select 1 from public.merchant_attendance_period_closures x
        where x.merchant_id=site and x.worker_id=wid and x.period_id=before_pid and x.opened_at=before_opened
          and x.from_date between first_day-30 and last_day and x.through_date>=first_day)) then raise exception 'attendance_invalid_request';end if;
    for listed in select x.* from public.merchant_attendance_period_closures x where x.merchant_id=site and x.worker_id=wid
      and x.from_date between first_day-30 and last_day and x.through_date>=first_day
      and (at_opened is null or (x.opened_at,x.period_id)<=(at_opened,at_pid))
      and (before_opened is null or (x.opened_at,x.period_id)<(before_opened,before_pid))
      order by x.opened_at desc,x.period_id desc limit 26 loop
      if at_opened is null then at_opened:=listed.opened_at;at_pid:=listed.period_id;end if;
      if jsonb_array_length(items)=25 then
        next_cursor:=cursor_scope||jsonb_build_object('atOpenedAt',to_char(at_opened at time zone 'UTC',fmt),'atPeriodId',at_pid,
          'beforeOpenedAt',to_char(last_opened at time zone 'UTC',fmt),'beforePeriodId',last_pid);exit;end if;
      if listed.employee_id<>e.id or listed.employee_auth_user_id<>e.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
      items:=items||jsonb_build_array(public.faolla_attendance_period_summary_v2(listed)||jsonb_build_object('openedAt',to_char(listed.opened_at at time zone 'UTC',fmt)));
      last_opened:=listed.opened_at;last_pid:=listed.period_id;
    end loop;
    return common||jsonb_build_object('kind','list','items',items,'nextCursor',next_cursor);
  end if;
  if mode_name in('history','versions') then
    if c.period_id is null then raise exception 'attendance_period_not_found';end if;
    summary:=public.faolla_attendance_period_summary_v2(c);
    if mode_name='history' then
      at_revision:=coalesce(at_revision,c.revision);
      if at_revision>c.revision or before_revision is not null and not exists(select 1 from public.merchant_attendance_period_entries x
        where x.merchant_id=site and x.period_id=pid and x.revision=before_revision) then raise exception 'attendance_invalid_request';end if;
      page_top:=case when before_revision is null then at_revision else before_revision-1 end;
      for entry_row in select x.* from public.merchant_attendance_period_entries x where x.merchant_id=site and x.period_id=pid
        and x.revision<=at_revision and (before_revision is null or x.revision<before_revision) order by x.revision desc limit 51 loop
        if entry_row.revision<>page_top-jsonb_array_length(items) then raise exception 'attendance_period_closure_invalid';end if;
        if jsonb_array_length(items)=50 then next_cursor:=cursor_scope||jsonb_build_object('atRevision',at_revision,'beforeRevision',last_revision);exit;end if;
        if entry_row.version>c.current_version or entry_row.recorded_at<c.opened_at or entry_row.recorded_at>c.updated_at
          or prior_at<entry_row.recorded_at then raise exception 'attendance_period_closure_invalid';end if;
        items:=items||jsonb_build_array(public.faolla_attendance_period_entry_v2(entry_row));last_revision:=entry_row.revision;prior_at:=entry_row.recorded_at;
      end loop;
      if jsonb_array_length(items)<>least(50,page_top) or (page_top>50)<>(next_cursor is not null) then raise exception 'attendance_period_closure_invalid';end if;
    else
      at_version:=coalesce(at_version,c.current_version);
      if at_version>c.current_version or before_version is not null and not exists(select 1 from public.merchant_attendance_period_versions x
        where x.merchant_id=site and x.period_id=pid and x.version=before_version) then raise exception 'attendance_invalid_request';end if;
      page_top:=case when before_version is null then at_version else before_version-1 end;
      for v in select x.* from public.merchant_attendance_period_versions x where x.merchant_id=site and x.period_id=pid
        and x.version<=at_version and (before_version is null or x.version<before_version) order by x.version desc limit 21 loop
        if v.version<>page_top-jsonb_array_length(items) then raise exception 'attendance_period_closure_invalid';end if;
        if jsonb_array_length(items)=20 then next_cursor:=cursor_scope||jsonb_build_object('atVersion',at_version,'beforeVersion',last_version);exit;end if;
        select * into entry_row from public.merchant_attendance_period_entries where merchant_id=site and operation_id=v.operation_id;
        page_entry:=public.faolla_attendance_period_entry_v2(entry_row);
        if page_entry is null or entry_row.period_id<>pid or entry_row.version<>v.version or entry_row.action<>'send' or entry_row.recorded_at<>v.recorded_at
          or v.recorded_at<c.opened_at or v.recorded_at>c.updated_at or prior_at<v.recorded_at then raise exception 'attendance_period_closure_invalid';end if;
        select jsonb_build_object('version',v.version,'operationId',v.operation_id,'recordedAt',to_char(v.recorded_at at time zone 'UTC',fmt),
          'artifactId',x.artifact_id,'sourceFingerprint',x.source_fingerprint,'artifactBytes',x.artifact_bytes,'artifactSha256',x.artifact_sha256) into version_meta
          from public.merchant_attendance_period_artifacts x where x.merchant_id=site and x.period_id=pid and x.artifact_id=v.artifact_id;
        if version_meta is null then raise exception 'attendance_period_closure_invalid';end if;
        items:=items||jsonb_build_array(version_meta);last_version:=v.version;prior_at:=v.recorded_at;
      end loop;
      if jsonb_array_length(items)<>least(20,page_top) or (page_top>20)<>(next_cursor is not null) then raise exception 'attendance_period_closure_invalid';end if;
    end if;
    return common||jsonb_build_object('kind',mode_name,'period',summary,'items',items,'nextCursor',next_cursor);
  end if;
  if mode_name='preview' then
    if pid is not null and c.period_id is null then raise exception 'attendance_period_not_found';end if;
    if c.period_id is not null then
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid
        and artifact_id=(select artifact_id from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version);
      summary:=public.faolla_attendance_period_summary_v1(c,public.faolla_attendance_period_artifact_checked_v1(a));
    end if;
    source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
    return jsonb_build_object('protocol','period-closure-v2','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
      'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','preview','period',summary,'source',source_result);
  end if;

  if p_command is not null and saved.operation_id is null then
    -- Reopen only removes this independent gate, not084 or the old deadline.
    -- It remains available to the current owner when the module is paused.
    if action_name<>'reopen' and (not coalesce(p_allow_write,false) or not s.enabled) then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not('attendance.self.request'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    is_new:=c.period_id is null;
    if is_new and action_name<>'send' then raise exception 'attendance_period_not_found';end if;
    if (p_command->>'expectedRevision')::integer<>coalesce(c.revision,0) or (p_command->>'expectedVersion')::integer<>coalesce(c.current_version,0) then raise exception 'attendance_version_conflict';end if;
    if coalesce(c.revision,0)>=2147483647 or coalesce(c.revision,0)>=2147483646 and action_name<>'reopen' then raise exception 'attendance_period_limit';end if;
    if action_name='send' then
      if c.sealed then raise exception 'attendance_period_sealed';end if;
      if p_artifact is null then raise exception 'attendance_invalid_request';end if;
      source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
      --179 also blocks relevant unresolved outage reviews before a fresh send.
      --Other old blockers retain their old review/seal semantics.
      if (source_result->'blockers' ? 'period_in_progress' or source_result->'blockers' ? 'unresolved_outage') then raise exception 'attendance_period_blocked';end if;
      if source_result->>'sourceFingerprint' is distinct from p_command->>'expectedFingerprint'
        or p_artifact->>'sourceFingerprint' is distinct from source_result->>'sourceFingerprint'
        or p_artifact->'source' is distinct from source_result->'sourceCanonical' then raise exception 'attendance_period_source_changed';end if;
      expected_worker:=jsonb_build_object('workerId',wid,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'workerName',w.display_name,'workerNo',w.worker_no);
      expected_period:=jsonb_build_object('fromDate',first_day,'throughDate',last_day,'timeZone',source_result->'timeZone','startAt',source_result->'fromAt','endAt',source_result->'toAt');
      if p_artifact->'worker' is distinct from expected_worker or p_artifact->'period' is distinct from expected_period
        or p_artifact->'dayBoundaries' is distinct from source_result->'dayBoundaries'
        or p_artifact->'report'->>'access' is distinct from 'owner'
        or p_artifact->'report'->'base'->>'workerId' is distinct from wid::text
        or p_artifact->'report'->'base'->>'employeeId' is distinct from e.id::text
        or p_artifact->'report'->'base'->>'fromAt' is distinct from source_result->>'fromAt'
        or p_artifact->'report'->'base'->>'toAt' is distinct from source_result->>'toAt' then raise exception 'attendance_period_closure_invalid';end if;
      -- Validate every fresh supplied body, even if this source fingerprint can
      -- reuse an existing immutable artifact (or need no new logical version).
      artifact_text:=p_artifact::text;artifact_size:=octet_length(convert_to(artifact_text,'UTF8'));
      if artifact_size>2097152 then raise exception 'attendance_period_source_too_large';end if;
      a.merchant_id:=site;a.period_id:=pid;a.artifact_id:=op;a.source_fingerprint:=source_result->>'sourceFingerprint';
      a.artifact_text:=artifact_text;a.artifact_sha256:=encode(sha256(convert_to(artifact_text,'UTF8')),'hex');a.artifact_bytes:=artifact_size;
      perform public.faolla_attendance_period_artifact_checked_v1(a);
      if not is_new and expected_period is distinct from jsonb_build_object('fromDate',c.from_date,'throughDate',c.through_date,'timeZone',c.time_zone,
        'startAt',to_char(c.start_at at time zone 'UTC',fmt),'endAt',to_char(c.end_at at time zone 'UTC',fmt)) then raise exception 'attendance_period_source_changed';end if;
      now_at:=clock_timestamp();
      if now_at<(source_result->>'readAt')::timestamptz or c.updated_at>now_at then raise exception 'attendance_version_conflict';end if;
      if is_new then
        --All stored periods were proven non-overlapping at183 installation;
        --settings UPDATE serializes every later insert. Read one predecessor.
        if exists(select 1 from (select x.end_at from public.merchant_attendance_period_closures x
          where x.merchant_id=site and x.worker_id=wid and x.start_at<(source_result->>'toAt')::timestamptz
          order by x.start_at desc,x.period_id desc limit 1) predecessor
          where predecessor.end_at>(source_result->>'fromAt')::timestamptz) then raise exception 'attendance_period_overlap';end if;
        insert into public.merchant_attendance_period_closures(merchant_id,period_id,worker_id,employee_id,employee_auth_user_id,from_date,through_date,time_zone,start_at,end_at,
          revision,current_version,state,sealed,confirmed_version,unresolved_dispute,opened_at,updated_at)
          values(site,pid,wid,e.id,e.auth_user_id,first_day,last_day,source_result->>'timeZone',(source_result->>'fromAt')::timestamptz,(source_result->>'toAt')::timestamptz,
            1,1,'review',false,null,false,now_at,now_at) returning * into c;
        new_version:=true;
      else
        select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version;
        select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and artifact_id=v.artifact_id;
        artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
        if a.source_fingerprint=source_result->>'sourceFingerprint' and artifact_json->'source' is distinct from source_result->'sourceCanonical' then
          raise exception 'attendance_period_closure_invalid';end if;
        new_version:=c.state='open' or a.source_fingerprint<>source_result->>'sourceFingerprint';
        if new_version and c.current_version>=2147483647 then raise exception 'attendance_period_limit';end if;
      end if;
      if new_version then
        select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and source_fingerprint=source_result->>'sourceFingerprint';
        if a.artifact_id is null then
          --Shared artifact INSERT trigger is the only ongoing budget charge.
          a.merchant_id:=site;a.period_id:=pid;a.artifact_id:=op;a.source_fingerprint:=source_result->>'sourceFingerprint';
          a.artifact_text:=artifact_text;a.artifact_sha256:=encode(sha256(convert_to(artifact_text,'UTF8')),'hex');a.artifact_bytes:=artifact_size;a.recorded_at:=now_at;
          perform public.faolla_attendance_period_artifact_checked_v1(a);
          insert into public.merchant_attendance_period_artifacts select (a).*;
        else
          artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
          if artifact_json->'source' is distinct from source_result->'sourceCanonical' then raise exception 'attendance_period_closure_invalid';end if;
        end if;
        if not is_new then c.current_version:=c.current_version+1;end if;
        insert into public.merchant_attendance_period_versions(merchant_id,period_id,version,artifact_id,operation_id,recorded_at)
          values(site,pid,c.current_version,a.artifact_id,op,now_at);
        c.confirmed_version:=null;c.state:=case when c.unresolved_dispute then 'disputed' else 'review' end;
      end if;
    else
      select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version;
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and artifact_id=v.artifact_id;
      artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
      if action_name in('confirm','seal') then
        if c.sealed then raise exception 'attendance_period_sealed';end if;
        if c.state='open' then raise exception 'attendance_period_not_confirmed';end if;
        if p_command->>'expectedFingerprint' is distinct from a.source_fingerprint then raise exception 'attendance_period_source_changed';end if;
        source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
        if source_result->>'sourceFingerprint' is distinct from a.source_fingerprint
          or source_result->'sourceCanonical' is distinct from artifact_json->'source' then raise exception 'attendance_period_source_changed';end if;
        if action_name='confirm' then c.confirmed_version:=c.current_version;c.unresolved_dispute:=false;c.state:='confirmed';
        else
          if source_result->>'validation' is distinct from 'owner_checked' or source_result->'blockers' is distinct from '[]'::jsonb then raise exception 'attendance_period_blocked';end if;
          if c.confirmed_version is distinct from c.current_version or c.unresolved_dispute then raise exception 'attendance_period_not_confirmed';end if;
          c.sealed:=true;c.state:='sealed';
        end if;
      elsif action_name='dispute' then
        c.unresolved_dispute:=true;if not c.sealed then c.state:='disputed';end if;
      elsif action_name='reopen' then
        if not c.sealed then raise exception 'attendance_period_not_sealed';end if;
        c.sealed:=false;c.state:='open';c.confirmed_version:=null;
      end if;
      -- respond appends an owner explanation only; it cannot clear a dispute,
      -- invent the employee's confirmation or rewrite a sealed version.
      now_at:=clock_timestamp();
      if c.updated_at>now_at or source_result is not null and now_at<(source_result->>'readAt')::timestamptz then raise exception 'attendance_version_conflict';end if;
    end if;
    c.revision:=(p_command->>'expectedRevision')::integer+1;c.updated_at:=now_at;
    insert into public.merchant_attendance_period_entries(merchant_id,period_id,operation_id,revision,version,actor_auth_user_id,action,command,recorded_at)
      values(site,pid,op,c.revision,c.current_version,p_auth_user_id,action_name,p_command,now_at) returning * into saved;
    update public.merchant_attendance_period_closures set revision=c.revision,current_version=c.current_version,state=c.state,sealed=c.sealed,
      confirmed_version=c.confirmed_version,unresolved_dispute=c.unresolved_dispute,updated_at=c.updated_at where merchant_id=site and period_id=pid;
  end if;

  if c.period_id is null then raise exception 'attendance_period_not_found';end if;
  if requested_version is null then requested_version:=case when replayed then saved.version else c.current_version end;end if;
  if replayed and requested_version<>saved.version then raise exception 'attendance_invalid_request';end if;
  select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=requested_version;
  if v.version is null then raise exception 'attendance_period_not_found';end if;
  select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and artifact_id=v.artifact_id;
  artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
  summary:=public.faolla_attendance_period_summary_v1(c,artifact_json);
  --Point-check the authoritative current head; bounded history lives only in
  --its dedicated seek endpoint. Recovery never reads unrelated operations.
  perform public.faolla_attendance_period_summary_v2(c);
  -- Recovery, export, historical version reads and all completed writes return
  -- the stored bytes without collecting current sources or consulting tzdata.
  if p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb then
    begin
      source_result:=public.faolla_attendance_period_closure_source_v1(source_query,p_auth_user_id);
      changed:=source_result->>'sourceFingerprint' is distinct from a.source_fingerprint;
    exception when raise_exception then
      -- A current source that cannot now be collected does not erase a saved
      -- archive or strand reopening. Authorization and unknown errors still fail.
      if sqlerrm=any(array['attendance_period_source_invalid','attendance_period_source_too_large',
        'attendance_period_source_identity_changed','attendance_period_identity_unproven',
        'attendance_period_source_identity_unproven','attendance_report_invalid_data',
        'attendance_report_too_large','attendance_report_reconciliation_required','attendance_session_invalid_records']) then
        changed:=null;
      else raise;end if;
    end;
  end if;
  common:=jsonb_build_object('protocol','period-closure-v2','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  return common||jsonb_build_object('kind','detail','period',summary,'artifact',artifact_json,'artifactText',a.artifact_text,
    'artifactSha256',a.artifact_sha256,'artifactBytes',a.artifact_bytes,'artifactVersion',requested_version,
    'sourceChanged',changed,'operation',public.faolla_attendance_period_entry_v2(saved),'replayed',replayed);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'attendance_invalid_request';
end;
$$;


revoke all on function public.faolla_attendance_period_closure_command_v2(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_entry_v2(public.merchant_attendance_period_entries) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_summary_v2(public.merchant_attendance_period_closures) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_storage_insert_v2() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_closure_v2(jsonb,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_closure_v2(jsonb,uuid,jsonb,jsonb,boolean) to service_role;

--Replaced old helpers keep their exact existing service/private boundary.
revoke all on function public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) to service_role;
revoke all on function public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_retention_source_v1(text,text,uuid) from public,anon,authenticated,service_role;

do $continuation_postconditions$
declare signature text;p record;role_name text;t regclass;meta record;idx record;
begin
  foreach signature in array array['public.faolla_attendance_period_closure_command_v2(jsonb)',
    'public.faolla_attendance_period_entry_v2(public.merchant_attendance_period_entries)',
    'public.faolla_attendance_period_summary_v2(public.merchant_attendance_period_closures)',
    'public.faolla_attendance_period_storage_insert_v2()','public.faolla_attendance_period_closure_v2(jsonb,uuid,jsonb,jsonb,boolean)'] loop
    select * into p from pg_proc where oid=to_regprocedure(signature);
    if p.oid is null or p.prokind<>'f' or p.proretset or p.proargmodes is not null or p.proparallel<>'u'
      or p.proowner<>(select oid from pg_roles where rolname=current_user) or p.proconfig is distinct from array['search_path=pg_catalog']
      or p.prosecdef<>(p.proname in('faolla_attendance_period_storage_insert_v2','faolla_attendance_period_closure_v2')) then
      raise exception 'merchant_attendance_period_continuation_function_conflict';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,p.oid,'EXECUTE') is distinct from
        (role_name='service_role' and p.proname='faolla_attendance_period_closure_v2') then
        raise exception 'merchant_attendance_period_continuation_permission_conflict';end if;
    end loop;
    if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
      and not(a.grantee=(select oid from pg_roles where rolname='service_role') and p.proname='faolla_attendance_period_closure_v2')) then
      raise exception 'merchant_attendance_period_continuation_permission_conflict';end if;
  end loop;
  foreach t in array array['public.merchant_attendance_period_storage'::regclass,'public.merchant_attendance_period_artifact_metadata'::regclass] loop
    if exists(select 1 from pg_class c where c.oid=t and (c.relkind<>'r' or not c.relrowsecurity
      or c.relowner<>(select oid from pg_roles where rolname=current_user))) or exists(select 1 from pg_policy where polrelid=t) then
      raise exception 'merchant_attendance_period_continuation_permission_conflict';end if;
    if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid=t and a.grantee<>c.relowner) then raise exception 'merchant_attendance_period_continuation_permission_conflict';end if;
  end loop;
  if (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum)
      from pg_attribute a where a.attrelid='public.merchant_attendance_period_storage'::regclass and a.attnum>0 and not a.attisdropped)
      is distinct from 'merchant_id:text:true,used_bytes:bigint:true'
    or (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum)
      from pg_attribute a where a.attrelid='public.merchant_attendance_period_artifact_metadata'::regclass and a.attnum>0 and not a.attisdropped)
      is distinct from 'merchant_id:text:true,artifact_id:uuid:true,worker_name:text:true,worker_no:text:true' then
    raise exception 'merchant_attendance_period_continuation_table_conflict';end if;
  for meta in select * from (values
    ('attendance_period_continuation_start_idx',4,5,'merchant_id,worker_id,start_at,period_id,end_at','0 0 3 3',null::text),
    ('attendance_period_continuation_sealed_idx',4,5,'merchant_id,worker_id,start_at,period_id,end_at','0 0 3 3','sealed'),
    ('attendance_period_continuation_dates_idx',6,6,'merchant_id,worker_id,from_date,through_date,opened_at,period_id','0 0 0 0 3 3',null::text)) expected(index_name,key_count,attribute_count,attributes,options,predicate) loop
    select i.*,c.relkind,c.relnamespace,c.relowner,am.amname into idx from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
      where i.indexrelid=to_regclass('public.'||meta.index_name);
    if idx.indexrelid is null or idx.indrelid<>'public.merchant_attendance_period_closures'::regclass or idx.relkind<>'i'
      or idx.relowner<>(select oid from pg_roles where rolname=current_user) or idx.amname<>'btree'
      or not idx.indisvalid or not idx.indisready or not idx.indislive or idx.indisunique or idx.indisprimary or idx.indisexclusion
      or idx.indnkeyatts<>meta.key_count or idx.indnatts<>meta.attribute_count or idx.indexprs is not null
      or idx.indoption::text is distinct from meta.options or pg_get_expr(idx.indpred,idx.indrelid,true) is distinct from meta.predicate
      or (select string_agg(a.attname,',' order by keys.ordinality) from unnest(idx.indkey::smallint[]) with ordinality keys(attnum,ordinality)
        join pg_attribute a on a.attrelid=idx.indrelid and a.attnum=keys.attnum) is distinct from meta.attributes then
      raise exception 'merchant_attendance_period_continuation_index_conflict';end if;
  end loop;
  for meta in select * from (values
    ('public.merchant_attendance_period_artifacts'::regclass,'attendance_period_storage_insert','public.faolla_attendance_period_storage_insert_v2()'::regprocedure,5),
    ('public.merchant_attendance_period_artifact_metadata'::regclass,'attendance_period_metadata_immutable','public.faolla_attendance_events_append_only_v1()'::regprocedure,27),
    ('public.merchant_attendance_period_artifact_metadata'::regclass,'attendance_period_metadata_no_truncate','public.faolla_attendance_events_append_only_v1()'::regprocedure,34)) expected(table_id,trigger_name,function_id,type_bits) loop
    if not exists(select 1 from pg_trigger g where g.tgrelid=meta.table_id and g.tgname=meta.trigger_name and g.tgfoid=meta.function_id
      and g.tgtype=meta.type_bits and not g.tgisinternal and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null) then
      raise exception 'merchant_attendance_period_continuation_trigger_conflict';end if;
  end loop;
  if (select count(*) from pg_constraint where convalidated and contype='c' and
    (conrelid='public.merchant_attendance_period_closures'::regclass and conname in('attendance_period_continuation_head_numbers','attendance_period_continuation_terminal_open')
    or conrelid='public.merchant_attendance_period_versions'::regclass and conname='attendance_period_continuation_version_numbers'
    or conrelid='public.merchant_attendance_period_entries'::regclass and conname in('attendance_period_continuation_entry_numbers','attendance_period_continuation_entry_command')))<>5 then
    raise exception 'merchant_attendance_period_continuation_constraint_conflict';end if;
end;
$continuation_postconditions$;

insert into public.faolla_schema_migrations(version,name) values(202610080183,'merchant_attendance_period_continuation') on conflict(version) do nothing;
commit;
