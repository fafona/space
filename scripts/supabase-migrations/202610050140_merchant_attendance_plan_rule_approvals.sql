-- Explicit owner adoption of two rules for one future plan. No clock, source
-- ledger, schedule writer, payroll or existing report is changed.
begin;
set local lock_timeout='3s';

do $plan_rules_prerequisites$
declare installed boolean;v bigint;n text;t text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_plan_rule_approvals_prerequisite_required';end if;
  for v,n in select * from (values
    (202610040130::bigint,'merchant_attendance_rule_sources'),(202610040133::bigint,'merchant_attendance_shift_rule_bindings'),
    (202610040135::bigint,'merchant_attendance_shift_rule_binding_reader'),(202610050136::bigint,'merchant_attendance_schedule_publication_evidence'),
    (202610050137::bigint,'merchant_attendance_self_schedule'),(202610050139::bigint,'merchant_attendance_plan_coverage')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_plan_rule_approvals_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_rule_sources_v1(jsonb,uuid)',
    'public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_shift_rule_fields_v1(jsonb)','public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])',
    'public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)','public.faolla_attendance_rule_values_v1(jsonb)',
    'public.faolla_attendance_rule_day_start_v1(text,text)','public.faolla_attendance_personal_rule_end_v1(text,text)',
    'public.faolla_attendance_events_append_only_v1()','pg_catalog.sha256(bytea)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_plan_rule_approvals_prerequisite_required';end if;
  end loop;
  if to_regclass('public.attendance_shift_schedule_slot_idx') is null then raise exception 'merchant_attendance_plan_rule_approvals_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050140 and name='merchant_attendance_plan_rule_approvals') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050140 and name<>'merchant_attendance_plan_rule_approvals') then
    raise exception 'merchant_attendance_plan_rule_approvals_installation_conflict';end if;
  foreach t in array array['merchant_attendance_plan_rule_artifacts','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_streams'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_plan_rule_approvals_installation_conflict';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_plan_rule_command_v1(jsonb)','public.faolla_attendance_plan_rule_fields_v1(jsonb)',
    'public.faolla_attendance_plan_rule_source_v1(jsonb)','public.faolla_attendance_plan_rule_point_v1(jsonb,jsonb,timestamp with time zone)',
    'public.faolla_attendance_plan_rule_same_v1(jsonb,jsonb)','public.faolla_attendance_plan_rule_preview_v1(jsonb,jsonb)',
    'public.faolla_attendance_plan_rule_approvals_v1(jsonb,uuid,jsonb,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_plan_rule_approvals_installation_conflict';end if;
  end loop;
end;
$plan_rules_prerequisites$;

create or replace function public.faolla_attendance_plan_rule_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;
begin
  if not public.faolla_attendance_shift_rule_binding_object_v1(p,array['operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','reason'])
    or octet_length(convert_to(p::text,'UTF8'))>4096 then return false;end if;
  foreach k in array array['operationId','employeeId','employeeAuthUserId'] loop
    if not public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'uuid') then return false;end if;
  end loop;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedRevision','head')
    and (p->>'expectedRevision')::numeric<9007199254740990
    and jsonb_typeof(p->'expectedFingerprint')='string' and p->>'expectedFingerprint'~'^[0-9a-f]{64}$'
    and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'reason','reason');
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- Pure two-field resolver. Fill the two deliberately unused keys only inside
-- the old pure helper; they are neither selected nor saved by this policy.
create or replace function public.faolla_attendance_plan_rule_fields_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare layer text;item jsonb;graph jsonb:='{}';part jsonb;full_rules jsonb;all_fields jsonb;
begin
  foreach layer in array array['personal','group','enterprise'] loop
    part:=p->layer;
    if part='null'::jsonb then graph:=graph||jsonb_build_object(layer,null);continue;end if;
    item:=case when layer='personal' then part->'approval' else part->'publication' end;
    if item<>'null'::jsonb then
      if not public.faolla_attendance_shift_rule_binding_object_v1(item->'rules',array['lateGraceMinutes','earlyGraceMinutes']) then
        raise exception 'attendance_plan_rule_invalid';end if;
      full_rules:=item->'rules'||jsonb_build_object('openSpanWarningMinutes',jsonb_build_object('mode','inherit'),
        'completedBreakMinimumMinutes',jsonb_build_object('mode','inherit'));
      if public.faolla_attendance_rule_values_v1(full_rules) is distinct from true then raise exception 'attendance_plan_rule_invalid';end if;
      item:=item||jsonb_build_object('rules',full_rules);
    end if;
    if layer='personal' then part:=jsonb_build_object('revision',part->'revision','approval',item);
    elsif layer='group' then part:=jsonb_build_object('revision',part->'revision','group',jsonb_build_object('groupId',part->'groupId'),'publication',item);
    else part:=jsonb_build_object('revision',part->'revision','publication',item);end if;
    graph:=graph||jsonb_build_object(layer,part);
  end loop;
  all_fields:=public.faolla_attendance_shift_rule_fields_v1(graph);
  return jsonb_build_object('lateGraceMinutes',all_fields->'lateGraceMinutes','earlyGraceMinutes',all_fields->'earlyGraceMinutes');
end;
$$;

