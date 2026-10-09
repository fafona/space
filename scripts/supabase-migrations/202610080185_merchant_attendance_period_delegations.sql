-- Explicit five-action, whole-period delegation. This migration never grants
-- existing roles permissions and never invokes a period writer. All fresh
-- authority is serialized with revocation and account suspension by settings.
begin;
set local lock_timeout='3s';

do $period_delegation_preflight$
declare item record;installed boolean;object_name text;
begin
  for item in select * from (values(202610060167::bigint,'merchant_attendance_schedule_delegation'),
    (202610060168::bigint,'merchant_attendance_schedule_delegation_permissions'),
    (202610080183::bigint,'merchant_attendance_period_continuation')) prerequisite(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations x where x.version=item.version and x.name=item.name) then
      raise exception 'merchant_attendance_period_delegation_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name<>'merchant_attendance_period_delegations') then
    raise exception 'merchant_attendance_period_delegation_installation_conflict';end if;
  foreach object_name in array array['merchant_attendance_period_delegations','merchant_attendance_period_delegation_revocations','merchant_attendance_period_delegation_operations'] loop
    if installed<>(to_regclass('public.'||object_name) is not null) then raise exception 'merchant_attendance_period_delegation_installation_conflict';end if;
    if installed and exists(select 1 from pg_class c where c.oid=to_regclass('public.'||object_name) and
      (c.relkind<>'r' or not c.relrowsecurity or c.relowner<>(select oid from pg_roles where rolname=current_user)
        or exists(select 1 from pg_policy where polrelid=c.oid)
        or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner))) then
      raise exception 'merchant_attendance_period_delegation_installation_conflict';end if;
  end loop;
  foreach object_name in array array['faolla_attendance_period_delegation_command_v1','faolla_attendance_period_delegation_hash_v1',
    'faolla_attendance_period_delegation_actions_v1','faolla_attendance_period_delegation_grant_v1','faolla_attendance_period_delegation_guard_v1',
    'faolla_attendance_period_delegation_proof_v1','faolla_attendance_period_delegation_authority_v1','faolla_attendance_period_delegation_receipt_v1',
    'faolla_attendance_period_delegation_v1'] loop
    if (select count(*) from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=object_name)
      <>(case when installed then 1 else 0 end) then raise exception 'merchant_attendance_period_delegation_installation_conflict';end if;
    if installed then
      select * into item from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=object_name;
      if item.proowner<>(select oid from pg_roles where rolname=current_user) or item.prokind<>'f' or item.proretset or item.proargmodes is not null
        or item.proconfig is distinct from array['search_path=pg_catalog'] or item.prosecdef<>(object_name='faolla_attendance_period_delegation_v1')
        or exists(select 1 from aclexplode(coalesce(item.proacl,acldefault('f',item.proowner))) a where a.grantee<>item.proowner
          and not(a.grantee=(select oid from pg_roles where rolname='service_role') and object_name='faolla_attendance_period_delegation_v1')) then
        raise exception 'merchant_attendance_period_delegation_installation_conflict';end if;
    end if;
  end loop;
end;
$period_delegation_preflight$;

create or replace function public.faolla_attendance_period_delegation_command_v1(p jsonb,p_access text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare key_name text;canonical_actions jsonb;first_day date;last_day date;first_at timestamptz;last_at timestamptz;
begin
  if p_access is distinct from 'owner' or p is null or jsonb_typeof(p) is distinct from 'object'
    or octet_length(convert_to(p::text,'UTF8'))>8192 then return false;end if;
  if p->>'action'='grant' then
    if public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','fromDate','throughDate','actions','includeExisting','validFrom','validUntil','reason']) is distinct from true
      or jsonb_typeof(p->'includeExisting') is distinct from 'boolean' or jsonb_typeof(p->'actions') is distinct from 'array' then return false;end if;
    foreach key_name in array array['delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId'] loop
      if public.faolla_attendance_shift_rule_binding_scalar_v1(p->key_name,'uuid') is distinct from true then return false;end if;
    end loop;
    select coalesce(jsonb_agg(to_jsonb(a.action) order by a.ordinal),'[]') into canonical_actions
      from (values('view',1),('send',2),('respond',3),('seal',4),('reopen',5)) a(action,ordinal) where p->'actions' ? a.action;
    if canonical_actions is distinct from p->'actions' or not(canonical_actions ? 'view')
      or p->>'delegateEmployeeId'=p->>'employeeId' or p->>'delegateAuthUserId'=p->>'employeeAuthUserId' then return false;end if;
    foreach key_name in array array['fromDate','throughDate'] loop
      if jsonb_typeof(p->key_name) is distinct from 'string' or coalesce(p->>key_name,'')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
    end loop;
    first_day:=(p->>'fromDate')::date;last_day:=(p->>'throughDate')::date;
    if to_char(first_day,'YYYY-MM-DD')<>p->>'fromDate' or to_char(last_day,'YYYY-MM-DD')<>p->>'throughDate'
      or first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 365 then return false;end if;
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p->'validFrom','stamp6') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'validUntil','stamp6') is distinct from true then return false;end if;
    first_at:=(p->>'validFrom')::timestamptz;last_at:=(p->>'validUntil')::timestamptz;
    if last_at<=first_at or last_at-first_at>interval '366 days' then return false;end if;
  elsif p->>'action'='revoke' then
    if public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','grantId','expectedRevision','reason']) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'grantId','uuid') is distinct from true or p->'expectedRevision' is distinct from '1'::jsonb then return false;end if;
  else return false;end if;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is true
    and jsonb_typeof(p->'reason')='string' and char_length(p->>'reason') between 1 and 200
    and p->>'reason'=btrim(p->>'reason') and p->>'reason'!~'[[:cntrl:]]';
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return false;
end;
$$;

