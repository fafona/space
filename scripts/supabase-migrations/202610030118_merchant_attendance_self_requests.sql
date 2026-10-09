-- Additive, current-identity self request summaries across all submission dates.
-- No old reader/writer, fact, approval rule or table privilege is changed.
-- Transactional index creation is lock-timeout bounded, not duration bounded.
-- Assess an approved concurrent-index rollout separately before large-ledger deployment.
begin;
set local lock_timeout='3s';

do $self_requests_prerequisites$
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or to_regclass('public.merchants') is null
    or to_regclass('public.merchant_attendance_settings') is null
    or to_regclass('public.merchant_enterprise_employees') is null
    or to_regclass('public.merchant_enterprise_roles') is null
    or to_regclass('public.merchant_attendance_workers') is null
    or to_regclass('public.merchant_attendance_events') is null
    or to_regclass('public.merchant_attendance_correction_entries') is null
    or to_regclass('public.merchant_attendance_correction_decisions') is null
    or to_regclass('public.merchant_attendance_correction_effects') is null
    or to_regclass('public.merchant_attendance_revision_requests') is null
    or to_regclass('public.merchant_attendance_revision_decisions') is null
    or to_regclass('public.merchant_attendance_missing_requests') is null
    or to_regclass('public.merchant_attendance_missing_entries') is null
    or to_regclass('public.attendance_revision_self_identity_history_idx') is null
    or to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null
    or to_regprocedure('public.faolla_attendance_instant_v1(text)') is null then
    raise exception 'merchant_attendance_self_requests_prerequisite_required';
  end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202609300086 and name='merchant_attendance_correction_decisions')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610010103 and name='merchant_attendance_missing_revisions')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610030116 and name='merchant_attendance_self_revision_history') then
    raise exception 'merchant_attendance_self_requests_prerequisite_required';
  end if;
end;
$self_requests_prerequisites$;

create index if not exists attendance_correction_self_identity_history_idx
  on public.merchant_attendance_correction_entries
  (merchant_id,worker_id,employee_id,actor_auth_user_id,recorded_at desc,request_id desc) where action='submit';
create index if not exists attendance_missing_self_identity_history_idx
  on public.merchant_attendance_missing_requests
  (merchant_id,worker_id,employee_id,actor_auth_user_id,submitted_at desc,request_id desc);

