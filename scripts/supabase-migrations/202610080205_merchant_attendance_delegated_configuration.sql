--205 candidate SOURCE: scoped worker_save/location_save, no new business tables.
--The legacy owner wrapper keeps its OID/defaults/ACL and exact166 body via a
--NULL-context private core. No role expansion, impersonation or broad listing.
begin;
set local lock_timeout='3s';
--BEGIN GENERATED DELEGATED CONFIGURATION PREFLIGHT
do $config205_prerequisites$ begin
 if to_regclass('public.faolla_schema_migrations') is null or not exists(select 1 from public.faolla_schema_migrations where version=202610060166 and name='merchant_attendance_employment_lifecycle') or not exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name='merchant_attendance_delegated_groups') then raise exception 'merchant_attendance_delegated_configuration_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name<>'merchant_attendance_delegated_configuration') then raise exception 'merchant_attendance_delegated_configuration_installation_conflict';end if;
 end;$config205_prerequisites$;
 create temp table groups_expected_settings(merchant_id text primary key) on commit drop;
create temp table merchant_attendance_config_operations (
  merchant_id text not null references pg_temp.groups_expected_settings(merchant_id) on delete restrict,
  operation_id uuid not null,
  actor_auth_user_id uuid not null,
  version bigint not null check (version between 1 and 9007199254740990),
  command jsonb not null check (jsonb_typeof(command)='object'),
  before_value jsonb null,
  after_value jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (merchant_id,operation_id),
  unique (merchant_id,version)
) on commit drop;
create index merchant_attendance_config_audit_time_idx on pg_temp.merchant_attendance_config_operations(merchant_id,recorded_at desc,operation_id desc);
 create temp table config205_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in('public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid)'::regprocedure,'public.faolla_attendance_management_insert_v1()'::regprocedure);
 do $config205_preflight$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;own_spec jsonb;f regprocedure;meta record;table_name text;actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_configuration_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name='merchant_attendance_delegated_configuration');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');own_spec:=$config205_dependencies$[{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_command_v1","signature":"public.faolla_attendance_group_command_v1(jsonb)","hash":"579d7fa2487e8220179294ba36500b39e1a7e828024e8377ad69578da13d61c5","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_item_v1","signature":"public.faolla_attendance_group_item_v1(public.merchant_attendance_groups)","hash":"19231ed0c7b2ecf95e91a27dc92caaefcf6aa3b81b908b54b216574c882c6acf","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_receipt_v1","signature":"public.faolla_attendance_group_receipt_v1(public.merchant_attendance_group_operations,public.merchant_attendance_groups)","hash":"0e0897b6905d35b557c49667d1b039f7601e939bceef00d521206d760239ce4a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_checked_v1","signature":"public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)","hash":"045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_item_v1","signature":"public.faolla_attendance_group_assignment_item_v1(public.merchant_attendance_group_assignments)","hash":"475397dc4b3caf6ce0aab4058456d877e456b3744c3703f810cb80750fe67d82","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_detail_v1","signature":"public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)","hash":"aa65e21fdec5f8854145dfa71ee3d3e3e4eff34bca59a4cda18bf52fb6af0a82","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_query_v1","signature":"public.faolla_attendance_delegated_groups_query_v1(jsonb)","hash":"1582cd1b3e7376554ae99a331af78ef3c8bcef52bcb405d6b4d51be53e5d6385","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_action_v1","signature":"public.faolla_attendance_delegated_groups_action_v1(text)","hash":"121538a7299a56317c69726c183f58a06bf51532fca31662059a6841f6cf7348","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_hash_v1","signature":"public.faolla_attendance_delegated_groups_hash_v1(text,uuid,uuid,jsonb)","hash":"fc054e6e2080ac05dc99924f99e3a1d5bc6db2bf8ff5940471f23e20c4abf6aa","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","grant_id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_authorize_v1","signature":"public.faolla_attendance_delegated_groups_authorize_v1(text,uuid,uuid,text,boolean)","hash":"acdd8535915b321321a35e8bf0abd3590438aa082c9d57871424920896a68e12","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","legacy_action","p_created"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_operation_v1","signature":"public.faolla_attendance_delegated_groups_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"43e97bf502d38b369f27b66e25430fd81e50418763015869c03b9624a6ca61ef","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_receipt_v1","signature":"public.faolla_attendance_delegated_groups_receipt_v1(text,uuid,uuid,uuid)","hash":"4216281e292dda0e00f4e423b98dddc29bfdf567457bbed4656bd4b95716e75b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_authority_v1","signature":"public.faolla_attendance_delegated_groups_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"0d95d4f690fcf51faafd599670698eb34773ceed2826220a69247a4d036a00cf","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_groups_core_v2","signature":"public.faolla_attendance_groups_core_v2(jsonb,uuid,jsonb,boolean,uuid)","hash":"ca8c54338e01af8d00881718a0a9de6b7683816ed5f3a79f79363e062f3a23c7","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_v1","signature":"public.faolla_attendance_delegated_groups_v1(jsonb,uuid,jsonb,boolean)","hash":"8271da64d75e0657325cfe94222b8ec1b8cd847390a6d793f3af331b461de18d","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_valid_zone_v1","signature":"public.faolla_attendance_valid_zone_v1(text)","hash":"3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_config_v1","signature":"public.faolla_attendance_employment_config_v1(text,uuid,uuid,date,boolean)","hash":"3d2e7597a1a7d74c4e56f56cf55c7e7a6c913ddcacf83916cef882a2dba7a037","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_start","p_active"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_chain_v1","signature":"public.faolla_attendance_employment_chain_v1(text,uuid,uuid,uuid)","hash":"80b0c474e1f8b846d448e9bd9eb08cf56d173e7d6ced24e716ea6470645cfbcb","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_receipt_v1","signature":"public.faolla_attendance_employment_receipt_v1(public.merchant_attendance_employment_operations)","hash":"4f6610d6ca4c869421468ee1cee1e502a20d7d460c404a5c1e1c8a75ff6604ab","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_hash_v1","signature":"public.faolla_attendance_employment_hash_v1(text,jsonb)","hash":"325b0715c6f05448210646af92f85b8b5f64b621dbbf8b86b50aa4d124180128","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_command_v1","signature":"public.faolla_attendance_employment_command_v1(jsonb)","hash":"87c4ee444481c0ad4e5e9a492532e79263766c415aacbdb5627c64d7dc127a7c","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_account_activation_guard_v1","signature":"public.faolla_attendance_account_activation_guard_v1()","hash":"2a4f30a259800b7f0e9fda5104f3f16c94629939c28e486962fced41fea4851a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_groups_v1","signature":"public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)","hash":"f228cd6ff752b0cd1a76fb57677f2b3fa0b4e0c4c923808e67c7627f17dcf363","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}]$config205_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $config205_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false}$config205_catalog190$::jsonb else $config205_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false}$config205_catalog185$::jsonb end),$config205_capture${"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false}$config205_capture$::jsonb);
 own_spec:=own_spec||jsonb_build_array($config205_admin${"name":"faolla_attendance_admin_v1","signature":"public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid)","hash":"67aa7c785dec53199a500517e05c0f58646e24f7bd5be0041a23679e32d19949","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, NULL::uuid","args":["p_site_id","p_auth_user_id","p_query","p_command","p_operation_id"],"searchPath":"search_path=pg_catalog","isRpc":true}$config205_admin$::jsonb||jsonb_build_object('hash',case when installed then 'ee820da6387fb80163b3bc42ced96a4782782196a70a92ac51a8ddcbe31673ad' else '67aa7c785dec53199a500517e05c0f58646e24f7bd5be0041a23679e32d19949' end),$config205_guard${"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"5d2636f3b1eacfaf0dcb6f249e234bd641e50657df5a71e0cc9fbd7600427183","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;"}$config205_guard$::jsonb||jsonb_build_object('hash',case when installed then '0be4836fd81477e2aabd411f282f16909f3345e06cca96795e390a4b8d1115d7' else '5d2636f3b1eacfaf0dcb6f249e234bd641e50657df5a71e0cc9fbd7600427183' end));
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
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and (proc.proname like 'faolla_attendance_delegated_config_%' or proc.proname='faolla_attendance_admin_core_v2'))<>(case when installed then 10 else 0 end) then raise exception 'merchant_attendance_delegated_configuration_installation_conflict';end if;
 if installed then own_spec:=$config205_own$[{"name":"faolla_attendance_delegated_config_query_v1","signature":"public.faolla_attendance_delegated_config_query_v1(jsonb)","hash":"fb4d148327e71668675bf5261e5c6a71e3b9a8e4e533c967d714c352a36d6ecc","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_command_v1","signature":"public.faolla_attendance_delegated_config_command_v1(jsonb)","hash":"d36d3ddebe3c90571aa21bc88cfd647a460d1fd3ebd349f7479ba4a249a91f31","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_hash_v1","signature":"public.faolla_attendance_delegated_config_hash_v1(text,uuid,uuid,jsonb)","hash":"d0c9240a02809c5ce208124ab0a766eef4c66e10eb23748df677a96a9213aa87","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","grant_id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_business_v1","signature":"public.faolla_attendance_delegated_config_business_v1(public.merchant_attendance_config_operations)","hash":"0539ecd5af7be0fe0ed27f9cc9a8a7083699ed8d512779ec5cd012cd09ddd99c","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_authorize_v1","signature":"public.faolla_attendance_delegated_config_authorize_v1(text,uuid,uuid,text,boolean)","hash":"fd0f48ce3106e129e4a8b9b6aeda2bdaf52f7dec915ac0eb61d36f5d5498963b","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","kind","p_created"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_operation_v1","signature":"public.faolla_attendance_delegated_config_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"71f291e2dde3a4519d763d62fe0724eafd914ba0c8ab9ba9aebc1274aeaa379e","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_receipt_v1","signature":"public.faolla_attendance_delegated_config_receipt_v1(text,uuid,uuid,uuid)","hash":"bfa0394c9286a8a92ca363841b43285641efd16907bf63cd6575879b3c0165dc","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_authority_v1","signature":"public.faolla_attendance_delegated_config_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"aea5553ddbaf4f313b29c79befc9079861461d390ca6b508eb55643c50f4af04","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_admin_core_v2","signature":"public.faolla_attendance_admin_core_v2(text,uuid,jsonb,jsonb,uuid,uuid)","hash":"61ab115817b3eedf7013ed2754da773740eccf66e2da64eb6a7df9bea31530f0","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site_id","p_auth_user_id","p_query","p_command","p_operation_id","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_v1","signature":"public.faolla_attendance_delegated_config_v1(jsonb,uuid,jsonb,boolean)","hash":"b34b78aee5358744636719b10a70e6dbe8ed185928c085fee922bbe0b0a8c0b6","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}]$config205_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
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
 end loop; end if;foreach table_name in array array['merchant_attendance_config_operations'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or (acl.grantee<>expected_owner and not(acl.grantee=(select oid from pg_roles where rolname='service_role') and acl.privilege_type='SELECT' and not acl.is_grantable))))
   or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation) is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation)) then raise exception 'merchant_attendance_delegated_configuration_table_conflict';end if;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_configuration_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.groups_expected_settings') then to_regclass(ns||'.merchant_attendance_settings') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit) is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_configuration_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_configuration_index_conflict';end if;
  for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
   select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption) is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_configuration_index_conflict';end if;
  end loop;
  if not has_table_privilege('service_role',actual_table,'SELECT') or (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>2 then raise exception 'merchant_attendance_delegated_configuration_trigger_conflict';end if;
  for trigger_spec in select * from(values('merchant_attendance_config_no_rewrite',27),('merchant_attendance_config_no_truncate',34)) expected(name,kind) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_configuration_trigger_conflict';end if;
  end loop;
  if exists(select 1 from pg_attribute actual left join pg_attrdef actual_default on actual_default.adrelid=actual.attrelid and actual_default.adnum=actual.attnum left join pg_attrdef expected_default on expected_default.adrelid=expected_table and expected_default.adnum=actual.attnum
   where actual.attrelid=actual_table and actual.attnum>0 and pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table)) then raise exception 'merchant_attendance_delegated_configuration_default_conflict';end if;
 end loop;
 end;$config205_preflight$;
