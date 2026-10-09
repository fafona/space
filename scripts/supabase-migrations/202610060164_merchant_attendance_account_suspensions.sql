--193 local opt-in membership suspension, not employment termination.
--No old event/application/archive rewrite, no automatic clock_out or grants.
--One short transaction; only new tables/indexes. No runtime enable/backfill.
begin;
set local lock_timeout='3s';
do $account_suspension_prerequisites$
declare d record;n text;installed boolean;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_account_suspensions_prerequisite_required';end if;
  for d in select * from (values
    (202608020019::bigint,'merchant_enterprise_audit'),(202609290064::bigint,'merchant_attendance_owner_configuration'),
    (202610010106::bigint,'merchant_attendance_pin_credentials'),(202610060160::bigint,'merchant_attendance_missing_delegation'),
    (202610060162::bigint,'merchant_attendance_application_delegation')) v(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations x where x.version=d.version and x.name=d.name) then raise exception 'merchant_attendance_account_suspensions_prerequisite_required';end if;
  end loop;
  if exists(select 1 from public.faolla_schema_migrations where version=202610060164 and name<>'merchant_attendance_account_suspensions') then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610060164 and name='merchant_attendance_account_suspensions') into installed;
  foreach n in array array['merchant_attendance_account_suspensions','merchant_attendance_account_epochs',
    'merchant_attendance_account_status_operations','merchant_attendance_account_restores','merchant_attendance_delegation_epochs'] loop
    if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
  end loop;
  foreach n in array array['public.faolla_update_merchant_enterprise_employee_v1(jsonb)',
    'public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz)',
    'public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz)',
    'public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])','public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)',
    'public.faolla_attendance_events_append_only_v1()'] loop
    if to_regprocedure(n) is null then raise exception 'merchant_attendance_account_suspensions_prerequisite_required';end if;
  end loop;
  foreach n in array array['faolla_update_merchant_enterprise_employee_v1_pre_suspend_164',
    'faolla_attendance_missing_delegation_usable_pre164','faolla_attendance_application_delegation_usable_pre164',
    'faolla_attendance_account_suspensions_v1','faolla_attendance_account_hash_v1','faolla_attendance_account_capture_v1',
    'faolla_attendance_account_item_v1','faolla_attendance_account_detail_v1','faolla_attendance_account_status_receipt_v1',
    'faolla_attendance_account_restore_receipt_v1','faolla_attendance_account_grant_epoch_v1',
    'faolla_attendance_account_grant_current_v1','faolla_attendance_account_activation_guard_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchants'::regclass) and proname=n) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
  end loop;
end;
$account_suspension_prerequisites$;

--Copy exact legacy bodies, rather than renaming their original OIDs: existing
--callers keep referring to the same newly guarded public/private entry points.
create or replace function public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.faolla_set_merchant_enterprise_audit_context_v1(p_input, 'employee.update', 'input');
  return public.faolla_update_merchant_enterprise_employee_v1_preaudit_019(p_input);
end;
$$;
create or replace function public.faolla_attendance_missing_delegation_usable_pre164(p public.merchant_attendance_missing_delegations,p_at timestamptz)
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
create or replace function public.faolla_attendance_application_delegation_usable_pre164(p public.merchant_attendance_application_delegations,p_at timestamptz)
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

