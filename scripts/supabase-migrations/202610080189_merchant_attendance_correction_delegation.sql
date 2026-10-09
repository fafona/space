--238: additive first-correction approval delegation. No owner impersonation,
--no revision/formal-exception authority, no old source/archive rewrite.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $correction_delegation_preflight$
declare n text; installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations') then
    raise exception 'merchant_attendance_correction_delegation_prerequisite_required';end if;
  foreach n in array array[
    'public.faolla_attendance_correction_owner_basis_v1(text,uuid,uuid,uuid,timestamp with time zone)',
    'public.faolla_attendance_correction_rules_v1(text,jsonb)','public.faolla_attendance_decision_checks_v2(text,jsonb)',
    'public.faolla_attendance_correction_summary_v1(public.merchant_attendance_correction_entries,public.merchant_attendance_correction_entries)',
    'public.faolla_attendance_correction_proposal_v1(jsonb,timestamp with time zone)',
    'public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)',
    'public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])','public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)',
    'public.faolla_attendance_events_append_only_v1()','public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'] loop
    if to_regprocedure(n) is null then raise exception 'merchant_attendance_correction_delegation_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610080189 and name<>'merchant_attendance_correction_delegation') then raise exception 'merchant_attendance_correction_delegation_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610080189 and name='merchant_attendance_correction_delegation') into installed;
  foreach n in array array['merchant_attendance_correction_delegations','merchant_attendance_correction_delegation_revocations','merchant_attendance_correction_delegation_decisions'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_correction_delegation_installation_conflict';end if;
  end loop;
end;
$correction_delegation_preflight$;

-- A registered installation is never silently repaired. Permissions, owner,
-- immutable triggers and private helper attributes must already be intact.
do $correction_delegation_reentry$
declare n text;t regclass;f regprocedure;role_name text;expected_owner oid;public_rpc boolean;
begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080189) then return;end if;
 select proowner into expected_owner from pg_proc where oid='public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'::regprocedure;
 foreach n in array array['merchant_attendance_correction_delegations','merchant_attendance_correction_delegation_revocations','merchant_attendance_correction_delegation_decisions'] loop
  t:=to_regclass('public.'||n);
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relrowsecurity and relowner=expected_owner)
   or exists(select 1 from pg_policy where polrelid=t)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='correction_delegation_immutable' and tgtype=27 and tgenabled='O' and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='correction_delegation_no_truncate' and tgtype=34 and tgenabled='O' and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
  then raise exception 'merchant_attendance_correction_delegation_installation_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and
     case when acl.grantee=0 then true else pg_has_role(role_name,acl.grantee,'USAGE') end)
   then raise exception 'merchant_attendance_correction_delegation_installation_conflict';end if;
  end loop;
 end loop;
 foreach n in array array['public.faolla_attendance_correction_delegation_command_v1(jsonb,text)',
  'public.faolla_attendance_correction_delegation_hash_v1(text,text,jsonb)',
  'public.faolla_attendance_correction_delegation_usable_v1(public.merchant_attendance_correction_delegations,timestamptz)',
  'public.faolla_attendance_correction_delegation_grant_v1(public.merchant_attendance_correction_delegations,boolean)',
  'public.faolla_attendance_correction_delegation_review_v1(text,uuid,uuid)',
  'public.faolla_attendance_correction_delegation_scope_v1(jsonb,uuid)',
  'public.faolla_attendance_correction_delegation_original_v1(jsonb,timestamptz)',
  'public.faolla_attendance_correction_delegation_summary_v1(public.merchant_attendance_correction_delegations,public.merchant_attendance_correction_entries)',
  'public.faolla_attendance_correction_delegation_receipt_v1(public.merchant_attendance_correction_delegation_decisions)',
  'public.faolla_attendance_correction_delegation_decision_guard_v1()',
  'public.faolla_attendance_correction_delegations_v1(jsonb,uuid,jsonb,boolean)',
  'public.faolla_attendance_delegated_corrections_v1(jsonb,uuid,jsonb,boolean)'] loop
  f:=to_regprocedure(n);public_rpc:=n in('public.faolla_attendance_correction_delegations_v1(jsonb,uuid,jsonb,boolean)','public.faolla_attendance_delegated_corrections_v1(jsonb,uuid,jsonb,boolean)');
  if f is null or not exists(select 1 from pg_proc where oid=f and proowner=expected_owner and prosecdef=public_rpc and proconfig=array['search_path=pg_catalog'])
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from public_rpc
  then raise exception 'merchant_attendance_correction_delegation_installation_conflict';end if;
 end loop;
end;
$correction_delegation_reentry$;


