-- Independent single-worker period versions, review/dispute, seal and reopen.
-- Immutable artifact bytes are archival evidence, not a current-tzdata replay.
-- No old facts, global correction locks, deadlines or clock writers are changed.
begin;
set local lock_timeout='3s';
do $period_closure_prerequisites$
declare installed boolean;t text;p text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050148 and name='merchant_attendance_period_source')
    or to_regprocedure('public.faolla_attendance_period_source_v1(jsonb,uuid)') is null
    or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null
    or to_regprocedure('public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])') is null then
    raise exception 'merchant_attendance_period_closure_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050149 and name='merchant_attendance_period_closure') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050149 and name<>'merchant_attendance_period_closure') then
    raise exception 'merchant_attendance_period_closure_installation_conflict';end if;
  foreach t in array array['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_period_closure_installation_conflict';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_period_closure_command_v1(jsonb)',
    'public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_period_closure_installation_conflict';end if;
  end loop;
  foreach p in array array['faolla_attendance_period_artifact_checked_v1','faolla_attendance_period_entry_v1','faolla_attendance_period_summary_v1'] loop
    if installed<>exists(select 1 from pg_proc where proname=p and pronamespace=(select pronamespace from pg_proc
      where oid=to_regprocedure('public.faolla_attendance_period_source_v1(jsonb,uuid)'))) then
      raise exception 'merchant_attendance_period_closure_installation_conflict';end if;
  end loop;
end;
$period_closure_prerequisites$;

create or replace function public.faolla_attendance_period_closure_command_v1(p jsonb)
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
    if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)!~'^(0|[1-9][0-9]{0,2})$' then return false;end if;
  end loop;
  if (p->>'expectedRevision')::integer>100 or (p->>'expectedVersion')::integer>20
    or action_name<>'send' and ((p->>'expectedRevision')::integer=0 or (p->>'expectedVersion')::integer=0)
    or jsonb_typeof(p->'reason') is distinct from 'string' or p->>'reason'<>btrim(p->>'reason')
    or char_length(p->>'reason')>500 or p->>'reason'~'[[:cntrl:]]'
    or action_name not in('send','confirm') and char_length(p->>'reason')=0 then return false;end if;
  if p->'expectedFingerprint'='null'::jsonb then return action_name not in('send','confirm','seal');end if;
  return jsonb_typeof(p->'expectedFingerprint')='string' and length(p->>'expectedFingerprint')=64 and p->>'expectedFingerprint'~'^[0-9a-f]{64}$';
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create table if not exists public.merchant_attendance_period_closures (
  merchant_id text not null,period_id uuid not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
  from_date date not null,through_date date not null,time_zone text not null,start_at timestamptz not null,end_at timestamptz not null,
  revision integer not null,current_version integer not null,state text not null,sealed boolean not null,
  confirmed_version integer,unresolved_dispute boolean not null,opened_at timestamptz not null,updated_at timestamptz not null,
  primary key(merchant_id,period_id),
  check(merchant_id~'^[0-9]{8}$' and length(merchant_id)=8),
  check(from_date>=date '2000-01-01' and through_date<=date '2100-12-31' and through_date-from_date between 0 and 30),
  check(isfinite(start_at) and isfinite(end_at) and start_at<end_at and isfinite(opened_at) and updated_at>=opened_at),
  check(revision between 1 and 100 and current_version between 1 and 20),
  check(state in('open','review','confirmed','disputed','sealed') and sealed=(state='sealed')),
  check(confirmed_version is null or confirmed_version between 1 and current_version),
  check(not sealed or confirmed_version is not null and confirmed_version=current_version),
  -- Revision100 is reserved exclusively for reopening, never a permanent seal.
  check(not sealed or revision<100)
);
create index if not exists attendance_period_closure_worker_idx on public.merchant_attendance_period_closures(merchant_id,worker_id,start_at,end_at);
create table if not exists public.merchant_attendance_period_artifacts (
  merchant_id text not null,period_id uuid not null,artifact_id uuid not null,source_fingerprint text not null,
  artifact_text text not null,artifact_sha256 text not null,artifact_bytes integer not null,recorded_at timestamptz not null,
  primary key(merchant_id,artifact_id),unique(merchant_id,period_id,artifact_id),unique(merchant_id,period_id,source_fingerprint),
  foreign key(merchant_id,period_id) references public.merchant_attendance_period_closures(merchant_id,period_id),
  check(source_fingerprint~'^[0-9a-f]{64}$' and artifact_sha256~'^[0-9a-f]{64}$'),
  check(jsonb_typeof(artifact_text::jsonb)='object' and artifact_bytes between 1 and 2097152
    and artifact_bytes=octet_length(convert_to(artifact_text,'UTF8')) and artifact_sha256=encode(sha256(convert_to(artifact_text,'UTF8')),'hex')),
  check(isfinite(recorded_at))
);
create table if not exists public.merchant_attendance_period_versions (
  merchant_id text not null,period_id uuid not null,version integer not null,artifact_id uuid not null,operation_id uuid not null,recorded_at timestamptz not null,
  primary key(merchant_id,period_id,version),unique(merchant_id,operation_id),
  foreign key(merchant_id,period_id,artifact_id) references public.merchant_attendance_period_artifacts(merchant_id,period_id,artifact_id),
  check(version between 1 and 20 and isfinite(recorded_at))
);
create table if not exists public.merchant_attendance_period_entries (
  merchant_id text not null,period_id uuid not null,operation_id uuid not null,revision integer not null,version integer not null,
  actor_auth_user_id uuid not null,action text not null,command jsonb not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,period_id,revision),
  foreign key(merchant_id,period_id,version) references public.merchant_attendance_period_versions(merchant_id,period_id,version),
  check(revision between 1 and 100 and version between 1 and 20 and isfinite(recorded_at)),
  check(public.faolla_attendance_period_closure_command_v1(command) is true
    and action=command->>'action' and operation_id=(command->>'operationId')::uuid and period_id=(command->>'periodId')::uuid
    and revision=(command->>'expectedRevision')::integer+1)
);
do $period_closure_storage$
declare t regclass;
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_period_closures'::regclass and conname='attendance_period_head_entry_fk') then
    alter table public.merchant_attendance_period_closures add constraint attendance_period_head_entry_fk
      foreign key(merchant_id,period_id,revision) references public.merchant_attendance_period_entries(merchant_id,period_id,revision) deferrable initially deferred;
    alter table public.merchant_attendance_period_closures add constraint attendance_period_current_version_fk
      foreign key(merchant_id,period_id,current_version) references public.merchant_attendance_period_versions(merchant_id,period_id,version) deferrable initially deferred;
    alter table public.merchant_attendance_period_versions add constraint attendance_period_version_entry_fk
      foreign key(merchant_id,operation_id) references public.merchant_attendance_period_entries(merchant_id,operation_id) deferrable initially deferred;
    alter table public.merchant_attendance_period_artifacts add constraint attendance_period_artifact_entry_fk
      foreign key(merchant_id,artifact_id) references public.merchant_attendance_period_entries(merchant_id,operation_id) deferrable initially deferred;
  end if;
  foreach t in array array['public.merchant_attendance_period_closures'::regclass,'public.merchant_attendance_period_artifacts'::regclass,
    'public.merchant_attendance_period_versions'::regclass,'public.merchant_attendance_period_entries'::regclass] loop
    -- The concrete statements below keep schema-owned fixture transformation safe.
    if exists(select 1 from pg_policy where polrelid=t) then raise exception 'merchant_attendance_period_closure_installation_conflict';end if;
  end loop;
