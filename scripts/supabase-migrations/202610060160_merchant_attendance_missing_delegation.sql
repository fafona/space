--189 opt-in, exact employee x saved-location missing-review delegation.
--No old function replacement, role grant, historical rewrite or owner spoofing.
--Three phases: read-only preflight; concurrent old-request index; atomic new
--storage/functions/registry. Do not wrap this file in an outer transaction.
begin;
set local lock_timeout='3s';
do $missing_delegation_prerequisites$
declare dep record;installed boolean;n text;idx oid;keys text[]:=array['merchant_id','worker_id','employee_id','actor_auth_user_id','location_id','submitted_at','request_id'];opts integer[]:=array[0,0,0,0,0,3,3];
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_missing_delegation_prerequisite_required';end if;
  for dep in select * from (values
    (202610010103::bigint,'merchant_attendance_missing_revisions'),
    (202610040135::bigint,'merchant_attendance_shift_rule_binding_reader'),
    (202610050150::bigint,'merchant_attendance_period_seal_guards')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dep.version and m.name=dep.name) then raise exception 'merchant_attendance_missing_delegation_prerequisite_required';end if;
  end loop;
  foreach n in array array['public.faolla_attendance_missing_review_v1(public.merchant_attendance_missing_requests,uuid,boolean)',
    'public.faolla_attendance_period_assert_open_v1(text,uuid,jsonb)','public.faolla_attendance_events_append_only_v1()',
    'public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])','public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)',
    'public.faolla_valid_merchant_enterprise_permissions_v1(text[])'] loop
    if to_regprocedure(n) is null then raise exception 'merchant_attendance_missing_delegation_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060160 and name<>'merchant_attendance_missing_delegation') then raise exception 'merchant_attendance_missing_delegation_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060160 and name='merchant_attendance_missing_delegation') into installed;
  foreach n in array array['merchant_attendance_missing_delegations','merchant_attendance_missing_delegation_revocations','merchant_attendance_missing_delegation_decisions'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_missing_delegation_installation_conflict';end if;
  end loop;
  foreach n in array array['faolla_attendance_missing_delegation_command_v1','faolla_attendance_missing_delegation_hash_v1',
    'faolla_attendance_missing_delegation_guard_v1','faolla_attendance_missing_delegation_usable_v1',
    'faolla_attendance_missing_delegation_grant_v1','faolla_attendance_missing_delegation_receipt_v1',
    'faolla_attendance_missing_delegation_item_v1','faolla_attendance_missing_delegations_v1','faolla_attendance_delegated_missing_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n) then raise exception 'merchant_attendance_missing_delegation_installation_conflict';end if;
  end loop;
  idx:=to_regclass('public.attendance_missing_delegation_list_idx');
  if installed and idx is null then raise exception 'merchant_attendance_missing_delegation_index_conflict';end if;
  if idx is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where c.oid=idx and c.relkind='i' and am.amname='btree' and i.indrelid='public.merchant_attendance_missing_requests'::regclass
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion
      and i.indpred is null and i.indexprs is null and i.indnatts=7 and i.indnkeyatts=7
      and not exists(select 1 from generate_subscripts(keys,1) z where
        (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1]) is distinct from keys[z]
        or i.indoption[z-1]<>opts[z] or i.indcollation[z-1] is distinct from (select attcollation from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1])
        or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
          where o.oid=i.indclass[z-1] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_missing_delegation_index_conflict';end if;
end;
$missing_delegation_prerequisites$;
commit;

--Correct valid orphans are reusable. Invalid/wrong objects are never repaired.
create index concurrently if not exists attendance_missing_delegation_list_idx
  on public.merchant_attendance_missing_requests(merchant_id,worker_id,employee_id,actor_auth_user_id,location_id,submitted_at desc,request_id desc);

begin;
set local lock_timeout='3s';
do $missing_delegation_index_ready$
declare idx oid:=to_regclass('public.attendance_missing_delegation_list_idx');keys text[]:=array['merchant_id','worker_id','employee_id','actor_auth_user_id','location_id','submitted_at','request_id'];opts integer[]:=array[0,0,0,0,0,3,3];
begin
  if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where c.oid=idx and c.relkind='i' and am.amname='btree' and i.indrelid='public.merchant_attendance_missing_requests'::regclass
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion
      and i.indpred is null and i.indexprs is null and i.indnatts=7 and i.indnkeyatts=7
      and not exists(select 1 from generate_subscripts(keys,1) z where
        (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1]) is distinct from keys[z]
        or i.indoption[z-1]<>opts[z] or i.indcollation[z-1] is distinct from (select attcollation from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1])
        or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
          where o.oid=i.indclass[z-1] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_missing_delegation_index_conflict';end if;
end;
$missing_delegation_index_ready$;