create or replace function public.faolla_attendance_correction_delegation_command_v1(p jsonb,p_access text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare d jsonb;k text;max_reason integer;
begin
  if p is null or octet_length(convert_to(p::text,'UTF8'))>8192 then return false;end if;
  if p_access='delegate' then
    if public.faolla_attendance_shift_rule_binding_object_v1(p,array['grantId','expectedGrantRevision','decision']) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'grantId','uuid') is distinct from true or p->'expectedGrantRevision' is distinct from '1'::jsonb then return false;end if;
    d:=p->'decision';max_reason:=500;
    if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','requestId','expectedRevision','expectedEvidence','reason']) is distinct from true
      or coalesce(d->>'action','') not in('approve','reject') or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'requestId','uuid') is distinct from true
      or jsonb_typeof(d->'expectedRevision') is distinct from 'number' or coalesce(d->>'expectedRevision','')!~'^[1-9][0-9]{0,15}$'
      or (d->>'expectedRevision')::numeric>9007199254740989 or jsonb_typeof(d->'expectedEvidence') is distinct from 'string'
      or coalesce(d->>'expectedEvidence','')!~'^[0-9a-f]{32}$' then return false;end if;
  elsif p_access='owner' then
    d:=p;max_reason:=200;
    if d->>'action'='grant' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','locationId','includePending','validFrom','validUntil','reason']) is distinct from true then return false;end if;
      foreach k in array array['delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','locationId'] loop
        if public.faolla_attendance_shift_rule_binding_scalar_v1(d->k,'uuid') is distinct from true then return false;end if;
      end loop;
      if jsonb_typeof(d->'includePending') is distinct from 'boolean'
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'validFrom','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'validUntil','stamp6') is distinct from true
        or (d->>'validFrom')::timestamptz>=(d->>'validUntil')::timestamptz then return false;end if;
    elsif d->>'action'='revoke' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','grantId','expectedRevision','reason']) is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'grantId','uuid') is distinct from true or d->'expectedRevision' is distinct from '1'::jsonb then return false;end if;
    else return false;end if;
  else return false;end if;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(d->'operationId','uuid') is true
    and jsonb_typeof(d->'reason')='string' and char_length(d->>'reason') between 1 and max_reason
    and d->>'reason'=btrim(d->>'reason') and d->>'reason'!~'[[:cntrl:]]';
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$$;
create or replace function public.faolla_attendance_correction_delegation_hash_v1(p_site text,p_access text,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare a jsonb;d jsonb;
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or public.faolla_attendance_correction_delegation_command_v1(p,p_access) is distinct from true then raise exception 'attendance_invalid_request';end if;
  a:=jsonb_build_array('attendance-correction-delegation-v1',p_site,p_access);
  if p_access='delegate' then
    d:=p->'decision';a:=a||jsonb_build_array(d->>'action',d->>'operationId',p->>'grantId',(p->>'expectedGrantRevision')::integer,
      d->>'requestId',(d->>'expectedRevision')::bigint,d->>'expectedEvidence',d->>'reason');
  elsif p->>'action'='grant' then
    a:=a||jsonb_build_array(p->>'action',p->>'operationId',p->>'delegateEmployeeId',p->>'delegateAuthUserId',p->>'workerId',p->>'employeeId',
      p->>'employeeAuthUserId',p->>'locationId',(p->>'includePending')::boolean,p->>'validFrom',p->>'validUntil',p->>'reason');
  else a:=a||jsonb_build_array(p->>'action',p->>'operationId',p->>'grantId',(p->>'expectedRevision')::integer,p->>'reason');end if;
  return encode(sha256(convert_to(a::text,'UTF8')),'hex');
end;
$$;

create table if not exists public.merchant_attendance_correction_delegations(
  merchant_id text not null references public.merchants(id),grant_id uuid not null,
  delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,delegate_name text not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,worker_name text not null,worker_no text not null,
  location_id uuid not null,location_name text not null,time_zone text not null,include_pending boolean not null,
  delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
  employee_generation bigint not null check(employee_generation between 0 and 9007199254740990),
  valid_from timestamptz not null,valid_until timestamptz not null,actor_auth_user_id uuid not null,reason text not null,
  command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,grant_id),
  foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id),
  check(isfinite(valid_from) and isfinite(valid_until) and valid_from<valid_until and isfinite(recorded_at) and valid_until>recorded_at),
  check(delegate_employee_id<>employee_id and delegate_auth_user_id<>employee_auth_user_id),
  check(public.faolla_attendance_correction_delegation_command_v1(command,'owner') is true and command->>'action'='grant'
    and command->>'operationId'=grant_id::text and command->>'delegateEmployeeId'=delegate_employee_id::text and command->>'delegateAuthUserId'=delegate_auth_user_id::text
    and command->>'workerId'=worker_id::text and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text
    and command->>'locationId'=location_id::text and (command->>'includePending')::boolean=include_pending
    and (command->>'validFrom')::timestamptz=valid_from and (command->>'validUntil')::timestamptz=valid_until
    and command->>'reason'=reason and command_fingerprint=public.faolla_attendance_correction_delegation_hash_v1(merchant_id,'owner',command)),
  check(public.faolla_attendance_group_text_v1(delegate_name,1,120) and public.faolla_attendance_group_text_v1(worker_name,1,120)
    and public.faolla_attendance_group_text_v1(worker_no,1,40) and public.faolla_attendance_group_text_v1(location_name,1,120)
    and public.faolla_attendance_group_text_v1(time_zone,1,100))
);
create index if not exists attendance_correction_delegation_delegate_idx on public.merchant_attendance_correction_delegations(merchant_id,delegate_employee_id,delegate_auth_user_id,grant_id);
create index if not exists attendance_correction_delegation_target_idx on public.merchant_attendance_correction_delegations(merchant_id,employee_id,grant_id);
create table if not exists public.merchant_attendance_correction_delegation_revocations(
  merchant_id text not null,operation_id uuid not null,grant_id uuid not null,actor_auth_user_id uuid not null,
  reason text not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,grant_id),
  foreign key(merchant_id,grant_id) references public.merchant_attendance_correction_delegations(merchant_id,grant_id),
  check(isfinite(recorded_at)),check(public.faolla_attendance_correction_delegation_command_v1(command,'owner') is true and command->>'action'='revoke'
    and command->>'operationId'=operation_id::text and command->>'grantId'=grant_id::text and command->>'reason'=reason
    and command_fingerprint=public.faolla_attendance_correction_delegation_hash_v1(merchant_id,'owner',command))
);
create table if not exists public.merchant_attendance_correction_delegation_decisions(
  merchant_id text not null,operation_id uuid not null,request_id uuid not null,grant_id uuid not null,
  delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,delegate_name text not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,location_id uuid not null,
  delegate_generation bigint not null,employee_generation bigint not null,authorized_at timestamptz not null,
  action text not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,request_id),
  foreign key(merchant_id,operation_id) references public.merchant_attendance_correction_decisions(merchant_id,operation_id),
  foreign key(merchant_id,request_id) references public.merchant_attendance_correction_entries(merchant_id,operation_id),
  foreign key(merchant_id,grant_id) references public.merchant_attendance_correction_delegations(merchant_id,grant_id),
  foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(action in('approve','reject') and isfinite(recorded_at) and isfinite(authorized_at) and authorized_at<=recorded_at
    and delegate_auth_user_id<>employee_auth_user_id and delegate_employee_id<>employee_id),
  check(public.faolla_attendance_group_text_v1(delegate_name,1,120)),
  check(public.faolla_attendance_correction_delegation_command_v1(command,'delegate') is true and command->>'grantId'=grant_id::text
    and command->'decision'->>'operationId'=operation_id::text and command->'decision'->>'requestId'=request_id::text and command->'decision'->>'action'=action
    and command_fingerprint=public.faolla_attendance_correction_delegation_hash_v1(merchant_id,'delegate',command))
);

create or replace function public.faolla_attendance_correction_delegation_usable_v1(p public.merchant_attendance_correction_delegations,p_at timestamptz)
returns boolean language sql stable set search_path=pg_catalog as $$
  select coalesce(p_at>=p.valid_from and p_at<p.valid_until
    and not exists(select 1 from public.merchant_attendance_correction_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id)
    and not exists(select 1 from public.merchant_attendance_account_epochs x where x.merchant_id=p.merchant_id and
      ((x.employee_id=p.delegate_employee_id and (x.paused or x.generation<>p.delegate_generation))
       or (x.employee_id=p.employee_id and (x.paused or x.generation<>p.employee_generation))))
    and p.delegate_generation=coalesce((select generation from public.merchant_attendance_account_epochs where merchant_id=p.merchant_id and employee_id=p.delegate_employee_id),0)
    and p.employee_generation=coalesce((select generation from public.merchant_attendance_account_epochs where merchant_id=p.merchant_id and employee_id=p.employee_id),0)
    and exists(select 1 from public.merchant_enterprise_employees de
      join public.merchant_enterprise_roles dr on dr.merchant_id=de.merchant_id and dr.id=de.role_id
      join public.merchant_attendance_workers w on w.merchant_id=de.merchant_id and w.id=p.worker_id
      join public.merchant_enterprise_employees te on te.merchant_id=w.merchant_id and te.id=w.employee_id
      join public.merchant_attendance_locations l on l.merchant_id=w.merchant_id and l.id=p.location_id
      where de.merchant_id=p.merchant_id and de.id=p.delegate_employee_id and de.auth_user_id=p.delegate_auth_user_id and de.status='active'
        and dr.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions)
        and dr.permissions @> array['enterprise.view','attendance.correction.review']::text[]
        and w.active and w.employee_id=p.employee_id and te.auth_user_id=p.employee_auth_user_id and te.status='active' and l.active
        and de.id<>te.id and de.auth_user_id<>te.auth_user_id),false);
