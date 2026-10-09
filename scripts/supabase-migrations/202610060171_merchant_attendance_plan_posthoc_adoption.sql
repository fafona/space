--204 Independent post-hoc evidence ledger. No old writer, association, event,
--140 approval, report, exception decision or period reader is replaced.
--Only the new service-only RPC can write; p_allow_write defaults to false.
begin;
set local lock_timeout='3s';
do $posthoc_prerequisites$
declare installed boolean;t text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or to_regclass('public.merchant_attendance_plan_exception_cases') is null
    or to_regprocedure('public.faolla_attendance_plan_exception_source_legacy_v1(jsonb,uuid)') is null
    or to_regprocedure('public.faolla_attendance_work_arrangement_context_v1(text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)') is null
    or to_regprocedure('public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamp with time zone)') is null
    or to_regprocedure('public.faolla_attendance_period_plan_rule_v1(text,uuid,uuid,uuid,uuid,uuid)') is null
    or to_regprocedure('public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)') is null then
    raise exception 'merchant_attendance_plan_posthoc_adoption_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060171 and name='merchant_attendance_plan_posthoc_adoption') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060171 and name<>'merchant_attendance_plan_posthoc_adoption') then
    raise exception 'merchant_attendance_plan_posthoc_adoption_installation_conflict';end if;
  foreach t in array array['merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_plan_posthoc_adoption_installation_conflict';end if;
  end loop;
  if installed<>(exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
    and proname='faolla_attendance_plan_posthoc_operation_v1')) then raise exception 'merchant_attendance_plan_posthoc_adoption_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_plan_posthoc_reference_v1(jsonb)','public.faolla_attendance_plan_posthoc_command_v1(jsonb)',
    'public.faolla_attendance_plan_posthoc_missing_v1(text,uuid,uuid,uuid,uuid)',
    'public.faolla_attendance_plan_posthoc_preview_v1(jsonb,uuid,integer,uuid)',
    'public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_plan_posthoc_adoption_installation_conflict';end if;
  end loop;
end;
$posthoc_prerequisites$;

create or replace function public.faolla_attendance_plan_posthoc_reference_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p->>'kind'='session' then
    return public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','startEventId','lastEventId','lastSequence','effectOperationId','effectRevision']) is true
      and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'startEventId','uuid') is true
      and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'lastEventId','uuid') is true
      and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'lastSequence','version') is true
      and ((p->'effectOperationId'='null'::jsonb and p->'effectRevision'='null'::jsonb)
        or (public.faolla_attendance_shift_rule_binding_scalar_v1(p->'effectOperationId','uuid') is true
          and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'effectRevision','version') is true));
  elsif p->>'kind'='missing' then
    return public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','requestId','rootRequestId','approvalOperationId']) is true
      and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'requestId','uuid') is true
      and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'rootRequestId','uuid') is true
      and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'approvalOperationId','uuid') is true
      and p->>'requestId'<>p->>'approvalOperationId';
  end if;
  return false;
end;
$$;


create or replace function public.faolla_attendance_plan_posthoc_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare x jsonb;keys text[]:=array[]::text[];k text;
begin
  if p->>'action' is null or p->>'action' not in('apply','revoke') or octet_length(convert_to(p::text,'UTF8'))>16384
    or public.faolla_attendance_shift_rule_binding_object_v1(p,case p->>'action' when 'apply'
      then array['action','operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','sources','reason']
      else array['action','operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','reason'] end) is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'employeeId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'employeeAuthUserId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedRevision','head') is distinct from true
    or (p->>'expectedRevision')::numeric>100
    or jsonb_typeof(p->'expectedFingerprint') is distinct from 'string' or p->>'expectedFingerprint'!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,1000) is distinct from true then return false;end if;
  if p->>'action'='apply' then
    if jsonb_typeof(p->'sources') is distinct from 'array' or jsonb_array_length(p->'sources')>10 then return false;end if;
    for x in select value from jsonb_array_elements(p->'sources') loop
      if public.faolla_attendance_plan_posthoc_reference_v1(x) is distinct from true then return false;end if;
      k:=(x->>'kind')||':'||coalesce(x->>'startEventId',x->>'rootRequestId');
      if k=any(keys) then return false;end if;keys:=array_append(keys,k);
    end loop;
  end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create table if not exists public.merchant_attendance_plan_posthoc_operations(
  merchant_id text not null,operation_id uuid not null,case_id uuid not null,worker_id uuid not null,slot_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid not null,actor_auth_user_id uuid not null,
  revision integer not null check(revision between 1 and 100),action text not null check(action in('apply','revoke')),
  command jsonb not null,source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),
  sources jsonb not null,selected jsonb not null,approval jsonb null,recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,slot_id,revision),unique(merchant_id,operation_id,worker_id,slot_id),
  foreign key(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id)
    references public.merchant_attendance_plan_exception_cases(merchant_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id),
  check(public.faolla_attendance_plan_posthoc_command_v1(command) is true and command->>'action'=action
    and command->>'operationId'=operation_id::text and (command->>'expectedRevision')::integer=revision-1
    and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text
    and command->>'expectedFingerprint'=source_fingerprint and actor_auth_user_id<>employee_auth_user_id),
  check(jsonb_typeof(sources)='array' and jsonb_typeof(selected)='array' and jsonb_array_length(sources)<=10
    and jsonb_array_length(sources)=jsonb_array_length(selected) and octet_length(convert_to(selected::text,'UTF8'))<=131072),
  check((action='apply' and revision<100 and sources=command->'sources') or (action='revoke' and sources='[]'::jsonb and selected='[]'::jsonb and approval is null))
);
--Only this small derived projection is mutable. Old claims remain exclusive
--when source versions change; an explicit replace/revoke is required.
create table if not exists public.merchant_attendance_plan_posthoc_claims(
  merchant_id text not null,kind text not null check(kind in('session','missing')),source_id uuid not null,
  worker_id uuid not null,slot_id uuid not null,operation_id uuid not null,
  primary key(merchant_id,kind,source_id),
  foreign key(merchant_id,operation_id,worker_id,slot_id)
    references public.merchant_attendance_plan_posthoc_operations(merchant_id,operation_id,worker_id,slot_id)
);
create index if not exists attendance_plan_posthoc_claim_slot_idx on public.merchant_attendance_plan_posthoc_claims(merchant_id,slot_id);
alter table public.merchant_attendance_plan_posthoc_operations enable row level security;
alter table public.merchant_attendance_plan_posthoc_claims enable row level security;
revoke all on public.merchant_attendance_plan_posthoc_operations,public.merchant_attendance_plan_posthoc_claims from public,anon,authenticated,service_role;
do $posthoc_immutable$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_plan_posthoc_operations'::regclass and tgname='attendance_plan_posthoc_immutable') then
    create trigger attendance_plan_posthoc_immutable before update or delete on public.merchant_attendance_plan_posthoc_operations for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_plan_posthoc_operations'::regclass and tgname='attendance_plan_posthoc_no_truncate') then
    create trigger attendance_plan_posthoc_no_truncate before truncate on public.merchant_attendance_plan_posthoc_operations for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