--END GENERATED DELEGATED CONFIGURATION PREFLIGHT

create or replace function public.faolla_attendance_delegated_config_query_v1(p jsonb)
returns void language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>4 or not(p ?& array['siteId','grantId','mode','operationId'])
  or jsonb_typeof(p->'siteId') is distinct from 'string' or coalesce(p->>'siteId','') !~ '^[0-9]{8}$'
  or jsonb_typeof(p->'grantId') is distinct from 'string' or coalesce(p->>'grantId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or jsonb_typeof(p->'mode') is distinct from 'string' or p->>'mode' not in('context','recover') then raise exception 'attendance_invalid_request';end if;
 if p->>'mode'='context' then
  if p->'operationId'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
 elsif jsonb_typeof(p->'operationId') is distinct from 'string' or coalesce(p->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'attendance_invalid_request';end if;
 if octet_length(convert_to(p::text,'UTF8'))>4096 then raise exception 'attendance_invalid_request';end if;
end;
$$;
create or replace function public.faolla_attendance_delegated_config_command_v1(c jsonb)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare v jsonb;k text;u constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';d date;
begin
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>4 or not(c ?& array['kind','values','operationId','expectedVersion'])
  or jsonb_typeof(c->'kind') is distinct from 'string' or c->>'kind' not in('worker','location') or jsonb_typeof(c->'operationId') is distinct from 'string' or coalesce(c->>'operationId','') !~ u
  or jsonb_typeof(c->'expectedVersion') is distinct from 'number' or coalesce(c->>'expectedVersion','') !~ '^[1-9][0-9]{0,15}$' or (c->>'expectedVersion')::numeric>=9007199254740990
  or jsonb_typeof(c->'values') is distinct from 'object' or octet_length(convert_to(c::text,'UTF8'))>8192 then raise exception 'attendance_invalid_request';end if;
 v:=c->'values';k:=c->>'kind';
 if jsonb_typeof(v->'id') is distinct from 'string' or coalesce(v->>'id','') !~ u or jsonb_typeof(v->'active') is distinct from 'boolean' then raise exception 'attendance_invalid_request';end if;
 if k='location' then
  if (select count(*) from jsonb_object_keys(v))<>4 or not(v ?& array['id','name','timeZone','active']) or jsonb_typeof(v->'name') is distinct from 'string'
   or char_length(v->>'name') not between 1 and 120 or btrim(v->>'name') is distinct from v->>'name' or (v->>'name')~'[[:cntrl:]]'
   or jsonb_typeof(v->'timeZone') is distinct from 'string' or public.faolla_attendance_valid_zone_v1(v->>'timeZone') is distinct from true then raise exception 'attendance_invalid_request';end if;
 else
  if (select count(*) from jsonb_object_keys(v))<>7 or not(v ?& array['id','employeeId','workerNo','displayName','locationId','active','startsOn'])
   or jsonb_typeof(v->'employeeId') is distinct from 'string' or coalesce(v->>'employeeId','') !~ u or jsonb_typeof(v->'locationId') is distinct from 'string' or coalesce(v->>'locationId','') !~ u
   or jsonb_typeof(v->'workerNo') is distinct from 'string' or char_length(v->>'workerNo') not between 1 and 40 or btrim(v->>'workerNo') is distinct from v->>'workerNo' or (v->>'workerNo')~'[[:cntrl:]]'
   or jsonb_typeof(v->'displayName') is distinct from 'string' or char_length(v->>'displayName') not between 1 and 120 or btrim(v->>'displayName') is distinct from v->>'displayName' or (v->>'displayName')~'[[:cntrl:]]'
   or jsonb_typeof(v->'startsOn') is distinct from 'string' or coalesce(v->>'startsOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'attendance_invalid_request';end if;
  d:=(v->>'startsOn')::date;if d not between date '2000-01-01' and date '2100-12-31' or d::text<>v->>'startsOn' then raise exception 'attendance_invalid_request';end if;
 end if;
exception when invalid_text_representation or datetime_field_overflow then raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_delegated_config_hash_v1(site text,actor uuid,grant_id uuid,c jsonb)
returns text language plpgsql stable set search_path=pg_catalog as $$
declare v jsonb;t jsonb;
begin
 perform public.faolla_attendance_delegated_config_command_v1(c);
 if site is null or site !~ '^[0-9]{8}$' or actor is null or grant_id is null then raise exception 'attendance_invalid_request';end if;v:=c->'values';
 t:=case when c->>'kind'='worker' then jsonb_build_array(v->'id',v->'employeeId',v->'workerNo',v->'displayName',v->'locationId',v->'active',v->'startsOn') else jsonb_build_array(v->'id',v->'name',v->'timeZone',v->'active') end;
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-configuration-command-v1',site,actor,grant_id,jsonb_build_array(c->'kind',c->'operationId',c->'expectedVersion',t)));
end;
$$;
create or replace function public.faolla_attendance_delegated_config_business_v1(p public.merchant_attendance_config_operations)
returns text language sql immutable set search_path=pg_catalog as $$
 select public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-configuration-business-v1',p.merchant_id,p.operation_id,p.actor_auth_user_id,p.version,p.command,p.before_value,p.after_value,to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
$$;
create or replace function public.faolla_attendance_delegated_config_authorize_v1(site text,actor uuid,id uuid,kind text,p_created boolean)
returns public.merchant_attendance_management_delegations language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;employee public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
 target public.merchant_enterprise_employees%rowtype;stamp timestamptz;
begin
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id for share;
 if actor is null or p_created is null or g.grant_id is null or g.delegate_auth_user_id is distinct from actor or g.delegated_action not in('worker_save','location_save')
  or kind is not null and g.delegated_action is distinct from (case kind when 'worker' then 'worker_save' when 'location' then 'location_save' end) then raise exception 'attendance_access_denied';end if;
 select * into employee from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.delegate_employee_id for share;
 select * into role_row from public.merchant_enterprise_roles actual where actual.merchant_id=site and actual.id=employee.role_id for share;stamp:=clock_timestamp();
 if not p_created then
  if public.faolla_attendance_management_current_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;
 else
  --Only a proven create postimage replaces scope_context's ABSENT test.
  if g.scope->'create' is distinct from 'true'::jsonb or g.scope->>'kind' not in('worker','location')
   or not isfinite(stamp) or not(stamp>=g.valid_from and stamp<g.valid_until)
   or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.grant_id=g.grant_id)
   or not exists(select 1 from public.merchants actual where actual.id=site and actual.user_id=g.actor_auth_user_id)
   or not exists(select 1 from public.merchant_attendance_settings actual where actual.merchant_id=site and actual.enabled)
   or employee.auth_user_id is distinct from g.delegate_auth_user_id or employee.status is distinct from 'active' or role_row.status is distinct from 'active'
   or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true or not(role_row.permissions @> array['enterprise.view',g.capability])
   or coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=site and epoch.employee_id=g.delegate_employee_id),0)<>g.delegate_generation
   or exists(select 1 from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=site and epoch.employee_id=g.delegate_employee_id and epoch.paused) then raise exception 'attendance_access_denied';end if;
  if g.scope->>'kind'='worker' then
   select * into target from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.employee_id for share;
   if row(g.worker_id,g.employee_id,g.employee_auth_user_id) is distinct from row((g.scope->>'workerId')::uuid,(g.scope->>'employeeId')::uuid,(g.scope->>'employeeAuthUserId')::uuid)
    or target.id is null or target.auth_user_id is distinct from g.employee_auth_user_id
    or coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=site and epoch.employee_id=g.employee_id),0) is distinct from g.employee_generation
    or exists(select 1 from jsonb_array_elements_text(g.scope->'locationIds') requested(id) where not exists(select 1 from public.merchant_attendance_locations actual where actual.merchant_id=site and actual.id=requested.id::uuid)) then raise exception 'attendance_access_denied';end if;
  elsif g.worker_id is not null or g.employee_id is not null or g.employee_auth_user_id is not null or g.employee_generation is not null then raise exception 'attendance_access_denied';end if;
 end if;return g;
