--198: fixed handling responsibility, never an approval entitlement.
--Concurrent old-table indexes must not be enclosed by an outer transaction.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $routing_preflight$
declare ns text;expected_owner oid;installed boolean;f regprocedure;info record;expected record;idx oid;t regclass;object_name text;role_name text;con record;expression_value text;
begin
 select n.nspname,c.relowner into ns,expected_owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing');
 if exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name<>'merchant_attendance_review_routing') then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 for expected in select * from (values (202610060160::bigint,'merchant_attendance_missing_delegation'),(202610060162::bigint,'merchant_attendance_application_delegation'),
  (202610060164::bigint,'merchant_attendance_account_suspensions'),(202610080189::bigint,'merchant_attendance_correction_delegation'),
  (202610080191::bigint,'merchant_attendance_operational_rules'),(202610080192::bigint,'merchant_attendance_operational_source'),
  (202610080193::bigint,'merchant_attendance_operational_punch'),(202610080194::bigint,'merchant_attendance_application_window')) dependency(version,name) loop
  if not exists(select 1 from public.faolla_schema_migrations m where m.version=expected.version and m.name=expected.name) then raise exception 'merchant_attendance_review_routing_prerequisite_required';end if;
 end loop;
 if to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null then raise exception 'merchant_attendance_review_routing_prerequisite_required';end if;
 for expected in select * from (values
  ('public.faolla_attendance_operational_rule_object_v1(jsonb,text[])','c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7','boolean','i','sql',false,false,0,array['p','ks']::text[]),
  ('public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)','99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce','boolean','i','plpgsql',false,false,0,array['p','k']::text[]),
  ('public.faolla_attendance_operational_source_stamp_v1(text)','4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265','timestamptz','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_group_text_v1(text,integer,integer)','b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562','boolean','i','sql',false,false,0,array['p','lo','hi']::text[]),
  ('public.faolla_attendance_correction_proposal_v1(jsonb,timestamptz)','d389ec334e368ecb2afcf44ad1a37ff39af028536fff6b30a64d72ca3ad3da9d','jsonb','v','plpgsql',false,false,0,array['p_value','p_now']::text[]),
  ('public.faolla_attendance_correction_summary_v1(public.merchant_attendance_correction_entries,public.merchant_attendance_correction_entries)','4aa9ea02f21c5dde7477666c3b68baffbd2ea49fb84279be4b5a55a4b39660b2','jsonb','i','sql',false,false,0,array['p_first','p_last']::text[]),
  ('public.faolla_attendance_missing_summary_v1(public.merchant_attendance_missing_requests)','b0e0bd86ca4583b4056d81043185d1727c5be85662dc97310e258ed684caad05','jsonb','v','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)','5df82b03753c90636b8fd9fce15384560490c4f5996fafe1df76ec9e75b09fa6','jsonb','v','plpgsql',false,false,1,array['p','p_revision']::text[]),
  ('public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)','a27f471975013268910a5523bf6e7998ce90f2901d25a234663e653ecc8222e5','jsonb','v','plpgsql',false,false,1,array['p','p_revision']::text[]),
  ('public.faolla_attendance_operational_punch_stamp_v1(timestamptz)','6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_correction_delegation_hash_v1(text,text,jsonb)','5ab9296fcbf5d0fd65d680b4de9885d0eb2d06c0266bffe425875b9ff10ca62c','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_missing_delegation_hash_v1(text,text,jsonb)','2d1805657c298a6190ea36d2aa5dc1b35a393db31e305d1ed919eba02441bbcc','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_application_delegation_hash_v1(text,text,jsonb)','2d54478110b1df6ea4d37a71899337dd283dc8a3bc63d97fad38db77ec952d09','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_correction_delegation_usable_v1(public.merchant_attendance_correction_delegations,timestamptz)','95427a0e2ee14be6aac45137a5cc154da56953bb4a7005027822376800fc0f2d','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_correction_delegation_scope_v1(jsonb,uuid)','0349465cb5460fa9cc15e5a12d1936683f52f9d5aef4a8ab976a8f4ca8e215fb','boolean','i','plpgsql',false,false,0,array['p_basis','p_location']::text[]),
  ('public.faolla_attendance_correction_owner_basis_v1(text,uuid,uuid,uuid,timestamptz)','2523fe8ecf015e11b1b334bd1d9938b1b956bdeb47557c42e5b299c7eb1dae6e','jsonb','v','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_start','p_now']::text[]),
  ('public.faolla_attendance_correction_delegation_original_v1(jsonb,timestamptz)','58ad93e2073338a63b5b1edc6deb0837b64949708cee9fff8d47b0e98c2df4b0','jsonb','v','plpgsql',false,false,0,array['p_basis','p_now']::text[]),
  ('public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz)','a6511db89e8639edb4f445e42efc345930bce5f08a67ba0ecfba23feee6e99a2','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz)','11c1b220fa18dc1b55caf3378b248aa8ccd9914bc44cf4ed132baded58d84dda','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_operational_rule_hash_v1(jsonb)','fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_source_tuple_v1(jsonb)','df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_saved_source_v1(jsonb)','f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_consumer_item_v1(public.merchant_attendance_operational_consumer_activations)','018cf97af523313e0759e0cc378d80ba1d8bf98b0501ecbaab322b5819afc5a4','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamptz)','9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee','jsonb','v','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_employee_auth','p_at']::text[]),
  ('public.faolla_attendance_operational_punch_source_ref_v1(jsonb)','31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_application_window_scalar_v1(jsonb,text)','fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db','boolean','i','plpgsql',false,false,0,array['p','k']::text[]),
  ('public.faolla_attendance_account_grant_current_v1(text,text,uuid,uuid,uuid,uuid,uuid)','882d5dc7f35d43fb131c536b79b6daf367bdc48bfe5a0550182b4f38d73ba428','boolean','s','plpgsql',false,false,0,array['p_site','p_channel','p_grant','p_delegate','p_delegate_auth','p_employee','p_auth']::text[]),
  ('public.faolla_attendance_missing_delegation_usable_pre164(public.merchant_attendance_missing_delegations,timestamptz)','68e6c074e4916a35ea9f21b006c67ae3ad28365a885b4b44c75965f2240602c2','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_application_delegation_usable_pre164(public.merchant_attendance_application_delegations,timestamptz)','ccb548d959cd1fa3d44adb41a335e000af899f1a6b62ff52e42249d45d446516','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean)',(case when installed then '3b621cc8c6271c100851413a88847da63e2e2c7b4b38a932e83d192a279aa144' else 'd4cdaae19d5488037fe732553be3e7cec835db5dc057f0160f8515f55cf9408d' end),'jsonb','v','plpgsql',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_activate']::text[])
 ) dependency(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility or info.lanname is distinct from expected.language_name
   or info.prorettype is distinct from to_regtype(expected.result_type) or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults
   or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('attendance_review_routing_correction_idx','merchant_attendance_correction_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','delegate_employee_id','delegate_auth_user_id','grant_id']::text[]),
  ('attendance_review_routing_missing_idx','merchant_attendance_missing_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','delegate_employee_id','delegate_auth_user_id','grant_id']::text[]),
  ('attendance_review_routing_application_idx','merchant_attendance_application_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','category','delegate_employee_id','delegate_auth_user_id','grant_id']::text[])
 ) old_index(index_name,table_name,keys) loop
  idx:=to_regclass('public.'||expected.index_name);t:=to_regclass('public.'||expected.table_name);
  if t is null or (installed and idx is null) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
  if idx is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
   where c.oid=idx and c.relowner=expected_owner and c.relkind='i' and am.amname='btree' and i.indrelid=t
    and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null
    and i.indnatts=cardinality(expected.keys) and i.indnkeyatts=cardinality(expected.keys)
    and not exists(select 1 from generate_subscripts(expected.keys,1) z where
     (select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]) is distinct from expected.keys[z]
     or i.indoption[z-1]<>0 or i.indcollation[z-1] is distinct from (select a.attcollation from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[z-1])
     or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
      where o.oid=i.indclass[z-1] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
 end loop;
 if (select count(*) from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns) and p.proname like 'faolla_attendance_review_routing_%')<>(case when installed then 16 else 0 end) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 foreach object_name in array array['merchant_attendance_review_responsibility_entries','merchant_attendance_review_responsibility_heads']::text[] loop
  if (to_regclass('public.'||object_name) is not null)<>installed then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 foreach object_name in array array['merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_leave_requests','merchant_attendance_work_arrangement_requests']::text[] loop
  t:=to_regclass('public.'||object_name);
  if t is null or exists(select 1 from pg_trigger where tgrelid=t and tgname='review_routing_capture')<>installed then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  if installed and not exists(select 1 from pg_trigger where tgrelid=t and tgname='review_routing_capture' and tgtype=5 and tgenabled='O' and tgnargs=0 and tgqual is null and not tgdeferrable and not tginitdeferred
   and tgfoid=to_regprocedure('public.faolla_attendance_review_routing_capture_v1()')) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 if not installed then return;end if;
 for expected in select * from (values
  ('public.faolla_attendance_review_routing_tuple_v1(jsonb,text)','afcd6520c775813bf11d0406e3f62b3cbf08445e1025be6761fc75d522b0d880','jsonb','s','plpgsql',false,false,0,array['p','p_kind']::text[]),
  ('public.faolla_attendance_review_routing_fact_v1(text,text,uuid,boolean)','4de217d5343138427dc0af875cdccff5cf1ca844f087562af61298fcaf00a8f7','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_complete']::text[]),
  ('public.faolla_attendance_review_routing_request_v1(text,text,uuid)','bea1a2fe21d3310967c64af9e2c019642e6e1432d09ed7eb19d2a546a752941b','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request']::text[]),
  ('public.faolla_attendance_review_routing_grant_v1(text,text,uuid)','8de810b68e5a3c994ed78b2e684d40e28967c5ec9f9381a92c64fcf42e233b9c','jsonb','s','plpgsql',false,false,0,array['p_site','p_family','p_grant']::text[]),
  ('public.faolla_attendance_review_routing_qualify_v1(text,text,uuid,uuid,timestamptz)','7a867d0c19f5b7dedae30db3f1e9007ad7792702949c333c919e22ac7c7bdff9','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_grant','p_at']::text[]),
  ('public.faolla_attendance_review_routing_candidates_v1(text,jsonb,jsonb,jsonb)','b6fdd5d441375fedea4328fd289b323d218a5e2b7c860061989552fec08640b8','jsonb','s','plpgsql',false,false,0,array['p_site','p_ref','p_delegate','p_cursor']::text[]),
  ('public.faolla_attendance_review_routing_origin_v1(jsonb,text,bigint)','fa9cb981676d6e4f0eed10a73c99b200193c3d4aeb95a0f02502c18933ac7df5','jsonb','s','plpgsql',false,false,0,array['p_source','p_family','p_activation']::text[]),
  ('public.faolla_attendance_review_routing_choose_v1(text,text,uuid,jsonb,uuid,timestamptz)','b60959dc2a537c238c0deedc03a3f240a10a441fab54261afcd9a1cec9eb144d','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_origin','p_owner','p_at']::text[]),
  ('public.faolla_attendance_review_routing_make_v1(text,jsonb,uuid,bigint,text,uuid,timestamptz,text,uuid,jsonb,jsonb,text)','c8c2cf0b9863ba02d74d2a57d80ecc1c799855ef9267e60fbd8cfa6862018763','jsonb','s','plpgsql',false,false,0,array['p_site','p_ref','p_op','p_revision','p_action','p_actor','p_at','p_reason','p_previous','p_origin','p_assignment','p_fingerprint']::text[]),
  ('public.faolla_attendance_review_routing_entry_v1(public.merchant_attendance_review_responsibility_entries)','c7ad8af0b4ae7950ba4d322112b8ec5282ea532b2f5f9432460e67500b4ef61b','jsonb','v','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_observe_v1(text,text,uuid,timestamptz)','c67fdd792c1ea719c2ce86cd88beb40d057920b66ad5f892b45ad9c1f91e7167','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_at']::text[]),
  ('public.faolla_attendance_review_routing_capture_v1()','58342d0420d4a28f4756b3876ba0ac67be750ec379c5a4429615fa967fc63dc3','trigger','v','plpgsql',true,false,0,array[]::text[]),
  ('public.faolla_attendance_review_routing_guard_v1()','b66673e41caf7849bf516cd94f952ca5d722adf3bedd53fa553717aeb698d35c','trigger','v','plpgsql',true,false,0,array[]::text[]),
  ('public.faolla_attendance_review_routing_query_v1(jsonb)','2982cdf9b06ec8a079c4fbb53f18157d120d489a154c4c846783be2e5f97d5e6','void','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_receipt_v1(public.merchant_attendance_review_responsibility_entries)','1f46dc51aaf7b2d8d786d8980c542d645152750f9289faa42af1632060a19a90','jsonb','v','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_v1(jsonb,uuid,jsonb,boolean)','159b511971d0b194a328507c77c5126de8b5e2400ea99f048ff0af957d8733ff','jsonb','v','plpgsql',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[])
 ) own(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility or info.lanname is distinct from expected.language_name
   or info.prorettype is distinct from to_regtype(expected.result_type) or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults
   or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries',array['merchant_id','family','request_id','operation_id','revision','actor_auth_user_id','recorded_at','worker_id','employee_id','employee_auth_user_id','request_ref','entry','command','source_ref','authority']::text[],array['text','text','uuid','uuid','bigint','uuid','timestamp with time zone','uuid','uuid','uuid','jsonb','jsonb','jsonb','jsonb','jsonb']::text[],array['command','source_ref','authority']::text[],8,4),
  ('merchant_attendance_review_responsibility_heads',array['merchant_id','family','request_id','revision','operation_id','recorded_at','worker_id','employee_id','employee_auth_user_id']::text[],array['text','text','uuid','bigint','uuid','timestamp with time zone','uuid','uuid','uuid']::text[],array[]::text[],3,2)
 ) tbl(table_name,columns,types,nullable_columns,constraints,triggers) loop
  t:=to_regclass('public.'||expected.table_name);
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or array(select a.attname::text from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.columns
   or array(select format_type(a.atttypid,a.atttypmod) from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.types
   or exists(select 1 from pg_attribute a where a.attrelid=t and a.attnum>0 and (a.attisdropped or a.attnotnull=(a.attname=any(expected.nullable_columns)) or a.atthasdef or a.attidentity<>'' or a.attgenerated<>'' or a.attndims<>0))
   or (select count(*) from pg_constraint where conrelid=t and contype<>'t')<>expected.constraints
   or (select count(*) from pg_index where indrelid=t)<>2 or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>expected.triggers
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  end loop;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_pk','p',array['merchant_id','family','operation_id']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_stream_uq','u',array['merchant_id','family','request_id','revision']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_site_fk','f',array['merchant_id']::text[],'merchant_attendance_settings',array['merchant_id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_worker_fk','f',array['merchant_id','worker_id']::text[],'merchant_attendance_workers',array['merchant_id','id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_employee_fk','f',array['merchant_id','employee_id']::text[],'merchant_enterprise_employees',array['merchant_id','id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_family_ck','c',array[]::text[],null::text,array[]::text[],'family=any(array[''correction'',''correction_revision'',''missing'',''missing_revision'',''leave'',''work_arrangement'']::text[])'),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_revision_ck','c',array[]::text[],null::text,array[]::text[],'revision>=1::bigint and revision<=9007199254740990::bigint and isfinite(recorded_at)'),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_bytes_ck','c',array[]::text[],null::text,array[]::text[],'octet_length(convert_to(jsonb_build_array(request_ref,entry,command,source_ref,authority)::text,''UTF8''))<=32768'),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_pk','p',array['merchant_id','family','request_id']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_entry_fk','f',array['merchant_id','family','operation_id']::text[],'merchant_attendance_review_responsibility_entries',array['merchant_id','family','operation_id']::text[],null::text),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_revision_ck','c',array[]::text[],null::text,array[]::text[],'revision>=1::bigint and revision<=9007199254740990::bigint and isfinite(recorded_at)')
 ) constraint_spec(table_name,constraint_name,kind,keys,referenced_table,referenced_keys,expression_text) loop
  t:=to_regclass('public.'||expected.table_name);
  select * into con from pg_constraint x where x.conrelid=t and x.conname=expected.constraint_name;
  if con.oid is null or con.contype::text is distinct from expected.kind or not con.convalidated or con.condeferrable or con.condeferred or expected.kind='c' and con.connoinherit then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  if expected.kind='c' then
   --Only insignificant formatting and explicit scalar casts are normalized; no operators or literals are removed.
   expression_value:=lower(replace(regexp_replace(regexp_replace(pg_get_expr(con.conbin,t),'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g'),chr(39),''));
   if expression_value is distinct from lower(replace(regexp_replace(regexp_replace(expected.expression_text,'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g'),chr(39),'')) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  else
   if array(select a.attname::text from unnest(con.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=t and a.attnum=k.attnum order by k.n) is distinct from expected.keys then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
   if expected.kind='f' then
    if con.confrelid is distinct from to_regclass('public.'||expected.referenced_table) or con.confupdtype<>'a' or con.confdeltype<>'a' or con.confmatchtype<>'s'
     or array(select a.attname::text from unnest(con.confkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.attnum order by k.n) is distinct from expected.referenced_keys then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
   elsif not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indexrelid=con.conindid and i.indrelid=t and c.relowner=expected_owner
    and am.amname='btree' and i.indisunique and i.indisvalid and i.indisready and i.indislive and not i.indisexclusion and i.indpred is null and i.indexprs is null
    and i.indnatts=cardinality(expected.keys) and i.indnkeyatts=cardinality(expected.keys)) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  end if;
 end loop;
 idx:=to_regclass('public.attendance_review_responsibility_list_idx');t:='public.merchant_attendance_review_responsibility_heads'::regclass;
 if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indexrelid=idx and i.indrelid=t and c.relowner=expected_owner and am.amname='btree'
  and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null and i.indnatts=4 and i.indnkeyatts=4
  and array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=t and a.attnum=k.attnum order by k.n)=array['merchant_id','recorded_at','family','request_id']
  and i.indoption[0]=0 and i.indoption[1]=3 and i.indoption[2]=0 and i.indoption[3]=3
  and i.indcollation[2]='pg_catalog."C"'::regcollation
  and not exists(select 1 from generate_series(0,3) z where (z<>2 and i.indcollation[z] is distinct from (select a.attcollation from pg_attribute a where a.attrelid=t and a.attnum=i.indkey[z]))
   or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=t and a.attnum=i.indkey[z] where o.oid=i.indclass[z] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries','review_routing_entry_before',7,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_immutable',27,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_no_truncate',34,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_proof',5,true,true),
  ('merchant_attendance_review_responsibility_heads','review_routing_head_before',31,false,false),
  ('merchant_attendance_review_responsibility_heads','review_routing_no_truncate',34,false,false)
 ) trigger_spec(table_name,trigger_name,trigger_type,is_deferred,initially_deferred) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||expected.table_name) and tgname=expected.trigger_name and tgtype=expected.trigger_type and tgenabled='O'
   and tgnargs=0 and tgqual is null and tgdeferrable=expected.is_deferred and tginitdeferred=expected.initially_deferred and tgfoid='public.faolla_attendance_review_routing_guard_v1()'::regprocedure) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
