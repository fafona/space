-- PRIVATE transaction core only: no application EXECUTE grant or HTTP writer.
-- All consumers and the continuous revision workflow must migrate before rollout.
begin;
set local lock_timeout='3s';
-- 093 deliberately exposed no writer. Do not adopt unexplained candidate nodes.
do $$ begin
  if exists(select 1 from public.merchant_attendance_effect_versions) then raise exception 'attendance_revision_decision_requires_empty_candidate_journal';end if;
end; $$;
create table public.merchant_attendance_revision_decisions (
  merchant_id text not null,request_id uuid not null,operation_id uuid not null,base_request_id uuid not null,worker_id uuid not null,
  action text not null check(action in ('approve','reject')),actor_auth_user_id uuid not null,
  request_revision bigint not null check(request_revision between 1 and 9007199254740989),
  base_operation_id uuid not null,evidence_token text not null check(evidence_token~'^[0-9a-f]{32}$'),
  reason text not null check(reason=btrim(reason) and char_length(reason) between 1 and 500 and reason !~ '[[:cntrl:]]'),
  command jsonb not null check(jsonb_typeof(command)='object' and octet_length(command::text)<=4096),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,request_id),unique(merchant_id,operation_id),
  foreign key(merchant_id,request_id) references public.merchant_attendance_revision_requests(merchant_id,operation_id) on delete restrict,
  foreign key(merchant_id,base_request_id) references public.merchant_attendance_correction_effects(merchant_id,request_id) on delete restrict,
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict
);
create index attendance_revision_decisions_root_idx on public.merchant_attendance_revision_decisions(merchant_id,base_request_id);
alter table public.merchant_attendance_revision_decisions enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_revision_decisions'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_revision_decisions from public,anon,authenticated,service_role;
create trigger attendance_revision_decision_no_rewrite before update or delete on public.merchant_attendance_revision_decisions for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_revision_decision_no_truncate before truncate on public.merchant_attendance_revision_decisions for each statement execute function public.faolla_attendance_events_append_only_v1();
alter table public.merchant_attendance_effect_versions add constraint attendance_effect_version_decision_fk foreign key(merchant_id,operation_id)
  references public.merchant_attendance_revision_decisions(merchant_id,operation_id) deferrable initially deferred;

create function public.faolla_attendance_revision_decision_link_v1() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare d public.merchant_attendance_revision_decisions%rowtype;n public.merchant_attendance_effect_versions%rowtype;
begin
  select * into d from public.merchant_attendance_revision_decisions where merchant_id=new.merchant_id and operation_id=new.operation_id;
  select * into n from public.merchant_attendance_effect_versions where merchant_id=new.merchant_id and operation_id=new.operation_id;
  if d.operation_id is null or (d.action='approve')<>(n.operation_id is not null)
    or n.operation_id is not null and (n.root_request_id<>d.base_request_id or n.request_id<>d.request_id or n.worker_id<>d.worker_id
      or n.previous_operation_id<>d.base_operation_id or n.actor_auth_user_id<>d.actor_auth_user_id or n.request_revision<>d.request_revision
      or n.evidence_token<>d.evidence_token or n.reason<>d.reason or n.recorded_at<>d.recorded_at)
    then raise exception 'attendance_revision_decision_effect_mismatch';end if;
  return null;
end; $$;
revoke all on function public.faolla_attendance_revision_decision_link_v1() from public,anon,authenticated,service_role;
create constraint trigger attendance_revision_decision_effect_link after insert on public.merchant_attendance_revision_decisions
  deferrable initially deferred for each row execute function public.faolla_attendance_revision_decision_link_v1();
create constraint trigger attendance_effect_version_decision_link after insert on public.merchant_attendance_effect_versions
  deferrable initially deferred for each row execute function public.faolla_attendance_revision_decision_link_v1();

