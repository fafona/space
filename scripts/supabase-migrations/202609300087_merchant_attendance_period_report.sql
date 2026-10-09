-- Additive/default-off owner report. No backfill or changes to existing readers.
-- Returns bounded immutable evidence, not stored/payroll totals. The application
-- independently validates and clips raw/approved spans to local calendar days.
begin;
set local lock_timeout='3s';
create index attendance_report_clock_in_idx on public.merchant_attendance_events(merchant_id,worker_id,occurred_at,sequence) where action='clock_in';
create function public.faolla_attendance_period_report_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
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
revoke all on function public.faolla_attendance_period_report_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_report_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300087,'merchant_attendance_period_report') on conflict(version) do nothing;
commit;