end;
$$;
create or replace function public.faolla_attendance_delegated_config_operation_v1(p public.merchant_attendance_management_delegation_operations,p_current boolean)
returns void language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;b public.merchant_attendance_config_operations%rowtype;c jsonb;v jsonb;created boolean;
 w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;previous_version bigint;
begin
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.grant_id;
 select * into b from public.merchant_attendance_config_operations actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id;
 if p_current is null or g.grant_id is null or b.operation_id is null then raise exception 'attendance_delegated_configuration_invalid';end if;c:=b.command;v:=c->'values';
 perform public.faolla_attendance_delegated_config_command_v1(c);created:=g.scope->'create'='true'::jsonb;
 if row(p.actor_auth_user_id,p.delegate_employee_id,p.delegate_generation,p.delegated_action,p.business_operation_id,p.business_reference_id,p.business_revision,p.recorded_at)
  is distinct from row(g.delegate_auth_user_id,g.delegate_employee_id,g.delegate_generation,case c->>'kind' when 'worker' then 'worker_save' else 'location_save' end,p.operation_id,(v->>'id')::uuid,b.version,b.recorded_at)
  or b.actor_auth_user_id is distinct from p.actor_auth_user_id or g.delegated_action is distinct from p.delegated_action
  or b.after_value is distinct from v or b.version<>(c->>'expectedVersion')::bigint+1 or not isfinite(b.recorded_at) or b.recorded_at<g.recorded_at
  or p.command_fingerprint is distinct from public.faolla_attendance_delegated_config_hash_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id,c)
  or p.business_fingerprint is distinct from public.faolla_attendance_delegated_config_business_v1(b)
  or created is distinct from (b.before_value is null)
  or exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.operation_id)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id) then raise exception 'attendance_delegated_configuration_invalid';end if;
 if c->>'kind'='worker' then
  if g.scope->>'kind'<>'worker' or row(v->>'id',v->>'employeeId') is distinct from row(g.scope->>'workerId',g.scope->>'employeeId')
   or not(g.scope->'locationIds' @> jsonb_build_array(v->'locationId'))
   or not created and (row(b.before_value->>'merchant_id',b.before_value->>'id',b.before_value->>'employee_id') is distinct from row(p.merchant_id,v->>'id',v->>'employeeId')
    or not(g.scope->'locationIds' @> jsonb_build_array(b.before_value->'default_location_id'))) then raise exception 'attendance_delegated_configuration_invalid';end if;
 else
  if g.scope->>'kind'<>'location' or v->>'id' is distinct from g.scope->>'locationId'
   or not created and row(b.before_value->>'merchant_id',b.before_value->>'id') is distinct from row(p.merchant_id,v->>'id') then raise exception 'attendance_delegated_configuration_invalid';end if;
 end if;
 if not created and (jsonb_typeof(b.before_value) is distinct from 'object' or coalesce(b.before_value->>'version','') !~ '^[1-9][0-9]{0,15}$') then raise exception 'attendance_delegated_configuration_invalid';end if;
 if p_current then
  perform public.faolla_attendance_delegated_config_authorize_v1(p.merchant_id,p.actor_auth_user_id,p.grant_id,c->>'kind',created);
  if not exists(select 1 from public.merchant_attendance_settings actual where actual.merchant_id=p.merchant_id and actual.version=b.version) then raise exception 'attendance_delegated_configuration_invalid';end if;
  previous_version:=case when created then 0 else (b.before_value->>'version')::bigint end;
  if c->>'kind'='worker' then
   select * into w from public.merchant_attendance_workers actual where actual.merchant_id=p.merchant_id and actual.id=(v->>'id')::uuid for share;
   if w.id is null or w.version<>previous_version+1 or row(w.employee_id,w.worker_no,w.display_name,w.default_location_id,w.active) is distinct from row((v->>'employeeId')::uuid,v->>'workerNo',v->>'displayName',(v->>'locationId')::uuid,(v->>'active')::boolean)
    or not isfinite(w.created_at) or not isfinite(w.updated_at) or w.updated_at<w.created_at or w.updated_at>b.recorded_at
    or public.faolla_attendance_employment_config_v1(p.merchant_id,w.id,w.employee_id,(v->>'startsOn')::date,w.active) is distinct from true then raise exception 'attendance_delegated_configuration_invalid';end if;
   if created and ((select count(*) from public.merchant_attendance_employment_periods actual where actual.merchant_id=p.merchant_id and actual.worker_id=w.id)<>1
    or not exists(select 1 from public.merchant_attendance_employment_periods actual where actual.merchant_id=p.merchant_id and actual.worker_id=w.id and actual.starts_on=(v->>'startsOn')::date and actual.ends_on is null)) then raise exception 'attendance_delegated_configuration_invalid';end if;
  else
   select * into l from public.merchant_attendance_locations actual where actual.merchant_id=p.merchant_id and actual.id=(v->>'id')::uuid for share;
   if l.id is null or l.version<>previous_version+1 or row(l.name,l.time_zone,l.active) is distinct from row(v->>'name',v->>'timeZone',(v->>'active')::boolean)
    or l.radius_meters is not null or not isfinite(l.created_at) or not isfinite(l.updated_at) or l.updated_at<l.created_at or l.updated_at>b.recorded_at then raise exception 'attendance_delegated_configuration_invalid';end if;
  end if;
 end if;
