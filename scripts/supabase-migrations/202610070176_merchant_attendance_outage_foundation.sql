--211 Foundation only: immutable outage incidents, personal declarations and
--exact receipts. A declaration is neither a clock event nor a resolved claim.
--No old function, source, period, application, permission or setting is changed.
begin;
set local lock_timeout='3s';
do $outage_prerequisites$
declare installed boolean;n text;d record;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_outage_foundation_prerequisite_required';end if;
  for d in select * from (values
    (202609290061::bigint,'merchant_attendance_foundation'),
    (202610040135::bigint,'merchant_attendance_shift_rule_binding_reader'),
    (202610060164::bigint,'merchant_attendance_account_suspensions'),
    (202610060175::bigint,'merchant_attendance_plan_posthoc_periods')) v(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations x where x.version=d.version and x.name=d.name) then
      raise exception 'merchant_attendance_outage_foundation_prerequisite_required';end if;
  end loop;
  foreach n in array array['public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])',
    'public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)','public.faolla_attendance_group_text_v1(text,integer,integer)',
    'public.faolla_attendance_events_append_only_v1()','public.faolla_attendance_valid_zone_v1(text)',
    'public.faolla_valid_merchant_enterprise_permissions_v1(text[])'] loop
    if to_regprocedure(n) is null then raise exception 'merchant_attendance_outage_foundation_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610070176 and name<>'merchant_attendance_outage_foundation') then
    raise exception 'merchant_attendance_outage_foundation_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610070176 and name='merchant_attendance_outage_foundation') into installed;
  foreach n in array array['merchant_attendance_outage_operations','merchant_attendance_outage_incidents','merchant_attendance_outage_declarations'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_outage_foundation_installation_conflict';end if;
  end loop;
  foreach n in array array['faolla_attendance_outage_interval_v1','faolla_attendance_outage_command_v1','faolla_attendance_outage_hash_v1',
    'faolla_attendance_outage_incident_v1','faolla_attendance_outage_declaration_v1','faolla_attendance_outage_receipt_v1',
    'faolla_attendance_outage_ledger_guard_v1','faolla_attendance_outage_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n) then
      raise exception 'merchant_attendance_outage_foundation_installation_conflict';end if;
  end loop;
end;
$outage_prerequisites$;

--Shape-only, including exact UTC microseconds. Historical receipts must not be
--reinterpreted against a later tzdata release. Fresh timezone checks are in RPC.
create or replace function public.faolla_attendance_outage_interval_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare a timestamptz;b timestamptz;k text;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['startAt','endAt','timeZone','startOffsetMinutes','endOffsetMinutes']) is distinct from true then return false;end if;
  foreach k in array array['startAt','endAt'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or p->>k!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' and p->>k!~'^2100-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then return false;end if;
    if to_char((p->>k)::timestamptz at time zone 'UTC',fmt)<>p->>k then return false;end if;
  end loop;
  a:=(p->>'startAt')::timestamptz;b:=(p->>'endAt')::timestamptz;
  if a<'2000-01-01T00:00:00Z'::timestamptz or b>='2101-01-01T00:00:00Z'::timestamptz or b<=a or b-a>interval '744 hours'
    or jsonb_typeof(p->'timeZone') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'timeZone',1,100) is distinct from true then return false;end if;
  foreach k in array array['startOffsetMinutes','endOffsetMinutes'] loop
    if jsonb_typeof(p->k) is distinct from 'number' or p->>k!~'^-?(0|[1-9][0-9]*)$' or (p->>k)::numeric not between -840 and 840 then return false;end if;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create or replace function public.faolla_attendance_outage_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;
begin
  if p is null or octet_length(convert_to(p::text,'UTF8'))>8192 or jsonb_typeof(p->'action') is distinct from 'string'
    or p->>'action' not in('create_incident','declare') then return false;end if;
  if public.faolla_attendance_shift_rule_binding_object_v1(p,case p->>'action' when 'create_incident' then
    array['action','operationId','incidentId','type','channel','locationId','interval','reason'] else
    array['action','operationId','declarationId','incidentId','workerId','employeeId','employeeAuthUserId','expectedWorkerVersion','expectedEmployeeVersion','expectedGeneration','interval','statement','originalOperationId','originalChannel','paperReference'] end) is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'incidentId','uuid') is distinct from true
    or public.faolla_attendance_outage_interval_v1(p->'interval') is distinct from true then return false;end if;
  if p->>'action'='create_incident' then
    return jsonb_typeof(p->'type')='string' and p->>'type' in('network','device','service','other')
      and jsonb_typeof(p->'channel')='string' and p->>'channel' in('web','location','onsite','pin','other')
      and (p->'locationId'='null'::jsonb or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'locationId','uuid') is true)
      and jsonb_typeof(p->'reason')='string' and public.faolla_attendance_group_text_v1(p->>'reason',1,1000) is true;
  end if;
  foreach k in array array['declarationId','workerId','employeeId','employeeAuthUserId'] loop
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'uuid') is distinct from true then return false;end if;
  end loop;
  foreach k in array array['expectedWorkerVersion','expectedEmployeeVersion'] loop
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'version') is distinct from true or (p->>k)::numeric>9007199254740990 then return false;end if;
  end loop;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedGeneration','head') is true
    and (p->>'expectedGeneration')::numeric<=9007199254740990
    and jsonb_typeof(p->'statement')='string' and public.faolla_attendance_group_text_v1(p->>'statement',1,1000) is true
    and ((p->'originalOperationId'='null'::jsonb and p->'originalChannel'='null'::jsonb)
      or (public.faolla_attendance_shift_rule_binding_scalar_v1(p->'originalOperationId','uuid') is true
        and jsonb_typeof(p->'originalChannel')='string' and p->>'originalChannel' in('web','location','onsite','pin','other')))
    and (p->'paperReference'='null'::jsonb or (jsonb_typeof(p->'paperReference')='string' and public.faolla_attendance_group_text_v1(p->>'paperReference',1,120) is true));
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create or replace function public.faolla_attendance_outage_hash_v1(p_site text,p_access text,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare tuple jsonb;body text;
begin
  if p->>'action'='create_incident' then
    tuple:=jsonb_build_array(p_site,p_access,p->'action',p->'operationId',p->'incidentId',p->'type',p->'channel',p->'locationId',
      p->'interval'->'startAt',p->'interval'->'endAt',p->'interval'->'timeZone',p->'interval'->'startOffsetMinutes',p->'interval'->'endOffsetMinutes',p->'reason');
  else
    tuple:=jsonb_build_array(p_site,p_access,p->'action',p->'operationId',p->'declarationId',p->'incidentId',p->'workerId',p->'employeeId',p->'employeeAuthUserId',
      p->'expectedWorkerVersion',p->'expectedEmployeeVersion',p->'expectedGeneration',p->'interval'->'startAt',p->'interval'->'endAt',p->'interval'->'timeZone',
      p->'interval'->'startOffsetMinutes',p->'interval'->'endOffsetMinutes',p->'statement',p->'originalOperationId',p->'originalChannel',p->'paperReference');
  end if;
  select '['||string_agg(value::text,',' order by ordinal)||']' into body from jsonb_array_elements(tuple) with ordinality a(value,ordinal);
  return encode(sha256(convert_to(body,'UTF8')),'hex');
end;
$$;

create table if not exists public.merchant_attendance_outage_operations(
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),operation_id uuid not null,
  access text not null check(access in('owner','self')),action text not null check(action in('create_incident','declare')),
  record_id uuid not null,incident_id uuid not null,actor_auth_user_id uuid not null,actor_employee_id uuid,
  worker_id uuid,employee_id uuid,employee_auth_user_id uuid,command jsonb not null,
  command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,operation_id,record_id,actor_auth_user_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,actor_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(public.faolla_attendance_outage_command_v1(command) is true and command->>'operationId'=operation_id::text
    and command->>'action'=action and command->>'incidentId'=incident_id::text
    and command_fingerprint=public.faolla_attendance_outage_hash_v1(merchant_id,access,command)),
  check(((access='owner' and actor_employee_id is null) or (access='self' and actor_employee_id=employee_id and actor_auth_user_id=employee_auth_user_id)) is true),
  check((action='create_incident' and access='owner' and record_id=incident_id and worker_id is null and employee_id is null and employee_auth_user_id is null)
    or (action='declare' and worker_id is not null and employee_id is not null and employee_auth_user_id is not null
      and command->>'declarationId'=record_id::text and command->>'workerId'=worker_id::text
      and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text))
);
create table if not exists public.merchant_attendance_outage_incidents(
  merchant_id text not null,incident_id uuid not null,operation_id uuid not null,actor_auth_user_id uuid not null,
  type text not null check(type in('network','device','service','other')),channel text not null check(channel in('web','location','onsite','pin','other')),
  location_id uuid,declared_interval jsonb not null check(public.faolla_attendance_outage_interval_v1(declared_interval) is true),
  reason text not null check(public.faolla_attendance_group_text_v1(reason,1,1000) is true),recorded_at timestamptz not null check(isfinite(recorded_at)),
  check((declared_interval->>'endAt')::timestamptz<=recorded_at),
  primary key(merchant_id,incident_id),unique(merchant_id,operation_id),
  foreign key(merchant_id,operation_id,incident_id,actor_auth_user_id) references public.merchant_attendance_outage_operations(merchant_id,operation_id,record_id,actor_auth_user_id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id)
);
create table if not exists public.merchant_attendance_outage_declarations(
  merchant_id text not null,declaration_id uuid not null,operation_id uuid not null,incident_id uuid not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
  worker_version bigint not null check(worker_version between 1 and 9007199254740990),employee_version bigint not null check(employee_version between 1 and 9007199254740990),
  generation bigint not null check(generation between 0 and 9007199254740990),
  declared_interval jsonb not null check(public.faolla_attendance_outage_interval_v1(declared_interval) is true),
  statement text not null check(public.faolla_attendance_group_text_v1(statement,1,1000) is true),
  original_operation_id uuid,original_channel text,paper_reference text,
  recorded_by text not null check(recorded_by in('owner','self')),actor_auth_user_id uuid not null,actor_employee_id uuid,
  recorded_at timestamptz not null check(isfinite(recorded_at)),primary key(merchant_id,declaration_id),unique(merchant_id,operation_id),
  foreign key(merchant_id,incident_id) references public.merchant_attendance_outage_incidents(merchant_id,incident_id),
  foreign key(merchant_id,operation_id,declaration_id,actor_auth_user_id) references public.merchant_attendance_outage_operations(merchant_id,operation_id,record_id,actor_auth_user_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,actor_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(((recorded_by='owner' and actor_employee_id is null) or (recorded_by='self' and actor_employee_id=employee_id and actor_auth_user_id=employee_auth_user_id)) is true),
  check(((original_operation_id is null and original_channel is null) or (original_operation_id is not null and original_channel in('web','location','onsite','pin','other'))) is true),
  check((declared_interval->>'endAt')::timestamptz<=recorded_at),
  check(paper_reference is null or public.faolla_attendance_group_text_v1(paper_reference,1,120) is true)
);
--Separate exact indexes: no unrelated history is loaded before a page/recovery.
create index if not exists attendance_outage_declaration_incident_idx on public.merchant_attendance_outage_declarations(merchant_id,incident_id,declaration_id);
create index if not exists attendance_outage_declaration_self_idx on public.merchant_attendance_outage_declarations(merchant_id,incident_id,worker_id,employee_id,employee_auth_user_id,declaration_id);

--A deferred mandatory pairing proof makes even a direct privileged insert
--unable to commit an operation without its exact immutable declaration/header.
create or replace function public.faolla_attendance_outage_ledger_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare i public.merchant_attendance_outage_incidents%rowtype;d public.merchant_attendance_outage_declarations%rowtype;
  entry_row public.merchant_attendance_outage_operations%rowtype;c jsonb;
begin
  select * into entry_row from public.merchant_attendance_outage_operations where merchant_id=new.merchant_id and operation_id=new.operation_id;
  if entry_row.operation_id is null or (tg_table_name='merchant_attendance_outage_incidents' and entry_row.action<>'create_incident')
    or (tg_table_name='merchant_attendance_outage_declarations' and entry_row.action<>'declare') then raise exception 'attendance_outage_invalid';end if;
  c:=entry_row.command;
  if entry_row.action='create_incident' then
    select * into i from public.merchant_attendance_outage_incidents where merchant_id=entry_row.merchant_id and incident_id=entry_row.record_id;
    if i.operation_id is distinct from entry_row.operation_id or i.actor_auth_user_id is distinct from entry_row.actor_auth_user_id
      or i.type is distinct from c->>'type' or i.channel is distinct from c->>'channel' or i.location_id is distinct from (c->>'locationId')::uuid
      or i.declared_interval is distinct from c->'interval' or i.reason is distinct from c->>'reason' or i.recorded_at is distinct from entry_row.recorded_at then
      raise exception 'attendance_outage_invalid';end if;
  else
    select * into d from public.merchant_attendance_outage_declarations where merchant_id=entry_row.merchant_id and declaration_id=entry_row.record_id;
    select * into i from public.merchant_attendance_outage_incidents where merchant_id=entry_row.merchant_id and incident_id=entry_row.incident_id;
    if d.operation_id is distinct from entry_row.operation_id or d.incident_id is distinct from entry_row.incident_id
      or row(d.worker_id,d.employee_id,d.employee_auth_user_id,d.actor_auth_user_id,d.actor_employee_id,d.recorded_by,d.recorded_at)
        is distinct from row(entry_row.worker_id,entry_row.employee_id,entry_row.employee_auth_user_id,entry_row.actor_auth_user_id,entry_row.actor_employee_id,entry_row.access,entry_row.recorded_at)
      or d.worker_version is distinct from (c->>'expectedWorkerVersion')::bigint or d.employee_version is distinct from (c->>'expectedEmployeeVersion')::bigint
      or d.generation is distinct from (c->>'expectedGeneration')::bigint or d.declared_interval is distinct from c->'interval' or d.statement is distinct from c->>'statement'
      or d.original_operation_id is distinct from (c->>'originalOperationId')::uuid or d.original_channel is distinct from c->>'originalChannel'
      or d.paper_reference is distinct from c->>'paperReference' or i.incident_id is null
      or not ((d.declared_interval->>'startAt')::timestamptz<(i.declared_interval->>'endAt')::timestamptz
        and (i.declared_interval->>'startAt')::timestamptz<(d.declared_interval->>'endAt')::timestamptz) then raise exception 'attendance_outage_invalid';end if;
  end if;
  return new;
end;
$$;

do $outage_table_guards$
declare n text;t regclass;
begin
  foreach n in array array['merchant_attendance_outage_operations','merchant_attendance_outage_incidents','merchant_attendance_outage_declarations'] loop
    t:=('public.'||n)::regclass;
    execute format('alter table %s enable row level security',t);
    execute format('revoke all on %s from public,anon,authenticated,service_role',t);
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_outage_immutable') then
      execute format('create trigger attendance_outage_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_outage_no_truncate') then
      execute format('create trigger attendance_outage_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_outage_pairing') then
      execute format('create constraint trigger attendance_outage_pairing after insert on %s deferrable initially deferred for each row execute function public.faolla_attendance_outage_ledger_guard_v1()',t);end if;
  end loop;
end;
$outage_table_guards$;

create or replace function public.faolla_attendance_outage_incident_v1(p public.merchant_attendance_outage_incidents)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('kind','incident','id',p.incident_id,'operationId',p.operation_id,'type',p.type,'channel',p.channel,'locationId',p.location_id,
    'interval',p.declared_interval,'reason',p.reason,'actorId',p.actor_auth_user_id,'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;
create or replace function public.faolla_attendance_outage_declaration_v1(p public.merchant_attendance_outage_declarations)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('kind','declaration','id',p.declaration_id,'operationId',p.operation_id,'incidentId',p.incident_id,
    'workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'workerVersion',p.worker_version,'employeeVersion',p.employee_version,
    'generation',p.generation,'interval',p.declared_interval,'statement',p.statement,'originalOperationId',p.original_operation_id,'originalChannel',p.original_channel,
    'paperReference',p.paper_reference,'recordedBy',p.recorded_by,'actorId',p.actor_auth_user_id,'actorEmployeeId',p.actor_employee_id,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;
create or replace function public.faolla_attendance_outage_receipt_v1(p public.merchant_attendance_outage_operations)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('operationId',p.operation_id,'action',p.action,'recordId',p.record_id,'incidentId',p.incident_id,'actorId',p.actor_auth_user_id,
    'commandFingerprint',p.command_fingerprint,'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;

create or replace function public.faolla_attendance_outage_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;keys text[];op uuid;record_id uuid;target_incident uuid;after_id uuid;wid uuid;actor_employee uuid;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  role_row public.merchant_enterprise_roles%rowtype;epoch public.merchant_attendance_account_epochs%rowtype;
  saved public.merchant_attendance_outage_operations%rowtype;i public.merchant_attendance_outage_incidents%rowtype;d public.merchant_attendance_outage_declarations%rowtype;
  span jsonb;stamp timestamptz;a timestamptz;b timestamptz;zone_name text;generation_no bigint:=0;
  items jsonb:='[]';detail jsonb;receipt jsonb;result jsonb;next_id uuid;n integer:=0;can_write boolean:=false;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or p_query->>'mode' not in('incidents','declarations','incident','declaration','recover') then
    raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  keys:=case mode_name when 'incidents' then array['siteId','access','mode','afterId'] when 'declarations' then array['siteId','access','mode','incidentId','afterId']
    when 'incident' then array['siteId','access','mode','incidentId'] when 'declaration' then array['siteId','access','mode','declarationId'] else array['siteId','access','mode','operationId'] end;
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,keys) is distinct from true then raise exception 'attendance_invalid_request';end if;
  if mode_name in('incidents','declarations') then
    if p_query->'afterId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'afterId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
    after_id:=(p_query->>'afterId')::uuid;
  end if;
  if mode_name in('incident','declarations') then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'incidentId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
    target_incident:=(p_query->>'incidentId')::uuid;
  elsif mode_name='declaration' then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'declarationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
    record_id:=(p_query->>'declarationId')::uuid;
  elsif mode_name='recover' then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
    op:=(p_query->>'operationId')::uuid;
  end if;
  if p_command is not null then
    if public.faolla_attendance_outage_command_v1(p_command) is distinct from true
      or not ((mode_name='incident' and access_name='owner' and p_command->>'action'='create_incident' and p_command->>'incidentId'=target_incident::text)
        or (mode_name='declaration' and p_command->>'action'='declare' and p_command->>'declarationId'=record_id::text)) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  --Same first locks as account/period writers. Settings serializes all new
  --receipt checks and prevents lock upgrades on fresh versus replay paths.
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    if mode_name='incidents' then raise exception 'attendance_access_denied';end if;
    --This first lookup only selects a lock target, never authorizes its data.
    select x.id into wid from public.merchant_attendance_workers x join public.merchant_enterprise_employees y on y.merchant_id=x.merchant_id and y.id=x.employee_id
      where x.merchant_id=site and y.auth_user_id=p_auth_user_id;
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
    if not found then raise exception 'attendance_access_denied';end if;
    select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
    if e.id is null or e.auth_user_id is distinct from p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if role_row.id is null or role_row.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
      or not role_row.permissions @> array['enterprise.view','attendance.self.view','attendance.self.request']::text[] then raise exception 'attendance_access_denied';end if;
    actor_employee:=e.id;
    select * into epoch from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=e.id;
    generation_no:=coalesce(epoch.generation,0);
  end if;
  if op is not null then
    select * into saved from public.merchant_attendance_outage_operations where merchant_id=site and operation_id=op;
    if saved.operation_id is not null then
      if saved.access<>access_name or saved.actor_auth_user_id<>p_auth_user_id
        or (access_name='self' and row(saved.worker_id,saved.employee_id,saved.employee_auth_user_id,saved.actor_employee_id)
          is distinct from row(w.id,e.id,e.auth_user_id,e.id)) then raise exception 'attendance_access_denied';end if;
      if p_command is not null and (saved.command is distinct from p_command or saved.record_id is distinct from coalesce(record_id,target_incident)) then raise exception 'attendance_operation_conflict';end if;
      receipt:=public.faolla_attendance_outage_receipt_v1(saved);
    elsif mode_name='recover' then raise exception 'attendance_outage_not_found';end if;
  end if;
  if receipt is null and p_command is not null then
    if not p_allow_write then raise exception 'attendance_outage_disabled';end if;
    if not s.enabled then raise exception 'attendance_platform_paused';end if;
    span:=p_command->'interval';a:=(span->>'startAt')::timestamptz;b:=(span->>'endAt')::timestamptz;zone_name:=span->>'timeZone';
    stamp:=clock_timestamp();
    if public.faolla_attendance_valid_zone_v1(zone_name) is distinct from true or b>stamp then raise exception 'attendance_invalid_request';end if;
    if extract(epoch from ((a at time zone zone_name)-(a at time zone 'UTC')))/60<>(span->>'startOffsetMinutes')::integer
      or extract(epoch from ((b at time zone zone_name)-(b at time zone 'UTC')))/60<>(span->>'endOffsetMinutes')::integer then raise exception 'attendance_invalid_request';end if;
    if p_command->>'action'='create_incident' then
      record_id:=target_incident;
      if exists(select 1 from public.merchant_attendance_outage_incidents x where x.merchant_id=site and x.incident_id=record_id) then raise exception 'attendance_outage_changed';end if;
      if p_command->'locationId'<>'null'::jsonb then
        perform 1 from public.merchant_attendance_locations where merchant_id=site and id=(p_command->>'locationId')::uuid for share;
        if not found then raise exception 'attendance_access_denied';end if;
      end if;
    else
      target_incident:=(p_command->>'incidentId')::uuid;
      select * into i from public.merchant_attendance_outage_incidents x where x.merchant_id=site and x.incident_id=target_incident;
      if i.incident_id is null then raise exception 'attendance_outage_not_found';end if;
      if not (a<(i.declared_interval->>'endAt')::timestamptz and (i.declared_interval->>'startAt')::timestamptz<b) then raise exception 'attendance_invalid_request';end if;
      if exists(select 1 from public.merchant_attendance_outage_declarations x where x.merchant_id=site and x.declaration_id=record_id) then raise exception 'attendance_outage_changed';end if;
      if access_name='owner' then
        select * into w from public.merchant_attendance_workers where merchant_id=site and id=(p_command->>'workerId')::uuid for update;
        if not found then raise exception 'attendance_access_denied';end if;
        select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
        select * into epoch from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=e.id;
        generation_no:=coalesce(epoch.generation,0);
      else
        if row(w.id,e.id,e.auth_user_id) is distinct from row((p_command->>'workerId')::uuid,(p_command->>'employeeId')::uuid,(p_command->>'employeeAuthUserId')::uuid) then raise exception 'attendance_access_denied';end if;
        if not w.active then raise exception 'attendance_account_suspended';end if;
        if coalesce(epoch.paused,false) then raise exception 'attendance_account_suspended';end if;
      end if;
      if e.id is null or e.auth_user_id is null or row(w.id,e.id,e.auth_user_id) is distinct from
        row((p_command->>'workerId')::uuid,(p_command->>'employeeId')::uuid,(p_command->>'employeeAuthUserId')::uuid)
        or w.version<>(p_command->>'expectedWorkerVersion')::bigint or e.version<>(p_command->>'expectedEmployeeVersion')::bigint
        or generation_no<>(p_command->>'expectedGeneration')::bigint then raise exception 'attendance_outage_changed';end if;
    end if;
    insert into public.merchant_attendance_outage_operations(merchant_id,operation_id,access,action,record_id,incident_id,actor_auth_user_id,actor_employee_id,
      worker_id,employee_id,employee_auth_user_id,command,command_fingerprint,recorded_at)
      values(site,op,access_name,p_command->>'action',record_id,target_incident,p_auth_user_id,actor_employee,
        case when p_command->>'action'='declare' then w.id end,case when p_command->>'action'='declare' then e.id end,
        case when p_command->>'action'='declare' then e.auth_user_id end,p_command,public.faolla_attendance_outage_hash_v1(site,access_name,p_command),stamp) returning * into saved;
    if p_command->>'action'='create_incident' then
      insert into public.merchant_attendance_outage_incidents(merchant_id,incident_id,operation_id,actor_auth_user_id,type,channel,location_id,declared_interval,reason,recorded_at)
        values(site,record_id,op,p_auth_user_id,p_command->>'type',p_command->>'channel',(p_command->>'locationId')::uuid,span,p_command->>'reason',stamp);
    else
      insert into public.merchant_attendance_outage_declarations(merchant_id,declaration_id,operation_id,incident_id,worker_id,employee_id,employee_auth_user_id,
        worker_version,employee_version,generation,declared_interval,statement,original_operation_id,original_channel,paper_reference,recorded_by,actor_auth_user_id,actor_employee_id,recorded_at)
        values(site,record_id,op,target_incident,w.id,e.id,e.auth_user_id,w.version,e.version,generation_no,span,p_command->>'statement',
          (p_command->>'originalOperationId')::uuid,p_command->>'originalChannel',p_command->>'paperReference',access_name,p_auth_user_id,actor_employee,stamp);
    end if;
    receipt:=public.faolla_attendance_outage_receipt_v1(saved);
  elsif receipt is null then
    can_write:=p_allow_write and s.enabled and (access_name='owner' or (w.active and not coalesce(epoch.paused,false)));
    if mode_name in('incident','declarations') then
      select * into i from public.merchant_attendance_outage_incidents x where x.merchant_id=site and x.incident_id=target_incident;
      if i.incident_id is null or (access_name='self' and not exists(select 1 from public.merchant_attendance_outage_declarations x
        where x.merchant_id=site and x.incident_id=target_incident and x.worker_id=w.id and x.employee_id=e.id and x.employee_auth_user_id=e.auth_user_id)) then
        raise exception 'attendance_outage_not_found';end if;
    end if;
    if mode_name='incident' then detail:=public.faolla_attendance_outage_incident_v1(i);
    elsif mode_name='declaration' then
      select * into d from public.merchant_attendance_outage_declarations x where x.merchant_id=site and x.declaration_id=record_id;
      if d.declaration_id is null or (access_name='self' and row(d.worker_id,d.employee_id,d.employee_auth_user_id) is distinct from row(w.id,e.id,e.auth_user_id)) then raise exception 'attendance_outage_not_found';end if;
      detail:=public.faolla_attendance_outage_declaration_v1(d);
    elsif mode_name='incidents' then
      for i in select x.* from public.merchant_attendance_outage_incidents x where x.merchant_id=site and (after_id is null or x.incident_id>after_id) order by x.incident_id limit 26 loop
        n:=n+1;if n=26 then next_id:=(items->24->>'id')::uuid;exit;end if;items:=items||jsonb_build_array(public.faolla_attendance_outage_incident_v1(i));
      end loop;
    elsif mode_name='declarations' then
      --Two mutually exclusive probes keep the self index prefix exact; do not
      --scan another employee's history and count/filter it after the page cap.
      for d in select bounded.* from (
        (select x.* from public.merchant_attendance_outage_declarations x where access_name='owner' and x.merchant_id=site and x.incident_id=target_incident
          and (after_id is null or x.declaration_id>after_id) order by x.declaration_id limit 26)
        union all
        (select x.* from public.merchant_attendance_outage_declarations x where access_name='self' and x.merchant_id=site and x.incident_id=target_incident
          and x.worker_id=w.id and x.employee_id=e.id and x.employee_auth_user_id=e.auth_user_id
          and (after_id is null or x.declaration_id>after_id) order by x.declaration_id limit 26)
        ) bounded order by bounded.declaration_id limit 26 loop
        n:=n+1;if n=26 then next_id:=(items->24->>'id')::uuid;exit;end if;items:=items||jsonb_build_array(public.faolla_attendance_outage_declaration_v1(d));
      end loop;
    end if;
  end if;
  result:=jsonb_build_object('protocol','attendance-outage-v1','siteId',site,'access',access_name,'mode',mode_name,'actorId',p_auth_user_id,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'canWrite',can_write,'items',items,'detail',detail,'receipt',receipt,'nextId',next_id);
  --25 legal 1000-codepoint statements plus 120-codepoint paper references can
  --exceed 128KiB with four-byte UTF8. Match the strict Node 256KiB reply budget.
  if octet_length(convert_to(result::text,'UTF8'))>262144 then raise exception 'attendance_outage_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_outage_interval_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_hash_v1(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_ledger_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_incident_v1(public.merchant_attendance_outage_incidents) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_declaration_v1(public.merchant_attendance_outage_declarations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_receipt_v1(public.merchant_attendance_outage_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.faolla_attendance_outage_v1(jsonb,uuid,jsonb,boolean) to service_role;

do $outage_permissions$
declare p record;r text;t regclass;priv text;idx record;
begin
  if (select count(*) from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
    and proname=any(array['faolla_attendance_outage_interval_v1','faolla_attendance_outage_command_v1','faolla_attendance_outage_hash_v1',
      'faolla_attendance_outage_ledger_guard_v1','faolla_attendance_outage_incident_v1','faolla_attendance_outage_declaration_v1','faolla_attendance_outage_receipt_v1','faolla_attendance_outage_v1']))<>8 then
    raise exception 'merchant_attendance_outage_foundation_installation_conflict';end if;
  for p in select oid,proname,prosecdef,proconfig from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
    and proname=any(array['faolla_attendance_outage_interval_v1','faolla_attendance_outage_command_v1','faolla_attendance_outage_hash_v1',
      'faolla_attendance_outage_ledger_guard_v1','faolla_attendance_outage_incident_v1','faolla_attendance_outage_declaration_v1','faolla_attendance_outage_receipt_v1','faolla_attendance_outage_v1']) loop
    if p.prosecdef<>(p.proname in('faolla_attendance_outage_v1','faolla_attendance_outage_ledger_guard_v1')) or p.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or exists(select 1 from pg_proc x cross join lateral aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) a where x.oid=p.oid and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'merchant_attendance_outage_foundation_permission_conflict';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p.oid,'EXECUTE') is distinct from (r='service_role' and p.proname='faolla_attendance_outage_v1') then
        raise exception 'merchant_attendance_outage_foundation_permission_conflict';end if;
    end loop;
  end loop;
  foreach t in array array['public.merchant_attendance_outage_operations'::regclass,'public.merchant_attendance_outage_incidents'::regclass,'public.merchant_attendance_outage_declarations'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
      or exists(select 1 from pg_class x cross join lateral aclexplode(coalesce(x.relacl,acldefault('r',x.relowner))) a where x.oid=t and a.grantee=0) then
      raise exception 'merchant_attendance_outage_foundation_permission_conflict';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      for priv in select a.privilege_type from pg_class c cross join lateral aclexplode(acldefault('r',c.relowner)) a where c.oid=t loop
        if has_table_privilege(r,t,priv) then raise exception 'merchant_attendance_outage_foundation_permission_conflict';end if;
      end loop;
    end loop;
    if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal and tgenabled='O' and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure
      and ((tgname='attendance_outage_immutable' and tgtype=27) or (tgname='attendance_outage_no_truncate' and tgtype=34)))<>2 then raise exception 'merchant_attendance_outage_foundation_installation_conflict';end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_outage_pairing'
      and tgfoid='public.faolla_attendance_outage_ledger_guard_v1()'::regprocedure and tgtype=5 and tgenabled='O' and tgdeferrable and tginitdeferred) then raise exception 'merchant_attendance_outage_foundation_installation_conflict';end if;
  end loop;
  for idx in select * from (values
    ('attendance_outage_declaration_incident_idx',array['merchant_id','incident_id','declaration_id']),
    ('attendance_outage_declaration_self_idx',array['merchant_id','incident_id','worker_id','employee_id','employee_auth_user_id','declaration_id'])) a(name,columns) loop
    if not exists(select 1 from pg_index x join pg_class c on c.oid=x.indexrelid join pg_am am on am.oid=c.relam
      where c.oid=to_regclass('public.'||idx.name) and x.indrelid='public.merchant_attendance_outage_declarations'::regclass
        and am.amname='btree' and x.indisvalid and x.indisready and not x.indisunique and x.indpred is null and x.indexprs is null
        and x.indnkeyatts=cardinality(idx.columns) and x.indnatts=cardinality(idx.columns)
        and (select array_agg(pg_get_indexdef(x.indexrelid,k,true) order by k) from generate_series(1,x.indnkeyatts) k)=idx.columns) then
      raise exception 'merchant_attendance_outage_foundation_installation_conflict';end if;
  end loop;
end;
$outage_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610070176,'merchant_attendance_outage_foundation') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
