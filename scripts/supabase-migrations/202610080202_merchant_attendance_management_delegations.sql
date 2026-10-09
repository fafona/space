--202 C03 FOUNDATION SOURCE CANDIDATE. Owner-managed finite action/resource
--grants only. NO seven-family executor, device consume, PIN setter, approval,
--audit exporter, old role update or production activation is supplied here.
--196/198/199 acceptance precedes202; never loosen their old body recipes to
--pretend that backward reentry after this forward upgrade is supported.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

--BEGIN GENERATED PREFLIGHT
do $management_prerequisites$ begin
 if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080189 and name='merchant_attendance_correction_delegation')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name='merchant_attendance_independent_workers')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080199 and name='merchant_attendance_day_reviews') then raise exception 'merchant_attendance_management_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080202 and name<>'merchant_attendance_management_delegations')
  or exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission') then raise exception 'merchant_attendance_management_installation_conflict';end if;
end;$management_prerequisites$;
create temp table management_expected_settings(merchant_id text primary key) on commit drop;
create temp table management_expected_employees(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
create temp table merchant_attendance_management_delegations(
 merchant_id text not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 delegate_employee_id uuid not null,
 delegate_auth_user_id uuid not null,
 delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
 delegated_action text not null check(delegated_action=any(array['worker_save','group_save','group_assign','group_end','group_cancel','location_save','rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw','terminal_prepare','terminal_revoke','pin_issue','pin_revoke','revision_approve','revision_reject','plan_exception_decide','audit_view','audit_export'])),
 capability text not null check(capability=any(array['attendance.workers.manage','attendance.groups.manage','attendance.locations.manage','attendance.rules.draft','attendance.rules.publish','attendance.rules.withdraw','attendance.terminals.pair','attendance.terminals.revoke','attendance.pin.issue','attendance.pin.revoke','attendance.correction.revision.review','attendance.plan_exception.review','attendance.audit.view','attendance.audit.export'])),
 scope jsonb not null,
 worker_id uuid,
 employee_id uuid,
 employee_auth_user_id uuid,
 employee_generation bigint check(employee_generation between 0 and 9007199254740990),
 valid_from timestamptz not null check(isfinite(valid_from)),
 valid_until timestamptz not null check(isfinite(valid_until) and valid_from<valid_until),
 reason text not null check(char_length(reason) between 1 and 200),
 command jsonb not null,
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_delegations_pk primary key(merchant_id,grant_id),
 constraint management_delegations_settings_fk foreign key(merchant_id) references pg_temp.management_expected_settings(merchant_id) on delete restrict,
 constraint management_delegations_delegate_fk foreign key(merchant_id,delegate_employee_id) references pg_temp.management_expected_employees(merchant_id,id) on delete restrict,
 constraint management_delegations_employee_fk foreign key(merchant_id,employee_id) references pg_temp.management_expected_employees(merchant_id,id) on delete restrict,
 constraint management_delegations_binding_ck check((employee_id is null and employee_auth_user_id is null and employee_generation is null) or (employee_id is not null and employee_auth_user_id is not null and employee_generation is not null and worker_id is not null))
) on commit drop;
create temp table merchant_attendance_management_delegation_revocations(
 merchant_id text not null,
 operation_id uuid not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 reason text not null check(char_length(reason) between 1 and 200),
 command jsonb not null,
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_revocations_pk primary key(merchant_id,operation_id),
 constraint management_revocations_grant_uq unique(merchant_id,grant_id),
 constraint management_revocations_grant_fk foreign key(merchant_id,grant_id) references pg_temp.merchant_attendance_management_delegations(merchant_id,grant_id) on delete restrict,
 constraint management_revocations_operation_ck check(operation_id<>grant_id)
) on commit drop;
create temp table merchant_attendance_management_delegation_operations(
 merchant_id text not null,
 operation_id uuid not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 delegate_employee_id uuid not null,
 delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
 delegated_action text not null check(delegated_action=any(array['worker_save','group_save','group_assign','group_end','group_cancel','location_save','rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw','terminal_prepare','terminal_revoke','pin_issue','pin_revoke','revision_approve','revision_reject','plan_exception_decide','audit_view','audit_export'])),
 business_operation_id uuid not null,
 business_reference_id uuid not null,
 business_revision bigint not null check(business_revision between 1 and 9007199254740990),
 business_fingerprint text not null check(business_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_operations_pk primary key(merchant_id,operation_id),
 constraint management_operations_business_uq unique(merchant_id,delegated_action,business_operation_id),
 constraint management_operations_grant_fk foreign key(merchant_id,grant_id) references pg_temp.merchant_attendance_management_delegations(merchant_id,grant_id) on delete restrict,
 constraint management_operations_employee_fk foreign key(merchant_id,delegate_employee_id) references pg_temp.management_expected_employees(merchant_id,id) on delete restrict
) on commit drop;
create index attendance_management_delegate_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,delegate_employee_id,grant_id);
create index attendance_management_target_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,employee_id,grant_id);
create index attendance_management_action_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,delegated_action,grant_id);
create index attendance_management_operation_actor_idx on pg_temp.merchant_attendance_management_delegation_operations(merchant_id,actor_auth_user_id,operation_id);
create temp table management_shared_metadata on commit drop as select proc.oid,to_jsonb(proc)-'prosrc' metadata from pg_proc proc where proc.oid=any(array['public.faolla_valid_merchant_enterprise_permissions_v1(text[])'::regprocedure::oid,'public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)'::regprocedure::oid]);
do $management_preflight$
declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;f regprocedure;meta record;own_spec jsonb;forwards jsonb;
 actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;
 index_spec record;actual_index record;trigger_spec record;
begin
 select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_management_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080202 and name='merchant_attendance_management_delegations');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 forwards:=$management_forward_manifest${"catalog185":{"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","newHash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b"},"catalog190":{"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","newHash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792"},"capture":{"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","newHash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907"}}$management_forward_manifest$::jsonb;
 own_spec:=$management_dependencies$[{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}]$management_dependencies$::jsonb;
 for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;
 own_spec:=jsonb_build_array((forwards->(case when has190 then 'catalog190' else 'catalog185' end))||jsonb_build_object('hash',(forwards->(case when has190 then 'catalog190' else 'catalog185' end))->>(case when installed then 'newHash' else 'oldHash' end)),
 (forwards->'capture')||jsonb_build_object('hash',forwards->'capture'->>(case when installed then 'newHash' else 'oldHash' end)));
 for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and proc.proname like 'faolla_attendance_management_%')<>(case when installed then 13 else 0 end)
  or exists(select 1 from unnest(array['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations']) expected(table_name) where (to_regclass(ns||'.'||expected.table_name) is not null)<>installed) then raise exception 'merchant_attendance_management_installation_conflict';end if;
 if not installed then return;end if;
 own_spec:=$management_own_manifest$[{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"07f4ddd1001f786eb0615d0396fd9bd1eca749fa995b82821e549684a9632bdc","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true}]$management_own_manifest$::jsonb;
 for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;
 foreach table_name in array array['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
    where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
     is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation))
   then raise exception 'merchant_attendance_management_table_conflict';end if;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_management_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.management_expected_settings') then to_regclass(ns||'.merchant_attendance_settings')
    when to_regclass('pg_temp.management_expected_employees') then to_regclass(ns||'.merchant_enterprise_employees')
    when to_regclass('pg_temp.merchant_attendance_management_delegations') then to_regclass(ns||'.merchant_attendance_management_delegations') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit)
    is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_management_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_management_index_conflict';end if;
  for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
   select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
    is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table)
    or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_management_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_management_trigger_conflict';end if;
  for trigger_spec in select * from (values('management_immutable',27,'faolla_attendance_events_append_only_v1'),('management_no_truncate',34,'faolla_attendance_events_append_only_v1'),('management_insert_guard',7,'faolla_attendance_management_insert_v1')) expected(name,kind,fn) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.'||trigger_spec.fn||'()')) then raise exception 'merchant_attendance_management_trigger_conflict';end if;
  end loop;
 end loop;