end;
$$;
create or replace function public.faolla_attendance_delegated_config_receipt_v1(site text,op uuid,actor uuid,id uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare saved public.merchant_attendance_management_delegation_operations%rowtype;
begin
 select * into saved from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op and actual.actor_auth_user_id=actor and actual.grant_id=id and actual.delegated_action in('worker_save','location_save');
 if saved.operation_id is null then return null;end if;perform public.faolla_attendance_delegated_config_operation_v1(saved,false);
 return jsonb_build_object('operationId',op,'actorId',actor,'grantId',id,'action',saved.delegated_action,'referenceId',saved.business_reference_id,'revision',saved.business_revision,
  'commandFingerprint',saved.command_fingerprint,'businessFingerprint',saved.business_fingerprint,'recordedAt',to_char(saved.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
create or replace function public.faolla_attendance_delegated_config_authority_v1(p public.merchant_attendance_management_delegation_operations)
returns void language plpgsql set search_path=pg_catalog as $$
begin perform public.faolla_attendance_delegated_config_operation_v1(p,true);end;
$$;

--BEGIN GENERATED DELEGATED CONFIGURATION CORE
create or replace function public.faolla_attendance_admin_core_v2(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb,p_operation_id uuid,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare
  v_merchant public.merchants%rowtype;
  v_settings public.merchant_attendance_settings%rowtype;
  v_location public.merchant_attendance_locations%rowtype;
  v_worker public.merchant_attendance_workers%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_operation public.merchant_attendance_config_operations%rowtype;
  v_values jsonb;
  v_before jsonb;
  v_after jsonb;
  v_kind text;
  v_expected bigint;
  v_operation_id uuid;
  v_id uuid;
  v_view text;
  v_cursor uuid;
  v_search text;
  v_rows jsonb := '[]'::jsonb;
  v_next uuid;
  v_version bigint;
  v_start date;
  v_is_new boolean;
  v_inserted integer := 0;
  v_uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request'; end if;
  if (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['view','cursor','search'])
    or coalesce(p_query->>'view','') not in ('settings','locations','workers','employees')
    or jsonb_typeof(p_query->'search')<>'string' or char_length(p_query->>'search')>80
    or (p_query->>'search') ~ '[[:cntrl:]]'
    or (p_query->'cursor'<>'null'::jsonb and coalesce(p_query->>'cursor','') !~ v_uuid_pattern)
  then raise exception 'attendance_invalid_request'; end if;
  v_view:=p_query->>'view'; v_cursor:=(p_query->>'cursor')::uuid; v_search:=btrim(p_query->>'search');

  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command))<>4 or not(p_command ?& array['kind','values','operationId','expectedVersion'])
      or coalesce(p_command->>'kind','') not in ('settings','location','worker')
      or coalesce(p_command->>'operationId','') !~ v_uuid_pattern
      or jsonb_typeof(p_command->'expectedVersion')<>'number'
      or coalesce(p_command->>'expectedVersion','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedVersion')::numeric>=9007199254740991
      or jsonb_typeof(p_command->'values')<>'object'
    then raise exception 'attendance_invalid_request'; end if;
    v_values:=p_command->'values'; v_kind:=p_command->>'kind';
    v_operation_id:=(p_command->>'operationId')::uuid; v_expected:=(p_command->>'expectedVersion')::bigint;
    if v_kind='settings' then
      if (select count(*) from jsonb_object_keys(v_values))<>4 or not(v_values ?& array['timeZone','enabled','webClockEnabled','webBreakPaid'])
        or jsonb_typeof(v_values->'enabled')<>'boolean' or jsonb_typeof(v_values->'webClockEnabled')<>'boolean'
        or jsonb_typeof(v_values->'webBreakPaid')<>'boolean' then raise exception 'attendance_invalid_request'; end if;
    elsif v_kind='location' then
      if (select count(*) from jsonb_object_keys(v_values))<>4 or not(v_values ?& array['id','name','timeZone','active'])
        or coalesce(v_values->>'id','') !~ v_uuid_pattern or jsonb_typeof(v_values->'active')<>'boolean'
        or jsonb_typeof(v_values->'name')<>'string' or char_length(btrim(v_values->>'name')) not between 1 and 120
        or (v_values->>'name') ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request'; end if;
      v_id:=(v_values->>'id')::uuid;
    else
      if (select count(*) from jsonb_object_keys(v_values))<>7 or not(v_values ?& array['id','employeeId','workerNo','displayName','locationId','active','startsOn'])
        or coalesce(v_values->>'id','') !~ v_uuid_pattern or coalesce(v_values->>'employeeId','') !~ v_uuid_pattern
        or coalesce(v_values->>'locationId','') !~ v_uuid_pattern or jsonb_typeof(v_values->'active')<>'boolean'
        or jsonb_typeof(v_values->'workerNo')<>'string' or char_length(btrim(v_values->>'workerNo')) not between 1 and 40
        or jsonb_typeof(v_values->'displayName')<>'string' or char_length(btrim(v_values->>'displayName')) not between 1 and 120
        or (v_values->>'workerNo') ~ '[[:cntrl:]]' or (v_values->>'displayName') ~ '[[:cntrl:]]'
        or coalesce(v_values->>'startsOn','') !~ '^\d{4}-\d{2}-\d{2}$'
      then raise exception 'attendance_invalid_request'; end if;
      v_id:=(v_values->>'id')::uuid; v_start:=(v_values->>'startsOn')::date;
      if v_start not between date '2000-01-01' and date '2100-12-31' then raise exception 'attendance_invalid_request'; end if;
    end if;
    if v_kind in ('settings','location') and (jsonb_typeof(v_values->'timeZone')<>'string'
      or not public.faolla_attendance_valid_zone_v1(v_values->>'timeZone')) then raise exception 'attendance_invalid_time_zone'; end if;
  end if;

  if p_grant_id is null then
  -- Match existing owner identity columns; never trust a client actor/role claim.
  -- Holding this row makes an ownership transfer precede or follow this transaction.
  select * into v_merchant from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[
    v_merchant.user_id,v_merchant.auth_user_id,v_merchant.owner_user_id,v_merchant.owner_id,
    v_merchant.auth_id,v_merchant.created_by,v_merchant.created_by_user_id]),false)
  then raise exception 'attendance_access_denied'; end if;
  else
    if p_command is null or v_kind not in('worker','location') or p_operation_id is not null
      or p_query is distinct from jsonb_build_object('view','settings','cursor',null,'search','') then raise exception 'attendance_invalid_request';end if;
    perform public.faolla_attendance_delegated_config_authorize_v1(p_site_id,p_auth_user_id,p_grant_id,v_kind,false);
  end if;

  if p_command is not null then
    -- Only explicit initial settings save creates a row; no implicit bootstrap on GET.
    if v_kind='settings' and v_expected=0 then
      insert into public.merchant_attendance_settings(merchant_id,time_zone)
      values(p_site_id,v_values->>'timeZone') on conflict(merchant_id) do nothing;
      get diagnostics v_inserted = row_count;
    end if;
    -- Rare config writes lock settings exclusively. All punches already take a
    -- shared settings lock FIRST, so checking open sessions cannot race a punch.
    select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for update;
  else
    select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  end if;
  v_version:=coalesce(v_settings.version,0);
  if p_command is not null then
    if v_settings.merchant_id is null then raise exception 'attendance_settings_required'; end if;
    select * into v_operation from public.merchant_attendance_config_operations
      where merchant_id=p_site_id and operation_id=v_operation_id;
    if v_operation.operation_id is not null then
      if v_operation.actor_auth_user_id<>p_auth_user_id or v_operation.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
    else
      -- version 0 is reserved for settings with no previous config operation.
      v_is_new:=v_inserted=1;
      if not v_is_new and v_expected<>v_settings.version then raise exception 'attendance_version_conflict'; end if;
      if v_settings.version>=9007199254740990 then raise exception 'attendance_version_conflict'; end if;
      v_version:=case when v_is_new then 1 else v_settings.version+1 end;
      if v_kind='settings' then
        v_before:=case when v_is_new then null else to_jsonb(v_settings) end;
        if (v_values->>'timeZone')<>v_settings.time_zone and exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id)
          then raise exception 'attendance_history_protected'; end if;
        if ((v_settings.enabled and not (v_values->>'enabled')::boolean)
          or (v_settings.web_clock_enabled and not (v_values->>'webClockEnabled')::boolean)
          or v_settings.web_break_paid<>(v_values->>'webBreakPaid')::boolean)
          and exists(select 1 from public.merchant_attendance_workers w
            cross join lateral (select action from public.merchant_attendance_events e where e.merchant_id=w.merchant_id and e.worker_id=w.id order by sequence desc limit 1) last
            where w.merchant_id=p_site_id and last.action<>'clock_out') then raise exception 'attendance_open_sessions'; end if;
        update public.merchant_attendance_settings set time_zone=v_values->>'timeZone',enabled=(v_values->>'enabled')::boolean,
          web_clock_enabled=(v_values->>'webClockEnabled')::boolean,web_break_paid=(v_values->>'webBreakPaid')::boolean where merchant_id=p_site_id;
        v_after:=v_values;
      elsif v_kind='location' then
        select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=v_id for update;
        v_before:=case when v_location.id is null then null else to_jsonb(v_location) end;
        if v_location.id is not null and v_location.radius_meters is not null then raise exception 'attendance_history_protected'; end if;
        if v_location.id is not null and (v_values->>'timeZone')<>v_location.time_zone
          and exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and location_id=v_id) then raise exception 'attendance_history_protected'; end if;
        if not (v_values->>'active')::boolean and exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site_id and default_location_id=v_id and active)
          then raise exception 'attendance_location_in_use'; end if;
        if v_location.id is null then
          insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
          values(v_id,p_site_id,btrim(v_values->>'name'),v_values->>'timeZone',(v_values->>'active')::boolean);
        else
          update public.merchant_attendance_locations set name=btrim(v_values->>'name'),time_zone=v_values->>'timeZone',active=(v_values->>'active')::boolean,
            version=version+1,updated_at=clock_timestamp() where merchant_id=p_site_id and id=v_id;
        end if;
        v_after:=v_values;
      else
        -- Settings lock precedes employee and worker locks, same as self-clock.
        select * into v_employee from public.merchant_enterprise_employees where merchant_id=p_site_id and id=(v_values->>'employeeId')::uuid for share;
        if not found or ((v_values->>'active')::boolean and v_employee.status<>'active') then raise exception 'attendance_employee_invalid'; end if;
        select * into v_worker from public.merchant_attendance_workers where merchant_id=p_site_id and id=v_id for update;
        v_before:=case when v_worker.id is null then null else to_jsonb(v_worker) end;
        if v_worker.id is not null and (v_worker.employee_id is distinct from v_employee.id
          or not public.faolla_attendance_employment_config_v1(p_site_id,v_id,v_employee.id,v_start,(v_values->>'active')::boolean))
          then raise exception 'attendance_history_protected'; end if;
        if v_worker.id is not null and (v_worker.active is distinct from (v_values->>'active')::boolean or v_worker.default_location_id is distinct from (v_values->>'locationId')::uuid)
          and exists(select 1 from (select action from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=v_id order by sequence desc limit 1) last where action<>'clock_out')
          then raise exception 'attendance_open_sessions'; end if;
        select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=(v_values->>'locationId')::uuid for share;
        if not found or v_location.radius_meters is not null or ((v_values->>'active')::boolean and not v_location.active) then raise exception 'attendance_location_denied'; end if;
        if v_worker.id is null then
          insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
          values(v_id,p_site_id,v_employee.id,btrim(v_values->>'workerNo'),btrim(v_values->>'displayName'),(v_values->>'active')::boolean,v_location.id);
          insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values(p_site_id,v_id,v_start);
        else
          update public.merchant_attendance_workers set worker_no=btrim(v_values->>'workerNo'),display_name=btrim(v_values->>'displayName'),
            active=(v_values->>'active')::boolean,default_location_id=v_location.id,version=version+1,updated_at=clock_timestamp() where merchant_id=p_site_id and id=v_id;
        end if;
        v_after:=v_values;
      end if;
      update public.merchant_attendance_settings set version=v_version,updated_at=clock_timestamp() where merchant_id=p_site_id returning * into v_settings;
      insert into public.merchant_attendance_config_operations(merchant_id,operation_id,actor_auth_user_id,version,command,before_value,after_value)
      values(p_site_id,v_operation_id,p_auth_user_id,v_version,p_command,v_before,v_after) returning * into v_operation;
    end if;
  else
    select * into v_operation from public.merchant_attendance_config_operations
      where merchant_id=p_site_id and operation_id=p_operation_id and actor_auth_user_id=p_auth_user_id;
  end if;

  -- At most 26 indexed keyset rows, return 25. No enterprise overview snapshot,
  -- auth IDs, email, geolocation or all-history fetches in these choices.
  if v_view='locations' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select id,jsonb_build_object('id',id,'name',name,'timeZone',time_zone,'active',active) j
      from public.merchant_attendance_locations where merchant_id=p_site_id and (v_cursor is null or id>v_cursor)
        and (v_search='' or strpos(lower(name),lower(v_search))>0) order by id limit 26) page;
  elsif v_view='workers' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select w.id,jsonb_build_object('id',w.id,'employeeId',w.employee_id,'workerNo',w.worker_no,'displayName',w.display_name,'locationId',w.default_location_id,
        'active',w.active,'startsOn',p.starts_on::text) j
      from public.merchant_attendance_workers w
      join lateral(select starts_on from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=w.id order by starts_on desc limit 1) p on true
      where w.merchant_id=p_site_id and w.employee_id is not null and w.default_location_id is not null and (v_cursor is null or w.id>v_cursor)
        and (v_search='' or strpos(lower(w.display_name||' '||w.worker_no),lower(v_search))>0) order by w.id limit 26) page;
  elsif v_view='employees' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select e.id,jsonb_build_object('id',e.id,'displayName',e.display_name) j
      from public.merchant_enterprise_employees e where e.merchant_id=p_site_id and e.status='active' and (v_cursor is null or e.id>v_cursor)
        and (v_search='' or strpos(lower(e.display_name),lower(v_search))>0)
        and not exists(select 1 from public.merchant_attendance_workers w where w.merchant_id=p_site_id and w.employee_id=e.id)
      order by e.id limit 26) page;
  end if;
  if jsonb_array_length(v_rows)>25 then v_rows:=v_rows-25; v_next:=(v_rows->24->>'id')::uuid; end if;
  return jsonb_build_object('siteId',p_site_id,'version',v_version,'view',v_view,'items',v_rows,'nextCursor',v_next,
    'settings',case when v_settings.merchant_id is null then null else jsonb_build_object('timeZone',v_settings.time_zone,'enabled',v_settings.enabled,
      'webClockEnabled',v_settings.web_clock_enabled,'webBreakPaid',v_settings.web_break_paid) end,
    'receipt',case when v_operation.operation_id is null then null else jsonb_build_object('operationId',v_operation.operation_id,'version',v_operation.version,
      'kind',v_operation.command->>'kind','targetId',v_operation.command->'values'->>'id') end);
