-- Unreleased first-decision candidate. Historical decision effect and current
-- effective source are distinct. No application grant or existing-call switch.
begin;
set local lock_timeout='3s';

create function public.faolla_attendance_decision_checks_v2(p_site text,r jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=r->'application';e jsonb:=r->'evidence';issues text[]:='{}';x text;
  from_at timestamptz;to_at timestamptz;zone text;first_day date;last_day date;day date;
  left_at timestamptz;right_at timestamptz;n integer;coverage integer;effective public.merchant_attendance_effect_current_v2%rowtype;
  controls_revision bigint;tail_id uuid;effect_id uuid;token text;can_reject boolean;
begin
  if a->'item'->>'status'<>'submitted' then issues:=array_append(issues,'withdrawn');end if;
  if exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id=p_site and request_id=(r->'item'->>'requestId')::uuid) then issues:=array_append(issues,'already_decided');end if;
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
      -- Skip nonexistent local dates and include only actual half-open proposal coverage.
      if right_at>left_at and left_at<to_at and right_at>from_at then
        select count(*) into coverage from jsonb_array_elements(e->'employmentPeriods') p where (p->>'startsOn')::date<=day and (p->'endsOn'='null'::jsonb or (p->>'endsOn')::date>=day);
        if coverage=0 and not('employment_gap'=any(issues)) then issues:=array_append(issues,'employment_gap');end if;
        if coverage>1 and not('employment_ambiguous'=any(issues)) then issues:=array_append(issues,'employment_ambiguous');end if;
      end if;
    end loop;
  end if;
  if exists(select 1 from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid and start_event_id=(r->'item'->>'startEventId')::uuid) then issues:=array_append(issues,'already_effective');end if;
  -- Latest effective spans are nonoverlapping under the same settings UPDATE lock.
  select * into effective from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid
    and start_at<to_at order by start_at desc limit 1;
  if effective.request_id is not null and effective.end_at>from_at then issues:=array_append(issues,'effective_overlap');end if;
  select coalesce(max(revision),0) into controls_revision from public.merchant_attendance_correction_controls where merchant_id=p_site;
  select id into tail_id from public.merchant_attendance_events where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by sequence desc limit 1;
  select operation_id into effect_id from public.merchant_attendance_effect_current_v2 where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by recorded_at desc,operation_id desc limit 1;
  -- Optimistic comparison only, NOT a capability or authorization token. Recheck all conditions on every write.
  token:=md5(jsonb_build_object('item',r->'item','original',a->'basis'->'events','current',e->'currentBasis'->'events',
    'evidence',e-'currentBasis','rules',(a->'rules')-'checkedAt','controlsRevision',controls_revision,'tailId',tail_id,'effectId',effect_id)::text);
  return jsonb_build_object('evidenceToken',token,'blockers',to_jsonb(issues),'canApprove',cardinality(issues)=0,'canReject',can_reject);
end; $$;
revoke all on function public.faolla_attendance_decision_checks_v2(text,jsonb) from public,anon,authenticated,service_role;