create table if not exists public.merchant_attendance_account_suspensions(
  merchant_id text not null references public.merchant_attendance_settings(merchant_id),suspension_id uuid not null,
  employee_id uuid not null,employee_auth_user_id uuid,employee_name text not null,generation bigint not null check(generation between 1 and 9007199254740990),
  worker_id uuid,worker_name text,was_active boolean,worker_version bigint,employee_version bigint not null,
  original_event_id uuid references public.merchant_attendance_events(id),original_sequence bigint,original_action text,original_actor_employee_id uuid,
  actor_auth_user_id uuid not null,actor_employee_id uuid,pin_revision_before integer,pin_revision_after integer,
  pin_invalidated boolean not null,delegations_invalidated boolean not null check(delegations_invalidated),recorded_at timestamptz not null,
  primary key(merchant_id,suspension_id),unique(merchant_id,employee_id,generation),unique(merchant_id,suspension_id,employee_id,generation),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,actor_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,original_actor_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(employee_version between 1 and 9007199254740991 and isfinite(recorded_at)),
  check((worker_id is null and worker_name is null and was_active is null and worker_version is null and original_event_id is null)
    or (worker_id is not null and worker_name is not null and was_active is not null and worker_version between 1 and 9007199254740991)),
  check((original_event_id is null and original_sequence is null and original_action is null and original_actor_employee_id is null)
    or (original_event_id is not null and original_sequence between 1 and 9007199254740991 and original_action in('clock_in','break_start','break_end','clock_out'))),
  check((not pin_invalidated and pin_revision_before is null and pin_revision_after is null)
    or (pin_invalidated and worker_id is not null and pin_revision_before>0 and pin_revision_after=pin_revision_before+1)),
  check(char_length(employee_name) between 1 and 120 and (worker_name is null or char_length(worker_name) between 1 and 120))
);
create table if not exists public.merchant_attendance_account_epochs(
  merchant_id text not null,employee_id uuid not null,generation bigint not null check(generation between 1 and 9007199254740990),
  suspension_id uuid not null,paused boolean not null,updated_at timestamptz not null check(isfinite(updated_at)),
  primary key(merchant_id,employee_id),
  foreign key(merchant_id,suspension_id,employee_id,generation) references public.merchant_attendance_account_suspensions(merchant_id,suspension_id,employee_id,generation)
);
create index if not exists attendance_account_paused_idx on public.merchant_attendance_account_epochs(merchant_id,suspension_id) where paused;
create table if not exists public.merchant_attendance_account_status_operations(
  merchant_id text not null references public.merchants(id),operation_id uuid not null,actor_auth_user_id uuid not null,actor_employee_id uuid,
  employee_id uuid not null,expected_version bigint not null,version bigint not null,status text not null,
  suspension_id uuid,input jsonb not null,result jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,actor_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,suspension_id) references public.merchant_attendance_account_suspensions(merchant_id,suspension_id),
  check(expected_version between 1 and 9007199254740990 and version=expected_version+1 and status in('active','disabled')),
  check(jsonb_typeof(input)='object' and octet_length(input::text)<=8192 and jsonb_typeof(result)='object' and octet_length(result::text)<=65536),
  check(command_fingerprint~'^[0-9a-f]{64}$' and isfinite(recorded_at))
);
create table if not exists public.merchant_attendance_account_restores(
  merchant_id text not null,operation_id uuid not null,actor_auth_user_id uuid not null,suspension_id uuid not null,
  generation bigint not null,employee_id uuid not null,worker_id uuid,worker_active boolean,command jsonb not null,
  command_fingerprint text not null,recorded_at timestamptz not null,
  primary key(merchant_id,operation_id),unique(merchant_id,suspension_id),
  foreign key(merchant_id,suspension_id) references public.merchant_attendance_account_suspensions(merchant_id,suspension_id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  check(generation between 1 and 9007199254740990 and (worker_id is null)=(worker_active is null)),
  check(jsonb_typeof(command)='object' and octet_length(command::text)<=8192 and command_fingerprint~'^[0-9a-f]{64}$' and isfinite(recorded_at))
);
create table if not exists public.merchant_attendance_delegation_epochs(
  merchant_id text not null,channel text not null,grant_id uuid not null,
  delegate_employee_id uuid not null,delegate_auth_user_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
  delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
  employee_generation bigint not null check(employee_generation between 0 and 9007199254740990),
  missing_grant_id uuid generated always as(case when channel='missing' then grant_id else null end) stored,
  application_grant_id uuid generated always as(case when channel='application' then grant_id else null end) stored,
  primary key(merchant_id,channel,grant_id),check(channel in('missing','application')),
  foreign key(merchant_id,missing_grant_id) references public.merchant_attendance_missing_delegations(merchant_id,grant_id),
  foreign key(merchant_id,application_grant_id) references public.merchant_attendance_application_delegations(merchant_id,grant_id),
  foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id)
);