end;
$period_closure_storage$;
alter table public.merchant_attendance_period_closures enable row level security;
alter table public.merchant_attendance_period_artifacts enable row level security;
alter table public.merchant_attendance_period_versions enable row level security;
alter table public.merchant_attendance_period_entries enable row level security;
revoke all on public.merchant_attendance_period_closures,public.merchant_attendance_period_artifacts,public.merchant_attendance_period_versions,public.merchant_attendance_period_entries from public,anon,authenticated,service_role;
do $period_closure_immutable$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_period_artifacts'::regclass and tgname='attendance_period_artifact_immutable') then
    create trigger attendance_period_artifact_immutable before update or delete on public.merchant_attendance_period_artifacts for each row execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_period_artifact_no_truncate before truncate on public.merchant_attendance_period_artifacts for each statement execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_period_version_immutable before update or delete on public.merchant_attendance_period_versions for each row execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_period_version_no_truncate before truncate on public.merchant_attendance_period_versions for each statement execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_period_entry_immutable before update or delete on public.merchant_attendance_period_entries for each row execute function public.faolla_attendance_events_append_only_v1();
    create trigger attendance_period_entry_no_truncate before truncate on public.merchant_attendance_period_entries for each statement execute function public.faolla_attendance_events_append_only_v1();
  end if;