create or replace function public.faolla_attendance_self_requests_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
  worker public.merchant_attendance_workers%rowtype;
  c public.merchant_attendance_correction_entries%rowtype;ct public.merchant_attendance_correction_entries%rowtype;
  cd public.merchant_attendance_correction_decisions%rowtype;
  v public.merchant_attendance_revision_requests%rowtype;vt public.merchant_attendance_revision_requests%rowtype;
  vd public.merchant_attendance_revision_decisions%rowtype;
  base public.merchant_attendance_correction_effects%rowtype;original public.merchant_attendance_correction_entries%rowtype;
  m public.merchant_attendance_missing_requests%rowtype;parent public.merchant_attendance_missing_requests%rowtype;
  root_row public.merchant_attendance_missing_requests%rowtype;
  ms public.merchant_attendance_missing_entries%rowtype;mt public.merchant_attendance_missing_entries%rowtype;
  approval public.merchant_attendance_missing_entries%rowtype;
  candidate record;k text;v_kind text;v_status text;v_state text;v_cursor_kind text;v_cursor_rank integer;v_cursor uuid;
  v_cursor_at timestamptz;v_asof timestamptz;v_now timestamptz;v_instant timestamptz;v_closed timestamptz;
  v_count integer:=0;v_items jsonb:='[]';v_next jsonb:='null';result jsonb;
  v_root uuid;v_start_event uuid;v_start text;v_end text;start_at timestamptz;end_at timestamptz;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>8
    or not(p_query ?& array['expectedEmployeeId','expectedWorkerId','kind','status','asOf','cursorAt','cursorKind','cursorId'])
    or jsonb_typeof(p_query->'kind')<>'string' or coalesce(p_query->>'kind','') not in ('all','correction','revision','missing')
    or jsonb_typeof(p_query->'status')<>'string' or coalesce(p_query->>'status','') not in ('all','submitted','approved','rejected','withdrawn')
    or (p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorKind'='null'::jsonb)
    or (p_query->'cursorAt'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb)
    or (p_query->'cursorKind'<>'null'::jsonb and (jsonb_typeof(p_query->'cursorKind')<>'string'
      or coalesce(p_query->>'cursorKind','') not in ('correction','revision','missing')))
    or (p_query->'cursorId'<>'null'::jsonb and (jsonb_typeof(p_query->'cursorId')<>'string'
      or coalesce(p_query->>'cursorId','') !~ v_uuid)) then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['expectedEmployeeId','expectedWorkerId'] loop
    if jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ v_uuid then raise exception 'attendance_invalid_request';end if;
  end loop;
  foreach k in array array['asOf','cursorAt'] loop
    if p_query->k<>'null'::jsonb then
      if jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
        then raise exception 'attendance_invalid_request';end if;
      v_instant:=public.faolla_attendance_instant_v1(p_query->>k);
      if to_char(v_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_query->>k then raise exception 'attendance_invalid_request';end if;
    end if;
  end loop;
  v_kind:=p_query->>'kind';v_status:=p_query->>'status';v_cursor_kind:=p_query->>'cursorKind';v_cursor:=(p_query->>'cursorId')::uuid;
  v_cursor_rank:=case v_cursor_kind when 'correction' then 1 when 'revision' then 2 when 'missing' then 3 end;
  if v_cursor is not null and (p_query->'asOf'='null'::jsonb or v_kind<>'all' and v_cursor_kind<>v_kind)
    then raise exception 'attendance_invalid_request';end if;

  -- Current membership and both identity pins are rechecked on every page.
  -- Reads do not depend on activity of the worker, clock/request permission or module pause.
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
  if not found or emp.status<>'active' or emp.id<>(p_query->>'expectedEmployeeId')::uuid then raise exception 'attendance_access_denied';end if;
  select * into role_row from public.merchant_enterprise_roles where merchant_id=p_site_id and id=emp.role_id for share;
  if not found or role_row.status<>'active'
    or not coalesce(public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions),false)
    or not coalesce('attendance.self.view'=any(role_row.permissions),false) then raise exception 'attendance_access_denied';end if;
  select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if worker.id<>(p_query->>'expectedWorkerId')::uuid then raise exception 'attendance_worker_changed';end if;
  v_now:=clock_timestamp();v_asof:=v_now;
  if p_query->'asOf'<>'null'::jsonb then v_asof:=public.faolla_attendance_instant_v1(p_query->>'asOf');end if;
  if v_asof>v_now then raise exception 'attendance_invalid_request';end if;
  if v_cursor is not null then
    v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt');
    if v_cursor_at>v_asof then raise exception 'attendance_invalid_request';end if;
  end if;

  -- Four identity columns precede each51 probe. Merge<=153 into51; interpret50.
  -- Status filtering is AFTER the bound; an empty page can have a next cursor.
  for candidate in select * from (
    (select 'correction'::text kind,1 kind_rank,request_id,recorded_at
      from public.merchant_attendance_correction_entries
      where v_kind in ('all','correction') and merchant_id=p_site_id and worker_id=worker.id
        and employee_id=emp.id and actor_auth_user_id=p_auth_user_id and action='submit' and recorded_at<=v_asof
        and (v_cursor is null or (recorded_at,1,request_id)<(v_cursor_at,v_cursor_rank,v_cursor))
      order by recorded_at desc,request_id desc limit 51)
    union all
    (select 'revision'::text kind,2 kind_rank,request_id,recorded_at
      from public.merchant_attendance_revision_requests
      where v_kind in ('all','revision') and merchant_id=p_site_id and worker_id=worker.id
        and employee_id=emp.id and actor_auth_user_id=p_auth_user_id and action='submit' and recorded_at<=v_asof
        and (v_cursor is null or (recorded_at,2,request_id)<(v_cursor_at,v_cursor_rank,v_cursor))
      order by recorded_at desc,request_id desc limit 51)
    union all
    (select 'missing'::text kind,3 kind_rank,request_id,submitted_at recorded_at
      from public.merchant_attendance_missing_requests
      where v_kind in ('all','missing') and merchant_id=p_site_id and worker_id=worker.id
        and employee_id=emp.id and actor_auth_user_id=p_auth_user_id and submitted_at<=v_asof
        and (v_cursor is null or (submitted_at,3,request_id)<(v_cursor_at,v_cursor_rank,v_cursor))
      order by submitted_at desc,request_id desc limit 51)
    ) candidates order by recorded_at desc,kind_rank desc,request_id desc limit 51 loop
    v_count:=v_count+1;exit when v_count=51;
    v_next:=jsonb_build_object('recordedAt',to_char(candidate.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind',candidate.kind,'requestId',candidate.request_id);
    v_start_event:=null;
    if candidate.kind='correction' then
      select * into c from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=candidate.request_id and action='submit';
      select * into ct from public.merchant_attendance_correction_entries where merchant_id=p_site_id and request_id=c.request_id and recorded_at<=v_asof order by revision desc limit 1;
      select * into cd from public.merchant_attendance_correction_decisions where merchant_id=p_site_id and request_id=c.request_id and recorded_at<=v_asof;
      if c.revision is null or c.operation_id is distinct from c.request_id or ct.revision is null
        or ct.worker_id is distinct from c.worker_id or ct.employee_id is distinct from c.employee_id
        or ct.actor_auth_user_id is distinct from c.actor_auth_user_id or ct.start_event_id is distinct from c.start_event_id
        or ct.revision<c.revision or ct.recorded_at<c.recorded_at
        or ct.action='submit' and ct.operation_id is distinct from c.operation_id
        or ct.action='withdraw' and ct.revision<>c.revision+1
        or cd.operation_id is not null and (ct.action<>'submit' or cd.request_revision<>c.revision or cd.recorded_at<c.recorded_at) then
        raise exception 'attendance_self_requests_invalid';
      end if;
      v_root:=c.request_id;v_start_event:=c.start_event_id;
      v_state:=case when ct.action='withdraw' then 'withdrawn' when cd.action='approve' then 'approved' when cd.action='reject' then 'rejected' else 'submitted' end;
      v_closed:=case when ct.action='withdraw' then ct.recorded_at else cd.recorded_at end;
      v_start:=c.proposal->>'startAt';v_end:=c.proposal->>'endAt';
    elsif candidate.kind='revision' then
      select * into v from public.merchant_attendance_revision_requests where merchant_id=p_site_id and request_id=candidate.request_id and action='submit';
      select * into vt from public.merchant_attendance_revision_requests where merchant_id=p_site_id and request_id=v.request_id and recorded_at<=v_asof order by revision desc limit 1;
      select * into vd from public.merchant_attendance_revision_decisions where merchant_id=p_site_id and request_id=v.request_id and recorded_at<=v_asof;
      select * into base from public.merchant_attendance_correction_effects where merchant_id=p_site_id and request_id=v.base_request_id;
      select * into original from public.merchant_attendance_correction_entries where merchant_id=p_site_id and operation_id=base.request_id and action='submit';
      if v.revision is null or v.operation_id is distinct from v.request_id or vt.revision is null
        or base.worker_id is distinct from worker.id or original.worker_id is distinct from worker.id
        or original.employee_id is distinct from emp.id or original.actor_auth_user_id is distinct from p_auth_user_id
        or base.start_event_id is distinct from original.start_event_id or original.recorded_at>v.recorded_at
        or base.recorded_at>v.recorded_at or v.base_request_id=v.request_id
        or vt.base_request_id is distinct from v.base_request_id or vt.worker_id is distinct from v.worker_id
        or vt.employee_id is distinct from v.employee_id or vt.actor_auth_user_id is distinct from v.actor_auth_user_id
        or vt.revision<v.revision or vt.recorded_at<v.recorded_at
        or vt.action='submit' and vt.operation_id is distinct from v.operation_id
        or vt.action='withdraw' and vt.revision<>v.revision+1
        or vd.operation_id is not null and (vt.action<>'submit' or vd.base_request_id is distinct from v.base_request_id
          or vd.worker_id is distinct from v.worker_id or vd.request_revision<>v.revision or vd.recorded_at<v.recorded_at) then
        raise exception 'attendance_self_requests_invalid';
      end if;
      v_root:=v.base_request_id;v_start_event:=original.start_event_id;
      v_state:=case when vt.action='withdraw' then 'withdrawn' when vd.action='approve' then 'approved' when vd.action='reject' then 'rejected' else 'submitted' end;
      v_closed:=case when vt.action='withdraw' then vt.recorded_at else vd.recorded_at end;
      v_start:=v.command->'proposal'->>'startAt';v_end:=v.command->'proposal'->>'endAt';
    else
      select * into m from public.merchant_attendance_missing_requests where merchant_id=p_site_id and request_id=candidate.request_id;
      select * into ms from public.merchant_attendance_missing_entries where merchant_id=p_site_id and request_id=m.request_id and revision=1;
      select * into mt from public.merchant_attendance_missing_entries where merchant_id=p_site_id and request_id=m.request_id and revision=2 and recorded_at<=v_asof;
      if m.request_id is null or ms.operation_id is distinct from m.request_id or ms.action is distinct from 'submit'
        or ms.actor_auth_user_id is distinct from m.actor_auth_user_id or ms.recorded_at is distinct from m.submitted_at
        or mt.operation_id is not null and (mt.recorded_at<m.submitted_at
          or mt.action='withdraw' and mt.actor_auth_user_id is distinct from m.actor_auth_user_id) then
        raise exception 'attendance_self_requests_invalid';
      end if;
      v_root:=coalesce(m.root_request_id,m.request_id);
      if m.supersedes_request_id is not null then
        select * into parent from public.merchant_attendance_missing_requests where merchant_id=p_site_id and request_id=m.supersedes_request_id;
        select * into root_row from public.merchant_attendance_missing_requests where merchant_id=p_site_id and request_id=m.root_request_id;
        select * into approval from public.merchant_attendance_missing_entries where merchant_id=p_site_id and operation_id=m.supersedes_operation_id;
        if parent.worker_id is distinct from worker.id or parent.employee_id is distinct from emp.id or parent.actor_auth_user_id is distinct from p_auth_user_id
          or root_row.worker_id is distinct from worker.id or root_row.employee_id is distinct from emp.id or root_row.actor_auth_user_id is distinct from p_auth_user_id
          or root_row.supersedes_request_id is not null or root_row.root_request_id is not null
          or coalesce(parent.root_request_id,parent.request_id) is distinct from m.root_request_id
          or parent.request_id=m.request_id or root_row.request_id=m.request_id
          or root_row.submitted_at>parent.submitted_at or parent.submitted_at>m.submitted_at
          or approval.request_id is distinct from parent.request_id or approval.revision is distinct from 2
          or approval.action is distinct from 'approve' or approval.recorded_at<parent.submitted_at or approval.recorded_at>m.submitted_at then
          raise exception 'attendance_self_requests_invalid';
        end if;
      elsif m.root_request_id is not null or m.supersedes_operation_id is not null then raise exception 'attendance_self_requests_invalid';end if;
      v_state:=case mt.action when 'withdraw' then 'withdrawn' when 'approve' then 'approved' when 'reject' then 'rejected' else 'submitted' end;
      v_closed:=mt.recorded_at;
      v_start:=to_char(m.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
      v_end:=to_char(m.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end if;
    -- A bounded point check of original identity, not a full session recalculation.
    if candidate.kind in ('correction','revision') and not exists(select 1 from public.merchant_attendance_events
      where id=v_start_event and merchant_id=p_site_id and worker_id=worker.id and action='clock_in' and actor_employee_id=emp.id) then
      raise exception 'attendance_self_requests_invalid';
    end if;
    begin
      if v_start is null or v_end is null then raise exception 'attendance_self_requests_invalid';end if;
      start_at:=public.faolla_attendance_instant_v1(v_start);end_at:=public.faolla_attendance_instant_v1(v_end);
      if end_at<=start_at or end_at>candidate.recorded_at
        or to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>v_start
        or to_char(end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>v_end then raise exception 'attendance_self_requests_invalid';end if;
    exception when sqlstate 'P0001' or invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'attendance_self_requests_invalid';
    end;
    if v_status<>'all' and v_state<>v_status then continue;end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('kind',candidate.kind,'requestId',candidate.request_id,'rootRequestId',v_root,
      'workerId',worker.id,'employeeId',emp.id,'workerName',worker.display_name,'workerNo',worker.worker_no,
      'submittedAt',to_char(candidate.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'proposedStartAt',v_start,'proposedEndAt',v_end,'status',v_state,
      'closedAt',case when v_closed is null then null else to_char(v_closed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end));
  end loop;
  result:=jsonb_build_object('protocol','self-requests-v1','readOnly',true,'siteId',p_site_id,'employeeId',emp.id,'workerId',worker.id,
    'asOf',to_char(v_asof at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_items,'scanned',least(v_count,50),
    'nextCursor',case when v_count=51 then v_next else 'null'::jsonb end);
  if octet_length(result::text)>131072 then raise exception 'attendance_self_requests_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_self_requests_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_self_requests_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name)
values(202610030118,'merchant_attendance_self_requests') on conflict(version) do nothing;
do $self_requests_postconditions$
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610030118 and name='merchant_attendance_self_requests') then
    raise exception 'merchant_attendance_self_requests_registry_postcondition_failed';
  end if;
  if not has_function_privilege('service_role','public.faolla_attendance_self_requests_v1(text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_self_requests_v1(text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_self_requests_v1(text,uuid,jsonb)','EXECUTE') then
    raise exception 'merchant_attendance_self_requests_acl_postcondition_failed';
  end if;
end;
$self_requests_postconditions$;
notify pgrst, 'reload schema';
commit;
