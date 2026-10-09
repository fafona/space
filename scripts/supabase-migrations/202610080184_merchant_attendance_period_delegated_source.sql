--232: private, after-authorization full-period collection for explicit delegation.
--No old routine, role, table, archive, configuration or business fact is changed.
--The 17 bounded mirrors below retain the approved calculations exactly; see the
--paired static contract for their source files and narrowly enumerated edits.
--New RPCs MUST first hold current grant/action/dual-identity/epoch/date authority.
--There is deliberately no public RPC, GUC authority switch or owner impersonation.
--A source upgrade must explicitly refresh this dependency profile AND the mirrors;
--both migration re-entry and every outer collection fail closed on source drift.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $period_delegated_source_prerequisites$
declare installed boolean;dependency record;function_meta pg_proc%rowtype;
  expected_owner oid;checked_role text;private_name text;
begin
  if to_regclass('public.faolla_schema_migrations') is null
    or not exists(select 1 from public.faolla_schema_migrations where version=202610080183 and name='merchant_attendance_period_continuation')
    or to_regprocedure('public.faolla_attendance_period_canonical_v1(jsonb)') is null
    or to_regprocedure('public.faolla_attendance_period_artifact_checked_v1(public.merchant_attendance_period_artifacts)') is null
    or to_regprocedure('public.faolla_attendance_outage_period_context_v1(text,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)') is null then
    raise exception 'merchant_attendance_period_delegated_source_prerequisite_required';
  end if;
  select oid into expected_owner from pg_roles where rolname=current_user;
  select exists(select 1 from public.faolla_schema_migrations where version=202610080184 and name='merchant_attendance_period_delegated_source') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610080184 and name<>'merchant_attendance_period_delegated_source') then
    raise exception 'merchant_attendance_period_delegated_source_installation_conflict';
  end if;
  --DEPENDENCY_PROFILE_BEGIN: pinned executable sources, not merely their names.
  for dependency in select * from (values
    ('public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid)','e13c2a8d9265985dae141a96fa56d733f77ac2a007b830f07cb3d0be1bfd1437',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_shift_check_v1(jsonb,uuid)','54632325e0d569c9835dfadc628632115c2f13a86c0466e852906a3f426bcfb0',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_coverage_v1(jsonb,uuid)','21917f1580f1b831e38064ce9bb003bf146a133858693e6b7a858b516d5f5c73',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)','bd1383469e3692438b3af55a504ef8348f9ef6cdd1e4134e705e0a4c9c227a0f',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_exception_source_legacy_v1(jsonb,uuid)','89309840b875cf0d530abc9e80fa8c0bcd93a34c64f23053c446a16eeea1bc8c',true,false,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)','1234394b481e1e3063d6a12d83bf606e11be1cb8d64b4b86ea194091eb5334b1',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_posthoc_preview_v1(jsonb,uuid,integer,uuid)','9640704dae146d72816cdebc8e4da81bf82b99b242df063ea2251a3c2e20df0c',false,false,0,array['p_query','p_auth_user_id','p_revision','p_current']::text[]),
    ('public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)','a12c7b2e71b3c98c379680e3be8a8c592f299e2475fdf6737cb9d1184279288e',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[]),
    ('public.faolla_attendance_plan_posthoc_formal_facts_v1(jsonb,uuid)','c9c0ced9eca39a7ad6f70710a04ef6f25d8add120839c91beb38ae6e7b70eacc',false,false,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid)','7794ff1971454006e2410476c4848faf3972d0e8bb67039c9acfb13dc32c7d64',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_period_report_v2(text,uuid,jsonb)','9c98806622a8f997ced37f7e83aaf548bd3ca04524ce55775c2828ba3639f389',true,true,0,array['p_site_id','p_auth_user_id','p_query']::text[]),
    ('public.faolla_attendance_unified_report_v1(text,uuid,jsonb)','b75e43356987a9754d1af8f9942996416b1405490aac618e7c0041cf66fd4a81',true,true,0,array['p_site_id','p_auth_user_id','p_query']::text[]),
    ('public.faolla_attendance_period_closure_report_v1(text,uuid,jsonb,jsonb)','7b5afdd059188deb1edd06668b308b4830b1937b4ca904f90e527535660001bf',true,false,0,array['p_site_id','p_auth_user_id','p_query','p_frame']::text[]),
    ('public.faolla_attendance_period_closure_unified_report_v1(text,uuid,jsonb,jsonb)','e113571f21684a514ea5be8536debbc97fc4096601fe6af91f8e01213ce0b775',true,false,0,array['p_site_id','p_auth_user_id','p_query','p_frame']::text[]),
    ('public.faolla_attendance_period_source_v1(jsonb,uuid)','9bb7f3abfaf07c110b33286950d347bab5b94874a35a6d459aef409bf341d4ca',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid)','512322083cd3b668f41d44322dec10f65b322388c8c4a470f34c5c691ba9eeb1',true,false,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_period_closure_source_v1(jsonb,uuid)','a89321433586376f607a9277306803ff363f43d07b157a1bc40f7aaf08be0f24',true,true,0,array['p_query','p_auth_user_id']::text[])
  ) expected(signature,source_sha256,is_definer,service_execute,defaults,argnames) loop
    select * into function_meta from pg_proc where oid=to_regprocedure(dependency.signature);
    if function_meta.oid is null or function_meta.proowner is distinct from expected_owner
      or function_meta.prorettype is distinct from 'jsonb'::regtype or function_meta.proretset
      or function_meta.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
      or function_meta.prosecdef is distinct from dependency.is_definer or function_meta.provolatile is distinct from 'v'
      or function_meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or function_meta.proargnames is distinct from dependency.argnames or function_meta.proargmodes is not null
      or function_meta.pronargdefaults is distinct from dependency.defaults
      or encode(sha256(convert_to(replace(replace(function_meta.prosrc,chr(13),''),
        quote_ident((select nspname from pg_namespace where oid=function_meta.pronamespace))||'.','public'||'.'),'UTF8')),'hex') is distinct from dependency.source_sha256
      or exists(select 1 from aclexplode(coalesce(function_meta.proacl,acldefault('f',function_meta.proowner))) a
        where a.privilege_type='EXECUTE' and a.grantee<>function_meta.proowner
          and not(dependency.service_execute and a.grantee=(select oid from pg_roles where rolname='service_role'))) then
      raise exception 'attendance_period_delegated_source_incompatible';
    end if;
    foreach checked_role in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(checked_role,function_meta.oid,'EXECUTE') is distinct from
        (checked_role='service_role' and dependency.service_execute) then
        raise exception 'attendance_period_delegated_source_incompatible';
      end if;
    end loop;
  end loop;
  --DEPENDENCY_PROFILE_END
  --MIRROR_PROFILE_BEGIN: do not overwrite a divergent installed private body.
  if installed then
    for dependency in select * from (values
      ('public.faolla_attendance_pd_binding_v1(jsonb,uuid)','bafe9103025f2d8717e840fb10554671bb44459a75065bb5fd1b560a96d7759f',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_shift_v1(jsonb,uuid)','93e34a5b9e5a4063a708829c94d2e89fdbe636422863f03336e94db74aeb138a',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_coverage_v1(jsonb,uuid)','677053898b2daa329dd664175e8f40b0c39e664236b2e7829c620c1e28177440',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_adoptions_v1(jsonb,uuid)','2bd55e8af66b971e2f16d03aee7a6daeff1fe01d290a03cd56d71f65b133f7e9',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_exception_legacy_v1(jsonb,uuid)','472e3a992e9a1282c91bd6021d0bcb4029b7639fbb6166fd35b6becd0dfb3d9c',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_exception_v1(jsonb,uuid)','8c20b5c314dd8f5f932b090ed9301123c6091a7c2ed86422fc8632c595df0fd5',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_posthoc_preview_v1(jsonb,uuid,integer,uuid)','9f0cdde2690e4c6b3f4b048ddba2eff9d74de42a0b3de702a1209a5b549a2709',0,array['p_query','p_auth_user_id','p_revision','p_current']::text[]),
      ('public.faolla_attendance_pd_posthoc_read_v1(jsonb,uuid)','5dfbf7d4675cdf1d019756195a1283a12f4e39f9d6e1b8d01a03bb4478b1f20b',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_formal_facts_v1(jsonb,uuid)','d3aedf4a521221a406bc64132a522b1350a5df55719391508a5ee6e53bbaac5b',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_formal_source_v1(jsonb,uuid)','df18e7f9c365cd2776cd6db47a634638406aee99f92d0a6db6375f1e47a7d4e3',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_report_v1(text,uuid,jsonb)','dec5e9cf5233ac99fe1f5b0321928c0be82ff5a0cec1a1bac77a13f43c371451',0,array['p_site_id','p_auth_user_id','p_query']::text[]),
      ('public.faolla_attendance_pd_unified_v1(text,uuid,jsonb)','1d7833adeefb8f86ffeeaa636efe9172c10aedcfe6358873987a44f1f8e27d91',0,array['p_site_id','p_auth_user_id','p_query']::text[]),
      ('public.faolla_attendance_pd_fixed_report_v1(text,uuid,jsonb,jsonb)','49a60f91bf7a6a3f1467e90da6d0d6dda2daa928d33c08352f4ebbc6620d0368',0,array['p_site_id','p_auth_user_id','p_query','p_frame']::text[]),
      ('public.faolla_attendance_pd_fixed_unified_v1(text,uuid,jsonb,jsonb)','61b51dc967f329c9812f01cfd6812db2d9edf620ceda6aa00b9d64dad98b15cc',0,array['p_site_id','p_auth_user_id','p_query','p_frame']::text[]),
      ('public.faolla_attendance_pd_source_v1(jsonb,uuid)','2f81f478bbc10f4831c53938a74c1617e293928c2534f231423674af84247ea5',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_fixed_source_v1(jsonb,uuid)','bc3d453f954be5dfc3624992ae0cc803bbec9d943322b82737775f830c355631',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_pd_envelope_v1(jsonb,uuid)','638f45c85375206e9586f5409faca10bf29af5ecfb55ffd850fdef0dd7b2fc98',0,array['p_query','p_auth_user_id']::text[]),
      ('public.faolla_attendance_period_delegated_source_v1(text,uuid,uuid,uuid,uuid,date,date,uuid)','0108f90d9092d374ffd35265b0e82b88a6c24239cdd89a5eaf3dbb7586b97749',1,array['p_site','p_worker','p_employee','p_employee_auth','p_actor','p_from','p_through','p_period']::text[])
    ) expected(signature,source_sha256,defaults,argnames) loop
      select * into function_meta from pg_proc where oid=to_regprocedure(dependency.signature);
      if function_meta.oid is null or function_meta.proargnames is distinct from dependency.argnames
        or function_meta.proargmodes is not null or function_meta.pronargdefaults is distinct from dependency.defaults
        or encode(sha256(convert_to(replace(replace(function_meta.prosrc,chr(13),''),
          quote_ident((select nspname from pg_namespace where oid=function_meta.pronamespace))||'.','public'||'.'),'UTF8')),'hex') is distinct from dependency.source_sha256 then
        raise exception 'merchant_attendance_period_delegated_source_installation_conflict';
      end if;
    end loop;
  end if;
  --MIRROR_PROFILE_END
  foreach private_name in array array['faolla_attendance_pd_binding_v1','faolla_attendance_pd_shift_v1','faolla_attendance_pd_coverage_v1','faolla_attendance_pd_adoptions_v1','faolla_attendance_pd_exception_legacy_v1','faolla_attendance_pd_exception_v1','faolla_attendance_pd_posthoc_preview_v1','faolla_attendance_pd_posthoc_read_v1','faolla_attendance_pd_formal_facts_v1','faolla_attendance_pd_formal_source_v1','faolla_attendance_pd_report_v1','faolla_attendance_pd_unified_v1','faolla_attendance_pd_fixed_report_v1','faolla_attendance_pd_fixed_unified_v1','faolla_attendance_pd_source_v1','faolla_attendance_pd_fixed_source_v1','faolla_attendance_pd_envelope_v1','faolla_attendance_period_delegated_source_v1'] loop
    if (select count(*) from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=private_name)
      <>(case when installed then 1 else 0 end) then raise exception 'merchant_attendance_period_delegated_source_installation_conflict';end if;
    if installed then
      select p.* into function_meta from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=private_name;
      if function_meta.proowner is distinct from expected_owner or function_meta.prosecdef
        or function_meta.prorettype is distinct from 'jsonb'::regtype or function_meta.proretset
        or function_meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
        or function_meta.provolatile is distinct from 'v'
        or function_meta.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
        or exists(select 1 from aclexplode(coalesce(function_meta.proacl,acldefault('f',function_meta.proowner))) a where a.grantee<>function_meta.proowner and a.privilege_type='EXECUTE') then
        raise exception 'merchant_attendance_period_delegated_source_installation_conflict';
      end if;
      foreach checked_role in array array['anon','authenticated','service_role'] loop
        if has_function_privilege(checked_role,function_meta.oid,'EXECUTE') then raise exception 'merchant_attendance_period_delegated_source_installation_conflict';end if;
      end loop;
    end if;
  end loop;
end;
$period_delegated_source_prerequisites$;

--PRIVATE MIRROR binding: 202610040135_merchant_attendance_shift_rule_binding_reader.sql / faolla_attendance_shift_rule_binding_v1
create or replace function public.faolla_attendance_pd_binding_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;wid uuid;eid uuid;s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  ev public.merchant_attendance_events%rowtype;b public.merchant_attendance_shift_rule_bindings%rowtype;a public.merchant_attendance_shift_rule_sources%rowtype;
  graph jsonb;source_item jsonb:=null;binding_item jsonb:=null;state_name text:='missing';reason_name text:='binding_missing';read_at timestamptz;result jsonb;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or not public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','startEventId'])
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','')!~'^\d{8}$'
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'startEventId','uuid') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;eid:=(p_query->>'startEventId')::uuid;
  --131/132 owner-read lock order. Read authorization is independent of activity,
  -- module pause, the historical author, and the original clock's request auth.
  perform 1 from public.merchants where id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
  select * into ev from public.merchant_attendance_events where merchant_id=site and worker_id=wid and id=eid;
  if ev.id is null or ev.action<>'clock_in' then raise exception 'attendance_shift_rule_binding_not_found';end if;
  if ev.actor_employee_id is distinct from w.employee_id then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
  if not public.faolla_attendance_group_text_v1(w.display_name,1,120) or not public.faolla_attendance_group_text_v1(w.worker_no,1,40)
    or w.version not between 1 and 9007199254740990 or s.version not between 1 and 9007199254740990
    or ev.sequence not between 1 and 9007199254740990 or not isfinite(ev.occurred_at) or ev.break_paid is not null or ev.source not in('web','kiosk')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(ev.time_zone),'zone')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(ev.operation_id),'uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(ev.location_id),'uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(e.id),'uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(e.auth_user_id),'uuid') then raise exception 'attendance_shift_rule_binding_invalid';end if;
  select * into b from public.merchant_attendance_shift_rule_bindings where merchant_id=site and start_event_id=eid;
  if b.start_event_id is not null then
    -- Even an unverified stored binding cannot be disclosed under a replacement
    -- employee/Auth pairing. Missing means no saved historical Auth proof.
    if b.employee_id is distinct from w.employee_id or b.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_shift_rule_binding_identity_changed';end if;
    if row(b.worker_id,b.operation_id,b.sequence,b.location_id,b.occurred_at,b.event_time_zone)
      is distinct from row(ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone)
      or b.algorithm_version<>'personal-group-enterprise-point-v1' or b.binding_policy<>'clock-in-whole-shift-v1'
      or not isfinite(b.recorded_at) or b.channel not in('self','location','pin','onsite')
      or (b.channel='pin')<>(ev.source='kiosk') or b.channel='pin' and b.request_auth_user_id is not null
      or b.channel<>'pin' and b.request_auth_user_id is distinct from e.auth_user_id
      or b.worker_version is not null and b.worker_version not between 1 and w.version
      or b.settings_version is not null and b.settings_version not between 1 and s.version then raise exception 'attendance_shift_rule_binding_invalid';end if;
    state_name:=b.status;reason_name:=b.reason;
    if b.status='verified' then
      if b.reason is not null or b.source_id is null or b.worker_version is null or b.settings_version is null or b.recorded_at<ev.occurred_at then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      select * into a from public.merchant_attendance_shift_rule_sources where merchant_id=site and source_id=b.source_id and worker_id=wid;
      if a.source_id is null or not isfinite(a.created_at) or a.created_at>b.recorded_at
        or public.faolla_attendance_shift_rule_source_valid_v1(a.source_text,site,wid,a.source_sha256,a.source_bytes) is distinct from true then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      graph:=a.source_text::jsonb;
      if graph->>'employeeId' is distinct from b.employee_id::text or graph->>'employeeAuthUserId' is distinct from b.employee_auth_user_id::text
        or graph->'workerVersion' is distinct from to_jsonb(b.worker_version) or graph->'settingsVersion' is distinct from to_jsonb(b.settings_version)
        or not public.faolla_attendance_shift_rule_binding_graph_v1(graph,ev.occurred_at) then raise exception 'attendance_shift_rule_binding_invalid';end if;
      -- The original text is returned unchanged. Dedup source_id may belong to
      -- an earlier clock-in; corporate graph zone may differ from event zone.
      source_item:=jsonb_build_object('sourceId',a.source_id,'sourceText',a.source_text,'sourceSha256',a.source_sha256,'sourceBytes',a.source_bytes,'canonicalFormat','pg-jsonb-text-utf8-v1');
    elsif b.status='unverified' then
      if b.source_id is not null or b.reason is null or b.reason not in('source_unavailable','source_invalid','source_conflict','identity_unavailable','identity_changed',
        'inactive_worker','inactive_employee','invalid_date','assignment_overlap','inactive_group','personal_overlap','source_cap','source_quota','source_too_large') then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
    else raise exception 'attendance_shift_rule_binding_invalid';end if;
    binding_item:=jsonb_build_object('channel',b.channel,'requestAuthUserId',b.request_auth_user_id,'employeeId',b.employee_id,'employeeAuthUserId',b.employee_auth_user_id,
      'workerVersion',b.worker_version,'settingsVersion',b.settings_version,'algorithmVersion',b.algorithm_version,'bindingPolicy',b.binding_policy,
      'recordedAt',to_char(b.recorded_at at time zone 'UTC',stamp_format),'source',source_item);
  end if;
  read_at:=clock_timestamp();
  if read_at<ev.occurred_at or b.recorded_at is not null and read_at<b.recorded_at then raise exception 'attendance_shift_rule_binding_invalid';end if;
  result:=jsonb_build_object('protocol','shift-rule-binding-v1','readOnly',true,'formalReady',false,'siteId',site,'actorId',p_auth_user_id,
    'worker',jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active'),
    'event',jsonb_build_object('startEventId',ev.id,'operationId',ev.operation_id,'sequence',ev.sequence,'locationId',ev.location_id,'occurredAt',to_char(ev.occurred_at at time zone 'UTC',stamp_format),'timeZone',ev.time_zone,'source',ev.source,'employeeId',ev.actor_employee_id),
    'status',state_name,'reason',reason_name,'binding',binding_item,'readAt',to_char(read_at at time zone 'UTC',stamp_format));
  --64KiB source text plus JSON escaping and fixed metadata, not more sources.
  if octet_length(convert_to(result::text,'UTF8'))>262144 then raise exception 'attendance_shift_rule_binding_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
  raise exception 'attendance_shift_rule_binding_invalid';
end;
$$;

