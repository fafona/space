-- C15-A independent administrative review. Additive; never changes raw hours,
-- old decisions, payroll, period sources/artifacts, notifications or writers.
-- Default-off writes. Private source bytes never leave the Node projection.
begin;
set local lock_timeout='3s';

-- The exact function/table/ACL manifests below are checked BEFORE replacing any
-- own definition. Old195 collector bodies are pinned, copied, never modified.
--199 PREFLIGHT START
do $day_review_prerequisites$
begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610060173 and name='merchant_attendance_plan_posthoc_formal_source')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610070179 and name='merchant_attendance_outage_periods')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations')
  then raise exception 'merchant_attendance_day_review_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080199 and name<>'merchant_attendance_day_reviews')
  or exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission') then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
end;
$day_review_prerequisites$;
--Empty transaction-local parser templates only. TEMP FKs reference TEMP
--skeletons; no permanent facts/DDL and no persisted manifest side table.
create temp table faolla_day_review_expected_settings(merchant_id text primary key) on commit drop;
create temp table faolla_day_review_expected_workers(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
create temp table faolla_day_review_expected_employees(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
create temp table merchant_attendance_day_review_cases(
 merchant_id text not null,case_id uuid not null,worker_id uuid not null,employee_id uuid not null,
 employee_auth_user_id uuid not null,kind text not null,work_date date not null,time_zone text not null,
 start_at timestamptz not null,end_at timestamptz not null,slot_id uuid,opened_at timestamptz not null,target jsonb not null,
 constraint day_review_cases_pk primary key(merchant_id,case_id),
 constraint day_review_cases_site_fk foreign key(merchant_id) references pg_temp.faolla_day_review_expected_settings(merchant_id),
 constraint day_review_cases_worker_fk foreign key(merchant_id,worker_id) references pg_temp.faolla_day_review_expected_workers(merchant_id,id),
 constraint day_review_cases_employee_fk foreign key(merchant_id,employee_id) references pg_temp.faolla_day_review_expected_employees(merchant_id,id),
 constraint day_review_cases_frame_ck check(kind in('day','plan') and (kind='day')=(slot_id is null)
  and work_date between date '2000-01-01' and date '2100-12-31' and isfinite(start_at) and isfinite(end_at) and isfinite(opened_at)
  and start_at<end_at and end_at-start_at<=case when kind='day' then interval '48 hours' else interval '24 hours' end),
 constraint day_review_cases_target_ck check(jsonb_typeof(target)='object' and octet_length(convert_to(target::text,'UTF8'))<=4096)
) on commit drop;
create temp table merchant_attendance_day_review_entries(
 merchant_id text not null,operation_id uuid not null,case_id uuid not null,revision bigint not null,
 actor_auth_user_id uuid not null,action text not null,query jsonb not null,command jsonb not null,
 command_fingerprint text not null,entry jsonb not null,canonical jsonb,source_text text,source_fingerprint text,
 normalized_input jsonb,recorded_at timestamptz not null,
 constraint day_review_entries_pk primary key(merchant_id,operation_id),
 constraint day_review_entries_stream_uq unique(merchant_id,case_id,revision),
 constraint day_review_entries_case_fk foreign key(merchant_id,case_id) references pg_temp.merchant_attendance_day_review_cases(merchant_id,case_id),
 constraint day_review_entries_revision_ck check(revision between 1 and 9007199254740990 and isfinite(recorded_at)),
 constraint day_review_entries_source_ck check(action in('decide','explain','dispute') and command_fingerprint~'^[0-9a-f]{64}$'
  and ((action='decide' and canonical is not null and source_text is not null and source_fingerprint is not null and source_fingerprint~'^[0-9a-f]{64}$' and normalized_input is not null)
   or (action<>'decide' and canonical is null and source_text is null and source_fingerprint is null and normalized_input is null))),
 constraint day_review_entries_bytes_ck check(octet_length(convert_to(jsonb_build_array(query,command,entry)::text,'UTF8'))<=16384
  and (source_text is null or octet_length(convert_to(source_text,'UTF8'))<=1048576)
  and (normalized_input is null or octet_length(convert_to(normalized_input::text,'UTF8'))<=262144))
) on commit drop;
create unique index attendance_day_review_day_uq on pg_temp.merchant_attendance_day_review_cases(merchant_id,worker_id,work_date) where kind='day';
create unique index attendance_day_review_plan_uq on pg_temp.merchant_attendance_day_review_cases(merchant_id,worker_id,slot_id) where kind='plan';
create index attendance_day_review_owner_idx on pg_temp.merchant_attendance_day_review_cases(merchant_id,opened_at desc,case_id desc);
create index attendance_day_review_worker_idx on pg_temp.merchant_attendance_day_review_cases(merchant_id,worker_id,opened_at desc,case_id desc);
create index attendance_day_review_self_idx on pg_temp.merchant_attendance_day_review_cases(merchant_id,employee_auth_user_id,employee_id,opened_at desc,case_id desc);
do $day_review_preflight$
declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;signature text;f regprocedure;meta record;table_name text;role_name text;
 actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record;
 own_spec jsonb;
begin
 select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_day_review_owner_conflict';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080199 and name='merchant_attendance_day_reviews');
 own_spec:=$day_review_dependencies$[{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_scalar_v1","signature":"public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)","hash":"3d17c1dc4359ef24d5da51b926bc586f857d0b67b6cffda92869015accf3f7f0","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","kind"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"legacyHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc"},{"name":"faolla_attendance_control_day_boundary_v1","signature":"public.faolla_attendance_control_day_boundary_v1(date,text)","hash":"6c1479bd60a7349acc92fe7a2b7552509751e65be5651cc48d102c00834164a8","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_date","p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_closure_unified_report_v1","signature":"public.faolla_attendance_period_closure_unified_report_v1(text,uuid,jsonb,jsonb)","hash":"e113571f21684a514ea5be8536debbc97fc4096601fe6af91f8e01213ce0b775","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site_id","p_auth_user_id","p_query","p_frame"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_boundary_v1","signature":"public.faolla_attendance_administrative_boundary_v1(text,uuid,uuid)","hash":"30f4e7c06f9fd44bd90e321ae8f7f7ec44638ba50e6092ae27cc967dfce196bb","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_start"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_session_v1","signature":"public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamptz)","hash":"d23cef1c4a301f655e3e9d43425671c0b56c5a598062302d25f851b3071d23e2","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_start","p_employee","p_member_auth","p_observed"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_self_schedule_slot_v1","signature":"public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)","hash":"3ea9205bf464f28cde58da98db82c863584e5287c529e3c5a26ae272fb6c374d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_plan_rule_v1","signature":"public.faolla_attendance_period_plan_rule_v1(text,uuid,uuid,uuid,uuid,uuid)","hash":"14c5ebcc0ab24aa7cd9334633c76a3bd82484e894b17877168409618651f0e17","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_slot","p_employee","p_member_auth","p_operation"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_leave_summary_v1","signature":"public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)","hash":"5df82b03753c90636b8fd9fce15384560490c4f5996fafe1df76ec9e75b09fa6","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_calendar_summary_v1","signature":"public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer)","hash":"4ffd6f0aaeb6c489707e8ec1d4b17d074fdf3c6f3a3e2e8d028e303545b66858","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_proposal_v1","signature":"public.faolla_attendance_correction_proposal_v1(jsonb,timestamptz)","hash":"d389ec334e368ecb2afcf44ad1a37ff39af028536fff6b30a64d72ca3ad3da9d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_value","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_instant_v1","signature":"public.faolla_attendance_instant_v1(text)","hash":"feba243fa6d87442defe285e3c9e4789bae5671c18d09cecb7c65dae6dffe5a5","result":"timestamptz","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_value"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_operation_v1","signature":"public.faolla_attendance_plan_posthoc_operation_v1(public.merchant_attendance_plan_posthoc_operations)","hash":"eb59e0f4bc1b509cfd81551717c10f8a45870cbf25df1a63abbbd161408f5cad","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_review_entry_v1","signature":"public.faolla_attendance_plan_exception_review_entry_v1(public.merchant_attendance_plan_exception_entries)","hash":"044e220ca14f67ae05dd30b6b2e88a7d653e74cd1a1926b2496326d4be2d787b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_formal_source_v1","signature":"public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid)","hash":"7794ff1971454006e2410476c4848faf3972d0e8bb67039c9acfb13dc32c7d64","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_exception_source_v1","signature":"public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)","hash":"1234394b481e1e3063d6a12d83bf606e11be1cb8d64b4b86ea194091eb5334b1","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_administrative_source_result_v1","signature":"public.faolla_attendance_administrative_source_result_v1(jsonb)","hash":"4466f706cd31a515157c9f1e2d926fecb264d09944181fc0fb6381d32e24f4ec","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_canonical_v1","signature":"public.faolla_attendance_period_canonical_v1(jsonb)","hash":"e8d106312d2058d92f5976d63e74bb543f22ac5b38c04fe9b3513278590cd8a8","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_context_v1","signature":"public.faolla_attendance_work_arrangement_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz)","hash":"dfdfcdbffb8db9855c91ce3189e4ef8e049cb758b40727d2b4713fdcef8ae21d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_member_auth","p_from","p_to"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_outage_period_context_v1","signature":"public.faolla_attendance_outage_period_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz)","hash":"a96540f582439a515716e38672a7aac67253fc529ebd45482c0a35728126e573","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_employee_auth","p_from","p_to"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_missing_v1","signature":"public.faolla_attendance_plan_posthoc_missing_v1(text,uuid,uuid,uuid,uuid)","hash":"c2dd4efcde6b512a2a5a4f00807287fb1173c3ed3127bf2b10b679b35b24f3d3","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_auth","p_request"],"searchPath":"search_path=pg_catalog","isRpc":false}]$day_review_dependencies$::jsonb;
 
 for spec in select value from jsonb_array_elements(own_spec) loop
  signature:=replace(spec->>'signature','public.',ns||'.');f:=to_regprocedure(signature);
  select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(spec->>'result') or meta.proretset or meta.proisstrict or meta.proleakproof
   or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid or meta.proallargtypes is not null or meta.proargmodes is not null
   or meta.pronargs<>jsonb_array_length(spec->'args') or meta.procost<>100 or meta.prorows<>0
   or meta.pronargdefaults<>(spec->>'defaults')::integer or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from
    (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then spec->>'legacyHash' else spec->>'hash' end)
   then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
  if has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  if spec->>'name'<>'faolla_valid_merchant_enterprise_permissions_v1' then
   if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
    or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
    or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl
     where acl.grantor<>expected_owner or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true
      or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
    then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  end if;
 end loop;
 if (select count(*) from pg_proc p where p.pronamespace=(select oid from pg_namespace where nspname=ns) and p.proname like 'faolla_attendance_day_review_%')<>(case when installed then 15 else 0 end)
  or (to_regclass(ns||'.merchant_attendance_day_review_cases') is not null)<>installed or (to_regclass(ns||'.merchant_attendance_day_review_entries') is not null)<>installed then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
 if not installed then return;end if;
 own_spec:=$day_review_own$[{"name":"faolla_attendance_day_review_target_v1","signature":"public.faolla_attendance_day_review_target_v1(public.merchant_attendance_day_review_cases)","hash":"d58b3b344473b8c52894801d4a809b1da993d4e594c4eebf94703fba496fe268","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_query_v1","signature":"public.faolla_attendance_day_review_query_v1(jsonb)","hash":"24fd10bdcba554a7682ff1506e4ab6eecc8e0809c48ccd1d68ad9a83b3de4908","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_command_v1","signature":"public.faolla_attendance_day_review_command_v1(jsonb,jsonb)","hash":"0de6669f595c37ac321a96356e1cdad51b55698b9b73961d264d3d672e376013","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["q","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_fingerprint_v1","signature":"public.faolla_attendance_day_review_fingerprint_v1(jsonb,uuid,jsonb)","hash":"ae76c825b8237fa52febd79c8871d0ab2e16fd234d9f5620d85e47d73bc8c215","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["q","a","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_receipt_v1","signature":"public.faolla_attendance_day_review_receipt_v1(public.merchant_attendance_day_review_entries)","hash":"38ee6ade7125c891937b9d5efe836ae3a0ca80a262df707b9eaaf0b2e7aba962","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_head_v1","signature":"public.faolla_attendance_day_review_head_v1(public.merchant_attendance_day_review_cases)","hash":"c78687653e92d746df4c116d9c33ecb7535eefa4c70d1343fe66c85a9b457351","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_day_base_v1","signature":"public.faolla_attendance_day_review_day_base_v1(jsonb,uuid)","hash":"3e8e5dd9bf7cab5c645975746bab4e95032d349bed72945b5e3c0711f858796a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_day_source_v1","signature":"public.faolla_attendance_day_review_day_source_v1(jsonb,uuid)","hash":"db59a6d23ab2be06dad98dad9b138e3f52455945488ed4f641e38e3ced5e9c0a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_stamp_v1","signature":"public.faolla_attendance_day_review_stamp_v1(timestamptz)","hash":"a2a16b078eed3497d2a643a8039e5ecae3a99ae581f47c40b8f0e0190b58e249","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_span_v1","signature":"public.faolla_attendance_day_review_span_v1(jsonb)","hash":"3d9631cc8b2cd6735b3764f729baff6fb9dc7cbc68ab421a7a518d1c27c8c21d","result":"jsonb","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_record_v1","signature":"public.faolla_attendance_day_review_record_v1(jsonb,jsonb,jsonb)","hash":"29f90d3f6b954ee76e2b8ab649d5618d5e8ee7f9103bcaef255b4de1ab8ba550","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["t","p","association"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_source_v1","signature":"public.faolla_attendance_day_review_source_v1(jsonb,uuid)","hash":"39c5a44db3b6f11282b6281026718f66cd39e6f9a3aeb9168074fad53b89b1ef","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["q","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_compute_v1","signature":"public.faolla_attendance_day_review_compute_v1(jsonb)","hash":"86b38fb20cbbbca79fedf1de012be61993f4cc3f1ef9c89854a4d61175c1b84b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_v1","signature":"public.faolla_attendance_day_review_v1(jsonb,uuid,jsonb,boolean)","hash":"da8fa3b1460225f19c80758aa4b2398ac05caf99e86a8d7251e5f9fcc70a335f","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_day_review_guard_v1","signature":"public.faolla_attendance_day_review_guard_v1()","hash":"0f6052b8694fb667e3737c01676d348168175744940385769297bbc49018c51e","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}]$day_review_own$::jsonb;
 
 for spec in select value from jsonb_array_elements(own_spec) loop
  signature:=replace(spec->>'signature','public.',ns||'.');f:=to_regprocedure(signature);
  select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(spec->>'result') or meta.proretset or meta.proisstrict or meta.proleakproof
   or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid or meta.proallargtypes is not null or meta.proargmodes is not null
   or meta.pronargs<>jsonb_array_length(spec->'args') or meta.procost<>100 or meta.prorows<>0
   or meta.pronargdefaults<>(spec->>'defaults')::integer or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from
    (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then spec->>'legacyHash' else spec->>'hash' end)
   then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
  if has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  if spec->>'name'<>'faolla_valid_merchant_enterprise_permissions_v1' then
   if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
    or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
    or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl
     where acl.grantor<>expected_owner or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true
      or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
    then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  end if;
 end loop;
 
 foreach table_name in array array['merchant_attendance_day_review_cases','merchant_attendance_day_review_entries'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
    where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
     is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation))
   then raise exception 'merchant_attendance_day_review_table_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,actual_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_day_review_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.faolla_day_review_expected_settings') then to_regclass(ns||'.merchant_attendance_settings')
    when to_regclass('pg_temp.faolla_day_review_expected_workers') then to_regclass(ns||'.merchant_attendance_workers')
    when to_regclass('pg_temp.faolla_day_review_expected_employees') then to_regclass(ns||'.merchant_enterprise_employees')
    when to_regclass('pg_temp.merchant_attendance_day_review_cases') then to_regclass(ns||'.merchant_attendance_day_review_cases') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit)
    is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_day_review_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_day_review_index_conflict';end if;
  for index_spec in select i.*,index_table.relname,index_table.relam from pg_index i join pg_class index_table on index_table.oid=i.indexrelid where i.indrelid=expected_table loop
   select i.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index i join pg_class index_table on index_table.oid=i.indexrelid where i.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
    is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table)
    or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_day_review_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_day_review_trigger_conflict';end if;
 end loop;
 for trigger_spec in select * from (values
  ('merchant_attendance_day_review_cases','day_review_case_pair',5,true),('merchant_attendance_day_review_cases','day_review_case_immutable',27,false),('merchant_attendance_day_review_cases','day_review_case_no_truncate',34,false),
  ('merchant_attendance_day_review_entries','day_review_entry_proof',7,false),('merchant_attendance_day_review_entries','day_review_entry_immutable',27,false),('merchant_attendance_day_review_entries','day_review_entry_no_truncate',34,false)
 ) t(table_name,trigger_name,kind,deferred) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(ns||'.'||trigger_spec.table_name) and tgname=trigger_spec.trigger_name and tgtype=trigger_spec.kind and tgenabled='O' and tgnargs=0 and tgqual is null
   and tgdeferrable=trigger_spec.deferred and tginitdeferred=trigger_spec.deferred and tgfoid=to_regprocedure(ns||'.faolla_attendance_day_review_guard_v1()')) then raise exception 'merchant_attendance_day_review_trigger_conflict';end if;
 end loop;
