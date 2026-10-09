-- Unreleased reader foundation. NO application approval writer is granted.
-- Future activation must move all report/export consumers off legacy readers.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_effect_versions (
  merchant_id text not null,root_request_id uuid not null,worker_id uuid not null,start_event_id uuid not null,
  revision integer not null check(revision>=2),request_id uuid not null,operation_id uuid not null,previous_operation_id uuid not null,
  actor_auth_user_id uuid not null,request_revision bigint not null check(request_revision between 1 and 9007199254740989),
  evidence_token text not null check(evidence_token~'^[0-9a-f]{32}$'),
  reason text not null check(char_length(reason) between 1 and 500 and reason=btrim(reason) and reason !~ '[[:cntrl:]]'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),policy_revision bigint not null,
  start_at timestamptz not null,end_at timestamptz not null,
  elapsed_us bigint not null,break_us bigint not null,paid_break_us bigint not null,worked_us bigint not null,
  primary key(merchant_id,root_request_id,revision),unique(merchant_id,request_id),unique(merchant_id,operation_id),
  unique(merchant_id,root_request_id,previous_operation_id),
  foreign key(merchant_id,root_request_id) references public.merchant_attendance_correction_effects(merchant_id,request_id) on delete restrict,
  foreign key(merchant_id,request_id) references public.merchant_attendance_revision_requests(merchant_id,operation_id) on delete restrict,
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(start_event_id) references public.merchant_attendance_events(id) on delete restrict,
  foreign key(merchant_id,policy_revision) references public.merchant_attendance_correction_controls(merchant_id,revision) on delete restrict,
  check(isfinite(start_at) and isfinite(end_at) and end_at>start_at and end_at<=recorded_at),
  check(elapsed_us between 1 and 2678400000000 and elapsed_us=extract(epoch from(end_at-start_at))*1000000),
  check(break_us>=0 and paid_break_us>=0 and paid_break_us<=break_us and worked_us>=0 and worked_us+break_us=elapsed_us)
);
create index attendance_effect_versions_worker_start_idx on public.merchant_attendance_effect_versions(merchant_id,worker_id,start_at,start_event_id);
alter table public.merchant_attendance_effect_versions enable row level security;
revoke all on public.merchant_attendance_effect_versions from public,anon,authenticated,service_role;
create trigger attendance_effect_version_no_rewrite before update or delete on public.merchant_attendance_effect_versions for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_effect_version_no_truncate before truncate on public.merchant_attendance_effect_versions for each statement execute function public.faolla_attendance_events_append_only_v1();

-- Storage integrity, NOT an application approval authorization mechanism.
-- All application roles lack INSERT/trigger execution; a future deciding RPC
-- must recheck actor, current review, locks, overlap, evidence and idempotency.
create function public.faolla_attendance_effect_version_guard_v1() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare root public.merchant_attendance_correction_effects%rowtype;prior public.merchant_attendance_effect_versions%rowtype;
  request public.merchant_attendance_revision_requests%rowtype;tail public.merchant_attendance_revision_requests%rowtype;
  original public.merchant_attendance_correction_entries%rowtype;proposal jsonb;b jsonb;break_us bigint:=0;paid_us bigint:=0;duration_us bigint;
  expected_operation uuid;expected_revision integer;prior_at timestamptz;
begin
  perform 1 from public.merchants where id=new.merchant_id for share;
  perform 1 from public.merchant_attendance_settings where merchant_id=new.merchant_id for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into root from public.merchant_attendance_correction_effects where merchant_id=new.merchant_id and request_id=new.root_request_id;
  if root.request_id is null or root.worker_id<>new.worker_id or root.start_event_id<>new.start_event_id then raise exception 'attendance_effect_version_invalid';end if;
  perform 1 from public.merchant_attendance_workers where merchant_id=new.merchant_id and id=root.worker_id for update;
  select * into prior from public.merchant_attendance_effect_versions where merchant_id=new.merchant_id and root_request_id=new.root_request_id order by revision desc limit 1;
  expected_operation:=coalesce(prior.operation_id,root.operation_id);expected_revision:=coalesce(prior.revision,1)+1;prior_at:=coalesce(prior.recorded_at,root.recorded_at);
  if new.revision<>expected_revision or new.previous_operation_id<>expected_operation or new.operation_id=expected_operation then raise exception 'attendance_effect_version_conflict';end if;
  select * into request from public.merchant_attendance_revision_requests where merchant_id=new.merchant_id and operation_id=new.request_id and action='submit';
  select * into tail from public.merchant_attendance_revision_requests where merchant_id=new.merchant_id and request_id=new.request_id order by revision desc limit 1;
  select * into original from public.merchant_attendance_correction_entries where merchant_id=new.merchant_id and operation_id=root.request_id and action='submit';
  if request.request_id is null or request.base_request_id<>root.request_id or request.worker_id<>root.worker_id
    or request.employee_id is distinct from original.employee_id or request.actor_auth_user_id is distinct from original.actor_auth_user_id
    or tail.action is distinct from 'submit' or tail.revision<>new.request_revision or request.recorded_at<=prior_at
    or coalesce(request.command->>'expectedEffectiveOperationId',request.base_operation_id::text)<>expected_operation::text
    or new.recorded_at<=request.recorded_at or new.recorded_at>clock_timestamp() or new.policy_revision<>request.policy_revision
    then raise exception 'attendance_effect_version_invalid';end if;
  if exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id=new.merchant_id and operation_id=new.operation_id)
    or exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=new.merchant_id and operation_id=new.operation_id)
    or exists(select 1 from public.merchant_attendance_revision_requests where merchant_id=new.merchant_id and operation_id=new.operation_id) then raise exception 'attendance_operation_conflict';end if;
  proposal:=public.faolla_attendance_correction_proposal_v1(request.command->'proposal',request.recorded_at);
  if proposal is distinct from request.command->'proposal' then raise exception 'attendance_effect_version_invalid';end if;
  for b in select value from jsonb_array_elements(proposal->'breaks') loop
    duration_us:=(extract(epoch from((b->>'endAt')::timestamptz-(b->>'startAt')::timestamptz))*1000000)::bigint;
    break_us:=break_us+duration_us;if (b->>'paid')::boolean then paid_us:=paid_us+duration_us;end if;
  end loop;
  -- Derived index/amount fields are small. The proposal/basis are NOT duplicated.
  new.start_at:=(proposal->>'startAt')::timestamptz;new.end_at:=(proposal->>'endAt')::timestamptz;
  new.elapsed_us:=(extract(epoch from(new.end_at-new.start_at))*1000000)::bigint;
  new.break_us:=break_us;new.paid_break_us:=paid_us;new.worked_us:=new.elapsed_us-break_us;
  return new;