--All hash inputs are scalar JSON array elements. Join serialized elements rather
--than stripping spaces from JSON strings (which would corrupt a human reason).
create or replace function public.faolla_attendance_account_hash_v1(p_values jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
  select encode(sha256(convert_to('['||coalesce(string_agg(value::text,',' order by ord),'')||']','UTF8')),'hex')
  from jsonb_array_elements(p_values) with ordinality x(value,ord);
$$;

--Caller holds settings UPDATE, which serializes both old grant writers and
--membership suspension. No later employee -> settings lock acquisition here.
create or replace function public.faolla_attendance_account_grant_epoch_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare de public.merchant_attendance_account_epochs%rowtype;te public.merchant_attendance_account_epochs%rowtype;channel_name text;
begin
  if tg_op<>'INSERT' or tg_when not in('BEFORE','AFTER') or tg_level<>'ROW' then raise exception 'attendance_account_suspension_invalid';end if;
  channel_name:=case tg_table_name when 'merchant_attendance_missing_delegations' then 'missing' when 'merchant_attendance_application_delegations' then 'application' else null end;
  if channel_name is null then raise exception 'attendance_account_suspension_invalid';end if;
  perform 1 from public.merchant_attendance_settings x where x.merchant_id=new.merchant_id for share;
  if not found then raise exception 'attendance_account_suspension_invalid';end if;
  --BEFORE also protects direct privileged fixture inserts before their FK locks.
  if tg_when='BEFORE' then return new;end if;
  select * into de from public.merchant_attendance_account_epochs x where x.merchant_id=new.merchant_id and x.employee_id=new.delegate_employee_id;
  select * into te from public.merchant_attendance_account_epochs x where x.merchant_id=new.merchant_id and x.employee_id=new.employee_id;
  if coalesce(de.paused,false) or coalesce(te.paused,false) then raise exception 'attendance_account_suspended';end if;
  insert into public.merchant_attendance_delegation_epochs(merchant_id,channel,grant_id,delegate_employee_id,delegate_auth_user_id,employee_id,employee_auth_user_id,delegate_generation,employee_generation)
  values(new.merchant_id,channel_name,new.grant_id,new.delegate_employee_id,new.delegate_auth_user_id,new.employee_id,new.employee_auth_user_id,coalesce(de.generation,0),coalesce(te.generation,0));
  return new;
end;
$$;
create or replace function public.faolla_attendance_account_grant_current_v1(p_site text,p_channel text,p_grant uuid,p_delegate uuid,p_delegate_auth uuid,p_employee uuid,p_auth uuid)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare de public.merchant_attendance_account_epochs%rowtype;te public.merchant_attendance_account_epochs%rowtype;b public.merchant_attendance_delegation_epochs%rowtype;
begin
  select * into de from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=p_delegate;
  select * into te from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=p_employee;
  if coalesce(de.paused,false) or coalesce(te.paused,false) then return false;end if;
  select * into b from public.merchant_attendance_delegation_epochs x where x.merchant_id=p_site and x.channel=p_channel and x.grant_id=p_grant;
  --No historical backfill: an old grant is usable only before either first epoch.
  if b.grant_id is null then return coalesce(de.generation,0)=0 and coalesce(te.generation,0)=0;end if;
  return (b.delegate_employee_id,b.delegate_auth_user_id,b.employee_id,b.employee_auth_user_id,b.delegate_generation,b.employee_generation)
    is not distinct from (p_delegate,p_delegate_auth,p_employee,p_auth,coalesce(de.generation,0),coalesce(te.generation,0));
end;
$$;
create or replace function public.faolla_attendance_missing_delegation_usable_v1(p public.merchant_attendance_missing_delegations,p_at timestamptz)
returns boolean language sql stable set search_path=pg_catalog as $$
  select public.faolla_attendance_missing_delegation_usable_pre164(p,p_at)
    and public.faolla_attendance_account_grant_current_v1(p.merchant_id,'missing',p.grant_id,p.delegate_employee_id,p.delegate_auth_user_id,p.employee_id,p.employee_auth_user_id);
$$;
create or replace function public.faolla_attendance_application_delegation_usable_v1(p public.merchant_attendance_application_delegations,p_at timestamptz)
returns boolean language sql stable set search_path=pg_catalog as $$
  select public.faolla_attendance_application_delegation_usable_pre164(p,p_at)
    and public.faolla_attendance_account_grant_current_v1(p.merchant_id,'application',p.grant_id,p.delegate_employee_id,p.delegate_auth_user_id,p.employee_id,p.employee_auth_user_id);
$$;

--This is a rejection-only guard on successful activation/credential writes, not
--an employee trigger. It never acquires settings or changes historical receipts.
create or replace function public.faolla_attendance_account_activation_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op not in('INSERT','UPDATE') or tg_when<>'BEFORE' or tg_level<>'ROW' then raise exception 'attendance_account_suspension_invalid';end if;
  if tg_table_name='merchant_attendance_workers' then
    if new.active and exists(select 1 from public.merchant_attendance_account_epochs x where x.merchant_id=new.merchant_id and x.employee_id=new.employee_id and x.paused) then raise exception 'attendance_account_suspended';end if;
  elsif tg_table_name='merchant_attendance_pin_credentials' then
    if new.enabled and exists(select 1 from public.merchant_attendance_account_epochs x where x.merchant_id=new.merchant_id and x.employee_id=new.employee_id and x.paused) then raise exception 'attendance_account_suspended';end if;
  else raise exception 'attendance_account_suspension_invalid';end if;
  return new;
end;
$$;

--Called only AFTER the original employee update has succeeded and still holds
--its employee/task locks. settings UPDATE was obtained by the outer wrapper.
create or replace function public.faolla_attendance_account_capture_v1(p_site text,p_employee uuid,p_actor uuid,p_actor_employee uuid,p_enabled boolean)
returns uuid language plpgsql set search_path=pg_catalog as $$
declare e public.merchant_enterprise_employees%rowtype;w public.merchant_attendance_workers%rowtype;
  ep public.merchant_attendance_account_epochs%rowtype;ev public.merchant_attendance_events%rowtype;c public.merchant_attendance_pin_credentials%rowtype;
  sid uuid;gen bigint;stamp timestamptz;pin_before integer;pin_after integer;
begin
  select * into ep from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  if ep.paused then return ep.suspension_id;end if;
  if ep.employee_id is null and not coalesce(p_enabled,false) then return null;end if;
  if not exists(select 1 from public.merchant_attendance_settings x where x.merchant_id=p_site) then return null;end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee;
  if e.id is null or e.status<>'disabled' or p_actor is null then raise exception 'attendance_account_suspension_invalid';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  --No worker is manufactured for a delegate. Both legacy delegate indexes start
  --with merchant/employee; target grants already require a linked worker.
  if ep.employee_id is null and w.id is null and not exists(select 1 from public.merchant_attendance_missing_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_application_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee) then return null;end if;
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

create or replace function public.faolla_update_merchant_enterprise_employee_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare clean_input jsonb;site text;target uuid;actor_auth uuid;actor_employee uuid;op uuid;sid uuid;capture boolean:=false;
  m public.merchants%rowtype;ae public.merchant_enterprise_employees%rowtype;e public.merchant_enterprise_employees%rowtype;
  prior public.merchant_attendance_account_status_operations%rowtype;result_json jsonb;fingerprint text;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  --The old validator/error paths remain authoritative for legacy input.
  if p_input is null or jsonb_typeof(p_input)<>'object' then return public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(p_input);end if;
  if p_input ? 'attendance_suspension_enabled' then
    if jsonb_typeof(p_input->'attendance_suspension_enabled') is distinct from 'boolean' then raise exception 'invalid_employee_update';end if;
    capture:=(p_input->>'attendance_suspension_enabled')::boolean;
  end if;
  if p_input ? 'attendance_operation_id' then
    if jsonb_typeof(p_input->'attendance_operation_id') is distinct from 'string' or coalesce(p_input->>'attendance_operation_id','')!~uuid_pattern then raise exception 'invalid_employee_update';end if;
    op:=(p_input->>'attendance_operation_id')::uuid;
  end if;
  clean_input:=p_input-'attendance_operation_id'-'attendance_suspension_enabled';
  if op is not null and (not(clean_input ?& array['merchant_id','employee_id','expected_version','actor_type','actor_id','status'])
    or exists(select 1 from jsonb_object_keys(clean_input) k where k not in('merchant_id','employee_id','expected_version','actor_type','actor_id','status','offboarding_mode','replacement_employee_id'))
    or coalesce(clean_input->>'status','') not in('active','disabled') or jsonb_typeof(clean_input->'expected_version') is distinct from 'number'
    or coalesce(clean_input->>'expected_version','')!~'^[1-9][0-9]{0,15}$' or (clean_input->>'expected_version')::numeric>9007199254740990) then raise exception 'invalid_employee_update';end if;
  site:=btrim(clean_input->>'merchant_id');
  --Match011/017 normalization for legacy successful inputs; keep clean_input
  --itself untouched so a new operation still has exact original-input replay.
  if site is null or site!~'^[0-9]{8}$' or coalesce(btrim(clean_input->>'employee_id'),'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(clean_input);
  end if;
  target:=btrim(clean_input->>'employee_id')::uuid;
  select * into m from public.merchants x where x.id=site for share;
  --Must be before old task -> employee -> role locks, even when opt-in is off.
  perform 1 from public.merchant_attendance_settings x where x.merchant_id=site for update;
  if btrim(clean_input->>'actor_type')='owner' then
    perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(clean_input,null,false);
    actor_auth:=btrim(clean_input->>'actor_id')::uuid;
  elsif btrim(clean_input->>'actor_type')='employee' and coalesce(btrim(clean_input->>'actor_id'),'')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    actor_employee:=btrim(clean_input->>'actor_id')::uuid;
    --No early employee lock: the old task/employee ordering is preserved.
    select * into ae from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=actor_employee;
    actor_auth:=ae.auth_user_id;
  end if;
  if op is not null then
    if actor_auth is null then raise exception 'permission_escalation_denied';end if;
    select * into prior from public.merchant_attendance_account_status_operations x where x.merchant_id=site and x.operation_id=op;
    if prior.operation_id is not null then
      if prior.actor_auth_user_id<>actor_auth or prior.actor_employee_id is distinct from actor_employee or prior.input is distinct from clean_input then raise exception 'attendance_operation_conflict';end if;
      --POST returns the frozen full employee result, unlike minimal GET recovery.
      --Recheck current managerial authority only on replay, so fresh writes still
      --retain the original task -> employee lock ordering.
      if actor_employee is not null then perform public.faolla_authorize_merchant_enterprise_employee_actor_v1(clean_input,target,true);end if;
      return prior.result;
    end if;
  end if;
  result_json:=public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(clean_input);
  --Original authorization, task handoff and audit have now succeeded, atomically.
  if actor_employee is not null then
    select * into ae from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=actor_employee;
    actor_auth:=ae.auth_user_id;
  end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=target;
  if btrim(clean_input->>'status')='disabled' then sid:=public.faolla_attendance_account_capture_v1(site,target,actor_auth,actor_employee,capture);end if;
  if sid is null then select x.suspension_id into sid from public.merchant_attendance_account_epochs x where x.merchant_id=site and x.employee_id=target and x.paused;end if;
  if op is not null then
    fingerprint:=public.faolla_attendance_account_hash_v1(jsonb_build_array('attendance-account-status-v1',site,op::text,target::text,
      (clean_input->>'expected_version')::bigint,clean_input->>'status',clean_input->>'offboarding_mode',clean_input->>'replacement_employee_id'));
    begin
      insert into public.merchant_attendance_account_status_operations(merchant_id,operation_id,actor_auth_user_id,actor_employee_id,employee_id,expected_version,version,status,suspension_id,input,result,command_fingerprint,recorded_at)
      values(site,op,actor_auth,actor_employee,target,(clean_input->>'expected_version')::bigint,e.version,e.status,sid,clean_input,result_json,fingerprint,clock_timestamp());
    exception when unique_violation then raise exception 'attendance_operation_conflict';end;
  end if;
  return result_json;
end;
$$;

create or replace function public.faolla_attendance_account_item_v1(p public.merchant_attendance_account_suspensions)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select jsonb_build_object('suspensionId',p.suspension_id,'generation',p.generation,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,
    'employeeName',p.employee_name,'workerId',p.worker_id,'workerName',p.worker_name,'wasActive',p.was_active,'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;
create or replace function public.faolla_attendance_account_status_receipt_v1(p public.merchant_attendance_account_status_operations)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select case when p.operation_id is null then null else jsonb_build_object('operationId',p.operation_id,'actorId',p.actor_auth_user_id,'employeeId',p.employee_id,
    'expectedVersion',p.expected_version,'version',p.version,'status',p.status,'suspensionId',p.suspension_id,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',p.command_fingerprint) end;
$$;
create or replace function public.faolla_attendance_account_restore_receipt_v1(p public.merchant_attendance_account_restores)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select case when p.operation_id is null then null else jsonb_build_object('operationId',p.operation_id,'actorId',p.actor_auth_user_id,'suspensionId',p.suspension_id,'generation',p.generation,
    'employeeId',p.employee_id,'workerId',p.worker_id,'workerActive',p.worker_active,'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',p.command_fingerprint) end;
$$;

--Caller already owns settings SHARE/UPDATE. Locks current facts without scanning
--pending applications or claiming other browsers' unknown operation count is 0.
create or replace function public.faolla_attendance_account_detail_v1(p public.merchant_attendance_account_suspensions)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare ep public.merchant_attendance_account_epochs%rowtype;e public.merchant_enterprise_employees%rowtype;
  w public.merchant_attendance_workers%rowtype;r public.merchant_enterprise_roles%rowtype;l public.merchant_attendance_locations%rowtype;
  s public.merchant_attendance_settings%rowtype;ev public.merchant_attendance_events%rowtype;b jsonb:='[]';today date;
begin
  select * into s from public.merchant_attendance_settings x where x.merchant_id=p.merchant_id;
  select * into ep from public.merchant_attendance_account_epochs x where x.merchant_id=p.merchant_id and x.employee_id=p.employee_id;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p.merchant_id and x.employee_id=p.employee_id for share;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p.merchant_id and x.id=p.employee_id for share;
  select * into r from public.merchant_enterprise_roles x where x.merchant_id=p.merchant_id and x.id=e.role_id for share;
  if ep.suspension_id is distinct from p.suspension_id or ep.generation is distinct from p.generation or ep.paused is distinct from true then b:=b||'"already_restored"'::jsonb;end if;
  if e.id is null or e.auth_user_id is distinct from p.employee_auth_user_id or w.id is distinct from p.worker_id then b:=b||'"binding_changed"'::jsonb;end if;
  if e.status is distinct from 'active' then b:=b||'"employee_inactive"'::jsonb;end if;
  if r.id is null or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
    or (coalesce(p.was_active,false) and not(r.permissions @> array['attendance.self.view','attendance.self.clock']::text[])) then b:=b||'"role_invalid"'::jsonb;end if;
  if s.enabled is distinct from true then b:=b||'"settings_disabled"'::jsonb;end if;
  if p.worker_id is not null then
    if w.id is null then b:=b||'"worker_missing"'::jsonb;end if;
    select * into ev from public.merchant_attendance_events x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id order by x.sequence desc limit 1;
    --A suspended worker cannot acquire a different original tail via a supported
    --clock. Legacy/corrupt identities remain visible but never silently restored.
    if (ev.id,ev.sequence,ev.action,ev.actor_employee_id) is distinct from (p.original_event_id,p.original_sequence,p.original_action,p.original_actor_employee_id)
      or (ev.id is not null and (ev.actor_employee_id is distinct from p.employee_id or p.original_actor_employee_id is distinct from p.employee_id)) then b:=b||'"state_binding_changed"'::jsonb;end if;
    if p.was_active then
      select * into l from public.merchant_attendance_locations x where x.merchant_id=p.merchant_id and x.id=w.default_location_id for share;
      if l.id is null or not l.active or public.faolla_attendance_valid_zone_v1(l.time_zone) is distinct from true then b:=b||'"location_invalid"'::jsonb;
      end if;
      if public.faolla_attendance_valid_zone_v1(s.time_zone) is distinct from true then b:=b||'"employment_invalid"'::jsonb;
      else
        --Same current enterprise civil date used by111, not the location date.
        today:=(clock_timestamp() at time zone s.time_zone)::date;
        if (select count(*) from public.merchant_attendance_employment_periods x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id and x.starts_on<=today and (x.ends_on is null or x.ends_on>=today))<>1 then b:=b||'"employment_invalid"'::jsonb;end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('suspension',public.faolla_attendance_account_item_v1(p),'employeeStatus',e.status,'employeeVersion',e.version,
    'workerVersion',w.version,'workerActive',w.active,'originalAction',p.original_action,'currentAction',ev.action,'canRestore',jsonb_array_length(b)=0,'blockers',b,
    'pinInvalidated',p.pin_invalidated,'delegationsInvalidated',p.delegations_invalidated,
    'pendingReview',jsonb_build_object('leave','not_checked','workArrangement','not_checked','missing','not_checked','unknownOperations','not_observable'));
end;
$$;

create or replace function public.faolla_attendance_account_suspensions_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_restore boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;after_id uuid;sid uuid;op uuid;m public.merchants%rowtype;s public.merchant_attendance_account_suspensions%rowtype;
  ep public.merchant_attendance_account_epochs%rowtype;old_restore public.merchant_attendance_account_restores%rowtype;old_status public.merchant_attendance_account_status_operations%rowtype;
  items jsonb:='[]';detail jsonb:='null';receipt jsonb:='null';status_receipt jsonb:='null';result_json jsonb;next_id uuid;fingerprint text;stamp timestamptz;
begin
  if p_auth_user_id is null or p_allow_restore is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','mode','afterId','suspensionId','operationId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$'
    or coalesce(p_query->>'mode','') not in('list','detail','recover','recover-status') then raise exception 'attendance_invalid_request';end if;
  foreach site in array array['afterId','suspensionId','operationId'] loop
    if p_query->site<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->site,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  site:=p_query->>'siteId';mode_name:=p_query->>'mode';after_id:=(p_query->>'afterId')::uuid;sid:=(p_query->>'suspensionId')::uuid;op:=(p_query->>'operationId')::uuid;
  if (mode_name='list' and (sid is not null or op is not null)) or (mode_name='detail' and (sid is null or after_id is not null or op is not null))
    or (mode_name in('recover','recover-status') and (op is null or sid is not null or after_id is not null)) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if mode_name<>'detail' or public.faolla_attendance_shift_rule_binding_object_v1(p_command,array['action','operationId','suspensionId','expectedGeneration','workerId','expectedWorkerVersion','expectedEmployeeVersion','employeeId','employeeAuthUserId','reason']) is distinct from true
      or p_command->>'action' is distinct from 'restore' or p_command->>'suspensionId' is distinct from sid::text
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'operationId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'employeeId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'employeeAuthUserId','uuid') is distinct from true
      or (p_command->'workerId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'workerId','uuid') is distinct from true)
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'expectedGeneration','version') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'expectedEmployeeVersion','version') is distinct from true
      or (p_command->'expectedWorkerVersion'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_command->'expectedWorkerVersion','version') is distinct from true)
      or (p_command->'workerId'='null'::jsonb)<>(p_command->'expectedWorkerVersion'='null'::jsonb)
      or jsonb_typeof(p_command->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p_command->>'reason',1,500) is distinct from true
      or p_command->>'reason'<>btrim(p_command->>'reason') or octet_length(p_command::text)>8192 then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  select * into m from public.merchants x where x.id=site for share;
  if m.id is null then raise exception 'attendance_access_denied';end if;
  if mode_name in('recover','recover-status') then
    --Original actor only; current permissions/activity are not required. Employee
    --actors must still have their exact saved membership/Auth binding.
    if mode_name='recover' then
      select * into old_restore from public.merchant_attendance_account_restores x where x.merchant_id=site and x.operation_id=op;
      if old_restore.operation_id is not null then
        if old_restore.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
        receipt:=public.faolla_attendance_account_restore_receipt_v1(old_restore);
      end if;
    else
      select * into old_status from public.merchant_attendance_account_status_operations x where x.merchant_id=site and x.operation_id=op;
      if old_status.operation_id is not null then
        if old_status.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
        if old_status.actor_employee_id is not null then
          --Hold the exact current binding to completion; inactive/revoked role
          --does not remove this original actor's minimal historical receipt.
          perform 1 from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=old_status.actor_employee_id and x.auth_user_id=p_auth_user_id for share;
          if not found then raise exception 'attendance_access_denied';end if;
        end if;
        status_receipt:=public.faolla_attendance_account_status_receipt_v1(old_status);
      end if;
    end if;
  else
    if not coalesce(p_auth_user_id=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false) then raise exception 'attendance_access_denied';end if;
    if p_command is null then perform 1 from public.merchant_attendance_settings x where x.merchant_id=site for share;
    else perform 1 from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
    if mode_name='list' then
      for s in select p.* from public.merchant_attendance_account_epochs x join public.merchant_attendance_account_suspensions p on p.merchant_id=x.merchant_id and p.suspension_id=x.suspension_id
        where x.merchant_id=site and x.paused and (after_id is null or x.suspension_id>after_id) order by x.suspension_id limit 26 loop
        if jsonb_array_length(items)=25 then next_id:=(items->24->>'suspensionId')::uuid;exit;end if;
        items:=items||jsonb_build_array(public.faolla_attendance_account_item_v1(s));
      end loop;
    else
      select * into s from public.merchant_attendance_account_suspensions x where x.merchant_id=site and x.suspension_id=sid;
      if s.suspension_id is null then raise exception 'attendance_account_suspension_not_found';end if;
      if p_command is not null then
        select * into old_restore from public.merchant_attendance_account_restores x where x.merchant_id=site and x.operation_id=op;
        if old_restore.operation_id is not null then
          if old_restore.actor_auth_user_id<>p_auth_user_id or old_restore.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
          receipt:=public.faolla_attendance_account_restore_receipt_v1(old_restore);
        else
          if not p_allow_restore then raise exception 'attendance_platform_paused';end if;
          --Exclusive settings already excludes every clock/config writer. Take
          --worker UPDATE before employee SHARE, never upgrade settings later.
          perform 1 from public.merchant_attendance_workers x where x.merchant_id=site and x.employee_id=s.employee_id for update;
          detail:=public.faolla_attendance_account_detail_v1(s);
          if p_command->>'employeeId' is distinct from s.employee_id::text or p_command->>'employeeAuthUserId' is distinct from s.employee_auth_user_id::text
            or p_command->>'workerId' is distinct from s.worker_id::text or (p_command->>'expectedGeneration')::bigint<>s.generation
            or p_command->'expectedEmployeeVersion' is distinct from detail->'employeeVersion' or p_command->'expectedWorkerVersion' is distinct from detail->'workerVersion'
            or detail->'canRestore' is distinct from 'true'::jsonb then raise exception 'attendance_account_suspension_changed';end if;
          stamp:=clock_timestamp();
          update public.merchant_attendance_account_epochs set paused=false,updated_at=stamp where merchant_id=site and employee_id=s.employee_id and suspension_id=s.suspension_id and generation=s.generation and paused;
          if not found then raise exception 'attendance_account_suspension_changed';end if;
          if s.worker_id is not null and (detail->>'workerActive')::boolean is distinct from s.was_active then
            if (detail->>'workerVersion')::bigint>=9007199254740991 then raise exception 'attendance_account_suspension_changed';end if;
            update public.merchant_attendance_workers set active=s.was_active,version=version+1,updated_at=stamp where merchant_id=site and id=s.worker_id;
          end if;
          fingerprint:=public.faolla_attendance_account_hash_v1(jsonb_build_array('attendance-account-restore-v1',site,p_command->>'action',p_command->>'operationId',p_command->>'suspensionId',
            (p_command->>'expectedGeneration')::bigint,p_command->>'workerId',(p_command->>'expectedWorkerVersion')::bigint,(p_command->>'expectedEmployeeVersion')::bigint,p_command->>'employeeId',p_command->>'employeeAuthUserId',p_command->>'reason'));
          insert into public.merchant_attendance_account_restores(merchant_id,operation_id,actor_auth_user_id,suspension_id,generation,employee_id,worker_id,worker_active,command,command_fingerprint,recorded_at)
          values(site,op,p_auth_user_id,sid,s.generation,s.employee_id,s.worker_id,s.was_active,p_command,fingerprint,stamp) returning * into old_restore;
          receipt:=public.faolla_attendance_account_restore_receipt_v1(old_restore);
        end if;
      end if;
      detail:=public.faolla_attendance_account_detail_v1(s);
    end if;
  end if;
  result_json:=jsonb_build_object('siteId',site,'mode',mode_name,'items',items,'nextAfterId',next_id,'detail',detail,'receipt',receipt,'statusReceipt',status_receipt);
  if octet_length(result_json::text)>131072 then raise exception 'attendance_account_suspension_invalid';end if;
  return result_json;
end;
$$;

do $account_suspension_storage$
declare n text;t regclass;
begin
  foreach n in array array['merchant_attendance_account_suspensions','merchant_attendance_account_epochs','merchant_attendance_account_status_operations','merchant_attendance_account_restores','merchant_attendance_delegation_epochs'] loop
    t:=to_regclass('public.'||n);execute format('alter table %s enable row level security',t);execute format('revoke all on table %s from public,anon,authenticated,service_role',t);
    if n<>'merchant_attendance_account_epochs' then
      if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_account_immutable') then execute format('create trigger attendance_account_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
    end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_account_no_truncate') then execute format('create trigger attendance_account_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  end loop;
  foreach n in array array['merchant_attendance_missing_delegations','merchant_attendance_application_delegations'] loop
    t:=to_regclass('public.'||n);
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_account_grant_lock') then execute format('create trigger attendance_account_grant_lock before insert on %s for each row execute function public.faolla_attendance_account_grant_epoch_v1()',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_account_grant_epoch') then execute format('create trigger attendance_account_grant_epoch after insert on %s for each row execute function public.faolla_attendance_account_grant_epoch_v1()',t);end if;
  end loop;
  foreach n in array array['merchant_attendance_workers','merchant_attendance_pin_credentials'] loop
    t:=to_regclass('public.'||n);
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_account_activation_guard') then execute format('create trigger attendance_account_activation_guard before insert or update on %s for each row execute function public.faolla_attendance_account_activation_guard_v1()',t);end if;
  end loop;