end;$management_preflight$;
--END GENERATED PREFLIGHT

create or replace function public.faolla_attendance_management_scalar_v1(p jsonb,k text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare v text:=p#>>'{}';t timestamptz;
begin
 if k='uuid' then return coalesce(jsonb_typeof(p)='string' and v~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false);end if;
 if k='uint' then return coalesce(jsonb_typeof(p)='number' and v~'^(0|[1-9][0-9]{0,15})$' and v::numeric<=9007199254740990,false);end if;
 if k='boolean' then return coalesce(jsonb_typeof(p)='boolean',false);end if;
 if k='reason' then return coalesce(jsonb_typeof(p)='string' and v=btrim(v) and char_length(v) between 1 and 200 and v!~'[[:cntrl:]]',false);end if;
 if k='stamp' then
  if jsonb_typeof(p) is distinct from 'string' or v!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then return false;end if;
  begin t:=v::timestamptz;exception when others then return false;end;
  return isfinite(t) and to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=v;
 end if;
 return false;
end;
$$;
create or replace function public.faolla_attendance_management_array_v1(p jsonb,allowed text[],minimum integer,maximum integer)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare item jsonb;prior text;v text;
begin
 if jsonb_typeof(p) is distinct from 'array' then return false;end if;
 if jsonb_array_length(p)<minimum or jsonb_array_length(p)>maximum then return false;end if;
 for item in select value from jsonb_array_elements(p) loop
  if jsonb_typeof(item) is distinct from 'string' then return false;end if;v:=item#>>'{}';
  if (allowed is null and not public.faolla_attendance_management_scalar_v1(item,'uuid')) or (allowed is not null and not(v=any(allowed))) or prior is not null and prior>=v then return false;end if;
  prior:=v;
 end loop;
 return true;
end;
$$;
create or replace function public.faolla_attendance_management_capability_v1(p text)
returns text language sql immutable set search_path=pg_catalog as $$
 select case p
 when 'worker_save' then 'attendance.workers.manage'
 when 'group_save' then 'attendance.groups.manage' when 'group_assign' then 'attendance.groups.manage' when 'group_end' then 'attendance.groups.manage' when 'group_cancel' then 'attendance.groups.manage'
 when 'location_save' then 'attendance.locations.manage'
 when 'rule_draft' then 'attendance.rules.draft' when 'rule_publish' then 'attendance.rules.publish' when 'rule_withdraw' then 'attendance.rules.withdraw'
 when 'personal_rule_approve' then 'attendance.rules.publish' when 'personal_rule_withdraw' then 'attendance.rules.withdraw'
 when 'operational_rule_draft' then 'attendance.rules.draft' when 'operational_rule_publish' then 'attendance.rules.publish' when 'operational_rule_withdraw' then 'attendance.rules.withdraw'
 when 'terminal_prepare' then 'attendance.terminals.pair' when 'terminal_revoke' then 'attendance.terminals.revoke'
 when 'pin_issue' then 'attendance.pin.issue' when 'pin_revoke' then 'attendance.pin.revoke'
 when 'revision_approve' then 'attendance.correction.revision.review' when 'revision_reject' then 'attendance.correction.revision.review'
 when 'plan_exception_decide' then 'attendance.plan_exception.review'
 when 'audit_view' then 'attendance.audit.view' when 'audit_export' then 'attendance.audit.export' else null end
$$;
create or replace function public.faolla_attendance_management_binding_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
begin
 if public.faolla_attendance_management_scalar_v1(p->'workerId','uuid') is distinct from true
  or public.faolla_attendance_management_scalar_v1(p->'employeeId','uuid') is distinct from true
  or public.faolla_attendance_management_scalar_v1(p->'employeeAuthUserId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 return jsonb_build_array(p->'workerId',p->'employeeId',p->'employeeAuthUserId');
end;
$$;
create or replace function public.faolla_attendance_management_scope_v1(p jsonb,a text)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare kind text:=p->>'kind';sub jsonb;ref jsonb;keys text[];
begin
 if p is null or octet_length(convert_to(p::text,'UTF8'))>12000 or public.faolla_attendance_management_capability_v1(a) is null then raise exception 'attendance_invalid_request';end if;
 if kind='worker' and a='worker_save' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','create','workerId','employeeId','employeeAuthUserId','locationIds']) is distinct from true
   or not public.faolla_attendance_management_scalar_v1(p->'create','boolean') or not public.faolla_attendance_management_array_v1(p->'locationIds',null,1,25) then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,p->'create',public.faolla_attendance_management_binding_v1(p),p->'locationIds');
 elsif kind='group' and a='group_save' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','groupId','create']) is distinct from true or not public.faolla_attendance_management_scalar_v1(p->'groupId','uuid') or not public.faolla_attendance_management_scalar_v1(p->'create','boolean') then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,p->'groupId',p->'create');
 elsif kind='group_worker' and a in('group_assign','group_end','group_cancel') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','groupId','assignmentId','workerId','employeeId','employeeAuthUserId','locationIds']) is distinct from true
   or not public.faolla_attendance_management_scalar_v1(p->'groupId','uuid') or not public.faolla_attendance_management_array_v1(p->'locationIds',null,1,25)
   or (a='group_assign') is distinct from (p->'assignmentId'='null'::jsonb) or a<>'group_assign' and not public.faolla_attendance_management_scalar_v1(p->'assignmentId','uuid') then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,p->'groupId',p->'assignmentId',public.faolla_attendance_management_binding_v1(p),p->'locationIds');
 elsif kind='location' and a='location_save' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','locationId','create']) is distinct from true or not public.faolla_attendance_management_scalar_v1(p->'locationId','uuid') or not public.faolla_attendance_management_scalar_v1(p->'create','boolean') then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,p->'locationId',p->'create');
 elsif kind='rules' and a in('rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','family','subject','allowedRuleKeys','locationIds']) is distinct from true
   or (case when a like 'operational_rule_%' then 'operational' when a like 'personal_rule_%' then 'personal' else 'base' end) is distinct from p->>'family'
   or not public.faolla_attendance_management_array_v1(p->'locationIds',null,0,25) then raise exception 'attendance_invalid_request';end if;
  sub:=p->'subject';
  if sub->>'kind'='enterprise' then
   if public.faolla_attendance_shift_rule_binding_object_v1(sub,array['kind']) is distinct from true then raise exception 'attendance_invalid_request';end if;ref:=jsonb_build_array('enterprise');
  elsif sub->>'kind'='group' then
   if public.faolla_attendance_shift_rule_binding_object_v1(sub,array['kind','groupId']) is distinct from true or not public.faolla_attendance_management_scalar_v1(sub->'groupId','uuid') then raise exception 'attendance_invalid_request';end if;ref:=jsonb_build_array('group',sub->'groupId');
  elsif sub->>'kind'='personal' then
   if public.faolla_attendance_shift_rule_binding_object_v1(sub,array['kind','workerId','employeeId','employeeAuthUserId']) is distinct from true then raise exception 'attendance_invalid_request';end if;ref:=jsonb_build_array('personal',public.faolla_attendance_management_binding_v1(sub));
  else raise exception 'attendance_invalid_request';end if;
  if p->>'family'='personal' and sub->>'kind'<>'personal' or p->>'family'='base' and sub->>'kind'='personal' then raise exception 'attendance_invalid_request';end if;
  keys:=case when p->>'family'='operational' then array['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders'] else array['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes'] end;
  if not public.faolla_attendance_management_array_v1(p->'allowedRuleKeys',keys,1,cardinality(keys)) then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,p->'family',ref,p->'allowedRuleKeys',p->'locationIds');
 elsif kind='terminal' and a in('terminal_prepare','terminal_revoke') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','terminalId','locationId','create']) is distinct from true or not public.faolla_attendance_management_scalar_v1(p->'terminalId','uuid') or not public.faolla_attendance_management_scalar_v1(p->'locationId','uuid') or p->'create' is distinct from to_jsonb(a='terminal_prepare') then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,p->'terminalId',p->'locationId',p->'create');
 elsif kind='member_pin' and a in('pin_issue','pin_revoke') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','workerId','employeeId','employeeAuthUserId','locationIds']) is distinct from true or not public.faolla_attendance_management_array_v1(p->'locationIds',null,1,25) then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,public.faolla_attendance_management_binding_v1(p),p->'locationIds');
 elsif kind='independent_pin' and a in('pin_issue','pin_revoke') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','workerId','subjectId','generation','locationIds']) is distinct from true or not public.faolla_attendance_management_scalar_v1(p->'workerId','uuid') or not public.faolla_attendance_management_scalar_v1(p->'subjectId','uuid') or not public.faolla_attendance_management_scalar_v1(p->'generation','uint') or (p->>'generation')::numeric<1 or not public.faolla_attendance_management_array_v1(p->'locationIds',null,1,25) then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,p->'workerId',p->'subjectId',p->'generation',p->'locationIds');
 elsif kind in('revision','formal_exception') and (kind='revision' and a in('revision_approve','revision_reject') or kind='formal_exception' and a='plan_exception_decide') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','workerId','employeeId','employeeAuthUserId','locationIds','includePending']) is distinct from true or not public.faolla_attendance_management_scalar_v1(p->'includePending','boolean') or not public.faolla_attendance_management_array_v1(p->'locationIds',null,1,25) then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,public.faolla_attendance_management_binding_v1(p),p->'locationIds',p->'includePending');
 elsif kind='audit_worker' and a in('audit_view','audit_export') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','workerId','employeeId','employeeAuthUserId','locationIds','sources']) is distinct from true or not public.faolla_attendance_management_array_v1(p->'locationIds',null,1,25) or not public.faolla_attendance_management_array_v1(p->'sources',array['config','scope','management'],1,3) then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,public.faolla_attendance_management_binding_v1(p),p->'locationIds',p->'sources');
 elsif kind='audit_company' and a in('audit_view','audit_export') then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['kind','sources']) is distinct from true or not public.faolla_attendance_management_array_v1(p->'sources',array['config','management'],1,2) then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(kind,p->'sources');
 end if;
 raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_management_command_v1(p jsonb)
