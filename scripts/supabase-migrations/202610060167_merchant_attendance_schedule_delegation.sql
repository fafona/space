--198 explicit person/location schedule delegation. Original099/136 writers stay
--owner-only. Saved authority proves history; current authority governs new work.
begin;
set local lock_timeout='3s';

do $schedule_delegation_prerequisites$
declare x record;n text;installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_schedule_delegation_prerequisite_required';end if;
  for x in select * from (values(202610050136::bigint,'merchant_attendance_schedule_publication_evidence'),
    (202610050137::bigint,'merchant_attendance_self_schedule'),(202610030120::bigint,'merchant_attendance_schedule_overview'),
    (202610040128::bigint,'merchant_attendance_sources'),(202610060164::bigint,'merchant_attendance_account_suspensions'),
    (202610060166::bigint,'merchant_attendance_employment_lifecycle')) r(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=x.version and m.name=x.name) then raise exception 'merchant_attendance_schedule_delegation_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060167 and name<>'merchant_attendance_schedule_delegation') then raise exception 'merchant_attendance_schedule_delegation_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060167 and name='merchant_attendance_schedule_delegation') into installed;
  foreach n in array array['merchant_attendance_schedule_delegations','merchant_attendance_schedule_delegation_revocations','merchant_attendance_schedule_delegation_operations'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_schedule_delegation_installation_conflict';end if;
  end loop;
  foreach n in array array['faolla_attendance_schedule_delegation_command_v1','faolla_attendance_schedule_delegation_hash_v1',
    'faolla_attendance_schedule_delegation_actions_v1','faolla_attendance_schedule_delegation_grant_v1',
    'faolla_attendance_schedule_delegation_proof_v1','faolla_attendance_schedule_delegation_guard_v1',
    'faolla_attendance_schedule_delegation_receipt_v1','faolla_attendance_schedule_delegation_schedule_v1','faolla_attendance_schedule_delegation_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n) then raise exception 'merchant_attendance_schedule_delegation_installation_conflict';end if;
  end loop;
end;
$schedule_delegation_prerequisites$;

create or replace function public.faolla_attendance_schedule_delegation_command_v1(p jsonb,p_access text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare d jsonb;k text;actions jsonb;pair jsonb;a timestamptz;b timestamptz;prior_end timestamptz;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(convert_to(p::text,'UTF8'))>8192 then return false;end if;
  if p_access='owner' then
    d:=p;
    if d->>'action'='grant' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','locationId','actions','includeExistingFuture','validFrom','validUntil','reason']) is distinct from true
        or jsonb_typeof(d->'includeExistingFuture') is distinct from 'boolean' or jsonb_typeof(d->'actions') is distinct from 'array' then return false;end if;
      foreach k in array array['delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','locationId'] loop
        if public.faolla_attendance_shift_rule_binding_scalar_v1(d->k,'uuid') is distinct from true then return false;end if;
      end loop;
      select coalesce(jsonb_agg(to_jsonb(x.action) order by x.ord),'[]') into actions from (values('publish',1),('cancel',2)) x(action,ord) where d->'actions' ? x.action;
      if actions='[]'::jsonb or actions is distinct from d->'actions' or d->>'delegateEmployeeId'=d->>'employeeId' or d->>'delegateAuthUserId'=d->>'employeeAuthUserId'
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'validFrom','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'validUntil','stamp6') is distinct from true then return false;end if;
      if (d->>'validFrom')::timestamptz>=(d->>'validUntil')::timestamptz then return false;end if;
    elsif d->>'action'='revoke' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','grantId','expectedRevision','reason']) is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'grantId','uuid') is distinct from true or d->'expectedRevision' is distinct from '1'::jsonb then return false;end if;
    else return false;end if;
  elsif p_access='delegate' then
    if public.faolla_attendance_shift_rule_binding_object_v1(p,array['expectedGrantRevision','decision']) is distinct from true or p->'expectedGrantRevision' is distinct from '1'::jsonb then return false;end if;
    d:=p->'decision';
    if d->>'action'='publish' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['operationId','expectedRevision','expectedSettingsVersion','reason','action','locationId','timeZone','slots']) is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'locationId','uuid') is distinct from true
        or jsonb_typeof(d->'timeZone') is distinct from 'string' or char_length(d->>'timeZone') not between 1 and 100
        or d->>'timeZone'<>btrim(d->>'timeZone') or d->>'timeZone' ~ '[[:cntrl:]]'
        or jsonb_typeof(d->'slots') is distinct from 'array' then return false;end if;
      if jsonb_array_length(d->'slots') not between 1 and 32 then return false;end if;
      for pair in select value from jsonb_array_elements(d->'slots') loop
        if jsonb_typeof(pair) is distinct from 'array' or jsonb_array_length(pair)<>2 then return false;end if;
        if public.faolla_attendance_shift_rule_binding_scalar_v1(pair->0,'stamp3') is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(pair->1,'stamp3') is distinct from true then return false;end if;
        a:=(pair->>0)::timestamptz;b:=(pair->>1)::timestamptz;
        if date_trunc('minute',a)<>a or date_trunc('minute',b)<>b or b<=a or b-a>interval '24 hours' or a<prior_end then return false;end if;prior_end:=b;
      end loop;
    elsif d->>'action'='cancel' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['operationId','expectedRevision','expectedSettingsVersion','reason','action','slotId']) is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'slotId','uuid') is distinct from true then return false;end if;
    else return false;end if;
    foreach k in array array['expectedRevision','expectedSettingsVersion'] loop
      if jsonb_typeof(d->k) is distinct from 'number' or coalesce(d->>k,'')!~'^(0|[1-9][0-9]{0,15})$' then return false;end if;
      if (d->>k)::numeric>9007199254740989 or k='expectedSettingsVersion' and (d->>k)::numeric<1 then return false;end if;
    end loop;
  else return false;end if;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(d->'operationId','uuid') is true
    and jsonb_typeof(d->'reason')='string' and char_length(d->>'reason') between 1 and 200 and d->>'reason'=btrim(d->>'reason') and d->>'reason' !~ '[[:cntrl:]]';
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then return false;
end;
$$;

create or replace function public.faolla_attendance_schedule_delegation_hash_v1(p_query jsonb,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare v jsonb;d jsonb;actions text;slots text;
begin
  if public.faolla_attendance_schedule_delegation_command_v1(p,p_query->>'access') is distinct from true then raise exception 'attendance_invalid_request';end if;
  v:=jsonb_build_array('attendance-schedule-delegation-v1',p_query->>'siteId',p_query->>'access');
  if p_query->>'access'='delegate' then
    d:=p->'decision';
    if d->>'action'='publish' then select '['||string_agg('['||to_jsonb(value->>0)::text||','||to_jsonb(value->>1)::text||']',',' order by ord)||']' into slots from jsonb_array_elements(d->'slots') with ordinality x(value,ord);end if;
    v:=v||jsonb_build_array(d->>'action',d->>'operationId',p_query->>'grantId',1,p_query->>'fromDate',p_query->>'throughDate',
      (d->>'expectedRevision')::bigint,(d->>'expectedSettingsVersion')::bigint,d->>'reason',d->>'locationId',d->>'timeZone',slots,d->>'slotId');
  elsif p->>'action'='grant' then
    select string_agg(value,',' order by ord) into actions from jsonb_array_elements_text(p->'actions') with ordinality x(value,ord);
    v:=v||jsonb_build_array('grant',p->>'operationId',p->>'delegateEmployeeId',p->>'delegateAuthUserId',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId',p->>'locationId',actions,
      (p->>'includeExistingFuture')::boolean,p->>'validFrom',p->>'validUntil',p->>'reason');
  else v:=v||jsonb_build_array('revoke',p->>'operationId',p->>'grantId',1,p->>'reason');end if;
  return encode(sha256(convert_to(v::text,'UTF8')),'hex');
end;
$$;

create table if not exists public.merchant_attendance_schedule_delegations(
  merchant_id text not null references public.merchants(id),grant_id uuid not null,
  delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,delegate_name text not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,worker_name text not null,worker_no text not null,
  location_id uuid not null,location_name text not null,time_zone text not null,actions jsonb not null,include_existing_future boolean not null,
  delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),employee_generation bigint not null check(employee_generation between 0 and 9007199254740990),
  valid_from timestamptz not null,valid_until timestamptz not null,actor_auth_user_id uuid not null,reason text not null,
  query jsonb not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,grant_id),foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id),
  check(isfinite(valid_from) and isfinite(valid_until) and valid_from<valid_until and isfinite(recorded_at)),
  check(public.faolla_attendance_schedule_delegation_command_v1(command,'owner') is true and command->>'action'='grant'
    and command->>'operationId'=grant_id::text and command->>'delegateEmployeeId'=delegate_employee_id::text and command->>'delegateAuthUserId'=delegate_auth_user_id::text
    and command->>'workerId'=worker_id::text and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text
    and command->>'locationId'=location_id::text and command->'actions'=actions and (command->>'includeExistingFuture')::boolean=include_existing_future
    and (command->>'validFrom')::timestamptz=valid_from and (command->>'validUntil')::timestamptz=valid_until and command->>'reason'=reason),
  check(query=jsonb_build_object('siteId',merchant_id,'access','owner','mode','list','catalog',null,'grantId',null,'afterId',null,'fromDate',null,'throughDate',null,'operationId',null)
    and command_fingerprint=public.faolla_attendance_schedule_delegation_hash_v1(query,command))
);
create index if not exists attendance_schedule_delegation_delegate_idx on public.merchant_attendance_schedule_delegations(merchant_id,delegate_employee_id,grant_id);
create index if not exists attendance_schedule_delegation_target_idx on public.merchant_attendance_schedule_delegations(merchant_id,employee_id,grant_id);
create table if not exists public.merchant_attendance_schedule_delegation_revocations(
  merchant_id text not null,operation_id uuid not null,grant_id uuid not null,actor_auth_user_id uuid not null,reason text not null,
  query jsonb not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,grant_id),foreign key(merchant_id,grant_id) references public.merchant_attendance_schedule_delegations(merchant_id,grant_id),
  check(public.faolla_attendance_schedule_delegation_command_v1(command,'owner') is true and command->>'action'='revoke'
    and command->>'operationId'=operation_id::text and command->>'grantId'=grant_id::text and command->>'reason'=reason
    and query=jsonb_build_object('siteId',merchant_id,'access','owner','mode','detail','catalog',null,'grantId',grant_id,'afterId',null,'fromDate',null,'throughDate',null,'operationId',null)
    and command_fingerprint=public.faolla_attendance_schedule_delegation_hash_v1(query,command))
);
create table if not exists public.merchant_attendance_schedule_delegation_operations(
  merchant_id text not null,operation_id uuid not null,grant_id uuid not null,schedule_revision bigint not null,
  actor_auth_user_id uuid not null,actor_employee_id uuid not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,location_id uuid not null,
  worker_version bigint not null,location_version bigint not null,settings_version bigint not null,
  query jsonb not null,command jsonb not null,original_query jsonb not null,original_command jsonb not null,command_fingerprint text not null,
  authorized_at timestamptz not null check(isfinite(authorized_at)),recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,schedule_revision),
  foreign key(merchant_id,grant_id) references public.merchant_attendance_schedule_delegations(merchant_id,grant_id),
  foreign key(merchant_id,operation_id) references public.merchant_attendance_schedule_commands(merchant_id,operation_id),
  foreign key(merchant_id,schedule_revision) references public.merchant_attendance_schedule_commands(merchant_id,revision),
  check(worker_version between 1 and 9007199254740991 and location_version between 1 and 9007199254740991 and settings_version between 1 and 9007199254740991),
  check(public.faolla_attendance_schedule_delegation_command_v1(command,'delegate') is true and command->'decision'=original_command
    and original_command->>'operationId'=operation_id::text and original_command->'expectedRevision'=to_jsonb(schedule_revision-1)
    and original_command->'expectedSettingsVersion'=to_jsonb(settings_version) and query->>'siteId'=merchant_id and query->>'access'='delegate'
    and query->>'grantId'=grant_id::text and command_fingerprint=public.faolla_attendance_schedule_delegation_hash_v1(query,command))
);