create or replace function public.faolla_attendance_missing_delegation_command_v1(p jsonb,p_access text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare d jsonb;k text;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(convert_to(p::text,'UTF8'))>8192 then return false;end if;
  if p_access='delegate' then
    if public.faolla_attendance_shift_rule_binding_object_v1(p,array['grantId','expectedGrantRevision','decision']) is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'grantId','uuid') is distinct from true or p->'expectedGrantRevision' is distinct from '1'::jsonb then return false;end if;
    d:=p->'decision';
    if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','requestId','expectedRevision','evidenceToken','reason']) is distinct from true
      or coalesce(d->>'action','') not in('approve','reject') or d->'expectedRevision' is distinct from '1'::jsonb
      or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'requestId','uuid') is distinct from true
      or jsonb_typeof(d->'evidenceToken') is distinct from 'string' or coalesce(d->>'evidenceToken','')!~'^[0-9a-f]{32}$' then return false;end if;
  elsif p_access='owner' then
    d:=p;
    if d->>'action'='grant' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','locationId','validFrom','validUntil','reason']) is distinct from true then return false;end if;
      foreach k in array array['delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','locationId'] loop
        if public.faolla_attendance_shift_rule_binding_scalar_v1(d->k,'uuid') is distinct from true then return false;end if;
      end loop;
      if public.faolla_attendance_shift_rule_binding_scalar_v1(d->'validFrom','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'validUntil','stamp6') is distinct from true then return false;end if;
      if (d->>'validFrom')::timestamptz>=(d->>'validUntil')::timestamptz then return false;end if;
    elsif d->>'action'='revoke' then
      if public.faolla_attendance_shift_rule_binding_object_v1(d,array['action','operationId','grantId','expectedRevision','reason']) is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(d->'grantId','uuid') is distinct from true or d->'expectedRevision' is distinct from '1'::jsonb then return false;end if;
    else return false;end if;
  else return false;end if;
  return public.faolla_attendance_shift_rule_binding_scalar_v1(d->'operationId','uuid') is true
    and public.faolla_attendance_shift_rule_binding_scalar_v1(d->'reason','reason') is true;
end;
$$;
create or replace function public.faolla_attendance_missing_delegation_hash_v1(p_site text,p_access text,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare values_json jsonb;d jsonb;
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or public.faolla_attendance_missing_delegation_command_v1(p,p_access) is distinct from true then raise exception 'attendance_invalid_request';end if;
  values_json:=jsonb_build_array('attendance-missing-delegation-v1',p_site,p_access);
  if p_access='delegate' then
    d:=p->'decision';values_json:=values_json||jsonb_build_array(d->>'action',d->>'operationId',p->>'grantId',(p->>'expectedGrantRevision')::integer,d->>'requestId',(d->>'expectedRevision')::integer,d->>'evidenceToken',d->>'reason');
  elsif p->>'action'='grant' then
    values_json:=values_json||jsonb_build_array(p->>'action',p->>'operationId',p->>'delegateEmployeeId',p->>'delegateAuthUserId',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId',p->>'locationId',p->>'validFrom',p->>'validUntil',p->>'reason');
  else values_json:=values_json||jsonb_build_array(p->>'action',p->>'operationId',p->>'grantId',(p->>'expectedRevision')::integer,p->>'reason');end if;
  return encode(sha256(convert_to(values_json::text,'UTF8')),'hex');
end;
$$;

create table if not exists public.merchant_attendance_missing_delegations(
  merchant_id text not null references public.merchants(id),grant_id uuid not null,
  delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,delegate_name text not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,worker_name text not null,worker_no text not null,
  location_id uuid not null,location_name text not null,time_zone text not null,
  valid_from timestamptz not null,valid_until timestamptz not null,actor_auth_user_id uuid not null,reason text not null,
  command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,grant_id),
  foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,location_id) references public.merchant_attendance_locations(merchant_id,id),
  check(isfinite(valid_from) and isfinite(valid_until) and valid_from<valid_until and isfinite(recorded_at)),
  check(public.faolla_attendance_missing_delegation_command_v1(command,'owner') is true and command->>'action'='grant'
    and command->>'operationId'=grant_id::text and command->>'delegateEmployeeId'=delegate_employee_id::text and command->>'delegateAuthUserId'=delegate_auth_user_id::text
    and command->>'workerId'=worker_id::text and command->>'employeeId'=employee_id::text and command->>'employeeAuthUserId'=employee_auth_user_id::text
    and command->>'locationId'=location_id::text and (command->>'validFrom')::timestamptz=valid_from and (command->>'validUntil')::timestamptz=valid_until
    and command->>'reason'=reason and command_fingerprint=public.faolla_attendance_missing_delegation_hash_v1(merchant_id,'owner',command)),
  check(public.faolla_attendance_group_text_v1(delegate_name,1,120) and public.faolla_attendance_group_text_v1(worker_name,1,120)
    and public.faolla_attendance_group_text_v1(worker_no,1,40) and public.faolla_attendance_group_text_v1(location_name,1,120)
    and public.faolla_attendance_group_text_v1(time_zone,1,100))
);
create index if not exists attendance_missing_delegation_delegate_idx on public.merchant_attendance_missing_delegations(merchant_id,delegate_employee_id,delegate_auth_user_id,grant_id);
create table if not exists public.merchant_attendance_missing_delegation_revocations(
  merchant_id text not null,operation_id uuid not null,grant_id uuid not null,actor_auth_user_id uuid not null,
  reason text not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,grant_id),
  foreign key(merchant_id,grant_id) references public.merchant_attendance_missing_delegations(merchant_id,grant_id),
  check(isfinite(recorded_at)),check(public.faolla_attendance_missing_delegation_command_v1(command,'owner') is true and command->>'action'='revoke'
    and command->>'operationId'=operation_id::text and command->>'grantId'=grant_id::text and command->>'reason'=reason
    and command_fingerprint=public.faolla_attendance_missing_delegation_hash_v1(merchant_id,'owner',command))
);
create table if not exists public.merchant_attendance_missing_delegation_decisions(
  merchant_id text not null,operation_id uuid not null,request_id uuid not null,grant_id uuid not null,
  delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,delegate_name text not null,
  worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,location_id uuid not null,
  action text not null,command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,request_id),
  foreign key(merchant_id,operation_id) references public.merchant_attendance_missing_entries(merchant_id,operation_id),
  foreign key(merchant_id,request_id) references public.merchant_attendance_missing_requests(merchant_id,request_id),
  foreign key(merchant_id,grant_id) references public.merchant_attendance_missing_delegations(merchant_id,grant_id),
  foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(action in('approve','reject') and isfinite(recorded_at) and delegate_auth_user_id<>employee_auth_user_id),
  check(public.faolla_attendance_group_text_v1(delegate_name,1,120)),
  check(public.faolla_attendance_missing_delegation_command_v1(command,'delegate') is true and command->>'grantId'=grant_id::text
    and command->'decision'->>'operationId'=operation_id::text and command->'decision'->>'requestId'=request_id::text and command->'decision'->>'action'=action
    and command_fingerprint=public.faolla_attendance_missing_delegation_hash_v1(merchant_id,'delegate',command))
);