returns void language plpgsql immutable set search_path=pg_catalog as $$
declare target jsonb;
begin
 if p is null or octet_length(convert_to(p::text,'UTF8'))>16384 or not public.faolla_attendance_management_scalar_v1(p->'operationId','uuid') or not public.faolla_attendance_management_scalar_v1(p->'reason','reason') then raise exception 'attendance_invalid_request';end if;
 if p->>'action'='revoke' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','grantId','expectedRevision','reason']) is distinct from true or p->'expectedRevision' is distinct from '1'::jsonb or not public.faolla_attendance_management_scalar_v1(p->'grantId','uuid') then raise exception 'attendance_invalid_request';end if;return;
 end if;
 if p->>'action' is distinct from 'grant' or public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','delegateEmployeeId','delegateAuthUserId','delegatedAction','scope','validFrom','validUntil','reason']) is distinct from true
  or not public.faolla_attendance_management_scalar_v1(p->'delegateEmployeeId','uuid') or not public.faolla_attendance_management_scalar_v1(p->'delegateAuthUserId','uuid')
  or not public.faolla_attendance_management_scalar_v1(p->'validFrom','stamp') or not public.faolla_attendance_management_scalar_v1(p->'validUntil','stamp')
  or (p->>'validFrom')::timestamptz>=(p->>'validUntil')::timestamptz then raise exception 'attendance_invalid_request';end if;
 perform public.faolla_attendance_management_scope_v1(p->'scope',p->>'delegatedAction');
 target:=case when p->'scope' ? 'employeeId' then p->'scope' when p->'scope'->>'kind'='rules' and p->'scope'->'subject'->>'kind'='personal' then p->'scope'->'subject' else null end;
 if target is not null and p->>'delegatedAction' not in('audit_view','audit_export') and (target->'employeeId'=p->'delegateEmployeeId' or target->'employeeAuthUserId'=p->'delegateAuthUserId') then raise exception 'attendance_invalid_request';end if;
