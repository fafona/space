-- Independent immutable observations of candidate sources, not applied rules,
-- historical application proof, timesheet sealing or a modification of writers.
begin;
set local lock_timeout='3s';

do $rule_captures_prerequisites$
declare installed boolean;t text;p text;v bigint;n text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_rule_captures_prerequisite_required';end if;
  for v,n in select * from (values
    (202609290064::bigint,'merchant_attendance_owner_configuration'),(202610030124::bigint,'merchant_attendance_groups'),
    (202610040127::bigint,'merchant_attendance_rule_versions'),(202610040129::bigint,'merchant_attendance_personal_rules'),
    (202610040130::bigint,'merchant_attendance_rule_sources')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_rule_captures_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_rule_sources_v1(jsonb,uuid)',
    'public.faolla_attendance_group_text_v1(text,integer,integer)','public.faolla_attendance_events_append_only_v1()',
    'pg_catalog.sha256(bytea)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_rule_captures_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040131 and name='merchant_attendance_rule_captures') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040131 and name<>'merchant_attendance_rule_captures') then
    raise exception 'merchant_attendance_rule_captures_installation_conflict';end if;
  foreach t in array array['merchant_attendance_rule_capture_artifacts','merchant_attendance_rule_capture_operations'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_rule_captures_installation_conflict';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_rule_capture_command_v1(jsonb)',
    'public.faolla_attendance_rule_capture_source_v1(text,text,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,integer)',
    'public.faolla_attendance_rule_captures_v1(jsonb,uuid,jsonb,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_rule_captures_installation_conflict';end if;
  end loop;
end;
$rule_captures_prerequisites$;

-- Civil labels only: original recovery never consults today's timezone data.
create or replace function public.faolla_attendance_rule_capture_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare first_day date;last_day date;k text;u constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(convert_to(p::text,'UTF8'))>4096
    or (select count(*) from jsonb_object_keys(p))<>6 or not(p ?& array['operationId','fromDate','throughDate','reason','employeeId','employeeAuthUserId']) then return false;end if;
  foreach k in array array['operationId','employeeId','employeeAuthUserId'] loop
    if jsonb_typeof(p->k)<>'string' or coalesce(p->>k,'') !~ u then return false;end if;
  end loop;
  if jsonb_typeof(p->'reason')<>'string' or not public.faolla_attendance_group_text_v1(p->>'reason',1,200)
    or jsonb_typeof(p->'fromDate')<>'string' or jsonb_typeof(p->'throughDate')<>'string'
    or coalesce(p->>'fromDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p->>'throughDate','') !~ '^\d{4}-\d{2}-\d{2}$' then return false;end if;
  first_day:=(p->>'fromDate')::date;last_day:=(p->>'throughDate')::date;
  return first_day between date '2000-01-01' and date '2100-12-31' and last_day between date '2000-01-01' and date '2100-12-31'
    and last_day-first_day between 0 and 6 and to_char(first_day,'YYYY-MM-DD')=p->>'fromDate' and to_char(last_day,'YYYY-MM-DD')=p->>'throughDate';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return false;
end;
$$;
revoke all on function public.faolla_attendance_rule_capture_command_v1(jsonb) from public,anon,authenticated,service_role;

-- Validate saved bytes and their original bindings, not current civil-to-UTC
-- conversions. Source text is stored once and never re-rendered on archive GET.
create or replace function public.faolla_attendance_rule_capture_source_v1(p_text text,p_site text,p_worker uuid,p_actor uuid,p_employee uuid,p_employee_auth uuid,
  p_read_at timestamptz,p_digest text,p_semantic_digest text,p_bytes integer)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare v jsonb;
begin
  if p_text is null or p_site is null or p_worker is null or p_actor is null or p_employee is null or p_employee_auth is null or p_read_at is null
    or p_digest is null or p_semantic_digest is null or p_bytes is null or not isfinite(p_read_at)
    or p_bytes not between 1 and 1048576 or p_bytes<>octet_length(convert_to(p_text,'UTF8'))
    or p_digest<>encode(sha256(convert_to(p_text,'UTF8')),'hex') then return false;end if;
  v:=p_text::jsonb;
  if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>14
    or not(v ?& array['protocol','siteId','actorId','fromDate','throughDate','worker','settingsVersion','timeZone','fromAt','toAt','readAt','assignments','rules','personal'])
    or v->>'protocol' is distinct from 'rule-sources-v1' or v->>'siteId' is distinct from p_site or v->>'actorId' is distinct from p_actor::text
    or v->'worker'->>'workerId' is distinct from p_worker::text or v->'worker'->>'employeeId' is distinct from p_employee::text
    or v->'worker'->>'employeeAuthUserId' is distinct from p_employee_auth::text
    or v->>'readAt' is distinct from to_char(p_read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    or v->'assignments'->'limited' is distinct from 'false'::jsonb or v->'rules'->'limited' is distinct from 'false'::jsonb
    or v->'personal'->'limited' is distinct from 'false'::jsonb
    or p_semantic_digest !~ '^[0-9a-f]{64}$' then return false;end if;
  -- Semantic digest is an insertion-time dedup index, not archive integrity.
  -- A PG rendering change may reduce cross-version dedup but must not reject
  -- unchanged original text bytes. Do not re-render v to verify its old digest.
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return false;
end;
$$;
revoke all on function public.faolla_attendance_rule_capture_source_v1(text,text,uuid,uuid,uuid,uuid,timestamptz,text,text,integer) from public,anon,authenticated,service_role;

-- Deliberately no foreign key to an existing business table: no new delete
-- dependency or changed lifecycle for merchants, workers or employee accounts.
create table if not exists public.merchant_attendance_rule_capture_artifacts (
  merchant_id text not null check(merchant_id ~ '^\d{8}$'),source_id uuid not null,worker_id uuid not null,actor_auth_user_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,source_read_at timestamptz not null,
  source_text text not null,source_sha256 text not null,semantic_sha256 text not null,source_bytes integer not null,
  primary key(merchant_id,source_id),unique(merchant_id,worker_id,actor_auth_user_id,semantic_sha256),
  unique(merchant_id,source_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id),
  check(source_sha256 ~ '^[0-9a-f]{64}$' and semantic_sha256 ~ '^[0-9a-f]{64}$'),
  check(public.faolla_attendance_rule_capture_source_v1(source_text,merchant_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id,source_read_at,source_sha256,semantic_sha256,source_bytes))
);
create table if not exists public.merchant_attendance_rule_capture_operations (
  merchant_id text not null check(merchant_id ~ '^\d{8}$'),operation_id uuid not null,worker_id uuid not null,actor_auth_user_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,source_id uuid not null,command jsonb not null,
  observed_at timestamptz not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),
  foreign key(merchant_id,source_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id)
    references public.merchant_attendance_rule_capture_artifacts(merchant_id,source_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id),
  check(public.faolla_attendance_rule_capture_command_v1(command)),
  check(command->>'operationId'=operation_id::text and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text),
  check(isfinite(observed_at) and isfinite(recorded_at) and recorded_at>=observed_at)
);
do $rule_capture_constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_rule_capture_artifacts'::regclass and conname='attendance_rule_capture_first_operation_fk') then
    alter table public.merchant_attendance_rule_capture_artifacts add constraint attendance_rule_capture_first_operation_fk
      foreign key(merchant_id,source_id) references public.merchant_attendance_rule_capture_operations(merchant_id,operation_id) deferrable initially deferred;
  end if;
end;
$rule_capture_constraints$;
create index if not exists attendance_rule_capture_artifacts_worker_idx on public.merchant_attendance_rule_capture_artifacts(merchant_id,worker_id);
alter table public.merchant_attendance_rule_capture_artifacts enable row level security;
alter table public.merchant_attendance_rule_capture_operations enable row level security;
revoke all on public.merchant_attendance_rule_capture_artifacts,public.merchant_attendance_rule_capture_operations from public,anon,authenticated,service_role;
do $rule_capture_triggers$
declare t text;
begin
  foreach t in array array['merchant_attendance_rule_capture_artifacts','merchant_attendance_rule_capture_operations'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname='attendance_rule_capture_immutable') then
      execute format('create trigger attendance_rule_capture_immutable before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname='attendance_rule_capture_no_truncate') then
      execute format('create trigger attendance_rule_capture_no_truncate before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  end loop;
end;
$rule_capture_triggers$;

create or replace function public.faolla_attendance_rule_captures_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_module_enabled boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;wid uuid;op uuid;s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  saved public.merchant_attendance_rule_capture_operations%rowtype;artifact public.merchant_attendance_rule_capture_artifacts%rowtype;
  raw jsonb;payload jsonb;receipt jsonb;read_at timestamptz;observed_at timestamptz;stamp timestamptz;source_text text;source_digest text;semantic_digest text;source_bytes integer;
  n bigint;b bigint;u constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_module_enabled is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['siteId','workerId','operationId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ u
    or jsonb_typeof(p_query->'operationId')<>'string' or coalesce(p_query->>'operationId','') !~ u then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;op:=(p_query->>'operationId')::uuid;
  if p_command is not null and (not public.faolla_attendance_rule_capture_command_v1(p_command) or p_command->>'operationId'<>op::text) then
    raise exception 'attendance_invalid_request';end if;

  -- Retain130's authorization/identity SHARE order. Never upgrade settings.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  -- Only this new ledger uses this merchant namespace. This serializes quota,
  -- dedup and same-number capture races without touching an old settings row.
  if p_command is not null then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-rule-captures:v1:'||site,0));end if;
  select * into saved from public.merchant_attendance_rule_capture_operations where merchant_id=site and operation_id=op;
  if found then
    if saved.worker_id<>wid or saved.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
    if saved.employee_id is distinct from w.employee_id or saved.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_rule_capture_identity_changed';end if;
    if p_command is not null and saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
  elsif p_command is not null then
    if not p_module_enabled then raise exception 'attendance_platform_paused';end if;
    if not w.active or e.id is null or e.auth_user_id is null or e.status<>'active' then raise exception 'attendance_rule_capture_worker_inactive';end if;
    if p_command->>'employeeId' is distinct from w.employee_id::text or p_command->>'employeeAuthUserId' is distinct from e.auth_user_id::text then
      raise exception 'attendance_rule_capture_identity_changed';end if;
    select count(*) into n from (select 1 from public.merchant_attendance_rule_capture_operations where merchant_id=site limit 1000) bounded;
    if n>=1000 then raise exception 'attendance_rule_capture_limit';end if;
    raw:=public.faolla_attendance_rule_sources_v1(jsonb_build_object('siteId',site,'workerId',wid,'fromDate',p_command->>'fromDate','throughDate',p_command->>'throughDate'),p_auth_user_id);
    if raw->'assignments'->'limited' is distinct from 'false'::jsonb or raw->'rules'->'limited' is distinct from 'false'::jsonb
      or raw->'personal'->'limited' is distinct from 'false'::jsonb then raise exception 'attendance_rule_capture_incomplete';end if;
    observed_at:=(raw->>'readAt')::timestamptz;source_text:=raw::text;source_bytes:=octet_length(convert_to(source_text,'UTF8'));
    source_digest:=encode(sha256(convert_to(source_text,'UTF8')),'hex');semantic_digest:=encode(sha256(convert_to((raw-'readAt')::text,'UTF8')),'hex');
    if not public.faolla_attendance_rule_capture_source_v1(source_text,site,wid,p_auth_user_id,w.employee_id,e.auth_user_id,observed_at,source_digest,semantic_digest,source_bytes) then
      raise exception 'attendance_rule_capture_invalid';end if;
    select * into artifact from public.merchant_attendance_rule_capture_artifacts a
      where a.merchant_id=site and a.worker_id=wid and a.actor_auth_user_id=p_auth_user_id and a.semantic_sha256=semantic_digest;
    if found then
      -- A digest is an index key, never permission to trust a collision.
      if artifact.source_text::jsonb-'readAt' is distinct from raw-'readAt' then raise exception 'attendance_rule_capture_invalid';end if;
    else
      select count(*),coalesce(sum(x.source_bytes),0) into n,b from
        (select a.source_bytes from public.merchant_attendance_rule_capture_artifacts a where a.merchant_id=site and a.worker_id=wid limit 51) x;
      if n>=50 or b+source_bytes>8388608 then raise exception 'attendance_rule_capture_limit';end if;
      select count(*),coalesce(sum(x.source_bytes),0) into n,b from
        (select a.source_bytes from public.merchant_attendance_rule_capture_artifacts a where a.merchant_id=site limit 501) x;
      if n>=500 or b+source_bytes>67108864 then raise exception 'attendance_rule_capture_limit';end if;
      insert into public.merchant_attendance_rule_capture_artifacts(merchant_id,source_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id,
        source_read_at,source_text,source_sha256,semantic_sha256,source_bytes)
        values(site,op,wid,p_auth_user_id,w.employee_id,e.auth_user_id,observed_at,source_text,source_digest,semantic_digest,source_bytes) returning * into artifact;
    end if;
    stamp:=clock_timestamp();
    if observed_at is null or stamp<observed_at or observed_at<artifact.source_read_at then raise exception 'attendance_rule_capture_invalid';end if;
    insert into public.merchant_attendance_rule_capture_operations(merchant_id,operation_id,worker_id,actor_auth_user_id,employee_id,employee_auth_user_id,source_id,command,observed_at,recorded_at)
      values(site,op,wid,p_auth_user_id,w.employee_id,e.auth_user_id,artifact.source_id,p_command,observed_at,stamp) returning * into saved;
  end if;

  receipt:=null;
  if saved.operation_id is not null then
    select * into artifact from public.merchant_attendance_rule_capture_artifacts where merchant_id=site and source_id=saved.source_id;
    if artifact.source_id is null or row(artifact.worker_id,artifact.actor_auth_user_id,artifact.employee_id,artifact.employee_auth_user_id)
      is distinct from row(saved.worker_id,saved.actor_auth_user_id,saved.employee_id,saved.employee_auth_user_id)
      or not public.faolla_attendance_rule_capture_command_v1(saved.command) or saved.command->>'operationId' is distinct from saved.operation_id::text
      or saved.command->>'employeeId' is distinct from saved.employee_id::text or saved.command->>'employeeAuthUserId' is distinct from saved.employee_auth_user_id::text
      or saved.observed_at<artifact.source_read_at or saved.recorded_at<saved.observed_at
      or not public.faolla_attendance_rule_capture_source_v1(artifact.source_text,site,wid,p_auth_user_id,saved.employee_id,saved.employee_auth_user_id,
        artifact.source_read_at,artifact.source_sha256,artifact.semantic_sha256,artifact.source_bytes) then raise exception 'attendance_rule_capture_invalid';end if;
    payload:=artifact.source_text::jsonb;
    if saved.command->>'fromDate' is distinct from payload->>'fromDate' or saved.command->>'throughDate' is distinct from payload->>'throughDate' then
      raise exception 'attendance_rule_capture_invalid';end if;
    receipt:=jsonb_build_object('operationId',saved.operation_id,'actorId',saved.actor_auth_user_id,'command',saved.command,
      'observedAt',to_char(saved.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'recordedAt',to_char(saved.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'sourceId',artifact.source_id,'sourceReadAt',to_char(artifact.source_read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'sourceText',artifact.source_text,'sourceSha256',artifact.source_sha256,'sourceBytes',artifact.source_bytes,'canonicalFormat','pg-jsonb-text-utf8-v1',
      'applied',false,'historicalApplicationProven',false);
  end if;
  read_at:=clock_timestamp();if saved.recorded_at is not null and read_at<saved.recorded_at then raise exception 'attendance_rule_capture_invalid';end if;
  return jsonb_build_object('protocol','candidate-rule-captures-v1','siteId',site,'actorId',p_auth_user_id,'workerId',wid,'operationId',op,
    'receipt',receipt,'readAt',to_char(read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_rule_captures_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_rule_captures_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040131,'merchant_attendance_rule_captures') on conflict(version) do nothing;
do $rule_captures_postconditions$
declare t regclass;r text;p regprocedure;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040131 and name='merchant_attendance_rule_captures') then
    raise exception 'merchant_attendance_rule_captures_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_rule_captures_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_rule_captures_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_rule_captures_v1(jsonb,uuid,jsonb,boolean)','EXECUTE') then
    raise exception 'merchant_attendance_rule_captures_acl_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_rule_capture_artifacts'::regclass,'public.merchant_attendance_rule_capture_operations'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_rule_captures_acl_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_rule_captures_acl_postcondition_failed';end if;
    end loop;
  end loop;
  foreach p in array array['public.faolla_attendance_rule_capture_command_v1(jsonb)'::regprocedure,
    'public.faolla_attendance_rule_capture_source_v1(text,text,uuid,uuid,uuid,uuid,timestamptz,text,text,integer)'::regprocedure] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_rule_captures_acl_postcondition_failed';end if;
    end loop;
    if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where f.oid=p and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'merchant_attendance_rule_captures_acl_postcondition_failed';end if;
  end loop;
end;
$rule_captures_postconditions$;
notify pgrst, 'reload schema';
commit;