create or replace function public.faolla_attendance_schedule_delegation_actions_v1(p public.merchant_attendance_schedule_delegations,p_at timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare permissions text[];de public.merchant_attendance_account_epochs%rowtype;te public.merchant_attendance_account_epochs%rowtype;result jsonb:='[]';a text;
begin
  if p_at<p.valid_from or p_at>=p.valid_until or exists(select 1 from public.merchant_attendance_schedule_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id) then return result;end if;
  select dr.permissions into permissions from public.merchant_enterprise_employees e join public.merchant_enterprise_roles dr on dr.merchant_id=e.merchant_id and dr.id=e.role_id
    join public.merchant_attendance_workers w on w.merchant_id=e.merchant_id and w.id=p.worker_id
    join public.merchant_enterprise_employees target on target.merchant_id=w.merchant_id and target.id=w.employee_id
    join public.merchant_attendance_locations l on l.merchant_id=w.merchant_id and l.id=p.location_id
    where e.merchant_id=p.merchant_id and e.id=p.delegate_employee_id and e.auth_user_id=p.delegate_auth_user_id and e.status='active'
      and dr.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) and dr.permissions @> array['enterprise.view','attendance.self.view']::text[]
      and w.active and w.employee_id=p.employee_id and target.status='active' and target.auth_user_id=p.employee_auth_user_id
      and e.id<>target.id and e.auth_user_id<>target.auth_user_id and l.active;
  if not found then return result;end if;
  select * into de from public.merchant_attendance_account_epochs where merchant_id=p.merchant_id and employee_id=p.delegate_employee_id;
  select * into te from public.merchant_attendance_account_epochs where merchant_id=p.merchant_id and employee_id=p.employee_id;
  if coalesce(de.paused,false) or coalesce(te.paused,false) or coalesce(de.generation,0)<>p.delegate_generation or coalesce(te.generation,0)<>p.employee_generation then return result;end if;
  foreach a in array array['publish','cancel'] loop
    if p.actions ? a and ('attendance.schedule.'||a)=any(permissions) then result:=result||to_jsonb(a);end if;
  end loop;
  return result;
