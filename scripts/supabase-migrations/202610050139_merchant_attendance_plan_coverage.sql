-- Owner-only explicit-slot relationship collection. This is a read source,
-- not automatic allocation, complete attendance, plan-start rules or payroll.
-- Only one additive partial index and one RPC; all existing writers stay intact.
begin;
set local lock_timeout='3s';

do $plan_coverage_prerequisites$
declare installed boolean;dependency record;t text;p text;idx oid;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_plan_coverage_prerequisite_required';end if;
  for dependency in select * from (values
    (202610040135::bigint,'merchant_attendance_shift_rule_binding_reader'),
    (202610050137::bigint,'merchant_attendance_self_schedule'),
    (202610050138::bigint,'merchant_attendance_shift_check')) d(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then
      raise exception 'merchant_attendance_plan_coverage_prerequisite_required';end if;
  end loop;
  foreach t in array array['merchants','merchant_attendance_settings','merchant_attendance_workers','merchant_enterprise_employees',
    'merchant_attendance_shift_schedule_relations','merchant_attendance_schedule_slots'] loop
    if to_regclass('public.'||t) is null then raise exception 'merchant_attendance_plan_coverage_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_shift_check_v1(jsonb,uuid)',
    'public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
    'public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])',
    'public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)',
    'public.faolla_attendance_group_text_v1(text,integer,integer)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_plan_coverage_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050139 and name='merchant_attendance_plan_coverage') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050139 and name<>'merchant_attendance_plan_coverage')
    or installed<>(to_regprocedure('public.faolla_attendance_plan_coverage_v1(jsonb,uuid)') is not null) then
    raise exception 'merchant_attendance_plan_coverage_installation_conflict';end if;
  -- A valid orphan left by an interrupted concurrent build may be adopted.
  -- Wrong definitions/invalid builds fail explicitly; never repair or drop them.
  idx:=to_regclass('public.attendance_shift_schedule_slot_idx');
  if installed and idx is null then raise exception 'merchant_attendance_plan_coverage_installation_conflict';end if;
  if idx is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where i.indexrelid=idx and i.indrelid='public.merchant_attendance_shift_schedule_relations'::regclass and am.amname='btree'
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion
      and pg_get_expr(i.indpred,i.indrelid)='(slot_id IS NOT NULL)' and i.indexprs is null and i.indnatts=3 and i.indnkeyatts=3
      and pg_get_indexdef(idx,1,true)='merchant_id' and pg_get_indexdef(idx,2,true)='slot_id' and pg_get_indexdef(idx,3,true)='start_event_id'
      and not exists(select 1 from unnest(i.indoption::smallint[]) o where o<>0)
      and not exists(select 1 from unnest(i.indclass::oid[]) with ordinality k(opclass,position)
        join pg_opclass opc on opc.oid=k.opclass where opc.opcmethod<>c.relam or not opc.opcdefault
          or opc.opcintype<>(case when k.position=1 then 'text'::regtype else 'uuid'::regtype end))
      and i.indcollation[0]=(select a.attcollation from pg_attribute a where a.attrelid=i.indrelid and a.attname='merchant_id' and not a.attisdropped)
      and i.indcollation[1]=0 and i.indcollation[2]=0) then
    raise exception 'merchant_attendance_plan_coverage_index_conflict';end if;
end;
$plan_coverage_prerequisites$;
commit;

-- Deliberately outside both transactions, as in136. The established runner
-- retains its own deadlines. A failed concurrent index is not auto-deleted.
create index concurrently if not exists attendance_shift_schedule_slot_idx
  on public.merchant_attendance_shift_schedule_relations(merchant_id,slot_id,start_event_id) where slot_id is not null;