end;
$$;
create or replace function public.faolla_attendance_management_hash_v1(site text,actor uuid,c jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
 perform public.faolla_attendance_management_command_v1(c);
 if site is null or site!~'^[0-9]{8}$' or actor is null then raise exception 'attendance_invalid_request';end if;
 return public.faolla_attendance_operational_rule_hash_v1(case when c->>'action'='grant' then
  jsonb_build_array('attendance-management-delegation-command-v1',site,actor,c->'action',c->'operationId',c->'delegateEmployeeId',c->'delegateAuthUserId',c->'delegatedAction',public.faolla_attendance_management_scope_v1(c->'scope',c->>'delegatedAction'),c->'validFrom',c->'validUntil',c->'reason')
  else jsonb_build_array('attendance-management-delegation-command-v1',site,actor,c->'action',c->'operationId',c->'grantId',c->'expectedRevision',c->'reason') end);
end;
$$;

create table if not exists public.merchant_attendance_management_delegations(
 merchant_id text not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 delegate_employee_id uuid not null,
 delegate_auth_user_id uuid not null,
 delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
 delegated_action text not null check(delegated_action=any(array['worker_save','group_save','group_assign','group_end','group_cancel','location_save','rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw','terminal_prepare','terminal_revoke','pin_issue','pin_revoke','revision_approve','revision_reject','plan_exception_decide','audit_view','audit_export'])),
 capability text not null check(capability=any(array['attendance.workers.manage','attendance.groups.manage','attendance.locations.manage','attendance.rules.draft','attendance.rules.publish','attendance.rules.withdraw','attendance.terminals.pair','attendance.terminals.revoke','attendance.pin.issue','attendance.pin.revoke','attendance.correction.revision.review','attendance.plan_exception.review','attendance.audit.view','attendance.audit.export'])),
 scope jsonb not null,
 worker_id uuid,
 employee_id uuid,
 employee_auth_user_id uuid,
 employee_generation bigint check(employee_generation between 0 and 9007199254740990),
 valid_from timestamptz not null check(isfinite(valid_from)),
 valid_until timestamptz not null check(isfinite(valid_until) and valid_from<valid_until),
 reason text not null check(char_length(reason) between 1 and 200),
 command jsonb not null,
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_delegations_pk primary key(merchant_id,grant_id),
 constraint management_delegations_settings_fk foreign key(merchant_id) references public.merchant_attendance_settings(merchant_id) on delete restrict,
 constraint management_delegations_delegate_fk foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
 constraint management_delegations_employee_fk foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
 constraint management_delegations_binding_ck check((employee_id is null and employee_auth_user_id is null and employee_generation is null) or (employee_id is not null and employee_auth_user_id is not null and employee_generation is not null and worker_id is not null))
);
create table if not exists public.merchant_attendance_management_delegation_revocations(
 merchant_id text not null,
 operation_id uuid not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 reason text not null check(char_length(reason) between 1 and 200),
 command jsonb not null,
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_revocations_pk primary key(merchant_id,operation_id),
 constraint management_revocations_grant_uq unique(merchant_id,grant_id),
 constraint management_revocations_grant_fk foreign key(merchant_id,grant_id) references public.merchant_attendance_management_delegations(merchant_id,grant_id) on delete restrict,
 constraint management_revocations_operation_ck check(operation_id<>grant_id)
);
--Future explicit family writers must append an actual-business authority
--sidecar in the same transaction. FOUNDATION denies every insert into this
--table; it is not a browser-supplied JSON executor or reusable authorization.
create table if not exists public.merchant_attendance_management_delegation_operations(
 merchant_id text not null,
 operation_id uuid not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 delegate_employee_id uuid not null,
 delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
 delegated_action text not null check(delegated_action=any(array['worker_save','group_save','group_assign','group_end','group_cancel','location_save','rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw','terminal_prepare','terminal_revoke','pin_issue','pin_revoke','revision_approve','revision_reject','plan_exception_decide','audit_view','audit_export'])),
 business_operation_id uuid not null,
 business_reference_id uuid not null,
 business_revision bigint not null check(business_revision between 1 and 9007199254740990),
 business_fingerprint text not null check(business_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),
 constraint management_operations_pk primary key(merchant_id,operation_id),
 constraint management_operations_business_uq unique(merchant_id,delegated_action,business_operation_id),
 constraint management_operations_grant_fk foreign key(merchant_id,grant_id) references public.merchant_attendance_management_delegations(merchant_id,grant_id) on delete restrict,
 constraint management_operations_employee_fk foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict
);
create index if not exists attendance_management_delegate_idx on public.merchant_attendance_management_delegations(merchant_id,delegate_employee_id,grant_id);
create index if not exists attendance_management_target_idx on public.merchant_attendance_management_delegations(merchant_id,employee_id,grant_id);
create index if not exists attendance_management_action_idx on public.merchant_attendance_management_delegations(merchant_id,delegated_action,grant_id);
create index if not exists attendance_management_operation_actor_idx on public.merchant_attendance_management_delegation_operations(merchant_id,actor_auth_user_id,operation_id);

--The remaining foundation functions, security and exact forward recipes are
--added below before removing the mandatory unfrozen abort above.
create or replace function public.faolla_attendance_management_scope_context_v1(site text,p jsonb,a text)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare target jsonb;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
 sub public.merchant_attendance_independent_subjects%rowtype;kind text:=p->>'kind';resource uuid;locations uuid[];
begin
 perform public.faolla_attendance_management_scope_v1(p,a);
 target:=case when p ? 'employeeId' then p when kind='rules' and p->'subject'->>'kind'='personal' then p->'subject' else null end;
 locations:=case when p ? 'locationIds' then array(select value::uuid from jsonb_array_elements_text(p->'locationIds')) else array[]::uuid[] end;
 if exists(select 1 from unnest(locations) requested(id) where not exists(select 1 from public.merchant_attendance_locations actual where actual.merchant_id=site and actual.id=requested.id)) then return null;end if;
 if target is not null then
  select * into w from public.merchant_attendance_workers actual where actual.merchant_id=site and actual.id=(target->>'workerId')::uuid for share;
  select * into e from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=(target->>'employeeId')::uuid for share;
  if e.id is null or e.auth_user_id is distinct from (target->>'employeeAuthUserId')::uuid then return null;end if;
  if kind='worker' and p->'create'='true'::jsonb then
   if w.id is not null or exists(select 1 from public.merchant_attendance_workers actual where actual.merchant_id=site and actual.employee_id=e.id) then return null;end if;
  elsif w.id is null or w.employee_id is distinct from e.id or cardinality(locations)>0 and not(w.default_location_id=any(locations)) then return null;end if;
 end if;
 if kind='independent_pin' then
  select * into sub from public.merchant_attendance_independent_subjects actual where actual.merchant_id=site and actual.subject_id=(p->>'subjectId')::uuid for share;
  select * into w from public.merchant_attendance_workers actual where actual.merchant_id=site and actual.id=(p->>'workerId')::uuid for share;
  if sub.subject_id is null or sub.worker_id is distinct from w.id or sub.state<>'independent' or sub.generation<>(p->>'generation')::bigint or w.employee_id is not null or not(w.default_location_id=any(locations)) then return null;end if;
 end if;
 if kind in('group','group_worker') or kind='rules' and p->'subject'->>'kind'='group' then
  resource:=(case when kind='rules' then p->'subject'->>'groupId' else p->>'groupId' end)::uuid;
  perform 1 from public.merchant_attendance_groups actual where actual.merchant_id=site and actual.group_id=resource for share;
  if (kind='group' and p->'create'='true'::jsonb)=(found) then return null;end if;
  if kind='group_worker' and p->'assignmentId'<>'null'::jsonb and not exists(select 1 from public.merchant_attendance_group_assignments actual where actual.merchant_id=site and actual.assignment_id=(p->>'assignmentId')::uuid and actual.group_id=resource and actual.worker_id=w.id and actual.employee_id=e.id) then return null;end if;
 end if;
 if kind='location' then
  perform 1 from public.merchant_attendance_locations actual where actual.merchant_id=site and actual.id=(p->>'locationId')::uuid for share;
  if (p->'create'='true'::jsonb)=(found) then return null;end if;
 end if;
 if kind='terminal' then
  perform 1 from public.merchant_attendance_locations actual where actual.merchant_id=site and actual.id=(p->>'locationId')::uuid for share;if not found then return null;end if;
  perform 1 from public.merchant_attendance_terminals actual where actual.merchant_id=site and actual.id=(p->>'terminalId')::uuid and actual.location_id=(p->>'locationId')::uuid for share;
  if (p->'create'='true'::jsonb)=(found) then return null;end if;
  if p->'create'='true'::jsonb and exists(select 1 from public.merchant_attendance_terminals actual where actual.merchant_id=site and actual.id=(p->>'terminalId')::uuid) then return null;end if;
 end if;
 --No blanket target-active guard. Historical review/audit does not alter the
 --target's clock qualification. Each future family keeps its actual old gates.
 return jsonb_build_object('workerId',case when target is not null then target->'workerId' when kind='independent_pin' then p->'workerId' else null end,
  'employeeId',target->'employeeId','employeeAuthUserId',target->'employeeAuthUserId','generation',case when target is null then null else
   coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=site and epoch.employee_id=e.id),0) end);
end;
$$;
create or replace function public.faolla_attendance_management_current_v1(g public.merchant_attendance_management_delegations,at_time timestamptz)
returns boolean language plpgsql set search_path=pg_catalog as $$
declare context jsonb;
begin
 if not isfinite(at_time) or at_time<g.valid_from or at_time>=g.valid_until
  or not exists(select 1 from public.merchant_attendance_settings actual where actual.merchant_id=g.merchant_id and actual.enabled)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=g.merchant_id and actual.grant_id=g.grant_id)
  or not exists(select 1 from public.merchants actual where actual.id=g.merchant_id and actual.user_id=g.actor_auth_user_id)
  or not exists(select 1 from public.merchant_enterprise_employees employee join public.merchant_enterprise_roles role_row on role_row.merchant_id=employee.merchant_id and role_row.id=employee.role_id
   where employee.merchant_id=g.merchant_id and employee.id=g.delegate_employee_id and employee.auth_user_id=g.delegate_auth_user_id and employee.status='active'
    and role_row.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) and role_row.permissions @> array['enterprise.view',g.capability])
  or g.delegate_generation<>coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=g.merchant_id and epoch.employee_id=g.delegate_employee_id),0)
  or exists(select 1 from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=g.merchant_id and epoch.employee_id=g.delegate_employee_id and epoch.paused) then return false;end if;
 context:=public.faolla_attendance_management_scope_context_v1(g.merchant_id,g.scope,g.delegated_action);
 return context is not null and row(g.worker_id,g.employee_id,g.employee_auth_user_id,g.employee_generation) is not distinct from
  row((context->>'workerId')::uuid,(context->>'employeeId')::uuid,(context->>'employeeAuthUserId')::uuid,(context->>'generation')::bigint);