$$;
create or replace function public.faolla_attendance_correction_delegation_grant_v1(p public.merchant_attendance_correction_delegations,p_usable boolean)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare r public.merchant_attendance_correction_delegation_revocations%rowtype;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  select * into r from public.merchant_attendance_correction_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id;
  return jsonb_build_object('grantId',p.grant_id,'revision',case when r.operation_id is null then 1 else 2 end,'status',case when r.operation_id is null then 'granted' else 'revoked' end,
    'delegate',jsonb_build_object('employeeId',p.delegate_employee_id,'authUserId',p.delegate_auth_user_id,'name',p.delegate_name),
    'worker',jsonb_build_object('workerId',p.worker_id,'employeeId',p.employee_id,'authUserId',p.employee_auth_user_id,'name',p.worker_name,'workerNo',p.worker_no),
    'location',jsonb_build_object('locationId',p.location_id,'name',p.location_name,'timeZone',p.time_zone),
    'includePending',p.include_pending,'validFrom',to_char(p.valid_from at time zone 'UTC',fmt),'validUntil',to_char(p.valid_until at time zone 'UTC',fmt),'grantedBy',p.actor_auth_user_id,'grantedAt',to_char(p.recorded_at at time zone 'UTC',fmt),'reason',p.reason,
    'revocation',case when r.operation_id is null then null else jsonb_build_object('operationId',r.operation_id,'actorId',r.actor_auth_user_id,'reason',r.reason,'recordedAt',to_char(r.recorded_at at time zone 'UTC',fmt)) end,'usable',p_usable and r.operation_id is null);
end;
$$;