create or replace function public.faolla_attendance_missing_delegation_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_missing_delegations%rowtype;r public.merchant_attendance_missing_requests%rowtype;e public.merchant_attendance_missing_entries%rowtype;
begin
  if tg_op<>'INSERT' or tg_when<>'BEFORE' or tg_level<>'ROW' then raise exception 'attendance_missing_delegation_invalid';end if;
  select * into g from public.merchant_attendance_missing_delegations x where x.merchant_id=new.merchant_id and x.grant_id=new.grant_id;
  select * into r from public.merchant_attendance_missing_requests x where x.merchant_id=new.merchant_id and x.request_id=new.request_id;
  select * into e from public.merchant_attendance_missing_entries x where x.merchant_id=new.merchant_id and x.operation_id=new.operation_id;
  if g.grant_id is null or r.request_id is null or e.operation_id is null
    or (new.delegate_employee_id,new.delegate_auth_user_id,new.worker_id,new.employee_id,new.employee_auth_user_id,new.location_id)
      is distinct from (g.delegate_employee_id,g.delegate_auth_user_id,g.worker_id,g.employee_id,g.employee_auth_user_id,g.location_id)
    or (r.worker_id,r.employee_id,r.actor_auth_user_id,r.location_id) is distinct from (g.worker_id,g.employee_id,g.employee_auth_user_id,g.location_id)
    or e.request_id<>r.request_id or e.revision<>2 or e.action<>new.action or e.actor_auth_user_id<>new.delegate_auth_user_id
    or e.command is distinct from new.command->'decision' or e.recorded_at is distinct from new.recorded_at
    or new.recorded_at<g.valid_from or new.recorded_at>=g.valid_until
    or exists(select 1 from public.merchant_attendance_missing_delegation_revocations x where x.merchant_id=g.merchant_id and x.grant_id=g.grant_id) then raise exception 'attendance_missing_delegation_invalid';end if;
  return new;
end;
$$;
do $missing_delegation_storage$
declare n text;t regclass;
begin
  foreach n in array array['merchant_attendance_missing_delegations','merchant_attendance_missing_delegation_revocations','merchant_attendance_missing_delegation_decisions'] loop
    t:=to_regclass('public.'||n);
    execute format('alter table %s enable row level security',t);
    execute format('revoke all on %s from public,anon,authenticated,service_role',t);
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='missing_delegation_immutable') then
      execute format('create trigger missing_delegation_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='missing_delegation_no_truncate') then
      execute format('create trigger missing_delegation_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_missing_delegation_decisions'::regclass and tgname='missing_delegation_decision_guard') then
    create trigger missing_delegation_decision_guard before insert on public.merchant_attendance_missing_delegation_decisions for each row execute function public.faolla_attendance_missing_delegation_guard_v1();end if;
end;
$missing_delegation_storage$;

--Private projection helpers contain no public authorization shortcut.
create or replace function public.faolla_attendance_missing_delegation_usable_v1(p public.merchant_attendance_missing_delegations,p_at timestamptz)
returns boolean language sql stable set search_path=pg_catalog as $$
  select p_at>=p.valid_from and p_at<p.valid_until
    and not exists(select 1 from public.merchant_attendance_missing_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id)
    and exists(select 1 from public.merchant_enterprise_employees de
      join public.merchant_enterprise_roles dr on dr.merchant_id=de.merchant_id and dr.id=de.role_id
      join public.merchant_attendance_workers w on w.merchant_id=de.merchant_id and w.id=p.worker_id
      join public.merchant_enterprise_employees te on te.merchant_id=w.merchant_id and te.id=w.employee_id
      join public.merchant_attendance_locations l on l.merchant_id=w.merchant_id and l.id=p.location_id
      where de.merchant_id=p.merchant_id and de.id=p.delegate_employee_id and de.auth_user_id=p.delegate_auth_user_id and de.status='active'
        and dr.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions)
        and dr.permissions @> array['enterprise.view','attendance.self.view','attendance.missing.review']::text[]
        and w.active and w.employee_id=p.employee_id and te.auth_user_id=p.employee_auth_user_id and te.status='active' and l.active
        and de.auth_user_id<>te.auth_user_id);