-- Archive validation uses saved UTC and text labels only, never today's IANA
-- conversions or mutable ledgers. The RPC separately checks hash/UTF8 bytes.
create or replace function public.faolla_attendance_plan_rule_source_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;layer text;part jsonb;item jsonb;a jsonb;point_at timestamptz;end_at timestamptz;
begin
  if not public.faolla_attendance_shift_rule_binding_object_v1(p,array['protocol','policy','siteId','workerId','employeeId','employeeAuthUserId',
    'workerVersion','settingsVersion','timeZone','slot','assignment','enterprise','group','personal','fields'])
    or p->>'protocol' is distinct from 'plan-rule-point-v1' or p->>'policy' is distinct from 'owner-approved-plan-start-v1'
    or jsonb_typeof(p->'siteId')<>'string' or coalesce(p->>'siteId','')!~'^\d{8}$'
    or octet_length(convert_to(p::text,'UTF8'))>32768 then return false;end if;
  foreach k in array array['workerId','employeeId','employeeAuthUserId'] loop
    if not public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'uuid') then return false;end if;
  end loop;
  foreach k in array array['workerVersion','settingsVersion'] loop
    if not public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'version') then return false;end if;
  end loop;
  if not public.faolla_attendance_shift_rule_binding_scalar_v1(p->'timeZone','zone')
    or not public.faolla_attendance_shift_rule_binding_object_v1(p->'slot',array['id','revision','locationId','locationVersion','timeZone','startAt','endAt']) then return false;end if;
  foreach k in array array['id','locationId'] loop
    if not public.faolla_attendance_shift_rule_binding_scalar_v1(p->'slot'->k,'uuid') then return false;end if;
  end loop;
  foreach k in array array['revision','locationVersion'] loop
    if not public.faolla_attendance_shift_rule_binding_scalar_v1(p->'slot'->k,'version') then return false;end if;
  end loop;
  if not public.faolla_attendance_shift_rule_binding_scalar_v1(p->'slot'->'timeZone','zone')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p->'slot'->'startAt','stamp3')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p->'slot'->'endAt','stamp3') then return false;end if;
  point_at:=(p->'slot'->>'startAt')::timestamptz;end_at:=(p->'slot'->>'endAt')::timestamptz;
  if end_at<=point_at or end_at-point_at>interval '24 hours' or date_trunc('minute',point_at)<>point_at or date_trunc('minute',end_at)<>end_at then return false;end if;
  a:=p->'assignment';
  if a<>'null'::jsonb then
    if not public.faolla_attendance_shift_rule_binding_object_v1(a,array['assignmentId','revision','groupId','groupName','groupRevision','employeeId','timeZone','fromAt','toAt'])
      or a->'employeeId' is distinct from p->'employeeId' then return false;end if;
    foreach k in array array['assignmentId','groupId','employeeId'] loop
      if not public.faolla_attendance_shift_rule_binding_scalar_v1(a->k,'uuid') then return false;end if;
    end loop;
    if not public.faolla_attendance_shift_rule_binding_scalar_v1(a->'revision','version') or (a->>'revision')::bigint>2
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(a->'groupRevision','version')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(a->'groupName','text80')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(a->'timeZone','zone')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(a->'fromAt','stamp6')
      or (a->>'fromAt')::timestamptz>point_at then return false;end if;
    if a->'toAt'<>'null'::jsonb and (not public.faolla_attendance_shift_rule_binding_scalar_v1(a->'toAt','stamp6')
      or (a->>'toAt')::timestamptz<=point_at) then return false;end if;
  end if;
  if (a='null'::jsonb) is distinct from (p->'group'='null'::jsonb) then return false;end if;
  foreach layer in array array['personal','group','enterprise'] loop
    part:=p->layer;
    if layer='group' and part='null'::jsonb then continue;end if;
    if not public.faolla_attendance_shift_rule_binding_object_v1(part,case when layer='personal' then array['revision','approval']
      when layer='group' then array['groupId','revision','publication'] else array['revision','publication'] end)
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(part->'revision','head') then return false;end if;
    if layer='group' and part->'groupId' is distinct from a->'groupId' then return false;end if;
    item:=case when layer='personal' then part->'approval' else part->'publication' end;
    if item='null'::jsonb then continue;end if;
    if not public.faolla_attendance_shift_rule_binding_object_v1(item,case when layer='personal' then
      array['operationId','revision','actorId','recordedAt','fromAt','toAt','rules'] else array['operationId','revision','actorId','recordedAt','effectiveAt','rules'] end)
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'operationId','uuid')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'actorId','uuid')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'revision','version')
      or (item->>'revision')::bigint>(part->>'revision')::bigint
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'recordedAt','stamp6') then return false;end if;
    if layer='personal' then
      if not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'fromAt','stamp3')
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'toAt','stamp3')
        or (item->>'fromAt')::timestamptz>point_at or (item->>'toAt')::timestamptz<=point_at
        or (item->>'recordedAt')::timestamptz>=(item->>'fromAt')::timestamptz then return false;end if;
    elsif (item->>'revision')::bigint<2 or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'effectiveAt','stamp3')
      or (item->>'effectiveAt')::timestamptz>point_at or (item->>'recordedAt')::timestamptz>=(item->>'effectiveAt')::timestamptz then return false;end if;
  end loop;
  return p->'fields' is not distinct from public.faolla_attendance_plan_rule_fields_v1(p);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or raise_exception then return false;
end;
$$;

