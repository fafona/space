--C23 metadata only. No expiry action, deletion, anonymization, propagation,
--backfill or modification of clocks, location summaries, periods or wages.
begin;
set local lock_timeout='3s';
do $retention_prerequisites$
declare installed boolean;n text;p record;r text;dependency record;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_retention_prerequisite_required';end if;
  for dependency in select * from (values (202609290061::bigint,'merchant_attendance_foundation'),(202609300072::bigint,'merchant_attendance_location_clock'),
    (202610040135::bigint,'merchant_attendance_shift_rule_binding_reader'),(202610050149::bigint,'merchant_attendance_period_closure')) d(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then raise exception 'merchant_attendance_retention_prerequisite_required';end if;
  end loop;
  foreach n in array array['merchants','merchant_attendance_settings','merchant_attendance_events','merchant_attendance_location_results',
    'merchant_attendance_period_artifacts','merchant_attendance_period_closures','merchant_attendance_period_versions','merchant_attendance_period_entries'] loop
    if to_regclass('public.'||n) is null then raise exception 'merchant_attendance_retention_prerequisite_required';end if;
  end loop;
  foreach n in array array['public.faolla_attendance_period_artifact_checked_v1(public.merchant_attendance_period_artifacts)',
    'public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])','public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)',
    'public.faolla_attendance_group_text_v1(text,integer,integer)','public.faolla_attendance_events_append_only_v1()'] loop
    if to_regprocedure(n) is null then raise exception 'merchant_attendance_retention_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610070182 and name='merchant_attendance_retention') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610070182 and name<>'merchant_attendance_retention') then raise exception 'merchant_attendance_retention_installation_conflict';end if;
  foreach n in array array['merchant_attendance_retention_policy_operations','merchant_attendance_preservation_operations'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_retention_installation_conflict';end if;
    if installed and exists(select 1 from pg_class c where c.oid=to_regclass('public.'||n) and
      (c.relkind<>'r' or not c.relrowsecurity or c.relowner<>(select oid from pg_roles where rolname=current_user)
        or exists(select 1 from pg_policy where polrelid=c.oid)
        or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner))) then raise exception 'merchant_attendance_retention_permission_conflict';end if;
  end loop;
  foreach n in array array['faolla_attendance_retention_command_v1','faolla_attendance_retention_hash_v1','faolla_attendance_retention_source_v1',
    'faolla_attendance_retention_receipt_v1','faolla_attendance_retention_policy_v1','faolla_attendance_retention_record_v1',
    'faolla_attendance_retention_guard_v1','faolla_attendance_retention_v1'] loop
    if (select count(*) from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n)<>(case when installed then 1 else 0 end) then raise exception 'merchant_attendance_retention_installation_conflict';end if;
    if installed then
      select * into p from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n;
      if p.prokind<>'f' or p.proretset or p.proargmodes is not null or p.proparallel<>'u'
        or p.proowner<>(select oid from pg_roles where rolname=current_user)
        or p.prosecdef<>(n in('faolla_attendance_retention_v1','faolla_attendance_retention_guard_v1'))
        or p.proconfig is distinct from (case when n='faolla_attendance_retention_source_v1' then array['search_path=pg_catalog','extra_float_digits=3'] else array['search_path=pg_catalog'] end)::text[] then raise exception 'merchant_attendance_retention_function_conflict';end if;
      foreach r in array array['anon','authenticated','service_role'] loop
        if has_function_privilege(r,p.oid,'EXECUTE') is distinct from (r='service_role' and n='faolla_attendance_retention_v1') then raise exception 'merchant_attendance_retention_permission_conflict';end if;
      end loop;
      if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
        and not(a.grantee=(select oid from pg_roles where rolname='service_role') and n='faolla_attendance_retention_v1')) then raise exception 'merchant_attendance_retention_permission_conflict';end if;
    end if;
  end loop;
end;
$retention_prerequisites$;

