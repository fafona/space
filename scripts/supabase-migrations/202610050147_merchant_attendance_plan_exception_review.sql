-- Independent, append-only single-plan review. No old facts, writer, roles,
-- leave/correction ledger or notification table is modified. A read ack is not
-- agreement. Employee detail is historical and NEVER impersonates the owner.
begin;
set local lock_timeout='3s';
do $plan_exception_review_prerequisites$
declare installed boolean;t text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610050146 and name='merchant_attendance_plan_exception_source')
    or to_regprocedure('public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)') is null
    or to_regprocedure('public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])') is null
    or to_regprocedure('public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)') is null
    or to_regprocedure('public.faolla_attendance_events_append_only_v1()') is null then
    raise exception 'merchant_attendance_plan_exception_review_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050147 and name='merchant_attendance_plan_exception_review') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050147 and name<>'merchant_attendance_plan_exception_review') then
    raise exception 'merchant_attendance_plan_exception_review_installation_conflict';end if;
  foreach t in array array['merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_plan_exception_reads'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_plan_exception_review_installation_conflict';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_plan_exception_review_command_v1(text,jsonb)',
    'public.faolla_attendance_plan_exception_review_evidence_v1(jsonb)',
    'public.faolla_attendance_plan_exception_review_v1(jsonb,uuid,jsonb,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_plan_exception_review_installation_conflict';end if;
  end loop;
  if installed<>(exists(select 1 from pg_proc f
    where f.pronamespace=(select pronamespace from pg_proc where oid=to_regprocedure('public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)'))
      and f.proname='faolla_attendance_plan_exception_review_entry_v1')) then
    raise exception 'merchant_attendance_plan_exception_review_installation_conflict';end if;
  if installed then
    if to_regprocedure('public.faolla_attendance_plan_exception_review_entry_v1(public.merchant_attendance_plan_exception_entries)') is null then
      raise exception 'merchant_attendance_plan_exception_review_installation_conflict';end if;
  end if;
end;
$plan_exception_review_prerequisites$;

create or replace function public.faolla_attendance_plan_exception_review_command_v1(mode_name text,p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
  if mode_name is null or mode_name not in('decide','note','ack') or octet_length(convert_to(p::text,'UTF8'))>4096
    or public.faolla_attendance_shift_rule_binding_object_v1(p,case mode_name
      when 'decide' then array['operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','outcome','note']
      when 'note' then array['operationId','expectedRevision','decisionOperationId','note']
      else array['operationId','decisionOperationId'] end) is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true then return false;end if;
  if mode_name<>'ack' then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedRevision','head') is distinct from true
      or (p->>'expectedRevision')::numeric>=9007199254740990 or jsonb_typeof(p->'note')<>'string'
      or public.faolla_attendance_group_text_v1(p->>'note',1,500) is distinct from true then return false;end if;
  end if;
  if mode_name='decide' then
    return public.faolla_attendance_shift_rule_binding_scalar_v1(p->'employeeId','uuid') is true
      and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'employeeAuthUserId','uuid') is true
      and jsonb_typeof(p->'expectedFingerprint')='string' and p->>'expectedFingerprint'~'^[0-9a-f]{64}$'
      and jsonb_typeof(p->'outcome')='string' and p->>'outcome' in('confirmed','excused','follow_up');
  end if;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(p->'decisionOperationId','uuid') is true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- Compact evidence keeps actual immutable source references, not just an opaque
-- hash. It is not a replayable copy of146's complete source or a payroll record.
create or replace function public.faolla_attendance_plan_exception_review_evidence_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;part jsonb;item jsonb;field jsonb;ref_keys text[];previous text;current_key text;
begin
  if octet_length(convert_to(p::text,'UTF8'))>131072
    or public.faolla_attendance_shift_rule_binding_object_v1(p,array['policy','fingerprint','observedAt','eligible','blockers','candidate','approval','sessions','contextRefs']) is distinct from true
    or p->'policy' is distinct from '"owner-confirmed-plan-edges-v1"'::jsonb
    or jsonb_typeof(p->'fingerprint')<>'string' or p->>'fingerprint'!~'^[0-9a-f]{64}$'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'observedAt','stamp6') is distinct from true
    or jsonb_typeof(p->'eligible')<>'boolean' or jsonb_typeof(p->'blockers')<>'array'
    or jsonb_array_length(p->'blockers')>32 or jsonb_typeof(p->'sessions')<>'array' or jsonb_array_length(p->'sessions')>10
    or public.faolla_attendance_shift_rule_binding_object_v1(p->'candidate',array['late','early','original','selected']) is distinct from true
    or public.faolla_attendance_shift_rule_binding_object_v1(p->'contextRefs',array['unassociated','leave','calendar','missing','pendingCorrections']) is distinct from true then return false;end if;
  if (p->>'eligible')::boolean<>(jsonb_array_length(p->'blockers')=0)
    or exists(select 1 from jsonb_array_elements(p->'blockers') x where jsonb_typeof(x)<>'string')
    or exists(select 1 from jsonb_array_elements_text(p->'blockers') x where x not in('plan_not_ended','slot_cancelled','publication_missing','worker_inactive',
      'no_associated_sessions','association_unverified','adoption_missing','adoption_unverified','approval_mismatch','session_open','session_zero_duration',
      'session_outside_plan','session_overlap','session_location_mismatch','context_unknown','unassociated_session','leave_pending','leave_approved',
      'calendar_entry','missing_request','pending_correction'))
    or (select count(*)<>count(distinct x) from jsonb_array_elements(p->'blockers') x) then return false;end if;
  foreach k in array array['late','early'] loop
    field:=p->'candidate'->k;
    if public.faolla_attendance_shift_rule_binding_object_v1(field,array['state','minutes','rawDeltaUs','excessUs']) is distinct from true
      or jsonb_typeof(field->'state')<>'string' or field->>'state' not in('blocked','unconfigured','disabled','triggered','not_triggered') then return false;end if;
    if field->>'state' in('triggered','not_triggered') then
      if jsonb_typeof(field->'minutes')<>'number' or field->>'minutes'!~'^(0|[1-9][0-9]*)$' or (field->>'minutes')::numeric>1440
        or jsonb_typeof(field->'rawDeltaUs')<>'string' or field->>'rawDeltaUs'!~'^(0|-?[1-9][0-9]*)$'
        or jsonb_typeof(field->'excessUs')<>'string' or field->>'excessUs'!~'^(0|[1-9][0-9]*)$'
        or (field->>'excessUs')::numeric<>greatest(0,(field->>'rawDeltaUs')::numeric-(field->>'minutes')::numeric*60000000)
        or (field->>'state'='triggered')<>((field->>'excessUs')::numeric>0) then return false;end if;
    elsif field->'minutes'<>'null'::jsonb or field->'rawDeltaUs'<>'null'::jsonb or field->'excessUs'<>'null'::jsonb then return false;end if;
    if (field->>'state'='blocked')=(p->>'eligible')::boolean then return false;end if;
  end loop;
  foreach k in array array['original','selected'] loop
    part:=p->'candidate'->k;
    if public.faolla_attendance_shift_rule_binding_object_v1(part,array['startAt','endAt']) is distinct from true then return false;end if;
    if part->'startAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(part->'startAt','stamp6') is distinct from true
      or part->'endAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(part->'endAt','stamp6') is distinct from true then return false;end if;
  end loop;
  part:=p->'approval';
  if part<>'null'::jsonb then
    if public.faolla_attendance_shift_rule_binding_object_v1(part,array['operationId','revision','sourceId','sourceSha256','recordedAt']) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(part->'operationId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(part->'sourceId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(part->'revision','version') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(part->'recordedAt','stamp6') is distinct from true
      or jsonb_typeof(part->'sourceSha256')<>'string' or part->>'sourceSha256'!~'^[0-9a-f]{64}$' then return false;end if;
  end if;
  foreach k in array array['sessions','unassociated','leave','calendar','missing','pendingCorrections'] loop
    if k='sessions' then part:=jsonb_build_object('limited',false,'items',p->'sessions');
    else part:=p->'contextRefs'->k;end if;
    if public.faolla_attendance_shift_rule_binding_object_v1(part,array['limited','items']) is distinct from true
      or jsonb_typeof(part->'limited')<>'boolean' or jsonb_typeof(part->'items')<>'array'
      or jsonb_array_length(part->'items')>100 or (part->>'limited')::boolean and part->'items'<>'[]'::jsonb then return false;end if;
    previous:=null;
    for item in select value from jsonb_array_elements(part->'items') loop
      ref_keys:=case when k in('sessions','unassociated') then array['startEventId','lastEventId','lastSequence','effectOperationId']
        when k='calendar' then array['entryId','operationId','revision']
        when k='pendingCorrections' then array['kind','requestId','operationId','revision','startEventId']
        else array['requestId','operationId','revision'] end;
      if public.faolla_attendance_shift_rule_binding_object_v1(item,ref_keys) is distinct from true then return false;end if;
      if k in('sessions','unassociated') then
        if public.faolla_attendance_shift_rule_binding_scalar_v1(item->'startEventId','uuid') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'lastEventId','uuid') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'lastSequence','version') is distinct from true
          or item->'effectOperationId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(item->'effectOperationId','uuid') is distinct from true then return false;end if;
        current_key:=item->>'startEventId';
      else
        if public.faolla_attendance_shift_rule_binding_scalar_v1(item->case when k='calendar' then 'entryId' else 'requestId' end,'uuid') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'operationId','uuid') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'revision','version') is distinct from true then return false;end if;
        current_key:=case when k='calendar' then item->>'entryId' else item->>'requestId' end;
        if k='pendingCorrections' then
          if jsonb_typeof(item->'kind')<>'string' or item->>'kind' not in('correction','revision') or public.faolla_attendance_shift_rule_binding_scalar_v1(item->'startEventId','uuid') is distinct from true then return false;end if;
          current_key:=(item->>'kind')||':'||current_key;
        end if;
      end if;
      if previous is not null and current_key<=previous then return false;end if;previous:=current_key;
    end loop;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$$;