end;
$$;
create or replace function public.faolla_attendance_management_receipt_v1(site text,op uuid,actor uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;r public.merchant_attendance_management_delegation_revocations%rowtype;
begin
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=op and actual.actor_auth_user_id=actor;
 if g.grant_id is not null then
  if g.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(site,actor,g.command) then raise exception 'attendance_management_delegation_invalid';end if;
  return jsonb_build_object('operationId',op,'actorId',actor,'action','grant','grantId',op,'revision',1,'commandFingerprint',g.command_fingerprint,'recordedAt',to_char(g.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 end if;
 select * into r from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.operation_id=op and actual.actor_auth_user_id=actor;
 if r.operation_id is null then return null;end if;
 if r.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(site,actor,r.command) then raise exception 'attendance_management_delegation_invalid';end if;
 return jsonb_build_object('operationId',op,'actorId',actor,'action','revoke','grantId',r.grant_id,'revision',2,'commandFingerprint',r.command_fingerprint,'recordedAt',to_char(r.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
create or replace function public.faolla_attendance_management_grant_v1(g public.merchant_attendance_management_delegations,at_time timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare r public.merchant_attendance_management_delegation_revocations%rowtype;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
 select * into r from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=g.merchant_id and actual.grant_id=g.grant_id;
 return jsonb_build_object('grantId',g.grant_id,'revision',case when r.operation_id is null then 1 else 2 end,'status',case when r.operation_id is null then 'granted' else 'revoked' end,
  'ownerId',g.actor_auth_user_id,'delegate',jsonb_build_object('employeeId',g.delegate_employee_id,'authUserId',g.delegate_auth_user_id,'generation',g.delegate_generation),
  'delegatedAction',g.delegated_action,'capability',g.capability,'scope',g.scope,'targetGeneration',g.employee_generation,
  'validFrom',to_char(g.valid_from at time zone 'UTC',fmt),'validUntil',to_char(g.valid_until at time zone 'UTC',fmt),'reason',g.reason,'grantedAt',to_char(g.recorded_at at time zone 'UTC',fmt),
  'revocation',case when r.operation_id is null then null else jsonb_build_object('operationId',r.operation_id,'actorId',r.actor_auth_user_id,'reason',r.reason,'recordedAt',to_char(r.recorded_at at time zone 'UTC',fmt)) end,
  'authorityCurrent',public.faolla_attendance_management_current_v1(g,at_time));
end;
$$;
create or replace function public.faolla_attendance_management_insert_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;
 perform public.faolla_attendance_management_command_v1(new.command);
 perform 1 from public.merchants actual where actual.id=new.merchant_id and actual.user_id=new.actor_auth_user_id for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=new.merchant_id for update;if not found then raise exception 'attendance_settings_required';end if;
 stamp:=clock_timestamp();
 if new.command_fingerprint is distinct from public.faolla_attendance_management_hash_v1(new.merchant_id,new.actor_auth_user_id,new.command)
  or new.reason is distinct from new.command->>'reason' or not isfinite(new.recorded_at) or new.recorded_at>stamp then raise exception 'attendance_management_delegation_invalid';end if;
 if tg_table_name='merchant_attendance_management_delegations' then
  if new.command->>'action' is distinct from 'grant' or row(new.grant_id::text,new.delegate_employee_id::text,new.delegate_auth_user_id::text,new.delegated_action) is distinct from row(new.command->>'operationId',new.command->>'delegateEmployeeId',new.command->>'delegateAuthUserId',new.command->>'delegatedAction')
   or new.scope is distinct from new.command->'scope' or new.capability is distinct from public.faolla_attendance_management_capability_v1(new.delegated_action)
   or new.valid_from is distinct from (new.command->>'validFrom')::timestamptz or new.valid_until is distinct from (new.command->>'validUntil')::timestamptz or new.valid_until<=stamp then raise exception 'attendance_management_delegation_invalid';end if;
  context:=public.faolla_attendance_management_scope_context_v1(new.merchant_id,new.scope,new.delegated_action);
  if context is null or row(new.worker_id,new.employee_id,new.employee_auth_user_id,new.employee_generation) is distinct from row((context->>'workerId')::uuid,(context->>'employeeId')::uuid,(context->>'employeeAuthUserId')::uuid,(context->>'generation')::bigint)
   or new.delegate_generation<>coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=new.merchant_id and epoch.employee_id=new.delegate_employee_id),0)
   or exists(select 1 from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=new.merchant_id and epoch.employee_id=new.delegate_employee_id and epoch.paused)
   or not exists(select 1 from public.merchant_enterprise_employees employee join public.merchant_enterprise_roles role_row on role_row.merchant_id=employee.merchant_id and role_row.id=employee.role_id
    where employee.merchant_id=new.merchant_id and employee.id=new.delegate_employee_id and employee.auth_user_id=new.delegate_auth_user_id and employee.status='active' and role_row.status='active'
     and public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) and role_row.permissions @> array['enterprise.view',new.capability]) then raise exception 'attendance_management_delegation_scope_invalid';end if;
  if exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.grant_id)
   or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.grant_id) then raise exception 'attendance_operation_conflict';end if;
 elsif tg_table_name='merchant_attendance_management_delegation_revocations' then
  select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=new.merchant_id and actual.grant_id=new.grant_id for share;
  if new.command->>'action' is distinct from 'revoke' or row(new.operation_id::text,new.grant_id::text) is distinct from row(new.command->>'operationId',new.command->>'grantId') or g.grant_id is null or new.recorded_at<g.recorded_at then raise exception 'attendance_management_delegation_invalid';end if;
  if exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=new.merchant_id and actual.grant_id=new.operation_id)
   or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.operation_id) then raise exception 'attendance_operation_conflict';end if;
 else raise exception 'attendance_management_delegation_invalid';end if;
 return new;
end;
$$;
create or replace function public.faolla_attendance_management_delegations_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_grant boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text:=p_query->>'siteId';mode text:=p_query->>'mode';op uuid;g public.merchant_attendance_management_delegations%rowtype;
 r public.merchant_attendance_management_delegation_revocations%rowtype;receipt jsonb;common jsonb;context jsonb;stamp timestamptz;fingerprint text;
 items jsonb:='[]';next_id uuid;count_items integer:=0;stored jsonb;stored_actor uuid;after_id uuid;settings_enabled boolean;
