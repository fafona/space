--191 opt-in person/category delegation, never a current-default-location scope.
--Old122/125/156/160 writers, receipts, role values and archives stay unchanged.
begin;
set local lock_timeout='3s';
do $application_delegation_prerequisites$
declare d record;installed boolean;n text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_application_delegation_prerequisite_required';end if;
  for d in select * from (values(202610030122::bigint,'merchant_attendance_leave_requests'),(202610040125::bigint,'merchant_attendance_leave_notifications'),
    (202610050150::bigint,'merchant_attendance_period_seal_guards'),(202610060156::bigint,'merchant_attendance_work_arrangements')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=d.version and m.name=d.name) then raise exception 'merchant_attendance_application_delegation_prerequisite_required';end if;
  end loop;
  foreach n in array array['public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)',
    'public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)',
    'public.faolla_attendance_work_arrangement_conflicts_v1(text,uuid,uuid,uuid,timestamptz,timestamptz,uuid)',
    'public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)','public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])',
    'public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)','public.faolla_attendance_events_append_only_v1()'] loop
    if to_regprocedure(n) is null then raise exception 'merchant_attendance_application_delegation_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060162 and name<>'merchant_attendance_application_delegation') then raise exception 'merchant_attendance_application_delegation_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060162 and name='merchant_attendance_application_delegation') into installed;
  foreach n in array array['merchant_attendance_application_delegations','merchant_attendance_application_delegation_revocations','merchant_attendance_application_delegation_decisions'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_application_delegation_installation_conflict';end if;
  end loop;
  foreach n in array array['faolla_attendance_application_delegation_command_v1','faolla_attendance_application_delegation_hash_v1',
    'faolla_attendance_application_delegation_usable_v1','faolla_attendance_application_delegation_grant_v1',
    'faolla_attendance_application_delegation_request_v1','faolla_attendance_application_delegation_review_v1',
    'faolla_attendance_application_delegation_guard_v1','faolla_attendance_application_delegation_receipt_v1',
    'faolla_attendance_application_delegations_v1','faolla_attendance_delegated_applications_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n) then raise exception 'merchant_attendance_application_delegation_installation_conflict';end if;
  end loop;
end;
$application_delegation_prerequisites$;

create or replace function public.faolla_attendance_application_delegation_command_v1(p jsonb,p_access text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare d jsonb;k text;kinds jsonb;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(convert_to(p::text,'UTF8'))>8192 then return false;end if;
  if p_access='delegate' then
    if public.faolla_attendance_shift_rule_binding_object_v1(p,array['grantId','expectedGrantRevision','expectedEvidenceFingerprint','decision']) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'grantId','uuid') is distinct from true or p->'expectedGrantRevision' is distinct from '1'::jsonb
      or jsonb_typeof(p->'expectedEvidenceFingerprint') is distinct from 'string' or coalesce(p->>'expectedEvidenceFingerprint','')!~'^[0-9a-f]{64}$' then return false;end if;
    d:=p->'decision';
    if jsonb_typeof(d) is distinct from 'object' or coalesce(d->>'action','') not in('approve','reject')
      or d->'expectedRevision' is distinct from '1'::jsonb or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'requestId','uuid') is distinct from true then return false;end if;
    if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','requestId','expectedRevision','reason']) is distinct from true then
      if d->>'action'<>'approve' or public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','requestId','expectedRevision','reason','expectedConflictsFingerprint','confirmConflicts']) is distinct from true
        or jsonb_typeof(d->'expectedConflictsFingerprint') is distinct from 'string' or coalesce(d->>'expectedConflictsFingerprint','')!~'^[0-9a-f]{64}$'
        or jsonb_typeof(d->'confirmConflicts') is distinct from 'boolean' then return false;end if;
    end if;
  elsif p_access='owner' then
    d:=p;
    if d->>'action'='grant' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','category','kinds','includePending','validFrom','validUntil','reason']) is distinct from true
        or coalesce(d->>'category','') not in('leave','work_arrangement') or jsonb_typeof(d->'includePending') is distinct from 'boolean' or jsonb_typeof(d->'kinds') is distinct from 'array' then return false;end if;
      foreach k in array array['delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId'] loop
        if public.faolla_attendance_shift_rule_binding_scalar_v1(d->k,'uuid') is distinct from true then return false;end if;
      end loop;
      if d->>'delegateEmployeeId'=d->>'employeeId' or d->>'delegateAuthUserId'=d->>'employeeAuthUserId' then return false;end if;
      select coalesce(jsonb_agg(to_jsonb(x.kind) order by x.ord),'[]') into kinds
        from (values('trip',1),('field',2),('remote',3)) x(kind,ord) where d->'kinds' ? x.kind;
      if d->'kinds' is distinct from kinds or d->>'category'='leave' and kinds<>'[]'::jsonb
        or d->>'category'='work_arrangement' and kinds='[]'::jsonb then return false;end if;
      if public.faolla_attendance_shift_rule_binding_scalar_v1(d->'validFrom','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'validUntil','stamp6') is distinct from true then return false;end if;
      if (d->>'validFrom')::timestamptz>=(d->>'validUntil')::timestamptz then return false;end if;
    elsif d->>'action'='revoke' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','grantId','expectedRevision','reason']) is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'grantId','uuid') is distinct from true or d->'expectedRevision' is distinct from '1'::jsonb then return false;end if;
    else return false;end if;
  else return false;end if;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(d->'operationId','uuid') is true and public.faolla_attendance_shift_rule_binding_scalar_v1(d->'reason','reason') is true;
end;
$$;
create or replace function public.faolla_attendance_application_delegation_hash_v1(p_site text,p_access text,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare v jsonb;d jsonb;kinds text;
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or public.faolla_attendance_application_delegation_command_v1(p,p_access) is distinct from true then raise exception 'attendance_invalid_request';end if;
  v:=jsonb_build_array('attendance-application-delegation-v1',p_site,p_access);
  if p_access='delegate' then
    d:=p->'decision';v:=v||jsonb_build_array(d->>'action',d->>'operationId',p->>'grantId',(p->>'expectedGrantRevision')::integer,p->>'expectedEvidenceFingerprint',d->>'requestId',(d->>'expectedRevision')::integer,d->>'reason',d->>'expectedConflictsFingerprint',d->'confirmConflicts');
  elsif p->>'action'='grant' then
    select coalesce(string_agg(value,',' order by ord),'') into kinds from jsonb_array_elements_text(p->'kinds') with ordinality x(value,ord);
    v:=v||jsonb_build_array(p->>'action',p->>'operationId',p->>'delegateEmployeeId',p->>'delegateAuthUserId',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId',p->>'category',kinds,(p->>'includePending')::boolean,p->>'validFrom',p->>'validUntil',p->>'reason');
  else v:=v||jsonb_build_array(p->>'action',p->>'operationId',p->>'grantId',(p->>'expectedRevision')::integer,p->>'reason');end if;
  return encode(sha256(convert_to(v::text,'UTF8')),'hex');
end;
$$;

create table if not exists public.merchant_attendance_application_delegations(
  merchant_id text not null references public.merchants(id),grant_id uuid not null,delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,delegate_name text not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,worker_name text not null,worker_no text not null,
  category text not null,kinds jsonb not null,include_pending boolean not null,valid_from timestamptz not null,valid_until timestamptz not null,
  actor_auth_user_id uuid not null,reason text not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,grant_id),foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(isfinite(valid_from) and isfinite(valid_until) and valid_from<valid_until and isfinite(recorded_at)),
  check(public.faolla_attendance_application_delegation_command_v1(command,'owner') is true and command->>'action'='grant' and command->>'operationId'=grant_id::text
    and command->>'delegateEmployeeId'=delegate_employee_id::text and command->>'delegateAuthUserId'=delegate_auth_user_id::text
    and command->>'workerId'=worker_id::text and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text
    and command->>'category'=category and command->'kinds'=kinds and (command->>'includePending')::boolean=include_pending
    and (command->>'validFrom')::timestamptz=valid_from and (command->>'validUntil')::timestamptz=valid_until and command->>'reason'=reason
    and command_fingerprint=public.faolla_attendance_application_delegation_hash_v1(merchant_id,'owner',command)),
  check(public.faolla_attendance_group_text_v1(delegate_name,1,120) and public.faolla_attendance_group_text_v1(worker_name,1,120) and public.faolla_attendance_group_text_v1(worker_no,1,40))
);
create index if not exists attendance_application_delegation_delegate_idx on public.merchant_attendance_application_delegations(merchant_id,delegate_employee_id,delegate_auth_user_id,grant_id);
create table if not exists public.merchant_attendance_application_delegation_revocations(
  merchant_id text not null,operation_id uuid not null,grant_id uuid not null,actor_auth_user_id uuid not null,reason text not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,grant_id),foreign key(merchant_id,grant_id) references public.merchant_attendance_application_delegations(merchant_id,grant_id),
  check(isfinite(recorded_at)),check(public.faolla_attendance_application_delegation_command_v1(command,'owner') is true and command->>'action'='revoke'
    and command->>'operationId'=operation_id::text and command->>'grantId'=grant_id::text and command->>'reason'=reason and command_fingerprint=public.faolla_attendance_application_delegation_hash_v1(merchant_id,'owner',command))
);
create table if not exists public.merchant_attendance_application_delegation_decisions(
  merchant_id text not null,operation_id uuid not null,request_id uuid not null,grant_id uuid not null,category text not null,
  delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,delegate_name text not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
  action text not null,command jsonb not null,command_fingerprint text not null,captured_notification boolean not null,recorded_at timestamptz not null,
  leave_operation_id uuid generated always as (case when category='leave' then operation_id else null end) stored,
  work_operation_id uuid generated always as (case when category='work_arrangement' then operation_id else null end) stored,
  primary key(merchant_id,operation_id),unique(merchant_id,category,request_id),
  foreign key(merchant_id,leave_operation_id) references public.merchant_attendance_leave_entries(merchant_id,operation_id),
  foreign key(merchant_id,work_operation_id) references public.merchant_attendance_work_arrangement_entries(merchant_id,operation_id),
  foreign key(merchant_id,grant_id) references public.merchant_attendance_application_delegations(merchant_id,grant_id),
  foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(category in('leave','work_arrangement') and action in('approve','reject') and isfinite(recorded_at) and delegate_auth_user_id<>employee_auth_user_id),
  check(not captured_notification or category='leave'),check(public.faolla_attendance_group_text_v1(delegate_name,1,120)),
  check(public.faolla_attendance_application_delegation_command_v1(command,'delegate') is true and command->>'grantId'=grant_id::text
    and command->'decision'->>'operationId'=operation_id::text and command->'decision'->>'requestId'=request_id::text and command->'decision'->>'action'=action
    and command_fingerprint=public.faolla_attendance_application_delegation_hash_v1(merchant_id,'delegate',command))
);

create or replace function public.faolla_attendance_application_delegation_usable_v1(p public.merchant_attendance_application_delegations,p_at timestamptz)
returns boolean language sql stable set search_path=pg_catalog as $$
  select p_at>=p.valid_from and p_at<p.valid_until
    and not exists(select 1 from public.merchant_attendance_application_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id)
    and exists(select 1 from public.merchant_enterprise_employees de join public.merchant_enterprise_roles dr on dr.merchant_id=de.merchant_id and dr.id=de.role_id
      join public.merchant_attendance_workers w on w.merchant_id=de.merchant_id and w.id=p.worker_id
      join public.merchant_enterprise_employees te on te.merchant_id=w.merchant_id and te.id=w.employee_id
      where de.merchant_id=p.merchant_id and de.id=p.delegate_employee_id and de.auth_user_id=p.delegate_auth_user_id and de.status='active'
        and dr.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions)
        and dr.permissions @> array['enterprise.view','attendance.self.view',case when p.category='leave' then 'attendance.leave.review' else 'attendance.work_arrangement.review' end]::text[]
        and w.active and w.employee_id=p.employee_id and te.auth_user_id=p.employee_auth_user_id and te.status='active' and de.auth_user_id<>te.auth_user_id);
$$;
create or replace function public.faolla_attendance_application_delegation_grant_v1(p public.merchant_attendance_application_delegations,p_usable boolean)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare r public.merchant_attendance_application_delegation_revocations%rowtype;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  select * into r from public.merchant_attendance_application_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id;
  return jsonb_build_object('grantId',p.grant_id,'revision',case when r.operation_id is null then 1 else 2 end,'status',case when r.operation_id is null then 'granted' else 'revoked' end,
    'delegate',jsonb_build_object('employeeId',p.delegate_employee_id,'authUserId',p.delegate_auth_user_id,'name',p.delegate_name),
    'worker',jsonb_build_object('workerId',p.worker_id,'employeeId',p.employee_id,'authUserId',p.employee_auth_user_id,'name',p.worker_name,'workerNo',p.worker_no),
    'category',p.category,'kinds',p.kinds,'includePending',p.include_pending,'validFrom',to_char(p.valid_from at time zone 'UTC',fmt),'validUntil',to_char(p.valid_until at time zone 'UTC',fmt),
    'grantedBy',p.actor_auth_user_id,'grantedAt',to_char(p.recorded_at at time zone 'UTC',fmt),'reason',p.reason,
    'revocation',case when r.operation_id is null then null else jsonb_build_object('operationId',r.operation_id,'actorId',r.actor_auth_user_id,'reason',r.reason,'recordedAt',to_char(r.recorded_at at time zone 'UTC',fmt)) end,'usable',p_usable and r.operation_id is null);
end;
$$;

--No authorization in this private bounded shape adapter. Caller must hold the
--settings/worker/employee locks and explicitly validate grant and current IDs.
create or replace function public.faolla_attendance_application_delegation_request_v1(p_site text,p_category text,p_request uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare l public.merchant_attendance_leave_requests%rowtype;w public.merchant_attendance_work_arrangement_requests%rowtype;item jsonb;r jsonb;kind_name text;
begin
  if p_category='leave' then
    select * into l from public.merchant_attendance_leave_requests x where x.merchant_id=p_site and x.request_id=p_request;
    if l.request_id is null then return null;end if;item:=public.faolla_attendance_leave_summary_v1(l);r:=to_jsonb(l);
  elsif p_category='work_arrangement' then
    select * into w from public.merchant_attendance_work_arrangement_requests x where x.merchant_id=p_site and x.request_id=p_request;
    if w.request_id is null then return null;end if;item:=public.faolla_attendance_work_arrangement_summary_v1(w);r:=to_jsonb(w);kind_name:=w.kind;
  else raise exception 'attendance_application_delegation_invalid';end if;
  return jsonb_build_object('request',r,'status',item->'status','revision',item->'revision','summary',jsonb_build_object(
    'requestId',p_request,'workerId',r->'worker_id','employeeId',r->'employee_id','employeeAuthUserId',r->'actor_auth_user_id','workerName',r->'worker_name',
    'category',p_category,'kind',kind_name,'startAt',item->'startAt','endAt',item->'endAt','timeZone',item->'timeZone','submittedAt',item->'submittedAt','status',item->'status'));
end;
$$;

--Internal evidence never leaves this helper unredacted. Scope rechecks use the
--same locked current identities and observation instant as the target grant.
create or replace function public.faolla_attendance_application_delegation_review_v1(p public.merchant_attendance_application_delegations,p_request uuid,p_at timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare body jsonb;r jsonb;summary jsonb;full_conflicts jsonb:='[]';visible jsonb:='[]';disclosure jsonb:='[]';piece jsonb;other jsonb;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;s public.merchant_attendance_settings%rowtype;
  leave_row public.merchant_attendance_leave_requests%rowtype;checked jsonb;operation_id uuid;
  a timestamptz;b timestamptz;first_day date;last_day date;day date;coverage integer;employment jsonb:='[]';employment_ok boolean:=true;binding_ok boolean;sealed boolean;
  permitted boolean;hidden boolean:=false;blocked boolean;category_name text;kind_name text;other_submitted timestamptz;conflict_hash text;evidence_hash text;source jsonb;detail jsonb;
begin
  body:=public.faolla_attendance_application_delegation_request_v1(p.merchant_id,p.category,p_request);
  if body is null then raise exception 'attendance_application_delegation_not_found';end if;
  r:=body->'request';summary:=body->'summary';
  if (r->>'worker_id')::uuid<>p.worker_id or (r->>'employee_id')::uuid<>p.employee_id or (r->>'actor_auth_user_id')::uuid<>p.employee_auth_user_id
    or p.category='work_arrangement' and not(p.kinds ? (r->>'kind')) or not p.include_pending and (r->>'submitted_at')::timestamptz<p.recorded_at
    or p.delegate_auth_user_id=p.employee_auth_user_id then raise exception 'attendance_access_denied';end if;
  if body->>'status'<>'submitted' or body->'revision'<>'1'::jsonb then raise exception 'attendance_application_delegation_not_found';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p.merchant_id and x.id=p.worker_id;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p.merchant_id and x.id=p.employee_id;
  select * into role_row from public.merchant_enterprise_roles x where x.merchant_id=p.merchant_id and x.id=e.role_id;
  select * into s from public.merchant_attendance_settings x where x.merchant_id=p.merchant_id;
  binding_ok:=coalesce(w.active and w.employee_id=p.employee_id and e.auth_user_id=p.employee_auth_user_id and e.status='active'
    and role_row.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) and 'attendance.self.view'=any(role_row.permissions),false);
  a:=(r->>'start_at')::timestamptz;b:=(r->>'end_at')::timestamptz;
  first_day:=(a at time zone (r->>'time_zone'))::date;last_day:=((b-interval '1 microsecond') at time zone (r->>'time_zone'))::date;
  for day in select generate_series(first_day::timestamp,last_day::timestamp,interval '1 day')::date loop
    if ((day::timestamp at time zone (r->>'time_zone')) at time zone (r->>'time_zone'))::date<>day then continue;end if;
    select count(*) into coverage from public.merchant_attendance_employment_periods x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id and x.starts_on<=day and (x.ends_on is null or x.ends_on>=day);
    employment:=employment||jsonb_build_array(jsonb_build_array(to_char(day,'YYYY-MM-DD'),coverage));
    if coverage<>1 then employment_ok:=false;end if;
  end loop;
  sealed:=exists(select 1 from public.merchant_attendance_period_closures c where c.merchant_id=p.merchant_id and c.worker_id=p.worker_id and c.sealed and c.start_at<b and c.end_at>a);
  if p.category='work_arrangement' then
    full_conflicts:=public.faolla_attendance_work_arrangement_conflicts_v1(p.merchant_id,p.worker_id,p.employee_id,p.employee_auth_user_id,a,b,p_request);
  else
    --Preserve122's hard prohibition on any other effective approved leave.
    for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id
      and x.request_id<>p_request and x.start_at>=a-interval '8784 hours' and x.start_at<b and x.end_at>a
      and exists(select 1 from public.merchant_attendance_leave_entries d where d.merchant_id=x.merchant_id and d.request_id=x.request_id and d.revision=2 and d.action='approve')
      and not exists(select 1 from public.merchant_attendance_leave_entries t where t.merchant_id=x.merchant_id and t.request_id=x.request_id and t.revision=3)
      order by x.start_at,x.request_id limit 101 loop
      if jsonb_array_length(full_conflicts)>=100 then raise exception 'attendance_application_delegation_too_large';end if;
      if leave_row.employee_id<>p.employee_id or leave_row.actor_auth_user_id<>p.employee_auth_user_id then raise exception 'attendance_leave_binding_changed';end if;
      checked:=public.faolla_attendance_leave_summary_v1(leave_row);
      select d.operation_id into operation_id from public.merchant_attendance_leave_entries d where d.merchant_id=p.merchant_id and d.request_id=leave_row.request_id and d.revision=2;
      if checked->>'status'<>'approved' then raise exception 'attendance_application_delegation_invalid';end if;
      full_conflicts:=full_conflicts||jsonb_build_array(jsonb_build_object('source','leave','id',leave_row.request_id,'operationId',operation_id,'status','approved','revision',2,
        'kind',null,'startAt',checked->'startAt','endAt',checked->'endAt','timeZone',leave_row.time_zone));
    end loop;
    select coalesce(jsonb_agg(x order by x->>'source',x->>'id'),'[]') into full_conflicts from jsonb_array_elements(full_conflicts) x;
  end if;
  conflict_hash:=encode(sha256(convert_to(full_conflicts::text,'UTF8')),'hex');
  for piece in select value from jsonb_array_elements(full_conflicts) loop
    permitted:=piece->>'source'='schedule';kind_name:=null;
    if not permitted then
      category_name:=case when piece->>'source'='leave' then 'leave' else 'work_arrangement' end;
      other:=public.faolla_attendance_application_delegation_request_v1(p.merchant_id,category_name,(piece->>'id')::uuid);
      if other is null or other->>'status' is distinct from piece->>'status'
        or (other->'request'->>'worker_id')::uuid<>p.worker_id or (other->'request'->>'employee_id')::uuid<>p.employee_id
        or (other->'request'->>'actor_auth_user_id')::uuid<>p.employee_auth_user_id then raise exception 'attendance_application_delegation_invalid';end if;
      kind_name:=case when category_name='leave' then 'leave' else other->'request'->>'kind' end;
      other_submitted:=(other->'request'->>'submitted_at')::timestamptz;
      select exists(select 1 from public.merchant_attendance_application_delegations g where g.merchant_id=p.merchant_id
        and g.delegate_employee_id=p.delegate_employee_id and g.delegate_auth_user_id=p.delegate_auth_user_id and g.worker_id=p.worker_id
        and g.employee_id=p.employee_id and g.employee_auth_user_id=p.employee_auth_user_id and g.category=category_name
        and (category_name='leave' or g.kinds ? kind_name)
        and (other_submitted>=g.recorded_at or g.include_pending and other->>'status'='submitted')
        and public.faolla_attendance_application_delegation_usable_v1(g,p_at)) into permitted;
    end if;
    disclosure:=disclosure||jsonb_build_array(jsonb_build_object('source',piece->'source','id',piece->'id','permitted',permitted));
    if permitted then
      visible:=visible||jsonb_build_array(jsonb_build_object('source',case when piece->>'source'='schedule' then 'schedule' else 'application' end,
        'kind',kind_name,'startAt',piece->'startAt','endAt',piece->'endAt','timeZone',piece->'timeZone'));
    else hidden:=true;end if;
  end loop;
  blocked:=not binding_ok or not employment_ok or sealed or hidden or p.category='leave' and jsonb_array_length(full_conflicts)>0;
  --Canonical evidence omits observation time and session-GUC-rendered row data.
  source:=jsonb_build_object('policy','person-application-review-v1','grantId',p.grant_id,'request',summary,'reason',r->'reason',
    'savedSettingsVersion',r->'settings_version','savedPolicyRevision',r->'policy_revision','savedRetrospectiveDays',r->'retrospective_days',
    'settingsVersion',s.version,'workerVersion',w.version,'employeeVersion',e.version,'roleVersion',role_row.version,
    'employment',employment,'bindingOk',binding_ok,'sealed',sealed,'conflicts',full_conflicts,'disclosure',disclosure);
  evidence_hash:=encode(sha256(convert_to(source::text,'UTF8')),'hex');
  detail:=summary||jsonb_build_object('reason',r->'reason','evidenceFingerprint',evidence_hash,'conflictsFingerprint',conflict_hash,'conflicts',visible,
    'blocked',blocked,'sealed',sealed,'canApprove',not blocked,'canReject',true);
  if octet_length(convert_to(source::text,'UTF8'))>1048576 then raise exception 'attendance_application_delegation_too_large';end if;
  return jsonb_build_object('detail',detail,'request',r,'bindingOk',binding_ok,'employmentOk',employment_ok,'hiddenConflict',hidden,'fullConflicts',full_conflicts);
end;
$$;

--Bounded historical receipt proof; intentionally no current owner/role test.
create or replace function public.faolla_attendance_application_delegation_receipt_v1(p public.merchant_attendance_application_delegation_decisions)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_application_delegations%rowtype;b jsonb;r jsonb;entry_json jsonb;n public.merchant_attendance_leave_notifications%rowtype;
begin
  select * into g from public.merchant_attendance_application_delegations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id;
  b:=public.faolla_attendance_application_delegation_request_v1(p.merchant_id,p.category,p.request_id);r:=b->'request';
  if p.category='leave' then select to_jsonb(x) into entry_json from public.merchant_attendance_leave_entries x where x.merchant_id=p.merchant_id and x.operation_id=p.operation_id;
  else select to_jsonb(x) into entry_json from public.merchant_attendance_work_arrangement_entries x where x.merchant_id=p.merchant_id and x.operation_id=p.operation_id;end if;
  if g.grant_id is null or b is null or entry_json is null or g.category<>p.category
    or (g.delegate_employee_id,g.delegate_auth_user_id,g.worker_id,g.employee_id,g.employee_auth_user_id)
      is distinct from (p.delegate_employee_id,p.delegate_auth_user_id,p.worker_id,p.employee_id,p.employee_auth_user_id)
    or (r->>'worker_id')::uuid<>p.worker_id or (r->>'employee_id')::uuid<>p.employee_id or (r->>'actor_auth_user_id')::uuid<>p.employee_auth_user_id
    or p.category='work_arrangement' and not(g.kinds ? (r->>'kind'))
    or not g.include_pending and (r->>'submitted_at')::timestamptz<g.recorded_at
    or p.recorded_at<g.valid_from or p.recorded_at>=g.valid_until or p.delegate_auth_user_id=p.employee_auth_user_id
    or entry_json->>'request_id' is distinct from p.request_id::text or entry_json->'revision' is distinct from '2'::jsonb
    or entry_json->>'action' is distinct from p.action or entry_json->>'actor_auth_user_id' is distinct from p.delegate_auth_user_id::text
    or entry_json->'command' is distinct from p.command->'decision' or (entry_json->>'recorded_at')::timestamptz is distinct from p.recorded_at
    or p.command_fingerprint is distinct from public.faolla_attendance_application_delegation_hash_v1(p.merchant_id,'delegate',p.command)
    or p.category='leave' and public.faolla_attendance_shift_rule_binding_object_v1(p.command->'decision',array['action','operationId','requestId','expectedRevision','reason']) is distinct from true
    or p.category='work_arrangement' and public.faolla_attendance_work_arrangement_command_v1(p.command->'decision') is distinct from true then raise exception 'attendance_application_delegation_invalid';end if;
  select * into n from public.merchant_attendance_leave_notifications x where x.merchant_id=p.merchant_id and x.notification_id=p.operation_id;
  if p.captured_notification then
    if n.notification_id is null or (n.request_id,n.worker_id,n.employee_id,n.recipient_auth_user_id,n.revision,n.action,n.decided_at)
      is distinct from (p.request_id,p.worker_id,p.employee_id,p.employee_auth_user_id,2,p.action,p.recorded_at) then raise exception 'attendance_application_delegation_invalid';end if;
  elsif p.category='leave' and n.notification_id is not null then raise exception 'attendance_application_delegation_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'requestId',p.request_id,'grantId',p.grant_id,'category',p.category,'action',p.action,
    'status',case when p.action='approve' then 'approved' else 'rejected' end,'actorId',p.delegate_auth_user_id,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',p.command_fingerprint);
end;
$$;
create or replace function public.faolla_attendance_application_delegation_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  perform public.faolla_attendance_application_delegation_receipt_v1(new);
  if exists(select 1 from public.merchant_attendance_application_delegation_revocations x where x.merchant_id=new.merchant_id and x.grant_id=new.grant_id) then raise exception 'attendance_application_delegation_invalid';end if;
  return new;
end;
$$;
do $application_delegation_storage$
declare n text;t regclass;
begin
  foreach n in array array['merchant_attendance_application_delegations','merchant_attendance_application_delegation_revocations','merchant_attendance_application_delegation_decisions'] loop
    t:=to_regclass('public.'||n);
    execute format('alter table %s enable row level security',t);
    execute format('revoke all on table %s from public,anon,authenticated,service_role',t);
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='application_delegation_immutable') then
      execute format('create trigger application_delegation_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='application_delegation_no_truncate') then
      execute format('create trigger application_delegation_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_application_delegation_decisions'::regclass and tgname='application_delegation_decision_guard') then
    create trigger application_delegation_decision_guard before insert on public.merchant_attendance_application_delegation_decisions for each row execute function public.faolla_attendance_application_delegation_guard_v1();
  end if;
end;
$application_delegation_storage$;

create or replace function public.faolla_attendance_application_delegations_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false,p_capture_notifications boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;kind text;k text;after_id uuid;target_grant_id uuid;op uuid;action_name text;stamp timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  de public.merchant_enterprise_employees%rowtype;te public.merchant_enterprise_employees%rowtype;dr public.merchant_enterprise_roles%rowtype;
  g public.merchant_attendance_application_delegations%rowtype;rv public.merchant_attendance_application_delegation_revocations%rowtype;
  candidate record;items jsonb:='[]';catalog_items jsonb:='[]';detail jsonb;receipt jsonb;result jsonb;next_id uuid;seen integer:=0;can_write boolean;
  fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_capture_notifications is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','catalog','afterId','grantId','operationId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$'
    or p_query->>'access' is distinct from 'owner' or coalesce(p_query->>'mode','') not in('list','catalog','detail','recover') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';mode_name:=p_query->>'mode';kind:=p_query->>'catalog';
  foreach k in array array['afterId','grantId','operationId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  after_id:=(p_query->>'afterId')::uuid;target_grant_id:=(p_query->>'grantId')::uuid;op:=(p_query->>'operationId')::uuid;
  if (mode_name='catalog' and (kind is null or kind not in('delegates','workers') or target_grant_id is not null or op is not null))
    or (mode_name<>'catalog' and p_query->'catalog'<>'null'::jsonb)
    or (mode_name='list' and (target_grant_id is not null or op is not null))
    or (mode_name='detail' and (target_grant_id is null or op is not null or after_id is not null))
    or (mode_name='recover' and (op is null or target_grant_id is not null or after_id is not null)) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_application_delegation_command_v1(p_command,'owner') is distinct from true then raise exception 'attendance_invalid_request';end if;
    action_name:=p_command->>'action';
    if (action_name='grant' and (mode_name<>'list' or after_id is not null))
      or (action_name='revoke' and (mode_name<>'detail' or p_command->>'grantId' is distinct from target_grant_id::text)) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  perform 1 from public.merchants m where m.id=site and m.user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings x where x.merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if not p_allow_write and mode_name<>'recover' and action_name is distinct from 'revoke' then raise exception 'attendance_application_delegation_disabled';end if;
  can_write:=p_allow_write and s.enabled;
  if op is not null then
    select * into g from public.merchant_attendance_application_delegations x where x.merchant_id=site and x.grant_id=op;
    select * into rv from public.merchant_attendance_application_delegation_revocations x where x.merchant_id=site and x.operation_id=op;
    if g.grant_id is not null and rv.operation_id is not null then raise exception 'attendance_application_delegation_invalid';end if;
    if g.grant_id is not null then
      if g.actor_auth_user_id<>p_auth_user_id or p_command is not null and g.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if g.command_fingerprint is distinct from public.faolla_attendance_application_delegation_hash_v1(site,'owner',g.command) then raise exception 'attendance_application_delegation_invalid';end if;
      receipt:=jsonb_build_object('operationId',g.grant_id,'action','grant','grantId',g.grant_id,'revision',1,'recordedAt',to_char(g.recorded_at at time zone 'UTC',fmt),'commandFingerprint',g.command_fingerprint);
    elsif rv.operation_id is not null then
      if rv.actor_auth_user_id<>p_auth_user_id or p_command is not null and rv.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if rv.command_fingerprint is distinct from public.faolla_attendance_application_delegation_hash_v1(site,'owner',rv.command) then raise exception 'attendance_application_delegation_invalid';end if;
      receipt:=jsonb_build_object('operationId',rv.operation_id,'action','revoke','grantId',rv.grant_id,'revision',2,'recordedAt',to_char(rv.recorded_at at time zone 'UTC',fmt),'commandFingerprint',rv.command_fingerprint);
    end if;
  end if;
  if p_command is not null and receipt is null then
    if action_name='grant' then
      if not can_write then raise exception 'attendance_platform_paused';end if;
      select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=(p_command->>'workerId')::uuid for update;
      perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id in((p_command->>'delegateEmployeeId')::uuid,(p_command->>'employeeId')::uuid) order by x.id for share;
      select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=(p_command->>'delegateEmployeeId')::uuid;
      select * into te from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=(p_command->>'employeeId')::uuid;
      select * into dr from public.merchant_enterprise_roles x where x.merchant_id=site and x.id=de.role_id for share;
      if w.id is null or not w.active or w.employee_id is distinct from te.id or te.id is null or te.status<>'active' or te.auth_user_id is distinct from (p_command->>'employeeAuthUserId')::uuid
        or de.id is null or de.status<>'active' or de.auth_user_id is distinct from (p_command->>'delegateAuthUserId')::uuid
        or dr.id is null or dr.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) is distinct from true
        or not(dr.permissions @> array['enterprise.view','attendance.self.view',case when p_command->>'category'='leave' then 'attendance.leave.review' else 'attendance.work_arrangement.review' end]::text[])
        or de.id=te.id or de.auth_user_id=te.auth_user_id then raise exception 'attendance_access_denied';end if;
      stamp:=clock_timestamp();
      insert into public.merchant_attendance_application_delegations(merchant_id,grant_id,delegate_employee_id,delegate_auth_user_id,delegate_name,
        worker_id,employee_id,employee_auth_user_id,worker_name,worker_no,category,kinds,include_pending,valid_from,valid_until,actor_auth_user_id,reason,command,command_fingerprint,recorded_at)
      values(site,op,de.id,de.auth_user_id,de.display_name,w.id,te.id,te.auth_user_id,w.display_name,w.worker_no,p_command->>'category',p_command->'kinds',(p_command->>'includePending')::boolean,
        (p_command->>'validFrom')::timestamptz,(p_command->>'validUntil')::timestamptz,p_auth_user_id,p_command->>'reason',p_command,
        public.faolla_attendance_application_delegation_hash_v1(site,'owner',p_command),stamp) returning * into g;
      receipt:=jsonb_build_object('operationId',op,'action','grant','grantId',op,'revision',1,'recordedAt',to_char(stamp at time zone 'UTC',fmt),'commandFingerprint',g.command_fingerprint);
    else
      select * into g from public.merchant_attendance_application_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
      if g.grant_id is null then raise exception 'attendance_application_delegation_not_found';end if;
      perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for update;
      if exists(select 1 from public.merchant_attendance_application_delegation_revocations x where x.merchant_id=site and x.grant_id=g.grant_id) then raise exception 'attendance_version_conflict';end if;
      stamp:=clock_timestamp();
      insert into public.merchant_attendance_application_delegation_revocations(merchant_id,operation_id,grant_id,actor_auth_user_id,reason,command,command_fingerprint,recorded_at)
        values(site,op,g.grant_id,p_auth_user_id,p_command->>'reason',p_command,public.faolla_attendance_application_delegation_hash_v1(site,'owner',p_command),stamp) returning * into rv;
      receipt:=jsonb_build_object('operationId',op,'action','revoke','grantId',g.grant_id,'revision',2,'recordedAt',to_char(stamp at time zone 'UTC',fmt),'commandFingerprint',rv.command_fingerprint);
    end if;
  elsif p_command is null and mode_name='detail' then
    select * into g from public.merchant_attendance_application_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
    if g.grant_id is null then raise exception 'attendance_application_delegation_not_found';end if;
    detail:=public.faolla_attendance_application_delegation_grant_v1(g,can_write and public.faolla_attendance_application_delegation_usable_v1(g,clock_timestamp()));
  elsif p_command is null and mode_name='list' then
    for g in select x.* from public.merchant_attendance_application_delegations x where x.merchant_id=site and (after_id is null or x.grant_id>after_id) order by x.grant_id limit 26 loop
      seen:=seen+1;exit when seen=26;
      items:=items||jsonb_build_array(public.faolla_attendance_application_delegation_grant_v1(g,can_write and public.faolla_attendance_application_delegation_usable_v1(g,clock_timestamp())));next_id:=g.grant_id;
    end loop;
  elsif p_command is null and mode_name='catalog' then
    for candidate in
      select c.* from (
        select x.id,x.display_name name,x.id employee_id,x.auth_user_id member_auth,null::text worker_no,null::text zone
          from public.merchant_enterprise_employees x join public.merchant_enterprise_roles r on r.merchant_id=x.merchant_id and r.id=x.role_id
          where kind='delegates' and x.merchant_id=site and x.status='active' and x.auth_user_id is not null and r.status='active'
            and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) and r.permissions @> array['enterprise.view','attendance.self.view']::text[] and r.permissions && array['attendance.leave.review','attendance.work_arrangement.review']::text[]
            and (after_id is null or x.id>after_id)
        union all
        select x.id,x.display_name,e.id,e.auth_user_id,x.worker_no,null::text from public.merchant_attendance_workers x
          join public.merchant_enterprise_employees e on e.merchant_id=x.merchant_id and e.id=x.employee_id
          where kind='workers' and x.merchant_id=site and x.active and e.status='active' and e.auth_user_id is not null and (after_id is null or x.id>after_id)
      ) c order by c.id limit 26 loop
      seen:=seen+1;exit when seen=26;
      catalog_items:=catalog_items||jsonb_build_array(jsonb_build_object('id',candidate.id,'name',candidate.name,'employeeId',candidate.employee_id,
        'employeeAuthUserId',candidate.member_auth,'workerNo',candidate.worker_no,'timeZone',candidate.zone));next_id:=candidate.id;
    end loop;
  end if;
  result:=jsonb_build_object('protocol','application-delegations-v1','siteId',site,'actorId',p_auth_user_id,'mode',mode_name,'timeZone',s.time_zone,'canWrite',can_write,
    'items',items,'catalogItems',catalog_items,'nextId',case when seen=26 then next_id else null end,'detail',detail,'receipt',receipt,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_application_delegation_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;

create or replace function public.faolla_attendance_delegated_applications_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false,p_capture_notifications boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;k text;target_grant_id uuid;target_request_id uuid;op uuid;cursor_at timestamptz;cursor_id uuid;after_id uuid;stamp timestamptz;
  s public.merchant_attendance_settings%rowtype;de public.merchant_enterprise_employees%rowtype;te public.merchant_enterprise_employees%rowtype;
  dr public.merchant_enterprise_roles%rowtype;w public.merchant_attendance_workers%rowtype;
  g public.merchant_attendance_application_delegations%rowtype;authority public.merchant_attendance_application_delegation_decisions%rowtype;
  candidate record;body jsonb;req_json jsonb;item jsonb;snapshot jsonb;action_name text;
  grants_json jsonb:='[]';items jsonb:='[]';detail jsonb;receipt jsonb;review jsonb;decision jsonb;result jsonb;next_cursor jsonb;next_id uuid;
  seen integer:=0;can_write boolean:=false;sealed boolean;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_capture_notifications is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','grantId','requestId','operationId','beforeAt','beforeId','afterId']) is distinct from true
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
    if public.faolla_attendance_application_delegation_command_v1(p_command,'delegate') is distinct from true
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
    select * into authority from public.merchant_attendance_application_delegation_decisions x where x.merchant_id=site and x.operation_id=op;
    select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.auth_user_id=p_auth_user_id for share;
    if de.id is null or authority.operation_id is not null and (authority.delegate_auth_user_id<>p_auth_user_id or authority.delegate_employee_id<>de.id) then raise exception 'attendance_access_denied';end if;
    if authority.operation_id is not null then receipt:=public.faolla_attendance_application_delegation_receipt_v1(authority);end if;
  else
    if not p_allow_write then raise exception 'attendance_application_delegation_disabled';end if;
    --Identify without taking an employee lock before the selected worker.
    select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.auth_user_id=p_auth_user_id;
    if de.id is null then raise exception 'attendance_access_denied';end if;
    if target_grant_id is not null then
      select * into g from public.merchant_attendance_application_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
      if g.grant_id is null or g.delegate_employee_id<>de.id or g.delegate_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is null then select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for share;
      else select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for update;end if;
      perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id in(g.delegate_employee_id,g.employee_id) order by x.id for share;
      select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=g.delegate_employee_id;
      select * into te from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=g.employee_id;
      if w.id is null or not w.active or w.employee_id is distinct from g.employee_id or te.id is null or te.auth_user_id is distinct from g.employee_auth_user_id
        or te.status<>'active' or de.auth_user_id is distinct from g.delegate_auth_user_id then raise exception 'attendance_access_denied';end if;
    else
      select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=de.id for share;
    end if;
    perform 1 from public.merchant_enterprise_roles x where x.merchant_id=site and x.id in(de.role_id,te.role_id) order by x.id for share;
    select * into dr from public.merchant_enterprise_roles x where x.merchant_id=site and x.id=de.role_id;
    if de.id is null or de.auth_user_id is distinct from p_auth_user_id or de.status<>'active' or dr.id is null or dr.status<>'active'
      or public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) is distinct from true
      or not(dr.permissions @> array['enterprise.view','attendance.self.view']::text[] and dr.permissions && array['attendance.leave.review','attendance.work_arrangement.review']::text[]) then raise exception 'attendance_access_denied';end if;
    stamp:=clock_timestamp();can_write:=p_allow_write and s.enabled;
    if g.grant_id is not null and public.faolla_attendance_application_delegation_usable_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;

    if mode_name='grants' then
      for g in select x.* from public.merchant_attendance_application_delegations x where can_write and x.merchant_id=site and x.delegate_employee_id=de.id and x.delegate_auth_user_id=p_auth_user_id
        and (after_id is null or x.grant_id>after_id) and public.faolla_attendance_application_delegation_usable_v1(x,stamp)
        order by x.grant_id limit 26 loop
        seen:=seen+1;exit when seen=26;
        grants_json:=grants_json||jsonb_build_array(public.faolla_attendance_application_delegation_grant_v1(g,can_write));next_id:=g.grant_id;
      end loop;
    elsif mode_name='list' then
      --Exact saved people/category/submission scope BEFORE the 25+1 cursor budget.
      for candidate in select c.* from (
        select x.request_id,x.submitted_at from public.merchant_attendance_leave_requests x where g.category='leave' and x.merchant_id=site and x.worker_id=g.worker_id
          and x.employee_id=g.employee_id and x.actor_auth_user_id=g.employee_auth_user_id and (g.include_pending or x.submitted_at>=g.recorded_at)
          and not exists(select 1 from public.merchant_attendance_leave_entries t where t.merchant_id=x.merchant_id and t.request_id=x.request_id and t.revision=2)
          and (cursor_at is null or (x.submitted_at,x.request_id)<(cursor_at,cursor_id))
        union all
        select x.request_id,x.submitted_at from public.merchant_attendance_work_arrangement_requests x where g.category='work_arrangement' and x.merchant_id=site and x.worker_id=g.worker_id
          and x.employee_id=g.employee_id and x.actor_auth_user_id=g.employee_auth_user_id and g.kinds ? x.kind and (g.include_pending or x.submitted_at>=g.recorded_at)
          and not exists(select 1 from public.merchant_attendance_work_arrangement_entries t where t.merchant_id=x.merchant_id and t.request_id=x.request_id and t.revision=2)
          and (cursor_at is null or (x.submitted_at,x.request_id)<(cursor_at,cursor_id))
      ) c order by c.submitted_at desc,c.request_id desc limit 26 loop
        seen:=seen+1;exit when seen=26;
        body:=public.faolla_attendance_application_delegation_request_v1(site,g.category,candidate.request_id);
        if body->>'status' is distinct from 'submitted' then raise exception 'attendance_application_delegation_invalid';end if;
        items:=items||jsonb_build_array(body->'summary');next_cursor:=jsonb_build_object('at',to_char(candidate.submitted_at at time zone 'UTC',fmt),'id',candidate.request_id);
      end loop;
    else
      if p_command is not null then
        if not can_write then raise exception 'attendance_platform_paused';end if;
        if g.category='leave' and public.faolla_attendance_shift_rule_binding_object_v1(decision,array['action','operationId','requestId','expectedRevision','reason']) is distinct from true
          or g.category='work_arrangement' and public.faolla_attendance_work_arrangement_command_v1(decision) is distinct from true then raise exception 'attendance_invalid_request';end if;
        select * into authority from public.merchant_attendance_application_delegation_decisions x where x.merchant_id=site and x.operation_id=op;
        if authority.operation_id is not null then
          if authority.delegate_employee_id<>de.id or authority.delegate_auth_user_id<>p_auth_user_id or authority.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
          receipt:=public.faolla_attendance_application_delegation_receipt_v1(authority);
        elsif exists(select 1 from public.merchant_attendance_leave_entries x where x.merchant_id=site and x.operation_id=op)
          or exists(select 1 from public.merchant_attendance_work_arrangement_entries x where x.merchant_id=site and x.operation_id=op) then
          --Legacy operations, including the other category, never acquire authority.
          raise exception 'attendance_operation_conflict';
        end if;
      end if;
      if receipt is null then
        review:=public.faolla_attendance_application_delegation_review_v1(g,target_request_id,stamp);
        req_json:=review->'request';item:=review->'detail';
        if p_command is not null then
          if p_command->>'expectedEvidenceFingerprint' is distinct from item->>'evidenceFingerprint' then raise exception 'attendance_application_delegation_evidence_changed';end if;
          action_name:=decision->>'action';
          if action_name='approve' then
            --Only the NEW delegated approval gains this sealed-span guard.
            perform public.faolla_attendance_period_assert_open_v1(site,g.worker_id,jsonb_build_array(jsonb_build_object(
              'startAt',to_char((item->>'startAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
              'endAt',to_char((item->>'endAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))));
            if review->'bindingOk' is distinct from 'true'::jsonb then
              if g.category='leave' then raise exception 'attendance_leave_binding_changed';else raise exception 'attendance_work_arrangement_binding_changed';end if;end if;
            if review->'employmentOk' is distinct from 'true'::jsonb then
              if g.category='leave' then raise exception 'attendance_leave_outside_employment';else raise exception 'attendance_work_arrangement_outside_employment';end if;end if;
            if review->'hiddenConflict' is distinct from 'false'::jsonb then raise exception 'attendance_access_denied';end if;
            if g.category='leave' then
              if jsonb_array_length(review->'fullConflicts')>0 then raise exception 'attendance_leave_overlap';end if;
            else
              if decision->>'expectedConflictsFingerprint' is distinct from item->>'conflictsFingerprint' then raise exception 'attendance_work_arrangement_conflicts_changed';end if;
              if jsonb_array_length(review->'fullConflicts')>0 and decision->'confirmConflicts' is distinct from 'true'::jsonb then raise exception 'attendance_work_arrangement_conflict_confirmation_required';end if;
            end if;
          end if;
          stamp:=clock_timestamp();
          if public.faolla_attendance_application_delegation_usable_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;
          if stamp<(req_json->>'submitted_at')::timestamptz then raise exception 'attendance_version_conflict';end if;
          if g.category='leave' then
            snapshot:=jsonb_build_object('requestId',target_request_id,'workerName',req_json->'worker_name','startAt',item->'startAt','endAt',item->'endAt',
              'timeZone',item->'timeZone','submittedAt',item->'submittedAt','revision',2,'status',case when action_name='approve' then 'approved' else 'rejected' end);
            insert into public.merchant_attendance_leave_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
              values(site,op,target_request_id,2,action_name,p_auth_user_id,decision,snapshot,stamp);
            if p_capture_notifications then
              insert into public.merchant_attendance_leave_notifications(merchant_id,notification_id,request_id,worker_id,employee_id,recipient_auth_user_id,revision,action,decided_at)
                values(site,op,target_request_id,g.worker_id,g.employee_id,g.employee_auth_user_id,2,action_name,stamp);
            end if;
          else
            --Reuse the exact16-field old summary, changing only terminal head.
            snapshot:=public.faolla_attendance_application_delegation_request_v1(site,g.category,target_request_id);
            select public.faolla_attendance_work_arrangement_summary_v1(x) into snapshot from public.merchant_attendance_work_arrangement_requests x where x.merchant_id=site and x.request_id=target_request_id;
            snapshot:=snapshot||jsonb_build_object('revision',2,'status',case when action_name='approve' then 'approved' else 'rejected' end);
            insert into public.merchant_attendance_work_arrangement_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
              values(site,op,target_request_id,2,action_name,p_auth_user_id,decision,snapshot,stamp);
          end if;
          insert into public.merchant_attendance_application_delegation_decisions(merchant_id,operation_id,request_id,grant_id,category,delegate_employee_id,delegate_auth_user_id,delegate_name,
            worker_id,employee_id,employee_auth_user_id,action,command,command_fingerprint,captured_notification,recorded_at)
          values(site,op,target_request_id,g.grant_id,g.category,de.id,p_auth_user_id,de.display_name,g.worker_id,g.employee_id,g.employee_auth_user_id,
            action_name,p_command,public.faolla_attendance_application_delegation_hash_v1(site,'delegate',p_command),g.category='leave' and p_capture_notifications,stamp) returning * into authority;
          receipt:=public.faolla_attendance_application_delegation_receipt_v1(authority);
        else
          detail:=item||jsonb_build_object('canApprove',can_write and (item->>'canApprove')::boolean,'canReject',can_write and (item->>'canReject')::boolean);
        end if;
      end if;
    end if;
  end if;
  result:=jsonb_build_object('protocol','delegated-applications-v1','siteId',site,'actorId',p_auth_user_id,'employeeId',de.id,'mode',mode_name,'canWrite',can_write,
    'grants',grants_json,'items',items,'nextCursor',case when mode_name='list' and seen=26 then next_cursor else null end,
    'nextId',case when mode_name='grants' and seen=26 then next_id else null end,'detail',detail,'receipt',receipt,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_application_delegation_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_application_delegation_command_v1(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_hash_v1(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_grant_v1(public.merchant_attendance_application_delegations,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_receipt_v1(public.merchant_attendance_application_delegation_decisions) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_request_v1(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_review_v1(public.merchant_attendance_application_delegations,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegations_v1(jsonb,uuid,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_applications_v1(jsonb,uuid,jsonb,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_application_delegations_v1(jsonb,uuid,jsonb,boolean,boolean) to service_role;
grant execute on function public.faolla_attendance_delegated_applications_v1(jsonb,uuid,jsonb,boolean,boolean) to service_role;

do $application_delegation_postconditions$
declare n text;t regclass;p regprocedure;role_name text;idx oid;keys text[]:=array['merchant_id','delegate_employee_id','delegate_auth_user_id','grant_id'];
begin
  foreach n in array array['merchant_attendance_application_delegations','merchant_attendance_application_delegation_revocations','merchant_attendance_application_delegation_decisions'] loop
    t:=to_regclass('public.'||n);
    if not(select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
      or not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='application_delegation_immutable' and not g.tgisinternal and g.tgtype=27 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
      or not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='application_delegation_no_truncate' and not g.tgisinternal and g.tgtype=34 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure) then raise exception 'merchant_attendance_application_delegation_storage_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(role_name,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(role_name,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_application_delegation_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_trigger g where g.tgrelid='public.merchant_attendance_application_delegation_decisions'::regclass and g.tgname='application_delegation_decision_guard' and not g.tgisinternal
    and g.tgtype=7 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_application_delegation_guard_v1()'::regprocedure) then raise exception 'merchant_attendance_application_delegation_storage_postcondition_failed';end if;
  idx:=to_regclass('public.attendance_application_delegation_delegate_idx');
  if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where c.oid=idx and c.relkind='i' and am.amname='btree' and i.indrelid='public.merchant_attendance_application_delegations'::regclass
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null and i.indnatts=4 and i.indnkeyatts=4
      and not exists(select 1 from generate_subscripts(keys,1) z where (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1]) is distinct from keys[z]
        or i.indoption[z-1]<>0 or i.indcollation[z-1] is distinct from (select attcollation from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1])
        or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
          where o.oid=i.indclass[z-1] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_application_delegation_index_conflict';end if;
  foreach n in array array['public.faolla_attendance_application_delegation_command_v1(jsonb,text)','public.faolla_attendance_application_delegation_hash_v1(text,text,jsonb)',
    'public.faolla_attendance_application_delegation_guard_v1()','public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz)',
    'public.faolla_attendance_application_delegation_grant_v1(public.merchant_attendance_application_delegations,boolean)',
    'public.faolla_attendance_application_delegation_receipt_v1(public.merchant_attendance_application_delegation_decisions)',
    'public.faolla_attendance_application_delegation_request_v1(text,text,uuid)',
    'public.faolla_attendance_application_delegation_review_v1(public.merchant_attendance_application_delegations,uuid,timestamptz)'] loop
    p:=to_regprocedure(n);
    if p is null or not exists(select 1 from pg_proc where oid=p and not prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'merchant_attendance_application_delegation_acl_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,p,'EXECUTE') then raise exception 'merchant_attendance_application_delegation_acl_postcondition_failed';end if;
    end loop;
  end loop;
  foreach n in array array['public.faolla_attendance_application_delegations_v1(jsonb,uuid,jsonb,boolean,boolean)','public.faolla_attendance_delegated_applications_v1(jsonb,uuid,jsonb,boolean,boolean)'] loop
    p:=to_regprocedure(n);
    if p is null or not exists(select 1 from pg_proc where oid=p and prosecdef and proconfig=array['search_path=pg_catalog'])
      or not has_function_privilege('service_role',p,'EXECUTE') or has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') then raise exception 'merchant_attendance_application_delegation_acl_postcondition_failed';end if;
  end loop;
end;
$application_delegation_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610060162,'merchant_attendance_application_delegation') on conflict(version) do nothing;
commit;
