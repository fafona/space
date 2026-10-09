-- Local/default-off candidate: requests to revise a first approved declaration.
-- No approval or effective-report switch here. Original facts/decisions stay intact.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_revision_requests (
  merchant_id text not null,base_request_id uuid not null,worker_id uuid not null,employee_id uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740989),
  request_id uuid not null,operation_id uuid not null,actor_auth_user_id uuid not null,
  action text not null check(action in ('submit','withdraw')),
  policy_revision bigint not null,base_operation_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object' and octet_length(command::text)<=12288),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,base_request_id,revision),unique(merchant_id,operation_id),
  foreign key(merchant_id,base_request_id) references public.merchant_attendance_correction_effects(merchant_id,request_id) on delete restrict,
  foreign key(merchant_id,base_operation_id) references public.merchant_attendance_correction_decisions(merchant_id,operation_id) on delete restrict,
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
  foreign key(merchant_id,policy_revision) references public.merchant_attendance_correction_controls(merchant_id,revision) on delete restrict,
  check(action<>'submit' or request_id=operation_id)
);
create unique index attendance_revision_submit_idx on public.merchant_attendance_revision_requests(merchant_id,request_id) where action='submit';
create index attendance_revision_request_idx on public.merchant_attendance_revision_requests(merchant_id,request_id,revision desc);
alter table public.merchant_attendance_revision_requests enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_revision_requests'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_revision_requests from public,anon,authenticated,service_role;
create trigger attendance_revision_no_rewrite before update or delete on public.merchant_attendance_revision_requests for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger attendance_revision_no_truncate before truncate on public.merchant_attendance_revision_requests for each statement execute function public.faolla_attendance_events_append_only_v1();

-- Caller holds settings lock. Check original, previous APPROVED and proposed
-- intervals: moving an approved shift out of a locked period must not bypass it.
create function public.faolla_attendance_revision_rules_v1(p_site text,p_basis jsonb,p_base jsonb,p_proposal jsonb,p_now timestamptz) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare policy public.merchant_attendance_correction_controls%rowtype;
  issues text[]:='{}';anchor date;deadline timestamptz;locked_count integer;
  original_start timestamptz:=(p_basis->'events'->0->>'occurredAt')::timestamptz;
  original_end timestamptz:=(p_basis->'events'->-1->>'occurredAt')::timestamptz;
begin
  select * into policy from public.merchant_attendance_correction_controls where merchant_id=p_site and action='set_policy' and recorded_at<=p_now order by recorded_at desc,revision desc limit 1;
  if policy.revision is null then issues:=array_append(issues,'policy_missing');
  else
    anchor:=(original_start at time zone (policy.payload->>'timeZone'))::date;
    if anchor<date '2000-01-01' or anchor>date '2100-12-31' then issues:=array_append(issues,'unsupported_dates');
    else
      deadline:=public.faolla_attendance_control_day_boundary_v1(anchor+(policy.payload->>'submissionWindowDays')::integer+1,policy.payload->>'timeZone');
      if p_now>=deadline then issues:=array_append(issues,'window_expired');end if;
    end if;
  end if;
  if original_end=original_start then original_end:=original_end+interval '1 microsecond';end if;
  if p_proposal is not null and ((p_proposal->>'startAt')::timestamptz<timestamptz '2000-01-01Z' or (p_proposal->>'endAt')::timestamptz>timestamptz '2101-01-01Z') then issues:=array_append(issues,'unsupported_dates');end if;
  select count(*) into locked_count from (select 1 from public.merchant_attendance_correction_periods where merchant_id=p_site and locked and (
    start_at<original_end and end_at>original_start
    or start_at<(p_base->>'endAt')::timestamptz and end_at>(p_base->>'startAt')::timestamptz
    or p_proposal is not null and start_at<(p_proposal->>'endAt')::timestamptz and end_at>(p_proposal->>'startAt')::timestamptz) limit 201) locks;
  if locked_count>200 then issues:=array_append(issues,'period_limit');elsif locked_count>0 then issues:=array_append(issues,'period_locked');end if;
  return jsonb_build_object('binding','preparation','approvalAvailable',false,'lockedPeriodCount',least(locked_count,200),'checkedAt',to_char(p_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'policy',case when policy.revision is null then null else jsonb_build_object('revision',policy.revision,'timeZone',policy.payload->'timeZone','submissionWindowDays',policy.payload->'submissionWindowDays',
      'recordedAt',to_char(policy.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end,
    'deadlineAt',case when deadline is null then null else to_char(deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'issues',to_jsonb(issues));
end; $$;
revoke all on function public.faolla_attendance_revision_rules_v1(text,jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;

create function public.faolla_attendance_revision_self_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null,p_platform_enabled boolean default false) returns jsonb
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
revoke all on function public.faolla_attendance_revision_self_v1(text,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_revision_self_v1(text,uuid,jsonb,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610010091,'merchant_attendance_revision_requests') on conflict(version) do nothing;
commit;