end;
$routing_preflight$;
commit;
create index concurrently if not exists attendance_review_routing_correction_idx on public.merchant_attendance_correction_delegations
 (merchant_id,worker_id,employee_id,employee_auth_user_id,delegate_employee_id,delegate_auth_user_id,grant_id);
create index concurrently if not exists attendance_review_routing_missing_idx on public.merchant_attendance_missing_delegations
 (merchant_id,worker_id,employee_id,employee_auth_user_id,delegate_employee_id,delegate_auth_user_id,grant_id);
create index concurrently if not exists attendance_review_routing_application_idx on public.merchant_attendance_application_delegations
 (merchant_id,worker_id,employee_id,employee_auth_user_id,category,delegate_employee_id,delegate_auth_user_id,grant_id);
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $routing_index_ready$
declare ns text;expected_owner oid;installed boolean;f regprocedure;info record;expected record;idx oid;t regclass;object_name text;role_name text;con record;expression_value text;
begin
 select n.nspname,c.relowner into ns,expected_owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing');
 if exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name<>'merchant_attendance_review_routing') then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 for expected in select * from (values (202610060160::bigint,'merchant_attendance_missing_delegation'),(202610060162::bigint,'merchant_attendance_application_delegation'),
  (202610060164::bigint,'merchant_attendance_account_suspensions'),(202610080189::bigint,'merchant_attendance_correction_delegation'),
  (202610080191::bigint,'merchant_attendance_operational_rules'),(202610080192::bigint,'merchant_attendance_operational_source'),
  (202610080193::bigint,'merchant_attendance_operational_punch'),(202610080194::bigint,'merchant_attendance_application_window')) dependency(version,name) loop
  if not exists(select 1 from public.faolla_schema_migrations m where m.version=expected.version and m.name=expected.name) then raise exception 'merchant_attendance_review_routing_prerequisite_required';end if;
 end loop;
 if to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null then raise exception 'merchant_attendance_review_routing_prerequisite_required';end if;
 for expected in select * from (values
  ('public.faolla_attendance_operational_rule_object_v1(jsonb,text[])','c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7','boolean','i','sql',false,false,0,array['p','ks']::text[]),
  ('public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)','99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce','boolean','i','plpgsql',false,false,0,array['p','k']::text[]),
  ('public.faolla_attendance_operational_source_stamp_v1(text)','4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265','timestamptz','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_group_text_v1(text,integer,integer)','b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562','boolean','i','sql',false,false,0,array['p','lo','hi']::text[]),
  ('public.faolla_attendance_correction_proposal_v1(jsonb,timestamptz)','d389ec334e368ecb2afcf44ad1a37ff39af028536fff6b30a64d72ca3ad3da9d','jsonb','v','plpgsql',false,false,0,array['p_value','p_now']::text[]),
  ('public.faolla_attendance_correction_summary_v1(public.merchant_attendance_correction_entries,public.merchant_attendance_correction_entries)','4aa9ea02f21c5dde7477666c3b68baffbd2ea49fb84279be4b5a55a4b39660b2','jsonb','i','sql',false,false,0,array['p_first','p_last']::text[]),
  ('public.faolla_attendance_missing_summary_v1(public.merchant_attendance_missing_requests)','b0e0bd86ca4583b4056d81043185d1727c5be85662dc97310e258ed684caad05','jsonb','v','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)','5df82b03753c90636b8fd9fce15384560490c4f5996fafe1df76ec9e75b09fa6','jsonb','v','plpgsql',false,false,1,array['p','p_revision']::text[]),
  ('public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)','a27f471975013268910a5523bf6e7998ce90f2901d25a234663e653ecc8222e5','jsonb','v','plpgsql',false,false,1,array['p','p_revision']::text[]),
  ('public.faolla_attendance_operational_punch_stamp_v1(timestamptz)','6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_correction_delegation_hash_v1(text,text,jsonb)','5ab9296fcbf5d0fd65d680b4de9885d0eb2d06c0266bffe425875b9ff10ca62c','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_missing_delegation_hash_v1(text,text,jsonb)','2d1805657c298a6190ea36d2aa5dc1b35a393db31e305d1ed919eba02441bbcc','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_application_delegation_hash_v1(text,text,jsonb)','2d54478110b1df6ea4d37a71899337dd283dc8a3bc63d97fad38db77ec952d09','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_correction_delegation_usable_v1(public.merchant_attendance_correction_delegations,timestamptz)','95427a0e2ee14be6aac45137a5cc154da56953bb4a7005027822376800fc0f2d','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_correction_delegation_scope_v1(jsonb,uuid)','0349465cb5460fa9cc15e5a12d1936683f52f9d5aef4a8ab976a8f4ca8e215fb','boolean','i','plpgsql',false,false,0,array['p_basis','p_location']::text[]),
  ('public.faolla_attendance_correction_owner_basis_v1(text,uuid,uuid,uuid,timestamptz)','2523fe8ecf015e11b1b334bd1d9938b1b956bdeb47557c42e5b299c7eb1dae6e','jsonb','v','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_start','p_now']::text[]),
  ('public.faolla_attendance_correction_delegation_original_v1(jsonb,timestamptz)','58ad93e2073338a63b5b1edc6deb0837b64949708cee9fff8d47b0e98c2df4b0','jsonb','v','plpgsql',false,false,0,array['p_basis','p_now']::text[]),
  ('public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz)','a6511db89e8639edb4f445e42efc345930bce5f08a67ba0ecfba23feee6e99a2','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz)','11c1b220fa18dc1b55caf3378b248aa8ccd9914bc44cf4ed132baded58d84dda','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_operational_rule_hash_v1(jsonb)','fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_source_tuple_v1(jsonb)','df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_saved_source_v1(jsonb)','f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_consumer_item_v1(public.merchant_attendance_operational_consumer_activations)','018cf97af523313e0759e0cc378d80ba1d8bf98b0501ecbaab322b5819afc5a4','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamptz)','9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee','jsonb','v','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_employee_auth','p_at']::text[]),
  ('public.faolla_attendance_operational_punch_source_ref_v1(jsonb)','31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_application_window_scalar_v1(jsonb,text)','fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db','boolean','i','plpgsql',false,false,0,array['p','k']::text[]),
  ('public.faolla_attendance_account_grant_current_v1(text,text,uuid,uuid,uuid,uuid,uuid)','882d5dc7f35d43fb131c536b79b6daf367bdc48bfe5a0550182b4f38d73ba428','boolean','s','plpgsql',false,false,0,array['p_site','p_channel','p_grant','p_delegate','p_delegate_auth','p_employee','p_auth']::text[]),
  ('public.faolla_attendance_missing_delegation_usable_pre164(public.merchant_attendance_missing_delegations,timestamptz)','68e6c074e4916a35ea9f21b006c67ae3ad28365a885b4b44c75965f2240602c2','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_application_delegation_usable_pre164(public.merchant_attendance_application_delegations,timestamptz)','ccb548d959cd1fa3d44adb41a335e000af899f1a6b62ff52e42249d45d446516','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean)',(case when installed then '3b621cc8c6271c100851413a88847da63e2e2c7b4b38a932e83d192a279aa144' else 'd4cdaae19d5488037fe732553be3e7cec835db5dc057f0160f8515f55cf9408d' end),'jsonb','v','plpgsql',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_activate']::text[])
 ) dependency(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility or info.lanname is distinct from expected.language_name
   or info.prorettype is distinct from to_regtype(expected.result_type) or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults
   or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('attendance_review_routing_correction_idx','merchant_attendance_correction_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','delegate_employee_id','delegate_auth_user_id','grant_id']::text[]),
  ('attendance_review_routing_missing_idx','merchant_attendance_missing_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','delegate_employee_id','delegate_auth_user_id','grant_id']::text[]),
  ('attendance_review_routing_application_idx','merchant_attendance_application_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','category','delegate_employee_id','delegate_auth_user_id','grant_id']::text[])
 ) old_index(index_name,table_name,keys) loop
  idx:=to_regclass('public.'||expected.index_name);t:=to_regclass('public.'||expected.table_name);
  if t is null or (true and idx is null) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
  if idx is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
   where c.oid=idx and c.relowner=expected_owner and c.relkind='i' and am.amname='btree' and i.indrelid=t
    and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null
    and i.indnatts=cardinality(expected.keys) and i.indnkeyatts=cardinality(expected.keys)
    and not exists(select 1 from generate_subscripts(expected.keys,1) z where
     (select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]) is distinct from expected.keys[z]
     or i.indoption[z-1]<>0 or i.indcollation[z-1] is distinct from (select a.attcollation from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[z-1])
     or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
      where o.oid=i.indclass[z-1] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
 end loop;
 if (select count(*) from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns) and p.proname like 'faolla_attendance_review_routing_%')<>(case when installed then 16 else 0 end) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 foreach object_name in array array['merchant_attendance_review_responsibility_entries','merchant_attendance_review_responsibility_heads']::text[] loop
  if (to_regclass('public.'||object_name) is not null)<>installed then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 foreach object_name in array array['merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_leave_requests','merchant_attendance_work_arrangement_requests']::text[] loop
  t:=to_regclass('public.'||object_name);
  if t is null or exists(select 1 from pg_trigger where tgrelid=t and tgname='review_routing_capture')<>installed then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  if installed and not exists(select 1 from pg_trigger where tgrelid=t and tgname='review_routing_capture' and tgtype=5 and tgenabled='O' and tgnargs=0 and tgqual is null and not tgdeferrable and not tginitdeferred
   and tgfoid=to_regprocedure('public.faolla_attendance_review_routing_capture_v1()')) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 if not installed then return;end if;
 for expected in select * from (values
  ('public.faolla_attendance_review_routing_tuple_v1(jsonb,text)','afcd6520c775813bf11d0406e3f62b3cbf08445e1025be6761fc75d522b0d880','jsonb','s','plpgsql',false,false,0,array['p','p_kind']::text[]),
  ('public.faolla_attendance_review_routing_fact_v1(text,text,uuid,boolean)','4de217d5343138427dc0af875cdccff5cf1ca844f087562af61298fcaf00a8f7','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_complete']::text[]),
  ('public.faolla_attendance_review_routing_request_v1(text,text,uuid)','bea1a2fe21d3310967c64af9e2c019642e6e1432d09ed7eb19d2a546a752941b','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request']::text[]),
  ('public.faolla_attendance_review_routing_grant_v1(text,text,uuid)','8de810b68e5a3c994ed78b2e684d40e28967c5ec9f9381a92c64fcf42e233b9c','jsonb','s','plpgsql',false,false,0,array['p_site','p_family','p_grant']::text[]),
  ('public.faolla_attendance_review_routing_qualify_v1(text,text,uuid,uuid,timestamptz)','7a867d0c19f5b7dedae30db3f1e9007ad7792702949c333c919e22ac7c7bdff9','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_grant','p_at']::text[]),
  ('public.faolla_attendance_review_routing_candidates_v1(text,jsonb,jsonb,jsonb)','b6fdd5d441375fedea4328fd289b323d218a5e2b7c860061989552fec08640b8','jsonb','s','plpgsql',false,false,0,array['p_site','p_ref','p_delegate','p_cursor']::text[]),
  ('public.faolla_attendance_review_routing_origin_v1(jsonb,text,bigint)','fa9cb981676d6e4f0eed10a73c99b200193c3d4aeb95a0f02502c18933ac7df5','jsonb','s','plpgsql',false,false,0,array['p_source','p_family','p_activation']::text[]),
  ('public.faolla_attendance_review_routing_choose_v1(text,text,uuid,jsonb,uuid,timestamptz)','b60959dc2a537c238c0deedc03a3f240a10a441fab54261afcd9a1cec9eb144d','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_origin','p_owner','p_at']::text[]),
  ('public.faolla_attendance_review_routing_make_v1(text,jsonb,uuid,bigint,text,uuid,timestamptz,text,uuid,jsonb,jsonb,text)','c8c2cf0b9863ba02d74d2a57d80ecc1c799855ef9267e60fbd8cfa6862018763','jsonb','s','plpgsql',false,false,0,array['p_site','p_ref','p_op','p_revision','p_action','p_actor','p_at','p_reason','p_previous','p_origin','p_assignment','p_fingerprint']::text[]),
  ('public.faolla_attendance_review_routing_entry_v1(public.merchant_attendance_review_responsibility_entries)','c7ad8af0b4ae7950ba4d322112b8ec5282ea532b2f5f9432460e67500b4ef61b','jsonb','v','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_observe_v1(text,text,uuid,timestamptz)','c67fdd792c1ea719c2ce86cd88beb40d057920b66ad5f892b45ad9c1f91e7167','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_at']::text[]),
  ('public.faolla_attendance_review_routing_capture_v1()','58342d0420d4a28f4756b3876ba0ac67be750ec379c5a4429615fa967fc63dc3','trigger','v','plpgsql',true,false,0,array[]::text[]),
  ('public.faolla_attendance_review_routing_guard_v1()','b66673e41caf7849bf516cd94f952ca5d722adf3bedd53fa553717aeb698d35c','trigger','v','plpgsql',true,false,0,array[]::text[]),
  ('public.faolla_attendance_review_routing_query_v1(jsonb)','2982cdf9b06ec8a079c4fbb53f18157d120d489a154c4c846783be2e5f97d5e6','void','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_receipt_v1(public.merchant_attendance_review_responsibility_entries)','1f46dc51aaf7b2d8d786d8980c542d645152750f9289faa42af1632060a19a90','jsonb','v','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_v1(jsonb,uuid,jsonb,boolean)','159b511971d0b194a328507c77c5126de8b5e2400ea99f048ff0af957d8733ff','jsonb','v','plpgsql',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[])
 ) own(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility or info.lanname is distinct from expected.language_name
   or info.prorettype is distinct from to_regtype(expected.result_type) or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults
   or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries',array['merchant_id','family','request_id','operation_id','revision','actor_auth_user_id','recorded_at','worker_id','employee_id','employee_auth_user_id','request_ref','entry','command','source_ref','authority']::text[],array['text','text','uuid','uuid','bigint','uuid','timestamp with time zone','uuid','uuid','uuid','jsonb','jsonb','jsonb','jsonb','jsonb']::text[],array['command','source_ref','authority']::text[],8,4),
  ('merchant_attendance_review_responsibility_heads',array['merchant_id','family','request_id','revision','operation_id','recorded_at','worker_id','employee_id','employee_auth_user_id']::text[],array['text','text','uuid','bigint','uuid','timestamp with time zone','uuid','uuid','uuid']::text[],array[]::text[],3,2)
 ) tbl(table_name,columns,types,nullable_columns,constraints,triggers) loop
  t:=to_regclass('public.'||expected.table_name);
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or array(select a.attname::text from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.columns
   or array(select format_type(a.atttypid,a.atttypmod) from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.types
   or exists(select 1 from pg_attribute a where a.attrelid=t and a.attnum>0 and (a.attisdropped or a.attnotnull=(a.attname=any(expected.nullable_columns)) or a.atthasdef or a.attidentity<>'' or a.attgenerated<>'' or a.attndims<>0))
   or (select count(*) from pg_constraint where conrelid=t and contype<>'t')<>expected.constraints
   or (select count(*) from pg_index where indrelid=t)<>2 or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>expected.triggers
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  end loop;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_pk','p',array['merchant_id','family','operation_id']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_stream_uq','u',array['merchant_id','family','request_id','revision']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_site_fk','f',array['merchant_id']::text[],'merchant_attendance_settings',array['merchant_id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_worker_fk','f',array['merchant_id','worker_id']::text[],'merchant_attendance_workers',array['merchant_id','id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_employee_fk','f',array['merchant_id','employee_id']::text[],'merchant_enterprise_employees',array['merchant_id','id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_family_ck','c',array[]::text[],null::text,array[]::text[],'family=any(array[''correction'',''correction_revision'',''missing'',''missing_revision'',''leave'',''work_arrangement'']::text[])'),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_revision_ck','c',array[]::text[],null::text,array[]::text[],'revision>=1::bigint and revision<=9007199254740990::bigint and isfinite(recorded_at)'),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_bytes_ck','c',array[]::text[],null::text,array[]::text[],'octet_length(convert_to(jsonb_build_array(request_ref,entry,command,source_ref,authority)::text,''UTF8''))<=32768'),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_pk','p',array['merchant_id','family','request_id']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_entry_fk','f',array['merchant_id','family','operation_id']::text[],'merchant_attendance_review_responsibility_entries',array['merchant_id','family','operation_id']::text[],null::text),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_revision_ck','c',array[]::text[],null::text,array[]::text[],'revision>=1::bigint and revision<=9007199254740990::bigint and isfinite(recorded_at)')
 ) constraint_spec(table_name,constraint_name,kind,keys,referenced_table,referenced_keys,expression_text) loop
  t:=to_regclass('public.'||expected.table_name);
  select * into con from pg_constraint x where x.conrelid=t and x.conname=expected.constraint_name;
  if con.oid is null or con.contype::text is distinct from expected.kind or not con.convalidated or con.condeferrable or con.condeferred or expected.kind='c' and con.connoinherit then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  if expected.kind='c' then
   --Only insignificant formatting and explicit scalar casts are normalized; no operators or literals are removed.
   expression_value:=lower(replace(regexp_replace(regexp_replace(pg_get_expr(con.conbin,t),'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g'),chr(39),''));
   if expression_value is distinct from lower(replace(regexp_replace(regexp_replace(expected.expression_text,'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g'),chr(39),'')) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  else
   if array(select a.attname::text from unnest(con.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=t and a.attnum=k.attnum order by k.n) is distinct from expected.keys then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
   if expected.kind='f' then
    if con.confrelid is distinct from to_regclass('public.'||expected.referenced_table) or con.confupdtype<>'a' or con.confdeltype<>'a' or con.confmatchtype<>'s'
     or array(select a.attname::text from unnest(con.confkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.attnum order by k.n) is distinct from expected.referenced_keys then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
   elsif not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indexrelid=con.conindid and i.indrelid=t and c.relowner=expected_owner
    and am.amname='btree' and i.indisunique and i.indisvalid and i.indisready and i.indislive and not i.indisexclusion and i.indpred is null and i.indexprs is null
    and i.indnatts=cardinality(expected.keys) and i.indnkeyatts=cardinality(expected.keys)) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  end if;
 end loop;
 idx:=to_regclass('public.attendance_review_responsibility_list_idx');t:='public.merchant_attendance_review_responsibility_heads'::regclass;
 if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indexrelid=idx and i.indrelid=t and c.relowner=expected_owner and am.amname='btree'
  and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null and i.indnatts=4 and i.indnkeyatts=4
  and array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=t and a.attnum=k.attnum order by k.n)=array['merchant_id','recorded_at','family','request_id']
  and i.indoption[0]=0 and i.indoption[1]=3 and i.indoption[2]=0 and i.indoption[3]=3
  and i.indcollation[2]='pg_catalog."C"'::regcollation
  and not exists(select 1 from generate_series(0,3) z where (z<>2 and i.indcollation[z] is distinct from (select a.attcollation from pg_attribute a where a.attrelid=t and a.attnum=i.indkey[z]))
   or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=t and a.attnum=i.indkey[z] where o.oid=i.indclass[z] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries','review_routing_entry_before',7,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_immutable',27,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_no_truncate',34,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_proof',5,true,true),
  ('merchant_attendance_review_responsibility_heads','review_routing_head_before',31,false,false),
  ('merchant_attendance_review_responsibility_heads','review_routing_no_truncate',34,false,false)
 ) trigger_spec(table_name,trigger_name,trigger_type,is_deferred,initially_deferred) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||expected.table_name) and tgname=expected.trigger_name and tgtype=expected.trigger_type and tgenabled='O'
   and tgnargs=0 and tgqual is null and tgdeferrable=expected.is_deferred and tginitdeferred=expected.initially_deferred and tgfoid='public.faolla_attendance_review_routing_guard_v1()'::regprocedure) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