exception
  when unique_violation then raise exception 'attendance_duplicate_worker';
  when invalid_text_representation or datetime_field_overflow then raise exception 'attendance_invalid_request';
end;
$$;
--END GENERATED DELEGATED CONFIGURATION CORE

create or replace function public.faolla_attendance_delegated_config_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;id uuid;op uuid;fp text;receipt jsonb;legacy jsonb;g public.merchant_attendance_management_delegations%rowtype;b public.merchant_attendance_config_operations%rowtype;
 entry public.merchant_attendance_management_delegation_operations%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;l public.merchant_attendance_locations%rowtype;
 worker_item jsonb;employee_item jsonb;locations jsonb:='[]';target_version bigint;settings_version bigint;context jsonb;
begin
 perform public.faolla_attendance_delegated_config_query_v1(p_query);site:=p_query->>'siteId';id:=(p_query->>'grantId')::uuid;
 if p_auth_user_id is null or p_allow_write is null then raise exception 'attendance_invalid_request';end if;
 if p_query->>'mode'='recover' then
  if p_command is not null then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
 elsif p_command is not null then fp:=public.faolla_attendance_delegated_config_hash_v1(site,p_auth_user_id,id,p_command);op:=(p_command->>'operationId')::uuid;end if;
 receipt:=public.faolla_attendance_delegated_config_receipt_v1(site,op,p_auth_user_id,id);
 if p_query->>'mode'='recover' or receipt is not null then
  if receipt is not null and p_command is not null and receipt->>'commandFingerprint' is distinct from fp then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('protocol','attendance-delegated-configuration-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 select actual.version into settings_version from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 --An identical operation may have committed while this request waited.
 receipt:=public.faolla_attendance_delegated_config_receipt_v1(site,op,p_auth_user_id,id);
 if receipt is not null then
  if receipt->>'commandFingerprint' is distinct from fp then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('protocol','attendance-delegated-configuration-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 if op is not null and (exists(select 1 from public.merchant_attendance_config_operations actual where actual.merchant_id=site and actual.operation_id=op)
  or exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=op)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.operation_id=op)
  or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op)) then raise exception 'attendance_operation_conflict';end if;
 if p_command is not null and not p_allow_write then raise exception 'attendance_delegated_configuration_disabled';end if;
 g:=public.faolla_attendance_delegated_config_authorize_v1(site,p_auth_user_id,id,p_command->>'kind',false);
 if p_command is not null then
  if g.scope->>'kind'='worker' then
   if row(p_command->'values'->>'id',p_command->'values'->>'employeeId') is distinct from row(g.scope->>'workerId',g.scope->>'employeeId') or not(g.scope->'locationIds' @> jsonb_build_array(p_command->'values'->'locationId')) then raise exception 'attendance_access_denied';end if;
  elsif p_command->'values'->>'id' is distinct from g.scope->>'locationId' then raise exception 'attendance_access_denied';end if;
  legacy:=public.faolla_attendance_admin_core_v2(site,p_auth_user_id,jsonb_build_object('view','settings','cursor',null,'search',''),p_command,null,id);
  select * into b from public.merchant_attendance_config_operations actual where actual.merchant_id=site and actual.operation_id=op;
  if b.operation_id is null or legacy->'receipt'->>'operationId' is distinct from op::text then raise exception 'attendance_delegated_configuration_invalid';end if;
  insert into public.merchant_attendance_management_delegation_operations(merchant_id,operation_id,grant_id,actor_auth_user_id,delegate_employee_id,delegate_generation,delegated_action,business_operation_id,business_reference_id,business_revision,business_fingerprint,command_fingerprint,recorded_at)
   values(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.delegated_action,op,(p_command->'values'->>'id')::uuid,b.version,public.faolla_attendance_delegated_config_business_v1(b),fp,b.recorded_at) returning * into entry;
  receipt:=public.faolla_attendance_delegated_config_receipt_v1(site,op,p_auth_user_id,id);
  return jsonb_build_object('protocol','attendance-delegated-configuration-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 --Only grant-bounded point reads. Never invoke the legacy owner listing views.
 if g.scope->>'kind'='worker' then
  select * into w from public.merchant_attendance_workers actual where actual.merchant_id=site and actual.id=g.worker_id;
  select * into e from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.employee_id;
  employee_item:=jsonb_build_object('id',e.id,'displayName',e.display_name);target_version:=w.version;
  if w.id is not null then worker_item:=jsonb_build_object('id',w.id,'employeeId',w.employee_id,'workerNo',w.worker_no,'displayName',w.display_name,'locationId',w.default_location_id,'active',w.active,
   'startsOn',(select actual.starts_on::text from public.merchant_attendance_employment_periods actual where actual.merchant_id=site and actual.worker_id=w.id order by actual.starts_on desc limit 1));end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',actual.id,'name',actual.name,'timeZone',actual.time_zone,'active',actual.active) order by actual.id),'[]') into locations
   from jsonb_array_elements_text(g.scope->'locationIds') requested(id)
   cross join lateral(select point.id,point.name,point.time_zone,point.active from public.merchant_attendance_locations point
    where point.merchant_id=site and point.id=requested.id::uuid offset 0) actual;
 else
  select * into l from public.merchant_attendance_locations actual where actual.merchant_id=site and actual.id=(g.scope->>'locationId')::uuid;target_version:=l.version;
  if l.id is not null then locations:=jsonb_build_array(jsonb_build_object('id',l.id,'name',l.name,'timeZone',l.time_zone,'active',l.active));end if;
 end if;
 context:=jsonb_build_object('settingsVersion',settings_version,'targetVersion',target_version,'worker',worker_item,'employee',employee_item,'locations',locations);
 return jsonb_build_object('protocol','attendance-delegated-configuration-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','context','grantId',id,'action',g.delegated_action,'scope',g.scope,'context',context);
end;
$$;

--BEGIN GENERATED DELEGATED CONFIGURATION FORWARD
do $config205_forward_0$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name='merchant_attendance_delegated_configuration') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid)'::regprocedure;
 if old_body is distinct from $config205_old_0$
