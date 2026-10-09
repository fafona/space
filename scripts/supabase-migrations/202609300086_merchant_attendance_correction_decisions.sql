-- Unreleased/default-off attendance candidate. One immutable decision per request.
-- Approved declarations are separate from original punches, payroll and period reports.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_correction_decisions (
  merchant_id text not null, request_id uuid not null, operation_id uuid not null,
  actor_auth_user_id uuid not null, action text not null check(action in ('approve','reject')),
  request_revision bigint not null check(request_revision between 1 and 9007199254740989),
  evidence_token text not null check(evidence_token ~ '^[0-9a-f]{32}$'),
  reason text not null check(char_length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'),
  command jsonb not null check(jsonb_typeof(command)='object'), review_snapshot jsonb not null check(jsonb_typeof(review_snapshot)='object'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,request_id), unique(merchant_id,operation_id),
  foreign key(merchant_id,request_id) references public.merchant_attendance_correction_entries(merchant_id,operation_id) on delete restrict
);
create table public.merchant_attendance_correction_effects (
  merchant_id text not null, worker_id uuid not null, start_event_id uuid not null,
  request_id uuid not null, operation_id uuid not null, revision integer not null check(revision=1),
  policy_revision bigint not null, proposal jsonb not null check(jsonb_typeof(proposal)='object'),
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)),
  start_at timestamptz not null, end_at timestamptz not null,
  elapsed_us bigint not null check(elapsed_us between 1 and 2678400000000),
  break_us bigint not null check(break_us>=0), paid_break_us bigint not null check(paid_break_us>=0),
  worked_us bigint not null check(worked_us>=0), recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,worker_id,start_event_id), unique(merchant_id,request_id),
  foreign key(merchant_id,request_id) references public.merchant_attendance_correction_decisions(merchant_id,request_id) on delete restrict,
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(merchant_id,policy_revision) references public.merchant_attendance_correction_controls(merchant_id,revision) on delete restrict,
  foreign key(start_event_id) references public.merchant_attendance_events(id) on delete restrict,
  check(isfinite(start_at) and isfinite(end_at) and end_at>start_at and end_at<=recorded_at),
  check(elapsed_us=extract(epoch from(end_at-start_at))*1000000 and worked_us+break_us=elapsed_us and paid_break_us<=break_us)
);
create index attendance_effect_worker_start_idx on public.merchant_attendance_correction_effects(merchant_id,worker_id,start_at desc);
create index attendance_effect_worker_latest_idx on public.merchant_attendance_correction_effects(merchant_id,worker_id,recorded_at desc,operation_id desc);
alter table public.merchant_attendance_correction_decisions enable row level security;
alter table public.merchant_attendance_correction_effects enable row level security;
revoke all on public.merchant_attendance_correction_decisions,public.merchant_attendance_correction_effects from public,anon,authenticated,service_role;
create trigger attendance_decision_no_rewrite before update or delete on public.merchant_attendance_correction_decisions for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_decision_no_truncate before truncate on public.merchant_attendance_correction_decisions for each statement execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_effect_no_rewrite before update or delete on public.merchant_attendance_correction_effects for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_effect_no_truncate before truncate on public.merchant_attendance_correction_effects for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_decision_summary_v1(d public.merchant_attendance_correction_decisions) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select case when d.request_id is null then null else jsonb_build_object('requestId',d.request_id,'operationId',d.operation_id,
    'action',d.action,'requestRevision',d.request_revision,'evidenceToken',d.evidence_token,'reason',d.reason,
    'recordedAt',to_char(d.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end;
$$;
revoke all on function public.faolla_attendance_decision_summary_v1(public.merchant_attendance_correction_decisions) from public,anon,authenticated,service_role;

create function public.faolla_attendance_decision_checks_v1(p_site text,r jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=r->'application';e jsonb:=r->'evidence';issues text[]:='{}';x text;
  from_at timestamptz;to_at timestamptz;zone text;first_day date;last_day date;day date;
  left_at timestamptz;right_at timestamptz;n integer;coverage integer;effective public.merchant_attendance_correction_effects%rowtype;
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
  if exists(select 1 from public.merchant_attendance_correction_effects where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid and start_event_id=(r->'item'->>'startEventId')::uuid) then issues:=array_append(issues,'already_effective');end if;
  -- Existing effects are nonoverlapping under the same settings UPDATE lock; nearest start suffices.
  select * into effective from public.merchant_attendance_correction_effects where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid
    and start_at<to_at order by start_at desc limit 1;
  if effective.request_id is not null and effective.end_at>from_at then issues:=array_append(issues,'effective_overlap');end if;
  select coalesce(max(revision),0) into controls_revision from public.merchant_attendance_correction_controls where merchant_id=p_site;
  select id into tail_id from public.merchant_attendance_events where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by sequence desc limit 1;
  select operation_id into effect_id from public.merchant_attendance_correction_effects where merchant_id=p_site and worker_id=(r->'item'->>'workerId')::uuid order by recorded_at desc,operation_id desc limit 1;
  -- Optimistic comparison only, NOT a capability or authorization token. Recheck all conditions on every write.
  token:=md5(jsonb_build_object('item',r->'item','original',a->'basis'->'events','current',e->'currentBasis'->'events',
    'evidence',e-'currentBasis','rules',(a->'rules')-'checkedAt','controlsRevision',controls_revision,'tailId',tail_id,'effectId',effect_id)::text);
  return jsonb_build_object('evidenceToken',token,'blockers',to_jsonb(issues),'canApprove',cardinality(issues)=0,'canReject',can_reject);
end; $$;
revoke all on function public.faolla_attendance_decision_checks_v1(text,jsonb) from public,anon,authenticated,service_role;

create function public.faolla_attendance_correction_decide_v1(p_site_id text,p_auth_user_id uuid,p_request_id uuid,p_command jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;checks jsonb;d public.merchant_attendance_correction_decisions%rowtype;receipt public.merchant_attendance_correction_decisions%rowtype;
  effect public.merchant_attendance_correction_effects%rowtype;effect_json jsonb:='null';a jsonb;now_at timestamptz;op uuid;
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
  a:=r->'application';checks:=public.faolla_attendance_decision_checks_v1(p_site_id,r);
  select * into receipt from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and operation_id=op;
  if receipt.request_id is not null and (receipt.request_id<>p_request_id or receipt.actor_auth_user_id<>p_auth_user_id) then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
  end if;
  if p_command is not null then
    if receipt.request_id is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if not coalesce(p_allow_write,false) then raise exception 'attendance_platform_paused';end if;
      if exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=p_request_id) then raise exception 'attendance_correction_decided';end if;
      if (a->'item'->>'revision')::bigint<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
      if checks->>'evidenceToken'<>p_command->>'expectedEvidence' then raise exception 'attendance_correction_evidence_changed';end if;
      if not (checks->>(case p_command->>'action' when 'approve' then 'canApprove' else 'canReject' end))::boolean then raise exception 'attendance_correction_decision_blocked';end if;
      now_at:=clock_timestamp();
      if now_at<=(a->'item'->>'submittedAt')::timestamptz or now_at<(r->>'asOf')::timestamptz then raise exception 'attendance_version_conflict';end if;
      insert into public.merchant_attendance_correction_decisions(merchant_id,request_id,operation_id,actor_auth_user_id,action,request_revision,evidence_token,reason,command,review_snapshot,recorded_at)
        values(p_site_id,p_request_id,op,p_auth_user_id,p_command->>'action',(a->'item'->>'revision')::bigint,p_command->>'expectedEvidence',p_command->>'reason',p_command,r,now_at) returning * into receipt;
      if receipt.action='approve' then
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
      checks:=public.faolla_attendance_decision_checks_v1(p_site_id,r);
    end if;
  end if;
  select * into d from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=p_request_id;
  select * into effect from public.merchant_attendance_correction_effects where merchant_id=p_site_id and request_id=p_request_id;
  if effect.request_id is not null then effect_json:=jsonb_build_object('requestId',effect.request_id,'operationId',effect.operation_id,'revision',effect.revision,
    'policyRevision',effect.policy_revision,'timeZone',effect.time_zone,'proposal',effect.proposal,'calculationVersion','declaration-v1',
    'elapsedUs',effect.elapsed_us,'workedUs',effect.worked_us,'breakUs',effect.break_us,'paidBreakUs',effect.paid_break_us,
    'recordedAt',to_char(effect.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));end if;
  return jsonb_build_object('siteId',p_site_id,'asOf',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'review',r,'evidenceToken',checks->'evidenceToken','blockers',checks->'blockers','canApprove',coalesce(p_allow_write,false) and (checks->>'canApprove')::boolean,
    'canReject',coalesce(p_allow_write,false) and (checks->>'canReject')::boolean,'decision',public.faolla_attendance_decision_summary_v1(d),
    'receipt',public.faolla_attendance_decision_summary_v1(receipt),'effective',effect_json,'timesheetIntegrated',false);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_correction_decide_v1(text,uuid,uuid,jsonb,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_decide_v1(text,uuid,uuid,jsonb,uuid,boolean) to service_role;

-- Existing readers show final decisions; the original submission status remains an immutable fact.
create function public.faolla_attendance_decision_decorate_v1(p_site text,r jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare i jsonb;items jsonb:='[]';d public.merchant_attendance_correction_decisions%rowtype;
begin
  if r->>'mode'='list' then
    for i in select value from jsonb_array_elements(r->'items') loop
      select * into d from public.merchant_attendance_correction_decisions where merchant_id=p_site and request_id=(i->>'requestId')::uuid and recorded_at<=(r->>'asOf')::timestamptz;
      items:=items||jsonb_build_array(i||jsonb_build_object('decision',public.faolla_attendance_decision_summary_v1(d)));
    end loop;r:=jsonb_set(r,'{items}',items);
  elsif r->>'mode'='detail' then
    select * into d from public.merchant_attendance_correction_decisions where merchant_id=p_site and request_id=(r->'item'->>'requestId')::uuid;
    r:=jsonb_set(r,'{item,decision}',coalesce(public.faolla_attendance_decision_summary_v1(d),'null'::jsonb));
    if r ? 'application' then r:=jsonb_set(r,'{application}',public.faolla_attendance_decision_decorate_v1(p_site,r->'application'));
    elsif d.request_id is not null then r:=jsonb_set(r,'{canRequest}','false');end if;
  end if;
  return r||jsonb_build_object('decisionsAvailable',true);
end; $$;
revoke all on function public.faolla_attendance_decision_decorate_v1(text,jsonb) from public,anon,authenticated,service_role;
create function public.faolla_attendance_correction_self_v3(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null,p_platform_enabled boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin return public.faolla_attendance_decision_decorate_v1(p_site_id,public.faolla_attendance_correction_self_v2(p_site_id,p_auth_user_id,p_query,p_command,p_platform_enabled));end; $$;
create function public.faolla_attendance_correction_owner_review_v3(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin return public.faolla_attendance_decision_decorate_v1(p_site_id,public.faolla_attendance_correction_owner_review_v2(p_site_id,p_auth_user_id,p_query));end; $$;
revoke all on function public.faolla_attendance_correction_self_v2(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_owner_review_v2(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_self_v3(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_owner_review_v3(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_self_v3(text,uuid,jsonb,jsonb,boolean) to service_role;
grant execute on function public.faolla_attendance_correction_owner_review_v3(text,uuid,jsonb) to service_role;

-- SELF_CORE_DECISION_GUARDS: expanded original self function follows (no runtime function-text rewriting).
create or replace function public.faolla_attendance_correction_self_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null,p_platform_enabled boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  emp public.merchant_enterprise_employees%rowtype;rr public.merchant_enterprise_roles%rowtype;w public.merchant_attendance_workers%rowtype;
  first_entry public.merchant_attendance_correction_entries%rowtype;last_entry public.merchant_attendance_correction_entries%rowtype;
  head public.merchant_attendance_correction_entries%rowtype;receipt public.merchant_attendance_correction_entries%rowtype;r public.merchant_attendance_correction_entries%rowtype;
  v_mode text;v_worker uuid;v_start uuid;v_request uuid;v_operation uuid;v_cursor_at timestamptz;v_cursor uuid;
  v_now timestamptz;v_basis jsonb;v_proposal jsonb;v_common jsonb;v_can boolean;v_count integer:=0;v_items jsonb:='[]';v_next jsonb:='null';
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or coalesce(p_query->>'expectedWorkerId','') !~ v_uuid then raise exception 'attendance_invalid_request';end if;
  v_mode:=p_query->>'mode';v_worker:=(p_query->>'expectedWorkerId')::uuid;
  if v_mode='prepare' then
    if p_command is not null or (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['mode','expectedWorkerId','startEventId'])
      or coalesce(p_query->>'startEventId','') !~ v_uuid then raise exception 'attendance_invalid_request';end if;v_start:=(p_query->>'startEventId')::uuid;
  elsif v_mode='detail' then
    if (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['mode','expectedWorkerId','requestId','operationId'])
      or coalesce(p_query->>'requestId','') !~ v_uuid or (p_query->'operationId'<>'null'::jsonb and coalesce(p_query->>'operationId','') !~ v_uuid)
      then raise exception 'attendance_invalid_request';end if;
    v_request:=(p_query->>'requestId')::uuid;v_operation:=(p_query->>'operationId')::uuid;
  elsif v_mode='list' then
    if p_command is not null or (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['mode','expectedWorkerId','cursorAt','cursorId'])
      or ((p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb))
      or (p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid) then raise exception 'attendance_invalid_request';end if;
    v_cursor:=(p_query->>'cursorId')::uuid;if v_cursor is not null then v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt');end if;
  else raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' or v_operation is not null or coalesce(p_command->>'action','') not in ('submit','withdraw')
      or coalesce(p_command->>'operationId','') !~ v_uuid or jsonb_typeof(p_command->'expectedRevision')<>'number'
      or coalesce(p_command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$' or (p_command->>'expectedRevision')::numeric>9007199254740988
      or jsonb_typeof(p_command->'reason')<>'string' or char_length(btrim(p_command->>'reason')) not between 1 and 500
      or p_command->>'reason'<>btrim(p_command->>'reason') or p_command->>'reason' ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request';end if;
    v_operation:=(p_command->>'operationId')::uuid;
    if p_command->>'action'='submit' then
      if (select count(*) from jsonb_object_keys(p_command))<>7 or not(p_command ?& array['action','operationId','expectedRevision','reason','startEventId','expectedLastEventId','proposal'])
        or v_request<>v_operation or coalesce(p_command->>'startEventId','') !~ v_uuid or coalesce(p_command->>'expectedLastEventId','') !~ v_uuid
        then raise exception 'attendance_invalid_request';end if;v_start:=(p_command->>'startEventId')::uuid;
    else
      if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['action','operationId','expectedRevision','reason','requestId'])
        or p_command->>'requestId' is distinct from v_request::text then raise exception 'attendance_invalid_request';end if;
    end if;
  end if;
  perform 1 from public.merchants where id=p_site_id for share;if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;if not found then raise exception 'attendance_settings_required';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into rr from public.merchant_enterprise_roles where merchant_id=p_site_id and id=emp.role_id for share;
  if not found or rr.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(rr.permissions)
    or not('attendance.self.view'=any(rr.permissions)) then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for share;
  else select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for update;end if;
  if not found then raise exception 'attendance_access_denied';end if;if w.id<>v_worker then raise exception 'attendance_worker_changed';end if;
  -- Inactive workers may request historical review; no new clock permission follows.
  v_can:='attendance.self.request'=any(rr.permissions);v_now:=clock_timestamp();
  v_common:=jsonb_build_object('siteId',p_site_id,'employeeId',emp.id,'workerId',w.id,'canRequest',v_can,'mode',v_mode);
  if v_mode='list' then
    for r in select * from public.merchant_attendance_correction_entries
      where merchant_id=p_site_id and worker_id=w.id and actor_auth_user_id=p_auth_user_id and employee_id=emp.id and action='submit'
      and (v_cursor is null or (recorded_at,request_id)<(v_cursor_at,v_cursor)) order by recorded_at desc,request_id desc limit 26
    loop
      v_count:=v_count+1;if v_count=26 then exit;end if;
      select * into last_entry from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=r.request_id order by revision desc limit 1;
      v_items:=v_items||jsonb_build_array(public.faolla_attendance_correction_summary_v1(r,last_entry));
      v_next:=jsonb_build_object('recordedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'requestId',r.request_id);
    end loop;
    return v_common||jsonb_build_object('asOf',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_items,'nextCursor',case when v_count=26 then v_next else 'null'::jsonb end);
  end if;
  if v_mode='detail' then
    select * into first_entry from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=v_request and action='submit';
    if first_entry.revision is not null and (first_entry.worker_id<>w.id or first_entry.employee_id<>emp.id or first_entry.actor_auth_user_id<>p_auth_user_id)
      then raise exception 'attendance_correction_not_found';end if;
    if first_entry.revision is null and (p_command is null or p_command->>'action'<>'submit') then raise exception 'attendance_correction_not_found';end if;
    if first_entry.revision is not null then v_start:=first_entry.start_event_id;end if;
  end if;
  select * into head from public.merchant_attendance_correction_entries where merchant_id=p_site_id and worker_id=w.id and start_event_id=v_start order by revision desc limit 1;
  if v_mode='prepare' then
    if head.revision is not null and head.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
    v_basis:=public.faolla_attendance_correction_basis_v1(p_site_id,p_auth_user_id,v_start,w.id,emp.id);
    return v_common||jsonb_build_object('asOf',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'basis',v_basis,
      'revision',coalesce(head.revision,0),'pendingRequestId',case when head.action='submit' and not exists(select 1 from public.merchant_attendance_correction_decisions d where d.merchant_id=p_site_id and d.request_id=head.request_id and d.action='reject') then head.request_id else null end);
  end if;
  select * into receipt from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=v_operation;
  if receipt.revision is not null and (receipt.worker_id<>w.id or receipt.employee_id<>emp.id or receipt.actor_auth_user_id<>p_auth_user_id or receipt.request_id<>v_request) then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;receipt:=null;
  end if;
  if p_command is not null then
    if receipt.revision is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict';end if;
    else
      if not v_can then raise exception 'attendance_access_denied';end if;
      if coalesce(head.revision,0)<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
      if p_command->>'action'='submit' then
        if head.revision is not null and head.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
        if not coalesce(p_platform_enabled,false) then raise exception 'attendance_platform_paused';end if;
        if head.action='submit' and not exists(select 1 from public.merchant_attendance_correction_decisions d where d.merchant_id=p_site_id and d.request_id=head.request_id and d.action='reject') then raise exception 'attendance_correction_pending';end if;
        v_basis:=public.faolla_attendance_correction_basis_v1(p_site_id,p_auth_user_id,v_start,w.id,emp.id);
        if v_basis->'events'->-1->>'id' is distinct from p_command->>'expectedLastEventId' then raise exception 'attendance_correction_basis_changed';end if;
        v_now:=clock_timestamp();v_proposal:=public.faolla_attendance_correction_proposal_v1(p_command->'proposal',v_now);
      else
        if exists(select 1 from public.merchant_attendance_correction_decisions d where d.merchant_id=p_site_id and d.request_id=v_request) then raise exception 'attendance_correction_decided';end if;
        if head.action is distinct from 'submit' or head.request_id<>v_request then raise exception 'attendance_correction_closed';end if;
      end if;
      insert into public.merchant_attendance_correction_entries(merchant_id,worker_id,employee_id,start_event_id,revision,request_id,operation_id,
        actor_auth_user_id,action,reason,proposal,basis,command,recorded_at)
      values(p_site_id,w.id,emp.id,v_start,coalesce(head.revision,0)+1,v_request,v_operation,p_auth_user_id,p_command->>'action',p_command->>'reason',v_proposal,v_basis,p_command,v_now)
      returning * into receipt;
      if receipt.action='submit' then first_entry:=receipt;end if;
    end if;
  end if;
  select * into last_entry from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=v_request order by revision desc limit 1;
  return v_common||jsonb_build_object('asOf',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'item',public.faolla_attendance_correction_summary_v1(first_entry,last_entry),'basis',first_entry.basis,'proposal',first_entry.proposal,'reason',first_entry.reason,
    'withdrawal',case when last_entry.action='withdraw' then jsonb_build_object('reason',last_entry.reason,'recordedAt',to_char(last_entry.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end,
    'receipt',case when receipt.revision is not null then jsonb_build_object('operationId',receipt.operation_id,'requestId',receipt.request_id,'revision',receipt.revision,'action',receipt.action,
      'recordedAt',to_char(receipt.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end);
end; $$;
insert into public.faolla_schema_migrations(version,name) values(202609300086,'merchant_attendance_correction_decisions') on conflict(version) do nothing;
commit;