end;
$routing_index_ready$;

create table if not exists public.merchant_attendance_review_responsibility_entries(
 merchant_id text not null,family text not null,request_id uuid not null,
 operation_id uuid not null,revision bigint not null,actor_auth_user_id uuid not null,recorded_at timestamptz not null,
 worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
 request_ref jsonb not null,entry jsonb not null,command jsonb,source_ref jsonb,authority jsonb,
 constraint review_routing_entries_pk primary key(merchant_id,family,operation_id),
 constraint review_routing_entries_stream_uq unique(merchant_id,family,request_id,revision),
 constraint review_routing_entries_site_fk foreign key(merchant_id) references public.merchant_attendance_settings(merchant_id),
 constraint review_routing_entries_worker_fk foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
 constraint review_routing_entries_employee_fk foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
 constraint review_routing_entries_family_ck check(family=any(array['correction','correction_revision','missing','missing_revision','leave','work_arrangement']::text[])),
 constraint review_routing_entries_revision_ck check(revision>=1::bigint and revision<=9007199254740990::bigint and isfinite(recorded_at)),
 constraint review_routing_entries_bytes_ck check(octet_length(convert_to(jsonb_build_array(request_ref,entry,command,source_ref,authority)::text,'UTF8'))<=32768)
);
create table if not exists public.merchant_attendance_review_responsibility_heads(
 merchant_id text not null,family text not null,request_id uuid not null,revision bigint not null,
 operation_id uuid not null,recorded_at timestamptz not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
 constraint review_routing_heads_pk primary key(merchant_id,family,request_id),
 constraint review_routing_heads_entry_fk foreign key(merchant_id,family,operation_id) references public.merchant_attendance_review_responsibility_entries(merchant_id,family,operation_id),
 constraint review_routing_heads_revision_ck check(revision>=1::bigint and revision<=9007199254740990::bigint and isfinite(recorded_at))
);
create index if not exists attendance_review_responsibility_list_idx on public.merchant_attendance_review_responsibility_heads
 (merchant_id,recorded_at desc,family collate "C",request_id desc);

