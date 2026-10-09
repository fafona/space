-- Default-off, READ ONLY preparation for revision decisions. No new approvals,
-- no effective version changes and no replacement of working report readers.
begin;
set local lock_timeout='3s';

create function public.faolla_attendance_revision_bound_rules_v1(p_site text,p_request public.merchant_attendance_revision_requests,p_basis jsonb,p_base jsonb,p_now timestamptz) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare policy public.merchant_attendance_correction_controls%rowtype;
  original_start timestamptz:=(p_basis->'events'->0->>'occurredAt')::timestamptz;
  original_end timestamptz:=(p_basis->'events'->-1->>'occurredAt')::timestamptz;
  proposal jsonb:=p_request.command->'proposal';anchor date;deadline timestamptz;issues text[]:='{}';locked_count integer;
begin
  select * into policy from public.merchant_attendance_correction_controls where merchant_id=p_site and revision=p_request.policy_revision and action='set_policy';
  if policy.revision is null or policy.recorded_at>p_request.recorded_at or p_request.action<>'submit' then raise exception 'attendance_revision_invalid_base';end if;
  anchor:=(original_start at time zone (policy.payload->>'timeZone'))::date;
  if anchor<date '2000-01-01' or anchor>date '2100-12-31' then issues:=array_append(issues,'unsupported_dates');
  else
    deadline:=public.faolla_attendance_control_day_boundary_v1(anchor+(policy.payload->>'submissionWindowDays')::integer+1,policy.payload->>'timeZone');
    if p_request.recorded_at>=deadline then issues:=array_append(issues,'window_expired');end if;
  end if;
  if ((proposal->>'startAt')::timestamptz<timestamptz '2000-01-01Z' or (proposal->>'endAt')::timestamptz>timestamptz '2101-01-01Z') and not('unsupported_dates'=any(issues)) then issues:=array_append(issues,'unsupported_dates');end if;
  if original_start=original_end then original_end:=original_end+interval '1 microsecond';end if;
  select count(*) into locked_count from (select 1 from public.merchant_attendance_correction_periods where merchant_id=p_site and locked and (
    start_at<original_end and end_at>original_start
    or start_at<(p_base->>'endAt')::timestamptz and end_at>(p_base->>'startAt')::timestamptz
    or start_at<(proposal->>'endAt')::timestamptz and end_at>(proposal->>'startAt')::timestamptz) limit 201) locks;
  if locked_count>200 then issues:=array_append(issues,'period_limit');elsif locked_count>0 then issues:=array_append(issues,'period_locked');end if;
  return jsonb_build_object('binding','bound','approvalAvailable',false,'lockedPeriodCount',least(locked_count,200),
    'checkedAt',to_char(p_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'policy',jsonb_build_object('revision',policy.revision,'recordedAt',to_char(policy.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',policy.payload->'timeZone','submissionWindowDays',policy.payload->'submissionWindowDays'),
    'deadlineAt',case when deadline is null then null else to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'issues',to_jsonb(issues));
end; $$;
revoke all on function public.faolla_attendance_revision_bound_rules_v1(text,public.merchant_attendance_revision_requests,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;

-- Revision-specific checks: never look up a revision request in the original
-- request/decision namespace, even when an old API later reuses the same UUID.
create function public.faolla_attendance_revision_review_checks_v1(p_site text,r jsonb,p_base_start uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=r->'application';e jsonb:=r->'evidence';issues text[]:='{}';x text;can_reject boolean;
  from_at timestamptz;to_at timestamptz;zone text;first_day date;last_day date;day date;left_at timestamptz;right_at timestamptz;n integer;coverage integer;
  other_effect public.merchant_attendance_correction_effects%rowtype;controls_revision bigint;tail_id uuid;effect_id uuid;token text;
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
  -- Current v1 effects are mutually nonoverlapping under settings UPDATE lock.
  -- Exclude only this shift's old approval, then test the nearest other start.
  select * into other_effect from public.merchant_attendance_correction_effects where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid
    and start_event_id<>p_base_start and start_at<to_at order by start_at desc limit 1;
  if other_effect.request_id is not null and other_effect.end_at>from_at then issues:=array_append(issues,'effective_overlap');end if;
  select coalesce(max(revision),0) into controls_revision from public.merchant_attendance_correction_controls where merchant_id=p_site;
  select id into tail_id from public.merchant_attendance_events where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by sequence desc limit 1;
  select operation_id into effect_id from public.merchant_attendance_correction_effects where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by recorded_at desc,operation_id desc limit 1;
  token:=md5(jsonb_build_object('item',r->'item','original',a->'basis'->'events','current',e->'currentBasis'->'events',
    'evidence',e-'currentBasis','rules',(a->'rules')-'checkedAt','controlsRevision',controls_revision,'tailId',tail_id,'effectId',effect_id)::text);
  return jsonb_build_object('evidenceToken',token,'blockers',to_jsonb(issues),'canReject',can_reject);
end; $$;
revoke all on function public.faolla_attendance_revision_review_checks_v1(text,jsonb,uuid) from public,anon,authenticated,service_role;

create function public.faolla_attendance_revision_owner_review_v1(p_site_id text,p_auth_user_id uuid,p_request_id uuid) returns jsonb
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
revoke all on function public.faolla_attendance_revision_owner_review_v1(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_revision_owner_review_v1(text,uuid,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010092,'merchant_attendance_revision_review') on conflict(version) do nothing;
commit;
