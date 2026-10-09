--204 scoped group executor only. No new roles, owner impersonation, generic dispatcher,
--group/worker business table changes, or clock/payroll/schedule side effects.
begin;
set local lock_timeout='3s';
--BEGIN GENERATED DELEGATED GROUPS PREFLIGHT
do $groups204_prerequisites$ begin
 if to_regclass('public.faolla_schema_migrations') is null or not exists(select 1 from public.faolla_schema_migrations where version=202610030124 and name='merchant_attendance_groups') or not exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit') then raise exception 'merchant_attendance_delegated_groups_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name<>'merchant_attendance_delegated_groups') then raise exception 'merchant_attendance_delegated_groups_installation_conflict';end if;
 end;$groups204_prerequisites$;
 create temp table groups_expected_settings(merchant_id text primary key) on commit drop;
create temp table groups_expected_workers(id uuid,merchant_id text,primary key(merchant_id,id)) on commit drop;
create temp table merchant_attendance_groups (
  merchant_id text not null references pg_temp.groups_expected_settings(merchant_id),group_id uuid not null,
  revision bigint not null check(revision between 1 and 9007199254740990),name text not null,description text not null,active boolean not null,
  created_at timestamptz not null,updated_at timestamptz not null,actor_auth_user_id uuid not null,
  primary key(merchant_id,group_id),check(public.faolla_attendance_group_text_v1(name,1,80)),check(public.faolla_attendance_group_text_v1(description,0,200)),
  check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
) on commit drop;
create temp table merchant_attendance_group_operations (
  merchant_id text not null,operation_id uuid not null,group_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
  actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,group_id,revision),
  foreign key(merchant_id,group_id) references pg_temp.merchant_attendance_groups(merchant_id,group_id),
  check(jsonb_typeof(command)='object' and jsonb_typeof(snapshot)='object'),check(revision<>1 or operation_id=group_id)
) on commit drop;
create temp table merchant_attendance_group_assignments (
  merchant_id text not null,assignment_id uuid not null,group_id uuid not null,group_name text not null,worker_id uuid not null,
  worker_name text not null,worker_no text not null,employee_id uuid null,group_revision bigint not null,worker_version bigint not null,settings_version bigint not null,
  time_zone text not null check(public.faolla_attendance_valid_zone_v1(time_zone)),starts_on date not null,original_ends_on date null,ends_on date null,
  revision smallint not null,status text not null,created_at timestamptz not null,updated_at timestamptz not null,actor_auth_user_id uuid not null,
  primary key(merchant_id,assignment_id),foreign key(merchant_id,group_id) references pg_temp.merchant_attendance_groups(merchant_id,group_id),
  foreign key(merchant_id,worker_id) references pg_temp.groups_expected_workers(merchant_id,id),
  check(public.faolla_attendance_group_text_v1(group_name,1,80)),check(public.faolla_attendance_group_text_v1(worker_name,1,120)),check(public.faolla_attendance_group_text_v1(worker_no,1,40)),
  check(group_revision between 1 and 9007199254740990 and worker_version between 1 and 9007199254740990 and settings_version between 1 and 9007199254740990),
  check(starts_on between date '2000-01-01' and date '2100-12-31'),
  check(original_ends_on is null or original_ends_on between starts_on and date '2100-12-31'),check(ends_on is null or ends_on between starts_on and date '2100-12-31'),
  check((status='assigned' and revision=1 and ends_on is not distinct from original_ends_on)
    or (status='ended' and revision=2 and original_ends_on is null and ends_on is not null) or (status='cancelled' and revision in(2,3))),
  check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
) on commit drop;
create temp table merchant_attendance_group_assignment_operations (
  merchant_id text not null,operation_id uuid not null,assignment_id uuid not null,revision smallint not null,action text not null,
  actor_auth_user_id uuid not null,command jsonb not null,snapshot jsonb not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,assignment_id,revision),
  foreign key(merchant_id,assignment_id) references pg_temp.merchant_attendance_group_assignments(merchant_id,assignment_id),
  check((revision=1 and action='assign' and operation_id=assignment_id) or (revision=2 and action in('end','cancel')) or (revision=3 and action='cancel')),
  check(jsonb_typeof(command)='object' and jsonb_typeof(snapshot)='object')
) on commit drop;
alter table pg_temp.merchant_attendance_groups add constraint attendance_group_create_receipt_fk foreign key(merchant_id,group_id) references pg_temp.merchant_attendance_group_operations(merchant_id,operation_id) deferrable initially deferred;
alter table pg_temp.merchant_attendance_group_assignments add constraint attendance_group_assignment_receipt_fk foreign key(merchant_id,assignment_id) references pg_temp.merchant_attendance_group_assignment_operations(merchant_id,operation_id) deferrable initially deferred;
create index attendance_group_assignments_group_idx on pg_temp.merchant_attendance_group_assignments(merchant_id,group_id,assignment_id desc);
create index attendance_group_assignments_worker_idx on pg_temp.merchant_attendance_group_assignments(merchant_id,worker_id,assignment_id desc);
create index attendance_group_assignments_overlap_idx on pg_temp.merchant_attendance_group_assignments(merchant_id,worker_id,starts_on,ends_on) where status<>'cancelled';
 create temp table groups204_forward_metadata on commit drop as select proc.oid,to_jsonb(proc)-array['prosrc','proargdefaults'] metadata,pg_get_expr(proc.proargdefaults,0) default_expression from pg_proc proc where proc.oid in('public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)'::regprocedure,'public.faolla_attendance_management_insert_v1()'::regprocedure);
 do $groups204_preflight$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;own_spec jsonb;f regprocedure;meta record;table_name text;actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_groups_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name='merchant_attendance_delegated_groups');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 own_spec:=$groups_dependencies$[{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_command_v1","signature":"public.faolla_attendance_group_command_v1(jsonb)","hash":"579d7fa2487e8220179294ba36500b39e1a7e828024e8377ad69578da13d61c5","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_item_v1","signature":"public.faolla_attendance_group_item_v1(public.merchant_attendance_groups)","hash":"19231ed0c7b2ecf95e91a27dc92caaefcf6aa3b81b908b54b216574c882c6acf","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_receipt_v1","signature":"public.faolla_attendance_group_receipt_v1(public.merchant_attendance_group_operations,public.merchant_attendance_groups)","hash":"0e0897b6905d35b557c49667d1b039f7601e939bceef00d521206d760239ce4a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_checked_v1","signature":"public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)","hash":"045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_item_v1","signature":"public.faolla_attendance_group_assignment_item_v1(public.merchant_attendance_group_assignments)","hash":"475397dc4b3caf6ce0aab4058456d877e456b3744c3703f810cb80750fe67d82","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_detail_v1","signature":"public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)","hash":"aa65e21fdec5f8854145dfa71ee3d3e3e4eff34bca59a4cda18bf52fb6af0a82","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false}]$groups_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $groups_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","newHash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792"}$groups_catalog190$::jsonb else $groups_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","newHash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b"}$groups_catalog185$::jsonb end)||jsonb_build_object('hash',case when has190 then '3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792' else '876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b' end),$groups_capture${"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","newHash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907"}$groups_capture$::jsonb||jsonb_build_object('hash','c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907'));
 own_spec:=own_spec||jsonb_build_array($groups_legacy_meta${"name":"faolla_attendance_groups_v1","signature":"public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)","hash":"d130e4c2de2fef57ce6f18c15cc9ddb99b1d0fedb029b4e44872aee071bb9068","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}$groups_legacy_meta$::jsonb||jsonb_build_object('hash',case when installed then 'f228cd6ff752b0cd1a76fb57677f2b3fa0b4e0c4c923808e67c7627f17dcf363' else 'd130e4c2de2fef57ce6f18c15cc9ddb99b1d0fedb029b4e44872aee071bb9068' end),$groups_guard_meta${"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"46d4e3edf8aba8d474b0e6e19651adc80fb7466a94c785f70e6681dc13a55110","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;"}$groups_guard_meta$::jsonb||jsonb_build_object('hash',case when installed then '5d2636f3b1eacfaf0dcb6f249e234bd641e50657df5a71e0cc9fbd7600427183' else '46d4e3edf8aba8d474b0e6e19651adc80fb7466a94c785f70e6681dc13a55110' end));
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
 if (select count(*) from pg_proc proc where proc.pronamespace=(select oid from pg_namespace where nspname=ns) and (proc.proname like 'faolla_attendance_delegated_groups_%' or proc.proname='faolla_attendance_groups_core_v2'))<>(case when installed then 9 else 0 end) then raise exception 'merchant_attendance_delegated_groups_installation_conflict';end if;
 if installed then own_spec:=$groups_own$[{"name":"faolla_attendance_delegated_groups_query_v1","signature":"public.faolla_attendance_delegated_groups_query_v1(jsonb)","hash":"1582cd1b3e7376554ae99a331af78ef3c8bcef52bcb405d6b4d51be53e5d6385","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_action_v1","signature":"public.faolla_attendance_delegated_groups_action_v1(text)","hash":"121538a7299a56317c69726c183f58a06bf51532fca31662059a6841f6cf7348","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_hash_v1","signature":"public.faolla_attendance_delegated_groups_hash_v1(text,uuid,uuid,jsonb)","hash":"fc054e6e2080ac05dc99924f99e3a1d5bc6db2bf8ff5940471f23e20c4abf6aa","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","grant_id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_authorize_v1","signature":"public.faolla_attendance_delegated_groups_authorize_v1(text,uuid,uuid,text,boolean)","hash":"acdd8535915b321321a35e8bf0abd3590438aa082c9d57871424920896a68e12","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","legacy_action","p_created"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_operation_v1","signature":"public.faolla_attendance_delegated_groups_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"43e97bf502d38b369f27b66e25430fd81e50418763015869c03b9624a6ca61ef","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_receipt_v1","signature":"public.faolla_attendance_delegated_groups_receipt_v1(text,uuid,uuid,uuid)","hash":"4216281e292dda0e00f4e423b98dddc29bfdf567457bbed4656bd4b95716e75b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_authority_v1","signature":"public.faolla_attendance_delegated_groups_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"0d95d4f690fcf51faafd599670698eb34773ceed2826220a69247a4d036a00cf","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_groups_core_v2","signature":"public.faolla_attendance_groups_core_v2(jsonb,uuid,jsonb,boolean,uuid)","hash":"ca8c54338e01af8d00881718a0a9de6b7683816ed5f3a79f79363e062f3a23c7","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_v1","signature":"public.faolla_attendance_delegated_groups_v1(jsonb,uuid,jsonb,boolean)","hash":"8271da64d75e0657325cfe94222b8ec1b8cd847390a6d793f3af331b461de18d","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}]$groups_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
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
 end loop; end if;
 foreach table_name in array array['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation) is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation)) then raise exception 'merchant_attendance_delegated_groups_table_conflict';end if;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_groups_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.groups_expected_settings') then to_regclass(ns||'.merchant_attendance_settings') when to_regclass('pg_temp.groups_expected_workers') then to_regclass(ns||'.merchant_attendance_workers') when to_regclass('pg_temp.merchant_attendance_groups') then to_regclass(ns||'.merchant_attendance_groups') when to_regclass('pg_temp.merchant_attendance_group_operations') then to_regclass(ns||'.merchant_attendance_group_operations') when to_regclass('pg_temp.merchant_attendance_group_assignments') then to_regclass(ns||'.merchant_attendance_group_assignments') when to_regclass('pg_temp.merchant_attendance_group_assignment_operations') then to_regclass(ns||'.merchant_attendance_group_assignment_operations') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit) is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_groups_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_groups_index_conflict';end if;
  for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
   select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption) is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_groups_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>(case when table_name like '%operations' then 2 else 0 end) then raise exception 'merchant_attendance_delegated_groups_trigger_conflict';end if;
  if table_name like '%operations' then for trigger_spec in select * from(values('_immutable',27),('_no_truncate',34)) expected(suffix,kind) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(table_name||trigger_spec.suffix)::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_groups_trigger_conflict';end if;
  end loop;end if;
 end loop;
 end;$groups204_preflight$;