$$;
create or replace function public.faolla_attendance_missing_delegation_grant_v1(p public.merchant_attendance_missing_delegations,p_usable boolean)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare r public.merchant_attendance_missing_delegation_revocations%rowtype;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  select * into r from public.merchant_attendance_missing_delegation_revocations x where x.merchant_id=p.merchant_id and x.grant_id=p.grant_id;
  return jsonb_build_object('grantId',p.grant_id,'revision',case when r.operation_id is null then 1 else 2 end,'status',case when r.operation_id is null then 'granted' else 'revoked' end,
    'delegate',jsonb_build_object('employeeId',p.delegate_employee_id,'authUserId',p.delegate_auth_user_id,'name',p.delegate_name),
    'worker',jsonb_build_object('workerId',p.worker_id,'employeeId',p.employee_id,'authUserId',p.employee_auth_user_id,'name',p.worker_name,'workerNo',p.worker_no),
    'location',jsonb_build_object('locationId',p.location_id,'name',p.location_name,'timeZone',p.time_zone),
    'validFrom',to_char(p.valid_from at time zone 'UTC',fmt),'validUntil',to_char(p.valid_until at time zone 'UTC',fmt),'grantedBy',p.actor_auth_user_id,'grantedAt',to_char(p.recorded_at at time zone 'UTC',fmt),'reason',p.reason,
    'revocation',case when r.operation_id is null then null else jsonb_build_object('operationId',r.operation_id,'actorId',r.actor_auth_user_id,'reason',r.reason,'recordedAt',to_char(r.recorded_at at time zone 'UTC',fmt)) end,'usable',p_usable and r.operation_id is null);
