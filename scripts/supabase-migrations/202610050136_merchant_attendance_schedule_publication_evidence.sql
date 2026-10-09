-- Opt-in publication-time identity/context evidence. This is NOT a selected
-- clock/slot relationship or a freeze of rules at the future planned start.
-- 099 remains unchanged. Evidence failure rolls back the entire NEW publish.
begin;
set local lock_timeout='3s';

do $schedule_publication_prerequisites$
declare installed boolean;p text;t text;v bigint;n text;idx oid;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_schedule_publication_prerequisite_required';end if;
  for v,n in select * from (values
    (202609290064::bigint,'merchant_attendance_owner_configuration'),(202610010099::bigint,'merchant_attendance_schedule')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then
      raise exception 'merchant_attendance_schedule_publication_prerequisite_required';end if;
  end loop;
  foreach t in array array['merchants','merchant_attendance_settings','merchant_attendance_workers','merchant_attendance_locations',
    'merchant_enterprise_employees','merchant_attendance_schedule_commands','merchant_attendance_schedule_slots'] loop
    if to_regclass('public.'||t) is null then raise exception 'merchant_attendance_schedule_publication_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_schedule_v1(jsonb,uuid,jsonb,boolean)','public.faolla_attendance_events_append_only_v1()'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_schedule_publication_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050136 and name='merchant_attendance_schedule_publication_evidence') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050136 and name<>'merchant_attendance_schedule_publication_evidence') then
    raise exception 'merchant_attendance_schedule_publication_installation_conflict';end if;
  if installed<>(to_regclass('public.merchant_attendance_schedule_publication_evidence') is not null) then
    raise exception 'merchant_attendance_schedule_publication_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_schedule_publication_slots_v1(jsonb)',
    'public.faolla_attendance_schedule_publication_guard_v1()','public.faolla_attendance_schedule_evidenced_v1(jsonb,uuid,jsonb,boolean)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_schedule_publication_installation_conflict';end if;
  end loop;
  -- A valid orphan from a previously interrupted concurrent build may be
  -- adopted. Wrong/invalid objects require explicit review, never auto-drop.
  idx:=to_regclass('public.attendance_schedule_publication_idx');
  if installed and idx is null then raise exception 'merchant_attendance_schedule_publication_installation_conflict';end if;
  if idx is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where i.indexrelid=idx and i.indrelid='public.merchant_attendance_schedule_slots'::regclass and am.amname='btree'
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion
      and i.indpred is null and i.indexprs is null and i.indnatts=3 and i.indnkeyatts=3
      and pg_get_indexdef(idx,1,true)='merchant_id' and pg_get_indexdef(idx,2,true)='revision' and pg_get_indexdef(idx,3,true)='id'
      and not exists(select 1 from unnest(i.indoption::smallint[]) o where o<>0)) then
    raise exception 'merchant_attendance_schedule_publication_index_conflict';end if;
end;
$schedule_publication_prerequisites$;
commit;

-- This phase must NOT be wrapped in a transaction by the migration runner.
-- Keep its existing statement/lock deadlines. A cancelled concurrent build may
-- remain invalid; retry refuses that state instead of deleting an index.
create index concurrently if not exists attendance_schedule_publication_idx
  on public.merchant_attendance_schedule_slots(merchant_id,revision,id);

begin;
set local lock_timeout='3s';
do $schedule_publication_index_ready$
declare idx oid:=to_regclass('public.attendance_schedule_publication_idx');
begin
  if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where i.indexrelid=idx and i.indrelid='public.merchant_attendance_schedule_slots'::regclass and am.amname='btree'
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion
      and i.indpred is null and i.indexprs is null and i.indnatts=3 and i.indnkeyatts=3
      and pg_get_indexdef(idx,1,true)='merchant_id' and pg_get_indexdef(idx,2,true)='revision' and pg_get_indexdef(idx,3,true)='id'
      and not exists(select 1 from unnest(i.indoption::smallint[]) o where o<>0)) then
    raise exception 'merchant_attendance_schedule_publication_index_conflict';end if;
end;
$schedule_publication_index_ready$;