end;
$period_closure_immutable$;

create or replace function public.faolla_attendance_period_artifact_checked_v1(p public.merchant_attendance_period_artifacts)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=p.artifact_text::jsonb;
begin
  if p.artifact_id is null or p.artifact_text is null or p.artifact_bytes not between 1 and 2097152
    or p.artifact_bytes is distinct from octet_length(convert_to(p.artifact_text,'UTF8'))
    or p.artifact_sha256 is distinct from encode(sha256(convert_to(p.artifact_text,'UTF8')),'hex')
    or public.faolla_attendance_shift_rule_binding_object_v1(a,array['protocol','sourceFingerprint','source','worker','period','report','dayBoundaries','calculationVersion']) is distinct from true
    or a->>'protocol' is distinct from 'attendance-period-artifact-v1' or a->>'calculationVersion' is distinct from 'timesheet-v2-unified-v1'
    or a->>'sourceFingerprint' is distinct from p.source_fingerprint
    or public.faolla_attendance_shift_rule_binding_object_v1(a->'worker',array['workerId','employeeId','employeeAuthUserId','workerName','workerNo']) is distinct from true
    or public.faolla_attendance_shift_rule_binding_object_v1(a->'period',array['fromDate','throughDate','timeZone','startAt','endAt']) is distinct from true
    or jsonb_typeof(a->'source') is distinct from 'object' or jsonb_typeof(a->'report') is distinct from 'object'
    or jsonb_typeof(a->'dayBoundaries') is distinct from 'array'
    or a->'report'->>'version' is distinct from 'attendance-unified-v1' or a->'report'->'complete' is distinct from 'true'::jsonb
    or a->'report'->'payrollReady' is distinct from 'false'::jsonb or a->'report'->>'access' is distinct from 'owner'
    or a->'report'->'base'->>'calculationVersion' is distinct from 'attendance-timesheet-v1' then raise exception 'attendance_period_closure_invalid';end if;
  -- Saved bytes are checked directly, never regenerated from JSONB or tzdata.
  return a;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_period_closure_invalid';
end;
$$;
create or replace function public.faolla_attendance_period_entry_v1(p public.merchant_attendance_period_entries)
returns jsonb language plpgsql set search_path=pg_catalog as $$
begin
  if p.operation_id is null then return null;end if;
  if public.faolla_attendance_period_closure_command_v1(p.command) is distinct from true
    or p.operation_id::text is distinct from p.command->>'operationId' or p.period_id::text is distinct from p.command->>'periodId'
    or p.action is distinct from p.command->>'action' or p.revision<>(p.command->>'expectedRevision')::integer+1 then raise exception 'attendance_period_closure_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'action',p.action,'version',p.version,
    'actorId',p.actor_auth_user_id,'reason',p.command->'reason','recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'command',p.command);