end; $$;
revoke all on function public.faolla_attendance_effect_version_guard_v1() from public,anon,authenticated,service_role;
create trigger attendance_effect_version_insert_guard before insert on public.merchant_attendance_effect_versions for each row execute function public.faolla_attendance_effect_version_guard_v1();

-- Both range-scan arms retain their own indexes. Superseded nodes never become
-- candidates merely because an older approved interval intersects the period.
create view public.merchant_attendance_effect_current_v2 as
select e.merchant_id,e.worker_id,e.start_event_id,e.request_id root_request_id,e.operation_id root_operation_id,e.recorded_at root_recorded_at,
  e.request_id,e.operation_id,e.revision,null::uuid previous_operation_id,e.policy_revision,e.proposal,e.time_zone,e.start_at,e.end_at,
  e.elapsed_us,e.break_us,e.paid_break_us,e.worked_us,e.recorded_at,r.employee_id,r.basis->'events'->-1->>'id' original_last_event_id
from public.merchant_attendance_correction_effects e join public.merchant_attendance_correction_entries r on r.merchant_id=e.merchant_id and r.operation_id=e.request_id and r.action='submit'
where not exists(select 1 from public.merchant_attendance_effect_versions n where n.merchant_id=e.merchant_id and n.root_request_id=e.request_id)
union all
select n.merchant_id,n.worker_id,n.start_event_id,n.root_request_id,e.operation_id,e.recorded_at,n.request_id,n.operation_id,n.revision,n.previous_operation_id,n.policy_revision,
  r.command->'proposal',e.time_zone,n.start_at,n.end_at,n.elapsed_us,n.break_us,n.paid_break_us,n.worked_us,n.recorded_at,r.employee_id,o.basis->'events'->-1->>'id'
from public.merchant_attendance_effect_versions n
join public.merchant_attendance_correction_effects e on e.merchant_id=n.merchant_id and e.request_id=n.root_request_id
join public.merchant_attendance_revision_requests r on r.merchant_id=n.merchant_id and r.operation_id=n.request_id and r.action='submit'
join public.merchant_attendance_correction_entries o on o.merchant_id=e.merchant_id and o.operation_id=e.request_id and o.action='submit'
where not exists(select 1 from public.merchant_attendance_effect_versions newer where newer.merchant_id=n.merchant_id and newer.root_request_id=n.root_request_id and newer.revision>n.revision);
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_effect_versions'::regclass,
      'public.merchant_attendance_effect_current_v2'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_effect_current_v2 from public,anon,authenticated,service_role;