create or replace function public.faolla_attendance_retention_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p is null or octet_length(convert_to(p::text,'UTF8'))>8192
    or jsonb_typeof(p->'action') is distinct from 'string' or p->>'action' not in('set_policy','hold','release')
    or public.faolla_attendance_shift_rule_binding_object_v1(p,(case when p->>'action'='set_policy' then
      array['siteId','action','operationId','category','expectedRevision','retentionDays','reason'] else
      array['siteId','action','operationId','category','recordId','expectedRevision','expectedSourceFingerprint','reason'] end)) is distinct from true
    or jsonb_typeof(p->'siteId') is distinct from 'string' or p->>'siteId'!~'^[0-9]{8}$'
    or jsonb_typeof(p->'category') is distinct from 'string' or p->>'category' not in('events','location_results','period_artifact')
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedRevision','head') is distinct from true or (p->>'expectedRevision')::numeric>=9007199254740990
    or (p->>'action'='release' and (p->>'expectedRevision')::numeric=0)
    or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,500) is distinct from true then return false;end if;
  if p->>'action'='set_policy' then
    return p->'retentionDays'='null'::jsonb or (public.faolla_attendance_shift_rule_binding_scalar_v1(p->'retentionDays','version') is true and (p->>'retentionDays')::numeric<=36500);
  end if;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(p->'recordId','uuid') is true
    and jsonb_typeof(p->'expectedSourceFingerprint')='string' and p->>'expectedSourceFingerprint'~'^[0-9a-f]{64}$';
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
create or replace function public.faolla_attendance_retention_hash_v1(p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
  select encode(sha256(convert_to('['||string_agg(value::text,',' order by ordinal)||']','UTF8')),'hex')
  from jsonb_array_elements(jsonb_build_array('attendance-retention-command-v1',p->'siteId',p->'action',p->'category',
    coalesce(p->'recordId','null'::jsonb),p->'operationId',p->'expectedRevision',coalesce(p->'retentionDays','null'::jsonb),
    coalesce(p->'expectedSourceFingerprint','null'::jsonb),p->'reason')) with ordinality a(value,ordinal);
$$;

create table if not exists public.merchant_attendance_retention_policy_operations(
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),category text not null check(category in('events','location_results','period_artifact')),
  operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),actor_auth_user_id uuid not null,
  retention_days integer check(retention_days between 1 and 36500),command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),primary key(merchant_id,operation_id),unique(merchant_id,category,revision),
  check((public.faolla_attendance_retention_command_v1(command) is true and command->>'action'='set_policy'
    and command->>'siteId'=merchant_id and command->>'category'=category and command->>'operationId'=operation_id::text
    and (command->>'expectedRevision')::bigint=revision-1 and command->'retentionDays'=coalesce(to_jsonb(retention_days),'null'::jsonb)
    and command_fingerprint=public.faolla_attendance_retention_hash_v1(command)) is true)
);
create table if not exists public.merchant_attendance_preservation_operations(
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),category text not null check(category in('events','location_results','period_artifact')),
  record_id uuid not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),actor_auth_user_id uuid not null,
  action text not null check(action in('hold','release')),command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
  source_snapshot jsonb not null,source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,category,record_id,revision),
  check((public.faolla_attendance_retention_command_v1(command) is true and command->>'action'=action
    and command->>'siteId'=merchant_id and command->>'category'=category and command->>'recordId'=record_id::text and command->>'operationId'=operation_id::text
    and (command->>'expectedRevision')::bigint=revision-1 and command->>'expectedSourceFingerprint'=source_fingerprint
    and command_fingerprint=public.faolla_attendance_retention_hash_v1(command)) is true),
  check((public.faolla_attendance_shift_rule_binding_object_v1(source_snapshot,array['siteId','category','recordId','source']) is true
    and source_snapshot->>'siteId'=merchant_id and source_snapshot->>'category'=category and source_snapshot->>'recordId'=record_id::text
    and octet_length(convert_to(source_snapshot::text,'UTF8'))<=8192 and source_fingerprint=encode(sha256(convert_to(source_snapshot::text,'UTF8')),'hex')) is true)
);
alter table public.merchant_attendance_retention_policy_operations enable row level security;
alter table public.merchant_attendance_preservation_operations enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_retention_policy_operations'::regclass,
      'public.merchant_attendance_preservation_operations'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_retention_policy_operations,public.merchant_attendance_preservation_operations from public,anon,authenticated,service_role;