-- Validate saved UTC/civil labels only. No current timezone lookup or rules.
create or replace function public.faolla_attendance_schedule_publication_slots_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare item jsonb;previous_id uuid;slot_id uuid;a timestamptz;b timestamptz;d date;
begin
  if p is null or jsonb_typeof(p)<>'array' then return false;end if;
  if jsonb_array_length(p) not between 1 and 32 or octet_length(convert_to(p::text,'UTF8'))>16384 then return false;end if;
  for item in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(item)<>'object' then return false;end if;
    if (select count(*) from jsonb_object_keys(item))<>4 or not(item ?& array['id','workDate','startAt','endAt'])
      or jsonb_typeof(item->'id')<>'string' or coalesce(item->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'workDate')<>'string' or coalesce(item->>'workDate','') !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(item->'startAt')<>'string' or coalesce(item->>'startAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$'
      or jsonb_typeof(item->'endAt')<>'string' or coalesce(item->>'endAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$' then return false;end if;
    slot_id:=(item->>'id')::uuid;a:=(item->>'startAt')::timestamptz;b:=(item->>'endAt')::timestamptz;d:=(item->>'workDate')::date;
    if (previous_id is not null and slot_id<=previous_id) or not isfinite(a) or not isfinite(b) or b<=a or b-a>interval '24 hours'
      or d not between date '2000-01-01' and date '2100-12-31' or to_char(d,'YYYY-MM-DD')<>item->>'workDate'
      or to_char(a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>item->>'startAt'
      or to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>item->>'endAt' then return false;end if;
    previous_id:=slot_id;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return false;
end;
$$;
revoke all on function public.faolla_attendance_schedule_publication_slots_v1(jsonb) from public,anon,authenticated,service_role;

create table if not exists public.merchant_attendance_schedule_publication_evidence (
  merchant_id text not null check(merchant_id ~ '^\d{8}$'),revision bigint not null check(revision between 1 and 9007199254740990),
  operation_id uuid not null,actor_auth_user_id uuid not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid null,
  identity_status text not null check(identity_status in('bound','unbound')),
  worker_version bigint not null check(worker_version between 1 and 9007199254740991),
  location_id uuid not null,location_version bigint not null check(location_version between 1 and 9007199254740991),
  settings_version bigint not null check(settings_version between 1 and 9007199254740991),
  time_zone text not null check(char_length(time_zone) between 1 and 100 and time_zone=btrim(time_zone) and time_zone !~ '[[:cntrl:]]'),
  slots jsonb not null check(public.faolla_attendance_schedule_publication_slots_v1(slots)),
  published_at timestamptz not null check(isfinite(published_at)),recorded_at timestamptz not null check(isfinite(recorded_at)),
  capture_policy text not null check(capture_policy='publish-identity-context-v1'),
  primary key(merchant_id,revision),unique(merchant_id,operation_id),
  foreign key(merchant_id,revision) references public.merchant_attendance_schedule_commands(merchant_id,revision),
  foreign key(merchant_id,operation_id) references public.merchant_attendance_schedule_commands(merchant_id,operation_id),
  check((employee_auth_user_id is null and identity_status='unbound') or (employee_auth_user_id is not null and identity_status='bound'))
);

-- The two FKs alone cannot prove that revision and operation refer to the SAME
-- old command. This private insert guard also binds every JSON slot reference
-- to the exact immutable publication, without changing any original constraint.
create or replace function public.faolla_attendance_schedule_publication_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare original public.merchant_attendance_schedule_commands%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  expected_slots jsonb:='[]';seen_pairs jsonb:='[]';slot_count integer:=0;pair jsonb;
begin
  select * into original from public.merchant_attendance_schedule_commands c where c.merchant_id=new.merchant_id and c.revision=new.revision;
  if original.operation_id is distinct from new.operation_id or original.actor_auth_user_id is distinct from new.actor_auth_user_id
    or original.recorded_at is distinct from new.published_at or original.command->>'action' is distinct from 'publish'
    or original.command->>'operationId' is distinct from new.operation_id::text
    or original.command->'expectedRevision' is distinct from to_jsonb(new.revision-1)
    or original.query->>'workerId' is distinct from new.worker_id::text or original.query->>'siteId' is distinct from new.merchant_id
    or original.query->>'access' is distinct from 'owner' or original.query->'operationId' is distinct from 'null'::jsonb
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
revoke all on function public.faolla_attendance_schedule_publication_guard_v1() from public,anon,authenticated,service_role;
alter table public.merchant_attendance_schedule_publication_evidence enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_schedule_publication_evidence'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_schedule_publication_evidence from public,anon,authenticated,service_role;
do $schedule_publication_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_schedule_publication_evidence'::regclass and tgname='attendance_schedule_publication_insert') then
    create trigger attendance_schedule_publication_insert before insert on public.merchant_attendance_schedule_publication_evidence
      for each row execute function public.faolla_attendance_schedule_publication_guard_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_schedule_publication_evidence'::regclass and tgname='attendance_schedule_publication_immutable') then
    create trigger attendance_schedule_publication_immutable before update or delete on public.merchant_attendance_schedule_publication_evidence
      for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_schedule_publication_evidence'::regclass and tgname='attendance_schedule_publication_no_truncate') then
    create trigger attendance_schedule_publication_no_truncate before truncate on public.merchant_attendance_schedule_publication_evidence
      for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
end;
$schedule_publication_triggers$;

create or replace function public.faolla_attendance_schedule_evidenced_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;site text;op uuid;already_recorded boolean;
  settings public.merchant_attendance_settings%rowtype;worker public.merchant_attendance_workers%rowtype;
  location public.merchant_attendance_locations%rowtype;employee public.merchant_enterprise_employees%rowtype;
  publication public.merchant_attendance_schedule_commands%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  captured_slots jsonb:='[]';slot_count integer:=0;
  u constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  -- GET/cancel and malformed action/query still use the original validator.
  -- No new evidence or identity state is consulted on those paths.
  if p_command is null or jsonb_typeof(p_command) is distinct from 'object' or p_command->>'action' is distinct from 'publish' then
    return public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write);end if;
  if jsonb_typeof(p_query) is distinct from 'object' then
    return public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write);end if;
  if p_auth_user_id is null or p_allow_write is null or (select count(*) from jsonb_object_keys(p_query))<>6
    or not(p_query ?& array['siteId','access','workerId','fromDate','throughDate','operationId'])
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or p_query->>'access' is distinct from 'owner' or p_query->'operationId' is distinct from 'null'::jsonb
    or jsonb_typeof(p_query->'workerId') is distinct from 'string' or coalesce(p_query->>'workerId','') !~ u
    or jsonb_typeof(p_command->'operationId') is distinct from 'string' or coalesce(p_command->>'operationId','') !~ u then
    return public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write);end if;
  site:=p_query->>'siteId';op:=(p_command->>'operationId')::uuid;
  -- Same order as099. The settings write lock serializes both old and opt-in
  -- writers before the existence probe. Never infer freshness from no evidence.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then return public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write);end if;
  select * into settings from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then return public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write);end if;
  select exists(select 1 from public.merchant_attendance_schedule_commands c where c.merchant_id=site and c.operation_id=op) into already_recorded;
  result:=public.faolla_attendance_schedule_v1(p_query,p_auth_user_id,p_command,p_allow_write);
  if already_recorded then return result;end if;

  -- All original validations and retained worker/location/employee SHARE locks
  -- succeeded. Original099 has no replay flag and can return empty entries even
  -- after a successful publish, so read the exact new immutable revision only.
  select * into publication from public.merchant_attendance_schedule_commands c where c.merchant_id=site and c.operation_id=op;
  if publication.operation_id is null or publication.actor_auth_user_id is distinct from p_auth_user_id
    or publication.query is distinct from p_query or publication.command is distinct from p_command
    or result->'receipt' is distinct from jsonb_build_object('operationId',publication.operation_id,'revision',publication.revision,'command',publication.command) then
    raise exception 'attendance_schedule_publication_evidence_invalid';end if;
  select * into worker from public.merchant_attendance_workers w where w.merchant_id=site and w.id=(p_query->>'workerId')::uuid for share;
  select * into location from public.merchant_attendance_locations l where l.merchant_id=site and l.id=worker.default_location_id for share;
  select * into employee from public.merchant_enterprise_employees e where e.merchant_id=site and e.id=worker.employee_id for share;
  if worker.id is null or employee.id is null or location.id is null or location.id::text is distinct from p_command->>'locationId'
    or location.time_zone is distinct from p_command->>'timeZone' or to_jsonb(settings.version) is distinct from p_command->'expectedSettingsVersion' then
    raise exception 'attendance_schedule_publication_evidence_invalid';end if;
  for slot in select x.* from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.revision=publication.revision order by x.id limit 33 loop
    slot_count:=slot_count+1;
    if slot_count>32 then raise exception 'attendance_schedule_publication_evidence_invalid';end if;
    captured_slots:=captured_slots||jsonb_build_array(jsonb_build_object('id',slot.id,'workDate',to_char(slot.work_date,'YYYY-MM-DD'),
      'startAt',to_char(slot.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endAt',to_char(slot.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  end loop;
  if slot_count not between 1 and 32 or slot_count<>jsonb_array_length(p_command->'slots') then raise exception 'attendance_schedule_publication_evidence_invalid';end if;
  -- Null Auth is represented honestly, never replaced by owner/current/future
  -- Auth. Existing employee constraints and099 eligibility remain unchanged.
  insert into public.merchant_attendance_schedule_publication_evidence(merchant_id,revision,operation_id,actor_auth_user_id,worker_id,employee_id,employee_auth_user_id,
    identity_status,worker_version,location_id,location_version,settings_version,time_zone,slots,published_at,recorded_at,capture_policy)
    values(site,publication.revision,op,p_auth_user_id,worker.id,employee.id,employee.auth_user_id,
      case when employee.auth_user_id is null then 'unbound' else 'bound' end,worker.version,location.id,location.version,settings.version,location.time_zone,
      captured_slots,publication.recorded_at,clock_timestamp(),'publish-identity-context-v1');
  -- Deliberately no caught exception around099 or evidence insertion: any
  -- failure aborts BOTH writes. Do not return a partially successful receipt.
  return result;
end;
$$;
revoke all on function public.faolla_attendance_schedule_evidenced_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_schedule_evidenced_v1(jsonb,uuid,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050136,'merchant_attendance_schedule_publication_evidence') on conflict(version) do nothing;

do $schedule_publication_postconditions$
declare r text;p text;trigger_name text;trigger_function regprocedure;trigger_type smallint;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050136 and name='merchant_attendance_schedule_publication_evidence')
    or not exists(select 1 from pg_class where oid='public.merchant_attendance_schedule_publication_evidence'::regclass and relrowsecurity) then
    raise exception 'merchant_attendance_schedule_publication_registry_postcondition_failed';end if;
  -- Never silently accept a disabled or same-name miswired integrity trigger.
  -- Fail the final transaction rather than repairing/deleting an existing one.
  for trigger_name,trigger_function,trigger_type in select * from (values
    ('attendance_schedule_publication_insert','public.faolla_attendance_schedule_publication_guard_v1()'::regprocedure,7::smallint),
    ('attendance_schedule_publication_immutable','public.faolla_attendance_events_append_only_v1()'::regprocedure,27::smallint),
    ('attendance_schedule_publication_no_truncate','public.faolla_attendance_events_append_only_v1()'::regprocedure,34::smallint)
  ) wanted(name,fn,kind) loop
    if not exists(select 1 from pg_trigger t where t.tgrelid='public.merchant_attendance_schedule_publication_evidence'::regclass
      and t.tgname=trigger_name and t.tgfoid=trigger_function::oid and t.tgtype=trigger_type and t.tgenabled in('O','A')
      and not t.tgisinternal and t.tgqual is null and t.tgnargs=0) then
      raise exception 'merchant_attendance_schedule_publication_trigger_conflict';end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_class c where c.oid='public.merchant_attendance_schedule_publication_evidence'::regclass
      and (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then
      raise exception 'merchant_attendance_schedule_publication_acl_postcondition_failed';end if;
    foreach p in array array['public.faolla_attendance_schedule_publication_slots_v1(jsonb)','public.faolla_attendance_schedule_publication_guard_v1()'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_schedule_publication_acl_postcondition_failed';end if;
    end loop;
  end loop;
  if not has_function_privilege('service_role','public.faolla_attendance_schedule_evidenced_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_schedule_evidenced_v1(jsonb,uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_schedule_evidenced_v1(jsonb,uuid,jsonb,boolean)','EXECUTE') then
    raise exception 'merchant_attendance_schedule_publication_acl_postcondition_failed';end if;
  if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    where f.oid in('public.faolla_attendance_schedule_publication_slots_v1(jsonb)'::regprocedure,
      'public.faolla_attendance_schedule_publication_guard_v1()'::regprocedure,'public.faolla_attendance_schedule_evidenced_v1(jsonb,uuid,jsonb,boolean)'::regprocedure)
      and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'merchant_attendance_schedule_publication_acl_postcondition_failed';end if;
  if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid='public.merchant_attendance_schedule_publication_evidence'::regclass and a.grantee=0) then
    raise exception 'merchant_attendance_schedule_publication_acl_postcondition_failed';end if;
end;
$schedule_publication_postconditions$;
notify pgrst, 'reload schema';
commit;