-- Private actual-actor detail collector. No owner wrapper or synthetic owner identity.
-- Calculation helpers remain the existing 083 basis, 085 fixed policy and 096 CAS.
create or replace function public.faolla_attendance_correction_delegation_review_v1(p_site_id text,p_auth_user_id uuid,v_request uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare r public.merchant_attendance_correction_entries%rowtype;tail public.merchant_attendance_correction_entries%rowtype;
 w public.merchant_attendance_workers%rowtype;emp public.merchant_enterprise_employees%rowtype;
 v_now timestamptz;v_asof timestamptz;v_summary jsonb;v_evidence jsonb;v_periods jsonb;v_period_count integer;
 v_first_date date;v_last_date date;v_zone text;v_code text;result jsonb;rules jsonb;
begin
 if p_site_id is null or p_auth_user_id is null or v_request is null then raise exception 'attendance_access_denied';end if;
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
  result:=jsonb_build_object('siteId',p_site_id,'mode','detail','asOf',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'approvalAvailable',false,
    'item',v_summary||jsonb_build_object('employeeId',r.employee_id,'workerId',r.worker_id,'workerName',w.display_name,'workerNo',w.worker_no),
    'application',jsonb_build_object('siteId',p_site_id,'employeeId',r.employee_id,'workerId',r.worker_id,'asOf',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'mode','detail','canRequest',false,'item',v_summary,'basis',r.basis,'proposal',r.proposal,'reason',r.reason,'receipt',null,
      'withdrawal',case when tail.action='withdraw' then jsonb_build_object('reason',tail.reason,'recordedAt',to_char(tail.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else null end),
    'evidence',v_evidence);

  rules:=public.faolla_attendance_correction_rules_v1(p_site_id,result->'application');
  return result||jsonb_build_object('rulesEnforced',true,'application',(result->'application')||jsonb_build_object('rulesEnforced',true,'rules',rules));
end;
$$;

create or replace function public.faolla_attendance_correction_delegation_scope_v1(p_basis jsonb,p_location uuid)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
 if p_location is null or jsonb_typeof(p_basis->'events') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_basis->'events') not between 2 and 202 then return false;end if;
 return not exists(select 1 from jsonb_array_elements(p_basis->'events') e where e->>'locationId' is distinct from p_location::text);
end;
$$;

create or replace function public.faolla_attendance_correction_delegation_original_v1(p_basis jsonb,p_now timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare e jsonb;opened jsonb;parts jsonb:='[]';state text:='off';first_at text;last_at text;n integer:=0;
begin
 if jsonb_typeof(p_basis->'events') is distinct from 'array' or jsonb_array_length(p_basis->'events') not between 2 and 202 then raise exception 'attendance_correction_delegation_invalid';end if;
 for e in select value from jsonb_array_elements(p_basis->'events') loop
  if state='off' and e->>'action'='clock_in' then first_at:=e->>'occurredAt';state:='working';
  elsif state='working' and e->>'action'='break_start' then opened:=e;state:='break';
  elsif state='break' and e->>'action'='break_end' then
   n:=n+1;if n>32 then raise exception 'attendance_correction_delegation_too_large';end if;
   parts:=parts||jsonb_build_array(jsonb_build_object('startAt',opened->>'occurredAt','endAt',e->>'occurredAt','paid',opened->'breakPaid'));state:='working';
  elsif state='working' and e->>'action'='clock_out' then last_at:=e->>'occurredAt';state:='closed';
  else raise exception 'attendance_correction_delegation_invalid';end if;
 end loop;
 if state<>'closed' then raise exception 'attendance_correction_delegation_invalid';end if;
 return public.faolla_attendance_correction_proposal_v1(jsonb_build_object('startAt',first_at,'endAt',last_at,'breaks',parts),p_now);
end;
$$;

create or replace function public.faolla_attendance_correction_delegation_summary_v1(g public.merchant_attendance_correction_delegations,r public.merchant_attendance_correction_entries)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('requestId',r.request_id,'startEventId',r.start_event_id,'revision',r.revision,
 'workerId',r.worker_id,'employeeId',r.employee_id,'employeeAuthUserId',r.actor_auth_user_id,'workerName',g.worker_name,
 'locationId',g.location_id,'locationName',g.location_name,'timeZone',r.basis->'events'->0->>'timeZone',
 'submittedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'status','submitted');
$$;

create or replace function public.faolla_attendance_correction_delegation_receipt_v1(p public.merchant_attendance_correction_delegation_decisions)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare d public.merchant_attendance_correction_decisions%rowtype;g public.merchant_attendance_correction_delegations%rowtype;
begin
 select * into d from public.merchant_attendance_correction_decisions x where x.merchant_id=p.merchant_id and x.operation_id=p.operation_id;
 select * into g from public.merchant_attendance_correction_delegations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id;
 if d.operation_id is null or g.grant_id is null or d.actor_auth_user_id is distinct from p.delegate_auth_user_id
  or d.request_id is distinct from p.request_id or d.action is distinct from p.action or d.command is distinct from p.command->'decision'
  or d.recorded_at is distinct from p.recorded_at or p.authorized_at is distinct from p.recorded_at
  or p.delegate_employee_id is distinct from g.delegate_employee_id or p.delegate_auth_user_id is distinct from g.delegate_auth_user_id
  or p.worker_id is distinct from g.worker_id or p.employee_id is distinct from g.employee_id or p.employee_auth_user_id is distinct from g.employee_auth_user_id
  or p.location_id is distinct from g.location_id or p.delegate_generation is distinct from g.delegate_generation or p.employee_generation is distinct from g.employee_generation
  or p.authorized_at<g.recorded_at or p.authorized_at<g.valid_from or p.authorized_at>=g.valid_until
  or p.command_fingerprint is distinct from public.faolla_attendance_correction_delegation_hash_v1(p.merchant_id,'delegate',p.command)
 then raise exception 'attendance_correction_delegation_invalid';end if;
 return jsonb_build_object('operationId',p.operation_id,'requestId',p.request_id,'grantId',p.grant_id,'action',p.action,
  'status',case p.action when 'approve' then 'approved' else 'rejected' end,'actorId',p.delegate_auth_user_id,
  'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',p.command_fingerprint);
end;
$$;

create or replace function public.faolla_attendance_correction_delegation_decision_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_correction_delegations%rowtype;r public.merchant_attendance_correction_entries%rowtype;
begin
 select * into g from public.merchant_attendance_correction_delegations x where x.merchant_id=new.merchant_id and x.grant_id=new.grant_id;
 select * into r from public.merchant_attendance_correction_entries x where x.merchant_id=new.merchant_id and x.operation_id=new.request_id and x.action='submit';
 if g.grant_id is null or r.operation_id is null or public.faolla_attendance_correction_delegation_usable_v1(g,new.authorized_at) is distinct from true
  or r.worker_id is distinct from g.worker_id or r.employee_id is distinct from g.employee_id or r.actor_auth_user_id is distinct from g.employee_auth_user_id
  or (not g.include_pending and r.recorded_at<=g.recorded_at)
  or public.faolla_attendance_correction_delegation_scope_v1(r.basis,g.location_id) is distinct from true
 then raise exception 'attendance_correction_delegation_invalid';end if;
 perform public.faolla_attendance_correction_delegation_receipt_v1(new);
 if (new.action='approve') is distinct from exists(select 1 from public.merchant_attendance_correction_effects x where x.merchant_id=new.merchant_id and x.request_id=new.request_id and x.operation_id=new.operation_id)
 then raise exception 'attendance_correction_delegation_invalid';end if;
 return new;
end;
$$;
create or replace function public.faolla_attendance_correction_delegations_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;kind text;k text;after_id uuid;target_grant_id uuid;op uuid;action_name text;stamp timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  de public.merchant_enterprise_employees%rowtype;te public.merchant_enterprise_employees%rowtype;dr public.merchant_enterprise_roles%rowtype;
  loc public.merchant_attendance_locations%rowtype;g public.merchant_attendance_correction_delegations%rowtype;rv public.merchant_attendance_correction_delegation_revocations%rowtype;
  candidate record;items jsonb:='[]';catalog_items jsonb:='[]';detail jsonb;receipt jsonb;result jsonb;next_id uuid;seen integer:=0;can_write boolean;
  de_epoch public.merchant_attendance_account_epochs%rowtype;te_epoch public.merchant_attendance_account_epochs%rowtype;
  fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','catalog','afterId','grantId','operationId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$'
    or p_query->>'access' is distinct from 'owner' or coalesce(p_query->>'mode','') not in('list','catalog','detail','recover') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';mode_name:=p_query->>'mode';kind:=p_query->>'catalog';
  foreach k in array array['afterId','grantId','operationId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  after_id:=(p_query->>'afterId')::uuid;target_grant_id:=(p_query->>'grantId')::uuid;op:=(p_query->>'operationId')::uuid;
  if (mode_name='catalog' and (kind is null or kind not in('delegates','workers','locations') or target_grant_id is not null or op is not null))
    or (mode_name<>'catalog' and p_query->'catalog'<>'null'::jsonb)
    or (mode_name='list' and (target_grant_id is not null or op is not null))
    or (mode_name='detail' and (target_grant_id is null or op is not null or after_id is not null))
    or (mode_name='recover' and (op is null or target_grant_id is not null or after_id is not null)) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_correction_delegation_command_v1(p_command,'owner') is distinct from true then raise exception 'attendance_invalid_request';end if;
    action_name:=p_command->>'action';
    if (action_name='grant' and (mode_name<>'list' or after_id is not null))
      or (action_name='revoke' and (mode_name<>'detail' or p_command->>'grantId' is distinct from target_grant_id::text)) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  perform 1 from public.merchants m where m.id=site and (mode_name='recover' or m.user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings x where x.merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if not p_allow_write and (mode_name='catalog' or action_name='grant') then raise exception 'attendance_correction_delegation_disabled';end if;
  can_write:=mode_name<>'recover' and p_allow_write and s.enabled;
  if op is not null then
    select * into g from public.merchant_attendance_correction_delegations x where x.merchant_id=site and x.grant_id=op;
    select * into rv from public.merchant_attendance_correction_delegation_revocations x where x.merchant_id=site and x.operation_id=op;
    if g.grant_id is not null and rv.operation_id is not null then raise exception 'attendance_correction_delegation_invalid';end if;
    if g.grant_id is not null then
      if g.actor_auth_user_id<>p_auth_user_id or p_command is not null and g.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if g.command_fingerprint is distinct from public.faolla_attendance_correction_delegation_hash_v1(site,'owner',g.command) then raise exception 'attendance_correction_delegation_invalid';end if;
      receipt:=jsonb_build_object('operationId',g.grant_id,'action','grant','grantId',g.grant_id,'revision',1,'recordedAt',to_char(g.recorded_at at time zone 'UTC',fmt),'commandFingerprint',g.command_fingerprint);
    elsif rv.operation_id is not null then
      if rv.actor_auth_user_id<>p_auth_user_id or p_command is not null and rv.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if rv.command_fingerprint is distinct from public.faolla_attendance_correction_delegation_hash_v1(site,'owner',rv.command) then raise exception 'attendance_correction_delegation_invalid';end if;
      receipt:=jsonb_build_object('operationId',rv.operation_id,'action','revoke','grantId',rv.grant_id,'revision',2,'recordedAt',to_char(rv.recorded_at at time zone 'UTC',fmt),'commandFingerprint',rv.command_fingerprint);
    end if;
  end if;
  if p_command is not null and receipt is null then
    if exists(select 1 from public.merchant_attendance_correction_delegation_decisions x where x.merchant_id=site and x.operation_id=op) then raise exception 'attendance_operation_conflict';end if;
    if action_name='grant' then
      if not can_write then raise exception 'attendance_platform_paused';end if;
      select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=(p_command->>'workerId')::uuid for update;
      perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id in((p_command->>'delegateEmployeeId')::uuid,(p_command->>'employeeId')::uuid) order by x.id for share;
      select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=(p_command->>'delegateEmployeeId')::uuid;
      select * into te from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=(p_command->>'employeeId')::uuid;
      perform 1 from public.merchant_enterprise_roles x where x.merchant_id=site and x.id in(de.role_id,te.role_id) order by x.id for share;
      select * into dr from public.merchant_enterprise_roles x where x.merchant_id=site and x.id=de.role_id;
      select * into loc from public.merchant_attendance_locations x where x.merchant_id=site and x.id=(p_command->>'locationId')::uuid for share;
      if w.id is null or not w.active or w.employee_id is distinct from te.id or te.id is null or te.status<>'active' or te.auth_user_id is distinct from (p_command->>'employeeAuthUserId')::uuid
        or de.id is null or de.status<>'active' or de.auth_user_id is distinct from (p_command->>'delegateAuthUserId')::uuid
        or dr.id is null or dr.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) is distinct from true
        or not(dr.permissions @> array['enterprise.view','attendance.correction.review']::text[])
        or loc.id is null or not loc.active or de.id=te.id or de.auth_user_id=te.auth_user_id then raise exception 'attendance_access_denied';end if;
      select * into de_epoch from public.merchant_attendance_account_epochs x where x.merchant_id=site and x.employee_id=de.id;
      select * into te_epoch from public.merchant_attendance_account_epochs x where x.merchant_id=site and x.employee_id=te.id;
      if coalesce(de_epoch.paused,false) or coalesce(te_epoch.paused,false) then raise exception 'attendance_access_denied';end if;
      stamp:=clock_timestamp();
      if (p_command->>'validUntil')::timestamptz<=stamp then raise exception 'attendance_invalid_request';end if;
      insert into public.merchant_attendance_correction_delegations(merchant_id,grant_id,delegate_employee_id,delegate_auth_user_id,delegate_name,
        worker_id,employee_id,employee_auth_user_id,worker_name,worker_no,location_id,location_name,time_zone,include_pending,delegate_generation,employee_generation,valid_from,valid_until,actor_auth_user_id,reason,command,command_fingerprint,recorded_at)
      values(site,op,de.id,de.auth_user_id,de.display_name,w.id,te.id,te.auth_user_id,w.display_name,w.worker_no,loc.id,loc.name,loc.time_zone,(p_command->>'includePending')::boolean,coalesce(de_epoch.generation,0),coalesce(te_epoch.generation,0),
        (p_command->>'validFrom')::timestamptz,(p_command->>'validUntil')::timestamptz,p_auth_user_id,p_command->>'reason',p_command,
        public.faolla_attendance_correction_delegation_hash_v1(site,'owner',p_command),stamp) returning * into g;
      receipt:=jsonb_build_object('operationId',op,'action','grant','grantId',op,'revision',1,'recordedAt',to_char(stamp at time zone 'UTC',fmt),'commandFingerprint',g.command_fingerprint);
    else
      select * into g from public.merchant_attendance_correction_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
      if g.grant_id is null then raise exception 'attendance_correction_delegation_not_found';end if;
      perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for update;
      if exists(select 1 from public.merchant_attendance_correction_delegation_revocations x where x.merchant_id=site and x.grant_id=g.grant_id) then raise exception 'attendance_version_conflict';end if;
      stamp:=clock_timestamp();
      insert into public.merchant_attendance_correction_delegation_revocations(merchant_id,operation_id,grant_id,actor_auth_user_id,reason,command,command_fingerprint,recorded_at)
        values(site,op,g.grant_id,p_auth_user_id,p_command->>'reason',p_command,public.faolla_attendance_correction_delegation_hash_v1(site,'owner',p_command),stamp) returning * into rv;
      receipt:=jsonb_build_object('operationId',op,'action','revoke','grantId',g.grant_id,'revision',2,'recordedAt',to_char(stamp at time zone 'UTC',fmt),'commandFingerprint',rv.command_fingerprint);
    end if;
  elsif p_command is null and mode_name='detail' then
    select * into g from public.merchant_attendance_correction_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
    if g.grant_id is null then raise exception 'attendance_correction_delegation_not_found';end if;
    detail:=public.faolla_attendance_correction_delegation_grant_v1(g,can_write and public.faolla_attendance_correction_delegation_usable_v1(g,clock_timestamp()));
  elsif p_command is null and mode_name='list' then
    for g in select x.* from public.merchant_attendance_correction_delegations x where x.merchant_id=site and (after_id is null or x.grant_id>after_id) order by x.grant_id limit 26 loop
      seen:=seen+1;exit when seen=26;
      items:=items||jsonb_build_array(public.faolla_attendance_correction_delegation_grant_v1(g,can_write and public.faolla_attendance_correction_delegation_usable_v1(g,clock_timestamp())));next_id:=g.grant_id;
    end loop;
  elsif p_command is null and mode_name='catalog' then
    for candidate in
      select c.* from (
        select x.id,x.display_name name,x.id employee_id,x.auth_user_id member_auth,null::text worker_no,null::text zone
          from public.merchant_enterprise_employees x join public.merchant_enterprise_roles r on r.merchant_id=x.merchant_id and r.id=x.role_id
          where kind='delegates' and x.merchant_id=site and x.status='active' and x.auth_user_id is not null and r.status='active'
            and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) and r.permissions @> array['enterprise.view','attendance.correction.review']::text[]
            and not exists(select 1 from public.merchant_attendance_account_epochs ep where ep.merchant_id=site and ep.employee_id=x.id and ep.paused)
            and (after_id is null or x.id>after_id)
        union all
        select x.id,x.display_name,e.id,e.auth_user_id,x.worker_no,null::text from public.merchant_attendance_workers x
          join public.merchant_enterprise_employees e on e.merchant_id=x.merchant_id and e.id=x.employee_id
          where kind='workers' and x.merchant_id=site and x.active and e.status='active' and e.auth_user_id is not null and not exists(select 1 from public.merchant_attendance_account_epochs ep where ep.merchant_id=site and ep.employee_id=e.id and ep.paused) and (after_id is null or x.id>after_id)
        union all
        select x.id,x.name,null::uuid,null::uuid,null::text,x.time_zone from public.merchant_attendance_locations x
          where kind='locations' and x.merchant_id=site and x.active and (after_id is null or x.id>after_id)
      ) c order by c.id limit 26 loop
      seen:=seen+1;exit when seen=26;
      catalog_items:=catalog_items||jsonb_build_array(jsonb_build_object('id',candidate.id,'name',candidate.name,'employeeId',candidate.employee_id,
        'employeeAuthUserId',candidate.member_auth,'workerNo',candidate.worker_no,'timeZone',candidate.zone));next_id:=candidate.id;
    end loop;
  end if;
  result:=jsonb_build_object('protocol','correction-delegations-v1','siteId',site,'actorId',p_auth_user_id,'mode',mode_name,'timeZone',s.time_zone,'canWrite',can_write,
    'items',items,'catalogItems',catalog_items,'nextId',case when seen=26 then next_id else null end,'detail',detail,'receipt',receipt,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_correction_delegation_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_delegated_corrections_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;k text;target_grant_id uuid;target_request_id uuid;op uuid;cursor_at timestamptz;cursor_id uuid;after_id uuid;stamp timestamptz;
  s public.merchant_attendance_settings%rowtype;de public.merchant_enterprise_employees%rowtype;te public.merchant_enterprise_employees%rowtype;
  dr public.merchant_enterprise_roles%rowtype;w public.merchant_attendance_workers%rowtype;loc public.merchant_attendance_locations%rowtype;
  g public.merchant_attendance_correction_delegations%rowtype;authority public.merchant_attendance_correction_delegation_decisions%rowtype;
  req public.merchant_attendance_correction_entries%rowtype;entry public.merchant_attendance_correction_decisions%rowtype;
  grants_json jsonb:='[]';items jsonb:='[]';detail jsonb;receipt jsonb;review jsonb;decision jsonb;result jsonb;next_cursor jsonb;next_id uuid;
  seen integer:=0;can_write boolean:=false;checks jsonb;a jsonb;proposal jsonb;b jsonb;original jsonb;blockers jsonb;issue text;
  elapsed_us bigint;break_us bigint:=0;paid_us bigint:=0;duration_us bigint;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','grantId','requestId','operationId','beforeAt','beforeId','afterId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$'
    or p_query->>'access' is distinct from 'delegate' or coalesce(p_query->>'mode','') not in('grants','list','detail','decide','recover') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';mode_name:=p_query->>'mode';
  foreach k in array array['grantId','requestId','operationId','beforeId','afterId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'beforeAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeAt','stamp6') is distinct from true then raise exception 'attendance_invalid_request';end if;
  target_grant_id:=(p_query->>'grantId')::uuid;target_request_id:=(p_query->>'requestId')::uuid;op:=(p_query->>'operationId')::uuid;
  cursor_at:=(p_query->>'beforeAt')::timestamptz;cursor_id:=(p_query->>'beforeId')::uuid;after_id:=(p_query->>'afterId')::uuid;
  if (cursor_at is null)<>(cursor_id is null)
    or (mode_name='grants' and (target_grant_id is not null or target_request_id is not null or op is not null or cursor_at is not null))
    or (mode_name='list' and (target_grant_id is null or target_request_id is not null or op is not null or after_id is not null))
    or (mode_name in('detail','decide') and (target_grant_id is null or target_request_id is null or op is not null or cursor_at is not null or after_id is not null))
    or (mode_name='recover' and (op is null or target_grant_id is not null or target_request_id is not null or cursor_at is not null or after_id is not null))
    or (mode_name='decide')<>(p_command is not null) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_correction_delegation_command_v1(p_command,'delegate') is distinct from true
      or p_command->>'grantId' is distinct from target_grant_id::text or p_command->'decision'->>'requestId' is distinct from target_request_id::text then raise exception 'attendance_invalid_request';end if;
    decision:=p_command->'decision';op:=(decision->>'operationId')::uuid;
  end if;
  perform 1 from public.merchants m where m.id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings x where x.merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;

  if mode_name='recover' then
    --No role/activity/grant/body checks here: original actor, SAME employee/Auth
    --only. This never executes an old command or discovers a new request.
    select * into authority from public.merchant_attendance_correction_delegation_decisions x where x.merchant_id=site and x.operation_id=op;
    select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.auth_user_id=p_auth_user_id for share;
    if de.id is null or authority.operation_id is not null and (authority.delegate_auth_user_id<>p_auth_user_id or authority.delegate_employee_id<>de.id) then raise exception 'attendance_access_denied';end if;
    if authority.operation_id is not null then receipt:=public.faolla_attendance_correction_delegation_receipt_v1(authority);end if;
  else
    if not p_allow_write then raise exception 'attendance_correction_delegation_disabled';end if;
    --Identify without taking an employee lock before the selected worker.
    select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.auth_user_id=p_auth_user_id;
    if de.id is null then raise exception 'attendance_access_denied';end if;
    if target_grant_id is not null then
      select * into g from public.merchant_attendance_correction_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
      if g.grant_id is null or g.delegate_employee_id<>de.id or g.delegate_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is null then select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for share;
      else select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for update;end if;
      perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id in(g.delegate_employee_id,g.employee_id) order by x.id for share;
      select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=g.delegate_employee_id;
      select * into te from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=g.employee_id;
      select * into loc from public.merchant_attendance_locations x where x.merchant_id=site and x.id=g.location_id for share;
      if w.id is null or not w.active or w.employee_id is distinct from g.employee_id or te.id is null or te.auth_user_id is distinct from g.employee_auth_user_id
        or te.status<>'active' or de.auth_user_id is distinct from g.delegate_auth_user_id or loc.id is null or not loc.active then raise exception 'attendance_access_denied';end if;
    else
      select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=de.id for share;
    end if;
    perform 1 from public.merchant_enterprise_roles x where x.merchant_id=site and x.id in(de.role_id,te.role_id) order by x.id for share;
    select * into dr from public.merchant_enterprise_roles x where x.merchant_id=site and x.id=de.role_id;
    if de.id is null or de.auth_user_id is distinct from p_auth_user_id or de.status<>'active' or dr.id is null or dr.status<>'active'
      or public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) is distinct from true
      or not(dr.permissions @> array['enterprise.view','attendance.correction.review']::text[]) then raise exception 'attendance_access_denied';end if;
    if exists(select 1 from public.merchant_attendance_account_epochs ep where ep.merchant_id=site and ep.employee_id=de.id and ep.paused) then raise exception 'attendance_access_denied';end if;
    stamp:=clock_timestamp();can_write:=p_allow_write and s.enabled;
    if g.grant_id is not null and public.faolla_attendance_correction_delegation_usable_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;
    if mode_name='grants' then
      for g in select x.* from public.merchant_attendance_correction_delegations x where can_write and x.merchant_id=site and x.delegate_employee_id=de.id and x.delegate_auth_user_id=p_auth_user_id
        and (after_id is null or x.grant_id>after_id) and public.faolla_attendance_correction_delegation_usable_v1(x,stamp)
        order by x.grant_id limit 26 loop
        seen:=seen+1;exit when seen=26;
        grants_json:=grants_json||jsonb_build_array(public.faolla_attendance_correction_delegation_grant_v1(g,can_write));next_id:=g.grant_id;
      end loop;

    elsif mode_name='list' then
      -- All immutable identity/location/includePending filters precede LIMIT.
      for req in select x.* from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.action='submit'
        and x.worker_id=g.worker_id and x.employee_id=g.employee_id and x.actor_auth_user_id=g.employee_auth_user_id
        and (g.include_pending or x.recorded_at>g.recorded_at)
        and public.faolla_attendance_correction_delegation_scope_v1(x.basis,g.location_id)
        and not exists(select 1 from public.merchant_attendance_correction_entries t where t.merchant_id=x.merchant_id and t.request_id=x.request_id and t.action='withdraw')
        and not exists(select 1 from public.merchant_attendance_correction_decisions t where t.merchant_id=x.merchant_id and t.request_id=x.request_id)
        and (cursor_at is null or (x.recorded_at,x.request_id)<(cursor_at,cursor_id))
        order by x.recorded_at desc,x.request_id desc limit 26 loop
        seen:=seen+1;exit when seen=26;
        items:=items||jsonb_build_array(public.faolla_attendance_correction_delegation_summary_v1(g,req));
        next_cursor:=jsonb_build_object('at',to_char(req.recorded_at at time zone 'UTC',fmt),'id',req.request_id);
      end loop;
    else
      if p_command is not null then
        select * into authority from public.merchant_attendance_correction_delegation_decisions x where x.merchant_id=site and x.operation_id=op;
        if authority.operation_id is not null then
          if authority.delegate_employee_id<>de.id or authority.delegate_auth_user_id<>p_auth_user_id or authority.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
          receipt:=public.faolla_attendance_correction_delegation_receipt_v1(authority);
        elsif exists(select 1 from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.operation_id=op)
          or exists(select 1 from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.operation_id=op)
          or exists(select 1 from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.operation_id=op)
          or exists(select 1 from public.merchant_attendance_revision_decisions x where x.merchant_id=site and x.operation_id=op)
          or exists(select 1 from public.merchant_attendance_effect_versions x where x.merchant_id=site and x.operation_id=op)
          or exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=site and x.grant_id=op)
          or exists(select 1 from public.merchant_attendance_correction_delegation_revocations x where x.merchant_id=site and x.operation_id=op)
        then raise exception 'attendance_operation_conflict';end if;
      end if;
      if receipt is null then
        select * into req from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=target_request_id and x.action='submit';
        if req.operation_id is null or (req.worker_id,req.employee_id,req.actor_auth_user_id) is distinct from (g.worker_id,g.employee_id,g.employee_auth_user_id)
          or req.actor_auth_user_id=p_auth_user_id or (not g.include_pending and req.recorded_at<=g.recorded_at)
          or public.faolla_attendance_correction_delegation_scope_v1(req.basis,g.location_id) is distinct from true
        then raise exception 'attendance_access_denied';end if;
        review:=public.faolla_attendance_correction_delegation_review_v1(site,p_auth_user_id,req.request_id);
        a:=review->'application';
        -- Never return a current source from outside the one saved location.
        if review->'evidence'->'currentBasis'<>'null'::jsonb and
          public.faolla_attendance_correction_delegation_scope_v1(review->'evidence'->'currentBasis',g.location_id) is distinct from true
        then raise exception 'attendance_access_denied';end if;
        original:=public.faolla_attendance_correction_delegation_original_v1(req.basis,clock_timestamp());
        checks:=public.faolla_attendance_decision_checks_v2(site,review);
        if p_command is not null then
          if not can_write then raise exception 'attendance_platform_paused';end if;
          stamp:=clock_timestamp();
          if public.faolla_attendance_correction_delegation_usable_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;
          if exists(select 1 from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.request_id=req.request_id) then raise exception 'attendance_correction_decided';end if;
          if (a->'item'->>'revision')::bigint<>(decision->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
          if checks->>'evidenceToken' is distinct from decision->>'expectedEvidence' then raise exception 'attendance_correction_evidence_changed';end if;
          if checks->(case decision->>'action' when 'approve' then 'canApprove' else 'canReject' end) is distinct from 'true'::jsonb then raise exception 'attendance_correction_decision_blocked';end if;
          if stamp<=req.recorded_at or stamp<(review->>'asOf')::timestamptz then raise exception 'attendance_version_conflict';end if;
          -- Real delegate actor and untouched six-key old command. The 150 effect
          -- INSERT trigger remains enabled and may reject a sealed source.
          insert into public.merchant_attendance_correction_decisions(merchant_id,request_id,operation_id,actor_auth_user_id,action,request_revision,evidence_token,reason,command,review_snapshot,recorded_at)
            values(site,req.request_id,op,p_auth_user_id,decision->>'action',(a->'item'->>'revision')::bigint,decision->>'expectedEvidence',decision->>'reason',decision,review,stamp) returning * into entry;
          if entry.action='approve' then
            proposal:=public.faolla_attendance_correction_proposal_v1(a->'proposal',stamp);
            elapsed_us:=(extract(epoch from ((proposal->>'endAt')::timestamptz-(proposal->>'startAt')::timestamptz))*1000000)::bigint;
            for b in select value from jsonb_array_elements(proposal->'breaks') loop
              duration_us:=(extract(epoch from ((b->>'endAt')::timestamptz-(b->>'startAt')::timestamptz))*1000000)::bigint;
              break_us:=break_us+duration_us;if (b->>'paid')::boolean then paid_us:=paid_us+duration_us;end if;
            end loop;
            insert into public.merchant_attendance_correction_effects(merchant_id,worker_id,start_event_id,request_id,operation_id,revision,policy_revision,proposal,time_zone,start_at,end_at,elapsed_us,break_us,paid_break_us,worked_us,recorded_at)
              values(site,req.worker_id,req.start_event_id,req.request_id,op,1,(a->'rules'->'policy'->>'revision')::bigint,proposal,
                a->'basis'->'events'->0->>'timeZone',(proposal->>'startAt')::timestamptz,(proposal->>'endAt')::timestamptz,elapsed_us,break_us,paid_us,elapsed_us-break_us,stamp);
          end if;
          insert into public.merchant_attendance_correction_delegation_decisions(merchant_id,operation_id,request_id,grant_id,
            delegate_employee_id,delegate_auth_user_id,delegate_name,worker_id,employee_id,employee_auth_user_id,location_id,
            delegate_generation,employee_generation,authorized_at,action,command,command_fingerprint,recorded_at)
            values(site,op,req.request_id,g.grant_id,de.id,p_auth_user_id,de.display_name,req.worker_id,req.employee_id,req.actor_auth_user_id,g.location_id,
              g.delegate_generation,g.employee_generation,stamp,entry.action,p_command,public.faolla_attendance_correction_delegation_hash_v1(site,'delegate',p_command),stamp) returning * into authority;
          receipt:=public.faolla_attendance_correction_delegation_receipt_v1(authority);
        else
          blockers:='[]';
          for issue in select jsonb_array_elements_text(checks->'blockers') loop
            if (issue='overlap_previous' and review->'evidence'->'previous'->>'locationId' is distinct from g.location_id::text)
              or (issue='overlap_next' and review->'evidence'->'next'->>'locationId' is distinct from g.location_id::text) then issue:='scope_unavailable';end if;
            if not blockers ? issue then blockers:=blockers||jsonb_build_array(issue);end if;
          end loop;
          detail:=public.faolla_attendance_correction_delegation_summary_v1(g,req)||jsonb_build_object('revision',a->'item'->'revision',
            'original',original,'proposal',a->'proposal','reason',a->'reason','evidenceToken',checks->'evidenceToken','blockers',blockers,
            'blocked',jsonb_array_length(blockers)>0,'canApprove',can_write and (checks->>'canApprove')::boolean,'canReject',can_write and (checks->>'canReject')::boolean);
        end if;
      end if;
    end if;
  end if;
  result:=jsonb_build_object('protocol','delegated-corrections-v1','siteId',site,'actorId',p_auth_user_id,'employeeId',de.id,'mode',mode_name,'canWrite',can_write,
    'grants',grants_json,'items',items,'nextCursor',case when mode_name='list' and seen=26 then next_cursor else null end,
    'nextId',case when mode_name='grants' and seen=26 then next_id else null end,'detail',detail,'receipt',receipt,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_correction_delegation_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;

-- Pin the actual latest185 source, not a freshly generated mirror. Re-entry
-- accepts only the exact two-predicate extension. Namespace rebinding in the
-- owned native fixture rewrites the same explicit qualified names on both sides.
do $correction_capture_preflight$
declare expected text:=$capture185$
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
$capture185$;actual text;item record;role_name text;
 addition text:=$capture_add$
    and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))$capture_add$;installed boolean;
begin
 select exists(select 1 from public.faolla_schema_migrations where version=202610080189) into installed;
 if installed then expected:=replace(expected,$capture_anchor$    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))$capture_anchor$,$capture_anchor$    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))$capture_anchor$||addition);end if;
 select p.* into item from pg_proc p where p.oid='public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'::regprocedure;
 actual:=replace(item.prosrc,E'\r\n',E'\n');
 if actual is distinct from expected or item.prosecdef or item.proconfig is distinct from array['search_path=pg_catalog']
  or item.proowner is distinct from (select proowner from pg_proc where oid='public.faolla_attendance_account_capture_pre_period_v1(text,uuid,uuid,uuid,boolean)'::regprocedure)
 then raise exception 'merchant_attendance_correction_capture_definition_conflict';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(role_name,item.oid,'EXECUTE') then raise exception 'merchant_attendance_correction_capture_acl_conflict';end if;
 end loop;