create or replace function public.faolla_attendance_review_routing_tuple_v1(p jsonb,p_kind text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;keys text[];t jsonb;v jsonb;n bigint;
begin
 if p_kind='request' then keys:=array['family','category','requestId','workerId','employeeId','employeeAuthUserId','submittedRevision','submittedAt','kind'];
 elsif p_kind='desired' then keys:=case p->>'kind' when 'owner' then array['kind'] when 'delegate' then array['kind','employeeId','authUserId'] else null end;
 elsif p_kind='origin' then keys:=case p->>'kind' when 'manual_registration' then array['kind'] when 'rule_capture' then array['kind','activationRevision','observedAt','sourceFingerprint','selection','selectedLayer','desired'] else null end;
 elsif p_kind='assignment' then keys:=case p->>'kind' when 'owner' then array['kind','authUserId'] when 'delegate' then array['kind','employeeId','authUserId','grantId','grantType','delegateGeneration','employeeGeneration','epochProofKind','validFrom','validUntil'] when 'needs_assignment' then array['kind','reason','desired'] else null end;
 elsif p_kind='command' then keys:=array['action','operationId','expectedResponsibilityRevision','expectedResponsibilityOperationId','expectedRequestRevision','expectedObservationFingerprint','grantId','reason'];
 else raise exception 'attendance_review_routing_invalid';end if;
 if keys is null or public.faolla_attendance_operational_rule_object_v1(p,keys) is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
 foreach k in array keys loop
  v:=p->k;
  if k in('requestId','workerId','employeeId','employeeAuthUserId','authUserId','operationId') or k='grantId' and v<>'null'::jsonb then
   if public.faolla_attendance_operational_rule_scalar_v1(v,'uuid') is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
  elsif k='expectedResponsibilityOperationId' and v<>'null'::jsonb then
   if public.faolla_attendance_operational_rule_scalar_v1(v,'uuid') is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
  elsif k in('submittedRevision','activationRevision','expectedRequestRevision') then
   if public.faolla_attendance_operational_rule_scalar_v1(v,'positive') is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
  elsif k in('delegateGeneration','employeeGeneration','expectedResponsibilityRevision') then
   if public.faolla_attendance_operational_rule_scalar_v1(v,'revision') is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
  elsif k in('submittedAt','observedAt','validFrom','validUntil') then
   if jsonb_typeof(v) is distinct from 'string' then raise exception 'attendance_review_routing_invalid';end if;
   perform public.faolla_attendance_operational_source_stamp_v1(v#>>'{}');
  elsif k in('sourceFingerprint','expectedObservationFingerprint') then
   if public.faolla_attendance_operational_rule_scalar_v1(v,'hash') is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
  end if;
 end loop;
 if p_kind='request' then
  if p->>'family' is null or p->>'family' not in('correction','correction_revision','missing','missing_revision','leave','work_arrangement')
   or p->>'category' is distinct from (case p->>'family' when 'correction_revision' then 'correction' when 'missing_revision' then 'missing' else p->>'family' end)
   or (p->>'family'='work_arrangement' and (p->>'kind' is null or p->>'kind' not in('trip','field','remote'))) or (p->>'family'<>'work_arrangement' and p->'kind'<>'null'::jsonb) then raise exception 'attendance_review_routing_invalid';end if;
  return jsonb_build_array(p->>'family',p->>'category',p->>'requestId',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId',p->'submittedRevision',p->>'submittedAt',p->'kind');
 elsif p_kind='desired' then
  if p->>'kind'='owner' then return jsonb_build_array('owner');end if;
  return jsonb_build_array('delegate',p->>'employeeId',p->>'authUserId');
 elsif p_kind='origin' then
  if p->>'kind'='manual_registration' then return jsonb_build_array('manual_registration');end if;
  if p->>'selection' is null or p->>'selection' not in('value','disabled','unconfigured','owner_only_revision')
   or p->'selectedLayer' not in('null'::jsonb,'"enterprise"'::jsonb,'"group"'::jsonb,'"personal"'::jsonb)
   or (p->>'selection' in('unconfigured','owner_only_revision'))<>(p->'selectedLayer'='null'::jsonb) then raise exception 'attendance_review_routing_invalid';end if;
  return jsonb_build_array('rule_capture',p->'activationRevision',p->>'observedAt',p->>'sourceFingerprint',p->>'selection',p->'selectedLayer',public.faolla_attendance_review_routing_tuple_v1(p->'desired','desired'));
 elsif p_kind='assignment' then
  if p->>'kind'='owner' then return jsonb_build_array('owner',p->>'authUserId');
  elsif p->>'kind'='delegate' then
   if p->>'grantId' is null or p->>'grantType' is null or p->>'grantType' not in('correction','missing','application') or p->>'epochProofKind' is null or p->>'epochProofKind' not in('embedded','sidecar','pre_epoch_zero')
    or (p->>'validFrom')::timestamptz>=(p->>'validUntil')::timestamptz then raise exception 'attendance_review_routing_invalid';end if;
   return jsonb_build_array('delegate',p->>'employeeId',p->>'authUserId',p->>'grantId',p->>'grantType',p->'delegateGeneration',p->'employeeGeneration',p->>'epochProofKind',p->>'validFrom',p->>'validUntil');
  end if;
  if p->>'reason' is null or p->>'reason' not in('no_grant','ambiguous_grant','candidate_limit','source_scope_unavailable')
   or public.faolla_attendance_operational_rule_object_v1(p->'desired',array['employeeId','authUserId']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p->'desired'->'employeeId','uuid') is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p->'desired'->'authUserId','uuid') is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
  return jsonb_build_array('needs_assignment',p->>'reason',jsonb_build_array(p->'desired'->>'employeeId',p->'desired'->>'authUserId'));
 else
  n:=(p->>'expectedResponsibilityRevision')::bigint;
  if p->>'action' is null or p->>'action' not in('register','take_over') or n>=9007199254740990
   or (n=0)<>(p->'expectedResponsibilityOperationId'='null'::jsonb)
   or (p->>'action'='take_over')<>(p->'grantId'='null'::jsonb)
   or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,200) is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
  return jsonb_build_array(p->>'action',p->>'operationId',n,p->'expectedResponsibilityOperationId',p->'expectedRequestRevision',p->>'expectedObservationFingerprint',p->'grantId',p->>'reason');
 end if;
end;
$$;

--The incomplete branch is exclusively for an AFTER request INSERT, before its
--old entry/binding is added. The deferred ledger guard always requests complete.
create or replace function public.faolla_attendance_review_routing_fact_v1(p_site text,p_family text,p_request uuid,p_complete boolean)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare c public.merchant_attendance_correction_entries%rowtype;ct public.merchant_attendance_correction_entries%rowtype;cb public.merchant_attendance_correction_rule_bindings%rowtype;
 r public.merchant_attendance_revision_requests%rowtype;rt public.merchant_attendance_revision_requests%rowtype;
 m public.merchant_attendance_missing_requests%rowtype;me public.merchant_attendance_missing_entries%rowtype;
 l public.merchant_attendance_leave_requests%rowtype;le public.merchant_attendance_leave_entries%rowtype;
 w public.merchant_attendance_work_arrangement_requests%rowtype;we public.merchant_attendance_work_arrangement_entries%rowtype;
 ref jsonb;raw jsonb;summary jsonb;head_op uuid;head_rev bigint;status_name text:='submitted';submitted_rev bigint:=1;kind_name text;
 wid uuid;eid uuid;au uuid;submitted timestamptz;decision record;
begin
 if p_site is null or p_request is null or p_complete is null then raise exception 'attendance_review_routing_invalid';end if;
 if p_family='correction' then
  select * into c from public.merchant_attendance_correction_entries x where x.merchant_id=p_site and x.request_id=p_request and x.action='submit';
  if c.operation_id is null then return null;end if;
  if c.operation_id<>p_request then raise exception 'attendance_review_routing_invalid';end if;
  wid:=c.worker_id;eid:=c.employee_id;au:=c.actor_auth_user_id;submitted:=c.recorded_at;submitted_rev:=c.revision;raw:=to_jsonb(c);
  select * into ct from public.merchant_attendance_correction_entries x where x.merchant_id=p_site and x.request_id=p_request order by x.revision desc limit 1;
  head_rev:=ct.revision;head_op:=ct.operation_id;status_name:=case when ct.action='withdraw' then 'withdrawn' else 'submitted' end;
  select x.operation_id,x.action into decision from public.merchant_attendance_correction_decisions x where x.merchant_id=p_site and x.request_id=p_request;
  if decision.operation_id is not null then status_name:=case decision.action when 'approve' then 'approved' else 'rejected' end;head_op:=decision.operation_id;end if;
  if p_complete then
   select * into cb from public.merchant_attendance_correction_rule_bindings x where x.merchant_id=p_site and x.request_id=p_request;
   if cb.request_id is not null and (cb.recorded_at<>submitted or (cb.command-'expectedPolicyRevision') is distinct from c.command
    or cb.command->'expectedPolicyRevision' is distinct from to_jsonb(cb.policy_revision)) then raise exception 'attendance_review_routing_invalid';end if;
   --Legacy pre085 requests remain observable/manual-registerable. A new capture
   --must additionally have its deferred binding (checked by entry_v1 below).
   if public.faolla_attendance_operational_rule_object_v1(c.command,array['action','operationId','expectedRevision','reason','startEventId','expectedLastEventId','proposal']) is distinct from true
    or c.command->>'action' is distinct from 'submit' or c.command->>'operationId' is distinct from c.operation_id::text
    or c.command->'expectedRevision' is distinct from to_jsonb(c.revision-1) or c.command->>'reason' is distinct from c.reason
    or c.command->>'startEventId' is distinct from c.start_event_id::text or c.command->>'expectedLastEventId' is distinct from c.basis->'events'->-1->>'id'
    or public.faolla_attendance_correction_proposal_v1(c.command->'proposal',c.recorded_at) is distinct from c.proposal
    or c.basis->>'workerId' is distinct from c.worker_id::text or c.basis->>'employeeId' is distinct from c.employee_id::text then raise exception 'attendance_review_routing_invalid';end if;
   perform public.faolla_attendance_correction_summary_v1(c,ct);
  end if;
 elsif p_family='correction_revision' then
  select * into r from public.merchant_attendance_revision_requests x where x.merchant_id=p_site and x.request_id=p_request and x.action='submit';
  if r.operation_id is null then return null;end if;
  select * into c from public.merchant_attendance_correction_entries x where x.merchant_id=p_site and x.operation_id=r.base_request_id and x.action='submit';
  if r.operation_id<>p_request or c.operation_id is null or row(c.worker_id,c.employee_id,c.actor_auth_user_id) is distinct from row(r.worker_id,r.employee_id,r.actor_auth_user_id)
   or r.command->>'operationId' is distinct from p_request::text or r.command->>'action' is distinct from 'submit' then raise exception 'attendance_review_routing_invalid';end if;
  if p_complete then
   if public.faolla_attendance_operational_rule_object_v1(r.command,case when r.command ? 'expectedEffectiveOperationId'
     then array['action','operationId','expectedRevision','reason','proposal','expectedBaseOperationId','expectedPolicyRevision','expectedEffectiveOperationId']
     else array['action','operationId','expectedRevision','reason','proposal','expectedBaseOperationId','expectedPolicyRevision'] end) is distinct from true
    or r.command->'expectedRevision' is distinct from to_jsonb(r.revision-1) or r.command->'expectedPolicyRevision' is distinct from to_jsonb(r.policy_revision)
    or r.command->>'expectedBaseOperationId' is distinct from r.base_operation_id::text
    or jsonb_typeof(r.command->'reason') is distinct from 'string' or char_length(r.command->>'reason') not between 1 and 500
    or r.command->>'reason'<>btrim(r.command->>'reason') or r.command->>'reason' ~ '[[:cntrl:]]'
    or r.command ? 'expectedEffectiveOperationId' and public.faolla_attendance_operational_rule_scalar_v1(r.command->'expectedEffectiveOperationId','uuid') is distinct from true then raise exception 'attendance_review_routing_invalid';end if;
   perform public.faolla_attendance_correction_proposal_v1(r.command->'proposal',r.recorded_at);
   if not exists(select 1 from public.merchant_attendance_correction_effects x where x.merchant_id=p_site and x.request_id=r.base_request_id
     and x.operation_id=r.base_operation_id and x.worker_id=r.worker_id and x.recorded_at<r.recorded_at)
    or r.command ? 'expectedEffectiveOperationId' and r.command->>'expectedEffectiveOperationId'<>r.base_operation_id::text
     and not exists(select 1 from public.merchant_attendance_effect_versions x where x.merchant_id=p_site and x.operation_id=(r.command->>'expectedEffectiveOperationId')::uuid
      and x.root_request_id=r.base_request_id and x.worker_id=r.worker_id and x.recorded_at<r.recorded_at) then raise exception 'attendance_review_routing_invalid';end if;
  end if;
  wid:=r.worker_id;eid:=r.employee_id;au:=r.actor_auth_user_id;submitted:=r.recorded_at;submitted_rev:=r.revision;raw:=to_jsonb(r);
  select * into rt from public.merchant_attendance_revision_requests x where x.merchant_id=p_site and x.request_id=p_request order by x.revision desc limit 1;
  head_rev:=rt.revision;head_op:=rt.operation_id;status_name:=case when rt.action='withdraw' then 'withdrawn' else 'submitted' end;
  select x.operation_id,x.action into decision from public.merchant_attendance_revision_decisions x where x.merchant_id=p_site and x.request_id=p_request;
  if decision.operation_id is not null then status_name:=case decision.action when 'approve' then 'approved' else 'rejected' end;head_op:=decision.operation_id;end if;
 elsif p_family in('missing','missing_revision') then
  select * into m from public.merchant_attendance_missing_requests x where x.merchant_id=p_site and x.request_id=p_request;
  if m.request_id is null then return null;end if;
  if (p_family='missing_revision')<>(m.supersedes_request_id is not null) then raise exception 'attendance_review_routing_not_found';end if;
  wid:=m.worker_id;eid:=m.employee_id;au:=m.actor_auth_user_id;submitted:=m.submitted_at;raw:=to_jsonb(m);
  select * into me from public.merchant_attendance_missing_entries x where x.merchant_id=p_site and x.request_id=p_request and x.revision=1;
  if p_complete and (me.operation_id is null or me.operation_id<>p_request or me.action<>'submit' or me.actor_auth_user_id<>au or me.recorded_at<>submitted
   or me.command->>'operationId' is distinct from p_request::text or me.command->'proposal' is distinct from m.proposal or me.command->>'expectedWorkerId' is distinct from wid::text
   or me.command->>'action' is distinct from (case p_family when 'missing_revision' then 'revise' else 'submit' end)
   or me.command->>'supersedesRequestId' is distinct from m.supersedes_request_id::text
   or me.command->>'expectedApprovalOperationId' is distinct from m.supersedes_operation_id::text
   or me.command->>'reason' is distinct from m.reason or me.command->>'locationId' is distinct from m.location_id::text
   or me.command->>'timeZone' is distinct from m.time_zone or me.command->'expectedPolicyRevision' is distinct from to_jsonb(m.policy_revision)
   or public.faolla_attendance_operational_rule_scalar_v1(me.command->'expectedSettingsVersion','positive') is distinct from true
   or public.faolla_attendance_operational_rule_object_v1(me.command,case p_family when 'missing_revision'
    then array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal','supersedesRequestId','expectedApprovalOperationId']
    else array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal'] end) is distinct from true) then raise exception 'attendance_review_routing_invalid';end if;
  select * into me from public.merchant_attendance_missing_entries x where x.merchant_id=p_site and x.request_id=p_request order by x.revision desc limit 1;
  head_rev:=coalesce(me.revision,1);head_op:=coalesce(me.operation_id,p_request);status_name:=case me.action when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' else 'submitted' end;
  if p_complete then
   if p_family='missing_revision' and not exists(select 1 from public.merchant_attendance_missing_requests parent
    join public.merchant_attendance_missing_requests root on root.merchant_id=parent.merchant_id and root.request_id=coalesce(parent.root_request_id,parent.request_id)
    join public.merchant_attendance_missing_entries approval on approval.merchant_id=parent.merchant_id and approval.operation_id=m.supersedes_operation_id
    where parent.merchant_id=p_site and parent.request_id=m.supersedes_request_id and root.request_id=m.root_request_id and root.supersedes_request_id is null
     and (parent.worker_id,parent.employee_id,parent.actor_auth_user_id)=(m.worker_id,m.employee_id,m.actor_auth_user_id)
     and (root.worker_id,root.employee_id,root.actor_auth_user_id)=(m.worker_id,m.employee_id,m.actor_auth_user_id)
     and approval.request_id=parent.request_id and approval.action='approve' and approval.recorded_at<m.submitted_at)
    then raise exception 'attendance_review_routing_invalid';end if;
   perform public.faolla_attendance_missing_summary_v1(m);
  end if;
 elsif p_family='leave' then
  select * into l from public.merchant_attendance_leave_requests x where x.merchant_id=p_site and x.request_id=p_request;
  if l.request_id is null then return null;end if;
  wid:=l.worker_id;eid:=l.employee_id;au:=l.actor_auth_user_id;submitted:=l.submitted_at;raw:=to_jsonb(l);
  if p_complete then summary:=public.faolla_attendance_leave_summary_v1(l);end if;
  select * into le from public.merchant_attendance_leave_entries x where x.merchant_id=p_site and x.request_id=p_request order by x.revision desc limit 1;
  head_rev:=coalesce(le.revision,1);head_op:=coalesce(le.operation_id,p_request);status_name:=coalesce(summary->>'status','submitted');
 elsif p_family='work_arrangement' then
  select * into w from public.merchant_attendance_work_arrangement_requests x where x.merchant_id=p_site and x.request_id=p_request;
  if w.request_id is null then return null;end if;
  wid:=w.worker_id;eid:=w.employee_id;au:=w.actor_auth_user_id;submitted:=w.submitted_at;kind_name:=w.kind;raw:=to_jsonb(w);
  if p_complete then summary:=public.faolla_attendance_work_arrangement_summary_v1(w);end if;
  select * into we from public.merchant_attendance_work_arrangement_entries x where x.merchant_id=p_site and x.request_id=p_request order by x.revision desc limit 1;
  head_rev:=coalesce(we.revision,1);head_op:=coalesce(we.operation_id,p_request);status_name:=coalesce(summary->>'status','submitted');
 else raise exception 'attendance_review_routing_invalid';end if;
 ref:=jsonb_build_object('family',p_family,'category',case p_family when 'correction_revision' then 'correction' when 'missing_revision' then 'missing' else p_family end,
  'requestId',p_request,'workerId',wid,'employeeId',eid,'employeeAuthUserId',au,'submittedRevision',submitted_rev,'submittedAt',public.faolla_attendance_operational_punch_stamp_v1(submitted),'kind',kind_name);
 perform public.faolla_attendance_review_routing_tuple_v1(ref,'request');
 return jsonb_build_object('request',ref,'row',raw,'requestRevision',head_rev,'requestHeadOperationId',head_op,'status',status_name);
end;
$$;
create or replace function public.faolla_attendance_review_routing_request_v1(p_site text,p_family text,p_request uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
begin return public.faolla_attendance_review_routing_fact_v1(p_site,p_family,p_request,true);end;
$$;

create or replace function public.faolla_attendance_review_routing_grant_v1(p_site text,p_family text,p_grant uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare c public.merchant_attendance_correction_delegations%rowtype;m public.merchant_attendance_missing_delegations%rowtype;a public.merchant_attendance_application_delegations%rowtype;
 ep public.merchant_attendance_delegation_epochs%rowtype;g jsonb;kind_name text;epoch_kind text;dg bigint;eg bigint;fp text;
begin
 if p_family='correction' then
  select * into c from public.merchant_attendance_correction_delegations x where x.merchant_id=p_site and x.grant_id=p_grant;if c.grant_id is null then return null;end if;
  g:=to_jsonb(c);kind_name:='correction';epoch_kind:='embedded';dg:=c.delegate_generation;eg:=c.employee_generation;
  fp:=public.faolla_attendance_correction_delegation_hash_v1(p_site,'owner',c.command);
 elsif p_family in('missing','missing_revision') then
  select * into m from public.merchant_attendance_missing_delegations x where x.merchant_id=p_site and x.grant_id=p_grant;if m.grant_id is null then return null;end if;
  g:=to_jsonb(m);kind_name:='missing';fp:=public.faolla_attendance_missing_delegation_hash_v1(p_site,'owner',m.command);
 elsif p_family in('leave','work_arrangement') then
  select * into a from public.merchant_attendance_application_delegations x where x.merchant_id=p_site and x.grant_id=p_grant and x.category=p_family;if a.grant_id is null then return null;end if;
  g:=to_jsonb(a);kind_name:='application';fp:=public.faolla_attendance_application_delegation_hash_v1(p_site,'owner',a.command);
 else return null;end if;
 if fp is distinct from g->>'command_fingerprint' then raise exception 'attendance_review_routing_invalid';end if;
 if kind_name<>'correction' then
  select * into ep from public.merchant_attendance_delegation_epochs x where x.merchant_id=p_site and x.channel=kind_name and x.grant_id=p_grant;
  if ep.grant_id is null then epoch_kind:='pre_epoch_zero';dg:=0;eg:=0;
  else
   if row(ep.delegate_employee_id,ep.delegate_auth_user_id,ep.employee_id,ep.employee_auth_user_id) is distinct from
    row((g->>'delegate_employee_id')::uuid,(g->>'delegate_auth_user_id')::uuid,(g->>'employee_id')::uuid,(g->>'employee_auth_user_id')::uuid) then raise exception 'attendance_review_routing_invalid';end if;
   epoch_kind:='sidecar';dg:=ep.delegate_generation;eg:=ep.employee_generation;
  end if;
 end if;
 return jsonb_build_object('row',g,'assignment',jsonb_build_object('kind','delegate','employeeId',g->'delegate_employee_id','authUserId',g->'delegate_auth_user_id',
  'grantId',p_grant,'grantType',kind_name,'delegateGeneration',dg,'employeeGeneration',eg,'epochProofKind',epoch_kind,
  'validFrom',public.faolla_attendance_operational_punch_stamp_v1((g->>'valid_from')::timestamptz),'validUntil',public.faolla_attendance_operational_punch_stamp_v1((g->>'valid_until')::timestamptz)),
  'grantFingerprint',fp);
end;
$$;

create or replace function public.faolla_attendance_review_routing_qualify_v1(p_site text,p_family text,p_request uuid,p_grant uuid,p_at timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare fact jsonb;ref jsonb;g jsonb;grant_value jsonb;basis jsonb;reason_name text;usable boolean:=false;scope_ok boolean:=true;code text;
 c public.merchant_attendance_correction_delegations%rowtype;m public.merchant_attendance_missing_delegations%rowtype;a public.merchant_attendance_application_delegations%rowtype;
begin
 if p_at is null or not isfinite(p_at) then raise exception 'attendance_review_routing_invalid';end if;
 fact:=public.faolla_attendance_review_routing_fact_v1(p_site,p_family,p_request,false);ref:=fact->'request';
 grant_value:=public.faolla_attendance_review_routing_grant_v1(p_site,p_family,p_grant);g:=grant_value->'row';
 if fact is null or grant_value is null then return null;end if;
 if row(g->>'worker_id',g->>'employee_id',g->>'employee_auth_user_id') is distinct from row(ref->>'workerId',ref->>'employeeId',ref->>'employeeAuthUserId')
  or g->>'delegate_employee_id'=ref->>'employeeId' or g->>'delegate_auth_user_id'=ref->>'employeeAuthUserId' then return null;end if;
 perform 1 from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id in((g->>'delegate_employee_id')::uuid,(ref->>'employeeId')::uuid) order by x.id for share;
 perform 1 from public.merchant_enterprise_roles x where x.merchant_id=p_site and x.id in(select e.role_id from public.merchant_enterprise_employees e
  where e.merchant_id=p_site and e.id in((g->>'delegate_employee_id')::uuid,(ref->>'employeeId')::uuid)) order by x.id for share;
 if p_family='correction' then
  c:=jsonb_populate_record(null::public.merchant_attendance_correction_delegations,g);
  perform 1 from public.merchant_attendance_locations x where x.merchant_id=p_site and x.id=c.location_id for share;
  usable:=public.faolla_attendance_correction_delegation_usable_v1(c,p_at);
  scope_ok:=(c.include_pending or (ref->>'submittedAt')::timestamptz>c.recorded_at)
   and public.faolla_attendance_correction_delegation_scope_v1(fact->'row'->'basis',c.location_id);
  if usable and scope_ok then
   begin
    basis:=public.faolla_attendance_correction_owner_basis_v1(p_site,c.worker_id,c.employee_id,(fact->'row'->>'start_event_id')::uuid,p_at);
    if basis->'currentBasis'<>'null'::jsonb and public.faolla_attendance_correction_delegation_scope_v1(basis->'currentBasis',c.location_id) is distinct from true then scope_ok:=false;end if;
    perform public.faolla_attendance_correction_delegation_original_v1(fact->'row'->'basis',p_at);
   exception when raise_exception then
    code:=sqlerrm;
    if code not in('attendance_session_not_found','attendance_session_invalid_records','attendance_session_too_large','attendance_session_span_too_long','attendance_correction_unsupported_basis','attendance_correction_delegation_too_large') then raise;end if;
    scope_ok:=false;
   end;
  end if;
 elsif p_family in('missing','missing_revision') then
  m:=jsonb_populate_record(null::public.merchant_attendance_missing_delegations,g);
  perform 1 from public.merchant_attendance_locations x where x.merchant_id=p_site and x.id=m.location_id for share;
  usable:=public.faolla_attendance_missing_delegation_usable_v1(m,p_at);
  scope_ok:=fact->'row'->>'location_id'=m.location_id::text;
 else
  a:=jsonb_populate_record(null::public.merchant_attendance_application_delegations,g);
  usable:=public.faolla_attendance_application_delegation_usable_v1(a,p_at);
  scope_ok:=(a.include_pending or (ref->>'submittedAt')::timestamptz>=a.recorded_at)
   and (p_family='leave' or a.kinds ? (ref->>'kind'));
 end if;
 usable:=coalesce(usable,false) and (g->>'recorded_at')::timestamptz<=p_at
  and clock_timestamp()>=(g->>'valid_from')::timestamptz and clock_timestamp()<(g->>'valid_until')::timestamptz;
 reason_name:=case when not usable then 'grant_unavailable' when scope_ok is distinct from true then 'scope_unavailable' else null end;
 return jsonb_build_object('usable',reason_name is null,'reason',reason_name,'assignment',grant_value->'assignment',
  'authority',jsonb_build_object('grantType',grant_value->'assignment'->'grantType','grantId',p_grant,'grantFingerprint',grant_value->'grantFingerprint',
   'epochProofKind',grant_value->'assignment'->'epochProofKind','delegateGeneration',grant_value->'assignment'->'delegateGeneration',
   'employeeGeneration',grant_value->'assignment'->'employeeGeneration','authorizedAt',public.faolla_attendance_operational_punch_stamp_v1(p_at)),
  'option',jsonb_build_object('grantId',p_grant,'delegateEmployeeId',g->'delegate_employee_id','delegateAuthUserId',g->'delegate_auth_user_id','delegateName',g->'delegate_name',
   'validFrom',grant_value->'assignment'->'validFrom','validUntil',grant_value->'assignment'->'validUntil','usable',reason_name is null,'reason',reason_name));
end;
$$;

--Raw immutable candidates are bounded BEFORE expensive qualification. With a
--sentinel we do not claim global uniqueness. Manual point-selection stays viable.
create or replace function public.faolla_attendance_review_routing_candidates_v1(p_site text,p_ref jsonb,p_delegate jsonb,p_cursor jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare result_value jsonb;category_name text:=p_ref->>'category';wid uuid:=(p_ref->>'workerId')::uuid;eid uuid:=(p_ref->>'employeeId')::uuid;au uuid:=(p_ref->>'employeeAuthUserId')::uuid;
 de uuid:=(p_delegate->>'employeeId')::uuid;da uuid:=(p_delegate->>'authUserId')::uuid;
 ce uuid:=(p_cursor->>'afterDelegateEmployeeId')::uuid;ca uuid:=(p_cursor->>'afterDelegateAuthUserId')::uuid;cg uuid:=(p_cursor->>'afterGrantId')::uuid;
begin
 if p_ref->>'family'='correction_revision' then return '[]';end if;
 if category_name='correction' then
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.delegate_employee_id,candidate.delegate_auth_user_id,candidate.grant_id),'[]') into result_value from
   (select x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id from public.merchant_attendance_correction_delegations x
    where x.merchant_id=p_site and x.worker_id=wid and x.employee_id=eid and x.employee_auth_user_id=au
     and (de is null or x.delegate_employee_id=de and x.delegate_auth_user_id=da)
     and (ce is null or (x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id)>(ce,ca,cg))
    order by x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id limit 26) candidate;
 elsif category_name='missing' then
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.delegate_employee_id,candidate.delegate_auth_user_id,candidate.grant_id),'[]') into result_value from
   (select x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id from public.merchant_attendance_missing_delegations x
    where x.merchant_id=p_site and x.worker_id=wid and x.employee_id=eid and x.employee_auth_user_id=au
     and (de is null or x.delegate_employee_id=de and x.delegate_auth_user_id=da)
     and (ce is null or (x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id)>(ce,ca,cg))
    order by x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id limit 26) candidate;
 else
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.delegate_employee_id,candidate.delegate_auth_user_id,candidate.grant_id),'[]') into result_value from
   (select x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id from public.merchant_attendance_application_delegations x
    where x.merchant_id=p_site and x.worker_id=wid and x.employee_id=eid and x.employee_auth_user_id=au and x.category=category_name
     and (de is null or x.delegate_employee_id=de and x.delegate_auth_user_id=da)
     and (ce is null or (x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id)>(ce,ca,cg))
    order by x.delegate_employee_id,x.delegate_auth_user_id,x.grant_id limit 26) candidate;
 end if;
 return result_value;
end;
$$;

create or replace function public.faolla_attendance_review_routing_origin_v1(p_source jsonb,p_family text,p_activation bigint)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;selected_layer text;selection text:='unconfigured';choice_value jsonb;desired jsonb:=jsonb_build_object('kind','owner');category_name text;v jsonb;
begin
 if p_activation is null or p_activation not between 1 and 9007199254740990
  or p_source->>'sourceFingerprint' is distinct from public.faolla_attendance_operational_rule_hash_v1(public.faolla_attendance_operational_source_tuple_v1(p_source)) then raise exception 'attendance_review_routing_invalid';end if;
 category_name:=case p_family when 'correction_revision' then 'correction' when 'missing_revision' then 'missing' else p_family end;
 if p_family='correction_revision' then selection:='owner_only_revision';
 else
  foreach k in array array['personal','group','enterprise'] loop
   choice_value:=p_source->'layers'->k->'rules'->'reviewRouting';
   if choice_value->>'mode' in('value','disabled') then
    selection:=choice_value->>'mode';selected_layer:=k;
    if selection='value' then
     v:=choice_value->'value'->category_name;
     if v<>'"owner"'::jsonb then desired:=jsonb_build_object('kind','delegate','employeeId',v->'delegateEmployeeId','authUserId',v->'delegateAuthUserId');end if;
    end if;
    exit;
   end if;
  end loop;
 end if;
 v:=jsonb_build_object('kind','rule_capture','activationRevision',p_activation,'observedAt',p_source->'at','sourceFingerprint',p_source->'sourceFingerprint',
  'selection',selection,'selectedLayer',selected_layer,'desired',desired);
 perform public.faolla_attendance_review_routing_tuple_v1(v,'origin');return v;
end;
$$;

create or replace function public.faolla_attendance_review_routing_choose_v1(p_site text,p_family text,p_request uuid,p_origin jsonb,p_owner uuid,p_at timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare fact jsonb;items jsonb;item jsonb;qualified jsonb;chosen jsonb;n integer:=0;scope_failure boolean:=false;assignment jsonb;reason_name text;
begin
 if p_owner is null then raise exception 'attendance_review_routing_invalid';end if;
 perform public.faolla_attendance_review_routing_tuple_v1(p_origin,'origin');
 if p_origin->>'kind'<>'rule_capture' then raise exception 'attendance_review_routing_invalid';end if;
 if p_origin->'desired'->>'kind'='owner' then return jsonb_build_object('assignment',jsonb_build_object('kind','owner','authUserId',p_owner),'authority',null);end if;
 fact:=public.faolla_attendance_review_routing_fact_v1(p_site,p_family,p_request,false);
 if fact is null then raise exception 'attendance_review_routing_invalid';end if;
 items:=public.faolla_attendance_review_routing_candidates_v1(p_site,fact->'request',p_origin->'desired',null);
 if jsonb_array_length(items)=26 then reason_name:='candidate_limit';
 else
  for item in select value from jsonb_array_elements(items) loop
   qualified:=public.faolla_attendance_review_routing_qualify_v1(p_site,p_family,p_request,(item->>'grant_id')::uuid,p_at);
   if qualified->'usable'='true'::jsonb then n:=n+1;chosen:=qualified;end if;
   if qualified->>'reason'='scope_unavailable' then scope_failure:=true;end if;
  end loop;
  if n=1 then return jsonb_build_object('assignment',chosen->'assignment','authority',chosen->'authority');end if;
  reason_name:=case when n>1 then 'ambiguous_grant' when scope_failure then 'source_scope_unavailable' else 'no_grant' end;
 end if;
 assignment:=jsonb_build_object('kind','needs_assignment','reason',reason_name,'desired',(p_origin->'desired')-'kind');
 return jsonb_build_object('assignment',assignment,'authority',null);
end;
$$;

create or replace function public.faolla_attendance_review_routing_make_v1(p_site text,p_ref jsonb,p_op uuid,p_revision bigint,p_action text,p_actor uuid,p_at timestamptz,p_reason text,p_previous uuid,p_origin jsonb,p_assignment jsonb,p_fingerprint text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare t jsonb;v jsonb;stamp text;
begin
 if p_op is null or p_actor is null or p_at is null or not isfinite(p_at) or p_revision is null or p_revision not between 1 and 9007199254740990
  or p_action is null or p_action not in('capture','register','take_over') or (p_revision=1)<>(p_previous is null)
  or (p_action='capture')<>(p_reason is null and p_fingerprint is null)
  or p_action<>'capture' and (public.faolla_attendance_group_text_v1(p_reason,1,200) is distinct from true or public.faolla_attendance_operational_rule_scalar_v1(to_jsonb(p_fingerprint),'hash') is distinct from true)
  then raise exception 'attendance_review_routing_invalid';end if;
 stamp:=public.faolla_attendance_operational_punch_stamp_v1(p_at);
 t:=jsonb_build_array('attendance-review-routing-entry-v1',p_site,public.faolla_attendance_review_routing_tuple_v1(p_ref,'request'),
  p_op,p_revision,p_action,p_actor,stamp,p_reason,p_previous,public.faolla_attendance_review_routing_tuple_v1(p_origin,'origin'),public.faolla_attendance_review_routing_tuple_v1(p_assignment,'assignment'),p_fingerprint);
 v:=jsonb_build_object('operationId',p_op,'revision',p_revision,'action',p_action,'actorId',p_actor,'recordedAt',stamp,'reason',p_reason,'previousOperationId',p_previous,
  'origin',p_origin,'assignment',p_assignment,'commandFingerprint',p_fingerprint,'entryFingerprint',public.faolla_attendance_operational_rule_hash_v1(t));
 return v;
end;
$$;

create or replace function public.faolla_attendance_review_routing_entry_v1(p public.merchant_attendance_review_responsibility_entries)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare fact jsonb;v jsonb;origin jsonb:=p.entry->'origin';assignment jsonb:=p.entry->'assignment';src jsonb;g jsonb;authority_expected jsonb;fp text;
 previous public.merchant_attendance_review_responsibility_entries%rowtype;activation public.merchant_attendance_operational_consumer_activations%rowtype;
begin
 if p.operation_id is null then return null;end if;
 fact:=public.faolla_attendance_review_routing_request_v1(p.merchant_id,p.family,p.request_id);
 if fact is null or fact->'request' is distinct from p.request_ref or row(p.worker_id::text,p.employee_id::text,p.employee_auth_user_id::text) is distinct from
  row(p.request_ref->>'workerId',p.request_ref->>'employeeId',p.request_ref->>'employeeAuthUserId') or p.recorded_at<(p.request_ref->>'submittedAt')::timestamptz then raise exception 'attendance_review_routing_invalid';end if;
 if p.revision>1 then
  select * into previous from public.merchant_attendance_review_responsibility_entries x where x.merchant_id=p.merchant_id and x.family=p.family and x.request_id=p.request_id and x.revision=p.revision-1;
  if previous.operation_id is null or previous.operation_id::text is distinct from p.entry->>'previousOperationId' or previous.recorded_at>p.recorded_at
   or previous.request_ref is distinct from p.request_ref or previous.entry->'origin' is distinct from origin or previous.source_ref is distinct from p.source_ref then raise exception 'attendance_review_routing_invalid';end if;
 end if;
 if origin->>'kind'='rule_capture' then
  if p.source_ref is null then raise exception 'attendance_review_routing_invalid';end if;
  if p.family='correction' and not exists(select 1 from public.merchant_attendance_correction_rule_bindings x where x.merchant_id=p.merchant_id and x.request_id=p.request_id) then raise exception 'attendance_review_routing_invalid';end if;
  src:=public.faolla_attendance_operational_punch_saved_source_v1(p.source_ref);
  if row(src->>'siteId',src->'workerIdentity'->>'workerId',src->'workerIdentity'->>'employeeId',src->'workerIdentity'->>'employeeAuthUserId') is distinct from
   row(p.merchant_id,p.worker_id::text,p.employee_id::text,p.employee_auth_user_id::text)
   or (src->>'at')::timestamptz<(p.request_ref->>'submittedAt')::timestamptz or (src->>'at')::timestamptz>p.recorded_at
   or public.faolla_attendance_review_routing_origin_v1(src,p.family,(origin->>'activationRevision')::bigint) is distinct from origin then raise exception 'attendance_review_routing_invalid';end if;
  select * into activation from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=p.merchant_id and x.consumer='review_routing' and x.revision=(origin->>'activationRevision')::bigint;
  if activation.operation_id is null or activation.action<>'activate' or activation.recorded_at>(src->>'at')::timestamptz
   or exists(select 1 from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=p.merchant_id and x.consumer='review_routing' and x.revision=activation.revision+1 and x.recorded_at<=(src->>'at')::timestamptz) then raise exception 'attendance_review_routing_invalid';end if;
  perform public.faolla_attendance_operational_consumer_item_v1(activation);
 elsif p.source_ref is not null then raise exception 'attendance_review_routing_invalid';end if;
 if p.entry->>'action'='capture' then
  if p.command is not null or p.revision<>1 or p.operation_id<>p.request_id or p.actor_auth_user_id<>p.employee_auth_user_id or origin->>'kind'<>'rule_capture'
   or origin->>'observedAt' is distinct from p.entry->>'recordedAt' then raise exception 'attendance_review_routing_invalid';end if;
  if origin->'desired'->>'kind'='owner' then
   if assignment->>'kind'<>'owner' then raise exception 'attendance_review_routing_invalid';end if;
  elsif assignment->>'kind'='delegate' then
   if row(assignment->>'employeeId',assignment->>'authUserId') is distinct from row(origin->'desired'->>'employeeId',origin->'desired'->>'authUserId') then raise exception 'attendance_review_routing_invalid';end if;
  elsif assignment->>'kind'<>'needs_assignment' or assignment->'desired' is distinct from ((origin->'desired')-'kind') then raise exception 'attendance_review_routing_invalid';end if;
 else
  if p.command is null or p.command->>'operationId' is distinct from p.operation_id::text or p.command->>'action' is distinct from p.entry->>'action'
   or p.command->>'reason' is distinct from p.entry->>'reason' or (p.command->>'expectedResponsibilityRevision')::bigint<>p.revision-1
   or p.command->'expectedResponsibilityOperationId' is distinct from p.entry->'previousOperationId' then raise exception 'attendance_review_routing_invalid';end if;
  fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-review-routing-command-v1',p.merchant_id,p.actor_auth_user_id,p.family,p.request_id,
   public.faolla_attendance_review_routing_tuple_v1(p.command,'command')));
  if fp is distinct from p.entry->>'commandFingerprint' then raise exception 'attendance_review_routing_invalid';end if;
  if p.entry->>'action'='take_over' then
   if p.revision=1 or assignment is distinct from jsonb_build_object('kind','owner','authUserId',p.actor_auth_user_id) then raise exception 'attendance_review_routing_invalid';end if;
  elsif assignment->>'kind'<>'delegate' or assignment->'grantId' is distinct from p.command->'grantId' then raise exception 'attendance_review_routing_invalid';end if;
  if p.revision=1 and origin is distinct from jsonb_build_object('kind','manual_registration') then raise exception 'attendance_review_routing_invalid';end if;
 end if;
 if assignment->>'kind'='delegate' then
  g:=public.faolla_attendance_review_routing_grant_v1(p.merchant_id,p.family,(assignment->>'grantId')::uuid);
  if g is null or g->'assignment' is distinct from assignment or row(g->'row'->>'worker_id',g->'row'->>'employee_id',g->'row'->>'employee_auth_user_id') is distinct from row(p.worker_id::text,p.employee_id::text,p.employee_auth_user_id::text)
   or assignment->>'employeeId'=p.employee_id::text or assignment->>'authUserId'=p.employee_auth_user_id::text
   or p.recorded_at<(g->'row'->>'recorded_at')::timestamptz or p.recorded_at<(assignment->>'validFrom')::timestamptz or p.recorded_at>=(assignment->>'validUntil')::timestamptz then raise exception 'attendance_review_routing_invalid';end if;
  authority_expected:=jsonb_build_object('grantType',assignment->'grantType','grantId',assignment->'grantId','grantFingerprint',g->'grantFingerprint','epochProofKind',assignment->'epochProofKind',
   'delegateGeneration',assignment->'delegateGeneration','employeeGeneration',assignment->'employeeGeneration','authorizedAt',p.entry->'recordedAt');
  if p.authority is distinct from authority_expected then raise exception 'attendance_review_routing_invalid';end if;
 elsif p.authority is not null then raise exception 'attendance_review_routing_invalid';end if;
 v:=public.faolla_attendance_review_routing_make_v1(p.merchant_id,p.request_ref,p.operation_id,p.revision,p.entry->>'action',p.actor_auth_user_id,p.recorded_at,p.entry->>'reason',
  (p.entry->>'previousOperationId')::uuid,origin,assignment,p.entry->>'commandFingerprint');
 if v is distinct from p.entry then raise exception 'attendance_review_routing_invalid';end if;
 return v;
end;
$$;

create or replace function public.faolla_attendance_review_routing_observe_v1(p_site text,p_family text,p_request uuid,p_at timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare fact jsonb;ref jsonb;entry_value jsonb;assignment jsonb;qualified jsonb;owner_id uuid;binding boolean;route_state text;reason_name text;v jsonb;
 head public.merchant_attendance_review_responsibility_heads%rowtype;saved public.merchant_attendance_review_responsibility_entries%rowtype;
begin
 fact:=public.faolla_attendance_review_routing_request_v1(p_site,p_family,p_request);if fact is null then raise exception 'attendance_review_routing_not_found';end if;ref:=fact->'request';
 select m.user_id into owner_id from public.merchants m where m.id=p_site;
 select * into head from public.merchant_attendance_review_responsibility_heads x where x.merchant_id=p_site and x.family=p_family and x.request_id=p_request;
 if head.operation_id is not null then
  select * into saved from public.merchant_attendance_review_responsibility_entries x where x.merchant_id=p_site and x.family=p_family and x.operation_id=head.operation_id;
  entry_value:=public.faolla_attendance_review_routing_entry_v1(saved);assignment:=entry_value->'assignment';
 end if;
 select exists(select 1 from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  where w.merchant_id=p_site and w.id=(ref->>'workerId')::uuid and w.employee_id=(ref->>'employeeId')::uuid and e.auth_user_id=(ref->>'employeeAuthUserId')::uuid
   and w.active and e.status='active' and not exists(select 1 from public.merchant_attendance_account_epochs ep where ep.merchant_id=p_site and ep.employee_id=e.id and ep.paused)) into binding;
 if fact->>'status'<>'submitted' then route_state:='closed';
 elsif head.operation_id is null then route_state:='unregistered';
 elsif assignment->>'kind'='needs_assignment' then route_state:='needs_assignment';reason_name:=assignment->>'reason';
 elsif assignment->>'kind'='owner' then
  if assignment->>'authUserId' is distinct from owner_id::text then route_state:='handover_needed';reason_name:='owner_changed';else route_state:='assigned';end if;
 else
  if not binding then route_state:='handover_needed';reason_name:='binding_changed';
  else
   qualified:=public.faolla_attendance_review_routing_qualify_v1(p_site,p_family,p_request,(assignment->>'grantId')::uuid,p_at);
   if qualified->'usable' is distinct from 'true'::jsonb then route_state:='handover_needed';reason_name:='grant_unavailable';else route_state:='assigned';end if;
  end if;
 end if;
 v:=jsonb_build_object('requestRevision',fact->'requestRevision','requestHeadOperationId',fact->'requestHeadOperationId','status',fact->'status','bindingCurrent',binding,
  'routeState',route_state,'reason',reason_name,'checkedAt',public.faolla_attendance_operational_punch_stamp_v1(p_at));
 return v||jsonb_build_object('observationFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-review-routing-observation-v1',p_site,
  public.faolla_attendance_review_routing_tuple_v1(ref,'request'),entry_value->'entryFingerprint',owner_id,fact->'requestRevision',fact->'requestHeadOperationId',fact->'status',binding,route_state,reason_name)));