end;
$posthoc_immutable$;

--A bounded local missing edge proof, not a whole-root history scan. Validate
--the current approved row, its incoming parent and any direct pending child.
--Never prefilter successor rows by identity/root/date before checking them.
create or replace function public.faolla_attendance_plan_posthoc_missing_v1(p_site text,p_worker uuid,p_employee uuid,p_auth uuid,p_request uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare r public.merchant_attendance_missing_requests%rowtype;b public.merchant_attendance_missing_requests%rowtype;
  parent public.merchant_attendance_missing_requests%rowtype;root_row public.merchant_attendance_missing_requests%rowtype;
  first_row public.merchant_attendance_missing_entries%rowtype;terminal public.merchant_attendance_missing_entries%rowtype;pa public.merchant_attendance_missing_entries%rowtype;
  approved uuid[];pending uuid[];check_ids uuid[];i uuid;cmd jsonb;pending_child boolean:=false;is_current boolean;
begin
  select * into r from public.merchant_attendance_missing_requests where merchant_id=p_site and request_id=p_request;
  if r.request_id is null then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  select * into terminal from public.merchant_attendance_missing_entries where merchant_id=p_site and request_id=p_request and revision=2;
  if terminal.action is distinct from 'approve' then raise exception 'attendance_plan_posthoc_adoption_changed';end if;
  approved:=array(select s.request_id from public.merchant_attendance_missing_requests s join public.merchant_attendance_missing_entries e
    on e.merchant_id=s.merchant_id and e.request_id=s.request_id and e.revision=2 and e.action='approve'
    where s.merchant_id=p_site and s.supersedes_request_id=p_request limit 2);
  if cardinality(approved)>1 then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  is_current:=cardinality(approved)=0;
  pending:=array(select s.request_id from public.merchant_attendance_missing_requests s where s.merchant_id=p_site and s.supersedes_request_id=p_request
    and not exists(select 1 from public.merchant_attendance_missing_entries e where e.merchant_id=s.merchant_id and e.request_id=s.request_id and e.revision=2) limit 2);
  if cardinality(pending)>1 or cardinality(pending)>0 and not is_current then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  pending_child:=cardinality(pending)>0;check_ids:=array[p_request]||approved||pending;
  foreach i in array check_ids loop
    select * into b from public.merchant_attendance_missing_requests where merchant_id=p_site and request_id=i;
    if row(b.worker_id,b.employee_id,b.actor_auth_user_id) is distinct from row(p_worker,p_employee,p_auth) then raise exception 'attendance_worker_changed';end if;
    select * into first_row from public.merchant_attendance_missing_entries where merchant_id=p_site and request_id=i and revision=1;
    select * into terminal from public.merchant_attendance_missing_entries where merchant_id=p_site and request_id=i and revision=2;
    cmd:=first_row.command;
    if first_row.operation_id is distinct from i or first_row.action is distinct from 'submit' or first_row.actor_auth_user_id is distinct from p_auth
      or first_row.recorded_at is distinct from b.submitted_at or cmd->'proposal' is distinct from b.proposal
      or public.faolla_attendance_shift_rule_binding_object_v1(cmd,case when b.supersedes_request_id is null
        then array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal']
        else array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId'] end) is distinct from true
      or cmd->>'action' is distinct from (case when b.supersedes_request_id is null then 'submit' else 'revise' end)
      or cmd->>'operationId' is distinct from i::text or cmd->>'expectedWorkerId' is distinct from p_worker::text
      or cmd->>'reason' is distinct from b.reason or cmd->>'locationId' is distinct from b.location_id::text or cmd->>'timeZone' is distinct from b.time_zone
      or cmd->'expectedPolicyRevision' is distinct from to_jsonb(b.policy_revision)
      or public.faolla_attendance_shift_rule_binding_scalar_v1(cmd->'expectedSettingsVersion','version') is distinct from true
      or public.faolla_attendance_correction_proposal_v1(b.proposal,b.submitted_at) is distinct from b.proposal
      or jsonb_array_length(b.proposal->'breaks')>8 or (b.proposal->>'startAt')::timestamptz is distinct from b.start_at
      or (b.proposal->>'endAt')::timestamptz is distinct from b.end_at then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
    if terminal.operation_id is not null then
      if terminal.action is distinct from 'approve' or terminal.actor_auth_user_id=p_auth
        or public.faolla_attendance_shift_rule_binding_object_v1(terminal.command,array['action','operationId','requestId','expectedRevision','evidenceToken','reason']) is distinct from true
        or terminal.command->>'action' is distinct from 'approve' or terminal.command->>'operationId' is distinct from terminal.operation_id::text
        or terminal.command->>'requestId' is distinct from i::text or terminal.command->'expectedRevision' is distinct from '1'::jsonb
        or jsonb_typeof(terminal.command->'evidenceToken') is distinct from 'string' or terminal.command->>'evidenceToken'!~'^[0-9a-f]{32}$'
        or public.faolla_attendance_group_text_v1(terminal.command->>'reason',1,200) is distinct from true then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
    end if;
    if b.supersedes_request_id is not null then
      select * into parent from public.merchant_attendance_missing_requests where merchant_id=p_site and request_id=b.supersedes_request_id;
      select * into root_row from public.merchant_attendance_missing_requests where merchant_id=p_site and request_id=b.root_request_id;
      select * into pa from public.merchant_attendance_missing_entries where merchant_id=p_site and request_id=parent.request_id and revision=2;
      if row(parent.worker_id,parent.employee_id,parent.actor_auth_user_id) is distinct from row(p_worker,p_employee,p_auth)
        or row(root_row.worker_id,root_row.employee_id,root_row.actor_auth_user_id) is distinct from row(p_worker,p_employee,p_auth) then raise exception 'attendance_worker_changed';end if;
      if parent.request_id is null or root_row.request_id is null or root_row.supersedes_request_id is not null or root_row.root_request_id is not null
        or root_row.supersedes_operation_id is not null or b.root_request_id is distinct from coalesce(parent.root_request_id,parent.request_id)
        or b.location_id is distinct from parent.location_id or b.time_zone is distinct from parent.time_zone
        or pa.action is distinct from 'approve' or b.supersedes_operation_id is distinct from pa.operation_id or pa.recorded_at>=b.submitted_at
        or terminal.recorded_at<b.submitted_at or parent.supersedes_request_id is not null and pa.recorded_at<parent.submitted_at
        or cmd->>'supersedesRequestId' is distinct from parent.request_id::text or cmd->>'expectedApprovalOperationId' is distinct from pa.operation_id::text
        or pa.actor_auth_user_id=p_auth
        or public.faolla_attendance_shift_rule_binding_object_v1(pa.command,array['action','operationId','requestId','expectedRevision','evidenceToken','reason']) is distinct from true
        or pa.command->>'action' is distinct from 'approve' or pa.command->>'operationId' is distinct from pa.operation_id::text
        or pa.command->>'requestId' is distinct from parent.request_id::text or pa.command->'expectedRevision' is distinct from '1'::jsonb
        or jsonb_typeof(pa.command->'evidenceToken') is distinct from 'string' or pa.command->>'evidenceToken'!~'^[0-9a-f]{32}$'
        or public.faolla_attendance_group_text_v1(pa.command->>'reason',1,200) is distinct from true then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
      approved:=array(select s.request_id from public.merchant_attendance_missing_requests s join public.merchant_attendance_missing_entries e
        on e.merchant_id=s.merchant_id and e.request_id=s.request_id and e.revision=2 and e.action='approve'
        where s.merchant_id=p_site and s.supersedes_request_id=parent.request_id limit 2);
      if terminal.operation_id is not null and (cardinality(approved)<>1 or approved[1] is distinct from i)
        or terminal.operation_id is null and cardinality(approved)<>0 then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
    end if;
  end loop;
  select * into terminal from public.merchant_attendance_missing_entries where merchant_id=p_site and request_id=p_request and revision=2;
  return jsonb_build_object('reference',jsonb_build_object('kind','missing','requestId',p_request,'rootRequestId',coalesce(r.root_request_id,p_request),
    'approvalOperationId',terminal.operation_id),'pending',pending_child,'current',is_current);
end;
$$;

--Saved operations are evidence, not a fresh eligibility assertion. Never
--re-read current source/owner/clock state while rendering an old receipt.
create or replace function public.faolla_attendance_plan_posthoc_operation_v1(p public.merchant_attendance_plan_posthoc_operations)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare x jsonb;n integer:=0;previous public.merchant_attendance_plan_posthoc_operations%rowtype;
begin
  if p.operation_id is null or public.faolla_attendance_plan_posthoc_command_v1(p.command) is distinct from true
    or p.command->>'operationId' is distinct from p.operation_id::text or p.command->>'action' is distinct from p.action
    or p.command->'expectedRevision' is distinct from to_jsonb(p.revision-1)
    or p.command->>'employeeId' is distinct from p.employee_id::text or p.command->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
    or p.source_fingerprint is distinct from p.command->>'expectedFingerprint' or p.actor_auth_user_id=p.employee_auth_user_id
    or jsonb_array_length(p.sources)<>jsonb_array_length(p.selected) then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  if p.revision>1 then
    select * into previous from public.merchant_attendance_plan_posthoc_operations where merchant_id=p.merchant_id and slot_id=p.slot_id and revision=p.revision-1;
    if previous.operation_id is null or row(previous.worker_id,previous.case_id,previous.employee_id,previous.employee_auth_user_id)
      is distinct from row(p.worker_id,p.case_id,p.employee_id,p.employee_auth_user_id) then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  end if;
  if p.action='revoke' then
    if previous.action is distinct from 'apply' or p.sources<>'[]'::jsonb or p.selected<>'[]'::jsonb or p.approval is not null
      or p.source_fingerprint is distinct from previous.source_fingerprint then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  else
    if p.sources is distinct from p.command->'sources' or p.revision>=100 then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
    for x in select value from jsonb_array_elements(p.selected) loop
      if public.faolla_attendance_shift_rule_binding_object_v1(x,array['reference','original','selected','locationId','timeZone','available','blockers','claim']) is distinct from true
        or x->'reference' is distinct from p.sources->n or x->>'available' is distinct from 'true' or x->'blockers' is distinct from '[]'::jsonb
        or public.faolla_attendance_shift_rule_binding_scalar_v1(x->'selected'->'startAt','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(x->'selected'->'endAt','stamp6') is distinct from true
        or (x->'selected'->>'endAt')::timestamptz<=(x->'selected'->>'startAt')::timestamptz then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
      n:=n+1;
    end loop;
    if p.sources<>'[]'::jsonb and p.approval is null then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
    if p.approval is not null and (public.faolla_attendance_shift_rule_binding_object_v1(p.approval,array['operationId','revision','sourceId','sourceSha256','recordedAt']) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.approval->'operationId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.approval->'sourceId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.approval->'revision','version') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.approval->'recordedAt','stamp6') is distinct from true
      or jsonb_typeof(p.approval->'sourceSha256') is distinct from 'string' or p.approval->>'sourceSha256'!~'^[0-9a-f]{64}$') then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'action',p.action,'actorId',p.actor_auth_user_id,
    'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'reason',p.command->'reason','sources',p.sources,
    'sourceFingerprint',p.source_fingerprint,'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;

--Private, called only after merchant SHARE -> settings UPDATE -> worker UPDATE
---> employee SHARE. Fixed159 legacy +156 work context deliberately avoids
--recursion when a future explicit source version consumes this new ledger.
create or replace function public.faolla_attendance_plan_posthoc_preview_v1(p_query jsonb,p_auth_user_id uuid,p_revision integer,p_current uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare raw jsonb;basis jsonb;arrangements jsonb;source jsonb;source_text text;slot jsonb;worker jsonb;
  c public.merchant_attendance_plan_exception_cases%rowtype;case_revision bigint:=0;
  fixed jsonb;approval jsonb;approval_id uuid;site text:=p_query->>'siteId';wid uuid:=(p_query->>'workerId')::uuid;sid uuid:=(p_query->>'slotId')::uuid;
  employee uuid;member_auth uuid;plan_begin timestamptz;plan_end timestamptz;observed timestamptz;
  part jsonb;compact jsonb;proof jsonb;events jsonb;first_event jsonb;last_event jsonb;effect jsonb;ref jsonb;original jsonb;selected jsonb;
  item jsonb;candidates jsonb:='[]';flags text[]:=array[]::text[];cf text[];blocks jsonb;cb jsonb;key text;kind_name text;ref_source_id uuid;
  location_id uuid;zone_name text;relation_id uuid;claim jsonb;claim_row public.merchant_attendance_plan_posthoc_claims%rowtype;
  claim_op public.merchant_attendance_plan_posthoc_operations%rowtype;missing_row public.merchant_attendance_missing_requests%rowtype;
  unproven boolean;a timestamptz;b timestamptz;failure text;count_sources integer:=0;event_count integer:=0;pending_ref record;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  raw:=public.faolla_attendance_plan_exception_source_legacy_v1(p_query,p_auth_user_id);
  basis:=raw->'source';slot:=raw->'slot';worker:=raw->'worker';observed:=(raw->>'readAt')::timestamptz;
  employee:=(worker->>'employeeId')::uuid;member_auth:=(worker->>'employeeAuthUserId')::uuid;
  plan_begin:=(slot->>'startAt')::timestamptz;plan_end:=(slot->>'endAt')::timestamptz;
  arrangements:=public.faolla_attendance_work_arrangement_context_v1(site,wid,employee,member_auth,plan_begin,plan_end);
  if arrangements<>'[]'::jsonb then
    select jsonb_agg(x order by x->>'requestId') into arrangements from jsonb_array_elements(arrangements) x;
    basis:=jsonb_set(basis,'{context,workArrangements}',jsonb_build_object('limited',false,'items',arrangements))
      ||jsonb_build_object('protocol','plan-exception-evidence-v2','policy','owner-confirmed-plan-edges-work-v2');
  end if;
  select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid;
  if c.case_id is null then flags:=array_append(flags,'case_missing');
  else
    if row(c.worker_id,c.employee_id,c.employee_auth_user_id) is distinct from row(wid,employee,member_auth) then raise exception 'attendance_worker_changed';end if;
    select revision into case_revision from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
    if case_revision is null then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  end if;
  if basis->>'phase'<>'ended' then flags:=array_append(flags,'plan_not_ended');end if;
  if (slot->>'cancelled')::boolean then flags:=array_append(flags,'slot_cancelled');end if;
  if not(slot->>'hasPublicationEvidence')::boolean then flags:=array_append(flags,'publication_missing');end if;
  if not(worker->>'active')::boolean or not(worker->>'employeeActive')::boolean then flags:=array_append(flags,'worker_inactive');end if;
  for key,part in select * from jsonb_each(basis->'context') loop
    if (part->>'limited')::boolean then flags:=array_append(flags,'context_unknown');end if;
    if key='pendingCorrections' and part->'items'<>'[]'::jsonb then flags:=array_append(flags,'pending_correction');end if;
    if key in('leave','missing','workArrangements') and exists(select 1 from jsonb_array_elements(part->'items') x where x->>'status'='submitted') then
      flags:=array_append(flags,case key when 'leave' then 'pending_leave' when 'missing' then 'pending_missing' else 'pending_work_arrangement' end);end if;
    if key='calendar' and exists(select 1 from jsonb_array_elements(part->'items') x where x->>'status'='created') then flags:=array_append(flags,'calendar_entry');end if;
  end loop;
  begin
    perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(jsonb_build_object(
      'startAt',to_char(plan_begin at time zone 'UTC',fmt),'endAt',to_char(plan_end at time zone 'UTC',fmt))));
  exception when raise_exception then get stacked diagnostics failure=message_text;
    if failure='attendance_period_sealed' then flags:=array_append(flags,'sealed');else raise;end if;
  end;
  select operation_id into approval_id from public.merchant_attendance_plan_rule_operations where merchant_id=site and slot_id=sid order by revision desc limit 1;
  if approval_id is not null then
    fixed:=public.faolla_attendance_period_plan_rule_v1(site,wid,sid,employee,member_auth,approval_id);
    approval:=jsonb_build_object('operationId',fixed->'operationId','revision',fixed->'revision','sourceId',fixed->'sourceId',
      'sourceSha256',fixed->'sourceSha256','recordedAt',fixed->'recordedAt');
  end if;
  --Full related set, not a browser display window. The inherited basis remains
  --conservative when its own older bounded reader marks context incomplete.
  for kind_name,compact in
    select 'session',x from jsonb_array_elements((basis->'sessions')||(basis->'context'->'unassociated'->'items')) x
    union all select 'missing',x from jsonb_array_elements(basis->'context'->'missing'->'items') x where x->>'status'='approved'
  loop
    cf:=array[]::text[];claim:=null;relation_id:=null;unproven:=false;
    if kind_name='session' then
      ref_source_id:=(compact->>'startEventId')::uuid;
      begin
        proof:=public.faolla_attendance_period_session_v1(site,wid,ref_source_id,employee,member_auth,observed);
      exception when raise_exception then get stacked diagnostics failure=message_text;
        if failure='attendance_period_source_identity_unproven' then unproven:=true;proof:=null;
          cf:=array_append(cf,'identity_unproven');flags:=array_append(flags,'context_unknown');else raise;end if;
      end;
      original:=compact->'original';selected:=compact->'selected';
      ref:=jsonb_build_object('kind','session','startEventId',ref_source_id,'lastEventId',compact->'lastEventId','lastSequence',compact->'lastSequence',
        'effectOperationId',compact->'effect'->'operationId','effectRevision',compact->'effect'->'revision');
      if not unproven then
        events:=proof->'item'->'events';first_event:=events->0;last_event:=events->-1;effect:=nullif(proof->'item'->'effect','null'::jsonb);
        event_count:=event_count+jsonb_array_length(events);if event_count>2002 then raise exception 'attendance_plan_posthoc_adoption_too_large';end if;
        if ref is distinct from jsonb_build_object('kind','session','startEventId',ref_source_id,'lastEventId',last_event->'id','lastSequence',last_event->'sequence',
          'effectOperationId',effect->'operationId','effectRevision',effect->'revision')
          or original is distinct from jsonb_build_object('startAt',first_event->'occurredAt','endAt',case when last_event->>'action'='clock_out' then last_event->'occurredAt' else 'null'::jsonb end)
          or selected is distinct from (case when effect is null then original else jsonb_build_object('startAt',effect->'proposal'->'startAt','endAt',effect->'proposal'->'endAt') end) then
          raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
        location_id:=(first_event->>'locationId')::uuid;zone_name:=first_event->>'timeZone';
        if exists(select 1 from jsonb_array_elements(events) ev where ev->>'locationId' is distinct from slot->>'locationId') then cf:=array_append(cf,'location_mismatch');end if;
        relation_id:=(proof->'relation'->'selection'->>'slotId')::uuid;
      else
        select e.location_id,e.time_zone into location_id,zone_name from public.merchant_attendance_events e where e.merchant_id=site and e.id=ref_source_id;
        relation_id:=coalesce((compact->>'relationSlotId')::uuid,(compact->'relation'->'selection'->>'slotId')::uuid);
      end if;
      if relation_id is not null then cf:=array_append(cf,case when relation_id=sid then 'already_associated' else 'associated_elsewhere' end);end if;
      if exists(select 1 from jsonb_array_elements(basis->'context'->'pendingCorrections'->'items') x where x->>'startEventId'=ref_source_id::text) then cf:=array_append(cf,'pending_correction');end if;
      --A pending proposal may move OUTSIDE the plan. Point-check the actual
      --root stream too; the old159 contextual range alone cannot prove absence.
      for pending_ref in
        select ce.employee_id,ce.actor_auth_user_id from public.merchant_attendance_correction_entries ce
          where ce.merchant_id=site and ce.worker_id=wid and ce.start_event_id=ref_source_id and ce.action='submit'
            and not exists(select 1 from public.merchant_attendance_correction_entries tail where tail.merchant_id=site and tail.request_id=ce.request_id and tail.revision>ce.revision)
            and not exists(select 1 from public.merchant_attendance_correction_decisions decision where decision.merchant_id=site and decision.request_id=ce.request_id)
        union all
        select rr.employee_id,rr.actor_auth_user_id from public.merchant_attendance_revision_requests rr
          join public.merchant_attendance_correction_effects base on base.merchant_id=rr.merchant_id and base.request_id=rr.base_request_id
          where rr.merchant_id=site and base.worker_id=wid and base.start_event_id=ref_source_id and rr.action='submit'
            and not exists(select 1 from public.merchant_attendance_revision_requests tail where tail.merchant_id=site and tail.request_id=rr.request_id and tail.revision>rr.revision)
            and not exists(select 1 from public.merchant_attendance_revision_decisions decision where decision.merchant_id=site and decision.request_id=rr.request_id)
        limit 101
      loop
        if row(pending_ref.employee_id,pending_ref.actor_auth_user_id) is distinct from row(employee,member_auth) then raise exception 'attendance_worker_changed';end if;
        cf:=array_append(cf,'pending_correction');flags:=array_append(flags,'pending_correction');
      end loop;
    else
      proof:=public.faolla_attendance_plan_posthoc_missing_v1(site,wid,employee,member_auth,(compact->>'requestId')::uuid);
      if proof->'current' is distinct from compact->'isCurrentApproved' then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
      --Historical parents are not candidates, but their outgoing approved edge
      --is still checked (a corrupt outside child must not disappear from proof).
      if not(proof->>'current')::boolean then continue;end if;
      ref:=proof->'reference';ref_source_id:=(ref->>'rootRequestId')::uuid;
      select * into missing_row from public.merchant_attendance_missing_requests where merchant_id=site and request_id=(ref->>'requestId')::uuid;
      original:=null;selected:=jsonb_build_object('startAt',compact->'startAt','endAt',compact->'endAt');
      if ref->>'approvalOperationId' is distinct from compact->>'operationId' then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
      location_id:=missing_row.location_id;zone_name:=missing_row.time_zone;
      if (proof->>'pending')::boolean then cf:=array_append(cf,'pending_missing');flags:=array_append(flags,'pending_missing');end if;
    end if;
    a:=(selected->>'startAt')::timestamptz;b:=(selected->>'endAt')::timestamptz;
    if b is null then cf:=array_append(cf,'source_open');elsif b=a then cf:=array_append(cf,'source_zero_duration');
    elsif a>=plan_end or b<=plan_begin then cf:=array_append(cf,'source_outside_plan');end if;
    if location_id::text is distinct from slot->>'locationId' then cf:=array_append(cf,'location_mismatch');end if;
    if approval is null then cf:=array_append(cf,'approval_missing');end if;
    select * into claim_row from public.merchant_attendance_plan_posthoc_claims where merchant_id=site and kind=kind_name and merchant_attendance_plan_posthoc_claims.source_id=ref_source_id;
    if claim_row.operation_id is not null then
      select * into claim_op from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and operation_id=claim_row.operation_id;
      perform public.faolla_attendance_plan_posthoc_operation_v1(claim_op);
      if claim_row.worker_id<>wid or claim_op.action<>'apply' or not exists(select 1 from jsonb_array_elements(claim_op.sources) x
        where x->>'kind'=kind_name and coalesce(x->>'startEventId',x->>'rootRequestId')=ref_source_id::text) then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
      claim:=jsonb_build_object('slotId',claim_row.slot_id,'operationId',claim_row.operation_id,'revision',claim_op.revision);
      if claim_row.slot_id<>sid then cf:=array_append(cf,'claimed_elsewhere');end if;
    end if;
    if a is not null and b is not null then
      begin
        perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(selected));
        if original is not null and original->>'endAt' is not null then perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(original));end if;
      exception when raise_exception then get stacked diagnostics failure=message_text;
        if failure='attendance_period_sealed' then cf:=array_append(cf,'sealed');else raise;end if;
      end;
    end if;
    select coalesce(jsonb_agg(x order by x),'[]'::jsonb) into cb from (select distinct unnest(cf) x) z;
    count_sources:=count_sources+1;if count_sources>100 then raise exception 'attendance_plan_posthoc_adoption_too_large';end if;
    candidates:=candidates||jsonb_build_array(jsonb_build_object('reference',ref,'original',original,'selected',selected,'locationId',location_id,
      'timeZone',zone_name,'available',cb='[]'::jsonb,'blockers',cb,'claim',claim));
  end loop;
  select coalesce(jsonb_agg(x order by x->'reference'->>'kind',coalesce(x->'reference'->>'startEventId',x->'reference'->>'rootRequestId')),'[]'::jsonb)
    into candidates from jsonb_array_elements(candidates) x;
  select coalesce(jsonb_agg(x order by x),'[]'::jsonb) into blocks from (select distinct unnest(flags) x) z;
  source:=jsonb_build_object('protocol','posthoc-adoption-preview-v1','basis',basis,'caseId',c.case_id,'caseRevision',case_revision,
    'revision',p_revision,'currentOperationId',p_current,'candidates',candidates,'approval',approval,'blockers',blocks);
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_adoption_too_large';end if;
  return jsonb_build_object('fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'),'eligible',blocks='[]'::jsonb,
    'blockers',blocks,'candidates',candidates,'approval',approval,'source',source,'sourceText',source_text);