begin
 if p_auth_user_id is null or site is null or site!~'^[0-9]{8}$' or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>4096 or p_allow_grant is null then raise exception 'attendance_invalid_request';end if;
 if mode='list' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','mode','afterId','state','delegatedAction']) is distinct from true
   or p_query->>'state' is null or p_query->>'state' not in('all','granted','revoked') or p_query->'afterId'<>'null'::jsonb and not public.faolla_attendance_management_scalar_v1(p_query->'afterId','uuid')
   or p_query->'delegatedAction'<>'null'::jsonb and public.faolla_attendance_management_capability_v1(p_query->>'delegatedAction') is null then raise exception 'attendance_invalid_request';end if;after_id:=(p_query->>'afterId')::uuid;
 elsif mode='detail' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','mode','grantId']) is distinct from true or not public.faolla_attendance_management_scalar_v1(p_query->'grantId','uuid') then raise exception 'attendance_invalid_request';end if;
 elsif mode='recover' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','mode','operationId']) is distinct from true or not public.faolla_attendance_management_scalar_v1(p_query->'operationId','uuid') or p_command is not null then raise exception 'attendance_invalid_request';end if;
 elsif mode='write' then
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','mode']) is distinct from true or p_command is null then raise exception 'attendance_invalid_request';end if;
 else raise exception 'attendance_invalid_request';end if;
 if mode<>'write' and p_command is not null then raise exception 'attendance_invalid_request';end if;
 if p_command is not null then perform public.faolla_attendance_management_command_v1(p_command);op:=(p_command->>'operationId')::uuid;fingerprint:=public.faolla_attendance_management_hash_v1(site,p_auth_user_id,p_command);end if;
 --Recovery is deliberately ahead of CURRENT owner/membership/pause/rollout.
 --It returns only an exact original actor receipt, never current grant body.
 if mode='recover' then
  receipt:=public.faolla_attendance_management_receipt_v1(site,(p_query->>'operationId')::uuid,p_auth_user_id);
  return jsonb_build_object('protocol','attendance-management-delegations-v1','kind','receipt','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'receipt',receipt);
 end if;
 if op is not null then
  select actor_auth_user_id,command into stored_actor,stored from (
   select actual.actor_auth_user_id,actual.command from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=op
   union all select actual.actor_auth_user_id,actual.command from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.operation_id=op) original;
  if stored is not null then
   if stored_actor is distinct from p_auth_user_id or stored is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
   receipt:=public.faolla_attendance_management_receipt_v1(site,op,p_auth_user_id);if receipt->>'commandFingerprint' is distinct from fingerprint then raise exception 'attendance_operation_conflict';end if;
   return jsonb_build_object('protocol','attendance-management-delegations-v1','kind','receipt','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'receipt',receipt);
  end if;
 end if;
 perform 1 from public.merchants actual where actual.id=site and actual.user_id=p_auth_user_id for share;if not found then raise exception 'attendance_access_denied';end if;
 select actual.enabled into settings_enabled from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 --Settings is the existing common serialization point. Recheck original IDs
 --after waiting, before any fresh grant gate or read of current identity.
 if op is not null then
  select actor_auth_user_id,command into stored_actor,stored from (
   select actual.actor_auth_user_id,actual.command from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=op
   union all select actual.actor_auth_user_id,actual.command from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.operation_id=op) original;
  if stored is not null then
   if stored_actor is distinct from p_auth_user_id or stored is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
   receipt:=public.faolla_attendance_management_receipt_v1(site,op,p_auth_user_id);if receipt->>'commandFingerprint' is distinct from fingerprint then raise exception 'attendance_operation_conflict';end if;
   return jsonb_build_object('protocol','attendance-management-delegations-v1','kind','receipt','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'receipt',receipt);
  end if;
  if exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op) then raise exception 'attendance_operation_conflict';end if;
  if p_command->>'action'='grant' then
   if p_allow_grant is distinct from true or not settings_enabled then raise exception 'attendance_management_delegation_disabled';end if;
   context:=public.faolla_attendance_management_scope_context_v1(site,p_command->'scope',p_command->>'delegatedAction');
   if context is null then raise exception 'attendance_management_delegation_scope_invalid';end if;
   perform 1 from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=(p_command->>'delegateEmployeeId')::uuid for share;
   perform 1 from public.merchant_enterprise_roles actual where actual.merchant_id=site and actual.id=(select employee.role_id from public.merchant_enterprise_employees employee where employee.merchant_id=site and employee.id=(p_command->>'delegateEmployeeId')::uuid) for share;
   stamp:=clock_timestamp();
   insert into public.merchant_attendance_management_delegations(merchant_id,grant_id,actor_auth_user_id,delegate_employee_id,delegate_auth_user_id,delegate_generation,
    delegated_action,capability,scope,worker_id,employee_id,employee_auth_user_id,employee_generation,valid_from,valid_until,reason,command,command_fingerprint,recorded_at)
   values(site,op,p_auth_user_id,(p_command->>'delegateEmployeeId')::uuid,(p_command->>'delegateAuthUserId')::uuid,
    coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=site and epoch.employee_id=(p_command->>'delegateEmployeeId')::uuid),0),
    p_command->>'delegatedAction',public.faolla_attendance_management_capability_v1(p_command->>'delegatedAction'),p_command->'scope',
    (context->>'workerId')::uuid,(context->>'employeeId')::uuid,(context->>'employeeAuthUserId')::uuid,(context->>'generation')::bigint,
    (p_command->>'validFrom')::timestamptz,(p_command->>'validUntil')::timestamptz,p_command->>'reason',p_command,fingerprint,stamp);
  else
   select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=(p_command->>'grantId')::uuid for share;
   if g.grant_id is null then raise exception 'attendance_management_delegation_not_found';end if;
   if exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.grant_id=g.grant_id) then raise exception 'attendance_management_delegation_changed';end if;
   stamp:=clock_timestamp();if stamp<g.recorded_at then raise exception 'attendance_management_delegation_invalid';end if;
   insert into public.merchant_attendance_management_delegation_revocations(merchant_id,operation_id,grant_id,actor_auth_user_id,reason,command,command_fingerprint,recorded_at)
    values(site,op,g.grant_id,p_auth_user_id,p_command->>'reason',p_command,fingerprint,stamp);
  end if;
  receipt:=public.faolla_attendance_management_receipt_v1(site,op,p_auth_user_id);
  return jsonb_build_object('protocol','attendance-management-delegations-v1','kind','receipt','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'receipt',receipt);
 end if;
 stamp:=clock_timestamp();common:=jsonb_build_object('protocol','attendance-management-delegations-v1','kind',mode,'siteId',site,'actorId',p_auth_user_id,'readAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'canGrant',p_allow_grant and settings_enabled);
 if mode='detail' then
  select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=(p_query->>'grantId')::uuid;
  if g.grant_id is null then raise exception 'attendance_management_delegation_not_found';end if;
  return common||jsonb_build_object('item',public.faolla_attendance_management_grant_v1(g,stamp));
 end if;
 for g in select actual.* from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and (after_id is null or actual.grant_id>after_id)
  and (p_query->'delegatedAction'='null'::jsonb or actual.delegated_action=p_query->>'delegatedAction')
  and (p_query->>'state'='all' or (p_query->>'state'='revoked')=exists(select 1 from public.merchant_attendance_management_delegation_revocations revoke_row where revoke_row.merchant_id=site and revoke_row.grant_id=actual.grant_id))
  order by actual.grant_id limit 26 loop
  count_items:=count_items+1;if count_items>25 then next_id:=(items->24->>'grantId')::uuid;exit;end if;
  items:=items||jsonb_build_array(public.faolla_attendance_management_grant_v1(g,stamp));
 end loop;
 return common||jsonb_build_object('items',items,'nextId',next_id);
end;
$$;

-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_management_delegations'::regclass,
      'public.merchant_attendance_management_delegation_revocations'::regclass,
      'public.merchant_attendance_management_delegation_operations'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $management_security$
declare name text;t regclass;
begin
 foreach name in array array['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'] loop
  t:=to_regclass('public.'||name);execute format('alter table %s enable row level security',t);execute format('revoke all on %s from public,anon,authenticated,service_role',t);
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=t and actual.tgname='management_immutable') then execute format('create trigger management_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=t and actual.tgname='management_no_truncate') then execute format('create trigger management_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  if not exists(select 1 from pg_trigger actual where actual.tgrelid=t and actual.tgname='management_insert_guard') then execute format('create trigger management_insert_guard before insert on %s for each row execute function public.faolla_attendance_management_insert_v1()',t);end if;
 end loop;
end;$management_security$;
revoke all on function public.faolla_attendance_management_scalar_v1(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_capability_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_binding_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_scope_v1(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_hash_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_scope_context_v1(text,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_receipt_v1(text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_insert_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean) to service_role;

--EXACT TWO APPROVED SHARED FORWARDS ONLY, generated/pinned from185|190 and189.
--No role row is granted a new capability and no business writer is replaced.
--Generated recipe body and immutable metadata checks are inserted here.
--BEGIN GENERATED FORWARD
do $management_two_forwards$
declare installed boolean;has190 boolean;item record;old_body text;next_body text;definition text;
begin
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080202);if installed then return;end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 for item in select * from (values
  ('public.faolla_valid_merchant_enterprise_permissions_v1(text[])',case when has190 then $management_old190$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('attendance.records.view', array['enterprise.view']::text[]),
      ('attendance.self.export', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.reports.export', array['enterprise.view', 'attendance.records.view']::text[]),
      ('attendance.self.view', array['enterprise.view']::text[]),
      ('attendance.self.clock', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.request', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.correction.review', array['enterprise.view']::text[]),
      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.publish', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.cancel', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.period.view', array['enterprise.view']::text[]),
      ('attendance.period.send', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.respond', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.seal', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.reopen', array['enterprise.view', 'attendance.period.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$management_old190$ else $management_old185$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('attendance.records.view', array['enterprise.view']::text[]),
      ('attendance.self.export', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.reports.export', array['enterprise.view', 'attendance.records.view']::text[]),
      ('attendance.self.view', array['enterprise.view']::text[]),
      ('attendance.self.clock', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.request', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.publish', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.cancel', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.period.view', array['enterprise.view']::text[]),
      ('attendance.period.send', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.respond', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.seal', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.reopen', array['enterprise.view', 'attendance.period.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$management_old185$ end,
   case when has190 then $management_new190$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('attendance.records.view', array['enterprise.view']::text[]),
      ('attendance.self.export', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.reports.export', array['enterprise.view', 'attendance.records.view']::text[]),
      ('attendance.self.view', array['enterprise.view']::text[]),
      ('attendance.self.clock', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.request', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.correction.review', array['enterprise.view']::text[]),
      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.publish', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.cancel', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.period.view', array['enterprise.view']::text[]),
      ('attendance.period.send', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.respond', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.seal', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.reopen', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.workers.manage', array['enterprise.view']::text[]),
      ('attendance.groups.manage', array['enterprise.view']::text[]),
      ('attendance.locations.manage', array['enterprise.view']::text[]),
      ('attendance.rules.draft', array['enterprise.view']::text[]),
      ('attendance.rules.publish', array['enterprise.view']::text[]),
      ('attendance.rules.withdraw', array['enterprise.view']::text[]),
      ('attendance.terminals.pair', array['enterprise.view']::text[]),
      ('attendance.terminals.revoke', array['enterprise.view']::text[]),
      ('attendance.pin.issue', array['enterprise.view']::text[]),
      ('attendance.pin.revoke', array['enterprise.view']::text[]),
      ('attendance.correction.revision.review', array['enterprise.view']::text[]),
      ('attendance.plan_exception.review', array['enterprise.view']::text[]),
      ('attendance.audit.view', array['enterprise.view']::text[]),
      ('attendance.audit.export', array['enterprise.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$management_new190$ else $management_new185$
  with permission_catalog(permission, dependencies) as (
    values
      ('enterprise.view'::text, array[]::text[]),
      ('tasks.view', array['enterprise.view']::text[]),
      ('tasks.create', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.update', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.assign', array['enterprise.view', 'tasks.view']::text[]),
      ('tasks.archive', array['enterprise.view', 'tasks.view']::text[]),
      ('orders.linked.view', array['enterprise.view', 'tasks.view']::text[]),
      ('boards.manage', array['enterprise.view', 'tasks.view']::text[]),
      ('employees.view', array['enterprise.view', 'roles.view']::text[]),
      ('employees.manage', array['enterprise.view', 'employees.view', 'roles.view']::text[]),
      ('roles.view', array['enterprise.view']::text[]),
      ('roles.manage', array['enterprise.view', 'roles.view']::text[]),
      ('workflows.view', array['enterprise.view']::text[]),
      ('workflows.manage', array['enterprise.view', 'workflows.view']::text[]),
      ('workflows.publish', array['enterprise.view', 'workflows.view']::text[]),
      ('automations.view', array['enterprise.view', 'tasks.view', 'workflows.view']::text[]),
      (
        'automations.manage',
        array[
          'enterprise.view',
          'tasks.view',
          'tasks.create',
          'tasks.assign',
          'workflows.view',
          'automations.view',
          'roles.view',
          'employees.view'
        ]::text[]
      ),
      ('audit.view', array['enterprise.view']::text[]),
      ('attendance.records.view', array['enterprise.view']::text[]),
      ('attendance.self.export', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.reports.export', array['enterprise.view', 'attendance.records.view']::text[]),
      ('attendance.self.view', array['enterprise.view']::text[]),
      ('attendance.self.clock', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.request', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.leave', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.self.work_arrangement', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.missing.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.leave.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.work_arrangement.review', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.publish', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.schedule.cancel', array['enterprise.view', 'attendance.self.view']::text[]),
      ('attendance.period.view', array['enterprise.view']::text[]),
      ('attendance.period.send', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.respond', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.seal', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.period.reopen', array['enterprise.view', 'attendance.period.view']::text[]),
      ('attendance.workers.manage', array['enterprise.view']::text[]),
      ('attendance.groups.manage', array['enterprise.view']::text[]),
      ('attendance.locations.manage', array['enterprise.view']::text[]),
      ('attendance.rules.draft', array['enterprise.view']::text[]),
      ('attendance.rules.publish', array['enterprise.view']::text[]),
      ('attendance.rules.withdraw', array['enterprise.view']::text[]),
      ('attendance.terminals.pair', array['enterprise.view']::text[]),
      ('attendance.terminals.revoke', array['enterprise.view']::text[]),
      ('attendance.pin.issue', array['enterprise.view']::text[]),
      ('attendance.pin.revoke', array['enterprise.view']::text[]),
      ('attendance.correction.revision.review', array['enterprise.view']::text[]),
      ('attendance.plan_exception.review', array['enterprise.view']::text[]),
      ('attendance.audit.view', array['enterprise.view']::text[]),
      ('attendance.audit.export', array['enterprise.view']::text[]),
      ('redemptions.view', array[]::text[]),
      ('redemptions.customer_data.view', array['redemptions.view']::text[]),
      (
        'redemptions.checkout',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge',
        array['redemptions.view', 'redemptions.customer_data.view']::text[]
      ),
      (
        'redemptions.recharge.cancel',
        array[
          'redemptions.view',
          'redemptions.customer_data.view',
          'redemptions.recharge'
        ]::text[]
      ),
      ('redemptions.catalog.manage', array['redemptions.view']::text[]),
      ('redemptions.print', array['redemptions.view']::text[]),
      ('bookings.view', array[]::text[]),
      ('bookings.customer_data.view', array['bookings.view']::text[]),
      (
        'bookings.update',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.status.manage', array['bookings.view']::text[]),
      (
        'bookings.email.send',
        array['bookings.view', 'bookings.customer_data.view']::text[]
      ),
      ('bookings.analytics.view', array['bookings.view']::text[]),
      ('bookings.export', array['bookings.view']::text[]),
      ('bookings.settings.manage', array['bookings.view']::text[]),
      ('bookings.automation.manage', array['bookings.view']::text[]),
      ('bookings.calendar.manage', array['bookings.view']::text[]),
      ('orders.view', array[]::text[]),
      ('orders.customer_data.view', array['orders.view']::text[]),
      ('orders.status.manage', array['orders.view']::text[]),
      ('orders.complete', array['orders.view']::text[]),
      ('orders.items.update', array['orders.view']::text[]),
      ('orders.print', array['orders.view']::text[]),
      ('orders.analytics.view', array['orders.view']::text[]),
      ('orders.export', array['orders.view']::text[]),
      (
        'orders.export.customer_data',
        array['orders.view', 'orders.customer_data.view', 'orders.export']::text[]
      ),
      ('orders.catalog.view', array['orders.view']::text[]),
      (
        'orders.catalog.manage',
        array['orders.view', 'orders.catalog.view']::text[]
      ),
      ('conversations.view', array[]::text[]),
      ('conversations.search', array['conversations.view']::text[]),
      (
        'conversations.start',
        array['conversations.view', 'conversations.search']::text[]
      ),
      ('conversations.send', array['conversations.view']::text[]),
      ('members.view', array[]::text[]),
      ('members.customer_data.view', array['members.view']::text[]),
      ('members.account.view', array['members.view']::text[]),
      (
        'members.account.adjust',
        array['members.view', 'members.account.view']::text[]
      ),
      (
        'members.allergens.manage',
        array['members.view', 'members.customer_data.view']::text[]
      ),
      ('members.insights.view', array['members.view']::text[]),
      ('members.settings.manage', array['members.view']::text[])
  ),
  requested_permissions(permission) as (
    select item.permission
      from unnest(coalesce(p_permissions, '{}'::text[])) as item(permission)
  )
  select
    p_permissions is not null
    and cardinality(p_permissions) = (
      select count(distinct requested.permission)::integer
        from requested_permissions as requested
    )
    and not exists (
      select 1
        from requested_permissions as requested
        left join permission_catalog as catalog
          on catalog.permission = requested.permission
       where catalog.permission is null
    )
    and not exists (
      select 1
        from permission_catalog as catalog
       where catalog.permission = any(p_permissions)
         and not (catalog.dependencies <@ p_permissions)
    );
$management_new185$ end),
  ('public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)',$management_old_capture$
declare e public.merchant_enterprise_employees%rowtype;w public.merchant_attendance_workers%rowtype;
  ep public.merchant_attendance_account_epochs%rowtype;ev public.merchant_attendance_events%rowtype;c public.merchant_attendance_pin_credentials%rowtype;
  sid uuid;gen bigint;stamp timestamptz;pin_before integer;pin_after integer;
begin
  select * into ep from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  if ep.paused then return ep.suspension_id;end if;
  if ep.employee_id is null and not coalesce(p_enabled,false)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  if not exists(select 1 from public.merchant_attendance_settings x where x.merchant_id=p_site) then return null;end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee;
  if e.id is null or e.status<>'disabled' or p_actor is null then raise exception 'attendance_account_suspension_invalid';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  --No worker is manufactured for a delegate. Both legacy delegate indexes start
  --with merchant/employee; target grants already require a linked worker.
  if ep.employee_id is null and w.id is null and not exists(select 1 from public.merchant_attendance_missing_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_application_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
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
$management_old_capture$,$management_new_capture$
declare e public.merchant_enterprise_employees%rowtype;w public.merchant_attendance_workers%rowtype;
  ep public.merchant_attendance_account_epochs%rowtype;ev public.merchant_attendance_events%rowtype;c public.merchant_attendance_pin_credentials%rowtype;
  sid uuid;gen bigint;stamp timestamptz;pin_before integer;pin_after integer;
begin
  select * into ep from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  if ep.paused then return ep.suspension_id;end if;
  if ep.employee_id is null and not coalesce(p_enabled,false)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_management_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
  if not exists(select 1 from public.merchant_attendance_settings x where x.merchant_id=p_site) then return null;end if;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee;
  if e.id is null or e.status<>'disabled' or p_actor is null then raise exception 'attendance_account_suspension_invalid';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.employee_id=p_employee for update;
  --No worker is manufactured for a delegate. Both legacy delegate indexes start
  --with merchant/employee; target grants already require a linked worker.
  if ep.employee_id is null and w.id is null and not exists(select 1 from public.merchant_attendance_missing_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_application_delegations x where x.merchant_id=p_site and x.delegate_employee_id=p_employee)
    and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))
    and not exists(select 1 from public.merchant_attendance_management_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee)) then return null;end if;
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
$management_new_capture$)) forward_source(signature,old_body,new_body) loop
  select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid=to_regprocedure(item.signature);
  if old_body is distinct from item.old_body or position(old_body in definition)=0 then raise exception 'merchant_attendance_management_forward_drift';end if;
  next_body:=item.new_body;definition:=replace(definition,old_body,next_body);execute definition;
 end loop;
end;$management_two_forwards$;
--END GENERATED FORWARD
--BEGIN GENERATED POSTCONDITIONS
do $management_postconditions$
declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;f regprocedure;meta record;own_spec jsonb;forwards jsonb;
 actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;
 index_spec record;actual_index record;trigger_spec record;
begin
 select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_management_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080202 and name='merchant_attendance_management_delegations');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 forwards:=$management_forward_manifest${"catalog185":{"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","newHash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b"},"catalog190":{"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","newHash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792"},"capture":{"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","newHash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907"}}$management_forward_manifest$::jsonb;
 own_spec:=$management_post_dependencies$[{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}]$management_post_dependencies$::jsonb;
 for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;
 own_spec:=jsonb_build_array((forwards->(case when has190 then 'catalog190' else 'catalog185' end))||jsonb_build_object('hash',(forwards->(case when has190 then 'catalog190' else 'catalog185' end))->>'newHash'),(forwards->'capture')||jsonb_build_object('hash',forwards->'capture'->>'newHash'));
 for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;
 own_spec:=$management_post_own$[{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"07f4ddd1001f786eb0615d0396fd9bd1eca749fa995b82821e549684a9632bdc","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true}]$management_post_own$::jsonb;
 for spec in select value from jsonb_array_elements(own_spec) loop
  f:=to_regprocedure(replace(spec->>'signature','public.',ns||'.'));
  select proc.*,language.lanname into meta from pg_proc proc join pg_language language on language.oid=proc.prolang where proc.oid=f;
  if f is null or meta.proowner is distinct from expected_owner or meta.prosecdef is distinct from (spec->>'definer')::boolean
   or meta.proconfig is distinct from array[replace(spec->>'searchPath','public',ns)] or meta.provolatile::text is distinct from spec->>'volatility'
   or meta.lanname is distinct from spec->>'language' or meta.prorettype is distinct from to_regtype(replace(spec->>'result','public.',ns||'.'))
   or meta.proretset or meta.proisstrict or meta.proleakproof or meta.prokind<>'f' or meta.proparallel<>'u' or meta.prosupport<>0::oid
   or meta.proallargtypes is not null or meta.proargmodes is not null or meta.pronargs<>jsonb_array_length(spec->'args')
   or meta.procost<>100 or meta.prorows<>0 or meta.pronargdefaults<>(spec->>'defaults')::integer
   or coalesce(meta.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'args'))
   or pg_get_expr(meta.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or (select count(*) from pg_proc proc where proc.pronamespace=meta.pronamespace and proc.proname=meta.proname)<>1
   or encode(sha256(convert_to(replace(replace(meta.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or has_function_privilege(expected_owner,f,'EXECUTE') is distinct from true
   or (case when spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then (has_function_privilege(expected_owner,meta.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false))))
    else has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'isRpc')::boolean
   or exists(select 1 from aclexplode(coalesce(meta.proacl,acldefault('f',meta.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and ((spec->>'isRpc')::boolean is distinct from true or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable)) end)
   then raise exception 'merchant_attendance_management_function_conflict';end if;
 end loop;
 foreach table_name in array array['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum
    where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation)
     is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation))
   then raise exception 'merchant_attendance_management_table_conflict';end if;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_management_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.management_expected_settings') then to_regclass(ns||'.merchant_attendance_settings')
    when to_regclass('pg_temp.management_expected_employees') then to_regclass(ns||'.merchant_enterprise_employees')
    when to_regclass('pg_temp.merchant_attendance_management_delegations') then to_regclass(ns||'.merchant_attendance_management_delegations') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit)
    is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_management_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_management_index_conflict';end if;
  for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
   select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption)
    is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table)
    or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_management_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>3 then raise exception 'merchant_attendance_management_trigger_conflict';end if;
  for trigger_spec in select * from (values('management_immutable',27,'faolla_attendance_events_append_only_v1'),('management_no_truncate',34,'faolla_attendance_events_append_only_v1'),('management_insert_guard',7,'faolla_attendance_management_insert_v1')) expected(name,kind,fn) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.'||trigger_spec.fn||'()')) then raise exception 'merchant_attendance_management_trigger_conflict';end if;
  end loop;
 end loop;
 if (select count(*) from management_shared_metadata)<>2 or exists(select 1 from management_shared_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or (to_jsonb(proc)-'prosrc') is distinct from original.metadata) then raise exception 'merchant_attendance_management_forward_metadata_changed';end if;
end;$management_postconditions$;
drop table pg_temp.management_shared_metadata,pg_temp.merchant_attendance_management_delegation_operations,pg_temp.merchant_attendance_management_delegation_revocations,pg_temp.merchant_attendance_management_delegations,pg_temp.management_expected_employees,pg_temp.management_expected_settings;
--END GENERATED POSTCONDITIONS

insert into public.faolla_schema_migrations(version,name) values(202610080202,'merchant_attendance_management_delegations') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
