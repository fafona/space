--242. Default-off four-channel operational punch consumption. No event rewrite.
--The six legacy entry points keep their signatures/owners/ACL and shared cores.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $punch_preflight$
declare installed boolean;ns text;expected_owner oid;f regprocedure;t regclass;expected record;info record;object_name text;role_name text;idx record;
begin
 if to_regclass('public.faolla_schema_migrations') is null
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080192 and name='merchant_attendance_operational_source')
 then raise exception 'merchant_attendance_operational_punch_prerequisite_required';end if;
 foreach object_name in array array['merchants','merchant_attendance_settings','merchant_attendance_workers','merchant_enterprise_employees','merchant_enterprise_roles',
  'merchant_attendance_events','merchant_attendance_locations','merchant_attendance_employment_periods','merchant_attendance_terminals',
  'merchant_attendance_pin_attempts','merchant_attendance_pin_clock_receipts','merchant_attendance_onsite_receipts','merchant_attendance_location_results','merchant_attendance_location_clock_notices',
  'merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_cancellations','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions',
  'merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications','merchant_attendance_correction_controls'] loop
  if to_regclass('public.'||object_name) is null then raise exception 'merchant_attendance_operational_punch_prerequisite_required';end if;
 end loop;
 foreach object_name in array array['public.faolla_attendance_event_receipt_v1(public.merchant_attendance_events)',
  'public.faolla_attendance_events_append_only_v1()','public.faolla_attendance_pin_finish_v1(text,uuid,text,text,uuid,boolean,boolean)',
  'public.faolla_attendance_self_schedule_slot_v1(public.merchant_attendance_schedule_slots)',
  'public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)',
  'public.faolla_attendance_shift_plan_adoption_v1(public.merchant_attendance_shift_schedule_relations,uuid,uuid,boolean,text)',
  'public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamp with time zone)',
  'public.faolla_attendance_operational_source_tuple_v1(jsonb)',
  'public.faolla_attendance_operational_rule_item_v1(public.merchant_attendance_operational_rule_operations)'] loop
  if to_regprocedure(object_name) is null then raise exception 'merchant_attendance_operational_punch_prerequisite_required';end if;
 end loop;
 select p.proowner into expected_owner from pg_proc p where p.oid='public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamp with time zone)'::regprocedure;
 if expected_owner is null or expected_owner<>(select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_operational_punch_owner_required';end if;
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 for expected in select * from (values
  ('public.faolla_attendance_operational_source_stamp_v1(text)','4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265','timestamptz','i','plpgsql'),
  ('public.faolla_attendance_operational_source_layer_v1(text,jsonb,timestamp with time zone)','26cf463e0e5da24c8783c4f085ca8076984243bb787033782cba4a281d58fc40','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_baseline_v1(text,timestamp with time zone,bigint)','6770099ab00f8827425c14773a8823509350c2745d742a998aff0dc7015019bf','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_tuple_v1(jsonb)','df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamp with time zone)','9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee','jsonb','v','plpgsql')
 ) pinned(signature,source_hash,result_type,volatility,language_name) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility
   or info.lanname is distinct from expected.language_name or info.prorettype is distinct from to_regtype(expected.result_type)
   or info.proretset or info.proisstrict or info.proleakproof
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner or a.grantee<>expected_owner)
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('service_role',f,'EXECUTE')
  then raise exception 'merchant_attendance_operational_punch_dependency_changed';end if;
 end loop;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080193 and name<>'merchant_attendance_operational_punch') then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080193 and name='merchant_attendance_operational_punch') into installed;
 for expected in select * from (values
  ('public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)','ce0a9971794cfe4fce1f6e8ab9355fad68c817e443dea9dba78f0182a5e6c801','3aaae429ef9d13ee2b154227de8c45d2c367b236dbd1430b360a5ed70ac12b08',true,2,array['p_site_id','p_auth_user_id','p_command','p_operation_id']::text[]),
  ('public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)','a9494b3f12a0323fc70e3e2343dc20e9116947ed59b71db5f63ccaf86e4801a5','a6f1a9b8182f84f70e5d6c20ea2f446ffbdfba55d87b016df382212ede893056',true,0,array['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new']::text[]),
  ('public.faolla_attendance_onsite_clock_v1(text,uuid,jsonb,jsonb,uuid,boolean)','c43a3590c6cad691fe1a61c6a4d1166d498994d4d1484800296cd1095b89f8da','a17b70c55270e7b357473b33c733757351d2142d4ccd2213e4080b67d8c37068',true,0,array['p_site','p_auth','p_claims','p_command','p_operation','p_allow_new']::text[]),
  ('public.faolla_attendance_location_clock_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)','5dad0419e0bb1e6747844106e4b2480a9c73e709be9a5bda1d9abcbb60e5bca7','645e3e6803916aa5093708c12125794d38c45fa52a39d6a6d10f077946c1d22e',false,5,array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock']::text[]),
  ('public.faolla_attendance_location_clock_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)','797c6a382ac8c0ddf27effb2c135e103ceb9c3433b4c86a09c550550055482ab','3cb77e5dc425f5b9255308bda8288eb6bf304395ba21649fc9684e4cb58bf0f7',true,5,array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock']::text[]),
  ('public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)','7ae3139791e9e63d51414dc4ae7287f96977a23b3237cd9fb730b31b0ce2b8ed','7de7672594013ab90d78a44bf704e5e2e9870fd052fe4fbc0c236fc8fb7f454e',true,3,array['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new','p_selection','p_allow_schedule','p_bind_rules']::text[])
 ) pinned(signature,original_hash,wrapper_hash,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or not info.prosecdef or info.proconfig is distinct from array['search_path=pg_catalog']
   or info.provolatile<>'v' or info.lanname<>'plpgsql' or info.prorettype<>'jsonb'::regtype or info.proretset or info.proisstrict or info.proleakproof
   or info.pronargdefaults<>expected.defaults or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex')
    is distinct from (case when installed then expected.wrapper_hash else expected.original_hash end)
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc
  then raise exception 'merchant_attendance_operational_punch_legacy_changed';end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and proname like 'faolla_attendance_operational_punch_%')<>(case when installed then 39 else 0 end) then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
 foreach object_name in array array['merchant_attendance_operational_punch_activations','merchant_attendance_operational_punch_sessions','merchant_attendance_operational_punch_operations'] loop
  if (to_regclass('public.'||object_name) is not null) is distinct from installed then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
 end loop;
 select i.*,c.relowner,a.amname into idx from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indexrelid=to_regclass('public.attendance_report_clock_in_idx');
 if idx.indexrelid is null or idx.relowner<>expected_owner or idx.amname<>'btree' or not idx.indisvalid or not idx.indisready or not idx.indislive
  or idx.indisunique or idx.indisexclusion or idx.indexprs is not null or idx.indnkeyatts<>4 or idx.indnatts<>4
  or idx.indrelid<>'public.merchant_attendance_events'::regclass or pg_get_expr(idx.indpred,idx.indrelid) is distinct from '(action = ''clock_in''::text)'
  or array(select a.attname::text from generate_series(0,3) q(ordinal) join pg_attribute a on a.attrelid=idx.indrelid and a.attnum=idx.indkey[q.ordinal] order by q.ordinal)
   is distinct from array['merchant_id','worker_id','occurred_at','sequence']
  or array(select idx.indoption[q.ordinal]::integer from generate_series(0,3) q(ordinal)) is distinct from array[0,0,0,0]
 then raise exception 'merchant_attendance_operational_punch_index_conflict';end if;
 if not installed then return;end if;
 for expected in select * from (values
  ('public.faolla_attendance_operational_punch_hash_v1(jsonb)','fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_stamp_v1(timestamp with time zone)','6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_selection_v1(jsonb)','7d5699e65a9eb561c61f25c9a76e2c3d1b39cb4b5d1b2e8803d34742f0696b58','jsonb','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_command_v1(text,jsonb)','82bc7821ff797f102f827337d1049a3cc13ed3b10aa94a7f01c5ef54c37e5ce1','jsonb','s','plpgsql',false,false,0,array['p_channel','p']::text[]),
  ('public.faolla_attendance_operational_punch_activation_command_v1(text,uuid,jsonb)','79921f3f54210fc410619a1c8e1b5afcdb86b043234b0d319fa7fd1c189854ab','jsonb','s','plpgsql',false,false,0,array['p_site','p_actor','p']::text[]),
  ('public.faolla_attendance_operational_punch_activation_item_v1(public.merchant_attendance_operational_punch_activations)','ca98d4c3465b6d856b8f0d8edef1a2208f14cb9b3d98f659c1adc89c5f9ed6af','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_activation_v1(jsonb,uuid,jsonb,boolean)','73655d699260bdc40dcc6dc200b338396abd9400508b2cd22a50d86b9387b642','jsonb','v','plpgsql',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_activate']::text[]),
  ('public.faolla_attendance_operational_punch_fields_v1(jsonb)','ad3bc82213f2a108cf2f793d432c4d69ffc8a9279d4391effca81e1f5f77a23c','jsonb','s','plpgsql',false,false,0,array['p_source']::text[]),
  ('public.faolla_attendance_operational_punch_value_tuple_v1(text,jsonb)','4a920661d5ff06a792d15349de1c76ab55fbeaf7196d05bc8d9bce6558da0534','jsonb','i','sql',false,false,0,array['p_key','p']::text[]),
  ('public.faolla_attendance_operational_punch_fields_tuple_v1(jsonb)','dd017c254ea8094640d8d4578bab712d5da3eb394297ae67360522e85a0ce586','jsonb','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_origins_v1(jsonb)','13bc1a1ced1b4cce3e30339b78a04bbf55a75eb7096153d07c3e8fad6b7bba1c','jsonb','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_policy_hash_v1(text,text,jsonb,jsonb)','3997f9badc241ebdc11f22ab8e601c9de23e54ef21b13c2eb327898cec196864','text','s','plpgsql',false,false,0,array['p_site','p_channel','p_policy','p_source']::text[]),
  ('public.faolla_attendance_operational_punch_source_ref_v1(jsonb)','31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_saved_source_v1(jsonb)','f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_session_hash_v1(text,jsonb)','d5c3ba9f4f9df3c6611bca6870ac6c999de120316a1a1826cd73268a3c2b40a5','text','s','plpgsql',false,false,0,array['p_site','p']::text[]),
  ('public.faolla_attendance_operational_punch_current_start_v1(text,uuid)','6fa51cfaa09299ee867150212816c20a11070e656b4c146a80f6a79bf3da05c8','uuid','s','plpgsql',false,false,0,array['p_site','p_worker']::text[]),
  ('public.faolla_attendance_operational_punch_legacy_gate_v1(text,uuid,text,uuid)','647cf86f66e6c6432d585ce96d298f972a6753a6100248dc472c3f1c6c807e0d','void','s','plpgsql',false,false,1,array['p_site','p_worker','p_action','p_receipt']::text[]),
  ('public.faolla_attendance_operational_punch_policy_v1(text,text,uuid,uuid,uuid,uuid,timestamp with time zone,boolean)','cc06406ff11ec128238017336fec4d53c378f2fc63a69f2107db6d7d93939967','jsonb','v','plpgsql',false,false,0,array['p_site','p_channel','p_worker','p_employee','p_auth','p_location','p_at','p_schedule']::text[]),
  ('public.faolla_attendance_operational_punch_session_v1(public.merchant_attendance_operational_punch_sessions)','060b51ad744fc7cd9a8a0354062d5d64129cfd2f00b77eeb745dd3d918031d32','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_before_v1(text,uuid,uuid,uuid,text,uuid,timestamp with time zone,text,boolean,jsonb)','af59fc45b051d2b55f5d734972624b51787c403e8de73ddbeffb64e36c3cb3e8','jsonb','v','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_actor','p_channel','p_location','p_at','p_action','p_default_paid','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_origin_v1(public.merchant_attendance_events,text)','123524019f7137247d2a3df946169fc371b5257d6a444b0d3d45e5e982f44285','jsonb','s','plpgsql',false,false,0,array['p','p_channel']::text[]),
  ('public.faolla_attendance_operational_punch_record_selection_v1(public.merchant_attendance_events,text,uuid,jsonb)','b6cbd18f4079330faca47830733eaee45c310acb8129fcccc1bee91b7c976e77','void','v','plpgsql',false,false,0,array['p','p_channel','p_auth','p_selection']::text[]),
  ('public.faolla_attendance_operational_punch_record_v1(uuid,uuid,text,jsonb,jsonb)','13ca4b42e6fa443e12f691f2622bc999c9e88d275dd30653b5b0ee771a5b0e25','void','v','plpgsql',false,false,0,array['p_event','p_actor','p_channel','p_intent','p_decision']::text[]),
  ('public.faolla_attendance_operational_punch_operation_v1(public.merchant_attendance_operational_punch_operations)','232ecc08199da70d28d06d72bf7c4df60e297ed1987cdbe101c3e379f9084897','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_replay_v1(uuid,uuid,text,jsonb)','6a0e64878402dd0002e5429286e1fdbdaef917bedf572b18372c8996cf90ce9b','void','s','plpgsql',false,false,0,array['p_event','p_actor','p_channel','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_guard_v1()','2aabf43314eccc6921ada71b694ead18d62d236847e75e225f0e6841da2b2653','trigger','v','plpgsql',true,false,0,array[]::text[]),
  ('public.faolla_attendance_operational_punch_choices_v1(text,uuid,uuid,uuid,uuid)','5fe5767679b8041cb0bbfebe8e60d03af93c51b9eeb28b1faa77155ed02e909a','jsonb','s','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_auth','p_location']::text[]),
  ('public.faolla_attendance_operational_punch_request_v1(text,text,jsonb,jsonb,boolean,boolean,boolean,boolean)','259f530275ad0a5893d381ea30fa325e3478b0856789af672c4befa3693d0d6a','jsonb','s','plpgsql',false,false,0,array['p_site','p_channel','p_query','p_command','p_allow_new','p_allow_start','p_schedule','p_bind']::text[]),
  ('public.faolla_attendance_operational_punch_lock_v1(text)','18f2022a1b4d8f57dd78f47bac1e93abc2c8892b304085cd3ddabf8d449d3605','void','v','plpgsql',false,false,0,array['p_site']::text[]),
  ('public.faolla_attendance_operational_punch_result_v1(text,uuid,text,jsonb,jsonb,jsonb,jsonb,uuid)','ba1f6a403132f4270fbb7edcc75afd3ade38e487fad322c7f37a1541d08c206f','jsonb','v','plpgsql',false,false,1,array['p_site','p_actor','p_channel','p_query','p_command','p_clock','p_intent','p_terminal']::text[]),
  ('public.faolla_attendance_operational_punch_self_v1(text,uuid,jsonb,jsonb,boolean,boolean,boolean,boolean)','558ed3e947dff39b2336e90c91384b1aa716015d91207aeaacb11e7b5813a940','jsonb','v','plpgsql',true,true,5,array['p_site','p_auth','p_query','p_command','p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules']::text[]),
  ('public.faolla_attendance_operational_punch_location_v1(text,uuid,uuid,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean,boolean)','ab9a499e6ee4618427d936fa20faded4c2964b8552194facdb36e511972a8a56','jsonb','v','plpgsql',true,true,7,array['p_site','p_auth','p_expected_worker','p_query','p_command','p_assertion','p_allow_new_sessions','p_require_clock','p_allow_operational_start','p_allow_schedule','p_bind_rules']::text[]),
  ('public.faolla_attendance_operational_punch_pin_v1(text,uuid,text,text,uuid,boolean,jsonb,jsonb,boolean,boolean,boolean,boolean)','f0bf9c0be01e685e3eb526cf3385fd008b66b7be0693d9036b22e18af1016576','jsonb','v','plpgsql',true,true,5,array['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_query','p_command','p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules']::text[]),
  ('public.faolla_attendance_operational_punch_onsite_v1(text,uuid,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean)','4bebd2262964618f7b326d8dd93f48c81fab5de16dd552eff2f99886c2f75b23','jsonb','v','plpgsql',true,true,5,array['p_site','p_auth','p_claims','p_query','p_command','p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules']::text[]),
  ('public.faolla_attendance_operational_punch_core_self_v1(text,uuid,jsonb,uuid,jsonb)','da1230e51a61288cc208211df474c9d2c296cd304161fd6733209c6eedc27bf9','jsonb','v','plpgsql',false,false,3,array['p_site_id','p_auth_user_id','p_command','p_operation_id','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_core_pin_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb)','f8952e91900866a9325ac0f2f1bf185cf84a13bfc7e5a13a9b9c21336833e029','jsonb','v','plpgsql',false,false,1,array['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_core_onsite_v1(text,uuid,jsonb,jsonb,uuid,boolean,jsonb)','fb4ef0bd317c450c52821d4c70c6a6756b0c2c9a0016a7c4e768947638deb98c','jsonb','v','plpgsql',false,false,1,array['p_site','p_auth','p_claims','p_command','p_operation','p_allow_new','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_core_location_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb)','388a36bcead29109e22b0be3b2eb514dc195e50863dcb5ae679859bf3259ec76','jsonb','v','plpgsql',false,false,6,array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_core_location_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb)','628cfefc46d9216568da94dcb3904ec55ab649e1d81d435cf1b6f1ad2b0cf04a','jsonb','v','plpgsql',false,false,6,array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock','p_intent']::text[])
 ) pinned(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility
   or info.lanname is distinct from expected.language_name or info.prorettype is distinct from to_regtype(expected.result_type)
   or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc
  then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_operational_punch_activations',array['merchant_id','operation_id','revision','actor_auth_user_id','action','reason','command','command_fingerprint','recorded_at']::text[],array['text','uuid','bigint','uuid','text','text','jsonb','text','timestamp with time zone']::text[],8,1),
  ('merchant_attendance_operational_punch_sessions',array['merchant_id','worker_id','employee_id','employee_auth_user_id','start_event_id','operation_id','session','source_ref']::text[],array['text','uuid','uuid','uuid','uuid','uuid','jsonb','jsonb']::text[],2,3),
  ('merchant_attendance_operational_punch_operations',array['merchant_id','worker_id','event_id','operation_id','start_event_id','channel','command','operation','origin_ref']::text[],array['text','uuid','uuid','uuid','uuid','text','jsonb','jsonb','jsonb']::text[],2,3)
 ) tables(table_name,columns,types,checks,fkeys) loop
  t:=to_regclass('public.'||expected.table_name);
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or array(select a.attname::text from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.columns
   or array(select format_type(a.atttypid,a.atttypmod) from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.types
   or exists(select 1 from pg_attribute where attrelid=t and attnum>0 and (attisdropped or not attnotnull or atthasdef or attidentity<>'' or attgenerated<>'' or attndims<>0))
   or exists(select 1 from pg_constraint where conrelid=t and (not convalidated or contype='c' and connoinherit))
   or (select count(*) from pg_constraint where conrelid=t and contype='c')<>expected.checks
   or (select count(*) from pg_constraint where conrelid=t and contype='f')<>expected.fkeys
   or (select count(*) from pg_constraint where conrelid=t and contype='p')<>1
   or (select count(*) from pg_constraint where conrelid=t and contype='u')<>1
   or exists(select 1 from pg_constraint where conrelid=t and contype not in('c','f','p','u','t'))
   or (select count(*) from pg_index where indrelid=t)<>2
   or exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indrelid=t
    and (not i.indisvalid or not i.indisready or not i.indislive or not i.indisunique or i.indisexclusion or i.indpred is not null or i.indexprs is not null or a.amname<>'btree' or c.relowner<>expected_owner))
   or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_no_truncate' and tgtype=34 and tgenabled='O' and tgnargs=0 and tgqual is null
    and not tgdeferrable and not tginitdeferred and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_immutable' and tgtype=27 and tgenabled='O' and tgnargs=0 and tgqual is null
    and not tgdeferrable and not tginitdeferred and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_proof' and tgtype=5 and tgenabled='O' and tgnargs=0 and tgqual is null
    and tgdeferrable and tginitdeferred and tgconstraint<>0 and tgfoid='public.faolla_attendance_operational_punch_guard_v1()'::regprocedure)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  then raise exception 'merchant_attendance_operational_punch_table_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_operational_punch_table_conflict';end if;
  end loop;
 end loop;
end;
$punch_preflight$;

create or replace function public.faolla_attendance_operational_punch_hash_v1(p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
 select encode(sha256(convert_to(p::text,'UTF8')),'hex');
$$;
create or replace function public.faolla_attendance_operational_punch_stamp_v1(p timestamptz)
returns text language sql immutable set search_path=pg_catalog as $$
 select to_char(p at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;
create or replace function public.faolla_attendance_operational_punch_selection_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
begin
 if p='null'::jsonb then return p;end if;
 if public.faolla_attendance_operational_rule_object_v1(p,array['slotId','revision']) is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(p->'slotId','uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(p->'revision','positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
 return jsonb_build_array(p->>'slotId',(p->>'revision')::bigint);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_command_v1(p_channel text,p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare c jsonb;q jsonb;t jsonb;z jsonb;k text;expected_keys text[];
begin
 if p_channel is null or p_channel not in('self','location','pin','onsite')
  or public.faolla_attendance_operational_rule_object_v1(p,array['clock','choice']) is distinct from true
  or octet_length(convert_to(p::text,'UTF8'))>8192 then raise exception 'attendance_invalid_request';end if;
 c:=p->'clock';q:=p->'choice';expected_keys:=array['expectedWorkerId','operationId','locationId','action','expectedSequence'];
 if p_channel in('pin','onsite') then expected_keys:=expected_keys||array['expectedEmployeeId'];
 elsif p_channel='location' then expected_keys:=expected_keys||array['settingsVersion','workerVersion','locationVersion','noticeRevision','safeFinish'];end if;
 if public.faolla_attendance_operational_rule_object_v1(c,expected_keys) is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(c->'expectedWorkerId','uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(c->'operationId','uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(c->'locationId','uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(c->'expectedSequence','revision') is distinct from true
  or jsonb_typeof(c->'action') is distinct from 'string' or c->>'action' not in('clock_in','break_start','break_end','clock_out') then raise exception 'attendance_invalid_request';end if;
 if p_channel in('pin','onsite') then
  if public.faolla_attendance_operational_rule_scalar_v1(c->'expectedEmployeeId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  t:=jsonb_build_array(c->>'expectedWorkerId',c->>'expectedEmployeeId',c->>'operationId',c->>'locationId',c->>'action',(c->>'expectedSequence')::bigint);
 else t:=jsonb_build_array(c->>'expectedWorkerId',c->>'operationId',c->>'locationId',c->>'action',(c->>'expectedSequence')::bigint);end if;
 if p_channel='location' then
  foreach k in array array['settingsVersion','workerVersion','locationVersion'] loop
   if public.faolla_attendance_operational_rule_scalar_v1(c->k,'positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  if jsonb_typeof(c->'safeFinish') is distinct from 'boolean' then raise exception 'attendance_invalid_request';end if;
  if c->'safeFinish'='true'::jsonb then
   if c->'noticeRevision' is distinct from 'null'::jsonb or c->>'action' not in('break_end','clock_out') then raise exception 'attendance_invalid_request';end if;
  elsif public.faolla_attendance_operational_rule_scalar_v1(c->'noticeRevision','positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
  t:=t||jsonb_build_array((c->>'settingsVersion')::bigint,(c->>'workerVersion')::bigint,(c->>'locationVersion')::bigint,c->'noticeRevision',c->'safeFinish');
 end if;
 if c->>'action'='clock_in' then
  if public.faolla_attendance_operational_rule_object_v1(q,array['kind','expectedPolicyFingerprint','selection']) is distinct from true
   or q->>'kind' is distinct from 'start' or public.faolla_attendance_operational_rule_scalar_v1(q->'expectedPolicyFingerprint','hash') is distinct from true then raise exception 'attendance_invalid_request';end if;
  z:=jsonb_build_array('start',q->>'expectedPolicyFingerprint',public.faolla_attendance_operational_punch_selection_v1(q->'selection'));
 elsif c->>'action'='break_start' then
  if q->>'kind'='legacy_break' and public.faolla_attendance_operational_rule_object_v1(q,array['kind']) is true then z:=jsonb_build_array('legacy_break');
  else
   if public.faolla_attendance_operational_rule_object_v1(q,array['kind','startEventId','expectedSessionFingerprint','breakType']) is distinct from true
    or q->>'kind' is distinct from 'break' or public.faolla_attendance_operational_rule_scalar_v1(q->'startEventId','uuid') is distinct from true
    or public.faolla_attendance_operational_rule_scalar_v1(q->'expectedSessionFingerprint','hash') is distinct from true
    or q->'breakType' not in('null'::jsonb,'"paid"'::jsonb,'"unpaid"'::jsonb) then raise exception 'attendance_invalid_request';end if;
   z:=jsonb_build_array('break',q->>'startEventId',q->>'expectedSessionFingerprint',q->'breakType');
  end if;
 else
  if public.faolla_attendance_operational_rule_object_v1(q,array['kind']) is distinct from true or q->>'kind' is distinct from 'finish' then raise exception 'attendance_invalid_request';end if;
  z:=jsonb_build_array('finish');
 end if;
 return jsonb_build_array(t,z);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_activation_command_v1(p_site text,p_actor uuid,p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
 if p_actor is null or public.faolla_attendance_operational_rule_object_v1(p,array['siteId','operationId','action','expectedRevision','reason']) is distinct from true
  or p->>'siteId' is distinct from p_site or p_site is null or char_length(p_site)<>8 or p_site!~'^[0-9]{8}$'
  or public.faolla_attendance_operational_rule_scalar_v1(p->'operationId','uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(p->'expectedRevision','revision') is distinct from true
  or (p->>'expectedRevision')::bigint>=9007199254740990 or jsonb_typeof(p->'action') is distinct from 'string'
  or p->>'action' not in('activate','deactivate') or jsonb_typeof(p->'reason') is distinct from 'string'
  or public.faolla_attendance_group_text_v1(p->>'reason',1,200) is distinct from true then raise exception 'attendance_invalid_request';end if;
 return jsonb_build_array('attendance-operational-punch-activation-command-v1',p_site,p_actor,
  jsonb_build_array(p->>'operationId',p->>'action',(p->>'expectedRevision')::bigint,p->>'reason'));
end;
$$;

create table if not exists public.merchant_attendance_operational_punch_activations (
 merchant_id text not null references public.merchant_attendance_settings(merchant_id),operation_id uuid not null,
 revision bigint not null check(revision between 1 and 9007199254740990),actor_auth_user_id uuid not null,
 action text not null check(action in('activate','deactivate')),reason text not null,command jsonb not null,
 command_fingerprint text not null check(char_length(command_fingerprint)=64 and command_fingerprint~'^[0-9a-f]{64}$'),
 recorded_at timestamptz not null check(isfinite(recorded_at)),primary key(merchant_id,operation_id),unique(merchant_id,revision),
 check(public.faolla_attendance_group_text_v1(reason,1,200)),
 check(command->>'siteId'=merchant_id and command->>'operationId'=operation_id::text and command->>'action'=action and command->>'reason'=reason),
 check((command->>'expectedRevision')::bigint=revision-1),
 check(command_fingerprint=public.faolla_attendance_operational_punch_hash_v1(public.faolla_attendance_operational_punch_activation_command_v1(merchant_id,actor_auth_user_id,command)))
);
create table if not exists public.merchant_attendance_operational_punch_sessions (
 merchant_id text not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
 start_event_id uuid primary key references public.merchant_attendance_events(id),operation_id uuid not null,
 session jsonb not null,source_ref jsonb not null,unique(merchant_id,worker_id,operation_id),
 foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
 foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
 check(octet_length(convert_to(source_ref::text,'UTF8'))<=16384),
 check(octet_length(convert_to(session::text,'UTF8'))+octet_length(convert_to(source_ref::text,'UTF8'))<=32768)
);
create table if not exists public.merchant_attendance_operational_punch_operations (
 merchant_id text not null,worker_id uuid not null,event_id uuid primary key references public.merchant_attendance_events(id),
 operation_id uuid not null,start_event_id uuid not null references public.merchant_attendance_events(id),
 channel text not null check(channel in('self','location','pin','onsite')),command jsonb not null,operation jsonb not null,origin_ref jsonb not null,
 unique(merchant_id,worker_id,operation_id),
 foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
 check(octet_length(convert_to(command::text,'UTF8'))+octet_length(convert_to(operation::text,'UTF8'))+octet_length(convert_to(origin_ref::text,'UTF8'))<=16384)
);

create or replace function public.faolla_attendance_operational_punch_activation_item_v1(p public.merchant_attendance_operational_punch_activations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
 if p.operation_id is null then return null;end if;
 if p.command_fingerprint is distinct from public.faolla_attendance_operational_punch_hash_v1(public.faolla_attendance_operational_punch_activation_command_v1(p.merchant_id,p.actor_auth_user_id,p.command))
  or p.revision is distinct from (p.command->>'expectedRevision')::bigint+1 or p.operation_id::text is distinct from p.command->>'operationId'
  or p.action is distinct from p.command->>'action' or p.reason is distinct from p.command->>'reason' or not isfinite(p.recorded_at) then raise exception 'attendance_operational_punch_invalid';end if;
 return jsonb_build_object('siteId',p.merchant_id,'operationId',p.operation_id,'revision',p.revision,'actorId',p.actor_auth_user_id,
  'action',p.action,'reason',p.reason,'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at),'commandFingerprint',p.command_fingerprint);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_activation_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_activate boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;op uuid;owner_id uuid;s public.merchant_attendance_settings%rowtype;
 head public.merchant_attendance_operational_punch_activations%rowtype;saved public.merchant_attendance_operational_punch_activations%rowtype;
 stamp timestamptz;tuple_value jsonb;can_activate boolean:=false;can_deactivate boolean:=false;
begin
 site:=p_query->>'siteId';mode_name:=p_query->>'mode';
 if p_auth_user_id is null or p_allow_activate is null or site is null or char_length(site)<>8 or site!~'^[0-9]{8}$' then raise exception 'attendance_invalid_request';end if;
 if mode_name='current' then
  if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode']) is distinct from true then raise exception 'attendance_invalid_request';end if;
 elsif mode_name='recover' then
  if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','operationId']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  op:=(p_query->>'operationId')::uuid;
 else raise exception 'attendance_invalid_request';end if;
 if mode_name='recover' then
  select * into saved from public.merchant_attendance_operational_punch_activations x where x.merchant_id=site and x.operation_id=op and x.actor_auth_user_id=p_auth_user_id;
  return jsonb_build_object('protocol','attendance-operational-punch-activation-v1','siteId',site,'actorId',p_auth_user_id,
   'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'canActivate',false,'canDeactivate',false,'current',null,
   'receipt',public.faolla_attendance_operational_punch_activation_item_v1(saved));
 end if;
 select user_id into owner_id from public.merchants where id=site for share;
 if owner_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
 if p_command is not null then select * into s from public.merchant_attendance_settings where merchant_id=site for update;
 else select * into s from public.merchant_attendance_settings where merchant_id=site for share;end if;
 if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
 select * into head from public.merchant_attendance_operational_punch_activations x where x.merchant_id=site order by x.revision desc limit 1;
 perform public.faolla_attendance_operational_punch_activation_item_v1(head);
 if p_command is not null then
  tuple_value:=public.faolla_attendance_operational_punch_activation_command_v1(site,p_auth_user_id,p_command);op:=(p_command->>'operationId')::uuid;
  select * into saved from public.merchant_attendance_operational_punch_activations x where x.merchant_id=site and x.operation_id=op;
  if saved.operation_id is not null then
   if saved.actor_auth_user_id<>p_auth_user_id or saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
  else
   if (p_command->>'expectedRevision')::bigint<>coalesce(head.revision,0) then raise exception 'attendance_operational_punch_changed';end if;
   if p_command->>'action'='activate' and (not p_allow_activate or not s.enabled) then raise exception 'attendance_operational_punch_disabled';end if;
   if coalesce(head.action,'deactivate')=p_command->>'action' then raise exception 'attendance_operational_punch_unchanged';end if;
   stamp:=date_trunc('milliseconds',clock_timestamp());
   if head.recorded_at>stamp then raise exception 'attendance_operational_punch_changed';end if;
   insert into public.merchant_attendance_operational_punch_activations(merchant_id,operation_id,revision,actor_auth_user_id,action,reason,command,command_fingerprint,recorded_at)
    values(site,op,coalesce(head.revision,0)+1,p_auth_user_id,p_command->>'action',p_command->>'reason',p_command,
     public.faolla_attendance_operational_punch_hash_v1(tuple_value),stamp) returning * into saved;
   head:=saved;
  end if;
 else can_activate:=p_allow_activate and s.enabled and coalesce(head.action,'deactivate')='deactivate';can_deactivate:=head.action='activate';end if;
 return jsonb_build_object('protocol','attendance-operational-punch-activation-v1','siteId',site,'actorId',p_auth_user_id,
  'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'canActivate',can_activate,'canDeactivate',coalesce(can_deactivate,false),
  'current',public.faolla_attendance_operational_punch_activation_item_v1(head),'receipt',public.faolla_attendance_operational_punch_activation_item_v1(saved));
end;
$$;

create or replace function public.faolla_attendance_operational_punch_fields_v1(p_source jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;layer_name text;v jsonb;c jsonb;trace_value jsonb;selected jsonb;sources_value jsonb;
 state_name text;value_now jsonb;restriction jsonb;result_value jsonb:='{}';
begin
 if p_source->>'sourceFingerprint' is distinct from public.faolla_attendance_operational_punch_hash_v1(public.faolla_attendance_operational_source_tuple_v1(p_source)) then raise exception 'attendance_operational_punch_invalid';end if;
 foreach k in array array['allowedChannels','locationScope','shiftSource','breakTypes'] loop
  trace_value:='[]';selected:=null;sources_value:='[]';restriction:=null;
  foreach layer_name in array array['personal','group','enterprise'] loop
   v:=p_source->'layers'->layer_name;
   if v='null'::jsonb and layer_name<>'enterprise' then continue;end if;
   c:=case when v='null'::jsonb then jsonb_build_object('mode','inherit') else v->'rules'->k end;
   trace_value:=trace_value||jsonb_build_array(jsonb_build_object('layer',layer_name,'choice',c));
   if selected is null and c->>'mode'<>'inherit' then selected:=c;sources_value:=jsonb_build_array(layer_name);end if;
  end loop;
  state_name:=coalesce(selected->>'mode','unconfigured');value_now:=case when state_name='value' then selected->'value' else 'null'::jsonb end;
  if k='locationScope' then
   sources_value:='[]';
   for v in select value from jsonb_array_elements(trace_value) loop
    if v->'choice'->>'mode'='value' then
     sources_value:=sources_value||jsonb_build_array(v->>'layer');
     if restriction is null then restriction:=v->'choice'->'value';
     else select coalesce(jsonb_agg(x.value order by (x.value#>>'{}') collate "C"),'[]') into restriction from jsonb_array_elements(restriction) x where (v->'choice'->'value') @> jsonb_build_array(x.value);end if;
    end if;
   end loop;
   if restriction is not null then state_name:='value';value_now:=restriction;
   elsif selected is not null then
    for v in select value from jsonb_array_elements(trace_value) loop
     if v->'choice'->>'mode'<>'inherit' then sources_value:=jsonb_build_array(v->>'layer');exit;end if;
    end loop;
   end if;
  end if;
  result_value:=result_value||jsonb_build_object(k,jsonb_build_object('state',state_name,'value',value_now,'sources',sources_value,'trace',trace_value));
 end loop;
 return result_value;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_value_tuple_v1(p_key text,p jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select case when p='null'::jsonb then p when p_key='breakTypes' then jsonb_build_array(p->'allowed',p->>'selection') else p end;
$$;
create or replace function public.faolla_attendance_operational_punch_fields_tuple_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare k text;f jsonb;t jsonb;v jsonb;c jsonb;ct jsonb;result_value jsonb:='[]';
begin
 if public.faolla_attendance_operational_rule_object_v1(p,array['allowedChannels','locationScope','shiftSource','breakTypes']) is distinct from true then raise exception 'attendance_operational_punch_invalid';end if;
 foreach k in array array['allowedChannels','locationScope','shiftSource','breakTypes'] loop
  f:=p->k;t:='[]';
  if public.faolla_attendance_operational_rule_object_v1(f,array['state','value','sources','trace']) is distinct from true or jsonb_typeof(f->'trace') is distinct from 'array' or jsonb_array_length(f->'trace')>3 then raise exception 'attendance_operational_punch_invalid';end if;
  for v in select value from jsonb_array_elements(f->'trace') loop
   c:=v->'choice';ct:=case when c->>'mode'='value' then jsonb_build_array('value',public.faolla_attendance_operational_punch_value_tuple_v1(k,c->'value')) else jsonb_build_array(c->>'mode') end;
   t:=t||jsonb_build_array(jsonb_build_array(v->>'layer',ct));
  end loop;
  result_value:=result_value||jsonb_build_array(jsonb_build_array(f->>'state',public.faolla_attendance_operational_punch_value_tuple_v1(k,f->'value'),f->'sources',t));
 end loop;
 return result_value;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_origins_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare k text;v jsonb;r jsonb:='[]';
begin
 foreach k in array array['enterprise','group','personal'] loop
  v:=p->'layers'->k;if v='null'::jsonb then continue;end if;
  r:=r||jsonb_build_array(jsonb_build_object('layer',k,'operationId',v->'operationId','revision',v->'revision','effectiveAt',v->'effectiveAt',
   'endsAt',v->'endsAt','rulesFingerprint',v->'rulesFingerprint','referenceFingerprint',v->'referenceFingerprint'));
 end loop;return r;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_policy_hash_v1(p_site text,p_channel text,p_policy jsonb,p_source jsonb)
returns text language plpgsql stable set search_path=pg_catalog as $$
declare t jsonb;l jsonb;
begin
 t:=public.faolla_attendance_operational_source_tuple_v1(p_source);l:=p_policy->'legacy';
 return public.faolla_attendance_operational_punch_hash_v1(jsonb_build_array('attendance-operational-punch-policy-v1',p_site,p_channel,
  p_policy->>'locationId',(p_policy->>'locationVersion')::bigint,(p_policy->>'activationRevision')::bigint,
  t->2,t->4,t->5,t->6,t->7,jsonb_build_array((l->>'settingsVersion')::bigint,l->'webBreakPaid',l->'scheduleEnabled')));
end;
$$;
create or replace function public.faolla_attendance_operational_punch_source_ref_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;v jsonb;l jsonb:='{}';
begin
 if p->>'sourceFingerprint' is distinct from public.faolla_attendance_operational_punch_hash_v1(public.faolla_attendance_operational_source_tuple_v1(p)) then raise exception 'attendance_operational_punch_invalid';end if;
 foreach k in array array['enterprise','group','personal'] loop
  v:=p->'layers'->k;l:=l||jsonb_build_object(k,case when v='null'::jsonb then 'null'::jsonb else jsonb_build_object('operationId',v->'operationId','revision',v->'revision') end);
 end loop;
 return (p-'protocol'-'layers')||jsonb_build_object('protocol','attendance-operational-punch-source-ref-v1','layers',l);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_saved_source_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;v jsonb;item_value jsonb;l jsonb:='{}';r jsonb;o public.merchant_attendance_operational_rule_operations%rowtype;
 baseline public.merchant_attendance_correction_controls%rowtype;
begin
 if public.faolla_attendance_operational_rule_object_v1(p,array['protocol','siteId','workerIdentity','at','settingsRef','groupAssignmentRef','layers','baselineCorrectionPolicyRef','sourceFingerprint']) is distinct from true
  or p->>'protocol' is distinct from 'attendance-operational-punch-source-ref-v1' or octet_length(convert_to(p::text,'UTF8'))>16384
  or public.faolla_attendance_operational_rule_object_v1(p->'layers',array['enterprise','group','personal']) is distinct from true then raise exception 'attendance_operational_punch_invalid';end if;
 foreach k in array array['enterprise','group','personal'] loop
  v:=p->'layers'->k;
  if v='null'::jsonb then l:=l||jsonb_build_object(k,null);continue;end if;
  if public.faolla_attendance_operational_rule_object_v1(v,array['operationId','revision']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(v->'operationId','uuid') is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(v->'revision','positive') is distinct from true then raise exception 'attendance_operational_punch_invalid';end if;
  select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p->>'siteId' and x.operation_id=(v->>'operationId')::uuid;
  if o.operation_id is null or o.action<>'publish' or o.revision<>(v->>'revision')::bigint then raise exception 'attendance_operational_punch_invalid';end if;
  item_value:=public.faolla_attendance_operational_rule_item_v1(o);
  l:=l||jsonb_build_object(k,jsonb_build_object('scope',o.scope,'operationId',o.operation_id,'revision',o.revision,'context',item_value->'context',
   'effectiveAt',item_value->'effectiveAt','endsAt',item_value->'endsAt','rulesFingerprint',item_value->'rulesFingerprint','referenceFingerprint',item_value->'referenceFingerprint',
   'rules',item_value->'rules','references',item_value->'references'));
 end loop;
 r:=(p-'protocol'-'layers')||jsonb_build_object('protocol','attendance-operational-rule-source-v1','layers',l);
 if r->>'sourceFingerprint' is distinct from public.faolla_attendance_operational_punch_hash_v1(public.faolla_attendance_operational_source_tuple_v1(r)) then raise exception 'attendance_operational_punch_invalid';end if;
 v:=r->'baselineCorrectionPolicyRef';
 if v<>'null'::jsonb then
  select * into baseline from public.merchant_attendance_correction_controls x where x.merchant_id=p->>'siteId' and x.operation_id=(v->>'operationId')::uuid;
  if baseline.operation_id is null or baseline.action<>'set_policy' or v is distinct from jsonb_build_object('operationId',baseline.operation_id,'revision',baseline.revision,
   'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(baseline.recorded_at),'submissionWindowDays',baseline.payload->'submissionWindowDays','timeZone',baseline.payload->'timeZone') then raise exception 'attendance_operational_punch_invalid';end if;
 end if;
 return r;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_session_hash_v1(p_site text,p jsonb)
returns text language plpgsql stable set search_path=pg_catalog as $$
declare origins jsonb:='[]';v jsonb;l jsonb;
begin
 for v in select value from jsonb_array_elements(p->'origins') loop origins:=origins||jsonb_build_array(jsonb_build_array(v->>'layer',v->>'operationId',(v->>'revision')::bigint,
  v->>'effectiveAt',v->>'endsAt',v->>'rulesFingerprint',v->>'referenceFingerprint'));end loop;l:=p->'legacy';
 return public.faolla_attendance_operational_punch_hash_v1(jsonb_build_array('attendance-operational-punch-session-v1',p_site,
  jsonb_build_array(p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId'),p->>'actorAuthUserId',p->>'startEventId',p->>'operationId',(p->>'startSequence')::bigint,
  p->>'occurredAt',p->>'channel',p->>'locationId',(p->>'locationVersion')::bigint,(p->>'activationRevision')::bigint,p->>'sourceFingerprint',p->>'policyFingerprint',
  public.faolla_attendance_operational_punch_fields_tuple_v1(p->'fields'),origins,jsonb_build_array((l->>'settingsVersion')::bigint,l->'webBreakPaid',l->'scheduleEnabled'),
  public.faolla_attendance_operational_punch_selection_v1(p->'selection')));
end;
$$;
create or replace function public.faolla_attendance_operational_punch_current_start_v1(p_site text,p_worker uuid)
returns uuid language plpgsql stable set search_path=pg_catalog as $$
declare last_fact public.merchant_attendance_events%rowtype;start_fact public.merchant_attendance_events%rowtype;
begin
 select * into last_fact from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=p_worker order by x.sequence desc limit 1;
 if last_fact.id is null or last_fact.action='clock_out' then return null;end if;
 select * into start_fact from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=p_worker and x.action='clock_in'
  order by x.occurred_at desc,x.sequence desc limit 1;
 if start_fact.id is null or start_fact.sequence>last_fact.sequence or start_fact.actor_employee_id is distinct from last_fact.actor_employee_id then raise exception 'attendance_operational_punch_invalid';end if;
 return start_fact.id;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_legacy_gate_v1(p_site text,p_worker uuid,p_action text,p_receipt uuid default null)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare h public.merchant_attendance_operational_punch_activations%rowtype;sid uuid;
begin
 if p_receipt is not null then
  if exists(select 1 from public.merchant_attendance_operational_punch_operations x where x.event_id=p_receipt) then raise exception 'attendance_operational_punch_protocol_required';end if;return;
 end if;
 if p_action='clock_in' then
  select * into h from public.merchant_attendance_operational_punch_activations x where x.merchant_id=p_site order by x.revision desc limit 1;
  perform public.faolla_attendance_operational_punch_activation_item_v1(h);
  if h.action='activate' then raise exception 'attendance_operational_punch_protocol_required';end if;
 elsif p_action='break_start' then
  sid:=public.faolla_attendance_operational_punch_current_start_v1(p_site,p_worker);
  if exists(select 1 from public.merchant_attendance_operational_punch_sessions x where x.start_event_id=sid) then raise exception 'attendance_operational_punch_protocol_required';end if;
 end if;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_policy_v1(p_site text,p_channel text,p_worker uuid,p_employee uuid,p_auth uuid,p_location uuid,p_at timestamptz,p_schedule boolean)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare h public.merchant_attendance_operational_punch_activations%rowtype;s public.merchant_attendance_settings%rowtype;l public.merchant_attendance_locations%rowtype;
 src jsonb;v jsonb;
begin
 if p_schedule is null then raise exception 'attendance_invalid_request';end if;
 select * into h from public.merchant_attendance_operational_punch_activations x where x.merchant_id=p_site order by x.revision desc limit 1;
 perform public.faolla_attendance_operational_punch_activation_item_v1(h);
 if h.action is distinct from 'activate' then raise exception 'attendance_operational_punch_disabled';end if;
 select * into s from public.merchant_attendance_settings where merchant_id=p_site;
 select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=p_location for share;
 if s.merchant_id is null or l.id is null then raise exception 'attendance_operational_punch_changed';end if;
 src:=public.faolla_attendance_operational_source_v1(p_site,p_worker,p_employee,p_auth,p_at);
 v:=jsonb_build_object('checkedAt',src->'at','policyFingerprint',repeat('0',64),'sourceFingerprint',src->'sourceFingerprint',
  'workerIdentity',src->'workerIdentity','locationId',l.id,'locationVersion',l.version,'activationRevision',h.revision,
  'fields',public.faolla_attendance_operational_punch_fields_v1(src),'origins',public.faolla_attendance_operational_punch_origins_v1(src),
  'legacy',jsonb_build_object('settingsVersion',s.version,'webBreakPaid',s.web_break_paid,'scheduleEnabled',p_schedule));
 v:=jsonb_set(v,'{policyFingerprint}',to_jsonb(public.faolla_attendance_operational_punch_policy_hash_v1(p_site,p_channel,v,src)));
 return jsonb_build_object('policy',v,'source',src);
exception when raise_exception then
 if sqlerrm in('attendance_operational_source_not_found','attendance_operational_source_identity_changed','attendance_operational_source_group_inactive','attendance_operational_source_ambiguous') then raise exception 'attendance_operational_punch_changed';
 elsif sqlerrm='attendance_operational_source_too_large' then raise exception 'attendance_operational_punch_too_large';
 elsif sqlerrm='attendance_operational_source_invalid' then raise exception 'attendance_operational_punch_invalid';end if;raise;
end;
$$;

create or replace function public.faolla_attendance_operational_punch_session_v1(p public.merchant_attendance_operational_punch_sessions)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare v jsonb;src jsonb;ev public.merchant_attendance_events%rowtype;h public.merchant_attendance_operational_punch_activations%rowtype;policy_value jsonb;
begin
 if p.start_event_id is null then return null;end if;v:=p.session;
 if public.faolla_attendance_operational_rule_object_v1(v,array['startEventId','operationId','startSequence','occurredAt','workerId','employeeId','employeeAuthUserId','actorAuthUserId',
  'channel','locationId','locationVersion','activationRevision','sourceFingerprint','policyFingerprint','sessionFingerprint','fields','origins','legacy','selection']) is distinct from true then raise exception 'attendance_operational_punch_invalid';end if;
 select * into ev from public.merchant_attendance_events where id=p.start_event_id;
 if row(ev.merchant_id,ev.worker_id,ev.actor_employee_id,ev.operation_id) is distinct from row(p.merchant_id,p.worker_id,p.employee_id,p.operation_id)
  or ev.action is distinct from 'clock_in' or ev.received_at is distinct from ev.occurred_at
  or v->>'startEventId' is distinct from ev.id::text or v->>'operationId' is distinct from ev.operation_id::text or v->>'workerId' is distinct from p.worker_id::text
  or v->>'employeeId' is distinct from p.employee_id::text or v->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
  or v->>'locationId' is distinct from ev.location_id::text or v->'startSequence' is distinct from to_jsonb(ev.sequence)
  or v->>'occurredAt' is distinct from public.faolla_attendance_operational_punch_stamp_v1(ev.occurred_at)
  or v->>'channel' not in('self','location','pin','onsite')
  or (v->'actorAuthUserId') is distinct from (case when v->>'channel'='pin' then 'null'::jsonb else to_jsonb(p.employee_auth_user_id) end) then raise exception 'attendance_operational_punch_invalid';end if;
 src:=public.faolla_attendance_operational_punch_saved_source_v1(p.source_ref);
 if src->>'siteId' is distinct from p.merchant_id or src->'workerIdentity'->>'workerId' is distinct from p.worker_id::text
  or src->'workerIdentity'->>'employeeId' is distinct from p.employee_id::text or src->'workerIdentity'->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
  or src->>'at' is distinct from v->>'occurredAt' or v->'sourceFingerprint' is distinct from src->'sourceFingerprint'
  or v->'fields' is distinct from public.faolla_attendance_operational_punch_fields_v1(src)
  or v->'origins' is distinct from public.faolla_attendance_operational_punch_origins_v1(src)
  or public.faolla_attendance_operational_rule_object_v1(v->'legacy',array['settingsVersion','webBreakPaid','scheduleEnabled']) is distinct from true
  or v->'legacy'->'settingsVersion' is distinct from src->'settingsRef'->'version'
  or jsonb_typeof(v->'legacy'->'webBreakPaid') is distinct from 'boolean' or jsonb_typeof(v->'legacy'->'scheduleEnabled') is distinct from 'boolean'
  or public.faolla_attendance_operational_rule_scalar_v1(v->'locationVersion','positive') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(v->'activationRevision','positive') is distinct from true then raise exception 'attendance_operational_punch_invalid';end if;
 select * into h from public.merchant_attendance_operational_punch_activations x where x.merchant_id=p.merchant_id and x.revision=(v->>'activationRevision')::bigint;
 perform public.faolla_attendance_operational_punch_activation_item_v1(h);
 if h.action is distinct from 'activate' or h.recorded_at>ev.occurred_at then raise exception 'attendance_operational_punch_invalid';end if;
 policy_value:=jsonb_build_object('locationId',v->'locationId','locationVersion',v->'locationVersion','activationRevision',v->'activationRevision','legacy',v->'legacy');
 if v->>'policyFingerprint' is distinct from public.faolla_attendance_operational_punch_policy_hash_v1(p.merchant_id,v->>'channel',policy_value,src)
  or v->>'sessionFingerprint' is distinct from public.faolla_attendance_operational_punch_session_hash_v1(p.merchant_id,v) then raise exception 'attendance_operational_punch_invalid';end if;
 if v->'fields'->'allowedChannels'->>'state'='value' and not(v->'fields'->'allowedChannels'->'value' @> jsonb_build_array(v->>'channel'))
  or v->'fields'->'locationScope'->>'state'='value' and not(v->'fields'->'locationScope'->'value' @> jsonb_build_array(v->>'locationId'))
  or v->'selection'<>'null'::jsonb and (v->'legacy'->'scheduleEnabled'<>'true'::jsonb or v->'fields'->'shiftSource'->>'state'='disabled'
   or v->'fields'->'shiftSource'->'value'='"unplanned"'::jsonb) then raise exception 'attendance_operational_punch_invalid';end if;
 return v;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_before_v1(p_site text,p_worker uuid,p_employee uuid,p_actor uuid,p_channel text,p_location uuid,p_at timestamptz,p_action text,p_default_paid boolean,p_intent jsonb)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare e public.merchant_enterprise_employees%rowtype;saved public.merchant_attendance_operational_punch_sessions%rowtype;
 c jsonb;q jsonb;bundle jsonb;policy_value jsonb;src jsonb;sess jsonb;sid uuid;paid boolean;b jsonb;selected jsonb;
begin
 if p_intent is null then
  perform public.faolla_attendance_operational_punch_legacy_gate_v1(p_site,p_worker,p_action,null);
  return jsonb_build_object('breakPaid',case when p_action='break_start' then p_default_paid else null end);
 end if;
 c:=p_intent->'command';q:=c->'choice';perform public.faolla_attendance_operational_punch_command_v1(p_channel,c);
 select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=p_employee;
 if e.id is null or e.auth_user_id is null or c->'clock'->>'expectedWorkerId' is distinct from p_worker::text
  or c->'clock'->>'locationId' is distinct from p_location::text or c->'clock'->>'action' is distinct from p_action
  or p_channel in('pin','onsite') and c->'clock'->>'expectedEmployeeId' is distinct from p_employee::text
  or p_channel='pin' and p_actor is not null or p_channel<>'pin' and p_actor is distinct from e.auth_user_id then raise exception 'attendance_access_denied';end if;
 if p_action in('clock_in','break_start') and p_intent->'allowNewSessions' is distinct from 'true'::jsonb then raise exception 'attendance_platform_paused';end if;
 if p_action='clock_in' then
  if p_intent->'allowOperationalStart' is distinct from 'true'::jsonb then raise exception 'attendance_operational_punch_disabled';end if;
  bundle:=public.faolla_attendance_operational_punch_policy_v1(p_site,p_channel,p_worker,p_employee,e.auth_user_id,p_location,p_at,(p_intent->>'allowSchedule')::boolean);
  policy_value:=bundle->'policy';src:=bundle->'source';
  if q->'expectedPolicyFingerprint' is distinct from policy_value->'policyFingerprint' then raise exception 'attendance_operational_punch_changed';end if;
  if policy_value->'fields'->'allowedChannels'->>'state'='value' and not(policy_value->'fields'->'allowedChannels'->'value' @> jsonb_build_array(p_channel)) then raise exception 'attendance_operational_punch_channel_denied';end if;
  if policy_value->'fields'->'locationScope'->>'state'='value' and not(policy_value->'fields'->'locationScope'->'value' @> jsonb_build_array(p_location)) then raise exception 'attendance_operational_punch_location_denied';end if;
  selected:=q->'selection';b:=policy_value->'fields'->'shiftSource';
  if selected<>'null'::jsonb and (p_intent->'allowSchedule' is distinct from 'true'::jsonb or b->>'state'='disabled' or b->'value'='"unplanned"'::jsonb) then raise exception 'attendance_operational_punch_changed';end if;
 else
  sid:=public.faolla_attendance_operational_punch_current_start_v1(p_site,p_worker);
  if sid is null then raise exception 'attendance_operational_punch_invalid';end if;
  select * into saved from public.merchant_attendance_operational_punch_sessions where start_event_id=sid;
  if p_action='break_start' then
   if saved.start_event_id is null then
    if q->>'kind'<>'legacy_break' then raise exception 'attendance_operational_punch_changed';end if;paid:=p_default_paid;
   else
    sess:=public.faolla_attendance_operational_punch_session_v1(saved);
    if row(saved.worker_id,saved.employee_id,saved.employee_auth_user_id) is distinct from row(p_worker,p_employee,e.auth_user_id) then raise exception 'attendance_access_denied';end if;
    if q->>'kind'<>'break' or q->>'startEventId' is distinct from sid::text or q->'expectedSessionFingerprint' is distinct from sess->'sessionFingerprint' then raise exception 'attendance_operational_punch_changed';end if;
    b:=sess->'fields'->'breakTypes';
    if b->>'state'='value' then
     if b->'value'->>'selection'='explicit' then
      if q->'breakType'='null'::jsonb or not(b->'value'->'allowed' @> jsonb_build_array(q->'breakType')) then raise exception 'attendance_operational_punch_break_type_denied';end if;paid:=q->>'breakType'='paid';
     else
      if q->'breakType'<>'null'::jsonb then raise exception 'attendance_operational_punch_break_type_denied';end if;paid:=b->'value'->'allowed'->>0='paid';
     end if;
    else
     if q->'breakType'<>'null'::jsonb then raise exception 'attendance_operational_punch_break_type_denied';end if;paid:=(sess->'legacy'->>'webBreakPaid')::boolean;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('source',src,'policy',policy_value,'session',sess,'startEventId',sid,'breakPaid',paid);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_origin_v1(p public.merchant_attendance_events,p_channel text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare pin public.merchant_attendance_pin_clock_receipts%rowtype;onsite public.merchant_attendance_onsite_receipts%rowtype;
 notice public.merchant_attendance_location_clock_notices%rowtype;loc public.merchant_attendance_location_results%rowtype;
begin
 select * into pin from public.merchant_attendance_pin_clock_receipts where event_id=p.id;
 select * into onsite from public.merchant_attendance_onsite_receipts where event_id=p.id;
 select * into notice from public.merchant_attendance_location_clock_notices where event_id=p.id;
 select * into loc from public.merchant_attendance_location_results where event_id=p.id;
 if p_channel='self' then
  if p.source<>'web' or pin.event_id is not null or onsite.event_id is not null or notice.event_id is not null or loc.event_id is not null then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('channel','self','eventId',p.id);
 elsif p_channel='pin' then
  if p.source<>'kiosk' or pin.event_id is null or onsite.event_id is not null or notice.event_id is not null or loc.event_id is not null
   or row(pin.merchant_id,pin.worker_id,pin.employee_id,pin.operation_id) is distinct from row(p.merchant_id,p.worker_id,p.actor_employee_id,p.operation_id) then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('channel','pin','eventId',p.id,'terminalId',pin.terminal_id);
 elsif p_channel='onsite' then
  if p.source<>'web' or onsite.event_id is null or pin.event_id is not null or notice.event_id is not null or loc.event_id is not null
   or row(onsite.merchant_id,onsite.worker_id,onsite.employee_id,onsite.operation_id) is distinct from row(p.merchant_id,p.worker_id,p.actor_employee_id,p.operation_id) then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('channel','onsite','eventId',p.id,'terminalId',onsite.terminal_id,'nonce',onsite.nonce);
 elsif p_channel='location' then
  if p.source<>'web' or notice.event_id is null or loc.event_id is null or pin.event_id is not null or onsite.event_id is not null
   or row(notice.merchant_id,notice.worker_id,notice.employee_id,notice.location_id) is distinct from row(p.merchant_id,p.worker_id,p.actor_employee_id,p.location_id) then raise exception 'attendance_operation_conflict';end if;
  return jsonb_build_object('channel','location','eventId',p.id,'noticeRevision',notice.notice_revision,'safeFinish',notice.safe_finish);
 end if;raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_operational_punch_record_selection_v1(p public.merchant_attendance_events,p_channel text,p_auth uuid,p_selection jsonb)
returns void language plpgsql volatile set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;s public.merchant_attendance_settings%rowtype;
 slot public.merchant_attendance_schedule_slots%rowtype;rel public.merchant_attendance_shift_schedule_relations%rowtype;
 context_value jsonb;slot_item jsonb;publication_item jsonb;cancellation_item jsonb;adoption_value jsonb;
 selected jsonb:=nullif(p_selection,'null'::jsonb);head bigint;status_name text:='unselected';reason_name text;day_now date;
begin
 if p.action<>'clock_in' or p_auth is null then raise exception 'attendance_operational_punch_invalid';end if;
 perform public.faolla_attendance_operational_punch_selection_v1(p_selection);
 select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id;
 select * into l from public.merchant_attendance_locations where merchant_id=p.merchant_id and id=p.location_id;
 select * into s from public.merchant_attendance_settings where merchant_id=p.merchant_id;
 select coalesce(max(x.revision),0) into head from public.merchant_attendance_schedule_commands x where x.merchant_id=p.merchant_id;
 if selected is not null then
  select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p.merchant_id and id=(selected->>'slotId')::uuid;
  if slot.id is null or slot.worker_id is distinct from p.worker_id or slot.employee_id is distinct from p.actor_employee_id then raise exception 'attendance_access_denied';end if;
  if slot.revision is distinct from (selected->>'revision')::bigint then raise exception 'attendance_operational_punch_changed';end if;
  context_value:=public.faolla_attendance_self_schedule_slot_v1(slot);
  if context_value->'publication'->>'employeeAuthUserId' is not null and context_value->'publication'->>'employeeAuthUserId'<>p_auth::text then raise exception 'attendance_access_denied';end if;
  slot_item:=context_value->'slot';publication_item:=nullif(context_value->'publication','null'::jsonb);cancellation_item:=nullif(context_value->'cancellation','null'::jsonb);
  day_now:=(p.occurred_at at time zone p.time_zone)::date;
  reason_name:=case when (slot_item->>'cancelled')::boolean then 'cancelled' when slot.location_id<>p.location_id then 'location_changed'
   when slot.work_date<day_now-1 or slot.work_date>day_now+1 then 'outside_window' when not(slot_item->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
  status_name:=case when reason_name is null then 'linked' else 'unverified' end;
 end if;
 insert into public.merchant_attendance_shift_schedule_relations(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
  employee_id,employee_auth_user_id,worker_version,location_version,settings_version,selection,slot_id,slot_revision,schedule_revision,status,reason,
  slot_snapshot,publication_snapshot,cancellation_snapshot,recorded_at,binding_policy)
 values(p.merchant_id,p.id,p.worker_id,p.operation_id,p.sequence,p.location_id,p.occurred_at,p.time_zone,p.actor_employee_id,p_auth,w.version,l.version,s.version,
  selected,slot.id,slot.revision,head,status_name,reason_name,slot_item,publication_item,cancellation_item,clock_timestamp(),'employee-explicit-clock-in-v1') returning * into rel;
 adoption_value:=public.faolla_attendance_shift_plan_adoption_v1(rel,p_auth,null,true,p_channel);
 insert into public.merchant_attendance_shift_plan_adoptions(merchant_id,start_event_id,worker_id,operation_id,employee_id,employee_auth_user_id,channel,slot_id,approval_operation_id,adoption,recorded_at)
 values(p.merchant_id,p.id,p.worker_id,p.operation_id,p.actor_employee_id,p_auth,p_channel,rel.slot_id,(adoption_value->'approval'->>'operationId')::uuid,adoption_value,rel.recorded_at);
end;
$$;

create or replace function public.faolla_attendance_operational_punch_record_v1(p_event uuid,p_actor uuid,p_channel text,p_intent jsonb,p_decision jsonb)
returns void language plpgsql volatile set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;e public.merchant_enterprise_employees%rowtype;saved public.merchant_attendance_operational_punch_sessions%rowtype;
 src jsonb;policy_value jsonb;sess jsonb;c jsonb;t jsonb;operation_value jsonb;origin_value jsonb;sid uuid;fp text;
begin
 if p_intent is null then return;end if;
 select * into ev from public.merchant_attendance_events where id=p_event;
 if ev.id is null then raise exception 'attendance_operational_punch_invalid';end if;
 select * into e from public.merchant_enterprise_employees where merchant_id=ev.merchant_id and id=ev.actor_employee_id;
 c:=p_intent->'command';t:=public.faolla_attendance_operational_punch_command_v1(p_channel,c);
 if e.auth_user_id is null or ev.operation_id::text is distinct from c->'clock'->>'operationId'
  or ev.worker_id::text is distinct from c->'clock'->>'expectedWorkerId' or ev.action is distinct from c->'clock'->>'action'
  or ev.location_id::text is distinct from c->'clock'->>'locationId' or ev.sequence is distinct from (c->'clock'->>'expectedSequence')::bigint+1
  or ev.break_paid is distinct from (p_decision->>'breakPaid')::boolean
  or (p_channel='pin' and p_actor is not null) or (p_channel<>'pin' and p_actor is distinct from e.auth_user_id) then raise exception 'attendance_operational_punch_invalid';end if;
 origin_value:=public.faolla_attendance_operational_punch_origin_v1(ev,p_channel);
 if ev.action='clock_in' then
  src:=p_decision->'source';policy_value:=p_decision->'policy';sid:=ev.id;
  if src is null or src='null'::jsonb or policy_value->'policyFingerprint' is distinct from c->'choice'->'expectedPolicyFingerprint' then raise exception 'attendance_operational_punch_invalid';end if;
  sess:=jsonb_build_object('startEventId',ev.id,'operationId',ev.operation_id,'startSequence',ev.sequence,'occurredAt',public.faolla_attendance_operational_punch_stamp_v1(ev.occurred_at),
   'workerId',ev.worker_id,'employeeId',ev.actor_employee_id,'employeeAuthUserId',e.auth_user_id,'actorAuthUserId',p_actor,'channel',p_channel,
   'locationId',ev.location_id,'locationVersion',policy_value->'locationVersion','activationRevision',policy_value->'activationRevision','sourceFingerprint',src->'sourceFingerprint',
   'policyFingerprint',policy_value->'policyFingerprint','sessionFingerprint',repeat('0',64),'fields',policy_value->'fields','origins',policy_value->'origins','legacy',policy_value->'legacy','selection',c->'choice'->'selection');
  sess:=jsonb_set(sess,'{sessionFingerprint}',to_jsonb(public.faolla_attendance_operational_punch_session_hash_v1(ev.merchant_id,sess)));
  insert into public.merchant_attendance_operational_punch_sessions(merchant_id,worker_id,employee_id,employee_auth_user_id,start_event_id,operation_id,session,source_ref)
   values(ev.merchant_id,ev.worker_id,ev.actor_employee_id,e.auth_user_id,ev.id,ev.operation_id,sess,public.faolla_attendance_operational_punch_source_ref_v1(src)) returning * into saved;
  perform public.faolla_attendance_operational_punch_session_v1(saved);
  if p_intent->'bindRules'='true'::jsonb then perform public.faolla_attendance_bind_shift_rules_v1(ev.id,p_channel,p_actor);end if;
  perform public.faolla_attendance_operational_punch_record_selection_v1(ev,p_channel,e.auth_user_id,c->'choice'->'selection');
 else
  sid:=(p_decision->>'startEventId')::uuid;
  if sid is null then raise exception 'attendance_operational_punch_invalid';end if;
  select * into saved from public.merchant_attendance_operational_punch_sessions where start_event_id=sid;
  --Finish never re-collects or evaluates current rules. Immutable saved hashes
  --are carried as references; type enforcement already occurred before INSERT.
  sess:=saved.session;
 end if;
 fp:=public.faolla_attendance_operational_punch_hash_v1(jsonb_build_array('attendance-operational-punch-command-v1',ev.merchant_id,p_channel,p_actor,
  jsonb_build_array(ev.worker_id,ev.actor_employee_id,e.auth_user_id),t->0,t->1));
 operation_value:=jsonb_build_object('operationId',ev.operation_id,'eventId',ev.id,'action',ev.action,'channel',p_channel,'workerId',ev.worker_id,
  'employeeId',ev.actor_employee_id,'employeeAuthUserId',e.auth_user_id,'actorAuthUserId',p_actor,'startEventId',sid,'sequence',ev.sequence,
  'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(ev.received_at),'commandFingerprint',fp,'sessionFingerprint',sess->'sessionFingerprint',
  'sourceFingerprint',sess->'sourceFingerprint','breakPaid',ev.break_paid);
 insert into public.merchant_attendance_operational_punch_operations(merchant_id,worker_id,event_id,operation_id,start_event_id,channel,command,operation,origin_ref)
  values(ev.merchant_id,ev.worker_id,ev.id,ev.operation_id,sid,p_channel,c,operation_value,origin_value);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_operation_v1(p public.merchant_attendance_operational_punch_operations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;start_fact public.merchant_attendance_events%rowtype;sess public.merchant_attendance_operational_punch_sessions%rowtype;
 v jsonb;c jsonb;t jsonb;paid boolean;b jsonb;choice_value jsonb;latest_start uuid;origin_command jsonb;
begin
 if p.event_id is null then return null;end if;v:=p.operation;c:=p.command;
 if public.faolla_attendance_operational_rule_object_v1(v,array['operationId','eventId','action','channel','workerId','employeeId','employeeAuthUserId','actorAuthUserId','startEventId','sequence',
  'recordedAt','commandFingerprint','sessionFingerprint','sourceFingerprint','breakPaid']) is distinct from true then raise exception 'attendance_operational_punch_invalid';end if;
 t:=public.faolla_attendance_operational_punch_command_v1(p.channel,c);
 select * into ev from public.merchant_attendance_events where id=p.event_id;
 select * into start_fact from public.merchant_attendance_events where id=p.start_event_id;
 select x.id into latest_start from public.merchant_attendance_events x where x.merchant_id=p.merchant_id and x.worker_id=p.worker_id and x.action='clock_in'
  and row(x.occurred_at,x.sequence)<=row(ev.occurred_at,ev.sequence) order by x.occurred_at desc,x.sequence desc limit 1;
 if row(ev.merchant_id,ev.worker_id,ev.operation_id) is distinct from row(p.merchant_id,p.worker_id,p.operation_id)
  or row(start_fact.merchant_id,start_fact.worker_id,start_fact.actor_employee_id) is distinct from row(p.merchant_id,p.worker_id,ev.actor_employee_id)
  or start_fact.action is distinct from 'clock_in' or start_fact.sequence>ev.sequence or latest_start is distinct from p.start_event_id
  or v->>'eventId' is distinct from ev.id::text or v->>'operationId' is distinct from ev.operation_id::text
  or v->>'workerId' is distinct from ev.worker_id::text or v->>'employeeId' is distinct from ev.actor_employee_id::text
  or v->>'channel' is distinct from p.channel or v->>'action' is distinct from ev.action or v->'sequence' is distinct from to_jsonb(ev.sequence)
  or v->>'startEventId' is distinct from start_fact.id::text or v->>'recordedAt' is distinct from public.faolla_attendance_operational_punch_stamp_v1(ev.received_at)
  or v->'breakPaid' is distinct from coalesce(to_jsonb(ev.break_paid),'null'::jsonb)
  or c->'clock'->>'expectedWorkerId' is distinct from ev.worker_id::text or c->'clock'->>'operationId' is distinct from ev.operation_id::text
  or c->'clock'->>'locationId' is distinct from ev.location_id::text or c->'clock'->>'action' is distinct from ev.action
  or (c->'clock'->>'expectedSequence')::bigint+1<>ev.sequence
  or public.faolla_attendance_operational_rule_scalar_v1(v->'employeeAuthUserId','uuid') is distinct from true
  or v->'actorAuthUserId' is distinct from (case when p.channel='pin' then 'null'::jsonb else v->'employeeAuthUserId' end)
  or p.origin_ref is distinct from public.faolla_attendance_operational_punch_origin_v1(ev,p.channel)
  or v->>'commandFingerprint' is distinct from public.faolla_attendance_operational_punch_hash_v1(jsonb_build_array('attendance-operational-punch-command-v1',p.merchant_id,p.channel,
   v->>'actorAuthUserId',jsonb_build_array(ev.worker_id,ev.actor_employee_id,v->>'employeeAuthUserId'),t->0,t->1)) then raise exception 'attendance_operational_punch_invalid';end if;
 if p.channel in('pin','onsite') and c->'clock'->>'expectedEmployeeId' is distinct from ev.actor_employee_id::text then raise exception 'attendance_operational_punch_invalid';end if;
 if p.channel='pin' then select x.command into origin_command from public.merchant_attendance_pin_clock_receipts x where x.event_id=ev.id;
 elsif p.channel='onsite' then select x.command into origin_command from public.merchant_attendance_onsite_receipts x where x.event_id=ev.id;
 elsif p.channel='location' then select x.command into origin_command from public.merchant_attendance_location_clock_notices x where x.event_id=ev.id;end if;
 if p.channel<>'self' and origin_command is distinct from (case when p.channel='location' then (c->'clock')-'expectedWorkerId' else c->'clock' end) then raise exception 'attendance_operational_punch_invalid';end if;
 select * into sess from public.merchant_attendance_operational_punch_sessions where start_event_id=p.start_event_id;
 if v->'sessionFingerprint' is distinct from coalesce(sess.session->'sessionFingerprint','null'::jsonb)
  or v->'sourceFingerprint' is distinct from coalesce(sess.session->'sourceFingerprint','null'::jsonb) then raise exception 'attendance_operational_punch_invalid';end if;
 choice_value:=c->'choice';
 if ev.action='clock_in' then
  if p.event_id<>p.start_event_id or sess.start_event_id is null or choice_value->'expectedPolicyFingerprint' is distinct from sess.session->'policyFingerprint'
   or choice_value->'selection' is distinct from sess.session->'selection' then raise exception 'attendance_operational_punch_invalid';end if;
 elsif ev.action='break_start' then
  if sess.start_event_id is null then
   if choice_value->>'kind'<>'legacy_break' then raise exception 'attendance_operational_punch_invalid';end if;
  else
   if choice_value->>'kind'<>'break' or choice_value->>'startEventId' is distinct from p.start_event_id::text
    or choice_value->'expectedSessionFingerprint' is distinct from sess.session->'sessionFingerprint'
    or sess.employee_auth_user_id::text is distinct from v->>'employeeAuthUserId' then raise exception 'attendance_operational_punch_invalid';end if;
   b:=sess.session->'fields'->'breakTypes';
   if b->>'state'='value' and b->'value'->>'selection'='explicit' then
    if choice_value->'breakType'='null'::jsonb or not(b->'value'->'allowed' @> jsonb_build_array(choice_value->'breakType')) then raise exception 'attendance_operational_punch_invalid';end if;
    paid:=choice_value->>'breakType'='paid';
   else
    if choice_value->'breakType'<>'null'::jsonb then raise exception 'attendance_operational_punch_invalid';end if;
    paid:=case when b->>'state'='value' then b->'value'->'allowed'->>0='paid' else (sess.session->'legacy'->>'webBreakPaid')::boolean end;
   end if;
   if ev.break_paid is distinct from paid then raise exception 'attendance_operational_punch_invalid';end if;
  end if;
 end if;
 return v;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_replay_v1(p_event uuid,p_actor uuid,p_channel text,p_intent jsonb)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare saved public.merchant_attendance_operational_punch_operations%rowtype;v jsonb;current_auth uuid;
begin
 if p_intent is null then perform public.faolla_attendance_operational_punch_legacy_gate_v1(null,null,null,p_event);return;end if;
 select * into saved from public.merchant_attendance_operational_punch_operations where event_id=p_event;
 if saved.event_id is null or saved.channel is distinct from p_channel or saved.command is distinct from p_intent->'command' then raise exception 'attendance_operation_conflict';end if;
 v:=public.faolla_attendance_operational_punch_operation_v1(saved);
 select e.auth_user_id into current_auth from public.merchant_enterprise_employees e where e.merchant_id=saved.merchant_id and e.id=(v->>'employeeId')::uuid;
 if v->>'actorAuthUserId' is distinct from p_actor::text or v->>'employeeAuthUserId' is distinct from current_auth::text then raise exception 'attendance_access_denied';end if;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_guard_v1()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog as $$
declare prior public.merchant_attendance_operational_punch_activations%rowtype;v jsonb;op public.merchant_attendance_operational_punch_operations%rowtype;
begin
 if TG_TABLE_NAME='merchant_attendance_operational_punch_activations' then
  perform public.faolla_attendance_operational_punch_activation_item_v1(new);
  select * into prior from public.merchant_attendance_operational_punch_activations x where x.merchant_id=new.merchant_id and x.revision=new.revision-1;
  if new.revision=1 then
   if new.action<>'activate' then raise exception 'attendance_operational_punch_invalid';end if;
  elsif prior.operation_id is null or prior.action=new.action or prior.recorded_at>new.recorded_at then raise exception 'attendance_operational_punch_invalid';end if;
 elsif TG_TABLE_NAME='merchant_attendance_operational_punch_sessions' then
  v:=public.faolla_attendance_operational_punch_session_v1(new);
  select * into op from public.merchant_attendance_operational_punch_operations where event_id=new.start_event_id;
  if op.event_id is null or op.operation->'sessionFingerprint' is distinct from v->'sessionFingerprint' then raise exception 'attendance_operational_punch_invalid';end if;
  perform public.faolla_attendance_operational_punch_operation_v1(op);
 else perform public.faolla_attendance_operational_punch_operation_v1(new);end if;return new;
end;
$$;

--The manifest pins reviewed ORIGINAL bodies. Each replacement has an exact
--occurrence count; transformed hashes are independently fixed in this migration.
--No arbitrary future legacy writer is copied, and no GUC transports authority.
do $punch_extract$
declare r jsonb;c jsonb;body_value text;wrapper_value text;ns text;f regprocedure;args text;old_hash text;actual_count integer;
 manifest jsonb:=$punch_recipes$
[
  {
    "file": "202610020111_merchant_attendance_self_clock_identity.sql",
    "signature": "public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)",
    "name": "faolla_attendance_self_v1",
    "core": "faolla_attendance_operational_punch_core_self_v1",
    "types": "text,uuid,jsonb,uuid",
    "originalHash": "ce0a9971794cfe4fce1f6e8ab9355fad68c817e443dea9dba78f0182a5e6c801",
    "coreHash": "da1230e51a61288cc208211df474c9d2c296cd304161fd6733209c6eedc27bf9",
    "wrapperHash": "3aaae429ef9d13ee2b154227de8c45d2c367b236dbd1430b360a5ed70ac12b08",
    "wrapper": "\nbegin\n return public.faolla_attendance_operational_punch_core_self_v1(p_site_id,p_auth_user_id,p_command,p_operation_id,null);\nend;\n",
    "changes": [
      {
        "from": "declare",
        "to": "declare\n  op_decision jsonb;",
        "count": 1
      },
      {
        "from": "      if v_receipt.action<>v_action",
        "to": "      perform public.faolla_attendance_operational_punch_replay_v1(v_receipt.id,p_auth_user_id,'self',p_intent);\n      if v_receipt.action<>v_action",
        "count": 1
      },
      {
        "from": "      insert into public.merchant_attendance_events(",
        "to": "      op_decision:=public.faolla_attendance_operational_punch_before_v1(p_site_id,v_worker.id,v_employee.id,p_auth_user_id,'self',v_location_id,v_now,v_action,v_settings.web_break_paid,p_intent);\n      insert into public.merchant_attendance_events(",
        "count": 1
      },
      {
        "from": "case when v_action='break_start' then v_settings.web_break_paid else null end",
        "to": "case when v_action='break_start' then (op_decision->>'breakPaid')::boolean else null end",
        "count": 1
      },
      {
        "from": "'receipt',public.faolla_attendance_event_receipt_v1(v_receipt),'replayed',v_replayed);",
        "to": "'receipt',public.faolla_attendance_event_receipt_v1(v_receipt),'replayed',v_replayed)||case when p_intent is null then '{}'::jsonb else jsonb_build_object('_operationalDecision',op_decision) end;",
        "count": 1
      }
    ]
  },
  {
    "file": "202610020112_merchant_attendance_pin_clock_identity.sql",
    "signature": "public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)",
    "name": "faolla_attendance_pin_clock_v1",
    "core": "faolla_attendance_operational_punch_core_pin_v1",
    "types": "text,uuid,text,text,uuid,boolean,jsonb,boolean",
    "originalHash": "a9494b3f12a0323fc70e3e2343dc20e9116947ed59b71db5f63ccaf86e4801a5",
    "coreHash": "f8952e91900866a9325ac0f2f1bf185cf84a13bfc7e5a13a9b9c21336833e029",
    "wrapperHash": "a6f1a9b8182f84f70e5d6c20ea2f446ffbdfba55d87b016df382212ede893056",
    "wrapper": "\nbegin\n return public.faolla_attendance_operational_punch_core_pin_v1(p_site,p_terminal,p_secret_hash,p_no,p_lease,p_verified,p_request,p_allow_new,null);\nend;\n",
    "changes": [
      {
        "from": "declare",
        "to": "declare\n  op_decision jsonb;",
        "count": 1
      },
      {
        "from": "      replayed:=c is not null;",
        "to": "      if c is not null then perform public.faolla_attendance_operational_punch_replay_v1(receipt.id,null,'pin',p_intent);end if;\n      replayed:=c is not null;",
        "count": 1
      },
      {
        "from": "      insert into public.merchant_attendance_events(",
        "to": "      op_decision:=public.faolla_attendance_operational_punch_before_v1(p_site,w.id,w.employee_id,null,'pin',t.location_id,now_at,action_now,s.web_break_paid,p_intent);\n      insert into public.merchant_attendance_events(",
        "count": 1
      },
      {
        "from": "case when action_now='break_start' then s.web_break_paid else null end",
        "to": "case when action_now='break_start' then (op_decision->>'breakPaid')::boolean else null end",
        "count": 1
      },
      {
        "from": "      insert into public.merchant_attendance_pin_clock_receipts values(receipt.id,p_site,p_terminal,w.id,w.employee_id,op,c);",
        "to": "      insert into public.merchant_attendance_pin_clock_receipts values(receipt.id,p_site,p_terminal,w.id,w.employee_id,op,c);\n      if p_intent is not null then perform public.faolla_attendance_operational_punch_record_v1(receipt.id,null,'pin',p_intent,op_decision);end if;",
        "count": 1
      },
      {
        "from": "'blockReason',reason);",
        "to": "'blockReason',reason)||case when p_intent is null then '{}'::jsonb else jsonb_build_object('_operationalDecision',op_decision) end;",
        "count": 1
      },
      {
        "from": "if sqlerrm in (",
        "to": "if sqlerrm in ('attendance_operational_punch_invalid','attendance_operational_punch_changed','attendance_operational_punch_protocol_required','attendance_operational_punch_disabled','attendance_operational_punch_channel_denied','attendance_operational_punch_location_denied','attendance_operational_punch_break_type_denied','attendance_operational_punch_too_large','attendance_operational_punch_not_found','attendance_operational_punch_unchanged','attendance_invalid_request','attendance_self_schedule_invalid','attendance_plan_rule_invalid','attendance_shift_rule_binding_invalid','attendance_pin_schedule_invalid',",
        "count": 1
      },
      {
        "from": "    return jsonb_build_object('siteId',p_site,'terminalId',p_terminal,'workerNo',w.worker_no,'workerName',w.display_name,'employeeId',w.employee_id,\n      'workerId',w.id,'locationId',t.location_id,'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row)),\n      'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed,'canStart',reason is null and coalesce(p_allow_new,false),'canFinish',reason is null,'blockReason',reason)||case when p_intent is null then '{}'::jsonb else jsonb_build_object('_operationalDecision',op_decision) end;",
        "to": "    if p_intent is not null then\n      return public.faolla_attendance_operational_punch_result_v1(p_site,null,'pin',p_intent->'query',nullif(p_intent->'command','null'::jsonb),jsonb_build_object('siteId',p_site,'terminalId',p_terminal,'workerNo',w.worker_no,'workerName',w.display_name,'employeeId',w.employee_id,\n      'workerId',w.id,'locationId',t.location_id,'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row)),\n      'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed,'canStart',reason is null and coalesce(p_allow_new,false),'canFinish',reason is null,'blockReason',reason)||case when p_intent is null then '{}'::jsonb else jsonb_build_object('_operationalDecision',op_decision) end,p_intent,p_terminal);\n    end if;\n    return jsonb_build_object('siteId',p_site,'terminalId',p_terminal,'workerNo',w.worker_no,'workerName',w.display_name,'employeeId',w.employee_id,\n      'workerId',w.id,'locationId',t.location_id,'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row)),\n      'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed,'canStart',reason is null and coalesce(p_allow_new,false),'canFinish',reason is null,'blockReason',reason)||case when p_intent is null then '{}'::jsonb else jsonb_build_object('_operationalDecision',op_decision) end;",
        "count": 1
      }
    ]
  },
  {
    "file": "202610010108_merchant_attendance_onsite_qr.sql",
    "signature": "public.faolla_attendance_onsite_clock_v1(text,uuid,jsonb,jsonb,uuid,boolean)",
    "name": "faolla_attendance_onsite_clock_v1",
    "core": "faolla_attendance_operational_punch_core_onsite_v1",
    "types": "text,uuid,jsonb,jsonb,uuid,boolean",
    "originalHash": "c43a3590c6cad691fe1a61c6a4d1166d498994d4d1484800296cd1095b89f8da",
    "coreHash": "fb4ef0bd317c450c52821d4c70c6a6756b0c2c9a0016a7c4e768947638deb98c",
    "wrapperHash": "a17b70c55270e7b357473b33c733757351d2142d4ccd2213e4080b67d8c37068",
    "wrapper": "\nbegin\n return public.faolla_attendance_operational_punch_core_onsite_v1(p_site,p_auth,p_claims,p_command,p_operation,p_allow_new,null);\nend;\n",
    "changes": [
      {
        "from": "declare",
        "to": "declare\n  op_decision jsonb;",
        "count": 1
      },
      {
        "from": "    replayed:=p_command is not null;",
        "to": "    if p_command is not null then perform public.faolla_attendance_operational_punch_replay_v1(receipt.id,p_auth,'onsite',p_intent);end if;\n    replayed:=p_command is not null;",
        "count": 1
      },
      {
        "from": "    insert into public.merchant_attendance_events(",
        "to": "    op_decision:=public.faolla_attendance_operational_punch_before_v1(p_site,w.id,e.id,p_auth,'onsite',loc_now,now_at,action_now,s.web_break_paid,p_intent);\n    insert into public.merchant_attendance_events(",
        "count": 1
      },
      {
        "from": "case when action_now='break_start' then s.web_break_paid else null end",
        "to": "case when action_now='break_start' then (op_decision->>'breakPaid')::boolean else null end",
        "count": 1
      },
      {
        "from": "'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed);",
        "to": "'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed)||case when p_intent is null then '{}'::jsonb else jsonb_build_object('_operationalDecision',op_decision) end;",
        "count": 1
      }
    ]
  },
  {
    "file": "202609300072_merchant_attendance_location_clock.sql",
    "signature": "public.faolla_attendance_location_clock_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)",
    "name": "faolla_attendance_location_clock_v1",
    "core": "faolla_attendance_operational_punch_core_location_v1",
    "types": "text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean",
    "originalHash": "5dad0419e0bb1e6747844106e4b2480a9c73e709be9a5bda1d9abcbb60e5bca7",
    "coreHash": "388a36bcead29109e22b0be3b2eb514dc195e50863dcb5ae679859bf3259ec76",
    "wrapperHash": "645e3e6803916aa5093708c12125794d38c45fa52a39d6a6d10f077946c1d22e",
    "wrapper": "\nbegin\n return public.faolla_attendance_operational_punch_core_location_v1(p_site_id,p_auth_user_id,p_expected_worker_id,p_command,p_operation_id,p_assertion,p_allow_new_sessions,p_require_clock,null);\nend;\n",
    "changes": [
      {
        "from": "declare",
        "to": "declare\n  op_decision jsonb;",
        "count": 1
      },
      {
        "from": "      v_replayed:=true;",
        "to": "      perform public.faolla_attendance_operational_punch_replay_v1(v_receipt.id,p_auth_user_id,'location',p_intent);\n      v_replayed:=true;",
        "count": 1
      },
      {
        "from": "    insert into public.merchant_attendance_events(",
        "to": "    op_decision:=public.faolla_attendance_operational_punch_before_v1(p_site_id,v_worker.id,v_employee.id,p_auth_user_id,'location',v_location_id,v_now,v_action,v_settings.web_break_paid,p_intent);\n    insert into public.merchant_attendance_events(",
        "count": 1
      },
      {
        "from": "case when v_action='break_start' then v_settings.web_break_paid else null end",
        "to": "case when v_action='break_start' then (op_decision->>'breakPaid')::boolean else null end",
        "count": 1
      },
      {
        "from": "'radiusMeters',v_location.radius_meters,'maxAgeMs',60000) end);",
        "to": "'radiusMeters',v_location.radius_meters,'maxAgeMs',60000) end)||case when p_intent is null then '{}'::jsonb else jsonb_build_object('_operationalDecision',op_decision) end;",
        "count": 1
      }
    ]
  },
  {
    "file": "202610020113_merchant_attendance_location_receipt_identity.sql",
    "signature": "public.faolla_attendance_location_clock_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)",
    "name": "faolla_attendance_location_clock_v2",
    "core": "faolla_attendance_operational_punch_core_location_v2",
    "types": "text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean",
    "originalHash": "797c6a382ac8c0ddf27effb2c135e103ceb9c3433b4c86a09c550550055482ab",
    "coreHash": "628cfefc46d9216568da94dcb3904ec55ab649e1d81d435cf1b6f1ad2b0cf04a",
    "wrapperHash": "3cb77e5dc425f5b9255308bda8288eb6bf304395ba21649fc9684e4cb58bf0f7",
    "wrapper": "\nbegin\n return public.faolla_attendance_operational_punch_core_location_v2(p_site_id,p_auth_user_id,p_expected_worker_id,p_command,p_operation_id,p_assertion,p_allow_new_sessions,p_require_clock,null);\nend;\n",
    "changes": [
      {
        "from": "declare",
        "to": "declare\n  op_decision jsonb;",
        "count": 1
      },
      {
        "from": "public.faolla_attendance_location_clock_v1(p_site_id,p_auth_user_id,p_expected_worker_id,null,op,null,p_allow_new_sessions,p_require_clock or p_command is not null);",
        "to": "public.faolla_attendance_operational_punch_core_location_v1(p_site_id,p_auth_user_id,p_expected_worker_id,null,op,null,p_allow_new_sessions,p_require_clock or p_command is not null,p_intent);",
        "count": 1
      },
      {
        "from": "public.faolla_attendance_location_clock_v1(p_site_id,p_auth_user_id,p_expected_worker_id,p_command-'noticeRevision'-'safeFinish',null,p_assertion,p_allow_new_sessions,true);",
        "to": "public.faolla_attendance_operational_punch_core_location_v1(p_site_id,p_auth_user_id,p_expected_worker_id,p_command-'noticeRevision'-'safeFinish',null,p_assertion,p_allow_new_sessions,true,p_intent);",
        "count": 1
      },
      {
        "from": "public.faolla_attendance_location_clock_v1(p_site_id,p_auth_user_id,p_expected_worker_id,null,op,null,p_allow_new_sessions,true);",
        "to": "public.faolla_attendance_operational_punch_core_location_v1(p_site_id,p_auth_user_id,p_expected_worker_id,null,op,null,p_allow_new_sessions,true,p_intent);",
        "count": 1
      },
      {
        "from": "      replay:=true;",
        "to": "      perform public.faolla_attendance_operational_punch_replay_v1((b->'receipt'->>'id')::uuid,p_auth_user_id,'location',p_intent);\n      replay:=true;",
        "count": 1
      },
      {
        "from": "      insert into public.merchant_attendance_events(",
        "to": "      op_decision:=public.faolla_attendance_operational_punch_before_v1(p_site_id,w.id,e.id,p_auth_user_id,'location',ending.id,stamp,p_command->>'action',s.web_break_paid,p_intent);\n      insert into public.merchant_attendance_events(",
        "count": 1
      },
      {
        "from": "      select * into saved from public.merchant_attendance_events where id=(b->'receipt'->>'id')::uuid;",
        "to": "      op_decision:=b->'_operationalDecision';\n      select * into saved from public.merchant_attendance_events where id=(b->'receipt'->>'id')::uuid;",
        "count": 1
      },
      {
        "from": "'noticeGate',gate,'finish',finish,'receiptGate',receipt_gate);",
        "to": "'noticeGate',gate,'finish',finish,'receiptGate',receipt_gate)||case when p_intent is null then '{}'::jsonb else jsonb_build_object('_operationalDecision',op_decision) end;",
        "count": 1
      }
    ]
  },
  {
    "file": "202610050143_merchant_attendance_pin_schedule.sql",
    "signature": "public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)",
    "name": "faolla_attendance_pin_schedule_v1",
    "core": null,
    "types": "text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean",
    "originalHash": "7ae3139791e9e63d51414dc4ae7287f96977a23b3237cd9fb730b31b0ce2b8ed",
    "coreHash": null,
    "wrapperHash": "7de7672594013ab90d78a44bf704e5e2e9870fd052fe4fbc0c236fc8fb7f454e",
    "wrapper": "\ndeclare checked jsonb;c jsonb;op uuid;action_now text;expected bigint;worker_expected uuid;loc_expected uuid;\n  s public.merchant_attendance_settings%rowtype;t public.merchant_attendance_terminals%rowtype;\n  w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;\n  last_row public.merchant_attendance_events%rowtype;receipt public.merchant_attendance_events%rowtype;\n  binding public.merchant_attendance_pin_clock_receipts%rowtype;\n  seq bigint;status_now text;now_at timestamptz;lease_until timestamptz;today date;replayed boolean:=false;reason text;valid_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';\n  e public.merchant_enterprise_employees%rowtype;ev public.merchant_attendance_events%rowtype;\n  saved public.merchant_attendance_shift_schedule_relations%rowtype;proof public.merchant_attendance_shift_plan_adoptions%rowtype;\n  slot public.merchant_attendance_schedule_slots%rowtype;candidates public.merchant_attendance_schedule_slots[];\n  member_auth uuid;selected jsonb:=nullif(p_selection,'null'::jsonb);clock_result jsonb;choices jsonb;association jsonb;adoption jsonb;result jsonb;\n  context jsonb;slot_item jsonb;publication_item jsonb;cancellation_item jsonb;current_cancellation jsonb;entries jsonb:='[]';\n  head bigint;day_now date;first_day date;last_day date;zone text;limited boolean:=false;fresh boolean:=false;\n  status_name text;reason_name text;current_cancelled boolean;was_cancelled boolean;\n  fmt constant text:='YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"';\nbegin\n  if p_allow_schedule is null or p_bind_rules is null or p_allow_new is null then raise exception 'attendance_invalid_request';end if;\n  if p_request is null or jsonb_typeof(p_request)<>'object' or (select count(*) from jsonb_object_keys(p_request))<>2\n    or not(p_request ?& array['command','operationId']) then raise exception 'attendance_invalid_request';end if;\n  c:=nullif(p_request->'command','null'::jsonb);\n  if c is not null then\n    if p_request->'operationId'<>'null'::jsonb or jsonb_typeof(c)<>'object' or (select count(*) from jsonb_object_keys(c))<>6\n      or not(c ?& array['expectedWorkerId','expectedEmployeeId','operationId','locationId','action','expectedSequence'])\n      or coalesce(c->>'action','') not in ('clock_in','break_start','break_end','clock_out')\n      or coalesce(c->>'expectedEmployeeId','') !~ valid_uuid or coalesce(c->>'expectedWorkerId','') !~ valid_uuid or coalesce(c->>'operationId','') !~ valid_uuid or coalesce(c->>'locationId','') !~ valid_uuid\n      or jsonb_typeof(c->'expectedSequence')<>'number' or coalesce(c->>'expectedSequence','') !~ '^(0|[1-9][0-9]{0,15})$'\n      or (c->>'expectedSequence')::numeric>9007199254740990 then raise exception 'attendance_invalid_request';end if;\n    op:=(c->>'operationId')::uuid;action_now:=c->>'action';expected:=(c->>'expectedSequence')::bigint;\n    worker_expected:=(c->>'expectedWorkerId')::uuid;loc_expected:=(c->>'locationId')::uuid;\n  elsif p_request->'operationId'<>'null'::jsonb then\n    if coalesce(p_request->>'operationId','') !~ valid_uuid then raise exception 'attendance_invalid_request';end if;\n    op:=(p_request->>'operationId')::uuid;\n  end if;\n  if c is null then\n    if selected is not null then raise exception 'attendance_invalid_request';end if;\n  else\n    if c->>'action'<>'clock_in' then raise exception 'attendance_invalid_request';end if;\n    if selected is not null and (not public.faolla_attendance_shift_rule_binding_object_v1(selected,array['slotId','revision'])\n      or not public.faolla_attendance_shift_rule_binding_scalar_v1(selected->'slotId','uuid')\n      or not public.faolla_attendance_shift_rule_binding_scalar_v1(selected->'revision','version')) then raise exception 'attendance_invalid_request';end if;\n  end if;\n  -- Finish consumes the lease and rechecks device/member/role/PIN revision.\n  -- Its settings/employee/role/worker locks remain held UNTIL this RPC commits.\n  -- true here enables authentication only; p_allow_new separately gates starts.\n  select lease_expires into lease_until from public.merchant_attendance_pin_attempts where merchant_id=p_site and terminal_id=p_terminal and lease_id=p_lease;\n  checked:=public.faolla_attendance_pin_finish_v1(p_site,p_terminal,p_secret_hash,p_no,p_lease,p_verified,true);\n  if checked->>'verified'<>'true' then return jsonb_build_object('error','attendance_pin_denied');end if;\n  -- Expected business denials roll back this subtransaction, NOT lease consumption.\n  -- Never leave an inserted event without its origin-bound immutable receipt.\n  begin\n    -- Feature rollback denies new commands AFTER consuming the authenticated\n    --lease; it does not turn state/recovery reads into unauthenticated GETs.\n    if c is not null and not p_allow_schedule then raise exception 'attendance_pin_schedule_disabled';end if;\n    select * into s from public.merchant_attendance_settings where merchant_id=p_site;\n    select * into t from public.merchant_attendance_terminals where merchant_id=p_site and id=p_terminal;\n    select * into w from public.merchant_attendance_workers where merchant_id=p_site and lower(btrim(worker_no))=lower(p_no);\n    if c is not null and (w.id<>worker_expected or w.employee_id is distinct from (c->>'expectedEmployeeId')::uuid) then raise exception 'attendance_worker_changed';end if;\n    select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=t.location_id;\n    select * into last_row from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;\n    if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id then\n      raise exception 'attendance_access_denied';\n    end if;\n    seq:=coalesce(last_row.sequence,0);status_now:=case when last_row.id is null or last_row.action='clock_out' then 'off' when last_row.action='break_start' then 'break' else 'working' end;\n    select * into receipt from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and operation_id=op;\n    if receipt.id is not null then\n      select * into binding from public.merchant_attendance_pin_clock_receipts where event_id=receipt.id;\n      if binding.event_id is null or binding.terminal_id<>p_terminal or binding.employee_id<>w.employee_id\n        or receipt.actor_employee_id is distinct from w.employee_id or receipt.source<>'kiosk'\n        or (c is not null and binding.command<>c) then raise exception 'attendance_operation_conflict';end if;\n      if c is not null then perform public.faolla_attendance_operational_punch_legacy_gate_v1(p_site,w.id,action_now,receipt.id);end if;\n      replayed:=c is not null;\n    end if;\n    now_at:=date_trunc('milliseconds',clock_timestamp());today:=(now_at at time zone s.time_zone)::date;\n    -- Re-date AFTER any membership/worker lock wait, not just before the wait.\n    if lease_until is null or clock_timestamp()>=lease_until or clock_timestamp()<lease_until-interval '30 seconds'\n      or now_at>=t.device_expires_at or now_at<t.paired_at then raise exception 'attendance_pin_denied';end if;\n    reason:=case when l.id is null or not l.active or w.default_location_id is distinct from t.location_id then 'attendance_location_denied'\n      when l.radius_meters is not null then 'attendance_location_verification_required'\n      when (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site and worker_id=w.id and starts_on<=today and (ends_on is null or ends_on>=today))<>1 then 'attendance_not_employed' else null end;\n    if c is not null and not replayed then\n      if seq<>expected then raise exception 'attendance_sequence_conflict';end if;\n      if loc_expected<>t.location_id then raise exception 'attendance_location_denied';end if;\n      if reason is not null then raise exception '%',reason;end if;\n      if p_allow_new is distinct from true and action_now in ('clock_in','break_start') then raise exception 'attendance_platform_paused';end if;\n      if last_row.id is not null and now_at<last_row.occurred_at then raise exception 'attendance_time_reversed';end if;\n      if action_now='clock_in' and status_now<>'off' then raise exception 'attendance_already_clocked_in';end if;\n      if action_now='break_start' and status_now<>'working' then raise exception 'attendance_not_working';end if;\n      if action_now='break_end' and status_now<>'break' then raise exception 'attendance_not_on_break';end if;\n      if action_now='clock_out' and status_now='break' then raise exception 'attendance_break_must_end';end if;\n      if action_now='clock_out' and status_now='off' then raise exception 'attendance_not_clocked_in';end if;\n      perform public.faolla_attendance_operational_punch_legacy_gate_v1(p_site,w.id,action_now,null);\n      insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)\n        values(p_site,w.id,t.location_id,op,seq+1,action_now,'kiosk',case when action_now='break_start' then s.web_break_paid else null end,now_at,now_at,l.time_zone,w.employee_id) returning * into receipt;\n      insert into public.merchant_attendance_pin_clock_receipts values(receipt.id,p_site,p_terminal,w.id,w.employee_id,op,c);\n      last_row:=receipt;seq:=receipt.sequence;status_now:=case when action_now='clock_out' then 'off' when action_now='break_start' then 'break' else 'working' end;\n    end if;\n    clock_result:=jsonb_build_object('siteId',p_site,'terminalId',p_terminal,'workerNo',w.worker_no,'workerName',w.display_name,'employeeId',w.employee_id,\n      'workerId',w.id,'locationId',t.location_id,'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row)),\n      'receipt',public.faolla_attendance_event_receipt_v1(receipt),'replayed',replayed,'canStart',reason is null and coalesce(p_allow_new,false),'canFinish',reason is null,'blockReason',reason);\n    select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id;\n    member_auth:=e.auth_user_id;\n    if e.id is null or member_auth is null then raise exception 'attendance_access_denied';end if;\n    if c is not null and not replayed and p_bind_rules then\n      if receipt.action<>'clock_in' or receipt.operation_id is distinct from op or receipt.merchant_id is distinct from p_site then\n        raise exception 'attendance_shift_rule_binding_invalid';end if;\n      perform public.faolla_attendance_bind_shift_rules_v1(receipt.id,'pin',null);\n    end if;\n    select coalesce(max(x.revision),0) into head from public.merchant_attendance_schedule_commands x where x.merchant_id=p_site;\n    choices:=jsonb_build_object('timeZone',null,'fromDate',null,'throughDate',null,'revision',head,'limited',false,'entries','[]'::jsonb);\n  if clock_result->'receipt'<>'null'::jsonb then\n    select * into ev from public.merchant_attendance_events where id=(clock_result->'receipt'->>'id')::uuid;\n    if ev.id is null or ev.merchant_id is distinct from p_site or ev.worker_id is distinct from w.id or ev.actor_employee_id is distinct from e.id then raise exception 'attendance_pin_schedule_invalid';end if;\n    select * into saved from public.merchant_attendance_shift_schedule_relations where merchant_id=p_site and start_event_id=ev.id;\n    if found then\n      if saved.worker_id is distinct from w.id or saved.operation_id is distinct from ev.operation_id or saved.employee_id is distinct from e.id\n        or saved.employee_auth_user_id is distinct from member_auth then raise exception 'attendance_access_denied';end if;\n      if c is not null and saved.selection is distinct from selected then raise exception 'attendance_operation_conflict';end if;\n    elsif c is not null and clock_result->'replayed'='false'::jsonb then\n      fresh:=true;\n      if ev.action<>'clock_in' or ev.source<>'kiosk' or ev.location_id is distinct from l.id or ev.operation_id::text is distinct from c->>'operationId' then\n        raise exception 'attendance_pin_schedule_invalid';end if;\n      status_name:='unselected';reason_name:=null;\n      if selected is not null then\n        select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p_site and id=(selected->>'slotId')::uuid;\n        if slot.id is null or slot.worker_id is distinct from w.id or slot.employee_id is distinct from e.id then raise exception 'attendance_access_denied';end if;\n        if slot.revision is distinct from (selected->>'revision')::bigint then raise exception 'attendance_invalid_request';end if;\n        context:=public.faolla_attendance_self_schedule_slot_v1(slot);\n        if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>member_auth::text then raise exception 'attendance_access_denied';end if;\n        slot_item:=context->'slot';publication_item:=nullif(context->'publication','null'::jsonb);cancellation_item:=nullif(context->'cancellation','null'::jsonb);\n        day_now:=(ev.occurred_at at time zone ev.time_zone)::date;\n        reason_name:=case when (slot_item->>'cancelled')::boolean then 'cancelled' when slot.location_id<>ev.location_id then 'location_changed'\n          when slot.work_date<day_now-1 or slot.work_date>day_now+1 then 'outside_window'\n          when not (slot_item->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;\n        status_name:=case when reason_name is null then 'linked' else 'unverified' end;\n      end if;\n      insert into public.merchant_attendance_shift_schedule_relations(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,\n        employee_id,employee_auth_user_id,worker_version,location_version,settings_version,selection,slot_id,slot_revision,schedule_revision,status,reason,\n        slot_snapshot,publication_snapshot,cancellation_snapshot,recorded_at,binding_policy)\n        values(p_site,ev.id,w.id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,e.id,member_auth,\n          w.version,l.version,s.version,selected,slot.id,slot.revision,head,status_name,reason_name,\n          slot_item,publication_item,cancellation_item,clock_timestamp(),'employee-explicit-clock-in-v1') returning * into saved;\n      adoption:=public.faolla_attendance_shift_plan_adoption_v1(saved,member_auth,null,true,'pin');\n      insert into public.merchant_attendance_shift_plan_adoptions(merchant_id,start_event_id,worker_id,operation_id,employee_id,employee_auth_user_id,\n        channel,slot_id,approval_operation_id,adoption,recorded_at)\n        values(p_site,ev.id,w.id,ev.operation_id,e.id,member_auth,'pin',saved.slot_id,\n          (adoption->'approval'->>'operationId')::uuid,adoption,saved.recorded_at) returning * into proof;\n    end if;\n    -- Legacy receipts are not backfilled, even when a new selection is sent.\n    if saved.start_event_id is not null then\n      perform public.faolla_attendance_pin_schedule_receipt_v1(saved,member_auth);\n      current_cancelled:=null;\n      if saved.slot_id is not null then\n        select * into slot from public.merchant_attendance_schedule_slots where merchant_id=p_site and id=saved.slot_id;\n        if slot.id is null or slot.worker_id is distinct from saved.worker_id or slot.employee_id is distinct from saved.employee_id or slot.revision is distinct from saved.slot_revision then\n          raise exception 'attendance_pin_schedule_invalid';end if;\n        context:=public.faolla_attendance_self_schedule_slot_v1(slot);current_cancelled:=(context->'slot'->>'cancelled')::boolean;\n        if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>member_auth::text then raise exception 'attendance_access_denied';end if;\n        if (saved.slot_snapshot-'cancelled') is distinct from ((context->'slot')-'cancelled')\n          or saved.publication_snapshot is distinct from nullif(context->'publication','null'::jsonb) then raise exception 'attendance_pin_schedule_invalid';end if;\n        current_cancellation:=nullif(context->'cancellation','null'::jsonb);was_cancelled:=(saved.slot_snapshot->>'cancelled')::boolean;\n        if was_cancelled then\n          if not current_cancelled or saved.cancellation_snapshot is null or saved.cancellation_snapshot is distinct from current_cancellation\n            or (current_cancellation->>'revision')::bigint>saved.schedule_revision then raise exception 'attendance_pin_schedule_invalid';end if;\n        elsif saved.cancellation_snapshot is not null or current_cancelled and (current_cancellation->>'revision')::bigint<=saved.schedule_revision then\n          raise exception 'attendance_pin_schedule_invalid';end if;\n        -- Keep the insertion-time outside_window decision, without new tzdata.\n        reason_name:=case when was_cancelled then 'cancelled' when slot.location_id<>ev.location_id then 'location_changed'\n          when saved.reason='outside_window' then 'outside_window' when not (context->'slot'->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;\n        if saved.reason is distinct from reason_name or saved.status is distinct from (case when reason_name is null then 'linked' else 'unverified' end) then\n          raise exception 'attendance_pin_schedule_invalid';end if;\n      end if;\n      association:=jsonb_build_object('startEventId',saved.start_event_id,'operationId',saved.operation_id,'selection',saved.selection,'status',saved.status,'reason',saved.reason,\n        'slot',saved.slot_snapshot,'observedRevision',saved.schedule_revision,'recordedAt',to_char(saved.recorded_at at time zone 'UTC',fmt),'currentCancelled',current_cancelled);\n      if not fresh then select * into proof from public.merchant_attendance_shift_plan_adoptions where merchant_id=p_site and start_event_id=ev.id;end if;\n      if proof.start_event_id is not null then\n        if row(proof.worker_id,proof.operation_id,proof.employee_id,proof.employee_auth_user_id,proof.slot_id,proof.recorded_at)\n          is distinct from row(saved.worker_id,saved.operation_id,saved.employee_id,saved.employee_auth_user_id,saved.slot_id,saved.recorded_at)\n          or proof.channel<>'pin' then raise exception 'attendance_pin_schedule_invalid';end if;\n        adoption:=public.faolla_attendance_shift_plan_adoption_v1(saved,member_auth,proof.approval_operation_id,false,'pin');\n        if proof.adoption is distinct from adoption then raise exception 'attendance_pin_schedule_invalid';end if;\n      end if;\n    end if;\n    if c is not null and proof.start_event_id is null then raise exception 'attendance_operation_conflict';end if;\n  elsif c is not null then raise exception 'attendance_pin_schedule_invalid';end if;\n  if fresh and (association is null or adoption is null) then raise exception 'attendance_pin_schedule_invalid';end if;\n\n  -- A successful authenticated state read may offer bounded terminal/default\n  --location candidates. Attempts and lease consumption are still intentional.\n  if c is null and op is null and p_allow_schedule and clock_result->'canStart'='true'::jsonb and status_now='off' then\n    zone:=l.time_zone;day_now:=(clock_timestamp() at time zone zone)::date;\n    first_day:=greatest(day_now-1,date '2000-01-01');last_day:=least(day_now+1,date '2100-12-31');\n    if first_day>last_day then raise exception 'attendance_pin_schedule_invalid';end if;\n    candidates:=array(select x from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site and x.worker_id=w.id\n      and x.work_date between first_day and last_day order by x.work_date,x.start_at,x.id limit 101);\n    limited:=cardinality(candidates)>100;\n    if not limited then foreach slot in array candidates loop\n      if slot.employee_id<>e.id or slot.location_id<>l.id then continue;end if;\n      context:=public.faolla_attendance_self_schedule_slot_v1(slot);\n      if context->'publication'->>'employeeAuthUserId' is not null and context->'publication'->>'employeeAuthUserId'<>member_auth::text then continue;end if;\n      entries:=entries||jsonb_build_array(context->'slot');\n    end loop;end if;\n    choices:=jsonb_build_object('timeZone',zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),'throughDate',to_char(last_day,'YYYY-MM-DD'),'revision',head,'limited',limited,'entries',entries);\n    if octet_length(convert_to(choices::text,'UTF8'))>48000 then choices:=jsonb_build_object('timeZone',zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),\n      'throughDate',to_char(last_day,'YYYY-MM-DD'),'revision',head,'limited',true,'entries','[]'::jsonb);end if;\n  end if;\n\n    result:=jsonb_build_object('protocol','pin-schedule-v1','clock',clock_result,'choices',choices,'association',association,'adoption',adoption);\n    if octet_length(convert_to(result::text,'UTF8'))>65536 then raise exception 'attendance_pin_schedule_invalid';end if;\n    return result;\n  exception when raise_exception then\n    if sqlerrm in ('attendance_operational_punch_protocol_required','attendance_access_denied','attendance_pin_denied','attendance_worker_changed','attendance_operation_conflict','attendance_sequence_conflict','attendance_location_denied','attendance_location_verification_required',\n      'attendance_not_employed','attendance_platform_paused','attendance_time_reversed','attendance_already_clocked_in','attendance_not_working','attendance_not_on_break','attendance_break_must_end','attendance_not_clocked_in',\n      'attendance_invalid_request','attendance_pin_schedule_disabled','attendance_pin_schedule_invalid',\n      'attendance_self_schedule_invalid','attendance_plan_rule_invalid','attendance_shift_rule_binding_invalid') then\n      return jsonb_build_object('error',sqlerrm);\n    end if;\n    -- Unknown storage, constraint, cancellation or infrastructure errors retain\n    --112's outer failure semantics: the whole transaction (including lease)\n    --rolls back. Do not disguise these as expected authentication outcomes.\n    raise;\n  end;\nend;",
    "changes": [
      {
        "from": "      insert into public.merchant_attendance_events(",
        "to": "      perform public.faolla_attendance_operational_punch_legacy_gate_v1(p_site,w.id,action_now,null);\n      insert into public.merchant_attendance_events(",
        "count": 1
      },
      {
        "from": "      replayed:=c is not null;",
        "to": "      if c is not null then perform public.faolla_attendance_operational_punch_legacy_gate_v1(p_site,w.id,action_now,receipt.id);end if;\n      replayed:=c is not null;",
        "count": 1
      },
      {
        "from": "if sqlerrm in (",
        "to": "if sqlerrm in ('attendance_operational_punch_protocol_required',",
        "count": 1
      }
    ]
  }
]
$punch_recipes$::jsonb;
begin
 select n.nspname into ns from pg_class t join pg_namespace n on n.oid=t.relnamespace where t.oid='public.faolla_schema_migrations'::regclass;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080193) then return;end if;
 for r in select value from jsonb_array_elements(manifest) loop
  f:=to_regprocedure(r->>'signature');
  if f is null then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
  select p.prosrc,pg_get_function_arguments(p.oid) into body_value,args from pg_proc p where p.oid=f;
  body_value:=replace(body_value,E'\r\n',E'\n');
  old_hash:=encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex');
  if old_hash is distinct from r->>'originalHash' then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
  for c in select value from jsonb_array_elements(r->'changes') loop
   actual_count:=(length(body_value)-length(replace(body_value,c->>'from','')))/nullif(length(c->>'from'),0);
   if actual_count is distinct from (c->>'count')::integer then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
   body_value:=replace(body_value,c->>'from',c->>'to');
  end loop;
  if r->'core'<>'null'::jsonb then
   if encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from r->>'coreHash' then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
   execute format('create function %I.%I(%s,p_intent jsonb default null) returns jsonb language plpgsql set search_path=pg_catalog as %L',ns,r->>'core',args,body_value);
   wrapper_value:=r->>'wrapper';
  else wrapper_value:=body_value;end if;
  if encode(sha256(convert_to(replace(wrapper_value,ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from r->>'wrapperHash' then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
  execute format('create or replace function %I.%I(%s) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',ns,r->>'name',args,wrapper_value);
 end loop;
end;
$punch_extract$;

create or replace function public.faolla_attendance_operational_punch_choices_v1(p_site text,p_worker uuid,p_employee uuid,p_auth uuid,p_location uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare l public.merchant_attendance_locations%rowtype;slot public.merchant_attendance_schedule_slots%rowtype;candidates public.merchant_attendance_schedule_slots[];
 head bigint;today date;first_day date;last_day date;v jsonb;entries jsonb:='[]';limited boolean;result_value jsonb;
begin
 select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=p_location;
 select coalesce(max(x.revision),0) into head from public.merchant_attendance_schedule_commands x where x.merchant_id=p_site;
 if l.id is null then raise exception 'attendance_operational_punch_changed';end if;
 today:=(clock_timestamp() at time zone l.time_zone)::date;first_day:=greatest(today-1,date '2000-01-01');last_day:=least(today+1,date '2100-12-31');
 if first_day>last_day then raise exception 'attendance_operational_punch_invalid';end if;
 candidates:=array(select x from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site and x.worker_id=p_worker and x.work_date between first_day and last_day
  order by x.work_date,x.start_at,x.id limit 101);limited:=cardinality(candidates)>100;
 if not limited then foreach slot in array candidates loop
  if slot.employee_id is distinct from p_employee or slot.location_id<>p_location then continue;end if;
  v:=public.faolla_attendance_self_schedule_slot_v1(slot);
  if v->'publication'->>'employeeAuthUserId' is not null and v->'publication'->>'employeeAuthUserId'<>p_auth::text then continue;end if;
  entries:=entries||jsonb_build_array(v->'slot');
 end loop;end if;
 result_value:=jsonb_build_object('timeZone',l.time_zone,'fromDate',to_char(first_day,'YYYY-MM-DD'),'throughDate',to_char(last_day,'YYYY-MM-DD'),
  'revision',head,'limited',limited,'entries',entries);
 if octet_length(convert_to(result_value::text,'UTF8'))>48000 then
  result_value:=jsonb_set(jsonb_set(result_value,'{limited}','true'),'{entries}','[]');
 end if;return result_value;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_request_v1(p_site text,p_channel text,p_query jsonb,p_command jsonb,p_allow_new boolean,p_allow_start boolean,p_schedule boolean,p_bind boolean)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
 if p_site is null or char_length(p_site)<>8 or p_site!~'^[0-9]{8}$' or p_channel is null or p_channel not in('self','location','pin','onsite')
  or p_allow_new is null or p_allow_start is null or p_schedule is null or p_bind is null then raise exception 'attendance_invalid_request';end if;
 if p_query->>'mode'='prepare' then
  if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['mode']) is distinct from true then raise exception 'attendance_invalid_request';end if;
 elsif p_query->>'mode'='recover' then
  if public.faolla_attendance_operational_rule_object_v1(p_query,array['mode','operationId']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
   perform public.faolla_attendance_operational_punch_command_v1(p_channel,p_command);
   if p_command->'clock'->'operationId' is distinct from p_query->'operationId' then raise exception 'attendance_invalid_request';end if;
  end if;
 else raise exception 'attendance_invalid_request';end if;
 return jsonb_build_object('query',p_query,'command',p_command,'allowNewSessions',p_allow_new,'allowOperationalStart',p_allow_start,'allowSchedule',p_schedule,'bindRules',p_bind);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_lock_v1(p_site text)
returns void language plpgsql volatile set search_path=pg_catalog as $$
begin
 perform 1 from public.merchants where id=p_site for share;
 if not found then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings where merchant_id=p_site for update;
 if not found then raise exception 'attendance_disabled';end if;
end;
$$;
create or replace function public.faolla_attendance_operational_punch_result_v1(p_site text,p_actor uuid,p_channel text,p_query jsonb,p_command jsonb,p_clock jsonb,p_intent jsonb,p_terminal uuid default null)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
 s public.merchant_attendance_settings%rowtype;l public.merchant_attendance_locations%rowtype;h public.merchant_attendance_operational_punch_activations%rowtype;
 saved public.merchant_attendance_operational_punch_sessions%rowtype;op public.merchant_attendance_operational_punch_operations%rowtype;
 ev public.merchant_attendance_events%rowtype;rel public.merchant_attendance_shift_schedule_relations%rowtype;ad public.merchant_attendance_shift_plan_adoptions%rowtype;
 source_value jsonb;policy_value jsonb;session_value jsonb;operation_value jsonb;choices_value jsonb;association_value jsonb;adoption_value jsonb;bundle jsonb;result_value jsonb;
 sid uuid;qualified boolean:=false;can_start boolean:=false;can_break boolean:=false;can_finish boolean:=false;state_name text;observed timestamptz;today date;
begin
 if p_clock is null or p_clock ? 'error' then raise exception 'attendance_operational_punch_invalid';end if;
 select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=(p_clock->>'workerId')::uuid;
 select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id;
 if w.id is null or e.id is null or e.auth_user_id is null or p_channel<>'pin' and p_actor is distinct from e.auth_user_id then raise exception 'attendance_access_denied';end if;
 if p_command is not null and p_clock->'replayed'='false'::jsonb then
  if p_clock->'receipt'='null'::jsonb then raise exception 'attendance_operational_punch_invalid';end if;
  if p_channel<>'pin' then perform public.faolla_attendance_operational_punch_record_v1((p_clock->'receipt'->>'id')::uuid,p_actor,p_channel,p_intent,p_clock->'_operationalDecision');end if;
 end if;
 if p_query->>'mode'='recover' then
  if p_clock->'receipt'<>'null'::jsonb then
   select * into op from public.merchant_attendance_operational_punch_operations where event_id=(p_clock->'receipt'->>'id')::uuid;
   if op.event_id is not null then
    operation_value:=public.faolla_attendance_operational_punch_operation_v1(op);
    if op.merchant_id<>p_site or op.worker_id<>w.id or op.channel<>p_channel or op.operation_id::text is distinct from p_query->>'operationId'
     or operation_value->>'employeeId' is distinct from e.id::text or operation_value->>'employeeAuthUserId' is distinct from e.auth_user_id::text
     or operation_value->>'actorAuthUserId' is distinct from p_actor::text
     or p_channel='pin' and op.origin_ref->>'terminalId' is distinct from p_terminal::text then raise exception 'attendance_access_denied';end if;
    if p_command is not null and op.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
   end if;
  end if;
  if p_command is not null and operation_value is null then raise exception 'attendance_operation_conflict';end if;
  if p_command is not null and operation_value->>'action'='clock_in' then
   select * into saved from public.merchant_attendance_operational_punch_sessions where start_event_id=(operation_value->>'startEventId')::uuid;
   session_value:=public.faolla_attendance_operational_punch_session_v1(saved);source_value:=public.faolla_attendance_operational_punch_saved_source_v1(saved.source_ref);
   select * into rel from public.merchant_attendance_shift_schedule_relations where start_event_id=saved.start_event_id;
   select * into ad from public.merchant_attendance_shift_plan_adoptions where start_event_id=saved.start_event_id;
   if rel.start_event_id is null or ad.start_event_id is null then raise exception 'attendance_operational_punch_invalid';end if;
   association_value:=jsonb_build_object('startEventId',rel.start_event_id,'operationId',rel.operation_id,'selection',rel.selection,'status',rel.status,'reason',rel.reason,
    'slot',rel.slot_snapshot,'observedRevision',rel.schedule_revision,'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(rel.recorded_at),
    'currentCancelled',case when rel.slot_id is null then null else exists(select 1 from public.merchant_attendance_schedule_cancellations x where x.merchant_id=p_site and x.slot_id=rel.slot_id) end);
   adoption_value:=ad.adoption;
  end if;
 else
  select * into s from public.merchant_attendance_settings where merchant_id=p_site;
  select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(p_clock->>'locationId')::uuid for share;
  select * into r from public.merchant_enterprise_roles where merchant_id=p_site and id=e.role_id;
  observed:=date_trunc('milliseconds',clock_timestamp());today:=(observed at time zone s.time_zone)::date;
  state_name:=p_clock->'state'->>'status';
  if p_channel='pin' then qualified:=p_clock->'canFinish'='true'::jsonb;
  elsif p_channel='location' then qualified:=p_clock->'channelEnabled'='true'::jsonb;
  else qualified:=s.enabled and w.active and e.status='active' and r.status='active' and 'attendance.self.clock'=any(r.permissions)
   and l.id is not null and l.active and l.radius_meters is null and l.id=w.default_location_id
   and (p_channel<>'self' or s.web_clock_enabled)
   and (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site and worker_id=w.id and starts_on<=today and (ends_on is null or ends_on>=today))=1;end if;
  can_finish:=state_name in('working','break') and (case when p_channel='location' then p_clock->'finish'<>'null'::jsonb and 'attendance.self.clock'=any(r.permissions) else qualified end);
  can_break:=state_name='working' and qualified and p_intent->'allowNewSessions'='true'::jsonb;
  if state_name='off' then
   select * into h from public.merchant_attendance_operational_punch_activations x where x.merchant_id=p_site order by x.revision desc limit 1;
   perform public.faolla_attendance_operational_punch_activation_item_v1(h);
   if h.action='activate' and p_intent->'allowOperationalStart'='true'::jsonb and l.id is not null then
    bundle:=public.faolla_attendance_operational_punch_policy_v1(p_site,p_channel,w.id,e.id,e.auth_user_id,l.id,observed,(p_intent->>'allowSchedule')::boolean);
    policy_value:=bundle->'policy';source_value:=bundle->'source';
    can_start:=qualified and p_intent->'allowNewSessions'='true'::jsonb
     and (policy_value->'fields'->'allowedChannels'->>'state'<>'value' or policy_value->'fields'->'allowedChannels'->'value' @> jsonb_build_array(p_channel))
     and (policy_value->'fields'->'locationScope'->>'state'<>'value' or policy_value->'fields'->'locationScope'->'value' @> jsonb_build_array(l.id));
    if can_start and p_intent->'allowSchedule'='true'::jsonb and policy_value->'fields'->'shiftSource'->>'state'<>'disabled'
     and policy_value->'fields'->'shiftSource'->'value' is distinct from '"unplanned"'::jsonb then
     choices_value:=public.faolla_attendance_operational_punch_choices_v1(p_site,w.id,e.id,e.auth_user_id,l.id);
    end if;
   end if;
  else
   sid:=public.faolla_attendance_operational_punch_current_start_v1(p_site,w.id);
   select * into saved from public.merchant_attendance_operational_punch_sessions where start_event_id=sid;
   if saved.start_event_id is not null then
    if saved.employee_id is distinct from e.id or saved.employee_auth_user_id is distinct from e.auth_user_id then raise exception 'attendance_access_denied';end if;
    session_value:=public.faolla_attendance_operational_punch_session_v1(saved);source_value:=public.faolla_attendance_operational_punch_saved_source_v1(saved.source_ref);
   end if;
  end if;
 end if;
 result_value:=jsonb_build_object('protocol','attendance-operational-punch-v1','channel',p_channel,'siteId',p_site,'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),
  'clock',p_clock-'_operationalDecision','policy',policy_value,'session',session_value,'choices',choices_value,'association',association_value,'adoption',adoption_value,
  'operation',operation_value,'replayed',p_clock->'replayed','canStart',coalesce(can_start,false),'canBreak',coalesce(can_break,false),'canFinish',coalesce(can_finish,false));
 if octet_length(convert_to(result_value::text,'UTF8'))>262144 then raise exception 'attendance_operational_punch_too_large';end if;
 bundle:=jsonb_build_object('result',result_value,'source',source_value);
 if octet_length(convert_to(bundle::text,'UTF8'))>262144 then raise exception 'attendance_operational_punch_too_large';end if;return bundle;
end;
$$;

create or replace function public.faolla_attendance_operational_punch_self_v1(p_site text,p_auth uuid,p_query jsonb,p_command jsonb default null,p_allow_new_sessions boolean default false,p_allow_operational_start boolean default false,p_allow_schedule boolean default false,p_bind_rules boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare intent jsonb;clock_value jsonb;
begin
 intent:=public.faolla_attendance_operational_punch_request_v1(p_site,'self',p_query,p_command,p_allow_new_sessions,p_allow_operational_start,p_allow_schedule,p_bind_rules);
 if p_auth is null then raise exception 'attendance_invalid_request';end if;
 perform public.faolla_attendance_operational_punch_lock_v1(p_site);
 clock_value:=public.faolla_attendance_operational_punch_core_self_v1(p_site,p_auth,p_command->'clock',case when p_command is null then (p_query->>'operationId')::uuid else null end,intent);
 return public.faolla_attendance_operational_punch_result_v1(p_site,p_auth,'self',p_query,p_command,clock_value,intent,null);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_location_v1(p_site text,p_auth uuid,p_expected_worker uuid,p_query jsonb,p_command jsonb default null,p_assertion jsonb default null,p_allow_new_sessions boolean default false,p_require_clock boolean default false,p_allow_operational_start boolean default false,p_allow_schedule boolean default false,p_bind_rules boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare intent jsonb;clock_value jsonb;c jsonb;
begin
 intent:=public.faolla_attendance_operational_punch_request_v1(p_site,'location',p_query,p_command,p_allow_new_sessions,p_allow_operational_start,p_allow_schedule,p_bind_rules);
 if p_auth is null or p_expected_worker is null or p_require_clock is null or p_command is not null and p_command->'clock'->>'expectedWorkerId' is distinct from p_expected_worker::text then raise exception 'attendance_invalid_request';end if;
 perform public.faolla_attendance_operational_punch_lock_v1(p_site);c:=p_command->'clock';
 clock_value:=public.faolla_attendance_operational_punch_core_location_v2(p_site,p_auth,p_expected_worker,c-'expectedWorkerId',
  case when p_command is null then (p_query->>'operationId')::uuid else null end,p_assertion,p_allow_new_sessions,p_require_clock,intent);
 return public.faolla_attendance_operational_punch_result_v1(p_site,p_auth,'location',p_query,p_command,clock_value,intent,null);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_pin_v1(p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,p_query jsonb,p_command jsonb default null,p_allow_new_sessions boolean default false,p_allow_operational_start boolean default false,p_allow_schedule boolean default false,p_bind_rules boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare intent jsonb;request_value jsonb;
begin
 intent:=public.faolla_attendance_operational_punch_request_v1(p_site,'pin',p_query,p_command,p_allow_new_sessions,p_allow_operational_start,p_allow_schedule,p_bind_rules);
 perform public.faolla_attendance_operational_punch_lock_v1(p_site);
 request_value:=jsonb_build_object('command',p_command->'clock','operationId',case when p_command is null then (p_query->>'operationId')::uuid else null end);
 --Core consumes finish once, then builds the ENTIRE new result inside its
 --existing business subtransaction. No post-return expected refusal can escape.
 return public.faolla_attendance_operational_punch_core_pin_v1(p_site,p_terminal,p_secret_hash,p_no,p_lease,p_verified,request_value,p_allow_new_sessions,intent);
end;
$$;
create or replace function public.faolla_attendance_operational_punch_onsite_v1(p_site text,p_auth uuid,p_claims jsonb,p_query jsonb,p_command jsonb default null,p_allow_new_sessions boolean default false,p_allow_operational_start boolean default false,p_allow_schedule boolean default false,p_bind_rules boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare intent jsonb;clock_value jsonb;
begin
 intent:=public.faolla_attendance_operational_punch_request_v1(p_site,'onsite',p_query,p_command,p_allow_new_sessions,p_allow_operational_start,p_allow_schedule,p_bind_rules);
 if p_auth is null then raise exception 'attendance_invalid_request';end if;
 perform public.faolla_attendance_operational_punch_lock_v1(p_site);
 clock_value:=public.faolla_attendance_operational_punch_core_onsite_v1(p_site,p_auth,p_claims,p_command->'clock',case when p_command is null then (p_query->>'operationId')::uuid else null end,p_allow_new_sessions,intent);
 return public.faolla_attendance_operational_punch_result_v1(p_site,p_auth,'onsite',p_query,p_command,clock_value,intent,null);
end;
$$;

-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_operational_punch_activations'::regclass,
      'public.merchant_attendance_operational_punch_sessions'::regclass,
      'public.merchant_attendance_operational_punch_operations'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $punch_security$
declare object_name text;t regclass;f regprocedure;
begin
 foreach object_name in array array['merchant_attendance_operational_punch_activations','merchant_attendance_operational_punch_sessions','merchant_attendance_operational_punch_operations'] loop
  t:=to_regclass('public.'||object_name);
  execute format('alter table %s enable row level security',t);
  execute format('revoke all on %s from public,anon,authenticated,service_role',t);
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_no_truncate') then
   execute format('create trigger operational_punch_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_immutable') then
   execute format('create trigger operational_punch_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_proof') then
   execute format('create constraint trigger operational_punch_proof after insert on %s deferrable initially deferred for each row execute function public.faolla_attendance_operational_punch_guard_v1()',t);end if;
 end loop;
 for f in select p.oid::regprocedure from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_operational_punch_sessions'::regclass)
  and p.proname like 'faolla_attendance_operational_punch_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end;
$punch_security$;
grant execute on function public.faolla_attendance_operational_punch_activation_v1(jsonb,uuid,jsonb,boolean) to service_role;
grant execute on function public.faolla_attendance_operational_punch_self_v1(text,uuid,jsonb,jsonb,boolean,boolean,boolean,boolean) to service_role;
grant execute on function public.faolla_attendance_operational_punch_location_v1(text,uuid,uuid,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean,boolean) to service_role;
grant execute on function public.faolla_attendance_operational_punch_pin_v1(text,uuid,text,text,uuid,boolean,jsonb,jsonb,boolean,boolean,boolean,boolean) to service_role;
grant execute on function public.faolla_attendance_operational_punch_onsite_v1(text,uuid,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean) to service_role;
do $punch_postconditions$
declare installed boolean:=true;ns text;expected_owner oid;f regprocedure;t regclass;expected record;info record;role_name text;
begin
 select p.proowner into expected_owner from pg_proc p where p.oid='public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamp with time zone)'::regprocedure;
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 for expected in select * from (values
  ('public.faolla_attendance_self_v1(text,uuid,jsonb,uuid)','ce0a9971794cfe4fce1f6e8ab9355fad68c817e443dea9dba78f0182a5e6c801','3aaae429ef9d13ee2b154227de8c45d2c367b236dbd1430b360a5ed70ac12b08',true,2,array['p_site_id','p_auth_user_id','p_command','p_operation_id']::text[]),
  ('public.faolla_attendance_pin_clock_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean)','a9494b3f12a0323fc70e3e2343dc20e9116947ed59b71db5f63ccaf86e4801a5','a6f1a9b8182f84f70e5d6c20ea2f446ffbdfba55d87b016df382212ede893056',true,0,array['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new']::text[]),
  ('public.faolla_attendance_onsite_clock_v1(text,uuid,jsonb,jsonb,uuid,boolean)','c43a3590c6cad691fe1a61c6a4d1166d498994d4d1484800296cd1095b89f8da','a17b70c55270e7b357473b33c733757351d2142d4ccd2213e4080b67d8c37068',true,0,array['p_site','p_auth','p_claims','p_command','p_operation','p_allow_new']::text[]),
  ('public.faolla_attendance_location_clock_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)','5dad0419e0bb1e6747844106e4b2480a9c73e709be9a5bda1d9abcbb60e5bca7','645e3e6803916aa5093708c12125794d38c45fa52a39d6a6d10f077946c1d22e',false,5,array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock']::text[]),
  ('public.faolla_attendance_location_clock_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean)','797c6a382ac8c0ddf27effb2c135e103ceb9c3433b4c86a09c550550055482ab','3cb77e5dc425f5b9255308bda8288eb6bf304395ba21649fc9684e4cb58bf0f7',true,5,array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock']::text[]),
  ('public.faolla_attendance_pin_schedule_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)','7ae3139791e9e63d51414dc4ae7287f96977a23b3237cd9fb730b31b0ce2b8ed','7de7672594013ab90d78a44bf704e5e2e9870fd052fe4fbc0c236fc8fb7f454e',true,3,array['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new','p_selection','p_allow_schedule','p_bind_rules']::text[])
 ) pinned(signature,original_hash,wrapper_hash,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or not info.prosecdef or info.proconfig is distinct from array['search_path=pg_catalog']
   or info.provolatile<>'v' or info.lanname<>'plpgsql' or info.prorettype<>'jsonb'::regtype or info.proretset or info.proisstrict or info.proleakproof
   or info.pronargdefaults<>expected.defaults or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex')
    is distinct from (case when installed then expected.wrapper_hash else expected.original_hash end)
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc
  then raise exception 'merchant_attendance_operational_punch_legacy_changed';end if;
 end loop;
 for expected in select * from (values
  ('public.faolla_attendance_operational_punch_hash_v1(jsonb)','fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_stamp_v1(timestamp with time zone)','6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2','text','i','sql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_selection_v1(jsonb)','7d5699e65a9eb561c61f25c9a76e2c3d1b39cb4b5d1b2e8803d34742f0696b58','jsonb','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_command_v1(text,jsonb)','82bc7821ff797f102f827337d1049a3cc13ed3b10aa94a7f01c5ef54c37e5ce1','jsonb','s','plpgsql',false,false,0,array['p_channel','p']::text[]),
  ('public.faolla_attendance_operational_punch_activation_command_v1(text,uuid,jsonb)','79921f3f54210fc410619a1c8e1b5afcdb86b043234b0d319fa7fd1c189854ab','jsonb','s','plpgsql',false,false,0,array['p_site','p_actor','p']::text[]),
  ('public.faolla_attendance_operational_punch_activation_item_v1(public.merchant_attendance_operational_punch_activations)','ca98d4c3465b6d856b8f0d8edef1a2208f14cb9b3d98f659c1adc89c5f9ed6af','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_activation_v1(jsonb,uuid,jsonb,boolean)','73655d699260bdc40dcc6dc200b338396abd9400508b2cd22a50d86b9387b642','jsonb','v','plpgsql',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_activate']::text[]),
  ('public.faolla_attendance_operational_punch_fields_v1(jsonb)','ad3bc82213f2a108cf2f793d432c4d69ffc8a9279d4391effca81e1f5f77a23c','jsonb','s','plpgsql',false,false,0,array['p_source']::text[]),
  ('public.faolla_attendance_operational_punch_value_tuple_v1(text,jsonb)','4a920661d5ff06a792d15349de1c76ab55fbeaf7196d05bc8d9bce6558da0534','jsonb','i','sql',false,false,0,array['p_key','p']::text[]),
  ('public.faolla_attendance_operational_punch_fields_tuple_v1(jsonb)','dd017c254ea8094640d8d4578bab712d5da3eb394297ae67360522e85a0ce586','jsonb','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_origins_v1(jsonb)','13bc1a1ced1b4cce3e30339b78a04bbf55a75eb7096153d07c3e8fad6b7bba1c','jsonb','i','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_policy_hash_v1(text,text,jsonb,jsonb)','3997f9badc241ebdc11f22ab8e601c9de23e54ef21b13c2eb327898cec196864','text','s','plpgsql',false,false,0,array['p_site','p_channel','p_policy','p_source']::text[]),
  ('public.faolla_attendance_operational_punch_source_ref_v1(jsonb)','31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_saved_source_v1(jsonb)','f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_session_hash_v1(text,jsonb)','d5c3ba9f4f9df3c6611bca6870ac6c999de120316a1a1826cd73268a3c2b40a5','text','s','plpgsql',false,false,0,array['p_site','p']::text[]),
  ('public.faolla_attendance_operational_punch_current_start_v1(text,uuid)','6fa51cfaa09299ee867150212816c20a11070e656b4c146a80f6a79bf3da05c8','uuid','s','plpgsql',false,false,0,array['p_site','p_worker']::text[]),
  ('public.faolla_attendance_operational_punch_legacy_gate_v1(text,uuid,text,uuid)','647cf86f66e6c6432d585ce96d298f972a6753a6100248dc472c3f1c6c807e0d','void','s','plpgsql',false,false,1,array['p_site','p_worker','p_action','p_receipt']::text[]),
  ('public.faolla_attendance_operational_punch_policy_v1(text,text,uuid,uuid,uuid,uuid,timestamp with time zone,boolean)','cc06406ff11ec128238017336fec4d53c378f2fc63a69f2107db6d7d93939967','jsonb','v','plpgsql',false,false,0,array['p_site','p_channel','p_worker','p_employee','p_auth','p_location','p_at','p_schedule']::text[]),
  ('public.faolla_attendance_operational_punch_session_v1(public.merchant_attendance_operational_punch_sessions)','060b51ad744fc7cd9a8a0354062d5d64129cfd2f00b77eeb745dd3d918031d32','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_before_v1(text,uuid,uuid,uuid,text,uuid,timestamp with time zone,text,boolean,jsonb)','af59fc45b051d2b55f5d734972624b51787c403e8de73ddbeffb64e36c3cb3e8','jsonb','v','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_actor','p_channel','p_location','p_at','p_action','p_default_paid','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_origin_v1(public.merchant_attendance_events,text)','123524019f7137247d2a3df946169fc371b5257d6a444b0d3d45e5e982f44285','jsonb','s','plpgsql',false,false,0,array['p','p_channel']::text[]),
  ('public.faolla_attendance_operational_punch_record_selection_v1(public.merchant_attendance_events,text,uuid,jsonb)','b6cbd18f4079330faca47830733eaee45c310acb8129fcccc1bee91b7c976e77','void','v','plpgsql',false,false,0,array['p','p_channel','p_auth','p_selection']::text[]),
  ('public.faolla_attendance_operational_punch_record_v1(uuid,uuid,text,jsonb,jsonb)','13ca4b42e6fa443e12f691f2622bc999c9e88d275dd30653b5b0ee771a5b0e25','void','v','plpgsql',false,false,0,array['p_event','p_actor','p_channel','p_intent','p_decision']::text[]),
  ('public.faolla_attendance_operational_punch_operation_v1(public.merchant_attendance_operational_punch_operations)','232ecc08199da70d28d06d72bf7c4df60e297ed1987cdbe101c3e379f9084897','jsonb','s','plpgsql',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_punch_replay_v1(uuid,uuid,text,jsonb)','6a0e64878402dd0002e5429286e1fdbdaef917bedf572b18372c8996cf90ce9b','void','s','plpgsql',false,false,0,array['p_event','p_actor','p_channel','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_guard_v1()','2aabf43314eccc6921ada71b694ead18d62d236847e75e225f0e6841da2b2653','trigger','v','plpgsql',true,false,0,array[]::text[]),
  ('public.faolla_attendance_operational_punch_choices_v1(text,uuid,uuid,uuid,uuid)','5fe5767679b8041cb0bbfebe8e60d03af93c51b9eeb28b1faa77155ed02e909a','jsonb','s','plpgsql',false,false,0,array['p_site','p_worker','p_employee','p_auth','p_location']::text[]),
  ('public.faolla_attendance_operational_punch_request_v1(text,text,jsonb,jsonb,boolean,boolean,boolean,boolean)','259f530275ad0a5893d381ea30fa325e3478b0856789af672c4befa3693d0d6a','jsonb','s','plpgsql',false,false,0,array['p_site','p_channel','p_query','p_command','p_allow_new','p_allow_start','p_schedule','p_bind']::text[]),
  ('public.faolla_attendance_operational_punch_lock_v1(text)','18f2022a1b4d8f57dd78f47bac1e93abc2c8892b304085cd3ddabf8d449d3605','void','v','plpgsql',false,false,0,array['p_site']::text[]),
  ('public.faolla_attendance_operational_punch_result_v1(text,uuid,text,jsonb,jsonb,jsonb,jsonb,uuid)','ba1f6a403132f4270fbb7edcc75afd3ade38e487fad322c7f37a1541d08c206f','jsonb','v','plpgsql',false,false,1,array['p_site','p_actor','p_channel','p_query','p_command','p_clock','p_intent','p_terminal']::text[]),
  ('public.faolla_attendance_operational_punch_self_v1(text,uuid,jsonb,jsonb,boolean,boolean,boolean,boolean)','558ed3e947dff39b2336e90c91384b1aa716015d91207aeaacb11e7b5813a940','jsonb','v','plpgsql',true,true,5,array['p_site','p_auth','p_query','p_command','p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules']::text[]),
  ('public.faolla_attendance_operational_punch_location_v1(text,uuid,uuid,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean,boolean)','ab9a499e6ee4618427d936fa20faded4c2964b8552194facdb36e511972a8a56','jsonb','v','plpgsql',true,true,7,array['p_site','p_auth','p_expected_worker','p_query','p_command','p_assertion','p_allow_new_sessions','p_require_clock','p_allow_operational_start','p_allow_schedule','p_bind_rules']::text[]),
  ('public.faolla_attendance_operational_punch_pin_v1(text,uuid,text,text,uuid,boolean,jsonb,jsonb,boolean,boolean,boolean,boolean)','f0bf9c0be01e685e3eb526cf3385fd008b66b7be0693d9036b22e18af1016576','jsonb','v','plpgsql',true,true,5,array['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_query','p_command','p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules']::text[]),
  ('public.faolla_attendance_operational_punch_onsite_v1(text,uuid,jsonb,jsonb,jsonb,boolean,boolean,boolean,boolean)','4bebd2262964618f7b326d8dd93f48c81fab5de16dd552eff2f99886c2f75b23','jsonb','v','plpgsql',true,true,5,array['p_site','p_auth','p_claims','p_query','p_command','p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules']::text[]),
  ('public.faolla_attendance_operational_punch_core_self_v1(text,uuid,jsonb,uuid,jsonb)','da1230e51a61288cc208211df474c9d2c296cd304161fd6733209c6eedc27bf9','jsonb','v','plpgsql',false,false,3,array['p_site_id','p_auth_user_id','p_command','p_operation_id','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_core_pin_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb)','f8952e91900866a9325ac0f2f1bf185cf84a13bfc7e5a13a9b9c21336833e029','jsonb','v','plpgsql',false,false,1,array['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_core_onsite_v1(text,uuid,jsonb,jsonb,uuid,boolean,jsonb)','fb4ef0bd317c450c52821d4c70c6a6756b0c2c9a0016a7c4e768947638deb98c','jsonb','v','plpgsql',false,false,1,array['p_site','p_auth','p_claims','p_command','p_operation','p_allow_new','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_core_location_v1(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb)','388a36bcead29109e22b0be3b2eb514dc195e50863dcb5ae679859bf3259ec76','jsonb','v','plpgsql',false,false,6,array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock','p_intent']::text[]),
  ('public.faolla_attendance_operational_punch_core_location_v2(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb)','628cfefc46d9216568da94dcb3904ec55ab649e1d81d435cf1b6f1ad2b0cf04a','jsonb','v','plpgsql',false,false,6,array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock','p_intent']::text[])
 ) pinned(signature,source_hash,result_type,volatility,language_name,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility
   or info.lanname is distinct from expected.language_name or info.prorettype is distinct from to_regtype(expected.result_type)
   or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc
  then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and proname like 'faolla_attendance_operational_punch_%')<>39 then raise exception 'merchant_attendance_operational_punch_installation_conflict';end if;
 for expected in select * from (values
  ('merchant_attendance_operational_punch_activations',array['merchant_id','operation_id','revision','actor_auth_user_id','action','reason','command','command_fingerprint','recorded_at']::text[],array['text','uuid','bigint','uuid','text','text','jsonb','text','timestamp with time zone']::text[],8,1),
  ('merchant_attendance_operational_punch_sessions',array['merchant_id','worker_id','employee_id','employee_auth_user_id','start_event_id','operation_id','session','source_ref']::text[],array['text','uuid','uuid','uuid','uuid','uuid','jsonb','jsonb']::text[],2,3),
  ('merchant_attendance_operational_punch_operations',array['merchant_id','worker_id','event_id','operation_id','start_event_id','channel','command','operation','origin_ref']::text[],array['text','uuid','uuid','uuid','uuid','text','jsonb','jsonb','jsonb']::text[],2,3)
 ) tables(table_name,columns,types,checks,fkeys) loop
  t:=to_regclass('public.'||expected.table_name);
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or array(select a.attname::text from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.columns
   or array(select format_type(a.atttypid,a.atttypmod) from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.types
   or exists(select 1 from pg_attribute where attrelid=t and attnum>0 and (attisdropped or not attnotnull or atthasdef or attidentity<>'' or attgenerated<>'' or attndims<>0))
   or exists(select 1 from pg_constraint where conrelid=t and (not convalidated or contype='c' and connoinherit))
   or (select count(*) from pg_constraint where conrelid=t and contype='c')<>expected.checks
   or (select count(*) from pg_constraint where conrelid=t and contype='f')<>expected.fkeys
   or (select count(*) from pg_constraint where conrelid=t and contype='p')<>1
   or (select count(*) from pg_constraint where conrelid=t and contype='u')<>1
   or exists(select 1 from pg_constraint where conrelid=t and contype not in('c','f','p','u','t'))
   or (select count(*) from pg_index where indrelid=t)<>2
   or exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indrelid=t
    and (not i.indisvalid or not i.indisready or not i.indislive or not i.indisunique or i.indisexclusion or i.indpred is not null or i.indexprs is not null or a.amname<>'btree' or c.relowner<>expected_owner))
   or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_no_truncate' and tgtype=34 and tgenabled='O' and tgnargs=0 and tgqual is null
    and not tgdeferrable and not tginitdeferred and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_immutable' and tgtype=27 and tgenabled='O' and tgnargs=0 and tgqual is null
    and not tgdeferrable and not tginitdeferred and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_punch_proof' and tgtype=5 and tgenabled='O' and tgnargs=0 and tgqual is null
    and tgdeferrable and tginitdeferred and tgconstraint<>0 and tgfoid='public.faolla_attendance_operational_punch_guard_v1()'::regprocedure)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  then raise exception 'merchant_attendance_operational_punch_table_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_operational_punch_table_conflict';end if;
  end loop;
 end loop;
end;
$punch_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610080193,'merchant_attendance_operational_punch') on conflict(version) do nothing;
commit;