end;
$$;

create or replace function public.faolla_attendance_plan_posthoc_adoption_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;wid uuid;sid uuid;op uuid;mode_name text;s public.merchant_attendance_settings%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;slot_row public.merchant_attendance_schedule_slots%rowtype;
  c public.merchant_attendance_plan_exception_cases%rowtype;head public.merchant_attendance_plan_posthoc_operations%rowtype;
  saved public.merchant_attendance_plan_posthoc_operations%rowtype;entry_row public.merchant_attendance_plan_posthoc_operations%rowtype;
  slot_context jsonb;worker_item jsonb;slot_item jsonb;preview jsonb;current_item jsonb;receipt jsonb;history jsonb:='[]';result jsonb;
  refs jsonb:='[]';selected jsonb:='[]';approval jsonb;x jsonb;y jsonb;item jsonb;count_ops integer;revision_no integer:=0;
  ref_source_id uuid;stamp timestamptz;read_at timestamptz;query_source jsonb;expected_claims integer;actual_claims integer;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','slotId','mode','operationId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid') is distinct from true
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or p_query->>'mode' not in('detail','recover') then raise exception 'attendance_invalid_request';end if;
  mode_name:=p_query->>'mode';site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;
  if mode_name='recover' then
    if p_command is not null or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
    op:=(p_query->>'operationId')::uuid;
  else
    if p_query->'operationId' is distinct from 'null'::jsonb then raise exception 'attendance_invalid_request';end if;
    if p_command is not null then
      if public.faolla_attendance_plan_posthoc_command_v1(p_command) is distinct from true then raise exception 'attendance_invalid_request';end if;
      op:=(p_command->>'operationId')::uuid;
    end if;
  end if;
  --Acquire writable locks first: no SHARE->UPDATE upgrade after collecting a
  --source. All old correction/missing/leave/seal writers serialize here too.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if e.id is null or e.auth_user_id is null then raise exception 'attendance_worker_changed';end if;
  select * into slot_row from public.merchant_attendance_schedule_slots where merchant_id=site and id=sid;
  if slot_row.id is null then raise exception 'attendance_plan_posthoc_adoption_not_found';end if;
  if slot_row.worker_id is distinct from wid or slot_row.employee_id is distinct from e.id then raise exception 'attendance_worker_changed';end if;
  slot_context:=public.faolla_attendance_self_schedule_slot_v1(slot_row);slot_item:=slot_context->'slot';
  if slot_context->'publication'->>'employeeAuthUserId' is not null and slot_context->'publication'->>'employeeAuthUserId'<>e.auth_user_id::text then
    raise exception 'attendance_worker_changed';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',e.id,
    'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
  select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid;
  if c.case_id is not null and row(c.worker_id,c.employee_id,c.employee_auth_user_id) is distinct from row(wid,e.id,e.auth_user_id) then raise exception 'attendance_worker_changed';end if;
  select * into head from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid order by revision desc limit 1;
  if head.operation_id is not null then
    if row(head.worker_id,head.case_id,head.employee_id,head.employee_auth_user_id) is distinct from row(wid,c.case_id,e.id,e.auth_user_id) then raise exception 'attendance_worker_changed';end if;
    current_item:=public.faolla_attendance_plan_posthoc_operation_v1(head);revision_no:=head.revision;
  end if;
  select count(*) into count_ops from (select 1 from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid limit 101) bounded;
  if count_ops<>revision_no or count_ops>100 then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  --Validate the exclusive projection, including empty apply and revoked heads.
  expected_claims:=case when head.action='apply' then jsonb_array_length(head.sources) else 0 end;
  select count(*) into actual_claims from public.merchant_attendance_plan_posthoc_claims where merchant_id=site and slot_id=sid;
  if actual_claims<>expected_claims or exists(select 1 from public.merchant_attendance_plan_posthoc_claims z where z.merchant_id=site and z.slot_id=sid
    and (z.worker_id<>wid or z.operation_id is distinct from head.operation_id or not exists(select 1 from jsonb_array_elements(head.sources) t
      where t->>'kind'=z.kind and coalesce(t->>'startEventId',t->>'rootRequestId')=z.source_id::text))) then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  if op is not null then
    select * into saved from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and operation_id=op;
    if saved.operation_id is not null then
      if row(saved.worker_id,saved.slot_id,saved.case_id,saved.employee_id,saved.employee_auth_user_id,saved.actor_auth_user_id)
        is distinct from row(wid,sid,c.case_id,e.id,e.auth_user_id,p_auth_user_id) then raise exception 'attendance_access_denied';end if;
      if p_command is not null and saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      receipt:=jsonb_build_object('operationId',saved.operation_id,'command',saved.command,'item',public.faolla_attendance_plan_posthoc_operation_v1(saved));
    elsif mode_name='recover' then raise exception 'attendance_plan_posthoc_adoption_not_found';end if;
  end if;
  query_source:=jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid);
  --Original number wins BEFORE feature/module/current-source revalidation.
  if receipt is null and p_command is not null then
    if not p_allow_write or not s.enabled then raise exception 'attendance_platform_paused';end if;
    if not w.active or e.status<>'active' then raise exception 'attendance_worker_changed';end if;
    if p_command->>'employeeId' is distinct from e.id::text or p_command->>'employeeAuthUserId' is distinct from e.auth_user_id::text then raise exception 'attendance_worker_changed';end if;
    if p_auth_user_id=e.auth_user_id then raise exception 'attendance_access_denied';end if;
    if p_command->'expectedRevision' is distinct from to_jsonb(revision_no) then raise exception 'attendance_plan_posthoc_adoption_changed';end if;
    if c.case_id is null then raise exception 'attendance_plan_posthoc_adoption_blocked';end if;
    if revision_no>=100 or p_command->>'action'='apply' and revision_no>=99 then raise exception 'attendance_plan_posthoc_adoption_limit';end if;
    perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(jsonb_build_object(
      'startAt',to_char(slot_row.start_at at time zone 'UTC',fmt),'endAt',to_char(slot_row.end_at at time zone 'UTC',fmt))));
    --Revocation is a release, not a new adoption. Its fingerprint is the saved
    --head's sourceFingerprint (NOT fresh preview), allowing damaged/stale source
    --to be released after exact CAS. Current identity and sealed spans still gate.
    if p_command->>'action'='revoke' then
      if head.action is distinct from 'apply' then raise exception 'attendance_plan_posthoc_adoption_changed';end if;
      if p_command->>'expectedFingerprint' is distinct from head.source_fingerprint then raise exception 'attendance_plan_posthoc_adoption_changed';end if;
    else
      preview:=public.faolla_attendance_plan_posthoc_preview_v1(query_source,p_auth_user_id,revision_no,head.operation_id);
      if p_command->>'expectedFingerprint' is distinct from preview->>'fingerprint' then raise exception 'attendance_plan_posthoc_adoption_changed';end if;
      if preview->>'eligible' is distinct from 'true' then raise exception 'attendance_plan_posthoc_adoption_blocked';end if;
      refs:=p_command->'sources';approval:=nullif(preview->'approval','null'::jsonb);
      for x in select value from jsonb_array_elements(refs) loop
        select value into item from jsonb_array_elements(preview->'candidates') where value->'reference'=x;
        if item is null or item->>'available' is distinct from 'true' then raise exception 'attendance_plan_posthoc_adoption_blocked';end if;
        selected:=selected||jsonb_build_array(item);
      end loop;
      --Whole sources only. No slices, duplicate root, overlapping chosen sources,
      --or overlap with an existing original137 associated selected interval.
      for x in select value from jsonb_array_elements(selected) loop
        for y in select value from jsonb_array_elements(selected) loop
          if x->'reference'<>y->'reference' and (x->'selected'->>'startAt')::timestamptz<(y->'selected'->>'endAt')::timestamptz
            and (y->'selected'->>'startAt')::timestamptz<(x->'selected'->>'endAt')::timestamptz then raise exception 'attendance_plan_posthoc_adoption_blocked';end if;
        end loop;
        if exists(select 1 from jsonb_array_elements(preview->'source'->'basis'->'sessions') z
          where (x->'selected'->>'startAt')::timestamptz<coalesce((z->'selected'->>'endAt')::timestamptz,'infinity'::timestamptz)
            and (z->'selected'->>'startAt')::timestamptz<(x->'selected'->>'endAt')::timestamptz) then raise exception 'attendance_plan_posthoc_adoption_blocked';end if;
      end loop;
    end if;
    --Replacement/revocation cannot silently affect a sealed old source whose
    --span no longer intersects this plan. Protect both saved endpoint versions.
    for x in select value from jsonb_array_elements(coalesce(head.selected,'[]'::jsonb)||selected) loop
      perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(x->'selected'));
      if x->'original'<>'null'::jsonb then perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(x->'original'));end if;
    end loop;
    stamp:=clock_timestamp();if stamp<head.recorded_at then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
    insert into public.merchant_attendance_plan_posthoc_operations(merchant_id,operation_id,case_id,worker_id,slot_id,employee_id,employee_auth_user_id,
      actor_auth_user_id,revision,action,command,source_fingerprint,sources,selected,approval,recorded_at)
      values(site,op,c.case_id,wid,sid,e.id,e.auth_user_id,p_auth_user_id,revision_no+1,p_command->>'action',p_command,p_command->>'expectedFingerprint',refs,selected,approval,stamp)
      returning * into saved;
    --Only new derived claims are deleted; all operations and all old facts stay.
    delete from public.merchant_attendance_plan_posthoc_claims where merchant_id=site and slot_id=sid;
    for x in select value from jsonb_array_elements(refs) loop
      ref_source_id:=coalesce(x->>'startEventId',x->>'rootRequestId')::uuid;
      if exists(select 1 from public.merchant_attendance_plan_posthoc_claims z where z.merchant_id=site and z.kind=x->>'kind' and z.source_id=ref_source_id) then
        raise exception 'attendance_plan_posthoc_adoption_changed';end if;
      insert into public.merchant_attendance_plan_posthoc_claims(merchant_id,kind,source_id,worker_id,slot_id,operation_id) values(site,x->>'kind',ref_source_id,wid,sid,op);
    end loop;
    current_item:=public.faolla_attendance_plan_posthoc_operation_v1(saved);revision_no:=saved.revision;
    receipt:=jsonb_build_object('operationId',op,'command',p_command,'item',current_item);preview:=null;
  elsif receipt is null and mode_name='detail' then
    preview:=public.faolla_attendance_plan_posthoc_preview_v1(query_source,p_auth_user_id,revision_no,head.operation_id);
  end if;
  for entry_row in select * from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid order by revision desc limit 25 loop
    if row(entry_row.worker_id,entry_row.case_id,entry_row.employee_id,entry_row.employee_auth_user_id) is distinct from row(wid,c.case_id,e.id,e.auth_user_id) then raise exception 'attendance_worker_changed';end if;
    history:=history||jsonb_build_array(public.faolla_attendance_plan_posthoc_operation_v1(entry_row));
  end loop;
  read_at:=clock_timestamp();
  if exists(select 1 from jsonb_array_elements(history) history_rows(value) where (history_rows.value->>'recordedAt')::timestamptz>read_at) then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  result:=jsonb_build_object('protocol','plan-posthoc-adoption-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'slot',slot_item,
    'revision',revision_no,'current',current_item,'preview',preview,'history',history,'historyTruncated',revision_no>25,'receipt',receipt,'readAt',to_char(read_at at time zone 'UTC',fmt));
  if octet_length(convert_to(result::text,'UTF8'))>2097152 then raise exception 'attendance_plan_posthoc_adoption_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_plan_posthoc_reference_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_missing_v1(text,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_operation_v1(public.merchant_attendance_plan_posthoc_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_preview_v1(jsonb,uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean) to service_role;

do $posthoc_permissions$
declare p oid;r text;t regclass;priv text;
begin
  for p in select oid from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
    and proname=any(array['faolla_attendance_plan_posthoc_reference_v1','faolla_attendance_plan_posthoc_command_v1','faolla_attendance_plan_posthoc_missing_v1',
      'faolla_attendance_plan_posthoc_operation_v1','faolla_attendance_plan_posthoc_preview_v1','faolla_attendance_plan_posthoc_adoption_v1']) loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p,'EXECUTE') is distinct from (r='service_role' and p='public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)'::regprocedure) then
        raise exception 'merchant_attendance_plan_posthoc_adoption_permission_conflict';end if;
    end loop;
  end loop;
  foreach t in array array['public.merchant_attendance_plan_posthoc_operations'::regclass,'public.merchant_attendance_plan_posthoc_claims'::regclass] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      for priv in select a.privilege_type from pg_class c cross join lateral aclexplode(acldefault('r',c.relowner)) a where c.oid=t loop
        if has_table_privilege(r,t,priv) then raise exception 'merchant_attendance_plan_posthoc_adoption_permission_conflict';end if;
      end loop;
    end loop;
  end loop;
end;
$posthoc_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610060171,'merchant_attendance_plan_posthoc_adoption') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