create or replace function public.faolla_attendance_period_delegation_hash_v1(p_query jsonb,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare tuple_value jsonb;action_text text;
begin
  if public.faolla_attendance_period_delegation_command_v1(p,p_query->>'access') is distinct from true then raise exception 'attendance_invalid_request';end if;
  tuple_value:=jsonb_build_array('attendance-period-delegation-v1',p_query->>'siteId',p_query->>'access');
  if p->>'action'='grant' then
    select string_agg(a.value,',' order by a.ordinal) into action_text from jsonb_array_elements_text(p->'actions') with ordinality a(value,ordinal);
    tuple_value:=tuple_value||jsonb_build_array('grant',p->>'operationId',p->>'delegateEmployeeId',p->>'delegateAuthUserId',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId',
      p->>'fromDate',p->>'throughDate',action_text,(p->>'includeExisting')::boolean,p->>'validFrom',p->>'validUntil',p->>'reason');
  else tuple_value:=tuple_value||jsonb_build_array('revoke',p->>'operationId',p->>'grantId',1,p->>'reason');end if;
  return encode(sha256(convert_to(tuple_value::text,'UTF8')),'hex');
end;
$$;

create table if not exists public.merchant_attendance_period_delegations(
  merchant_id text not null references public.merchants(id),grant_id uuid not null,
  delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,delegate_name text not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,worker_name text not null,worker_no text not null,
  from_date date not null,through_date date not null,actions jsonb not null,include_existing boolean not null,
  delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
  employee_generation bigint not null check(employee_generation between 0 and 9007199254740990),
  valid_from timestamptz not null,valid_until timestamptz not null,actor_auth_user_id uuid not null,reason text not null,
  query jsonb not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,grant_id),
  foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  check(isfinite(valid_from) and isfinite(valid_until) and valid_until>valid_from and valid_until-valid_from<=interval '366 days'
    and isfinite(recorded_at) and valid_until>recorded_at and from_date>=date '2000-01-01' and through_date<=date '2100-12-31' and through_date-from_date between 0 and 365),
  check(public.faolla_attendance_period_delegation_command_v1(command,'owner') is true and command->>'action'='grant'
    and command->>'operationId'=grant_id::text and command->>'delegateEmployeeId'=delegate_employee_id::text and command->>'delegateAuthUserId'=delegate_auth_user_id::text
    and command->>'workerId'=worker_id::text and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text
    and command->>'fromDate'=to_char(from_date,'YYYY-MM-DD') and command->>'throughDate'=to_char(through_date,'YYYY-MM-DD')
    and command->'actions'=actions and (command->>'includeExisting')::boolean=include_existing
    and (command->>'validFrom')::timestamptz=valid_from and (command->>'validUntil')::timestamptz=valid_until and command->>'reason'=reason),
  check(query=jsonb_build_object('siteId',merchant_id,'access','owner','mode','list','catalog',null,'grantId',null,'afterId',null,'operationId',null)
    and command_fingerprint=public.faolla_attendance_period_delegation_hash_v1(query,command))
);
create index if not exists attendance_period_delegation_delegate_idx on public.merchant_attendance_period_delegations(merchant_id,delegate_employee_id,grant_id);
create index if not exists attendance_period_delegation_target_idx on public.merchant_attendance_period_delegations(merchant_id,employee_id,grant_id);
create table if not exists public.merchant_attendance_period_delegation_revocations(
  merchant_id text not null,operation_id uuid not null,grant_id uuid not null,actor_auth_user_id uuid not null,reason text not null,
  query jsonb not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,grant_id),
  foreign key(merchant_id,grant_id) references public.merchant_attendance_period_delegations(merchant_id,grant_id),
  check(public.faolla_attendance_period_delegation_command_v1(command,'owner') is true and command->>'action'='revoke'
    and command->>'operationId'=operation_id::text and command->>'grantId'=grant_id::text and command->>'reason'=reason
    and query=jsonb_build_object('siteId',merchant_id,'access','owner','mode','detail','catalog',null,'grantId',grant_id,'afterId',null,'operationId',null)
    and command_fingerprint=public.faolla_attendance_period_delegation_hash_v1(query,command))
);
--186 owns period command/query fingerprint semantics. This immutable sidecar
--must still match the actual period entry and the precise captured grant.
create table if not exists public.merchant_attendance_period_delegation_operations(
  merchant_id text not null,operation_id uuid not null,grant_id uuid not null,period_id uuid not null,period_revision integer not null,period_version integer not null,
  actor_auth_user_id uuid not null,actor_employee_id uuid not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
  action text not null,query jsonb not null,command jsonb not null,command_fingerprint text not null,authority jsonb not null,
  authorized_at timestamptz not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,period_id,period_revision),
  foreign key(merchant_id,grant_id) references public.merchant_attendance_period_delegations(merchant_id,grant_id),
  foreign key(merchant_id,operation_id) references public.merchant_attendance_period_entries(merchant_id,operation_id),
  foreign key(merchant_id,period_id,period_revision) references public.merchant_attendance_period_entries(merchant_id,period_id,revision),
  check(action in('send','respond','seal','reopen') and period_revision between 1 and 2147483647 and period_version between 1 and period_revision
    and isfinite(authorized_at) and isfinite(recorded_at) and authorized_at<=recorded_at
    and command_fingerprint~'^[0-9a-f]{64}$' and length(command_fingerprint)=64
    and jsonb_typeof(query)='object' and octet_length(query::text)<=8192 and jsonb_typeof(command)='object' and octet_length(command::text)<=8192
    and jsonb_typeof(authority)='object' and octet_length(authority::text)<=8192)
);