-- Only new private storage. No FK is added to existing business tables.
create table if not exists public.merchant_attendance_plan_rule_artifacts(
  merchant_id text not null check(merchant_id~'^\d{8}$'),source_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,source jsonb not null,source_sha256 text not null,source_bytes integer not null,
  primary key(merchant_id,source_id),unique(merchant_id,worker_id,source_sha256),
  unique(merchant_id,source_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  check(source_sha256~'^[0-9a-f]{64}$' and source_sha256=encode(sha256(convert_to(source::text,'UTF8')),'hex')),
  check(source_bytes between 1 and 32768 and source_bytes=octet_length(convert_to(source::text,'UTF8'))),
  check(public.faolla_attendance_plan_rule_source_v1(source)),
  check(source->>'siteId'=merchant_id and source->>'workerId'=worker_id::text and source->'slot'->>'id'=slot_id::text
    and source->>'employeeId'=employee_id::text and source->>'employeeAuthUserId'=employee_auth_user_id::text)
);
create table if not exists public.merchant_attendance_plan_rule_operations(
  merchant_id text not null check(merchant_id~'^\d{8}$'),operation_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740990),actor_auth_user_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,command jsonb not null,source_id uuid not null,
  observed_at timestamptz not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,slot_id,revision),
  unique(merchant_id,slot_id,worker_id,employee_id,employee_auth_user_id,revision),
  foreign key(merchant_id,source_id,worker_id,slot_id,employee_id,employee_auth_user_id)
    references public.merchant_attendance_plan_rule_artifacts(merchant_id,source_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  check(public.faolla_attendance_plan_rule_command_v1(command)),
  check(command->>'operationId'=operation_id::text and (command->>'expectedRevision')::bigint=revision-1
    and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text),
  check(isfinite(observed_at) and isfinite(recorded_at) and observed_at<=recorded_at)
);
create table if not exists public.merchant_attendance_plan_rule_streams(
  merchant_id text not null check(merchant_id~'^\d{8}$'),slot_id uuid not null,worker_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  primary key(merchant_id,slot_id),
  foreign key(merchant_id,slot_id,worker_id,employee_id,employee_auth_user_id,revision)
    references public.merchant_attendance_plan_rule_operations(merchant_id,slot_id,worker_id,employee_id,employee_auth_user_id,revision)
);
do $plan_rules_constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_plan_rule_artifacts'::regclass and conname='attendance_plan_rule_first_operation_fk') then
    alter table public.merchant_attendance_plan_rule_artifacts add constraint attendance_plan_rule_first_operation_fk
      foreign key(merchant_id,source_id) references public.merchant_attendance_plan_rule_operations(merchant_id,operation_id) deferrable initially deferred;
  end if;