create function public.faolla_attendance_effect_evidence_v2(e public.merchant_attendance_effect_current_v2,p_now timestamptz) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare root public.merchant_attendance_correction_effects%rowtype;d public.merchant_attendance_correction_decisions%rowtype;r public.merchant_attendance_correction_entries%rowtype;
begin
  select * into root from public.merchant_attendance_correction_effects where merchant_id=e.merchant_id and request_id=e.root_request_id;
  select * into d from public.merchant_attendance_correction_decisions where merchant_id=e.merchant_id and request_id=e.root_request_id;
  select * into r from public.merchant_attendance_correction_entries where merchant_id=e.merchant_id and operation_id=e.root_request_id and action='submit';
  if d.action is distinct from 'approve' or d.operation_id is distinct from root.operation_id or d.recorded_at is distinct from root.recorded_at
    or r.proposal is distinct from root.proposal or r.worker_id is distinct from e.worker_id or r.start_event_id is distinct from e.start_event_id
    or r.employee_id is distinct from e.employee_id or root.recorded_at>e.recorded_at or e.recorded_at>p_now then raise exception 'attendance_report_invalid_data';end if;
  return jsonb_build_object('requestId',e.request_id,'operationId',e.operation_id,'revision',e.revision,'policyRevision',e.policy_revision,'action','approve',
    'originalLastEventId',e.original_last_event_id,'recordedAt',to_char(e.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'employeeId',e.employee_id,'timeZone',e.time_zone,'proposal',e.proposal,'calculationVersion','declaration-v1',
    'elapsedUs',e.elapsed_us,'workedUs',e.worked_us,'breakUs',e.break_us,'paidBreakUs',e.paid_break_us,
    'lineage',jsonb_build_object('rootRequestId',e.root_request_id,'rootOperationId',e.root_operation_id,'rootRecordedAt',to_char(e.root_recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'previousOperationId',e.previous_operation_id));
end; $$;
revoke all on function public.faolla_attendance_effect_evidence_v2(public.merchant_attendance_effect_current_v2,timestamptz) from public,anon,authenticated,service_role;

-- Reader definitions follow. No application decision writer exists here.
create function public.faolla_attendance_period_report_v2(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  first_day date;last_day date;from_at timestamptz;to_at timestamptz;now_at timestamptz;end_sequence bigint;
  events jsonb;effect_json jsonb;items jsonb:='[]';result jsonb;candidate_count integer:=0;event_count integer:=0;
  worker uuid;raw_relevant boolean;effect_relevant boolean;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['workerId','fromDate','throughDate'])
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or coalesce(p_query->>'fromDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_query->>'throughDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    then raise exception 'attendance_invalid_request';end if;
  worker:=(p_query->>'workerId')::uuid;first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or first_day>last_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  -- Same ordering as writes. These SHARE locks prevent a moving snapshot, new
  -- effects, owner transfer or a concurrent punch until all candidates are read.
  perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and id=worker for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  now_at:=clock_timestamp();from_at:=public.faolla_attendance_control_day_boundary_v1(first_day,s.time_zone);
  to_at:=public.faolla_attendance_control_day_boundary_v1(last_day+1,s.time_zone);
  if (from_at at time zone s.time_zone)::date<>first_day or
    (public.faolla_attendance_control_day_boundary_v1(last_day,s.time_zone) at time zone s.time_zone)::date<>last_day
    then raise exception 'attendance_local_date_does_not_exist';end if;
  -- Each arm is independently bounded. Include one left-boundary raw segment
  -- AND effective spans that moved in from an original start outside the range.
  for e in
    with inside as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and occurred_at>=from_at and occurred_at<to_at order by occurred_at,sequence limit 101),
    preceding as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and occurred_at<from_at order by occurred_at desc,sequence desc limit 1),
    moved as (select start_event_id id from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and worker_id=worker
      and start_at>=from_at-interval '31 days' and start_at<to_at and end_at>from_at order by start_at,start_event_id limit 101),
    candidates as (select id from inside union select id from preceding union select id from moved)
    select ev.* from candidates c join public.merchant_attendance_events ev on ev.id=c.id and ev.merchant_id=p_site_id and ev.worker_id=worker
    order by ev.sequence limit 101
  loop
    candidate_count:=candidate_count+1;if candidate_count>100 then raise exception 'attendance_report_too_large';end if;
    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;
    select sequence into end_sequence from (select sequence,action from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence order by sequence limit 2003) endpoint
      where action='clock_out' order by sequence limit 1;
    -- Exclude the irrelevant preceding completed shift before allocating its JSON.
    raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else
      e.occurred_at>=from_at or exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence=end_sequence and occurred_at>from_at) end);
    select * into eff from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and worker_id=worker and start_event_id=e.id;
    effect_relevant:=eff.request_id is not null and eff.start_at<to_at and eff.end_at>from_at;
    if not raw_relevant and not effect_relevant then continue;end if;
    select jsonb_agg(jsonb_build_object('id',ev.id,'locationId',ev.location_id,'sequence',ev.sequence,'action',ev.action,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',ev.time_zone,'breakPaid',ev.break_paid,'source',ev.source) order by ev.sequence)
      into events from (select * from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence
        and (end_sequence is null or sequence<=end_sequence) order by sequence limit 2003) ev;
    event_count:=event_count+jsonb_array_length(events);
    if jsonb_array_length(events)>2002 or event_count>4000 then raise exception 'attendance_report_too_large';end if;
    effect_json:='null';
    if eff.request_id is not null then
      effect_json:=public.faolla_attendance_effect_evidence_v2(eff,now_at);
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('startEventId',e.id,'events',events,'effect',effect_json));
  end loop;
  result:=jsonb_build_object('siteId',p_site_id,'workerId',worker,'employeeId',w.employee_id,'workerName',w.display_name,'workerNo',w.worker_no,
    'fromDate',first_day,'throughDate',last_day,'fromAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'toAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',s.time_zone,
    'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceVersion','raw-and-approved-v2','complete',true,'items',items);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

revoke all on function public.faolla_attendance_period_report_v2(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_report_v2(text,uuid,jsonb) to service_role;

create or replace function public.faolla_attendance_period_report_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_attendance_events%rowtype;eff public.merchant_attendance_correction_effects%rowtype;
  d public.merchant_attendance_correction_decisions%rowtype;r public.merchant_attendance_correction_entries%rowtype;
  first_day date;last_day date;from_at timestamptz;to_at timestamptz;now_at timestamptz;end_sequence bigint;
  events jsonb;effect_json jsonb;items jsonb:='[]';result jsonb;candidate_count integer:=0;event_count integer:=0;
  worker uuid;raw_relevant boolean;effect_relevant boolean;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['workerId','fromDate','throughDate'])
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or coalesce(p_query->>'fromDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_query->>'throughDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    then raise exception 'attendance_invalid_request';end if;
  worker:=(p_query->>'workerId')::uuid;first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or first_day>last_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  -- Same ordering as writes. These SHARE locks prevent a moving snapshot, new
  -- effects, owner transfer or a concurrent punch until all candidates are read.
  perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and id=worker for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if exists(select 1 from public.merchant_attendance_effect_versions where merchant_id=p_site_id and worker_id=worker) then raise exception 'attendance_report_version_required';end if;
  now_at:=clock_timestamp();from_at:=public.faolla_attendance_control_day_boundary_v1(first_day,s.time_zone);
  to_at:=public.faolla_attendance_control_day_boundary_v1(last_day+1,s.time_zone);
  if (from_at at time zone s.time_zone)::date<>first_day or
    (public.faolla_attendance_control_day_boundary_v1(last_day,s.time_zone) at time zone s.time_zone)::date<>last_day
    then raise exception 'attendance_local_date_does_not_exist';end if;
  -- Each arm is independently bounded. Include one left-boundary raw segment
  -- AND effective spans that moved in from an original start outside the range.
  for e in
    with inside as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and occurred_at>=from_at and occurred_at<to_at order by occurred_at,sequence limit 101),
    preceding as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and occurred_at<from_at order by occurred_at desc,sequence desc limit 1),
    moved as (select start_event_id id from public.merchant_attendance_correction_effects where merchant_id=p_site_id and worker_id=worker
      and start_at>=from_at-interval '31 days' and start_at<to_at and end_at>from_at order by start_at,start_event_id limit 101),
    candidates as (select id from inside union select id from preceding union select id from moved)
    select ev.* from candidates c join public.merchant_attendance_events ev on ev.id=c.id and ev.merchant_id=p_site_id and ev.worker_id=worker
    order by ev.sequence limit 101
  loop
    candidate_count:=candidate_count+1;if candidate_count>100 then raise exception 'attendance_report_too_large';end if;
    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;
    select sequence into end_sequence from (select sequence,action from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence order by sequence limit 2003) endpoint
      where action='clock_out' order by sequence limit 1;
    -- Exclude the irrelevant preceding completed shift before allocating its JSON.
    raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else
      e.occurred_at>=from_at or exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence=end_sequence and occurred_at>from_at) end);
    select * into eff from public.merchant_attendance_correction_effects where merchant_id=p_site_id and worker_id=worker and start_event_id=e.id;
    effect_relevant:=eff.request_id is not null and eff.start_at<to_at and eff.end_at>from_at;
    if not raw_relevant and not effect_relevant then continue;end if;
    select jsonb_agg(jsonb_build_object('id',ev.id,'locationId',ev.location_id,'sequence',ev.sequence,'action',ev.action,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',ev.time_zone,'breakPaid',ev.break_paid,'source',ev.source) order by ev.sequence)
      into events from (select * from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence
        and (end_sequence is null or sequence<=end_sequence) order by sequence limit 2003) ev;
    event_count:=event_count+jsonb_array_length(events);
    if jsonb_array_length(events)>2002 or event_count>4000 then raise exception 'attendance_report_too_large';end if;
    effect_json:='null';
    if eff.request_id is not null then
      select * into d from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=eff.request_id;
      select * into r from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=eff.request_id and action='submit';
      if d.action is distinct from 'approve' or d.operation_id is distinct from eff.operation_id or eff.recorded_at is distinct from d.recorded_at
        or eff.recorded_at>now_at or r.start_event_id is distinct from e.id or r.worker_id is distinct from worker or r.proposal is distinct from eff.proposal
        then raise exception 'attendance_report_invalid_data';end if;
      effect_json:=jsonb_build_object('requestId',eff.request_id,'operationId',eff.operation_id,'revision',eff.revision,'policyRevision',eff.policy_revision,
        'action',d.action,'originalLastEventId',r.basis->'events'->-1->'id','recordedAt',to_char(eff.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'timeZone',eff.time_zone,'proposal',eff.proposal,'calculationVersion','declaration-v1','elapsedUs',eff.elapsed_us,'workedUs',eff.worked_us,'breakUs',eff.break_us,'paidBreakUs',eff.paid_break_us);
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('startEventId',e.id,'events',events,'effect',effect_json));
  end loop;
  result:=jsonb_build_object('siteId',p_site_id,'workerId',worker,'employeeId',w.employee_id,'workerName',w.display_name,'workerNo',w.worker_no,
    'fromDate',first_day,'throughDate',last_day,'fromAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'toAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',s.time_zone,
    'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceVersion','raw-and-approved-v1','complete',true,'items',items);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

create function public.faolla_attendance_scoped_period_report_v2(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  first_day date;last_day date;from_at timestamptz;to_at timestamptz;now_at timestamptz;end_sequence bigint;
  events jsonb;effect_json jsonb;items jsonb:='[]';result jsonb;candidate_count integer:=0;event_count integer:=0;
  worker uuid;raw_relevant boolean;effect_relevant boolean;
  viewer public.merchant_enterprise_employees%rowtype;viewer_role public.merchant_enterprise_roles%rowtype;
  viewer_scope public.merchant_attendance_scopes%rowtype;
  access text;target_location uuid;expected_worker uuid;record_count integer;fully_visible boolean;
  access_until timestamptz;granted boolean;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>6 or not(p_query ?& array['access','workerId','locationId','expectedWorkerId','fromDate','throughDate'])
    or coalesce(p_query->>'access','') not in ('self','manager')
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or coalesce(p_query->>'fromDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_query->>'throughDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    then raise exception 'attendance_invalid_request';end if;
  access:=p_query->>'access';
  if access='self' then
    if p_query->'workerId'<>'null'::jsonb or p_query->'locationId'<>'null'::jsonb
      or (p_query->'expectedWorkerId'<>'null'::jsonb and (jsonb_typeof(p_query->'expectedWorkerId')<>'string' or coalesce(p_query->>'expectedWorkerId','') !~ uuid_pattern))
      then raise exception 'attendance_invalid_request';end if;
  else
    if p_query->'expectedWorkerId'<>'null'::jsonb or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ uuid_pattern
      or jsonb_typeof(p_query->'locationId')<>'string' or coalesce(p_query->>'locationId','') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
  end if;
  expected_worker:=(p_query->>'expectedWorkerId')::uuid;worker:=(p_query->>'workerId')::uuid;target_location:=(p_query->>'locationId')::uuid;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or first_day>last_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  -- Same lock order as role/scope writes and punches. No owner impersonation,
  -- private owner RPC call, caller-supplied membership or post-fetch JS filter.
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  select * into viewer from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or viewer.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into viewer_role from public.merchant_enterprise_roles where merchant_id=p_site_id and id=viewer.role_id for share;
  if not found or viewer_role.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(viewer_role.permissions)
    or not('enterprise.view'=any(viewer_role.permissions))
    or not((case when access='self' then 'attendance.self.view' else 'attendance.records.view' end)=any(viewer_role.permissions))
    then raise exception 'attendance_access_denied';end if;
  -- Do not reveal configuration existence to a non-member or revoked role.
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if access='self' then
    select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=viewer.id for share;
    if not found then raise exception 'attendance_access_denied';end if;
    worker:=w.id;
    if expected_worker is not null and expected_worker<>worker then raise exception 'attendance_worker_changed';end if;
  else
    select * into viewer_scope from public.merchant_attendance_scopes where merchant_id=p_site_id and employee_id=viewer.id for share;
    if not found then raise exception 'attendance_access_denied';end if;
    -- Authorize a complete pair before locking any caller-chosen worker.
    if not exists(select 1 from public.merchant_attendance_scope_grants g
      join public.merchant_attendance_scope_workers sw on sw.merchant_id=g.merchant_id and sw.employee_id=g.employee_id and sw.grant_id=g.id
      join public.merchant_attendance_scope_locations sl on sl.merchant_id=g.merchant_id and sl.employee_id=g.employee_id and sl.grant_id=g.id
      where g.merchant_id=p_site_id and g.employee_id=viewer.id and sw.worker_id=worker and sl.location_id=target_location
        and g.valid_from<=clock_timestamp() and (g.valid_until is null or clock_timestamp()<g.valid_until))
      then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and id=worker for share;
    if not found then raise exception 'attendance_access_denied';end if;
  end if;
  -- Capture time after every lock: waiting cannot prolong a grant.
  now_at:=clock_timestamp();
  if access='manager' then
    select count(*)>0,case when bool_or(g.valid_until is null) then null else max(g.valid_until) end into granted,access_until
      from public.merchant_attendance_scope_grants g
      join public.merchant_attendance_scope_workers sw on sw.merchant_id=g.merchant_id and sw.employee_id=g.employee_id and sw.grant_id=g.id
      join public.merchant_attendance_scope_locations sl on sl.merchant_id=g.merchant_id and sl.employee_id=g.employee_id and sl.grant_id=g.id
      where g.merchant_id=p_site_id and g.employee_id=viewer.id and sw.worker_id=worker and sl.location_id=target_location
        and g.valid_from<=now_at and (g.valid_until is null or now_at<g.valid_until);
    if not granted then raise exception 'attendance_access_denied';end if;
  end if;
  from_at:=public.faolla_attendance_control_day_boundary_v1(first_day,s.time_zone);
  to_at:=public.faolla_attendance_control_day_boundary_v1(last_day+1,s.time_zone);
  if (from_at at time zone s.time_zone)::date<>first_day or
    (public.faolla_attendance_control_day_boundary_v1(last_day,s.time_zone) at time zone s.time_zone)::date<>last_day
    then raise exception 'attendance_local_date_does_not_exist';end if;
  -- Each arm is independently bounded. Include one left-boundary raw segment
  -- AND effective spans that moved in from an original start outside the range.
  for e in
    with inside as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and ((access='self' and actor_employee_id=viewer.id) or (access='manager' and location_id=target_location))
      and occurred_at>=from_at and occurred_at<to_at order by occurred_at,sequence limit 101),
    preceding as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and ((access='self' and actor_employee_id=viewer.id) or (access='manager' and location_id=target_location))
      and occurred_at<from_at order by occurred_at desc,sequence desc limit 1),
    moved as (select ef.start_event_id id from public.merchant_attendance_effect_current_v2 ef
      join public.merchant_attendance_events se on se.merchant_id=ef.merchant_id and se.worker_id=ef.worker_id and se.id=ef.start_event_id
      where ef.merchant_id=p_site_id and ef.worker_id=worker
        and ((access='self' and se.actor_employee_id=viewer.id) or (access='manager' and se.location_id=target_location))
        and ef.start_at>=from_at-interval '31 days' and ef.start_at<to_at and ef.end_at>from_at order by ef.start_at,ef.start_event_id limit 101),
    candidates as (select id from inside union select id from preceding union select id from moved)
    select ev.* from candidates c join public.merchant_attendance_events ev on ev.id=c.id and ev.merchant_id=p_site_id and ev.worker_id=worker
    order by ev.sequence limit 101
  loop
    candidate_count:=candidate_count+1;if candidate_count>100 then raise exception 'attendance_report_too_large';end if;
    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;
    select sequence into end_sequence from (select sequence,action from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence order by sequence limit 2003) endpoint
      where action='clock_out' order by sequence limit 1;
    -- Exclude the irrelevant preceding completed shift before allocating its JSON.
    raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else
      e.occurred_at>=from_at or exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence=end_sequence and occurred_at>from_at) end);
    select * into eff from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and worker_id=worker and start_event_id=e.id;
    effect_relevant:=eff.request_id is not null and eff.start_at<to_at and eff.end_at>from_at;
    if not raw_relevant and not effect_relevant then continue;end if;
    -- Entire original segment must be authorized BEFORE evidence is returned.
    -- Cross-location/mixed-identity sessions are omitted, with no excluded count,
    -- hidden end-time, location, aggregate or approval hint.
    select count(*),bool_and(case when access='self' then actor_employee_id is not distinct from viewer.id else location_id=target_location end)
      into record_count,fully_visible from (select actor_employee_id,location_id from public.merchant_attendance_events
        where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence and (end_sequence is null or sequence<=end_sequence)
        order by sequence limit 2003) checked;
    if not coalesce(fully_visible,false) then continue;end if;
    if record_count>2002 then raise exception 'attendance_report_too_large';end if;
    select jsonb_agg(jsonb_build_object('id',ev.id,'locationId',ev.location_id,'actorEmployeeId',ev.actor_employee_id,'sequence',ev.sequence,'action',ev.action,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',ev.time_zone,'breakPaid',ev.break_paid,'source',ev.source) order by ev.sequence)
      into events from (select * from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence
        and (end_sequence is null or sequence<=end_sequence) order by sequence limit 2003) ev;
    event_count:=event_count+jsonb_array_length(events);
    if jsonb_array_length(events)>2002 or event_count>4000 then raise exception 'attendance_report_too_large';end if;
    effect_json:='null';
    if eff.request_id is not null then
      if access='self' and eff.employee_id is distinct from viewer.id then continue;end if;
      effect_json:=public.faolla_attendance_effect_evidence_v2(eff,now_at);
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('startEventId',e.id,'events',events,'effect',effect_json));
  end loop;
  result:=jsonb_build_object('siteId',p_site_id,'workerId',worker,'employeeId',w.employee_id,'workerName',w.display_name,'workerNo',w.worker_no,
    'fromDate',first_day,'throughDate',last_day,'fromAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'toAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',s.time_zone,
    'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceVersion','raw-and-approved-v2','complete',true,'items',items,
    'access',access,'viewerEmployeeId',viewer.id,'scopeRevision',case when access='manager' then viewer_scope.revision else null end,
    'locationId',target_location,'coverage','authorized-complete-sessions-v1',
    'accessValidUntil',case when access_until is null then null else to_char(access_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  if access_until is not null and clock_timestamp()>=access_until then raise exception 'attendance_access_denied';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

revoke all on function public.faolla_attendance_scoped_period_report_v2(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_scoped_period_report_v2(text,uuid,jsonb) to service_role;

create or replace function public.faolla_attendance_scoped_period_report_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_attendance_events%rowtype;eff public.merchant_attendance_correction_effects%rowtype;
  d public.merchant_attendance_correction_decisions%rowtype;r public.merchant_attendance_correction_entries%rowtype;
  first_day date;last_day date;from_at timestamptz;to_at timestamptz;now_at timestamptz;end_sequence bigint;
  events jsonb;effect_json jsonb;items jsonb:='[]';result jsonb;candidate_count integer:=0;event_count integer:=0;
  worker uuid;raw_relevant boolean;effect_relevant boolean;
  viewer public.merchant_enterprise_employees%rowtype;viewer_role public.merchant_enterprise_roles%rowtype;
  viewer_scope public.merchant_attendance_scopes%rowtype;
  access text;target_location uuid;expected_worker uuid;record_count integer;fully_visible boolean;
  access_until timestamptz;granted boolean;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>6 or not(p_query ?& array['access','workerId','locationId','expectedWorkerId','fromDate','throughDate'])
    or coalesce(p_query->>'access','') not in ('self','manager')
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or coalesce(p_query->>'fromDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_query->>'throughDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    then raise exception 'attendance_invalid_request';end if;
  access:=p_query->>'access';
  if access='self' then
    if p_query->'workerId'<>'null'::jsonb or p_query->'locationId'<>'null'::jsonb
      or (p_query->'expectedWorkerId'<>'null'::jsonb and (jsonb_typeof(p_query->'expectedWorkerId')<>'string' or coalesce(p_query->>'expectedWorkerId','') !~ uuid_pattern))
      then raise exception 'attendance_invalid_request';end if;
  else
    if p_query->'expectedWorkerId'<>'null'::jsonb or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ uuid_pattern
      or jsonb_typeof(p_query->'locationId')<>'string' or coalesce(p_query->>'locationId','') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
  end if;
  expected_worker:=(p_query->>'expectedWorkerId')::uuid;worker:=(p_query->>'workerId')::uuid;target_location:=(p_query->>'locationId')::uuid;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or first_day>last_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  -- Same lock order as role/scope writes and punches. No owner impersonation,
  -- private owner RPC call, caller-supplied membership or post-fetch JS filter.
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  select * into viewer from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or viewer.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into viewer_role from public.merchant_enterprise_roles where merchant_id=p_site_id and id=viewer.role_id for share;
  if not found or viewer_role.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(viewer_role.permissions)
    or not('enterprise.view'=any(viewer_role.permissions))
    or not((case when access='self' then 'attendance.self.view' else 'attendance.records.view' end)=any(viewer_role.permissions))
    then raise exception 'attendance_access_denied';end if;
  -- Do not reveal configuration existence to a non-member or revoked role.
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if access='self' then
    select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=viewer.id for share;
    if not found then raise exception 'attendance_access_denied';end if;
    worker:=w.id;
    if expected_worker is not null and expected_worker<>worker then raise exception 'attendance_worker_changed';end if;
  else
    select * into viewer_scope from public.merchant_attendance_scopes where merchant_id=p_site_id and employee_id=viewer.id for share;
    if not found then raise exception 'attendance_access_denied';end if;
    -- Authorize a complete pair before locking any caller-chosen worker.
    if not exists(select 1 from public.merchant_attendance_scope_grants g
      join public.merchant_attendance_scope_workers sw on sw.merchant_id=g.merchant_id and sw.employee_id=g.employee_id and sw.grant_id=g.id
      join public.merchant_attendance_scope_locations sl on sl.merchant_id=g.merchant_id and sl.employee_id=g.employee_id and sl.grant_id=g.id
      where g.merchant_id=p_site_id and g.employee_id=viewer.id and sw.worker_id=worker and sl.location_id=target_location
        and g.valid_from<=clock_timestamp() and (g.valid_until is null or clock_timestamp()<g.valid_until))
      then raise exception 'attendance_access_denied';end if;
    select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and id=worker for share;
    if not found then raise exception 'attendance_access_denied';end if;
  end if;
  -- Capture time after every lock: waiting cannot prolong a grant.
  now_at:=clock_timestamp();
  if access='manager' then
    select count(*)>0,case when bool_or(g.valid_until is null) then null else max(g.valid_until) end into granted,access_until
      from public.merchant_attendance_scope_grants g
      join public.merchant_attendance_scope_workers sw on sw.merchant_id=g.merchant_id and sw.employee_id=g.employee_id and sw.grant_id=g.id
      join public.merchant_attendance_scope_locations sl on sl.merchant_id=g.merchant_id and sl.employee_id=g.employee_id and sl.grant_id=g.id
      where g.merchant_id=p_site_id and g.employee_id=viewer.id and sw.worker_id=worker and sl.location_id=target_location
        and g.valid_from<=now_at and (g.valid_until is null or now_at<g.valid_until);
    if not granted then raise exception 'attendance_access_denied';end if;
  end if;
  -- Compatibility refusal must not disclose a revision in an invisible session.
  if exists(select 1 from public.merchant_attendance_effect_versions n
    join public.merchant_attendance_correction_entries root_request on root_request.merchant_id=n.merchant_id and root_request.operation_id=n.root_request_id and root_request.action='submit'
    where n.merchant_id=p_site_id and n.worker_id=worker
      and not exists(select 1 from public.merchant_attendance_events ev where ev.merchant_id=p_site_id and ev.worker_id=worker
        and ev.sequence>=(root_request.basis->'events'->0->>'sequence')::bigint and ev.sequence<=(root_request.basis->'events'->-1->>'sequence')::bigint
        and (case when access='self' then ev.actor_employee_id is distinct from viewer.id else ev.location_id is distinct from target_location end)))
    then raise exception 'attendance_report_version_required';end if;
  from_at:=public.faolla_attendance_control_day_boundary_v1(first_day,s.time_zone);
  to_at:=public.faolla_attendance_control_day_boundary_v1(last_day+1,s.time_zone);
  if (from_at at time zone s.time_zone)::date<>first_day or
    (public.faolla_attendance_control_day_boundary_v1(last_day,s.time_zone) at time zone s.time_zone)::date<>last_day
    then raise exception 'attendance_local_date_does_not_exist';end if;
  -- Each arm is independently bounded. Include one left-boundary raw segment
  -- AND effective spans that moved in from an original start outside the range.
  for e in
    with inside as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and ((access='self' and actor_employee_id=viewer.id) or (access='manager' and location_id=target_location))
      and occurred_at>=from_at and occurred_at<to_at order by occurred_at,sequence limit 101),
    preceding as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and ((access='self' and actor_employee_id=viewer.id) or (access='manager' and location_id=target_location))
      and occurred_at<from_at order by occurred_at desc,sequence desc limit 1),
    moved as (select ef.start_event_id id from public.merchant_attendance_correction_effects ef
      join public.merchant_attendance_events se on se.merchant_id=ef.merchant_id and se.worker_id=ef.worker_id and se.id=ef.start_event_id
      where ef.merchant_id=p_site_id and ef.worker_id=worker
        and ((access='self' and se.actor_employee_id=viewer.id) or (access='manager' and se.location_id=target_location))
        and ef.start_at>=from_at-interval '31 days' and ef.start_at<to_at and ef.end_at>from_at order by ef.start_at,ef.start_event_id limit 101),
    candidates as (select id from inside union select id from preceding union select id from moved)
    select ev.* from candidates c join public.merchant_attendance_events ev on ev.id=c.id and ev.merchant_id=p_site_id and ev.worker_id=worker
    order by ev.sequence limit 101
  loop
    candidate_count:=candidate_count+1;if candidate_count>100 then raise exception 'attendance_report_too_large';end if;
    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;
    select sequence into end_sequence from (select sequence,action from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence order by sequence limit 2003) endpoint
      where action='clock_out' order by sequence limit 1;
    -- Exclude the irrelevant preceding completed shift before allocating its JSON.
    raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else
      e.occurred_at>=from_at or exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence=end_sequence and occurred_at>from_at) end);
    select * into eff from public.merchant_attendance_correction_effects where merchant_id=p_site_id and worker_id=worker and start_event_id=e.id;
    effect_relevant:=eff.request_id is not null and eff.start_at<to_at and eff.end_at>from_at;
    if not raw_relevant and not effect_relevant then continue;end if;
    -- Entire original segment must be authorized BEFORE evidence is returned.
    -- Cross-location/mixed-identity sessions are omitted, with no excluded count,
    -- hidden end-time, location, aggregate or approval hint.
    select count(*),bool_and(case when access='self' then actor_employee_id is not distinct from viewer.id else location_id=target_location end)
      into record_count,fully_visible from (select actor_employee_id,location_id from public.merchant_attendance_events
        where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence and (end_sequence is null or sequence<=end_sequence)
        order by sequence limit 2003) checked;
    if not coalesce(fully_visible,false) then continue;end if;
    if record_count>2002 then raise exception 'attendance_report_too_large';end if;
    select jsonb_agg(jsonb_build_object('id',ev.id,'locationId',ev.location_id,'actorEmployeeId',ev.actor_employee_id,'sequence',ev.sequence,'action',ev.action,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',ev.time_zone,'breakPaid',ev.break_paid,'source',ev.source) order by ev.sequence)
      into events from (select * from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence
        and (end_sequence is null or sequence<=end_sequence) order by sequence limit 2003) ev;
    event_count:=event_count+jsonb_array_length(events);
    if jsonb_array_length(events)>2002 or event_count>4000 then raise exception 'attendance_report_too_large';end if;
    effect_json:='null';
    if eff.request_id is not null then
      select * into d from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=eff.request_id;
      select * into r from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=eff.request_id and action='submit';
      if access='self' and r.employee_id is distinct from viewer.id then continue;end if;
      if d.action is distinct from 'approve' or d.operation_id is distinct from eff.operation_id or eff.recorded_at is distinct from d.recorded_at
        or eff.recorded_at>now_at or r.start_event_id is distinct from e.id or r.worker_id is distinct from worker or r.proposal is distinct from eff.proposal
        then raise exception 'attendance_report_invalid_data';end if;
      effect_json:=jsonb_build_object('requestId',eff.request_id,'operationId',eff.operation_id,'employeeId',r.employee_id,'revision',eff.revision,'policyRevision',eff.policy_revision,
        'action',d.action,'originalLastEventId',r.basis->'events'->-1->'id','recordedAt',to_char(eff.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'timeZone',eff.time_zone,'proposal',eff.proposal,'calculationVersion','declaration-v1','elapsedUs',eff.elapsed_us,'workedUs',eff.worked_us,'breakUs',eff.break_us,'paidBreakUs',eff.paid_break_us);
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('startEventId',e.id,'events',events,'effect',effect_json));
  end loop;
  result:=jsonb_build_object('siteId',p_site_id,'workerId',worker,'employeeId',w.employee_id,'workerName',w.display_name,'workerNo',w.worker_no,
    'fromDate',first_day,'throughDate',last_day,'fromAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'toAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',s.time_zone,
    'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceVersion','raw-and-approved-v1','complete',true,'items',items,
    'access',access,'viewerEmployeeId',viewer.id,'scopeRevision',case when access='manager' then viewer_scope.revision else null end,
    'locationId',target_location,'coverage','authorized-complete-sessions-v1',
    'accessValidUntil',case when access_until is null then null else to_char(access_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  if access_until is not null and clock_timestamp()>=access_until then raise exception 'attendance_access_denied';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

create function public.faolla_attendance_period_export_v2(p_site_id text,p_auth_user_id uuid,p_operation_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  rec public.merchant_attendance_report_exports%rowtype;
  access text;report jsonb;replayed boolean:=false;until_at timestamptz;receipt jsonb;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_operation_id is null
    or p_operation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_query is null or jsonb_typeof(p_query)<>'object' or octet_length(p_query::text)>2048
    or (select count(*) from jsonb_object_keys(p_query))<>8
    or not(p_query ?& array['access','workerId','locationId','expectedWorkerId','fromDate','throughDate','expectedTimeZone','expectedScopeRevision'])
    or coalesce(p_query->>'access','') not in ('owner','self','manager')
    or jsonb_typeof(p_query->'expectedTimeZone')<>'string' or char_length(p_query->>'expectedTimeZone') not between 1 and 100
    then raise exception 'attendance_invalid_request';end if;
  access:=p_query->>'access';
  if access='manager' then
    if jsonb_typeof(p_query->'expectedScopeRevision')<>'number' or (p_query->>'expectedScopeRevision') !~ '^[1-9][0-9]{0,15}$'
      or (p_query->>'expectedScopeRevision')::bigint>9007199254740990 then raise exception 'attendance_invalid_request';end if;
  elsif p_query->'expectedScopeRevision'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if access='owner' and (p_query->'locationId'<>'null'::jsonb or p_query->'expectedWorkerId'<>'null'::jsonb)
    or access='self' and p_query->'expectedWorkerId'='null'::jsonb then raise exception 'attendance_invalid_request';end if;

  -- Keep the original reader lock order. Extra export permission is checked
  -- under the same role lock, then the established reader rechecks full scope.
  perform 1 from public.merchants where id=p_site_id and (access<>'owner' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if access<>'owner' then
    select * into e from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
    if not found or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=p_site_id and id=e.role_id for share;
    if not found or r.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions)
      or not((case when access='self' then 'attendance.self.export' else 'attendance.reports.export' end)=any(r.permissions))
      then raise exception 'attendance_export_denied';end if;
  end if;
  if access='owner' then
    report:=public.faolla_attendance_period_report_v2(p_site_id,p_auth_user_id,p_query-array['access','locationId','expectedWorkerId','expectedTimeZone','expectedScopeRevision']);
  else
    report:=public.faolla_attendance_scoped_period_report_v2(p_site_id,p_auth_user_id,p_query-array['expectedTimeZone','expectedScopeRevision']);
  end if;
  if report->>'timeZone'<>p_query->>'expectedTimeZone' then raise exception 'attendance_report_zone_changed';end if;
  if access='manager' and report->'scopeRevision'<>p_query->'expectedScopeRevision' then raise exception 'attendance_version_conflict';end if;
  until_at:=(report->>'accessValidUntil')::timestamptz;
  if until_at is not null and clock_timestamp()>=until_at then raise exception 'attendance_access_denied';end if;

  -- Metadata-only receipt: no report JSON, CSV, names, addresses or coordinates.
  -- Concurrent identical IDs insert once. A replay never regenerates different
  -- evidence under the earlier ID, nor returns the earlier export's contents.
  insert into public.merchant_attendance_report_exports(merchant_id,operation_id,actor_auth_user_id,actor_employee_id,access,query,
    worker_id,location_id,as_of,recorded_at,source_sha256,source_bytes,session_count)
  values(p_site_id,p_operation_id,p_auth_user_id,e.id,access,p_query,
    (report->>'workerId')::uuid,case when access='manager' then (report->>'locationId')::uuid else null end,
    (report->>'asOf')::timestamptz,clock_timestamp(),encode(sha256(convert_to(report::text,'UTF8')),'hex'),octet_length(report::text),jsonb_array_length(report->'items'))
  on conflict(merchant_id,operation_id) do nothing returning * into rec;
  if not found then
    replayed:=true;select * into rec from public.merchant_attendance_report_exports where merchant_id=p_site_id and operation_id=p_operation_id;
    if rec.actor_auth_user_id<>p_auth_user_id or rec.query<>p_query then raise exception 'attendance_operation_conflict';end if;
  end if;
  if until_at is not null and clock_timestamp()>=until_at then raise exception 'attendance_access_denied';end if;
  receipt:=jsonb_build_object('operationId',rec.operation_id,'siteId',rec.merchant_id,'access',rec.access,'workerId',rec.worker_id,'locationId',rec.location_id,
    'fromDate',rec.query->'fromDate','throughDate',rec.query->'throughDate','timeZone',rec.query->'expectedTimeZone','scopeRevision',rec.query->'expectedScopeRevision',
    'asOf',to_char(rec.as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recordedAt',to_char(rec.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceSha256',rec.source_sha256,'sourceBytes',rec.source_bytes,
    'sessionCount',rec.session_count,'schemaVersion',1,'status','source_read','downloadConfirmed',false);
  return jsonb_build_object('receipt',receipt,'replayed',replayed,'report',case when replayed then 'null'::jsonb else report end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

revoke all on function public.faolla_attendance_period_export_v2(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_export_v2(text,uuid,uuid,jsonb) to service_role;

-- Fail closed for legacy consumers, even if a future write feature is turned off.

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

create or replace function public.faolla_attendance_correction_decide_v1(p_site_id text,p_auth_user_id uuid,p_request_id uuid,p_command jsonb default null,p_operation_id uuid default null,p_allow_write boolean default false) returns jsonb
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
      if p_command->>'action'='approve' and exists(select 1 from public.merchant_attendance_effect_versions where merchant_id=p_site_id and worker_id=(r->'item'->>'workerId')::uuid) then raise exception 'attendance_report_version_required';end if;
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
insert into public.faolla_schema_migrations(version,name) values(202610010093,'merchant_attendance_versioned_reports') on conflict(version) do nothing;
commit;