create or replace function public.faolla_attendance_period_delegation_actions_v1(p public.merchant_attendance_period_delegations,p_at timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare permission_set text[];delegate_epoch public.merchant_attendance_account_epochs%rowtype;target_epoch public.merchant_attendance_account_epochs%rowtype;
  action_name text;result_value jsonb:='[]';
begin
  if p.grant_id is null or p_at is null or not isfinite(p_at) or p_at<p.valid_from or p_at>=p.valid_until
    or exists(select 1 from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id) then return result_value;end if;
  select r.permissions into permission_set from public.merchant_enterprise_employees member
    join public.merchant_enterprise_roles r on r.merchant_id=member.merchant_id and r.id=member.role_id
    join public.merchant_attendance_workers worker on worker.merchant_id=member.merchant_id and worker.id=p.worker_id
    join public.merchant_enterprise_employees target on target.merchant_id=worker.merchant_id and target.id=worker.employee_id
    join public.merchants merchant on merchant.id=member.merchant_id
    where member.merchant_id=p.merchant_id and member.id=p.delegate_employee_id and member.auth_user_id=p.delegate_auth_user_id and member.status='active'
      and r.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is true
      and r.permissions @> array['enterprise.view','attendance.period.view']::text[]
      and worker.active and worker.employee_id=p.employee_id and target.status='active' and target.auth_user_id=p.employee_auth_user_id
      and member.id<>target.id and member.auth_user_id<>target.auth_user_id and merchant.user_id=p.actor_auth_user_id;
  if not found then return result_value;end if;
  select * into delegate_epoch from public.merchant_attendance_account_epochs x where x.merchant_id=p.merchant_id and x.employee_id=p.delegate_employee_id;
  select * into target_epoch from public.merchant_attendance_account_epochs x where x.merchant_id=p.merchant_id and x.employee_id=p.employee_id;
  if coalesce(delegate_epoch.paused,false) or coalesce(target_epoch.paused,false)
    or coalesce(delegate_epoch.generation,0)<>p.delegate_generation or coalesce(target_epoch.generation,0)<>p.employee_generation then return result_value;end if;
  foreach action_name in array array['view','send','respond','seal','reopen'] loop
    if p.actions ? action_name and ('attendance.period.'||action_name)=any(permission_set) then result_value:=result_value||to_jsonb(action_name);end if;
  end loop;
  return result_value;
end;
$$;

create or replace function public.faolla_attendance_period_delegation_grant_v1(p public.merchant_attendance_period_delegations,p_actions jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare revoked public.merchant_attendance_period_delegation_revocations%rowtype;stamp_format text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  select * into revoked from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id;
  return jsonb_build_object('grantId',p.grant_id,'revision',case when revoked.operation_id is null then 1 else 2 end,'status',case when revoked.operation_id is null then 'granted' else 'revoked' end,
    'delegate',jsonb_build_object('employeeId',p.delegate_employee_id,'authUserId',p.delegate_auth_user_id,'name',p.delegate_name),
    'worker',jsonb_build_object('workerId',p.worker_id,'employeeId',p.employee_id,'authUserId',p.employee_auth_user_id,'name',p.worker_name,'workerNo',p.worker_no),
    'fromDate',to_char(p.from_date,'YYYY-MM-DD'),'throughDate',to_char(p.through_date,'YYYY-MM-DD'),'actions',p.actions,'includeExisting',p.include_existing,
    'validFrom',to_char(p.valid_from at time zone 'UTC',stamp_format),'validUntil',to_char(p.valid_until at time zone 'UTC',stamp_format),
    'grantedBy',p.actor_auth_user_id,'grantedAt',to_char(p.recorded_at at time zone 'UTC',stamp_format),'reason',p.reason,
    'revocation',case when revoked.operation_id is null then null else jsonb_build_object('operationId',revoked.operation_id,'actorId',revoked.actor_auth_user_id,
      'reason',revoked.reason,'recordedAt',to_char(revoked.recorded_at at time zone 'UTC',stamp_format)) end,
    'usableActions',case when revoked.operation_id is null then p_actions else '[]'::jsonb end);
end;
$$;

--Private fresh-action gate. Existing IDs bind the saved whole frame; a missing
--period ID is accepted only for view/send, never for a lifecycle action.
create or replace function public.faolla_attendance_period_delegation_guard_v1(
  p_site text,p_grant uuid,p_auth uuid,p_action text,p_worker uuid,p_from date,p_through date,p_period uuid default null,p_allow_write boolean default false)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare merchant public.merchants%rowtype;settings public.merchant_attendance_settings%rowtype;
  saved_grant public.merchant_attendance_period_delegations%rowtype;period_head public.merchant_attendance_period_closures%rowtype;
  member public.merchant_enterprise_employees%rowtype;role_value public.merchant_enterprise_roles%rowtype;
  authorized_stamp timestamptz;usable jsonb;
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or length(p_site)<>8 or p_grant is null or p_auth is null or p_worker is null
    or p_action is null or p_action not in('view','send','respond','seal','reopen') or p_from is null or p_through is null
    or not isfinite(p_from) or not isfinite(p_through) or p_from<date '2000-01-01' or p_through>date '2100-12-31'
    or p_through-p_from not between 0 and 30 or p_allow_write is distinct from true then raise exception 'attendance_access_denied';end if;
  select * into merchant from public.merchants x where x.id=p_site for share;
  select * into settings from public.merchant_attendance_settings x where x.merchant_id=p_site for update;
  if merchant.id is null or settings.merchant_id is null then raise exception 'attendance_access_denied';end if;
  if not settings.enabled then raise exception 'attendance_platform_paused';end if;
  select * into saved_grant from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and x.grant_id=p_grant;
  if saved_grant.grant_id is null or saved_grant.delegate_auth_user_id<>p_auth or saved_grant.worker_id<>p_worker
    or merchant.user_id is distinct from saved_grant.actor_auth_user_id or p_from<saved_grant.from_date or p_through>saved_grant.through_date then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_workers x where x.merchant_id=p_site and x.id=p_worker for update;
  perform 1 from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id in(saved_grant.delegate_employee_id,saved_grant.employee_id) order by x.id for share;
  select * into member from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=saved_grant.delegate_employee_id;
  select * into role_value from public.merchant_enterprise_roles x where x.merchant_id=p_site and x.id=member.role_id for share;
  authorized_stamp:=clock_timestamp();usable:=public.faolla_attendance_period_delegation_actions_v1(saved_grant,authorized_stamp);
  if not(usable ? 'view') or not(usable ? p_action) then raise exception 'attendance_access_denied';end if;
  if p_period is not null then select * into period_head from public.merchant_attendance_period_closures x where x.merchant_id=p_site and x.period_id=p_period;end if;
  if period_head.period_id is null then
    if p_action not in('view','send') then raise exception 'attendance_access_denied';end if;
  elsif period_head.worker_id<>p_worker or period_head.employee_id<>saved_grant.employee_id or period_head.employee_auth_user_id<>saved_grant.employee_auth_user_id
    or period_head.from_date<>p_from or period_head.through_date<>p_through
    or not saved_grant.include_existing and period_head.opened_at<saved_grant.recorded_at then raise exception 'attendance_access_denied';end if;
  return jsonb_build_object('protocol','period-delegation-authority-v1','siteId',p_site,'grantId',p_grant,'grantRevision',1,
    'actorEmployeeId',saved_grant.delegate_employee_id,'actorAuthUserId',p_auth,'workerId',p_worker,'employeeId',saved_grant.employee_id,'employeeAuthUserId',saved_grant.employee_auth_user_id,
    'delegateGeneration',saved_grant.delegate_generation,'employeeGeneration',saved_grant.employee_generation,'fromDate',to_char(p_from,'YYYY-MM-DD'),'throughDate',to_char(p_through,'YYYY-MM-DD'),
    'action',p_action,'includeExisting',saved_grant.include_existing,'grantedAt',to_char(saved_grant.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'authorizedAt',to_char(authorized_stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'periodId',p_period);
end;
$$;

create or replace function public.faolla_attendance_period_delegation_proof_v1(p public.merchant_attendance_period_delegation_operations)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare saved_grant public.merchant_attendance_period_delegations%rowtype;entry_value public.merchant_attendance_period_entries%rowtype;
  period_head public.merchant_attendance_period_closures%rowtype;expected_authority jsonb;
begin
  select * into saved_grant from public.merchant_attendance_period_delegations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id;
  select * into entry_value from public.merchant_attendance_period_entries x where x.merchant_id=p.merchant_id and x.operation_id=p.operation_id;
  select * into period_head from public.merchant_attendance_period_closures x where x.merchant_id=p.merchant_id and x.period_id=p.period_id;
  if p.operation_id is null or saved_grant.grant_id is null or entry_value.operation_id is null or period_head.period_id is null
    or p.actor_auth_user_id<>saved_grant.delegate_auth_user_id or p.actor_employee_id<>saved_grant.delegate_employee_id
    or p.worker_id<>saved_grant.worker_id or p.employee_id<>saved_grant.employee_id or p.employee_auth_user_id<>saved_grant.employee_auth_user_id
    or p.actor_employee_id=p.employee_id or p.actor_auth_user_id=p.employee_auth_user_id
    or p.action not in('send','respond','seal','reopen') or not(saved_grant.actions ? p.action) or not(saved_grant.actions ? 'view')
    or entry_value.period_id<>p.period_id or entry_value.revision<>p.period_revision or entry_value.version<>p.period_version
    or entry_value.actor_auth_user_id<>p.actor_auth_user_id or entry_value.action<>p.action or entry_value.recorded_at<>p.recorded_at
    or p.command is distinct from entry_value.command
    or public.faolla_attendance_period_closure_command_v2(entry_value.command) is distinct from true
    or period_head.worker_id<>p.worker_id or period_head.employee_id<>p.employee_id or period_head.employee_auth_user_id<>p.employee_auth_user_id
    or period_head.from_date<saved_grant.from_date or period_head.through_date>saved_grant.through_date
    or p.authorized_at<saved_grant.recorded_at or p.authorized_at<saved_grant.valid_from or p.authorized_at>=saved_grant.valid_until
    or p.recorded_at<p.authorized_at or not saved_grant.include_existing and period_head.opened_at<saved_grant.recorded_at
    or exists(select 1 from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id and x.recorded_at<=p.authorized_at)
    or exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p.merchant_id and x.grant_id=p.operation_id)
    or exists(select 1 from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=p.merchant_id and x.operation_id=p.operation_id) then return false;end if;
  expected_authority:=jsonb_build_object('protocol','period-delegation-authority-v1','siteId',p.merchant_id,'grantId',p.grant_id,'grantRevision',1,
    'actorEmployeeId',p.actor_employee_id,'actorAuthUserId',p.actor_auth_user_id,'workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,
    'delegateGeneration',saved_grant.delegate_generation,'employeeGeneration',saved_grant.employee_generation,
    'fromDate',to_char(period_head.from_date,'YYYY-MM-DD'),'throughDate',to_char(period_head.through_date,'YYYY-MM-DD'),'action',p.action,'includeExisting',saved_grant.include_existing,
    'grantedAt',to_char(saved_grant.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'authorizedAt',to_char(p.authorized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'periodId',p.period_id);
  return p.authority is not distinct from expected_authority;
end;
$$;
create or replace function public.faolla_attendance_period_delegation_authority_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if public.faolla_attendance_period_delegation_proof_v1(new) is distinct from true then raise exception 'attendance_period_delegation_invalid';end if;
  return new;
end;
$$;

create or replace function public.faolla_attendance_period_delegation_receipt_v1(p_site text,p_operation uuid,p_auth uuid,p_access text,p_employee uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare saved_grant public.merchant_attendance_period_delegations%rowtype;revoked public.merchant_attendance_period_delegation_revocations%rowtype;
  delegated public.merchant_attendance_period_delegation_operations%rowtype;actor_uuid uuid;receipt_value jsonb;matches integer;
begin
  if p_auth is null or p_access is null or p_access not in('owner','delegate') then raise exception 'attendance_access_denied';end if;
  select * into saved_grant from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and x.grant_id=p_operation;
  select * into revoked from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=p_site and x.operation_id=p_operation;
  select * into delegated from public.merchant_attendance_period_delegation_operations x where x.merchant_id=p_site and x.operation_id=p_operation;
  matches:=(saved_grant.grant_id is not null)::integer+(revoked.operation_id is not null)::integer+(delegated.operation_id is not null)::integer;
  if matches>1 then raise exception 'attendance_period_delegation_invalid';end if;
  if matches=0 then return null;end if;
  if (p_access='delegate') is distinct from (delegated.operation_id is not null) then raise exception 'attendance_access_denied';end if;
  if saved_grant.grant_id is not null then
    actor_uuid:=saved_grant.actor_auth_user_id;
    receipt_value:=jsonb_build_object('operationId',p_operation,'action','grant','grantId',saved_grant.grant_id,'grantRevision',1,'periodId',null,'periodRevision',null,
      'actorId',actor_uuid,'recordedAt',to_char(saved_grant.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',saved_grant.command_fingerprint);
  elsif revoked.operation_id is not null then
    actor_uuid:=revoked.actor_auth_user_id;
    receipt_value:=jsonb_build_object('operationId',p_operation,'action','revoke','grantId',revoked.grant_id,'grantRevision',2,'periodId',null,'periodRevision',null,
      'actorId',actor_uuid,'recordedAt',to_char(revoked.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',revoked.command_fingerprint);
  else
    if delegated.actor_employee_id is distinct from p_employee or public.faolla_attendance_period_delegation_proof_v1(delegated) is distinct from true then raise exception 'attendance_access_denied';end if;
    actor_uuid:=delegated.actor_auth_user_id;
    receipt_value:=jsonb_build_object('operationId',p_operation,'action',delegated.action,'grantId',delegated.grant_id,'grantRevision',1,'periodId',delegated.period_id,'periodRevision',delegated.period_revision,
      'actorId',actor_uuid,'recordedAt',to_char(delegated.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',delegated.command_fingerprint);
  end if;
  if actor_uuid is distinct from p_auth then raise exception 'attendance_access_denied';end if;
  return receipt_value;
end;
$$;

create or replace function public.faolla_attendance_period_delegation_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;catalog_name text;key_name text;action_name text;op uuid;target_grant uuid;after_id uuid;next_id uuid;
  stamp timestamptz;seen integer:=0;employee_uuid uuid;can_write boolean:=false;expected_hash text;
  merchant public.merchants%rowtype;settings public.merchant_attendance_settings%rowtype;worker public.merchant_attendance_workers%rowtype;
  member public.merchant_enterprise_employees%rowtype;target public.merchant_enterprise_employees%rowtype;role_value public.merchant_enterprise_roles%rowtype;
  delegate_epoch public.merchant_attendance_account_epochs%rowtype;target_epoch public.merchant_attendance_account_epochs%rowtype;
  saved_grant public.merchant_attendance_period_delegations%rowtype;revoked public.merchant_attendance_period_delegation_revocations%rowtype;
  candidate record;grants_value jsonb:='[]';catalog_value jsonb:='[]';actions_value jsonb;detail_value jsonb;receipt_value jsonb;result_value jsonb;
begin
  if p_auth_user_id is null or p_allow_write is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','catalog','grantId','afterId','operationId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$' or length(p_query->>'siteId')<>8
    or coalesce(p_query->>'access','') not in('owner','delegate') or coalesce(p_query->>'mode','') not in('list','catalog','detail','recover')
    or octet_length(convert_to(p_query::text,'UTF8'))>8192 then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';catalog_name:=p_query->>'catalog';
  foreach key_name in array array['grantId','afterId','operationId'] loop
    if p_query->key_name is distinct from 'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->key_name,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'catalog' is distinct from 'null'::jsonb and (jsonb_typeof(p_query->'catalog') is distinct from 'string' or coalesce(catalog_name,'') not in('delegates','workers')) then raise exception 'attendance_invalid_request';end if;
  target_grant:=(p_query->>'grantId')::uuid;after_id:=(p_query->>'afterId')::uuid;op:=(p_query->>'operationId')::uuid;
  if access_name='delegate' and mode_name='catalog' or (mode_name='catalog') is distinct from (catalog_name is not null)
    or (mode_name='detail') is distinct from (target_grant is not null) or (mode_name='recover') is distinct from (op is not null)
    or mode_name not in('list','catalog') and after_id is not null then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_period_delegation_command_v1(p_command,access_name) is distinct from true or op is not null or after_id is not null then raise exception 'attendance_invalid_request';end if;
    action_name:=p_command->>'action';op:=(p_command->>'operationId')::uuid;
    if action_name='grant' and mode_name<>'list' or action_name='revoke' and (mode_name<>'detail' or p_command->>'grantId' is distinct from target_grant::text) then raise exception 'attendance_invalid_request';end if;
  end if;
  --Disabled submissions are not replayed: only explicit GET recovery and owner
  --revocation are safe. Current-owner metadata never reads any period source.
  if p_allow_write is distinct from true and (p_command is null and (mode_name='recover' or access_name='owner' and mode_name in('list','detail'))
    or p_command is not null and access_name='owner' and action_name='revoke') is distinct from true then raise exception 'attendance_period_delegation_disabled';end if;
  select * into merchant from public.merchants x where x.id=site for share;
  if merchant.id is null or access_name='owner' and mode_name<>'recover' and merchant.user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
  if access_name='delegate' then
    select * into member from public.merchant_enterprise_employees x where x.merchant_id=site and x.auth_user_id=p_auth_user_id;
    if member.id is null then raise exception 'attendance_access_denied';end if;employee_uuid:=member.id;
  end if;
  if p_command is null then select * into settings from public.merchant_attendance_settings x where x.merchant_id=site for share;
  else select * into settings from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
  if settings.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if op is not null then
    if access_name='delegate' then
      select * into member from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=employee_uuid for share;
      if member.id is null or member.auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
    end if;
    receipt_value:=public.faolla_attendance_period_delegation_receipt_v1(site,op,p_auth_user_id,access_name,employee_uuid);
    if p_command is not null then
      if receipt_value is not null then
        expected_hash:=public.faolla_attendance_period_delegation_hash_v1(p_query,p_command);
        if receipt_value->>'commandFingerprint' is distinct from expected_hash then raise exception 'attendance_operation_conflict';end if;
        if action_name='grant' then
          select * into saved_grant from public.merchant_attendance_period_delegations x where x.merchant_id=site and x.grant_id=op;
          if saved_grant.command is distinct from p_command or saved_grant.query is distinct from p_query then raise exception 'attendance_operation_conflict';end if;
        else
          select * into revoked from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=site and x.operation_id=op;
          if revoked.command is distinct from p_command or revoked.query is distinct from p_query then raise exception 'attendance_operation_conflict';end if;
        end if;
      elsif exists(select 1 from public.merchant_attendance_period_entries x where x.merchant_id=site and x.operation_id=op) then raise exception 'attendance_operation_conflict';end if;
    end if;
  end if;
  if mode_name<>'recover' and receipt_value is null then
    can_write:=p_allow_write and settings.enabled;
    if access_name='delegate' then
      perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=employee_uuid for share;
      select * into member from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=employee_uuid;
      select * into role_value from public.merchant_enterprise_roles x where x.merchant_id=site and x.id=member.role_id for share;
      if member.auth_user_id is distinct from p_auth_user_id or member.status<>'active' or role_value.id is null or role_value.status<>'active'
        or public.faolla_valid_merchant_enterprise_permissions_v1(role_value.permissions) is distinct from true
        or not(role_value.permissions @> array['enterprise.view','attendance.period.view']::text[]) then raise exception 'attendance_access_denied';end if;
    end if;
    if p_command is not null then
      if action_name='grant' then
        if not settings.enabled then raise exception 'attendance_platform_paused';end if;
        select * into worker from public.merchant_attendance_workers x where x.merchant_id=site and x.id=(p_command->>'workerId')::uuid for update;
        perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id in((p_command->>'delegateEmployeeId')::uuid,(p_command->>'employeeId')::uuid) order by x.id for share;
        select * into member from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=(p_command->>'delegateEmployeeId')::uuid;
        select * into target from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=(p_command->>'employeeId')::uuid;
        select * into role_value from public.merchant_enterprise_roles x where x.merchant_id=site and x.id=member.role_id for share;
        if worker.id is null or not worker.active or target.id is null or worker.employee_id is distinct from target.id or target.status<>'active'
          or target.auth_user_id is distinct from (p_command->>'employeeAuthUserId')::uuid
          or member.id is null or member.status<>'active' or member.auth_user_id is distinct from (p_command->>'delegateAuthUserId')::uuid
          or member.id=target.id or member.auth_user_id=target.auth_user_id or role_value.id is null or role_value.status<>'active'
          or public.faolla_valid_merchant_enterprise_permissions_v1(role_value.permissions) is distinct from true
          or not(role_value.permissions @> array['enterprise.view','attendance.period.view']::text[]) then raise exception 'attendance_access_denied';end if;
        for key_name in select value from jsonb_array_elements_text(p_command->'actions') loop
          if not(('attendance.period.'||key_name)=any(role_value.permissions)) then raise exception 'attendance_access_denied';end if;
        end loop;
        select * into delegate_epoch from public.merchant_attendance_account_epochs x where x.merchant_id=site and x.employee_id=member.id;
        select * into target_epoch from public.merchant_attendance_account_epochs x where x.merchant_id=site and x.employee_id=target.id;
        if coalesce(delegate_epoch.paused,false) or coalesce(target_epoch.paused,false) then raise exception 'attendance_account_suspended';end if;
        stamp:=clock_timestamp();if (p_command->>'validUntil')::timestamptz<=stamp then raise exception 'attendance_period_delegation_changed';end if;
        insert into public.merchant_attendance_period_delegations(merchant_id,grant_id,delegate_employee_id,delegate_auth_user_id,delegate_name,
          worker_id,employee_id,employee_auth_user_id,worker_name,worker_no,from_date,through_date,actions,include_existing,delegate_generation,employee_generation,
          valid_from,valid_until,actor_auth_user_id,reason,query,command,command_fingerprint,recorded_at)
        values(site,op,member.id,member.auth_user_id,member.display_name,worker.id,target.id,target.auth_user_id,worker.display_name,worker.worker_no,
          (p_command->>'fromDate')::date,(p_command->>'throughDate')::date,p_command->'actions',(p_command->>'includeExisting')::boolean,
          coalesce(delegate_epoch.generation,0),coalesce(target_epoch.generation,0),(p_command->>'validFrom')::timestamptz,(p_command->>'validUntil')::timestamptz,
          p_auth_user_id,p_command->>'reason',p_query,p_command,public.faolla_attendance_period_delegation_hash_v1(p_query,p_command),stamp);
      else
        select * into saved_grant from public.merchant_attendance_period_delegations x where x.merchant_id=site and x.grant_id=target_grant;
        if saved_grant.grant_id is null then raise exception 'attendance_period_delegation_not_found';end if;
        perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.id=saved_grant.worker_id for update;
        if exists(select 1 from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=site and x.grant_id=target_grant) then raise exception 'attendance_version_conflict';end if;
        insert into public.merchant_attendance_period_delegation_revocations(merchant_id,operation_id,grant_id,actor_auth_user_id,reason,query,command,command_fingerprint,recorded_at)
          values(site,op,target_grant,p_auth_user_id,p_command->>'reason',p_query,p_command,public.faolla_attendance_period_delegation_hash_v1(p_query,p_command),clock_timestamp());
      end if;
      receipt_value:=public.faolla_attendance_period_delegation_receipt_v1(site,op,p_auth_user_id,access_name,employee_uuid);
    elsif mode_name='list' then
      stamp:=clock_timestamp();
      --Page the immutable identity index BEFORE any current-authority filter.
      --Expired/revoked metadata has [], never source access, and cannot turn
      --an arbitrarily long expired prefix into an unbounded normal request.
      for saved_grant in select x.* from public.merchant_attendance_period_delegations x
        where x.merchant_id=site and (after_id is null or x.grant_id>after_id)
          and (access_name='owner' or x.delegate_employee_id=employee_uuid and x.delegate_auth_user_id=p_auth_user_id)
        order by x.grant_id limit 26 loop
        seen:=seen+1;exit when seen=26;
        actions_value:=case when can_write then public.faolla_attendance_period_delegation_actions_v1(saved_grant,stamp) else '[]'::jsonb end;
        grants_value:=grants_value||jsonb_build_array(public.faolla_attendance_period_delegation_grant_v1(saved_grant,actions_value));next_id:=saved_grant.grant_id;
      end loop;
    elsif mode_name='detail' then
      select * into saved_grant from public.merchant_attendance_period_delegations x where x.merchant_id=site and x.grant_id=target_grant;
      if saved_grant.grant_id is null then raise exception 'attendance_period_delegation_not_found';end if;
      if access_name='delegate' and (saved_grant.delegate_employee_id<>employee_uuid or saved_grant.delegate_auth_user_id<>p_auth_user_id) then raise exception 'attendance_access_denied';end if;
      detail_value:=public.faolla_attendance_period_delegation_grant_v1(saved_grant,case when can_write then public.faolla_attendance_period_delegation_actions_v1(saved_grant,clock_timestamp()) else '[]'::jsonb end);
    elsif mode_name='catalog' then
      for candidate in select directory.* from (
        select e.id,e.display_name name,e.id employee_id,e.auth_user_id member_auth,null::text worker_no,
          (select jsonb_agg(to_jsonb(a.action) order by a.ordinal) from (values('view',1),('send',2),('respond',3),('seal',4),('reopen',5)) a(action,ordinal)
            where ('attendance.period.'||a.action)=any(r.permissions)) allowed_actions
        from public.merchant_enterprise_employees e join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
        where catalog_name='delegates' and e.merchant_id=site and e.status='active' and e.auth_user_id is not null and r.status='active'
          and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is true and r.permissions @> array['enterprise.view','attendance.period.view']::text[]
          and (after_id is null or e.id>after_id)
        union all select w.id,w.display_name,e.id,e.auth_user_id,w.worker_no,'[]'::jsonb
        from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
        where catalog_name='workers' and w.merchant_id=site and w.active and e.status='active' and e.auth_user_id is not null and (after_id is null or w.id>after_id)
      ) directory order by directory.id limit 26 loop
        seen:=seen+1;exit when seen=26;
        catalog_value:=catalog_value||jsonb_build_array(jsonb_build_object('id',candidate.id,'name',candidate.name,'employeeId',candidate.employee_id,
          'employeeAuthUserId',candidate.member_auth,'workerNo',candidate.worker_no,'actions',candidate.allowed_actions));next_id:=candidate.id;
      end loop;
    end if;
  end if;
  if mode_name='recover' or p_command is not null then can_write:=false;end if;
  result_value:=jsonb_build_object('protocol','period-delegation-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,'employeeId',employee_uuid,'mode',mode_name,
    'canWrite',can_write,'grants',grants_value,'catalogItems',catalog_value,'nextAfterId',case when seen=26 then next_id else null end,
    'detail',detail_value,'receipt',receipt_value,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  if octet_length(convert_to(result_value::text,'UTF8'))>131072 then raise exception 'attendance_period_delegation_too_large';end if;
  return result_value;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end;
$$;

--The two old definitions are retained privately, byte-for-byte (line endings
--normalized only). Installation/re-entry refuses an unexpected live body.
--Only the five catalog rows and the two new-grant early-exit predicates differ.
do $period_delegation_forward_guard$
declare installed boolean;expected_permissions text:=$permissions_original$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('attendance.records.view', array['enterprise.view']::text[]),
      ('attendance.self.export', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.reports.export', array['enterprise.view', 'attendance.records.view']::text[]),
      ('attendance.self.view', array['enterprise.view']::text[]),
      ('attendance.self.clock', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.request', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.publish', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.cancel', array['enterprise.view', 'attendance.self.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$permissions_original$;
  expected_capture text:=$capture_original$
declare e public.merchant_enterprise_employees%rowtype;w public.merchant_attendance_workers%rowtype;
  ep public.merchant_attendance_account_epochs%rowtype;ev public.merchant_attendance_events%rowtype;c public.merchant_attendance_pin_credentials%rowtype;
  sid uuid;gen bigint;stamp timestamptz;pin_before integer;pin_after integer;
begin
  select * into ep from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  if ep.paused then return ep.suspension_id;end if;
  if ep.employee_id is null and not coalesce(p_enabled,false)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  if not exists(select 1 from public.merchant_attendance_settings x where x.merchant_id=p_site) then return null;end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee;
  if e.id is null or e.status<>'disabled' or p_actor is null then raise exception 'attendance_account_suspension_invalid';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  --No worker is manufactured for a delegate. Both legacy delegate indexes start
  --with merchant/employee; target grants already require a linked worker.
  if ep.employee_id is null and w.id is null and not exists(select 1 from public.merchant_attendance_missing_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_application_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  gen:=coalesce(ep.generation,0)+1;if gen>9007199254740990 then raise exception 'attendance_account_suspension_invalid';end if;
  sid:=gen_random_uuid();stamp:=clock_timestamp();
  if w.id is not null then
    select * into ev from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=w.id order by x.sequence desc limit 1;
    select * into c from public.merchant_attendance_pin_credentials x where x.merchant_id=p_site and x.worker_id=w.id for update;
    if c.worker_id is not null then
      if c.revision>=2147483647 then raise exception 'attendance_account_suspension_invalid';end if;
      pin_before:=c.revision;pin_after:=c.revision+1;
      --Never route urgent revocation through the PIN setter rate/time gates.
      update public.merchant_attendance_pin_credentials set revision=pin_after,enabled=false,salt=null,verifier=null,changed_at=stamp,created_by=p_actor where merchant_id=p_site and worker_id=w.id;
    end if;
    if w.active then
      if w.version>=9007199254740991 then raise exception 'attendance_account_suspension_invalid';end if;
      update public.merchant_attendance_workers set active=false,version=version+1,updated_at=stamp where merchant_id=p_site and id=w.id;
    end if;
  end if;
  insert into public.merchant_attendance_account_suspensions(merchant_id,suspension_id,employee_id,employee_auth_user_id,employee_name,generation,
    worker_id,worker_name,was_active,worker_version,employee_version,original_event_id,original_sequence,original_action,original_actor_employee_id,
    actor_auth_user_id,actor_employee_id,pin_revision_before,pin_revision_after,pin_invalidated,delegations_invalidated,recorded_at)
  values(p_site,sid,e.id,e.auth_user_id,e.display_name,gen,w.id,w.display_name,w.active,w.version,e.version,ev.id,ev.sequence,ev.action,ev.actor_employee_id,
    p_actor,p_actor_employee,pin_before,pin_after,c.worker_id is not null,true,stamp);
  insert into public.merchant_attendance_account_epochs(merchant_id,employee_id,generation,suspension_id,paused,updated_at)
    values(p_site,p_employee,gen,sid,true,stamp) on conflict(merchant_id,employee_id)
    do update set generation=excluded.generation,suspension_id=excluded.suspension_id,paused=true,updated_at=excluded.updated_at;
  return sid;
end;
$capture_original$;
  actual_permissions text;actual_capture text;removed_permissions text:=$period_permission_rows$      ('attendance.period.view', array['enterprise.view']::text[]),
      ('attendance.period.send', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.respond', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.seal', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.reopen', array['enterprise.view', 'attendance.period.view']::text[]),
$period_permission_rows$;
  removed_capture text:=$period_capture_predicate$
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))$period_capture_predicate$;
  object_name text;function_row record;expected_source text;
begin
  select exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations') into installed;
  select replace(prosrc,E'\r\n',E'\n') into actual_permissions from pg_proc where oid='public.faolla_valid_merchant_enterprise_permissions_v1(text[])'::regprocedure;
  select replace(prosrc,E'\r\n',E'\n') into actual_capture from pg_proc where oid='public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'::regprocedure;
  if installed then
    if (length(actual_permissions)-length(replace(actual_permissions,removed_permissions,'')))/length(removed_permissions)<>1
      or (length(actual_capture)-length(replace(actual_capture,removed_capture,'')))/length(removed_capture)<>2 then
      raise exception 'merchant_attendance_period_delegation_forward_conflict';end if;
    actual_permissions:=replace(actual_permissions,removed_permissions,'');
    actual_capture:=replace(actual_capture,removed_capture,'');
  end if;
  if actual_permissions is distinct from expected_permissions or actual_capture is distinct from expected_capture then
    raise exception 'merchant_attendance_period_delegation_forward_conflict';end if;
  foreach object_name in array array['faolla_valid_merchant_enterprise_permissions_pre_period_v1','faolla_attendance_account_capture_pre_period_v1'] loop
    select * into function_row from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=object_name;
    if installed<>(function_row.oid is not null) then raise exception 'merchant_attendance_period_delegation_forward_conflict';end if;
    if installed then
      expected_source:=case when object_name='faolla_valid_merchant_enterprise_permissions_pre_period_v1' then expected_permissions else expected_capture end;
      if replace(function_row.prosrc,E'\r\n',E'\n') is distinct from expected_source
        or function_row.proowner<>(select oid from pg_roles where rolname=current_user) or function_row.prosecdef or function_row.proretset
        or exists(select 1 from aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) a where a.grantee<>function_row.proowner) then
        raise exception 'merchant_attendance_period_delegation_forward_conflict';end if;
    end if;
  end loop;
end;
$period_delegation_forward_guard$;

create or replace function public.faolla_valid_merchant_enterprise_permissions_pre_period_v1(
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('attendance.records.view', array['enterprise.view']::text[]),
      ('attendance.self.export', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.reports.export', array['enterprise.view', 'attendance.records.view']::text[]),
      ('attendance.self.view', array['enterprise.view']::text[]),
      ('attendance.self.clock', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.request', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.publish', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.cancel', array['enterprise.view', 'attendance.self.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$$;

create or replace function public.faolla_attendance_account_capture_pre_period_v1(p_site text,p_employee uuid,p_actor uuid,p_actor_employee uuid,p_enabled boolean)
returns uuid language plpgsql set search_path=pg_catalog as $$
declare e public.merchant_enterprise_employees%rowtype;w public.merchant_attendance_workers%rowtype;
  ep public.merchant_attendance_account_epochs%rowtype;ev public.merchant_attendance_events%rowtype;c public.merchant_attendance_pin_credentials%rowtype;
  sid uuid;gen bigint;stamp timestamptz;pin_before integer;pin_after integer;
begin
  select * into ep from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  if ep.paused then return ep.suspension_id;end if;
  if ep.employee_id is null and not coalesce(p_enabled,false)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  if not exists(select 1 from public.merchant_attendance_settings x where x.merchant_id=p_site) then return null;end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee;
  if e.id is null or e.status<>'disabled' or p_actor is null then raise exception 'attendance_account_suspension_invalid';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  --No worker is manufactured for a delegate. Both legacy delegate indexes start
  --with merchant/employee; target grants already require a linked worker.
  if ep.employee_id is null and w.id is null and not exists(select 1 from public.merchant_attendance_missing_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_application_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  gen:=coalesce(ep.generation,0)+1;if gen>9007199254740990 then raise exception 'attendance_account_suspension_invalid';end if;
  sid:=gen_random_uuid();stamp:=clock_timestamp();
  if w.id is not null then
    select * into ev from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=w.id order by x.sequence desc limit 1;
    select * into c from public.merchant_attendance_pin_credentials x where x.merchant_id=p_site and x.worker_id=w.id for update;
    if c.worker_id is not null then
      if c.revision>=2147483647 then raise exception 'attendance_account_suspension_invalid';end if;
      pin_before:=c.revision;pin_after:=c.revision+1;
      --Never route urgent revocation through the PIN setter rate/time gates.
      update public.merchant_attendance_pin_credentials set revision=pin_after,enabled=false,salt=null,verifier=null,changed_at=stamp,created_by=p_actor where merchant_id=p_site and worker_id=w.id;
    end if;
    if w.active then
      if w.version>=9007199254740991 then raise exception 'attendance_account_suspension_invalid';end if;
      update public.merchant_attendance_workers set active=false,version=version+1,updated_at=stamp where merchant_id=p_site and id=w.id;
    end if;
  end if;
  insert into public.merchant_attendance_account_suspensions(merchant_id,suspension_id,employee_id,employee_auth_user_id,employee_name,generation,
    worker_id,worker_name,was_active,worker_version,employee_version,original_event_id,original_sequence,original_action,original_actor_employee_id,
    actor_auth_user_id,actor_employee_id,pin_revision_before,pin_revision_after,pin_invalidated,delegations_invalidated,recorded_at)
  values(p_site,sid,e.id,e.auth_user_id,e.display_name,gen,w.id,w.display_name,w.active,w.version,e.version,ev.id,ev.sequence,ev.action,ev.actor_employee_id,
    p_actor,p_actor_employee,pin_before,pin_after,c.worker_id is not null,true,stamp);
  insert into public.merchant_attendance_account_epochs(merchant_id,employee_id,generation,suspension_id,paused,updated_at)
    values(p_site,p_employee,gen,sid,true,stamp) on conflict(merchant_id,employee_id)
    do update set generation=excluded.generation,suspension_id=excluded.suspension_id,paused=true,updated_at=excluded.updated_at;
  return sid;
end;
$$;

create or replace function public.faolla_valid_merchant_enterprise_permissions_v1(
  p_permissions text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('attendance.records.view', array['enterprise.view']::text[]),
      ('attendance.self.export', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.reports.export', array['enterprise.view', 'attendance.records.view']::text[]),
      ('attendance.self.view', array['enterprise.view']::text[]),
      ('attendance.self.clock', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.request', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.publish', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.cancel', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.period.view', array['enterprise.view']::text[]),
      ('attendance.period.send', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.respond', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.seal', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.reopen', array['enterprise.view', 'attendance.period.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$$;

create or replace function public.faolla_attendance_account_capture_v1(p_site text,p_employee uuid,p_actor uuid,p_actor_employee uuid,p_enabled boolean)
returns uuid language plpgsql set search_path=pg_catalog as $$
declare e public.merchant_enterprise_employees%rowtype;w public.merchant_attendance_workers%rowtype;
  ep public.merchant_attendance_account_epochs%rowtype;ev public.merchant_attendance_events%rowtype;c public.merchant_attendance_pin_credentials%rowtype;
  sid uuid;gen bigint;stamp timestamptz;pin_before integer;pin_after integer;
begin
  select * into ep from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  if ep.paused then return ep.suspension_id;end if;
  if ep.employee_id is null and not coalesce(p_enabled,false)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  if not exists(select 1 from public.merchant_attendance_settings x where x.merchant_id=p_site) then return null;end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee;
  if e.id is null or e.status<>'disabled' or p_actor is null then raise exception 'attendance_account_suspension_invalid';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  --No worker is manufactured for a delegate. Both legacy delegate indexes start
  --with merchant/employee; target grants already require a linked worker.
  if ep.employee_id is null and w.id is null and not exists(select 1 from public.merchant_attendance_missing_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_application_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  gen:=coalesce(ep.generation,0)+1;if gen>9007199254740990 then raise exception 'attendance_account_suspension_invalid';end if;
  sid:=gen_random_uuid();stamp:=clock_timestamp();
  if w.id is not null then
    select * into ev from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=w.id order by x.sequence desc limit 1;
    select * into c from public.merchant_attendance_pin_credentials x where x.merchant_id=p_site and x.worker_id=w.id for update;
    if c.worker_id is not null then
      if c.revision>=2147483647 then raise exception 'attendance_account_suspension_invalid';end if;
      pin_before:=c.revision;pin_after:=c.revision+1;
      --Never route urgent revocation through the PIN setter rate/time gates.
      update public.merchant_attendance_pin_credentials set revision=pin_after,enabled=false,salt=null,verifier=null,changed_at=stamp,created_by=p_actor where merchant_id=p_site and worker_id=w.id;
    end if;
    if w.active then
      if w.version>=9007199254740991 then raise exception 'attendance_account_suspension_invalid';end if;
      update public.merchant_attendance_workers set active=false,version=version+1,updated_at=stamp where merchant_id=p_site and id=w.id;
    end if;
  end if;
  insert into public.merchant_attendance_account_suspensions(merchant_id,suspension_id,employee_id,employee_auth_user_id,employee_name,generation,
    worker_id,worker_name,was_active,worker_version,employee_version,original_event_id,original_sequence,original_action,original_actor_employee_id,
    actor_auth_user_id,actor_employee_id,pin_revision_before,pin_revision_after,pin_invalidated,delegations_invalidated,recorded_at)
  values(p_site,sid,e.id,e.auth_user_id,e.display_name,gen,w.id,w.display_name,w.active,w.version,e.version,ev.id,ev.sequence,ev.action,ev.actor_employee_id,
    p_actor,p_actor_employee,pin_before,pin_after,c.worker_id is not null,true,stamp);
  insert into public.merchant_attendance_account_epochs(merchant_id,employee_id,generation,suspension_id,paused,updated_at)
    values(p_site,p_employee,gen,sid,true,stamp) on conflict(merchant_id,employee_id)
    do update set generation=excluded.generation,suspension_id=excluded.suspension_id,paused=true,updated_at=excluded.updated_at;
  return sid;
end;
$$;

-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_period_delegations'::regclass,
      'public.merchant_attendance_period_delegation_revocations'::regclass,
      'public.merchant_attendance_period_delegation_operations'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $period_delegation_security$
declare object_name text;relation_id regclass;
begin
  foreach object_name in array array['merchant_attendance_period_delegations','merchant_attendance_period_delegation_revocations','merchant_attendance_period_delegation_operations'] loop
    relation_id:=to_regclass('public.'||object_name);
    if exists(select 1 from pg_policy where polrelid=relation_id) then raise exception 'merchant_attendance_period_delegation_installation_conflict';end if;
    execute format('alter table %s enable row level security',relation_id);
    execute format('revoke all on %s from public,anon,authenticated,service_role',relation_id);
    if not exists(select 1 from pg_trigger where tgrelid=relation_id and tgname='attendance_period_delegation_immutable') then
      execute format('create trigger attendance_period_delegation_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',relation_id);end if;
    if not exists(select 1 from pg_trigger where tgrelid=relation_id and tgname='attendance_period_delegation_no_truncate') then
      execute format('create trigger attendance_period_delegation_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',relation_id);end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_period_delegation_operations'::regclass and tgname='attendance_period_delegation_authority') then
    create trigger attendance_period_delegation_authority after insert on public.merchant_attendance_period_delegation_operations
      for each row execute function public.faolla_attendance_period_delegation_authority_v1();end if;
end;
$period_delegation_security$;
revoke all on function public.faolla_attendance_period_delegation_command_v1(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegation_hash_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegation_actions_v1(public.merchant_attendance_period_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegation_grant_v1(public.merchant_attendance_period_delegations,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegation_guard_v1(text,uuid,uuid,text,uuid,date,date,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegation_proof_v1(public.merchant_attendance_period_delegation_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegation_authority_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegation_receipt_v1(text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegation_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_valid_merchant_enterprise_permissions_pre_period_v1(text[]) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_capture_pre_period_v1(text,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_delegation_v1(jsonb,uuid,jsonb,boolean) to service_role;
--The two original function OIDs retain their original ACLs. No stored role row
--is modified, no existing grant is manufactured and no source is collected.
insert into public.faolla_schema_migrations(version,name) values(202610080185,'merchant_attendance_period_delegations') on conflict(version) do nothing;

do $period_delegation_postconditions$
declare object_name text;relation_id regclass;function_id regprocedure;role_name text;index_item record;
begin
  foreach object_name in array array['merchant_attendance_period_delegations','merchant_attendance_period_delegation_revocations','merchant_attendance_period_delegation_operations'] loop
    relation_id:=to_regclass('public.'||object_name);
    if relation_id is null or not(select relrowsecurity from pg_class where oid=relation_id)
      or exists(select 1 from pg_policy where polrelid=relation_id)
      or not exists(select 1 from pg_trigger where tgrelid=relation_id and tgname='attendance_period_delegation_immutable'
        and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and tgtype=27 and tgenabled='O')
      or not exists(select 1 from pg_trigger where tgrelid=relation_id and tgname='attendance_period_delegation_no_truncate'
        and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and tgtype=34 and tgenabled='O') then
      raise exception 'merchant_attendance_period_delegation_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=relation_id and (pg_has_role(role_name,c.relowner,'USAGE')
        or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          where case when a.grantee=0 then true else pg_has_role(role_name,a.grantee,'USAGE') end)))
        or exists(select 1 from pg_attribute attr cross join lateral aclexplode(attr.attacl) a where attr.attrelid=relation_id
          and case when a.grantee=0 then true else pg_has_role(role_name,a.grantee,'USAGE') end) then
        raise exception 'merchant_attendance_period_delegation_acl_failed';end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_period_delegation_operations'::regclass
    and tgname='attendance_period_delegation_authority' and tgfoid='public.faolla_attendance_period_delegation_authority_v1()'::regprocedure and tgtype=5 and tgenabled='O') then
    raise exception 'merchant_attendance_period_delegation_postcondition_failed';end if;
  for index_item in select * from (values('attendance_period_delegation_delegate_idx',array['merchant_id','delegate_employee_id','grant_id']),
    ('attendance_period_delegation_target_idx',array['merchant_id','employee_id','grant_id'])) expected(index_name,column_names) loop
    if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
      where c.oid=to_regclass('public.'||index_item.index_name) and i.indrelid='public.merchant_attendance_period_delegations'::regclass
        and i.indisvalid and i.indisready and not i.indisunique and i.indnkeyatts=3 and i.indnatts=3 and i.indexprs is null and i.indpred is null and am.amname='btree'
        and (select array_agg(a.attname::text order by k.ordinal) from unnest(i.indkey) with ordinality k(attnum,ordinal)
          join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum)=index_item.column_names) then
      raise exception 'merchant_attendance_period_delegation_index_conflict';end if;
  end loop;
  foreach object_name in array array['public.faolla_attendance_period_delegation_command_v1(jsonb,text)','public.faolla_attendance_period_delegation_hash_v1(jsonb,jsonb)',
    'public.faolla_attendance_period_delegation_actions_v1(public.merchant_attendance_period_delegations,timestamptz)',
    'public.faolla_attendance_period_delegation_grant_v1(public.merchant_attendance_period_delegations,jsonb)',
    'public.faolla_attendance_period_delegation_guard_v1(text,uuid,uuid,text,uuid,date,date,uuid,boolean)',
    'public.faolla_attendance_period_delegation_proof_v1(public.merchant_attendance_period_delegation_operations)',
    'public.faolla_attendance_period_delegation_authority_v1()','public.faolla_attendance_period_delegation_receipt_v1(text,uuid,uuid,text,uuid)',
    'public.faolla_valid_merchant_enterprise_permissions_pre_period_v1(text[])','public.faolla_attendance_account_capture_pre_period_v1(text,uuid,uuid,uuid,boolean)',
    'public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'] loop
    function_id:=to_regprocedure(object_name);if function_id is null then raise exception 'merchant_attendance_period_delegation_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,function_id,'EXECUTE') then raise exception 'merchant_attendance_period_delegation_acl_failed';end if;
    end loop;
  end loop;
  function_id:='public.faolla_attendance_period_delegation_v1(jsonb,uuid,jsonb,boolean)'::regprocedure;
  if not has_function_privilege('service_role',function_id,'EXECUTE') or has_function_privilege('anon',function_id,'EXECUTE') or has_function_privilege('authenticated',function_id,'EXECUTE') then
    raise exception 'merchant_attendance_period_delegation_acl_failed';end if;
end;
$period_delegation_postconditions$;
notify pgrst, 'reload schema';
commit;