--END GENERATED DELEGATED GROUPS PREFLIGHT

create or replace function public.faolla_attendance_delegated_groups_query_v1(p jsonb)
returns void language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>4 or not(p ?& array['siteId','grantId','mode','operationId'])
  or jsonb_typeof(p->'siteId') is distinct from 'string' or coalesce(p->>'siteId','') !~ '^[0-9]{8}$'
  or jsonb_typeof(p->'grantId') is distinct from 'string' or coalesce(p->>'grantId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or p->>'mode' not in('context','recover') or jsonb_typeof(p->'mode') is distinct from 'string' then raise exception 'attendance_invalid_request';end if;
 if p->>'mode'='context' then
  if p->'operationId'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
 elsif jsonb_typeof(p->'operationId') is distinct from 'string' or coalesce(p->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'attendance_invalid_request';end if;
 if octet_length(convert_to(p::text,'UTF8'))>4096 then raise exception 'attendance_invalid_request';end if;
end;
$$;
create or replace function public.faolla_attendance_delegated_groups_action_v1(p text)
returns text language sql immutable set search_path=pg_catalog as $$
 select case p when 'save_group' then 'group_save' when 'assign' then 'group_assign' when 'end' then 'group_end' when 'cancel' then 'group_cancel' end;
$$;
create or replace function public.faolla_attendance_delegated_groups_hash_v1(site text,actor uuid,grant_id uuid,c jsonb)
returns text language plpgsql stable set search_path=pg_catalog as $$
declare t jsonb;
begin
 if actor is null or grant_id is null or site !~ '^[0-9]{8}$' or public.faolla_attendance_group_command_v1(c) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if c->>'action'='save_group' then t:=jsonb_build_array(c->'action',c->'operationId',c->'reason',c->'groupId',c->'expectedRevision',c->'name',c->'description',c->'active');
 elsif c->>'action'='assign' then t:=jsonb_build_array(c->'action',c->'operationId',c->'reason',c->'groupId',c->'workerId',c->'expectedGroupRevision',c->'expectedWorkerVersion',c->'expectedSettingsVersion',c->'timeZone',c->'startsOn',c->'endsOn');
 elsif c->>'action'='end' then t:=jsonb_build_array(c->'action',c->'operationId',c->'reason',c->'assignmentId',c->'expectedRevision',c->'endsOn');
 else t:=jsonb_build_array(c->'action',c->'operationId',c->'reason',c->'assignmentId',c->'expectedRevision');end if;
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-delegated-groups-command-v1',site,actor,grant_id,t));
end;
$$;
create or replace function public.faolla_attendance_delegated_groups_authorize_v1(site text,actor uuid,id uuid,legacy_action text,p_created boolean)
returns public.merchant_attendance_management_delegations language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;employee public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;stamp timestamptz;
begin
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=id for share;
 if actor is null or p_created is null or g.grant_id is null or g.delegate_auth_user_id is distinct from actor or g.delegated_action not in('group_save','group_assign','group_end','group_cancel')
  or legacy_action is not null and g.delegated_action is distinct from public.faolla_attendance_delegated_groups_action_v1(legacy_action) then raise exception 'attendance_access_denied';end if;
 if g.worker_id is not null then perform 1 from public.merchant_attendance_workers actual where actual.merchant_id=site and actual.id=g.worker_id for share;end if;
 if g.employee_id is not null then perform 1 from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.employee_id for share;end if;
 select * into employee from public.merchant_enterprise_employees actual where actual.merchant_id=site and actual.id=g.delegate_employee_id for share;
 select * into role_row from public.merchant_enterprise_roles actual where actual.merchant_id=site and actual.id=employee.role_id for share;stamp:=clock_timestamp();
 if not p_created then
  if public.faolla_attendance_management_current_v1(g,stamp) is distinct from true then raise exception 'attendance_access_denied';end if;
 else
  --Only a genuine group-create postimage replaces scope_context's ABSENT test.
  --All unchanged current grant gates are repeated, never weakened globally.
  if g.delegated_action<>'group_save' or g.scope->>'kind'<>'group' or g.scope->'create'<>'true'::jsonb
   or not(stamp>=g.valid_from and stamp<g.valid_until) or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.grant_id=g.grant_id)
   or not exists(select 1 from public.merchants actual where actual.id=site and actual.user_id=g.actor_auth_user_id)
   or not exists(select 1 from public.merchant_attendance_settings actual where actual.merchant_id=site and actual.enabled)
   or employee.auth_user_id is distinct from g.delegate_auth_user_id or employee.status is distinct from 'active' or role_row.status is distinct from 'active'
   or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true or not(role_row.permissions @> array['enterprise.view',g.capability])
   or coalesce((select epoch.generation from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=site and epoch.employee_id=g.delegate_employee_id),0)<>g.delegate_generation
   or exists(select 1 from public.merchant_attendance_account_epochs epoch where epoch.merchant_id=site and epoch.employee_id=g.delegate_employee_id and epoch.paused)
   or g.worker_id is not null or g.employee_id is not null or g.employee_auth_user_id is not null or g.employee_generation is not null then raise exception 'attendance_access_denied';end if;
 end if;return g;
end;
$$;
create or replace function public.faolla_attendance_delegated_groups_operation_v1(p public.merchant_attendance_management_delegation_operations,p_current boolean)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare g public.merchant_attendance_management_delegations%rowtype;go public.merchant_attendance_group_operations%rowtype;ao public.merchant_attendance_group_assignment_operations%rowtype;
 group_row public.merchant_attendance_groups%rowtype;assignment public.merchant_attendance_group_assignments%rowtype;c jsonb;snapshot jsonb;stamp timestamptz;reference_id uuid;revision_value bigint;created boolean;
begin
 select * into g from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.grant_id;
 select * into go from public.merchant_attendance_group_operations actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id;
 select * into ao from public.merchant_attendance_group_assignment_operations actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id;
 if p_current is null or g.grant_id is null or (go.operation_id is null)=(ao.operation_id is null) then raise exception 'attendance_delegated_groups_invalid';end if;
 if go.operation_id is not null then
  select * into group_row from public.merchant_attendance_groups actual where actual.merchant_id=p.merchant_id and actual.group_id=go.group_id;
  perform public.faolla_attendance_group_receipt_v1(go,group_row);c:=go.command;snapshot:=go.snapshot;stamp:=go.recorded_at;reference_id:=go.group_id;revision_value:=go.revision;
  if go.actor_auth_user_id is distinct from p.actor_auth_user_id or g.scope->>'kind'<>'group' or g.scope->>'groupId' is distinct from go.group_id::text
   or g.scope->'create' is distinct from to_jsonb(go.revision=1) then raise exception 'attendance_delegated_groups_invalid';end if;
  created:=go.revision=1;
 else
  select * into assignment from public.merchant_attendance_group_assignments actual where actual.merchant_id=p.merchant_id and actual.assignment_id=ao.assignment_id;
  perform public.faolla_attendance_group_assignment_detail_v1(assignment);c:=ao.command;snapshot:=ao.snapshot;stamp:=ao.recorded_at;reference_id:=ao.assignment_id;revision_value:=ao.revision;created:=false;
  if ao.actor_auth_user_id is distinct from p.actor_auth_user_id or g.scope->>'kind'<>'group_worker'
   or row(g.scope->>'groupId',g.worker_id,g.employee_id) is distinct from row(assignment.group_id::text,assignment.worker_id,assignment.employee_id)
   or (case when ao.action='assign' then g.scope->'assignmentId'<>'null'::jsonb else g.scope->>'assignmentId' is distinct from assignment.assignment_id::text end) then raise exception 'attendance_delegated_groups_invalid';end if;
 end if;
 if row(p.actor_auth_user_id,p.delegate_employee_id,p.delegate_generation,p.delegated_action,p.business_operation_id,p.business_reference_id,p.business_revision,p.recorded_at)
  is distinct from row(g.delegate_auth_user_id,g.delegate_employee_id,g.delegate_generation,public.faolla_attendance_delegated_groups_action_v1(c->>'action'),p.operation_id,reference_id,revision_value,stamp)
  or g.delegated_action is distinct from p.delegated_action or p.command_fingerprint is distinct from public.faolla_attendance_delegated_groups_hash_v1(p.merchant_id,p.actor_auth_user_id,g.grant_id,c)
  or p.business_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(snapshot)
  or exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=p.merchant_id and actual.grant_id=p.operation_id)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=p.merchant_id and actual.operation_id=p.operation_id) then raise exception 'attendance_delegated_groups_invalid';end if;
 if p_current then
  perform public.faolla_attendance_delegated_groups_authorize_v1(p.merchant_id,p.actor_auth_user_id,g.grant_id,c->>'action',created);
  if created and (go.operation_id<>go.group_id or group_row.actor_auth_user_id<>p.actor_auth_user_id or group_row.created_at<>stamp
   or (c->>'expectedRevision')::bigint<>0 or go.revision<>1 or group_row.revision<>1 or snapshot is distinct from public.faolla_attendance_group_item_v1(group_row)) then raise exception 'attendance_delegated_groups_invalid';end if;
 end if;return jsonb_build_object('command',c,'item',snapshot);