end;
$$;

create or replace function public.faolla_attendance_review_routing_capture_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare family_name text;raw jsonb:=to_jsonb(new);site text:=raw->>'merchant_id';rid uuid;fact jsonb;ref jsonb;src jsonb;origin jsonb;choice_value jsonb;entry_value jsonb;stamp timestamptz;owner_id uuid;
 activation public.merchant_attendance_operational_consumer_activations%rowtype;
begin
 if tg_when<>'AFTER' or tg_op<>'INSERT' or tg_level<>'ROW' then raise exception 'attendance_review_routing_invalid';end if;
 family_name:=case tg_table_name when 'merchant_attendance_correction_entries' then 'correction' when 'merchant_attendance_revision_requests' then 'correction_revision'
  when 'merchant_attendance_missing_requests' then case when raw->>'supersedes_request_id' is null then 'missing' else 'missing_revision' end
  when 'merchant_attendance_leave_requests' then 'leave' when 'merchant_attendance_work_arrangement_requests' then 'work_arrangement' else null end;
 if family_name is null then raise exception 'attendance_review_routing_invalid';end if;
 if family_name in('correction','correction_revision') and raw->>'action'<>'submit' then return new;end if;
 select * into activation from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=site and x.consumer='review_routing' order by x.revision desc limit 1;
 if activation.action is distinct from 'activate' then return new;end if;
 perform public.faolla_attendance_operational_consumer_item_v1(activation);
 --The existing submit owns merchant/settings locks. These compatible locks also
 --make privileged synthetic inserts obey the same serialization contract.
 select m.user_id into owner_id from public.merchants m where m.id=site for share;
 perform 1 from public.merchant_attendance_settings s where s.merchant_id=site for update;if not found or owner_id is null then raise exception 'attendance_review_routing_invalid';end if;
 rid:=(raw->>'request_id')::uuid;fact:=public.faolla_attendance_review_routing_fact_v1(site,family_name,rid,false);ref:=fact->'request';
 if fact is null then raise exception 'attendance_review_routing_invalid';end if;
 stamp:=clock_timestamp();if stamp<(ref->>'submittedAt')::timestamptz then raise exception 'attendance_review_routing_changed';end if;
 src:=public.faolla_attendance_operational_source_v1(site,(ref->>'workerId')::uuid,(ref->>'employeeId')::uuid,(ref->>'employeeAuthUserId')::uuid,stamp);
 origin:=public.faolla_attendance_review_routing_origin_v1(src,family_name,activation.revision);
 choice_value:=public.faolla_attendance_review_routing_choose_v1(site,family_name,rid,origin,owner_id,stamp);
 entry_value:=public.faolla_attendance_review_routing_make_v1(site,ref,rid,1,'capture',(ref->>'employeeAuthUserId')::uuid,stamp,null,null,origin,choice_value->'assignment',null);
 insert into public.merchant_attendance_review_responsibility_entries(merchant_id,family,request_id,operation_id,revision,actor_auth_user_id,recorded_at,worker_id,employee_id,employee_auth_user_id,request_ref,entry,command,source_ref,authority)
  values(site,family_name,rid,rid,1,(ref->>'employeeAuthUserId')::uuid,stamp,(ref->>'workerId')::uuid,(ref->>'employeeId')::uuid,(ref->>'employeeAuthUserId')::uuid,ref,entry_value,null,
   public.faolla_attendance_operational_punch_source_ref_v1(src),nullif(choice_value->'authority','null'::jsonb));
 insert into public.merchant_attendance_review_responsibility_heads(merchant_id,family,request_id,revision,operation_id,recorded_at,worker_id,employee_id,employee_auth_user_id)
  values(site,family_name,rid,1,rid,stamp,(ref->>'workerId')::uuid,(ref->>'employeeId')::uuid,(ref->>'employeeAuthUserId')::uuid);
 return new;