--PRIVATE MIRROR shift: 202610050143_merchant_attendance_pin_schedule.sql / faolla_attendance_shift_check_v1
create or replace function public.faolla_attendance_pd_shift_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare
  binding jsonb;site text;wid uuid;eid uuid;employee uuid;member_auth uuid;observed timestamptz;
  first_event public.merchant_attendance_events%rowtype;ev public.merchant_attendance_events%rowtype;tail_event public.merchant_attendance_events%rowtype;
  candidates public.merchant_attendance_events[];events jsonb:='[]'::jsonb;event_count integer:=0;
  previous_sequence bigint;previous_at timestamptz;last_id uuid;last_at timestamptz;state_name text:='off';
  root_effect public.merchant_attendance_correction_effects%rowtype;latest public.merchant_attendance_effect_versions%rowtype;
  previous_effect public.merchant_attendance_effect_versions%rowtype;effect public.merchant_attendance_effect_current_v2%rowtype;
  original_request public.merchant_attendance_correction_entries%rowtype;revision_request public.merchant_attendance_revision_requests%rowtype;
  effect_json jsonb:=null;expected_previous uuid;expected_previous_at timestamptz;
  saved public.merchant_attendance_shift_schedule_relations%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;
  context jsonb;current_slot jsonb;current_publication jsonb;current_cancellation jsonb;relation jsonb:=null;
  was_cancelled boolean;is_cancelled boolean;expected_reason text;result jsonb;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  -- The existing owner reader validates EXACT siteId/workerId/startEventId and
  -- current historical dual identity. Never call a self RPC as an owner/member.
  binding:=public.faolla_attendance_pd_binding_v1(p_query,p_auth_user_id);
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;eid:=(p_query->>'startEventId')::uuid;
  employee:=(binding->'worker'->>'employeeId')::uuid;member_auth:=(binding->'worker'->>'employeeAuthUserId')::uuid;
  observed:=clock_timestamp();
  if not isfinite(observed) or observed<(binding->>'readAt')::timestamptz then raise exception 'attendance_shift_check_invalid';end if;
  select * into first_event from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.id=eid;
  if first_event.id is null or first_event.action<>'clock_in' or first_event.actor_employee_id is distinct from employee
    or first_event.sequence is distinct from (binding->'event'->>'sequence')::bigint
    or first_event.occurred_at is distinct from (binding->'event'->>'occurredAt')::timestamptz
    or first_event.location_id::text is distinct from binding->'event'->>'locationId'
    or first_event.time_zone is distinct from binding->'event'->>'timeZone'
    or first_event.operation_id::text is distinct from binding->'event'->>'operationId' then raise exception 'attendance_shift_check_invalid';end if;
  if first_event.sequence>1 and not exists(select 1 from public.merchant_attendance_events x
    where x.merchant_id=site and x.worker_id=wid and x.sequence=first_event.sequence-1 and x.action='clock_out') then
    raise exception 'attendance_shift_check_invalid';end if;
  -- Existing unique(merchant_id,worker_id,sequence) bounds the probe, including
  -- a2003rd sentinel. Stop at the first real clock_out; never append an asOf one.
  candidates:=array(select x from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid
    and x.sequence>=first_event.sequence order by x.sequence limit 2003);
  if cardinality(candidates)=0 then raise exception 'attendance_shift_check_invalid';end if;
  previous_sequence:=first_event.sequence-1;previous_at:=first_event.occurred_at;
  foreach ev in array candidates loop
    event_count:=event_count+1;
    if event_count>2002 then raise exception 'attendance_shift_check_too_large';end if;
    if ev.actor_employee_id is distinct from employee then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
    if ev.sequence<>previous_sequence+1 or ev.sequence not between 1 and 9007199254740991
      or not isfinite(ev.occurred_at) or ev.occurred_at<previous_at or ev.occurred_at>observed
      or ev.occurred_at<timestamptz '2000-01-01 00:00:00+00' or ev.occurred_at>=timestamptz '2101-01-01 00:00:00+00'
      or ev.source not in('web','kiosk') or ev.location_id is null or char_length(ev.time_zone) not between 1 and 100
      or ev.time_zone<>btrim(ev.time_zone) or ev.time_zone ~ '[[:cntrl:]]'
      or (ev.action='break_start' and ev.break_paid is null) or (ev.action<>'break_start' and ev.break_paid is not null) then
      raise exception 'attendance_shift_check_invalid';end if;
    if event_count=1 then
      if ev.id<>eid or ev.action<>'clock_in' then raise exception 'attendance_shift_check_invalid';end if;state_name:='working';
    elsif ev.action='break_start' and state_name='working' then state_name:='break';
    elsif ev.action='break_end' and state_name='break' then state_name:='working';
    elsif ev.action='clock_out' and state_name='working' then state_name:='completed';
    else raise exception 'attendance_shift_check_invalid';end if;
    previous_sequence:=ev.sequence;previous_at:=ev.occurred_at;last_id:=ev.id;last_at:=ev.occurred_at;
    if state_name='completed' then exit;end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',x.id,'locationId',x.location_id,'sequence',x.sequence,'action',x.action,
    'occurredAt',to_char(x.occurred_at at time zone 'UTC',stamp_format),'timeZone',x.time_zone,'breakPaid',x.break_paid,'source',x.source) order by x.sequence)
    into events from unnest(candidates) x where x.sequence<=previous_sequence;
  if state_name<>'completed' then
    --111 derives state from the indexed immutable tail, not a mutable cache.
    select * into tail_event from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid order by x.sequence desc limit 1;
    if row(tail_event.id,tail_event.sequence,tail_event.occurred_at,tail_event.actor_employee_id)
      is distinct from row(last_id,previous_sequence,last_at,employee) then raise exception 'attendance_shift_check_invalid';end if;
  end if;
  if state_name='completed' and last_at-first_event.occurred_at>interval '744 hours' then raise exception 'attendance_shift_check_too_large';end if;

  -- PK root lookup, one reverse-PK latest revision, then one exact view member.
  -- No broad employee/date query or traversal of the complete revision history.
  select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=eid;
  if root_effect.request_id is not null then
    select * into latest from public.merchant_attendance_effect_versions x where x.merchant_id=site and x.root_request_id=root_effect.request_id
      order by x.revision desc limit 1;
    select * into effect from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site
      and x.root_request_id=root_effect.request_id and x.revision=coalesce(latest.revision,1);
    if effect.request_id is null or effect.worker_id is distinct from wid or effect.start_event_id is distinct from eid
      or effect.employee_id is distinct from employee or effect.original_last_event_id is distinct from last_id::text
      or state_name<>'completed' or effect.time_zone is distinct from first_event.time_zone
      or not isfinite(effect.recorded_at) or effect.recorded_at<last_at or effect.recorded_at>observed
      or effect.root_operation_id is distinct from root_effect.operation_id or effect.root_recorded_at is distinct from root_effect.recorded_at
      or root_effect.recorded_at<last_at then raise exception 'attendance_shift_check_invalid';end if;
    select * into original_request from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.operation_id=root_effect.request_id and x.action='submit';
    if original_request.operation_id is null or original_request.worker_id is distinct from wid or original_request.start_event_id is distinct from eid
      or original_request.employee_id is distinct from employee or original_request.actor_auth_user_id is distinct from member_auth
      or original_request.basis->'events'->0->>'id' is distinct from eid::text
      or original_request.basis->'events'->-1->>'id' is distinct from last_id::text then raise exception 'attendance_shift_check_invalid';end if;
    if latest.operation_id is null then
      if effect.revision<>1 or effect.request_id is distinct from root_effect.request_id or effect.operation_id is distinct from root_effect.operation_id
        or effect.previous_operation_id is not null then raise exception 'attendance_shift_check_invalid';end if;
    else
      if latest.revision=2 then expected_previous:=root_effect.operation_id;expected_previous_at:=root_effect.recorded_at;
      else
        select * into previous_effect from public.merchant_attendance_effect_versions x where x.merchant_id=site
          and x.root_request_id=root_effect.request_id and x.revision=latest.revision-1;
        if previous_effect.operation_id is null or previous_effect.worker_id is distinct from wid or previous_effect.start_event_id is distinct from eid then
          raise exception 'attendance_shift_check_invalid';end if;
        expected_previous:=previous_effect.operation_id;expected_previous_at:=previous_effect.recorded_at;
      end if;
      select * into revision_request from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.operation_id=latest.request_id and x.action='submit';
      if latest.worker_id is distinct from wid or latest.start_event_id is distinct from eid or latest.revision<2
        or latest.previous_operation_id is distinct from expected_previous or latest.recorded_at<=expected_previous_at
        or effect.operation_id is distinct from latest.operation_id or effect.request_id is distinct from latest.request_id
        or effect.previous_operation_id is distinct from expected_previous
        or revision_request.operation_id is null or revision_request.base_request_id is distinct from root_effect.request_id
        or revision_request.worker_id is distinct from wid or revision_request.employee_id is distinct from employee
        or revision_request.actor_auth_user_id is distinct from member_auth
        or coalesce(revision_request.command->>'expectedEffectiveOperationId',revision_request.base_operation_id::text) is distinct from expected_previous::text
        or revision_request.recorded_at<=expected_previous_at or revision_request.recorded_at>=latest.recorded_at then
        raise exception 'attendance_shift_check_invalid';end if;
    end if;
    effect_json:=public.faolla_attendance_effect_evidence_v2(effect,observed);
  end if;

  --137's event key is bounded. Missing is not synthesized from today's plans.
  select * into saved from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.start_event_id=eid;
  if saved.start_event_id is not null then
    if saved.employee_id is distinct from employee or saved.employee_auth_user_id is distinct from member_auth then
      raise exception 'attendance_shift_rule_binding_identity_changed';end if;
    if row(saved.worker_id,saved.operation_id,saved.sequence,saved.location_id,saved.occurred_at,saved.event_time_zone)
      is distinct from row(wid,first_event.operation_id,first_event.sequence,first_event.location_id,first_event.occurred_at,first_event.time_zone)
      or first_event.source not in('web','kiosk') or first_event.occurred_at<>first_event.received_at
      or saved.binding_policy<>'employee-explicit-clock-in-v1' or not isfinite(saved.recorded_at) or saved.recorded_at>observed
      or saved.worker_version not between 1 and 9007199254740991 or saved.location_version not between 1 and 9007199254740991
      or saved.settings_version not between 1 and 9007199254740991 or saved.schedule_revision not between 0 and 9007199254740990
      or saved.schedule_revision>0 and not exists(select 1 from public.merchant_attendance_schedule_commands x where x.merchant_id=site and x.revision=saved.schedule_revision) then
      raise exception 'attendance_shift_check_invalid';end if;
    if first_event.source='kiosk' then perform public.faolla_attendance_pin_schedule_receipt_v1(saved,member_auth);end if;
    is_cancelled:=null;
    if saved.selection is null then
      if saved.status<>'unselected' or saved.reason is not null or saved.slot_id is not null or saved.slot_revision is not null
        or saved.slot_snapshot is not null or saved.publication_snapshot is not null or saved.cancellation_snapshot is not null then
        raise exception 'attendance_shift_check_invalid';end if;
    else
      select * into slot from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=saved.slot_id;
      if slot.id is null or slot.worker_id is distinct from wid or slot.employee_id is distinct from employee or slot.revision is distinct from saved.slot_revision
        or saved.slot_revision>saved.schedule_revision or saved.selection is distinct from jsonb_build_object('slotId',slot.id,'revision',slot.revision)
        or saved.status not in('linked','unverified') or jsonb_typeof(saved.slot_snapshot) is distinct from 'object'
        or jsonb_typeof(saved.slot_snapshot->'cancelled') is distinct from 'boolean' then raise exception 'attendance_shift_check_invalid';end if;
      context:=public.faolla_attendance_self_schedule_slot_v1(slot);
      current_slot:=context->'slot';current_publication:=nullif(context->'publication','null'::jsonb);current_cancellation:=nullif(context->'cancellation','null'::jsonb);
      if current_publication->>'employeeAuthUserId' is not null and current_publication->>'employeeAuthUserId'<>member_auth::text then
        raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      if saved.slot_snapshot-'cancelled' is distinct from current_slot-'cancelled'
        or saved.publication_snapshot is distinct from current_publication then raise exception 'attendance_shift_check_invalid';end if;
      was_cancelled:=(saved.slot_snapshot->>'cancelled')::boolean;is_cancelled:=(current_slot->>'cancelled')::boolean;
      if was_cancelled then
        if not is_cancelled or saved.cancellation_snapshot is null or saved.cancellation_snapshot is distinct from current_cancellation
          or (current_cancellation->>'revision')::bigint>saved.schedule_revision then raise exception 'attendance_shift_check_invalid';end if;
      elsif saved.cancellation_snapshot is not null or is_cancelled and (current_cancellation->>'revision')::bigint<=saved.schedule_revision then
        raise exception 'attendance_shift_check_invalid';end if;
      -- Outside-window was checked by137 at insertion using the THEN-available
      -- zone database. Preserve that immutable decision, do not reinterpret it.
      expected_reason:=case when was_cancelled then 'cancelled' when slot.location_id<>first_event.location_id then 'location_changed'
        when saved.reason='outside_window' then 'outside_window' when not (current_slot->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
      if saved.reason is distinct from expected_reason or saved.status is distinct from (case when expected_reason is null then 'linked' else 'unverified' end) then
        raise exception 'attendance_shift_check_invalid';end if;
    end if;
    relation:=jsonb_build_object('startEventId',saved.start_event_id,'operationId',saved.operation_id,'selection',saved.selection,'status',saved.status,
      'reason',saved.reason,'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision,
      'recordedAt',to_char(saved.recorded_at at time zone 'UTC',stamp_format),'currentCancelled',is_cancelled);
  end if;
  result:=jsonb_build_object('protocol','shift-check-source-v1','binding',binding,'asOf',to_char(observed at time zone 'UTC',stamp_format),
    'events',events,'effect',effect_json,'relation',relation);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_shift_check_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
  raise exception 'attendance_shift_check_invalid';
end;
$$;

--PRIVATE MIRROR coverage: 202610050139_merchant_attendance_plan_coverage.sql / faolla_attendance_plan_coverage_v1
create or replace function public.faolla_attendance_pd_coverage_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
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
  perform 1 from public.merchants where id=site for share;
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
    child:=public.faolla_attendance_pd_shift_v1(jsonb_build_object('siteId',site,'workerId',wid,'startEventId',saved.start_event_id),p_auth_user_id);
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

--PRIVATE MIRROR adoptions: 202610050145_merchant_attendance_plan_adoption_view.sql / faolla_attendance_plan_coverage_adoptions_v1
create or replace function public.faolla_attendance_pd_adoptions_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare original_coverage jsonb;child jsonb;adoption jsonb;adoptions jsonb:='[]'::jsonb;result jsonb;
  event_count integer:=0;child_count integer;start_id uuid;previous_id uuid;
begin
  --139 retains owner/settings/worker/employee locks before even an EMPTY set.
  -- Do not repeat the whole139 read or separately query a changing relation set.
  original_coverage:=public.faolla_attendance_pd_coverage_v1(p_query,p_auth_user_id);
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

--PRIVATE MIRROR exception_legacy: 202610060159_merchant_attendance_work_arrangement_exceptions.sql / faolla_attendance_plan_exception_source_legacy_v1
create or replace function public.faolla_attendance_pd_exception_legacy_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare
  envelope jsonb;coverage jsonb;child jsonb;item jsonb;adoption jsonb;compact jsonb;summary jsonb;source jsonb;source_text text;result jsonb;
  site text;wid uuid;employee uuid;member_auth uuid;place uuid;sid uuid;target_id uuid;approval_id uuid;associated_ids uuid[]:='{}';candidate_ids uuid[];
  slot jsonb;worker jsonb;approval jsonb;sessions jsonb:='[]';extra_items jsonb:='[]';leave_items jsonb:='[]';calendar_items jsonb:='[]';missing_items jsonb:='[]';pending_items jsonb:='[]';
  extra_limited boolean:=false;leave_limited boolean:=false;calendar_limited boolean:=false;missing_limited boolean:=false;pending_limited boolean:=false;
  flags text[]:='{}';blockers jsonb;candidate jsonb;field jsonb;field_result jsonb;key text;phase text;status_name text;failure text;
  plan_begin timestamptz;plan_end timestamptz;read_at timestamptz;a timestamptz;b timestamptz;original_start timestamptz;original_end timestamptz;
  selected_start timestamptz;selected_end timestamptz;all_closed boolean:=true;prior_end timestamptz;raw_delta numeric;excess numeric;grace integer;
  event_count integer:=0;ids uuid[];other_ids uuid[];calendar_ids uuid[];root_ids uuid[];
  bounds jsonb:='{}';cache_key text;from_day date;through_day date;boundary_date date;boundary_at timestamptz;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_op public.merchant_attendance_leave_entries%rowtype;
  calendar_row public.merchant_attendance_calendar_entries%rowtype;calendar_op public.merchant_attendance_calendar_operations%rowtype;
  missing_row public.merchant_attendance_missing_requests%rowtype;missing_op public.merchant_attendance_missing_entries%rowtype;missing_first public.merchant_attendance_missing_entries%rowtype;
  correction_row public.merchant_attendance_correction_entries%rowtype;correction_tail public.merchant_attendance_correction_entries%rowtype;
  revision_row public.merchant_attendance_revision_requests%rowtype;revision_tail public.merchant_attendance_revision_requests%rowtype;
  root_effect public.merchant_attendance_correction_effects%rowtype;artifact public.merchant_attendance_plan_rule_artifacts%rowtype;
  decision public.merchant_attendance_correction_decisions%rowtype;revision_decision public.merchant_attendance_revision_decisions%rowtype;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  -- This is the authorization/lock acquisition, including empty relation sets.
  -- No impersonation, lock upgrades, independent current-head read or rescanning
  -- a changing association set after authorization.
  envelope:=public.faolla_attendance_pd_adoptions_v1(p_query,p_auth_user_id);
  coverage:=envelope->'coverage';site:=coverage->>'siteId';worker:=coverage->'worker';slot:=coverage->'slot';
  wid:=(worker->>'workerId')::uuid;employee:=(worker->>'employeeId')::uuid;member_auth:=(worker->>'employeeAuthUserId')::uuid;
  sid:=(slot->>'id')::uuid;place:=(slot->>'locationId')::uuid;plan_begin:=(slot->>'startAt')::timestamptz;plan_end:=(slot->>'endAt')::timestamptz;
  if envelope->>'protocol' is distinct from 'plan-coverage-adoptions-source-v1'
    or coverage->>'actorId' is distinct from p_auth_user_id::text or site is distinct from p_query->>'siteId'
    or wid::text is distinct from p_query->>'workerId' or sid::text is distinct from p_query->>'slotId'
    or employee is null or member_auth is null or jsonb_array_length(coverage->'sessions')>10
    or jsonb_array_length(coverage->'sessions')<>jsonb_array_length(envelope->'adoptions') then raise exception 'attendance_plan_exception_invalid';end if;
  if (slot->>'cancelled')::boolean then flags:=array_append(flags,'slot_cancelled');end if;
  if not (slot->>'hasPublicationEvidence')::boolean then flags:=array_append(flags,'publication_missing');end if;
  if not (worker->>'active')::boolean or not (worker->>'employeeActive')::boolean then flags:=array_append(flags,'worker_inactive');end if;
  if jsonb_array_length(coverage->'sessions')=0 then flags:=array_append(flags,'no_associated_sessions');end if;

  for child in select value from jsonb_array_elements(coverage->'sessions') loop
    compact:=public.faolla_attendance_plan_exception_session_v1(child);target_id:=(compact->>'startEventId')::uuid;
    associated_ids:=array_append(associated_ids,target_id);event_count:=event_count+jsonb_array_length(child->'events');
    if event_count>2002 then raise exception 'attendance_plan_exception_too_large';end if;
    select x.value->'adoption' into adoption from jsonb_array_elements(envelope->'adoptions') x where x.value->>'startEventId'=target_id::text;
    if adoption is null then raise exception 'attendance_plan_exception_invalid';end if;
    if child->'relation'->>'status' is distinct from 'linked' then flags:=array_append(flags,'association_unverified');end if;
    if adoption='null'::jsonb then flags:=array_append(flags,'adoption_missing');
    elsif adoption->>'status'<>'adopted' then flags:=array_append(flags,'adoption_unverified');
    elsif approval_id is null then
      approval_id:=(adoption->'approval'->>'operationId')::uuid;
      --145 already called the exact fixed-reference validator (p_current=false).
      -- Recheck the body/byte hash here; never use the mutable approval stream.
      select * into artifact from public.merchant_attendance_plan_rule_artifacts x
        where x.merchant_id=site and x.source_id=(adoption->'approval'->>'sourceId')::uuid;
      if artifact.source_id is null or artifact.worker_id<>wid or artifact.slot_id<>sid
        or artifact.employee_id<>employee or artifact.employee_auth_user_id<>member_auth
        or artifact.source_sha256 is distinct from adoption->'approval'->>'sourceSha256'
        or artifact.source_sha256 is distinct from encode(sha256(convert_to(artifact.source::text,'UTF8')),'hex')
        or artifact.source_bytes is distinct from octet_length(convert_to(artifact.source::text,'UTF8'))
        or public.faolla_attendance_plan_rule_source_v1(artifact.source) is distinct from true then raise exception 'attendance_plan_exception_invalid';end if;
      approval:=(adoption->'approval')||jsonb_build_object('source',artifact.source);
    elsif adoption->'approval'->>'operationId' is distinct from approval_id::text
      or adoption->'approval' is distinct from (approval-'source') then flags:=array_append(flags,'approval_mismatch');end if;
    if exists(select 1 from jsonb_array_elements(child->'events') ev where ev.value->>'locationId' is distinct from place::text) then
      flags:=array_append(flags,'session_location_mismatch');end if;
    a:=(compact->'original'->>'startAt')::timestamptz;b:=(compact->'original'->>'endAt')::timestamptz;
    original_start:=least(original_start,a);original_end:=greatest(original_end,b);
    a:=(compact->'selected'->>'startAt')::timestamptz;b:=(compact->'selected'->>'endAt')::timestamptz;
    selected_start:=least(selected_start,a);selected_end:=greatest(selected_end,b);
    if b is null then all_closed:=false;flags:=array_append(flags,'session_open');
    elsif b=a then flags:=array_append(flags,'session_zero_duration');
    elsif a>=plan_end or b<=plan_begin then flags:=array_append(flags,'session_outside_plan');end if;
    sessions:=sessions||jsonb_build_array(compact||jsonb_build_object('relation',child->'relation','adoption',adoption));
  end loop;
  if not all_closed then original_end:=null;selected_end:=null;end if;
  for item in select value from jsonb_array_elements(sessions) order by (value->'selected'->>'startAt')::timestamptz,value->>'startEventId' loop
    a:=(item->'selected'->>'startAt')::timestamptz;b:=(item->'selected'->>'endAt')::timestamptz;
    if prior_end is not null and a<prior_end then flags:=array_append(flags,'session_overlap');end if;
    prior_end:=greatest(prior_end,b);
  end loop;

  -- Raw candidates use the existing clock_in partial index. One preceding
  -- anchor has NO lookback ceiling: an indefinitely open shift stays visible.
  ids:=array(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
    and x.occurred_at>=plan_begin and x.occurred_at<plan_end order by x.occurred_at,x.sequence limit 101);
  if cardinality(ids)>100 then extra_limited:=true;end if;
  candidate_ids:=ids;
  select x.id into target_id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
    and x.occurred_at<plan_begin order by x.occurred_at desc,x.sequence desc limit 1;
  if target_id is not null then candidate_ids:=array_append(candidate_ids,target_id);end if;
  -- Separately bound ORIGINAL effect and every revised start range BEFORE latest
  -- selection. Thus a revision moved in from outside the raw window is not lost.
  ids:=array(select x.start_event_id from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=plan_begin-interval '744 hours' and x.start_at<plan_end order by x.start_at desc limit 101);
  if cardinality(ids)>100 then extra_limited:=true;end if;candidate_ids:=candidate_ids||ids;
  ids:=array(select x.start_event_id from public.merchant_attendance_effect_versions x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=plan_begin-interval '744 hours' and x.start_at<plan_end order by x.start_at,x.start_event_id limit 101);
  if cardinality(ids)>100 then extra_limited:=true;end if;candidate_ids:=candidate_ids||ids;
  candidate_ids:=array(select distinct x from unnest(candidate_ids) x where not(x=any(associated_ids)) order by x limit 101);
  if cardinality(candidate_ids)>100 then extra_limited:=true;end if;
  event_count:=0;
  if not extra_limited then
    foreach target_id in array candidate_ids loop
      begin
        child:=public.faolla_attendance_pd_shift_v1(jsonb_build_object('siteId',site,'workerId',wid,'startEventId',target_id),p_auth_user_id);
        event_count:=event_count+jsonb_array_length(child->'events');
        if event_count>2002 then extra_limited:=true;exit;end if;
        compact:=public.faolla_attendance_plan_exception_session_v1(child);
        if ((compact->'original'->>'startAt')::timestamptz<plan_end and coalesce((compact->'original'->>'endAt')::timestamptz,'infinity'::timestamptz)>plan_begin)
          or ((compact->'selected'->>'startAt')::timestamptz<plan_end and coalesce((compact->'selected'->>'endAt')::timestamptz,'infinity'::timestamptz)>plan_begin) then
          extra_items:=extra_items||jsonb_build_array(compact||jsonb_build_object('relationSlotId',child->'relation'->'slot'->'id'));
        end if;
      exception when raise_exception then
        get stacked diagnostics failure=message_text;
        if failure in('attendance_shift_check_too_large','attendance_plan_adoption_view_too_large') then extra_limited:=true;exit;end if;
        raise;
      end;
    end loop;
  end if;
  if extra_limited then extra_items:='[]';end if;

  -- Leave: include all terminal states, no reason text and no automatic excuse.
  ids:=array(select x.request_id from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=plan_begin-interval '8784 hours' and x.start_at<plan_end order by x.start_at,x.end_at limit 101);
  leave_limited:=cardinality(ids)>100;
  if not leave_limited then
    for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
      if leave_row.end_at<=plan_begin then continue;end if;
      if leave_row.employee_id<>employee or leave_row.actor_auth_user_id<>member_auth then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      summary:=public.faolla_attendance_leave_summary_v1(leave_row);
      select * into leave_op from public.merchant_attendance_leave_entries x where x.merchant_id=site and x.request_id=leave_row.request_id order by x.revision desc limit 1;
      leave_items:=leave_items||jsonb_build_array(jsonb_build_object('requestId',leave_row.request_id,'operationId',leave_op.operation_id,
        'revision',summary->'revision','status',summary->'status','startAt',summary->'startAt','endAt',summary->'endAt','recordedAt',to_char(leave_op.recorded_at at time zone 'UTC',fmt)));
    end loop;
  end if;

  -- Calendar: two indexed scopes (enterprise and ORIGINAL slot location), never
  -- today's default location. Conservative366-day civil range, cap BEFORE costly
  -- chain/date checks; cache each distinct saved-zone/day boundary once.
  from_day:=(plan_begin at time zone 'UTC')::date-367;through_day:=(plan_end at time zone 'UTC')::date+2;
  calendar_ids:=array(select x.entry_id from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id is null
    and x.from_date>=from_day and x.from_date<=through_day order by x.from_date,x.through_date limit 101);
  ids:=array(select x.entry_id from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id=place
    and x.from_date>=from_day and x.from_date<=through_day order by x.from_date,x.through_date limit 101);
  calendar_ids:=calendar_ids||ids;calendar_limited:=cardinality(calendar_ids)>100;
  if not calendar_limited then
    for calendar_row in select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.entry_id=any(calendar_ids) order by x.entry_id loop
      summary:=public.faolla_attendance_calendar_summary_v1(calendar_row);
      foreach boundary_date in array array[calendar_row.from_date,calendar_row.through_date+1] loop
        cache_key:=jsonb_build_array(calendar_row.time_zone,boundary_date)::text;
        if not(bounds ? cache_key) then
          boundary_at:=public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone);
          bounds:=bounds||jsonb_build_object(cache_key,to_char(boundary_at at time zone 'UTC',fmt));
        end if;
      end loop;
      a:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.from_date)::text)::timestamptz;
      b:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.through_date+1)::text)::timestamptz;
      if a>=plan_end or b<=plan_begin then continue;end if;
      select * into calendar_op from public.merchant_attendance_calendar_operations x where x.merchant_id=site and x.entry_id=calendar_row.entry_id order by x.revision desc limit 1;
      calendar_items:=calendar_items||jsonb_build_array(jsonb_build_object('entryId',calendar_row.entry_id,'operationId',calendar_op.operation_id,
        'revision',summary->'revision','status',summary->'status','locationId',calendar_row.location_id,'kind',calendar_row.kind,'timeZone',calendar_row.time_zone,
        'fromDate',summary->'fromDate','throughDate',summary->'throughDate','fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),
        'recordedAt',to_char(calendar_op.recorded_at at time zone 'UTC',fmt)));
    end loop;
  end if;

  -- Missing declarations are independent request intervals, including pending
  -- revisions moved in. Do NOT only query the approved-current view. Each request
  -- has at most2 immutable entries. Bounded root membership proves supersession.
  ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=plan_begin-interval '24 hours' and x.start_at<plan_end order by x.start_at,x.end_at limit 101);
  missing_limited:=cardinality(ids)>100;
  if not missing_limited then
    for missing_row in select x.* from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
      if missing_row.end_at<=plan_begin then continue;end if;
      if missing_row.employee_id<>employee or missing_row.actor_auth_user_id<>member_auth then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      select * into missing_first from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id and x.revision=1;
      select * into missing_op from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id order by x.revision desc limit 1;
      if missing_first.operation_id is distinct from missing_row.request_id or missing_first.action is distinct from 'submit'
        or missing_first.actor_auth_user_id is distinct from member_auth or missing_first.recorded_at is distinct from missing_row.submitted_at
        or missing_first.command->'proposal' is distinct from missing_row.proposal
        or missing_op.revision not between 1 and 2 or missing_op.recorded_at<missing_first.recorded_at
        or missing_op.command->>'operationId' is distinct from missing_op.operation_id::text then raise exception 'attendance_plan_exception_invalid';end if;
      root_ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site
        and coalesce(x.root_request_id,x.request_id)=coalesce(missing_row.root_request_id,missing_row.request_id) limit 101);
      if cardinality(root_ids)>100 then missing_limited:=true;exit;end if;
      status_name:=case missing_op.action when 'submit' then 'submitted' when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' end;
      if status_name is null then raise exception 'attendance_plan_exception_invalid';end if;
      missing_items:=missing_items||jsonb_build_array(jsonb_build_object('requestId',missing_row.request_id,'operationId',missing_op.operation_id,
        'revision',missing_op.revision,'status',status_name,'startAt',to_char(missing_row.start_at at time zone 'UTC',fmt),'endAt',to_char(missing_row.end_at at time zone 'UTC',fmt),
        'recordedAt',to_char(missing_op.recorded_at at time zone 'UTC',fmt),'supersedesRequestId',missing_row.supersedes_request_id,
        'rootRequestId',coalesce(missing_row.root_request_id,missing_row.request_id),
        'isCurrentApproved',status_name='approved' and not exists(select 1 from public.merchant_attendance_missing_requests x
          join public.merchant_attendance_missing_entries terminal on terminal.merchant_id=x.merchant_id and terminal.request_id=x.request_id and terminal.revision=2 and terminal.action='approve'
          where x.merchant_id=site and x.request_id=any(root_ids) and x.supersedes_request_id=missing_row.request_id)));
    end loop;
  end if;
  if missing_limited then missing_items:='[]';end if;

  -- Pending proposals have no proposal-time index. Use existing worker submit
  -- indexes and101 BEFORE filtering status/overlap. Large history is explicitly
  -- unknown, not silently "no pending correction". Revision ordering exactly
  -- follows116's worker/identity/history index (no unbounded expression sort).
  ids:=array(select x.request_id from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.worker_id=wid and x.action='submit'
    order by x.recorded_at desc,x.request_id desc limit 101);
  other_ids:=array(select x.request_id from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.worker_id=wid and x.action='submit'
    order by x.employee_id,x.actor_auth_user_id,x.recorded_at desc,x.request_id desc limit 101);
  pending_limited:=cardinality(ids)>100 or cardinality(other_ids)>100;
  if not pending_limited then
    for correction_row in select x.* from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=any(ids) and x.action='submit' order by x.request_id loop
      select * into correction_tail from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=correction_row.request_id order by x.revision desc limit 1;
      select * into decision from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.request_id=correction_row.request_id;
      if correction_tail.action<>'submit' or decision.operation_id is not null then continue;end if;
      a:=(correction_row.proposal->>'startAt')::timestamptz;b:=(correction_row.proposal->>'endAt')::timestamptz;
      if not(correction_row.start_event_id=any(associated_ids)) and (a>=plan_end or b<=plan_begin) then continue;end if;
      if correction_row.employee_id<>employee or correction_row.actor_auth_user_id<>member_auth then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      if public.faolla_attendance_correction_proposal_v1(correction_row.proposal,correction_row.recorded_at) is distinct from correction_row.proposal
        or correction_tail.operation_id is distinct from correction_row.operation_id then raise exception 'attendance_plan_exception_invalid';end if;
      pending_items:=pending_items||jsonb_build_array(jsonb_build_object('kind','correction','requestId',correction_row.request_id,'operationId',correction_row.operation_id,
        'revision',correction_row.revision,'startEventId',correction_row.start_event_id,'startAt',correction_row.proposal->'startAt','endAt',correction_row.proposal->'endAt',
        'recordedAt',to_char(correction_row.recorded_at at time zone 'UTC',fmt)));
    end loop;
    for revision_row in select x.* from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=any(other_ids) and x.action='submit' order by x.request_id loop
      select * into revision_tail from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=revision_row.request_id order by x.revision desc limit 1;
      select * into revision_decision from public.merchant_attendance_revision_decisions x where x.merchant_id=site and x.request_id=revision_row.request_id;
      if revision_tail.action<>'submit' or revision_decision.operation_id is not null then continue;end if;
      select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.request_id=revision_row.base_request_id;
      a:=(revision_row.command->'proposal'->>'startAt')::timestamptz;b:=(revision_row.command->'proposal'->>'endAt')::timestamptz;
      if not(root_effect.start_event_id=any(associated_ids)) and (a>=plan_end or b<=plan_begin) then continue;end if;
      if revision_row.employee_id<>employee or revision_row.actor_auth_user_id<>member_auth then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
      if root_effect.worker_id is distinct from wid or root_effect.start_event_id is null
        or public.faolla_attendance_correction_proposal_v1(revision_row.command->'proposal',revision_row.recorded_at) is distinct from revision_row.command->'proposal'
        or revision_tail.operation_id is distinct from revision_row.operation_id then raise exception 'attendance_plan_exception_invalid';end if;
      pending_items:=pending_items||jsonb_build_array(jsonb_build_object('kind','revision','requestId',revision_row.request_id,'operationId',revision_row.operation_id,
        'revision',revision_row.revision,'startEventId',root_effect.start_event_id,'startAt',revision_row.command->'proposal'->'startAt','endAt',revision_row.command->'proposal'->'endAt',
        'recordedAt',to_char(revision_row.recorded_at at time zone 'UTC',fmt)));
    end loop;
    if jsonb_array_length(pending_items)>100 then pending_limited:=true;end if;
  end if;
  if pending_limited then pending_items:='[]';end if;

  read_at:=clock_timestamp();
  if read_at<(coverage->>'readCompletedAt')::timestamptz then raise exception 'attendance_plan_exception_invalid';end if;
  phase:=case when read_at<plan_begin then 'future' when read_at<plan_end then 'ongoing' else 'ended' end;
  if phase<>'ended' then flags:=array_append(flags,'plan_not_ended');end if;
  if extra_limited or leave_limited or calendar_limited or missing_limited or pending_limited then flags:=array_append(flags,'context_unknown');end if;
  if jsonb_array_length(extra_items)>0 then flags:=array_append(flags,'unassociated_session');end if;
  if exists(select 1 from jsonb_array_elements(leave_items) x where x.value->>'status'='submitted') then flags:=array_append(flags,'leave_pending');end if;
  if exists(select 1 from jsonb_array_elements(leave_items) x where x.value->>'status'='approved') then flags:=array_append(flags,'leave_approved');end if;
  if exists(select 1 from jsonb_array_elements(calendar_items) x where x.value->>'status'='created') then flags:=array_append(flags,'calendar_entry');end if;
  if exists(select 1 from jsonb_array_elements(missing_items) x where x.value->>'status'='submitted' or (x.value->>'isCurrentApproved')::boolean) then flags:=array_append(flags,'missing_request');end if;
  if jsonb_array_length(pending_items)>0 then flags:=array_append(flags,'pending_correction');end if;
  -- The fixed order is also the browser/shared-contract enum order.
  select coalesce(jsonb_agg(x.value order by x.ordinality),'[]'::jsonb) into blockers
    from unnest(array['plan_not_ended','slot_cancelled','publication_missing','worker_inactive','no_associated_sessions','association_unverified',
      'adoption_missing','adoption_unverified','approval_mismatch','session_open','session_zero_duration','session_outside_plan','session_overlap',
      'session_location_mismatch','context_unknown','unassociated_session','leave_pending','leave_approved','calendar_entry','missing_request','pending_correction'])
      with ordinality x(value,ordinality) where x.value=any(flags);
  source:=jsonb_build_object('protocol','plan-exception-evidence-v1','policy','owner-confirmed-plan-edges-v1','siteId',site,'worker',worker,'slot',slot,'phase',phase,
    'approval',approval,'sessions',sessions,'context',jsonb_build_object(
      'unassociated',jsonb_build_object('limited',extra_limited,'items',extra_items),'leave',jsonb_build_object('limited',leave_limited,'items',leave_items),
      'calendar',jsonb_build_object('limited',calendar_limited,'items',calendar_items),'missing',jsonb_build_object('limited',missing_limited,'items',missing_items),
      'pendingCorrections',jsonb_build_object('limited',pending_limited,'items',pending_items)));
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  candidate:=jsonb_build_object('original',jsonb_build_object('startAt',to_char(original_start at time zone 'UTC',fmt),'endAt',to_char(original_end at time zone 'UTC',fmt)),
    'selected',jsonb_build_object('startAt',to_char(selected_start at time zone 'UTC',fmt),'endAt',to_char(selected_end at time zone 'UTC',fmt)));
  foreach key in array array['late','early'] loop
    field:=approval->'source'->'fields'->(case key when 'late' then 'lateGraceMinutes' else 'earlyGraceMinutes' end);
    if jsonb_array_length(blockers)>0 then field_result:=jsonb_build_object('state','blocked','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field is null or field->>'state'='unconfigured' then field_result:=jsonb_build_object('state','unconfigured','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field->>'state'='disabled' then field_result:=jsonb_build_object('state','disabled','minutes',null,'rawDeltaUs',null,'excessUs',null);
    elsif field->>'state'='value' then
      grace:=(field->>'minutes')::integer;
      raw_delta:=case key when 'late' then extract(epoch from selected_start-plan_begin)*1000000 else extract(epoch from plan_end-selected_end)*1000000 end;
      excess:=greatest(0,raw_delta-grace::numeric*60000000);
      field_result:=jsonb_build_object('state',case when raw_delta>grace::numeric*60000000 then 'triggered' else 'not_triggered' end,
        'minutes',grace,'rawDeltaUs',raw_delta::bigint::text,'excessUs',excess::bigint::text);
    else raise exception 'attendance_plan_exception_invalid';end if;
    candidate:=candidate||jsonb_build_object(key,field_result);
  end loop;
  result:=jsonb_build_object('protocol','plan-exception-source-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker,'slot',slot,
    'readAt',to_char(read_at at time zone 'UTC',fmt),'source',source,'sourceText',source_text,
    'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'),'eligible',jsonb_array_length(blockers)=0,'blockers',blockers,'candidate',candidate);
  return result;