--Historical record identity only. Never reconstruct old Auth from a current
--worker binding, or require that a former employee is still active.
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
    --An artifact may be legitimately reused by several versions. Validate the
    --fixed references without depending on today's current version or source.
    for version_row in select v.*,e.action,e.command,e.version as entry_version,e.recorded_at as entry_recorded_at from public.merchant_attendance_period_versions v
      left join public.merchant_attendance_period_entries e on e.merchant_id=v.merchant_id and e.period_id=v.period_id and e.operation_id=v.operation_id
      where v.merchant_id=p_site and v.period_id=ar.period_id and v.artifact_id=ar.artifact_id order by v.version limit 21 loop
      n:=n+1;
      if n>20 or version_row.action is distinct from 'send' or version_row.entry_version is distinct from version_row.version or version_row.recorded_at<ar.recorded_at
        or version_row.entry_recorded_at is distinct from version_row.recorded_at
        or version_row.command->>'periodId' is distinct from ar.period_id::text
        or version_row.command->>'operationId' is distinct from version_row.operation_id::text
        or version_row.command->>'expectedFingerprint' is distinct from ar.source_fingerprint then raise exception 'attendance_retention_invalid';end if;
    end loop;
    if n=0 or not exists(select 1 from public.merchant_attendance_period_entries e where e.merchant_id=p_site and e.period_id=ar.period_id
      and e.operation_id=ar.artifact_id and e.action='send' and e.recorded_at=ar.recorded_at) then raise exception 'attendance_retention_invalid';end if;
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