end;
$$;

create or replace function public.faolla_attendance_review_routing_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare saved public.merchant_attendance_review_responsibility_entries%rowtype;latest public.merchant_attendance_review_responsibility_heads%rowtype;
 owner_id uuid;choice_value jsonb;observation jsonb;fact jsonb;
begin
 if tg_op in('DELETE','TRUNCATE') then raise exception 'attendance_review_routing_immutable';end if;
 if tg_table_name='merchant_attendance_review_responsibility_entries' then
  if tg_op<>'INSERT' then raise exception 'attendance_review_routing_immutable';end if;
  if tg_when='AFTER' then
   perform public.faolla_attendance_review_routing_entry_v1(new);
   select * into latest from public.merchant_attendance_review_responsibility_heads h where h.merchant_id=new.merchant_id and h.family=new.family and h.request_id=new.request_id;
   if latest.operation_id is null or latest.revision<new.revision then raise exception 'attendance_review_routing_invalid';end if;
   return new;
  end if;
  select m.user_id into owner_id from public.merchants m where m.id=new.merchant_id for share;
  perform 1 from public.merchant_attendance_settings s where s.merchant_id=new.merchant_id for update;if not found then raise exception 'attendance_review_routing_invalid';end if;
  if new.entry->>'action'='capture' then
   if new.revision<>1 or new.command is not null then raise exception 'attendance_review_routing_invalid';end if;
   choice_value:=public.faolla_attendance_review_routing_choose_v1(new.merchant_id,new.family,new.request_id,new.entry->'origin',owner_id,new.recorded_at);
   if choice_value->'assignment' is distinct from new.entry->'assignment' or nullif(choice_value->'authority','null'::jsonb) is distinct from new.authority then raise exception 'attendance_review_routing_invalid';end if;
  else
   if owner_id is distinct from new.actor_auth_user_id then raise exception 'attendance_access_denied';end if;
   observation:=public.faolla_attendance_review_routing_observe_v1(new.merchant_id,new.family,new.request_id,new.recorded_at);
   if observation->>'status'<>'submitted' or observation->'observationFingerprint' is distinct from new.command->'expectedObservationFingerprint'
    or observation->'requestRevision' is distinct from new.command->'expectedRequestRevision' then raise exception 'attendance_review_routing_changed';end if;
   if new.entry->>'action'='register' then
    if observation->>'routeState' not in('unregistered','needs_assignment','handover_needed') then raise exception 'attendance_review_routing_unchanged';end if;
    choice_value:=public.faolla_attendance_review_routing_qualify_v1(new.merchant_id,new.family,new.request_id,(new.command->>'grantId')::uuid,new.recorded_at);
    if choice_value->'usable' is distinct from 'true'::jsonb or choice_value->'assignment' is distinct from new.entry->'assignment'
     or choice_value->'authority' is distinct from new.authority then raise exception 'attendance_review_routing_unavailable';end if;
   elsif new.entry->>'action'='take_over' then
    if observation->>'routeState' not in('needs_assignment','handover_needed') or new.entry->'assignment' is distinct from jsonb_build_object('kind','owner','authUserId',owner_id) then raise exception 'attendance_review_routing_unchanged';end if;
   else raise exception 'attendance_review_routing_invalid';end if;
  end if;
  return new;
 elsif tg_table_name<>'merchant_attendance_review_responsibility_heads' or tg_when<>'BEFORE' or tg_op not in('INSERT','UPDATE') then raise exception 'attendance_review_routing_invalid';end if;
 select * into saved from public.merchant_attendance_review_responsibility_entries x where x.merchant_id=new.merchant_id and x.family=new.family and x.operation_id=new.operation_id;
 if saved.operation_id is null or row(saved.request_id,saved.revision,saved.recorded_at,saved.worker_id,saved.employee_id,saved.employee_auth_user_id) is distinct from
  row(new.request_id,new.revision,new.recorded_at,new.worker_id,new.employee_id,new.employee_auth_user_id) then raise exception 'attendance_review_routing_invalid';end if;
 if tg_op='INSERT' then
  if new.revision<>1 or saved.entry->'previousOperationId' is distinct from 'null'::jsonb then raise exception 'attendance_review_routing_invalid';end if;
 else
  if row(new.merchant_id,new.family,new.request_id,new.worker_id,new.employee_id,new.employee_auth_user_id) is distinct from row(old.merchant_id,old.family,old.request_id,old.worker_id,old.employee_id,old.employee_auth_user_id)
   or new.revision<>old.revision+1 or saved.entry->>'previousOperationId' is distinct from old.operation_id::text or new.recorded_at<old.recorded_at then raise exception 'attendance_review_routing_invalid';end if;
 end if;
 return new;
end;
$$;