end;
$$;

--PRIVATE MIRROR exception: 202610060159_merchant_attendance_work_arrangement_exceptions.sql / faolla_attendance_plan_exception_source_v1
create or replace function public.faolla_attendance_pd_exception_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare result jsonb;arrangements jsonb;ordered_items jsonb;evidence jsonb;source_text text;blockers jsonb;candidate jsonb;field jsonb;
begin
  result:=public.faolla_attendance_pd_exception_legacy_v1(p_query,p_auth_user_id);
  arrangements:=public.faolla_attendance_work_arrangement_context_v1(result->>'siteId',
    (result->'worker'->>'workerId')::uuid,(result->'worker'->>'employeeId')::uuid,(result->'worker'->>'employeeAuthUserId')::uuid,
    (result->'slot'->>'startAt')::timestamptz,(result->'slot'->>'endAt')::timestamptz);
  if arrangements='[]'::jsonb then return result;end if;
  select jsonb_agg(x order by x->>'requestId') into ordered_items from jsonb_array_elements(arrangements) x;
  evidence:=jsonb_set(result->'source','{context,workArrangements}',jsonb_build_object('limited',false,'items',ordered_items))
    ||jsonb_build_object('protocol','plan-exception-evidence-v2','policy','owner-confirmed-plan-edges-work-v2');
  blockers:=result->'blockers';candidate:=result->'candidate';
  if exists(select 1 from jsonb_array_elements(arrangements) x where x->>'status'='submitted') then blockers:=blockers||'["work_arrangement_pending"]'::jsonb;end if;
  -- Approved arrangements stay in the evidence. They do not waive an edge or
  -- permanently block an explicit owner decision; pending requests must first
  -- be resolved. Actual edge math remains the legacy calculation.
  if blockers<>'[]'::jsonb then
    field:=jsonb_build_object('state','blocked','minutes',null,'rawDeltaUs',null,'excessUs',null);
    candidate:=candidate||jsonb_build_object('late',field,'early',field);
  end if;
  source_text:=evidence::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_exception_too_large';end if;
  return result||jsonb_build_object('protocol','plan-exception-source-v2','source',evidence,'sourceText',source_text,
    'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'),'eligible',blockers='[]'::jsonb,'blockers',blockers,'candidate',candidate);
end;
$$;

--PRIVATE MIRROR posthoc_preview: 202610060171_merchant_attendance_plan_posthoc_adoption.sql / faolla_attendance_plan_posthoc_preview_v1
create or replace function public.faolla_attendance_pd_posthoc_preview_v1(p_query jsonb,p_auth_user_id uuid,p_revision integer,p_current uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare raw jsonb;basis jsonb;arrangements jsonb;source jsonb;source_text text;slot jsonb;worker jsonb;
  c public.merchant_attendance_plan_exception_cases%rowtype;case_revision bigint:=0;
  fixed jsonb;approval jsonb;approval_id uuid;site text:=p_query->>'siteId';wid uuid:=(p_query->>'workerId')::uuid;sid uuid:=(p_query->>'slotId')::uuid;
  employee uuid;member_auth uuid;plan_begin timestamptz;plan_end timestamptz;observed timestamptz;
  part jsonb;compact jsonb;proof jsonb;events jsonb;first_event jsonb;last_event jsonb;effect jsonb;ref jsonb;original jsonb;selected jsonb;
  item jsonb;candidates jsonb:='[]';flags text[]:=array[]::text[];cf text[];blocks jsonb;cb jsonb;key text;kind_name text;ref_source_id uuid;
  location_id uuid;zone_name text;relation_id uuid;claim jsonb;claim_row public.merchant_attendance_plan_posthoc_claims%rowtype;
  claim_op public.merchant_attendance_plan_posthoc_operations%rowtype;missing_row public.merchant_attendance_missing_requests%rowtype;
  unproven boolean;a timestamptz;b timestamptz;failure text;count_sources integer:=0;event_count integer:=0;pending_ref record;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  raw:=public.faolla_attendance_pd_exception_legacy_v1(p_query,p_auth_user_id);
  basis:=raw->'source';slot:=raw->'slot';worker:=raw->'worker';observed:=(raw->>'readAt')::timestamptz;
  employee:=(worker->>'employeeId')::uuid;member_auth:=(worker->>'employeeAuthUserId')::uuid;
  plan_begin:=(slot->>'startAt')::timestamptz;plan_end:=(slot->>'endAt')::timestamptz;
  arrangements:=public.faolla_attendance_work_arrangement_context_v1(site,wid,employee,member_auth,plan_begin,plan_end);
  if arrangements<>'[]'::jsonb then
    select jsonb_agg(x order by x->>'requestId') into arrangements from jsonb_array_elements(arrangements) x;
    basis:=jsonb_set(basis,'{context,workArrangements}',jsonb_build_object('limited',false,'items',arrangements))
      ||jsonb_build_object('protocol','plan-exception-evidence-v2','policy','owner-confirmed-plan-edges-work-v2');
  end if;
  select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid;
  if c.case_id is null then flags:=array_append(flags,'case_missing');
  else
    if row(c.worker_id,c.employee_id,c.employee_auth_user_id) is distinct from row(wid,employee,member_auth) then raise exception 'attendance_worker_changed';end if;
    select revision into case_revision from public.merchant_attendance_plan_exception_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
    if case_revision is null then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  end if;
  if basis->>'phase'<>'ended' then flags:=array_append(flags,'plan_not_ended');end if;
  if (slot->>'cancelled')::boolean then flags:=array_append(flags,'slot_cancelled');end if;
  if not(slot->>'hasPublicationEvidence')::boolean then flags:=array_append(flags,'publication_missing');end if;
  if not(worker->>'active')::boolean or not(worker->>'employeeActive')::boolean then flags:=array_append(flags,'worker_inactive');end if;
  for key,part in select * from jsonb_each(basis->'context') loop
    if (part->>'limited')::boolean then flags:=array_append(flags,'context_unknown');end if;
    if key='pendingCorrections' and part->'items'<>'[]'::jsonb then flags:=array_append(flags,'pending_correction');end if;
    if key in('leave','missing','workArrangements') and exists(select 1 from jsonb_array_elements(part->'items') x where x->>'status'='submitted') then
      flags:=array_append(flags,case key when 'leave' then 'pending_leave' when 'missing' then 'pending_missing' else 'pending_work_arrangement' end);end if;
    if key='calendar' and exists(select 1 from jsonb_array_elements(part->'items') x where x->>'status'='created') then flags:=array_append(flags,'calendar_entry');end if;
  end loop;
  begin
    perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(jsonb_build_object(
      'startAt',to_char(plan_begin at time zone 'UTC',fmt),'endAt',to_char(plan_end at time zone 'UTC',fmt))));
  exception when raise_exception then get stacked diagnostics failure=message_text;
    if failure='attendance_period_sealed' then flags:=array_append(flags,'sealed');else raise;end if;
  end;
  select operation_id into approval_id from public.merchant_attendance_plan_rule_operations where merchant_id=site and slot_id=sid order by revision desc limit 1;
  if approval_id is not null then
    fixed:=public.faolla_attendance_period_plan_rule_v1(site,wid,sid,employee,member_auth,approval_id);
    approval:=jsonb_build_object('operationId',fixed->'operationId','revision',fixed->'revision','sourceId',fixed->'sourceId',
      'sourceSha256',fixed->'sourceSha256','recordedAt',fixed->'recordedAt');
  end if;
  --Full related set, not a browser display window. The inherited basis remains
  --conservative when its own older bounded reader marks context incomplete.
  for kind_name,compact in
    select 'session',x from jsonb_array_elements((basis->'sessions')||(basis->'context'->'unassociated'->'items')) x
    union all select 'missing',x from jsonb_array_elements(basis->'context'->'missing'->'items') x where x->>'status'='approved'
  loop
    cf:=array[]::text[];claim:=null;relation_id:=null;unproven:=false;
    if kind_name='session' then
      ref_source_id:=(compact->>'startEventId')::uuid;
      begin
        proof:=public.faolla_attendance_period_session_v1(site,wid,ref_source_id,employee,member_auth,observed);
      exception when raise_exception then get stacked diagnostics failure=message_text;
        if failure='attendance_period_source_identity_unproven' then unproven:=true;proof:=null;
          cf:=array_append(cf,'identity_unproven');flags:=array_append(flags,'context_unknown');else raise;end if;
      end;
      original:=compact->'original';selected:=compact->'selected';
      ref:=jsonb_build_object('kind','session','startEventId',ref_source_id,'lastEventId',compact->'lastEventId','lastSequence',compact->'lastSequence',
        'effectOperationId',compact->'effect'->'operationId','effectRevision',compact->'effect'->'revision');
      if not unproven then
        events:=proof->'item'->'events';first_event:=events->0;last_event:=events->-1;effect:=nullif(proof->'item'->'effect','null'::jsonb);
        event_count:=event_count+jsonb_array_length(events);if event_count>2002 then raise exception 'attendance_plan_posthoc_adoption_too_large';end if;
        if ref is distinct from jsonb_build_object('kind','session','startEventId',ref_source_id,'lastEventId',last_event->'id','lastSequence',last_event->'sequence',
          'effectOperationId',effect->'operationId','effectRevision',effect->'revision')
          or original is distinct from jsonb_build_object('startAt',first_event->'occurredAt','endAt',case when last_event->>'action'='clock_out' then last_event->'occurredAt' else 'null'::jsonb end)
          or selected is distinct from (case when effect is null then original else jsonb_build_object('startAt',effect->'proposal'->'startAt','endAt',effect->'proposal'->'endAt') end) then
          raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
        location_id:=(first_event->>'locationId')::uuid;zone_name:=first_event->>'timeZone';
        if exists(select 1 from jsonb_array_elements(events) ev where ev->>'locationId' is distinct from slot->>'locationId') then cf:=array_append(cf,'location_mismatch');end if;
        relation_id:=(proof->'relation'->'selection'->>'slotId')::uuid;
      else
        select e.location_id,e.time_zone into location_id,zone_name from public.merchant_attendance_events e where e.merchant_id=site and e.id=ref_source_id;
        relation_id:=coalesce((compact->>'relationSlotId')::uuid,(compact->'relation'->'selection'->>'slotId')::uuid);
      end if;
      if relation_id is not null then cf:=array_append(cf,case when relation_id=sid then 'already_associated' else 'associated_elsewhere' end);end if;
      if exists(select 1 from jsonb_array_elements(basis->'context'->'pendingCorrections'->'items') x where x->>'startEventId'=ref_source_id::text) then cf:=array_append(cf,'pending_correction');end if;
      --A pending proposal may move OUTSIDE the plan. Point-check the actual
      --root stream too; the old159 contextual range alone cannot prove absence.
      for pending_ref in
        select ce.employee_id,ce.actor_auth_user_id from public.merchant_attendance_correction_entries ce
          where ce.merchant_id=site and ce.worker_id=wid and ce.start_event_id=ref_source_id and ce.action='submit'
            and not exists(select 1 from public.merchant_attendance_correction_entries tail where tail.merchant_id=site and tail.request_id=ce.request_id and tail.revision>ce.revision)
            and not exists(select 1 from public.merchant_attendance_correction_decisions decision where decision.merchant_id=site and decision.request_id=ce.request_id)
        union all
        select rr.employee_id,rr.actor_auth_user_id from public.merchant_attendance_revision_requests rr
          join public.merchant_attendance_correction_effects base on base.merchant_id=rr.merchant_id and base.request_id=rr.base_request_id
          where rr.merchant_id=site and base.worker_id=wid and base.start_event_id=ref_source_id and rr.action='submit'
            and not exists(select 1 from public.merchant_attendance_revision_requests tail where tail.merchant_id=site and tail.request_id=rr.request_id and tail.revision>rr.revision)
            and not exists(select 1 from public.merchant_attendance_revision_decisions decision where decision.merchant_id=site and decision.request_id=rr.request_id)
        limit 101
      loop
        if row(pending_ref.employee_id,pending_ref.actor_auth_user_id) is distinct from row(employee,member_auth) then raise exception 'attendance_worker_changed';end if;
        cf:=array_append(cf,'pending_correction');flags:=array_append(flags,'pending_correction');
      end loop;
    else
      proof:=public.faolla_attendance_plan_posthoc_missing_v1(site,wid,employee,member_auth,(compact->>'requestId')::uuid);
      if proof->'current' is distinct from compact->'isCurrentApproved' then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
      --Historical parents are not candidates, but their outgoing approved edge
      --is still checked (a corrupt outside child must not disappear from proof).
      if not(proof->>'current')::boolean then continue;end if;
      ref:=proof->'reference';ref_source_id:=(ref->>'rootRequestId')::uuid;
      select * into missing_row from public.merchant_attendance_missing_requests where merchant_id=site and request_id=(ref->>'requestId')::uuid;
      original:=null;selected:=jsonb_build_object('startAt',compact->'startAt','endAt',compact->'endAt');
      if ref->>'approvalOperationId' is distinct from compact->>'operationId' then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
      location_id:=missing_row.location_id;zone_name:=missing_row.time_zone;
      if (proof->>'pending')::boolean then cf:=array_append(cf,'pending_missing');flags:=array_append(flags,'pending_missing');end if;
    end if;
    a:=(selected->>'startAt')::timestamptz;b:=(selected->>'endAt')::timestamptz;
    if b is null then cf:=array_append(cf,'source_open');elsif b=a then cf:=array_append(cf,'source_zero_duration');
    elsif a>=plan_end or b<=plan_begin then cf:=array_append(cf,'source_outside_plan');end if;
    if location_id::text is distinct from slot->>'locationId' then cf:=array_append(cf,'location_mismatch');end if;
    if approval is null then cf:=array_append(cf,'approval_missing');end if;
    select * into claim_row from public.merchant_attendance_plan_posthoc_claims where merchant_id=site and kind=kind_name and merchant_attendance_plan_posthoc_claims.source_id=ref_source_id;
    if claim_row.operation_id is not null then
      select * into claim_op from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and operation_id=claim_row.operation_id;
      perform public.faolla_attendance_plan_posthoc_operation_v1(claim_op);
      if claim_row.worker_id<>wid or claim_op.action<>'apply' or not exists(select 1 from jsonb_array_elements(claim_op.sources) x
        where x->>'kind'=kind_name and coalesce(x->>'startEventId',x->>'rootRequestId')=ref_source_id::text) then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
      claim:=jsonb_build_object('slotId',claim_row.slot_id,'operationId',claim_row.operation_id,'revision',claim_op.revision);
      if claim_row.slot_id<>sid then cf:=array_append(cf,'claimed_elsewhere');end if;
    end if;
    if a is not null and b is not null then
      begin
        perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(selected));
        if original is not null and original->>'endAt' is not null then perform public.faolla_attendance_period_assert_open_v1(site,wid,jsonb_build_array(original));end if;
      exception when raise_exception then get stacked diagnostics failure=message_text;
        if failure='attendance_period_sealed' then cf:=array_append(cf,'sealed');else raise;end if;
      end;
    end if;
    select coalesce(jsonb_agg(x order by x),'[]'::jsonb) into cb from (select distinct unnest(cf) x) z;
    count_sources:=count_sources+1;if count_sources>100 then raise exception 'attendance_plan_posthoc_adoption_too_large';end if;
    candidates:=candidates||jsonb_build_array(jsonb_build_object('reference',ref,'original',original,'selected',selected,'locationId',location_id,
      'timeZone',zone_name,'available',cb='[]'::jsonb,'blockers',cb,'claim',claim));
  end loop;
  select coalesce(jsonb_agg(x order by x->'reference'->>'kind',coalesce(x->'reference'->>'startEventId',x->'reference'->>'rootRequestId')),'[]'::jsonb)
    into candidates from jsonb_array_elements(candidates) x;
  select coalesce(jsonb_agg(x order by x),'[]'::jsonb) into blocks from (select distinct unnest(flags) x) z;
  source:=jsonb_build_object('protocol','posthoc-adoption-preview-v1','basis',basis,'caseId',c.case_id,'caseRevision',case_revision,
    'revision',p_revision,'currentOperationId',p_current,'candidates',candidates,'approval',approval,'blockers',blocks);
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_adoption_too_large';end if;
  return jsonb_build_object('fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'),'eligible',blocks='[]'::jsonb,
    'blockers',blocks,'candidates',candidates,'approval',approval,'source',source,'sourceText',source_text);
end;
$$;

