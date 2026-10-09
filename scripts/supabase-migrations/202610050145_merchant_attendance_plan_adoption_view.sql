-- Owner-only fixed adoption evidence, composed with the existing138/139 reads.
-- No old function, writer, table, index, stored reference or timestamp changes.
--135's merchant/settings/worker/employee SHARE locks remain held throughout.
begin;
set local lock_timeout='3s';

do $plan_adoption_view_prerequisites$
declare installed boolean;dependency record;signature text;relation_name text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_plan_adoption_view_prerequisite_required';end if;
  for dependency in select * from (values
    (202610050138::bigint,'merchant_attendance_shift_check'),
    (202610050139::bigint,'merchant_attendance_plan_coverage'),
    (202610050144::bigint,'merchant_attendance_self_schedule_adoption')) required(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then
      raise exception 'merchant_attendance_plan_adoption_view_prerequisite_required';end if;
  end loop;
  foreach relation_name in array array['merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions',
    'merchant_attendance_workers','merchant_enterprise_employees','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts'] loop
    if to_regclass('public.'||relation_name) is null then raise exception 'merchant_attendance_plan_adoption_view_prerequisite_required';end if;
  end loop;
  foreach signature in array array['public.faolla_attendance_shift_check_v1(jsonb,uuid)',
    'public.faolla_attendance_plan_coverage_v1(jsonb,uuid)',
    'public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])',
    'public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)',
    'public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)'] loop
    if to_regprocedure(signature) is null then raise exception 'merchant_attendance_plan_adoption_view_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050145 and name='merchant_attendance_plan_adoption_view') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050145 and name<>'merchant_attendance_plan_adoption_view') then
    raise exception 'merchant_attendance_plan_adoption_view_installation_conflict';end if;
  foreach signature in array array['public.faolla_attendance_shift_plan_adoption_read_v1(jsonb)',
    'public.faolla_attendance_shift_check_adoption_v1(jsonb,uuid)',
    'public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)'] loop
    if installed<>(to_regprocedure(signature) is not null) then raise exception 'merchant_attendance_plan_adoption_view_installation_conflict';end if;
  end loop;
end;
$plan_adoption_view_prerequisites$;

-- Private trusted composition only: p_check is the actual authorized138 result,
-- never caller-supplied evidence. The owner login is NOT the employee Auth UUID.
-- Missing sidecar means unknown historical adoption, not "not_approved".
create or replace function public.faolla_attendance_shift_plan_adoption_read_v1(p_check jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;wid uuid;eid uuid;employee uuid;member_auth uuid;
  saved public.merchant_attendance_shift_schedule_relations%rowtype;
  proof public.merchant_attendance_shift_plan_adoptions%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  original_relation jsonb;expected_relation jsonb;expected_adoption jsonb;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if not public.faolla_attendance_shift_rule_binding_object_v1(p_check,array['protocol','binding','asOf','events','effect','relation'])
    or p_check->>'protocol' is distinct from 'shift-check-source-v1'
    or p_check->'binding'->>'protocol' is distinct from 'shift-rule-binding-v1'
    or jsonb_typeof(p_check->'binding'->'siteId') is distinct from 'string'
    or coalesce(p_check->'binding'->>'siteId','')!~'^\d{8}$'
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_check->'binding'->'worker'->'workerId','uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_check->'binding'->'worker'->'employeeId','uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_check->'binding'->'worker'->'employeeAuthUserId','uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_check->'binding'->'event'->'startEventId','uuid') then
    raise exception 'attendance_plan_adoption_view_invalid';end if;
  site:=p_check->'binding'->>'siteId';wid:=(p_check->'binding'->'worker'->>'workerId')::uuid;
  eid:=(p_check->'binding'->'event'->>'startEventId')::uuid;
  employee:=(p_check->'binding'->'worker'->>'employeeId')::uuid;
  member_auth:=(p_check->'binding'->'worker'->>'employeeAuthUserId')::uuid;
  -- The enclosing read already holds these SHARE locks. Do not upgrade them,
  -- reverse the authorization lock order or deny inactive matching identities.
  select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=wid;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=employee;
  if w.id is null or e.id is null or w.employee_id is distinct from employee or e.auth_user_id is distinct from member_auth then
    raise exception 'attendance_shift_rule_binding_identity_changed';end if;
  select * into saved from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.start_event_id=eid;
  select * into proof from public.merchant_attendance_shift_plan_adoptions x where x.merchant_id=site and x.start_event_id=eid;
  original_relation:=nullif(p_check->'relation','null'::jsonb);
  if saved.start_event_id is null then
    if original_relation is not null or proof.start_event_id is not null then raise exception 'attendance_plan_adoption_view_invalid';end if;
    return null;
  end if;
  if saved.worker_id is distinct from wid or saved.employee_id is distinct from employee or saved.employee_auth_user_id is distinct from member_auth then
    raise exception 'attendance_shift_rule_binding_identity_changed';end if;
  expected_relation:=jsonb_build_object('startEventId',saved.start_event_id,'operationId',saved.operation_id,'selection',saved.selection,
    'status',saved.status,'reason',saved.reason,'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision,
    'recordedAt',to_char(saved.recorded_at at time zone 'UTC',fmt));
  if original_relation is null or (original_relation-'currentCancelled') is distinct from expected_relation
    or saved.operation_id::text is distinct from p_check->'binding'->'event'->>'operationId' then
    raise exception 'attendance_plan_adoption_view_invalid';end if;
  -- Historical137 relations without a sidecar stay null; never call the
  -- collector with a null target to invent a retrospective not_approved fact.
  if proof.start_event_id is null then return null;end if;
  if row(proof.worker_id,proof.operation_id,proof.employee_id,proof.employee_auth_user_id,proof.slot_id,proof.recorded_at)
    is distinct from row(saved.worker_id,saved.operation_id,saved.employee_id,saved.employee_auth_user_id,saved.slot_id,saved.recorded_at)
    or proof.channel not in('self','location','onsite','pin') then raise exception 'attendance_plan_adoption_view_invalid';end if;
  -- false is essential: exact immutable140 operation/artifact only, NEVER the
  -- current approval stream/head. This helper also verifies the real channel
  -- receipt (or self's explicit relation plus other-channel receipt exclusions),
  -- saved identities, original command, source hash/bytes and fixed reference.
  expected_adoption:=public.faolla_attendance_shift_plan_adoption_v1(saved,member_auth,proof.approval_operation_id,false,proof.channel);
  if proof.adoption is distinct from expected_adoption
    or proof.approval_operation_id::text is distinct from expected_adoption->'approval'->>'operationId' then
    raise exception 'attendance_plan_adoption_view_invalid';end if;
  return expected_adoption;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
  raise exception 'attendance_plan_adoption_view_invalid';
end;
$$;

create or replace function public.faolla_attendance_shift_check_adoption_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare original_check jsonb;adoption jsonb;result jsonb;event_count integer;
begin
  -- Exactly one existing authorized read; its locks persist until commit.
  original_check:=public.faolla_attendance_shift_check_v1(p_query,p_auth_user_id);
  if original_check->>'protocol' is distinct from 'shift-check-source-v1'
    or original_check->'binding'->>'siteId' is distinct from p_query->>'siteId'
    or original_check->'binding'->>'actorId' is distinct from p_auth_user_id::text
    or original_check->'binding'->'worker'->>'workerId' is distinct from p_query->>'workerId'
    or original_check->'binding'->'event'->>'startEventId' is distinct from p_query->>'startEventId'
    or jsonb_typeof(original_check->'events') is distinct from 'array' then raise exception 'attendance_plan_adoption_view_invalid';end if;
  event_count:=jsonb_array_length(original_check->'events');
  if event_count<1 then raise exception 'attendance_plan_adoption_view_invalid';end if;
  if event_count>2002 then raise exception 'attendance_plan_adoption_view_too_large';end if;
  adoption:=public.faolla_attendance_shift_plan_adoption_read_v1(original_check);
  -- asOf/readAt and the complete original check are preserved verbatim. The
  -- extension validates immutable evidence under retained locks, not new time.
  result:=jsonb_build_object('protocol','shift-check-adoption-source-v1','check',original_check,'adoption',adoption);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_adoption_view_too_large';end if;
  return result;
end;
$$;

create or replace function public.faolla_attendance_plan_coverage_adoptions_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare original_coverage jsonb;child jsonb;adoption jsonb;adoptions jsonb:='[]'::jsonb;result jsonb;
  event_count integer:=0;child_count integer;start_id uuid;previous_id uuid;
begin
  --139 retains owner/settings/worker/employee locks before even an EMPTY set.
  -- Do not repeat the whole139 read or separately query a changing relation set.
  original_coverage:=public.faolla_attendance_plan_coverage_v1(p_query,p_auth_user_id);
  if not public.faolla_attendance_shift_rule_binding_object_v1(original_coverage,
      array['protocol','siteId','actorId','worker','slot','readStartedAt','readCompletedAt','sessions'])
    or original_coverage->>'protocol' is distinct from 'plan-coverage-source-v1'
    or original_coverage->>'siteId' is distinct from p_query->>'siteId'
    or original_coverage->>'actorId' is distinct from p_auth_user_id::text
    or original_coverage->'worker'->>'workerId' is distinct from p_query->>'workerId'
    or original_coverage->'slot'->>'id' is distinct from p_query->>'slotId'
    or jsonb_typeof(original_coverage->'sessions') is distinct from 'array' then raise exception 'attendance_plan_adoption_view_invalid';end if;
  if jsonb_array_length(original_coverage->'sessions')>10 then raise exception 'attendance_plan_adoption_view_too_large';end if;
  for child in select value from jsonb_array_elements(original_coverage->'sessions') loop
    if child->'binding'->>'siteId' is distinct from original_coverage->>'siteId'
      or child->'binding'->>'actorId' is distinct from original_coverage->>'actorId'
      or child->'binding'->'worker' is distinct from original_coverage->'worker'
      or child->'relation'->'slot'->>'id' is distinct from p_query->>'slotId'
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(child->'binding'->'event'->'startEventId','uuid')
      or jsonb_typeof(child->'events') is distinct from 'array' then raise exception 'attendance_plan_adoption_view_invalid';end if;
    start_id:=(child->'binding'->'event'->>'startEventId')::uuid;
    if previous_id is not null and start_id<=previous_id then raise exception 'attendance_plan_adoption_view_invalid';end if;
    previous_id:=start_id;child_count:=jsonb_array_length(child->'events');
    if child_count<1 then raise exception 'attendance_plan_adoption_view_invalid';end if;
    event_count:=event_count+child_count;
    if event_count>2002 then raise exception 'attendance_plan_adoption_view_too_large';end if;
    adoption:=public.faolla_attendance_shift_plan_adoption_read_v1(child);
    -- Exactly one ordered item per original session, including null evidence.
    adoptions:=adoptions||jsonb_build_array(jsonb_build_object('startEventId',start_id,'adoption',adoption));
  end loop;
  result:=jsonb_build_object('protocol','plan-coverage-adoptions-source-v1','coverage',original_coverage,'adoptions',adoptions);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_plan_adoption_view_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_shift_plan_adoption_read_v1(jsonb),
  public.faolla_attendance_shift_check_adoption_v1(jsonb,uuid),public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_shift_check_adoption_v1(jsonb,uuid),
  public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610050145,'merchant_attendance_plan_adoption_view') on conflict(version) do nothing;

do $plan_adoption_view_postconditions$
declare signature text;role_name text;is_rpc boolean;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610050145 and name='merchant_attendance_plan_adoption_view') then
    raise exception 'merchant_attendance_plan_adoption_view_registry_postcondition_failed';end if;
  foreach signature in array array['public.faolla_attendance_shift_plan_adoption_read_v1(jsonb)',
    'public.faolla_attendance_shift_check_adoption_v1(jsonb,uuid)',
    'public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)'] loop
    is_rpc:=signature<>'public.faolla_attendance_shift_plan_adoption_read_v1(jsonb)';
    if not exists(select 1 from pg_proc x where x.oid=to_regprocedure(signature) and x.prosecdef=is_rpc and x.provolatile='v'
      and x.prorettype='jsonb'::regtype and x.proconfig=array['search_path=pg_catalog']) then
      raise exception 'merchant_attendance_plan_adoption_view_definition_postcondition_failed';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') is distinct from (is_rpc and role_name='service_role') then
        raise exception 'merchant_attendance_plan_adoption_view_acl_postcondition_failed';end if;
    end loop;
    if exists(select 1 from pg_proc x cross join lateral aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) acl
      where x.oid=to_regprocedure(signature) and acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception 'merchant_attendance_plan_adoption_view_acl_postcondition_failed';end if;
  end loop;
end;
$plan_adoption_view_postconditions$;
notify pgrst, 'reload schema';
commit;