create function public.faolla_attendance_correction_decide_v2(p_site_id text,p_auth_user_id uuid,p_request_id uuid,p_command jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;checks jsonb;d public.merchant_attendance_correction_decisions%rowtype;receipt public.merchant_attendance_correction_decisions%rowtype;
  effect public.merchant_attendance_correction_effects%rowtype;effect_json jsonb:='null';a jsonb;now_at timestamptz;op uuid;
  current_effect public.merchant_attendance_effect_current_v2%rowtype;current_json jsonb:='null';replayed boolean:=false;changed boolean:=false;
  proposal jsonb;b jsonb;elapsed_us bigint;break_us bigint:=0;paid_us bigint:=0;duration_us bigint;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_request_id is null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' or (select count(*) from jsonb_object_keys(p_command))<>6
      or not(p_command ?& array['action','operationId','requestId','expectedRevision','expectedEvidence','reason'])
      or coalesce(p_command->>'action','') not in ('approve','reject') or p_command->>'requestId' is distinct from p_request_id::text
      or coalesce(p_command->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
  r:=public.faolla_attendance_correction_owner_review_v2(p_site_id,p_auth_user_id,jsonb_build_object('mode','detail','requestId',p_request_id));
  a:=r->'application';checks:=public.faolla_attendance_decision_checks_v2(p_site_id,r);
  select * into receipt from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and operation_id=op;
  if receipt.request_id is not null and (receipt.request_id<>p_request_id or receipt.actor_auth_user_id<>p_auth_user_id) then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
  end if;
  if p_command is not null then
    if receipt.request_id is not null then
      replayed:=true;
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if not coalesce(p_allow_write,false) then raise exception 'attendance_platform_paused';end if;
      if exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=op)
        or exists(select 1 from public.merchant_attendance_revision_requests where merchant_id=p_site_id and operation_id=op)
        or exists(select 1 from public.merchant_attendance_revision_decisions where merchant_id=p_site_id and operation_id=op)
        or exists(select 1 from public.merchant_attendance_effect_versions where merchant_id=p_site_id and operation_id=op) then raise exception 'attendance_operation_conflict';end if;
      if exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=p_request_id) then raise exception 'attendance_correction_decided';end if;
      if (a->'item'->>'revision')::bigint<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
      if checks->>'evidenceToken'<>p_command->>'expectedEvidence' then raise exception 'attendance_correction_evidence_changed';end if;
      if not (checks->>(case p_command->>'action' when 'approve' then 'canApprove' else 'canReject' end))::boolean then raise exception 'attendance_correction_decision_blocked';end if;
      now_at:=clock_timestamp();
      if now_at<=(a->'item'->>'submittedAt')::timestamptz or now_at<(r->>'asOf')::timestamptz then raise exception 'attendance_version_conflict';end if;
      insert into public.merchant_attendance_correction_decisions(merchant_id,request_id,operation_id,actor_auth_user_id,action,request_revision,evidence_token,reason,command,review_snapshot,recorded_at)
        values(p_site_id,p_request_id,op,p_auth_user_id,p_command->>'action',(a->'item'->>'revision')::bigint,p_command->>'expectedEvidence',p_command->>'reason',p_command,r,now_at) returning * into receipt;
      if receipt.action='approve' then
        changed:=true;
        proposal:=public.faolla_attendance_correction_proposal_v1(a->'proposal',now_at);
        elapsed_us:=(extract(epoch from ((proposal->>'endAt')::timestamptz-(proposal->>'startAt')::timestamptz))*1000000)::bigint;
        for b in select value from jsonb_array_elements(proposal->'breaks') loop
          duration_us:=(extract(epoch from ((b->>'endAt')::timestamptz-(b->>'startAt')::timestamptz))*1000000)::bigint;
          break_us:=break_us+duration_us;if (b->>'paid')::boolean then paid_us:=paid_us+duration_us;end if;
        end loop;
        insert into public.merchant_attendance_correction_effects(merchant_id,worker_id,start_event_id,request_id,operation_id,revision,policy_revision,proposal,time_zone,
          start_at,end_at,elapsed_us,break_us,paid_break_us,worked_us,recorded_at)
          values(p_site_id,(r->'item'->>'workerId')::uuid,(r->'item'->>'startEventId')::uuid,p_request_id,op,1,(a->'rules'->'policy'->>'revision')::bigint,
            proposal,a->'basis'->'events'->0->>'timeZone',(proposal->>'startAt')::timestamptz,(proposal->>'endAt')::timestamptz,elapsed_us,break_us,paid_us,elapsed_us-break_us,now_at);
      end if;
      checks:=public.faolla_attendance_decision_checks_v2(p_site_id,r);
    end if;
  end if;
  if p_command is null and receipt.request_id is not null then replayed:=true;end if;
  select * into d from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=p_request_id;
  select * into effect from public.merchant_attendance_correction_effects where merchant_id=p_site_id and request_id=p_request_id;
  if effect.request_id is not null then effect_json:=jsonb_build_object('requestId',effect.request_id,'operationId',effect.operation_id,'revision',effect.revision,
    'policyRevision',effect.policy_revision,'timeZone',effect.time_zone,'proposal',effect.proposal,'calculationVersion','declaration-v1',
    'elapsedUs',effect.elapsed_us,'workedUs',effect.worked_us,'breakUs',effect.break_us,'paidBreakUs',effect.paid_break_us,
    'recordedAt',to_char(effect.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));end if;
  now_at:=clock_timestamp();
  select * into current_effect from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id
    and worker_id=(r->'item'->>'workerId')::uuid and start_event_id=(r->'item'->>'startEventId')::uuid;
  if current_effect.request_id is not null then current_json:=public.faolla_attendance_effect_evidence_v2(current_effect,now_at);end if;
  return jsonb_build_object('protocol','correction-decision-v2','siteId',p_site_id,'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'review',r,'evidenceToken',checks->'evidenceToken','blockers',checks->'blockers','canApprove',coalesce(p_allow_write,false) and (checks->>'canApprove')::boolean,
    'canReject',coalesce(p_allow_write,false) and (checks->>'canReject')::boolean,'decision',public.faolla_attendance_decision_summary_v1(d),
    'receipt',public.faolla_attendance_decision_summary_v1(receipt),'effective',effect_json,'current',current_json,'writeEnabled',coalesce(p_allow_write,false),'replayed',replayed,'effectiveChanged',changed);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_correction_decide_v2(text,uuid,uuid,jsonb,uuid,boolean) from public,anon,authenticated,service_role;

insert into public.faolla_schema_migrations(version,name) values(202610010096,'merchant_attendance_current_correction_decisions') on conflict(version) do nothing;
commit;