end;
$day_review_preflight$;
--199 PREFLIGHT END

create table if not exists public.merchant_attendance_day_review_cases(
 merchant_id text not null,case_id uuid not null,worker_id uuid not null,employee_id uuid not null,
 employee_auth_user_id uuid not null,kind text not null,work_date date not null,time_zone text not null,
 start_at timestamptz not null,end_at timestamptz not null,slot_id uuid,opened_at timestamptz not null,target jsonb not null,
 constraint day_review_cases_pk primary key(merchant_id,case_id),
 constraint day_review_cases_site_fk foreign key(merchant_id) references public.merchant_attendance_settings(merchant_id),
 constraint day_review_cases_worker_fk foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
 constraint day_review_cases_employee_fk foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
 constraint day_review_cases_frame_ck check(kind in('day','plan') and (kind='day')=(slot_id is null)
  and work_date between date '2000-01-01' and date '2100-12-31' and isfinite(start_at) and isfinite(end_at) and isfinite(opened_at)
  and start_at<end_at and end_at-start_at<=case when kind='day' then interval '48 hours' else interval '24 hours' end),
 constraint day_review_cases_target_ck check(jsonb_typeof(target)='object' and octet_length(convert_to(target::text,'UTF8'))<=4096)
);
create unique index if not exists attendance_day_review_day_uq on public.merchant_attendance_day_review_cases(merchant_id,worker_id,work_date) where kind='day';
create unique index if not exists attendance_day_review_plan_uq on public.merchant_attendance_day_review_cases(merchant_id,worker_id,slot_id) where kind='plan';
create index if not exists attendance_day_review_owner_idx on public.merchant_attendance_day_review_cases(merchant_id,opened_at desc,case_id desc);
create index if not exists attendance_day_review_worker_idx on public.merchant_attendance_day_review_cases(merchant_id,worker_id,opened_at desc,case_id desc);
create index if not exists attendance_day_review_self_idx on public.merchant_attendance_day_review_cases(merchant_id,employee_auth_user_id,employee_id,opened_at desc,case_id desc);

create table if not exists public.merchant_attendance_day_review_entries(
 merchant_id text not null,operation_id uuid not null,case_id uuid not null,revision bigint not null,
 actor_auth_user_id uuid not null,action text not null,query jsonb not null,command jsonb not null,
 command_fingerprint text not null,entry jsonb not null,canonical jsonb,source_text text,source_fingerprint text,
 normalized_input jsonb,recorded_at timestamptz not null,
 constraint day_review_entries_pk primary key(merchant_id,operation_id),
 constraint day_review_entries_stream_uq unique(merchant_id,case_id,revision),
 constraint day_review_entries_case_fk foreign key(merchant_id,case_id) references public.merchant_attendance_day_review_cases(merchant_id,case_id),
 constraint day_review_entries_revision_ck check(revision between 1 and 9007199254740990 and isfinite(recorded_at)),
 constraint day_review_entries_source_ck check(action in('decide','explain','dispute') and command_fingerprint~'^[0-9a-f]{64}$'
  and ((action='decide' and canonical is not null and source_text is not null and source_fingerprint is not null and source_fingerprint~'^[0-9a-f]{64}$' and normalized_input is not null)
   or (action<>'decide' and canonical is null and source_text is null and source_fingerprint is null and normalized_input is null))),
 constraint day_review_entries_bytes_ck check(octet_length(convert_to(jsonb_build_array(query,command,entry)::text,'UTF8'))<=16384
  and (source_text is null or octet_length(convert_to(source_text,'UTF8'))<=1048576)
  and (normalized_input is null or octet_length(convert_to(normalized_input::text,'UTF8'))<=262144))
);
alter table public.merchant_attendance_day_review_cases enable row level security;
alter table public.merchant_attendance_day_review_entries enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_day_review_cases'::regclass,
      'public.merchant_attendance_day_review_entries'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_day_review_cases,public.merchant_attendance_day_review_entries from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_day_review_target_v1(p public.merchant_attendance_day_review_cases)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('kind',p.kind,'workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,
  'workDate',p.work_date,'timeZone',p.time_zone,'fromAt',to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'toAt',to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'slotId',p.slot_id)
$$;
create or replace function public.faolla_attendance_day_review_query_v1(p jsonb)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare mode text:=p->>'mode';keys text[];k text;
begin
 if p is null or octet_length(convert_to(p::text,'UTF8'))>8192 or jsonb_typeof(p->'siteId') is distinct from 'string'
  or length(p->>'siteId')<>8 or p->>'siteId'!~'^[0-9]{8}$' then raise exception 'attendance_invalid_request';end if;
 keys:=case mode when 'candidates' then array['siteId','access','mode','workerId','workDate']
  when 'preview' then array['siteId','access','mode','workerId','workDate','slotId','caseId']
  when 'list' then array['siteId','access','mode','workerId','cursor'] when 'detail' then array['siteId','access','mode','caseId']
  when 'history' then array['siteId','access','mode','caseId','beforeRevision'] when 'recover' then array['siteId','mode','operationId'] else null end;
 if keys is null or public.faolla_attendance_shift_rule_binding_object_v1(p,keys) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode='recover' then
  if public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;return;
 end if;
 if p->>'access' not in('owner','self') or jsonb_typeof(p->'access') is distinct from 'string'
  or mode in('candidates','preview') and p->>'access'<>'owner' then raise exception 'attendance_invalid_request';end if;
 foreach k in array array['workerId','caseId','slotId'] loop
  if p ? k and p->k<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 end loop;
 if mode in('candidates','preview') and (p->'workerId'='null'::jsonb or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'workDate','date') is distinct from true)
  or mode in('detail','history') and p->'caseId'='null'::jsonb
  or mode='list' and p->>'access'='self' and p->'workerId'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
 if mode='history' and p->'beforeRevision'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p->'beforeRevision','version') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode='list' and p->'cursor'<>'null'::jsonb and (
  public.faolla_attendance_shift_rule_binding_object_v1(p->'cursor',array['openedAt','caseId']) is distinct from true
  or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'cursor'->'openedAt','stamp6') is distinct from true
  or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'cursor'->'caseId','uuid') is distinct from true) then raise exception 'attendance_invalid_request';end if;
end;
$$;
create or replace function public.faolla_attendance_day_review_command_v1(q jsonb,c jsonb)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare action text:=c->>'action';k text;outcome text:=c->>'outcome';
begin
 perform public.faolla_attendance_day_review_query_v1(q);
 if c is null or octet_length(convert_to(jsonb_build_object('query',q,'command',c)::text,'UTF8'))>8192
  or public.faolla_attendance_shift_rule_binding_scalar_v1(c->'operationId','uuid') is distinct from true
  or jsonb_typeof(c->'reason') is distinct from 'string'
  or public.faolla_attendance_group_text_v1(c->>'reason',1,1000) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if action='decide' then
  if q->>'mode'<>'preview' or q->>'access'<>'owner'
   or public.faolla_attendance_shift_rule_binding_object_v1(c,array['action','operationId','caseId','expectedRevision','workerId','employeeId','employeeAuthUserId','expectedFingerprint','outcome','calendarReference','selfStatementOperationId','reason']) is distinct from true
   or public.faolla_attendance_shift_rule_binding_scalar_v1(c->'expectedRevision','head') is distinct from true
   or (q->'caseId'='null'::jsonb) is distinct from (c->'expectedRevision'='0'::jsonb)
   or q->'caseId'<>'null'::jsonb and q->'caseId' is distinct from c->'caseId'
   or q->'workerId' is distinct from c->'workerId'
   or jsonb_typeof(c->'expectedFingerprint') is distinct from 'string' or c->>'expectedFingerprint'!~'^[0-9a-f]{64}$'
   or outcome is null or outcome not in('follow_up','calendar_exempt','not_worked_reported','recorded_work_reviewed') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['caseId','workerId','employeeId','employeeAuthUserId'] loop
   if public.faolla_attendance_shift_rule_binding_scalar_v1(c->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if (outcome='calendar_exempt') is distinct from (c->'calendarReference'<>'null'::jsonb)
   or (outcome='not_worked_reported') is distinct from (c->'selfStatementOperationId'<>'null'::jsonb)
   or outcome='calendar_exempt' and q->'slotId'='null'::jsonb
   or outcome='not_worked_reported' and q->'caseId'='null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if c->'calendarReference'<>'null'::jsonb and (
   public.faolla_attendance_shift_rule_binding_object_v1(c->'calendarReference',array['entryId','operationId','revision']) is distinct from true
   or public.faolla_attendance_shift_rule_binding_scalar_v1(c->'calendarReference'->'entryId','uuid') is distinct from true
   or c->'calendarReference'->'entryId' is distinct from c->'calendarReference'->'operationId'
   or c->'calendarReference'->'revision' is distinct from '1'::jsonb) then raise exception 'attendance_invalid_request';end if;
  if c->'selfStatementOperationId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(c->'selfStatementOperationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 elsif action in('explain','dispute') then
  if q->>'mode'<>'detail' or q->>'access'<>'self'
   or public.faolla_attendance_shift_rule_binding_object_v1(c,array['action','operationId','expectedRevision','decisionOperationId','claim','reason']) is distinct from true
   or public.faolla_attendance_shift_rule_binding_scalar_v1(c->'expectedRevision','version') is distinct from true
   or public.faolla_attendance_shift_rule_binding_scalar_v1(c->'decisionOperationId','uuid') is distinct from true
   or c->'decisionOperationId'=c->'operationId'
   or action='dispute' and c->'claim'<>'null'::jsonb
   or action='explain' and (jsonb_typeof(c->'claim') is distinct from 'string' or c->>'claim' not in('worked_missing_records','not_worked','uncertain')) then raise exception 'attendance_invalid_request';end if;
 else raise exception 'attendance_invalid_request';end if;