create or replace function public.faolla_attendance_review_routing_query_v1(p jsonb)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare mode_name text:=p->>'mode';keys text[];c jsonb:=p->'cursor';k text;
begin
 if public.faolla_attendance_application_window_scalar_v1(p->'siteId','site') is distinct from true or octet_length(convert_to(p::text,'UTF8'))>8192 then raise exception 'attendance_invalid_request';end if;
 keys:=case mode_name when 'list' then array['siteId','mode','cursor'] when 'detail' then array['siteId','mode','family','requestId']
  when 'self' then array['siteId','mode','family','requestId'] when 'history' then array['siteId','mode','family','requestId','beforeRevision']
  when 'grants' then array['siteId','mode','family','requestId','cursor'] when 'recover' then array['siteId','mode','family','operationId'] else null end;
 if keys is null or public.faolla_attendance_operational_rule_object_v1(p,keys) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode_name<>'list' then
  if p->>'family' is null or p->>'family' not in('correction','correction_revision','missing','missing_revision','leave','work_arrangement')
   or public.faolla_attendance_operational_rule_scalar_v1(p->(case when mode_name='recover' then 'operationId' else 'requestId' end),'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 end if;
 if mode_name='history' and p->'beforeRevision'<>'null'::jsonb and (public.faolla_attendance_operational_rule_scalar_v1(p->'beforeRevision','positive') is distinct from true or (p->>'beforeRevision')::bigint<=1) then raise exception 'attendance_invalid_request';end if;
 if mode_name in('list','grants') and c<>'null'::jsonb then
  keys:=case mode_name when 'list' then array['kind','siteId','beforeAt','beforeFamily','beforeRequestId'] else array['kind','siteId','family','requestId','afterDelegateEmployeeId','afterDelegateAuthUserId','afterGrantId'] end;
  if public.faolla_attendance_operational_rule_object_v1(c,keys) is distinct from true or c->>'kind' is distinct from mode_name or c->'siteId' is distinct from p->'siteId' then raise exception 'attendance_invalid_request';end if;
  if mode_name='list' then
   if c->>'beforeFamily' is null or c->>'beforeFamily' not in('correction','correction_revision','missing','missing_revision','leave','work_arrangement') or jsonb_typeof(c->'beforeAt') is distinct from 'string'
    or public.faolla_attendance_operational_rule_scalar_v1(c->'beforeRequestId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
   perform public.faolla_attendance_operational_source_stamp_v1(c->>'beforeAt');
  else
   if c->'family' is distinct from p->'family' or c->'requestId' is distinct from p->'requestId' then raise exception 'attendance_invalid_request';end if;
   foreach k in array array['afterDelegateEmployeeId','afterDelegateAuthUserId','afterGrantId'] loop
    if public.faolla_attendance_operational_rule_scalar_v1(c->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
   end loop;
  end if;
 end if;
end;
$$;

create or replace function public.faolla_attendance_review_routing_receipt_v1(p public.merchant_attendance_review_responsibility_entries)
returns jsonb language plpgsql set search_path=pg_catalog as $$
begin
 if p.operation_id is null or p.entry->>'action'='capture' then return null;end if;
 perform public.faolla_attendance_review_routing_entry_v1(p);
 return jsonb_build_object('operationId',p.operation_id,'family',p.family,'requestId',p.request_id,'revision',p.revision,'action',p.entry->'action',
  'actorId',p.actor_auth_user_id,'recordedAt',p.entry->'recordedAt','commandFingerprint',p.entry->'commandFingerprint');
end;
$$;

create or replace function public.faolla_attendance_review_routing_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text:=p_query->>'siteId';mode_name text:=p_query->>'mode';family_name text:=p_query->>'family';rid uuid;op uuid;
 head public.merchant_attendance_review_responsibility_heads%rowtype;saved public.merchant_attendance_review_responsibility_entries%rowtype;
 previous public.merchant_attendance_review_responsibility_entries%rowtype;owner_id uuid;stamp timestamptz;fact jsonb;ref jsonb;observation jsonb;current_value jsonb;
 data_value jsonb;receipt jsonb;result_value jsonb;items jsonb:='[]';c jsonb:=p_query->'cursor';next_cursor jsonb;before_revision bigint;
 n integer:=0;can_register boolean;can_take boolean;choice_value jsonb;origin jsonb;assignment jsonb;entry_value jsonb;fingerprint text;item jsonb;cursor_item jsonb;
begin
 perform public.faolla_attendance_review_routing_query_v1(p_query);
 rid:=(p_query->>'requestId')::uuid;before_revision:=(p_query->>'beforeRevision')::bigint;
 if p_auth_user_id is null or p_allow_write is null or p_command is not null and mode_name<>'detail' then raise exception 'attendance_invalid_request';end if;
 if p_command is not null then
  if octet_length(convert_to(jsonb_build_object('query',p_query,'command',p_command)::text,'UTF8'))>8192 then raise exception 'attendance_invalid_request';end if;
  fingerprint:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-review-routing-command-v1',site,p_auth_user_id,family_name,rid,public.faolla_attendance_review_routing_tuple_v1(p_command,'command')));
  op:=(p_command->>'operationId')::uuid;
 elsif mode_name='recover' then op:=(p_query->>'operationId')::uuid;end if;
 if op is not null then
  select * into saved from public.merchant_attendance_review_responsibility_entries x where x.merchant_id=site and x.family=family_name and x.operation_id=op;
  if saved.operation_id is not null and (saved.actor_auth_user_id<>p_auth_user_id or saved.command is null) then
   if p_command is not null then raise exception 'attendance_operation_conflict';end if;saved:=null;
  end if;
  if p_command is not null and saved.operation_id is not null and (saved.request_id<>rid or saved.command is distinct from p_command or saved.entry->>'commandFingerprint' is distinct from fingerprint) then raise exception 'attendance_operation_conflict';end if;
  if mode_name='recover' or saved.operation_id is not null then
   receipt:=public.faolla_attendance_review_routing_receipt_v1(saved);
   return jsonb_build_object('protocol','attendance-review-routing-v1','siteId',site,'actorId',p_auth_user_id,'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'data',jsonb_build_object('kind','receipt'),'receipt',receipt);
  end if;
 end if;
 select m.user_id into owner_id from public.merchants m where m.id=site for share;
 if owner_id is null or mode_name<>'self' and owner_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
 if p_command is null then perform 1 from public.merchant_attendance_settings s where s.merchant_id=site for share;
 else perform 1 from public.merchant_attendance_settings s where s.merchant_id=site for update;end if;
 if not found then raise exception 'attendance_settings_required';end if;
 if p_command is not null and not p_allow_write then raise exception 'attendance_review_routing_disabled';end if;
 stamp:=clock_timestamp();
 if mode_name='list' then
  for head in select h.* from public.merchant_attendance_review_responsibility_heads h where h.merchant_id=site
   and (c='null'::jsonb or h.recorded_at<(c->>'beforeAt')::timestamptz
    or h.recorded_at=(c->>'beforeAt')::timestamptz and (h.family collate "C">(c->>'beforeFamily') collate "C"
     or h.family=(c->>'beforeFamily') and h.request_id<(c->>'beforeRequestId')::uuid))
   order by h.recorded_at desc,h.family collate "C",h.request_id desc limit 26 loop
   n:=n+1;if n=26 then next_cursor:=cursor_item;exit;end if;
   select * into saved from public.merchant_attendance_review_responsibility_entries e where e.merchant_id=site and e.family=head.family and e.operation_id=head.operation_id;
   current_value:=public.faolla_attendance_review_routing_entry_v1(saved);observation:=public.faolla_attendance_review_routing_observe_v1(site,head.family,head.request_id,stamp);
   items:=items||jsonb_build_array(jsonb_build_object('request',saved.request_ref,'current',current_value,'observation',observation));
   cursor_item:=jsonb_build_object('kind','list','siteId',site,'beforeAt',current_value->'recordedAt','beforeFamily',head.family,'beforeRequestId',head.request_id);
  end loop;
  data_value:=jsonb_build_object('kind','list','items',items,'nextCursor',next_cursor);
 else
  fact:=public.faolla_attendance_review_routing_request_v1(site,family_name,rid);if fact is null then raise exception 'attendance_review_routing_not_found';end if;ref:=fact->'request';
  perform 1 from public.merchant_attendance_workers w where w.merchant_id=site and w.id=(ref->>'workerId')::uuid for share;
  perform 1 from public.merchant_enterprise_employees e where e.merchant_id=site and e.id=(ref->>'employeeId')::uuid for share;
  if mode_name='self' and (ref->>'employeeAuthUserId' is distinct from p_auth_user_id::text or not exists(select 1 from public.merchant_enterprise_employees e join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
   where e.merchant_id=site and e.id=(ref->>'employeeId')::uuid and e.auth_user_id=p_auth_user_id and e.status='active' and r.status='active'
    and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) and 'attendance.self.view'=any(r.permissions))) then raise exception 'attendance_access_denied';end if;
  if p_command is null then select * into head from public.merchant_attendance_review_responsibility_heads h where h.merchant_id=site and h.family=family_name and h.request_id=rid;
  else select * into head from public.merchant_attendance_review_responsibility_heads h where h.merchant_id=site and h.family=family_name and h.request_id=rid for update;end if;
  if head.operation_id is not null then select * into previous from public.merchant_attendance_review_responsibility_entries e where e.merchant_id=site and e.family=family_name and e.operation_id=head.operation_id;current_value:=public.faolla_attendance_review_routing_entry_v1(previous);end if;
  if mode_name='history' then
   for saved in select e.* from public.merchant_attendance_review_responsibility_entries e where e.merchant_id=site and e.family=family_name and e.request_id=rid
    and (before_revision is null or e.revision<before_revision) order by e.revision desc limit 26 loop
    n:=n+1;if n=26 then next_cursor:=items->24->'revision';exit;end if;items:=items||jsonb_build_array(public.faolla_attendance_review_routing_entry_v1(saved));
   end loop;
   data_value:=jsonb_build_object('kind','history','request',ref,'items',items,'nextBeforeRevision',next_cursor);
  elsif mode_name='grants' then
   for item in select value from jsonb_array_elements(public.faolla_attendance_review_routing_candidates_v1(site,ref,null,nullif(c,'null'::jsonb))) loop
    n:=n+1;if n=26 then next_cursor:=cursor_item;exit;end if;
    choice_value:=public.faolla_attendance_review_routing_qualify_v1(site,family_name,rid,(item->>'grant_id')::uuid,stamp);
    if choice_value is null then raise exception 'attendance_review_routing_invalid';end if;
    items:=items||jsonb_build_array(choice_value->'option');cursor_item:=jsonb_build_object('kind','grants','siteId',site,'family',family_name,'requestId',rid,
     'afterDelegateEmployeeId',item->'delegate_employee_id','afterDelegateAuthUserId',item->'delegate_auth_user_id','afterGrantId',item->'grant_id');
   end loop;
   data_value:=jsonb_build_object('kind','grants','request',ref,'items',items,'nextCursor',next_cursor);
  else
   stamp:=clock_timestamp();observation:=public.faolla_attendance_review_routing_observe_v1(site,family_name,rid,stamp);
   can_register:=p_allow_write and family_name<>'correction_revision' and observation->>'status'='submitted' and observation->>'routeState' in('unregistered','needs_assignment','handover_needed');
   can_take:=p_allow_write and observation->>'status'='submitted' and observation->>'routeState' in('needs_assignment','handover_needed');
   if p_command is not null then
    if observation->>'status'<>'submitted' then raise exception 'attendance_review_routing_closed';end if;
    if (p_command->>'expectedResponsibilityRevision')::bigint<>coalesce(head.revision,0) or p_command->>'expectedResponsibilityOperationId' is distinct from head.operation_id::text
     or p_command->'expectedRequestRevision' is distinct from observation->'requestRevision' or p_command->'expectedObservationFingerprint' is distinct from observation->'observationFingerprint' then raise exception 'attendance_review_routing_changed';end if;
    if p_command->>'action'='register' then
     if not can_register then raise exception 'attendance_review_routing_unchanged';end if;
     choice_value:=public.faolla_attendance_review_routing_qualify_v1(site,family_name,rid,(p_command->>'grantId')::uuid,stamp);
     if choice_value->'usable' is distinct from 'true'::jsonb then raise exception 'attendance_review_routing_unavailable';end if;assignment:=choice_value->'assignment';
    else
     if not can_take then raise exception 'attendance_review_routing_unchanged';end if;assignment:=jsonb_build_object('kind','owner','authUserId',p_auth_user_id);
    end if;
    origin:=coalesce(current_value->'origin',jsonb_build_object('kind','manual_registration'));
    entry_value:=public.faolla_attendance_review_routing_make_v1(site,ref,op,coalesce(head.revision,0)+1,p_command->>'action',p_auth_user_id,stamp,p_command->>'reason',head.operation_id,origin,assignment,fingerprint);
    insert into public.merchant_attendance_review_responsibility_entries(merchant_id,family,request_id,operation_id,revision,actor_auth_user_id,recorded_at,worker_id,employee_id,employee_auth_user_id,request_ref,entry,command,source_ref,authority)
     values(site,family_name,rid,op,coalesce(head.revision,0)+1,p_auth_user_id,stamp,(ref->>'workerId')::uuid,(ref->>'employeeId')::uuid,(ref->>'employeeAuthUserId')::uuid,
      ref,entry_value,p_command,previous.source_ref,case when p_command->>'action'='register' then choice_value->'authority' else null end) returning * into saved;
    if head.operation_id is null then
     insert into public.merchant_attendance_review_responsibility_heads values(site,family_name,rid,saved.revision,op,stamp,saved.worker_id,saved.employee_id,saved.employee_auth_user_id);
    else update public.merchant_attendance_review_responsibility_heads h set revision=saved.revision,operation_id=op,recorded_at=stamp where h.merchant_id=site and h.family=family_name and h.request_id=rid;end if;
    receipt:=public.faolla_attendance_review_routing_receipt_v1(saved);data_value:=jsonb_build_object('kind','receipt');
   elsif mode_name='self' then
    data_value:=jsonb_build_object('kind','self','family',family_name,'requestId',rid,'submittedAt',ref->'submittedAt',
     'route',coalesce(current_value->'assignment'->>'kind','unregistered'),'handoverNeeded',observation->>'routeState' in('needs_assignment','handover_needed'),
     'capturedAt',case when current_value->'origin'->>'kind'='rule_capture' then current_value->'origin'->'observedAt' else null end);
   else data_value:=jsonb_build_object('kind','detail','request',ref,'current',current_value,'observation',observation,'canRegister',coalesce(can_register,false),'canTakeOver',coalesce(can_take,false));end if;
  end if;
 end if;
 result_value:=jsonb_build_object('protocol','attendance-review-routing-v1','siteId',site,'actorId',p_auth_user_id,'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'data',data_value,'receipt',receipt);
 if octet_length(convert_to(result_value::text,'UTF8'))>262144 then raise exception 'attendance_review_routing_too_large';end if;return result_value;
exception when raise_exception then
 if sqlerrm like 'attendance_operational_source_%' or sqlerrm like 'attendance_operational_punch_%' then raise exception 'attendance_review_routing_invalid';end if;raise;
end;
$$;

do $routing_activation_forward$
declare ns text;f regprocedure:='public.faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean)'::regprocedure;body_value text;args text;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080198) then return;end if;
 select n.nspname,replace(p.prosrc,E'\r\n',E'\n'),pg_get_function_arguments(p.oid) into ns,body_value,args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=f;
 if encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex')<>'d4cdaae19d5488037fe732553be3e7cec835db5dc057f0160f8515f55cf9408d' then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 if (length(body_value)-length(replace(body_value,'kind<>''application_window'' or not p_allow_activate or not s.enabled','')))/length('kind<>''application_window'' or not p_allow_activate or not s.enabled')<>1 then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 body_value:=replace(body_value,'kind<>''application_window'' or not p_allow_activate or not s.enabled','kind not in(''application_window'',''review_routing'') or not p_allow_activate or not s.enabled');
 if (length(body_value)-length(replace(body_value,'kind=''application_window'' and p_allow_activate and s.enabled','')))/length('kind=''application_window'' and p_allow_activate and s.enabled')<>1 then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 body_value:=replace(body_value,'kind=''application_window'' and p_allow_activate and s.enabled','kind in(''application_window'',''review_routing'') and p_allow_activate and s.enabled');
 if encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex')<>'3b621cc8c6271c100851413a88847da63e2e2c7b4b38a932e83d192a279aa144' then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 execute format('create or replace function %I.faolla_attendance_operational_consumer_activation_v1(%s) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',ns,args,body_value);
end;
$routing_activation_forward$;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_review_responsibility_entries'::regclass,
      'public.merchant_attendance_review_responsibility_heads'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $routing_security$
declare ns text;f regprocedure;t regclass;table_name text;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080198) then return;end if;
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 for f in select p.oid::regprocedure from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns) and p.proname like 'faolla_attendance_review_routing_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
 foreach table_name in array array['merchant_attendance_review_responsibility_entries','merchant_attendance_review_responsibility_heads']::text[] loop
  t:=to_regclass('public.'||table_name);execute format('alter table %s enable row level security',t);execute format('revoke all on %s from public,anon,authenticated,service_role',t);
  execute format('create trigger review_routing_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_review_routing_guard_v1()',t);
 end loop;
 create trigger review_routing_entry_before before insert on public.merchant_attendance_review_responsibility_entries for each row execute function public.faolla_attendance_review_routing_guard_v1();
 create trigger review_routing_immutable before update or delete on public.merchant_attendance_review_responsibility_entries for each row execute function public.faolla_attendance_review_routing_guard_v1();
 create constraint trigger review_routing_proof after insert on public.merchant_attendance_review_responsibility_entries deferrable initially deferred for each row execute function public.faolla_attendance_review_routing_guard_v1();
 create trigger review_routing_head_before before insert or update or delete on public.merchant_attendance_review_responsibility_heads for each row execute function public.faolla_attendance_review_routing_guard_v1();
 foreach table_name in array array['merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_leave_requests','merchant_attendance_work_arrangement_requests']::text[] loop
  execute format('create trigger review_routing_capture after insert on %s for each row execute function public.faolla_attendance_review_routing_capture_v1()',to_regclass('public.'||table_name));
 end loop;
end;
$routing_security$;
grant execute on function public.faolla_attendance_review_routing_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $routing_postconditions$
declare ns text;expected_owner oid;installed boolean;f regprocedure;info record;expected record;idx oid;t regclass;object_name text;role_name text;con record;expression_value text;
begin
 select n.nspname,c.relowner into ns,expected_owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 installed:=true;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name<>'merchant_attendance_review_routing') then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 for expected in select * from (values (202610060160::bigint,'merchant_attendance_missing_delegation'),(202610060162::bigint,'merchant_attendance_application_delegation'),
  (202610060164::bigint,'merchant_attendance_account_suspensions'),(202610080189::bigint,'merchant_attendance_correction_delegation'),
  (202610080191::bigint,'merchant_attendance_operational_rules'),(202610080192::bigint,'merchant_attendance_operational_source'),
  (202610080193::bigint,'merchant_attendance_operational_punch'),(202610080194::bigint,'merchant_attendance_application_window')) dependency(version,name) loop
  if not exists(select 1 from public.faolla_schema_migrations m where m.version=expected.version and m.name=expected.name) then raise exception 'merchant_attendance_review_routing_prerequisite_required';end if;
 end loop;
 if to_regprocedure('public.faolla_valid_merchant_enterprise_permissions_v1(text[])') is null then raise exception 'merchant_attendance_review_routing_prerequisite_required';end if;
 for expected in select * from (values
  ('public.faolla_attendance_operational_rule_object_v1(jsonb,text[])','c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7','boolean','i','sql',false,false,0,array['p','ks']::text[]),
  ('public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)','99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce','boolean','i','plpgsql',false,false,0,array['p','k']::text[]),
  ('public.faolla_attendance_operational_source_stamp_v1(text)','4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265','timestamptz','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_group_text_v1(text,integer,integer)','b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562','boolean','i','sql',false,false,0,array['p','lo','hi']::text[]),
  ('public.faolla_attendance_correction_proposal_v1(jsonb,timestamptz)','d389ec334e368ecb2afcf44ad1a37ff39af028536fff6b30a64d72ca3ad3da9d','jsonb','v','plpgsql',false,false,0,array['p_value','p_now']::text[]),
  ('public.faolla_attendance_correction_summary_v1(public.merchant_attendance_correction_entries,public.merchant_attendance_correction_entries)','4aa9ea02f21c5dde7477666c3b68baffbd2ea49fb84279be4b5a55a4b39660b2','jsonb','i','sql',false,false,0,array['p_first','p_last']::text[]),
  ('public.faolla_attendance_missing_summary_v1(public.merchant_attendance_missing_requests)','b0e0bd86ca4583b4056d81043185d1727c5be85662dc97310e258ed684caad05','jsonb','v','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_leave_summary_v1(public.merchant_attendance_leave_requests,integer)','5df82b03753c90636b8fd9fce15384560490c4f5996fafe1df76ec9e75b09fa6','jsonb','v','plpgsql',false,false,1,array['p','p_revision']::text[]),
  ('public.faolla_attendance_work_arrangement_summary_v1(public.merchant_attendance_work_arrangement_requests,integer)','a27f471975013268910a5523bf6e7998ce90f2901d25a234663e653ecc8222e5','jsonb','v','plpgsql',false,false,1,array['p','p_revision']::text[]),
  ('public.faolla_attendance_operational_punch_stamp_v1(timestamptz)','6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_correction_delegation_hash_v1(text,text,jsonb)','5ab9296fcbf5d0fd65d680b4de9885d0eb2d06c0266bffe425875b9ff10ca62c','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_missing_delegation_hash_v1(text,text,jsonb)','2d1805657c298a6190ea36d2aa5dc1b35a393db31e305d1ed919eba02441bbcc','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_application_delegation_hash_v1(text,text,jsonb)','2d54478110b1df6ea4d37a71899337dd283dc8a3bc63d97fad38db77ec952d09','text','i','plpgsql',false,false,0,array['p_site','p_access','p']::text[]),
  ('public.faolla_attendance_correction_delegation_usable_v1(public.merchant_attendance_correction_delegations,timestamptz)','95427a0e2ee14be6aac45137a5cc154da56953bb4a7005027822376800fc0f2d','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_correction_delegation_scope_v1(jsonb,uuid)','0349465cb5460fa9cc15e5a12d1936683f52f9d5aef4a8ab976a8f4ca8e215fb','boolean','i','plpgsql',false,false,0,array['p_basis','p_location']::text[]),
  ('public.faolla_attendance_correction_owner_basis_v1(text,uuid,uuid,uuid,timestamptz)','2523fe8ecf015e11b1b334bd1d9938b1b956bdeb47557c42e5b299c7eb1dae6e','jsonb','v','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_start','p_now']::text[]),
  ('public.faolla_attendance_correction_delegation_original_v1(jsonb,timestamptz)','58ad93e2073338a63b5b1edc6deb0837b64949708cee9fff8d47b0e98c2df4b0','jsonb','v','plpgsql',false,false,0,array['p_basis','p_now']::text[]),
  ('public.faolla_attendance_missing_delegation_usable_v1(public.merchant_attendance_missing_delegations,timestamptz)','a6511db89e8639edb4f445e42efc345930bce5f08a67ba0ecfba23feee6e99a2','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_application_delegation_usable_v1(public.merchant_attendance_application_delegations,timestamptz)','11c1b220fa18dc1b55caf3378b248aa8ccd9914bc44cf4ed132baded58d84dda','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_operational_rule_hash_v1(jsonb)','fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_source_tuple_v1(jsonb)','df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_saved_source_v1(jsonb)','f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_consumer_item_v1(public.merchant_attendance_operational_consumer_activations)','018cf97af523313e0759e0cc378d80ba1d8bf98b0501ecbaab322b5819afc5a4','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamptz)','9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee','jsonb','v','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_employee_auth','p_at']::text[]),
  ('public.faolla_attendance_operational_punch_source_ref_v1(jsonb)','31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_application_window_scalar_v1(jsonb,text)','fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db','boolean','i','plpgsql',false,false,0,array['p','k']::text[]),
  ('public.faolla_attendance_account_grant_current_v1(text,text,uuid,uuid,uuid,uuid,uuid)','882d5dc7f35d43fb131c536b79b6daf367bdc48bfe5a0550182b4f38d73ba428','boolean','s','plpgsql',false,false,0,array['p_site','p_channel','p_grant','p_delegate','p_delegate_auth','p_employee','p_auth']::text[]),
  ('public.faolla_attendance_missing_delegation_usable_pre164(public.merchant_attendance_missing_delegations,timestamptz)','68e6c074e4916a35ea9f21b006c67ae3ad28365a885b4b44c75965f2240602c2','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_application_delegation_usable_pre164(public.merchant_attendance_application_delegations,timestamptz)','ccb548d959cd1fa3d44adb41a335e000af899f1a6b62ff52e42249d45d446516','boolean','s','sql',false,false,0,array['p','p_at']::text[]),
  ('public.faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean)','3b621cc8c6271c100851413a88847da63e2e2c7b4b38a932e83d192a279aa144','jsonb','v','plpgsql',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_activate']::text[])
 ) dependency(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility or info.lanname is distinct from expected.language_name
   or info.prorettype is distinct from to_regtype(expected.result_type) or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults
   or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('attendance_review_routing_correction_idx','merchant_attendance_correction_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','delegate_employee_id','delegate_auth_user_id','grant_id']::text[]),
  ('attendance_review_routing_missing_idx','merchant_attendance_missing_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','delegate_employee_id','delegate_auth_user_id','grant_id']::text[]),
  ('attendance_review_routing_application_idx','merchant_attendance_application_delegations',array['merchant_id','worker_id','employee_id','employee_auth_user_id','category','delegate_employee_id','delegate_auth_user_id','grant_id']::text[])
 ) old_index(index_name,table_name,keys) loop
  idx:=to_regclass('public.'||expected.index_name);t:=to_regclass('public.'||expected.table_name);
  if t is null or (true and idx is null) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
  if idx is not null and not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
   where c.oid=idx and c.relowner=expected_owner and c.relkind='i' and am.amname='btree' and i.indrelid=t
    and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null
    and i.indnatts=cardinality(expected.keys) and i.indnkeyatts=cardinality(expected.keys)
    and not exists(select 1 from generate_subscripts(expected.keys,1) z where
     (select a.attname from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]) is distinct from expected.keys[z]
     or i.indoption[z-1]<>0 or i.indcollation[z-1] is distinct from (select a.attcollation from pg_attribute a where a.attrelid=i.indrelid and a.attnum=i.indkey[z-1])
     or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[z-1]
      where o.oid=i.indclass[z-1] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
 end loop;
 if (select count(*) from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns) and p.proname like 'faolla_attendance_review_routing_%')<>(case when installed then 16 else 0 end) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 foreach object_name in array array['merchant_attendance_review_responsibility_entries','merchant_attendance_review_responsibility_heads']::text[] loop
  if (to_regclass('public.'||object_name) is not null)<>installed then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 foreach object_name in array array['merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_leave_requests','merchant_attendance_work_arrangement_requests']::text[] loop
  t:=to_regclass('public.'||object_name);
  if t is null or exists(select 1 from pg_trigger where tgrelid=t and tgname='review_routing_capture')<>installed then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  if installed and not exists(select 1 from pg_trigger where tgrelid=t and tgname='review_routing_capture' and tgtype=5 and tgenabled='O' and tgnargs=0 and tgqual is null and not tgdeferrable and not tginitdeferred
   and tgfoid=to_regprocedure('public.faolla_attendance_review_routing_capture_v1()')) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 if not installed then return;end if;
 for expected in select * from (values
  ('public.faolla_attendance_review_routing_tuple_v1(jsonb,text)','afcd6520c775813bf11d0406e3f62b3cbf08445e1025be6761fc75d522b0d880','jsonb','s','plpgsql',false,false,0,array['p','p_kind']::text[]),
  ('public.faolla_attendance_review_routing_fact_v1(text,text,uuid,boolean)','4de217d5343138427dc0af875cdccff5cf1ca844f087562af61298fcaf00a8f7','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_complete']::text[]),
  ('public.faolla_attendance_review_routing_request_v1(text,text,uuid)','bea1a2fe21d3310967c64af9e2c019642e6e1432d09ed7eb19d2a546a752941b','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request']::text[]),
  ('public.faolla_attendance_review_routing_grant_v1(text,text,uuid)','8de810b68e5a3c994ed78b2e684d40e28967c5ec9f9381a92c64fcf42e233b9c','jsonb','s','plpgsql',false,false,0,array['p_site','p_family','p_grant']::text[]),
  ('public.faolla_attendance_review_routing_qualify_v1(text,text,uuid,uuid,timestamptz)','7a867d0c19f5b7dedae30db3f1e9007ad7792702949c333c919e22ac7c7bdff9','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_grant','p_at']::text[]),
  ('public.faolla_attendance_review_routing_candidates_v1(text,jsonb,jsonb,jsonb)','b6fdd5d441375fedea4328fd289b323d218a5e2b7c860061989552fec08640b8','jsonb','s','plpgsql',false,false,0,array['p_site','p_ref','p_delegate','p_cursor']::text[]),
  ('public.faolla_attendance_review_routing_origin_v1(jsonb,text,bigint)','fa9cb981676d6e4f0eed10a73c99b200193c3d4aeb95a0f02502c18933ac7df5','jsonb','s','plpgsql',false,false,0,array['p_source','p_family','p_activation']::text[]),
  ('public.faolla_attendance_review_routing_choose_v1(text,text,uuid,jsonb,uuid,timestamptz)','b60959dc2a537c238c0deedc03a3f240a10a441fab54261afcd9a1cec9eb144d','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_origin','p_owner','p_at']::text[]),
  ('public.faolla_attendance_review_routing_make_v1(text,jsonb,uuid,bigint,text,uuid,timestamptz,text,uuid,jsonb,jsonb,text)','c8c2cf0b9863ba02d74d2a57d80ecc1c799855ef9267e60fbd8cfa6862018763','jsonb','s','plpgsql',false,false,0,array['p_site','p_ref','p_op','p_revision','p_action','p_actor','p_at','p_reason','p_previous','p_origin','p_assignment','p_fingerprint']::text[]),
  ('public.faolla_attendance_review_routing_entry_v1(public.merchant_attendance_review_responsibility_entries)','c7ad8af0b4ae7950ba4d322112b8ec5282ea532b2f5f9432460e67500b4ef61b','jsonb','v','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_observe_v1(text,text,uuid,timestamptz)','c67fdd792c1ea719c2ce86cd88beb40d057920b66ad5f892b45ad9c1f91e7167','jsonb','v','plpgsql',false,false,0,array['p_site','p_family','p_request','p_at']::text[]),
  ('public.faolla_attendance_review_routing_capture_v1()','58342d0420d4a28f4756b3876ba0ac67be750ec379c5a4429615fa967fc63dc3','trigger','v','plpgsql',true,false,0,array[]::text[]),
  ('public.faolla_attendance_review_routing_guard_v1()','b66673e41caf7849bf516cd94f952ca5d722adf3bedd53fa553717aeb698d35c','trigger','v','plpgsql',true,false,0,array[]::text[]),
  ('public.faolla_attendance_review_routing_query_v1(jsonb)','2982cdf9b06ec8a079c4fbb53f18157d120d489a154c4c846783be2e5f97d5e6','void','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_receipt_v1(public.merchant_attendance_review_responsibility_entries)','1f46dc51aaf7b2d8d786d8980c542d645152750f9289faa42af1632060a19a90','jsonb','v','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_review_routing_v1(jsonb,uuid,jsonb,boolean)','159b511971d0b194a328507c77c5126de8b5e2400ea99f048ff0af957d8733ff','jsonb','v','plpgsql',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[])
 ) own(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility or info.lanname is distinct from expected.language_name
   or info.prorettype is distinct from to_regtype(expected.result_type) or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults
   or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries',array['merchant_id','family','request_id','operation_id','revision','actor_auth_user_id','recorded_at','worker_id','employee_id','employee_auth_user_id','request_ref','entry','command','source_ref','authority']::text[],array['text','text','uuid','uuid','bigint','uuid','timestamp with time zone','uuid','uuid','uuid','jsonb','jsonb','jsonb','jsonb','jsonb']::text[],array['command','source_ref','authority']::text[],8,4),
  ('merchant_attendance_review_responsibility_heads',array['merchant_id','family','request_id','revision','operation_id','recorded_at','worker_id','employee_id','employee_auth_user_id']::text[],array['text','text','uuid','bigint','uuid','timestamp with time zone','uuid','uuid','uuid']::text[],array[]::text[],3,2)
 ) tbl(table_name,columns,types,nullable_columns,constraints,triggers) loop
  t:=to_regclass('public.'||expected.table_name);
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or array(select a.attname::text from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.columns
   or array(select format_type(a.atttypid,a.atttypmod) from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.types
   or exists(select 1 from pg_attribute a where a.attrelid=t and a.attnum>0 and (a.attisdropped or a.attnotnull=(a.attname=any(expected.nullable_columns)) or a.atthasdef or a.attidentity<>'' or a.attgenerated<>'' or a.attndims<>0))
   or (select count(*) from pg_constraint where conrelid=t and contype<>'t')<>expected.constraints
   or (select count(*) from pg_index where indrelid=t)<>2 or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>expected.triggers
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  end loop;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_pk','p',array['merchant_id','family','operation_id']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_stream_uq','u',array['merchant_id','family','request_id','revision']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_site_fk','f',array['merchant_id']::text[],'merchant_attendance_settings',array['merchant_id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_worker_fk','f',array['merchant_id','worker_id']::text[],'merchant_attendance_workers',array['merchant_id','id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_employee_fk','f',array['merchant_id','employee_id']::text[],'merchant_enterprise_employees',array['merchant_id','id']::text[],null::text),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_family_ck','c',array[]::text[],null::text,array[]::text[],'family=any(array[''correction'',''correction_revision'',''missing'',''missing_revision'',''leave'',''work_arrangement'']::text[])'),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_revision_ck','c',array[]::text[],null::text,array[]::text[],'revision>=1::bigint and revision<=9007199254740990::bigint and isfinite(recorded_at)'),
  ('merchant_attendance_review_responsibility_entries','review_routing_entries_bytes_ck','c',array[]::text[],null::text,array[]::text[],'octet_length(convert_to(jsonb_build_array(request_ref,entry,command,source_ref,authority)::text,''UTF8''))<=32768'),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_pk','p',array['merchant_id','family','request_id']::text[],null::text,array[]::text[],null::text),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_entry_fk','f',array['merchant_id','family','operation_id']::text[],'merchant_attendance_review_responsibility_entries',array['merchant_id','family','operation_id']::text[],null::text),
  ('merchant_attendance_review_responsibility_heads','review_routing_heads_revision_ck','c',array[]::text[],null::text,array[]::text[],'revision>=1::bigint and revision<=9007199254740990::bigint and isfinite(recorded_at)')
 ) constraint_spec(table_name,constraint_name,kind,keys,referenced_table,referenced_keys,expression_text) loop
  t:=to_regclass('public.'||expected.table_name);
  select * into con from pg_constraint x where x.conrelid=t and x.conname=expected.constraint_name;
  if con.oid is null or con.contype::text is distinct from expected.kind or not con.convalidated or con.condeferrable or con.condeferred or expected.kind='c' and con.connoinherit then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  if expected.kind='c' then
   --Only insignificant formatting and explicit scalar casts are normalized; no operators or literals are removed.
   expression_value:=lower(replace(regexp_replace(regexp_replace(pg_get_expr(con.conbin,t),'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g'),chr(39),''));
   if expression_value is distinct from lower(replace(regexp_replace(regexp_replace(expected.expression_text,'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g'),chr(39),'')) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  else
   if array(select a.attname::text from unnest(con.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=t and a.attnum=k.attnum order by k.n) is distinct from expected.keys then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
   if expected.kind='f' then
    if con.confrelid is distinct from to_regclass('public.'||expected.referenced_table) or con.confupdtype<>'a' or con.confdeltype<>'a' or con.confmatchtype<>'s'
     or array(select a.attname::text from unnest(con.confkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.attnum order by k.n) is distinct from expected.referenced_keys then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
   elsif not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indexrelid=con.conindid and i.indrelid=t and c.relowner=expected_owner
    and am.amname='btree' and i.indisunique and i.indisvalid and i.indisready and i.indislive and not i.indisexclusion and i.indpred is null and i.indexprs is null
    and i.indnatts=cardinality(expected.keys) and i.indnkeyatts=cardinality(expected.keys)) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
  end if;
 end loop;
 idx:=to_regclass('public.attendance_review_responsibility_list_idx');t:='public.merchant_attendance_review_responsibility_heads'::regclass;
 if idx is null or not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indexrelid=idx and i.indrelid=t and c.relowner=expected_owner and am.amname='btree'
  and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisexclusion and i.indpred is null and i.indexprs is null and i.indnatts=4 and i.indnkeyatts=4
  and array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=t and a.attnum=k.attnum order by k.n)=array['merchant_id','recorded_at','family','request_id']
  and i.indoption[0]=0 and i.indoption[1]=3 and i.indoption[2]=0 and i.indoption[3]=3
  and i.indcollation[2]='pg_catalog."C"'::regcollation
  and not exists(select 1 from generate_series(0,3) z where (z<>2 and i.indcollation[z] is distinct from (select a.attcollation from pg_attribute a where a.attrelid=t and a.attnum=i.indkey[z]))
   or not exists(select 1 from pg_opclass o join pg_attribute a on a.attrelid=t and a.attnum=i.indkey[z] where o.oid=i.indclass[z] and o.opcnamespace='pg_catalog'::regnamespace and o.opcdefault and o.opcmethod=c.relam and o.opcintype=a.atttypid))) then raise exception 'merchant_attendance_review_routing_index_conflict';end if;
 for expected in select * from (values
  ('merchant_attendance_review_responsibility_entries','review_routing_entry_before',7,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_immutable',27,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_no_truncate',34,false,false),
  ('merchant_attendance_review_responsibility_entries','review_routing_proof',5,true,true),
  ('merchant_attendance_review_responsibility_heads','review_routing_head_before',31,false,false),
  ('merchant_attendance_review_responsibility_heads','review_routing_no_truncate',34,false,false)
 ) trigger_spec(table_name,trigger_name,trigger_type,is_deferred,initially_deferred) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||expected.table_name) and tgname=expected.trigger_name and tgtype=expected.trigger_type and tgenabled='O'
   and tgnargs=0 and tgqual is null and tgdeferrable=expected.is_deferred and tginitdeferred=expected.initially_deferred and tgfoid='public.faolla_attendance_review_routing_guard_v1()'::regprocedure) then raise exception 'merchant_attendance_review_routing_installation_conflict';end if;
 end loop;
end;
$routing_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610080198,'merchant_attendance_review_routing') on conflict(version) do nothing;
commit;