begin;
set local lock_timeout='3s';
do $plan_coverage_index_ready$
declare idx oid:=to_regclass('public.attendance_shift_schedule_slot_idx');
begin
  if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where i.indexrelid=idx and i.indrelid='public.merchant_attendance_shift_schedule_relations'::regclass and am.amname='btree'
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion
      and pg_get_expr(i.indpred,i.indrelid)='(slot_id IS NOT NULL)' and i.indexprs is null and i.indnatts=3 and i.indnkeyatts=3
      and pg_get_indexdef(idx,1,true)='merchant_id' and pg_get_indexdef(idx,2,true)='slot_id' and pg_get_indexdef(idx,3,true)='start_event_id'
      and not exists(select 1 from unnest(i.indoption::smallint[]) o where o<>0)
      and not exists(select 1 from unnest(i.indclass::oid[]) with ordinality k(opclass,position)
        join pg_opclass opc on opc.oid=k.opclass where opc.opcmethod<>c.relam or not opc.opcdefault
          or opc.opcintype<>(case when k.position=1 then 'text'::regtype else 'uuid'::regtype end))
      and i.indcollation[0]=(select a.attcollation from pg_attribute a where a.attrelid=i.indrelid and a.attname='merchant_id' and not a.attisdropped)
      and i.indcollation[1]=0 and i.indcollation[2]=0) then
    raise exception 'merchant_attendance_plan_coverage_index_conflict';end if;
end;
$plan_coverage_index_ready$;