create table if not exists public.merchant_attendance_plan_exception_cases(
  merchant_id text not null check(merchant_id~'^[0-9]{8}$'),case_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,worker_name text not null,worker_no text not null,
  slot_start_at timestamptz not null,slot_end_at timestamptz not null,time_zone text not null,opened_at timestamptz not null,
  primary key(merchant_id,case_id),unique(merchant_id,slot_id),
  unique(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  check(public.faolla_attendance_group_text_v1(worker_name,1,120) and public.faolla_attendance_group_text_v1(worker_no,1,40)
    and public.faolla_attendance_group_text_v1(time_zone,1,100)),
  check(isfinite(slot_start_at) and isfinite(slot_end_at) and slot_end_at>slot_start_at and isfinite(opened_at))
);
create table if not exists public.merchant_attendance_plan_exception_entries(
  merchant_id text not null,operation_id uuid not null,case_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  actor_auth_user_id uuid not null,kind text not null,command jsonb not null,evidence jsonb null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,case_id,revision),
  foreign key(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id)
    references public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  check(kind in('decision','note') and public.faolla_attendance_plan_exception_review_command_v1(case kind when 'decision' then 'decide' else 'note' end,command) is true),
  check(command->>'operationId'=operation_id::text and (command->>'expectedRevision')::bigint=revision-1 and isfinite(recorded_at)),
  check((kind='decision' and evidence is not null and public.faolla_attendance_plan_exception_review_evidence_v1(evidence) is true
      and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text
      and command->>'expectedFingerprint'=evidence->>'fingerprint' and (evidence->>'observedAt')::timestamptz<=recorded_at)
    or (kind='note' and evidence is null and actor_auth_user_id=employee_auth_user_id))
);
create table if not exists public.merchant_attendance_plan_exception_reads(
  merchant_id text not null,operation_id uuid not null,case_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,decision_operation_id uuid not null,command jsonb not null,read_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,decision_operation_id),
  foreign key(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id)
    references public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  foreign key(merchant_id,decision_operation_id) references public.merchant_attendance_plan_exception_entries(merchant_id,operation_id),
  check(public.faolla_attendance_plan_exception_review_command_v1('ack',command) is true
    and command->>'operationId'=operation_id::text and command->>'decisionOperationId'=decision_operation_id::text and isfinite(read_at))
);
do $plan_exception_review_fk$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_plan_exception_cases'::regclass and conname='attendance_plan_exception_first_entry_fk') then
    alter table public.merchant_attendance_plan_exception_cases add constraint attendance_plan_exception_first_entry_fk
      foreign key(merchant_id,case_id) references public.merchant_attendance_plan_exception_entries(merchant_id,operation_id) deferrable initially deferred;
  end if;