end;
$$;
create or replace function public.faolla_attendance_day_review_fingerprint_v1(q jsonb,a uuid,c jsonb)
returns text language plpgsql stable set search_path=pg_catalog as $$
declare frame jsonb;tuple jsonb;
begin
 perform public.faolla_attendance_day_review_command_v1(q,c);if a is null then raise exception 'attendance_invalid_request';end if;
 frame:=case when q->>'mode'='preview' then jsonb_build_array(q->'mode',q->'access',q->'workerId',q->'workDate',q->'slotId',q->'caseId')
  else jsonb_build_array(q->'mode',q->'access',q->'caseId') end;
 tuple:=case when c->>'action'='decide' then jsonb_build_array(c->'action',c->'operationId',c->'caseId',c->'expectedRevision',c->'workerId',c->'employeeId',c->'employeeAuthUserId',c->'expectedFingerprint',c->'outcome',
  case when c->'calendarReference'='null'::jsonb then null else jsonb_build_array(c->'calendarReference'->'entryId',c->'calendarReference'->'operationId',c->'calendarReference'->'revision') end,c->'selfStatementOperationId',c->'reason')
  else jsonb_build_array(c->'action',c->'operationId',c->'expectedRevision',c->'decisionOperationId',c->'claim',c->'reason') end;
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-day-review-command-v1',q->'siteId',a,frame,tuple));
end;
$$;
create or replace function public.faolla_attendance_day_review_receipt_v1(p public.merchant_attendance_day_review_entries)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('operationId',p.operation_id,'caseId',p.case_id,'revision',p.revision,'action',p.action,'actorId',p.actor_auth_user_id,
  'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',p.command_fingerprint)
$$;
create or replace function public.faolla_attendance_day_review_head_v1(p public.merchant_attendance_day_review_cases)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare h public.merchant_attendance_day_review_entries%rowtype;d public.merchant_attendance_day_review_entries%rowtype;
begin
 select * into h from public.merchant_attendance_day_review_entries where merchant_id=p.merchant_id and case_id=p.case_id order by revision desc limit 1;
 select * into d from public.merchant_attendance_day_review_entries where merchant_id=p.merchant_id and case_id=p.case_id and action='decide' order by revision desc limit 1;
 if h.operation_id is null or d.operation_id is null or d.revision>h.revision then raise exception 'attendance_day_review_invalid';end if;
 return jsonb_build_object('caseId',p.case_id,'target',p.target,'openedAt',to_char(p.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'revision',h.revision,'latestDecision',d.entry,'latestSelf',case when h.action='decide' then null else h.entry end,'needsResponse',h.action<>'decide');
end;
$$;

create or replace function public.faolla_attendance_day_review_day_base_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare
  administrative_value jsonb;
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
  day_case public.merchant_attendance_day_review_cases%rowtype;
  fixed_frame jsonb;fixed_zone text;fixed_days jsonb;requested_case uuid;
  --175 posthoc declarations begin.
  posthoc_head public.merchant_attendance_plan_posthoc_operations%rowtype;posthoc_context jsonb:='[]';posthoc_snapshot jsonb;has_posthoc boolean:=false;
  --175 posthoc declarations end.
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or octet_length(convert_to(p_query::text,'UTF8'))>8192
    or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','mode','workerId','workDate','slotId','caseId']) is distinct from true
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or p_query->>'access' is distinct from 'owner' or p_query->>'mode' is distinct from 'preview'
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_group_date_v1(p_query->>'workDate') is distinct from true
    or p_query->'slotId' is distinct from 'null'::jsonb
    or (p_query->'caseId'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'caseId','uuid') is distinct from true)
    then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;access_name:='owner';
  first_day:=(p_query->>'workDate')::date;last_day:=first_day;requested_case:=(p_query->>'caseId')::uuid;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
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
  --199 own immutable DAY frame. A case UUID is not a period identity.
  --Authorization/settings/worker/employee locks were acquired by the exact
  --pinned collector above. Never turn a missing requested case into a new day.
  if requested_case is not null then
    select * into day_case from public.merchant_attendance_day_review_cases
      where merchant_id=site and case_id=requested_case;
    if day_case.case_id is null then raise exception 'attendance_day_review_not_found';end if;
    if day_case.worker_id is distinct from wid or day_case.kind is distinct from 'day'
      or day_case.work_date is distinct from first_day or day_case.slot_id is not null
      then raise exception 'attendance_access_denied';end if;
    if day_case.employee_id is distinct from emp.id or day_case.employee_auth_user_id is distinct from emp.auth_user_id
      then raise exception 'attendance_day_review_identity_changed';end if;
    fixed_zone:=day_case.time_zone;a:=day_case.start_at;b:=day_case.end_at;
    --No current timezone calculation for a saved case. Its UTC endpoints are
    --immutable data, including the originally observed civil DST boundaries.
  else
    fixed_zone:=s.time_zone;
    a:=public.faolla_attendance_control_day_boundary_v1(first_day,fixed_zone);
    b:=public.faolla_attendance_control_day_boundary_v1(first_day+1,fixed_zone);
  end if;
  if a>=b or b-a>interval '48 hours' then raise exception 'attendance_day_review_invalid';end if;
  fixed_frame:=jsonb_build_object('timeZone',fixed_zone,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt));
  fixed_days:=jsonb_build_array(jsonb_build_object('date',first_day,'fromAt',fixed_frame->'fromAt','toAt',fixed_frame->'toAt','skipped',false));
  --199 own DAY frame ends. This is not a civil-day adapter for a clipped plan.
  report:=public.faolla_attendance_period_closure_unified_report_v1(site,p_auth_user_id,case when access_name='owner' then
    jsonb_build_object('access','owner','workerId',wid,'fromDate',first_day,'throughDate',last_day) else
    jsonb_build_object('access','self','workerId',null,'locationId',null,'expectedWorkerId',wid,'fromDate',first_day,'throughDate',last_day) end,fixed_frame);
  base:=report->'base';range_from:=(base->>'fromAt')::timestamptz;range_to:=(base->>'toAt')::timestamptz;observed:=(base->>'asOf')::timestamptz;
  if base->>'siteId' is distinct from site or base->>'workerId' is distinct from wid::text or base->>'employeeId' is distinct from emp.id::text
    or report->>'access' is distinct from access_name or report->>'complete' is distinct from 'true' or base->>'complete' is distinct from 'true'
    or report->>'payrollReady' is distinct from 'false' then raise exception 'attendance_period_source_invalid';end if;
  if range_to>observed then flags:=array_append(flags,'period_in_progress');end if;
  day_items:=fixed_days;
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
    administrative_value:=public.faolla_attendance_administrative_boundary_v1(site,wid,ev.id);
    select * into endpoint from (select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.sequence>=ev.sequence order by x.sequence limit 2003) tail
      where tail.action='clock_out' order by tail.sequence limit 1;
    select * into eff from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=ev.id;
    if not(ev.occurred_at<range_to and (ev.occurred_at>=range_from or coalesce((administrative_value->>'verifiedEndAt')::timestamptz,endpoint.occurred_at,observed)>range_from))
      and not(coalesce(eff.start_at<range_to and eff.end_at>range_from,false)) then continue;end if;
    if expected_report_count>=100 then raise exception 'attendance_period_source_too_large';end if;
    child:=public.faolla_attendance_period_session_v1(site,wid,ev.id,emp.id,emp.auth_user_id,observed);
    if not exists(select 1 from jsonb_array_elements(base->'items') x where x.value->>'startEventId'=ev.id::text) then raise exception 'attendance_period_source_identity_changed';end if;
    expected_report_count:=expected_report_count+1;report_ids:=array_append(report_ids,ev.id);session_ids:=array_append(session_ids,ev.id);sessions:=sessions||jsonb_build_array(child);
    total_events:=total_events+jsonb_array_length(child->'item'->'events');
    if child->'item'->'events'->-1->>'action'<>'clock_out' and coalesce(child->'item'->'administrativeBoundary','null'::jsonb)='null'::jsonb then flags:=array_append(flags,'open_session');end if;
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
      if child->'item'->'events'->-1->>'action'<>'clock_out' and coalesce(child->'item'->'administrativeBoundary','null'::jsonb)='null'::jsonb then flags:=array_append(flags,'open_session');end if;
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
        current_source:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
        exception when raise_exception then
          if sqlerrm=any(array['attendance_plan_posthoc_formal_invalid','attendance_plan_posthoc_evaluation_invalid',
            'attendance_plan_posthoc_adoption_invalid','attendance_plan_posthoc_adoption_changed']) then raise exception 'attendance_period_source_invalid';
          elsif sqlerrm=any(array['attendance_plan_posthoc_formal_too_large','attendance_plan_posthoc_evaluation_too_large',
            'attendance_plan_posthoc_adoption_too_large']) then raise exception 'attendance_period_source_too_large';
          elsif sqlerrm='attendance_worker_changed' then raise exception 'attendance_period_source_identity_changed';
          else raise;end if;
        end;
      else
      current_source:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
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
    'timeZone',fixed_zone,'fromDate',first_day,'throughDate',last_day,'fromAt',base->'fromAt','toAt',base->'toAt','readAt',to_char(read_at at time zone 'UTC',fmt),
    'dayBoundaries',day_items,'report',report,'context',context,'blockers',blockers,'complete',true,'validation',case when access_name='owner' then 'owner_checked' else 'self_not_checked' end);
  result:=public.faolla_attendance_administrative_source_result_v1(result);
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