--PRIVATE MIRROR posthoc_read: 202610060171_merchant_attendance_plan_posthoc_adoption.sql / faolla_attendance_plan_posthoc_adoption_v1
create or replace function public.faolla_attendance_pd_posthoc_read_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;wid uuid;sid uuid;op uuid;mode_name text;s public.merchant_attendance_settings%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;slot_row public.merchant_attendance_schedule_slots%rowtype;
  c public.merchant_attendance_plan_exception_cases%rowtype;head public.merchant_attendance_plan_posthoc_operations%rowtype;
  saved public.merchant_attendance_plan_posthoc_operations%rowtype;entry_row public.merchant_attendance_plan_posthoc_operations%rowtype;
  slot_context jsonb;worker_item jsonb;slot_item jsonb;preview jsonb;current_item jsonb;receipt jsonb;history jsonb:='[]';result jsonb;
  refs jsonb:='[]';selected jsonb:='[]';approval jsonb;x jsonb;y jsonb;item jsonb;count_ops integer;revision_no integer:=0;
  ref_source_id uuid;stamp timestamptz;read_at timestamptz;query_source jsonb;expected_claims integer;actual_claims integer;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_query is null
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','slotId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid') is distinct from true
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;
  --Acquire writable locks first: no SHARE->UPDATE upgrade after collecting a
  --source. All old correction/missing/leave/seal writers serialize here too.
  perform 1 from public.merchants where id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if e.id is null or e.auth_user_id is null then raise exception 'attendance_worker_changed';end if;
  select * into slot_row from public.merchant_attendance_schedule_slots where merchant_id=site and id=sid;
  if slot_row.id is null then raise exception 'attendance_plan_posthoc_adoption_not_found';end if;
  if slot_row.worker_id is distinct from wid or slot_row.employee_id is distinct from e.id then raise exception 'attendance_worker_changed';end if;
  slot_context:=public.faolla_attendance_self_schedule_slot_v1(slot_row);slot_item:=slot_context->'slot';
  if slot_context->'publication'->>'employeeAuthUserId' is not null and slot_context->'publication'->>'employeeAuthUserId'<>e.auth_user_id::text then
    raise exception 'attendance_worker_changed';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',e.id,
    'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active');
  select * into c from public.merchant_attendance_plan_exception_cases where merchant_id=site and slot_id=sid;
  if c.case_id is not null and row(c.worker_id,c.employee_id,c.employee_auth_user_id) is distinct from row(wid,e.id,e.auth_user_id) then raise exception 'attendance_worker_changed';end if;
  select * into head from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid order by revision desc limit 1;
  if head.operation_id is not null then
    if row(head.worker_id,head.case_id,head.employee_id,head.employee_auth_user_id) is distinct from row(wid,c.case_id,e.id,e.auth_user_id) then raise exception 'attendance_worker_changed';end if;
    current_item:=public.faolla_attendance_plan_posthoc_operation_v1(head);revision_no:=head.revision;
  end if;
  select count(*) into count_ops from (select 1 from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid limit 101) bounded;
  if count_ops<>revision_no or count_ops>100 then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  --Validate the exclusive projection, including empty apply and revoked heads.
  expected_claims:=case when head.action='apply' then jsonb_array_length(head.sources) else 0 end;
  select count(*) into actual_claims from public.merchant_attendance_plan_posthoc_claims where merchant_id=site and slot_id=sid;
  if actual_claims<>expected_claims or exists(select 1 from public.merchant_attendance_plan_posthoc_claims z where z.merchant_id=site and z.slot_id=sid
    and (z.worker_id<>wid or z.operation_id is distinct from head.operation_id or not exists(select 1 from jsonb_array_elements(head.sources) t
      where t->>'kind'=z.kind and coalesce(t->>'startEventId',t->>'rootRequestId')=z.source_id::text))) then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  query_source:=jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid);
  preview:=public.faolla_attendance_pd_posthoc_preview_v1(query_source,p_auth_user_id,revision_no,head.operation_id);
  for entry_row in select * from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid order by revision desc limit 25 loop
    if row(entry_row.worker_id,entry_row.case_id,entry_row.employee_id,entry_row.employee_auth_user_id) is distinct from row(wid,c.case_id,e.id,e.auth_user_id) then raise exception 'attendance_worker_changed';end if;
    history:=history||jsonb_build_array(public.faolla_attendance_plan_posthoc_operation_v1(entry_row));
  end loop;
  read_at:=clock_timestamp();
  if exists(select 1 from jsonb_array_elements(history) history_rows(value) where (history_rows.value->>'recordedAt')::timestamptz>read_at) then raise exception 'attendance_plan_posthoc_adoption_invalid';end if;
  result:=jsonb_build_object('protocol','plan-posthoc-adoption-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'slot',slot_item,
    'revision',revision_no,'current',current_item,'preview',preview,'history',history,'historyTruncated',revision_no>25,'receipt',receipt,'readAt',to_char(read_at at time zone 'UTC',fmt));
  if octet_length(convert_to(result::text,'UTF8'))>2097152 then raise exception 'attendance_plan_posthoc_adoption_too_large';end if;
  return result;
end;
$$;

--PRIVATE MIRROR formal_facts: 202610060173_merchant_attendance_plan_posthoc_formal_source.sql / faolla_attendance_plan_posthoc_formal_facts_v1
create or replace function public.faolla_attendance_pd_formal_facts_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare baseline jsonb;basis jsonb;worker_item jsonb;slot_item jsonb;posthoc_item jsonb;observations jsonb:='[]';observation jsonb;snapshot jsonb;
  saved_operation public.merchant_attendance_plan_posthoc_operations%rowtype;full_approval jsonb;approval_item jsonb;compact_approval jsonb;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_head public.merchant_attendance_leave_entries%rowtype;leave_summary jsonb;
  leave_ids uuid[];leave_items jsonb:='[]';leave_context jsonb;leave_limited boolean;flags text[]:=array[]::text[];resolution_blockers jsonb;
  source jsonb;source_text text;site text:=p_query->>'siteId';wid uuid:=(p_query->>'workerId')::uuid;sid uuid:=(p_query->>'slotId')::uuid;
  employee uuid;member_auth uuid;plan_begin timestamptz;plan_end timestamptz;observed timestamptz;read_at timestamptz;part jsonb;
  current_candidate jsonb;candidate_blockers jsonb;observation_blockers jsonb;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  baseline:=public.faolla_attendance_pd_posthoc_read_v1(p_query,p_auth_user_id);
  if baseline->>'actorId' is distinct from p_auth_user_id::text or baseline->>'siteId' is distinct from site or baseline->'current'='null'::jsonb then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  basis:=baseline->'preview'->'source'->'basis';worker_item:=baseline->'worker';slot_item:=baseline->'slot';
  employee:=(worker_item->>'employeeId')::uuid;member_auth:=(worker_item->>'employeeAuthUserId')::uuid;
  plan_begin:=(slot_item->>'startAt')::timestamptz;plan_end:=(slot_item->>'endAt')::timestamptz;observed:=(baseline->>'readAt')::timestamptz;
  select * into saved_operation from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and operation_id=(baseline->'current'->>'operationId')::uuid;
  if public.faolla_attendance_plan_posthoc_operation_v1(saved_operation) is distinct from baseline->'current'
    or row(saved_operation.worker_id,saved_operation.slot_id,saved_operation.employee_id,saved_operation.employee_auth_user_id)
      is distinct from row(wid,sid,employee,member_auth) then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  posthoc_item:=jsonb_build_object('revision',baseline->'revision','current',baseline->'current',
    'selected',coalesce(saved_operation.selected,'[]'::jsonb),'approval',saved_operation.approval);
  compact_approval:=saved_operation.approval;
  if compact_approval is not null then
    full_approval:=public.faolla_attendance_period_plan_rule_v1(site,wid,sid,employee,member_auth,(compact_approval->>'operationId')::uuid);
    approval_item:=jsonb_build_object('operationId',full_approval->'operationId','revision',full_approval->'revision','sourceId',full_approval->'sourceId',
      'sourceSha256',full_approval->'sourceSha256','recordedAt',full_approval->'recordedAt','source',full_approval->'source');
    if (approval_item-'source') is distinct from compact_approval then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  else approval_item:=nullif(basis->'approval','null'::jsonb);end if;
  if saved_operation.action is distinct from 'apply' then flags:=array_append(flags,'posthoc_inactive');
  else
    if jsonb_array_length(saved_operation.selected)>10 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
    for snapshot in select snapshot_rows.value from jsonb_array_elements(saved_operation.selected) snapshot_rows(value) loop
      observation:=public.faolla_attendance_plan_posthoc_observation_v1(site,wid,employee,member_auth,slot_item,saved_operation.operation_id,approval_item,snapshot,observed);
      current_candidate:=nullif(observation->'current','null'::jsonb);
      if current_candidate is not null then
        candidate_blockers:=(current_candidate->'blockers')-'sealed';
        current_candidate:=current_candidate||jsonb_build_object('blockers',candidate_blockers,'available',candidate_blockers='[]'::jsonb);
        observation_blockers:=(observation->'blockers')-'source_unavailable';
        if candidate_blockers<>'[]'::jsonb then observation_blockers:=observation_blockers||'"source_unavailable"'::jsonb;end if;
        observation:=observation||jsonb_build_object('current',current_candidate,'blockers',observation_blockers);
      end if;
      observations:=observations||jsonb_build_array(observation);
      if observation->'blockers' ? 'source_changed' then flags:=array_append(flags,'source_changed');end if;
      if observation->'blockers' ? 'source_unavailable' then flags:=array_append(flags,'source_unavailable');end if;
    end loop;
  end if;
  leave_ids:=array(select requests.request_id from public.merchant_attendance_leave_requests requests
    where requests.merchant_id=site and requests.worker_id=wid and requests.start_at<plan_end and requests.end_at>plan_begin
    order by requests.start_at,requests.end_at,requests.request_id limit 101);
  leave_limited:=cardinality(leave_ids)>100 or (basis->'context'->'leave'->>'limited')::boolean;
  if not leave_limited then
    for leave_row in select requests.* from public.merchant_attendance_leave_requests requests where requests.merchant_id=site and requests.request_id=any(leave_ids) order by requests.request_id loop
      if row(leave_row.worker_id,leave_row.employee_id,leave_row.actor_auth_user_id) is distinct from row(wid,employee,member_auth) then raise exception 'attendance_worker_changed';end if;
      leave_summary:=public.faolla_attendance_leave_summary_v1(leave_row,null);
      select * into leave_head from public.merchant_attendance_leave_entries entries where entries.merchant_id=site and entries.request_id=leave_row.request_id order by entries.revision desc limit 1;
      if leave_head.operation_id is null or leave_summary->'revision' is distinct from to_jsonb(leave_head.revision) then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
      leave_items:=leave_items||jsonb_build_array(jsonb_build_object('requestId',leave_row.request_id,'operationId',leave_head.operation_id,
        'revision',leave_head.revision,'status',leave_summary->'status','startAt',to_char(leave_row.start_at at time zone 'UTC',fmt),
        'endAt',to_char(leave_row.end_at at time zone 'UTC',fmt),'recordedAt',to_char(leave_head.recorded_at at time zone 'UTC',fmt),'current',true));
    end loop;
  end if;
  leave_context:=jsonb_build_object('limited',leave_limited,'resolved',not leave_limited,'items',leave_items);
  if leave_limited or baseline->'preview'->'blockers' ? 'context_unknown' then flags:=array_append(flags,'context_unknown');end if;
  if exists(select 1 from jsonb_array_elements(baseline->'preview'->'candidates') candidate_rows(value)
    where candidate_rows.value->'reference'->>'kind'='session' and candidate_rows.value->'blockers' ? 'location_mismatch'
      and exists(select 1 from jsonb_array_elements(basis->'sessions') session_rows(value)
        where session_rows.value->>'startEventId'=candidate_rows.value->'reference'->>'startEventId')) then
    flags:=array_append(flags,'source_unavailable');end if;
  if baseline->'preview'->'blockers' ?| array['pending_correction','pending_missing'] then flags:=array_append(flags,'source_unavailable');end if;
  for part in select sections.value from jsonb_each(basis->'context') sections(key,value) loop
    if part->>'limited'='true' then flags:=array_append(flags,'context_unknown');end if;
  end loop;
  select coalesce(jsonb_agg(flag_rows.flag order by flag_rows.flag),'[]'::jsonb) into resolution_blockers from (select distinct unnest(flags) as flag) flag_rows;
  source:=jsonb_build_object('protocol','posthoc-evaluation-evidence-v1','basis',basis,'posthoc',posthoc_item,'observations',observations,
    'approval',approval_item,'leave',leave_context,'resolutionBlockers',resolution_blockers);
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_plan_posthoc_formal_invalid';end if;
  return jsonb_build_object('protocol','plan-posthoc-evaluation-v1','siteId',site,'actorId',p_auth_user_id,'worker',worker_item,'slot',slot_item,
    'readAt',to_char(read_at at time zone 'UTC',fmt),'source',source,'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
end;
$$;

--PRIVATE MIRROR formal_source: 202610060173_merchant_attendance_plan_posthoc_formal_source.sql / faolla_attendance_plan_posthoc_formal_source_v1
create or replace function public.faolla_attendance_pd_formal_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;wid uuid;sid uuid;s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_enterprise_employees%rowtype;facts jsonb;derived jsonb;source jsonb;source_text text;result jsonb;
begin
  if p_auth_user_id is null or octet_length(convert_to(p_query::text,'UTF8'))>4096
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','slotId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'slotId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;sid:=(p_query->>'slotId')::uuid;
  --Acquire writable lock levels FIRST, never after old review/case locks.
  --No writer is called. These locks serialize source changes until return/commit.
  perform 1 from public.merchants where id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if e.id is null or e.auth_user_id is null then raise exception 'attendance_worker_changed';end if;
  --Absence is tested under the same settings lock used by171 apply/revoke. A
  --plan without a case or adoption is NOT required to pass171 prerequisites.
  --Call159's current public source, preserving its exact old v1/v2 canonical.
  if not exists(select 1 from public.merchant_attendance_plan_posthoc_operations where merchant_id=site and slot_id=sid) then
    return public.faolla_attendance_pd_exception_v1(p_query,p_auth_user_id);
  end if;
  facts:=public.faolla_attendance_pd_formal_facts_v1(p_query,p_auth_user_id);
  derived:=public.faolla_attendance_plan_posthoc_formal_compute_v1(facts);
  source:=jsonb_build_object('protocol','plan-exception-evidence-v3','policy','owner-confirmed-plan-edges-posthoc-v3','evaluation',facts->'source');
  source_text:=source::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  result:=jsonb_build_object('protocol','plan-exception-source-v3','siteId',site,'actorId',p_auth_user_id,'worker',facts->'worker','slot',facts->'slot',
    'readAt',facts->'readAt','source',source,'sourceText',source_text,'fingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'))||derived;
  if octet_length(convert_to(result::text,'UTF8'))>2097152 then raise exception 'attendance_plan_posthoc_formal_too_large';end if;
  return result;
end;
$$;