end;
$plan_exception_review_fk$;
create index if not exists attendance_plan_exception_owner_list_idx on public.merchant_attendance_plan_exception_cases(merchant_id,opened_at desc,case_id desc);
create index if not exists attendance_plan_exception_worker_list_idx on public.merchant_attendance_plan_exception_cases(merchant_id,worker_id,opened_at desc,case_id desc);
create index if not exists attendance_plan_exception_self_list_idx on public.merchant_attendance_plan_exception_cases(merchant_id,worker_id,employee_id,employee_auth_user_id,opened_at desc,case_id desc);
create index if not exists attendance_plan_exception_latest_decision_idx on public.merchant_attendance_plan_exception_entries(merchant_id,case_id,revision desc) where kind='decision';
alter table public.merchant_attendance_plan_exception_cases enable row level security;
alter table public.merchant_attendance_plan_exception_entries enable row level security;
alter table public.merchant_attendance_plan_exception_reads enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_plan_exception_cases'::regclass,
      'public.merchant_attendance_plan_exception_entries'::regclass,
      'public.merchant_attendance_plan_exception_reads'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_plan_exception_cases,public.merchant_attendance_plan_exception_entries,public.merchant_attendance_plan_exception_reads from public,anon,authenticated,service_role;
do $plan_exception_review_immutable$
declare t text;
begin
  foreach t in array array['merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_plan_exception_reads'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname='attendance_plan_exception_immutable') then
      execute format('create trigger attendance_plan_exception_immutable before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname='attendance_plan_exception_no_truncate') then
      execute format('create trigger attendance_plan_exception_no_truncate before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  end loop;
end;
$plan_exception_review_immutable$;

create or replace function public.faolla_attendance_plan_exception_review_entry_v1(p public.merchant_attendance_plan_exception_entries)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare c public.merchant_attendance_plan_exception_cases%rowtype;previous public.merchant_attendance_plan_exception_entries%rowtype;
  target public.merchant_attendance_plan_exception_entries%rowtype;
begin
  select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=p.merchant_id and case_id=p.case_id;
  if c.case_id is null or p.worker_id is distinct from c.worker_id or p.slot_id is distinct from c.slot_id
    or p.employee_id is distinct from c.employee_id or p.employee_auth_user_id is distinct from c.employee_auth_user_id
    or p.revision<1 or not isfinite(p.recorded_at) or p.recorded_at<c.opened_at
    or public.faolla_attendance_plan_exception_review_command_v1(case p.kind when 'decision' then 'decide' when 'note' then 'note' end,p.command) is distinct from true
    or p.command->>'operationId' is distinct from p.operation_id::text or p.command->>'expectedRevision' is distinct from (p.revision-1)::text then
    raise exception 'attendance_plan_exception_review_invalid';end if;
  if p.revision=1 then
    if p.kind<>'decision' or p.operation_id<>c.case_id or p.recorded_at<>c.opened_at then raise exception 'attendance_plan_exception_review_invalid';end if;
  else
    select * into previous from public.merchant_attendance_plan_exception_entries where merchant_id=p.merchant_id and case_id=p.case_id and revision=p.revision-1;
    if previous.operation_id is null or previous.recorded_at>p.recorded_at then raise exception 'attendance_plan_exception_review_invalid';end if;
  end if;
  if p.kind='decision' then
    if public.faolla_attendance_plan_exception_review_evidence_v1(p.evidence) is distinct from true
      or p.command->>'employeeId' is distinct from p.employee_id::text or p.command->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
      or p.command->>'expectedFingerprint' is distinct from p.evidence->>'fingerprint' or (p.evidence->>'observedAt')::timestamptz>p.recorded_at
      or p.command->>'outcome'<>'follow_up' and (p.evidence->>'eligible'<>'true'
        or not(p.evidence->'candidate'->'late'->>'state'='triggered' or p.evidence->'candidate'->'early'->>'state'='triggered')) then
      raise exception 'attendance_plan_exception_review_invalid';end if;
  else
    select * into target from public.merchant_attendance_plan_exception_entries where merchant_id=p.merchant_id and operation_id=(p.command->>'decisionOperationId')::uuid;
    if p.evidence is not null or p.actor_auth_user_id<>p.employee_auth_user_id or target.kind is distinct from 'decision'
      or target.case_id is distinct from p.case_id or target.revision>=p.revision then raise exception 'attendance_plan_exception_review_invalid';end if;
  end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'actorId',p.actor_auth_user_id,'kind',p.kind,
    'outcome',case when p.kind='decision' then p.command->'outcome' else 'null'::jsonb end,'note',p.command->'note',
    'decisionOperationId',case when p.kind='note' then p.command->'decisionOperationId' else 'null'::jsonb end,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'evidence',p.evidence);
end;
$$;

create or replace function public.faolla_attendance_plan_exception_review_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;wid uuid;sid uuid;op uuid;cursor_at timestamptz;cursor_id uuid;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  r public.merchant_enterprise_roles%rowtype;c public.merchant_attendance_plan_exception_cases%rowtype;
  entry_row public.merchant_attendance_plan_exception_entries%rowtype;saved public.merchant_attendance_plan_exception_entries%rowtype;
  latest public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  saved_read public.merchant_attendance_plan_exception_reads%rowtype;
  source_result jsonb:=null;current_item jsonb:=null;evidence jsonb;refs jsonb;part jsonb;ref_item jsonb;ref_items jsonb;k text;
  worker_item jsonb;items jsonb:='[]';history jsonb:='[]';detail jsonb:=null;receipt jsonb:=null;read_receipt jsonb:=null;
  latest_item jsonb:=null;item jsonb;next_cursor jsonb:=null;result jsonb;head bigint:=0;row_count integer:=0;
  history_truncated boolean:=false;checked boolean:=false;stale boolean:=null;stamp timestamptz;last_at timestamptz;read_at timestamptz;
  n bigint;bytes bigint;current_employee uuid;current_auth uuid;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','workerId','slotId','operationId','beforeAt','beforeId']) is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string'
    or char_length(p_query->>'siteId')<>8 or p_query->>'siteId'!~'^[0-9]{8}$' or jsonb_typeof(p_query->'access')<>'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode')<>'string' or p_query->>'mode' not in('list','detail','recover','decide','note','ack') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  foreach k in array array['workerId','slotId','operationId','beforeId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;op:=(p_query->>'operationId')::uuid;
  cursor_at:=(p_query->>'beforeAt')::timestamptz;cursor_id:=(p_query->>'beforeId')::uuid;
  if mode_name='list' then
    if sid is not null or op is not null or p_command is not null or (cursor_at is null)<>(cursor_id is null) then raise exception 'attendance_invalid_request';end if;
  else
    if wid is null or sid is null or cursor_at is not null or cursor_id is not null
      or (mode_name='detail')<>(op is null) then raise exception 'attendance_invalid_request';end if;
    if mode_name in('detail','recover') then
      if p_command is not null then raise exception 'attendance_invalid_request';end if;
    elsif public.faolla_attendance_plan_exception_review_command_v1(mode_name,p_command) is distinct from true
      or p_command->>'operationId' is distinct from op::text then raise exception 'attendance_invalid_request';end if;
  end if;
  if mode_name='decide' and access_name<>'owner' or mode_name in('note','ack') and access_name<>'self' then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    -- Resolve the employee ID without locking, then follow the shared
    -- merchant/settings -> worker -> employee -> role order. The locked
    -- reread below rechecks the same authenticated binding after any wait.
    select id into current_employee from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if current_employee is null then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=current_employee for share;
    select * into e from public.merchant_enterprise_employees where merchant_id=site and id=current_employee and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if not found or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not('attendance.self.view'=any(r.permissions)) then raise exception 'attendance_access_denied';end if;
    if w.id is not null and w.employee_id is distinct from e.id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if wid is not null and w.id is distinct from wid then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    wid:=w.id;current_employee:=e.id;current_auth:=e.auth_user_id;
  elsif wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
    if not found then raise exception 'attendance_worker_not_found';end if;
    if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
    if e.id is null or e.auth_user_id is null then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    current_employee:=e.id;current_auth:=e.auth_user_id;
  end if;
  -- New namespace serializes operation IDs across entries/reads, first-case
  -- creation and finite quotas. No old row receives UPDATE or lock upgrade.
  if p_command is not null then perform pg_advisory_xact_lock(hashtextextended('faolla:attendance-plan-exception-review:v1:'||site,0));end if;
  if mode_name<>'list' then
    if p_command is null then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for share;
    else
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid for update;
    end if;
    if c.case_id is not null then
      if c.worker_id is distinct from wid or c.employee_id is distinct from current_employee or c.employee_auth_user_id is distinct from current_auth then
        raise exception 'attendance_plan_exception_review_identity_changed';end if;
    elsif access_name='self' then raise exception 'attendance_plan_exception_review_not_found';end if;
  end if;
  -- Exact original receipts are read before pause, current-source collection,
  -- eligibility or quota. Current authorization and dual identity always apply.
  if op is not null then
    select * into saved from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=op;
    select * into saved_read from public.merchant_attendance_plan_exception_reads where merchant_id=site and operation_id=op;
    if saved.operation_id is not null and saved_read.operation_id is not null then raise exception 'attendance_plan_exception_review_invalid';end if;
    -- A concurrent first decision can commit between the earlier case lookup
    -- and this immutable receipt lookup. Re-pin the case after finding it.
    if c.case_id is null and (saved.operation_id is not null or saved_read.operation_id is not null) then
      select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and case_id=coalesce(saved.case_id,saved_read.case_id) for share;
      if c.worker_id is distinct from wid or c.slot_id is distinct from sid or c.employee_id is distinct from current_employee
        or c.employee_auth_user_id is distinct from current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    end if;
    if saved.operation_id is not null then
      if saved.actor_auth_user_id<>p_auth_user_id or saved.worker_id<>wid or saved.slot_id<>sid or saved.case_id is distinct from c.case_id
        or (saved.kind='decision')<>(access_name='owner') then raise exception 'attendance_access_denied';end if;
      if saved.employee_id<>current_employee or saved.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (saved.command is distinct from p_command or mode_name<>case saved.kind when 'decision' then 'decide' else 'note' end) then
        raise exception 'attendance_operation_conflict';end if;
    elsif saved_read.operation_id is not null then
      if access_name<>'self' or saved_read.employee_auth_user_id<>p_auth_user_id or saved_read.worker_id<>wid or saved_read.slot_id<>sid
        or saved_read.case_id is distinct from c.case_id then raise exception 'attendance_access_denied';end if;
      if saved_read.employee_id<>current_employee or saved_read.employee_auth_user_id<>current_auth then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      if p_command is not null and (mode_name<>'ack' or saved_read.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
    end if;
  end if;
  if c.case_id is not null then
    select revision,recorded_at into head,last_at from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
    if head is null then raise exception 'attendance_plan_exception_review_invalid';end if;
    select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
    if latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if not p_allow_write or not s.enabled then raise exception 'attendance_platform_paused';end if;
    if access_name='self' and not w.active then raise exception 'attendance_access_denied';end if;
    if mode_name<>'ack' and (p_command->>'expectedRevision')::bigint<>head then raise exception 'attendance_version_conflict';end if;
    if mode_name='decide' and (p_command->>'employeeId' is distinct from current_employee::text
      or p_command->>'employeeAuthUserId' is distinct from current_auth::text) then raise exception 'attendance_plan_exception_review_identity_changed';end if;
    if mode_name='decide' and p_auth_user_id=current_auth then raise exception 'attendance_access_denied';end if;
  end if;
  if access_name='owner' and (mode_name='detail' or mode_name='decide' and saved.operation_id is null) then
    source_result:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),p_auth_user_id);
    if source_result->>'siteId' is distinct from site or source_result->>'actorId' is distinct from p_auth_user_id::text
      or source_result->'worker'->>'workerId' is distinct from wid::text or source_result->'worker'->>'employeeId' is distinct from current_employee::text
      or source_result->'worker'->>'employeeAuthUserId' is distinct from current_auth::text or source_result->'slot'->>'id' is distinct from sid::text
      or source_result->>'sourceText' is distinct from (source_result->'source')::text
      or source_result->>'fingerprint' is distinct from encode(sha256(convert_to(source_result->>'sourceText','UTF8')),'hex') then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    current_item:=source_result-'sourceText';checked:=true;
    if latest.operation_id is not null then stale:=latest.evidence->>'fingerprint' is distinct from source_result->>'fingerprint';end if;
  end if;
  if p_command is not null and saved.operation_id is null and saved_read.operation_id is null then
    if mode_name='decide' then
      if source_result->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_plan_exception_review_source_changed';end if;
      if p_command->>'outcome'<>'follow_up' and (source_result->>'eligible' is distinct from 'true'
        or not(source_result->'candidate'->'late'->>'state'='triggered' or source_result->'candidate'->'early'->>'state'='triggered')) then
        raise exception 'attendance_plan_exception_review_blocked';end if;
      refs:='{}';
      foreach k in array array['sessions','unassociated','leave','calendar','missing','pendingCorrections'] loop
        part:=case when k='sessions' then jsonb_build_object('limited',false,'items',source_result->'source'->'sessions') else source_result->'source'->'context'->k end;
        ref_items:='[]';
        for ref_item in select value from jsonb_array_elements(part->'items') loop
          if k in('sessions','unassociated') then
            item:=jsonb_build_object('startEventId',ref_item->'startEventId','lastEventId',ref_item->'lastEventId','lastSequence',ref_item->'lastSequence','effectOperationId',ref_item->'effect'->'operationId');
          elsif k='calendar' then item:=jsonb_build_object('entryId',ref_item->'entryId','operationId',ref_item->'operationId','revision',ref_item->'revision');
          else
            item:=jsonb_build_object('requestId',ref_item->'requestId','operationId',ref_item->'operationId','revision',ref_item->'revision');
            if k='pendingCorrections' then item:=item||jsonb_build_object('kind',ref_item->'kind','startEventId',ref_item->'startEventId');end if;
          end if;
          ref_items:=ref_items||jsonb_build_array(item);
        end loop;
        refs:=refs||jsonb_build_object(k,case when k='sessions' then ref_items else jsonb_build_object('limited',part->'limited','items',ref_items) end);
      end loop;
      evidence:=jsonb_build_object('policy','owner-confirmed-plan-edges-v1','fingerprint',source_result->'fingerprint','observedAt',source_result->'readAt',
        'eligible',source_result->'eligible','blockers',source_result->'blockers','candidate',source_result->'candidate',
        'approval',nullif(source_result->'source'->'approval','null'::jsonb)-'source','sessions',refs->'sessions','contextRefs',refs-'sessions');
      if octet_length(convert_to(evidence::text,'UTF8'))>131072 then raise exception 'attendance_plan_exception_too_large';end if;
      if public.faolla_attendance_plan_exception_review_evidence_v1(evidence) is distinct from true then raise exception 'attendance_plan_exception_review_invalid';end if;
    elsif mode_name='note' then
      if latest.operation_id is null or p_command->>'decisionOperationId' is distinct from latest.operation_id::text then raise exception 'attendance_version_conflict';end if;
    else
      select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=(p_command->>'decisionOperationId')::uuid;
      if entry_row.case_id is distinct from c.case_id or entry_row.kind is distinct from 'decision' then raise exception 'attendance_plan_exception_review_not_found';end if;
      perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
      if exists(select 1 from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=entry_row.operation_id) then
        raise exception 'attendance_operation_conflict';end if;
    end if;
    if mode_name<>'ack' then
      select count(*),coalesce(sum(octet_length(convert_to(x.command::text,'UTF8'))+coalesce(octet_length(convert_to(x.evidence::text,'UTF8')),0)),0)
        into n,bytes from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site;
      if n>=5000 or bytes+octet_length(convert_to(p_command::text,'UTF8'))+coalesce(octet_length(convert_to(evidence::text,'UTF8')),0)>67108864 or head>=200 then
        raise exception 'attendance_plan_exception_review_limit';end if;
    end if;
    stamp:=clock_timestamp();
    if last_at is not null and stamp<last_at or source_result is not null and stamp<(source_result->>'readAt')::timestamptz then
      raise exception 'attendance_plan_exception_review_invalid';end if;
    if c.case_id is null then
      if mode_name<>'decide' then raise exception 'attendance_plan_exception_review_not_found';end if;
      select count(*) into n from public.merchant_attendance_plan_exception_cases where merchant_id=site;
      if n>=500 or (select count(*) from public.merchant_attendance_plan_exception_cases where merchant_id=site and worker_id=wid)>=100 then
        raise exception 'attendance_plan_exception_review_limit';end if;
      insert into public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,worker_name,worker_no,slot_start_at,slot_end_at,time_zone,opened_at)
        values(site,op,wid,sid,current_employee,current_auth,w.display_name,w.worker_no,(source_result->'slot'->>'startAt')::timestamptz,
          (source_result->'slot'->>'endAt')::timestamptz,source_result->'slot'->>'timeZone',stamp) returning * into c;
    end if;
    if mode_name='ack' then
      if stamp<entry_row.recorded_at then raise exception 'attendance_plan_exception_review_invalid';end if;
      insert into public.merchant_attendance_plan_exception_reads(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,decision_operation_id,command,read_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,entry_row.operation_id,p_command,stamp) returning * into saved_read;
    else
      insert into public.merchant_attendance_plan_exception_entries(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,revision,actor_auth_user_id,kind,command,evidence,recorded_at)
        values(site,op,c.case_id,wid,sid,current_employee,current_auth,head+1,p_auth_user_id,case mode_name when 'decide' then 'decision' else 'note' end,p_command,
          case when mode_name='decide' then evidence else null end,stamp) returning * into saved;
      head:=head+1;
      if mode_name='decide' then latest:=saved;stale:=false;end if;
    end if;
  end if;
  if saved.operation_id is not null then receipt:=jsonb_build_object('operationId',saved.operation_id,'command',saved.command,'item',public.faolla_attendance_plan_exception_review_entry_v1(saved));end if;
  if saved_read.operation_id is not null then
    select * into entry_row from public.merchant_attendance_plan_exception_entries where merchant_id=site and operation_id=saved_read.decision_operation_id;
    if entry_row.case_id is distinct from saved_read.case_id or entry_row.kind is distinct from 'decision' or saved_read.read_at<entry_row.recorded_at
      or public.faolla_attendance_plan_exception_review_command_v1('ack',saved_read.command) is distinct from true
      or saved_read.command->>'operationId' is distinct from saved_read.operation_id::text
      or saved_read.command->>'decisionOperationId' is distinct from saved_read.decision_operation_id::text then raise exception 'attendance_plan_exception_review_invalid';end if;
    perform public.faolla_attendance_plan_exception_review_entry_v1(entry_row);
    read_receipt:=jsonb_build_object('operationId',saved_read.operation_id,'command',saved_read.command,'decisionOperationId',saved_read.decision_operation_id,
      'actorId',saved_read.employee_auth_user_id,'employeeId',saved_read.employee_id,'employeeAuthUserId',saved_read.employee_auth_user_id,
      'readAt',to_char(saved_read.read_at at time zone 'UTC',stamp_format));
  end if;
  if mode_name='list' then
    for c in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and (wid is null and access_name='owner' or x.worker_id=wid)
      and (access_name='owner' or x.employee_id=current_employee and x.employee_auth_user_id=current_auth)
      and (cursor_at is null or (x.opened_at,x.case_id)<(cursor_at,cursor_id)) order by x.opened_at desc,x.case_id desc limit 26 for share loop
      row_count:=row_count+1;if row_count>25 then exit;end if;
      -- Owner discovery must not hand a historical case to a newly bound member.
      select * into w from public.merchant_attendance_workers where merchant_id=site and id=c.worker_id for share;
      select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
      if w.employee_id is distinct from c.employee_id or e.auth_user_id is distinct from c.employee_auth_user_id then raise exception 'attendance_plan_exception_review_identity_changed';end if;
      select revision into head from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
      select * into latest from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id and kind='decision' order by revision desc limit 1;
      if head is null or latest.operation_id is null then raise exception 'attendance_plan_exception_review_invalid';end if;
      item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      items:=items||jsonb_build_array(jsonb_build_object('caseId',c.case_id,'workerId',c.worker_id,'slotId',c.slot_id,'employeeId',c.employee_id,
        'employeeAuthUserId',c.employee_auth_user_id,'workerName',c.worker_name,'workerNo',c.worker_no,'slotStartAt',to_char(c.slot_start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'slotEndAt',to_char(c.slot_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timeZone',c.time_zone,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'revision',head,
        'latestDecision',jsonb_build_object('operationId',latest.operation_id,'revision',latest.revision,'outcome',latest.command->'outcome','recordedAt',item->'recordedAt','readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format))));
      next_cursor:=jsonb_build_object('at',to_char(c.opened_at at time zone 'UTC',stamp_format),'id',c.case_id);
    end loop;
    if row_count<=25 then next_cursor:=null;end if;
  else
    if latest.operation_id is not null then
      latest_item:=public.faolla_attendance_plan_exception_review_entry_v1(latest);
      select * into read_row from public.merchant_attendance_plan_exception_reads where merchant_id=site and decision_operation_id=latest.operation_id;
      if read_row.operation_id is not null and (read_row.case_id<>c.case_id or read_row.employee_id<>c.employee_id or read_row.employee_auth_user_id<>c.employee_auth_user_id or read_row.read_at<latest.recorded_at) then raise exception 'attendance_plan_exception_review_invalid';end if;
      latest_item:=latest_item||jsonb_build_object('readAt',to_char(read_row.read_at at time zone 'UTC',stamp_format));
      for entry_row in select * from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 26 loop
        row_count:=row_count+1;if row_count>25 then history_truncated:=true;exit;end if;
        history:=history||jsonb_build_array(public.faolla_attendance_plan_exception_review_entry_v1(entry_row)-'evidence');
      end loop;
    end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
      'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
    detail:=jsonb_build_object('caseId',c.case_id,'openedAt',to_char(c.opened_at at time zone 'UTC',stamp_format),'worker',worker_item,'slotId',sid,'revision',head,
      'current',current_item,'currentValidation',case when checked then 'checked' else 'not_checked' end,'stale',case when checked then stale else null end,
      'latestDecision',latest_item,'history',history,'historyTruncated',history_truncated,
      'canDecide',access_name='owner' and checked and p_allow_write and s.enabled and p_auth_user_id<>current_auth,
      'canNote',access_name='self' and latest.operation_id is not null and p_allow_write and s.enabled and w.active);
  end if;
  read_at:=clock_timestamp();
  if source_result is not null and read_at<(source_result->>'readAt')::timestamptz
    or saved.operation_id is not null and read_at<saved.recorded_at or saved_read.operation_id is not null and read_at<saved_read.read_at then
    raise exception 'attendance_plan_exception_review_invalid';end if;
  result:=jsonb_build_object('protocol','plan-exception-review-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,
    'employeeId',case when access_name='self' then current_employee else null end,'readAt',to_char(read_at at time zone 'UTC',stamp_format),
    'items',items,'nextCursor',next_cursor,'detail',detail,'receipt',receipt,'readReceipt',read_receipt);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_plan_exception_review_command_v1(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_exception_review_evidence_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_exception_review_entry_v1(public.merchant_attendance_plan_exception_entries) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_exception_review_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_plan_exception_review_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050147,'merchant_attendance_plan_exception_review') on conflict(version) do nothing;
do $plan_exception_review_postconditions$
declare t regclass;p regprocedure;role_name text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050147 and name='merchant_attendance_plan_exception_review') then
    raise exception 'merchant_attendance_plan_exception_review_registry_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_plan_exception_cases'::regclass,'public.merchant_attendance_plan_exception_entries'::regclass,'public.merchant_attendance_plan_exception_reads'::regclass] loop
    if not(select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
      or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal
      and tgname in('attendance_plan_exception_immutable','attendance_plan_exception_no_truncate') and tgenabled='O')<>2 then
      raise exception 'merchant_attendance_plan_exception_review_storage_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class cls where cls.oid=t and
        (pg_has_role(role_name,cls.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(cls.relacl,acldefault('r',cls.relowner))) acl
          where case when acl.grantee=0 then true else pg_has_role(role_name,acl.grantee,'USAGE') end))) then
        raise exception 'merchant_attendance_plan_exception_review_acl_postcondition_failed';end if;
    end loop;
  end loop;
  foreach p in array array['public.faolla_attendance_plan_exception_review_command_v1(text,jsonb)'::regprocedure,
    'public.faolla_attendance_plan_exception_review_evidence_v1(jsonb)'::regprocedure,
    'public.faolla_attendance_plan_exception_review_entry_v1(public.merchant_attendance_plan_exception_entries)'::regprocedure] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,p,'EXECUTE') then raise exception 'merchant_attendance_plan_exception_review_acl_postcondition_failed';end if;
    end loop;
  end loop;
  p:='public.faolla_attendance_plan_exception_review_v1(jsonb,uuid,jsonb,boolean)'::regprocedure;
  if not(select prosecdef from pg_proc where oid=p) or not has_function_privilege('service_role',p,'EXECUTE')
    or has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') then
    raise exception 'merchant_attendance_plan_exception_review_acl_postcondition_failed';end if;
end;
$plan_exception_review_postconditions$;
commit;