create or replace function public.faolla_attendance_day_review_day_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare result jsonb;arrangements jsonb;outages jsonb;canonical jsonb;source_text text;
begin
  --175's collector authorizes and retains its original fixed-frame locks.
  result:=public.faolla_attendance_day_review_day_base_v1(p_query,p_auth_user_id);
  arrangements:=public.faolla_attendance_work_arrangement_context_v1(
    result->>'siteId',(result->>'workerId')::uuid,(result->>'employeeId')::uuid,(result->>'employeeAuthUserId')::uuid,
    (result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz);
  outages:=public.faolla_attendance_outage_period_context_v1(
    result->>'siteId',(result->>'workerId')::uuid,(result->>'employeeId')::uuid,(result->>'employeeAuthUserId')::uuid,
    (result->>'fromAt')::timestamptz,(result->>'toAt')::timestamptz);
  if arrangements='[]'::jsonb and outages='[]'::jsonb then return result;end if;
  if arrangements<>'[]'::jsonb then
    result:=jsonb_set(result,'{context,workArrangements}',arrangements)||jsonb_build_object('sourceVersion',case when result->>'sourceVersion' in('attendance-period-source-v3','attendance-period-source-v5') then result->>'sourceVersion' else 'attendance-period-source-v2' end);
    if exists(select 1 from jsonb_array_elements(arrangements) x where x->>'status'='submitted') then
      result:=jsonb_set(result,'{blockers}',(result->'blockers')||'["pending_work_arrangement"]'::jsonb);
    end if;
  end if;
  --No synthetic empty section and no v4 upgrade for an unrelated old period.
  if outages<>'[]'::jsonb then
    result:=jsonb_set(result,'{context,outages}',outages)||jsonb_build_object('sourceVersion',case when result->>'sourceVersion'='attendance-period-source-v5' then 'attendance-period-source-v5' else 'attendance-period-source-v4' end);
    if exists(select 1 from jsonb_array_elements(outages) x where x->'status'->'resolved' is distinct from 'true'::jsonb) then
      result:=jsonb_set(result,'{blockers}',(result->'blockers')||'["unresolved_outage"]'::jsonb);
    end if;
  end if;
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  return result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
end;
$$;

--All normalized timestamps are UTC with six fractional places, regardless of
--which supported older full collector supplied them. Never reinterpret an
--already saved IANA/civil frame under today's default location or tzdata.
create or replace function public.faolla_attendance_day_review_stamp_v1(p timestamptz)
returns text language sql immutable set search_path=pg_catalog as $$
 select case when p is null then null else to_char(p at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
$$;
create or replace function public.faolla_attendance_day_review_span_v1(p jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select case when p is null or p='null'::jsonb then null else jsonb_build_object(
  'startAt',public.faolla_attendance_day_review_stamp_v1((p->>'startAt')::timestamptz),
  'endAt',public.faolla_attendance_day_review_stamp_v1((p->>'endAt')::timestamptz)) end
$$;
--Only accepts the private proof returned by the existing, pinned full-session
--checker. Compact old source references are never treated as fresh endpoints.
create or replace function public.faolla_attendance_day_review_record_v1(t jsonb,p jsonb,association jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare item jsonb:=p->'item';events jsonb:=p->'item'->'events';effect jsonb:=nullif(p->'item'->'effect','null'::jsonb);
 original jsonb;selected jsonb;boundary jsonb:=nullif(p->'item'->'administrativeBoundary','null'::jsonb);
begin
 if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)<1 or jsonb_array_length(events)>2002
  or events->0->>'action' is distinct from 'clock_in' or events->0->'id' is distinct from item->'startEventId'
  then raise exception 'attendance_day_review_invalid';end if;
 original:=jsonb_build_object('startAt',public.faolla_attendance_day_review_stamp_v1((events->0->>'occurredAt')::timestamptz),
  'endAt',case when events->-1->>'action'='clock_out' then public.faolla_attendance_day_review_stamp_v1((events->-1->>'occurredAt')::timestamptz) else null end);
 selected:=case when effect is null then original else public.faolla_attendance_day_review_span_v1(effect->'proposal') end;
 if boundary is not null and (effect is not null or original->'endAt'<>'null'::jsonb or original is distinct from selected) then raise exception 'attendance_day_review_invalid';end if;
 return jsonb_build_object('kind','session','sourceId',item->'startEventId','operationId',effect->'operationId','revision',coalesce(effect->'revision','0'::jsonb),
  'workerId',t->'workerId','employeeId',t->'employeeId','employeeAuthUserId',t->'employeeAuthUserId',
  'locationId',events->0->'locationId','original',original,'selected',selected,'association',association,'administrativeBoundary',boundary);
end;
$$;
create or replace function public.faolla_attendance_day_review_source_v1(q jsonb,actor uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text:=q->>'siteId';wid uuid;sid uuid;raw jsonb;basis jsonb;context jsonb;outages jsonb:='[]';base_canonical jsonb;
 t jsonb;plans jsonb:='[]';records jsonb:='[]';calendars jsonb:='[]';pending jsonb:='[]';conflicts jsonb:='[]';arrangements jsonb:='[]';leaves jsonb:='[]';
 v jsonb;x jsonb;y jsonb;part jsonb;child jsonb;assoc jsonb;record_item jsonb;slot jsonb;ref jsonb;proof jsonb;observations jsonb:='[]';
 c public.merchant_attendance_day_review_cases%rowtype;missing_row public.merchant_attendance_missing_requests%rowtype;
 missing_entry public.merchant_attendance_missing_entries%rowtype;start_event public.merchant_attendance_events%rowtype;
 claim_row public.merchant_attendance_plan_posthoc_claims%rowtype;
 saved jsonb;head jsonb;case_head jsonb;facts jsonb;input jsonb;canonical jsonb;source_text text;fingerprint text;result jsonb;
 first_at timestamptz;last_at timestamptz;observed timestamptz;read_at timestamptz;current_source boolean:=true;key text;session_ids uuid[]:=array[]::uuid[];
 target_query jsonb;loc uuid;is_day boolean;position integer;other integer;record_end timestamptz;other_end timestamptz;
begin
 perform public.faolla_attendance_day_review_query_v1(q);
 if actor is null or q->>'access' is distinct from 'owner' or q->>'mode' not in('candidates','preview') then raise exception 'attendance_invalid_request';end if;
 wid:=(q->>'workerId')::uuid;sid:=(q->>'slotId')::uuid;is_day:=sid is null;
 target_query:=case when q->>'mode'='candidates' then q||jsonb_build_object('mode','preview','slotId',null,'caseId',null) else q end;
 if is_day then
  raw:=public.faolla_attendance_day_review_day_source_v1(target_query,actor);
  if raw->>'complete' is distinct from 'true' or raw->>'validation' is distinct from 'owner_checked' then raise exception 'attendance_day_review_ineligible';end if;
  context:=raw->'context';base_canonical:=raw->'sourceCanonical';observed:=(raw->>'readAt')::timestamptz;
  t:=jsonb_build_object('kind','day','workerId',wid,'employeeId',raw->'employeeId','employeeAuthUserId',raw->'employeeAuthUserId',
   'workDate',q->'workDate','timeZone',raw->'timeZone','fromAt',raw->'fromAt','toAt',raw->'toAt','slotId',null);
  for v in select value from jsonb_array_elements(context->'plans'->'items') loop
   slot:=v->'slot';
   --The full raw DAY context also retains related original slots outside this
   --day. Keep those in canonical evidence; normalized plan geometry is only
   --the intersecting whole slots required by the strict classifier contract.
   if (slot->>'startAt')::timestamptz>=(t->>'toAt')::timestamptz or (slot->>'endAt')::timestamptz<=(t->>'fromAt')::timestamptz then continue;end if;
   plans:=plans||jsonb_build_array(jsonb_build_object('slotId',slot->'id','revision',slot->'revision','workerId',wid,
    'employeeId',t->'employeeId','employeeAuthUserId',t->'employeeAuthUserId','locationId',slot->'locationId','workDate',slot->'workDate','timeZone',slot->'timeZone',
    'startAt',public.faolla_attendance_day_review_stamp_v1((slot->>'startAt')::timestamptz),'endAt',public.faolla_attendance_day_review_stamp_v1((slot->>'endAt')::timestamptz),
    'cancelled',slot->'cancelled','hasPublicationEvidence',slot->'hasPublicationEvidence'));
  end loop;
  for v in select value from jsonb_array_elements(raw->'report'->'base'->'items') loop
   child:=null;select value into child from jsonb_array_elements(context->'plans'->'sessions') where value->'item'->'startEventId'=v->'startEventId';
   if child is null or child->'item' is distinct from v then raise exception 'attendance_day_review_invalid';end if;
   assoc:=case when child->'relation'->>'status'='linked' and exists(select 1 from jsonb_array_elements(plans) p where p->'slotId'=child->'relation'->'selection'->'slotId')
    then jsonb_build_object('slotId',child->'relation'->'selection'->'slotId','operationId',child->'relation'->'operationId') else null end;
   records:=records||jsonb_build_array(public.faolla_attendance_day_review_record_v1(t,child,assoc));
  end loop;
  for v in select value from jsonb_array_elements(raw->'report'->'missing') loop
   x:=null;select value into x from jsonb_array_elements(context->'missing') where value->'requestId'=v->'requestId' and value->'operationId'=v->'operationId';
   if x is null or x->>'status' is distinct from 'approved' or x->>'isCurrentApproved' is distinct from 'true' then raise exception 'attendance_day_review_invalid';end if;
   records:=records||jsonb_build_array(jsonb_build_object('kind','missing','sourceId',v->'requestId','operationId',v->'operationId','revision',x->'revision',
    'workerId',wid,'employeeId',t->'employeeId','employeeAuthUserId',t->'employeeAuthUserId','locationId',v->'locationId',
    'original',null,'selected',public.faolla_attendance_day_review_span_v1(v->'proposal'),'association',null,'administrativeBoundary',null));
  end loop;
  --Explicit posthoc adoption is a real association only while its current
  --exclusive claim and exact latest reference/endpoints still match. An old
  --snapshot never associates a moved correction or a missing successor.
  for position in 0..jsonb_array_length(records)-1 loop
   record_item:=records->position;
   if record_item->'association'<>'null'::jsonb then continue;end if;
   assoc:=null;
   for v in select value from jsonb_array_elements(coalesce(context->'posthoc','[]'::jsonb)) where value->'current'->>'action'='apply' loop
    if not exists(select 1 from jsonb_array_elements(plans) p where p->'slotId'=v->'slotId') then continue;end if;
    for x in select value from jsonb_array_elements(v->'selected') loop
     ref:=x->'reference';
     if ref->'kind' is distinct from record_item->'kind'
      or record_item->>'kind'='session' and (ref->'startEventId' is distinct from record_item->'sourceId' or ref->'effectOperationId' is distinct from record_item->'operationId' or coalesce(ref->'effectRevision','0'::jsonb) is distinct from record_item->'revision')
      or record_item->>'kind'='missing' and (ref->'requestId' is distinct from record_item->'sourceId' or ref->'approvalOperationId' is distinct from record_item->'operationId')
      or public.faolla_attendance_day_review_span_v1(x->'original') is distinct from record_item->'original'
      or public.faolla_attendance_day_review_span_v1(x->'selected') is distinct from record_item->'selected' then continue;end if;
     select * into claim_row from public.merchant_attendance_plan_posthoc_claims pc where pc.merchant_id=site and pc.kind=record_item->>'kind'
      and pc.source_id=coalesce((ref->>'startEventId')::uuid,(ref->>'rootRequestId')::uuid);
     if row(claim_row.worker_id,claim_row.slot_id,claim_row.operation_id) is distinct from row(wid,(v->>'slotId')::uuid,(v->'current'->>'operationId')::uuid) then raise exception 'attendance_day_review_invalid';end if;
     if assoc is not null then raise exception 'attendance_day_review_invalid';end if;
     assoc:=jsonb_build_object('slotId',v->'slotId','operationId',v->'current'->'operationId');
    end loop;
   end loop;
   if assoc is not null then records:=jsonb_set(records,array[position::text,'association'],assoc);end if;
  end loop;
  for v in select value from jsonb_array_elements(context->'calendar') loop
   x:=v->'summary';calendars:=calendars||jsonb_build_array(jsonb_build_object('siteId',site,'entryId',x->'entryId','operationId',v->'operationId',
    'revision',x->'revision','kind',x->'kind','status',x->'status','locationId',x->'locationId','timeZone',x->'timeZone','fromDate',x->'fromDate','throughDate',x->'throughDate',
    'fromAt',v->'fromAt','toAt',v->'toAt','recordedAt',v->'recordedAt'));
  end loop;
  for v in select value from jsonb_array_elements(context->'leave') loop
   x:=v->'summary';leaves:=leaves||jsonb_build_array(x||jsonb_build_object('operationId',v->'operationId'));
  end loop;
  outages:=coalesce(context->'outages','[]'::jsonb);
 else
  raw:=public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',sid),actor);
  if raw->>'protocol' not in('plan-exception-source-v1','plan-exception-source-v2','plan-exception-source-v3')
   or raw->>'siteId' is distinct from site or raw->>'actorId' is distinct from actor::text then raise exception 'attendance_day_review_invalid';end if;
  base_canonical:=raw->'source';observed:=(raw->>'readAt')::timestamptz;slot:=raw->'slot';
  t:=jsonb_build_object('kind','plan','workerId',wid,'employeeId',raw->'worker'->'employeeId','employeeAuthUserId',raw->'worker'->'employeeAuthUserId',
   'workDate',slot->'workDate','timeZone',slot->'timeZone','fromAt',public.faolla_attendance_day_review_stamp_v1((slot->>'startAt')::timestamptz),
   'toAt',public.faolla_attendance_day_review_stamp_v1((slot->>'endAt')::timestamptz),'slotId',sid);
  if t->'workDate' is distinct from q->'workDate' then raise exception 'attendance_invalid_request';end if;
  if raw->>'protocol'='plan-exception-source-v3' then
   basis:=raw->'source'->'evaluation'->'basis';observations:=raw->'source'->'evaluation'->'observations';
   if raw->'source'->'evaluation'->'resolutionBlockers' ? 'context_unknown' then raise exception 'attendance_day_review_ineligible';end if;
   current_source:=not(raw->'source'->'evaluation'->'resolutionBlockers' ?| array['source_changed','source_unavailable']);
   leaves:=raw->'source'->'evaluation'->'leave'->'items';
   if raw->'source'->'evaluation'->'leave'->>'limited' is distinct from 'false' then raise exception 'attendance_day_review_ineligible';end if;
  else basis:=raw->'source';leaves:=basis->'context'->'leave'->'items';end if;
  context:=basis->'context';
  for part in select value from jsonb_each(context) loop
   if part->>'limited' is distinct from 'false' then raise exception 'attendance_day_review_ineligible';end if;
  end loop;
  plans:=jsonb_build_array(jsonb_build_object('slotId',sid,'revision',slot->'revision','workerId',wid,'employeeId',t->'employeeId','employeeAuthUserId',t->'employeeAuthUserId',
   'locationId',slot->'locationId','workDate',slot->'workDate','timeZone',slot->'timeZone','startAt',t->'fromAt','endAt',t->'toAt',
   'cancelled',slot->'cancelled','hasPublicationEvidence',slot->'hasPublicationEvidence'));
  --Complete basis PLUS every current point observation. Selected snapshots
  --are not a replacement for unrelated, pending or moved source candidates.
  session_ids:=array(select distinct id from (
   select (value->>'startEventId')::uuid id from jsonb_array_elements((basis->'sessions')||(context->'unassociated'->'items'))
   union all select (value->'current'->'reference'->>'startEventId')::uuid from jsonb_array_elements(observations)
    where value->'current'->'reference'->>'kind'='session') refs where id is not null order by id);
  if cardinality(session_ids)>100 then raise exception 'attendance_day_review_too_large';end if;
  foreach sid in array session_ids loop
   child:=public.faolla_attendance_period_session_v1(site,wid,sid,(t->>'employeeId')::uuid,(t->>'employeeAuthUserId')::uuid,observed);
   if child is null then raise exception 'attendance_day_review_ineligible';end if;
   assoc:=case when child->'relation'->>'status'='linked' and child->'relation'->'selection'->'slotId'=t->'slotId'
    then jsonb_build_object('slotId',t->'slotId','operationId',child->'relation'->'operationId') else null end;
   x:=null;select value->'current' into x from jsonb_array_elements(observations) where value->'current'->'reference'->>'startEventId'=sid::text;
   if x is not null and x->'claim'->'slotId'=t->'slotId' and x->'available'='true'::jsonb then
    assoc:=jsonb_build_object('slotId',t->'slotId','operationId',x->'claim'->'operationId');end if;
   record_item:=public.faolla_attendance_day_review_record_v1(t,child,assoc);
   if x is not null and (public.faolla_attendance_day_review_span_v1(x->'original') is distinct from record_item->'original'
    or public.faolla_attendance_day_review_span_v1(x->'selected') is distinct from record_item->'selected') then raise exception 'attendance_day_review_source_changed';end if;
   --159/173 compact legacy points have no administrative boundary. If their
   --NULL end admitted a shift actually closed before this slot, neither drop
   --that compact point into an apparently complete empty set nor extend it
   --to observed. This finite compatibility gap refuses all new decisions.
   if nullif(record_item->'administrativeBoundary','null'::jsonb) is not null
    and not (((record_item->'selected'->>'startAt')::timestamptz<(t->>'toAt')::timestamptz
      or (record_item->'original'->>'startAt')::timestamptz<(t->>'toAt')::timestamptz)
     and (record_item->'administrativeBoundary'->>'verifiedEndAt')::timestamptz>(t->>'fromAt')::timestamptz)
    then raise exception 'attendance_day_review_ineligible';end if;
   --A currently moved-out point is retained in raw canonical evidence but is
   --not falsely described as an intersecting full-slot work record.
   if (record_item->'selected'->>'startAt')::timestamptz<(t->>'toAt')::timestamptz
     and coalesce((record_item->'administrativeBoundary'->>'verifiedEndAt')::timestamptz,(record_item->'selected'->>'endAt')::timestamptz,observed)>(t->>'fromAt')::timestamptz
    or (record_item->'original'->>'startAt')::timestamptz<(t->>'toAt')::timestamptz
     and coalesce((record_item->'administrativeBoundary'->>'verifiedEndAt')::timestamptz,(record_item->'original'->>'endAt')::timestamptz,observed)>(t->>'fromAt')::timestamptz then
    records:=records||jsonb_build_array(record_item);end if;
  end loop;
  for v in select value from jsonb_array_elements(context->'missing'->'items') where value->>'isCurrentApproved'='true' loop
   select * into missing_row from public.merchant_attendance_missing_requests where merchant_id=site and request_id=(v->>'requestId')::uuid;
   proof:=public.faolla_attendance_plan_posthoc_missing_v1(site,wid,(t->>'employeeId')::uuid,(t->>'employeeAuthUserId')::uuid,missing_row.request_id);
   select * into missing_entry from public.merchant_attendance_missing_entries where merchant_id=site and request_id=missing_row.request_id order by revision desc limit 1;
   if proof->>'current' is distinct from 'true' or proof->'reference'->'approvalOperationId' is distinct from v->'operationId'
    or missing_entry.operation_id::text is distinct from v->>'operationId' or to_jsonb(missing_entry.revision) is distinct from v->'revision'
    or missing_entry.action is distinct from 'approve' then raise exception 'attendance_day_review_invalid';end if;
   assoc:=null;x:=null;select value->'current' into x from jsonb_array_elements(observations) where value->'current'->'reference'->'requestId'=v->'requestId';
   if x is not null and x->'claim'->'slotId'=t->'slotId' and x->'available'='true'::jsonb then assoc:=jsonb_build_object('slotId',t->'slotId','operationId',x->'claim'->'operationId');end if;
   records:=records||jsonb_build_array(jsonb_build_object('kind','missing','sourceId',v->'requestId','operationId',v->'operationId','revision',v->'revision',
    'workerId',wid,'employeeId',t->'employeeId','employeeAuthUserId',t->'employeeAuthUserId','locationId',missing_row.location_id,
    'original',null,'selected',public.faolla_attendance_day_review_span_v1(missing_row.proposal),'association',assoc,'administrativeBoundary',null));
  end loop;
  for v in select value from jsonb_array_elements(context->'calendar'->'items') loop
   calendars:=calendars||jsonb_build_array(jsonb_build_object('siteId',site,'entryId',v->'entryId','operationId',v->'operationId','revision',v->'revision',
    'kind',v->'kind','status',v->'status','locationId',v->'locationId','timeZone',v->'timeZone','fromDate',v->'fromDate','throughDate',v->'throughDate',
    'fromAt',public.faolla_attendance_day_review_stamp_v1((v->>'fromAt')::timestamptz),'toAt',public.faolla_attendance_day_review_stamp_v1((v->>'toAt')::timestamptz),
    'recordedAt',public.faolla_attendance_day_review_stamp_v1((v->>'recordedAt')::timestamptz)));
  end loop;
  outages:=public.faolla_attendance_outage_period_context_v1(site,wid,(t->>'employeeId')::uuid,(t->>'employeeAuthUserId')::uuid,(t->>'fromAt')::timestamptz,(t->>'toAt')::timestamptz);
 end if;
 first_at:=(t->>'fromAt')::timestamptz;last_at:=(t->>'toAt')::timestamptz;
 if first_at>=last_at or t->>'employeeId' is null or t->>'employeeAuthUserId' is null then raise exception 'attendance_day_review_invalid';end if;
 if q->>'caseId' is not null then
  select * into c from public.merchant_attendance_day_review_cases where merchant_id=site and case_id=(q->>'caseId')::uuid for update;
  if c.case_id is null then raise exception 'attendance_day_review_not_found';end if;
  if c.target is distinct from t then raise exception 'attendance_day_review_identity_changed';end if;
  head:=public.faolla_attendance_day_review_head_v1(c);
  case_head:=jsonb_build_object('caseId',c.case_id,'target',t,'revision',head->'revision','coverage','complete',
   'latestDecision',jsonb_build_object('operationId',head->'latestDecision'->'receipt'->'operationId','revision',head->'latestDecision'->'receipt'->'revision','recordedAt',head->'latestDecision'->'receipt'->'recordedAt'),
   'latestSelf',case when head->'latestSelf'='null'::jsonb then null else jsonb_build_object('caseId',c.case_id,'operationId',head->'latestSelf'->'receipt'->'operationId',
    'revision',head->'latestSelf'->'receipt'->'revision','recordedAt',head->'latestSelf'->'receipt'->'recordedAt','actorId',head->'latestSelf'->'receipt'->'actorId',
    'decisionOperationId',head->'latestSelf'->'decisionOperationId','kind',head->'latestSelf'->'action','claim',head->'latestSelf'->'claim') end);
 end if;
 --Every collection is complete or the whole call fails. In particular a
 --legacy limited=true/empty array cannot pass as a complete empty workday.
 for v in select value from jsonb_array_elements(case when is_day then context->'pendingCorrections' else context->'pendingCorrections'->'items' end) loop
  pending:=pending||jsonb_build_array(jsonb_build_object('kind',v->'kind','sourceId',v->'requestId','operationId',v->'operationId','revision',v->'revision'));
 end loop;
 for v in select value from jsonb_array_elements(case when is_day then context->'missing' else context->'missing'->'items' end) where value->>'status'='submitted' loop
  pending:=pending||jsonb_build_array(jsonb_build_object('kind','missing','sourceId',v->'requestId','operationId',v->'operationId','revision',v->'revision'));
 end loop;
 for v in select value from jsonb_array_elements(leaves) loop
  if v->>'status'='submitted' then pending:=pending||jsonb_build_array(jsonb_build_object('kind','leave','sourceId',v->'requestId','operationId',v->'operationId','revision',v->'revision'));end if;
 end loop;
 for v in select value from jsonb_array_elements(coalesce(case when is_day then context->'workArrangements' else context->'workArrangements'->'items' end,'[]'::jsonb)) loop
  if v->>'status'='submitted' then pending:=pending||jsonb_build_array(jsonb_build_object('kind','arrangement','sourceId',v->'requestId','operationId',v->'history'->-1->'operationId','revision',v->'revision'));
  elsif v->>'status'='approved' then arrangements:=arrangements||jsonb_build_array(jsonb_build_object('requestId',v->'requestId','operationId',v->'history'->-1->'operationId','revision',v->'revision',
   'startAt',public.faolla_attendance_day_review_stamp_v1((v->>'startAt')::timestamptz),'endAt',public.faolla_attendance_day_review_stamp_v1((v->>'endAt')::timestamptz)));end if;
 end loop;
 for v in select value from jsonb_array_elements(outages) where value->'status'->>'resolved' is distinct from 'true' loop
  --A declaration exists even before its separate review stream has revision1.
  --Use its actual original declaration operation/revision, not invented rev0.
  if v->'current'='null'::jsonb then
   select to_jsonb(o.operation_id) into x from public.merchant_attendance_outage_operations o where o.merchant_id=site and o.record_id=(v->>'declarationId')::uuid and o.action='declare';
   if x is null then raise exception 'attendance_day_review_invalid';end if;
   pending:=pending||jsonb_build_array(jsonb_build_object('kind','outage','sourceId',v->'declarationId','operationId',x,'revision',1));
  else pending:=pending||jsonb_build_array(jsonb_build_object('kind','outage','sourceId',v->'declarationId','operationId',v->'current'->'operationId','revision',v->'current'->'revision'));end if;
 end loop;
 --Conflicts are observations, never merged/zeroed hours. At most100 pairs;
 --excess returns no partial body and cannot be saved as a follow_up witness.
 for position in 0..jsonb_array_length(records)-1 loop
  v:=records->position;record_end:=least(last_at,coalesce((v->'administrativeBoundary'->>'verifiedEndAt')::timestamptz,(v->'selected'->>'endAt')::timestamptz,observed));
  if position+1<jsonb_array_length(records) then
   for other in position+1..jsonb_array_length(records)-1 loop
    x:=records->other;other_end:=least(last_at,coalesce((x->'administrativeBoundary'->>'verifiedEndAt')::timestamptz,(x->'selected'->>'endAt')::timestamptz,observed));
    if greatest(first_at,(v->'selected'->>'startAt')::timestamptz,(x->'selected'->>'startAt')::timestamptz)<least(record_end,other_end) then
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('kind','records_overlap','sourceIds',jsonb_build_array(v->'sourceId',x->'sourceId')));end if;
   end loop;
  end if;
  for x in select value from jsonb_array_elements(leaves) where value->>'status'='approved' loop
   if greatest(first_at,(v->'selected'->>'startAt')::timestamptz,(x->>'startAt')::timestamptz)<least(record_end,(x->>'endAt')::timestamptz) then
    conflicts:=conflicts||jsonb_build_array(jsonb_build_object('kind','work_leave','sourceIds',jsonb_build_array(v->'sourceId',x->'requestId')));end if;
  end loop;
  if jsonb_array_length(conflicts)>100 then raise exception 'attendance_day_review_too_large';end if;
 end loop;
 for part in select value from jsonb_array_elements(jsonb_build_array(plans,records,calendars,pending,conflicts,arrangements)) items(value) loop
  if jsonb_typeof(part) is distinct from 'array' or jsonb_array_length(part)>100 then raise exception 'attendance_day_review_too_large';end if;
 end loop;
 if (select count(*) from jsonb_array_elements(records))<>(select count(distinct value->>'sourceId') from jsonb_array_elements(records))
  or (select count(*) from jsonb_array_elements(pending))<>(select count(distinct (value->>'kind')||':'||(value->>'sourceId')) from jsonb_array_elements(pending))
  then raise exception 'attendance_day_review_invalid';end if;
 select coalesce(jsonb_agg(value order by value->>'slotId'),'[]') into plans from jsonb_array_elements(plans);
 select coalesce(jsonb_agg(value order by value->>'kind',value->>'sourceId'),'[]') into records from jsonb_array_elements(records);
 select coalesce(jsonb_agg(value order by value->>'entryId'),'[]') into calendars from jsonb_array_elements(calendars);
 select coalesce(jsonb_agg(value order by value->>'kind',value->>'sourceId',value->>'operationId'),'[]') into pending from jsonb_array_elements(pending);
 select coalesce(jsonb_agg(value order by value->>'kind',(value->'sourceIds')::text),'[]') into conflicts from jsonb_array_elements(conflicts);
 select coalesce(jsonb_agg(value order by value->>'requestId'),'[]') into arrangements from jsonb_array_elements(arrangements);
 facts:=jsonb_build_object('coverage','complete','identity','matching','plans',plans,'records',records,'calendar',calendars,'pending',pending,'conflicts',conflicts,'arrangements',arrangements);
 canonical:=jsonb_build_array('attendance-day-review-evidence-v1',t,base_canonical,case when is_day then '[]'::jsonb else outages end,facts);
 source_text:=canonical::text;fingerprint:=public.faolla_attendance_operational_rule_hash_v1(canonical);
 read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_time_reversed';end if;
 input:=jsonb_build_object('protocol','attendance-day-classification-input-v1','siteId',site,'actorId',actor,'asOf',public.faolla_attendance_day_review_stamp_v1(read_at),'target',t,
  'source',facts||jsonb_build_object('fingerprint',fingerprint,'current',current_source,'caseHead',case_head));
 if octet_length(convert_to(source_text,'UTF8'))>1048576 or octet_length(convert_to(input::text,'UTF8'))>262144 then raise exception 'attendance_day_review_too_large';end if;
 if head is not null then saved:=jsonb_build_object('protocol','attendance-day-review-v1','kind','detail','siteId',site,'actorId',actor,
  'readAt',public.faolla_attendance_day_review_stamp_v1(read_at),'access','owner','head',head,'operation',null,'replayed',false);end if;
 result:=jsonb_build_object('protocol','attendance-day-review-source-v1','kind',q->'mode','siteId',site,'actorId',actor,'readAt',public.faolla_attendance_day_review_stamp_v1(read_at),'query',q,
  'source',jsonb_build_object('kind',t->'kind','raw',raw,'outages',case when is_day then '[]'::jsonb else outages end,'canonical',canonical,'text',source_text,'fingerprint',fingerprint),
  'input',input,'saved',saved,'sourceChanged',case when head is null then null else head->'latestDecision'->>'sourceFingerprint'<>fingerprint end);
 if octet_length(convert_to(result::text,'UTF8'))>4194304 then raise exception 'attendance_day_review_too_large';end if;
 return result;
end;
$$;

--Private deterministic calculation. Only source_v1's trusted complete input
--reaches a new writer. The public/browser pure evaluator remains nonauthority.
create or replace function public.faolla_attendance_day_review_compute_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare t jsonb:=p->'target';s jsonb:=p->'source';ended boolean:=(p->>'asOf')::timestamptz>=(p->'target'->>'toAt')::timestamptz;
 complete boolean:=s->>'coverage'='complete' and s->>'identity'='matching' and s->>'current'='true';
 administrative boolean;is_open boolean;unassociated boolean;has_work boolean;conflict boolean;observed jsonb:='[]';
 common_flags text[]:=array[]::text[];flags text[];plan jsonb;covering jsonb:='[]';statement jsonb;candidates jsonb:='[]';outcome text;blockers jsonb;
 all_flags constant text[]:=array['evidence_incomplete','identity_unproven','source_not_current','target_not_ended','self_review','pending_source','open_record','source_conflict','unassociated_record',
 'administrative_hours_unassessed','plan_required','plan_cancelled','publication_missing','covering_closure_missing','work_record_present','latest_not_worked_statement_required','recorded_work_required'];
begin
 administrative:=exists(select 1 from jsonb_array_elements(s->'records') x where nullif(x->'administrativeBoundary','null'::jsonb) is not null);
 is_open:=exists(select 1 from jsonb_array_elements(s->'records') x where nullif(x->'administrativeBoundary','null'::jsonb) is null and (x->'original'->'endAt'='null'::jsonb or x->'selected'->'endAt'='null'::jsonb));
 unassociated:=exists(select 1 from jsonb_array_elements(s->'records') x where nullif(x->'association','null'::jsonb) is null or t->>'kind'='plan' and x->'association'->'slotId' is distinct from t->'slotId');
 conflict:=jsonb_array_length(s->'conflicts')>0;
 has_work:=complete and exists(select 1 from jsonb_array_elements(s->'records') x where nullif(x->'selected'->'endAt','null'::jsonb) is not null or nullif(x->'original'->'endAt','null'::jsonb) is not null);
 if not complete or not ended or administrative then observed:=observed||'"evidence_insufficient"'::jsonb;end if;
 if jsonb_array_length(s->'pending')>0 then observed:=observed||'"pending_source"'::jsonb;common_flags:=array_append(common_flags,'pending_source');end if;
 if is_open then observed:=observed||'"open_record"'::jsonb;common_flags:=array_append(common_flags,'open_record');end if;
 if conflict then observed:=observed||'"source_conflict"'::jsonb;common_flags:=array_append(common_flags,'source_conflict');end if;
 if unassociated then observed:=observed||'"unassociated_record"'::jsonb;common_flags:=array_append(common_flags,'unassociated_record');end if;
 if complete and ended and jsonb_array_length(s->'records')=0 then observed:=observed||'"no_record"'::jsonb;end if;
 if has_work then observed:=observed||'"recorded_work"'::jsonb;end if;
 if s->>'coverage'<>'complete' then common_flags:=array_append(common_flags,'evidence_incomplete');end if;
 if s->>'identity'<>'matching' then common_flags:=array_append(common_flags,'identity_unproven');end if;
 if s->>'current'<>'true' then common_flags:=array_append(common_flags,'source_not_current');end if;
 if not ended then common_flags:=array_append(common_flags,'target_not_ended');end if;
 if p->'actorId'=t->'employeeAuthUserId' then common_flags:=array_append(common_flags,'self_review');end if;
 if administrative then common_flags:=array_append(common_flags,'administrative_hours_unassessed');end if;
 if t->>'kind'='plan' then select value into plan from jsonb_array_elements(s->'plans') where value->'slotId'=t->'slotId';end if;
 if plan is not null and plan->>'cancelled'='false' and plan->>'hasPublicationEvidence'='true' then
  select coalesce(jsonb_agg(value order by value->>'entryId'),'[]') into covering from jsonb_array_elements(s->'calendar') where value->>'kind'='closure' and value->>'status'='created'
   and (value->'locationId'='null'::jsonb or value->'locationId'=plan->'locationId') and (value->>'fromAt')::timestamptz<=(plan->>'startAt')::timestamptz and (value->>'toAt')::timestamptz>=(plan->>'endAt')::timestamptz;
 end if;
 if s->'caseHead'->>'coverage'='complete' and s->'caseHead'->'latestSelf'->>'kind'='explain' and s->'caseHead'->'latestSelf'->>'claim'='not_worked' then statement:=s->'caseHead'->'latestSelf';end if;
 foreach outcome in array array['follow_up','calendar_exempt','not_worked_reported','recorded_work_reviewed'] loop
  flags:=case when outcome='follow_up' then case when 'self_review'=any(common_flags) then array['self_review']::text[] else array[]::text[] end else common_flags end;
  if outcome='calendar_exempt' then
   if plan is null then flags:=array_append(flags,'plan_required');end if;
   if plan->>'cancelled'='true' then flags:=array_append(flags,'plan_cancelled');end if;
   if plan is not null and plan->>'hasPublicationEvidence'<>'true' then flags:=array_append(flags,'publication_missing');end if;
   if covering='[]'::jsonb then flags:=array_append(flags,'covering_closure_missing');end if;
  elsif outcome='not_worked_reported' then
   if jsonb_array_length(s->'records')>0 then flags:=array_append(flags,'work_record_present');end if;
   if statement is null then flags:=array_append(flags,'latest_not_worked_statement_required');end if;
  elsif outcome='recorded_work_reviewed' and not has_work then flags:=array_append(flags,'recorded_work_required');end if;
  select coalesce(jsonb_agg(flag order by ord),'[]') into blockers from unnest(all_flags) with ordinality f(flag,ord) where flag=any(flags);
  candidates:=candidates||jsonb_build_array(jsonb_build_object('outcome',outcome,'blockers',blockers,
   'calendarReferences',case when outcome='calendar_exempt' and blockers='[]'::jsonb then covering else '[]'::jsonb end,
   'selfStatementReference',case when outcome='not_worked_reported' and blockers='[]'::jsonb then statement else null end));
 end loop;
 return jsonb_build_object('observations',observed,'candidates',candidates);
end;
$$;
create or replace function public.faolla_attendance_day_review_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text:=p_query->>'siteId';mode text:=p_query->>'mode';access_name text:=p_query->>'access';op uuid;wid uuid;
 c public.merchant_attendance_day_review_cases%rowtype;entry_row public.merchant_attendance_day_review_entries%rowtype;
 saved public.merchant_attendance_day_review_entries%rowtype;w public.merchant_attendance_workers%rowtype;
 e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;s public.merchant_attendance_settings%rowtype;
 head jsonb;source_wire jsonb;input jsonb;t jsonb;calculation jsonb;candidate jsonb;common jsonb;items jsonb:='[]';next_cursor jsonb;next_revision bigint;
 fingerprint text;rev bigint;last_at timestamptz;recorded timestamptz;read_at timestamptz;count_items integer:=0;cursor_at timestamptz;cursor_id uuid;
begin
 perform public.faolla_attendance_day_review_query_v1(p_query);
 if p_auth_user_id is null then raise exception 'attendance_access_denied';end if;
 if p_command is not null then perform public.faolla_attendance_day_review_command_v1(p_query,p_command);op:=(p_command->>'operationId')::uuid;end if;
 --This is the only authority-independent recovery path. No current worker,
 --owner, membership, frame, source or settings text is exposed here.
 if mode='recover' then
  if p_command is not null then raise exception 'attendance_invalid_request';end if;
  select * into saved from public.merchant_attendance_day_review_entries where merchant_id=site and operation_id=(p_query->>'operationId')::uuid and actor_auth_user_id=p_auth_user_id;
  if saved.operation_id is null then raise exception 'attendance_operation_not_found';end if;
  return jsonb_build_object('protocol','attendance-day-review-v1','kind','receipt','siteId',site,'actorId',p_auth_user_id,
   'readAt',public.faolla_attendance_day_review_stamp_v1(clock_timestamp()),'receipt',public.faolla_attendance_day_review_receipt_v1(saved),'replayed',true);
 end if;
 --An exact original POST is also only a minimum receipt recovery, never new
 --authorization. Check the immutable full command before any current source,
 --membership/owner, pause or rollout flag; a lost response stays recoverable.
 if op is not null then
  fingerprint:=public.faolla_attendance_day_review_fingerprint_v1(p_query,p_auth_user_id,p_command);
  select * into saved from public.merchant_attendance_day_review_entries where merchant_id=site and operation_id=op;
  if saved.operation_id is not null then
   if saved.actor_auth_user_id is distinct from p_auth_user_id or saved.query is distinct from p_query or saved.command is distinct from p_command or saved.command_fingerprint is distinct from fingerprint
    then raise exception 'attendance_operation_conflict';end if;
   return jsonb_build_object('protocol','attendance-day-review-v1','kind','receipt','siteId',site,'actorId',p_auth_user_id,
    'readAt',public.faolla_attendance_day_review_stamp_v1(clock_timestamp()),'receipt',public.faolla_attendance_day_review_receipt_v1(saved),'replayed',true);
  end if;
 end if;
 --Only fresh operations and full reads reach current authority. Lock order
 --matches the old writers: merchant/settings/worker/employee/case.
 perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
 if not found then raise exception 'attendance_access_denied';end if;
 select * into s from public.merchant_attendance_settings where merchant_id=site for update;
 if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
 if access_name='self' then
  select x.id into wid from public.merchant_attendance_workers x join public.merchant_enterprise_employees y on y.merchant_id=x.merchant_id and y.id=x.employee_id
   where x.merchant_id=site and y.auth_user_id=p_auth_user_id;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if w.id is null or e.id is null or e.auth_user_id is distinct from p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
  if r.id is null or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
   or not r.permissions @> array['enterprise.view','attendance.self.view']::text[] then raise exception 'attendance_access_denied';end if;
 elsif p_query->>'workerId' is not null then
  wid:=(p_query->>'workerId')::uuid;select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if w.id is null then raise exception 'attendance_worker_not_found';end if;
 end if;
 if op is not null then
  --A concurrent first request may have committed while this one waited for
  --settings. The same exact receipt predicate is repeated after that lock.
  select * into saved from public.merchant_attendance_day_review_entries where merchant_id=site and operation_id=op;
  if saved.operation_id is not null then
   if saved.actor_auth_user_id is distinct from p_auth_user_id or saved.query is distinct from p_query or saved.command is distinct from p_command or saved.command_fingerprint is distinct from fingerprint then raise exception 'attendance_operation_conflict';end if;
   return jsonb_build_object('protocol','attendance-day-review-v1','kind','receipt','siteId',site,'actorId',p_auth_user_id,'readAt',public.faolla_attendance_day_review_stamp_v1(clock_timestamp()),'receipt',public.faolla_attendance_day_review_receipt_v1(saved),'replayed',true);
  end if;
  --Turning off new owner decisions cannot silence a legitimate response to
  --an already saved case. Self identity, role, pause and head guards remain.
  if p_command->>'action'='decide' and p_allow_write is distinct from true then raise exception 'attendance_module_disabled';end if;
 end if;
 if mode in('candidates','preview') then
  source_wire:=public.faolla_attendance_day_review_source_v1(p_query,p_auth_user_id);
  if p_command is null then return source_wire;end if;
  input:=source_wire->'input';t:=input->'target';
  if p_command->'workerId' is distinct from t->'workerId' or p_command->'employeeId' is distinct from t->'employeeId'
   or p_command->'employeeAuthUserId' is distinct from t->'employeeAuthUserId' then raise exception 'attendance_day_review_identity_changed';end if;
  if p_command->'expectedFingerprint' is distinct from input->'source'->'fingerprint' then raise exception 'attendance_day_review_source_changed';end if;
  if p_query->'caseId'='null'::jsonb then
   if exists(select 1 from public.merchant_attendance_day_review_cases x where x.merchant_id=site and (x.case_id=(p_command->>'caseId')::uuid
    or x.worker_id=wid and (t->>'kind'='day' and x.kind='day' and x.work_date=(t->>'workDate')::date or t->>'kind'='plan' and x.kind='plan' and x.slot_id=(t->>'slotId')::uuid))) then raise exception 'attendance_day_review_head_changed';end if;
   rev:=0;last_at:=null;
  else
   select * into c from public.merchant_attendance_day_review_cases where merchant_id=site and case_id=(p_query->>'caseId')::uuid for update;
   if c.case_id is null then raise exception 'attendance_day_review_not_found';end if;
   select revision,recorded_at into rev,last_at from public.merchant_attendance_day_review_entries where merchant_id=site and case_id=c.case_id order by revision desc limit 1;
  end if;
  if rev is null or rev<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_day_review_head_changed';end if;
  calculation:=public.faolla_attendance_day_review_compute_v1(input);
  select value into candidate from jsonb_array_elements(calculation->'candidates') where value->'outcome'=p_command->'outcome';
  if candidate is null or candidate->'blockers'<>'[]'::jsonb then raise exception 'attendance_day_review_ineligible';end if;
  if p_command->>'outcome'='calendar_exempt' and not exists(select 1 from jsonb_array_elements(candidate->'calendarReferences') x where
   x->'entryId'=p_command->'calendarReference'->'entryId' and x->'operationId'=p_command->'calendarReference'->'operationId' and x->'revision'=p_command->'calendarReference'->'revision')
   or p_command->>'outcome'='not_worked_reported' and candidate->'selfStatementReference'->'operationId' is distinct from p_command->'selfStatementOperationId' then raise exception 'attendance_day_review_ineligible';end if;
  recorded:=clock_timestamp();if recorded<(input->>'asOf')::timestamptz or recorded<last_at then raise exception 'attendance_time_reversed';end if;
  if rev=0 then
   insert into public.merchant_attendance_day_review_cases(merchant_id,case_id,worker_id,employee_id,employee_auth_user_id,kind,work_date,time_zone,start_at,end_at,slot_id,opened_at,target)
    values(site,(p_command->>'caseId')::uuid,wid,(t->>'employeeId')::uuid,(t->>'employeeAuthUserId')::uuid,t->>'kind',(t->>'workDate')::date,t->>'timeZone',
     (t->>'fromAt')::timestamptz,(t->>'toAt')::timestamptz,(t->>'slotId')::uuid,recorded,t) returning * into c;
  end if;
  entry_row.merchant_id:=site;entry_row.case_id:=c.case_id;entry_row.operation_id:=op;entry_row.revision:=rev+1;entry_row.actor_auth_user_id:=p_auth_user_id;
  entry_row.action:='decide';entry_row.query:=p_query;entry_row.command:=p_command;entry_row.command_fingerprint:=fingerprint;entry_row.recorded_at:=recorded;
  entry_row.canonical:=source_wire->'source'->'canonical';entry_row.source_text:=source_wire->'source'->>'text';entry_row.source_fingerprint:=input->'source'->>'fingerprint';entry_row.normalized_input:=input;
  entry_row.entry:=jsonb_build_object('receipt',public.faolla_attendance_day_review_receipt_v1(entry_row),'action','decide','reason',p_command->'reason','outcome',p_command->'outcome',
   'sourceFingerprint',entry_row.source_fingerprint,'observations',calculation->'observations','calendarReference',p_command->'calendarReference','selfStatementOperationId',p_command->'selfStatementOperationId');
 elsif mode in('detail','history') then
  select * into c from public.merchant_attendance_day_review_cases where merchant_id=site and case_id=(p_query->>'caseId')::uuid for update;
  if c.case_id is null then raise exception 'attendance_day_review_not_found';end if;
  if access_name='self' and row(c.worker_id,c.employee_id,c.employee_auth_user_id) is distinct from row(w.id,e.id,e.auth_user_id) then raise exception 'attendance_access_denied';end if;
  head:=public.faolla_attendance_day_review_head_v1(c);
  if p_command is not null then
   rev:=(head->>'revision')::bigint;last_at:=(case when head->'latestSelf'<>'null'::jsonb then head->'latestSelf' else head->'latestDecision' end)->'receipt'->>'recordedAt';
   if rev<>(p_command->>'expectedRevision')::bigint or p_command->'decisionOperationId' is distinct from head->'latestDecision'->'receipt'->'operationId' then raise exception 'attendance_day_review_head_changed';end if;
   if not w.active or exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=e.id and paused) then raise exception 'attendance_paused';end if;
   recorded:=clock_timestamp();if recorded<last_at then raise exception 'attendance_time_reversed';end if;
   entry_row.merchant_id:=site;entry_row.case_id:=c.case_id;entry_row.operation_id:=op;entry_row.revision:=rev+1;entry_row.actor_auth_user_id:=p_auth_user_id;
   entry_row.action:=p_command->>'action';entry_row.query:=p_query;entry_row.command:=p_command;entry_row.command_fingerprint:=fingerprint;entry_row.recorded_at:=recorded;
   entry_row.entry:=jsonb_build_object('receipt',public.faolla_attendance_day_review_receipt_v1(entry_row),'action',p_command->'action','reason',p_command->'reason',
    'decisionOperationId',p_command->'decisionOperationId','claim',p_command->'claim');
  end if;
 end if;
 if p_command is not null then
  if entry_row.operation_id is null then raise exception 'attendance_invalid_request';end if;
  if entry_row.revision>9007199254740990 then raise exception 'attendance_day_review_too_large';end if;
  insert into public.merchant_attendance_day_review_entries select entry_row.*;
  return jsonb_build_object('protocol','attendance-day-review-v1','kind','receipt','siteId',site,'actorId',p_auth_user_id,
   'readAt',public.faolla_attendance_day_review_stamp_v1(clock_timestamp()),'receipt',public.faolla_attendance_day_review_receipt_v1(entry_row),'replayed',false);
 end if;
 read_at:=clock_timestamp();common:=jsonb_build_object('protocol','attendance-day-review-v1','siteId',site,'actorId',p_auth_user_id,'readAt',public.faolla_attendance_day_review_stamp_v1(read_at),'access',access_name);
 if mode='detail' then return common||jsonb_build_object('kind','detail','head',head,'operation',null,'replayed',false);
 elsif mode='history' then
  for saved in select x.* from public.merchant_attendance_day_review_entries x where x.merchant_id=site and x.case_id=c.case_id
   and (p_query->'beforeRevision'='null'::jsonb or x.revision<(p_query->>'beforeRevision')::bigint) order by x.revision desc limit 26 loop
   count_items:=count_items+1;if count_items>25 then next_revision:=(items->-1->'receipt'->>'revision')::bigint;exit;end if;items:=items||jsonb_build_array(saved.entry);
  end loop;
  return common||jsonb_build_object('kind','history','head',head,'items',items,'nextRevision',next_revision);
 elsif mode='list' then
  cursor_at:=(p_query->'cursor'->>'openedAt')::timestamptz;cursor_id:=(p_query->'cursor'->>'caseId')::uuid;
  for c in select x.* from public.merchant_attendance_day_review_cases x where x.merchant_id=site
   and (access_name='owner' or row(x.worker_id,x.employee_id,x.employee_auth_user_id)=row(w.id,e.id,e.auth_user_id))
   and (p_query->'workerId'='null'::jsonb or x.worker_id=(p_query->>'workerId')::uuid)
   and (p_query->'cursor'='null'::jsonb or row(x.opened_at,x.case_id)<row(cursor_at,cursor_id)) order by x.opened_at desc,x.case_id desc limit 26 loop
   count_items:=count_items+1;if count_items>25 then next_cursor:=jsonb_build_object('openedAt',items->-1->'openedAt','caseId',items->-1->'caseId');exit;end if;
   items:=items||jsonb_build_array(public.faolla_attendance_day_review_head_v1(c));
  end loop;
  return common||jsonb_build_object('kind','list','items',items,'nextCursor',next_cursor);
 end if;
 raise exception 'attendance_invalid_request';
end;
$$;

create or replace function public.faolla_attendance_day_review_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare c public.merchant_attendance_day_review_cases%rowtype;previous public.merchant_attendance_day_review_entries%rowtype;
 decision public.merchant_attendance_day_review_entries%rowtype;wire jsonb;fresh jsonb;calc jsonb;candidate jsonb;expected jsonb;head bigint;
 worker_row public.merchant_attendance_workers%rowtype;employee_row public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
begin
 if tg_op in('UPDATE','DELETE','TRUNCATE') then raise exception 'attendance_day_review_immutable';end if;
 if tg_table_name='merchant_attendance_day_review_cases' then
  if new.target is distinct from public.faolla_attendance_day_review_target_v1(new)
   or not exists(select 1 from pg_timezone_names where name=new.time_zone)
   or not exists(select 1 from public.merchant_attendance_day_review_entries x where x.merchant_id=new.merchant_id and x.case_id=new.case_id and x.revision=1 and x.action='decide' and x.recorded_at=new.opened_at)
   then raise exception 'attendance_day_review_invalid';end if;
  return new;
 end if;
 --Even a direct privileged proof probe follows the established lock order;
 --never take a case lock first and later upgrade the shared settings lock.
 perform 1 from public.merchants where id=new.merchant_id for share;
 perform 1 from public.merchant_attendance_settings where merchant_id=new.merchant_id for update;
 select * into c from public.merchant_attendance_day_review_cases where merchant_id=new.merchant_id and case_id=new.case_id;
 if c.case_id is null then raise exception 'attendance_day_review_invalid';end if;
 select * into worker_row from public.merchant_attendance_workers where merchant_id=c.merchant_id and id=c.worker_id for update;
 select * into employee_row from public.merchant_enterprise_employees where merchant_id=c.merchant_id and id=c.employee_id for share;
 select * into c from public.merchant_attendance_day_review_cases where merchant_id=new.merchant_id and case_id=new.case_id for update;
 perform public.faolla_attendance_day_review_command_v1(new.query,new.command);
 if new.query->>'siteId' is distinct from new.merchant_id or new.command->>'operationId' is distinct from new.operation_id::text
  or new.command->>'action' is distinct from new.action or (new.command->>'expectedRevision')::bigint<>new.revision-1
  or new.command_fingerprint is distinct from public.faolla_attendance_day_review_fingerprint_v1(new.query,new.actor_auth_user_id,new.command)
  or new.recorded_at<c.opened_at then raise exception 'attendance_day_review_invalid';end if;
 select * into previous from public.merchant_attendance_day_review_entries x where x.merchant_id=new.merchant_id and x.case_id=new.case_id order by revision desc limit 1;
 head:=coalesce(previous.revision,0);
 if head<>new.revision-1 or previous.recorded_at>new.recorded_at or new.revision=1 and (new.action<>'decide' or new.recorded_at<>c.opened_at)
  then raise exception 'attendance_day_review_invalid';end if;
 if new.action='decide' then
  if new.command->>'caseId' is distinct from c.case_id::text or new.command->>'workerId' is distinct from c.worker_id::text
   or new.command->>'employeeId' is distinct from c.employee_id::text or new.command->>'employeeAuthUserId' is distinct from c.employee_auth_user_id::text
   or new.actor_auth_user_id=c.employee_auth_user_id or new.normalized_input->'target' is distinct from c.target
   or new.normalized_input->>'siteId' is distinct from c.merchant_id or new.normalized_input->>'actorId' is distinct from new.actor_auth_user_id::text
   or public.faolla_attendance_shift_rule_binding_scalar_v1(new.normalized_input->'asOf','stamp6') is distinct from true
   or (new.normalized_input->>'asOf')::timestamptz>new.recorded_at or new.source_text is distinct from new.canonical::text
   or new.source_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(new.canonical)
   or new.normalized_input->>'protocol' is distinct from 'attendance-day-classification-input-v1'
   or new.normalized_input->'source'->>'fingerprint' is distinct from new.source_fingerprint
   or new.command->>'expectedFingerprint' is distinct from new.source_fingerprint then raise exception 'attendance_day_review_invalid';end if;
  --A direct insert cannot certify forged self-consistent source JSON. Re-read
  --the complete trusted source under the same actual owner/settings locks.
  wire:=public.faolla_attendance_day_review_source_v1(new.query,new.actor_auth_user_id);fresh:=wire->'input';
  if wire->'source'->'canonical' is distinct from new.canonical or fresh->'target' is distinct from c.target
   or fresh-'asOf' is distinct from new.normalized_input-'asOf' then raise exception 'attendance_day_review_source_changed';end if;
  calc:=public.faolla_attendance_day_review_compute_v1(new.normalized_input);
  select value into candidate from jsonb_array_elements(calc->'candidates') where value->'outcome'=new.command->'outcome';
  if candidate is null or candidate->'blockers'<>'[]'::jsonb then raise exception 'attendance_day_review_ineligible';end if;
  if new.command->>'outcome'='calendar_exempt' and not exists(select 1 from jsonb_array_elements(candidate->'calendarReferences') x where
   x->'entryId'=new.command->'calendarReference'->'entryId' and x->'operationId'=new.command->'calendarReference'->'operationId' and x->'revision'=new.command->'calendarReference'->'revision')
   or new.command->>'outcome'='not_worked_reported' and candidate->'selfStatementReference'->'operationId' is distinct from new.command->'selfStatementOperationId' then raise exception 'attendance_day_review_ineligible';end if;
  expected:=jsonb_build_object('receipt',public.faolla_attendance_day_review_receipt_v1(new),'action','decide','reason',new.command->'reason','outcome',new.command->'outcome',
   'sourceFingerprint',new.source_fingerprint,'observations',calc->'observations','calendarReference',new.command->'calendarReference','selfStatementOperationId',new.command->'selfStatementOperationId');
 else
  if new.actor_auth_user_id<>c.employee_auth_user_id or new.query->>'caseId' is distinct from c.case_id::text then raise exception 'attendance_access_denied';end if;
  select * into worker_row from public.merchant_attendance_workers where merchant_id=c.merchant_id and id=c.worker_id for update;
  select * into employee_row from public.merchant_enterprise_employees where merchant_id=c.merchant_id and id=c.employee_id for share;
  if worker_row.employee_id is distinct from c.employee_id or employee_row.auth_user_id is distinct from c.employee_auth_user_id
   or employee_row.status is distinct from 'active' or worker_row.active is distinct from true then raise exception 'attendance_access_denied';end if;
  select * into role_row from public.merchant_enterprise_roles where merchant_id=c.merchant_id and id=employee_row.role_id for share;
  if role_row.id is null or role_row.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
   or not role_row.permissions @> array['enterprise.view','attendance.self.view']::text[] then raise exception 'attendance_access_denied';end if;
  if exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=c.merchant_id and employee_id=c.employee_id and paused) then raise exception 'attendance_paused';end if;
  select * into decision from public.merchant_attendance_day_review_entries x where x.merchant_id=new.merchant_id and x.case_id=new.case_id and x.action='decide' order by revision desc limit 1;
  if decision.operation_id is null or new.command->>'decisionOperationId' is distinct from decision.operation_id::text then raise exception 'attendance_day_review_head_changed';end if;
  expected:=jsonb_build_object('receipt',public.faolla_attendance_day_review_receipt_v1(new),'action',new.action,'reason',new.command->'reason','decisionOperationId',new.command->'decisionOperationId','claim',new.command->'claim');
 end if;
 if expected is distinct from new.entry then raise exception 'attendance_day_review_invalid';end if;
 return new;
end;
$$;
--No trigger is dropped on reentry: a changed trigger is an installation
--conflict, not something the migration silently repairs.
do $day_review_triggers$
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_day_review_cases'::regclass and tgname='day_review_case_pair') then
  create constraint trigger day_review_case_pair after insert on public.merchant_attendance_day_review_cases deferrable initially deferred for each row execute function public.faolla_attendance_day_review_guard_v1();
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_day_review_entries'::regclass and tgname='day_review_entry_proof') then
  create trigger day_review_entry_proof before insert on public.merchant_attendance_day_review_entries for each row execute function public.faolla_attendance_day_review_guard_v1();
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_day_review_cases'::regclass and tgname='day_review_case_immutable') then
  create trigger day_review_case_immutable before update or delete on public.merchant_attendance_day_review_cases for each row execute function public.faolla_attendance_day_review_guard_v1();
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_day_review_entries'::regclass and tgname='day_review_entry_immutable') then
  create trigger day_review_entry_immutable before update or delete on public.merchant_attendance_day_review_entries for each row execute function public.faolla_attendance_day_review_guard_v1();
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_day_review_cases'::regclass and tgname='day_review_case_no_truncate') then
  create trigger day_review_case_no_truncate before truncate on public.merchant_attendance_day_review_cases for each statement execute function public.faolla_attendance_day_review_guard_v1();
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_day_review_entries'::regclass and tgname='day_review_entry_no_truncate') then
  create trigger day_review_entry_no_truncate before truncate on public.merchant_attendance_day_review_entries for each statement execute function public.faolla_attendance_day_review_guard_v1();
 end if;
end;
$day_review_triggers$;

--199 FINAL START
revoke all on function public.faolla_attendance_day_review_target_v1(public.merchant_attendance_day_review_cases) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_query_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_command_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_fingerprint_v1(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_receipt_v1(public.merchant_attendance_day_review_entries) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_head_v1(public.merchant_attendance_day_review_cases) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_day_base_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_day_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_stamp_v1(timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_span_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_record_v1(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_compute_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_day_review_guard_v1() from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_day_review_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $day_review_postconditions$
declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;signature text;f regprocedure;meta record;table_name text;role_name text;
 actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record;
 own_spec jsonb;
begin
 select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_day_review_owner_conflict';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 own_spec:=$day_review_post_dependencies$[{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_scalar_v1","signature":"public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)","hash":"3d17c1dc4359ef24d5da51b926bc586f857d0b67b6cffda92869015accf3f7f0","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","kind"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"legacyHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc"},{"name":"faolla_attendance_control_day_boundary_v1","signature":"public.faolla_attendance_control_day_boundary_v1(date,text)","hash":"6c1479bd60a7349acc92fe7a2b7552509751e65be5651cc48d102c00834164a8","result":"timestamptz","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_date","p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_closure_unified_report_v1","signature":"public.faolla_attendance_period_closure_unified_report_v1(text,uuid,jsonb,jsonb)","hash":"e113571f21684a514ea5be8536debbc97fc4096601fe6af91f8e01213ce0b775","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_site_id","p_auth_user_id","p_query","p_frame"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_administrative_boundary_v1","signature":"public.faolla_attendance_administrative_boundary_v1(text,uuid,uuid)","hash":"30f4e7c06f9fd44bd90e321ae8f7f7ec44638ba50e6092ae27cc967dfce196bb","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_start"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_session_v1","signature":"public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamptz)","hash":"d23cef1c4a301f655e3e9d43425671c0b56c5a598062302d25f851b3071d23e2","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_start","p_employee","p_member_auth","p_observed"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_self_schedule_slot_v1","signature":"public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)","hash":"3ea9205bf464f28cde58da98db82c863584e5287c529e3c5a26ae272fb6c374d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_plan_rule_v1","signature":"public.faolla_attendance_period_plan_rule_v1(text,uuid,uuid,uuid,uuid,uuid)","hash":"14c5ebcc0ab24aa7cd9334633c76a3bd82484e894b17877168409618651f0e17","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_slot","p_employee","p_member_auth","p_operation"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_leave_summary_v1","signature":"public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)","hash":"5df82b03753c90636b8fd9fce15384560490c4f5996fafe1df76ec9e75b09fa6","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_calendar_summary_v1","signature":"public.faolla_attendance_calendar_summary_v1(public.merchant_attendance_calendar_entries,integer)","hash":"4ffd6f0aaeb6c489707e8ec1d4b17d074fdf3c6f3a3e2e8d028e303545b66858","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":1,"defaultExpression":"NULL::integer","args":["p","p_revision"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_correction_proposal_v1","signature":"public.faolla_attendance_correction_proposal_v1(jsonb,timestamptz)","hash":"d389ec334e368ecb2afcf44ad1a37ff39af028536fff6b30a64d72ca3ad3da9d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_value","p_now"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_instant_v1","signature":"public.faolla_attendance_instant_v1(text)","hash":"feba243fa6d87442defe285e3c9e4789bae5671c18d09cecb7c65dae6dffe5a5","result":"timestamptz","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_value"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_operation_v1","signature":"public.faolla_attendance_plan_posthoc_operation_v1(public.merchant_attendance_plan_posthoc_operations)","hash":"eb59e0f4bc1b509cfd81551717c10f8a45870cbf25df1a63abbbd161408f5cad","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_exception_review_entry_v1","signature":"public.faolla_attendance_plan_exception_review_entry_v1(public.merchant_attendance_plan_exception_entries)","hash":"044e220ca14f67ae05dd30b6b2e88a7d653e74cd1a1926b2496326d4be2d787b","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_formal_source_v1","signature":"public.faolla_attendance_plan_posthoc_formal_source_v1(jsonb,uuid)","hash":"7794ff1971454006e2410476c4848faf3972d0e8bb67039c9acfb13dc32c7d64","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_plan_exception_source_v1","signature":"public.faolla_attendance_plan_exception_source_v1(jsonb,uuid)","hash":"1234394b481e1e3063d6a12d83bf606e11be1cb8d64b4b86ea194091eb5334b1","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_administrative_source_result_v1","signature":"public.faolla_attendance_administrative_source_result_v1(jsonb)","hash":"4466f706cd31a515157c9f1e2d926fecb264d09944181fc0fb6381d32e24f4ec","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_period_canonical_v1","signature":"public.faolla_attendance_period_canonical_v1(jsonb)","hash":"e8d106312d2058d92f5976d63e74bb543f22ac5b38c04fe9b3513278590cd8a8","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_work_arrangement_context_v1","signature":"public.faolla_attendance_work_arrangement_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz)","hash":"dfdfcdbffb8db9855c91ce3189e4ef8e049cb758b40727d2b4713fdcef8ae21d","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_member_auth","p_from","p_to"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_outage_period_context_v1","signature":"public.faolla_attendance_outage_period_context_v1(text,uuid,uuid,uuid,timestamptz,timestamptz)","hash":"a96540f582439a515716e38672a7aac67253fc529ebd45482c0a35728126e573","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_employee_auth","p_from","p_to"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_plan_posthoc_missing_v1","signature":"public.faolla_attendance_plan_posthoc_missing_v1(text,uuid,uuid,uuid,uuid)","hash":"c2dd4efcde6b512a2a5a4f00807287fb1173c3ed3127bf2b10b679b35b24f3d3","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_auth","p_request"],"searchPath":"search_path=pg_catalog","isRpc":false}]$day_review_post_dependencies$::jsonb;
 
 for spec in select value from jsonb_array_elements(own_spec) loop
  signature:=replace(spec->>'signature','public.',ns||'.');f:=to_regprocedure(signature);
  select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(spec->>'result') or meta.proretset or meta.proisstrict or meta.proleakproof
   or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid or meta.proallargtypes is not null or meta.proargmodes is not null
   or meta.pronargs<>jsonb_array_length(spec->'args') or meta.procost<>100 or meta.prorows<>0
   or meta.pronargdefaults<>(spec->>'defaults')::integer or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from
    (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then spec->>'legacyHash' else spec->>'hash' end)
   then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
  if has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  if spec->>'name'<>'faolla_valid_merchant_enterprise_permissions_v1' then
   if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
    or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
    or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl
     where acl.grantor<>expected_owner or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true
      or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
    then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  end if;
 end loop;
 own_spec:=$day_review_post_own$[{"name":"faolla_attendance_day_review_target_v1","signature":"public.faolla_attendance_day_review_target_v1(public.merchant_attendance_day_review_cases)","hash":"d58b3b344473b8c52894801d4a809b1da993d4e594c4eebf94703fba496fe268","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_query_v1","signature":"public.faolla_attendance_day_review_query_v1(jsonb)","hash":"24fd10bdcba554a7682ff1506e4ab6eecc8e0809c48ccd1d68ad9a83b3de4908","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_command_v1","signature":"public.faolla_attendance_day_review_command_v1(jsonb,jsonb)","hash":"0de6669f595c37ac321a96356e1cdad51b55698b9b73961d264d3d672e376013","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["q","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_fingerprint_v1","signature":"public.faolla_attendance_day_review_fingerprint_v1(jsonb,uuid,jsonb)","hash":"ae76c825b8237fa52febd79c8871d0ab2e16fd234d9f5620d85e47d73bc8c215","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["q","a","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_receipt_v1","signature":"public.faolla_attendance_day_review_receipt_v1(public.merchant_attendance_day_review_entries)","hash":"38ee6ade7125c891937b9d5efe836ae3a0ca80a262df707b9eaaf0b2e7aba962","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_head_v1","signature":"public.faolla_attendance_day_review_head_v1(public.merchant_attendance_day_review_cases)","hash":"c78687653e92d746df4c116d9c33ecb7535eefa4c70d1343fe66c85a9b457351","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_day_base_v1","signature":"public.faolla_attendance_day_review_day_base_v1(jsonb,uuid)","hash":"3e8e5dd9bf7cab5c645975746bab4e95032d349bed72945b5e3c0711f858796a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_day_source_v1","signature":"public.faolla_attendance_day_review_day_source_v1(jsonb,uuid)","hash":"db59a6d23ab2be06dad98dad9b138e3f52455945488ed4f641e38e3ced5e9c0a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_stamp_v1","signature":"public.faolla_attendance_day_review_stamp_v1(timestamptz)","hash":"a2a16b078eed3497d2a643a8039e5ecae3a99ae581f47c40b8f0e0190b58e249","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_span_v1","signature":"public.faolla_attendance_day_review_span_v1(jsonb)","hash":"3d9631cc8b2cd6735b3764f729baff6fb9dc7cbc68ab421a7a518d1c27c8c21d","result":"jsonb","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_record_v1","signature":"public.faolla_attendance_day_review_record_v1(jsonb,jsonb,jsonb)","hash":"29f90d3f6b954ee76e2b8ab649d5618d5e8ee7f9103bcaef255b4de1ab8ba550","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["t","p","association"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_source_v1","signature":"public.faolla_attendance_day_review_source_v1(jsonb,uuid)","hash":"39c5a44db3b6f11282b6281026718f66cd39e6f9a3aeb9168074fad53b89b1ef","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["q","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_compute_v1","signature":"public.faolla_attendance_day_review_compute_v1(jsonb)","hash":"86b38fb20cbbbca79fedf1de012be61993f4cc3f1ef9c89854a4d61175c1b84b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_day_review_v1","signature":"public.faolla_attendance_day_review_v1(jsonb,uuid,jsonb,boolean)","hash":"da8fa3b1460225f19c80758aa4b2398ac05caf99e86a8d7251e5f9fcc70a335f","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_day_review_guard_v1","signature":"public.faolla_attendance_day_review_guard_v1()","hash":"0f6052b8694fb667e3737c01676d348168175744940385769297bbc49018c51e","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}]$day_review_post_own$::jsonb;
 
 for spec in select value from jsonb_array_elements(own_spec) loop
  signature:=replace(spec->>'signature','public.',ns||'.');f:=to_regprocedure(signature);
  select p.*,l.lanname into meta from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(spec->>'result') or meta.proretset or meta.proisstrict or meta.proleakproof
   or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid or meta.proallargtypes is not null or meta.proargmodes is not null
   or meta.pronargs<>jsonb_array_length(spec->'args') or meta.procost<>100 or meta.prorows<>0
   or meta.pronargdefaults<>(spec->>'defaults')::integer or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc p where p.pronamespace=meta.pronamespace and p.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from
    (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then spec->>'legacyHash' else spec->>'hash' end)
   then raise exception 'merchant_attendance_day_review_installation_conflict';end if;
  if has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  if spec->>'name'<>'faolla_valid_merchant_enterprise_permissions_v1' then
   if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
    or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
    or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl
     where acl.grantor<>expected_owner or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true
      or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
    then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  end if;
 end loop;
 
 foreach table_name in array array['merchant_attendance_day_review_cases','merchant_attendance_day_review_entries'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
    where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
     is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation))
   then raise exception 'merchant_attendance_day_review_table_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,actual_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_day_review_permission_conflict';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_day_review_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.faolla_day_review_expected_settings') then to_regclass(ns||'.merchant_attendance_settings')
    when to_regclass('pg_temp.faolla_day_review_expected_workers') then to_regclass(ns||'.merchant_attendance_workers')
    when to_regclass('pg_temp.faolla_day_review_expected_employees') then to_regclass(ns||'.merchant_enterprise_employees')
    when to_regclass('pg_temp.merchant_attendance_day_review_cases') then to_regclass(ns||'.merchant_attendance_day_review_cases') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit)
    is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_day_review_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_day_review_index_conflict';end if;
  for index_spec in select i.*,index_table.relname,index_table.relam from pg_index i join pg_class index_table on index_table.oid=i.indexrelid where i.indrelid=expected_table loop
   select i.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index i join pg_class index_table on index_table.oid=i.indexrelid where i.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
    is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table)
    or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_day_review_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_day_review_trigger_conflict';end if;
 end loop;
 for trigger_spec in select * from (values
  ('merchant_attendance_day_review_cases','day_review_case_pair',5,true),('merchant_attendance_day_review_cases','day_review_case_immutable',27,false),('merchant_attendance_day_review_cases','day_review_case_no_truncate',34,false),
  ('merchant_attendance_day_review_entries','day_review_entry_proof',7,false),('merchant_attendance_day_review_entries','day_review_entry_immutable',27,false),('merchant_attendance_day_review_entries','day_review_entry_no_truncate',34,false)
 ) t(table_name,trigger_name,kind,deferred) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(ns||'.'||trigger_spec.table_name) and tgname=trigger_spec.trigger_name and tgtype=trigger_spec.kind and tgenabled='O' and tgnargs=0 and tgqual is null
   and tgdeferrable=trigger_spec.deferred and tginitdeferred=trigger_spec.deferred and tgfoid=to_regprocedure(ns||'.faolla_attendance_day_review_guard_v1()')) then raise exception 'merchant_attendance_day_review_trigger_conflict';end if;
 end loop;
end;
$day_review_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610080199,'merchant_attendance_day_reviews') on conflict(version) do nothing;
--199 FINAL END
commit;