declare
  v_merchant public.merchants%rowtype;
  v_settings public.merchant_attendance_settings%rowtype;
  v_location public.merchant_attendance_locations%rowtype;
  v_worker public.merchant_attendance_workers%rowtype;
  v_employee public.merchant_enterprise_employees%rowtype;
  v_operation public.merchant_attendance_config_operations%rowtype;
  v_values jsonb;
  v_before jsonb;
  v_after jsonb;
  v_kind text;
  v_expected bigint;
  v_operation_id uuid;
  v_id uuid;
  v_view text;
  v_cursor uuid;
  v_search text;
  v_rows jsonb := '[]'::jsonb;
  v_next uuid;
  v_version bigint;
  v_start date;
  v_is_new boolean;
  v_inserted integer := 0;
  v_uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null
    or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request'; end if;
  if (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['view','cursor','search'])
    or coalesce(p_query->>'view','') not in ('settings','locations','workers','employees')
    or jsonb_typeof(p_query->'search')<>'string' or char_length(p_query->>'search')>80
    or (p_query->>'search') ~ '[[:cntrl:]]'
    or (p_query->'cursor'<>'null'::jsonb and coalesce(p_query->>'cursor','') !~ v_uuid_pattern)
  then raise exception 'attendance_invalid_request'; end if;
  v_view:=p_query->>'view'; v_cursor:=(p_query->>'cursor')::uuid; v_search:=btrim(p_query->>'search');

  if p_command is not null then
    if p_operation_id is not null or jsonb_typeof(p_command)<>'object' then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command))<>4 or not(p_command ?& array['kind','values','operationId','expectedVersion'])
      or coalesce(p_command->>'kind','') not in ('settings','location','worker')
      or coalesce(p_command->>'operationId','') !~ v_uuid_pattern
      or jsonb_typeof(p_command->'expectedVersion')<>'number'
      or coalesce(p_command->>'expectedVersion','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedVersion')::numeric>=9007199254740991
      or jsonb_typeof(p_command->'values')<>'object'
    then raise exception 'attendance_invalid_request'; end if;
    v_values:=p_command->'values'; v_kind:=p_command->>'kind';
    v_operation_id:=(p_command->>'operationId')::uuid; v_expected:=(p_command->>'expectedVersion')::bigint;
    if v_kind='settings' then
      if (select count(*) from jsonb_object_keys(v_values))<>4 or not(v_values ?& array['timeZone','enabled','webClockEnabled','webBreakPaid'])
        or jsonb_typeof(v_values->'enabled')<>'boolean' or jsonb_typeof(v_values->'webClockEnabled')<>'boolean'
        or jsonb_typeof(v_values->'webBreakPaid')<>'boolean' then raise exception 'attendance_invalid_request'; end if;
    elsif v_kind='location' then
      if (select count(*) from jsonb_object_keys(v_values))<>4 or not(v_values ?& array['id','name','timeZone','active'])
        or coalesce(v_values->>'id','') !~ v_uuid_pattern or jsonb_typeof(v_values->'active')<>'boolean'
        or jsonb_typeof(v_values->'name')<>'string' or char_length(btrim(v_values->>'name')) not between 1 and 120
        or (v_values->>'name') ~ '[[:cntrl:]]' then raise exception 'attendance_invalid_request'; end if;
      v_id:=(v_values->>'id')::uuid;
    else
      if (select count(*) from jsonb_object_keys(v_values))<>7 or not(v_values ?& array['id','employeeId','workerNo','displayName','locationId','active','startsOn'])
        or coalesce(v_values->>'id','') !~ v_uuid_pattern or coalesce(v_values->>'employeeId','') !~ v_uuid_pattern
        or coalesce(v_values->>'locationId','') !~ v_uuid_pattern or jsonb_typeof(v_values->'active')<>'boolean'
        or jsonb_typeof(v_values->'workerNo')<>'string' or char_length(btrim(v_values->>'workerNo')) not between 1 and 40
        or jsonb_typeof(v_values->'displayName')<>'string' or char_length(btrim(v_values->>'displayName')) not between 1 and 120
        or (v_values->>'workerNo') ~ '[[:cntrl:]]' or (v_values->>'displayName') ~ '[[:cntrl:]]'
        or coalesce(v_values->>'startsOn','') !~ '^\d{4}-\d{2}-\d{2}$'
      then raise exception 'attendance_invalid_request'; end if;
      v_id:=(v_values->>'id')::uuid; v_start:=(v_values->>'startsOn')::date;
      if v_start not between date '2000-01-01' and date '2100-12-31' then raise exception 'attendance_invalid_request'; end if;
    end if;
    if v_kind in ('settings','location') and (jsonb_typeof(v_values->'timeZone')<>'string'
      or not public.faolla_attendance_valid_zone_v1(v_values->>'timeZone')) then raise exception 'attendance_invalid_time_zone'; end if;
  end if;

  -- Match existing owner identity columns; never trust a client actor/role claim.
  -- Holding this row makes an ownership transfer precede or follow this transaction.
  select * into v_merchant from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[
    v_merchant.user_id,v_merchant.auth_user_id,v_merchant.owner_user_id,v_merchant.owner_id,
    v_merchant.auth_id,v_merchant.created_by,v_merchant.created_by_user_id]),false)
  then raise exception 'attendance_access_denied'; end if;

  if p_command is not null then
    -- Only explicit initial settings save creates a row; no implicit bootstrap on GET.
    if v_kind='settings' and v_expected=0 then
      insert into public.merchant_attendance_settings(merchant_id,time_zone)
      values(p_site_id,v_values->>'timeZone') on conflict(merchant_id) do nothing;
      get diagnostics v_inserted = row_count;
    end if;
    -- Rare config writes lock settings exclusively. All punches already take a
    -- shared settings lock FIRST, so checking open sessions cannot race a punch.
    select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for update;
  else
    select * into v_settings from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  end if;
  v_version:=coalesce(v_settings.version,0);
  if p_command is not null then
    if v_settings.merchant_id is null then raise exception 'attendance_settings_required'; end if;
    select * into v_operation from public.merchant_attendance_config_operations
      where merchant_id=p_site_id and operation_id=v_operation_id;
    if v_operation.operation_id is not null then
      if v_operation.actor_auth_user_id<>p_auth_user_id or v_operation.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
    else
      -- version 0 is reserved for settings with no previous config operation.
      v_is_new:=v_inserted=1;
      if not v_is_new and v_expected<>v_settings.version then raise exception 'attendance_version_conflict'; end if;
      if v_settings.version>=9007199254740990 then raise exception 'attendance_version_conflict'; end if;
      v_version:=case when v_is_new then 1 else v_settings.version+1 end;
      if v_kind='settings' then
        v_before:=case when v_is_new then null else to_jsonb(v_settings) end;
        if (v_values->>'timeZone')<>v_settings.time_zone and exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id)
          then raise exception 'attendance_history_protected'; end if;
        if ((v_settings.enabled and not (v_values->>'enabled')::boolean)
          or (v_settings.web_clock_enabled and not (v_values->>'webClockEnabled')::boolean)
          or v_settings.web_break_paid<>(v_values->>'webBreakPaid')::boolean)
          and exists(select 1 from public.merchant_attendance_workers w
            cross join lateral (select action from public.merchant_attendance_events e where e.merchant_id=w.merchant_id and e.worker_id=w.id order by sequence desc limit 1) last
            where w.merchant_id=p_site_id and last.action<>'clock_out') then raise exception 'attendance_open_sessions'; end if;
        update public.merchant_attendance_settings set time_zone=v_values->>'timeZone',enabled=(v_values->>'enabled')::boolean,
          web_clock_enabled=(v_values->>'webClockEnabled')::boolean,web_break_paid=(v_values->>'webBreakPaid')::boolean where merchant_id=p_site_id;
        v_after:=v_values;
      elsif v_kind='location' then
        select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=v_id for update;
        v_before:=case when v_location.id is null then null else to_jsonb(v_location) end;
        if v_location.id is not null and v_location.radius_meters is not null then raise exception 'attendance_history_protected'; end if;
        if v_location.id is not null and (v_values->>'timeZone')<>v_location.time_zone
          and exists(select 1 from public.merchant_attendance_events where merchant_id=p_site_id and location_id=v_id) then raise exception 'attendance_history_protected'; end if;
        if not (v_values->>'active')::boolean and exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site_id and default_location_id=v_id and active)
          then raise exception 'attendance_location_in_use'; end if;
        if v_location.id is null then
          insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active)
          values(v_id,p_site_id,btrim(v_values->>'name'),v_values->>'timeZone',(v_values->>'active')::boolean);
        else
          update public.merchant_attendance_locations set name=btrim(v_values->>'name'),time_zone=v_values->>'timeZone',active=(v_values->>'active')::boolean,
            version=version+1,updated_at=clock_timestamp() where merchant_id=p_site_id and id=v_id;
        end if;
        v_after:=v_values;
      else
        -- Settings lock precedes employee and worker locks, same as self-clock.
        select * into v_employee from public.merchant_enterprise_employees where merchant_id=p_site_id and id=(v_values->>'employeeId')::uuid for share;
        if not found or ((v_values->>'active')::boolean and v_employee.status<>'active') then raise exception 'attendance_employee_invalid'; end if;
        select * into v_worker from public.merchant_attendance_workers where merchant_id=p_site_id and id=v_id for update;
        v_before:=case when v_worker.id is null then null else to_jsonb(v_worker) end;
        if v_worker.id is not null and (v_worker.employee_id is distinct from v_employee.id
          or not public.faolla_attendance_employment_config_v1(p_site_id,v_id,v_employee.id,v_start,(v_values->>'active')::boolean))
          then raise exception 'attendance_history_protected'; end if;
        if v_worker.id is not null and (v_worker.active is distinct from (v_values->>'active')::boolean or v_worker.default_location_id is distinct from (v_values->>'locationId')::uuid)
          and exists(select 1 from (select action from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=v_id order by sequence desc limit 1) last where action<>'clock_out')
          then raise exception 'attendance_open_sessions'; end if;
        select * into v_location from public.merchant_attendance_locations where merchant_id=p_site_id and id=(v_values->>'locationId')::uuid for share;
        if not found or v_location.radius_meters is not null or ((v_values->>'active')::boolean and not v_location.active) then raise exception 'attendance_location_denied'; end if;
        if v_worker.id is null then
          insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
          values(v_id,p_site_id,v_employee.id,btrim(v_values->>'workerNo'),btrim(v_values->>'displayName'),(v_values->>'active')::boolean,v_location.id);
          insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values(p_site_id,v_id,v_start);
        else
          update public.merchant_attendance_workers set worker_no=btrim(v_values->>'workerNo'),display_name=btrim(v_values->>'displayName'),
            active=(v_values->>'active')::boolean,default_location_id=v_location.id,version=version+1,updated_at=clock_timestamp() where merchant_id=p_site_id and id=v_id;
        end if;
        v_after:=v_values;
      end if;
      update public.merchant_attendance_settings set version=v_version,updated_at=clock_timestamp() where merchant_id=p_site_id returning * into v_settings;
      insert into public.merchant_attendance_config_operations(merchant_id,operation_id,actor_auth_user_id,version,command,before_value,after_value)
      values(p_site_id,v_operation_id,p_auth_user_id,v_version,p_command,v_before,v_after) returning * into v_operation;
    end if;
  else
    select * into v_operation from public.merchant_attendance_config_operations
      where merchant_id=p_site_id and operation_id=p_operation_id and actor_auth_user_id=p_auth_user_id;
  end if;

  -- At most 26 indexed keyset rows, return 25. No enterprise overview snapshot,
  -- auth IDs, email, geolocation or all-history fetches in these choices.
  if v_view='locations' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select id,jsonb_build_object('id',id,'name',name,'timeZone',time_zone,'active',active) j
      from public.merchant_attendance_locations where merchant_id=p_site_id and (v_cursor is null or id>v_cursor)
        and (v_search='' or strpos(lower(name),lower(v_search))>0) order by id limit 26) page;
  elsif v_view='workers' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select w.id,jsonb_build_object('id',w.id,'employeeId',w.employee_id,'workerNo',w.worker_no,'displayName',w.display_name,'locationId',w.default_location_id,
        'active',w.active,'startsOn',p.starts_on::text) j
      from public.merchant_attendance_workers w
      join lateral(select starts_on from public.merchant_attendance_employment_periods where merchant_id=p_site_id and worker_id=w.id order by starts_on desc limit 1) p on true
      where w.merchant_id=p_site_id and w.employee_id is not null and w.default_location_id is not null and (v_cursor is null or w.id>v_cursor)
        and (v_search='' or strpos(lower(w.display_name||' '||w.worker_no),lower(v_search))>0) order by w.id limit 26) page;
  elsif v_view='employees' then
    select coalesce(jsonb_agg(j order by id),'[]'::jsonb) into v_rows from (
      select e.id,jsonb_build_object('id',e.id,'displayName',e.display_name) j
      from public.merchant_enterprise_employees e where e.merchant_id=p_site_id and e.status='active' and (v_cursor is null or e.id>v_cursor)
        and (v_search='' or strpos(lower(e.display_name),lower(v_search))>0)
        and not exists(select 1 from public.merchant_attendance_workers w where w.merchant_id=p_site_id and w.employee_id=e.id)
      order by e.id limit 26) page;
  end if;
  if jsonb_array_length(v_rows)>25 then v_rows:=v_rows-25; v_next:=(v_rows->24->>'id')::uuid; end if;
  return jsonb_build_object('siteId',p_site_id,'version',v_version,'view',v_view,'items',v_rows,'nextCursor',v_next,
    'settings',case when v_settings.merchant_id is null then null else jsonb_build_object('timeZone',v_settings.time_zone,'enabled',v_settings.enabled,
      'webClockEnabled',v_settings.web_clock_enabled,'webBreakPaid',v_settings.web_break_paid) end,
    'receipt',case when v_operation.operation_id is null then null else jsonb_build_object('operationId',v_operation.operation_id,'version',v_operation.version,
      'kind',v_operation.command->>'kind','targetId',v_operation.command->'values'->>'id') end);