end;
$$;
create or replace function public.faolla_attendance_period_summary_v1(p public.merchant_attendance_period_closures,a jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p.period_id is null then return null;end if;
  if a->'worker'->>'workerId' is distinct from p.worker_id::text or a->'worker'->>'employeeId' is distinct from p.employee_id::text
    or a->'worker'->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
    or a->'period' is distinct from jsonb_build_object('fromDate',p.from_date,'throughDate',p.through_date,'timeZone',p.time_zone,
      'startAt',to_char(p.start_at at time zone 'UTC',fmt),'endAt',to_char(p.end_at at time zone 'UTC',fmt)) then raise exception 'attendance_period_closure_invalid';end if;
  return (a->'worker')||(a->'period')||jsonb_build_object('periodId',p.period_id,'revision',p.revision,'currentVersion',p.current_version,
    'state',p.state,'sealed',p.sealed,'confirmedVersion',p.confirmed_version,'unresolvedDispute',p.unresolved_dispute);
end;
$$;

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
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
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
  source_query:=jsonb_build_object('siteId',site,'access',access_name,'workerId',wid,'fromDate',first_day,'throughDate',last_day);
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

  if mode_name='list' then
    for listed in select * from public.merchant_attendance_period_closures where merchant_id=site and worker_id=wid
      and from_date=first_day and through_date=last_day order by opened_at desc,period_id desc limit 21 loop
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
    source_result:=public.faolla_attendance_period_source_v1(source_query,p_auth_user_id);
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
      source_result:=public.faolla_attendance_period_source_v1(source_query,p_auth_user_id);
      -- Only ended periods enter this workflow. Other complete-source blockers
      -- may be sent for review; sealing still requires the entire list empty.
      if source_result->'blockers' ? 'period_in_progress' then raise exception 'attendance_period_blocked';end if;
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
        if exists(select 1 from public.merchant_attendance_period_closures where merchant_id=site and worker_id=wid
          and start_at<(source_result->>'toAt')::timestamptz and end_at>(source_result->>'fromAt')::timestamptz) then raise exception 'attendance_period_overlap';end if;
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
          select coalesce(sum(artifact_bytes),0) into bytes_total from public.merchant_attendance_period_artifacts where merchant_id=site;
          if bytes_total+artifact_size>67108864 then raise exception 'attendance_period_limit';end if;
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
        source_result:=public.faolla_attendance_period_source_v1(source_query,p_auth_user_id);
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
      source_result:=public.faolla_attendance_period_source_v1(source_query,p_auth_user_id);
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

revoke all on function public.faolla_attendance_period_closure_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_artifact_checked_v1(public.merchant_attendance_period_artifacts) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_entry_v1(public.merchant_attendance_period_entries) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_summary_v1(public.merchant_attendance_period_closures,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050149,'merchant_attendance_period_closure') on conflict(version) do nothing;
do $period_closure_postconditions$
declare t regclass;p regprocedure;role_name text;
begin
  foreach t in array array['public.merchant_attendance_period_closures'::regclass,'public.merchant_attendance_period_artifacts'::regclass,
    'public.merchant_attendance_period_versions'::regclass,'public.merchant_attendance_period_entries'::regclass] loop
    if not(select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t) then raise exception 'merchant_attendance_period_closure_storage_postcondition_failed';end if;
    if t<>'public.merchant_attendance_period_closures'::regclass and (select count(*) from pg_trigger where tgrelid=t and not tgisinternal
      and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and tgenabled='O')<>2 then raise exception 'merchant_attendance_period_closure_storage_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class cls where cls.oid=t and (pg_has_role(role_name,cls.relowner,'USAGE')
        or exists(select 1 from aclexplode(coalesce(cls.relacl,acldefault('r',cls.relowner))) acl
          where case when acl.grantee=0 then true else pg_has_role(role_name,acl.grantee,'USAGE') end))) then raise exception 'merchant_attendance_period_closure_acl_postcondition_failed';end if;
    end loop;
  end loop;
  foreach p in array array['public.faolla_attendance_period_closure_command_v1(jsonb)'::regprocedure,
    'public.faolla_attendance_period_artifact_checked_v1(public.merchant_attendance_period_artifacts)'::regprocedure,
    'public.faolla_attendance_period_entry_v1(public.merchant_attendance_period_entries)'::regprocedure,
    'public.faolla_attendance_period_summary_v1(public.merchant_attendance_period_closures,jsonb)'::regprocedure] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,p,'EXECUTE') then raise exception 'merchant_attendance_period_closure_acl_postcondition_failed';end if;
    end loop;
  end loop;
  p:='public.faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure;
  if not(select prosecdef from pg_proc where oid=p) or not has_function_privilege('service_role',p,'EXECUTE')
    or has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') then raise exception 'merchant_attendance_period_closure_acl_postcondition_failed';end if;
end;
$period_closure_postconditions$;
commit;
