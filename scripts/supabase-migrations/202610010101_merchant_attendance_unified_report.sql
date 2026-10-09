-- Unreleased, additive read-only candidate. Existing reports and writers unchanged.
begin;
set local lock_timeout='3s';
create function public.faolla_attendance_unified_report_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare mode text;base jsonb;result jsonb;items jsonb:='[]';worker uuid;viewer uuid;location uuid;
  from_at timestamptz;to_at timestamptz;as_of timestamptz;expires timestamptz;row_count integer;
  p public.merchant_attendance_missing_requests%rowtype;decision public.merchant_attendance_missing_entries%rowtype;
  prior_action text;
begin
  if p_query is null or jsonb_typeof(p_query)<>'object' or not(p_query ? 'access') then raise exception 'attendance_invalid_request';end if;
  mode:=p_query->>'access';
  -- Delegate original-source collection AND authorization to the unchanged exact
  -- owner/self/scoped protocol, not to an impersonated owner or JS post-filter.
  if mode='owner' then
    base:=public.faolla_attendance_period_report_v2(p_site_id,p_auth_user_id,p_query-'access');
  elsif mode in ('self','manager') then
    base:=public.faolla_attendance_scoped_period_report_v2(p_site_id,p_auth_user_id,p_query);
  else raise exception 'attendance_invalid_request';end if;
  worker:=(base->>'workerId')::uuid;viewer:=(base->>'viewerEmployeeId')::uuid;location:=(base->>'locationId')::uuid;
  from_at:=(base->>'fromAt')::timestamptz;to_at:=(base->>'toAt')::timestamptz;as_of:=(base->>'asOf')::timestamptz;expires:=(base->>'accessValidUntil')::timestamptz;
  -- Original reader retains owner/settings/role/scope/worker locks until this
  -- enclosing transaction ends. Missing decisions take the settings UPDATE lock.
  row_count:=jsonb_array_length(base->'items');
  for p in select r.* from public.merchant_attendance_missing_requests r
    join public.merchant_attendance_missing_entries d on d.merchant_id=r.merchant_id and d.request_id=r.request_id and d.action='approve' and d.revision=2
    where r.merchant_id=p_site_id and r.worker_id=worker and r.start_at>=from_at-interval '24 hours' and r.start_at<to_at and r.end_at>from_at
      and (mode='owner' or mode='self' and r.employee_id=viewer and r.actor_auth_user_id=p_auth_user_id or mode='manager' and r.location_id=location)
    order by r.start_at,r.request_id limit 101
  loop
    row_count:=row_count+1;if row_count>100 then raise exception 'attendance_report_too_large';end if;
    select * into decision from public.merchant_attendance_missing_entries d where d.merchant_id=p.merchant_id and d.request_id=p.request_id and d.revision=2;
    if p.submitted_at>as_of or decision.recorded_at>as_of or decision.action<>'approve' then raise exception 'attendance_report_invalid_data';end if;
    -- Historical approval stays valid after offboarding/location deactivation or
    -- later period locks. Only conflicting time sources block this read. Never
    -- silently drop a conflicting approved declaration or count it twice.
    select action into prior_action from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at<=p.start_at order by occurred_at desc,sequence desc limit 1;
    if (prior_action is not null and prior_action<>'clock_out') or exists(select 1 from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at>p.start_at and occurred_at<p.end_at)
      or exists(select 1 from public.merchant_attendance_effect_current_v2 where merchant_id=p.merchant_id and worker_id=p.worker_id and start_at<p.end_at and end_at>p.start_at)
      or exists(select 1 from public.merchant_attendance_missing_requests other join public.merchant_attendance_missing_entries d on d.merchant_id=other.merchant_id and d.request_id=other.request_id and d.action='approve' and d.revision=2
        where other.merchant_id=p.merchant_id and other.worker_id=p.worker_id and other.request_id<>p.request_id and other.start_at<p.end_at and other.end_at>p.start_at)
      then raise exception 'attendance_report_reconciliation_required';end if;
    items:=items||jsonb_build_array(jsonb_build_object('source','missing-approved','requestId',p.request_id,'operationId',decision.operation_id,'workerId',p.worker_id,
      'employeeId',case when mode='self' then p.employee_id else null end,'workerName',p.worker_name,'locationId',p.location_id,'locationName',p.location_name,
      'timeZone',p.time_zone,'policyRevision',p.policy_revision,'proposal',p.proposal,
      'submittedAt',to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'approvedAt',to_char(decision.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end loop;
  result:=jsonb_build_object('version','attendance-unified-v1','access',mode,'base',base,'missing',items,'complete',true,'payrollReady',false);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  -- A short manager grant may expire while collecting evidence. No stale grant.
  if expires is not null and clock_timestamp()>=expires then raise exception 'attendance_access_denied';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_unified_report_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_unified_report_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010101,'merchant_attendance_unified_report') on conflict(version) do nothing;
commit;