end;
$plan_rules_constraints$;
create index if not exists attendance_plan_rule_artifacts_worker_idx on public.merchant_attendance_plan_rule_artifacts(merchant_id,worker_id);
alter table public.merchant_attendance_plan_rule_artifacts enable row level security;
alter table public.merchant_attendance_plan_rule_operations enable row level security;
alter table public.merchant_attendance_plan_rule_streams enable row level security;
revoke all on public.merchant_attendance_plan_rule_artifacts,public.merchant_attendance_plan_rule_operations,public.merchant_attendance_plan_rule_streams from public,anon,authenticated,service_role;
do $plan_rules_triggers$
declare t text;
begin
  foreach t in array array['merchant_attendance_plan_rule_artifacts','merchant_attendance_plan_rule_operations'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname='attendance_plan_rule_immutable') then
      execute format('create trigger attendance_plan_rule_immutable before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname='attendance_plan_rule_no_truncate') then
      execute format('create trigger attendance_plan_rule_no_truncate before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  end loop;
end;
$plan_rules_triggers$;

--130 rows have already been validated. Temporary normalized UTC boundaries are
-- computed once by preview; this pure point selector does not re-query sources.
create or replace function public.faolla_attendance_plan_rule_point_v1(p jsonb,p_slot jsonb,p_at timestamptz)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare row_item jsonb;d jsonb;g jsonb;a jsonb:='null';group_id jsonb:='null';scope_item jsonb;chosen jsonb;part jsonb;layer text;
  internal jsonb:='{}';rules_by_layer jsonb:='{}';source jsonb;n integer:=0;rule_head jsonb;fields jsonb;
begin
  for row_item in select value from jsonb_array_elements(p->'assignments'->'items') loop
    d:=row_item->'detail';
    if d->>'status'='cancelled' or (row_item->>'_fromAt')::timestamptz>p_at
      or row_item->>'_toAt' is not null and (row_item->>'_toAt')::timestamptz<=p_at then continue;end if;
    n:=n+1;if n>1 then raise exception 'attendance_plan_rule_assignment_overlap';end if;
    if d->'employeeId' is distinct from p->'worker'->'employeeId' then raise exception 'attendance_plan_rule_identity_changed';end if;
    g:=row_item->'currentGroup';if g->'active' is distinct from 'true'::jsonb then raise exception 'attendance_plan_rule_group_inactive';end if;
    group_id:=g->'groupId';
    a:=jsonb_build_object('assignmentId',d->'assignmentId','revision',d->'revision','groupId',group_id,'groupName',g->'name',
      'groupRevision',g->'revision','employeeId',d->'employeeId','timeZone',d->'timeZone','fromAt',row_item->'_fromAt','toAt',row_item->'_toAt');
  end loop;
  foreach layer in array array['enterprise','group'] loop
    if layer='group' and group_id='null'::jsonb then internal:=internal||jsonb_build_object(layer,null);rules_by_layer:=rules_by_layer||jsonb_build_object(layer,null);continue;end if;
    scope_item:=null;
    select value into scope_item from jsonb_array_elements(p->'rules'->'items') where value->'groupId'=(case when layer='group' then group_id else 'null'::jsonb end);
    if scope_item is null then raise exception 'attendance_plan_rule_invalid';end if;
    chosen:=null;
    select value into chosen from jsonb_array_elements(scope_item->'publications') where (value->>'effectiveAt')::timestamptz<=p_at
      order by (value->>'effectiveAt')::timestamptz desc limit 1;
    rules_by_layer:=rules_by_layer||jsonb_build_object(layer,chosen->'rules');
    if chosen is not null then chosen:=jsonb_build_object('operationId',chosen->'operationId','revision',chosen->'revision','actorId',chosen->'actorId',
      'recordedAt',chosen->'recordedAt','effectiveAt',chosen->'effectiveAt','rules',jsonb_build_object('lateGraceMinutes',chosen->'rules'->'lateGraceMinutes','earlyGraceMinutes',chosen->'rules'->'earlyGraceMinutes'));end if;
    part:=jsonb_build_object('revision',scope_item->'revision','publication',chosen);
    if layer='group' then part:=part||jsonb_build_object('groupId',group_id);end if;
    internal:=internal||jsonb_build_object(layer,part);
  end loop;
  chosen:=null;n:=0;
  for row_item in select value from jsonb_array_elements(p->'personal'->'items') loop
    d:=row_item->'approval';
    if row_item->'withdrawal'<>'null'::jsonb or (d->>'fromAt')::timestamptz>p_at or (d->>'toAt')::timestamptz<=p_at then continue;end if;
    n:=n+1;if n>1 then raise exception 'attendance_plan_rule_invalid';end if;chosen:=d;
  end loop;
  rules_by_layer:=rules_by_layer||jsonb_build_object('personal',chosen->'rules');
  if chosen is not null then chosen:=jsonb_build_object('operationId',chosen->'operationId','revision',chosen->'revision','actorId',chosen->'actorId',
    'recordedAt',chosen->'recordedAt','fromAt',chosen->'fromAt','toAt',chosen->'toAt',
    'rules',jsonb_build_object('lateGraceMinutes',chosen->'rules'->'lateGraceMinutes','earlyGraceMinutes',chosen->'rules'->'earlyGraceMinutes'));end if;
  rule_head:=p->'personal'->'revision';
  internal:=internal||jsonb_build_object('personal',jsonb_build_object('revision',rule_head,'approval',chosen));
  fields:=public.faolla_attendance_plan_rule_fields_v1(internal);
  source:=jsonb_build_object('protocol','plan-rule-point-v1','policy','owner-approved-plan-start-v1','siteId',p->'siteId',
    'workerId',p->'worker'->'workerId','employeeId',p->'worker'->'employeeId','employeeAuthUserId',p->'worker'->'employeeAuthUserId',
    'workerVersion',p->'worker'->'version','settingsVersion',p->'settingsVersion','timeZone',p->'timeZone','slot',p_slot,
    'assignment',a,'enterprise',internal->'enterprise','group',internal->'group','personal',internal->'personal','fields',fields);
  return jsonb_build_object('source',source,'_rules',rules_by_layer);
end;
$$;

-- Compare only each field's actually consulted inheritance prefix. Later
-- layers cannot affect a personal override. A new operation with identical
-- four rules is a provenance change; ONLY changes to the two unused rules
-- (while both relevant choices match) are ignored.
create or replace function public.faolla_attendance_plan_rule_same_v1(a jsonb,b jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;i integer;x jsonb;y jsonb;layer text;ar jsonb;br jsonb;
begin
  foreach k in array array['lateGraceMinutes','earlyGraceMinutes'] loop
    for i in 0..2 loop
      x:=a->'source'->'fields'->k->'trace'->i;y:=b->'source'->'fields'->k->'trace'->i;layer:=x->>'layer';
      if x->'mode' is distinct from y->'mode' or x->'minutes' is distinct from y->'minutes'
        or x->'groupId' is distinct from y->'groupId' then return false;end if;
      if layer='group' and (a->'source'->'assignment') is distinct from (b->'source'->'assignment') then return false;end if;
      if x->'source' is distinct from y->'source' then
        ar:=a->'_rules'->layer;br:=b->'_rules'->layer;
        if ar is null or br is null or ar='null'::jsonb or br='null'::jsonb
          or ar->'lateGraceMinutes' is distinct from br->'lateGraceMinutes' or ar->'earlyGraceMinutes' is distinct from br->'earlyGraceMinutes'
          or ar is not distinct from br then return false;end if;
      end if;
      if x->>'mode' in('value','disabled') then exit;end if;
    end loop;
  end loop;
  return true;
end;
$$;

create or replace function public.faolla_attendance_plan_rule_preview_v1(p_raw jsonb,p_slot jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare raw jsonb:=p_raw;normalized jsonb:='[]';item jsonb;d jsonb;cache jsonb:='{}';cache_key text;from_at timestamptz;to_at timestamptz;
  start_at timestamptz:=(p_slot->>'startAt')::timestamptz;end_at timestamptz:=(p_slot->>'endAt')::timestamptz;
  boundaries timestamptz[]:='{}';boundary timestamptz;first_point jsonb;previous_point jsonb;next_point jsonb;source jsonb;fingerprint text;failure text;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if raw->'assignments'->'limited' is distinct from 'false'::jsonb or raw->'rules'->'limited' is distinct from 'false'::jsonb
    or raw->'personal'->'limited' is distinct from 'false'::jsonb then
    return jsonb_build_object('fingerprint',null,'observedAt',raw->'readAt','eligible',false,'blockers',jsonb_build_array('source_incomplete'),'source',null);end if;
  for item in select value from jsonb_array_elements(raw->'assignments'->'items') loop
    d:=item->'detail';if d->>'status'='cancelled' then continue;end if;
    cache_key:=jsonb_build_array('start',d->'timeZone',d->'startsOn')::text;from_at:=(cache->>cache_key)::timestamptz;
    if from_at is null then from_at:=public.faolla_attendance_rule_day_start_v1(d->>'startsOn',d->>'timeZone');
      if from_at is null then raise exception 'attendance_plan_rule_invalid';end if;cache:=cache||jsonb_build_object(cache_key,from_at);end if;
    to_at:=null;
    if d->'endsOn'<>'null'::jsonb then
      cache_key:=jsonb_build_array('end',d->'timeZone',d->'endsOn')::text;to_at:=(cache->>cache_key)::timestamptz;
      if to_at is null then to_at:=public.faolla_attendance_personal_rule_end_v1(d->>'endsOn',d->>'timeZone');
        if to_at is null then raise exception 'attendance_plan_rule_invalid';end if;cache:=cache||jsonb_build_object(cache_key,to_at);end if;
    end if;
    normalized:=normalized||jsonb_build_array(item||jsonb_build_object('_fromAt',to_char(from_at at time zone 'UTC',stamp_format),'_toAt',to_char(to_at at time zone 'UTC',stamp_format)));
    boundaries:=array_append(boundaries,from_at);if to_at is not null then boundaries:=array_append(boundaries,to_at);end if;
  end loop;
  raw:=jsonb_set(raw,'{assignments,items}',normalized);
  for item in select pub.value from jsonb_array_elements(raw->'rules'->'items') s cross join lateral jsonb_array_elements(s.value->'publications') pub loop
    boundaries:=array_append(boundaries,(item->>'effectiveAt')::timestamptz);
  end loop;
  for item in select value from jsonb_array_elements(raw->'personal'->'items') where value->'withdrawal'='null'::jsonb loop
    boundaries:=array_append(boundaries,(item->'approval'->>'fromAt')::timestamptz);boundaries:=array_append(boundaries,(item->'approval'->>'toAt')::timestamptz);
  end loop;
  first_point:=public.faolla_attendance_plan_rule_point_v1(raw,p_slot,start_at);source:=first_point->'source';
  if octet_length(convert_to(source::text,'UTF8'))>32768 then raise exception 'attendance_plan_rule_source_too_large';end if;
  if public.faolla_attendance_plan_rule_source_v1(source) is distinct from true then raise exception 'attendance_plan_rule_invalid';end if;
  fingerprint:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
  previous_point:=first_point;
  -- At most two boundaries/assignment, two/personal, one/publication (<=500).
  for boundary in select distinct x from unnest(boundaries) x where x>start_at and x<end_at order by x loop
    next_point:=public.faolla_attendance_plan_rule_point_v1(raw,p_slot,boundary);
    if public.faolla_attendance_plan_rule_same_v1(previous_point,next_point) is distinct from true then
      return jsonb_build_object('fingerprint',fingerprint,'observedAt',raw->'readAt','eligible',false,'blockers',jsonb_build_array('source_switch'),'source',source);end if;
    previous_point:=next_point;
  end loop;
  return jsonb_build_object('fingerprint',fingerprint,'observedAt',raw->'readAt','eligible',true,'blockers','[]'::jsonb,'source',source);
exception when raise_exception then
  get stacked diagnostics failure=message_text;
  if failure in('attendance_plan_rule_assignment_overlap','attendance_plan_rule_group_inactive','attendance_plan_rule_source_too_large') then
    return jsonb_build_object('fingerprint',null,'observedAt',raw->'readAt','eligible',false,
      'blockers',jsonb_build_array(substr(failure,length('attendance_plan_rule_')+1)),'source',null);end if;
  raise;
end;
$$;

create or replace function public.faolla_attendance_plan_rule_approvals_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_module_enabled boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;wid uuid;sid uuid;op uuid;mode_name text;s public.merchant_attendance_settings%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  stream public.merchant_attendance_plan_rule_streams%rowtype;saved public.merchant_attendance_plan_rule_operations%rowtype;
  artifact public.merchant_attendance_plan_rule_artifacts%rowtype;context jsonb;publication jsonb;slot_item jsonb;source_slot jsonb;worker_item jsonb;
  head bigint:=0;preview jsonb:=null;approval jsonb:=null;raw jsonb;source jsonb;fingerprint text;source_size integer;
  blockers jsonb:='[]';stamp timestamptz;observed_at timestamptz;read_at timestamptz;first_day date;last_day date;n bigint;b bigint;result jsonb;
  layer text;source_item jsonb;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_module_enabled is null or not public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','slotId','mode','operationId'])
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','')!~'^\d{8}$'
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid')
    or jsonb_typeof(p_query->'mode')<>'string' or p_query->>'mode' not in('preview','read','recover','approve') then raise exception 'attendance_invalid_request';end if;
  mode_name:=p_query->>'mode';site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;
  if mode_name in('preview','read') then
    if p_query->'operationId'<>'null'::jsonb or p_command is not null then raise exception 'attendance_invalid_request';end if;
  else
    if not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') then raise exception 'attendance_invalid_request';end if;
    op:=(p_query->>'operationId')::uuid;
    if mode_name='recover' and p_command is not null or mode_name='approve' and (p_command is null
      or public.faolla_attendance_plan_rule_command_v1(p_command) is distinct from true or p_command->>'operationId' is distinct from op::text) then
      raise exception 'attendance_invalid_request';end if;
  end if;
  -- Never upgrade an old settings lock or acquire merchant after worker.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_plan_rule_identity_changed';end if;
  if s.version not between 1 and 9007199254740990 or w.version not between 1 and 9007199254740990
    or not public.faolla_attendance_group_text_v1(w.display_name,1,120) or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) then
    raise exception 'attendance_plan_rule_invalid';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',e.id,
    'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
  select * into slot from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=wid and x.id=sid;
  if slot.id is null then raise exception 'attendance_plan_rule_not_found';end if;
  if slot.employee_id is distinct from e.id then raise exception 'attendance_plan_rule_identity_changed';end if;
  context:=public.faolla_attendance_self_schedule_slot_v1(slot);slot_item:=context->'slot';publication:=nullif(context->'publication','null'::jsonb);
  if publication is not null and (publication->>'employeeId' is distinct from e.id::text
    or publication->>'employeeAuthUserId' is distinct from e.auth_user_id::text) then raise exception 'attendance_plan_rule_identity_changed';end if;
  -- New merchant namespace only: serialize CAS, original-number replay, dedup
  -- and quota. Ordinary preview/read/recover never acquire this advisory lock.
  if mode_name='approve' then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-rule-approvals:v1:'||site,0));end if;
  select * into stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=site and x.slot_id=sid;
  if found then
    if stream.worker_id is distinct from wid or stream.employee_id is distinct from e.id or stream.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_plan_rule_identity_changed';end if;head:=stream.revision;
  end if;
  if mode_name in('recover','approve') then
    select * into saved from public.merchant_attendance_plan_rule_operations x where x.merchant_id=site and x.operation_id=op;
    if found then
      if saved.worker_id<>wid or saved.slot_id<>sid or saved.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if saved.employee_id is distinct from e.id or saved.employee_auth_user_id is distinct from e.auth_user_id then raise exception 'attendance_plan_rule_identity_changed';end if;
      if mode_name='approve' and saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      -- READ COMMITTED recovery may see an operation committed after the first
      -- head query. Re-read its monotonic head after that immutable operation;
      -- do not turn a successful concurrent approval into an invalid receipt.
      if mode_name='recover' then
        select * into stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=site and x.slot_id=sid;
        if not found or stream.worker_id is distinct from wid or stream.employee_id is distinct from e.id
          or stream.employee_auth_user_id is distinct from e.auth_user_id then raise exception 'attendance_plan_rule_invalid';end if;
        head:=stream.revision;
      end if;
    end if;
  elsif mode_name='read' and head>0 then
    select * into saved from public.merchant_attendance_plan_rule_operations x where x.merchant_id=site and x.slot_id=sid and x.revision=head;
    if not found then raise exception 'attendance_plan_rule_invalid';end if;
  end if;

  -- Existing exact operations bypass new-operation eligibility, including
  -- pause/time/activity. No existing observation is recomputed or overwritten.
  if mode_name='preview' or mode_name='approve' and saved.operation_id is null then
    if mode_name='approve' then
      if not p_module_enabled or not s.enabled then raise exception 'attendance_platform_paused';end if;
      if p_command->>'employeeId' is distinct from e.id::text or p_command->>'employeeAuthUserId' is distinct from e.auth_user_id::text then
        raise exception 'attendance_plan_rule_identity_changed';end if;
      if (p_command->>'expectedRevision')::bigint<>head then raise exception 'attendance_version_conflict';end if;
    end if;
    stamp:=clock_timestamp();
    if not p_module_enabled or not s.enabled then blockers:=blockers||jsonb_build_array('module_paused');end if;
    if not w.active or e.status<>'active' then blockers:=blockers||jsonb_build_array('worker_inactive');end if;
    if publication is null or slot_item->'hasPublicationEvidence' is distinct from 'true'::jsonb then blockers:=blockers||jsonb_build_array('publication_missing');end if;
    if slot_item->'cancelled'='true'::jsonb then blockers:=blockers||jsonb_build_array('cancelled');end if;
    if stamp>=slot.start_at then blockers:=blockers||jsonb_build_array('started');end if;
    -- Worker SHARE also freezes new137 relations. This indexed existence check
    -- means an explicit associated clock, not all clocks/time-based allocation.
    if exists(select 1 from public.merchant_attendance_shift_schedule_relations r
      where r.merchant_id=site and r.slot_id=sid and r.slot_id is not null limit 1) then blockers:=blockers||jsonb_build_array('associated');end if;
    if jsonb_array_length(blockers)>0 then
      preview:=jsonb_build_object('fingerprint',null,'observedAt',to_char(stamp at time zone 'UTC',stamp_format),'eligible',false,'blockers',blockers,'source',null);
    else
      first_day:=(slot.start_at at time zone s.time_zone)::date;last_day:=((slot.end_at-interval '1 microsecond') at time zone s.time_zone)::date;
      raw:=public.faolla_attendance_rule_sources_v1(jsonb_build_object('siteId',site,'workerId',wid,'fromDate',to_char(first_day,'YYYY-MM-DD'),'throughDate',to_char(last_day,'YYYY-MM-DD')),p_auth_user_id);
      if raw->'worker' is distinct from worker_item or raw->'settingsVersion' is distinct from to_jsonb(s.version) or raw->>'timeZone' is distinct from s.time_zone then
        raise exception 'attendance_plan_rule_invalid';end if;
      source_slot:=jsonb_build_object('id',slot.id,'revision',slot.revision,'locationId',slot.location_id,'locationVersion',publication->'locationVersion',
        'timeZone',slot.time_zone,'startAt',slot_item->'startAt','endAt',slot_item->'endAt');
      preview:=public.faolla_attendance_plan_rule_preview_v1(raw,source_slot);
      if clock_timestamp()>=slot.start_at then preview:=jsonb_build_object('fingerprint',null,'observedAt',preview->'observedAt','eligible',false,'blockers',jsonb_build_array('started'),'source',null);end if;
    end if;
    if mode_name='approve' then
      if preview->'eligible' is distinct from 'true'::jsonb then raise exception 'attendance_plan_rule_blocked';end if;
      if preview->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_plan_rule_source_conflict';end if;
      source:=preview->'source';fingerprint:=preview->>'fingerprint';observed_at:=(preview->>'observedAt')::timestamptz;
      source_size:=octet_length(convert_to(source::text,'UTF8'));
      select count(*) into n from (select 1 from public.merchant_attendance_plan_rule_operations x where x.merchant_id=site limit 1000) q;
      if n>=1000 then raise exception 'attendance_plan_rule_limit';end if;
      select * into artifact from public.merchant_attendance_plan_rule_artifacts x where x.merchant_id=site and x.worker_id=wid and x.source_sha256=fingerprint;
      if found then
        if artifact.source is distinct from source then raise exception 'attendance_plan_rule_invalid';end if;
      else
        select count(*),coalesce(sum(x.source_bytes),0) into n,b from
          (select a.source_bytes from public.merchant_attendance_plan_rule_artifacts a where a.merchant_id=site and a.worker_id=wid limit 51) x;
        if n>=50 or b+source_size>8388608 then raise exception 'attendance_plan_rule_limit';end if;
        select count(*),coalesce(sum(x.source_bytes),0) into n,b from
          (select a.source_bytes from public.merchant_attendance_plan_rule_artifacts a where a.merchant_id=site limit 501) x;
        if n>=500 or b+source_size>67108864 then raise exception 'attendance_plan_rule_limit';end if;
        insert into public.merchant_attendance_plan_rule_artifacts(merchant_id,source_id,worker_id,slot_id,employee_id,employee_auth_user_id,source,source_sha256,source_bytes)
          values(site,op,wid,sid,e.id,e.auth_user_id,source,fingerprint,source_size) returning * into artifact;
      end if;
      -- This is an in-transaction eligibility timestamp, NOT a commit timestamp.
      stamp:=clock_timestamp();
      if not isfinite(stamp) or stamp<observed_at then raise exception 'attendance_plan_rule_invalid';end if;
      if stamp>=slot.start_at then raise exception 'attendance_plan_rule_blocked';end if;
      insert into public.merchant_attendance_plan_rule_operations(merchant_id,operation_id,worker_id,slot_id,revision,actor_auth_user_id,employee_id,
        employee_auth_user_id,command,source_id,observed_at,recorded_at)
        values(site,op,wid,sid,head+1,p_auth_user_id,e.id,e.auth_user_id,p_command,artifact.source_id,observed_at,stamp) returning * into saved;
      insert into public.merchant_attendance_plan_rule_streams(merchant_id,slot_id,worker_id,employee_id,employee_auth_user_id,revision)
        values(site,sid,wid,e.id,e.auth_user_id,head+1)
        on conflict(merchant_id,slot_id) do update set revision=excluded.revision;
      head:=head+1;
    end if;
  end if;

  if saved.operation_id is not null then
    select * into artifact from public.merchant_attendance_plan_rule_artifacts x where x.merchant_id=site and x.source_id=saved.source_id;
    if artifact.source_id is null or saved.worker_id is distinct from wid or saved.slot_id is distinct from sid
      or saved.employee_id is distinct from e.id or saved.employee_auth_user_id is distinct from e.auth_user_id
      or saved.revision>head or public.faolla_attendance_plan_rule_command_v1(saved.command) is distinct from true
      or saved.command->>'operationId' is distinct from saved.operation_id::text or (saved.command->>'expectedRevision')::bigint<>saved.revision-1
      or saved.command->>'employeeId' is distinct from e.id::text or saved.command->>'employeeAuthUserId' is distinct from e.auth_user_id::text
      or saved.command->>'expectedFingerprint' is distinct from artifact.source_sha256
      or row(artifact.worker_id,artifact.slot_id,artifact.employee_id,artifact.employee_auth_user_id) is distinct from row(wid,sid,e.id,e.auth_user_id)
      or artifact.source_sha256 is distinct from encode(sha256(convert_to(artifact.source::text,'UTF8')),'hex')
      or artifact.source_bytes is distinct from octet_length(convert_to(artifact.source::text,'UTF8'))
      or public.faolla_attendance_plan_rule_source_v1(artifact.source) is distinct from true
      or saved.observed_at>saved.recorded_at or saved.recorded_at>=slot.start_at
      or artifact.source->'slot'->>'id' is distinct from sid::text or artifact.source->'slot'->>'revision' is distinct from slot.revision::text
      or artifact.source->'slot'->'startAt' is distinct from slot_item->'startAt' or artifact.source->'slot'->'endAt' is distinct from slot_item->'endAt'
      or artifact.source->'slot'->'locationId' is distinct from slot_item->'locationId' or artifact.source->'slot'->'timeZone' is distinct from slot_item->'timeZone'
      or artifact.source->>'siteId' is distinct from site or artifact.source->>'workerId' is distinct from wid::text
      or artifact.source->>'employeeId' is distinct from e.id::text or artifact.source->>'employeeAuthUserId' is distinct from e.auth_user_id::text
      or (artifact.source->>'workerVersion')::bigint>w.version or (artifact.source->>'settingsVersion')::bigint>s.version then
      raise exception 'attendance_plan_rule_invalid';end if;
    foreach layer in array array['personal','group','enterprise'] loop
      source_item:=case when layer='personal' then artifact.source->layer->'approval' else artifact.source->layer->'publication' end;
      if source_item is not null and source_item<>'null'::jsonb and (source_item->>'recordedAt')::timestamptz>saved.observed_at then
        raise exception 'attendance_plan_rule_invalid';end if;
    end loop;
    approval:=jsonb_build_object('operationId',saved.operation_id,'revision',saved.revision,'actorId',saved.actor_auth_user_id,'command',saved.command,
      'observedAt',to_char(saved.observed_at at time zone 'UTC',stamp_format),'recordedAt',to_char(saved.recorded_at at time zone 'UTC',stamp_format),
      'sourceId',artifact.source_id,'sourceSha256',artifact.source_sha256,'sourceBytes',artifact.source_bytes,'source',artifact.source);
  end if;
  read_at:=clock_timestamp();
  if not isfinite(read_at) or saved.recorded_at is not null and read_at<saved.recorded_at
    or preview is not null and read_at<(preview->>'observedAt')::timestamptz then raise exception 'attendance_plan_rule_invalid';end if;
  result:=jsonb_build_object('protocol','plan-rule-approvals-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'slot',slot_item,
    'revision',head,'preview',case when mode_name='preview' then preview else null end,'approval',approval,'readAt',to_char(read_at at time zone 'UTC',stamp_format));
  if octet_length(convert_to(result::text,'UTF8'))>65536 then raise exception 'attendance_plan_rule_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
  raise exception 'attendance_plan_rule_invalid';
end;
$$;

revoke all on function public.faolla_attendance_plan_rule_command_v1(jsonb),public.faolla_attendance_plan_rule_fields_v1(jsonb),
  public.faolla_attendance_plan_rule_source_v1(jsonb),public.faolla_attendance_plan_rule_point_v1(jsonb,jsonb,timestamptz),
  public.faolla_attendance_plan_rule_same_v1(jsonb,jsonb),public.faolla_attendance_plan_rule_preview_v1(jsonb,jsonb),
  public.faolla_attendance_plan_rule_approvals_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_plan_rule_approvals_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050140,'merchant_attendance_plan_rule_approvals') on conflict(version) do nothing;

do $plan_rules_postconditions$
declare t text;r text;p text;fn regprocedure;trig text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050140 and name='merchant_attendance_plan_rule_approvals') then
    raise exception 'merchant_attendance_plan_rule_approvals_registry_postcondition_failed';end if;
  foreach t in array array['merchant_attendance_plan_rule_artifacts','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_streams'] loop
    if not exists(select 1 from pg_class where oid=('public.'||t)::regclass and relrowsecurity)
      or exists(select 1 from pg_policy where polrelid=('public.'||t)::regclass) then raise exception 'merchant_attendance_plan_rule_approvals_rls_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=('public.'||t)::regclass and
        (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then
        raise exception 'merchant_attendance_plan_rule_approvals_acl_postcondition_failed';end if;
    end loop;
    if t='merchant_attendance_plan_rule_streams' then continue;end if;
    foreach trig in array array['attendance_plan_rule_immutable','attendance_plan_rule_no_truncate'] loop
      if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=trig and not tgisinternal and tgenabled='O'
        and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure
        and tgtype=(case when trig='attendance_plan_rule_immutable' then 27 else 34 end)) then
        raise exception 'merchant_attendance_plan_rule_approvals_immutable_postcondition_failed';end if;
    end loop;
  end loop;
  foreach p in array array['public.faolla_attendance_plan_rule_command_v1(jsonb)','public.faolla_attendance_plan_rule_fields_v1(jsonb)',
    'public.faolla_attendance_plan_rule_source_v1(jsonb)','public.faolla_attendance_plan_rule_point_v1(jsonb,jsonb,timestamp with time zone)',
    'public.faolla_attendance_plan_rule_same_v1(jsonb,jsonb)','public.faolla_attendance_plan_rule_preview_v1(jsonb,jsonb)',
    'public.faolla_attendance_plan_rule_approvals_v1(jsonb,uuid,jsonb,boolean)'] loop
    fn:=p::regprocedure;
    if not exists(select 1 from pg_proc where oid=fn and proconfig=array['search_path=pg_catalog']
      and prosecdef=(p like '%plan_rule_approvals_v1%')) then raise exception 'merchant_attendance_plan_rule_approvals_definition_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p,'EXECUTE') is distinct from (r='service_role' and p like '%plan_rule_approvals_v1%') then
        raise exception 'merchant_attendance_plan_rule_approvals_acl_postcondition_failed';end if;
    end loop;
    if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      where f.oid=fn and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'merchant_attendance_plan_rule_approvals_acl_postcondition_failed';end if;
  end loop;
end;
$plan_rules_postconditions$;
notify pgrst, 'reload schema';
commit;