end;
$correction_capture_preflight$;
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
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  if not exists(select 1 from public.merchant_attendance_settings x where x.merchant_id=p_site) then return null;end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee;
  if e.id is null or e.status<>'disabled' or p_actor is null then raise exception 'attendance_account_suspension_invalid';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  --No worker is manufactured for a delegate. Both legacy delegate indexes start
  --with merchant/employee; target grants already require a linked worker.
  if ep.employee_id is null and w.id is null and not exists(select 1 from public.merchant_attendance_missing_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_application_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
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

do $correction_delegation_security$
declare n text;t regclass;
begin
 foreach n in array array['merchant_attendance_correction_delegations','merchant_attendance_correction_delegation_revocations','merchant_attendance_correction_delegation_decisions'] loop
  t:=to_regclass('public.'||n);
  if exists(select 1 from pg_policy where polrelid=t) then raise exception 'merchant_attendance_correction_delegation_installation_conflict';end if;
  execute format('alter table %s enable row level security',t);
  execute format('revoke all on %s from public,anon,authenticated,service_role',t);
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='correction_delegation_immutable') then
   execute format('create trigger correction_delegation_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='correction_delegation_no_truncate') then
   execute format('create trigger correction_delegation_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_correction_delegation_decisions'::regclass and tgname='correction_delegation_decision_guard') then
  create trigger correction_delegation_decision_guard before insert on public.merchant_attendance_correction_delegation_decisions
   for each row execute function public.faolla_attendance_correction_delegation_decision_guard_v1();end if;
end;
$correction_delegation_security$;
revoke all on function public.faolla_attendance_correction_delegation_command_v1(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_hash_v1(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_usable_v1(public.merchant_attendance_correction_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_grant_v1(public.merchant_attendance_correction_delegations,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_review_v1(text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_scope_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_original_v1(jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_summary_v1(public.merchant_attendance_correction_delegations,public.merchant_attendance_correction_entries) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_receipt_v1(public.merchant_attendance_correction_delegation_decisions) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegation_decision_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_correction_delegations_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_corrections_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_correction_delegations_v1(jsonb,uuid,jsonb,boolean) to service_role;
grant execute on function public.faolla_attendance_delegated_corrections_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $correction_delegation_postconditions$
declare n text;t regclass;p regprocedure;role_name text;idx oid;keys text[]:=array['merchant_id','delegate_employee_id','delegate_auth_user_id','grant_id'];
begin
  foreach n in array array['merchant_attendance_correction_delegations','merchant_attendance_correction_delegation_revocations','merchant_attendance_correction_delegation_decisions'] loop
    t:=to_regclass('public.'||n);
    if not(select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
      or not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='correction_delegation_immutable' and not g.tgisinternal and g.tgtype=27 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
      or not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='correction_delegation_no_truncate' and not g.tgisinternal and g.tgtype=34 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure) then raise exception 'merchant_attendance_correction_delegation_storage_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(role_name,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(role_name,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_correction_delegation_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_trigger g where g.tgrelid='public.merchant_attendance_correction_delegation_decisions'::regclass and g.tgname='correction_delegation_decision_guard' and not g.tgisinternal
    and g.tgtype=7 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_correction_delegation_decision_guard_v1()'::regprocedure) then raise exception 'merchant_attendance_correction_delegation_storage_postcondition_failed';end if;
  idx:=to_regclass('public.attendance_correction_delegation_delegate_idx');
  if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where c.oid=idx and c.relkind='i' and am.amname='btree' and i.indrelid='public.merchant_attendance_correction_delegations'::regclass
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null and i.indnatts=4 and i.indnkeyatts=4
      and not exists(select 1 from generate_subscripts(keys,1) z where (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1]) is distinct from keys[z]
        or i.indoption[z-1]<>0 or i.indcollation[z-1] is distinct from (select attcollation from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1])
        or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
          where o.oid=i.indclass[z-1] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_correction_delegation_index_conflict';end if;
  foreach n in array array['public.faolla_attendance_correction_delegation_command_v1(jsonb,text)',
    'public.faolla_attendance_correction_delegation_hash_v1(text,text,jsonb)',
    'public.faolla_attendance_correction_delegation_usable_v1(public.merchant_attendance_correction_delegations,timestamptz)',
    'public.faolla_attendance_correction_delegation_grant_v1(public.merchant_attendance_correction_delegations,boolean)',
    'public.faolla_attendance_correction_delegation_review_v1(text,uuid,uuid)',
    'public.faolla_attendance_correction_delegation_scope_v1(jsonb,uuid)',
    'public.faolla_attendance_correction_delegation_original_v1(jsonb,timestamptz)',
    'public.faolla_attendance_correction_delegation_summary_v1(public.merchant_attendance_correction_delegations,public.merchant_attendance_correction_entries)',
    'public.faolla_attendance_correction_delegation_receipt_v1(public.merchant_attendance_correction_delegation_decisions)',
    'public.faolla_attendance_correction_delegation_decision_guard_v1()'] loop
    p:=to_regprocedure(n);
    if p is null or not exists(select 1 from pg_proc where oid=p and not prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'merchant_attendance_correction_delegation_acl_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,p,'EXECUTE') then raise exception 'merchant_attendance_correction_delegation_acl_postcondition_failed';end if;
    end loop;
  end loop;
  foreach n in array array['public.faolla_attendance_correction_delegations_v1(jsonb,uuid,jsonb,boolean)','public.faolla_attendance_delegated_corrections_v1(jsonb,uuid,jsonb,boolean)'] loop
    p:=to_regprocedure(n);
    if p is null or not exists(select 1 from pg_proc where oid=p and prosecdef and proconfig=array['search_path=pg_catalog'])
      or not has_function_privilege('service_role',p,'EXECUTE') or has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') then raise exception 'merchant_attendance_correction_delegation_acl_postcondition_failed';end if;
  end loop;
end;
$correction_delegation_postconditions$;

insert into public.faolla_schema_migrations(version,name) values(202610080189,'merchant_attendance_correction_delegation') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