create or replace function public.faolla_attendance_plan_coverage_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;wid uuid;sid uuid;s public.merchant_attendance_settings%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  slot public.merchant_attendance_schedule_slots%rowtype;context jsonb;slot_item jsonb;publication jsonb;worker_item jsonb;
  candidates public.merchant_attendance_shift_schedule_relations[];saved public.merchant_attendance_shift_schedule_relations%rowtype;
  sessions jsonb:='[]'::jsonb;child jsonb;child_relation jsonb;event_count integer:=0;
  read_started timestamptz;read_completed timestamptz;last_observation timestamptz;child_observation timestamptz;result jsonb;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or not public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','slotId'])
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','')!~'^\d{8}$'
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;
  -- Authorize even an EMPTY relation set. Keep135's lock order, with no upgrade.
  -- settings SHARE excludes schedule/correction writes; worker SHARE excludes
  -- fresh clocks/relations. All locks remain held through every138 child read.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
  if not public.faolla_attendance_group_text_v1(w.display_name,1,120) or not public.faolla_attendance_group_text_v1(w.worker_no,1,40)
    or w.version not between 1 and 9007199254740990 or s.version not between 1 and 9007199254740990
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(e.id),'uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(e.auth_user_id),'uuid') then raise exception 'attendance_plan_coverage_invalid';end if;
  -- Inactive matching identities and platform pause do not erase read access.
  read_started:=clock_timestamp();last_observation:=read_started;
  if not isfinite(read_started) then raise exception 'attendance_plan_coverage_invalid';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
    'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
  select * into slot from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=wid and x.id=sid;
  if slot.id is null then raise exception 'attendance_plan_coverage_not_found';end if;
  if slot.employee_id is distinct from e.id then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
  context:=public.faolla_attendance_self_schedule_slot_v1(slot);
  slot_item:=context->'slot';publication:=nullif(context->'publication','null'::jsonb);
  if publication is not null and (publication->>'employeeId' is distinct from e.id::text
    or publication->>'employeeAuthUserId' is distinct from e.auth_user_id::text) then raise exception 'attendance_shift_rule_binding_identity_changed';end if;

  -- Use the new partial index. No work-date/time intersection/current status
  -- prefilter may hide an original association or a correction moved outside.
  candidates:=array(select x from public.merchant_attendance_shift_schedule_relations x
    where x.merchant_id=site and x.slot_id=sid and x.slot_id is not null order by x.start_event_id limit 11);
  if cardinality(candidates)>10 then raise exception 'attendance_plan_coverage_too_large';end if;
  foreach saved in array candidates loop
    if saved.worker_id is distinct from wid or saved.employee_id is distinct from e.id or saved.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_shift_rule_binding_identity_changed';end if;
    if saved.slot_revision is distinct from slot.revision or saved.selection is distinct from jsonb_build_object('slotId',sid,'revision',slot.revision)
      or saved.status not in('linked','unverified') then raise exception 'attendance_plan_coverage_invalid';end if;
    child:=public.faolla_attendance_shift_check_v1(jsonb_build_object('siteId',site,'workerId',wid,'startEventId',saved.start_event_id),p_auth_user_id);
    child_relation:=child->'relation';
    if child->>'protocol' is distinct from 'shift-check-source-v1' or child->'binding'->>'siteId' is distinct from site
      or child->'binding'->>'actorId' is distinct from p_auth_user_id::text or child->'binding'->'worker' is distinct from worker_item
      or child->'binding'->'event'->>'startEventId' is distinct from saved.start_event_id::text
      or jsonb_typeof(child_relation) is distinct from 'object' or child_relation->>'startEventId' is distinct from saved.start_event_id::text
      or child_relation->'selection' is distinct from saved.selection or child_relation->>'status' is distinct from saved.status
      or child_relation->'slot' is distinct from saved.slot_snapshot
      or ((child_relation->'slot')-'cancelled') is distinct from (slot_item-'cancelled')
      or child_relation->'currentCancelled' is distinct from slot_item->'cancelled'
      or jsonb_typeof(child->'events') is distinct from 'array' then raise exception 'attendance_plan_coverage_invalid';end if;
    child_observation:=(child->>'asOf')::timestamptz;
    if child_observation is null or not isfinite(child_observation) or child_observation<read_started
      or (child->'binding'->>'readAt')::timestamptz<read_started or (child->'binding'->>'readAt')::timestamptz>child_observation then
      raise exception 'attendance_plan_coverage_invalid';end if;
    last_observation:=greatest(last_observation,child_observation);
    event_count:=event_count+jsonb_array_length(child->'events');
    if event_count>2002 then raise exception 'attendance_plan_coverage_too_large';end if;
    sessions:=sessions||jsonb_build_array(child);
    if octet_length(convert_to(sessions::text,'UTF8'))>1048576 then raise exception 'attendance_plan_coverage_too_large';end if;
  end loop;
  read_completed:=clock_timestamp();
  if not isfinite(read_completed) or read_completed<last_observation then raise exception 'attendance_plan_coverage_invalid';end if;
  -- Child asOf/readAt remain their actual timestamps, never rewritten to look
  -- simultaneous. The outer interval records this single transaction's read.
  result:=jsonb_build_object('protocol','plan-coverage-source-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'slot',slot_item,
    'readStartedAt',to_char(read_started at time zone 'UTC',stamp_format),'readCompletedAt',to_char(read_completed at time zone 'UTC',stamp_format),'sessions',sessions);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_coverage_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
  raise exception 'attendance_plan_coverage_invalid';
end;
$$;
revoke all on function public.faolla_attendance_plan_coverage_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_plan_coverage_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050139,'merchant_attendance_plan_coverage') on conflict(version) do nothing;

do $plan_coverage_postconditions$
declare r text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050139 and name='merchant_attendance_plan_coverage') then
    raise exception 'merchant_attendance_plan_coverage_registry_postcondition_failed';end if;
  if not exists(select 1 from pg_proc where oid='public.faolla_attendance_plan_coverage_v1(jsonb,uuid)'::regprocedure
    and prosecdef and provolatile='v' and proconfig=array['search_path=pg_catalog']) then raise exception 'merchant_attendance_plan_coverage_definition_postcondition_failed';end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(r,'public.faolla_attendance_plan_coverage_v1(jsonb,uuid)','EXECUTE') is distinct from (r='service_role') then
      raise exception 'merchant_attendance_plan_coverage_acl_postcondition_failed';end if;
  end loop;
  if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    where f.oid='public.faolla_attendance_plan_coverage_v1(jsonb,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'merchant_attendance_plan_coverage_acl_postcondition_failed';end if;
end;
$plan_coverage_postconditions$;
notify pgrst, 'reload schema';
commit;
