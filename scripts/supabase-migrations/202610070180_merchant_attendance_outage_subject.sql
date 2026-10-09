--217 Read-only, known-incident declaration preparation. No incident listing,
--owner reason, other employee data, epoch creation, or existing function change.
begin;
set local lock_timeout='3s';
do $outage_subject_prerequisites$
declare installed boolean;meta record;signature text:='public.faolla_attendance_outage_subject_v1(jsonb,uuid,boolean)';r text;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610070176 and name='merchant_attendance_outage_foundation')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610070179 and name='merchant_attendance_outage_periods')
    or to_regprocedure('public.faolla_attendance_outage_interval_v1(jsonb)') is null
    or to_regprocedure('public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])') is null
    or to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null then
    raise exception 'merchant_attendance_outage_subject_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610070180 and name='merchant_attendance_outage_subject') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610070180 and name<>'merchant_attendance_outage_subject')
    or installed<>(to_regprocedure(signature) is not null)
    or not installed and exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
      and proname='faolla_attendance_outage_subject_v1') then raise exception 'merchant_attendance_outage_subject_installation_conflict';end if;
  if installed then
    select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
    if meta.oid is null or meta.prokind<>'f' or meta.lanname<>'plpgsql' or not meta.prosecdef or meta.proretset
      or meta.proargmodes is not null or meta.proparallel<>'u' or meta.pronargs<>3 or meta.pronargdefaults<>1 or meta.prorettype<>'jsonb'::regtype
      or meta.provolatile<>'v' or meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or meta.proargnames is distinct from array['p_query','p_auth_user_id','p_allow_write']::text[]
      or meta.proowner<>(select oid from pg_roles where rolname=current_user)
      or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1 then
      raise exception 'merchant_attendance_outage_subject_function_conflict';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,signature,'EXECUTE') is distinct from (r='service_role') then raise exception 'merchant_attendance_outage_subject_function_conflict';end if;
    end loop;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=meta.oid
      and a.privilege_type='EXECUTE' and a.grantee<>p.proowner and a.grantee<>(select oid from pg_roles where rolname='service_role')) then
      raise exception 'merchant_attendance_outage_subject_function_conflict';end if;
  end if;
end;
$outage_subject_prerequisites$;

create or replace function public.faolla_attendance_outage_subject_v1(p_query jsonb,p_auth_user_id uuid,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;wid uuid;iid uuid;generation_no bigint;result jsonb;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
  epoch public.merchant_attendance_account_epochs%rowtype;i public.merchant_attendance_outage_incidents%rowtype;
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','incidentId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'incidentId') is distinct from 'string'
    or p_query->>'incidentId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';iid:=(p_query->>'incidentId')::uuid;
  if access_name='owner' then
    if jsonb_typeof(p_query->'workerId') is distinct from 'string'
      or p_query->>'workerId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'attendance_invalid_request';end if;
    wid:=(p_query->>'workerId')::uuid;
  elsif p_query->'workerId' is distinct from 'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  --Same lock order as176: merchant SHARE -> settings UPDATE -> worker UPDATE
  ---> employee SHARE -> role SHARE. No writes, even when no epoch exists.
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  if access_name='self' then
    --Lookup chooses a lock target only; the locked current pair below authorizes.
    select x.id into wid from public.merchant_attendance_workers x join public.merchant_enterprise_employees y
      on y.merchant_id=x.merchant_id and y.id=x.employee_id where x.merchant_id=site and y.auth_user_id=p_auth_user_id;
  end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if e.id is null or e.auth_user_id is null or w.employee_id is distinct from e.id then raise exception 'attendance_access_denied';end if;
  if access_name='self' then
    if e.auth_user_id is distinct from p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if r.id is null or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not r.permissions @> array['enterprise.view','attendance.self.view','attendance.self.request']::text[] then raise exception 'attendance_access_denied';end if;
  end if;
  select * into epoch from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=e.id;
  generation_no:=coalesce(epoch.generation,0);
  if access_name='self' and (not w.active or coalesce(epoch.paused,false)) then raise exception 'attendance_account_suspended';end if;
  select * into i from public.merchant_attendance_outage_incidents where merchant_id=site and incident_id=iid;
  if not found then raise exception 'attendance_outage_subject_not_found';end if;
  if public.faolla_attendance_outage_interval_v1(i.declared_interval) is distinct from true then raise exception 'attendance_outage_subject_invalid';end if;
  --A known incident is enough for first self declaration. Deliberately do not
  --read declarations or expose the owner's reason, actor, or any peer counts.
  result:=jsonb_build_object('protocol','attendance-outage-subject-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,
    'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'canWrite',p_allow_write and s.enabled,
    'subject',jsonb_build_object('workerId',w.id,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,
      'workerVersion',w.version,'employeeVersion',e.version,'generation',generation_no,'displayName',w.display_name,'active',w.active,'paused',coalesce(epoch.paused,false)),
    'incident',jsonb_build_object('id',i.incident_id,'type',i.type,'channel',i.channel,'locationId',i.location_id,'interval',i.declared_interval));
  if octet_length(convert_to(result::text,'UTF8'))>16384 then raise exception 'attendance_outage_subject_invalid';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_outage_subject_v1(jsonb,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_outage_subject_v1(jsonb,uuid,boolean) to service_role;
do $outage_subject_permissions$
declare meta record;signature text:='public.faolla_attendance_outage_subject_v1(jsonb,uuid,boolean)';r text;
begin
  select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(signature);
  if meta.oid is null or meta.prokind<>'f' or meta.lanname<>'plpgsql' or not meta.prosecdef or meta.proretset
    or meta.proargmodes is not null or meta.proparallel<>'u' or meta.pronargs<>3 or meta.pronargdefaults<>1 or meta.prorettype<>'jsonb'::regtype
    or meta.provolatile<>'v' or meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or meta.proargnames is distinct from array['p_query','p_auth_user_id','p_allow_write']::text[]
    or meta.proowner<>(select oid from pg_roles where rolname=current_user)
    or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1 then
    raise exception 'merchant_attendance_outage_subject_function_conflict';end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(r,signature,'EXECUTE') is distinct from (r='service_role') then raise exception 'merchant_attendance_outage_subject_function_conflict';end if;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=meta.oid
    and a.privilege_type='EXECUTE' and a.grantee<>p.proowner and a.grantee<>(select oid from pg_roles where rolname='service_role')) then
    raise exception 'merchant_attendance_outage_subject_function_conflict';end if;
end;
$outage_subject_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610070180,'merchant_attendance_outage_subject') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
