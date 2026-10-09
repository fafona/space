-- Membership-linked kiosk records use the existing correction/revision workflow.
-- Only private basis validators change. No row rewrite, backfill, public grant or clock writer.
begin;
set local lock_timeout='3s';

create or replace function public.faolla_attendance_correction_basis_v1(p_site text,p_auth uuid,p_start uuid,p_worker uuid,p_employee uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare v jsonb;e jsonb;prev_seq bigint;prev_at timestamptz;first_at timestamptz;at_time timestamptz;state text:='off';
begin
  v:=public.faolla_attendance_self_session_v1(p_site,p_auth,p_start);
  if p_worker is null or p_employee is null or v->>'workerId'<>p_worker::text or v->>'employeeId'<>p_employee::text then raise exception 'attendance_worker_changed';end if;
  if jsonb_array_length(v->'events')>202 then raise exception 'attendance_session_too_large';end if;
  for e in select value from jsonb_array_elements(v->'events') loop
    if e->>'source' not in ('web','kiosk') or not exists(select 1 from public.merchant_attendance_events ev
      where ev.id=(e->>'id')::uuid and ev.merchant_id=p_site and ev.worker_id=p_worker and ev.actor_employee_id=p_employee)
      then raise exception 'attendance_correction_unsupported_basis';end if;
    at_time:=public.faolla_attendance_instant_v1(e->>'occurredAt');
    if at_time>public.faolla_attendance_instant_v1(v->>'asOf') then raise exception 'attendance_session_invalid_records';end if;
    if prev_seq is not null and ((e->>'sequence')::bigint<>prev_seq+1 or at_time<prev_at) then raise exception 'attendance_session_invalid_records';end if;
    if prev_seq is null and e->>'action'='clock_in' then state:='working';first_at:=at_time;
    elsif state='working' and e->>'action'='break_start' then state:='break';
    elsif state='break' and e->>'action'='break_end' then state:='working';
    elsif state='working' and e->>'action'='clock_out' then state:='closed';
    else raise exception 'attendance_session_invalid_records';end if;
    prev_seq:=(e->>'sequence')::bigint;prev_at:=at_time;
  end loop;
  if state='closed' and prev_at-first_at>interval '31 days' then raise exception 'attendance_session_span_too_long';end if;
  return v;
end; $$;
revoke all on function public.faolla_attendance_correction_basis_v1(text,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_correction_owner_basis_v1(p_site text,p_worker uuid,p_employee uuid,p_start uuid,p_now timestamptz) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare first_event public.merchant_attendance_events%rowtype;e public.merchant_attendance_events%rowtype;
  prev_event public.merchant_attendance_events%rowtype;next_event public.merchant_attendance_events%rowtype;
  last_event public.merchant_attendance_events%rowtype;rows jsonb:='[]';state text:='off';n integer:=0;
begin
  if p_employee is null then raise exception 'attendance_correction_unsupported_basis';end if;
  select * into first_event from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and id=p_start and action='clock_in';
  if not found then raise exception 'attendance_session_not_found';end if;
  select * into prev_event from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and sequence<first_event.sequence order by sequence desc limit 1;
  if (first_event.sequence=1 and prev_event.id is not null) or (first_event.sequence>1 and (prev_event.id is null or prev_event.sequence<>first_event.sequence-1 or prev_event.action<>'clock_out' or prev_event.occurred_at>first_event.occurred_at))
    then raise exception 'attendance_session_invalid_records';end if;
  for e in select * from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and sequence>=first_event.sequence order by sequence limit 203 loop
    n:=n+1;if n>202 then raise exception 'attendance_session_too_large';end if;
    if e.source not in ('web','kiosk') or e.actor_employee_id is distinct from p_employee then raise exception 'attendance_correction_unsupported_basis';end if;
    if e.occurred_at>p_now or (last_event.id is not null and (e.sequence<>last_event.sequence+1 or e.occurred_at<last_event.occurred_at))
      then raise exception 'attendance_session_invalid_records';end if;
    if state='off' and e.action='clock_in' then state:='working';
    elsif state='working' and e.action='break_start' then state:='break';
    elsif state='break' and e.action='break_end' then state:='working';
    elsif state='working' and e.action='clock_out' then state:='closed';
    else raise exception 'attendance_session_invalid_records';end if;
    rows:=rows||jsonb_build_array(public.faolla_attendance_review_event_v1(e));last_event:=e;exit when state='closed';
  end loop;
  if state='closed' and last_event.occurred_at-first_event.occurred_at>interval '31 days' then raise exception 'attendance_session_span_too_long';end if;
  select * into next_event from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and sequence>last_event.sequence order by sequence limit 1;
  if next_event.id is not null and (state<>'closed' or next_event.sequence<>last_event.sequence+1 or next_event.action<>'clock_in'
    or next_event.occurred_at<last_event.occurred_at or next_event.occurred_at>p_now) then raise exception 'attendance_session_invalid_records';end if;
  return jsonb_build_object('currentBasis',jsonb_build_object('siteId',p_site,'workerId',p_worker,'employeeId',p_employee,
    'asOf',to_char(p_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'events',rows),
    'previous',public.faolla_attendance_review_event_v1(prev_event),'next',public.faolla_attendance_review_event_v1(next_event),'basisIssue',null);
end; $$;
revoke all on function public.faolla_attendance_correction_owner_basis_v1(text,uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010105,'merchant_attendance_kiosk_correction_basis') on conflict(version) do nothing;
commit;
