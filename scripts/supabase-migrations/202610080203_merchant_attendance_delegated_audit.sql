--203 finite delegated RESOURCE audit. No historical Auth reconstruction,
--owner impersonation, old owner RPC changes or generic family dispatcher.
--SOURCE only until separately installed/accepted in an owned synthetic context.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
--BEGIN GENERATED AUDIT PREFLIGHT
do $audit_prerequisites$ begin
 if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_settings') is null
  or not exists(select 1 from public.faolla_schema_migrations where version=202609300069 and name='merchant_attendance_audit_read')
  or not exists(select 1 from public.faolla_schema_migrations where version=202609300080 and name='merchant_attendance_audit_export')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080202 and name='merchant_attendance_management_delegations') then raise exception 'merchant_attendance_delegated_audit_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name<>'merchant_attendance_delegated_audit') then raise exception 'merchant_attendance_delegated_audit_installation_conflict';end if;
end;$audit_prerequisites$;
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
create temp table audit_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-'prosrc' metadata from pg_proc proc where proc.oid='public.faolla_attendance_management_insert_v1()'::regprocedure;
do $audit_preflight$
declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;f regprocedure;meta record;own_spec jsonb;
 actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;
 index_spec record;actual_index record;trigger_spec record;
begin
 select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_audit_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 own_spec:=$audit_dependencies$[{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_audit_value_v1","signature":"public.faolla_attendance_audit_value_v1(text,jsonb,boolean,uuid)","hash":"5031c8fe15669fe16cb1eb300ac1ccc45a74d04f258576e0002b619d9b25bdb3","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_kind","p_value","p_before","p_target"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}]$audit_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array($audit_guard_meta${"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"07f4ddd1001f786eb0615d0396fd9bd1eca749fa995b82821e549684a9632bdc","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}$audit_guard_meta$::jsonb||jsonb_build_object('hash',case when installed then '46d4e3edf8aba8d474b0e6e19651adc80fb7466a94c785f70e6681dc13a55110' else '07f4ddd1001f786eb0615d0396fd9bd1eca749fa995b82821e549684a9632bdc' end));
 own_spec:=own_spec||jsonb_build_array((case when has190 then $audit_parent190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","newHash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792"}$audit_parent190$::jsonb else $audit_parent185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","newHash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b"}$audit_parent185$::jsonb end)||jsonb_build_object('hash',case when has190 then '3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792' else '876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b' end),
 $audit_parent_capture${"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","newHash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907"}$audit_parent_capture$::jsonb||jsonb_build_object('hash','c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907'));
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
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and (proc.proname like 'faolla_attendance_management_audit_%' or proc.proname='faolla_attendance_delegated_audit_v1'))<>(case when installed then 9 else 0 end)
  or (to_regclass(ns||'.merchant_attendance_management_audit_exports') is not null)<>installed then raise exception 'merchant_attendance_delegated_audit_installation_conflict';end if;
 if not installed then
  if exists(select 1 from pg_class catalog_table where catalog_table.relnamespace=(select oid from pg_namespace where nspname=ns) and catalog_table.relname in('management_audit_grant_time_idx','management_audit_revoke_time_idx')) then raise exception 'merchant_attendance_delegated_audit_index_conflict';end if;
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
  return;
 end if;
 execute 'create index management_audit_grant_time_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,recorded_at desc,grant_id desc);';
 execute 'create index management_audit_revoke_time_idx on pg_temp.merchant_attendance_management_delegation_revocations(merchant_id,recorded_at desc,operation_id desc);';
 own_spec:=$audit_own$[{"name":"faolla_attendance_management_audit_query_v1","signature":"public.faolla_attendance_management_audit_query_v1(jsonb)","hash":"a756d6b2a440b66102285199d8a1797682a7138b95f5be3cf862f627b6cb6192","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["q"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_hash_v1","signature":"public.faolla_attendance_management_audit_hash_v1(text,uuid,jsonb,jsonb)","hash":"f0f06c075c6182ce12bce91db692e3f24ee6968c795cf41ab7b628330be8ba6b","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","q","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_project_v1","signature":"public.faolla_attendance_management_audit_project_v1(text,text,jsonb,jsonb,uuid)","hash":"71499ffb88177b31eebc00d4ae705d94b063ce1e3165b9ba8c042b8feab7c0ee","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","source","raw","scope","owner"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_collect_v1","signature":"public.faolla_attendance_management_audit_collect_v1(jsonb,public.merchant_attendance_management_delegations,timestamptz,uuid)","hash":"8fb0083b770a857f2555006ce5392fc36e51941eecf385f9a1259ee7bc8fdf85","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["q","g","as_of","owner"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_authorize_v1","signature":"public.faolla_attendance_management_audit_authorize_v1(text,uuid,uuid,text,text)","hash":"9ff0c88d9d8152412e931a07f7c3f3a14591efee1ad4c4c9a8eee2592021c20b","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","action","source"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_receipt_v1","signature":"public.faolla_attendance_management_audit_receipt_v1(text,uuid,uuid)","hash":"9f66c9e459dfa737cbd37c698300d39131f6e15193d2aa18e94c93f07ed1918f","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_insert_v1","signature":"public.faolla_attendance_management_audit_insert_v1()","hash":"0470b71375779213bbd66e6ae0aaff172d75327da5c34aed8442b5e78ef2bca9","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_authority_v1","signature":"public.faolla_attendance_management_audit_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"0ee4f488b86d826c4a6fa7c9078bea26352af9a7bf73c1f8566d74a5d8e0065f","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_audit_v1","signature":"public.faolla_attendance_delegated_audit_v1(jsonb,uuid,jsonb,boolean)","hash":"d48ad94187dbb86a51922c3f954beded111f34c3e81836d8570a35e80e3f9776","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_access"],"searchPath":"search_path=pg_catalog","isRpc":true}]$audit_own$::jsonb;
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
end;$audit_preflight$;
create temp table merchant_attendance_management_audit_exports(
 merchant_id text not null,
 operation_id uuid not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 delegate_employee_id uuid not null,
 delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
 worker_id uuid,
 employee_id uuid,
 employee_auth_user_id uuid,
 employee_generation bigint check(employee_generation between 0 and 9007199254740990),
 query jsonb not null,
 command jsonb not null,
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 as_of timestamptz not null check(isfinite(as_of)),
 result_count integer not null check(result_count between 0 and 250),
 result_bytes integer not null check(result_bytes between 1 and 1572864),
 result_fingerprint text not null check(result_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at) and recorded_at>=as_of),
 constraint management_audit_exports_pk primary key(merchant_id,operation_id),
 constraint management_audit_exports_grant_fk foreign key(merchant_id,grant_id) references pg_temp.merchant_attendance_management_delegations(merchant_id,grant_id) on delete restrict,
 constraint management_audit_exports_delegate_fk foreign key(merchant_id,delegate_employee_id) references pg_temp.management_expected_employees(merchant_id,id) on delete restrict,
 constraint management_audit_exports_employee_fk foreign key(merchant_id,employee_id) references pg_temp.management_expected_employees(merchant_id,id) on delete restrict,
 constraint management_audit_exports_binding_ck check((worker_id is null and employee_id is null and employee_auth_user_id is null and employee_generation is null)
  or (worker_id is not null and employee_id is not null and employee_auth_user_id is not null and employee_generation is not null))
) on commit drop;
create index management_audit_exports_actor_idx on pg_temp.merchant_attendance_management_audit_exports(merchant_id,actor_auth_user_id,recorded_at desc,operation_id desc);
create index management_audit_export_time_idx on pg_temp.merchant_attendance_management_audit_exports(merchant_id,recorded_at desc,operation_id desc);
do $audit_reentry_tables$
declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;f regprocedure;meta record;own_spec jsonb;
 actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;
 index_spec record;actual_index record;trigger_spec record;
begin
 select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_audit_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 if installed then
 foreach table_name in array array['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations','merchant_attendance_management_audit_exports'] loop
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
  for trigger_spec in select * from (values(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_immutable' else 'management_immutable' end,27,'faolla_attendance_events_append_only_v1'),(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_no_truncate' else 'management_no_truncate' end,34,'faolla_attendance_events_append_only_v1'),(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_insert_guard' else 'management_insert_guard' end,7,case when table_name='merchant_attendance_management_audit_exports' then 'faolla_attendance_management_audit_insert_v1' else 'faolla_attendance_management_insert_v1' end)) expected(name,kind,fn) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.'||trigger_spec.fn||'()')) then raise exception 'merchant_attendance_management_trigger_conflict';end if;
  end loop;
 end loop;
 end if;
end;$audit_reentry_tables$;
--END GENERATED AUDIT PREFLIGHT

create or replace function public.faolla_attendance_management_audit_query_v1(q jsonb)
returns void language plpgsql immutable set search_path=pg_catalog as $$
declare mode text:=q->>'mode';from_at timestamptz;to_at timestamptz;as_of timestamptz;cursor_at timestamptz;
begin
 if q is null or octet_length(q::text)>4096 or jsonb_typeof(q->'siteId') is distinct from 'string' or q->>'siteId'!~'^[0-9]{8}$' then raise exception 'attendance_invalid_request';end if;
 if mode='recover' then
  if public.faolla_attendance_shift_rule_binding_object_v1(q,array['siteId','mode','operationId']) is distinct from true or not public.faolla_attendance_management_scalar_v1(q->'operationId','uuid') then raise exception 'attendance_invalid_request';end if;return;
 end if;
 if not public.faolla_attendance_management_scalar_v1(q->'grantId','uuid') or q->>'source' is null or q->>'source' not in('config','scope','management') then raise exception 'attendance_invalid_request';end if;
 if mode='detail' then
  if public.faolla_attendance_shift_rule_binding_object_v1(q,array['siteId','grantId','mode','source','sourceOperationId']) is distinct from true or not public.faolla_attendance_management_scalar_v1(q->'sourceOperationId','uuid') then raise exception 'attendance_invalid_request';end if;return;
 elsif mode='export' then
  if public.faolla_attendance_shift_rule_binding_object_v1(q,array['siteId','grantId','mode','source','fromAt','toAt']) is distinct from true then raise exception 'attendance_invalid_request';end if;
 elsif mode='list' then
  if public.faolla_attendance_shift_rule_binding_object_v1(q,array['siteId','grantId','mode','source','fromAt','toAt','asOf','cursorAt','cursorId']) is distinct from true
   or (q->'cursorId'='null'::jsonb) is distinct from (q->'cursorAt'='null'::jsonb)
   or q->'cursorId'<>'null'::jsonb and (not public.faolla_attendance_management_scalar_v1(q->'cursorId','uuid') or q->'asOf'='null'::jsonb)
   or q->'asOf'<>'null'::jsonb and not public.faolla_attendance_management_scalar_v1(q->'asOf','stamp')
   or q->'cursorAt'<>'null'::jsonb and not public.faolla_attendance_management_scalar_v1(q->'cursorAt','stamp') then raise exception 'attendance_invalid_request';end if;
 else raise exception 'attendance_invalid_request';end if;
 if not public.faolla_attendance_management_scalar_v1(q->'fromAt','stamp') or not public.faolla_attendance_management_scalar_v1(q->'toAt','stamp') then raise exception 'attendance_invalid_request';end if;
 from_at:=(q->>'fromAt')::timestamptz;to_at:=(q->>'toAt')::timestamptz;
 if to_at<=from_at or to_at-from_at>interval '31 days' then raise exception 'attendance_invalid_request';end if;
 if mode='list' then
  as_of:=(q->>'asOf')::timestamptz;cursor_at:=(q->>'cursorAt')::timestamptz;
  if cursor_at is not null and (cursor_at<from_at or cursor_at>=least(to_at,as_of)) then raise exception 'attendance_invalid_request';end if;
 end if;
end;
$$;
create or replace function public.faolla_attendance_management_audit_hash_v1(site text,actor uuid,q jsonb,c jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
 perform public.faolla_attendance_management_audit_query_v1(q);
 if actor is null or q->>'siteId' is distinct from site or q->>'mode' is distinct from 'export'
  or public.faolla_attendance_shift_rule_binding_object_v1(c,array['action','operationId']) is distinct from true
  or c->>'action' is distinct from 'export' or not public.faolla_attendance_management_scalar_v1(c->'operationId','uuid') then raise exception 'attendance_invalid_request';end if;
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-audit-command-v1',site,actor,
  q->'grantId',q->'source',q->'fromAt',q->'toAt',c->'action',c->'operationId'));
end;
$$;

create table if not exists public.merchant_attendance_management_audit_exports(
 merchant_id text not null,
 operation_id uuid not null,
 grant_id uuid not null,
 actor_auth_user_id uuid not null,
 delegate_employee_id uuid not null,
 delegate_generation bigint not null check(delegate_generation between 0 and 9007199254740990),
 worker_id uuid,
 employee_id uuid,
 employee_auth_user_id uuid,
 employee_generation bigint check(employee_generation between 0 and 9007199254740990),
 query jsonb not null,
 command jsonb not null,
 command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 as_of timestamptz not null check(isfinite(as_of)),
 result_count integer not null check(result_count between 0 and 250),
 result_bytes integer not null check(result_bytes between 1 and 1572864),
 result_fingerprint text not null check(result_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at) and recorded_at>=as_of),
 constraint management_audit_exports_pk primary key(merchant_id,operation_id),
 constraint management_audit_exports_grant_fk foreign key(merchant_id,grant_id) references public.merchant_attendance_management_delegations(merchant_id,grant_id) on delete restrict,
 constraint management_audit_exports_delegate_fk foreign key(merchant_id,delegate_employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
 constraint management_audit_exports_employee_fk foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
 constraint management_audit_exports_binding_ck check((worker_id is null and employee_id is null and employee_auth_user_id is null and employee_generation is null)
  or (worker_id is not null and employee_id is not null and employee_auth_user_id is not null and employee_generation is not null))
);
create index if not exists management_audit_exports_actor_idx on public.merchant_attendance_management_audit_exports(merchant_id,actor_auth_user_id,recorded_at desc,operation_id desc);
--Only the two new202 private ledger tables need a forward read index. Existing
--064/066/069/080 tables/writers/owner paths remain untouched.
create index if not exists management_audit_grant_time_idx on public.merchant_attendance_management_delegations(merchant_id,recorded_at desc,grant_id desc);
create index if not exists management_audit_revoke_time_idx on public.merchant_attendance_management_delegation_revocations(merchant_id,recorded_at desc,operation_id desc);
create index if not exists management_audit_export_time_idx on public.merchant_attendance_management_audit_exports(merchant_id,recorded_at desc,operation_id desc);

--Projection is resource evidence, NOT a claim about historical target Auth.
--Return null for an out-of-scope/mixed whole receipt; never trim its snapshots.
create or replace function public.faolla_attendance_management_audit_project_v1(site text,source text,raw jsonb,scope jsonb,owner uuid)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare before_value jsonb;after_value jsonb;value jsonb;g jsonb;item jsonb;kind text;target uuid;stamp timestamptz;
 locations jsonb:=scope->'locationIds';holder text;worker_scope boolean:=scope->>'kind'='audit_worker';n integer;
begin
 if source='config' then
  kind:=raw->'command'->>'kind';target:=(raw->'command'->'values'->>'id')::uuid;
  if kind not in('settings','location','worker') or kind is null then raise exception 'attendance_delegated_audit_invalid';end if;
  before_value:=public.faolla_attendance_audit_value_v1(kind,raw->'before_value',true,target);
  after_value:=public.faolla_attendance_audit_value_v1(kind,raw->'after_value',false,target);
  if after_value is null then raise exception 'attendance_delegated_audit_invalid';end if;
  if worker_scope then
   if kind<>'worker' or target::text is distinct from scope->>'workerId' or after_value->>'employeeId' is distinct from scope->>'employeeId'
    or before_value is not null and before_value<>'null'::jsonb and before_value->>'employeeId' is distinct from scope->>'employeeId' then return null;end if;
   if after_value->>'locationId' is null or not(locations ? (after_value->>'locationId'))
    or before_value is not null and before_value<>'null'::jsonb and (before_value->>'locationId' is null or not(locations ? (before_value->>'locationId'))) then return null;end if;
  end if;
 elsif source='scope' then
  if not worker_scope then return null;end if;
  if raw->'command'->>'action' not in('put','remove') or raw->'command'->>'action' is null then raise exception 'attendance_delegated_audit_invalid';end if;
  kind:='grant_'||(raw->'command'->>'action');target:=(raw->'command'->>'grantId')::uuid;
  before_value:=public.faolla_attendance_audit_value_v1(kind,raw->'before_value',true,target);
  after_value:=public.faolla_attendance_audit_value_v1(kind,raw->'after_value',false,target);
  if kind='grant_remove' and before_value is null or kind='grant_put' and after_value is null then raise exception 'attendance_delegated_audit_invalid';end if;
  foreach n in array array[0,1] loop
   value:=case when n=0 then before_value else after_value end;
   if value is null or value='null'::jsonb then continue;end if;
   if value->'workerIds' is distinct from jsonb_build_array(scope->'workerId') then return null;end if;
   if jsonb_typeof(value->'locationIds') is distinct from 'array' or jsonb_array_length(value->'locationIds') not between 1 and 50 then raise exception 'attendance_delegated_audit_invalid';end if;
   if exists(select 1 from jsonb_array_elements_text(value->'locationIds') location(id) where not(locations ? location.id)) then return null;end if;
  end loop;
  holder:=md5('attendance-audit-holder:'||site||':'||(raw->>'employee_id'));
 elsif source='management' then
  kind:=raw->>'kind';g:=raw->'grant';target:=(g->>'grant_id')::uuid;
  if kind not in('management_grant','management_revoke','management_audit_export') or kind is null then raise exception 'attendance_delegated_audit_invalid';end if;
  if worker_scope then
   if row(g->>'worker_id',g->>'employee_id',g->>'employee_auth_user_id') is distinct from row(scope->>'workerId',scope->>'employeeId',scope->>'employeeAuthUserId') then return null;end if;
   if jsonb_typeof(g->'scope'->'locationIds') is distinct from 'array' or jsonb_array_length(g->'scope'->'locationIds')=0
    or exists(select 1 from jsonb_array_elements_text(g->'scope'->'locationIds') location(id) where not(locations ? location.id)) then return null;end if;
  end if;
  value:=jsonb_build_object('grantId',target,'delegateRef',md5('attendance-audit-holder:'||site||':'||(g->>'delegate_employee_id')),
   'delegatedAction',g->'delegated_action','scopeKind',g->'scope'->'kind','workerId',g->'worker_id','employeeId',g->'employee_id',
   'locationIds',coalesce(g->'scope'->'locationIds','[]'::jsonb),'allowedRuleKeys',coalesce(g->'scope'->'allowedRuleKeys','[]'::jsonb),
   'validFrom',to_char((g->>'valid_from')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'validUntil',to_char((g->>'valid_until')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reason',g->'reason');
  if kind='management_grant' then before_value:=null;after_value:=value||jsonb_build_object('status','granted');
  elsif kind='management_revoke' then before_value:=value||jsonb_build_object('status','granted');after_value:=value||jsonb_build_object('status','revoked','revocationReason',raw->'reason');
  else before_value:=null;after_value:=jsonb_build_object('grantId',target,'source',raw->'query'->'source','fromAt',raw->'query'->'fromAt','toAt',raw->'query'->'toAt',
   'asOf',to_char((raw->>'as_of')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'count',raw->'result_count','resultFingerprint',raw->'result_fingerprint');end if;
 else raise exception 'attendance_delegated_audit_invalid';end if;
 stamp:=(raw->>'recorded_at')::timestamptz;
 if not isfinite(stamp) or not public.faolla_attendance_management_scalar_v1(raw->'operation_id','uuid') or not public.faolla_attendance_management_scalar_v1(raw->'actor_auth_user_id','uuid') then raise exception 'attendance_delegated_audit_invalid';end if;
 item:=jsonb_build_object('operationId',raw->'operation_id','recordedAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'kind',kind,'version',case when source='scope' then raw->'revision' when source='config' then raw->'version' when kind='management_revoke' then '2'::jsonb else '1'::jsonb end,
  'targetId',target,'actorRef',md5('attendance-audit:'||site||':'||(raw->>'actor_auth_user_id')),'byCurrentOwner',(raw->>'actor_auth_user_id')::uuid=owner,'holderRef',holder);
 return jsonb_build_object('item',item,'before',before_value,'after',after_value);
end;
$$;

create or replace function public.faolla_attendance_management_audit_collect_v1(q jsonb,g public.merchant_attendance_management_delegations,as_of timestamptz,owner uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare source text:=q->>'source';mode text:=q->>'mode';site text:=q->>'siteId';raw record;projected jsonb;rows jsonb:='[]';items jsonb:='[]';
 from_at timestamptz:=(q->>'fromAt')::timestamptz;to_at timestamptz:=(q->>'toAt')::timestamptz;cursor_at timestamptz:=(q->>'cursorAt')::timestamptz;
 cursor_id uuid:=(q->>'cursorId')::uuid;source_op uuid:=(q->>'sourceOperationId')::uuid;scanned integer:=0;maximum integer:=case when mode='export' then 250 else 25 end;next_cursor jsonb:='null';result jsonb;
begin
 if as_of is null or not isfinite(as_of) or as_of>clock_timestamp() then raise exception 'attendance_invalid_request';end if;
 --The existing tenant/time indexes bound company reads. Worker filtering uses
 --at most1001 raw receipts; no unbounded JSON scan or partial/false empty page.
 for raw in select unified.* from (
  (select actual.recorded_at,actual.operation_id,to_jsonb(actual) data from public.merchant_attendance_config_operations actual where source='config' and actual.merchant_id=site
   and ((mode='detail' and actual.operation_id=source_op) or (mode<>'detail' and actual.recorded_at>=from_at and actual.recorded_at<least(to_at,faolla_attendance_management_audit_collect_v1.as_of)
    and (cursor_id is null or (actual.recorded_at,actual.operation_id)<(cursor_at,cursor_id)))) order by actual.recorded_at desc,actual.operation_id desc limit 1001)
  union all (select actual.recorded_at,actual.operation_id,to_jsonb(actual) from public.merchant_attendance_scope_operations actual where source='scope' and actual.merchant_id=site
   and ((mode='detail' and actual.operation_id=source_op) or (mode<>'detail' and actual.recorded_at>=from_at and actual.recorded_at<least(to_at,faolla_attendance_management_audit_collect_v1.as_of)
    and (cursor_id is null or (actual.recorded_at,actual.operation_id)<(cursor_at,cursor_id)))) order by actual.recorded_at desc,actual.operation_id desc limit 1001)
  union all (select actual.recorded_at,actual.grant_id,jsonb_build_object('kind','management_grant','operation_id',actual.grant_id,'recorded_at',actual.recorded_at,'actor_auth_user_id',actual.actor_auth_user_id,'grant',to_jsonb(actual))
   from public.merchant_attendance_management_delegations actual where source='management' and actual.merchant_id=site
   and ((mode='detail' and actual.grant_id=source_op) or (mode<>'detail' and actual.recorded_at>=from_at and actual.recorded_at<least(to_at,faolla_attendance_management_audit_collect_v1.as_of)
    and (cursor_id is null or (actual.recorded_at,actual.grant_id)<(cursor_at,cursor_id)))) order by actual.recorded_at desc,actual.grant_id desc limit 1001)
  union all (select actual.recorded_at,actual.operation_id,to_jsonb(actual)||jsonb_build_object('kind','management_revoke','grant',to_jsonb(original))
   from public.merchant_attendance_management_delegation_revocations actual join public.merchant_attendance_management_delegations original on original.merchant_id=actual.merchant_id and original.grant_id=actual.grant_id where source='management' and actual.merchant_id=site
   and ((mode='detail' and actual.operation_id=source_op) or (mode<>'detail' and actual.recorded_at>=from_at and actual.recorded_at<least(to_at,faolla_attendance_management_audit_collect_v1.as_of)
    and (cursor_id is null or (actual.recorded_at,actual.operation_id)<(cursor_at,cursor_id)))) order by actual.recorded_at desc,actual.operation_id desc limit 1001)
  union all (select actual.recorded_at,actual.operation_id,to_jsonb(actual)||jsonb_build_object('kind','management_audit_export','grant',to_jsonb(original))
   from public.merchant_attendance_management_audit_exports actual join public.merchant_attendance_management_delegations original on original.merchant_id=actual.merchant_id and original.grant_id=actual.grant_id
   where source='management' and actual.merchant_id=site
   and ((mode='detail' and actual.operation_id=source_op) or (mode<>'detail' and actual.recorded_at>=from_at and actual.recorded_at<least(to_at,faolla_attendance_management_audit_collect_v1.as_of)
    and (cursor_id is null or (actual.recorded_at,actual.operation_id)<(cursor_at,cursor_id)))) order by actual.recorded_at desc,actual.operation_id desc limit 1001)
 ) unified order by unified.recorded_at desc,unified.operation_id desc limit 1001 loop
  scanned:=scanned+1;if scanned>1000 then raise exception 'attendance_delegated_audit_too_large';end if;
  --A missing/mismatched authority proof must not make a real export disappear.
  if source='management' and raw.data->>'kind'='management_audit_export' then
   perform public.faolla_attendance_management_audit_receipt_v1(site,raw.operation_id,(raw.data->>'actor_auth_user_id')::uuid);
  end if;
  projected:=public.faolla_attendance_management_audit_project_v1(site,source,raw.data,g.scope,owner);if projected is null then continue;end if;
  if mode='detail' then
   if result is not null then raise exception 'attendance_delegated_audit_invalid';end if;
   result:=jsonb_build_object('row',projected);continue;
  end if;
  if jsonb_array_length(rows)>=maximum then
   if mode='export' then raise exception 'attendance_export_too_large';end if;
   next_cursor:=jsonb_build_object('recordedAt',rows->24->'item'->'recordedAt','operationId',rows->24->'item'->'operationId');exit;
  end if;
  rows:=rows||jsonb_build_array(projected);items:=items||jsonb_build_array(projected->'item');
 end loop;
 if mode='detail' then
  if result is null then raise exception 'attendance_audit_not_found';end if;
  if octet_length(convert_to(result::text,'UTF8'))>1572864 then raise exception 'attendance_export_too_large';end if;
  return result;
 end if;
 if mode='list' then result:=jsonb_build_object('asOf',to_char(as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',items,'nextCursor',next_cursor);
 else result:=jsonb_build_object('schemaVersion',1,'fromAt',q->'fromAt','toAt',q->'toAt','asOf',to_char(as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'count',jsonb_array_length(rows),'rows',rows);end if;
 if octet_length(convert_to(result::text,'UTF8'))>1572864 then raise exception 'attendance_export_too_large';end if;
 return result;
end;
$$;
create or replace function public.faolla_attendance_management_audit_authorize_v1(site text,actor uuid,id uuid,action text,source text)
returns public.merchant_attendance_management_delegations language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;employee public.merchant_enterprise_employees%rowtype;
begin
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id for share;
 if g.grant_id is null or g.delegate_auth_user_id is distinct from actor or g.delegated_action is distinct from action or g.scope->>'kind' not in('audit_worker','audit_company')
  or not(g.scope->'sources' ? source) then raise exception 'attendance_access_denied';end if;
 select * into employee from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.delegate_employee_id for share;
 perform 1 from public.merchant_enterprise_roles actual where actual.merchant_id=site and actual.id=employee.role_id for share;
 if public.faolla_attendance_management_current_v1(g,clock_timestamp()) is distinct from true then raise exception 'attendance_access_denied';end if;
 return g;
end;
$$;
create or replace function public.faolla_attendance_management_audit_receipt_v1(site text,op uuid,actor uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare saved public.merchant_attendance_management_audit_exports%rowtype;original public.merchant_attendance_management_delegations%rowtype;
begin
 select * into saved from public.merchant_attendance_management_audit_exports actual where actual.merchant_id=site and actual.operation_id=op and actual.actor_auth_user_id=actor;
 if saved.operation_id is null then return null;end if;
 --Immutable original grant binding, not current membership or current epoch.
 select * into original from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=saved.grant_id;
 if original.grant_id is null or original.delegate_auth_user_id is distinct from actor or original.delegated_action is distinct from 'audit_export'
  or not(original.scope->'sources' ? (saved.query->>'source')) or saved.query->>'grantId' is distinct from original.grant_id::text
  or row(saved.delegate_employee_id,saved.delegate_generation,saved.worker_id,saved.employee_id,saved.employee_auth_user_id,saved.employee_generation)
   is distinct from row(original.delegate_employee_id,original.delegate_generation,original.worker_id,original.employee_id,original.employee_auth_user_id,original.employee_generation)
  or saved.command->>'operationId' is distinct from op::text
  or saved.command_fingerprint is distinct from public.faolla_attendance_management_audit_hash_v1(site,actor,saved.query,saved.command)
  or not exists(select 1 from public.merchant_attendance_management_delegation_operations proof where proof.merchant_id=site and proof.operation_id=op and proof.actor_auth_user_id=actor
   and proof.grant_id=saved.grant_id and proof.delegate_employee_id=saved.delegate_employee_id and proof.delegate_generation=saved.delegate_generation
   and proof.delegated_action='audit_export' and proof.business_operation_id=op and proof.business_reference_id=op and proof.business_revision=1
   and proof.business_fingerprint=saved.result_fingerprint and proof.command_fingerprint=saved.command_fingerprint and proof.recorded_at=saved.recorded_at) then raise exception 'attendance_delegated_audit_invalid';end if;
 return jsonb_build_object('operationId',op,'actorId',actor,'grantId',saved.grant_id,'action','export','commandFingerprint',saved.command_fingerprint,
  'asOf',to_char(saved.as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'count',saved.result_count,'resultFingerprint',saved.result_fingerprint,
  'recordedAt',to_char(saved.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
create or replace function public.faolla_attendance_management_audit_insert_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;payload jsonb;canonical jsonb;owner uuid;stamp timestamptz;
begin
 if tg_table_name<>'merchant_attendance_management_audit_exports' then raise exception 'attendance_delegated_audit_invalid';end if;
 if new.operation_id::text is distinct from new.command->>'operationId' or new.grant_id::text is distinct from new.query->>'grantId'
  or new.query->>'siteId' is distinct from new.merchant_id or new.command_fingerprint is distinct from public.faolla_attendance_management_audit_hash_v1(new.merchant_id,new.actor_auth_user_id,new.query,new.command) then raise exception 'attendance_delegated_audit_invalid';end if;
 g:=public.faolla_attendance_management_audit_authorize_v1(new.merchant_id,new.actor_auth_user_id,new.grant_id,'audit_export',new.query->>'source');
 if row(new.delegate_employee_id,new.delegate_generation,new.worker_id,new.employee_id,new.employee_auth_user_id,new.employee_generation)
  is distinct from row(g.delegate_employee_id,g.delegate_generation,g.worker_id,g.employee_id,g.employee_auth_user_id,g.employee_generation) then raise exception 'attendance_delegated_audit_invalid';end if;
 if exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=new.merchant_id and actual.grant_id=new.operation_id)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.operation_id)
  or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=new.merchant_id and actual.operation_id=new.operation_id) then raise exception 'attendance_operation_conflict';end if;
 select actual.user_id into owner from public.merchants actual where actual.id=new.merchant_id;
 payload:=public.faolla_attendance_management_audit_collect_v1(new.query,g,new.as_of,owner);
 canonical:=jsonb_build_array('attendance-delegated-audit-snapshot-v1',new.merchant_id,new.actor_auth_user_id,new.grant_id,new.query,payload);
 stamp:=clock_timestamp();
 if new.result_count is distinct from (payload->>'count')::integer or new.result_bytes<>octet_length(convert_to(payload::text,'UTF8'))
  or new.result_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(canonical) or not isfinite(new.recorded_at) or new.recorded_at<new.as_of or new.recorded_at>stamp
  or public.faolla_attendance_management_current_v1(g,stamp) is distinct from true then raise exception 'attendance_delegated_audit_invalid';end if;
 return new;
end;
$$;
create or replace function public.faolla_attendance_management_audit_authority_v1(p public.merchant_attendance_management_delegation_operations)
returns void language plpgsql set search_path=pg_catalog as $$
declare saved public.merchant_attendance_management_audit_exports%rowtype;g public.merchant_attendance_management_delegations%rowtype;
begin
 select * into saved from public.merchant_attendance_management_audit_exports actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id;
 if saved.operation_id is null or row(p.grant_id,p.actor_auth_user_id,p.delegate_employee_id,p.delegate_generation,p.delegated_action,p.business_operation_id,p.business_reference_id,p.business_revision,p.business_fingerprint,p.command_fingerprint,p.recorded_at)
  is distinct from row(saved.grant_id,saved.actor_auth_user_id,saved.delegate_employee_id,saved.delegate_generation,'audit_export'::text,saved.operation_id,saved.operation_id,1::bigint,saved.result_fingerprint,saved.command_fingerprint,saved.recorded_at)
  or saved.command_fingerprint is distinct from public.faolla_attendance_management_audit_hash_v1(saved.merchant_id,saved.actor_auth_user_id,saved.query,saved.command) then raise exception 'attendance_delegated_audit_invalid';end if;
 g:=public.faolla_attendance_management_audit_authorize_v1(saved.merchant_id,saved.actor_auth_user_id,saved.grant_id,'audit_export',saved.query->>'source');
 if row(saved.delegate_employee_id,saved.delegate_generation,saved.worker_id,saved.employee_id,saved.employee_auth_user_id,saved.employee_generation)
  is distinct from row(g.delegate_employee_id,g.delegate_generation,g.worker_id,g.employee_id,g.employee_auth_user_id,g.employee_generation) then raise exception 'attendance_delegated_audit_invalid';end if;
end;
$$;
create or replace function public.faolla_attendance_delegated_audit_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_access boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text:=p_query->>'siteId';mode text:=p_query->>'mode';op uuid;fingerprint text;g public.merchant_attendance_management_delegations%rowtype;
 saved public.merchant_attendance_management_audit_exports%rowtype;payload jsonb;canonical jsonb;receipt jsonb;common jsonb;owner uuid;as_of timestamptz;stamp timestamptz;
 private_wire jsonb;
begin
 perform public.faolla_attendance_management_audit_query_v1(p_query);
 if p_auth_user_id is null or p_allow_access is null then raise exception 'attendance_invalid_request';end if;
 if mode='recover' then
  if p_command is not null then raise exception 'attendance_invalid_request';end if;
  receipt:=public.faolla_attendance_management_audit_receipt_v1(site,(p_query->>'operationId')::uuid,p_auth_user_id);
  return jsonb_build_object('protocol','attendance-delegated-audit-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 if mode='export' then
  fingerprint:=public.faolla_attendance_management_audit_hash_v1(site,p_auth_user_id,p_query,p_command);op:=(p_command->>'operationId')::uuid;
  select * into saved from public.merchant_attendance_management_audit_exports actual where actual.merchant_id=site and actual.operation_id=op;
  if saved.operation_id is not null then
   if saved.actor_auth_user_id is distinct from p_auth_user_id or saved.query is distinct from p_query or saved.command is distinct from p_command or saved.command_fingerprint is distinct from fingerprint then raise exception 'attendance_operation_conflict';end if;
   receipt:=public.faolla_attendance_management_audit_receipt_v1(site,op,p_auth_user_id);
   return jsonb_build_object('protocol','attendance-delegated-audit-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
  end if;
 elsif p_command is not null then raise exception 'attendance_invalid_request';end if;
 --The common serialization wait itself grants no current read authority.
 --A concurrent original export can finish while this request waits; inspect
 --that ID before current delegation/pause/role/rollout checks.
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 --After the settings wait, inspect an original ID before fresh rollout/source.
 if op is not null then
  select * into saved from public.merchant_attendance_management_audit_exports actual where actual.merchant_id=site and actual.operation_id=op;
  if saved.operation_id is not null then
   if saved.actor_auth_user_id is distinct from p_auth_user_id or saved.query is distinct from p_query or saved.command is distinct from p_command or saved.command_fingerprint is distinct from fingerprint then raise exception 'attendance_operation_conflict';end if;
   receipt:=public.faolla_attendance_management_audit_receipt_v1(site,op,p_auth_user_id);
   return jsonb_build_object('protocol','attendance-delegated-audit-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
  end if;
 end if;
 g:=public.faolla_attendance_management_audit_authorize_v1(site,p_auth_user_id,(p_query->>'grantId')::uuid,case when mode='export' then 'audit_export' else 'audit_view' end,p_query->>'source');
 if p_allow_access is distinct from true then raise exception 'attendance_delegated_audit_disabled';end if;
 select actual.user_id into owner from public.merchants actual where actual.id=site;
 as_of:=case when mode='list' and p_query->'asOf'<>'null'::jsonb then (p_query->>'asOf')::timestamptz else clock_timestamp() end;
 payload:=public.faolla_attendance_management_audit_collect_v1(p_query,g,as_of,owner);stamp:=clock_timestamp();
 if public.faolla_attendance_management_current_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;
 common:=jsonb_build_object('protocol','attendance-delegated-audit-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'grantId',g.grant_id,'source',p_query->'source','scopeKind',g.scope->'kind','target',case when g.scope->>'kind'='audit_worker' then jsonb_build_object('workerId',g.worker_id,'employeeId',g.employee_id,'employeeAuthUserId',g.employee_auth_user_id,'generation',g.employee_generation) else null end);
 if mode<>'export' then return common||jsonb_build_object('kind',mode)||payload;end if;
 canonical:=jsonb_build_array('attendance-delegated-audit-snapshot-v1',site,p_auth_user_id,g.grant_id,p_query,payload);
 insert into public.merchant_attendance_management_audit_exports(merchant_id,operation_id,grant_id,actor_auth_user_id,delegate_employee_id,delegate_generation,worker_id,employee_id,employee_auth_user_id,employee_generation,
  query,command,command_fingerprint,as_of,result_count,result_bytes,result_fingerprint,recorded_at)
 values(site,op,g.grant_id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.worker_id,g.employee_id,g.employee_auth_user_id,g.employee_generation,
  p_query,p_command,fingerprint,as_of,(payload->>'count')::integer,octet_length(convert_to(payload::text,'UTF8')),public.faolla_attendance_operational_rule_hash_v1(canonical),stamp) returning * into saved;
 insert into public.merchant_attendance_management_delegation_operations(merchant_id,operation_id,grant_id,actor_auth_user_id,delegate_employee_id,delegate_generation,delegated_action,business_operation_id,business_reference_id,business_revision,business_fingerprint,command_fingerprint,recorded_at)
 values(site,op,g.grant_id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,'audit_export',op,op,1,saved.result_fingerprint,saved.command_fingerprint,saved.recorded_at);
 receipt:=public.faolla_attendance_management_audit_receipt_v1(site,op,p_auth_user_id);
 --Private Node wire carries only one canonicalText, not three payload copies.
 --The escaping required by outer JSON can exceed2MiB even for a legal1.5MiB
 --payload. Reject atomically, without raising limits or truncating snapshots.
 private_wire:=common||jsonb_build_object('kind','export','receipt',receipt,'snapshotText',canonical::text,
  'snapshotBytes',octet_length(convert_to(canonical::text,'UTF8')),'snapshotFingerprint',saved.result_fingerprint);
 if octet_length(convert_to(private_wire::text,'UTF8'))>2097152 then raise exception 'attendance_export_too_large';end if;
 return private_wire;
end;
$$;
alter table public.merchant_attendance_management_audit_exports enable row level security;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_management_audit_exports'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

revoke all on public.merchant_attendance_management_audit_exports from public,anon,authenticated,service_role;
do $audit_security$
begin
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_management_audit_exports'::regclass and tgname='management_audit_immutable'::name) then create trigger management_audit_immutable before update or delete on public.merchant_attendance_management_audit_exports for each row execute function public.faolla_attendance_events_append_only_v1();end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_management_audit_exports'::regclass and tgname='management_audit_no_truncate'::name) then create trigger management_audit_no_truncate before truncate on public.merchant_attendance_management_audit_exports for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_management_audit_exports'::regclass and tgname='management_audit_insert_guard'::name) then create trigger management_audit_insert_guard before insert on public.merchant_attendance_management_audit_exports for each row execute function public.faolla_attendance_management_audit_insert_v1();end if;
end;$audit_security$;
revoke all on function public.faolla_attendance_management_audit_query_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_audit_hash_v1(text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_audit_project_v1(text,text,jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_audit_collect_v1(jsonb,public.merchant_attendance_management_delegations,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_audit_authorize_v1(text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_audit_receipt_v1(text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_audit_insert_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_management_audit_authority_v1(public.merchant_attendance_management_delegation_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_audit_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.faolla_attendance_delegated_audit_v1(jsonb,uuid,jsonb,boolean) to service_role;
--BEGIN GENERATED AUDIT FORWARD
do $audit_one_forward$
declare old_body text;definition text;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_management_insert_v1()'::regprocedure;
 if old_body is distinct from $audit_old_guard$
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
$audit_old_guard$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_audit_forward_drift';end if;
 definition:=replace(definition,old_body,$audit_new_guard$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then
  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;
  raise exception 'attendance_management_executor_unavailable';
 end if;
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
$audit_new_guard$);execute definition;
end;$audit_one_forward$;
--END GENERATED AUDIT FORWARD
--BEGIN GENERATED AUDIT POSTCONDITIONS
do $audit_expected_forward_indexes$
begin
 execute 'create index if not exists management_audit_grant_time_idx on pg_temp.merchant_attendance_management_delegations(merchant_id,recorded_at desc,grant_id desc);';
 execute 'create index if not exists management_audit_revoke_time_idx on pg_temp.merchant_attendance_management_delegation_revocations(merchant_id,recorded_at desc,operation_id desc);';
end;$audit_expected_forward_indexes$;
do $audit_postconditions$
declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;f regprocedure;meta record;own_spec jsonb;
 actual_table regclass;expected_table regclass;foreign_table regclass;table_name text;constraint_spec record;actual_constraint record;
 index_spec record;actual_index record;trigger_spec record;
begin
 select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_audit_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 own_spec:=$audit_dependencies$[{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_audit_value_v1","signature":"public.faolla_attendance_audit_value_v1(text,jsonb,boolean,uuid)","hash":"5031c8fe15669fe16cb1eb300ac1ccc45a74d04f258576e0002b619d9b25bdb3","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_kind","p_value","p_before","p_target"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_shift_rule_binding_object_v1","signature":"public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])","hash":"2a634d258ceab747cb0098c516aa423babe8d7f0203ce9fb24725bc9602ded50","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","keys"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}]$audit_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array($audit_guard_meta${"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"07f4ddd1001f786eb0615d0396fd9bd1eca749fa995b82821e549684a9632bdc","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false}$audit_guard_meta$::jsonb||jsonb_build_object('hash','46d4e3edf8aba8d474b0e6e19651adc80fb7466a94c785f70e6681dc13a55110'));
 own_spec:=own_spec||jsonb_build_array((case when has190 then $audit_parent190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","newHash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792"}$audit_parent190$::jsonb else $audit_parent185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","newHash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b"}$audit_parent185$::jsonb end)||jsonb_build_object('hash',case when has190 then '3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792' else '876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b' end),
 $audit_parent_capture${"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","newHash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907"}$audit_parent_capture$::jsonb||jsonb_build_object('hash','c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907'));
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
 own_spec:=$audit_own$[{"name":"faolla_attendance_management_audit_query_v1","signature":"public.faolla_attendance_management_audit_query_v1(jsonb)","hash":"a756d6b2a440b66102285199d8a1797682a7138b95f5be3cf862f627b6cb6192","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["q"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_hash_v1","signature":"public.faolla_attendance_management_audit_hash_v1(text,uuid,jsonb,jsonb)","hash":"f0f06c075c6182ce12bce91db692e3f24ee6968c795cf41ab7b628330be8ba6b","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","q","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_project_v1","signature":"public.faolla_attendance_management_audit_project_v1(text,text,jsonb,jsonb,uuid)","hash":"71499ffb88177b31eebc00d4ae705d94b063ce1e3165b9ba8c042b8feab7c0ee","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","source","raw","scope","owner"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_collect_v1","signature":"public.faolla_attendance_management_audit_collect_v1(jsonb,public.merchant_attendance_management_delegations,timestamptz,uuid)","hash":"8fb0083b770a857f2555006ce5392fc36e51941eecf385f9a1259ee7bc8fdf85","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["q","g","as_of","owner"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_authorize_v1","signature":"public.faolla_attendance_management_audit_authorize_v1(text,uuid,uuid,text,text)","hash":"9ff0c88d9d8152412e931a07f7c3f3a14591efee1ad4c4c9a8eee2592021c20b","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","action","source"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_receipt_v1","signature":"public.faolla_attendance_management_audit_receipt_v1(text,uuid,uuid)","hash":"9f66c9e459dfa737cbd37c698300d39131f6e15193d2aa18e94c93f07ed1918f","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_insert_v1","signature":"public.faolla_attendance_management_audit_insert_v1()","hash":"0470b71375779213bbd66e6ae0aaff172d75327da5c34aed8442b5e78ef2bca9","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_audit_authority_v1","signature":"public.faolla_attendance_management_audit_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"0ee4f488b86d826c4a6fa7c9078bea26352af9a7bf73c1f8566d74a5d8e0065f","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_audit_v1","signature":"public.faolla_attendance_delegated_audit_v1(jsonb,uuid,jsonb,boolean)","hash":"d48ad94187dbb86a51922c3f954beded111f34c3e81836d8570a35e80e3f9776","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_access"],"searchPath":"search_path=pg_catalog","isRpc":true}]$audit_own$::jsonb;
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
 foreach table_name in array array['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations','merchant_attendance_management_audit_exports'] loop
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
  for trigger_spec in select * from (values(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_immutable' else 'management_immutable' end,27,'faolla_attendance_events_append_only_v1'),(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_no_truncate' else 'management_no_truncate' end,34,'faolla_attendance_events_append_only_v1'),(case when table_name='merchant_attendance_management_audit_exports' then 'management_audit_insert_guard' else 'management_insert_guard' end,7,case when table_name='merchant_attendance_management_audit_exports' then 'faolla_attendance_management_audit_insert_v1' else 'faolla_attendance_management_insert_v1' end)) expected(name,kind,fn) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.'||trigger_spec.fn||'()')) then raise exception 'merchant_attendance_management_trigger_conflict';end if;
  end loop;
 end loop;
 if (select count(*) from audit_forward_metadata)<>1 or exists(select 1 from audit_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or (to_jsonb(proc)-'prosrc') is distinct from original.metadata) then raise exception 'merchant_attendance_delegated_audit_forward_metadata_changed';end if;
end;$audit_postconditions$;
drop table pg_temp.audit_forward_metadata,pg_temp.merchant_attendance_management_audit_exports,pg_temp.merchant_attendance_management_delegation_operations,pg_temp.merchant_attendance_management_delegation_revocations,pg_temp.merchant_attendance_management_delegations,pg_temp.management_expected_employees,pg_temp.management_expected_settings;
--END GENERATED AUDIT POSTCONDITIONS
insert into public.faolla_schema_migrations(version,name) values(202610080203,'merchant_attendance_delegated_audit') on conflict(version) do nothing;
notify pgrst,'reload schema';
commit;