end;
$$;
create or replace function public.faolla_attendance_schedule_delegation_grant_v1(p public.merchant_attendance_schedule_delegations,p_actions jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare r public.merchant_attendance_schedule_delegation_revocations%rowtype;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  select * into r from public.merchant_attendance_schedule_delegation_revocations where merchant_id=p.merchant_id and grant_id=p.grant_id;
  return jsonb_build_object('grantId',p.grant_id,'revision',case when r.operation_id is null then 1 else 2 end,'status',case when r.operation_id is null then 'granted' else 'revoked' end,
    'delegate',jsonb_build_object('employeeId',p.delegate_employee_id,'authUserId',p.delegate_auth_user_id,'name',p.delegate_name),
    'worker',jsonb_build_object('workerId',p.worker_id,'employeeId',p.employee_id,'authUserId',p.employee_auth_user_id,'name',p.worker_name,'workerNo',p.worker_no),
    'location',jsonb_build_object('id',p.location_id,'name',p.location_name,'timeZone',p.time_zone),'actions',p.actions,'includeExistingFuture',p.include_existing_future,
    'validFrom',to_char(p.valid_from at time zone 'UTC',fmt),'validUntil',to_char(p.valid_until at time zone 'UTC',fmt),'grantedBy',p.actor_auth_user_id,
    'grantedAt',to_char(p.recorded_at at time zone 'UTC',fmt),'reason',p.reason,'revocation',case when r.operation_id is null then null else
      jsonb_build_object('operationId',r.operation_id,'actorId',r.actor_auth_user_id,'reason',r.reason,'recordedAt',to_char(r.recorded_at at time zone 'UTC',fmt)) end,
    'usableActions',case when r.operation_id is null then p_actions else '[]'::jsonb end);
end;
$$;

--Historical validation ONLY: never inspect current roles, owner, epoch, expiry
--or revocations here. Every new branch below requires this immutable proof.
create or replace function public.faolla_attendance_schedule_delegation_proof_v1(p public.merchant_attendance_schedule_commands)
returns boolean language plpgsql set search_path=pg_catalog as $$
declare a public.merchant_attendance_schedule_delegation_operations%rowtype;g public.merchant_attendance_schedule_delegations%rowtype;
  slot public.merchant_attendance_schedule_slots%rowtype;pub public.merchant_attendance_schedule_publication_evidence%rowtype;
  pair jsonb;start_at timestamptz;end_at timestamptz;
begin
  if p.query->>'access' is distinct from 'delegate' then return false;end if;
  select * into a from public.merchant_attendance_schedule_delegation_operations where merchant_id=p.merchant_id and operation_id=p.operation_id;
  select * into g from public.merchant_attendance_schedule_delegations where merchant_id=a.merchant_id and grant_id=a.grant_id;
  if a.operation_id is null or g.grant_id is null or a.schedule_revision is distinct from p.revision or a.actor_auth_user_id is distinct from p.actor_auth_user_id
    or a.original_query is distinct from p.query or a.original_command is distinct from p.command or a.recorded_at is distinct from p.recorded_at
    or a.actor_employee_id is distinct from g.delegate_employee_id or a.actor_auth_user_id is distinct from g.delegate_auth_user_id
    or row(a.worker_id,a.employee_id,a.employee_auth_user_id,a.location_id) is distinct from row(g.worker_id,g.employee_id,g.employee_auth_user_id,g.location_id)
    or public.faolla_attendance_schedule_delegation_command_v1(a.command,'delegate') is distinct from true
    or a.command_fingerprint is distinct from public.faolla_attendance_schedule_delegation_hash_v1(a.query,a.command)
    or public.faolla_attendance_shift_rule_binding_object_v1(a.query,array['siteId','access','mode','catalog','grantId','afterId','fromDate','throughDate','operationId']) is distinct from true
    or a.query is distinct from jsonb_build_object('siteId',p.merchant_id,'access','delegate','mode','schedule','catalog',null,'grantId',g.grant_id,'afterId',null,'fromDate',p.query->'fromDate','throughDate',p.query->'throughDate','operationId',null)
    or p.query is distinct from jsonb_build_object('siteId',p.merchant_id,'access','delegate','workerId',g.worker_id,'fromDate',a.query->'fromDate','throughDate',a.query->'throughDate','operationId',null)
    or a.command->'decision' is distinct from p.command or a.authorized_at<g.valid_from or a.authorized_at>=g.valid_until
    or not(g.actions ? (p.command->>'action')) then return false;end if;
  if p.command->>'action'='publish' then
    if p.command->>'locationId' is distinct from g.location_id::text then return false;end if;
    for pair in select value from jsonb_array_elements(p.command->'slots') loop
      start_at:=(pair->>0)::timestamptz;end_at:=(pair->>1)::timestamptz;
      if start_at<g.valid_from or end_at>g.valid_until or start_at<=a.authorized_at or start_at>a.authorized_at+interval '180 days' then return false;end if;
    end loop;
  elsif p.command->>'action'='cancel' then
    select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p.merchant_id and id=(p.command->>'slotId')::uuid;
    select * into pub from public.merchant_attendance_schedule_publication_evidence where merchant_id=p.merchant_id and revision=slot.revision;
    if slot.id is null or row(slot.worker_id,slot.employee_id,slot.location_id) is distinct from row(g.worker_id,g.employee_id,g.location_id)
      or pub.employee_auth_user_id is distinct from g.employee_auth_user_id or pub.employee_id is distinct from g.employee_id or pub.identity_status is distinct from 'bound'
      or slot.start_at<=a.authorized_at or slot.start_at<g.valid_from or slot.end_at>g.valid_until
      or not g.include_existing_future and pub.published_at<g.recorded_at
      or not exists(select 1 from public.merchant_attendance_schedule_cancellations c where c.merchant_id=p.merchant_id and c.slot_id=slot.id and c.revision=p.revision) then return false;end if;
  else return false;end if;
  return true;
end;
$$;
create or replace function public.faolla_attendance_schedule_delegation_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare c public.merchant_attendance_schedule_commands%rowtype;
begin
  select * into c from public.merchant_attendance_schedule_commands where merchant_id=new.merchant_id and operation_id=new.operation_id;
  if public.faolla_attendance_schedule_delegation_proof_v1(c) is distinct from true then raise exception 'attendance_schedule_delegation_invalid';end if;
  return new;
end;
$$;

create or replace function public.faolla_attendance_schedule_delegation_receipt_v1(p_site text,p_operation uuid,p_auth uuid,p_access text,p_employee uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare g public.merchant_attendance_schedule_delegations%rowtype;r public.merchant_attendance_schedule_delegation_revocations%rowtype;c public.merchant_attendance_schedule_commands%rowtype;
  a public.merchant_attendance_schedule_delegation_operations%rowtype;gid uuid;actor uuid;action_name text;revision integer;schedule_revision bigint;stamp timestamptz;fingerprint text;
begin
  select * into g from public.merchant_attendance_schedule_delegations where merchant_id=p_site and grant_id=p_operation;
  select * into r from public.merchant_attendance_schedule_delegation_revocations where merchant_id=p_site and operation_id=p_operation;
  select * into a from public.merchant_attendance_schedule_delegation_operations where merchant_id=p_site and operation_id=p_operation;
  if (case when g.grant_id is null then 0 else 1 end)+(case when r.operation_id is null then 0 else 1 end)+(case when a.operation_id is null then 0 else 1 end)>1 then raise exception 'attendance_schedule_delegation_invalid';end if;
  if g.grant_id is not null then gid:=g.grant_id;actor:=g.actor_auth_user_id;action_name:='grant';revision:=1;stamp:=g.recorded_at;fingerprint:=g.command_fingerprint;
  elsif r.operation_id is not null then gid:=r.grant_id;actor:=r.actor_auth_user_id;action_name:='revoke';revision:=2;stamp:=r.recorded_at;fingerprint:=r.command_fingerprint;
  elsif a.operation_id is not null then
    if p_employee is distinct from a.actor_employee_id then raise exception 'attendance_access_denied';end if;
    select * into c from public.merchant_attendance_schedule_commands where merchant_id=p_site and operation_id=p_operation;
    if public.faolla_attendance_schedule_delegation_proof_v1(c) is distinct from true then raise exception 'attendance_schedule_delegation_invalid';end if;
    gid:=a.grant_id;actor:=a.actor_auth_user_id;action_name:=a.original_command->>'action';revision:=1;schedule_revision:=a.schedule_revision;stamp:=a.recorded_at;fingerprint:=a.command_fingerprint;
  else return null;end if;
  if actor is distinct from p_auth or (p_access='delegate') is distinct from (a.operation_id is not null) then raise exception 'attendance_access_denied';end if;
  return jsonb_build_object('operationId',p_operation,'action',action_name,'grantId',gid,'grantRevision',revision,'scheduleRevision',schedule_revision,
    'actorId',actor,'recordedAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',fingerprint);
end;
$$;

create or replace function public.faolla_attendance_schedule_delegation_schedule_v1(p public.merchant_attendance_schedule_delegations,p_from date,p_through date,p_actions jsonb,p_at timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;
  slot public.merchant_attendance_schedule_slots%rowtype;pub public.merchant_attendance_schedule_commands%rowtype;cancel public.merchant_attendance_schedule_commands%rowtype;
  evidence public.merchant_attendance_schedule_publication_evidence%rowtype;context jsonb;entries jsonb:='[]';n integer:=0;rev bigint;allowed boolean;
begin
  select * into s from public.merchant_attendance_settings where merchant_id=p.merchant_id;
  select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id;
  select * into l from public.merchant_attendance_locations where merchant_id=p.merchant_id and id=p.location_id;
  select coalesce(max(revision),0) into rev from public.merchant_attendance_schedule_commands where merchant_id=p.merchant_id;
  for slot in select * from public.merchant_attendance_schedule_slots x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id and x.location_id=p.location_id
    and x.employee_id=p.employee_id and x.work_date between p_from and p_through and x.start_at>=p.valid_from and x.end_at<=p.valid_until
    and exists(select 1 from public.merchant_attendance_schedule_publication_evidence e where e.merchant_id=x.merchant_id and e.revision=x.revision
      and e.employee_id=p.employee_id and e.employee_auth_user_id=p.employee_auth_user_id and (p.include_existing_future or e.published_at>=p.recorded_at))
    order by x.work_date,x.start_at,x.id limit 101 loop
    n:=n+1;if n>100 then entries:='[]';exit;end if;
    context:=public.faolla_attendance_self_schedule_slot_v1(slot);
    select * into pub from public.merchant_attendance_schedule_commands where merchant_id=p.merchant_id and revision=slot.revision;
    select c.* into cancel from public.merchant_attendance_schedule_cancellations x join public.merchant_attendance_schedule_commands c on c.merchant_id=x.merchant_id and c.revision=x.revision where x.merchant_id=p.merchant_id and x.slot_id=slot.id;
    select * into evidence from public.merchant_attendance_schedule_publication_evidence where merchant_id=p.merchant_id and revision=slot.revision;
    if context->'slot'->'hasPublicationEvidence' is distinct from 'true'::jsonb or evidence.identity_status<>'bound' then raise exception 'attendance_schedule_delegation_invalid';end if;
    allowed:=p_actions ? 'cancel' and cancel.operation_id is null and slot.start_at>p_at;
    entries:=entries||jsonb_build_array(jsonb_build_object('slotId',slot.id,'revision',slot.revision,'workerId',slot.worker_id,'locationId',slot.location_id,'timeZone',slot.time_zone,
      'workDate',slot.work_date::text,'startAt',to_char(slot.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(slot.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'publishedAt',to_char(pub.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'publishedBy',pub.actor_auth_user_id,'cancelled',cancel.operation_id is not null,
      'cancelledAt',case when cancel.operation_id is null then null else to_char(cancel.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'cancelledBy',cancel.actor_auth_user_id,'canCancel',allowed));
  end loop;
  return jsonb_build_object('grant',public.faolla_attendance_schedule_delegation_grant_v1(p,p_actions),'revision',rev,'settingsVersion',s.version,'timeZone',l.time_zone,
    'workerVersion',w.version,'locationVersion',l.version,'readAt',to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'entries',entries,'rangeLimited',n>100);
end;
$$;

create or replace function public.faolla_attendance_schedule_delegation_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;catalog_name text;k text;action_name text;op uuid;target_grant_id uuid;after_id uuid;next_id uuid;
  first_day date;last_day date;day date;last_work_day date;stamp timestamptz;first_at timestamptz;last_at timestamptz;rev bigint;seen integer:=0;
  m public.merchants%rowtype;s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  de public.merchant_enterprise_employees%rowtype;te public.merchant_enterprise_employees%rowtype;dr public.merchant_enterprise_roles%rowtype;
  l public.merchant_attendance_locations%rowtype;de_epoch public.merchant_attendance_account_epochs%rowtype;te_epoch public.merchant_attendance_account_epochs%rowtype;
  g public.merchant_attendance_schedule_delegations%rowtype;rv public.merchant_attendance_schedule_delegation_revocations%rowtype;authority public.merchant_attendance_schedule_delegation_operations%rowtype;
  original public.merchant_attendance_schedule_commands%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;pub public.merchant_attendance_schedule_publication_evidence%rowtype;
  candidate record;decision jsonb;pair jsonb;original_query jsonb;actions jsonb:='[]';grants_json jsonb:='[]';catalog_json jsonb:='[]';captured_slots jsonb:='[]';
  receipt jsonb;detail jsonb;schedule jsonb;result_json jsonb;can_write boolean:=false;employee_uuid uuid;expected_hash text;
  fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','catalog','grantId','afterId','fromDate','throughDate','operationId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^\d{8}$'
    or coalesce(p_query->>'access','') not in('owner','delegate') or coalesce(p_query->>'mode','') not in('list','catalog','detail','grants','schedule','recover') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';catalog_name:=p_query->>'catalog';
  foreach k in array array['grantId','afterId','operationId'] loop
    if p_query->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  target_grant_id:=(p_query->>'grantId')::uuid;after_id:=(p_query->>'afterId')::uuid;op:=(p_query->>'operationId')::uuid;
  if access_name='owner' and mode_name not in('list','catalog','detail','recover') or access_name='delegate' and mode_name not in('grants','schedule','recover')
    or (mode_name='catalog') is distinct from (catalog_name is not null) or catalog_name is not null and catalog_name not in('delegates','workers','locations')
    or (mode_name in('detail','schedule')) is distinct from (target_grant_id is not null) or (mode_name='recover') is distinct from (op is not null)
    or mode_name not in('list','grants','catalog') and after_id is not null then raise exception 'attendance_invalid_request';end if;
  if mode_name='schedule' then
    foreach k in array array['fromDate','throughDate'] loop
      if jsonb_typeof(p_query->k) is distinct from 'string' or coalesce(p_query->>k,'')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'attendance_invalid_request';end if;
    end loop;
    first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
    if first_day::text<>p_query->>'fromDate' or last_day::text<>p_query->>'throughDate' or first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day<first_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  elsif p_query->'fromDate'<>'null'::jsonb or p_query->'throughDate'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_schedule_delegation_command_v1(p_command,access_name) is distinct from true or op is not null or after_id is not null then raise exception 'attendance_invalid_request';end if;
    decision:=case when access_name='delegate' then p_command->'decision' else p_command end;action_name:=decision->>'action';op:=(decision->>'operationId')::uuid;
    if access_name='owner' and (action_name='grant' and mode_name<>'list' or action_name='revoke' and (mode_name<>'detail' or decision->>'grantId' is distinct from target_grant_id::text))
      or access_name='delegate' and mode_name<>'schedule' then raise exception 'attendance_invalid_request';end if;
  end if;
  select * into m from public.merchants where id=site for share;
  if m.id is null then raise exception 'attendance_access_denied';end if;
  if access_name='owner' then
    if mode_name<>'recover' and m.user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
  else
    --Recovery requires the original current membership/Auth, not current role,
    --active status, feature flag, grant or employment. No list is returned.
    select * into de from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
    if de.id is null then raise exception 'attendance_access_denied';end if;employee_uuid:=de.id;
  end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if op is not null then
    if access_name='delegate' and (mode_name='recover' or exists(select 1 from public.merchant_attendance_schedule_delegation_operations x where x.merchant_id=site and x.operation_id=op)) then
      --Receipt-only replay has no later worker lock. Re-read the current Auth
      --under membership SHARE; fresh writes retain worker-before-member order.
      select * into de from public.merchant_enterprise_employees where merchant_id=site and id=employee_uuid for share;
      if de.id is null or de.auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
    end if;
    receipt:=public.faolla_attendance_schedule_delegation_receipt_v1(site,op,p_auth_user_id,access_name,employee_uuid);
    if receipt is not null and p_command is not null then
      expected_hash:=public.faolla_attendance_schedule_delegation_hash_v1(p_query,p_command);
      if receipt->>'commandFingerprint' is distinct from expected_hash then raise exception 'attendance_operation_conflict';end if;
      if access_name='delegate' then
        select * into authority from public.merchant_attendance_schedule_delegation_operations x where x.merchant_id=site and x.operation_id=op;
        if authority.query is distinct from p_query or authority.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      elsif action_name='grant' then
        select * into g from public.merchant_attendance_schedule_delegations x where x.merchant_id=site and x.grant_id=op;
        if g.query is distinct from p_query or g.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      else
        select * into rv from public.merchant_attendance_schedule_delegation_revocations x where x.merchant_id=site and x.operation_id=op;
        if rv.query is distinct from p_query or rv.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      end if;
    end if;
    if p_command is not null and receipt is null and exists(select 1 from public.merchant_attendance_schedule_commands x where x.merchant_id=site and x.operation_id=op) then raise exception 'attendance_operation_conflict';end if;
  end if;
  if mode_name<>'recover' and receipt is null then
    can_write:=p_allow_write and s.enabled;
    if access_name='delegate' then
      if not p_allow_write then raise exception 'attendance_schedule_delegation_disabled';end if;
      if target_grant_id is not null then
        select * into g from public.merchant_attendance_schedule_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
        if g.grant_id is null or g.delegate_employee_id<>de.id or g.delegate_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
        if p_command is null then perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for share;
        else perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for update;end if;
        perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id in(g.delegate_employee_id,g.employee_id) order by x.id for share;
      else perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=de.id for share;end if;
      select * into de from public.merchant_enterprise_employees where merchant_id=site and id=employee_uuid;
      select * into dr from public.merchant_enterprise_roles where merchant_id=site and id=de.role_id for share;
      if de.auth_user_id is distinct from p_auth_user_id or de.status<>'active' or dr.id is null or dr.status<>'active'
        or public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) is distinct from true
        or not(dr.permissions @> array['enterprise.view','attendance.self.view']::text[] and dr.permissions && array['attendance.schedule.publish','attendance.schedule.cancel']::text[]) then raise exception 'attendance_access_denied';end if;
    end if;
    if p_command is not null then
      if action_name='grant' then
        if not p_allow_write then raise exception 'attendance_schedule_delegation_disabled';end if;
        if not s.enabled then raise exception 'attendance_platform_paused';end if;
        select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=(decision->>'workerId')::uuid for update;
        perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id in((decision->>'delegateEmployeeId')::uuid,(decision->>'employeeId')::uuid) order by x.id for share;
        select * into de from public.merchant_enterprise_employees where merchant_id=site and id=(decision->>'delegateEmployeeId')::uuid;
        select * into te from public.merchant_enterprise_employees where merchant_id=site and id=(decision->>'employeeId')::uuid;
        select * into dr from public.merchant_enterprise_roles where merchant_id=site and id=de.role_id for share;
        select * into l from public.merchant_attendance_locations where merchant_id=site and id=(decision->>'locationId')::uuid for share;
        if w.id is null or not w.active or w.employee_id is distinct from te.id or te.id is null or te.status<>'active' or te.auth_user_id is distinct from (decision->>'employeeAuthUserId')::uuid
          or de.id is null or de.status<>'active' or de.auth_user_id is distinct from (decision->>'delegateAuthUserId')::uuid or de.id=te.id or de.auth_user_id=te.auth_user_id
          or dr.id is null or dr.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) is distinct from true
          or not(dr.permissions @> array['enterprise.view','attendance.self.view']::text[]) or l.id is null or not l.active or w.default_location_id is distinct from l.id then raise exception 'attendance_access_denied';end if;
        for k in select value from jsonb_array_elements_text(decision->'actions') loop
          if not(('attendance.schedule.'||k)=any(dr.permissions)) then raise exception 'attendance_access_denied';end if;
        end loop;
        select * into de_epoch from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=de.id;
        select * into te_epoch from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=te.id;
        if coalesce(de_epoch.paused,false) or coalesce(te_epoch.paused,false) then raise exception 'attendance_account_suspended';end if;
        stamp:=clock_timestamp();if (decision->>'validUntil')::timestamptz<=stamp then raise exception 'attendance_schedule_delegation_changed';end if;
        insert into public.merchant_attendance_schedule_delegations(merchant_id,grant_id,delegate_employee_id,delegate_auth_user_id,delegate_name,worker_id,employee_id,employee_auth_user_id,worker_name,worker_no,
          location_id,location_name,time_zone,actions,include_existing_future,delegate_generation,employee_generation,valid_from,valid_until,actor_auth_user_id,reason,query,command,command_fingerprint,recorded_at)
        values(site,op,de.id,de.auth_user_id,de.display_name,w.id,te.id,te.auth_user_id,w.display_name,w.worker_no,l.id,l.name,l.time_zone,decision->'actions',(decision->>'includeExistingFuture')::boolean,
          coalesce(de_epoch.generation,0),coalesce(te_epoch.generation,0),(decision->>'validFrom')::timestamptz,(decision->>'validUntil')::timestamptz,p_auth_user_id,decision->>'reason',p_query,p_command,
          public.faolla_attendance_schedule_delegation_hash_v1(p_query,p_command),stamp);
      elsif action_name='revoke' then
        select * into g from public.merchant_attendance_schedule_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
        if g.grant_id is null then raise exception 'attendance_schedule_delegation_not_found';end if;
        perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for update;
        if exists(select 1 from public.merchant_attendance_schedule_delegation_revocations x where x.merchant_id=site and x.grant_id=g.grant_id) then raise exception 'attendance_version_conflict';end if;
        insert into public.merchant_attendance_schedule_delegation_revocations(merchant_id,operation_id,grant_id,actor_auth_user_id,reason,query,command,command_fingerprint,recorded_at)
        values(site,op,g.grant_id,p_auth_user_id,decision->>'reason',p_query,p_command,public.faolla_attendance_schedule_delegation_hash_v1(p_query,p_command),clock_timestamp());
      else
        if not s.enabled then raise exception 'attendance_platform_paused';end if;
        select * into w from public.merchant_attendance_workers where merchant_id=site and id=g.worker_id;
        select * into te from public.merchant_enterprise_employees where merchant_id=site and id=g.employee_id;
        select * into l from public.merchant_attendance_locations where merchant_id=site and id=g.location_id for share;
        stamp:=clock_timestamp();actions:=public.faolla_attendance_schedule_delegation_actions_v1(g,stamp);
        if not(actions ? action_name) then raise exception 'attendance_access_denied';end if;
        schedule:=public.faolla_attendance_schedule_delegation_schedule_v1(g,first_day,last_day,actions,stamp);
        if schedule->'rangeLimited'='true'::jsonb then raise exception 'attendance_schedule_range_limit';end if;
        select coalesce(max(revision),0) into rev from public.merchant_attendance_schedule_commands where merchant_id=site;
        if (decision->>'expectedRevision')::bigint<>rev or (decision->>'expectedSettingsVersion')::bigint<>s.version then raise exception 'attendance_version_conflict';end if;
        if rev>=9007199254740989 then raise exception 'attendance_version_conflict';end if;
        if action_name='publish' then
          if w.default_location_id is distinct from l.id or decision->>'locationId' is distinct from l.id::text or decision->>'timeZone' is distinct from l.time_zone then raise exception 'attendance_schedule_location_changed';end if;
          for pair in select value from jsonb_array_elements(decision->'slots') loop
            first_at:=(pair->>0)::timestamptz;last_at:=(pair->>1)::timestamptz;day:=(first_at at time zone l.time_zone)::date;last_work_day:=((last_at-interval '1 millisecond') at time zone l.time_zone)::date;
            if day<first_day or day>last_day then raise exception 'attendance_invalid_request';end if;
            if first_at<=stamp or first_at>stamp+interval '180 days' then raise exception 'attendance_schedule_past';end if;
            if first_at<g.valid_from or last_at>g.valid_until then raise exception 'attendance_access_denied';end if;
            if not exists(select 1 from public.merchant_attendance_employment_periods where merchant_id=site and worker_id=w.id and starts_on<=day and (ends_on is null or ends_on>=last_work_day)) then raise exception 'attendance_schedule_outside_employment';end if;
            if exists(select 1 from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=w.id and x.start_at<last_at and x.end_at>first_at
              and not exists(select 1 from public.merchant_attendance_schedule_cancellations c where c.merchant_id=site and c.slot_id=x.id)) then raise exception 'attendance_schedule_overlap';end if;
          end loop;
        else
          select * into slot from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=(decision->>'slotId')::uuid and x.worker_id=g.worker_id and x.location_id=g.location_id and x.employee_id=g.employee_id
            and x.work_date between first_day and last_day and not exists(select 1 from public.merchant_attendance_schedule_cancellations c where c.merchant_id=site and c.slot_id=x.id);
          if slot.id is null then raise exception 'attendance_schedule_not_active';end if;
          perform public.faolla_attendance_self_schedule_slot_v1(slot);
          select * into pub from public.merchant_attendance_schedule_publication_evidence where merchant_id=site and revision=slot.revision;
          if pub.operation_id is null or pub.employee_id is distinct from g.employee_id or pub.employee_auth_user_id is distinct from g.employee_auth_user_id or pub.identity_status<>'bound'
            or slot.start_at<g.valid_from or slot.end_at>g.valid_until or not g.include_existing_future and pub.published_at<g.recorded_at then raise exception 'attendance_access_denied';end if;
          if slot.start_at<=stamp then raise exception 'attendance_schedule_past';end if;
        end if;
        rev:=rev+1;original_query:=jsonb_build_object('siteId',site,'access','delegate','workerId',g.worker_id,'fromDate',p_query->'fromDate','throughDate',p_query->'throughDate','operationId',null);
        insert into public.merchant_attendance_schedule_commands(merchant_id,revision,operation_id,actor_auth_user_id,query,command,recorded_at)
          values(site,rev,op,p_auth_user_id,original_query,decision,stamp) returning * into original;
        if action_name='publish' then
          insert into public.merchant_attendance_schedule_slots(merchant_id,revision,worker_id,employee_id,worker_name,location_id,location_name,time_zone,work_date,start_at,end_at)
            select site,rev,w.id,te.id,w.display_name,l.id,l.name,l.time_zone,((value->>0)::timestamptz at time zone l.time_zone)::date,(value->>0)::timestamptz,(value->>1)::timestamptz from jsonb_array_elements(decision->'slots');
        else insert into public.merchant_attendance_schedule_cancellations(merchant_id,slot_id,revision) values(site,slot.id,rev);end if;
        --Mandatory authority is inserted BEFORE136 evidence, whose trigger now
        --requires it. No caught failure can return a partly written schedule.
        insert into public.merchant_attendance_schedule_delegation_operations(merchant_id,operation_id,grant_id,schedule_revision,actor_auth_user_id,actor_employee_id,worker_id,employee_id,employee_auth_user_id,location_id,
          worker_version,location_version,settings_version,query,command,original_query,original_command,command_fingerprint,authorized_at,recorded_at)
        values(site,op,g.grant_id,rev,p_auth_user_id,de.id,w.id,te.id,te.auth_user_id,l.id,w.version,l.version,s.version,p_query,p_command,original_query,decision,
          public.faolla_attendance_schedule_delegation_hash_v1(p_query,p_command),stamp,stamp);
        if action_name='publish' then
          select jsonb_agg(jsonb_build_object('id',x.id,'workDate',x.work_date::text,'startAt',to_char(x.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'endAt',to_char(x.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by x.id) into captured_slots from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.revision=rev;
          insert into public.merchant_attendance_schedule_publication_evidence(merchant_id,revision,operation_id,actor_auth_user_id,worker_id,employee_id,employee_auth_user_id,identity_status,
            worker_version,location_id,location_version,settings_version,time_zone,slots,published_at,recorded_at,capture_policy)
          values(site,rev,op,p_auth_user_id,w.id,te.id,te.auth_user_id,'bound',w.version,l.id,l.version,s.version,l.time_zone,captured_slots,stamp,stamp,'publish-identity-context-v1');
        end if;
      end if;
      receipt:=public.faolla_attendance_schedule_delegation_receipt_v1(site,op,p_auth_user_id,access_name,employee_uuid);schedule:=null;can_write:=false;
    elsif mode_name in('list','grants') then
      stamp:=clock_timestamp();
      for g in select x.* from public.merchant_attendance_schedule_delegations x where x.merchant_id=site and (after_id is null or x.grant_id>after_id)
        and (access_name='owner' or (can_write and x.delegate_employee_id=de.id and x.delegate_auth_user_id=p_auth_user_id and public.faolla_attendance_schedule_delegation_actions_v1(x,stamp)<>'[]'::jsonb))
        order by x.grant_id limit 26 loop
        seen:=seen+1;exit when seen=26;actions:=case when can_write then public.faolla_attendance_schedule_delegation_actions_v1(g,stamp) else '[]'::jsonb end;
        grants_json:=grants_json||jsonb_build_array(public.faolla_attendance_schedule_delegation_grant_v1(g,actions));next_id:=g.grant_id;
      end loop;
    elsif mode_name='detail' then
      select * into g from public.merchant_attendance_schedule_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
      if g.grant_id is null then raise exception 'attendance_schedule_delegation_not_found';end if;
      detail:=public.faolla_attendance_schedule_delegation_grant_v1(g,case when can_write then public.faolla_attendance_schedule_delegation_actions_v1(g,clock_timestamp()) else '[]'::jsonb end);
    elsif mode_name='schedule' then
      select * into l from public.merchant_attendance_locations where merchant_id=site and id=g.location_id for share;
      stamp:=clock_timestamp();actions:=case when can_write then public.faolla_attendance_schedule_delegation_actions_v1(g,stamp) else '[]'::jsonb end;
      if actions='[]'::jsonb then raise exception 'attendance_access_denied';end if;
      schedule:=public.faolla_attendance_schedule_delegation_schedule_v1(g,first_day,last_day,actions,stamp);
    elsif mode_name='catalog' then
      for candidate in select c.* from (
        select e.id,e.display_name name,e.id employee_id,e.auth_user_id member_auth,null::text worker_no,null::text zone from public.merchant_enterprise_employees e
          join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
          where catalog_name='delegates' and e.merchant_id=site and e.status='active' and e.auth_user_id is not null and r.status='active'
            and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) and r.permissions @> array['enterprise.view','attendance.self.view']::text[]
            and r.permissions && array['attendance.schedule.publish','attendance.schedule.cancel']::text[] and (after_id is null or e.id>after_id)
        union all select cw.id,cw.display_name,e.id,e.auth_user_id,cw.worker_no,null::text from public.merchant_attendance_workers cw join public.merchant_enterprise_employees e on e.merchant_id=cw.merchant_id and e.id=cw.employee_id
          where catalog_name='workers' and cw.merchant_id=site and cw.active and e.status='active' and e.auth_user_id is not null and (after_id is null or cw.id>after_id)
        union all select cl.id,cl.name,null::uuid,null::uuid,null::text,cl.time_zone from public.merchant_attendance_locations cl where catalog_name='locations' and cl.merchant_id=site and cl.active and (after_id is null or cl.id>after_id)
      ) c order by c.id limit 26 loop
        seen:=seen+1;exit when seen=26;catalog_json:=catalog_json||jsonb_build_array(jsonb_build_object('id',candidate.id,'name',candidate.name,'employeeId',candidate.employee_id,
          'employeeAuthUserId',candidate.member_auth,'workerNo',candidate.worker_no,'timeZone',candidate.zone));next_id:=candidate.id;
      end loop;
    end if;
  end if;
  if mode_name='recover' or p_command is not null then can_write:=false;end if;
  result_json:=jsonb_build_object('protocol','schedule-delegation-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,'employeeId',employee_uuid,'mode',mode_name,
    'canWrite',can_write,'grants',grants_json,'catalogItems',catalog_json,'nextAfterId',case when seen=26 then next_id else null end,'detail',detail,'schedule',schedule,'receipt',receipt,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  if octet_length(convert_to(result_json::text,'UTF8'))>131072 then raise exception 'attendance_schedule_delegation_too_large';end if;
  return result_json;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;

--Five complete, narrowly changed old definitions follow; original files and
--owner writers are never patched or dynamically string-replaced at install.


--Forward compatibility of 202610050136_merchant_attendance_schedule_publication_evidence.sql
create or replace function public.faolla_attendance_schedule_publication_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare original public.merchant_attendance_schedule_commands%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  expected_slots jsonb:='[]';seen_pairs jsonb:='[]';slot_count integer:=0;pair jsonb;
begin
  select * into original from public.merchant_attendance_schedule_commands c where c.merchant_id=new.merchant_id and c.revision=new.revision;
  if original.query->>'access'='delegate' and not exists(select 1 from public.merchant_attendance_schedule_delegation_operations a
    where a.merchant_id=new.merchant_id and a.operation_id=new.operation_id and a.schedule_revision=new.revision
      and row(a.actor_auth_user_id,a.worker_id,a.employee_id,a.employee_auth_user_id,a.location_id,a.worker_version,a.location_version,a.settings_version)
        is not distinct from row(new.actor_auth_user_id,new.worker_id,new.employee_id,new.employee_auth_user_id,new.location_id,new.worker_version,new.location_version,new.settings_version))
    then raise exception 'attendance_schedule_publication_evidence_invalid';end if;
  if original.operation_id is distinct from new.operation_id or original.actor_auth_user_id is distinct from new.actor_auth_user_id
    or original.recorded_at is distinct from new.published_at or original.command->>'action' is distinct from 'publish'
    or original.command->>'operationId' is distinct from new.operation_id::text
    or original.command->'expectedRevision' is distinct from to_jsonb(new.revision-1)
    or original.query->>'workerId' is distinct from new.worker_id::text or original.query->>'siteId' is distinct from new.merchant_id
    or (original.query->>'access' is distinct from 'owner' and public.faolla_attendance_schedule_delegation_proof_v1(original) is distinct from true) or original.query->'operationId' is distinct from 'null'::jsonb
    or original.command->>'locationId' is distinct from new.location_id::text or original.command->>'timeZone' is distinct from new.time_zone
    or original.command->'expectedSettingsVersion' is distinct from to_jsonb(new.settings_version)
    or jsonb_typeof(original.command->'slots') is distinct from 'array' then
    raise exception 'attendance_schedule_publication_evidence_invalid';end if;
  for slot in select x.* from public.merchant_attendance_schedule_slots x where x.merchant_id=new.merchant_id and x.revision=new.revision order by x.id limit 33 loop
    slot_count:=slot_count+1;
    if slot_count>32 or slot.worker_id is distinct from new.worker_id or slot.employee_id is distinct from new.employee_id
      or slot.location_id is distinct from new.location_id or slot.time_zone is distinct from new.time_zone then
      raise exception 'attendance_schedule_publication_evidence_invalid';end if;
    pair:=jsonb_build_array(to_char(slot.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      to_char(slot.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    if not exists(select 1 from jsonb_array_elements(original.command->'slots') expected where expected.value=pair)
      or exists(select 1 from jsonb_array_elements(seen_pairs) seen where seen.value=pair) then
      raise exception 'attendance_schedule_publication_evidence_invalid';end if;
    seen_pairs:=seen_pairs||jsonb_build_array(pair);
    expected_slots:=expected_slots||jsonb_build_array(jsonb_build_object('id',slot.id,'workDate',to_char(slot.work_date,'YYYY-MM-DD'),
      'startAt',pair->0,'endAt',pair->1));
  end loop;
  if slot_count not between 1 and 32 or slot_count<>jsonb_array_length(original.command->'slots') or expected_slots is distinct from new.slots then
    raise exception 'attendance_schedule_publication_evidence_invalid';end if;
  return new;
end;
$$;


--Forward compatibility of 202610050137_merchant_attendance_self_schedule.sql
create or replace function public.faolla_attendance_self_schedule_slot_v1(p public.merchant_attendance_schedule_slots)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare published public.merchant_attendance_schedule_commands%rowtype;cancelled public.merchant_attendance_schedule_commands%rowtype;
  cancellation public.merchant_attendance_schedule_cancellations%rowtype;evidence public.merchant_attendance_schedule_publication_evidence%rowtype;
  slot_item jsonb;publication_item jsonb:=null;cancellation_item jsonb:=null;pair jsonb;matches integer;has_evidence boolean:=false;
begin
  if p.id is null or p.revision<1 or not isfinite(p.start_at) or not isfinite(p.end_at) or p.end_at<=p.start_at or p.end_at-p.start_at>interval '24 hours'
    or date_trunc('minute',p.start_at)<>p.start_at or date_trunc('minute',p.end_at)<>p.end_at
    or p.work_date not between date '2000-01-01' and date '2100-12-31' or char_length(p.location_name) not between 1 and 120
    or p.location_name<>btrim(p.location_name) or p.location_name ~ '[[:cntrl:]]' or char_length(p.time_zone) not between 1 and 100
    or p.time_zone<>btrim(p.time_zone) or p.time_zone ~ '[[:cntrl:]]' then raise exception 'attendance_self_schedule_invalid';end if;
  select * into published from public.merchant_attendance_schedule_commands c where c.merchant_id=p.merchant_id and c.revision=p.revision;
  if published.operation_id is null or published.actor_auth_user_id is null or not isfinite(published.recorded_at)
    or jsonb_typeof(published.command) is distinct from 'object' or jsonb_typeof(published.query) is distinct from 'object' then
    raise exception 'attendance_self_schedule_invalid';end if;
  if (select count(*) from jsonb_object_keys(published.command))<>8
    or not(published.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','locationId','timeZone','slots'])
    or published.command->>'operationId' is distinct from published.operation_id::text or published.command->>'action' is distinct from 'publish'
    or published.command->'expectedRevision' is distinct from to_jsonb(p.revision-1)
    or published.command->>'locationId' is distinct from p.location_id::text or published.command->>'timeZone' is distinct from p.time_zone
    or (select count(*) from jsonb_object_keys(published.query))<>6
    or not(published.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
    or published.query->>'siteId' is distinct from p.merchant_id or published.query->>'workerId' is distinct from p.worker_id::text
    or (published.query->>'access' is distinct from 'owner' and public.faolla_attendance_schedule_delegation_proof_v1(published) is distinct from true) or published.query->'operationId' is distinct from 'null'::jsonb
    or jsonb_typeof(published.command->'slots') is distinct from 'array' then raise exception 'attendance_self_schedule_invalid';end if;
  if jsonb_array_length(published.command->'slots') not between 1 and 32 then raise exception 'attendance_self_schedule_invalid';end if;
  pair:=jsonb_build_array(to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  select count(*) into matches from jsonb_array_elements(published.command->'slots') x where x.value=pair;
  if matches<>1 then raise exception 'attendance_self_schedule_invalid';end if;
  select * into evidence from public.merchant_attendance_schedule_publication_evidence e where e.merchant_id=p.merchant_id and e.revision=p.revision;
  if found then
    if evidence.operation_id is distinct from published.operation_id or evidence.actor_auth_user_id is distinct from published.actor_auth_user_id
      or evidence.worker_id is distinct from p.worker_id or evidence.employee_id is distinct from p.employee_id
      or evidence.location_id is distinct from p.location_id or evidence.time_zone is distinct from p.time_zone
      or evidence.published_at is distinct from published.recorded_at or not isfinite(evidence.recorded_at)
      or published.command->'expectedSettingsVersion' is distinct from to_jsonb(evidence.settings_version)
      or evidence.capture_policy is distinct from 'publish-identity-context-v1'
      or (evidence.employee_auth_user_id is null and evidence.identity_status is distinct from 'unbound')
      or (evidence.employee_auth_user_id is not null and evidence.identity_status is distinct from 'bound')
      or public.faolla_attendance_schedule_publication_slots_v1(evidence.slots) is distinct from true then raise exception 'attendance_self_schedule_invalid';end if;
    select count(*) into matches from jsonb_array_elements(evidence.slots) x where x.value=jsonb_build_object('id',p.id,
      'workDate',to_char(p.work_date,'YYYY-MM-DD'),'startAt',pair->0,'endAt',pair->1);
    if matches<>1 then raise exception 'attendance_self_schedule_invalid';end if;
    has_evidence:=evidence.employee_auth_user_id is not null;
    publication_item:=jsonb_build_object('operationId',evidence.operation_id,'revision',evidence.revision,'actorId',evidence.actor_auth_user_id,
      'employeeId',evidence.employee_id,'employeeAuthUserId',evidence.employee_auth_user_id,'identityStatus',evidence.identity_status,
      'workerVersion',evidence.worker_version,'locationVersion',evidence.location_version,'settingsVersion',evidence.settings_version,
      'timeZone',evidence.time_zone,'publishedAt',to_char(evidence.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'recordedAt',to_char(evidence.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'capturePolicy',evidence.capture_policy);
  end if;
  select * into cancellation from public.merchant_attendance_schedule_cancellations c where c.merchant_id=p.merchant_id and c.slot_id=p.id;
  if found then
    select * into cancelled from public.merchant_attendance_schedule_commands c where c.merchant_id=p.merchant_id and c.revision=cancellation.revision;
    if cancelled.operation_id is null or cancelled.revision<=p.revision or not isfinite(cancelled.recorded_at)
      or jsonb_typeof(cancelled.command) is distinct from 'object' or jsonb_typeof(cancelled.query) is distinct from 'object' then
      raise exception 'attendance_self_schedule_invalid';end if;
    if (select count(*) from jsonb_object_keys(cancelled.command))<>6
      or not(cancelled.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','slotId'])
      or cancelled.command->>'action' is distinct from 'cancel' or cancelled.command->>'slotId' is distinct from p.id::text
      or cancelled.command->>'operationId' is distinct from cancelled.operation_id::text
      or cancelled.command->'expectedRevision' is distinct from to_jsonb(cancelled.revision-1)
      or (select count(*) from jsonb_object_keys(cancelled.query))<>6
      or not(cancelled.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
      or cancelled.query->>'siteId' is distinct from p.merchant_id or cancelled.query->>'workerId' is distinct from p.worker_id::text
      or (cancelled.query->>'access' is distinct from 'owner' and public.faolla_attendance_schedule_delegation_proof_v1(cancelled) is distinct from true) or cancelled.query->'operationId' is distinct from 'null'::jsonb then
      raise exception 'attendance_self_schedule_invalid';end if;
    cancellation_item:=jsonb_build_object('revision',cancelled.revision,'operationId',cancelled.operation_id,'actorId',cancelled.actor_auth_user_id,
      'recordedAt',to_char(cancelled.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
  slot_item:=jsonb_build_object('id',p.id,'revision',p.revision,'locationId',p.location_id,'locationName',p.location_name,'timeZone',p.time_zone,
    'workDate',to_char(p.work_date,'YYYY-MM-DD'),'startAt',pair->0,'endAt',pair->1,'cancelled',cancellation_item is not null,'hasPublicationEvidence',has_evidence);
  return jsonb_build_object('slot',slot_item,'publication',publication_item,'cancellation',cancellation_item);
end;
$$;


--Forward compatibility of 202610030120_merchant_attendance_schedule_overview.sql
create or replace function public.faolla_attendance_schedule_overview_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;workers uuid[]:='{}';worker uuid;previous_worker uuid;value jsonb;k text;
  first_day date;last_day date;cursor_day date;cursor_start timestamptz;cursor_id uuid;
  snapshot_revision bigint;latest_revision bigint;candidate record;
  published public.merchant_attendance_schedule_commands%rowtype;
  cancelled public.merchant_attendance_schedule_commands%rowtype;
  count_rows integer:=0;items jsonb:='[]';next_cursor jsonb:='null';result jsonb;
  start_text text;end_text text;cancel_revision bigint;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>8
    or not(p_query ?& array['siteId','workerIds','fromDate','throughDate','revision','cursorDate','cursorStart','cursorId']) then
    raise exception 'attendance_invalid_request';
  end if;
  site:=p_query->>'siteId';
  if jsonb_typeof(p_query->'siteId')<>'string' or coalesce(site,'') !~ '^[0-9]{8}$'
    or jsonb_typeof(p_query->'workerIds')<>'array' then raise exception 'attendance_invalid_request';end if;
  if jsonb_array_length(p_query->'workerIds') not between 1 and 20 then raise exception 'attendance_invalid_request';end if;
  for value in select jsonb_array_elements(p_query->'workerIds') loop
    if jsonb_typeof(value)<>'string' or coalesce(value#>>'{}','') !~ uuid_pattern then raise exception 'attendance_invalid_request';end if;
    worker:=(value#>>'{}')::uuid;
    if previous_worker is not null and worker<=previous_worker then raise exception 'attendance_invalid_request';end if;
    workers:=array_append(workers,worker);previous_worker:=worker;
  end loop;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (p_query->>k)::date not between date '2000-01-01' and date '2100-12-31'
      or to_char((p_query->>k)::date,'YYYY-MM-DD')<>p_query->>k then raise exception 'attendance_invalid_request';end if;
  end loop;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day<first_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  if p_query->'revision'<>'null'::jsonb then
    if jsonb_typeof(p_query->'revision')<>'number' or coalesce(p_query->>'revision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_query->>'revision')::numeric>9007199254740989 then raise exception 'attendance_invalid_request';end if;
    snapshot_revision:=(p_query->>'revision')::bigint;
  end if;
  if (p_query->'cursorDate'='null'::jsonb)<>(p_query->'cursorStart'='null'::jsonb)
    or (p_query->'cursorDate'='null'::jsonb)<>(p_query->'cursorId'='null'::jsonb) then raise exception 'attendance_invalid_request';end if;
  if p_query->'cursorId'<>'null'::jsonb then
    if snapshot_revision is null or jsonb_typeof(p_query->'cursorId')<>'string' or coalesce(p_query->>'cursorId','') !~ uuid_pattern
      or jsonb_typeof(p_query->'cursorDate')<>'string' or coalesce(p_query->>'cursorDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(p_query->'cursorStart')<>'string' or coalesce(p_query->>'cursorStart','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00\.000Z$' then
      raise exception 'attendance_invalid_request';
    end if;
    cursor_day:=(p_query->>'cursorDate')::date;cursor_start:=(p_query->>'cursorStart')::timestamptz;cursor_id:=(p_query->>'cursorId')::uuid;
    if cursor_day not between first_day and last_day or to_char(cursor_day,'YYYY-MM-DD')<>p_query->>'cursorDate'
      or not isfinite(cursor_start)
      or to_char(cursor_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_query->>'cursorStart' then
      raise exception 'attendance_invalid_request';
    end if;
  end if;
  -- Original099 writes take these locks in this order. The SHARE lock fixes the
  -- first revision read and this page without weakening later owner revocation.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  foreach worker in array workers loop
    perform 1 from public.merchant_attendance_workers where merchant_id=site and id=worker for share;
    if not found then raise exception 'attendance_access_denied';end if;
  end loop;
  select coalesce(max(revision),0) into latest_revision from public.merchant_attendance_schedule_commands where merchant_id=site;
  if snapshot_revision is null then snapshot_revision:=latest_revision;
  elsif snapshot_revision>latest_revision then raise exception 'attendance_invalid_request';end if;

  -- No revision or cancellation filtering before each index-aligned LIMIT.
  -- A later publication can produce an empty page, but cannot cause an unbounded
  -- pre-limit search for old-snapshot rows. Only the first50 merged rows are read.
  for candidate in
    with probes as materialized (
      select s.* from unnest(workers) selected(worker_id)
      cross join lateral (
        select x.* from public.merchant_attendance_schedule_slots x
        where x.merchant_id=site and x.worker_id=selected.worker_id and x.work_date between first_day and last_day
          and (cursor_id is null or (x.work_date,x.start_at,x.id)>(cursor_day,cursor_start,cursor_id))
        order by x.work_date,x.start_at,x.id limit 51
      ) s
    )
    select * from probes order by work_date,start_at,id limit 51
  loop
    count_rows:=count_rows+1;exit when count_rows=51;
    start_text:=to_char(candidate.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    end_text:=to_char(candidate.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    next_cursor:=jsonb_build_object('workDate',candidate.work_date,'startAt',start_text,'slotId',candidate.id);
    if candidate.revision>snapshot_revision then continue;end if;
    begin
      if candidate.revision<1 or candidate.id::text !~ uuid_pattern or candidate.worker_id::text !~ uuid_pattern or candidate.location_id::text !~ uuid_pattern
        or char_length(candidate.worker_name) not between 1 and 120 or candidate.worker_name<>btrim(candidate.worker_name) or candidate.worker_name ~ '[[:cntrl:]]'
        or char_length(candidate.location_name) not between 1 and 120 or candidate.location_name<>btrim(candidate.location_name) or candidate.location_name ~ '[[:cntrl:]]'
        or not public.faolla_attendance_valid_zone_v1(candidate.time_zone)
        or not isfinite(candidate.start_at) or not isfinite(candidate.end_at) or candidate.end_at<=candidate.start_at
        or candidate.end_at-candidate.start_at>interval '24 hours'
        or date_trunc('minute',candidate.start_at)<>candidate.start_at or date_trunc('minute',candidate.end_at)<>candidate.end_at
        or (candidate.start_at at time zone candidate.time_zone)::date<>candidate.work_date then raise exception 'attendance_schedule_overview_invalid';end if;
      select * into published from public.merchant_attendance_schedule_commands where merchant_id=site and revision=candidate.revision;
      if not found or published.command->>'action' is distinct from 'publish'
        or jsonb_typeof(published.query) is distinct from 'object' or (select count(*) from jsonb_object_keys(published.query))<>6
        or not(published.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
        or published.query->'operationId' is distinct from 'null'::jsonb
        or jsonb_typeof(published.command) is distinct from 'object' or (select count(*) from jsonb_object_keys(published.command))<>8
        or not(published.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','locationId','timeZone','slots'])
        or published.query->>'siteId' is distinct from site or (published.query->>'access' is distinct from 'owner' and public.faolla_attendance_schedule_delegation_proof_v1(published) is distinct from true)
        or published.query->>'workerId' is distinct from candidate.worker_id::text
        or published.command->>'operationId' is distinct from published.operation_id::text
        or published.command->>'locationId' is distinct from candidate.location_id::text
        or published.command->>'timeZone' is distinct from candidate.time_zone
        or (published.command->>'expectedRevision')::bigint is distinct from candidate.revision-1
        or candidate.work_date not between (published.query->>'fromDate')::date and (published.query->>'throughDate')::date
        or not coalesce(published.command->'slots' @> jsonb_build_array(jsonb_build_array(start_text,end_text)),false) then
        raise exception 'attendance_schedule_overview_invalid';
      end if;
      -- The ON predicate hides future cancellations while retaining the slot.
      select c.revision into cancel_revision from public.merchant_attendance_schedule_slots s
        left join public.merchant_attendance_schedule_cancellations c on c.merchant_id=s.merchant_id and c.slot_id=s.id and c.revision<=snapshot_revision
        where s.merchant_id=site and s.id=candidate.id;
      if cancel_revision is not null then
        select * into cancelled from public.merchant_attendance_schedule_commands where merchant_id=site and revision=cancel_revision;
        if not found or cancel_revision<=candidate.revision or cancelled.command->>'action' is distinct from 'cancel'
          or jsonb_typeof(cancelled.query) is distinct from 'object' or (select count(*) from jsonb_object_keys(cancelled.query))<>6
          or not(cancelled.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
          or cancelled.query->'operationId' is distinct from 'null'::jsonb
          or jsonb_typeof(cancelled.command) is distinct from 'object' or (select count(*) from jsonb_object_keys(cancelled.command))<>6
          or not(cancelled.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','slotId'])
          or cancelled.query->>'siteId' is distinct from site or (cancelled.query->>'access' is distinct from 'owner' and public.faolla_attendance_schedule_delegation_proof_v1(cancelled) is distinct from true)
          or cancelled.query->>'workerId' is distinct from candidate.worker_id::text
          or cancelled.command->>'operationId' is distinct from cancelled.operation_id::text
          or cancelled.command->>'slotId' is distinct from candidate.id::text
          or (cancelled.command->>'expectedRevision')::bigint is distinct from cancel_revision-1
          or candidate.work_date not between (cancelled.query->>'fromDate')::date and (cancelled.query->>'throughDate')::date then raise exception 'attendance_schedule_overview_invalid';end if;
      end if;
    exception when others then raise exception 'attendance_schedule_overview_invalid';end;
    items:=items||jsonb_build_array(jsonb_build_object('id',candidate.id,'workerId',candidate.worker_id,'workerName',candidate.worker_name,
      'locationId',candidate.location_id,'locationName',candidate.location_name,'timeZone',candidate.time_zone,'workDate',candidate.work_date,
      'startAt',start_text,'endAt',end_text,'revision',candidate.revision,'cancelled',cancel_revision is not null,'cancelRevision',cancel_revision));
  end loop;
  result:=jsonb_build_object('protocol','schedule-overview-v1','readOnly',true,'siteId',site,'ownerId',p_auth_user_id,'workerIds',to_jsonb(workers),
    'fromDate',first_day,'throughDate',last_day,'revision',snapshot_revision,'items',items,'scanned',least(count_rows,50),
    'nextCursor',case when count_rows=51 then next_cursor else 'null'::jsonb end);
  if octet_length(result::text)>131072 then raise exception 'attendance_schedule_overview_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then
  raise exception 'attendance_invalid_request';
end;
$$;


--Forward compatibility of 202610040128_merchant_attendance_sources.sql
create or replace function public.faolla_attendance_sources_schedule_v1(p public.merchant_attendance_schedule_slots)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare original public.merchant_attendance_schedule_commands%rowtype;cancelled public.merchant_attendance_schedule_commands%rowtype;
  cancellation public.merchant_attendance_schedule_cancellations%rowtype;x jsonb;a timestamptz;b timestamptz;previous_end timestamptz;
  matches integer:=0;first_day date;last_day date;k text;
begin
  select * into original from public.merchant_attendance_schedule_commands where merchant_id=p.merchant_id and revision=p.revision;
  if original.operation_id is null or jsonb_typeof(original.command) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(original.command))<>8
    or not(original.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','locationId','timeZone','slots'])
    or original.command->>'operationId' is distinct from original.operation_id::text or original.command->>'action' is distinct from 'publish'
    or original.command->'expectedRevision' is distinct from to_jsonb(original.revision-1)
    or original.command->>'locationId' is distinct from p.location_id::text or original.command->>'timeZone' is distinct from p.time_zone
    or jsonb_typeof(original.command->'slots') is distinct from 'array' or jsonb_array_length(original.command->'slots') not between 1 and 32
    or jsonb_typeof(original.query) is distinct from 'object' or (select count(*) from jsonb_object_keys(original.query))<>6
    or not(original.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
    or original.query->>'siteId' is distinct from p.merchant_id or original.query->>'workerId' is distinct from p.worker_id::text
    or (original.query->>'access' is distinct from 'owner' and public.faolla_attendance_schedule_delegation_proof_v1(original) is distinct from true) or original.query->'operationId' is distinct from 'null'::jsonb
    or not isfinite(original.recorded_at)
    or not public.faolla_attendance_group_text_v1(p.worker_name,1,120) or not public.faolla_attendance_group_text_v1(p.location_name,1,120)
    or p.work_date<>(p.start_at at time zone p.time_zone)::date then raise exception 'attendance_sources_invalid';end if;
  if jsonb_typeof(original.command->'reason') is distinct from 'string'
    or not public.faolla_attendance_group_text_v1(original.command->>'reason',1,200)
    or jsonb_typeof(original.command->'expectedSettingsVersion') is distinct from 'number'
    or coalesce(original.command->>'expectedSettingsVersion','') !~ '^[1-9][0-9]{0,15}$'
    or (original.command->>'expectedSettingsVersion')::numeric>9007199254740989 then raise exception 'attendance_sources_invalid';end if;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(original.query->k) is distinct from 'string' or not public.faolla_attendance_group_date_v1(original.query->>k) then
      raise exception 'attendance_sources_invalid';end if;
  end loop;
  first_day:=(original.query->>'fromDate')::date;last_day:=(original.query->>'throughDate')::date;
  if last_day-first_day not between 0 and 30 or p.work_date not between first_day and last_day then raise exception 'attendance_sources_invalid';end if;
  for x in select value from jsonb_array_elements(original.command->'slots') loop
    if jsonb_typeof(x) is distinct from 'array' or jsonb_array_length(x)<>2 or jsonb_typeof(x->0) is distinct from 'string' or jsonb_typeof(x->1) is distinct from 'string'
      or coalesce(x->>0,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$' or coalesce(x->>1,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$' then raise exception 'attendance_sources_invalid';end if;
    a:=(x->>0)::timestamptz;b:=(x->>1)::timestamptz;
    if not isfinite(a) or not isfinite(b) or b<=a or b-a>interval '24 hours' or a<previous_end
      or to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>x->>0 or to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>x->>1
      or (a at time zone p.time_zone)::date not between first_day and last_day then raise exception 'attendance_sources_invalid';end if;
    if a=p.start_at and b=p.end_at then matches:=matches+1;end if;previous_end:=b;
  end loop;
  if matches<>1 then raise exception 'attendance_sources_invalid';end if;
  select * into cancellation from public.merchant_attendance_schedule_cancellations where merchant_id=p.merchant_id and slot_id=p.id;
  if found then
    select * into cancelled from public.merchant_attendance_schedule_commands where merchant_id=p.merchant_id and revision=cancellation.revision;
    if cancelled.operation_id is null or cancelled.revision<=p.revision or not isfinite(cancelled.recorded_at) or cancelled.recorded_at<original.recorded_at
      or jsonb_typeof(cancelled.command) is distinct from 'object' or (select count(*) from jsonb_object_keys(cancelled.command))<>6
      or not(cancelled.command ?& array['operationId','expectedRevision','expectedSettingsVersion','reason','action','slotId'])
      or cancelled.command->>'operationId' is distinct from cancelled.operation_id::text or cancelled.command->>'action' is distinct from 'cancel'
      or cancelled.command->>'slotId' is distinct from p.id::text or cancelled.command->'expectedRevision' is distinct from to_jsonb(cancelled.revision-1)
      or jsonb_typeof(cancelled.command->'expectedSettingsVersion') is distinct from 'number'
      or coalesce(cancelled.command->>'expectedSettingsVersion','') !~ '^[1-9][0-9]{0,15}$' or (cancelled.command->>'expectedSettingsVersion')::numeric>9007199254740989
      or jsonb_typeof(cancelled.command->'reason') is distinct from 'string' or not public.faolla_attendance_group_text_v1(cancelled.command->>'reason',1,200)
      or jsonb_typeof(cancelled.query) is distinct from 'object' or (select count(*) from jsonb_object_keys(cancelled.query))<>6
      or not(cancelled.query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
      or cancelled.query->>'siteId' is distinct from p.merchant_id or cancelled.query->>'workerId' is distinct from p.worker_id::text
      or (cancelled.query->>'access' is distinct from 'owner' and public.faolla_attendance_schedule_delegation_proof_v1(cancelled) is distinct from true) or cancelled.query->'operationId' is distinct from 'null'::jsonb
      or not public.faolla_attendance_group_date_v1(cancelled.query->>'fromDate') or not public.faolla_attendance_group_date_v1(cancelled.query->>'throughDate')
      or (cancelled.query->>'throughDate')::date-(cancelled.query->>'fromDate')::date not between 0 and 30
      or p.work_date not between (cancelled.query->>'fromDate')::date and (cancelled.query->>'throughDate')::date then raise exception 'attendance_sources_invalid';end if;
  end if;
  return jsonb_build_object('id',p.id,'workerId',p.worker_id,'workerName',p.worker_name,'locationId',p.location_id,'locationName',p.location_name,
    'timeZone',p.time_zone,'workDate',to_char(p.work_date,'YYYY-MM-DD'),'startAt',to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endAt',to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',p.revision,'cancelled',cancelled.operation_id is not null,
    'reason',original.command->>'reason','cancelReason',cancelled.command->>'reason');
end;
$$;


--Forward compatibility of 202610060164_merchant_attendance_account_suspensions.sql
create or replace function public.faolla_attendance_account_capture_v1(p_site text,p_employee uuid,p_actor uuid,p_actor_employee uuid,p_enabled boolean)
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

do $schedule_delegation_security$
declare n text;t regclass;
begin
  foreach n in array array['merchant_attendance_schedule_delegations','merchant_attendance_schedule_delegation_revocations','merchant_attendance_schedule_delegation_operations'] loop
    t:=to_regclass('public.'||n);
    execute format('alter table %s enable row level security',t);
    execute format('revoke all on %s from public,anon,authenticated,service_role',t);
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_schedule_delegation_immutable') then
      execute format('create trigger attendance_schedule_delegation_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_schedule_delegation_no_truncate') then
      execute format('create trigger attendance_schedule_delegation_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_schedule_delegation_operations'::regclass and tgname='attendance_schedule_delegation_authority') then
    create trigger attendance_schedule_delegation_authority after insert on public.merchant_attendance_schedule_delegation_operations
      for each row execute function public.faolla_attendance_schedule_delegation_guard_v1();end if;
end;
$schedule_delegation_security$;

revoke all on function public.faolla_attendance_schedule_delegation_command_v1(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_schedule_delegation_hash_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_schedule_delegation_actions_v1(public.merchant_attendance_schedule_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_schedule_delegation_grant_v1(public.merchant_attendance_schedule_delegations,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_schedule_delegation_proof_v1(public.merchant_attendance_schedule_commands) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_schedule_delegation_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_schedule_delegation_receipt_v1(text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_schedule_delegation_schedule_v1(public.merchant_attendance_schedule_delegations,date,date,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_schedule_delegation_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_schedule_delegation_v1(jsonb,uuid,jsonb,boolean) to service_role;
--The five replaced definitions retain their existing ACL; assert them below.
insert into public.faolla_schema_migrations(version,name) values(202610060167,'merchant_attendance_schedule_delegation') on conflict(version) do nothing;

do $schedule_delegation_postconditions$
declare n text;t regclass;r text;f regprocedure;body text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610060167 and name='merchant_attendance_schedule_delegation') then raise exception 'merchant_attendance_schedule_delegation_postcondition_failed';end if;
  foreach n in array array['merchant_attendance_schedule_delegations','merchant_attendance_schedule_delegation_revocations','merchant_attendance_schedule_delegation_operations'] loop
    t:=to_regclass('public.'||n);
    if t is null or not(select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_schedule_delegation_postcondition_failed';end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_schedule_delegation_immutable' and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and tgenabled='O' and tgtype=27)
      or not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_schedule_delegation_no_truncate' and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and tgenabled='O' and tgtype=34) then raise exception 'merchant_attendance_schedule_delegation_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_schedule_delegation_acl_failed';end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_schedule_delegation_operations'::regclass and tgname='attendance_schedule_delegation_authority'
    and tgfoid='public.faolla_attendance_schedule_delegation_guard_v1()'::regprocedure and tgtype=5 and tgenabled='O') then raise exception 'merchant_attendance_schedule_delegation_postcondition_failed';end if;
  foreach n in array array['public.faolla_attendance_schedule_delegation_command_v1(jsonb,text)','public.faolla_attendance_schedule_delegation_hash_v1(jsonb,jsonb)',
    'public.faolla_attendance_schedule_delegation_actions_v1(public.merchant_attendance_schedule_delegations,timestamptz)',
    'public.faolla_attendance_schedule_delegation_grant_v1(public.merchant_attendance_schedule_delegations,jsonb)',
    'public.faolla_attendance_schedule_delegation_proof_v1(public.merchant_attendance_schedule_commands)','public.faolla_attendance_schedule_delegation_guard_v1()',
    'public.faolla_attendance_schedule_delegation_receipt_v1(text,uuid,uuid,text,uuid)',
    'public.faolla_attendance_schedule_delegation_schedule_v1(public.merchant_attendance_schedule_delegations,date,date,jsonb,timestamptz)',
    'public.faolla_attendance_schedule_publication_guard_v1()','public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_sources_schedule_v1(public.merchant_attendance_schedule_slots)','public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'] loop
    f:=to_regprocedure(n);if f is null then raise exception 'merchant_attendance_schedule_delegation_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,f,'EXECUTE') then raise exception 'merchant_attendance_schedule_delegation_acl_failed';end if;
    end loop;
  end loop;
  foreach n in array array['public.faolla_attendance_schedule_delegation_v1(jsonb,uuid,jsonb,boolean)','public.faolla_attendance_schedule_overview_v1(jsonb,uuid)'] loop
    f:=to_regprocedure(n);
    if f is null or not has_function_privilege('service_role',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'merchant_attendance_schedule_delegation_acl_failed';end if;
  end loop;
  body:=pg_get_functiondef('public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'::regprocedure);
  if position('merchant_attendance_schedule_delegations' in body)=0 then raise exception 'merchant_attendance_schedule_delegation_postcondition_failed';end if;
end;
$schedule_delegation_postconditions$;
notify pgrst, 'reload schema';
commit;