exception
  when unique_violation then raise exception 'attendance_duplicate_worker';
  when invalid_text_representation or datetime_field_overflow then raise exception 'attendance_invalid_request';
end;
$config205_old_0$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_configuration_forward_drift';end if;
 execute replace(definition,old_body,$config205_new_0$
begin
 return public.faolla_attendance_admin_core_v2(p_site_id,p_auth_user_id,p_query,p_command,p_operation_id,null);
end;
$config205_new_0$);
 end;$config205_forward_0$;
do $config205_forward_1$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name='merchant_attendance_delegated_configuration') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_management_insert_v1()'::regprocedure;
 if old_body is distinct from $config205_old_1$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then
  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;
  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;
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
$config205_old_1$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_configuration_forward_drift';end if;
 execute replace(definition,old_body,$config205_new_1$
declare context jsonb;g public.merchant_attendance_management_delegations%rowtype;stamp timestamptz;
begin
 if tg_table_name='merchant_attendance_management_delegation_operations' then
  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;
  if new.delegated_action in('group_save','group_assign','group_end','group_cancel') then perform public.faolla_attendance_delegated_groups_authority_v1(new);return new;end if;
  if new.delegated_action in('worker_save','location_save') then perform public.faolla_attendance_delegated_config_authority_v1(new);return new;end if;
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
$config205_new_1$);
 end;$config205_forward_1$;