end;
$$;
create or replace function public.faolla_attendance_missing_delegation_receipt_v1(p public.merchant_attendance_missing_delegation_decisions)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare e public.merchant_attendance_missing_entries%rowtype;
begin
  select * into e from public.merchant_attendance_missing_entries x where x.merchant_id=p.merchant_id and x.operation_id=p.operation_id;
  if e.operation_id is null or e.request_id<>p.request_id or e.revision<>2 or e.action<>p.action or e.actor_auth_user_id<>p.delegate_auth_user_id
    or e.command is distinct from p.command->'decision' or e.recorded_at is distinct from p.recorded_at
    or p.command_fingerprint is distinct from public.faolla_attendance_missing_delegation_hash_v1(p.merchant_id,'delegate',p.command) then raise exception 'attendance_missing_delegation_invalid';end if;
  return jsonb_build_object('operationId',p.operation_id,'requestId',p.request_id,'grantId',p.grant_id,'action',p.action,
    'status',case when p.action='approve' then 'approved' else 'rejected' end,'actorId',p.delegate_auth_user_id,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',p.command_fingerprint);
end;
$$;
create or replace function public.faolla_attendance_missing_delegation_item_v1(p public.merchant_attendance_missing_requests,p_review jsonb default null)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare item jsonb;
begin
  item:=jsonb_build_object('requestId',p.request_id,'workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.actor_auth_user_id,
    'workerName',p.worker_name,'locationId',p.location_id,'locationName',p.location_name,'timeZone',p.time_zone,
    'submittedAt',to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'status','submitted');
  if p_review is not null then
    item:=item||jsonb_build_object('proposal',p.proposal,'reason',p.reason,'evidenceToken',p_review->'evidenceToken','blocked',p_review->'issues'<>'[]'::jsonb,
      'canApprove',p_review->'canApprove','canReject',p_review->'canReject');
  end if;
  return item;
end;
$$;

create or replace function public.faolla_attendance_missing_delegations_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;kind text;k text;after_id uuid;target_grant_id uuid;op uuid;action_name text;stamp timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  de public.merchant_enterprise_employees%rowtype;te public.merchant_enterprise_employees%rowtype;dr public.merchant_enterprise_roles%rowtype;
  loc public.merchant_attendance_locations%rowtype;g public.merchant_attendance_missing_delegations%rowtype;rv public.merchant_attendance_missing_delegation_revocations%rowtype;
  candidate record;items jsonb:='[]';catalog_items jsonb:='[]';detail jsonb;receipt jsonb;result jsonb;next_id uuid;seen integer:=0;can_write boolean;
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
    if public.faolla_attendance_missing_delegation_command_v1(p_command,'owner') is distinct from true then raise exception 'attendance_invalid_request';end if;
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
  if not p_allow_write and mode_name<>'recover' and action_name is distinct from 'revoke' then raise exception 'attendance_missing_delegation_disabled';end if;
  can_write:=p_allow_write and s.enabled;
  if op is not null then
    select * into g from public.merchant_attendance_missing_delegations x where x.merchant_id=site and x.grant_id=op;
    select * into rv from public.merchant_attendance_missing_delegation_revocations x where x.merchant_id=site and x.operation_id=op;
    if g.grant_id is not null and rv.operation_id is not null then raise exception 'attendance_missing_delegation_invalid';end if;
    if g.grant_id is not null then
      if g.actor_auth_user_id<>p_auth_user_id or p_command is not null and g.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if g.command_fingerprint is distinct from public.faolla_attendance_missing_delegation_hash_v1(site,'owner',g.command) then raise exception 'attendance_missing_delegation_invalid';end if;
      receipt:=jsonb_build_object('operationId',g.grant_id,'action','grant','grantId',g.grant_id,'revision',1,'recordedAt',to_char(g.recorded_at at time zone 'UTC',fmt),'commandFingerprint',g.command_fingerprint);
    elsif rv.operation_id is not null then
      if rv.actor_auth_user_id<>p_auth_user_id or p_command is not null and rv.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      if rv.command_fingerprint is distinct from public.faolla_attendance_missing_delegation_hash_v1(site,'owner',rv.command) then raise exception 'attendance_missing_delegation_invalid';end if;
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
      select * into loc from public.merchant_attendance_locations x where x.merchant_id=site and x.id=(p_command->>'locationId')::uuid for share;
      if w.id is null or not w.active or w.employee_id is distinct from te.id or te.id is null or te.status<>'active' or te.auth_user_id is distinct from (p_command->>'employeeAuthUserId')::uuid
        or de.id is null or de.status<>'active' or de.auth_user_id is distinct from (p_command->>'delegateAuthUserId')::uuid
        or dr.id is null or dr.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) is distinct from true
        or not(dr.permissions @> array['enterprise.view','attendance.self.view','attendance.missing.review']::text[])
        or loc.id is null or not loc.active or de.id=te.id or de.auth_user_id=te.auth_user_id then raise exception 'attendance_access_denied';end if;
      stamp:=clock_timestamp();
      insert into public.merchant_attendance_missing_delegations(merchant_id,grant_id,delegate_employee_id,delegate_auth_user_id,delegate_name,
        worker_id,employee_id,employee_auth_user_id,worker_name,worker_no,location_id,location_name,time_zone,valid_from,valid_until,actor_auth_user_id,reason,command,command_fingerprint,recorded_at)
      values(site,op,de.id,de.auth_user_id,de.display_name,w.id,te.id,te.auth_user_id,w.display_name,w.worker_no,loc.id,loc.name,loc.time_zone,
        (p_command->>'validFrom')::timestamptz,(p_command->>'validUntil')::timestamptz,p_auth_user_id,p_command->>'reason',p_command,
        public.faolla_attendance_missing_delegation_hash_v1(site,'owner',p_command),stamp) returning * into g;
      receipt:=jsonb_build_object('operationId',op,'action','grant','grantId',op,'revision',1,'recordedAt',to_char(stamp at time zone 'UTC',fmt),'commandFingerprint',g.command_fingerprint);
    else
      select * into g from public.merchant_attendance_missing_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
      if g.grant_id is null then raise exception 'attendance_missing_delegation_not_found';end if;
      perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.id=g.worker_id for update;
      if exists(select 1 from public.merchant_attendance_missing_delegation_revocations x where x.merchant_id=site and x.grant_id=g.grant_id) then raise exception 'attendance_version_conflict';end if;
      stamp:=clock_timestamp();
      insert into public.merchant_attendance_missing_delegation_revocations(merchant_id,operation_id,grant_id,actor_auth_user_id,reason,command,command_fingerprint,recorded_at)
        values(site,op,g.grant_id,p_auth_user_id,p_command->>'reason',p_command,public.faolla_attendance_missing_delegation_hash_v1(site,'owner',p_command),stamp) returning * into rv;
      receipt:=jsonb_build_object('operationId',op,'action','revoke','grantId',g.grant_id,'revision',2,'recordedAt',to_char(stamp at time zone 'UTC',fmt),'commandFingerprint',rv.command_fingerprint);
    end if;
  elsif p_command is null and mode_name='detail' then
    select * into g from public.merchant_attendance_missing_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
    if g.grant_id is null then raise exception 'attendance_missing_delegation_not_found';end if;
    detail:=public.faolla_attendance_missing_delegation_grant_v1(g,can_write and public.faolla_attendance_missing_delegation_usable_v1(g,clock_timestamp()));
  elsif p_command is null and mode_name='list' then
    for g in select x.* from public.merchant_attendance_missing_delegations x where x.merchant_id=site and (after_id is null or x.grant_id>after_id) order by x.grant_id limit 26 loop
      seen:=seen+1;exit when seen=26;
      items:=items||jsonb_build_array(public.faolla_attendance_missing_delegation_grant_v1(g,can_write and public.faolla_attendance_missing_delegation_usable_v1(g,clock_timestamp())));next_id:=g.grant_id;
    end loop;
  elsif p_command is null and mode_name='catalog' then
    for candidate in
      select c.* from (
        select x.id,x.display_name name,x.id employee_id,x.auth_user_id member_auth,null::text worker_no,null::text zone
          from public.merchant_enterprise_employees x join public.merchant_enterprise_roles r on r.merchant_id=x.merchant_id and r.id=x.role_id
          where kind='delegates' and x.merchant_id=site and x.status='active' and x.auth_user_id is not null and r.status='active'
            and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) and r.permissions @> array['enterprise.view','attendance.self.view','attendance.missing.review']::text[]
            and (after_id is null or x.id>after_id)
        union all
        select x.id,x.display_name,e.id,e.auth_user_id,x.worker_no,null::text from public.merchant_attendance_workers x
          join public.merchant_enterprise_employees e on e.merchant_id=x.merchant_id and e.id=x.employee_id
          where kind='workers' and x.merchant_id=site and x.active and e.status='active' and e.auth_user_id is not null and (after_id is null or x.id>after_id)
        union all
        select x.id,x.name,null::uuid,null::uuid,null::text,x.time_zone from public.merchant_attendance_locations x
          where kind='locations' and x.merchant_id=site and x.active and (after_id is null or x.id>after_id)
      ) c order by c.id limit 26 loop
      seen:=seen+1;exit when seen=26;
      catalog_items:=catalog_items||jsonb_build_array(jsonb_build_object('id',candidate.id,'name',candidate.name,'employeeId',candidate.employee_id,
        'employeeAuthUserId',candidate.member_auth,'workerNo',candidate.worker_no,'timeZone',candidate.zone));next_id:=candidate.id;
    end loop;
  end if;
  result:=jsonb_build_object('protocol','missing-delegations-v1','siteId',site,'actorId',p_auth_user_id,'mode',mode_name,'timeZone',s.time_zone,'canWrite',can_write,
    'items',items,'catalogItems',catalog_items,'nextId',case when seen=26 then next_id else null end,'detail',detail,'receipt',receipt,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_missing_delegation_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;

create or replace function public.faolla_attendance_delegated_missing_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;k text;target_grant_id uuid;target_request_id uuid;op uuid;cursor_at timestamptz;cursor_id uuid;after_id uuid;stamp timestamptz;
  s public.merchant_attendance_settings%rowtype;de public.merchant_enterprise_employees%rowtype;te public.merchant_enterprise_employees%rowtype;
  dr public.merchant_enterprise_roles%rowtype;w public.merchant_attendance_workers%rowtype;loc public.merchant_attendance_locations%rowtype;
  g public.merchant_attendance_missing_delegations%rowtype;authority public.merchant_attendance_missing_delegation_decisions%rowtype;
  req public.merchant_attendance_missing_requests%rowtype;entry public.merchant_attendance_missing_entries%rowtype;
  grants_json jsonb:='[]';items jsonb:='[]';detail jsonb;receipt jsonb;review jsonb;decision jsonb;result jsonb;next_cursor jsonb;next_id uuid;
  seen integer:=0;can_write boolean:=false;sealed boolean;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
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
    if public.faolla_attendance_missing_delegation_command_v1(p_command,'delegate') is distinct from true
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
    select * into authority from public.merchant_attendance_missing_delegation_decisions x where x.merchant_id=site and x.operation_id=op;
    select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.auth_user_id=p_auth_user_id for share;
    if de.id is null or authority.operation_id is not null and (authority.delegate_auth_user_id<>p_auth_user_id or authority.delegate_employee_id<>de.id) then raise exception 'attendance_access_denied';end if;
    if authority.operation_id is not null then receipt:=public.faolla_attendance_missing_delegation_receipt_v1(authority);end if;
  else
    if not p_allow_write then raise exception 'attendance_missing_delegation_disabled';end if;
    --Identify without taking an employee lock before the selected worker.
    select * into de from public.merchant_enterprise_employees x where x.merchant_id=site and x.auth_user_id=p_auth_user_id;
    if de.id is null then raise exception 'attendance_access_denied';end if;
    if target_grant_id is not null then
      select * into g from public.merchant_attendance_missing_delegations x where x.merchant_id=site and x.grant_id=target_grant_id;
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
    select * into dr from public.merchant_enterprise_roles x where x.merchant_id=site and x.id=de.role_id for share;
    if de.id is null or de.auth_user_id is distinct from p_auth_user_id or de.status<>'active' or dr.id is null or dr.status<>'active'
      or public.faolla_valid_merchant_enterprise_permissions_v1(dr.permissions) is distinct from true
      or not(dr.permissions @> array['enterprise.view','attendance.self.view','attendance.missing.review']::text[]) then raise exception 'attendance_access_denied';end if;
    stamp:=clock_timestamp();can_write:=p_allow_write and s.enabled;
    if g.grant_id is not null and public.faolla_attendance_missing_delegation_usable_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;
    if mode_name='grants' then
      for g in select x.* from public.merchant_attendance_missing_delegations x where can_write and x.merchant_id=site and x.delegate_employee_id=de.id and x.delegate_auth_user_id=p_auth_user_id
        and (after_id is null or x.grant_id>after_id) and public.faolla_attendance_missing_delegation_usable_v1(x,stamp)
        order by x.grant_id limit 26 loop
        seen:=seen+1;exit when seen=26;
        grants_json:=grants_json||jsonb_build_array(public.faolla_attendance_missing_delegation_grant_v1(g,can_write));next_id:=g.grant_id;
      end loop;
    elsif mode_name='list' then
      --Filter the exact saved identity AND location before the 25+1 budget.
      for req in select x.* from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.worker_id=g.worker_id
        and x.employee_id=g.employee_id and x.actor_auth_user_id=g.employee_auth_user_id and x.location_id=g.location_id
        and not exists(select 1 from public.merchant_attendance_missing_entries t where t.merchant_id=x.merchant_id and t.request_id=x.request_id and t.revision=2)
        and (cursor_at is null or (x.submitted_at,x.request_id)<(cursor_at,cursor_id)) order by x.submitted_at desc,x.request_id desc limit 26 loop
        seen:=seen+1;exit when seen=26;
        items:=items||jsonb_build_array(public.faolla_attendance_missing_delegation_item_v1(req));next_cursor:=jsonb_build_object('at',to_char(req.submitted_at at time zone 'UTC',fmt),'id',req.request_id);
      end loop;
    else
      select * into req from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=target_request_id;
      if req.request_id is null or (req.worker_id,req.employee_id,req.actor_auth_user_id,req.location_id) is distinct from (g.worker_id,g.employee_id,g.employee_auth_user_id,g.location_id)
        or req.actor_auth_user_id=p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null then
        if not can_write then raise exception 'attendance_platform_paused';end if;
        select * into authority from public.merchant_attendance_missing_delegation_decisions x where x.merchant_id=site and x.operation_id=op;
        if authority.operation_id is not null then
          if authority.delegate_employee_id<>de.id or authority.delegate_auth_user_id<>p_auth_user_id or authority.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
          receipt:=public.faolla_attendance_missing_delegation_receipt_v1(authority);
        elsif exists(select 1 from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.operation_id=op) then
          --A legacy owner/self operation is never adopted or backfilled.
          raise exception 'attendance_operation_conflict';
        end if;
      end if;
      if receipt is null then
        review:=public.faolla_attendance_missing_review_v1(req,p_auth_user_id,true);
        if review->>'status' is distinct from 'submitted' then raise exception 'attendance_missing_closed';end if;
        select exists(select 1 from public.merchant_attendance_period_closures c where c.merchant_id=site and c.worker_id=req.worker_id and c.sealed
          and (c.start_at<req.end_at and c.end_at>req.start_at or exists(select 1 from public.merchant_attendance_missing_requests p
            where p.merchant_id=site and p.request_id=req.supersedes_request_id and c.start_at<p.end_at and c.end_at>p.start_at))) into sealed;
        if p_command is not null then
          stamp:=clock_timestamp();
          --Clock/expiry checked again AFTER all locks and the source review.
          if public.faolla_attendance_missing_delegation_usable_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;
          if req.supersedes_request_id is not null and stamp<req.submitted_at then raise exception 'attendance_missing_basis_changed';end if;
          if decision->>'evidenceToken' is distinct from review->>'evidenceToken' then raise exception 'attendance_missing_basis_changed';end if;
          if decision->>'action'='approve' and review->'canApprove' is distinct from 'true'::jsonb
            or decision->>'action'='reject' and review->'canReject' is distinct from 'true'::jsonb then raise exception 'attendance_missing_conflict';end if;
          --The original150 INSERT guard checks both proposal and revision base
          --sealed spans. Approval and authority are mandatory, one transaction.
          insert into public.merchant_attendance_missing_entries(merchant_id,operation_id,request_id,revision,action,actor_auth_user_id,command,recorded_at)
            values(site,op,req.request_id,2,decision->>'action',p_auth_user_id,decision,stamp) returning * into entry;
          insert into public.merchant_attendance_missing_delegation_decisions(merchant_id,operation_id,request_id,grant_id,delegate_employee_id,delegate_auth_user_id,delegate_name,
            worker_id,employee_id,employee_auth_user_id,location_id,action,command,command_fingerprint,recorded_at)
          values(site,op,req.request_id,g.grant_id,de.id,p_auth_user_id,de.display_name,req.worker_id,req.employee_id,req.actor_auth_user_id,req.location_id,
            entry.action,p_command,public.faolla_attendance_missing_delegation_hash_v1(site,'delegate',p_command),stamp) returning * into authority;
          receipt:=public.faolla_attendance_missing_delegation_receipt_v1(authority);
        else
          --Expose neither issues nor lineage; all failures are a generic flag.
          if sealed then review:=review||jsonb_build_object('issues',(review->'issues')||jsonb_build_array('basis_unavailable'),'canApprove',false);end if;
          review:=review||jsonb_build_object('canApprove',can_write and (review->>'canApprove')::boolean,'canReject',can_write and (review->>'canReject')::boolean);
          detail:=public.faolla_attendance_missing_delegation_item_v1(req,review);
        end if;
      end if;
    end if;
  end if;
  result:=jsonb_build_object('protocol','delegated-missing-v1','siteId',site,'actorId',p_auth_user_id,'employeeId',de.id,'mode',mode_name,'canWrite',can_write,
    'grants',grants_json,'items',items,'nextCursor',case when mode_name='list' and seen=26 then next_cursor else null end,
    'nextId',case when mode_name='grants' and seen=26 then next_id else null end,'detail',detail,'receipt',receipt,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_missing_delegation_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_missing_delegation_command_v1(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegation_hash_v1(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegation_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegation_grant_v1(public.merchant_attendance_missing_delegations,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegation_receipt_v1(public.merchant_attendance_missing_delegation_decisions) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegation_item_v1(public.merchant_attendance_missing_requests,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegations_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_missing_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_missing_delegations_v1(jsonb,uuid,jsonb,boolean) to service_role;
grant execute on function public.faolla_attendance_delegated_missing_v1(jsonb,uuid,jsonb,boolean) to service_role;

do $missing_delegation_postconditions$
declare n text;t regclass;p regprocedure;role_name text;idx oid;keys text[]:=array['merchant_id','delegate_employee_id','delegate_auth_user_id','grant_id'];
begin
  foreach n in array array['merchant_attendance_missing_delegations','merchant_attendance_missing_delegation_revocations','merchant_attendance_missing_delegation_decisions'] loop
    t:=to_regclass('public.'||n);
    if not(select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
      or not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='missing_delegation_immutable' and not g.tgisinternal and g.tgtype=27 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
      or not exists(select 1 from pg_trigger g where g.tgrelid=t and g.tgname='missing_delegation_no_truncate' and not g.tgisinternal and g.tgtype=34 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure) then raise exception 'merchant_attendance_missing_delegation_storage_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(role_name,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(role_name,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_missing_delegation_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_trigger g where g.tgrelid='public.merchant_attendance_missing_delegation_decisions'::regclass and g.tgname='missing_delegation_decision_guard' and not g.tgisinternal
    and g.tgtype=7 and g.tgenabled='O' and g.tgnargs=0 and g.tgqual is null and g.tgfoid='public.faolla_attendance_missing_delegation_guard_v1()'::regprocedure) then raise exception 'merchant_attendance_missing_delegation_storage_postcondition_failed';end if;
  idx:=to_regclass('public.attendance_missing_delegation_delegate_idx');
  if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where c.oid=idx and c.relkind='i' and am.amname='btree' and i.indrelid='public.merchant_attendance_missing_delegations'::regclass
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null and i.indnatts=4 and i.indnkeyatts=4
      and not exists(select 1 from generate_subscripts(keys,1) z where (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1]) is distinct from keys[z]
        or i.indoption[z-1]<>0 or i.indcollation[z-1] is distinct from (select attcollation from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[z-1])
        or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
          where o.oid=i.indclass[z-1] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_missing_delegation_index_conflict';end if;
  foreach n in array array['public.faolla_attendance_missing_delegation_command_v1(jsonb,text)','public.faolla_attendance_missing_delegation_hash_v1(text,text,jsonb)',
    'public.faolla_attendance_missing_delegation_guard_v1()','public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz)',
    'public.faolla_attendance_missing_delegation_grant_v1(public.merchant_attendance_missing_delegations,boolean)',
    'public.faolla_attendance_missing_delegation_receipt_v1(public.merchant_attendance_missing_delegation_decisions)',
    'public.faolla_attendance_missing_delegation_item_v1(public.merchant_attendance_missing_requests,jsonb)'] loop
    p:=to_regprocedure(n);
    if p is null or not exists(select 1 from pg_proc where oid=p and not prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'merchant_attendance_missing_delegation_acl_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,p,'EXECUTE') then raise exception 'merchant_attendance_missing_delegation_acl_postcondition_failed';end if;
    end loop;
  end loop;
  foreach n in array array['public.faolla_attendance_missing_delegations_v1(jsonb,uuid,jsonb,boolean)','public.faolla_attendance_delegated_missing_v1(jsonb,uuid,jsonb,boolean)'] loop
    p:=to_regprocedure(n);
    if p is null or not exists(select 1 from pg_proc where oid=p and prosecdef and proconfig=array['search_path=pg_catalog'])
      or not has_function_privilege('service_role',p,'EXECUTE') or has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') then raise exception 'merchant_attendance_missing_delegation_acl_postcondition_failed';end if;
  end loop;
end;
$missing_delegation_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610060160,'merchant_attendance_missing_delegation') on conflict(version) do nothing;
commit;