end;
$$;
create or replace function public.faolla_attendance_delegated_groups_receipt_v1(site text,op uuid,actor uuid,id uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare saved public.merchant_attendance_management_delegation_operations%rowtype;
begin
 select * into saved from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op and actual.actor_auth_user_id=actor and actual.grant_id=id and actual.delegated_action in('group_save','group_assign','group_end','group_cancel');
 if saved.operation_id is null then return null;end if;
 perform public.faolla_attendance_delegated_groups_operation_v1(saved,false);
 return jsonb_build_object('operationId',op,'actorId',actor,'grantId',id,'action',saved.delegated_action,'referenceId',saved.business_reference_id,'revision',saved.business_revision,
  'commandFingerprint',saved.command_fingerprint,'businessFingerprint',saved.business_fingerprint,'recordedAt',to_char(saved.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$$;
create or replace function public.faolla_attendance_delegated_groups_authority_v1(p public.merchant_attendance_management_delegation_operations)
returns void language plpgsql set search_path=pg_catalog as $$
begin perform public.faolla_attendance_delegated_groups_operation_v1(p,true);end;
$$;

--BEGIN GENERATED DELEGATED GROUPS CORE
create or replace function public.faolla_attendance_groups_core_v2(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_allow_write boolean,p_grant_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare site text;view_name text;gid uuid;wid uuid;aid uuid;op uuid;cursor_id uuid;on_day date;k text;action_name text;
  s public.merchant_attendance_settings%rowtype;g public.merchant_attendance_groups%rowtype;w public.merchant_attendance_workers%rowtype;
  target public.merchant_attendance_group_assignments%rowtype;gc public.merchant_attendance_groups%rowtype;ac public.merchant_attendance_group_assignments%rowtype;
  go public.merchant_attendance_group_operations%rowtype;ao public.merchant_attendance_group_assignment_operations%rowtype;
  group_item jsonb;worker_item jsonb;detail jsonb;receipt jsonb;items jsonb:='[]';next_cursor uuid;rows_seen integer:=0;result jsonb;stamp timestamptz;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>8 or not(p_query ?& array['siteId','view','groupId','workerId','onDate','assignmentId','operationId','cursorId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'view')<>'string' or coalesce(p_query->>'view','') not in('groups','members','context') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';view_name:=p_query->>'view';
  foreach k in array array['groupId','workerId','assignmentId','operationId','cursorId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'onDate'<>'null'::jsonb and (jsonb_typeof(p_query->'onDate')<>'string' or not public.faolla_attendance_group_date_v1(p_query->>'onDate')) then raise exception 'attendance_invalid_request';end if;
  gid:=(p_query->>'groupId')::uuid;wid:=(p_query->>'workerId')::uuid;aid:=(p_query->>'assignmentId')::uuid;op:=(p_query->>'operationId')::uuid;cursor_id:=(p_query->>'cursorId')::uuid;on_day:=(p_query->>'onDate')::date;
  if view_name='groups' and (gid is not null or wid is not null or aid is not null or op is not null or on_day is not null)
    or view_name='members' and (gid is null and wid is null or aid is not null or op is not null)
    or view_name='context' and (on_day is not null or cursor_id is not null or aid is not null and (gid is null or wid is null)) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if view_name<>'context' or op is not null or not public.faolla_attendance_group_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
    if action_name='save_group' then
      if wid is not null or aid is not null or (p_command->'expectedRevision'='0'::jsonb and gid is not null)
        or (p_command->'expectedRevision'<>'0'::jsonb and gid is distinct from (p_command->>'groupId')::uuid) then raise exception 'attendance_invalid_request';end if;
    elsif action_name='assign' then
      if gid is distinct from (p_command->>'groupId')::uuid or wid is distinct from (p_command->>'workerId')::uuid or aid is not null then raise exception 'attendance_invalid_request';end if;
    elsif gid is null or wid is null or aid is distinct from (p_command->>'assignmentId')::uuid then raise exception 'attendance_invalid_request';end if;
  end if;

  if p_grant_id is null then
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  else
    if view_name<>'context' or p_query->'operationId'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
    perform public.faolla_attendance_delegated_groups_authorize_v1(site,p_auth_user_id,p_grant_id,action_name,false);
  end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if s.version>9007199254740990 then raise exception 'attendance_version_conflict';end if;
  -- One operation namespace across both ledgers, serialized by the settings lock.
  if op is not null then
    select * into go from public.merchant_attendance_group_operations where merchant_id=site and operation_id=op;
    select * into ao from public.merchant_attendance_group_assignment_operations where merchant_id=site and operation_id=op;
    if go.operation_id is not null and ao.operation_id is not null then raise exception 'attendance_group_invalid';end if;
    if go.operation_id is not null then
      if go.actor_auth_user_id<>p_auth_user_id then
        if p_command is not null then raise exception 'attendance_operation_conflict';end if;go:=null;
      else
        if p_command is not null and go.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
        if wid is not null or aid is not null or gid is not null and gid<>go.group_id
          or gid is null and go.revision<>1 then raise exception 'attendance_group_not_found';end if;
        gid:=go.group_id;
      end if;
    elsif ao.operation_id is not null then
      if ao.actor_auth_user_id<>p_auth_user_id then
        if p_command is not null then raise exception 'attendance_operation_conflict';end if;ao:=null;
      else
        if p_command is not null and ao.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
        if gid is null or wid is null or aid is not null and aid<>ao.assignment_id then raise exception 'attendance_group_not_found';end if;
        aid:=ao.assignment_id;
      end if;
    end if;
  end if;
  if gid is not null then
    select * into g from public.merchant_attendance_groups where merchant_id=site and group_id=gid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    group_item:=public.faolla_attendance_group_checked_v1(g);
  end if;
  if wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    if w.version>9007199254740990 then raise exception 'attendance_version_conflict';end if;
    if not public.faolla_attendance_group_text_v1(w.display_name,1,120) or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) then raise exception 'attendance_group_invalid';end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,'version',w.version,'active',w.active);
  end if;
  if aid is not null then
    select * into target from public.merchant_attendance_group_assignments where merchant_id=site and assignment_id=aid;
    if target.assignment_id is null or target.group_id is distinct from gid or target.worker_id is distinct from wid then raise exception 'attendance_group_not_found';end if;
    detail:=public.faolla_attendance_group_assignment_detail_v1(target);
  end if;
  if go.operation_id is not null then receipt:=public.faolla_attendance_group_receipt_v1(go,g);
  elsif ao.operation_id is not null then receipt:=jsonb_build_object('command',ao.command,'item',ao.snapshot);end if;

  -- Current ownership always precedes replay; current activity, pause and CAS do not invalidate a confirmed original command.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    stamp:=clock_timestamp();
    if action_name='save_group' then
      if p_command->'expectedRevision'='0'::jsonb then
        if exists(select 1 from public.merchant_attendance_groups where merchant_id=site and group_id=(p_command->>'groupId')::uuid) then raise exception 'attendance_operation_conflict';end if;
        insert into public.merchant_attendance_groups(merchant_id,group_id,revision,name,description,active,created_at,updated_at,actor_auth_user_id)
          values(site,(p_command->>'groupId')::uuid,1,p_command->>'name',p_command->>'description',(p_command->>'active')::boolean,stamp,stamp,p_auth_user_id) returning * into g;
      else
        if g.revision<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
        update public.merchant_attendance_groups set revision=revision+1,name=p_command->>'name',description=p_command->>'description',active=(p_command->>'active')::boolean,updated_at=stamp
          where merchant_id=site and group_id=gid returning * into g;
      end if;
      group_item:=public.faolla_attendance_group_item_v1(g);
      insert into public.merchant_attendance_group_operations(merchant_id,operation_id,group_id,revision,actor_auth_user_id,command,snapshot,recorded_at)
        values(site,op,g.group_id,g.revision,p_auth_user_id,p_command,group_item,stamp) returning * into go;
      receipt:=public.faolla_attendance_group_receipt_v1(go,g);
    else
      if action_name='assign' then
        if not g.active then raise exception 'attendance_group_inactive';end if;
        if not w.active then raise exception 'attendance_group_worker_inactive';end if;
        if (p_command->>'expectedGroupRevision')::bigint<>g.revision or (p_command->>'expectedWorkerVersion')::bigint<>w.version
          or (p_command->>'expectedSettingsVersion')::bigint<>s.version or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
        if exists(select 1 from public.merchant_attendance_group_assignments x where x.merchant_id=site and x.worker_id=wid and x.status<>'cancelled'
          and (x.ends_on is null or x.ends_on>=(p_command->>'startsOn')::date)
          and (p_command->'endsOn'='null'::jsonb or x.starts_on<=(p_command->>'endsOn')::date)) then raise exception 'attendance_group_overlap';end if;
        insert into public.merchant_attendance_group_assignments(merchant_id,assignment_id,group_id,group_name,worker_id,worker_name,worker_no,employee_id,
          group_revision,worker_version,settings_version,time_zone,starts_on,original_ends_on,ends_on,revision,status,created_at,updated_at,actor_auth_user_id)
          values(site,op,gid,g.name,wid,w.display_name,w.worker_no,w.employee_id,g.revision,w.version,s.version,s.time_zone,
            (p_command->>'startsOn')::date,(p_command->>'endsOn')::date,(p_command->>'endsOn')::date,1,'assigned',stamp,stamp,p_auth_user_id) returning * into target;
      else
        if target.status='cancelled' or action_name='end' and (target.status<>'assigned' or target.ends_on is not null) then raise exception 'attendance_group_closed';end if;
        if target.revision<>(p_command->>'expectedRevision')::integer then raise exception 'attendance_version_conflict';end if;
        if action_name='end' and ((p_command->>'endsOn')::date<target.starts_on or not public.faolla_attendance_group_date_v1(p_command->>'endsOn',target.time_zone)) then raise exception 'attendance_invalid_request';end if;
        update public.merchant_attendance_group_assignments set revision=revision+1,status=case when action_name='end' then 'ended' else 'cancelled' end,
          ends_on=case when action_name='end' then (p_command->>'endsOn')::date else ends_on end,updated_at=stamp where merchant_id=site and assignment_id=aid returning * into target;
      end if;
      insert into public.merchant_attendance_group_assignment_operations(merchant_id,operation_id,assignment_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
        values(site,op,target.assignment_id,target.revision,action_name,p_auth_user_id,p_command,public.faolla_attendance_group_assignment_item_v1(target),stamp) returning * into ao;
      detail:=public.faolla_attendance_group_assignment_detail_v1(target);receipt:=jsonb_build_object('command',ao.command,'item',ao.snapshot);
    end if;
  end if;
  if view_name='groups' then
    for gc in select * from public.merchant_attendance_groups where merchant_id=site and (cursor_id is null or group_id<cursor_id) order by group_id desc limit 26 loop
      rows_seen:=rows_seen+1;exit when rows_seen=26;
      items:=items||jsonb_build_array(public.faolla_attendance_group_checked_v1(gc));next_cursor:=gc.group_id;
    end loop;
  elsif view_name='members' then
    for ac in select * from public.merchant_attendance_group_assignments x where x.merchant_id=site and (gid is null or x.group_id=gid) and (wid is null or x.worker_id=wid)
      and (on_day is null or x.starts_on<=on_day and (x.ends_on is null or x.ends_on>=on_day)) and (cursor_id is null or x.assignment_id<cursor_id) order by x.assignment_id desc limit 26 loop
      rows_seen:=rows_seen+1;exit when rows_seen=26;
      perform public.faolla_attendance_group_assignment_detail_v1(ac);items:=items||jsonb_build_array(public.faolla_attendance_group_assignment_item_v1(ac));next_cursor:=ac.assignment_id;
    end loop;
  end if;
  result:=jsonb_build_object('protocol','groups-v1','siteId',site,'actorId',p_auth_user_id,'settingsVersion',s.version,'timeZone',s.time_zone,'view',view_name,
    'group',group_item,'worker',worker_item,'items',items,'nextCursor',case when rows_seen=26 then next_cursor else null end,'detail',detail,'receipt',receipt);
  if octet_length(result::text)>131072 then raise exception 'attendance_group_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
--END GENERATED DELEGATED GROUPS CORE

create or replace function public.faolla_attendance_delegated_groups_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;id uuid;op uuid;fp text;receipt jsonb;result jsonb;q jsonb;legacy jsonb;g public.merchant_attendance_management_delegations%rowtype;entry public.merchant_attendance_management_delegation_operations%rowtype;item jsonb;reference_id uuid;
begin
 perform public.faolla_attendance_delegated_groups_query_v1(p_query);site:=p_query->>'siteId';id:=(p_query->>'grantId')::uuid;
 if p_auth_user_id is null or p_allow_write is null then raise exception 'attendance_invalid_request';end if;
 if p_query->>'mode'='recover' then
  if p_command is not null then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
 else
  if p_command is not null then fp:=public.faolla_attendance_delegated_groups_hash_v1(site,p_auth_user_id,id,p_command);op:=(p_command->>'operationId')::uuid;end if;
 end if;
 receipt:=public.faolla_attendance_delegated_groups_receipt_v1(site,op,p_auth_user_id,id);
 if p_query->>'mode'='recover' or receipt is not null then
  if receipt is not null and p_command is not null and receipt->>'commandFingerprint' is distinct from fp then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('protocol','attendance-delegated-groups-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 perform 1 from public.merchants actual where actual.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings actual where actual.merchant_id=site for update;if not found then raise exception 'attendance_settings_required';end if;
 --Recheck an operation that may have committed during settings serialization.
 receipt:=public.faolla_attendance_delegated_groups_receipt_v1(site,op,p_auth_user_id,id);
 if receipt is not null then
  if receipt->>'commandFingerprint' is distinct from fp then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('protocol','attendance-delegated-groups-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 if op is not null and (exists(select 1 from public.merchant_attendance_group_operations actual where actual.merchant_id=site and actual.operation_id=op)
  or exists(select 1 from public.merchant_attendance_group_assignment_operations actual where actual.merchant_id=site and actual.operation_id=op)
  or exists(select 1 from public.merchant_attendance_management_delegations actual where actual.merchant_id=site and actual.grant_id=op)
  or exists(select 1 from public.merchant_attendance_management_delegation_revocations actual where actual.merchant_id=site and actual.operation_id=op)
  or exists(select 1 from public.merchant_attendance_management_delegation_operations actual where actual.merchant_id=site and actual.operation_id=op)) then raise exception 'attendance_operation_conflict';end if;
 if p_command is not null and not p_allow_write then raise exception 'attendance_delegated_groups_disabled';end if;
 g:=public.faolla_attendance_delegated_groups_authorize_v1(site,p_auth_user_id,id,p_command->>'action',false);
 if p_command is not null and g.delegated_action='group_save' and (p_command->>'groupId' is distinct from g.scope->>'groupId' or to_jsonb((p_command->>'expectedRevision')::bigint=0) is distinct from g.scope->'create') then raise exception 'attendance_access_denied';end if;
 q:=jsonb_build_object('siteId',site,'view','context','groupId',case when g.scope->>'kind'='group' and g.scope->'create'='true'::jsonb then null else g.scope->'groupId' end,
  'workerId',case when g.scope->>'kind'='group_worker' then g.scope->'workerId' else null end,'onDate',null,'assignmentId',case when g.scope->>'kind'='group_worker' then g.scope->'assignmentId' else null end,'operationId',null,'cursorId',null);
 legacy:=public.faolla_attendance_groups_core_v2(q,p_auth_user_id,p_command,p_allow_write,id);
 if p_command is not null then
  item:=legacy->'receipt'->'item';reference_id:=coalesce((item->>'groupId')::uuid,(item->>'assignmentId')::uuid);
  if p_command->>'action'<>'save_group' then reference_id:=(item->>'assignmentId')::uuid;end if;
  insert into public.merchant_attendance_management_delegation_operations(merchant_id,operation_id,grant_id,actor_auth_user_id,delegate_employee_id,delegate_generation,delegated_action,business_operation_id,business_reference_id,business_revision,business_fingerprint,command_fingerprint,recorded_at)
   values(site,op,id,p_auth_user_id,g.delegate_employee_id,g.delegate_generation,g.delegated_action,op,reference_id,(item->>'revision')::bigint,public.faolla_attendance_operational_rule_hash_v1(item),fp,(item->>'updatedAt')::timestamptz);
  receipt:=public.faolla_attendance_delegated_groups_receipt_v1(site,op,p_auth_user_id,id);
  return jsonb_build_object('protocol','attendance-delegated-groups-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'kind','receipt','receipt',receipt);
 end if;
 result:=jsonb_build_object('protocol','attendance-delegated-groups-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'kind','context','grantId',id,'action',g.delegated_action,'scope',g.scope,'context',legacy);
 if octet_length(convert_to(result::text,'UTF8'))>131072 then raise exception 'attendance_delegated_groups_invalid';end if;return result;
end;
$$;
--BEGIN GENERATED DELEGATED GROUPS FORWARD
do $groups204_forward_0$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name='merchant_attendance_delegated_groups') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)'::regprocedure;
 if old_body is distinct from $groups204_old_0$
declare site text;view_name text;gid uuid;wid uuid;aid uuid;op uuid;cursor_id uuid;on_day date;k text;action_name text;
  s public.merchant_attendance_settings%rowtype;g public.merchant_attendance_groups%rowtype;w public.merchant_attendance_workers%rowtype;
  target public.merchant_attendance_group_assignments%rowtype;gc public.merchant_attendance_groups%rowtype;ac public.merchant_attendance_group_assignments%rowtype;
  go public.merchant_attendance_group_operations%rowtype;ao public.merchant_attendance_group_assignment_operations%rowtype;
  group_item jsonb;worker_item jsonb;detail jsonb;receipt jsonb;items jsonb:='[]';next_cursor uuid;rows_seen integer:=0;result jsonb;stamp timestamptz;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or jsonb_typeof(p_query)<>'object' then raise exception 'attendance_invalid_request';end if;
  if (select count(*) from jsonb_object_keys(p_query))<>8 or not(p_query ?& array['siteId','view','groupId','workerId','onDate','assignmentId','operationId','cursorId'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'view')<>'string' or coalesce(p_query->>'view','') not in('groups','members','context') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';view_name:=p_query->>'view';
  foreach k in array array['groupId','workerId','assignmentId','operationId','cursorId'] loop
    if p_query->k<>'null'::jsonb and (jsonb_typeof(p_query->k)<>'string' or coalesce(p_query->>k,'') !~ uuid_pattern) then raise exception 'attendance_invalid_request';end if;
  end loop;
  if p_query->'onDate'<>'null'::jsonb and (jsonb_typeof(p_query->'onDate')<>'string' or not public.faolla_attendance_group_date_v1(p_query->>'onDate')) then raise exception 'attendance_invalid_request';end if;
  gid:=(p_query->>'groupId')::uuid;wid:=(p_query->>'workerId')::uuid;aid:=(p_query->>'assignmentId')::uuid;op:=(p_query->>'operationId')::uuid;cursor_id:=(p_query->>'cursorId')::uuid;on_day:=(p_query->>'onDate')::date;
  if view_name='groups' and (gid is not null or wid is not null or aid is not null or op is not null or on_day is not null)
    or view_name='members' and (gid is null and wid is null or aid is not null or op is not null)
    or view_name='context' and (on_day is not null or cursor_id is not null or aid is not null and (gid is null or wid is null)) then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if view_name<>'context' or op is not null or not public.faolla_attendance_group_command_v1(p_command) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
    if action_name='save_group' then
      if wid is not null or aid is not null or (p_command->'expectedRevision'='0'::jsonb and gid is not null)
        or (p_command->'expectedRevision'<>'0'::jsonb and gid is distinct from (p_command->>'groupId')::uuid) then raise exception 'attendance_invalid_request';end if;
    elsif action_name='assign' then
      if gid is distinct from (p_command->>'groupId')::uuid or wid is distinct from (p_command->>'workerId')::uuid or aid is not null then raise exception 'attendance_invalid_request';end if;
    elsif gid is null or wid is null or aid is distinct from (p_command->>'assignmentId')::uuid then raise exception 'attendance_invalid_request';end if;
  end if;

  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  if s.version>9007199254740990 then raise exception 'attendance_version_conflict';end if;
  -- One operation namespace across both ledgers, serialized by the settings lock.
  if op is not null then
    select * into go from public.merchant_attendance_group_operations where merchant_id=site and operation_id=op;
    select * into ao from public.merchant_attendance_group_assignment_operations where merchant_id=site and operation_id=op;
    if go.operation_id is not null and ao.operation_id is not null then raise exception 'attendance_group_invalid';end if;
    if go.operation_id is not null then
      if go.actor_auth_user_id<>p_auth_user_id then
        if p_command is not null then raise exception 'attendance_operation_conflict';end if;go:=null;
      else
        if p_command is not null and go.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
        if wid is not null or aid is not null or gid is not null and gid<>go.group_id
          or gid is null and go.revision<>1 then raise exception 'attendance_group_not_found';end if;
        gid:=go.group_id;
      end if;
    elsif ao.operation_id is not null then
      if ao.actor_auth_user_id<>p_auth_user_id then
        if p_command is not null then raise exception 'attendance_operation_conflict';end if;ao:=null;
      else
        if p_command is not null and ao.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
        if gid is null or wid is null or aid is not null and aid<>ao.assignment_id then raise exception 'attendance_group_not_found';end if;
        aid:=ao.assignment_id;
      end if;
    end if;
  end if;
  if gid is not null then
    select * into g from public.merchant_attendance_groups where merchant_id=site and group_id=gid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    group_item:=public.faolla_attendance_group_checked_v1(g);
  end if;
  if wid is not null then
    select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
    if not found then raise exception 'attendance_group_not_found';end if;
    if w.version>9007199254740990 then raise exception 'attendance_version_conflict';end if;
    if not public.faolla_attendance_group_text_v1(w.display_name,1,120) or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) then raise exception 'attendance_group_invalid';end if;
    worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,'version',w.version,'active',w.active);
  end if;
  if aid is not null then
    select * into target from public.merchant_attendance_group_assignments where merchant_id=site and assignment_id=aid;
    if target.assignment_id is null or target.group_id is distinct from gid or target.worker_id is distinct from wid then raise exception 'attendance_group_not_found';end if;
    detail:=public.faolla_attendance_group_assignment_detail_v1(target);
  end if;
  if go.operation_id is not null then receipt:=public.faolla_attendance_group_receipt_v1(go,g);
  elsif ao.operation_id is not null then receipt:=jsonb_build_object('command',ao.command,'item',ao.snapshot);end if;

  -- Current ownership always precedes replay; current activity, pause and CAS do not invalidate a confirmed original command.
  if p_command is not null and receipt is null then
    if not p_allow_write then raise exception 'attendance_platform_paused';end if;
    stamp:=clock_timestamp();
    if action_name='save_group' then
      if p_command->'expectedRevision'='0'::jsonb then
        if exists(select 1 from public.merchant_attendance_groups where merchant_id=site and group_id=(p_command->>'groupId')::uuid) then raise exception 'attendance_operation_conflict';end if;
        insert into public.merchant_attendance_groups(merchant_id,group_id,revision,name,description,active,created_at,updated_at,actor_auth_user_id)
          values(site,(p_command->>'groupId')::uuid,1,p_command->>'name',p_command->>'description',(p_command->>'active')::boolean,stamp,stamp,p_auth_user_id) returning * into g;
      else
        if g.revision<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict';end if;
        update public.merchant_attendance_groups set revision=revision+1,name=p_command->>'name',description=p_command->>'description',active=(p_command->>'active')::boolean,updated_at=stamp
          where merchant_id=site and group_id=gid returning * into g;
      end if;
      group_item:=public.faolla_attendance_group_item_v1(g);
      insert into public.merchant_attendance_group_operations(merchant_id,operation_id,group_id,revision,actor_auth_user_id,command,snapshot,recorded_at)
        values(site,op,g.group_id,g.revision,p_auth_user_id,p_command,group_item,stamp) returning * into go;
      receipt:=public.faolla_attendance_group_receipt_v1(go,g);
    else
      if action_name='assign' then
        if not g.active then raise exception 'attendance_group_inactive';end if;
        if not w.active then raise exception 'attendance_group_worker_inactive';end if;
        if (p_command->>'expectedGroupRevision')::bigint<>g.revision or (p_command->>'expectedWorkerVersion')::bigint<>w.version
          or (p_command->>'expectedSettingsVersion')::bigint<>s.version or p_command->>'timeZone'<>s.time_zone then raise exception 'attendance_version_conflict';end if;
        if exists(select 1 from public.merchant_attendance_group_assignments x where x.merchant_id=site and x.worker_id=wid and x.status<>'cancelled'
          and (x.ends_on is null or x.ends_on>=(p_command->>'startsOn')::date)
          and (p_command->'endsOn'='null'::jsonb or x.starts_on<=(p_command->>'endsOn')::date)) then raise exception 'attendance_group_overlap';end if;
        insert into public.merchant_attendance_group_assignments(merchant_id,assignment_id,group_id,group_name,worker_id,worker_name,worker_no,employee_id,
          group_revision,worker_version,settings_version,time_zone,starts_on,original_ends_on,ends_on,revision,status,created_at,updated_at,actor_auth_user_id)
          values(site,op,gid,g.name,wid,w.display_name,w.worker_no,w.employee_id,g.revision,w.version,s.version,s.time_zone,
            (p_command->>'startsOn')::date,(p_command->>'endsOn')::date,(p_command->>'endsOn')::date,1,'assigned',stamp,stamp,p_auth_user_id) returning * into target;
      else
        if target.status='cancelled' or action_name='end' and (target.status<>'assigned' or target.ends_on is not null) then raise exception 'attendance_group_closed';end if;
        if target.revision<>(p_command->>'expectedRevision')::integer then raise exception 'attendance_version_conflict';end if;
        if action_name='end' and ((p_command->>'endsOn')::date<target.starts_on or not public.faolla_attendance_group_date_v1(p_command->>'endsOn',target.time_zone)) then raise exception 'attendance_invalid_request';end if;
        update public.merchant_attendance_group_assignments set revision=revision+1,status=case when action_name='end' then 'ended' else 'cancelled' end,
          ends_on=case when action_name='end' then (p_command->>'endsOn')::date else ends_on end,updated_at=stamp where merchant_id=site and assignment_id=aid returning * into target;
      end if;
      insert into public.merchant_attendance_group_assignment_operations(merchant_id,operation_id,assignment_id,revision,action,actor_auth_user_id,command,snapshot,recorded_at)
        values(site,op,target.assignment_id,target.revision,action_name,p_auth_user_id,p_command,public.faolla_attendance_group_assignment_item_v1(target),stamp) returning * into ao;
      detail:=public.faolla_attendance_group_assignment_detail_v1(target);receipt:=jsonb_build_object('command',ao.command,'item',ao.snapshot);
    end if;
  end if;
  if view_name='groups' then
    for gc in select * from public.merchant_attendance_groups where merchant_id=site and (cursor_id is null or group_id<cursor_id) order by group_id desc limit 26 loop
      rows_seen:=rows_seen+1;exit when rows_seen=26;
      items:=items||jsonb_build_array(public.faolla_attendance_group_checked_v1(gc));next_cursor:=gc.group_id;
    end loop;
  elsif view_name='members' then
    for ac in select * from public.merchant_attendance_group_assignments x where x.merchant_id=site and (gid is null or x.group_id=gid) and (wid is null or x.worker_id=wid)
      and (on_day is null or x.starts_on<=on_day and (x.ends_on is null or x.ends_on>=on_day)) and (cursor_id is null or x.assignment_id<cursor_id) order by x.assignment_id desc limit 26 loop
      rows_seen:=rows_seen+1;exit when rows_seen=26;
      perform public.faolla_attendance_group_assignment_detail_v1(ac);items:=items||jsonb_build_array(public.faolla_attendance_group_assignment_item_v1(ac));next_cursor:=ac.assignment_id;
    end loop;
  end if;
  result:=jsonb_build_object('protocol','groups-v1','siteId',site,'actorId',p_auth_user_id,'settingsVersion',s.version,'timeZone',s.time_zone,'view',view_name,
    'group',group_item,'worker',worker_item,'items',items,'nextCursor',case when rows_seen=26 then next_cursor else null end,'detail',detail,'receipt',receipt);
  if octet_length(result::text)>131072 then raise exception 'attendance_group_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$groups204_old_0$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_groups_forward_drift';end if;
 execute replace(definition,old_body,$groups204_new_0$
begin
 return public.faolla_attendance_groups_core_v2(p_query,p_auth_user_id,p_command,p_allow_write,null);
end;
$groups204_new_0$);
 end;$groups204_forward_0$;
do $groups204_forward_1$ declare old_body text;definition text;begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name='merchant_attendance_delegated_groups') then return;end if;
 select replace(proc.prosrc,E'\r\n',E'\n'),pg_get_functiondef(proc.oid) into old_body,definition from pg_proc proc where proc.oid='public.faolla_attendance_management_insert_v1()'::regprocedure;
 if old_body is distinct from $groups204_old_1$
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
$groups204_old_1$ or position(old_body in definition)=0 then raise exception 'merchant_attendance_delegated_groups_forward_drift';end if;
 execute replace(definition,old_body,$groups204_new_1$
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
$groups204_new_1$);
 end;$groups204_forward_1$;
--END GENERATED DELEGATED GROUPS FORWARD
--BEGIN GENERATED DELEGATED GROUPS POSTCONDITIONS
revoke all on function public.faolla_attendance_delegated_groups_query_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_groups_action_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_groups_hash_v1(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_groups_authorize_v1(text,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_groups_operation_v1(public.merchant_attendance_management_delegation_operations,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_groups_receipt_v1(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_groups_authority_v1(public.merchant_attendance_management_delegation_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_groups_core_v2(jsonb,uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_delegated_groups_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_delegated_groups_v1(jsonb,uuid,jsonb,boolean) to service_role;
 do $groups204_postconditions$ declare ns text;expected_owner oid;installed boolean;has190 boolean;spec jsonb;own_spec jsonb;f regprocedure;meta record;table_name text;actual_table regclass;expected_table regclass;foreign_table regclass;constraint_spec record;actual_constraint record;index_spec record;actual_index record;trigger_spec record; begin select namespace.nspname,catalog_table.relowner into ns,expected_owner from pg_class catalog_table join pg_namespace namespace on namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_settings'::regclass;
 if expected_owner is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_delegated_groups_owner_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080204 and name='merchant_attendance_delegated_groups');
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 own_spec:=$groups_dependencies$[{"name":"faolla_attendance_group_text_v1","signature":"public.faolla_attendance_group_text_v1(text,integer,integer)","hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","lo","hi"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_date_v1","signature":"public.faolla_attendance_group_date_v1(text,text)","hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":1,"defaultExpression":"NULL::text","args":["p","z"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_command_v1","signature":"public.faolla_attendance_group_command_v1(jsonb)","hash":"579d7fa2487e8220179294ba36500b39e1a7e828024e8377ad69578da13d61c5","result":"boolean","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_item_v1","signature":"public.faolla_attendance_group_item_v1(public.merchant_attendance_groups)","hash":"19231ed0c7b2ecf95e91a27dc92caaefcf6aa3b81b908b54b216574c882c6acf","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_receipt_v1","signature":"public.faolla_attendance_group_receipt_v1(public.merchant_attendance_group_operations,public.merchant_attendance_groups)","hash":"0e0897b6905d35b557c49667d1b039f7601e939bceef00d521206d760239ce4a","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_checked_v1","signature":"public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)","hash":"045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_item_v1","signature":"public.faolla_attendance_group_assignment_item_v1(public.merchant_attendance_group_assignments)","hash":"475397dc4b3caf6ce0aab4058456d877e456b3744c3703f810cb80750fe67d82","result":"jsonb","language":"sql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_group_assignment_detail_v1","signature":"public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)","hash":"aa65e21fdec5f8854145dfa71ee3d3e3e4eff34bca59a4cda18bf52fb6af0a82","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scalar_v1","signature":"public.faolla_attendance_management_scalar_v1(jsonb,text)","hash":"1f1afb8930a212c34937f2cfe8b843e9991d9827440c7589afb93a4f2e62ac06","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","k"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_array_v1","signature":"public.faolla_attendance_management_array_v1(jsonb,text[],integer,integer)","hash":"01b5e60f56433b2ec408d82c25bc9aec85187175e52482e33a15162d01cacebf","result":"boolean","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","allowed","minimum","maximum"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_capability_v1","signature":"public.faolla_attendance_management_capability_v1(text)","hash":"8442e9811c7795f37e06e22fc84cca3d773cb084b19fc3c9528d3f642b97b990","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_binding_v1","signature":"public.faolla_attendance_management_binding_v1(jsonb)","hash":"434f3279e8bd6c90d559db026bdeca2d6092749586bb6271146c23ab826358b0","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_v1","signature":"public.faolla_attendance_management_scope_v1(jsonb,text)","hash":"715c2692e308c9562a54fab06f3ab4f0c888378837e6ffdf40e9531ad40ea16c","result":"jsonb","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_command_v1","signature":"public.faolla_attendance_management_command_v1(jsonb)","hash":"4bfb75e4776588b774e58e64018394a95fb8c802776c3df433dc0259de3a0fd3","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_hash_v1","signature":"public.faolla_attendance_management_hash_v1(text,uuid,jsonb)","hash":"0251284215e3c71ba9420c3b7be5cc496699aa5a5cad4a6189da6b9a8361dd84","result":"text","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_scope_context_v1","signature":"public.faolla_attendance_management_scope_context_v1(text,jsonb,text)","hash":"dc5dbf304f62b90e211566ab9ca39a6dbace37341cf06e829f8c478dc681fa8f","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","p","a"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_current_v1","signature":"public.faolla_attendance_management_current_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"2148814cd6c45a36a584c6293e8abc8d7db61cdd62d55e06ceadcb0e757b7aa7","result":"boolean","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_receipt_v1","signature":"public.faolla_attendance_management_receipt_v1(text,uuid,uuid)","hash":"e2fc56f00392cc2cd5e50c7208e9cdca9e75dde7ae49e3d0c1534a0d24a8958d","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_grant_v1","signature":"public.faolla_attendance_management_grant_v1(public.merchant_attendance_management_delegations,timestamptz)","hash":"6dcd10acdf0b20a3184432fd943d702c75be56d37cf78c731b9f1f819e577358","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["g","at_time"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_management_delegations_v1","signature":"public.faolla_attendance_management_delegations_v1(jsonb,uuid,jsonb,boolean)","hash":"0f8acf4b919f1f77d0f82a267705ace9490d8e5cbe349b04e99f64893968a513","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_grant"],"searchPath":"search_path=pg_catalog","isRpc":true},{"name":"faolla_attendance_operational_rule_hash_v1","signature":"public.faolla_attendance_operational_rule_hash_v1(jsonb)","hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false}]$groups_dependencies$::jsonb;
 own_spec:=own_spec||jsonb_build_array((case when has190 then $groups_catalog190${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","newHash":"3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792"}$groups_catalog190$::jsonb else $groups_catalog185${"name":"faolla_valid_merchant_enterprise_permissions_v1","signature":"public.faolla_valid_merchant_enterprise_permissions_v1(text[])","hash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","result":"boolean","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p_permissions"],"searchPath":"search_path=pg_catalog, public","isRpc":false,"oldHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc","newHash":"876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b"}$groups_catalog185$::jsonb end)||jsonb_build_object('hash',case when has190 then '3d759540cb9f60753053c3012d4bbbc9d14aed92ad86aa9ba7358a0fc2d89792' else '876f0456ae5a911a8dd7de7ebed3ab03aa3b9bb4fa347c9adae4261d4d64c48b' end),$groups_capture${"name":"faolla_attendance_account_capture_v1","signature":"public.faolla_attendance_account_capture_v1(text,uuid,uuid,uuid,boolean)","hash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","result":"uuid","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_site","p_employee","p_actor","p_actor_employee","p_enabled"],"searchPath":"search_path=pg_catalog","isRpc":false,"oldHash":"07a407edc5cd7bc9d08c70769f589eb5e40531a411aa45068c499717899a47ac","newHash":"c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907"}$groups_capture$::jsonb||jsonb_build_object('hash','c5ba771116846124af37e113086395bad0787b8daaf6f9e5283273cf82337907'));
 own_spec:=own_spec||jsonb_build_array($groups_legacy_meta${"name":"faolla_attendance_groups_v1","signature":"public.faolla_attendance_groups_v1(jsonb,uuid,jsonb,boolean)","hash":"d130e4c2de2fef57ce6f18c15cc9ddb99b1d0fedb029b4e44872aee071bb9068","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}$groups_legacy_meta$::jsonb||jsonb_build_object('hash','f228cd6ff752b0cd1a76fb57677f2b3fa0b4e0c4c923808e67c7627f17dcf363'),$groups_guard_meta${"name":"faolla_attendance_management_insert_v1","signature":"public.faolla_attendance_management_insert_v1()","hash":"46d4e3edf8aba8d474b0e6e19651adc80fb7466a94c785f70e6681dc13a55110","result":"trigger","language":"plpgsql","volatility":"v","definer":true,"defaults":0,"defaultExpression":null,"args":[],"searchPath":"search_path=pg_catalog","isRpc":false,"from":"if tg_table_name='merchant_attendance_management_delegation_operations' then raise exception 'attendance_management_executor_unavailable';end if;","to":"if tg_table_name='merchant_attendance_management_delegation_operations' then\n  if new.delegated_action='audit_export' then perform public.faolla_attendance_management_audit_authority_v1(new);return new;end if;\n  raise exception 'attendance_management_executor_unavailable';\n end if;"}$groups_guard_meta$::jsonb||jsonb_build_object('hash','5d2636f3b1eacfaf0dcb6f249e234bd641e50657df5a71e0cc9fbd7600427183'));
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
 end loop;own_spec:=$groups_own$[{"name":"faolla_attendance_delegated_groups_query_v1","signature":"public.faolla_attendance_delegated_groups_query_v1(jsonb)","hash":"1582cd1b3e7376554ae99a331af78ef3c8bcef52bcb405d6b4d51be53e5d6385","result":"void","language":"plpgsql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_action_v1","signature":"public.faolla_attendance_delegated_groups_action_v1(text)","hash":"121538a7299a56317c69726c183f58a06bf51532fca31662059a6841f6cf7348","result":"text","language":"sql","volatility":"i","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_hash_v1","signature":"public.faolla_attendance_delegated_groups_hash_v1(text,uuid,uuid,jsonb)","hash":"fc054e6e2080ac05dc99924f99e3a1d5bc6db2bf8ff5940471f23e20c4abf6aa","result":"text","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","grant_id","c"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_authorize_v1","signature":"public.faolla_attendance_delegated_groups_authorize_v1(text,uuid,uuid,text,boolean)","hash":"acdd8535915b321321a35e8bf0abd3590438aa082c9d57871424920896a68e12","result":"public.merchant_attendance_management_delegations","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["site","actor","id","legacy_action","p_created"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_operation_v1","signature":"public.faolla_attendance_delegated_groups_operation_v1(public.merchant_attendance_management_delegation_operations,boolean)","hash":"43e97bf502d38b369f27b66e25430fd81e50418763015869c03b9624a6ca61ef","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p","p_current"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_receipt_v1","signature":"public.faolla_attendance_delegated_groups_receipt_v1(text,uuid,uuid,uuid)","hash":"4216281e292dda0e00f4e423b98dddc29bfdf567457bbed4656bd4b95716e75b","result":"jsonb","language":"plpgsql","volatility":"s","definer":false,"defaults":0,"defaultExpression":null,"args":["site","op","actor","id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_authority_v1","signature":"public.faolla_attendance_delegated_groups_authority_v1(public.merchant_attendance_management_delegation_operations)","hash":"0d95d4f690fcf51faafd599670698eb34773ceed2826220a69247a4d036a00cf","result":"void","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_groups_core_v2","signature":"public.faolla_attendance_groups_core_v2(jsonb,uuid,jsonb,boolean,uuid)","hash":"ca8c54338e01af8d00881718a0a9de6b7683816ed5f3a79f79363e062f3a23c7","result":"jsonb","language":"plpgsql","volatility":"v","definer":false,"defaults":0,"defaultExpression":null,"args":["p_query","p_auth_user_id","p_command","p_allow_write","p_grant_id"],"searchPath":"search_path=pg_catalog","isRpc":false},{"name":"faolla_attendance_delegated_groups_v1","signature":"public.faolla_attendance_delegated_groups_v1(jsonb,uuid,jsonb,boolean)","hash":"8271da64d75e0657325cfe94222b8ec1b8cd847390a6d793f3af331b461de18d","result":"jsonb","language":"plpgsql","volatility":"v","definer":true,"defaults":2,"defaultExpression":"NULL::jsonb, false","args":["p_query","p_auth_user_id","p_command","p_allow_write"],"searchPath":"search_path=pg_catalog","isRpc":true}]$groups_own$::jsonb;for spec in select value from jsonb_array_elements(own_spec) loop
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
 end loop;foreach table_name in array array['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations'] loop
  actual_table:=to_regclass(ns||'.'||table_name);expected_table:=to_regclass('pg_temp.'||table_name);
  if not exists(select 1 from pg_class catalog_table where catalog_table.oid=actual_table and catalog_table.relkind='r' and catalog_table.relowner=expected_owner and catalog_table.relrowsecurity and not catalog_table.relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=actual_table)
   or exists(select 1 from pg_class catalog_table cross join lateral aclexplode(coalesce(catalog_table.relacl,acldefault('r',catalog_table.relowner))) acl where catalog_table.oid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or exists(select 1 from pg_attribute attribute cross join lateral aclexplode(attribute.attacl) acl where attribute.attrelid=actual_table and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or (select count(*) from pg_attribute where attrelid=actual_table and attnum>0)<>(select count(*) from pg_attribute where attrelid=expected_table and attnum>0)
   or exists(select 1 from pg_attribute actual full join pg_attribute expected on expected.attrelid=expected_table and actual.attnum=expected.attnum where actual.attrelid=actual_table and actual.attnum>0 and row(actual.attname,actual.atttypid,actual.atttypmod,actual.attnotnull,actual.atthasdef,actual.attidentity,actual.attgenerated,actual.attndims,actual.attisdropped,actual.attcollation) is distinct from row(expected.attname,expected.atttypid,expected.atttypmod,expected.attnotnull,expected.atthasdef,expected.attidentity,expected.attgenerated,expected.attndims,expected.attisdropped,expected.attcollation)) then raise exception 'merchant_attendance_delegated_groups_table_conflict';end if;
  if (select count(*) from pg_constraint where conrelid=actual_table and contype<>'t')<>(select count(*) from pg_constraint where conrelid=expected_table and contype<>'t') then raise exception 'merchant_attendance_delegated_groups_constraint_conflict';end if;
  for constraint_spec in select * from pg_constraint where conrelid=expected_table and contype<>'t' loop
   select * into actual_constraint from pg_constraint where conrelid=actual_table and conname=constraint_spec.conname;
   foreign_table:=case constraint_spec.confrelid when to_regclass('pg_temp.groups_expected_settings') then to_regclass(ns||'.merchant_attendance_settings') when to_regclass('pg_temp.groups_expected_workers') then to_regclass(ns||'.merchant_attendance_workers') when to_regclass('pg_temp.merchant_attendance_groups') then to_regclass(ns||'.merchant_attendance_groups') when to_regclass('pg_temp.merchant_attendance_group_operations') then to_regclass(ns||'.merchant_attendance_group_operations') when to_regclass('pg_temp.merchant_attendance_group_assignments') then to_regclass(ns||'.merchant_attendance_group_assignments') when to_regclass('pg_temp.merchant_attendance_group_assignment_operations') then to_regclass(ns||'.merchant_attendance_group_assignment_operations') else constraint_spec.confrelid end;
   if actual_constraint.oid is null or row(actual_constraint.contype,actual_constraint.conkey,actual_constraint.confkey,actual_constraint.confrelid,actual_constraint.condeferrable,actual_constraint.condeferred,actual_constraint.convalidated,actual_constraint.confupdtype,actual_constraint.confdeltype,actual_constraint.confmatchtype,actual_constraint.connoinherit) is distinct from row(constraint_spec.contype,constraint_spec.conkey,constraint_spec.confkey,foreign_table::oid,constraint_spec.condeferrable,constraint_spec.condeferred,constraint_spec.convalidated,constraint_spec.confupdtype,constraint_spec.confdeltype,constraint_spec.confmatchtype,constraint_spec.connoinherit)
    or pg_get_expr(actual_constraint.conbin,actual_table) is distinct from pg_get_expr(constraint_spec.conbin,expected_table) then raise exception 'merchant_attendance_delegated_groups_constraint_conflict';end if;
  end loop;
  if (select count(*) from pg_index where indrelid=actual_table)<>(select count(*) from pg_index where indrelid=expected_table) then raise exception 'merchant_attendance_delegated_groups_index_conflict';end if;
  for index_spec in select index_row.*,index_table.relname,index_table.relam from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indrelid=expected_table loop
   select index_row.*,index_table.relowner,index_table.relam,index_table.relkind into actual_index from pg_index index_row join pg_class index_table on index_table.oid=index_row.indexrelid where index_row.indexrelid=to_regclass(ns||'.'||index_spec.relname);
   if actual_index.indexrelid is null or actual_index.indrelid<>actual_table or actual_index.relowner<>expected_owner or actual_index.relkind<>'i' or not actual_index.indisvalid or not actual_index.indisready or not actual_index.indislive
    or row(actual_index.relam,actual_index.indnatts,actual_index.indnkeyatts,actual_index.indisunique,actual_index.indisprimary,actual_index.indisexclusion,actual_index.indimmediate,actual_index.indkey,actual_index.indcollation,actual_index.indclass,actual_index.indoption) is distinct from row(index_spec.relam,index_spec.indnatts,index_spec.indnkeyatts,index_spec.indisunique,index_spec.indisprimary,index_spec.indisexclusion,index_spec.indimmediate,index_spec.indkey,index_spec.indcollation,index_spec.indclass,index_spec.indoption)
    or pg_get_expr(actual_index.indpred,actual_table) is distinct from pg_get_expr(index_spec.indpred,expected_table) or pg_get_expr(actual_index.indexprs,actual_table) is distinct from pg_get_expr(index_spec.indexprs,expected_table) then raise exception 'merchant_attendance_delegated_groups_index_conflict';end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=actual_table and not tgisinternal)<>(case when table_name like '%operations' then 2 else 0 end) then raise exception 'merchant_attendance_delegated_groups_trigger_conflict';end if;
  if table_name like '%operations' then for trigger_spec in select * from(values('_immutable',27),('_no_truncate',34)) expected(suffix,kind) loop
   if not exists(select 1 from pg_trigger actual where actual.tgrelid=actual_table and actual.tgname=(table_name||trigger_spec.suffix)::name and actual.tgtype=trigger_spec.kind and actual.tgenabled='O' and actual.tgnargs=0 and actual.tgqual is null and not actual.tgdeferrable and not actual.tginitdeferred and actual.tgfoid=to_regprocedure(ns||'.faolla_attendance_events_append_only_v1()')) then raise exception 'merchant_attendance_delegated_groups_trigger_conflict';end if;
  end loop;end if;
 end loop;
 if (select count(*) from groups204_forward_metadata)<>2 or exists(select 1 from groups204_forward_metadata original left join pg_proc proc on proc.oid=original.oid where proc.oid is null or to_jsonb(proc)-array['prosrc','proargdefaults'] is distinct from original.metadata or pg_get_expr(proc.proargdefaults,0) is distinct from original.default_expression) then raise exception 'merchant_attendance_delegated_groups_forward_metadata_changed';end if;
 end;$groups204_postconditions$;
 drop table pg_temp.groups204_forward_metadata,pg_temp.merchant_attendance_groups,pg_temp.merchant_attendance_group_operations,pg_temp.merchant_attendance_group_assignments,pg_temp.merchant_attendance_group_assignment_operations,pg_temp.groups_expected_workers,pg_temp.groups_expected_settings;
--END GENERATED DELEGATED GROUPS POSTCONDITIONS
insert into public.faolla_schema_migrations(version,name) values(202610080204,'merchant_attendance_delegated_groups') on conflict(version) do nothing;
commit;