--Receipt validation does not recollect the source or consult current policy.
create or replace function public.faolla_attendance_retention_receipt_v1(p_command jsonb,p_actor uuid,p_revision bigint,p_fingerprint text,p_recorded timestamptz)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
begin
  if public.faolla_attendance_retention_command_v1(p_command) is distinct from true or p_actor is null
    or p_revision is null or p_revision not between 1 and 9007199254740990 or p_revision<>(p_command->>'expectedRevision')::bigint+1
    or p_fingerprint is distinct from public.faolla_attendance_retention_hash_v1(p_command) or p_recorded is null or not isfinite(p_recorded) then raise exception 'attendance_retention_invalid';end if;
  return jsonb_build_object('operationId',p_command->'operationId','actorId',p_actor,'revision',p_revision,'command',p_command,
    'commandFingerprint',p_fingerprint,'recordedAt',to_char(p_recorded at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
create or replace function public.faolla_attendance_retention_policy_v1(p_site text,p_category text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare p public.merchant_attendance_retention_policy_operations%rowtype;
begin
  select * into p from public.merchant_attendance_retention_policy_operations where merchant_id=p_site and category=p_category order by revision desc limit 1;
  if p.operation_id is not null then perform public.faolla_attendance_retention_receipt_v1(p.command,p.actor_auth_user_id,p.revision,p.command_fingerprint,p.recorded_at);end if;
  return jsonb_build_object('category',p_category,'revision',coalesce(p.revision,0),'retentionDays',p.retention_days,'operationId',p.operation_id,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
create or replace function public.faolla_attendance_retention_record_v1(p_site text,p_category text,p_record uuid,p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare src jsonb;canonical jsonb;policy jsonb;pres public.merchant_attendance_preservation_operations%rowtype;anchor timestamptz;due_at timestamptz;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_as_of is null or not isfinite(p_as_of) then raise exception 'attendance_retention_invalid';end if;
  src:=public.faolla_attendance_retention_source_v1(p_site,p_category,p_record);
  canonical:=jsonb_build_object('siteId',p_site,'category',p_category,'recordId',p_record,'source',src);
  policy:=public.faolla_attendance_retention_policy_v1(p_site,p_category);
  anchor:=(case p_category when 'events' then src->>'receivedAt' when 'location_results' then src->'event'->>'receivedAt' else src->>'recordedAt' end)::timestamptz;
  --Elapsed UTC seconds, not civil calendar days or session timezone arithmetic.
  if policy->'retentionDays'<>'null'::jsonb then due_at:=anchor+(policy->>'retentionDays')::integer*interval '86400 seconds';end if;
  if due_at is not null and public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(to_char(due_at at time zone 'UTC',fmt)),'stamp6') is distinct from true then raise exception 'attendance_retention_invalid';end if;
  select * into pres from public.merchant_attendance_preservation_operations where merchant_id=p_site and category=p_category and record_id=p_record order by revision desc limit 1;
  if pres.operation_id is not null then
    perform public.faolla_attendance_retention_receipt_v1(pres.command,pres.actor_auth_user_id,pres.revision,pres.command_fingerprint,pres.recorded_at);
    if pres.source_snapshot is distinct from canonical or pres.source_fingerprint is distinct from encode(sha256(convert_to(canonical::text,'UTF8')),'hex') then raise exception 'attendance_retention_invalid';end if;
  end if;
  return jsonb_build_object('category',p_category,'recordId',p_record,'source',src,'sourceText',canonical::text,'sourceFingerprint',encode(sha256(convert_to(canonical::text,'UTF8')),'hex'),
    'policy',policy,'anchorAt',to_char(anchor at time zone 'UTC',fmt),'asOf',to_char(p_as_of at time zone 'UTC',fmt),'dueAt',to_char(due_at at time zone 'UTC',fmt),
    'ageState',(case when due_at is null then 'unconfigured' when due_at<=p_as_of then 'due' else 'not_due' end),
    'preservation',jsonb_build_object('revision',coalesce(pres.revision,0),'held',coalesce(pres.action='hold',false),'operationId',pres.operation_id,
      'actorId',pres.actor_auth_user_id,'reason',pres.command->'reason','recordedAt',to_char(pres.recorded_at at time zone 'UTC',fmt)));
end;
$$;

create or replace function public.faolla_attendance_retention_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare previous_policy public.merchant_attendance_retention_policy_operations%rowtype;
  previous_pres public.merchant_attendance_preservation_operations%rowtype;canonical jsonb;
begin
  perform public.faolla_attendance_retention_receipt_v1(new.command,new.actor_auth_user_id,new.revision,new.command_fingerprint,new.recorded_at);
  if tg_table_name='merchant_attendance_retention_policy_operations' then
    if exists(select 1 from public.merchant_attendance_preservation_operations where merchant_id=new.merchant_id and operation_id=new.operation_id) then raise exception 'attendance_operation_conflict';end if;
    select * into previous_policy from public.merchant_attendance_retention_policy_operations where merchant_id=new.merchant_id and category=new.category and revision=new.revision-1;
    if (new.revision>1 and previous_policy.operation_id is null) or previous_policy.recorded_at>new.recorded_at
      or previous_policy.retention_days is not distinct from new.retention_days then raise exception 'attendance_retention_invalid';end if;
  elsif tg_table_name='merchant_attendance_preservation_operations' then
    if exists(select 1 from public.merchant_attendance_retention_policy_operations where merchant_id=new.merchant_id and operation_id=new.operation_id) then raise exception 'attendance_operation_conflict';end if;
    select * into previous_pres from public.merchant_attendance_preservation_operations where merchant_id=new.merchant_id and category=new.category and record_id=new.record_id and revision=new.revision-1;
    if (new.revision=1 and new.action<>'hold') or (new.revision>1 and previous_pres.operation_id is null)
      or previous_pres.recorded_at>new.recorded_at or previous_pres.action=new.action then raise exception 'attendance_retention_invalid';end if;
    canonical:=jsonb_build_object('siteId',new.merchant_id,'category',new.category,'recordId',new.record_id,
      'source',public.faolla_attendance_retention_source_v1(new.merchant_id,new.category,new.record_id));
    if canonical is distinct from new.source_snapshot or new.source_fingerprint is distinct from encode(sha256(convert_to(canonical::text,'UTF8')),'hex') then raise exception 'attendance_retention_invalid';end if;
  else raise exception 'attendance_retention_invalid';end if;
  return new;
end;
$$;
do $retention_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_retention_policy_operations'::regclass and tgname='attendance_retention_policy_immutable') then
    create trigger attendance_retention_policy_immutable before update or delete on public.merchant_attendance_retention_policy_operations for each row execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_retention_policy_no_truncate before truncate on public.merchant_attendance_retention_policy_operations for each statement execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_retention_policy_valid after insert on public.merchant_attendance_retention_policy_operations for each row execute function public.faolla_attendance_retention_guard_v1();
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_preservation_operations'::regclass and tgname='attendance_preservation_immutable') then
    create trigger attendance_preservation_immutable before update or delete on public.merchant_attendance_preservation_operations for each row execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_preservation_no_truncate before truncate on public.merchant_attendance_preservation_operations for each statement execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_preservation_valid after insert on public.merchant_attendance_preservation_operations for each row execute function public.faolla_attendance_retention_guard_v1();
  end if;
end;
$retention_triggers$;

create or replace function public.faolla_attendance_retention_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_site text;v_mode text;v_category text;v_record uuid;v_operation uuid;v_worker uuid;v_period uuid;before_rev bigint;
  from_at timestamptz;to_at timestamptz;read_at timestamptz;keys text[];k text;row_item record;policy_row public.merchant_attendance_retention_policy_operations%rowtype;
  pres_row public.merchant_attendance_preservation_operations%rowtype;head_rev bigint;head_days integer;head_action text;previous_at timestamptz;
  item jsonb;items jsonb:='[]';data jsonb;receipt jsonb;result jsonb;canonical jsonb;next_rev bigint;can_write boolean:=false;n integer:=0;stamp timestamptz;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or p_query->>'mode' not in('policies','record','history','recover','preview') then raise exception 'attendance_invalid_request';end if;
  v_site:=p_query->>'siteId';v_mode:=p_query->>'mode';
  keys:=array['siteId','mode']||(case v_mode when 'record' then array['category','recordId'] when 'history' then array['category','recordId','beforeRevision']
    when 'recover' then array['operationId'] when 'preview' then (case when p_query->>'category'='period_artifact' then array['category','workerId','periodId'] else array['category','workerId','fromAt','toAt'] end) else array[]::text[] end);
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,keys) is distinct from true then raise exception 'attendance_invalid_request';end if;
  if v_mode in('record','history','preview') then
    if jsonb_typeof(p_query->'category') is distinct from 'string' or p_query->>'category' not in('events','location_results','period_artifact') then raise exception 'attendance_invalid_request';end if;v_category:=p_query->>'category';
  end if;
  if v_mode in('record','history') then
    if not(v_mode='history' and p_query->'recordId'='null'::jsonb) and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'recordId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
    v_record:=(p_query->>'recordId')::uuid;
  end if;
  if v_mode='recover' then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;v_operation:=(p_query->>'operationId')::uuid;
  elsif v_mode='history' then
    if p_query->'beforeRevision'<>'null'::jsonb and (jsonb_typeof(p_query->'beforeRevision') is distinct from 'number'
      or p_query->>'beforeRevision'!~'^[1-9][0-9]{0,15}$' or (p_query->>'beforeRevision')::numeric>9007199254740991) then raise exception 'attendance_invalid_request';end if;
    before_rev:=(p_query->>'beforeRevision')::bigint;
  elsif v_mode='preview' then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;v_worker:=(p_query->>'workerId')::uuid;
    if v_category='period_artifact' then
      if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'periodId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;v_period:=(p_query->>'periodId')::uuid;
    else
      foreach k in array array['fromAt','toAt'] loop
        if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
      end loop;
      from_at:=(p_query->>'fromAt')::timestamptz;to_at:=(p_query->>'toAt')::timestamptz;
      if to_at<=from_at or to_at-from_at>interval '744 hours' then raise exception 'attendance_invalid_request';end if;
    end if;
  end if;
  if p_command is not null then
    if public.faolla_attendance_retention_command_v1(p_command) is distinct from true or p_command->>'siteId'<>v_site
      or (p_command->>'action'='set_policy' and v_mode<>'policies')
      or (p_command->>'action'<>'set_policy' and (v_mode<>'record' or p_command->>'category' is distinct from v_category or p_command->>'recordId' is distinct from v_record::text)) then raise exception 'attendance_invalid_request';end if;
    v_operation:=(p_command->>'operationId')::uuid;v_category:=p_command->>'category';
  end if;
  --Current canonical merchant owner only. A handoff permits a NEW metadata
  --action, never recovery in the name of a previous owner's operation.
  perform 1 from public.merchants where id=v_site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=v_site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  --Shared settings lock serializes the two operation namespaces and every CAS.
  --Saved recovery precedes rollout, source collection, current policy and CAS.
  if v_operation is not null then
    select * into policy_row from public.merchant_attendance_retention_policy_operations where merchant_id=v_site and operation_id=v_operation;
    select * into pres_row from public.merchant_attendance_preservation_operations where merchant_id=v_site and operation_id=v_operation;
    if policy_row.operation_id is not null and pres_row.operation_id is not null then raise exception 'attendance_retention_invalid';end if;
    if policy_row.operation_id is not null then
      if policy_row.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and policy_row.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      receipt:=public.faolla_attendance_retention_receipt_v1(policy_row.command,policy_row.actor_auth_user_id,policy_row.revision,policy_row.command_fingerprint,policy_row.recorded_at);
    elsif pres_row.operation_id is not null then
      if pres_row.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and pres_row.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      receipt:=public.faolla_attendance_retention_receipt_v1(pres_row.command,pres_row.actor_auth_user_id,pres_row.revision,pres_row.command_fingerprint,pres_row.recorded_at);
    end if;
  end if;
  if receipt is not null or v_mode='recover' then data:=jsonb_build_object('kind','receipt');
  elsif p_command is not null then
    if not p_allow_write then raise exception 'attendance_retention_disabled';end if;
    if p_command->>'action'='set_policy' then
      select * into policy_row from public.merchant_attendance_retention_policy_operations where merchant_id=v_site and category=v_category order by revision desc limit 1;
      head_rev:=coalesce(policy_row.revision,0);head_days:=policy_row.retention_days;previous_at:=policy_row.recorded_at;
      if head_rev<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_retention_changed';end if;
      if head_days is not distinct from (p_command->>'retentionDays')::integer then raise exception 'attendance_retention_unchanged';end if;
      stamp:=clock_timestamp();if previous_at>stamp then raise exception 'attendance_retention_invalid';end if;
      insert into public.merchant_attendance_retention_policy_operations(merchant_id,category,operation_id,revision,actor_auth_user_id,retention_days,command,command_fingerprint,recorded_at)
        values(v_site,v_category,v_operation,head_rev+1,p_auth_user_id,(p_command->>'retentionDays')::integer,p_command,public.faolla_attendance_retention_hash_v1(p_command),stamp) returning * into policy_row;
      receipt:=public.faolla_attendance_retention_receipt_v1(policy_row.command,policy_row.actor_auth_user_id,policy_row.revision,policy_row.command_fingerprint,policy_row.recorded_at);
    else
      select * into pres_row from public.merchant_attendance_preservation_operations where merchant_id=v_site and category=v_category and record_id=v_record order by revision desc limit 1;
      head_rev:=coalesce(pres_row.revision,0);head_action:=pres_row.action;previous_at:=pres_row.recorded_at;
      if head_rev<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_retention_changed';end if;
      if coalesce(head_action,'release')=p_command->>'action' then raise exception 'attendance_retention_unchanged';end if;
      canonical:=jsonb_build_object('siteId',v_site,'category',v_category,'recordId',v_record,'source',public.faolla_attendance_retention_source_v1(v_site,v_category,v_record));
      if p_command->>'expectedSourceFingerprint' is distinct from encode(sha256(convert_to(canonical::text,'UTF8')),'hex') then raise exception 'attendance_retention_changed';end if;
      stamp:=clock_timestamp();if previous_at>stamp then raise exception 'attendance_retention_invalid';end if;
      insert into public.merchant_attendance_preservation_operations(merchant_id,category,record_id,operation_id,revision,actor_auth_user_id,action,command,command_fingerprint,source_snapshot,source_fingerprint,recorded_at)
        values(v_site,v_category,v_record,v_operation,head_rev+1,p_auth_user_id,p_command->>'action',p_command,public.faolla_attendance_retention_hash_v1(p_command),canonical,p_command->>'expectedSourceFingerprint',stamp) returning * into pres_row;
      receipt:=public.faolla_attendance_retention_receipt_v1(pres_row.command,pres_row.actor_auth_user_id,pres_row.revision,pres_row.command_fingerprint,pres_row.recorded_at);
    end if;
    data:=jsonb_build_object('kind','receipt');
  else
    read_at:=clock_timestamp();
    if v_mode='policies' then
      foreach k in array array['events','location_results','period_artifact'] loop items:=items||jsonb_build_array(public.faolla_attendance_retention_policy_v1(v_site,k));end loop;
      data:=jsonb_build_object('kind','policies','items',items);can_write:=p_allow_write;
    elsif v_mode='record' then
      item:=public.faolla_attendance_retention_record_v1(v_site,v_category,v_record,read_at);data:=jsonb_build_object('kind','record','item',item);can_write:=p_allow_write;
    elsif v_mode='history' then
      if v_record is null then
        for policy_row in select * from public.merchant_attendance_retention_policy_operations where merchant_id=v_site and category=v_category
          and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
          n:=n+1;if n>25 then next_rev:=(items->-1->>'revision')::bigint;exit;end if;
          items:=items||jsonb_build_array(public.faolla_attendance_retention_receipt_v1(policy_row.command,policy_row.actor_auth_user_id,policy_row.revision,policy_row.command_fingerprint,policy_row.recorded_at));
        end loop;
      else
        for pres_row in select * from public.merchant_attendance_preservation_operations where merchant_id=v_site and category=v_category and record_id=v_record
          and (before_rev is null or revision<before_rev) order by revision desc limit 26 loop
          n:=n+1;if n>25 then next_rev:=(items->-1->>'revision')::bigint;exit;end if;
          items:=items||jsonb_build_array(public.faolla_attendance_retention_receipt_v1(pres_row.command,pres_row.actor_auth_user_id,pres_row.revision,pres_row.command_fingerprint,pres_row.recorded_at));
        end loop;
      end if;
      data:=jsonb_build_object('kind','history','items',items,'nextBeforeRevision',next_rev);
    else
      --Use saved worker keys only; inactive/rebound workers are not filtered.
      --Probe 101 BEFORE projecting records, so no partial list is returned.
      if v_category='period_artifact' then
        for row_item in select a.artifact_id as id from public.merchant_attendance_period_artifacts a
          join public.merchant_attendance_period_closures c on c.merchant_id=a.merchant_id and c.period_id=a.period_id
          where a.merchant_id=v_site and a.period_id=v_period and c.worker_id=v_worker order by a.recorded_at desc,a.artifact_id desc limit 101 loop
          n:=n+1;if n>100 then raise exception 'attendance_retention_too_large';end if;items:=items||to_jsonb(row_item.id);
        end loop;
      else
        for row_item in select e.id from public.merchant_attendance_events e where e.merchant_id=v_site and e.worker_id=v_worker and e.occurred_at>=from_at and e.occurred_at<to_at
          and (v_category='events' or exists(select 1 from public.merchant_attendance_location_results l where l.event_id=e.id))
          order by e.occurred_at desc,e.id desc limit 101 loop
          n:=n+1;if n>100 then raise exception 'attendance_retention_too_large';end if;items:=items||to_jsonb(row_item.id);
        end loop;
      end if;
      data:='[]';for row_item in select value#>>'{}' as id from jsonb_array_elements(items) loop
        data:=data||jsonb_build_array(public.faolla_attendance_retention_record_v1(v_site,v_category,row_item.id::uuid,read_at));
        if octet_length(convert_to(data::text,'UTF8'))>131072 then raise exception 'attendance_retention_too_large';end if;
      end loop;
      data:=jsonb_build_object('kind','preview','asOf',to_char(read_at at time zone 'UTC',fmt),'items',data);
    end if;
  end if;
  read_at:=coalesce(read_at,clock_timestamp());
  result:=jsonb_build_object('protocol','attendance-retention-v1','siteId',v_site,'actorId',p_auth_user_id,'readAt',to_char(read_at at time zone 'UTC',fmt),
    'canWrite',can_write,'data',data,'receipt',receipt,'disposition','preview_only');
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_retention_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_retention_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_retention_hash_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_retention_source_v1(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_retention_receipt_v1(jsonb,uuid,bigint,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_retention_policy_v1(text,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_retention_record_v1(text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_retention_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_retention_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_retention_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $retention_permissions$
declare p record;f record;r text;priv text;t regclass;prefix text;
begin
  for f in select * from (values
    ('faolla_attendance_retention_command_v1','jsonb','boolean',array['p'],'i',0,false,'plpgsql'),
    ('faolla_attendance_retention_hash_v1','jsonb','text',array['p'],'i',0,false,'sql'),
    ('faolla_attendance_retention_source_v1','text,text,uuid','jsonb',array['p_site','p_category','p_record'],'s',0,false,'plpgsql'),
    ('faolla_attendance_retention_receipt_v1','jsonb,uuid,bigint,text,timestamptz','jsonb',array['p_command','p_actor','p_revision','p_fingerprint','p_recorded'],'i',0,false,'plpgsql'),
    ('faolla_attendance_retention_policy_v1','text,text','jsonb',array['p_site','p_category'],'s',0,false,'plpgsql'),
    ('faolla_attendance_retention_record_v1','text,text,uuid,timestamptz','jsonb',array['p_site','p_category','p_record','p_as_of'],'s',0,false,'plpgsql'),
    ('faolla_attendance_retention_guard_v1','','trigger',null::text[],'v',0,true,'plpgsql'),
    ('faolla_attendance_retention_v1','jsonb,uuid,jsonb,boolean','jsonb',array['p_query','p_auth_user_id','p_command','p_allow_write'],'v',2,true,'plpgsql')) a(name,args,return_type,names,volatility,defaults,definer,language_name) loop
    select x.*,l.lanname into p from pg_proc x join pg_language l on l.oid=x.prolang where x.oid=to_regprocedure('public.'||f.name||'('||f.args||')');
    if p.oid is null or p.prokind<>'f' or p.proretset or p.proargmodes is not null or p.proparallel<>'u' or p.lanname<>f.language_name or p.provolatile::text<>f.volatility
      or p.proowner<>(select oid from pg_roles where rolname=current_user) or p.prosecdef<>f.definer
      or p.proconfig is distinct from (case when f.name='faolla_attendance_retention_source_v1' then array['search_path=pg_catalog','extra_float_digits=3'] else array['search_path=pg_catalog'] end)::text[]
      or p.proargnames is distinct from f.names or p.pronargs<>coalesce(cardinality(f.names),0) or p.pronargdefaults<>f.defaults or p.prorettype<>f.return_type::regtype
      or (select count(*) from pg_proc x where x.pronamespace=p.pronamespace and x.proname=p.proname)<>1 then raise exception 'merchant_attendance_retention_function_conflict';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p.oid,'EXECUTE') is distinct from (r='service_role' and f.name='faolla_attendance_retention_v1') then raise exception 'merchant_attendance_retention_permission_conflict';end if;
    end loop;
    if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
      and not(a.grantee=(select oid from pg_roles where rolname='service_role') and f.name='faolla_attendance_retention_v1')) then raise exception 'merchant_attendance_retention_permission_conflict';end if;
  end loop;
  foreach t in array array['public.merchant_attendance_retention_policy_operations'::regclass,'public.merchant_attendance_preservation_operations'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
      or (select relowner from pg_class where oid=t)<>(select oid from pg_roles where rolname=current_user)
      or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and a.grantee<>c.relowner) then raise exception 'merchant_attendance_retention_permission_conflict';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      for priv in select a.privilege_type from pg_class c cross join lateral aclexplode(acldefault('r',c.relowner)) a where c.oid=t loop
        if has_table_privilege(r,t,priv) then raise exception 'merchant_attendance_retention_permission_conflict';end if;
      end loop;
    end loop;
    prefix:=(case when t='public.merchant_attendance_retention_policy_operations'::regclass then 'attendance_retention_policy_' else 'attendance_preservation_' end);
    if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3 or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal and tgenabled='O' and (
      (tgname=prefix||'immutable' and tgtype=27 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
      or (tgname=prefix||'no_truncate' and tgtype=34 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
      or (tgname=prefix||'valid' and tgtype=5 and tgfoid='public.faolla_attendance_retention_guard_v1()'::regprocedure)))<>3 then raise exception 'merchant_attendance_retention_installation_conflict';end if;
  end loop;
end;
$retention_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610070182,'merchant_attendance_retention') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