create function public.faolla_attendance_revision_review_checks_v2(p_site text,r jsonb,p_base_start uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=r->'application';e jsonb:=r->'evidence';issues text[]:='{}';x text;can_reject boolean;
  from_at timestamptz;to_at timestamptz;zone text;first_day date;last_day date;day date;left_at timestamptz;right_at timestamptz;n integer;coverage integer;
  other_effect public.merchant_attendance_effect_current_v2%rowtype;controls_revision bigint;tail_id uuid;effect_id uuid;token text;
begin
  if a->'item'->>'status'<>'submitted' then issues:=array_append(issues,'withdrawn');end if;
  if e->'bindingCurrent'<>'true'::jsonb then issues:=array_append(issues,'binding_changed');end if;
  if e->'ownApplication'='true'::jsonb then issues:=array_append(issues,'self_review');end if;
  can_reject:=cardinality(issues)=0;
  if e->'currentBasis'='null'::jsonb then issues:=array_append(issues,'basis_unavailable');
  else
    if e->'currentBasis'->'events'<>a->'basis'->'events' then issues:=array_append(issues,'basis_changed');end if;
    if e->'currentBasis'->'events'->-1->>'action'<>'clock_out' then issues:=array_append(issues,'open_session');end if;
    if e->'previous'<>'null'::jsonb and (a->'proposal'->>'startAt')::timestamptz<(e->'previous'->>'occurredAt')::timestamptz then issues:=array_append(issues,'overlap_previous');end if;
    if e->'next'<>'null'::jsonb and (a->'proposal'->>'endAt')::timestamptz>(e->'next'->>'occurredAt')::timestamptz then issues:=array_append(issues,'overlap_next');end if;
  end if;
  for x in select jsonb_array_elements_text(a->'rules'->'issues') loop issues:=array_append(issues,'rule_'||x);end loop;
  from_at:=(a->'proposal'->>'startAt')::timestamptz;to_at:=(a->'proposal'->>'endAt')::timestamptz;zone:=a->'basis'->'events'->0->>'timeZone';
  first_day:=(from_at at time zone zone)::date;last_day:=((to_at-interval '1 microsecond') at time zone zone)::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 32 then issues:=array_append(issues,'declaration_range');
  elsif e->'employmentTruncated'='true'::jsonb then issues:=array_append(issues,'employment_limit');
  else
    for n in 0..(last_day-first_day) loop
      day:=first_day+n;left_at:=public.faolla_attendance_control_day_boundary_v1(day,zone);right_at:=public.faolla_attendance_control_day_boundary_v1(day+1,zone);
      if right_at>left_at and left_at<to_at and right_at>from_at then
        select count(*) into coverage from jsonb_array_elements(e->'employmentPeriods') p where (p->>'startsOn')::date<=day and (p->'endsOn'='null'::jsonb or (p->>'endsOn')::date>=day);
        if coverage=0 and not('employment_gap'=any(issues)) then issues:=array_append(issues,'employment_gap');end if;
        if coverage>1 and not('employment_ambiguous'=any(issues)) then issues:=array_append(issues,'employment_ambiguous');end if;
      end if;
    end loop;
  end if;
  -- Current effective spans are mutually nonoverlapping under settings UPDATE lock.
  -- Exclude only this shift's old approval, then test the nearest other start.
  select * into other_effect from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid
    and start_event_id<>p_base_start and start_at<to_at order by start_at desc limit 1;
  if other_effect.request_id is not null and other_effect.end_at>from_at then issues:=array_append(issues,'effective_overlap');end if;
  select coalesce(max(revision),0) into controls_revision from public.merchant_attendance_correction_controls where merchant_id=p_site;
  select id into tail_id from public.merchant_attendance_events where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by sequence desc limit 1;
  select operation_id into effect_id from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by recorded_at desc,operation_id desc limit 1;
  token:=md5(jsonb_build_object('item',r->'item','original',a->'basis'->'events','current',e->'currentBasis'->'events',
    'evidence',e-'currentBasis','rules',(a->'rules')-'checkedAt','controlsRevision',controls_revision,'tailId',tail_id,'effectId',effect_id)::text);
  return jsonb_build_object('evidenceToken',token,'blockers',to_jsonb(issues),'canReject',can_reject);
end; $$;
revoke all on function public.faolla_attendance_revision_review_checks_v2(text,jsonb,uuid) from public,anon,authenticated,service_role;

create function public.faolla_attendance_revision_owner_review_v2(p_site_id text,p_auth_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare first_row public.merchant_attendance_revision_requests%rowtype;last_row public.merchant_attendance_revision_requests%rowtype;head public.merchant_attendance_revision_requests%rowtype;
  base public.merchant_attendance_correction_effects%rowtype;original public.merchant_attendance_correction_entries%rowtype;decision public.merchant_attendance_correction_decisions%rowtype;
  emp public.merchant_enterprise_employees%rowtype;worker public.merchant_attendance_workers%rowtype;
  now_at timestamptz;as_of text;proposed jsonb;summary jsonb;rules jsonb;evidence jsonb;periods jsonb;period_count integer;
  first_day date;last_day date;review jsonb;base_json jsonb;checks jsonb;blockers jsonb;token text;result jsonb;code text;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_request_id is null then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into first_row from public.merchant_attendance_revision_requests where merchant_id=p_site_id and request_id=p_request_id and action='submit';
  if not found then raise exception 'attendance_correction_not_found';end if;
  -- Current owner can inspect a historical request even after requester loses
  -- permission. Binding changes are an explicit blocker, never a silent rebind.
  select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and id=first_row.employee_id for share;
  select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and id=first_row.worker_id for share;
  if emp.id is null or worker.id is null then raise exception 'attendance_revision_invalid_base';end if;
  select * into last_row from public.merchant_attendance_revision_requests where merchant_id=p_site_id and request_id=p_request_id order by revision desc limit 1;
  select * into head from public.merchant_attendance_revision_requests where merchant_id=p_site_id and base_request_id=first_row.base_request_id order by revision desc limit 1;
  select * into base from public.merchant_attendance_correction_effects where merchant_id=p_site_id and request_id=first_row.base_request_id;
  select * into original from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=first_row.base_request_id and action='submit';
  select * into decision from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=first_row.base_request_id;
  now_at:=clock_timestamp();as_of:=to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  if base.worker_id is distinct from worker.id or base.revision is distinct from 1 or base.operation_id is distinct from first_row.base_operation_id
    or original.employee_id is distinct from first_row.employee_id or original.actor_auth_user_id is distinct from first_row.actor_auth_user_id
    or original.start_event_id is distinct from base.start_event_id or original.proposal is distinct from base.proposal
    or decision.action is distinct from 'approve' or decision.operation_id is distinct from base.operation_id or decision.recorded_at is distinct from base.recorded_at
    or base.recorded_at>=first_row.recorded_at or first_row.recorded_at>now_at or last_row.recorded_at>now_at or head.recorded_at>now_at
    then raise exception 'attendance_revision_invalid_base';end if;
  proposed:=public.faolla_attendance_correction_proposal_v1(first_row.command->'proposal',first_row.recorded_at);
  rules:=public.faolla_attendance_revision_bound_rules_v1(p_site_id,first_row,original.basis,base.proposal,now_at);
  begin
    evidence:=public.faolla_attendance_correction_owner_basis_v1(p_site_id,worker.id,first_row.employee_id,base.start_event_id,now_at);
  exception when sqlstate 'P0001' then
    code:=sqlerrm;if code not in ('attendance_session_not_found','attendance_session_invalid_records','attendance_session_too_large','attendance_session_span_too_long','attendance_correction_unsupported_basis') then raise;end if;
    evidence:=jsonb_build_object('currentBasis',null,'previous',null,'next',null,'basisIssue',code);
  end;
  first_day:=((proposed->>'startAt')::timestamptz at time zone base.time_zone)::date;
  last_day:=(((proposed->>'endAt')::timestamptz-interval '1 microsecond') at time zone base.time_zone)::date;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('startsOn',starts_on,'endsOn',ends_on) order by starts_on) filter(where rn<=100),'[]'::jsonb)
    into period_count,periods from (select starts_on,ends_on,row_number() over(order by starts_on) rn from (
      select starts_on,ends_on from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=worker.id
      and starts_on<=last_day and (ends_on is null or ends_on>=first_day) order by starts_on limit 101) bounded) matches;
  evidence:=evidence||jsonb_build_object('bindingCurrent',coalesce(worker.employee_id=first_row.employee_id and emp.auth_user_id=first_row.actor_auth_user_id,false),
    'ownApplication',first_row.actor_auth_user_id=p_auth_user_id,'employmentPeriods',periods,'employmentTruncated',period_count>100);
  summary:=jsonb_build_object('requestId',p_request_id,'startEventId',base.start_event_id,'revision',last_row.revision,
    'status',case last_row.action when 'submit' then 'submitted' else 'withdrawn' end,
    'submittedAt',to_char(first_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'startAt',proposed->'startAt','endAt',proposed->'endAt');
  review:=jsonb_build_object('siteId',p_site_id,'mode','detail','asOf',as_of,'approvalAvailable',false,'rulesEnforced',true,
    'item',summary||jsonb_build_object('workerId',worker.id,'employeeId',first_row.employee_id,'workerName',worker.display_name,'workerNo',worker.worker_no),
    'application',jsonb_build_object('siteId',p_site_id,'employeeId',first_row.employee_id,'workerId',worker.id,'asOf',as_of,'mode','detail','canRequest',false,
      'rulesEnforced',true,'rules',rules,'item',summary,'basis',original.basis,'proposal',proposed,'reason',first_row.command->'reason','receipt',null,
      'withdrawal',case last_row.action when 'withdraw' then jsonb_build_object('reason',last_row.command->'reason','recordedAt',to_char(last_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end),
    'evidence',evidence);
  checks:=public.faolla_attendance_revision_review_checks_v2(p_site_id,review,base.start_event_id);blockers:=checks->'blockers';
  base_json:=jsonb_build_object('requestId',base.request_id,'operationId',base.operation_id,'revision',base.revision,'policyRevision',base.policy_revision,
    'proposal',base.proposal,'timeZone',base.time_zone,'recordedAt',to_char(base.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'elapsedUs',base.elapsed_us,'breakUs',base.break_us,'paidBreakUs',base.paid_break_us,'workedUs',base.worked_us);
  -- Optimistic evidence fingerprint only. It is not a signature, grant or saved
  -- approval. A future deciding transaction must recompute it and all checks.
  token:=md5(jsonb_build_object('sourceToken',checks->'evidenceToken','base',base_json,'command',first_row.command,'headOperation',head.operation_id,
    'headRevision',head.revision,'blockers',blockers)::text);
  result:=jsonb_build_object('siteId',p_site_id,'requestId',p_request_id,'asOf',as_of,'reviewOnly',true,'approvalAvailable',false,'effectiveChanged',false,
    'review',review,'base',base_json,'submittedRevision',first_row.revision,'ledgerRevision',head.revision,
    'pendingRequestId',case head.action when 'submit' then head.request_id else null end,'evidenceToken',token,'blockers',blockers,
    'checksPassed',blockers='[]'::jsonb,'rejectionChecksPassed',checks->'canReject');
  if octet_length(result::text)>393216 then raise exception 'attendance_revision_review_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_revision_owner_review_v2(text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.faolla_attendance_revision_decision_summary_v1(d public.merchant_attendance_revision_decisions) returns jsonb
language sql set search_path=pg_catalog as $$
select case when d.operation_id is null then 'null'::jsonb else jsonb_build_object('requestId',d.request_id,'operationId',d.operation_id,
  'action',d.action,'requestRevision',d.request_revision,'baseOperationId',d.base_operation_id,'evidenceToken',d.evidence_token,'reason',d.reason,
  'recordedAt',to_char(d.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'command',d.command) end;
$$;
revoke all on function public.faolla_attendance_revision_decision_summary_v1(public.merchant_attendance_revision_decisions) from public,anon,authenticated,service_role;

-- Private core supports deciding requests based on the first approved source.
-- Continuous post-decision resubmission and public consumer rollout are separate.
create function public.faolla_attendance_revision_decide_v1(p_site_id text,p_auth_user_id uuid,p_request_id uuid,p_command jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;d public.merchant_attendance_revision_decisions%rowtype;receipt public.merchant_attendance_revision_decisions%rowtype;
  current_effect public.merchant_attendance_effect_current_v2%rowtype;first_row public.merchant_attendance_revision_requests%rowtype;
  op uuid;now_at timestamptz;token text;blockers jsonb;did_write boolean:=false;result jsonb;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_request_id is null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' or octet_length(p_command::text)>4096
      or (select count(*) from jsonb_object_keys(p_command))<>7 or not(p_command ?& array['action','operationId','requestId','expectedRevision','expectedEvidence','expectedBaseOperationId','reason'])
      or coalesce(p_command->>'action','') not in ('approve','reject') or p_command->>'requestId' is distinct from p_request_id::text
      or coalesce(p_command->>'operationId','') !~ uuid_pattern or coalesce(p_command->>'expectedBaseOperationId','') !~ uuid_pattern
      or jsonb_typeof(p_command->'expectedRevision')<>'number' or coalesce(p_command->>'expectedRevision','') !~ '^[1-9][0-9]{0,15}$'
      or (p_command->>'expectedRevision')::numeric>9007199254740989 or coalesce(p_command->>'expectedEvidence','') !~ '^[0-9a-f]{32}$'
      or jsonb_typeof(p_command->'reason')<>'string' or char_length(btrim(p_command->>'reason')) not between 1 and 500
      or p_command->>'reason'<>btrim(p_command->>'reason') or p_command->>'reason' ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  else op:=p_operation_id;end if;
  perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  r:=public.faolla_attendance_revision_owner_review_v2(p_site_id,p_auth_user_id,p_request_id);
  select * into first_row from public.merchant_attendance_revision_requests where merchant_id=p_site_id and operation_id=p_request_id and action='submit';
  select * into current_effect from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and root_request_id=first_row.base_request_id;
  if current_effect.request_id is null then raise exception 'attendance_revision_invalid_base';end if;
  select * into d from public.merchant_attendance_revision_decisions where merchant_id=p_site_id and request_id=p_request_id;
  select * into receipt from public.merchant_attendance_revision_decisions where merchant_id=p_site_id and operation_id=op;
  if receipt.operation_id is not null and (receipt.request_id<>p_request_id or receipt.actor_auth_user_id<>p_auth_user_id) then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
  end if;
  token:=md5(jsonb_build_object('review',r->'evidenceToken','currentOperation',current_effect.operation_id,'currentRevision',current_effect.revision,'decisionOperation',d.operation_id)::text);
  if p_command is not null then
    if receipt.operation_id is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if not coalesce(p_allow_write,false) then raise exception 'attendance_platform_paused';end if;
      if d.operation_id is not null then raise exception 'attendance_correction_decided';end if;
      if exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=op)
        or exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and operation_id=op)
        or exists(select 1 from public.merchant_attendance_revision_requests where merchant_id=p_site_id and operation_id=op)
        or exists(select 1 from public.merchant_attendance_effect_versions where merchant_id=p_site_id and operation_id=op) then raise exception 'attendance_operation_conflict';end if;
      if current_effect.operation_id<>first_row.base_operation_id or current_effect.operation_id::text<>p_command->>'expectedBaseOperationId' then raise exception 'attendance_revision_base_changed';end if;
      if (r->'review'->'item'->>'revision')::bigint<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
      if token<>p_command->>'expectedEvidence' then raise exception 'attendance_correction_evidence_changed';end if;
      if not (r->>(case p_command->>'action' when 'approve' then 'checksPassed' else 'rejectionChecksPassed' end))::boolean then raise exception 'attendance_correction_decision_blocked';end if;
      now_at:=clock_timestamp();
      if now_at<=first_row.recorded_at or now_at<current_effect.recorded_at or now_at<(r->>'asOf')::timestamptz then raise exception 'attendance_version_conflict';end if;
      insert into public.merchant_attendance_revision_decisions(merchant_id,request_id,operation_id,base_request_id,worker_id,action,actor_auth_user_id,request_revision,base_operation_id,evidence_token,reason,command,recorded_at)
        values(p_site_id,p_request_id,op,first_row.base_request_id,first_row.worker_id,p_command->>'action',p_auth_user_id,(p_command->>'expectedRevision')::bigint,
          current_effect.operation_id,token,p_command->>'reason',p_command,now_at) returning * into receipt;
      if receipt.action='approve' then
        insert into public.merchant_attendance_effect_versions(merchant_id,root_request_id,worker_id,start_event_id,revision,request_id,operation_id,previous_operation_id,actor_auth_user_id,request_revision,evidence_token,reason,recorded_at,policy_revision)
          values(p_site_id,first_row.base_request_id,first_row.worker_id,current_effect.start_event_id,current_effect.revision+1,p_request_id,op,current_effect.operation_id,p_auth_user_id,
            receipt.request_revision,token,receipt.reason,now_at,first_row.policy_revision);
      end if;
      did_write:=true;d:=receipt;
      select * into current_effect from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and root_request_id=first_row.base_request_id;
    end if;
  end if;
  blockers:=r->'blockers';
  if d.operation_id is not null then blockers:=blockers||jsonb_build_array('already_decided');end if;
  if current_effect.operation_id<>first_row.base_operation_id then blockers:=blockers||jsonb_build_array('base_changed');end if;
  token:=md5(jsonb_build_object('review',r->'evidenceToken','currentOperation',current_effect.operation_id,'currentRevision',current_effect.revision,'decisionOperation',d.operation_id)::text);
  now_at:=clock_timestamp();
  result:=jsonb_build_object('siteId',p_site_id,'requestId',p_request_id,'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'protocol','revision-decision-v1','review',r,'evidenceToken',token,'blockers',blockers,'writeEnabled',coalesce(p_allow_write,false),
    'canApprove',coalesce(p_allow_write,false) and blockers='[]'::jsonb,
    'canReject',coalesce(p_allow_write,false) and d.operation_id is null and current_effect.operation_id=first_row.base_operation_id and (r->>'rejectionChecksPassed')::boolean,
    'decision',public.faolla_attendance_revision_decision_summary_v1(d),'receipt',public.faolla_attendance_revision_decision_summary_v1(receipt),
    'current',public.faolla_attendance_effect_evidence_v2(current_effect,now_at),'replayed',receipt.operation_id is not null and not did_write,
    'effectiveChanged',did_write and receipt.action='approve');
  if octet_length(result::text)>425984 then raise exception 'attendance_revision_review_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_revision_decide_v1(text,uuid,uuid,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
create or replace function public.faolla_attendance_revision_self_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null,p_platform_enabled boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;worker public.merchant_attendance_workers%rowtype;
  base public.merchant_attendance_correction_effects%rowtype;original public.merchant_attendance_correction_entries%rowtype;decision public.merchant_attendance_correction_decisions%rowtype;
  head public.merchant_attendance_revision_requests%rowtype;first_row public.merchant_attendance_revision_requests%rowtype;
  last_row public.merchant_attendance_revision_requests%rowtype;receipt public.merchant_attendance_revision_requests%rowtype;
  mode text;target_request uuid;op uuid;k text;now_at timestamptz;basis jsonb;proposal jsonb;rules jsonb;can_request boolean;result jsonb;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>5 or not(p_query ?& array['mode','expectedWorkerId','baseRequestId','requestId','operationId'])
    or coalesce(p_query->>'mode','') not in ('prepare','detail') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['expectedWorkerId','baseRequestId'] loop if coalesce(p_query->>k,'') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;end loop;
  mode:=p_query->>'mode';
  if mode='prepare' then
    if p_command is not null or p_query->'requestId'<>'null'::jsonb or p_query->'operationId'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  else
    if coalesce(p_query->>'requestId','') !~ uuid_pattern or p_query->'operationId'<>'null'::jsonb and coalesce(p_query->>'operationId','') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
    target_request:=(p_query->>'requestId')::uuid;op:=(p_query->>'operationId')::uuid;
  end if;
  if p_command is not null then
    if op is not null or jsonb_typeof(p_command)<>'object' or octet_length(p_command::text)>12288 or coalesce(p_command->>'action','') not in ('submit','withdraw')
      or not(p_command ?& array['action','operationId','expectedRevision','reason']) or coalesce(p_command->>'operationId','') !~ uuid_pattern
      or jsonb_typeof(p_command->'expectedRevision')<>'number' or coalesce(p_command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedRevision')::bigint>9007199254740988 or jsonb_typeof(p_command->'reason')<>'string'
      or char_length(btrim(p_command->>'reason')) not between 1 and 500 or p_command->>'reason'<>btrim(p_command->>'reason') or p_command->>'reason' ~ '[[:cntrl:]]'
      then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
    if p_command->>'action'='submit' then
      if target_request<>op or (select count(*) from jsonb_object_keys(p_command))<>7 or not(p_command ?& array['expectedBaseOperationId','expectedPolicyRevision','proposal'])
        or coalesce(p_command->>'expectedBaseOperationId','') !~ uuid_pattern or jsonb_typeof(p_command->'expectedPolicyRevision')<>'number'
        or coalesce(p_command->>'expectedPolicyRevision','') !~ '^[1-9][0-9]{0,15}$' or (p_command->>'expectedPolicyRevision')::bigint>9007199254740989 then raise exception 'attendance_invalid_request';end if;
    elsif (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ? 'requestId') or p_command->>'requestId' is distinct from target_request::text then raise exception 'attendance_invalid_request';end if;
  end if;
  perform 1 from public.merchants where id=p_site_id for share;if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into role_row from public.merchant_enterprise_roles where merchant_id=p_site_id and id=emp.role_id for share;
  if not found or role_row.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for share;
  else select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for update;end if;
  if not found then raise exception 'attendance_access_denied';end if;
  if worker.id::text<>p_query->>'expectedWorkerId' then raise exception 'attendance_worker_changed';end if;
  select * into base from public.merchant_attendance_correction_effects where merchant_id=p_site_id and request_id=(p_query->>'baseRequestId')::uuid and worker_id=worker.id;
  if not found then raise exception 'attendance_revision_base_not_found';end if;
  select * into original from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=base.request_id and action='submit';
  if original.employee_id is distinct from emp.id or original.actor_auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_revision_base_not_found';end if;
  if exists(select 1 from public.merchant_attendance_effect_versions where merchant_id=p_site_id and root_request_id=base.request_id and worker_id=worker.id) then raise exception 'attendance_report_version_required';end if;
  if exists(select 1 from public.merchant_attendance_revision_decisions where merchant_id=p_site_id and base_request_id=base.request_id) then raise exception 'attendance_report_version_required';end if;
  select * into decision from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=base.request_id;
  if decision.action is distinct from 'approve' or decision.operation_id is distinct from base.operation_id or decision.recorded_at is distinct from base.recorded_at
    or original.proposal is distinct from base.proposal or original.start_event_id is distinct from base.start_event_id or base.revision<>1 then raise exception 'attendance_revision_invalid_base';end if;
  can_request:='attendance.self.request'=any(role_row.permissions);basis:=original.basis;now_at:=clock_timestamp();
  select * into head from public.merchant_attendance_revision_requests where merchant_id=p_site_id and base_request_id=base.request_id order by revision desc limit 1;
  if head.revision is not null and (head.employee_id<>emp.id or head.actor_auth_user_id<>p_auth_user_id) then raise exception 'attendance_access_denied';end if;
  select * into receipt from public.merchant_attendance_revision_requests r where r.merchant_id=p_site_id and r.operation_id=op;
  if receipt.revision is not null and (receipt.base_request_id<>base.request_id or receipt.request_id<>target_request or receipt.worker_id<>worker.id or receipt.employee_id<>emp.id or receipt.actor_auth_user_id<>p_auth_user_id) then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
  end if;
  select * into first_row from public.merchant_attendance_revision_requests r where r.merchant_id=p_site_id and r.request_id=target_request and r.action='submit';
  if first_row.revision is not null and (first_row.base_request_id<>base.request_id or first_row.employee_id<>emp.id or first_row.actor_auth_user_id<>p_auth_user_id) then raise exception 'attendance_correction_not_found';end if;
  if mode='detail' and first_row.revision is null and (p_command is null or p_command->>'action'<>'submit') then raise exception 'attendance_correction_not_found';end if;
  if p_command is not null then
    if receipt.revision is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=op)
        or exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and operation_id=op) then raise exception 'attendance_operation_conflict';end if;
      if coalesce(head.revision,0)<>(p_command->>'expectedRevision')::bigint or head.recorded_at>=now_at then raise exception 'attendance_version_conflict';end if;
      if p_command->>'action'='submit' then
        if not can_request then raise exception 'attendance_access_denied';end if;
        if not coalesce(p_platform_enabled,false) then raise exception 'attendance_platform_paused';end if;
        if head.action='submit' then raise exception 'attendance_correction_pending';end if;
        if base.operation_id::text<>p_command->>'expectedBaseOperationId' then raise exception 'attendance_revision_base_changed';end if;
        basis:=public.faolla_attendance_correction_basis_v1(p_site_id,p_auth_user_id,base.start_event_id,worker.id,emp.id);
        if basis->'events' is distinct from original.basis->'events' or basis->'events'->-1->>'action'<>'clock_out' then raise exception 'attendance_correction_basis_changed';end if;
        now_at:=clock_timestamp();proposal:=public.faolla_attendance_correction_proposal_v1(p_command->'proposal',now_at);
        if proposal=base.proposal then raise exception 'attendance_revision_unchanged';end if;
        rules:=public.faolla_attendance_revision_rules_v1(p_site_id,original.basis,base.proposal,proposal,now_at);
        if rules->'policy'='null'::jsonb then raise exception 'attendance_correction_policy_required';end if;
        if rules->'policy'->>'revision'<>p_command->>'expectedPolicyRevision' then raise exception 'attendance_correction_policy_changed';end if;
        if rules->'issues' ? 'window_expired' then raise exception 'attendance_correction_window_expired';end if;
        if rules->'issues' ? 'period_locked' then raise exception 'attendance_correction_period_locked';end if;
        if rules->'issues'<>'[]'::jsonb then raise exception 'attendance_correction_rules_unavailable';end if;
      else
        if head.action is distinct from 'submit' or head.request_id<>target_request then raise exception 'attendance_correction_closed';end if;
      end if;
      if now_at<=base.recorded_at then raise exception 'attendance_version_conflict';end if;
      insert into public.merchant_attendance_revision_requests(merchant_id,base_request_id,worker_id,employee_id,revision,request_id,operation_id,actor_auth_user_id,action,policy_revision,base_operation_id,command,recorded_at)
      values(p_site_id,base.request_id,worker.id,emp.id,coalesce(head.revision,0)+1,target_request,op,p_auth_user_id,p_command->>'action',
        case when p_command->>'action'='submit' then (rules->'policy'->>'revision')::bigint else first_row.policy_revision end,base.operation_id,p_command,now_at) returning * into receipt;
      head:=receipt;if receipt.action='submit' then first_row:=receipt;end if;
    end if;
  end if;
  if mode='detail' then select * into last_row from public.merchant_attendance_revision_requests r where r.merchant_id=p_site_id and r.request_id=target_request order by revision desc limit 1;end if;
  now_at:=clock_timestamp();rules:=public.faolla_attendance_revision_rules_v1(p_site_id,original.basis,base.proposal,first_row.command->'proposal',now_at);
  result:=jsonb_build_object('siteId',p_site_id,'mode',mode,'employeeId',emp.id,'workerId',worker.id,'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revision',coalesce(head.revision,0),'pendingRequestId',case when head.action='submit' then head.request_id else null end,
    'canSubmit',can_request and coalesce(p_platform_enabled,false) and (head.action is null or head.action='withdraw') and rules->'issues'='[]'::jsonb,
    'canWithdraw',mode='detail' and last_row.action='submit' and head.request_id=target_request,'approvalAvailable',false,'effectiveChanged',false,
    'basis',original.basis,'currentRules',rules,'base',jsonb_build_object('requestId',base.request_id,'operationId',base.operation_id,'revision',base.revision,'policyRevision',base.policy_revision,
      'proposal',base.proposal,'timeZone',base.time_zone,'recordedAt',to_char(base.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'elapsedUs',base.elapsed_us,'breakUs',base.break_us,'paidBreakUs',base.paid_break_us,'workedUs',base.worked_us),
    'item',case when mode='prepare' then null else jsonb_build_object('requestId',first_row.request_id,'revision',last_row.revision,'submittedRevision',first_row.revision,
      'status',case last_row.action when 'submit' then 'submitted' else 'withdrawn' end,'policyRevision',first_row.policy_revision,'proposal',first_row.command->'proposal','reason',first_row.command->'reason',
      'submittedAt',to_char(first_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'withdrawal',case last_row.action when 'withdraw' then jsonb_build_object('reason',last_row.command->'reason','recordedAt',to_char(last_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end) end,
    'receipt',case when receipt.revision is null then null else jsonb_build_object('operationId',receipt.operation_id,'requestId',receipt.request_id,'revision',receipt.revision,'action',receipt.action,
      'recordedAt',to_char(receipt.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'command',receipt.command) end);
  if octet_length(result::text)>196608 then raise exception 'attendance_revision_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

create or replace function public.faolla_attendance_revision_owner_review_v1(p_site_id text,p_auth_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare first_row public.merchant_attendance_revision_requests%rowtype;last_row public.merchant_attendance_revision_requests%rowtype;head public.merchant_attendance_revision_requests%rowtype;
  base public.merchant_attendance_correction_effects%rowtype;original public.merchant_attendance_correction_entries%rowtype;decision public.merchant_attendance_correction_decisions%rowtype;
  emp public.merchant_enterprise_employees%rowtype;worker public.merchant_attendance_workers%rowtype;
  now_at timestamptz;as_of text;proposed jsonb;summary jsonb;rules jsonb;evidence jsonb;periods jsonb;period_count integer;
  first_day date;last_day date;review jsonb;base_json jsonb;checks jsonb;blockers jsonb;token text;result jsonb;code text;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_request_id is null then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into first_row from public.merchant_attendance_revision_requests where merchant_id=p_site_id and request_id=p_request_id and action='submit';
  if not found then raise exception 'attendance_correction_not_found';end if;
  -- Current owner can inspect a historical request even after requester loses
  -- permission. Binding changes are an explicit blocker, never a silent rebind.
  select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and id=first_row.employee_id for share;
  select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and id=first_row.worker_id for share;
  if emp.id is null or worker.id is null then raise exception 'attendance_revision_invalid_base';end if;
  if exists(select 1 from public.merchant_attendance_effect_versions where merchant_id=p_site_id and worker_id=worker.id) then raise exception 'attendance_report_version_required';end if;
  if exists(select 1 from public.merchant_attendance_revision_decisions where merchant_id=p_site_id and request_id=p_request_id) then raise exception 'attendance_report_version_required';end if;
  select * into last_row from public.merchant_attendance_revision_requests where merchant_id=p_site_id and request_id=p_request_id order by revision desc limit 1;
  select * into head from public.merchant_attendance_revision_requests where merchant_id=p_site_id and base_request_id=first_row.base_request_id order by revision desc limit 1;
  select * into base from public.merchant_attendance_correction_effects where merchant_id=p_site_id and request_id=first_row.base_request_id;
  select * into original from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=first_row.base_request_id and action='submit';
  select * into decision from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=first_row.base_request_id;
  now_at:=clock_timestamp();as_of:=to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  if base.worker_id is distinct from worker.id or base.revision is distinct from 1 or base.operation_id is distinct from first_row.base_operation_id
    or original.employee_id is distinct from first_row.employee_id or original.actor_auth_user_id is distinct from first_row.actor_auth_user_id
    or original.start_event_id is distinct from base.start_event_id or original.proposal is distinct from base.proposal
    or decision.action is distinct from 'approve' or decision.operation_id is distinct from base.operation_id or decision.recorded_at is distinct from base.recorded_at
    or base.recorded_at>=first_row.recorded_at or first_row.recorded_at>now_at or last_row.recorded_at>now_at or head.recorded_at>now_at
    then raise exception 'attendance_revision_invalid_base';end if;
  proposed:=public.faolla_attendance_correction_proposal_v1(first_row.command->'proposal',first_row.recorded_at);
  rules:=public.faolla_attendance_revision_bound_rules_v1(p_site_id,first_row,original.basis,base.proposal,now_at);
  begin
    evidence:=public.faolla_attendance_correction_owner_basis_v1(p_site_id,worker.id,first_row.employee_id,base.start_event_id,now_at);
  exception when sqlstate 'P0001' then
    code:=sqlerrm;if code not in ('attendance_session_not_found','attendance_session_invalid_records','attendance_session_too_large','attendance_session_span_too_long','attendance_correction_unsupported_basis') then raise;end if;
    evidence:=jsonb_build_object('currentBasis',null,'previous',null,'next',null,'basisIssue',code);
  end;
  first_day:=((proposed->>'startAt')::timestamptz at time zone base.time_zone)::date;
  last_day:=(((proposed->>'endAt')::timestamptz-interval '1 microsecond') at time zone base.time_zone)::date;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('startsOn',starts_on,'endsOn',ends_on) order by starts_on) filter(where rn<=100),'[]'::jsonb)
    into period_count,periods from (select starts_on,ends_on,row_number() over(order by starts_on) rn from (
      select starts_on,ends_on from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=worker.id
      and starts_on<=last_day and (ends_on is null or ends_on>=first_day) order by starts_on limit 101) bounded) matches;
  evidence:=evidence||jsonb_build_object('bindingCurrent',coalesce(worker.employee_id=first_row.employee_id and emp.auth_user_id=first_row.actor_auth_user_id,false),
    'ownApplication',first_row.actor_auth_user_id=p_auth_user_id,'employmentPeriods',periods,'employmentTruncated',period_count>100);
  summary:=jsonb_build_object('requestId',p_request_id,'startEventId',base.start_event_id,'revision',last_row.revision,
    'status',case last_row.action when 'submit' then 'submitted' else 'withdrawn' end,
    'submittedAt',to_char(first_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'startAt',proposed->'startAt','endAt',proposed->'endAt');
  review:=jsonb_build_object('siteId',p_site_id,'mode','detail','asOf',as_of,'approvalAvailable',false,'rulesEnforced',true,
    'item',summary||jsonb_build_object('workerId',worker.id,'employeeId',first_row.employee_id,'workerName',worker.display_name,'workerNo',worker.worker_no),
    'application',jsonb_build_object('siteId',p_site_id,'employeeId',first_row.employee_id,'workerId',worker.id,'asOf',as_of,'mode','detail','canRequest',false,
      'rulesEnforced',true,'rules',rules,'item',summary,'basis',original.basis,'proposal',proposed,'reason',first_row.command->'reason','receipt',null,
      'withdrawal',case last_row.action when 'withdraw' then jsonb_build_object('reason',last_row.command->'reason','recordedAt',to_char(last_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end),
    'evidence',evidence);
  checks:=public.faolla_attendance_revision_review_checks_v1(p_site_id,review,base.start_event_id);blockers:=checks->'blockers';
  base_json:=jsonb_build_object('requestId',base.request_id,'operationId',base.operation_id,'revision',base.revision,'policyRevision',base.policy_revision,
    'proposal',base.proposal,'timeZone',base.time_zone,'recordedAt',to_char(base.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'elapsedUs',base.elapsed_us,'breakUs',base.break_us,'paidBreakUs',base.paid_break_us,'workedUs',base.worked_us);
  -- Optimistic evidence fingerprint only. It is not a signature, grant or saved
  -- approval. A future deciding transaction must recompute it and all checks.
  token:=md5(jsonb_build_object('sourceToken',checks->'evidenceToken','base',base_json,'command',first_row.command,'headOperation',head.operation_id,
    'headRevision',head.revision,'blockers',blockers)::text);
  result:=jsonb_build_object('siteId',p_site_id,'requestId',p_request_id,'asOf',as_of,'reviewOnly',true,'approvalAvailable',false,'effectiveChanged',false,
    'review',review,'base',base_json,'submittedRevision',first_row.revision,'ledgerRevision',head.revision,
    'pendingRequestId',case head.action when 'submit' then head.request_id else null end,'evidenceToken',token,'blockers',blockers,
    'checksPassed',blockers='[]'::jsonb,'rejectionChecksPassed',checks->'canReject');
  if octet_length(result::text)>393216 then raise exception 'attendance_revision_review_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
insert into public.faolla_schema_migrations(version,name) values(202610010094,'merchant_attendance_revision_decision_core') on conflict(version) do nothing;
commit;