--END GENERATED DELEGATED CONFIGURATION FORWARD
--BEGIN GENERATED DELEGATED CONFIGURATION POSTCONDITIONS
revoke all on function public.faolla_attendance_delegated_config_query_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_config_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_config_hash_v1(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_config_business_v1(public.merchant_attendance_config_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_config_authorize_v1(text,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_config_operation_v1(public.merchant_attendance_management_delegation_operations,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_config_receipt_v1(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_config_authority_v1(public.merchant_attendance_management_delegation_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_admin_core_v2(text,uuid,jsonb,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_config_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_delegated_config_v1(jsonb,uuid,jsonb,boolean) to service_role;
 do $config205_postconditions$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;own_spec jsonb;f regprocedure;meta record;table_name text;actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_configuration_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080205 and name='merchant_attendance_delegated_configuration');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');own_spec:=$config205_dependencies$[{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_command_v1","signature":"public.faolla_attendance_group_command_v1(jsonb)","hash":"579d7fa2487e8220179294ba36500b39e1a7e828024e8377ad69578da13d61c5","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_item_v1","signature":"public.faolla_attendance_group_item_v1(public.merchant_attendance_groups)","hash":"19231ed0c7b2ecf95e91a27dc92caaefcf6aa3b81b908b54b216574c882c6acf","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_receipt_v1","signature":"public.faolla_attendance_group_receipt_v1(public.merchant_attendance_group_operations,public.merchant_attendance_groups)","hash":"0e0897b6905d35b557c49667d1b039f7601e939bceef00d521206d760239ce4a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_checked_v1","signature":"public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)","hash":"045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_item_v1","signature":"public.faolla_attendance_group_assignment_item_v1(public.merchant_attendance_group_assignments)","hash":"475397dc4b3caf6ce0aab4058456d877e456b3744c3703f810cb80750fe67d82","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_detail_v1","signature":"public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)","hash":"aa65e21fdec5f8854145dfa71ee3d3e3e4eff34bca59a4cda18bf52fb6af0a82","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_query_v1","signature":"public.faolla_attendance_delegated_groups_query_v1(jsonb)","hash":"1582cd1b3e7376554ae99a331af78ef3c8bcef52bcb405d6b4d51be53e5d6385","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_action_v1","signature":"public.faolla_attendance_delegated_groups_action_v1(text)","hash":"121538a7299a56317c69726c183f58a06bf51532fca31662059a6841f6cf7348","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_hash_v1","signature":"public.faolla_attendance_delegated_groups_hash_v1(text,uuid,uuid,jsonb)","hash":"fc054e6e2080ac05dc99924f99e3a1d5bc6db2bf8ff5940471f23e20c4abf6aa","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","grant_id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_authorize_v1","signature":"public.faolla_attendance_delegated_groups_authorize_v1(text,uuid,uuid,text,boolean)","hash":"acdd8535915b321321a35e8bf0abd3590438aa082c9d57871424920896a68e12","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","legacy_action","p_created"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_operation_v1","signature":"public.faolla_attendance_delegated_groups_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"43e97bf502d38b369f27b66e25430fd81e50418763015869c03b9624a6ca61ef","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_receipt_v1","signature":"public.faolla_attendance_delegated_groups_receipt_v1(text,uuid,uuid,uuid)","hash":"4216281e292dda0e00f4e423b98dddc29bfdf567457bbed4656bd4b95716e75b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_authority_v1","signature":"public.faolla_attendance_delegated_groups_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"0d95d4f690fcf51faafd599670698eb34773ceed2826220a69247a4d036a00cf","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_groups_core_v2","signature":"public.faolla_attendance_groups_core_v2(jsonb,uuid,jsonb,boolean,uuid)","hash":"ca8c54338e01af8d00881718a0a9de6b7683816ed5f3a79f79363e062f3a23c7","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_v1","signature":"public.faolla_attendance_delegated_groups_v1(jsonb,uuid,jsonb,boolean)","hash":"8271da64d75e0657325cfe94222b8ec1b8cd847390a6d793f3af331b461de18d","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_valid_zone_v1","signature":"public.faolla_attendance_valid_zone_v1(text)","hash":"3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d","result":"boolean","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_zone"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_config_v1","signature":"public.faolla_attendance_employment_config_v1(text,uuid,uuid,date,boolean)","hash":"3d2e7597a1a7d74c4e56f56cf55c7e7a6c913ddcacf83916cef882a2dba7a037","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_start","p_active"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_chain_v1","signature":"public.faolla_attendance_employment_chain_v1(text,uuid,uuid,uuid)","hash":"80b0c474e1f8b846d448e9bd9eb08cf56d173e7d6ced24e716ea6470645cfbcb","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_worker","p_employee","p_auth"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_receipt_v1","signature":"public.faolla_attendance_employment_receipt_v1(public.merchant_attendance_employment_operations)","hash":"4f6610d6ca4c869421468ee1cee1e502a20d7d460c404a5c1e1c8a75ff6604ab","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_hash_v1","signature":"public.faolla_attendance_employment_hash_v1(text,jsonb)","hash":"325b0715c6f05448210646af92f85b8b5f64b621dbbf8b86b50aa4d124180128","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_employment_command_v1","signature":"public.faolla_attendance_employment_command_v1(jsonb)","hash":"87c4ee444481c0ad4e5e9a492532e79263766c415aacbdb5627c64d7dc127a7c","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_account_activation_guard_v1","signature":"public.faolla_attendance_account_activation_guard_v1()","hash":"2a4f30a259800b7f0e9fda5104f3f16c94629939c28e486962fced41fea4851a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_events_append_only_v1","signature":"public.faolla_attendance_events_append_only_v1()","hash":"66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a","result":"trigger","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_groups_v1","signature":"public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)","hash":"f228cd6ff752b0cd1a76fb57677f2b3fa0b4e0c4c923808e67c7627f17dcf363","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}]$config205_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $config205_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false}$config205_catalog190$::jsonb else $config205_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false}$config205_catalog185$::jsonb end),$config205_capture${"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false}$config205_capture$::jsonb);
 own_spec:=own_spec||jsonb_build_array($config205_admin${"name":"faolla_attendance_admin_v1","signature":"public.faolla_attendance_admin_v1(text,uuid,jsonb,jsonb,uuid)","hash":"67aa7c785dec53199a500517e05c0f58646e24f7bd5be0041a23679e32d19949","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, NULL::uuid","args":["p_site_id","p_auth_user_id","p_query","p_command","p_operation_id"],"searchPath":"search_path=pg_catalog","isRpc":true}$config205_admin$::jsonb||jsonb_build_object('hash','ee820da6387fb80163b3bc42ced96a4782782196a70a92ac51a8ddcbe31673ad'),$config205_guard${"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"5d2636f3b1eacfaf0dcb6f249e234bd641e50657df5a71e0cc9fbd7600427183","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;"}$config205_guard$::jsonb||jsonb_build_object('hash','0be4836fd81477e2aabd411f282f16909f3345e06cca96795e390a4b8d1115d7'));
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
 end loop;own_spec:=$config205_own$[{"name":"faolla_attendance_delegated_config_query_v1","signature":"public.faolla_attendance_delegated_config_query_v1(jsonb)","hash":"fb4d148327e71668675bf5261e5c6a71e3b9a8e4e533c967d714c352a36d6ecc","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_command_v1","signature":"public.faolla_attendance_delegated_config_command_v1(jsonb)","hash":"d36d3ddebe3c90571aa21bc88cfd647a460d1fd3ebd349f7479ba4a249a91f31","result":"void","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_hash_v1","signature":"public.faolla_attendance_delegated_config_hash_v1(text,uuid,uuid,jsonb)","hash":"d0c9240a02809c5ce208124ab0a766eef4c66e10eb23748df677a96a9213aa87","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","grant_id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_business_v1","signature":"public.faolla_attendance_delegated_config_business_v1(public.merchant_attendance_config_operations)","hash":"0539ecd5af7be0fe0ed27f9cc9a8a7083699ed8d512779ec5cd012cd09ddd99c","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_authorize_v1","signature":"public.faolla_attendance_delegated_config_authorize_v1(text,uuid,uuid,text,boolean)","hash":"fd0f48ce3106e129e4a8b9b6aeda2bdaf52f7dec915ac0eb61d36f5d5498963b","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","kind","p_created"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_operation_v1","signature":"public.faolla_attendance_delegated_config_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"71f291e2dde3a4519d763d62fe0724eafd914ba0c8ab9ba9aebc1274aeaa379e","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_receipt_v1","signature":"public.faolla_attendance_delegated_config_receipt_v1(text,uuid,uuid,uuid)","hash":"bfa0394c9286a8a92ca363841b43285641efd16907bf63cd6575879b3c0165dc","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_authority_v1","signature":"public.faolla_attendance_delegated_config_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"aea5553ddbaf4f313b29c79befc9079861461d390ca6b508eb55643c50f4af04","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_admin_core_v2","signature":"public.faolla_attendance_admin_core_v2(text,uuid,jsonb,jsonb,uuid,uuid)","hash":"61ab115817b3eedf7013ed2754da773740eccf66e2da64eb6a7df9bea31530f0","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site_id","p_auth_user_id","p_query","p_command","p_operation_id","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_config_v1","signature":"public.faolla_attendance_delegated_config_v1(jsonb,uuid,jsonb,boolean)","hash":"b34b78aee5358744636719b10a70e6dbe8ed185928c085fee922bbe0b0a8c0b6","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}]$config205_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
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
 end loop;foreach table_name in array array['merchant_attendance_config_operations'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or (acl.grantee<>expected_owner and not(acl.grantee=(select oid from pg_roles where rolname='service_role') and acl.privilege_type='SELECT' and not acl.is_grantable))))
   or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation) is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation)) then raise exception 'merchant_attendance_delegated_configuration_table_conflict';end if;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_configuration_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.groups_expected_settings') then to_regclass(ns||'.merchant_attendance_settings') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit) is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_configuration_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_configuration_index_conflict';end if;
  for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
   select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption) is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_configuration_index_conflict';end if;
  end loop;
  if not has_table_privilege('service_role',actual_table,'SELECT') or (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>2 then raise exception 'merchant_attendance_delegated_configuration_trigger_conflict';end if;
  for trigger_spec in select * from(values('merchant_attendance_config_no_rewrite',27),('merchant_attendance_config_no_truncate',34)) expected(name,kind) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=trigger_spec.name::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_configuration_trigger_conflict';end if;
  end loop;
  if exists(select 1 from pg_attribute actual left join pg_attrdef actual_default on actual_default.adrelid=actual.attrelid and actual_default.adnum=actual.attnum left join pg_attrdef expected_default on expected_default.adrelid=expected_table and expected_default.adnum=actual.attnum
   where actual.attrelid=actual_table and actual.attnum>0 and pg_get_expr(actual_default.adbin,actual_table) is distinct from pg_get_expr(expected_default.adbin,expected_table)) then raise exception 'merchant_attendance_delegated_configuration_default_conflict';end if;
 end loop;
 if (select count(*) from config205_forward_metadata)<>2 or exists(select 1 from config205_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_configuration_forward_metadata_changed';end if;
 end;$config205_postconditions$;
 drop table pg_temp.config205_forward_metadata,pg_temp.merchant_attendance_config_operations,pg_temp.groups_expected_settings;
--END GENERATED DELEGATED CONFIGURATION POSTCONDITIONS
insert into public.faolla_schema_migrations(version,name) values(202610080205,'merchant_attendance_delegated_configuration') on conflict(version) do nothing;
commit;
