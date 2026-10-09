-- Owner-only READ-ONLY correction inbox/preflight. No decision or effective-time mutation.
begin;
set local lock_timeout='3s';
create index attendance_correction_owner_list_idx on public.merchant_attendance_correction_entries(merchant_id,recorded_at desc,request_id desc) where action='submit';
create index attendance_correction_owner_worker_list_idx on public.merchant_attendance_correction_entries(merchant_id,worker_id,recorded_at desc,request_id desc) where action='submit';

create function public.faolla_attendance_review_event_v1(p public.merchant_attendance_events) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select case when p.id is null then null else jsonb_build_object('id',p.id,'locationId',p.location_id,'sequence',p.sequence,'action',p.action,
    'occurredAt',to_char(p.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',p.time_zone,'breakPaid',p.break_paid,'source',p.source) end;
$$;
revoke all on function public.faolla_attendance_review_event_v1(public.merchant_attendance_events) from public,anon,authenticated,service_role;

create function public.faolla_attendance_correction_owner_basis_v1(p_site text,p_worker uuid,p_employee uuid,p_start uuid,p_now timestamptz) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare first_event public.merchant_attendance_events%rowtype;e public.merchant_attendance_events%rowtype;
  prev_event public.merchant_attendance_events%rowtype;next_event public.merchant_attendance_events%rowtype;
  last_event public.merchant_attendance_events%rowtype;rows jsonb:='[]';state text:='off';n integer:=0;
begin
  select * into first_event from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and id=p_start and action='clock_in';
  if not found then raise exception 'attendance_session_not_found';end if;
  select * into prev_event from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and sequence<first_event.sequence order by sequence desc limit 1;
  if (first_event.sequence=1 and prev_event.id is not null) or (first_event.sequence>1 and (prev_event.id is null or prev_event.sequence<>first_event.sequence-1 or prev_event.action<>'clock_out' or prev_event.occurred_at>first_event.occurred_at))
    then raise exception 'attendance_session_invalid_records';end if;
  for e in select * from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and sequence>=first_event.sequence order by sequence limit 203 loop
    n:=n+1;if n>202 then raise exception 'attendance_session_too_large';end if;
    if e.source<>'web' or e.actor_employee_id is distinct from p_employee then raise exception 'attendance_correction_unsupported_basis';end if;
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

create function public.faolla_attendance_correction_owner_review_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  r public.merchant_attendance_correction_entries%rowtype;tail public.merchant_attendance_correction_entries%rowtype;
  w public.merchant_attendance_workers%rowtype;emp public.merchant_enterprise_employees%rowtype;
  v_mode text;v_request uuid;v_worker uuid;v_status text;v_from timestamptz;v_to timestamptz;v_now timestamptz;v_asof timestamptz;
  v_cursor_at timestamptz;v_cursor uuid;v_count integer:=0;v_items jsonb:='[]';v_next jsonb:='null';v_summary jsonb;
  v_evidence jsonb;v_periods jsonb;v_period_count integer;v_first_date date;v_last_date date;v_zone text;v_code text;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  v_mode:=p_query->>'mode';
  if v_mode='detail' then
    if (select count(*) from jsonb_object_keys(p_query))<>2 or not(p_query ?& array['mode','requestId']) or coalesce(p_query->>'requestId','') !~ v_uuid then raise exception 'attendance_invalid_request';end if;
    v_request:=(p_query->>'requestId')::uuid;
  elsif v_mode='list' then
    if (select count(*) from jsonb_object_keys(p_query))<>8 or not(p_query ?& array['mode','fromAt','toAt','workerId','status','asOf','cursorAt','cursorId'])
      then raise exception 'attendance_invalid_request';end if;
  else raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=p_site_id and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  v_now:=clock_timestamp();v_asof:=v_now;
  if v_mode='list' then
    if (p_query->'workerId'<>'null'::jsonb and coalesce(p_query->>'workerId','') !~ v_uuid)
      or coalesce(p_query->>'status','') not in ('all','submitted','withdrawn')
      or ((p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb))
      or (p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid) then raise exception 'attendance_invalid_request';end if;
    v_from:=public.faolla_attendance_instant_v1(p_query->>'fromAt');v_to:=public.faolla_attendance_instant_v1(p_query->>'toAt');
    v_status:=p_query->>'status';v_worker:=(p_query->>'workerId')::uuid;v_cursor:=(p_query->>'cursorId')::uuid;
    if p_query->'asOf'<>'null'::jsonb then v_asof:=public.faolla_attendance_instant_v1(p_query->>'asOf');end if;
    if v_from>=v_to or v_to-v_from>interval '31 days' or v_from<timestamptz '2000-01-01T00:00:00Z'
      or v_to>timestamptz '2101-01-01T00:00:00Z' or v_asof>v_now then raise exception 'attendance_invalid_request';end if;
    if v_cursor is not null then
      v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt');
      if p_query->'asOf'='null'::jsonb or v_cursor_at<v_from or v_cursor_at>=v_to or v_cursor_at>v_asof then raise exception 'attendance_invalid_request';end if;
    end if;
    for r in select * from public.merchant_attendance_correction_entries
      where merchant_id=p_site_id and action='submit' and recorded_at>=v_from and recorded_at<v_to and recorded_at<=v_asof
      and (v_worker is null or worker_id=v_worker) and (v_cursor is null or (recorded_at,request_id)<(v_cursor_at,v_cursor))
      order by recorded_at desc,request_id desc limit 51 loop
      v_count:=v_count+1;exit when v_count=51;
      v_next:=jsonb_build_object('recordedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'requestId',r.request_id);
      select * into tail from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=r.request_id and recorded_at<=v_asof order by revision desc limit 1;
      if v_status<>'all' and (case tail.action when 'submit' then 'submitted' else 'withdrawn' end)<>v_status then continue;end if;
      select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and id=r.worker_id;
      v_summary:=public.faolla_attendance_correction_summary_v1(r,tail)||jsonb_build_object('employeeId',r.employee_id,'workerId',r.worker_id,'workerName',w.display_name,'workerNo',w.worker_no);
      v_items:=v_items||jsonb_build_array(v_summary);
    end loop;
    return jsonb_build_object('siteId',p_site_id,'mode','list','asOf',to_char(v_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'approvalAvailable',false,'scanned',least(v_count,50),'items',v_items,'nextCursor',case when v_count=51 then v_next else 'null'::jsonb end);
  end if;
  select * into r from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=v_request and action='submit';
  if not found then raise exception 'attendance_correction_not_found';end if;
  -- Same lock order as employee writes; inactive/withdrawn records remain available to the current owner.
  select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and id=r.employee_id for share;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and id=r.worker_id for share;
  if w.id is null or emp.id is null then raise exception 'attendance_correction_not_found';end if;
  v_now:=clock_timestamp();v_asof:=v_now;
  select * into tail from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=v_request order by revision desc limit 1;
  if tail.recorded_at>v_now or r.recorded_at>v_now then raise exception 'attendance_invalid_request';end if;
  v_summary:=public.faolla_attendance_correction_summary_v1(r,tail);
  begin
    v_evidence:=public.faolla_attendance_correction_owner_basis_v1(p_site_id,r.worker_id,r.employee_id,r.start_event_id,v_now);
  exception when sqlstate 'P0001' then
    v_code:=sqlerrm;
    if v_code not in ('attendance_session_not_found','attendance_session_invalid_records','attendance_session_too_large','attendance_session_span_too_long','attendance_correction_unsupported_basis') then raise;end if;
    v_evidence:=jsonb_build_object('currentBasis',null,'previous',null,'next',null,'basisIssue',v_code);
  end;
  v_zone:=r.basis->'events'->0->>'timeZone';
  v_first_date:=(public.faolla_attendance_instant_v1(r.proposal->>'startAt') at time zone v_zone)::date;
  v_last_date:=((public.faolla_attendance_instant_v1(r.proposal->>'endAt')-interval '1 microsecond') at time zone v_zone)::date;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('startsOn',starts_on,'endsOn',ends_on) order by starts_on) filter(where rn<=100),'[]'::jsonb)
    into v_period_count,v_periods from (select starts_on,ends_on,row_number() over(order by starts_on) rn from (
      select starts_on,ends_on from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=r.worker_id
      and starts_on<=v_last_date and (ends_on is null or ends_on>=v_first_date) order by starts_on limit 101) bounded) periods;
  v_evidence:=v_evidence||jsonb_build_object('bindingCurrent',coalesce(w.employee_id=r.employee_id and emp.auth_user_id=r.actor_auth_user_id,false),
    'ownApplication',r.actor_auth_user_id=p_auth_user_id,'employmentPeriods',v_periods,'employmentTruncated',v_period_count>100);
  return jsonb_build_object('siteId',p_site_id,'mode','detail','asOf',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'approvalAvailable',false,
    'item',v_summary||jsonb_build_object('employeeId',r.employee_id,'workerId',r.worker_id,'workerName',w.display_name,'workerNo',w.worker_no),
    'application',jsonb_build_object('siteId',p_site_id,'employeeId',r.employee_id,'workerId',r.worker_id,'asOf',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'mode','detail','canRequest',false,'item',v_summary,'basis',r.basis,'proposal',r.proposal,'reason',r.reason,'receipt',null,
      'withdrawal',case when tail.action='withdraw' then jsonb_build_object('reason',tail.reason,'recordedAt',to_char(tail.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end),
    'evidence',v_evidence);
end; $$;
revoke all on function public.faolla_attendance_correction_owner_review_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_owner_review_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300083,'merchant_attendance_correction_owner_review') on conflict(version) do nothing;
commit;