end;
$account_suspension_storage$;

--The copied 019 implementation and both unchanged old usability bodies become
--private delegates. No old table ACL or historical receipt guard is replaced.
revoke all on function public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegation_usable_pre164(public.merchant_attendance_missing_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_usable_pre164(public.merchant_attendance_application_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_hash_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_grant_epoch_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_grant_current_v1(text,text,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_activation_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_item_v1(public.merchant_attendance_account_suspensions) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_detail_v1(public.merchant_attendance_account_suspensions) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_status_receipt_v1(public.merchant_attendance_account_status_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_restore_receipt_v1(public.merchant_attendance_account_restores) from public,anon,authenticated,service_role;
revoke all on function public.faolla_update_merchant_enterprise_employee_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_account_suspensions_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_update_merchant_enterprise_employee_v1(jsonb) to service_role;
grant execute on function public.faolla_attendance_account_suspensions_v1(jsonb,uuid,jsonb,boolean) to service_role;

do $account_suspension_postconditions$
declare n text;t regclass;f regprocedure;is_rpc boolean;tr record;
begin
  foreach n in array array['merchant_attendance_account_suspensions','merchant_attendance_account_epochs','merchant_attendance_account_status_operations','merchant_attendance_account_restores','merchant_attendance_delegation_epochs'] loop
    t:=to_regclass('public.'||n);
    if not exists(select 1 from pg_class where oid=t and relkind='r' and relrowsecurity) or exists(select 1 from pg_policy where polrelid=t)
      or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantee=0 or a.grantee in(select oid from pg_roles where rolname in('anon','authenticated','service_role')))) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
    if n<>'merchant_attendance_account_epochs' and not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_account_immutable' and tgenabled='O' and tgtype=27 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and tgname='attendance_account_no_truncate' and tgenabled='O' and tgtype=34 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
  end loop;
  for tr in select * from (values
    ('merchant_attendance_missing_delegations','attendance_account_grant_lock',7,'public.faolla_attendance_account_grant_epoch_v1()'),
    ('merchant_attendance_application_delegations','attendance_account_grant_lock',7,'public.faolla_attendance_account_grant_epoch_v1()'),
    ('merchant_attendance_missing_delegations','attendance_account_grant_epoch',5,'public.faolla_attendance_account_grant_epoch_v1()'),
    ('merchant_attendance_application_delegations','attendance_account_grant_epoch',5,'public.faolla_attendance_account_grant_epoch_v1()'),
    ('merchant_attendance_workers','attendance_account_activation_guard',23,'public.faolla_attendance_account_activation_guard_v1()'),
    ('merchant_attendance_pin_credentials','attendance_account_activation_guard',23,'public.faolla_attendance_account_activation_guard_v1()')) x(tbl,name,kind,func) loop
    if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||tr.tbl) and tgname=tr.name and tgenabled='O' and tgtype=tr.kind and tgfoid=to_regprocedure(tr.func)) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
  end loop;
  if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam
    where i.indexrelid=to_regclass('public.attendance_account_paused_idx') and i.indrelid='public.merchant_attendance_account_epochs'::regclass
      and a.amname='btree' and i.indisvalid and i.indisready and i.indislive and not i.indisunique and i.indnkeyatts=2 and i.indnatts=2
      and i.indexprs is null and pg_get_expr(i.indpred,i.indrelid)='paused'
      and pg_get_indexdef(i.indexrelid,1,true)='merchant_id' and pg_get_indexdef(i.indexrelid,2,true)='suspension_id') then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
  foreach n in array array[
    'public.faolla_update_merchant_enterprise_employee_v1(jsonb)','public.faolla_attendance_account_suspensions_v1(jsonb,uuid,jsonb,boolean)',
    'public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(jsonb)',
    'public.faolla_attendance_missing_delegation_usable_pre164(public.merchant_attendance_missing_delegations,timestamptz)',
    'public.faolla_attendance_application_delegation_usable_pre164(public.merchant_attendance_application_delegations,timestamptz)',
    'public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz)',
    'public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz)',
    'public.faolla_attendance_account_hash_v1(jsonb)','public.faolla_attendance_account_grant_epoch_v1()',
    'public.faolla_attendance_account_grant_current_v1(text,text,uuid,uuid,uuid,uuid,uuid)','public.faolla_attendance_account_activation_guard_v1()',
    'public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)','public.faolla_attendance_account_item_v1(public.merchant_attendance_account_suspensions)',
    'public.faolla_attendance_account_detail_v1(public.merchant_attendance_account_suspensions)',
    'public.faolla_attendance_account_status_receipt_v1(public.merchant_attendance_account_status_operations)',
    'public.faolla_attendance_account_restore_receipt_v1(public.merchant_attendance_account_restores)'] loop
    f:=to_regprocedure(n);is_rpc:=n in('public.faolla_update_merchant_enterprise_employee_v1(jsonb)','public.faolla_attendance_account_suspensions_v1(jsonb,uuid,jsonb,boolean)');
    if f is null or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=f
      and (a.grantee=0 or a.grantee in(select oid from pg_roles where rolname in('anon','authenticated')) or (not is_rpc and a.grantee=(select oid from pg_roles where rolname='service_role')))) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
    if is_rpc and (not has_function_privilege('service_role',f,'EXECUTE') or not exists(select 1 from pg_proc where oid=f and prosecdef and proconfig=array['search_path=pg_catalog'])) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
    if not is_rpc and n<>'public.faolla_update_merchant_enterprise_employee_v1_pre_suspend_164(jsonb)' and not exists(select 1 from pg_proc where oid=f and not prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'merchant_attendance_account_suspensions_installation_conflict';end if;
  end loop;
end;
$account_suspension_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610060164,'merchant_attendance_account_suspensions') on conflict(version) do nothing;
commit;