--PRIVATE MIRROR report: 202610050153_merchant_attendance_period_session_capacity.sql / faolla_attendance_period_report_v2
create or replace function public.faolla_attendance_pd_report_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  first_day date;last_day date;from_at timestamptz;to_at timestamptz;now_at timestamptz;end_sequence bigint;
  events jsonb;effect_json jsonb;items jsonb:='[]';result jsonb;candidate_count integer:=0;event_count integer:=0;
  worker uuid;raw_relevant boolean;effect_relevant boolean;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['workerId','fromDate','throughDate'])
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or coalesce(p_query->>'fromDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_query->>'throughDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    then raise exception 'attendance_invalid_request';end if;
  worker:=(p_query->>'workerId')::uuid;first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or first_day>last_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  -- Same ordering as writes. These SHARE locks prevent a moving snapshot, new
  -- effects, owner transfer or a concurrent punch until all candidates are read.
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and id=worker for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  now_at:=clock_timestamp();from_at:=public.faolla_attendance_control_day_boundary_v1(first_day,s.time_zone);
  to_at:=public.faolla_attendance_control_day_boundary_v1(last_day+1,s.time_zone);
  if (from_at at time zone s.time_zone)::date<>first_day or
    (public.faolla_attendance_control_day_boundary_v1(last_day,s.time_zone) at time zone s.time_zone)::date<>last_day
    then raise exception 'attendance_local_date_does_not_exist';end if;
  -- Each arm is independently bounded. Include one left-boundary raw segment
  -- AND effective spans that moved in from an original start outside the range.
  for e in
    with inside as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and occurred_at>=from_at and occurred_at<to_at order by occurred_at,sequence limit 101),
    preceding as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and occurred_at<from_at order by occurred_at desc,sequence desc limit 1),
    moved as (select start_event_id id from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and worker_id=worker
      and start_at>=from_at-interval '31 days' and start_at<to_at and end_at>from_at order by start_at,start_event_id limit 101),
    candidates as (select id from inside union select id from preceding union select id from moved)
    select ev.* from candidates c join public.merchant_attendance_events ev on ev.id=c.id and ev.merchant_id=p_site_id and ev.worker_id=worker
    order by ev.sequence limit 102
  loop
    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;
    select sequence into end_sequence from (select sequence,action from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence order by sequence limit 2003) endpoint
      where action='clock_out' order by sequence limit 1;
    -- Exclude the irrelevant preceding completed shift before allocating its JSON.
    raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else
      e.occurred_at>=from_at or exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence=end_sequence and occurred_at>from_at) end);
    select * into eff from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and worker_id=worker and start_event_id=e.id;
    effect_relevant:=eff.request_id is not null and eff.start_at<to_at and eff.end_at>from_at;
    if not raw_relevant and not effect_relevant then continue;end if;
    candidate_count:=candidate_count+1;if candidate_count>100 then raise exception 'attendance_report_too_large';end if;
    select jsonb_agg(jsonb_build_object('id',ev.id,'locationId',ev.location_id,'sequence',ev.sequence,'action',ev.action,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',ev.time_zone,'breakPaid',ev.break_paid,'source',ev.source) order by ev.sequence)
      into events from (select * from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence
        and (end_sequence is null or sequence<=end_sequence) order by sequence limit 2003) ev;
    event_count:=event_count+jsonb_array_length(events);
    if jsonb_array_length(events)>2002 or event_count>4000 then raise exception 'attendance_report_too_large';end if;
    effect_json:='null';
    if eff.request_id is not null then
      effect_json:=public.faolla_attendance_effect_evidence_v2(eff,now_at);
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('startEventId',e.id,'events',events,'effect',effect_json));
  end loop;
  result:=jsonb_build_object('siteId',p_site_id,'workerId',worker,'employeeId',w.employee_id,'workerName',w.display_name,'workerNo',w.worker_no,
    'fromDate',first_day,'throughDate',last_day,'fromAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'toAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',s.time_zone,
    'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceVersion','raw-and-approved-v2','complete',true,'items',items);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

--PRIVATE MIRROR unified: 202610010103_merchant_attendance_missing_revisions.sql / faolla_attendance_unified_report_v1
create or replace function public.faolla_attendance_pd_unified_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare mode text;base jsonb;result jsonb;items jsonb:='[]';worker uuid;viewer uuid;location uuid;
  from_at timestamptz;to_at timestamptz;as_of timestamptz;expires timestamptz;row_count integer;
  p public.merchant_attendance_missing_requests%rowtype;decision public.merchant_attendance_missing_entries%rowtype;
  prior_action text;
begin
  if p_query is null or jsonb_typeof(p_query)<>'object' or not(p_query ? 'access') then raise exception 'attendance_invalid_request';end if;
  mode:=p_query->>'access';
  -- Delegate original-source collection AND authorization to the unchanged exact
  -- owner/self/scoped protocol, not to an impersonated owner or JS post-filter.
  if mode is distinct from 'delegate' then raise exception 'attendance_invalid_request';end if;
  base:=public.faolla_attendance_pd_report_v1(p_site_id,p_auth_user_id,p_query-'access');
  worker:=(base->>'workerId')::uuid;viewer:=(base->>'viewerEmployeeId')::uuid;location:=(base->>'locationId')::uuid;
  from_at:=(base->>'fromAt')::timestamptz;to_at:=(base->>'toAt')::timestamptz;as_of:=(base->>'asOf')::timestamptz;expires:=(base->>'accessValidUntil')::timestamptz;
  -- Original reader retains owner/settings/role/scope/worker locks until this
  -- enclosing transaction ends. Missing decisions take the settings UPDATE lock.
  row_count:=jsonb_array_length(base->'items');
  for p in select r.* from public.merchant_attendance_missing_current_v1 r
    join public.merchant_attendance_missing_entries d on d.merchant_id=r.merchant_id and d.request_id=r.request_id and d.action='approve' and d.revision=2
    where r.merchant_id=p_site_id and r.worker_id=worker and r.start_at>=from_at-interval '24 hours' and r.start_at<to_at and r.end_at>from_at
      and (mode='delegate' or mode='self' and r.employee_id=viewer and r.actor_auth_user_id=p_auth_user_id or mode='manager' and r.location_id=location)
    order by r.start_at,r.request_id limit 101
  loop
    row_count:=row_count+1;if row_count>100 then raise exception 'attendance_report_too_large';end if;
    select * into decision from public.merchant_attendance_missing_entries d where d.merchant_id=p.merchant_id and d.request_id=p.request_id and d.revision=2;
    if p.submitted_at>as_of or decision.recorded_at>as_of or decision.action<>'approve' then raise exception 'attendance_report_invalid_data';end if;
    -- Historical approval stays valid after offboarding/location deactivation or
    -- later period locks. Only conflicting time sources block this read. Never
    -- silently drop a conflicting approved declaration or count it twice.
    select action into prior_action from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at<=p.start_at order by occurred_at desc,sequence desc limit 1;
    if (prior_action is not null and prior_action<>'clock_out') or exists(select 1 from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at>p.start_at and occurred_at<p.end_at)
      or exists(select 1 from public.merchant_attendance_effect_current_v2 where merchant_id=p.merchant_id and worker_id=p.worker_id and start_at<p.end_at and end_at>p.start_at)
      or exists(select 1 from public.merchant_attendance_missing_current_v1 other join public.merchant_attendance_missing_entries d on d.merchant_id=other.merchant_id and d.request_id=other.request_id and d.action='approve' and d.revision=2
        where other.merchant_id=p.merchant_id and other.worker_id=p.worker_id and other.request_id<>p.request_id and other.start_at<p.end_at and other.end_at>p.start_at)
      then raise exception 'attendance_report_reconciliation_required';end if;
    items:=items||jsonb_build_array(jsonb_build_object('source','missing-approved','requestId',p.request_id,'operationId',decision.operation_id,'workerId',p.worker_id,
      'employeeId',case when mode='self' then p.employee_id else null end,'workerName',p.worker_name,'locationId',p.location_id,'locationName',p.location_name,
      'timeZone',p.time_zone,'policyRevision',p.policy_revision,'proposal',p.proposal,
      'submittedAt',to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'approvedAt',to_char(decision.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end loop;
  result:=jsonb_build_object('version','attendance-unified-v1','access',mode,'base',base,'missing',items,'complete',true,'payrollReady',false);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  -- A short manager grant may expire while collecting evidence. No stale grant.
  if expires is not null and clock_timestamp()>=expires then raise exception 'attendance_access_denied';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

--PRIVATE MIRROR fixed_report: 202610050155_merchant_attendance_period_fixed_boundaries.sql / faolla_attendance_period_closure_report_v1
create or replace function public.faolla_attendance_pd_fixed_report_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_frame jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
  e public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  first_day date;last_day date;from_at timestamptz;to_at timestamptz;now_at timestamptz;end_sequence bigint;
  events jsonb;effect_json jsonb;items jsonb:='[]';result jsonb;candidate_count integer:=0;event_count integer:=0;
  worker uuid;raw_relevant boolean;effect_relevant boolean;
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['workerId','fromDate','throughDate'])
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or coalesce(p_query->>'fromDate','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_query->>'throughDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    then raise exception 'attendance_invalid_request';end if;
  worker:=(p_query->>'workerId')::uuid;first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or first_day>last_day or last_day-first_day>30 then raise exception 'attendance_invalid_request';end if;
  -- Same ordering as writes. These SHARE locks prevent a moving snapshot, new
  -- effects, owner transfer or a concurrent punch until all candidates are read.
  perform 1 from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site_id and id=worker for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  now_at:=clock_timestamp();from_at:=(p_frame->>'fromAt')::timestamptz;to_at:=(p_frame->>'toAt')::timestamptz;
  if public.faolla_attendance_shift_rule_binding_object_v1(p_frame,array['timeZone','fromAt','toAt']) is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_frame->'timeZone','zone') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_frame->'fromAt','stamp6') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_frame->'toAt','stamp6') is distinct from true
    or from_at>=to_at then raise exception 'attendance_period_closure_invalid';end if;
  -- Each arm is independently bounded. Include one left-boundary raw segment
  -- AND effective spans that moved in from an original start outside the range.
  for e in
    with inside as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and occurred_at>=from_at and occurred_at<to_at order by occurred_at,sequence limit 101),
    preceding as (select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and action='clock_in'
      and occurred_at<from_at order by occurred_at desc,sequence desc limit 1),
    moved as (select start_event_id id from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and worker_id=worker
      and start_at>=from_at-interval '31 days' and start_at<to_at and end_at>from_at order by start_at,start_event_id limit 101),
    candidates as (select id from inside union select id from preceding union select id from moved)
    select ev.* from candidates c join public.merchant_attendance_events ev on ev.id=c.id and ev.merchant_id=p_site_id and ev.worker_id=worker
    order by ev.sequence limit 102
  loop
    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;
    select sequence into end_sequence from (select sequence,action from public.merchant_attendance_events
      where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence order by sequence limit 2003) endpoint
      where action='clock_out' order by sequence limit 1;
    -- Exclude the irrelevant preceding completed shift before allocating its JSON.
    raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else
      e.occurred_at>=from_at or exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence=end_sequence and occurred_at>from_at) end);
    select * into eff from public.merchant_attendance_effect_current_v2 where merchant_id=p_site_id and worker_id=worker and start_event_id=e.id;
    effect_relevant:=eff.request_id is not null and eff.start_at<to_at and eff.end_at>from_at;
    if not raw_relevant and not effect_relevant then continue;end if;
    candidate_count:=candidate_count+1;if candidate_count>100 then raise exception 'attendance_report_too_large';end if;
    select jsonb_agg(jsonb_build_object('id',ev.id,'locationId',ev.location_id,'sequence',ev.sequence,'action',ev.action,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',ev.time_zone,'breakPaid',ev.break_paid,'source',ev.source) order by ev.sequence)
      into events from (select * from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=worker and sequence>=e.sequence
        and (end_sequence is null or sequence<=end_sequence) order by sequence limit 2003) ev;
    event_count:=event_count+jsonb_array_length(events);
    if jsonb_array_length(events)>2002 or event_count>4000 then raise exception 'attendance_report_too_large';end if;
    effect_json:='null';
    if eff.request_id is not null then
      effect_json:=public.faolla_attendance_effect_evidence_v2(eff,now_at);
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('startEventId',e.id,'events',events,'effect',effect_json));
  end loop;
  result:=jsonb_build_object('siteId',p_site_id,'workerId',worker,'employeeId',w.employee_id,'workerName',w.display_name,'workerNo',w.worker_no,
    'fromDate',first_day,'throughDate',last_day,'fromAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'toAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',p_frame->'timeZone',
    'asOf',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceVersion','raw-and-approved-v2','complete',true,'items',items);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

--PRIVATE MIRROR fixed_unified: 202610050155_merchant_attendance_period_fixed_boundaries.sql / faolla_attendance_period_closure_unified_report_v1
create or replace function public.faolla_attendance_pd_fixed_unified_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_frame jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare mode text;base jsonb;result jsonb;items jsonb:='[]';worker uuid;viewer uuid;location uuid;
  from_at timestamptz;to_at timestamptz;as_of timestamptz;expires timestamptz;row_count integer;
  p public.merchant_attendance_missing_requests%rowtype;decision public.merchant_attendance_missing_entries%rowtype;
  prior_action text;
begin
  if p_query is null or jsonb_typeof(p_query)<>'object' or not(p_query ? 'access') then raise exception 'attendance_invalid_request';end if;
  mode:=p_query->>'access';
  -- Delegate original-source collection AND authorization to the unchanged exact
  -- owner/self/scoped protocol, not to an impersonated owner or JS post-filter.
  if mode is distinct from 'delegate' then raise exception 'attendance_invalid_request';end if;
  base:=public.faolla_attendance_pd_fixed_report_v1(p_site_id,p_auth_user_id,p_query-'access',p_frame);
  worker:=(base->>'workerId')::uuid;viewer:=(base->>'viewerEmployeeId')::uuid;location:=(base->>'locationId')::uuid;
  from_at:=(base->>'fromAt')::timestamptz;to_at:=(base->>'toAt')::timestamptz;as_of:=(base->>'asOf')::timestamptz;expires:=(base->>'accessValidUntil')::timestamptz;
  -- Original reader retains owner/settings/role/scope/worker locks until this
  -- enclosing transaction ends. Missing decisions take the settings UPDATE lock.
  row_count:=jsonb_array_length(base->'items');
  for p in select r.* from public.merchant_attendance_missing_current_v1 r
    join public.merchant_attendance_missing_entries d on d.merchant_id=r.merchant_id and d.request_id=r.request_id and d.action='approve' and d.revision=2
    where r.merchant_id=p_site_id and r.worker_id=worker and r.start_at>=from_at-interval '24 hours' and r.start_at<to_at and r.end_at>from_at
      and (mode='delegate' or mode='self' and r.employee_id=viewer and r.actor_auth_user_id=p_auth_user_id or mode='manager' and r.location_id=location)
    order by r.start_at,r.request_id limit 101
  loop
    row_count:=row_count+1;if row_count>100 then raise exception 'attendance_report_too_large';end if;
    select * into decision from public.merchant_attendance_missing_entries d where d.merchant_id=p.merchant_id and d.request_id=p.request_id and d.revision=2;
    if p.submitted_at>as_of or decision.recorded_at>as_of or decision.action<>'approve' then raise exception 'attendance_report_invalid_data';end if;
    -- Historical approval stays valid after offboarding/location deactivation or
    -- later period locks. Only conflicting time sources block this read. Never
    -- silently drop a conflicting approved declaration or count it twice.
    select action into prior_action from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at<=p.start_at order by occurred_at desc,sequence desc limit 1;
    if (prior_action is not null and prior_action<>'clock_out') or exists(select 1 from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and occurred_at>p.start_at and occurred_at<p.end_at)
      or exists(select 1 from public.merchant_attendance_effect_current_v2 where merchant_id=p.merchant_id and worker_id=p.worker_id and start_at<p.end_at and end_at>p.start_at)
      or exists(select 1 from public.merchant_attendance_missing_current_v1 other join public.merchant_attendance_missing_entries d on d.merchant_id=other.merchant_id and d.request_id=other.request_id and d.action='approve' and d.revision=2
        where other.merchant_id=p.merchant_id and other.worker_id=p.worker_id and other.request_id<>p.request_id and other.start_at<p.end_at and other.end_at>p.start_at)
      then raise exception 'attendance_report_reconciliation_required';end if;
    items:=items||jsonb_build_array(jsonb_build_object('source','missing-approved','requestId',p.request_id,'operationId',decision.operation_id,'workerId',p.worker_id,
      'employeeId',case when mode='self' then p.employee_id else null end,'workerName',p.worker_name,'locationId',p.location_id,'locationName',p.location_name,
      'timeZone',p.time_zone,'policyRevision',p.policy_revision,'proposal',p.proposal,
      'submittedAt',to_char(p.submitted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'approvedAt',to_char(decision.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end loop;
  result:=jsonb_build_object('version','attendance-unified-v1','access',mode,'base',base,'missing',items,'complete',true,'payrollReady',false);
  if octet_length(result::text)>1048576 then raise exception 'attendance_report_too_large';end if;
  -- A short manager grant may expire while collecting evidence. No stale grant.
  if expires is not null and clock_timestamp()>=expires then raise exception 'attendance_access_denied';end if;
  return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;

--PRIVATE MIRROR source: 202610060175_merchant_attendance_plan_posthoc_periods.sql / faolla_attendance_period_source_v1
create or replace function public.faolla_attendance_pd_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare
  site text;wid uuid;access_name text;first_day date;last_day date;range_from timestamptz;range_to timestamptz;observed timestamptz;read_at timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
  report jsonb;base jsonb;result jsonb;canonical jsonb;source_text text;day_items jsonb:='[]';d date;a timestamptz;b timestamptz;
  item jsonb;child jsonb;summary jsonb;context jsonb;plans jsonb:='[]';sessions jsonb:='[]';reviews jsonb:='[]';leaves jsonb:='[]';calendars jsonb:='[]';missing jsonb:='[]';pending jsonb:='[]';
  flags text[]:='{}';blockers jsonb;ids uuid[];other_ids uuid[];candidate_ids uuid[];session_ids uuid[]:='{}';report_ids uuid[]:='{}';place_ids uuid[]:='{}';place uuid;target_id uuid;
  ev public.merchant_attendance_events%rowtype;endpoint public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;relation_row public.merchant_attendance_shift_schedule_relations%rowtype;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_op public.merchant_attendance_leave_entries%rowtype;
  calendar_row public.merchant_attendance_calendar_entries%rowtype;calendar_op public.merchant_attendance_calendar_operations%rowtype;
  missing_row public.merchant_attendance_missing_requests%rowtype;missing_first public.merchant_attendance_missing_entries%rowtype;missing_op public.merchant_attendance_missing_entries%rowtype;
  missing_base_ids uuid[];missing_child_ids uuid[];missing_parent public.merchant_attendance_missing_requests%rowtype;missing_root public.merchant_attendance_missing_requests%rowtype;
  missing_parent_approval public.merchant_attendance_missing_entries%rowtype;missing_proposal jsonb;
  correction_row public.merchant_attendance_correction_entries%rowtype;correction_tail public.merchant_attendance_correction_entries%rowtype;
  revision_row public.merchant_attendance_revision_requests%rowtype;revision_tail public.merchant_attendance_revision_requests%rowtype;root_effect public.merchant_attendance_correction_effects%rowtype;
  case_row public.merchant_attendance_plan_exception_cases%rowtype;review_head public.merchant_attendance_plan_exception_entries%rowtype;
  rule_stream public.merchant_attendance_plan_rule_streams%rowtype;rule_operation public.merchant_attendance_plan_rule_operations%rowtype;current_approval jsonb;
  decision_row public.merchant_attendance_plan_exception_entries%rowtype;note_row public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  current_source jsonb;status_name text;bounds jsonb:='{}';cache_key text;boundary_date date;total_events integer:=0;expected_report_count integer:=0;

  missing_approved_ids uuid[];missing_edge_ids uuid[];missing_sibling_ids uuid[];missing_is_current boolean;
  missing_successor public.merchant_attendance_missing_requests%rowtype;missing_successor_first public.merchant_attendance_missing_entries%rowtype;
  missing_successor_approval public.merchant_attendance_missing_entries%rowtype;missing_checked_approval public.merchant_attendance_missing_entries%rowtype;
  --175 posthoc declarations begin.
  posthoc_head public.merchant_attendance_plan_posthoc_operations%rowtype;posthoc_context jsonb:='[]';posthoc_snapshot jsonb;has_posthoc boolean:=false;
  --175 posthoc declarations end.
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate']) is distinct from true
    or p_auth_user_id is null or coalesce(p_query->>'siteId','')!~'^\d{8}$' or jsonb_typeof(p_query->'siteId')<>'string'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' is distinct from 'delegate' or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_group_date_v1(p_query->>'fromDate') is distinct from true or public.faolla_attendance_group_date_v1(p_query->>'throughDate') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;access_name:=p_query->>'access';first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  --175 acquire the eventual173 lock level before worker/case reads.
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  -- First match self without locks to avoid locking another person's worker;
  -- recheck the authenticated identity under the employee lock below.
  if access_name='self' and not exists(select 1 from public.merchant_attendance_workers x join public.merchant_enterprise_employees e
    on e.merchant_id=x.merchant_id and e.id=x.employee_id where x.merchant_id=site and x.id=wid and e.auth_user_id=p_auth_user_id) then raise exception 'attendance_access_denied';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if emp.id is null or emp.auth_user_id is null then raise exception 'attendance_period_source_identity_changed';end if;
  if access_name='self' then
    if emp.auth_user_id<>p_auth_user_id or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=emp.role_id for share;
    if role_row.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
      or not('enterprise.view'=any(role_row.permissions)) or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
  end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  report:=public.faolla_attendance_pd_unified_v1(site,p_auth_user_id,case when access_name='delegate' then
    jsonb_build_object('access','delegate','workerId',wid,'fromDate',first_day,'throughDate',last_day) else
    jsonb_build_object('access','self','workerId',null,'locationId',null,'expectedWorkerId',wid,'fromDate',first_day,'throughDate',last_day) end);
  base:=report->'base';range_from:=(base->>'fromAt')::timestamptz;range_to:=(base->>'toAt')::timestamptz;observed:=(base->>'asOf')::timestamptz;
  if base->>'siteId' is distinct from site or base->>'workerId' is distinct from wid::text or base->>'employeeId' is distinct from emp.id::text
    or report->>'access' is distinct from access_name or report->>'complete' is distinct from 'true' or base->>'complete' is distinct from 'true'
    or report->>'payrollReady' is distinct from 'false' then raise exception 'attendance_period_source_invalid';end if;
  if range_to>observed then flags:=array_append(flags,'period_in_progress');end if;
  for d in select generate_series(first_day::timestamp,last_day::timestamp,interval '1 day')::date loop
    a:=public.faolla_attendance_control_day_boundary_v1(d,s.time_zone);b:=public.faolla_attendance_control_day_boundary_v1(d+1,s.time_zone);
    day_items:=day_items||jsonb_build_array(jsonb_build_object('date',d,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),'skipped',a=b));
  end loop;
  -- Mirror the unfiltered owner candidate set. The scoped reader may silently
  -- omit a mixed-identity session; compare the complete private set explicitly.
  candidate_ids:=array(with inside as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at>=range_from and x.occurred_at<range_to order by x.occurred_at,x.sequence limit 101),
    preceding as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at<range_from order by x.occurred_at desc,x.sequence desc limit 1),
    moved as(select x.start_event_id id from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid
      and x.start_at>=range_from-interval '744 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.start_event_id limit 101)
    select id from (select id from inside union select id from preceding union select id from moved) all_candidates order by id limit 102);
  for ev in select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.id=any(candidate_ids) order by x.sequence loop
    select * into endpoint from (select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.sequence>=ev.sequence order by x.sequence limit 2003) tail
      where tail.action='clock_out' order by tail.sequence limit 1;
    select * into eff from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=ev.id;
    if not(ev.occurred_at<range_to and (ev.occurred_at>=range_from or coalesce(endpoint.occurred_at,observed)>range_from))
      and not(coalesce(eff.start_at<range_to and eff.end_at>range_from,false)) then continue;end if;
    if expected_report_count>=100 then raise exception 'attendance_period_source_too_large';end if;
    child:=public.faolla_attendance_period_session_v1(site,wid,ev.id,emp.id,emp.auth_user_id,observed);
    if not exists(select 1 from jsonb_array_elements(base->'items') x where x.value->>'startEventId'=ev.id::text) then raise exception 'attendance_period_source_identity_changed';end if;
    expected_report_count:=expected_report_count+1;report_ids:=array_append(report_ids,ev.id);session_ids:=array_append(session_ids,ev.id);sessions:=sessions||jsonb_build_array(child);
    total_events:=total_events+jsonb_array_length(child->'item'->'events');
    if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
  end loop;
  if expected_report_count<>jsonb_array_length(base->'items') or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;

  -- Full original plan membership, including cancelled plans and associations
  -- whose original/latest endpoints moved outside this period. No auto matching.
  ids:=array(select x.id from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for slot_row in select x.* from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=any(ids) order by x.id loop
    if slot_row.end_at<=range_from then continue;end if;
    if slot_row.employee_id<>emp.id then raise exception 'attendance_period_source_identity_changed';end if;
    item:=public.faolla_attendance_self_schedule_slot_v1(slot_row);
    if item->'publication'->>'employeeAuthUserId' is null then raise exception 'attendance_period_source_identity_unproven';end if;
    if item->'publication'->>'employeeId' is distinct from emp.id::text or item->'publication'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text then
      raise exception 'attendance_period_source_identity_changed';end if;
    current_approval:=null;
    select * into rule_stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=site and x.slot_id=slot_row.id;
    if rule_stream.slot_id is not null then
      if row(rule_stream.worker_id,rule_stream.employee_id,rule_stream.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into rule_operation from public.merchant_attendance_plan_rule_operations x where x.merchant_id=site and x.slot_id=slot_row.id and x.revision=rule_stream.revision;
      if rule_operation.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
      current_approval:=public.faolla_attendance_period_plan_rule_v1(site,wid,slot_row.id,emp.id,emp.auth_user_id,rule_operation.operation_id);
    end if;
    plans:=plans||jsonb_build_array(item||jsonb_build_object('currentApproval',current_approval));
    other_ids:=array(select x.start_event_id from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.slot_id=slot_row.id and x.slot_id is not null order by x.start_event_id limit 11);
    if cardinality(other_ids)>10 then raise exception 'attendance_period_source_too_large';end if;
    foreach target_id in array other_ids loop
      if target_id=any(session_ids) then continue;end if;
      child:=public.faolla_attendance_period_session_v1(site,wid,target_id,emp.id,emp.auth_user_id,observed);
      sessions:=sessions||jsonb_build_array(child);session_ids:=array_append(session_ids,target_id);total_events:=total_events+jsonb_array_length(child->'item'->'events');
      if cardinality(session_ids)>100 or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;
      if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
    end loop;
  end loop;
  select coalesce(jsonb_agg(value order by value->'item'->>'startEventId'),'[]'::jsonb) into sessions from jsonb_array_elements(sessions);

  -- Leave retains current terminal state, not a payroll deduction/excuse.
  ids:=array(select x.request_id from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '8784 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if leave_row.end_at<=range_from then continue;end if;
    if leave_row.employee_id<>emp.id or leave_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    summary:=public.faolla_attendance_leave_summary_v1(leave_row);
    select * into leave_op from public.merchant_attendance_leave_entries x where x.merchant_id=site and x.request_id=leave_row.request_id and x.revision=(summary->>'revision')::integer;
    leaves:=leaves||jsonb_build_array(jsonb_build_object('workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,'summary',summary,
      'operationId',leave_op.operation_id,'recordedAt',to_char(leave_op.recorded_at at time zone 'UTC',fmt)));
    if summary->>'status'='submitted' then flags:=array_append(flags,'pending_leave');end if;
  end loop;
  -- Saved locations only. No current default location and no unrelated people.
  place_ids:=array(select distinct id from (select (event->>'locationId')::uuid id from jsonb_array_elements(sessions) r cross join lateral jsonb_array_elements(r->'item'->'events') event
    union all select (value->>'locationId')::uuid from jsonb_array_elements(report->'missing')
    union all select (value->'slot'->>'locationId')::uuid from jsonb_array_elements(plans)) places where id is not null order by id limit 101);
  if cardinality(place_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  -- Date indexes narrow each saved scope; they are only a conservative UTC
  -- superset. Do NOT cap that superset: only precise saved-zone overlaps count.
  -- The existing local cache avoids repeating STABLE/tzdata boundary work for
  -- equal (zone,date). No UTC/tzdata expression is falsely declared immutable.
  for calendar_row in
    select candidates.* from (
      select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id is null
        and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2
        and x.through_date>=(range_from at time zone 'UTC')::date-2
      union all
      select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id=any(place_ids)
        and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2
        and x.through_date>=(range_from at time zone 'UTC')::date-2
    ) candidates order by candidates.entry_id
  loop
    foreach boundary_date in array array[calendar_row.from_date,calendar_row.through_date+1] loop
      cache_key:=jsonb_build_array(calendar_row.time_zone,boundary_date)::text;
      if not(bounds ? cache_key) then bounds:=bounds||jsonb_build_object(cache_key,to_char(public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone) at time zone 'UTC',fmt));end if;
    end loop;
    a:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.from_date)::text)::timestamptz;b:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.through_date+1)::text)::timestamptz;
    if a>=range_to or b<=range_from then continue;end if;
    if jsonb_array_length(calendars)>=100 then raise exception 'attendance_period_source_too_large';end if;
    summary:=public.faolla_attendance_calendar_summary_v1(calendar_row);
    select * into calendar_op from public.merchant_attendance_calendar_operations x where x.merchant_id=site and x.entry_id=calendar_row.entry_id and x.revision=(summary->>'revision')::integer;
    calendars:=calendars||jsonb_build_array(jsonb_build_object('summary',summary,'operationId',calendar_op.operation_id,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),'recordedAt',to_char(calendar_op.recorded_at at time zone 'UTC',fmt)));
  end loop;

  -- Relevant missing facts retain the151 exact UTC window. A direct pending
  -- revision can move OUT of that window while replacing an approved parent
  -- which is still counted in this period. Include that request, not its hours.
  -- No recursive/root expansion: once an approved successor is outside, its
  -- own outside pending successor does not affect an old ancestor's period.
  missing_base_ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(missing_base_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  missing_child_ids:=array(
    select child.request_id from unnest(missing_base_ids) relevant_parent(request_id)
    cross join lateral(
      select x.request_id from public.merchant_attendance_missing_requests x
      where x.merchant_id=site and x.supersedes_request_id=relevant_parent.request_id and x.supersedes_request_id is not null
        and not exists(select 1 from public.merchant_attendance_missing_entries terminal
          where terminal.merchant_id=x.merchant_id and terminal.request_id=x.request_id and terminal.revision=2)
      order by x.request_id limit 101
    ) child order by child.request_id limit 101);
  -- Do not filter the new child candidates by worker/Auth: an invalid saved
  -- relationship must be rejected, not silently omitted from a complete source.
  ids:=array(select distinct candidate.request_id from unnest(missing_base_ids||missing_child_ids) candidate(request_id) order by candidate.request_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for missing_row in select x.* from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if row(missing_row.worker_id,missing_row.employee_id,missing_row.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
      raise exception 'attendance_period_source_identity_changed';end if;
    select * into missing_first from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id and x.revision=1;
    select * into missing_op from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id order by x.revision desc limit 1;
    if missing_first.operation_id is distinct from missing_row.request_id or missing_first.action is distinct from 'submit'
      or missing_first.actor_auth_user_id is distinct from emp.auth_user_id or missing_first.command->'proposal' is distinct from missing_row.proposal
      or missing_op.revision not between 1 and 2 or missing_op.recorded_at<missing_first.recorded_at then raise exception 'attendance_period_source_invalid';end if;
    -- Validate every pending revision we actually return, including an in-window
    -- child whose approved parent is outside. This checks saved UTC/identity and
    -- immutable receipt linkage only: no current employment/timezone/policy
    -- eligibility, and no owner impersonation or old writer invocation.
    if missing_row.supersedes_request_id is not null and missing_op.revision=1 then
      select * into missing_parent from public.merchant_attendance_missing_requests x
        where x.merchant_id=site and x.request_id=missing_row.supersedes_request_id;
      if missing_parent.request_id is null then raise exception 'attendance_period_source_invalid';end if;
      if row(missing_parent.worker_id,missing_parent.employee_id,missing_parent.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
        raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent_approval from public.merchant_attendance_missing_entries x
        where x.merchant_id=site and x.request_id=missing_parent.request_id and x.revision=2;
      if missing_parent_approval.action is distinct from 'approve'
        or missing_parent_approval.operation_id is distinct from missing_row.supersedes_operation_id
        or missing_row.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)
        or missing_row.location_id is distinct from missing_parent.location_id or missing_row.time_zone is distinct from missing_parent.time_zone
        or missing_parent_approval.recorded_at>=missing_row.submitted_at
        or exists(select 1 from public.merchant_attendance_missing_requests successor
          join public.merchant_attendance_missing_entries approved on approved.merchant_id=successor.merchant_id and approved.request_id=successor.request_id
            and approved.revision=2 and approved.action='approve'
          where successor.merchant_id=site and successor.supersedes_request_id=missing_parent.request_id)
        or exists(select 1 from public.merchant_attendance_missing_requests sibling
          where sibling.merchant_id=site and sibling.supersedes_request_id=missing_parent.request_id and sibling.request_id<>missing_row.request_id
            and not exists(select 1 from public.merchant_attendance_missing_entries terminal
              where terminal.merchant_id=sibling.merchant_id and terminal.request_id=sibling.request_id and terminal.revision=2)) then
        raise exception 'attendance_period_source_invalid';end if;
      select * into missing_root from public.merchant_attendance_missing_requests x
        where x.merchant_id=site and x.request_id=missing_row.root_request_id;
      if missing_root.request_id is null or missing_root.root_request_id is not null or missing_root.supersedes_request_id is not null then
        raise exception 'attendance_period_source_invalid';end if;
      if row(missing_root.worker_id,missing_root.employee_id,missing_root.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
        raise exception 'attendance_period_source_identity_changed';end if;
      if public.faolla_attendance_shift_rule_binding_object_v1(missing_first.command,
          array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']) is distinct from true
        or missing_first.command->>'action' is distinct from 'revise'
        or missing_first.command->>'operationId' is distinct from missing_row.request_id::text
        or missing_first.command->>'expectedWorkerId' is distinct from missing_row.worker_id::text
        or missing_first.command->>'supersedesRequestId' is distinct from missing_row.supersedes_request_id::text
        or missing_first.command->>'expectedApprovalOperationId' is distinct from missing_row.supersedes_operation_id::text
        or missing_first.command->>'locationId' is distinct from missing_row.location_id::text
        or missing_first.command->>'timeZone' is distinct from missing_row.time_zone
        or missing_first.command->>'reason' is distinct from missing_row.reason
        or missing_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_row.policy_revision)
        or jsonb_typeof(missing_first.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(missing_first.command->>'expectedSettingsVersion','')!~'^[1-9][0-9]{0,15}$'
        or (missing_first.command->>'expectedSettingsVersion')::numeric>9007199254740989
        or missing_first.recorded_at is distinct from missing_row.submitted_at
        or missing_op.operation_id is distinct from missing_first.operation_id then raise exception 'attendance_period_source_invalid';end if;
      begin
        missing_proposal:=public.faolla_attendance_correction_proposal_v1(missing_row.proposal,missing_row.submitted_at);
      exception when raise_exception then raise exception 'attendance_period_source_invalid';end;
      if missing_proposal is distinct from missing_row.proposal or jsonb_array_length(missing_proposal->'breaks')>8
        or public.faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_row.start_at
        or public.faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_row.end_at then raise exception 'attendance_period_source_invalid';end if;
    end if;
    status_name:=case missing_op.action when 'submit' then 'submitted' when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' end;
    if status_name is null then raise exception 'attendance_period_source_invalid';end if;
    --154 direct-approved-edge validation begins.
    -- Do not enumerate/cap lifetime root history. A direct approval makes the
    -- parent historical even if that child was later superseded. Never filter
    -- by worker/Auth/root/date before validation: an invalid edge must not hide.
    -- LIMIT2 is a duplicate witness, not a constant-cost scan claim: rejected/
    -- withdrawn siblings can still require indexed probes under the deadline.
    missing_approved_ids:=array(select successor.request_id
      from public.merchant_attendance_missing_requests successor
      join public.merchant_attendance_missing_entries approved
        on approved.merchant_id=successor.merchant_id and approved.request_id=successor.request_id
          and approved.revision=2 and approved.action='approve'
      where successor.merchant_id=site and successor.supersedes_request_id=missing_row.request_id
        and successor.supersedes_request_id is not null limit 2);
    if cardinality(missing_approved_ids)>1 then raise exception 'attendance_period_source_invalid';end if;
    missing_is_current:=status_name='approved' and cardinality(missing_approved_ids)=0;
    missing_edge_ids:=missing_approved_ids;
    -- A returned approved revision may itself have an out-of-period parent.
    -- Validate that incoming edge too; at most two local edges, never recurse.
    if status_name='approved' and missing_row.supersedes_request_id is not null then
      missing_edge_ids:=array_append(missing_edge_ids,missing_row.request_id);
    end if;
    for missing_successor in select successor.* from public.merchant_attendance_missing_requests successor
      where successor.merchant_id=site and successor.request_id=any(missing_edge_ids) order by successor.request_id loop
      if row(missing_successor.worker_id,missing_successor.employee_id,missing_successor.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent from public.merchant_attendance_missing_requests parent
        where parent.merchant_id=site and parent.request_id=missing_successor.supersedes_request_id;
      if missing_parent.request_id is null then raise exception 'attendance_period_source_invalid';end if;
      if row(missing_parent.worker_id,missing_parent.employee_id,missing_parent.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent_approval from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.request_id=missing_parent.request_id and approval.revision=2;
      select * into missing_successor_first from public.merchant_attendance_missing_entries submission
        where submission.merchant_id=site and submission.request_id=missing_successor.request_id and submission.revision=1;
      select * into missing_successor_approval from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.request_id=missing_successor.request_id and approval.revision=2;
      if missing_parent_approval.action is distinct from 'approve'
        or missing_parent_approval.operation_id is distinct from missing_successor.supersedes_operation_id
        or missing_successor.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)
        or missing_successor.location_id is distinct from missing_parent.location_id
        or missing_successor.time_zone is distinct from missing_parent.time_zone
        or missing_parent_approval.recorded_at>=missing_successor.submitted_at
        or missing_successor_approval.action is distinct from 'approve'
        or missing_successor_approval.recorded_at<missing_successor.submitted_at
        --103 explicitly prohibits a revision approval before its submission,
        -- but makes no corresponding monotonic-clock promise for an initial root.
        or (missing_parent.supersedes_request_id is not null and missing_parent_approval.recorded_at<missing_parent.submitted_at) then
        raise exception 'attendance_period_source_invalid';end if;
      select * into missing_root from public.merchant_attendance_missing_requests root_row
        where root_row.merchant_id=site and root_row.request_id=missing_successor.root_request_id;
      if missing_root.request_id is null or missing_root.root_request_id is not null
        or missing_root.supersedes_request_id is not null or missing_root.supersedes_operation_id is not null then
        raise exception 'attendance_period_source_invalid';end if;
      if row(missing_root.worker_id,missing_root.employee_id,missing_root.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      -- The incoming edge's parent might not be one of our returned rows.
      -- Validate uniqueness there too; no current-head/current-owner test.
      missing_sibling_ids:=array(select sibling.request_id from public.merchant_attendance_missing_requests sibling
        join public.merchant_attendance_missing_entries approved
          on approved.merchant_id=sibling.merchant_id and approved.request_id=sibling.request_id
            and approved.revision=2 and approved.action='approve'
        where sibling.merchant_id=site and sibling.supersedes_request_id=missing_parent.request_id
          and sibling.supersedes_request_id is not null limit 2);
      if cardinality(missing_sibling_ids)<>1 or missing_sibling_ids[1] is distinct from missing_successor.request_id then
        raise exception 'attendance_period_source_invalid';end if;
      if missing_successor_first.operation_id is distinct from missing_successor.request_id
        or missing_successor_first.action is distinct from 'submit'
        or missing_successor_first.actor_auth_user_id is distinct from missing_successor.actor_auth_user_id
        or missing_successor_first.recorded_at is distinct from missing_successor.submitted_at
        or missing_successor_first.command->'proposal' is distinct from missing_successor.proposal
        or public.faolla_attendance_shift_rule_binding_object_v1(missing_successor_first.command,
          array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']) is distinct from true
        or missing_successor_first.command->>'action' is distinct from 'revise'
        or missing_successor_first.command->>'operationId' is distinct from missing_successor.request_id::text
        or missing_successor_first.command->>'expectedWorkerId' is distinct from missing_successor.worker_id::text
        or missing_successor_first.command->>'supersedesRequestId' is distinct from missing_parent.request_id::text
        or missing_successor_first.command->>'expectedApprovalOperationId' is distinct from missing_parent_approval.operation_id::text
        or missing_successor_first.command->>'locationId' is distinct from missing_successor.location_id::text
        or missing_successor_first.command->>'timeZone' is distinct from missing_successor.time_zone
        or missing_successor_first.command->>'reason' is distinct from missing_successor.reason
        or jsonb_typeof(missing_successor_first.command->'reason') is distinct from 'string'
        or char_length(missing_successor.reason) not between 1 and 200 or missing_successor.reason<>btrim(missing_successor.reason)
        or missing_successor.reason ~ '[[:cntrl:]]'
        or missing_successor_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_successor.policy_revision)
        or jsonb_typeof(missing_successor_first.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(missing_successor_first.command->>'expectedSettingsVersion','')!~'^[1-9][0-9]{0,15}$'
        or (missing_successor_first.command->>'expectedSettingsVersion')::numeric>9007199254740989 then
        raise exception 'attendance_period_source_invalid';end if;
      begin
        missing_proposal:=public.faolla_attendance_correction_proposal_v1(missing_successor.proposal,missing_successor.submitted_at);
      exception when raise_exception then raise exception 'attendance_period_source_invalid';end;
      if missing_proposal is distinct from missing_successor.proposal or jsonb_array_length(missing_proposal->'breaks')>8
        or public.faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_successor.start_at
        or public.faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_successor.end_at then
        raise exception 'attendance_period_source_invalid';end if;
      -- Both approval receipts bind their actual request and operation. Their
      -- historical owner may differ from today's caller/owner, but cannot be the
      -- applicant itself. Do not revalidate old evidenceTokens against today.
      for missing_checked_approval in select approval.* from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.operation_id in(missing_parent_approval.operation_id,missing_successor_approval.operation_id) loop
        if missing_checked_approval.actor_auth_user_id=emp.auth_user_id
          or public.faolla_attendance_shift_rule_binding_object_v1(missing_checked_approval.command,
            array['action','operationId','requestId','expectedRevision','evidenceToken','reason']) is distinct from true
          or missing_checked_approval.command->>'action' is distinct from 'approve'
          or missing_checked_approval.command->>'operationId' is distinct from missing_checked_approval.operation_id::text
          or missing_checked_approval.command->>'requestId' is distinct from missing_checked_approval.request_id::text
          or missing_checked_approval.command->'expectedRevision' is distinct from '1'::jsonb
          or jsonb_typeof(missing_checked_approval.command->'evidenceToken') is distinct from 'string'
          or coalesce(missing_checked_approval.command->>'evidenceToken','')!~'^[a-f0-9]{32}$'
          or jsonb_typeof(missing_checked_approval.command->'reason') is distinct from 'string'
          or char_length(missing_checked_approval.command->>'reason') not between 1 and 200
          or (missing_checked_approval.command->>'reason')<>btrim(missing_checked_approval.command->>'reason')
          or (missing_checked_approval.command->>'reason') ~ '[[:cntrl:]]' then
          raise exception 'attendance_period_source_invalid';end if;
      end loop;
    end loop;
    --154 direct-approved-edge validation ends.
    missing:=missing||jsonb_build_array(jsonb_build_object('requestId',missing_row.request_id,'operationId',missing_op.operation_id,'revision',missing_op.revision,'status',status_name,
      'startAt',to_char(missing_row.start_at at time zone 'UTC',fmt),'endAt',to_char(missing_row.end_at at time zone 'UTC',fmt),'recordedAt',to_char(missing_op.recorded_at at time zone 'UTC',fmt),
      'supersedesRequestId',missing_row.supersedes_request_id,'rootRequestId',coalesce(missing_row.root_request_id,missing_row.request_id),
      'isCurrentApproved',missing_is_current));
    if status_name='submitted' then flags:=array_append(flags,'pending_missing');end if;
  end loop;

  -- A pending head can affect this period either via its original/current
  -- session (including a proposal moving OUT), or via a proposal moving IN.
  -- Each related stream/root is point-read at its latest revision. Range arms
  -- use the new partial UTC expression indexes; superseded/withdrawn/decided
  -- submissions do not consume the 100 truly-related pending-request budget.
  ids:=array(
    with related as (
      select head.request_id from unnest(session_ids) related_session(start_event_id)
      cross join lateral(
        select x.request_id,x.action from public.merchant_attendance_correction_entries x
        where x.merchant_id=site and x.worker_id=wid and x.start_event_id=related_session.start_event_id
        order by x.revision desc limit 1
      ) head
      where head.action='submit' and not exists(
        select 1 from public.merchant_attendance_correction_decisions decided where decided.merchant_id=site and decided.request_id=head.request_id)
    ), moved as (
      select x.request_id from public.merchant_attendance_correction_entries x
      where x.merchant_id=site and x.worker_id=wid and x.action='submit'
        and public.faolla_attendance_instant_v1(x.proposal->>'startAt')>=range_from-interval '744 hours'
        and public.faolla_attendance_instant_v1(x.proposal->>'startAt')<range_to
        and public.faolla_attendance_instant_v1(x.proposal->>'endAt')>range_from
        and not exists(select 1 from public.merchant_attendance_correction_entries newer
          where newer.merchant_id=x.merchant_id and newer.worker_id=x.worker_id and newer.start_event_id=x.start_event_id and newer.revision>x.revision)
        and not exists(select 1 from public.merchant_attendance_correction_decisions decided
          where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
    )
    select request_id from (select request_id from related union select request_id from moved) relevant order by request_id limit 101);
  other_ids:=array(
    with related as (
      select head.request_id from unnest(session_ids) related_session(start_event_id)
      join public.merchant_attendance_correction_effects root on root.merchant_id=site and root.worker_id=wid and root.start_event_id=related_session.start_event_id
      cross join lateral(
        select x.request_id,x.action from public.merchant_attendance_revision_requests x
        where x.merchant_id=site and x.base_request_id=root.request_id order by x.revision desc limit 1
      ) head
      where head.action='submit' and not exists(
        select 1 from public.merchant_attendance_revision_decisions decided where decided.merchant_id=site and decided.request_id=head.request_id)
    ), moved as (
      select x.request_id from public.merchant_attendance_revision_requests x
      where x.merchant_id=site and x.worker_id=wid and x.action='submit'
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')>=range_from-interval '744 hours'
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')<range_to
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'endAt')>range_from
        and not exists(select 1 from public.merchant_attendance_revision_requests newer
          where newer.merchant_id=x.merchant_id and newer.base_request_id=x.base_request_id and newer.revision>x.revision)
        and not exists(select 1 from public.merchant_attendance_revision_decisions decided
          where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
    )
    select request_id from (select request_id from related union select request_id from moved) relevant order by request_id limit 101);
  if cardinality(ids)>100 or cardinality(other_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for correction_row in select x.* from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=any(ids) and x.action='submit' order by x.request_id loop
    select * into correction_tail from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=correction_row.request_id order by x.revision desc limit 1;
    if correction_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.request_id=correction_row.request_id) then continue;end if;
    a:=(correction_row.proposal->>'startAt')::timestamptz;b:=(correction_row.proposal->>'endAt')::timestamptz;
    if not(correction_row.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if correction_row.employee_id<>emp.id or correction_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if public.faolla_attendance_correction_proposal_v1(correction_row.proposal,correction_row.recorded_at) is distinct from correction_row.proposal then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','correction','requestId',correction_row.request_id,'operationId',correction_row.operation_id,'revision',correction_row.revision,
      'startEventId',correction_row.start_event_id,'startAt',correction_row.proposal->'startAt','endAt',correction_row.proposal->'endAt','recordedAt',to_char(correction_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  for revision_row in select x.* from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=any(other_ids) and x.action='submit' order by x.request_id loop
    select * into revision_tail from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=revision_row.request_id order by x.revision desc limit 1;
    if revision_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_revision_decisions x where x.merchant_id=site and x.request_id=revision_row.request_id) then continue;end if;
    select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.request_id=revision_row.base_request_id;
    a:=(revision_row.command->'proposal'->>'startAt')::timestamptz;b:=(revision_row.command->'proposal'->>'endAt')::timestamptz;
    if not(root_effect.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if revision_row.employee_id<>emp.id or revision_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if root_effect.worker_id is distinct from wid or root_effect.start_event_id is null
      or public.faolla_attendance_correction_proposal_v1(revision_row.command->'proposal',revision_row.recorded_at) is distinct from revision_row.command->'proposal' then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','revision','requestId',revision_row.request_id,'operationId',revision_row.operation_id,'revision',revision_row.revision,
      'startEventId',root_effect.start_event_id,'startAt',revision_row.command->'proposal'->'startAt','endAt',revision_row.command->'proposal'->'endAt','recordedAt',to_char(revision_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  if jsonb_array_length(pending)>100 then raise exception 'attendance_period_source_too_large';end if;
  if jsonb_array_length(pending)>0 then flags:=array_append(flags,'pending_correction');end if;

  -- Only the complete already-collected plan membership is relevant: plans in
  -- this period plus saved plan references of original/latest related sessions.
  -- At most 200 distinct IDs (100 plans + 100 sessions), each looked up through
  -- existing147 UNIQUE(merchant_id,slot_id). Unrelated lifetime cases do not
  -- consume the period's 100-case budget; no history scan or silent truncation.
  other_ids:=array(select distinct candidate.slot_id from (
    select (value->'slot'->>'id')::uuid slot_id from jsonb_array_elements(plans)
    union all select (value->'relation'->'slot'->>'id')::uuid slot_id from jsonb_array_elements(sessions)
  ) candidate where candidate.slot_id is not null order by candidate.slot_id);
  if cardinality(other_ids)>200 then raise exception 'attendance_period_source_too_large';end if;
  ids:=array(select picked.case_id from unnest(other_ids) selected(slot_id)
    cross join lateral(select x.case_id from public.merchant_attendance_plan_exception_cases x
      where x.merchant_id=site and x.slot_id=selected.slot_id limit 1) picked
    order by picked.case_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for case_row in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and x.case_id=any(ids) order by x.case_id loop
    if row(case_row.worker_id,case_row.employee_id,case_row.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
    select * into review_head from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id order by x.revision desc limit 1;
    select * into decision_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='decision' order by x.revision desc limit 1;
    select * into note_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='note' order by x.revision desc limit 1;
    select * into read_row from public.merchant_attendance_plan_exception_reads x where x.merchant_id=site and x.decision_operation_id=decision_row.operation_id;
    if review_head.operation_id is null or decision_row.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
    --175 posthoc snapshot begins. Point-read the current head without filtering
    --historical identities away; self sees saved facts, never owner observations.
    select * into posthoc_head from public.merchant_attendance_plan_posthoc_operations x
      where x.merchant_id=site and x.slot_id=case_row.slot_id order by x.revision desc limit 1;
    if posthoc_head.operation_id is not null then
      if row(posthoc_head.case_id,posthoc_head.worker_id,posthoc_head.employee_id,posthoc_head.employee_auth_user_id)
        is distinct from row(case_row.case_id,wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      posthoc_snapshot:=public.faolla_attendance_plan_posthoc_operation_v1(posthoc_head);
      posthoc_context:=posthoc_context||jsonb_build_array(jsonb_build_object('slotId',case_row.slot_id,'revision',posthoc_head.revision,
        'current',posthoc_snapshot,'selected',posthoc_head.selected,'approval',posthoc_head.approval));
      has_posthoc:=true;
    elsif decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then
      --A v3 decision cannot legitimately outlive its append-only171 ledger.
      raise exception 'attendance_period_source_invalid';
    end if;
    --175 posthoc snapshot ends.
    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);
    summary:=case when note_row.operation_id is null then null else public.faolla_attendance_plan_exception_review_entry_v1(note_row) end;
    reviews:=reviews||jsonb_build_array(jsonb_build_object('caseId',case_row.case_id,'slotId',case_row.slot_id,'revision',review_head.revision,'latestDecision',item,'latestNote',summary,
      'read',case when read_row.operation_id is null then null else jsonb_build_object('operationId',read_row.operation_id,'decisionOperationId',read_row.decision_operation_id,'readAt',to_char(read_row.read_at at time zone 'UTC',fmt)) end));
    -- Validation is deliberately outside canonical content. A self read cannot
    -- call146 as the owner.149 owner send/seal performs the real fresh check.
    if access_name='self' then flags:=array_append(flags,'unresolved_review');
    else
      --175 formal dispatch begins. A new171 head also invalidates an OLD saved
      --decision; dispatch cannot depend only on the saved evidence policy.
      if posthoc_head.operation_id is not null or decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then
        --175 translate only known source failures; authorization and unknown failures propagate.
        begin
        current_source:=public.faolla_attendance_pd_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
        exception when raise_exception then
          if sqlerrm=any(array['attendance_plan_posthoc_formal_invalid','attendance_plan_posthoc_evaluation_invalid',
            'attendance_plan_posthoc_adoption_invalid','attendance_plan_posthoc_adoption_changed']) then raise exception 'attendance_period_source_invalid';
          elsif sqlerrm=any(array['attendance_plan_posthoc_formal_too_large','attendance_plan_posthoc_evaluation_too_large',
            'attendance_plan_posthoc_adoption_too_large']) then raise exception 'attendance_period_source_too_large';
          elsif sqlerrm='attendance_worker_changed' then raise exception 'attendance_period_source_identity_changed';
          else raise;end if;
        end;
      else
      current_source:=public.faolla_attendance_pd_exception_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
      end if;
      --175 formal dispatch ends.
      if decision_row.command->>'outcome'='follow_up' or note_row.revision>decision_row.revision
        or decision_row.evidence->>'fingerprint' is distinct from current_source->>'fingerprint' then flags:=array_append(flags,'unresolved_review');end if;
    end if;
  end loop;
  read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_period_source_invalid';end if;
  select coalesce(jsonb_agg(to_jsonb(reason) order by ord),'[]'::jsonb) into blockers from unnest(array['period_in_progress','open_session','pending_correction','pending_missing','pending_leave','unresolved_review']) with ordinality t(reason,ord) where reason=any(flags);
  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);
  --175 canonical posthoc begins. Only opted-in related facts add this key.
  if has_posthoc then
    select jsonb_agg(head_rows.value order by head_rows.value->>'slotId') into posthoc_context
      from jsonb_array_elements(posthoc_context) head_rows(value);
    context:=context||jsonb_build_object('posthoc',posthoc_context);
  end if;
  --175 canonical posthoc ends.
  result:=jsonb_build_object('sourceVersion',case when has_posthoc then 'attendance-period-source-v3' else 'attendance-period-source-v1' end,'siteId',site,'workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,
    'timeZone',s.time_zone,'fromDate',first_day,'throughDate',last_day,'fromAt',base->'fromAt','toAt',base->'toAt','readAt',to_char(read_at at time zone 'UTC',fmt),
    'dayBoundaries',day_items,'report',report,'context',context,'blockers',blockers,'complete',true,'validation',case when access_name='delegate' then 'delegate_checked' else 'self_not_checked' end);
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  result:=result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
  -- Internal SQL envelope carries raw and canonical material for server-side
  -- verification. The HTTP service projects a smaller archive artifact.
  if octet_length(convert_to(result::text,'UTF8'))>4194304 then raise exception 'attendance_period_source_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_period_source_invalid';
end;
$$;

--PRIVATE MIRROR fixed_source: 202610070179_merchant_attendance_outage_periods.sql / faolla_attendance_period_closure_source_base_v1
create or replace function public.faolla_attendance_pd_fixed_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare
  site text;wid uuid;access_name text;first_day date;last_day date;range_from timestamptz;range_to timestamptz;observed timestamptz;read_at timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
  report jsonb;base jsonb;result jsonb;canonical jsonb;source_text text;day_items jsonb:='[]';d date;a timestamptz;b timestamptz;
  item jsonb;child jsonb;summary jsonb;context jsonb;plans jsonb:='[]';sessions jsonb:='[]';reviews jsonb:='[]';leaves jsonb:='[]';calendars jsonb:='[]';missing jsonb:='[]';pending jsonb:='[]';
  flags text[]:='{}';blockers jsonb;ids uuid[];other_ids uuid[];candidate_ids uuid[];session_ids uuid[]:='{}';report_ids uuid[]:='{}';place_ids uuid[]:='{}';place uuid;target_id uuid;
  ev public.merchant_attendance_events%rowtype;endpoint public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;relation_row public.merchant_attendance_shift_schedule_relations%rowtype;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_op public.merchant_attendance_leave_entries%rowtype;
  calendar_row public.merchant_attendance_calendar_entries%rowtype;calendar_op public.merchant_attendance_calendar_operations%rowtype;
  missing_row public.merchant_attendance_missing_requests%rowtype;missing_first public.merchant_attendance_missing_entries%rowtype;missing_op public.merchant_attendance_missing_entries%rowtype;
  missing_base_ids uuid[];missing_child_ids uuid[];missing_parent public.merchant_attendance_missing_requests%rowtype;missing_root public.merchant_attendance_missing_requests%rowtype;
  missing_parent_approval public.merchant_attendance_missing_entries%rowtype;missing_proposal jsonb;
  correction_row public.merchant_attendance_correction_entries%rowtype;correction_tail public.merchant_attendance_correction_entries%rowtype;
  revision_row public.merchant_attendance_revision_requests%rowtype;revision_tail public.merchant_attendance_revision_requests%rowtype;root_effect public.merchant_attendance_correction_effects%rowtype;
  case_row public.merchant_attendance_plan_exception_cases%rowtype;review_head public.merchant_attendance_plan_exception_entries%rowtype;
  rule_stream public.merchant_attendance_plan_rule_streams%rowtype;rule_operation public.merchant_attendance_plan_rule_operations%rowtype;current_approval jsonb;
  decision_row public.merchant_attendance_plan_exception_entries%rowtype;note_row public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  current_source jsonb;status_name text;bounds jsonb:='{}';cache_key text;boundary_date date;total_events integer:=0;expected_report_count integer:=0;

  missing_approved_ids uuid[];missing_edge_ids uuid[];missing_sibling_ids uuid[];missing_is_current boolean;
  missing_successor public.merchant_attendance_missing_requests%rowtype;missing_successor_first public.merchant_attendance_missing_entries%rowtype;
  missing_successor_approval public.merchant_attendance_missing_entries%rowtype;missing_checked_approval public.merchant_attendance_missing_entries%rowtype;
  fixed_head public.merchant_attendance_period_closures%rowtype;fixed_artifact public.merchant_attendance_period_artifacts%rowtype;
  fixed_version public.merchant_attendance_period_versions%rowtype;fixed_body jsonb;current_body jsonb;fixed_frame jsonb;fixed_day jsonb;fixed_pid uuid;fixed_index integer:=0;
  fixed_previous timestamptz;
  --175 posthoc declarations begin.
  posthoc_head public.merchant_attendance_plan_posthoc_operations%rowtype;posthoc_context jsonb:='[]';posthoc_snapshot jsonb;has_posthoc boolean:=false;
  --175 posthoc declarations end.
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate','periodId']) is distinct from true
    or p_auth_user_id is null or coalesce(p_query->>'siteId','')!~'^\d{8}$' or jsonb_typeof(p_query->'siteId')<>'string'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' is distinct from 'delegate' or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_group_date_v1(p_query->>'fromDate') is distinct from true or public.faolla_attendance_group_date_v1(p_query->>'throughDate') is distinct from true then raise exception 'attendance_invalid_request';end if;
  if p_query->'periodId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'periodId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  fixed_pid:=(p_query->>'periodId')::uuid;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;access_name:=p_query->>'access';first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  --175 acquire the eventual173 lock level before worker/case reads.
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  -- First match self without locks to avoid locking another person's worker;
  -- recheck the authenticated identity under the employee lock below.
  if access_name='self' and not exists(select 1 from public.merchant_attendance_workers x join public.merchant_enterprise_employees e
    on e.merchant_id=x.merchant_id and e.id=x.employee_id where x.merchant_id=site and x.id=wid and e.auth_user_id=p_auth_user_id) then raise exception 'attendance_access_denied';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if emp.id is null or emp.auth_user_id is null then raise exception 'attendance_period_source_identity_changed';end if;
  if access_name='self' then
    if emp.auth_user_id<>p_auth_user_id or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=emp.role_id for share;
    if role_row.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
      or not('enterprise.view'=any(role_row.permissions)) or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
  end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  --155 fixed frame begins. The caller supplies only an identity, never a zone,
  -- UTC interval, day boundary, session setting, or impersonated owner.
  if fixed_pid is not null then
    select * into fixed_head from public.merchant_attendance_period_closures where merchant_id=site and period_id=fixed_pid;
  end if;
  if fixed_head.period_id is null then
    -- A first send has a new UUID but no saved frame yet. Preserve154 exactly.
    return public.faolla_attendance_pd_source_v1(p_query-'periodId',p_auth_user_id);
  end if;
  if fixed_head.worker_id<>wid or fixed_head.from_date<>first_day or fixed_head.through_date<>last_day then raise exception 'attendance_access_denied';end if;
  if fixed_head.employee_id<>emp.id or fixed_head.employee_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
  select * into fixed_version from public.merchant_attendance_period_versions where merchant_id=site and period_id=fixed_pid and version=1;
  select * into fixed_artifact from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=fixed_pid and artifact_id=fixed_version.artifact_id;
  fixed_body:=public.faolla_attendance_period_artifact_checked_v1(fixed_artifact);
  perform public.faolla_attendance_period_summary_v1(fixed_head,fixed_body);
  if fixed_version.version is distinct from 1 or coalesce(fixed_body->'source'->>'sourceVersion','') not in ('attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3','attendance-period-source-v4')
    or fixed_body->'source'->>'siteId' is distinct from site or fixed_body->'source'->>'workerId' is distinct from wid::text
    or fixed_body->'source'->>'employeeId' is distinct from emp.id::text or fixed_body->'source'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text
    or fixed_body->'source'->>'sourceFingerprint' is not null
    or fixed_artifact.source_fingerprint is distinct from encode(sha256(convert_to((fixed_body->'source')::text,'UTF8')),'hex')
    or fixed_body->'source'->>'fromDate' is distinct from first_day::text or fixed_body->'source'->>'throughDate' is distinct from last_day::text
    or fixed_body->'source'->>'timeZone' is distinct from fixed_head.time_zone
    or fixed_body->'source'->>'fromAt' is distinct from to_char(fixed_head.start_at at time zone 'UTC',fmt)
    or fixed_body->'source'->>'toAt' is distinct from to_char(fixed_head.end_at at time zone 'UTC',fmt)
    or fixed_body->'dayBoundaries' is distinct from fixed_body->'source'->'dayBoundaries'
    or jsonb_array_length(fixed_body->'dayBoundaries')<>last_day-first_day+1 then raise exception 'attendance_period_closure_invalid';end if;
  -- Authoritative first-version civil dates must be ordered, gapless and exactly
  -- cover the saved UTC head. A skipped date has equal endpoints, not a missing
  -- row. No current PostgreSQL timezone lookup is used to validate old days.
  for fixed_day in select value from jsonb_array_elements(fixed_body->'dayBoundaries') loop
    if public.faolla_attendance_shift_rule_binding_object_v1(fixed_day,array['date','fromAt','toAt','skipped']) is distinct from true
      or fixed_day->>'date' is distinct from (first_day+fixed_index)::text
      or public.faolla_attendance_shift_rule_binding_scalar_v1(fixed_day->'fromAt','stamp6') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(fixed_day->'toAt','stamp6') is distinct from true
      or jsonb_typeof(fixed_day->'skipped') is distinct from 'boolean' then raise exception 'attendance_period_closure_invalid';end if;
    a:=(fixed_day->>'fromAt')::timestamptz;b:=(fixed_day->>'toAt')::timestamptz;
    if a>b or fixed_day->'skipped' is distinct from to_jsonb(a=b)
      or fixed_index=0 and a is distinct from fixed_head.start_at
      or fixed_index>0 and a is distinct from fixed_previous then raise exception 'attendance_period_closure_invalid';end if;
    fixed_previous:=b;fixed_index:=fixed_index+1;
  end loop;
  if fixed_previous is distinct from fixed_head.end_at
    or fixed_body->'dayBoundaries'->0->'skipped' is distinct from 'false'::jsonb
    or fixed_body->'dayBoundaries'->-1->'skipped' is distinct from 'false'::jsonb then raise exception 'attendance_period_closure_invalid';end if;
  -- Later versions may change business sources, never this period's frame.
  select * into fixed_version from public.merchant_attendance_period_versions where merchant_id=site and period_id=fixed_pid and version=fixed_head.current_version;
  select * into fixed_artifact from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=fixed_pid and artifact_id=fixed_version.artifact_id;
  current_body:=public.faolla_attendance_period_artifact_checked_v1(fixed_artifact);
  perform public.faolla_attendance_period_summary_v1(fixed_head,current_body);
  if current_body->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'
    or current_body->'source'->'dayBoundaries' is distinct from fixed_body->'dayBoundaries'
    or fixed_artifact.source_fingerprint is distinct from encode(sha256(convert_to((current_body->'source')::text,'UTF8')),'hex') then raise exception 'attendance_period_closure_invalid';end if;
  fixed_frame:=jsonb_build_object('timeZone',fixed_head.time_zone,'fromAt',to_char(fixed_head.start_at at time zone 'UTC',fmt),'toAt',to_char(fixed_head.end_at at time zone 'UTC',fmt));
  --155 fixed frame ends.
  report:=public.faolla_attendance_pd_fixed_unified_v1(site,p_auth_user_id,case when access_name='delegate' then
    jsonb_build_object('access','delegate','workerId',wid,'fromDate',first_day,'throughDate',last_day) else
    jsonb_build_object('access','self','workerId',null,'locationId',null,'expectedWorkerId',wid,'fromDate',first_day,'throughDate',last_day) end,fixed_frame);
  base:=report->'base';range_from:=(base->>'fromAt')::timestamptz;range_to:=(base->>'toAt')::timestamptz;observed:=(base->>'asOf')::timestamptz;
  if base->>'siteId' is distinct from site or base->>'workerId' is distinct from wid::text or base->>'employeeId' is distinct from emp.id::text
    or report->>'access' is distinct from access_name or report->>'complete' is distinct from 'true' or base->>'complete' is distinct from 'true'
    or report->>'payrollReady' is distinct from 'false' then raise exception 'attendance_period_source_invalid';end if;
  if range_to>observed then flags:=array_append(flags,'period_in_progress');end if;
  day_items:=fixed_body->'dayBoundaries';
  -- Mirror the unfiltered owner candidate set. The scoped reader may silently
  -- omit a mixed-identity session; compare the complete private set explicitly.
  candidate_ids:=array(with inside as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at>=range_from and x.occurred_at<range_to order by x.occurred_at,x.sequence limit 101),
    preceding as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at<range_from order by x.occurred_at desc,x.sequence desc limit 1),
    moved as(select x.start_event_id id from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid
      and x.start_at>=range_from-interval '744 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.start_event_id limit 101)
    select id from (select id from inside union select id from preceding union select id from moved) all_candidates order by id limit 102);
  for ev in select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.id=any(candidate_ids) order by x.sequence loop
    select * into endpoint from (select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.sequence>=ev.sequence order by x.sequence limit 2003) tail
      where tail.action='clock_out' order by tail.sequence limit 1;
    select * into eff from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=ev.id;
    if not(ev.occurred_at<range_to and (ev.occurred_at>=range_from or coalesce(endpoint.occurred_at,observed)>range_from))
      and not(coalesce(eff.start_at<range_to and eff.end_at>range_from,false)) then continue;end if;
    if expected_report_count>=100 then raise exception 'attendance_period_source_too_large';end if;
    child:=public.faolla_attendance_period_session_v1(site,wid,ev.id,emp.id,emp.auth_user_id,observed);
    if not exists(select 1 from jsonb_array_elements(base->'items') x where x.value->>'startEventId'=ev.id::text) then raise exception 'attendance_period_source_identity_changed';end if;
    expected_report_count:=expected_report_count+1;report_ids:=array_append(report_ids,ev.id);session_ids:=array_append(session_ids,ev.id);sessions:=sessions||jsonb_build_array(child);
    total_events:=total_events+jsonb_array_length(child->'item'->'events');
    if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
  end loop;
  if expected_report_count<>jsonb_array_length(base->'items') or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;

  -- Full original plan membership, including cancelled plans and associations
  -- whose original/latest endpoints moved outside this period. No auto matching.
  ids:=array(select x.id from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for slot_row in select x.* from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=any(ids) order by x.id loop
    if slot_row.end_at<=range_from then continue;end if;
    if slot_row.employee_id<>emp.id then raise exception 'attendance_period_source_identity_changed';end if;
    item:=public.faolla_attendance_self_schedule_slot_v1(slot_row);
    if item->'publication'->>'employeeAuthUserId' is null then raise exception 'attendance_period_source_identity_unproven';end if;
    if item->'publication'->>'employeeId' is distinct from emp.id::text or item->'publication'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text then
      raise exception 'attendance_period_source_identity_changed';end if;
    current_approval:=null;
    select * into rule_stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=site and x.slot_id=slot_row.id;
    if rule_stream.slot_id is not null then
      if row(rule_stream.worker_id,rule_stream.employee_id,rule_stream.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into rule_operation from public.merchant_attendance_plan_rule_operations x where x.merchant_id=site and x.slot_id=slot_row.id and x.revision=rule_stream.revision;
      if rule_operation.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
      current_approval:=public.faolla_attendance_period_plan_rule_v1(site,wid,slot_row.id,emp.id,emp.auth_user_id,rule_operation.operation_id);
    end if;
    plans:=plans||jsonb_build_array(item||jsonb_build_object('currentApproval',current_approval));
    other_ids:=array(select x.start_event_id from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.slot_id=slot_row.id and x.slot_id is not null order by x.start_event_id limit 11);
    if cardinality(other_ids)>10 then raise exception 'attendance_period_source_too_large';end if;
    foreach target_id in array other_ids loop
      if target_id=any(session_ids) then continue;end if;
      child:=public.faolla_attendance_period_session_v1(site,wid,target_id,emp.id,emp.auth_user_id,observed);
      sessions:=sessions||jsonb_build_array(child);session_ids:=array_append(session_ids,target_id);total_events:=total_events+jsonb_array_length(child->'item'->'events');
      if cardinality(session_ids)>100 or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;
      if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
    end loop;
  end loop;
  select coalesce(jsonb_agg(value order by value->'item'->>'startEventId'),'[]'::jsonb) into sessions from jsonb_array_elements(sessions);

  -- Leave retains current terminal state, not a payroll deduction/excuse.
  ids:=array(select x.request_id from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '8784 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if leave_row.end_at<=range_from then continue;end if;
    if leave_row.employee_id<>emp.id or leave_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    summary:=public.faolla_attendance_leave_summary_v1(leave_row);
    select * into leave_op from public.merchant_attendance_leave_entries x where x.merchant_id=site and x.request_id=leave_row.request_id and x.revision=(summary->>'revision')::integer;
    leaves:=leaves||jsonb_build_array(jsonb_build_object('workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,'summary',summary,
      'operationId',leave_op.operation_id,'recordedAt',to_char(leave_op.recorded_at at time zone 'UTC',fmt)));
    if summary->>'status'='submitted' then flags:=array_append(flags,'pending_leave');end if;
  end loop;
  -- Saved locations only. No current default location and no unrelated people.
  place_ids:=array(select distinct id from (select (event->>'locationId')::uuid id from jsonb_array_elements(sessions) r cross join lateral jsonb_array_elements(r->'item'->'events') event
    union all select (value->>'locationId')::uuid from jsonb_array_elements(report->'missing')
    union all select (value->'slot'->>'locationId')::uuid from jsonb_array_elements(plans)) places where id is not null order by id limit 101);
  if cardinality(place_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  -- Date indexes narrow each saved scope; they are only a conservative UTC
  -- superset. Do NOT cap that superset: only precise saved-zone overlaps count.
  -- The existing local cache avoids repeating STABLE/tzdata boundary work for
  -- equal (zone,date). No UTC/tzdata expression is falsely declared immutable.
  for calendar_row in
    select candidates.* from (
      select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id is null
        and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2
        and x.through_date>=(range_from at time zone 'UTC')::date-2
      union all
      select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id=any(place_ids)
        and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2
        and x.through_date>=(range_from at time zone 'UTC')::date-2
    ) candidates order by candidates.entry_id
  loop
    foreach boundary_date in array array[calendar_row.from_date,calendar_row.through_date+1] loop
      cache_key:=jsonb_build_array(calendar_row.time_zone,boundary_date)::text;
      if not(bounds ? cache_key) then bounds:=bounds||jsonb_build_object(cache_key,to_char(public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone) at time zone 'UTC',fmt));end if;
    end loop;
    a:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.from_date)::text)::timestamptz;b:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.through_date+1)::text)::timestamptz;
    if a>=range_to or b<=range_from then continue;end if;
    if jsonb_array_length(calendars)>=100 then raise exception 'attendance_period_source_too_large';end if;
    summary:=public.faolla_attendance_calendar_summary_v1(calendar_row);
    select * into calendar_op from public.merchant_attendance_calendar_operations x where x.merchant_id=site and x.entry_id=calendar_row.entry_id and x.revision=(summary->>'revision')::integer;
    calendars:=calendars||jsonb_build_array(jsonb_build_object('summary',summary,'operationId',calendar_op.operation_id,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),'recordedAt',to_char(calendar_op.recorded_at at time zone 'UTC',fmt)));
  end loop;

  -- Relevant missing facts retain the151 exact UTC window. A direct pending
  -- revision can move OUT of that window while replacing an approved parent
  -- which is still counted in this period. Include that request, not its hours.
  -- No recursive/root expansion: once an approved successor is outside, its
  -- own outside pending successor does not affect an old ancestor's period.
  missing_base_ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101);
  if cardinality(missing_base_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  missing_child_ids:=array(
    select child.request_id from unnest(missing_base_ids) relevant_parent(request_id)
    cross join lateral(
      select x.request_id from public.merchant_attendance_missing_requests x
      where x.merchant_id=site and x.supersedes_request_id=relevant_parent.request_id and x.supersedes_request_id is not null
        and not exists(select 1 from public.merchant_attendance_missing_entries terminal
          where terminal.merchant_id=x.merchant_id and terminal.request_id=x.request_id and terminal.revision=2)
      order by x.request_id limit 101
    ) child order by child.request_id limit 101);
  -- Do not filter the new child candidates by worker/Auth: an invalid saved
  -- relationship must be rejected, not silently omitted from a complete source.
  ids:=array(select distinct candidate.request_id from unnest(missing_base_ids||missing_child_ids) candidate(request_id) order by candidate.request_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for missing_row in select x.* from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if row(missing_row.worker_id,missing_row.employee_id,missing_row.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
      raise exception 'attendance_period_source_identity_changed';end if;
    select * into missing_first from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id and x.revision=1;
    select * into missing_op from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id order by x.revision desc limit 1;
    if missing_first.operation_id is distinct from missing_row.request_id or missing_first.action is distinct from 'submit'
      or missing_first.actor_auth_user_id is distinct from emp.auth_user_id or missing_first.command->'proposal' is distinct from missing_row.proposal
      or missing_op.revision not between 1 and 2 or missing_op.recorded_at<missing_first.recorded_at then raise exception 'attendance_period_source_invalid';end if;
    -- Validate every pending revision we actually return, including an in-window
    -- child whose approved parent is outside. This checks saved UTC/identity and
    -- immutable receipt linkage only: no current employment/timezone/policy
    -- eligibility, and no owner impersonation or old writer invocation.
    if missing_row.supersedes_request_id is not null and missing_op.revision=1 then
      select * into missing_parent from public.merchant_attendance_missing_requests x
        where x.merchant_id=site and x.request_id=missing_row.supersedes_request_id;
      if missing_parent.request_id is null then raise exception 'attendance_period_source_invalid';end if;
      if row(missing_parent.worker_id,missing_parent.employee_id,missing_parent.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
        raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent_approval from public.merchant_attendance_missing_entries x
        where x.merchant_id=site and x.request_id=missing_parent.request_id and x.revision=2;
      if missing_parent_approval.action is distinct from 'approve'
        or missing_parent_approval.operation_id is distinct from missing_row.supersedes_operation_id
        or missing_row.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)
        or missing_row.location_id is distinct from missing_parent.location_id or missing_row.time_zone is distinct from missing_parent.time_zone
        or missing_parent_approval.recorded_at>=missing_row.submitted_at
        or exists(select 1 from public.merchant_attendance_missing_requests successor
          join public.merchant_attendance_missing_entries approved on approved.merchant_id=successor.merchant_id and approved.request_id=successor.request_id
            and approved.revision=2 and approved.action='approve'
          where successor.merchant_id=site and successor.supersedes_request_id=missing_parent.request_id)
        or exists(select 1 from public.merchant_attendance_missing_requests sibling
          where sibling.merchant_id=site and sibling.supersedes_request_id=missing_parent.request_id and sibling.request_id<>missing_row.request_id
            and not exists(select 1 from public.merchant_attendance_missing_entries terminal
              where terminal.merchant_id=sibling.merchant_id and terminal.request_id=sibling.request_id and terminal.revision=2)) then
        raise exception 'attendance_period_source_invalid';end if;
      select * into missing_root from public.merchant_attendance_missing_requests x
        where x.merchant_id=site and x.request_id=missing_row.root_request_id;
      if missing_root.request_id is null or missing_root.root_request_id is not null or missing_root.supersedes_request_id is not null then
        raise exception 'attendance_period_source_invalid';end if;
      if row(missing_root.worker_id,missing_root.employee_id,missing_root.actor_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then
        raise exception 'attendance_period_source_identity_changed';end if;
      if public.faolla_attendance_shift_rule_binding_object_v1(missing_first.command,
          array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']) is distinct from true
        or missing_first.command->>'action' is distinct from 'revise'
        or missing_first.command->>'operationId' is distinct from missing_row.request_id::text
        or missing_first.command->>'expectedWorkerId' is distinct from missing_row.worker_id::text
        or missing_first.command->>'supersedesRequestId' is distinct from missing_row.supersedes_request_id::text
        or missing_first.command->>'expectedApprovalOperationId' is distinct from missing_row.supersedes_operation_id::text
        or missing_first.command->>'locationId' is distinct from missing_row.location_id::text
        or missing_first.command->>'timeZone' is distinct from missing_row.time_zone
        or missing_first.command->>'reason' is distinct from missing_row.reason
        or missing_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_row.policy_revision)
        or jsonb_typeof(missing_first.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(missing_first.command->>'expectedSettingsVersion','')!~'^[1-9][0-9]{0,15}$'
        or (missing_first.command->>'expectedSettingsVersion')::numeric>9007199254740989
        or missing_first.recorded_at is distinct from missing_row.submitted_at
        or missing_op.operation_id is distinct from missing_first.operation_id then raise exception 'attendance_period_source_invalid';end if;
      begin
        missing_proposal:=public.faolla_attendance_correction_proposal_v1(missing_row.proposal,missing_row.submitted_at);
      exception when raise_exception then raise exception 'attendance_period_source_invalid';end;
      if missing_proposal is distinct from missing_row.proposal or jsonb_array_length(missing_proposal->'breaks')>8
        or public.faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_row.start_at
        or public.faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_row.end_at then raise exception 'attendance_period_source_invalid';end if;
    end if;
    status_name:=case missing_op.action when 'submit' then 'submitted' when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' end;
    if status_name is null then raise exception 'attendance_period_source_invalid';end if;
    --154 direct-approved-edge validation begins.
    -- Do not enumerate/cap lifetime root history. A direct approval makes the
    -- parent historical even if that child was later superseded. Never filter
    -- by worker/Auth/root/date before validation: an invalid edge must not hide.
    -- LIMIT2 is a duplicate witness, not a constant-cost scan claim: rejected/
    -- withdrawn siblings can still require indexed probes under the deadline.
    missing_approved_ids:=array(select successor.request_id
      from public.merchant_attendance_missing_requests successor
      join public.merchant_attendance_missing_entries approved
        on approved.merchant_id=successor.merchant_id and approved.request_id=successor.request_id
          and approved.revision=2 and approved.action='approve'
      where successor.merchant_id=site and successor.supersedes_request_id=missing_row.request_id
        and successor.supersedes_request_id is not null limit 2);
    if cardinality(missing_approved_ids)>1 then raise exception 'attendance_period_source_invalid';end if;
    missing_is_current:=status_name='approved' and cardinality(missing_approved_ids)=0;
    missing_edge_ids:=missing_approved_ids;
    -- A returned approved revision may itself have an out-of-period parent.
    -- Validate that incoming edge too; at most two local edges, never recurse.
    if status_name='approved' and missing_row.supersedes_request_id is not null then
      missing_edge_ids:=array_append(missing_edge_ids,missing_row.request_id);
    end if;
    for missing_successor in select successor.* from public.merchant_attendance_missing_requests successor
      where successor.merchant_id=site and successor.request_id=any(missing_edge_ids) order by successor.request_id loop
      if row(missing_successor.worker_id,missing_successor.employee_id,missing_successor.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent from public.merchant_attendance_missing_requests parent
        where parent.merchant_id=site and parent.request_id=missing_successor.supersedes_request_id;
      if missing_parent.request_id is null then raise exception 'attendance_period_source_invalid';end if;
      if row(missing_parent.worker_id,missing_parent.employee_id,missing_parent.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into missing_parent_approval from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.request_id=missing_parent.request_id and approval.revision=2;
      select * into missing_successor_first from public.merchant_attendance_missing_entries submission
        where submission.merchant_id=site and submission.request_id=missing_successor.request_id and submission.revision=1;
      select * into missing_successor_approval from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.request_id=missing_successor.request_id and approval.revision=2;
      if missing_parent_approval.action is distinct from 'approve'
        or missing_parent_approval.operation_id is distinct from missing_successor.supersedes_operation_id
        or missing_successor.root_request_id is distinct from coalesce(missing_parent.root_request_id,missing_parent.request_id)
        or missing_successor.location_id is distinct from missing_parent.location_id
        or missing_successor.time_zone is distinct from missing_parent.time_zone
        or missing_parent_approval.recorded_at>=missing_successor.submitted_at
        or missing_successor_approval.action is distinct from 'approve'
        or missing_successor_approval.recorded_at<missing_successor.submitted_at
        --103 explicitly prohibits a revision approval before its submission,
        -- but makes no corresponding monotonic-clock promise for an initial root.
        or (missing_parent.supersedes_request_id is not null and missing_parent_approval.recorded_at<missing_parent.submitted_at) then
        raise exception 'attendance_period_source_invalid';end if;
      select * into missing_root from public.merchant_attendance_missing_requests root_row
        where root_row.merchant_id=site and root_row.request_id=missing_successor.root_request_id;
      if missing_root.request_id is null or missing_root.root_request_id is not null
        or missing_root.supersedes_request_id is not null or missing_root.supersedes_operation_id is not null then
        raise exception 'attendance_period_source_invalid';end if;
      if row(missing_root.worker_id,missing_root.employee_id,missing_root.actor_auth_user_id)
        is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      -- The incoming edge's parent might not be one of our returned rows.
      -- Validate uniqueness there too; no current-head/current-owner test.
      missing_sibling_ids:=array(select sibling.request_id from public.merchant_attendance_missing_requests sibling
        join public.merchant_attendance_missing_entries approved
          on approved.merchant_id=sibling.merchant_id and approved.request_id=sibling.request_id
            and approved.revision=2 and approved.action='approve'
        where sibling.merchant_id=site and sibling.supersedes_request_id=missing_parent.request_id
          and sibling.supersedes_request_id is not null limit 2);
      if cardinality(missing_sibling_ids)<>1 or missing_sibling_ids[1] is distinct from missing_successor.request_id then
        raise exception 'attendance_period_source_invalid';end if;
      if missing_successor_first.operation_id is distinct from missing_successor.request_id
        or missing_successor_first.action is distinct from 'submit'
        or missing_successor_first.actor_auth_user_id is distinct from missing_successor.actor_auth_user_id
        or missing_successor_first.recorded_at is distinct from missing_successor.submitted_at
        or missing_successor_first.command->'proposal' is distinct from missing_successor.proposal
        or public.faolla_attendance_shift_rule_binding_object_v1(missing_successor_first.command,
          array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']) is distinct from true
        or missing_successor_first.command->>'action' is distinct from 'revise'
        or missing_successor_first.command->>'operationId' is distinct from missing_successor.request_id::text
        or missing_successor_first.command->>'expectedWorkerId' is distinct from missing_successor.worker_id::text
        or missing_successor_first.command->>'supersedesRequestId' is distinct from missing_parent.request_id::text
        or missing_successor_first.command->>'expectedApprovalOperationId' is distinct from missing_parent_approval.operation_id::text
        or missing_successor_first.command->>'locationId' is distinct from missing_successor.location_id::text
        or missing_successor_first.command->>'timeZone' is distinct from missing_successor.time_zone
        or missing_successor_first.command->>'reason' is distinct from missing_successor.reason
        or jsonb_typeof(missing_successor_first.command->'reason') is distinct from 'string'
        or char_length(missing_successor.reason) not between 1 and 200 or missing_successor.reason<>btrim(missing_successor.reason)
        or missing_successor.reason ~ '[[:cntrl:]]'
        or missing_successor_first.command->'expectedPolicyRevision' is distinct from to_jsonb(missing_successor.policy_revision)
        or jsonb_typeof(missing_successor_first.command->'expectedSettingsVersion') is distinct from 'number'
        or coalesce(missing_successor_first.command->>'expectedSettingsVersion','')!~'^[1-9][0-9]{0,15}$'
        or (missing_successor_first.command->>'expectedSettingsVersion')::numeric>9007199254740989 then
        raise exception 'attendance_period_source_invalid';end if;
      begin
        missing_proposal:=public.faolla_attendance_correction_proposal_v1(missing_successor.proposal,missing_successor.submitted_at);
      exception when raise_exception then raise exception 'attendance_period_source_invalid';end;
      if missing_proposal is distinct from missing_successor.proposal or jsonb_array_length(missing_proposal->'breaks')>8
        or public.faolla_attendance_instant_v1(missing_proposal->>'startAt') is distinct from missing_successor.start_at
        or public.faolla_attendance_instant_v1(missing_proposal->>'endAt') is distinct from missing_successor.end_at then
        raise exception 'attendance_period_source_invalid';end if;
      -- Both approval receipts bind their actual request and operation. Their
      -- historical owner may differ from today's caller/owner, but cannot be the
      -- applicant itself. Do not revalidate old evidenceTokens against today.
      for missing_checked_approval in select approval.* from public.merchant_attendance_missing_entries approval
        where approval.merchant_id=site and approval.operation_id in(missing_parent_approval.operation_id,missing_successor_approval.operation_id) loop
        if missing_checked_approval.actor_auth_user_id=emp.auth_user_id
          or public.faolla_attendance_shift_rule_binding_object_v1(missing_checked_approval.command,
            array['action','operationId','requestId','expectedRevision','evidenceToken','reason']) is distinct from true
          or missing_checked_approval.command->>'action' is distinct from 'approve'
          or missing_checked_approval.command->>'operationId' is distinct from missing_checked_approval.operation_id::text
          or missing_checked_approval.command->>'requestId' is distinct from missing_checked_approval.request_id::text
          or missing_checked_approval.command->'expectedRevision' is distinct from '1'::jsonb
          or jsonb_typeof(missing_checked_approval.command->'evidenceToken') is distinct from 'string'
          or coalesce(missing_checked_approval.command->>'evidenceToken','')!~'^[a-f0-9]{32}$'
          or jsonb_typeof(missing_checked_approval.command->'reason') is distinct from 'string'
          or char_length(missing_checked_approval.command->>'reason') not between 1 and 200
          or (missing_checked_approval.command->>'reason')<>btrim(missing_checked_approval.command->>'reason')
          or (missing_checked_approval.command->>'reason') ~ '[[:cntrl:]]' then
          raise exception 'attendance_period_source_invalid';end if;
      end loop;
    end loop;
    --154 direct-approved-edge validation ends.
    missing:=missing||jsonb_build_array(jsonb_build_object('requestId',missing_row.request_id,'operationId',missing_op.operation_id,'revision',missing_op.revision,'status',status_name,
      'startAt',to_char(missing_row.start_at at time zone 'UTC',fmt),'endAt',to_char(missing_row.end_at at time zone 'UTC',fmt),'recordedAt',to_char(missing_op.recorded_at at time zone 'UTC',fmt),
      'supersedesRequestId',missing_row.supersedes_request_id,'rootRequestId',coalesce(missing_row.root_request_id,missing_row.request_id),
      'isCurrentApproved',missing_is_current));
    if status_name='submitted' then flags:=array_append(flags,'pending_missing');end if;
  end loop;

  -- A pending head can affect this period either via its original/current
  -- session (including a proposal moving OUT), or via a proposal moving IN.
  -- Each related stream/root is point-read at its latest revision. Range arms
  -- use the new partial UTC expression indexes; superseded/withdrawn/decided
  -- submissions do not consume the 100 truly-related pending-request budget.
  ids:=array(
    with related as (
      select head.request_id from unnest(session_ids) related_session(start_event_id)
      cross join lateral(
        select x.request_id,x.action from public.merchant_attendance_correction_entries x
        where x.merchant_id=site and x.worker_id=wid and x.start_event_id=related_session.start_event_id
        order by x.revision desc limit 1
      ) head
      where head.action='submit' and not exists(
        select 1 from public.merchant_attendance_correction_decisions decided where decided.merchant_id=site and decided.request_id=head.request_id)
    ), moved as (
      select x.request_id from public.merchant_attendance_correction_entries x
      where x.merchant_id=site and x.worker_id=wid and x.action='submit'
        and public.faolla_attendance_instant_v1(x.proposal->>'startAt')>=range_from-interval '744 hours'
        and public.faolla_attendance_instant_v1(x.proposal->>'startAt')<range_to
        and public.faolla_attendance_instant_v1(x.proposal->>'endAt')>range_from
        and not exists(select 1 from public.merchant_attendance_correction_entries newer
          where newer.merchant_id=x.merchant_id and newer.worker_id=x.worker_id and newer.start_event_id=x.start_event_id and newer.revision>x.revision)
        and not exists(select 1 from public.merchant_attendance_correction_decisions decided
          where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
    )
    select request_id from (select request_id from related union select request_id from moved) relevant order by request_id limit 101);
  other_ids:=array(
    with related as (
      select head.request_id from unnest(session_ids) related_session(start_event_id)
      join public.merchant_attendance_correction_effects root on root.merchant_id=site and root.worker_id=wid and root.start_event_id=related_session.start_event_id
      cross join lateral(
        select x.request_id,x.action from public.merchant_attendance_revision_requests x
        where x.merchant_id=site and x.base_request_id=root.request_id order by x.revision desc limit 1
      ) head
      where head.action='submit' and not exists(
        select 1 from public.merchant_attendance_revision_decisions decided where decided.merchant_id=site and decided.request_id=head.request_id)
    ), moved as (
      select x.request_id from public.merchant_attendance_revision_requests x
      where x.merchant_id=site and x.worker_id=wid and x.action='submit'
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')>=range_from-interval '744 hours'
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')<range_to
        and public.faolla_attendance_instant_v1(x.command->'proposal'->>'endAt')>range_from
        and not exists(select 1 from public.merchant_attendance_revision_requests newer
          where newer.merchant_id=x.merchant_id and newer.base_request_id=x.base_request_id and newer.revision>x.revision)
        and not exists(select 1 from public.merchant_attendance_revision_decisions decided
          where decided.merchant_id=x.merchant_id and decided.request_id=x.request_id)
    )
    select request_id from (select request_id from related union select request_id from moved) relevant order by request_id limit 101);
  if cardinality(ids)>100 or cardinality(other_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for correction_row in select x.* from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=any(ids) and x.action='submit' order by x.request_id loop
    select * into correction_tail from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=correction_row.request_id order by x.revision desc limit 1;
    if correction_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.request_id=correction_row.request_id) then continue;end if;
    a:=(correction_row.proposal->>'startAt')::timestamptz;b:=(correction_row.proposal->>'endAt')::timestamptz;
    if not(correction_row.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if correction_row.employee_id<>emp.id or correction_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if public.faolla_attendance_correction_proposal_v1(correction_row.proposal,correction_row.recorded_at) is distinct from correction_row.proposal then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','correction','requestId',correction_row.request_id,'operationId',correction_row.operation_id,'revision',correction_row.revision,
      'startEventId',correction_row.start_event_id,'startAt',correction_row.proposal->'startAt','endAt',correction_row.proposal->'endAt','recordedAt',to_char(correction_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  for revision_row in select x.* from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=any(other_ids) and x.action='submit' order by x.request_id loop
    select * into revision_tail from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=revision_row.request_id order by x.revision desc limit 1;
    if revision_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_revision_decisions x where x.merchant_id=site and x.request_id=revision_row.request_id) then continue;end if;
    select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.request_id=revision_row.base_request_id;
    a:=(revision_row.command->'proposal'->>'startAt')::timestamptz;b:=(revision_row.command->'proposal'->>'endAt')::timestamptz;
    if not(root_effect.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if revision_row.employee_id<>emp.id or revision_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if root_effect.worker_id is distinct from wid or root_effect.start_event_id is null
      or public.faolla_attendance_correction_proposal_v1(revision_row.command->'proposal',revision_row.recorded_at) is distinct from revision_row.command->'proposal' then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','revision','requestId',revision_row.request_id,'operationId',revision_row.operation_id,'revision',revision_row.revision,
      'startEventId',root_effect.start_event_id,'startAt',revision_row.command->'proposal'->'startAt','endAt',revision_row.command->'proposal'->'endAt','recordedAt',to_char(revision_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  if jsonb_array_length(pending)>100 then raise exception 'attendance_period_source_too_large';end if;
  if jsonb_array_length(pending)>0 then flags:=array_append(flags,'pending_correction');end if;

  -- Only the complete already-collected plan membership is relevant: plans in
  -- this period plus saved plan references of original/latest related sessions.
  -- At most 200 distinct IDs (100 plans + 100 sessions), each looked up through
  -- existing147 UNIQUE(merchant_id,slot_id). Unrelated lifetime cases do not
  -- consume the period's 100-case budget; no history scan or silent truncation.
  other_ids:=array(select distinct candidate.slot_id from (
    select (value->'slot'->>'id')::uuid slot_id from jsonb_array_elements(plans)
    union all select (value->'relation'->'slot'->>'id')::uuid slot_id from jsonb_array_elements(sessions)
  ) candidate where candidate.slot_id is not null order by candidate.slot_id);
  if cardinality(other_ids)>200 then raise exception 'attendance_period_source_too_large';end if;
  ids:=array(select picked.case_id from unnest(other_ids) selected(slot_id)
    cross join lateral(select x.case_id from public.merchant_attendance_plan_exception_cases x
      where x.merchant_id=site and x.slot_id=selected.slot_id limit 1) picked
    order by picked.case_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for case_row in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and x.case_id=any(ids) order by x.case_id loop
    if row(case_row.worker_id,case_row.employee_id,case_row.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
    select * into review_head from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id order by x.revision desc limit 1;
    select * into decision_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='decision' order by x.revision desc limit 1;
    select * into note_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='note' order by x.revision desc limit 1;
    select * into read_row from public.merchant_attendance_plan_exception_reads x where x.merchant_id=site and x.decision_operation_id=decision_row.operation_id;
    if review_head.operation_id is null or decision_row.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
    --175 posthoc snapshot begins. Point-read the current head without filtering
    --historical identities away; self sees saved facts, never owner observations.
    select * into posthoc_head from public.merchant_attendance_plan_posthoc_operations x
      where x.merchant_id=site and x.slot_id=case_row.slot_id order by x.revision desc limit 1;
    if posthoc_head.operation_id is not null then
      if row(posthoc_head.case_id,posthoc_head.worker_id,posthoc_head.employee_id,posthoc_head.employee_auth_user_id)
        is distinct from row(case_row.case_id,wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      posthoc_snapshot:=public.faolla_attendance_plan_posthoc_operation_v1(posthoc_head);
      posthoc_context:=posthoc_context||jsonb_build_array(jsonb_build_object('slotId',case_row.slot_id,'revision',posthoc_head.revision,
        'current',posthoc_snapshot,'selected',posthoc_head.selected,'approval',posthoc_head.approval));
      has_posthoc:=true;
    elsif decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then
      --A v3 decision cannot legitimately outlive its append-only171 ledger.
      raise exception 'attendance_period_source_invalid';
    end if;
    --175 posthoc snapshot ends.
    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);
    summary:=case when note_row.operation_id is null then null else public.faolla_attendance_plan_exception_review_entry_v1(note_row) end;
    reviews:=reviews||jsonb_build_array(jsonb_build_object('caseId',case_row.case_id,'slotId',case_row.slot_id,'revision',review_head.revision,'latestDecision',item,'latestNote',summary,
      'read',case when read_row.operation_id is null then null else jsonb_build_object('operationId',read_row.operation_id,'decisionOperationId',read_row.decision_operation_id,'readAt',to_char(read_row.read_at at time zone 'UTC',fmt)) end));
    -- Validation is deliberately outside canonical content. A self read cannot
    -- call146 as the owner.149 owner send/seal performs the real fresh check.
    if access_name='self' then flags:=array_append(flags,'unresolved_review');
    else
      --175 formal dispatch begins. A new171 head also invalidates an OLD saved
      --decision; dispatch cannot depend only on the saved evidence policy.
      if posthoc_head.operation_id is not null or decision_row.evidence->>'policy'='owner-confirmed-plan-edges-posthoc-v3' then
        --175 translate only known source failures; authorization and unknown failures propagate.
        begin
        current_source:=public.faolla_attendance_pd_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
        exception when raise_exception then
          if sqlerrm=any(array['attendance_plan_posthoc_formal_invalid','attendance_plan_posthoc_evaluation_invalid',
            'attendance_plan_posthoc_adoption_invalid','attendance_plan_posthoc_adoption_changed']) then raise exception 'attendance_period_source_invalid';
          elsif sqlerrm=any(array['attendance_plan_posthoc_formal_too_large','attendance_plan_posthoc_evaluation_too_large',
            'attendance_plan_posthoc_adoption_too_large']) then raise exception 'attendance_period_source_too_large';
          elsif sqlerrm='attendance_worker_changed' then raise exception 'attendance_period_source_identity_changed';
          else raise;end if;
        end;
      else
      current_source:=public.faolla_attendance_pd_exception_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
      end if;
      --175 formal dispatch ends.
      if decision_row.command->>'outcome'='follow_up' or note_row.revision>decision_row.revision
        or decision_row.evidence->>'fingerprint' is distinct from current_source->>'fingerprint' then flags:=array_append(flags,'unresolved_review');end if;
    end if;
  end loop;
  read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_period_source_invalid';end if;
  select coalesce(jsonb_agg(to_jsonb(reason) order by ord),'[]'::jsonb) into blockers from unnest(array['period_in_progress','open_session','pending_correction','pending_missing','pending_leave','unresolved_review']) with ordinality t(reason,ord) where reason=any(flags);
  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);
  --175 canonical posthoc begins. Only opted-in related facts add this key.
  if has_posthoc then
    select jsonb_agg(head_rows.value order by head_rows.value->>'slotId') into posthoc_context
      from jsonb_array_elements(posthoc_context) head_rows(value);
    context:=context||jsonb_build_object('posthoc',posthoc_context);
  end if;
  --175 canonical posthoc ends.
  result:=jsonb_build_object('sourceVersion',case when has_posthoc then 'attendance-period-source-v3' else 'attendance-period-source-v1' end,'siteId',site,'workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,
    'timeZone',fixed_head.time_zone,'fromDate',first_day,'throughDate',last_day,'fromAt',base->'fromAt','toAt',base->'toAt','readAt',to_char(read_at at time zone 'UTC',fmt),
    'dayBoundaries',day_items,'report',report,'context',context,'blockers',blockers,'complete',true,'validation',case when access_name='delegate' then 'delegate_checked' else 'self_not_checked' end);
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  result:=result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
  -- Internal SQL envelope carries raw and canonical material for server-side
  -- verification. The HTTP service projects a smaller archive artifact.
  if octet_length(convert_to(result::text,'UTF8'))>4194304 then raise exception 'attendance_period_source_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_period_source_invalid';
end;
$$;

--PRIVATE MIRROR envelope: 202610070179_merchant_attendance_outage_periods.sql / faolla_attendance_period_closure_source_v1
create or replace function public.faolla_attendance_pd_envelope_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare result jsonb;arrangements jsonb;outages jsonb;canonical jsonb;source_text text;
begin
  --175's collector authorizes and retains its original fixed-frame locks.
  result:=public.faolla_attendance_pd_fixed_source_v1(p_query,p_auth_user_id);
  arrangements:=public.faolla_attendance_work_arrangement_context_v1(
    result->>'siteId',(result->>'workerId')::uuid,(result->>'employeeId')::uuid,(result->>'employeeAuthUserId')::uuid,
    (result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz);
  outages:=public.faolla_attendance_outage_period_context_v1(
    result->>'siteId',(result->>'workerId')::uuid,(result->>'employeeId')::uuid,(result->>'employeeAuthUserId')::uuid,
    (result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz);
  if arrangements='[]'::jsonb and outages='[]'::jsonb then return result;end if;
  if arrangements<>'[]'::jsonb then
    result:=jsonb_set(result,'{context,workArrangements}',arrangements)||jsonb_build_object('sourceVersion',case when result->>'sourceVersion'='attendance-period-source-v3' then 'attendance-period-source-v3' else 'attendance-period-source-v2' end);
    if exists(select 1 from jsonb_array_elements(arrangements) x where x->>'status'='submitted') then
      result:=jsonb_set(result,'{blockers}',(result->'blockers')||'["pending_work_arrangement"]'::jsonb);
    end if;
  end if;
  --No synthetic empty section and no v4 upgrade for an unrelated old period.
  if outages<>'[]'::jsonb then
    result:=jsonb_set(result,'{context,outages}',outages)||jsonb_build_object('sourceVersion','attendance-period-source-v4');
    if exists(select 1 from jsonb_array_elements(outages) x where x->'status'->'resolved' is distinct from 'true'::jsonb) then
      result:=jsonb_set(result,'{blockers}',(result->'blockers')||'["unresolved_outage"]'::jsonb);
    end if;
  end if;
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  return result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
end;
$$;

--The ONLY integration entry. Typed identity/frame arguments come from a trusted
--grant wrapper, never from a direct browser/service call. This helper rechecks
--membership/target scope under locks, but intentionally cannot grant any action.
create or replace function public.faolla_attendance_period_delegated_source_v1(
  p_site text,p_worker uuid,p_employee uuid,p_employee_auth uuid,p_actor uuid,p_from date,p_through date,p_period uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  actor_employee public.merchant_enterprise_employees%rowtype;actor_employee_id uuid;
  result jsonb;dependency record;function_meta pg_proc%rowtype;expected_owner oid;checked_role text;
begin
  if p_site is null or p_site!~'^[0-9]{8}$' or p_worker is null or p_employee is null or p_employee_auth is null or p_actor is null
    or p_from is null or p_through is null or not isfinite(p_from) or not isfinite(p_through)
    or p_from<date '2000-01-01' or p_through>date '2100-12-31' or p_through-p_from not between 0 and 30
    or p_actor=p_employee_auth then raise exception 'attendance_invalid_request';end if;
  select proowner into expected_owner from pg_proc
    where oid='public.faolla_attendance_period_delegated_source_v1(text,uuid,uuid,uuid,uuid,date,date,uuid)'::regprocedure;
  --DEPENDENCY_PROFILE_BEGIN: pinned executable sources, not merely their names.
  for dependency in select * from (values
    ('public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid)','e13c2a8d9265985dae141a96fa56d733f77ac2a007b830f07cb3d0be1bfd1437',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_shift_check_v1(jsonb,uuid)','54632325e0d569c9835dfadc628632115c2f13a86c0466e852906a3f426bcfb0',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_coverage_v1(jsonb,uuid)','21917f1580f1b831e38064ce9bb003bf146a133858693e6b7a858b516d5f5c73',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_coverage_adoptions_v1(jsonb,uuid)','bd1383469e3692438b3af55a504ef8348f9ef6cdd1e4134e705e0a4c9c227a0f',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_exception_source_legacy_v1(jsonb,uuid)','89309840b875cf0d530abc9e80fa8c0bcd93a34c64f23053c446a16eeea1bc8c',true,false,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)','1234394b481e1e3063d6a12d83bf606e11be1cb8d64b4b86ea194091eb5334b1',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_posthoc_preview_v1(jsonb,uuid,integer,uuid)','9640704dae146d72816cdebc8e4da81bf82b99b242df063ea2251a3c2e20df0c',false,false,0,array['p_query','p_auth_user_id','p_revision','p_current']::text[]),
    ('public.faolla_attendance_plan_posthoc_adoption_v1(jsonb,uuid,jsonb,boolean)','a12c7b2e71b3c98c379680e3be8a8c592f299e2475fdf6737cb9d1184279288e',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[]),
    ('public.faolla_attendance_plan_posthoc_formal_facts_v1(jsonb,uuid)','c9c0ced9eca39a7ad6f70710a04ef6f25d8add120839c91beb38ae6e7b70eacc',false,false,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid)','7794ff1971454006e2410476c4848faf3972d0e8bb67039c9acfb13dc32c7d64',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_period_report_v2(text,uuid,jsonb)','9c98806622a8f997ced37f7e83aaf548bd3ca04524ce55775c2828ba3639f389',true,true,0,array['p_site_id','p_auth_user_id','p_query']::text[]),
    ('public.faolla_attendance_unified_report_v1(text,uuid,jsonb)','b75e43356987a9754d1af8f9942996416b1405490aac618e7c0041cf66fd4a81',true,true,0,array['p_site_id','p_auth_user_id','p_query']::text[]),
    ('public.faolla_attendance_period_closure_report_v1(text,uuid,jsonb,jsonb)','7b5afdd059188deb1edd06668b308b4830b1937b4ca904f90e527535660001bf',true,false,0,array['p_site_id','p_auth_user_id','p_query','p_frame']::text[]),
    ('public.faolla_attendance_period_closure_unified_report_v1(text,uuid,jsonb,jsonb)','e113571f21684a514ea5be8536debbc97fc4096601fe6af91f8e01213ce0b775',true,false,0,array['p_site_id','p_auth_user_id','p_query','p_frame']::text[]),
    ('public.faolla_attendance_period_source_v1(jsonb,uuid)','9bb7f3abfaf07c110b33286950d347bab5b94874a35a6d459aef409bf341d4ca',true,true,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_period_closure_source_base_v1(jsonb,uuid)','512322083cd3b668f41d44322dec10f65b322388c8c4a470f34c5c691ba9eeb1',true,false,0,array['p_query','p_auth_user_id']::text[]),
    ('public.faolla_attendance_period_closure_source_v1(jsonb,uuid)','a89321433586376f607a9277306803ff363f43d07b157a1bc40f7aaf08be0f24',true,true,0,array['p_query','p_auth_user_id']::text[])
  ) expected(signature,source_sha256,is_definer,service_execute,defaults,argnames) loop
    select * into function_meta from pg_proc where oid=to_regprocedure(dependency.signature);
    if function_meta.oid is null or function_meta.proowner is distinct from expected_owner
      or function_meta.prorettype is distinct from 'jsonb'::regtype or function_meta.proretset
      or function_meta.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
      or function_meta.prosecdef is distinct from dependency.is_definer or function_meta.provolatile is distinct from 'v'
      or function_meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or function_meta.proargnames is distinct from dependency.argnames or function_meta.proargmodes is not null
      or function_meta.pronargdefaults is distinct from dependency.defaults
      or encode(sha256(convert_to(replace(replace(function_meta.prosrc,chr(13),''),
        quote_ident((select nspname from pg_namespace where oid=function_meta.pronamespace))||'.','public'||'.'),'UTF8')),'hex') is distinct from dependency.source_sha256
      or exists(select 1 from aclexplode(coalesce(function_meta.proacl,acldefault('f',function_meta.proowner))) a
        where a.privilege_type='EXECUTE' and a.grantee<>function_meta.proowner
          and not(dependency.service_execute and a.grantee=(select oid from pg_roles where rolname='service_role'))) then
      raise exception 'attendance_period_delegated_source_incompatible';
    end if;
    foreach checked_role in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(checked_role,function_meta.oid,'EXECUTE') is distinct from
        (checked_role='service_role' and dependency.service_execute) then
        raise exception 'attendance_period_delegated_source_incompatible';
      end if;
    end loop;
  end loop;
  --DEPENDENCY_PROFILE_END
  --Same transaction and lock ordering as the future grant wrapper, 179 and183.
  perform 1 from public.merchants where id=p_site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=p_worker for update;
  if w.id is null or w.employee_id is distinct from p_employee then raise exception 'attendance_period_source_identity_changed';end if;
  select id into actor_employee_id from public.merchant_enterprise_employees where merchant_id=p_site and auth_user_id=p_actor;
  if actor_employee_id is null or actor_employee_id=p_employee then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id in(p_employee,actor_employee_id) order by x.id for share;
  select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=p_employee;
  select * into actor_employee from public.merchant_enterprise_employees where merchant_id=p_site and id=actor_employee_id;
  if e.id is null or e.auth_user_id is distinct from p_employee_auth then raise exception 'attendance_period_source_identity_changed';end if;
  if actor_employee.id is null or actor_employee.auth_user_id is distinct from p_actor or actor_employee.status is distinct from 'active' then
    raise exception 'attendance_access_denied';end if;
  result:=public.faolla_attendance_pd_envelope_v1(jsonb_build_object('siteId',p_site,'access','delegate','workerId',p_worker,
    'fromDate',p_from,'throughDate',p_through,'periodId',p_period),p_actor);
  if result is null or result->>'siteId' is distinct from p_site or result->>'workerId' is distinct from p_worker::text
    or result->>'employeeId' is distinct from p_employee::text or result->>'employeeAuthUserId' is distinct from p_employee_auth::text
    or result->>'fromDate' is distinct from p_from::text or result->>'throughDate' is distinct from p_through::text
    or result->'report'->>'access' is distinct from 'delegate' or result->>'validation' is distinct from 'delegate_checked'
    or result->'complete' is distinct from 'true'::jsonb
    or public.faolla_attendance_period_canonical_v1(result) is distinct from result->'sourceCanonical'
    or result->>'sourceText' is distinct from (result->'sourceCanonical')::text
    or result->>'sourceFingerprint' is distinct from encode(sha256(convert_to(result->>'sourceText','UTF8')),'hex') then
    raise exception 'attendance_period_source_invalid';
  end if;
  if octet_length(convert_to(result->>'sourceText','UTF8'))>1048576
    or octet_length(convert_to(result::text,'UTF8'))>4194304 then raise exception 'attendance_period_source_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_pd_binding_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_shift_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_coverage_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_adoptions_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_exception_legacy_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_exception_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_posthoc_preview_v1(jsonb,uuid,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_posthoc_read_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_formal_facts_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_formal_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_report_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_unified_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_fixed_report_v1(text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_fixed_unified_v1(text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_fixed_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_pd_envelope_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegated_source_v1(text,uuid,uuid,uuid,uuid,date,date,uuid) from public,anon,authenticated,service_role;

do $period_delegated_source_permissions$
declare signature text;function_meta pg_proc%rowtype;expected_owner oid;checked_role text;
begin
  select oid into expected_owner from pg_roles where rolname=current_user;
  foreach signature in array array[
    'public.faolla_attendance_pd_binding_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_shift_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_coverage_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_adoptions_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_exception_legacy_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_exception_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_posthoc_preview_v1(jsonb,uuid,integer,uuid)',
    'public.faolla_attendance_pd_posthoc_read_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_formal_facts_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_formal_source_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_report_v1(text,uuid,jsonb)',
    'public.faolla_attendance_pd_unified_v1(text,uuid,jsonb)',
    'public.faolla_attendance_pd_fixed_report_v1(text,uuid,jsonb,jsonb)',
    'public.faolla_attendance_pd_fixed_unified_v1(text,uuid,jsonb,jsonb)',
    'public.faolla_attendance_pd_source_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_fixed_source_v1(jsonb,uuid)',
    'public.faolla_attendance_pd_envelope_v1(jsonb,uuid)',
    'public.faolla_attendance_period_delegated_source_v1(text,uuid,uuid,uuid,uuid,date,date,uuid)'
  ] loop
    select * into function_meta from pg_proc where oid=to_regprocedure(signature);
    if function_meta.oid is null or function_meta.proowner is distinct from expected_owner or function_meta.prosecdef
      or function_meta.prorettype is distinct from 'jsonb'::regtype or function_meta.proretset
      or function_meta.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or function_meta.provolatile is distinct from 'v'
      or function_meta.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
      or exists(select 1 from aclexplode(coalesce(function_meta.proacl,acldefault('f',function_meta.proowner))) a where a.grantee<>function_meta.proowner and a.privilege_type='EXECUTE') then
      raise exception 'merchant_attendance_period_delegated_source_acl_failed';
    end if;
    foreach checked_role in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(checked_role,function_meta.oid,'EXECUTE') then raise exception 'merchant_attendance_period_delegated_source_acl_failed';end if;
    end loop;
  end loop;
end;
$period_delegated_source_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610080184,'merchant_attendance_period_delegated_source') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
