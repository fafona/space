begin;
--201 SOURCE: one finite, opt-in in-app reminder ledger. No cron, history backfill,
--email, owner impersonation, approval, raw event mutation or archive rewrite.
-- BEGIN REMINDER PREFLIGHT
do $reminder_preflight$
declare installed boolean;ns text;owner_id oid;has190 boolean;spec jsonb;col jsonb;c jsonb;ix jsonb;f pg_proc%rowtype;t regclass;con pg_constraint%rowtype;idx pg_index%rowtype;tr pg_trigger%rowtype;expected_hash text;keys text[];refkeys text[];n integer;
begin
 select n.nspname,v.relowner into ns,owner_id from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.merchant_attendance_settings'::regclass;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080201 and name='merchant_attendance_reminders');
 if exists(select 1 from public.faolla_schema_migrations where version=202610080201 and name<>'merchant_attendance_reminders') 
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080193 and name='merchant_attendance_operational_punch')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080200 and name='merchant_attendance_operational_cycle')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations')
  or exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission') then raise exception 'merchant_attendance_reminder_prerequisite_required';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 for spec in select value from jsonb_array_elements($reminder_preflight_dependencies$[{"name":"faolla_attendance_administrative_boundary_v1","types":"text,uuid,uuid","argumentNames":["p_site","p_worker","p_start"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"30f4e7c06f9fd44bd90e321ae8f7f7ec44638ba50e6092ae27cc967dfce196bb","defaultExpression":null,"source":"202610080195_merchant_attendance_administrative_closure.sql"},{"name":"faolla_attendance_application_window_scalar_v1","types":"jsonb,text","argumentNames":["p","k"],"defaults":0,"resultType":"boolean","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db","defaultExpression":null,"source":"202610080194_merchant_attendance_application_window.sql"},{"name":"faolla_attendance_cycle_authority_v1","types":"text,text,uuid,uuid,uuid,date,date,text","argumentNames":["p_site","p_access","p_worker","p_grant","p_actor","p_from","p_through","p_action"],"defaults":0,"resultType":"void","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"891a994e9c1c1c13118f28c4c1b5a43ae62ee360708edc3ef34be0a30bdf834a","defaultExpression":null,"source":"202610080200_merchant_attendance_operational_cycle.sql"},{"name":"faolla_attendance_cycle_intent_v1","types":"public.merchant_attendance_cycle_intents","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"75bf87a8b1815c61d208fd760abb0540db31f7d2195d3cf499ada8cbf26c61c2","defaultExpression":null,"source":"202610080200_merchant_attendance_operational_cycle.sql"},{"name":"faolla_attendance_operational_punch_current_start_v1","types":"text,uuid","argumentNames":["p_site","p_worker"],"defaults":0,"resultType":"uuid","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"f6b47de540399f78360ffb1b24a4597a01878807825ca1cbaca820aebf39db01","defaultExpression":null,"source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_punch_saved_source_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d","defaultExpression":null,"source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_punch_source_ref_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7","defaultExpression":null,"source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_punch_stamp_v1","types":"timestamptz","argumentNames":["p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","defaultExpression":null,"source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_rule_hash_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","defaultExpression":null,"source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_rule_object_v1","types":"jsonb,text[]","argumentNames":["p","ks"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","defaultExpression":null,"source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_rule_scalar_v1","types":"jsonb,text","argumentNames":["p","k"],"defaults":0,"resultType":"boolean","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","defaultExpression":null,"source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_source_stamp_v1","types":"text","argumentNames":["p"],"defaults":0,"resultType":"timestamptz","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265","defaultExpression":null,"source":"202610080192_merchant_attendance_operational_source.sql"},{"name":"faolla_attendance_operational_source_tuple_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a","defaultExpression":null,"source":"202610080192_merchant_attendance_operational_source.sql"},{"name":"faolla_attendance_operational_source_v1","types":"text,uuid,uuid,uuid,timestamptz","argumentNames":["p_site","p_worker","p_employee","p_employee_auth","p_at"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee","defaultExpression":null,"source":"202610080192_merchant_attendance_operational_source.sql"},{"name":"faolla_attendance_review_routing_entry_v1","types":"public.merchant_attendance_review_responsibility_entries","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"c7ad8af0b4ae7950ba4d322112b8ec5282ea532b2f5f9432460e67500b4ef61b","defaultExpression":null,"source":"202610080198_merchant_attendance_review_routing.sql"},{"name":"faolla_attendance_review_routing_observe_v1","types":"text,text,uuid,timestamptz","argumentNames":["p_site","p_family","p_request","p_at"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"c67fdd792c1ea719c2ce86cd88beb40d057920b66ad5f892b45ad9c1f91e7167","defaultExpression":null,"source":"202610080198_merchant_attendance_review_routing.sql"},{"name":"faolla_attendance_review_routing_qualify_v1","types":"text,text,uuid,uuid,timestamptz","argumentNames":["p_site","p_family","p_request","p_grant","p_at"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"7a867d0c19f5b7dedae30db3f1e9007ad7792702949c333c919e22ac7c7bdff9","defaultExpression":null,"source":"202610080198_merchant_attendance_review_routing.sql"},{"name":"faolla_valid_merchant_enterprise_permissions_v1","types":"text[]","argumentNames":["p_permissions"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog, public"],"serviceExecute":false,"hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","defaultExpression":null,"source":"202610080190_merchant_attendance_correction_delegation_permission.sql","legacyHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc"},{"name":"faolla_attendance_operational_consumer_activation_v1","types":"jsonb,uuid,jsonb,boolean","argumentNames":["p_query","p_auth_user_id","p_command","p_allow_activate"],"defaults":2,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":null,"defaultExpression":"NULL::jsonb, false","source":"202610080194_merchant_attendance_application_window.sql","oldHash":"47c615dc8b28428b158efd3ea31bb551335bc95ba10ffd70555358f702a7877c","newHash":"cc1997523546034ef0c6fc4d94a1adce530275871ef6ac7f01f7271f5c066a7e"}]$reminder_preflight_dependencies$::jsonb) loop
  select * into f from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));
  expected_hash:=coalesce(spec->>'hash',(case when installed then spec->>'newHash' else spec->>'oldHash' end));
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then expected_hash:=spec->>'legacyHash';end if;
  if f.oid is null or f.proowner<>owner_id or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.provolatile::text<>spec->>'volatility'
   or (select lanname from pg_language where oid=f.prolang)<>spec->>'language' or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f' or f.proparallel<>'u' or f.provariadic<>0 or f.proargmodes is not null or f.proallargtypes is not null
   or f.pronargs<>jsonb_array_length(spec->'argumentNames') or f.procost<>100 or f.prorows<>0 or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or f.pronargdefaults<>(spec->>'defaults')::integer or pg_get_expr(f.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash then raise exception 'merchant_attendance_reminder_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if (has_function_privilege(owner_id,f.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(owner_id,owner_id,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(owner_id,0::oid,'EXECUTE',false),jsonb_build_array(owner_id,owner_id,'EXECUTE',false)))) then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
  elsif exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>owner_id or a.privilege_type<>'EXECUTE' or a.is_grantable
    or a.grantee<>owner_id and (not(spec->>'serviceExecute')::boolean or a.grantee<>(select oid from pg_roles where rolname='service_role')))
   or (select count(*) from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))))<>(case when (spec->>'serviceExecute')::boolean then 2 else 1 end)
   or not has_function_privilege(owner_id,f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from (spec->>'serviceExecute')::boolean then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and (proname like 'faolla_attendance_reminder_%' or proname like 'faolla_attendance_reminders_%'))<>(case when installed then 20 else 0 end) then raise exception 'merchant_attendance_reminder_installation_conflict:function_inventory';end if;
 if (select count(*) from pg_class where relnamespace=(select oid from pg_namespace where nspname=ns) and relname like 'merchant_attendance_reminder_%' and relkind not in('i','I'))<>(case when installed then 5 else 0 end) then raise exception 'merchant_attendance_reminder_installation_conflict:relation_inventory';end if;
 for spec in select value from jsonb_array_elements($reminder_preflight_tables$[{"name":"merchant_attendance_reminder_plans","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"plan_id","type":"uuid","nullable":false},{"name":"budget_key","type":"text","nullable":false},{"name":"category","type":"text","nullable":false},{"name":"worker_id","type":"uuid","nullable":false},{"name":"employee_id","type":"uuid","nullable":false},{"name":"employee_auth_user_id","type":"uuid","nullable":false},{"name":"source_id","type":"uuid","nullable":false},{"name":"source_version","type":"text","nullable":false},{"name":"target","type":"jsonb","nullable":false},{"name":"source_ref","type":"jsonb","nullable":false},{"name":"recipient","type":"jsonb","nullable":false},{"name":"recipient_key","type":"text","nullable":false},{"name":"configuration","type":"jsonb","nullable":false},{"name":"anchor_at","type":"timestamptz","nullable":false},{"name":"activation_revision","type":"bigint","nullable":false},{"name":"recorded_at","type":"timestamptz","nullable":false},{"name":"plan_fingerprint","type":"text","nullable":false}],"constraints":[{"name":"reminder_plans_pk","kind":"p","keys":["merchant_id","plan_id"],"reference":null,"referenceKeys":null},{"name":"reminder_plans_source_uq","kind":"u","keys":["merchant_id","category","source_id","source_version"],"reference":null,"referenceKeys":null},{"name":"reminder_plans_worker_fk","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"]},{"name":"reminder_plans_employee_fk","kind":"f","keys":["merchant_id","employee_id"],"reference":"merchant_enterprise_employees","referenceKeys":["merchant_id","id"]},{"name":"reminder_plans_shape_ck","kind":"c","expression":"category=any(array['open_session','pending_review','period_due']) and activation_revision>=1 and isfinite(anchor_at) and isfinite(recorded_at)\n  and budget_key~'^[0-9a-f]{64}$' and recipient_key~'^[0-9a-f]{64}$' and plan_fingerprint~'^[0-9a-f]{64}$'\n  and octet_length(convert_to(jsonb_build_array(target,source_ref,recipient,configuration)::text,'UTF8'))<=24576"}]},{"name":"merchant_attendance_reminder_heads","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"budget_key","type":"text","nullable":false},{"name":"plan_id","type":"uuid","nullable":false},{"name":"revision","type":"bigint","nullable":false},{"name":"last_event_id","type":"uuid","nullable":false},{"name":"state","type":"text","nullable":false},{"name":"delivered_count","type":"integer","nullable":false},{"name":"last_delivered_at","type":"timestamptz","nullable":true},{"name":"next_due_at","type":"timestamptz","nullable":true}],"constraints":[{"name":"reminder_heads_pk","kind":"p","keys":["merchant_id","budget_key"],"reference":null,"referenceKeys":null},{"name":"reminder_heads_plan_fk","kind":"f","keys":["merchant_id","plan_id"],"reference":"merchant_attendance_reminder_plans","referenceKeys":["merchant_id","plan_id"]},{"name":"reminder_heads_shape_ck","kind":"c","expression":"revision>=1 and revision<=9007199254740990 and delivered_count>=0 and delivered_count<=10\n  and state=any(array['active','stopped','handover_needed']) and (delivered_count=0)=(last_delivered_at is null)\n  and (state='active')=(next_due_at is not null) and (last_delivered_at is null or isfinite(last_delivered_at)) and (next_due_at is null or isfinite(next_due_at))"}]},{"name":"merchant_attendance_reminder_events","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"event_id","type":"uuid","nullable":false},{"name":"budget_key","type":"text","nullable":false},{"name":"plan_id","type":"uuid","nullable":false},{"name":"revision","type":"bigint","nullable":false},{"name":"action","type":"text","nullable":false},{"name":"ordinal","type":"integer","nullable":false},{"name":"recorded_at","type":"timestamptz","nullable":false},{"name":"previous_head","type":"jsonb","nullable":true},{"name":"current_head","type":"jsonb","nullable":false},{"name":"batch_id","type":"uuid","nullable":true},{"name":"item","type":"jsonb","nullable":true},{"name":"run_operation_id","type":"uuid","nullable":true}],"constraints":[{"name":"reminder_events_pk","kind":"p","keys":["merchant_id","event_id"],"reference":null,"referenceKeys":null},{"name":"reminder_events_stream_uq","kind":"u","keys":["merchant_id","budget_key","revision"],"reference":null,"referenceKeys":null},{"name":"reminder_events_plan_fk","kind":"f","keys":["merchant_id","plan_id"],"reference":"merchant_attendance_reminder_plans","referenceKeys":["merchant_id","plan_id"]},{"name":"reminder_events_shape_ck","kind":"c","expression":"action=any(array['register','delivery','defer','stop']) and revision>=1 and revision<=9007199254740990 and ordinal>=0 and ordinal<=10\n  and isfinite(recorded_at) and (action='delivery')=(batch_id is not null) and (action='delivery')=(item is not null)\n  and octet_length(convert_to(jsonb_build_array(previous_head,current_head,item)::text,'UTF8'))<=8192"}]},{"name":"merchant_attendance_reminder_batches","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"batch_id","type":"uuid","nullable":false},{"name":"category","type":"text","nullable":false},{"name":"recipient","type":"jsonb","nullable":false},{"name":"recipient_key","type":"text","nullable":false},{"name":"recipient_auth_user_id","type":"uuid","nullable":false},{"name":"window_start","type":"timestamptz","nullable":false},{"name":"window_end","type":"timestamptz","nullable":false},{"name":"recorded_at","type":"timestamptz","nullable":false},{"name":"items","type":"jsonb","nullable":false},{"name":"batch_fingerprint","type":"text","nullable":false}],"constraints":[{"name":"reminder_batches_pk","kind":"p","keys":["merchant_id","batch_id"],"reference":null,"referenceKeys":null},{"name":"reminder_batches_window_uq","kind":"u","keys":["merchant_id","recipient_key","category","window_start"],"reference":null,"referenceKeys":null},{"name":"reminder_batches_shape_ck","kind":"c","expression":"category=any(array['open_session','pending_review','period_due']) and recipient_key~'^[0-9a-f]{64}$' and batch_fingerprint~'^[0-9a-f]{64}$'\n  and isfinite(window_start) and isfinite(window_end) and isfinite(recorded_at) and window_end=window_start+'01:00:00'::interval\n  and recorded_at>=window_start and recorded_at<window_end and jsonb_typeof(items)='array' and jsonb_array_length(items)>=1 and jsonb_array_length(items)<=25\n  and octet_length(convert_to(jsonb_build_array(recipient,items)::text,'UTF8'))<=32768"}]},{"name":"merchant_attendance_reminder_operations","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"operation_id","type":"uuid","nullable":false},{"name":"action","type":"text","nullable":false},{"name":"actor_kind","type":"text","nullable":false},{"name":"actor_id","type":"uuid","nullable":true},{"name":"command","type":"jsonb","nullable":false},{"name":"command_fingerprint","type":"text","nullable":false},{"name":"recorded_at","type":"timestamptz","nullable":false},{"name":"result","type":"jsonb","nullable":false},{"name":"batch_id","type":"uuid","nullable":true}],"constraints":[{"name":"reminder_operations_pk","kind":"p","keys":["merchant_id","operation_id"],"reference":null,"referenceKeys":null},{"name":"reminder_operations_shape_ck","kind":"c","expression":"action=any(array['run_due','mark_read']) and actor_kind=any(array['auth','system']) and (actor_kind='system')=(actor_id is null)\n  and (action='mark_read')=(batch_id is not null) and (action<>'mark_read' or actor_kind='auth') and command_fingerprint~'^[0-9a-f]{64}$' and isfinite(recorded_at)\n  and octet_length(convert_to(jsonb_build_array(command,result)::text,'UTF8'))<=16384"}]}]$reminder_preflight_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));if installed<>(t is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:table:%',spec->>'name';end if;if not installed then continue;end if;
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=owner_id and relrowsecurity and not relforcerowsecurity and relpersistence='p' and not relispartition)
   or exists(select 1 from pg_policy where polrelid=t) or exists(select 1 from pg_class z cross join lateral aclexplode(coalesce(z.relacl,acldefault('r',z.relowner))) a where z.oid=t and (a.grantor<>owner_id or a.grantee<>owner_id))
   or exists(select 1 from pg_attribute z cross join lateral aclexplode(z.attacl) a where z.attrelid=t and (a.grantor<>owner_id or a.grantee<>owner_id)) then raise exception 'merchant_attendance_reminder_installation_conflict:table_acl:%',spec->>'name';end if;
  if (select count(*) from pg_attribute where attrelid=t and attnum>0)<>jsonb_array_length(spec->'columns') then raise exception 'merchant_attendance_reminder_installation_conflict:columns:%',spec->>'name';end if;n:=0;
  for col in select value from jsonb_array_elements(spec->'columns') loop n:=n+1;
   if not exists(select 1 from pg_attribute a join pg_type y on y.oid=a.atttypid where a.attrelid=t and a.attnum=n and a.attname=col->>'name' and a.atttypid=to_regtype(col->>'type') and a.atttypmod=-1 and not a.attisdropped and a.attnotnull=(not(col->>'nullable')::boolean) and not a.atthasdef and a.attidentity='' and a.attgenerated='' and a.attndims=0 and a.attcollation=y.typcollation) then raise exception 'merchant_attendance_reminder_installation_conflict:column:%.%',spec->>'name',col->>'name';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=t and contype<>'t')<>jsonb_array_length(spec->'constraints') then raise exception 'merchant_attendance_reminder_installation_conflict:constraints:%',spec->>'name';end if;
  for c in select value from jsonb_array_elements(spec->'constraints') loop
   select * into con from pg_constraint where conrelid=t and conname=c->>'name';
   if coalesce(c->>'kind','') not in('c','p','u','f') or con.oid is null or con.contype::text<>c->>'kind' or not con.convalidated or con.connoinherit is distinct from ((c->>'kind') in('p','u','f')) or not con.conislocal or con.coninhcount<>0 or con.condeferrable or con.condeferred then raise exception 'merchant_attendance_reminder_installation_conflict:constraint:%',c->>'name';end if;
   if con.contype='c' then
    if (select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(pg_get_expr(con.conbin,t),'''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) is distinct from (select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(c->>'expression','''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) then raise exception 'merchant_attendance_reminder_installation_conflict:check:%',c->>'name';end if;
   else
    select array_agg(a.attname::text order by z.ord) into keys from unnest(con.conkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=t and a.attnum=z.n;
    if keys is distinct from array(select jsonb_array_elements_text(c->'keys')) then raise exception 'merchant_attendance_reminder_installation_conflict:keys:%',c->>'name';end if;
    if con.contype='f' then
     select array_agg(a.attname::text order by z.ord) into refkeys from unnest(con.confkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=z.n;
     if con.confrelid is distinct from to_regclass(format('%I.%I',ns,c->>'reference')) or refkeys is distinct from array(select jsonb_array_elements_text(c->'referenceKeys')) or con.confmatchtype<>'s' or con.confupdtype<>'a' or con.confdeltype<>'a' then raise exception 'merchant_attendance_reminder_installation_conflict:foreign_key:%',c->>'name';end if;
    else
     select * into idx from pg_index where indexrelid=con.conindid;
     if idx.indexrelid is null or not(idx.indisvalid and idx.indisready and idx.indislive and idx.indisunique) or idx.indpred is not null or idx.indexprs is not null or idx.indnullsnotdistinct or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or idx.indisprimary<>(con.contype='p')
      or not exists(select 1 from pg_class v join pg_am a on a.oid=v.relam where v.oid=idx.indexrelid and v.relowner=owner_id and a.amname='btree')
      or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z] join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_reminder_installation_conflict:constraint_index:%',c->>'name';end if;
    end if;
   end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3 then raise exception 'merchant_attendance_reminder_installation_conflict:trigger_inventory:%',spec->>'name';end if;
  for tr in select * from pg_trigger where tgrelid=t and not tgisinternal loop
   if tr.tgname not in('reminder_immutable','reminder_no_truncate','reminder_proof') or tr.tgenabled<>'O' or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null
    or tr.tgfoid is distinct from to_regprocedure(format('%I.%I()',ns,(case when tr.tgname='reminder_proof' then 'faolla_attendance_reminder_deferred_v1' else 'faolla_attendance_reminder_guard_v1' end)))
    or tr.tgtype<>(case when tr.tgname='reminder_no_truncate' then 34 when tr.tgname='reminder_immutable' then 31 when spec->>'name'='merchant_attendance_reminder_heads' then 21 else 5 end)
    or tr.tgdeferrable<>(tr.tgname='reminder_proof') or tr.tginitdeferred<>(tr.tgname='reminder_proof') or (tr.tgconstraint<>0)<>(tr.tgname='reminder_proof') then raise exception 'merchant_attendance_reminder_installation_conflict:trigger:%',tr.tgname;end if;
  end loop;
  if (select count(*) from pg_index where indrelid=t)<>(select count(*) from jsonb_array_elements(spec->'constraints') constraint_item where constraint_item->>'kind' in('p','u'))+(select count(*) from jsonb_array_elements($reminder_preflight_indexes$[{"name":"reminder_due_idx","table":"merchant_attendance_reminder_heads","keys":["merchant_id","next_due_at","plan_id"],"unique":false,"predicate":"state='active'"},{"name":"reminder_plan_budget_idx","table":"merchant_attendance_reminder_plans","keys":["merchant_id","budget_key","recorded_at","plan_id"],"unique":false,"predicate":null},{"name":"reminder_recipient_idx","table":"merchant_attendance_reminder_batches","keys":["merchant_id","recipient_auth_user_id","recorded_at","batch_id"],"unique":false,"predicate":null},{"name":"reminder_first_read_idx","table":"merchant_attendance_reminder_operations","keys":["merchant_id","batch_id","actor_id","recorded_at","operation_id"],"unique":false,"predicate":"action='mark_read'"},{"name":"reminder_delivery_budget_uq","table":"merchant_attendance_reminder_events","keys":["merchant_id","budget_key","ordinal"],"unique":true,"predicate":"action='delivery'"},{"name":"reminder_delivery_plan_uq","table":"merchant_attendance_reminder_events","keys":["merchant_id","plan_id","ordinal"],"unique":true,"predicate":"action='delivery'"},{"name":"reminder_run_event_idx","table":"merchant_attendance_reminder_events","keys":["merchant_id","run_operation_id","event_id"],"unique":false,"predicate":"run_operation_id is not null"}]$reminder_preflight_indexes$::jsonb) index_item where index_item->>'table'=spec->>'name') then raise exception 'merchant_attendance_reminder_installation_conflict:index_inventory:%',spec->>'name';end if;
 end loop;
 for ix in select value from jsonb_array_elements($reminder_preflight_indexes$[{"name":"reminder_due_idx","table":"merchant_attendance_reminder_heads","keys":["merchant_id","next_due_at","plan_id"],"unique":false,"predicate":"state='active'"},{"name":"reminder_plan_budget_idx","table":"merchant_attendance_reminder_plans","keys":["merchant_id","budget_key","recorded_at","plan_id"],"unique":false,"predicate":null},{"name":"reminder_recipient_idx","table":"merchant_attendance_reminder_batches","keys":["merchant_id","recipient_auth_user_id","recorded_at","batch_id"],"unique":false,"predicate":null},{"name":"reminder_first_read_idx","table":"merchant_attendance_reminder_operations","keys":["merchant_id","batch_id","actor_id","recorded_at","operation_id"],"unique":false,"predicate":"action='mark_read'"},{"name":"reminder_delivery_budget_uq","table":"merchant_attendance_reminder_events","keys":["merchant_id","budget_key","ordinal"],"unique":true,"predicate":"action='delivery'"},{"name":"reminder_delivery_plan_uq","table":"merchant_attendance_reminder_events","keys":["merchant_id","plan_id","ordinal"],"unique":true,"predicate":"action='delivery'"},{"name":"reminder_run_event_idx","table":"merchant_attendance_reminder_events","keys":["merchant_id","run_operation_id","event_id"],"unique":false,"predicate":"run_operation_id is not null"}]$reminder_preflight_indexes$::jsonb) loop
  select * into idx from pg_index where indexrelid=to_regclass(format('%I.%I',ns,ix->>'name'));if installed<>(idx.indexrelid is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:index:%',ix->>'name';end if;if not installed then continue;end if;
  t:=to_regclass(format('%I.%I',ns,ix->>'table'));keys:=array(select jsonb_array_elements_text(ix->'keys'));
  if idx.indrelid<>t or not(idx.indisvalid and idx.indisready and idx.indislive) or idx.indisunique<>(ix->>'unique')::boolean or idx.indisprimary or idx.indisexclusion or idx.indnullsnotdistinct or idx.indexprs is not null or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys)
   or (select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(pg_get_expr(idx.indpred,t),'''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) is distinct from (select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(ix->>'predicate','''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord))
   or not exists(select 1 from pg_class v join pg_am a on a.oid=v.relam where v.oid=idx.indexrelid and v.relowner=owner_id and a.amname='btree')
   or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z] join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_reminder_installation_conflict:index:%',ix->>'name';end if;
 end loop;
 if installed then
  for spec in select value from jsonb_array_elements($reminder_preflight_functions$[{"name":"faolla_attendance_reminder_id_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"uuid","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"addb44f8b3fbb33610adda8e583738966adb33f97ebb87795fdddfaccd5f44c2","defaultExpression":null},{"name":"faolla_attendance_reminder_config_v1","types":"jsonb,text","argumentNames":["p_source","p_category"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"5d737b34f4bc38d6f68e43b2dd5cd91572782c0aa3a0daeefdff52880ebd2dd2","defaultExpression":null},{"name":"faolla_attendance_reminder_config_layers_v1","types":"jsonb,text","argumentNames":["p_layers","p_category"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"ccc252d6180747cc4d9cbe5bc0509307845e702691c4c35c09b9cd6a7c51959d","defaultExpression":null},{"name":"faolla_attendance_reminder_head_v1","types":"public.merchant_attendance_reminder_heads","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"0ad15d99b26b3ca7c5e0b16ee20696062c2746c0219be59be6897106e5f91dd7","defaultExpression":null},{"name":"faolla_attendance_reminder_eligible_v1","types":"public.merchant_attendance_reminder_plans,timestamptz","argumentNames":["p","p_at"],"defaults":0,"resultType":"text","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"e098e5885e5dfaf2e53f074deb833a4ce7e99e984c6a93bade10c12aea3737e4","defaultExpression":null},{"name":"faolla_attendance_reminder_qualify_v1","types":"public.merchant_attendance_reminder_plans,timestamptz","argumentNames":["p","p_at"],"defaults":0,"resultType":"text","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"473addf4892f0a776c9c63105466a482194c0b0b72b214336da9d98f96878e57","defaultExpression":null},{"name":"faolla_attendance_reminder_advance_v1","types":"public.merchant_attendance_reminder_plans,text,timestamptz,text,timestamptz,uuid,jsonb,uuid","argumentNames":["p","p_action","p_at","p_state","p_due","p_batch","p_item","p_operation"],"defaults":1,"resultType":"void","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"0a486f4b48d90948aa00b6e4555ab7c49ae9e41a5814c3014b3a60fe2b7fc287","defaultExpression":"NULL::uuid"},{"name":"faolla_attendance_reminder_capture_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"06ffebf88abd0f233b9d26ecf77fdbbc5e646d582ec110d33c682ccddcb04f5f","defaultExpression":null},{"name":"faolla_attendance_reminder_command_v1","types":"text,text,uuid,jsonb","argumentNames":["p_site","p_kind","p_actor","p_command"],"defaults":0,"resultType":"text","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"dd544846a248bdbf2ca14456007a47b4700bf510109e87ffa722682e246d3040","defaultExpression":null},{"name":"faolla_attendance_reminder_receipt_v1","types":"public.merchant_attendance_reminder_operations","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"d0a7431e6000983a97b67adbf229d891b3aabfbba97804df446fdb5e2718106b","defaultExpression":null},{"name":"faolla_attendance_reminder_run_v1","types":"text,text,uuid,jsonb,boolean","argumentNames":["p_site","p_kind","p_actor","p_command","p_allow"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"251e587468e8176014ee4f8acbfb108196d4d5292cf62e6d33c3dbe55446b48c","defaultExpression":null},{"name":"faolla_attendance_reminder_recipient_v1","types":"public.merchant_attendance_reminder_batches,uuid","argumentNames":["p","p_actor"],"defaults":0,"resultType":"void","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"9c5088bc85a0cea069a2273756e884e2682054534a02f41610ab6a917625274d","defaultExpression":null},{"name":"faolla_attendance_reminder_batch_v1","types":"public.merchant_attendance_reminder_batches,uuid,boolean","argumentNames":["p","p_actor","p_detail"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"02e854dbb8876c1cc234ca4d4633d125ded82574875de588b9c074fad671b29f","defaultExpression":null},{"name":"faolla_attendance_reminders_v1","types":"jsonb,uuid,jsonb,boolean","argumentNames":["p_query","p_auth_user_id","p_command","p_allow_write"],"defaults":2,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"3d32b6b7c6f5eaef0b5aa7edb1262d52c04b53591c34debc4cafac4395d4e945","defaultExpression":"NULL::jsonb, false"},{"name":"faolla_attendance_reminders_run_v1","types":"jsonb,boolean","argumentNames":["p_query","p_allow_run"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"c798f0fe940b0107ae8cfbc76d84af85821bd13437ea3e28fbe87a6a25529d70","defaultExpression":"false"},{"name":"faolla_attendance_reminder_plan_proof_v1","types":"public.merchant_attendance_reminder_plans","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"bed800a5692bb335a5a22f8fbd7065644cdb5edf6942a4a797cd46c92c9389c8","defaultExpression":null},{"name":"faolla_attendance_reminder_batch_proof_v1","types":"public.merchant_attendance_reminder_batches","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1e647e5feea6e0591201295a1d8a1a25ff892e0bde70578f182a77751724fec8","defaultExpression":null},{"name":"faolla_attendance_reminder_event_proof_v1","types":"public.merchant_attendance_reminder_events","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"cf0a21575ca3e1552dd2325f21fee0edeb0b6dea387359375b50e1c5951a1008","defaultExpression":null},{"name":"faolla_attendance_reminder_guard_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1b229f813a30bb287b0600f4c30ecfcbed0945f83f098c9533f7d782ad5ab6d1","defaultExpression":null},{"name":"faolla_attendance_reminder_deferred_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1b6c37d226e746cab05ff29cad196d0d062f24bb5903d66ef5c76dd24cc7969a","defaultExpression":null}]$reminder_preflight_functions$::jsonb) loop
   select * into f from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));expected_hash:=spec->>'hash';
  if f.oid is null or f.proowner<>owner_id or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.provolatile::text<>spec->>'volatility'
   or (select lanname from pg_language where oid=f.prolang)<>spec->>'language' or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f' or f.proparallel<>'u' or f.provariadic<>0 or f.proargmodes is not null or f.proallargtypes is not null
   or f.pronargs<>jsonb_array_length(spec->'argumentNames') or f.procost<>100 or f.prorows<>0 or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or f.pronargdefaults<>(spec->>'defaults')::integer or pg_get_expr(f.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash then raise exception 'merchant_attendance_reminder_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if (has_function_privilege(owner_id,f.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(owner_id,owner_id,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(owner_id,0::oid,'EXECUTE',false),jsonb_build_array(owner_id,owner_id,'EXECUTE',false)))) then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
  elsif exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>owner_id or a.privilege_type<>'EXECUTE' or a.is_grantable
    or a.grantee<>owner_id and (not(spec->>'serviceExecute')::boolean or a.grantee<>(select oid from pg_roles where rolname='service_role')))
   or (select count(*) from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))))<>(case when (spec->>'serviceExecute')::boolean then 2 else 1 end)
   or not has_function_privilege(owner_id,f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from (spec->>'serviceExecute')::boolean then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
  end loop;
 end if;
 for spec in select value from jsonb_array_elements($reminder_preflight_captures$[{"table":"merchant_attendance_operational_punch_sessions","type":5,"deferred":false},{"table":"merchant_attendance_review_responsibility_heads","type":21,"deferred":true},{"table":"merchant_attendance_cycle_operations","type":5,"deferred":true}]$reminder_preflight_captures$::jsonb) loop
  select * into tr from pg_trigger where tgrelid=to_regclass(format('%I.%I',ns,spec->>'table')) and tgname='reminder_capture';
  if installed<>(tr.oid is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:capture:%',spec->>'table';end if;
  if installed and (tr.tgfoid is distinct from to_regprocedure(format('%I.faolla_attendance_reminder_capture_v1()',ns)) or tr.tgtype<>(spec->>'type')::integer or tr.tgenabled<>'O' or tr.tgdeferrable<>(spec->>'deferred')::boolean or tr.tginitdeferred<>(spec->>'deferred')::boolean or (tr.tgconstraint<>0)<>(spec->>'deferred')::boolean or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:capture:%',spec->>'table';end if;
 end loop;
end;
$reminder_preflight$;
-- END REMINDER PREFLIGHT

create table if not exists public.merchant_attendance_reminder_plans(
 merchant_id text not null,plan_id uuid not null,budget_key text not null,category text not null,
 worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
 source_id uuid not null,source_version text not null,target jsonb not null,source_ref jsonb not null,
 recipient jsonb not null,recipient_key text not null,configuration jsonb not null,anchor_at timestamptz not null,
 activation_revision bigint not null,recorded_at timestamptz not null,plan_fingerprint text not null,
 constraint reminder_plans_pk primary key(merchant_id,plan_id),
 constraint reminder_plans_source_uq unique(merchant_id,category,source_id,source_version),
 constraint reminder_plans_worker_fk foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
 constraint reminder_plans_employee_fk foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
 constraint reminder_plans_shape_ck check(category in('open_session','pending_review','period_due') and activation_revision>=1 and isfinite(anchor_at) and isfinite(recorded_at)
  and budget_key~'^[0-9a-f]{64}$' and recipient_key~'^[0-9a-f]{64}$' and plan_fingerprint~'^[0-9a-f]{64}$'
  and octet_length(convert_to(jsonb_build_array(target,source_ref,recipient,configuration)::text,'UTF8'))<=24576)
);
create table if not exists public.merchant_attendance_reminder_heads(
 merchant_id text not null,budget_key text not null,plan_id uuid not null,revision bigint not null,last_event_id uuid not null,
 state text not null,delivered_count integer not null,last_delivered_at timestamptz,next_due_at timestamptz,
 constraint reminder_heads_pk primary key(merchant_id,budget_key),
 constraint reminder_heads_plan_fk foreign key(merchant_id,plan_id) references public.merchant_attendance_reminder_plans(merchant_id,plan_id),
 constraint reminder_heads_shape_ck check(revision>=1 and revision<=9007199254740990 and delivered_count>=0 and delivered_count<=10
  and state in('active','stopped','handover_needed') and (delivered_count=0)=(last_delivered_at is null)
  and (state='active')=(next_due_at is not null) and (last_delivered_at is null or isfinite(last_delivered_at)) and (next_due_at is null or isfinite(next_due_at)))
);
create table if not exists public.merchant_attendance_reminder_events(
 merchant_id text not null,event_id uuid not null,budget_key text not null,plan_id uuid not null,revision bigint not null,
 action text not null,ordinal integer not null,recorded_at timestamptz not null,previous_head jsonb,current_head jsonb not null,batch_id uuid,item jsonb,run_operation_id uuid,
 constraint reminder_events_pk primary key(merchant_id,event_id),
 constraint reminder_events_stream_uq unique(merchant_id,budget_key,revision),
 constraint reminder_events_plan_fk foreign key(merchant_id,plan_id) references public.merchant_attendance_reminder_plans(merchant_id,plan_id),
 constraint reminder_events_shape_ck check(action in('register','delivery','defer','stop') and revision>=1 and revision<=9007199254740990 and ordinal>=0 and ordinal<=10
  and isfinite(recorded_at) and (action='delivery')=(batch_id is not null) and (action='delivery')=(item is not null)
  and octet_length(convert_to(jsonb_build_array(previous_head,current_head,item)::text,'UTF8'))<=8192)
);
create table if not exists public.merchant_attendance_reminder_batches(
 merchant_id text not null,batch_id uuid not null,category text not null,recipient jsonb not null,recipient_key text not null,recipient_auth_user_id uuid not null,
 window_start timestamptz not null,window_end timestamptz not null,recorded_at timestamptz not null,items jsonb not null,batch_fingerprint text not null,
 constraint reminder_batches_pk primary key(merchant_id,batch_id),
 constraint reminder_batches_window_uq unique(merchant_id,recipient_key,category,window_start),
 constraint reminder_batches_shape_ck check(category in('open_session','pending_review','period_due') and recipient_key~'^[0-9a-f]{64}$' and batch_fingerprint~'^[0-9a-f]{64}$'
  and isfinite(window_start) and isfinite(window_end) and isfinite(recorded_at) and window_end=window_start+interval '1 hour'
  and recorded_at>=window_start and recorded_at<window_end and jsonb_typeof(items)='array' and jsonb_array_length(items)>=1 and jsonb_array_length(items)<=25
  and octet_length(convert_to(jsonb_build_array(recipient,items)::text,'UTF8'))<=32768)
);
create table if not exists public.merchant_attendance_reminder_operations(
 merchant_id text not null,operation_id uuid not null,action text not null,actor_kind text not null,actor_id uuid,
 command jsonb not null,command_fingerprint text not null,recorded_at timestamptz not null,result jsonb not null,batch_id uuid,
 constraint reminder_operations_pk primary key(merchant_id,operation_id),
 constraint reminder_operations_shape_ck check(action in('run_due','mark_read') and actor_kind in('auth','system') and (actor_kind='system')=(actor_id is null)
  and (action='mark_read')=(batch_id is not null) and (action<>'mark_read' or actor_kind='auth') and command_fingerprint~'^[0-9a-f]{64}$' and isfinite(recorded_at)
  and octet_length(convert_to(jsonb_build_array(command,result)::text,'UTF8'))<=16384)
);
create index if not exists reminder_due_idx on public.merchant_attendance_reminder_heads(merchant_id,next_due_at,plan_id) where state='active';
create index if not exists reminder_plan_budget_idx on public.merchant_attendance_reminder_plans(merchant_id,budget_key,recorded_at,plan_id);
create index if not exists reminder_recipient_idx on public.merchant_attendance_reminder_batches(merchant_id,recipient_auth_user_id,recorded_at,batch_id);
create index if not exists reminder_first_read_idx on public.merchant_attendance_reminder_operations(merchant_id,batch_id,actor_id,recorded_at,operation_id) where action='mark_read';
create unique index if not exists reminder_delivery_budget_uq on public.merchant_attendance_reminder_events(merchant_id,budget_key,ordinal) where action='delivery';
create unique index if not exists reminder_delivery_plan_uq on public.merchant_attendance_reminder_events(merchant_id,plan_id,ordinal) where action='delivery';
create index if not exists reminder_run_event_idx on public.merchant_attendance_reminder_events(merchant_id,run_operation_id,event_id) where run_operation_id is not null;

create or replace function public.faolla_attendance_reminder_id_v1(p jsonb)
returns uuid language sql immutable set search_path=pg_catalog as $$
 select (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
 from (select public.faolla_attendance_operational_rule_hash_v1(p) h) x;
$$;
create or replace function public.faolla_attendance_reminder_config_v1(p_source jsonb,p_category text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;v jsonb;c jsonb;
begin
 if p_category not in('open_session','pending_review','period_due') or p_source->>'sourceFingerprint' is distinct from public.faolla_attendance_operational_rule_hash_v1(public.faolla_attendance_operational_source_tuple_v1(p_source)) then raise exception 'attendance_reminder_invalid';end if;
 foreach k in array array['personal','group','enterprise'] loop
  v:=p_source->'layers'->k->'rules'->'reminders';
  if v->>'mode'='disabled' then return null;end if;
  if v->>'mode'='value' then
   c:=v->'value'->p_category;if c->>'mode'='disabled' then return null;end if;
   if public.faolla_attendance_operational_rule_object_v1(c,array['mode','afterMinutes','repeatMinutes','maxOccurrences']) is distinct from true or c->>'mode'<>'enabled'
    or public.faolla_attendance_operational_rule_scalar_v1(c->'afterMinutes','positive') is distinct from true or (c->>'afterMinutes')::bigint>44640
    or public.faolla_attendance_operational_rule_scalar_v1(c->'repeatMinutes','positive') is distinct from true or (c->>'repeatMinutes')::bigint not between 60 and 44640
    or public.faolla_attendance_operational_rule_scalar_v1(c->'maxOccurrences','positive') is distinct from true or (c->>'maxOccurrences')::bigint>10 then raise exception 'attendance_reminder_invalid';end if;
   return c;
  end if;
 end loop;return null;
end;
$$;
--Private resolver for a function-local source that has just passed the full
--193 saved-source or192 current-source validator. This is not an independent
--source validator, RPC, trusted flag, or cross-request memo. Keep the original
--config_v1 full-source boundary and its category/choice semantics unchanged.
create or replace function public.faolla_attendance_reminder_config_layers_v1(p_layers jsonb,p_category text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;v jsonb;c jsonb;
begin
 if p_category not in('open_session','pending_review','period_due') then raise exception 'attendance_reminder_invalid';end if;
 foreach k in array array['personal','group','enterprise'] loop
  v:=p_layers->k->'rules'->'reminders';
  if v->>'mode'='disabled' then return null;end if;
  if v->>'mode'='value' then
   c:=v->'value'->p_category;if c->>'mode'='disabled' then return null;end if;
   if public.faolla_attendance_operational_rule_object_v1(c,array['mode','afterMinutes','repeatMinutes','maxOccurrences']) is distinct from true or c->>'mode'<>'enabled'
    or public.faolla_attendance_operational_rule_scalar_v1(c->'afterMinutes','positive') is distinct from true or (c->>'afterMinutes')::bigint>44640
    or public.faolla_attendance_operational_rule_scalar_v1(c->'repeatMinutes','positive') is distinct from true or (c->>'repeatMinutes')::bigint not between 60 and 44640
    or public.faolla_attendance_operational_rule_scalar_v1(c->'maxOccurrences','positive') is distinct from true or (c->>'maxOccurrences')::bigint>10 then raise exception 'attendance_reminder_invalid';end if;
   return c;
  end if;
 end loop;return null;
end;
$$;
revoke all on function public.faolla_attendance_reminder_config_layers_v1(jsonb,text) from public,anon,authenticated,service_role;
create or replace function public.faolla_attendance_reminder_head_v1(p public.merchant_attendance_reminder_heads)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select case when p.plan_id is null then null else jsonb_build_object('planId',p.plan_id,'revision',p.revision,'lastEventId',p.last_event_id,'state',p.state,
 'deliveredCount',p.delivered_count,'lastDeliveredAt',public.faolla_attendance_operational_punch_stamp_v1(p.last_delivered_at),'nextDueAt',public.faolla_attendance_operational_punch_stamp_v1(p.next_due_at)) end;
$$;
create or replace function public.faolla_attendance_reminder_eligible_v1(p public.merchant_attendance_reminder_plans,p_at timestamptz)
returns text language plpgsql volatile set search_path=pg_catalog as $$
declare owner_id uuid;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
 a public.merchant_attendance_operational_consumer_activations%rowtype;ref jsonb;observed jsonb;source_value jsonb;sid uuid;ci public.merchant_attendance_cycle_intents%rowtype;ch public.merchant_attendance_cycle_frame_heads%rowtype;
begin
 select * into a from public.merchant_attendance_operational_consumer_activations where merchant_id=p.merchant_id and consumer='reminders' order by revision desc limit 1;
 if a.action is distinct from 'activate' or a.revision<>p.activation_revision then return 'stopped';end if;
 select user_id into owner_id from public.merchants where id=p.merchant_id;
 select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id for share;
 select * into e from public.merchant_enterprise_employees where merchant_id=p.merchant_id and id=p.employee_id for share;
 if w.id is null or e.id is null or w.employee_id is distinct from p.employee_id or e.auth_user_id is distinct from p.employee_auth_user_id then return 'handover_needed';end if;
 if p.category='open_session' then
  if not w.active or e.status<>'active' or exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=p.merchant_id and employee_id=e.id and paused) then return 'stopped';end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=p.merchant_id and id=e.role_id for share;
  if r.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true or not(r.permissions @> array['enterprise.view','attendance.self.view']) then return 'stopped';end if;
  sid:=public.faolla_attendance_operational_punch_current_start_v1(p.merchant_id,p.worker_id);
  if sid is distinct from p.source_id or public.faolla_attendance_administrative_boundary_v1(p.merchant_id,p.worker_id,p.source_id) is not null then return 'stopped';end if;
 elsif p.category='pending_review' then
  observed:=public.faolla_attendance_review_routing_observe_v1(p.merchant_id,p.target->>'family',p.source_id,p_at);
  if observed->>'status'<>'submitted' then return 'stopped';end if;
  select entry into ref from public.merchant_attendance_review_responsibility_entries where merchant_id=p.merchant_id and family=p.target->>'family' and operation_id=(p.target->>'responsibilityOperationId')::uuid;
  if not exists(select 1 from public.merchant_attendance_review_responsibility_heads h where h.merchant_id=p.merchant_id and h.family=p.target->>'family' and h.request_id=p.source_id and h.operation_id=(p.target->>'responsibilityOperationId')::uuid) then return 'stopped';end if;
  if observed->>'routeState'<>'assigned' or ref->'assignment' is distinct from p.recipient then return 'handover_needed';end if;
 elsif p.category='period_due' then
  select * into ci from public.merchant_attendance_cycle_intents where merchant_id=p.merchant_id and intent_id=p.source_id;
  select * into ch from public.merchant_attendance_cycle_frame_heads where merchant_id=p.merchant_id and worker_id=p.worker_id and frame_key=ci.frame_key;
  if ci.intent_id is null or ch.active_intent_id is distinct from ci.intent_id then return 'stopped';end if;
  begin perform public.faolla_attendance_cycle_authority_v1(p.merchant_id,ci.access,p.worker_id,ci.grant_id,ci.actor_auth_user_id,ci.from_date,ci.through_date,'send');
  exception when raise_exception then if sqlerrm in('attendance_access_denied','attendance_platform_paused') then return 'handover_needed';end if;raise;end;
 else raise exception 'attendance_reminder_invalid';end if;
 --Current source may stop, never enlarge, the saved plan. Invalid/ambiguous
 --source propagates: the entire run rolls back instead of inventing disabled.
 source_value:=public.faolla_attendance_operational_source_v1(p.merchant_id,p.worker_id,p.employee_id,p.employee_auth_user_id,p_at);
 if public.faolla_attendance_reminder_config_v1(source_value,p.category) is null then return 'stopped';end if;
 return 'active';
end;
$$;
--The runner reuses only a same-run rule/configuration check. All live source
--qualification remains per plan. Keep the original capture eligibility intact.
create or replace function public.faolla_attendance_reminder_qualify_v1(p public.merchant_attendance_reminder_plans,p_at timestamptz)
returns text language plpgsql volatile set search_path=pg_catalog as $$
declare owner_id uuid;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;
 a public.merchant_attendance_operational_consumer_activations%rowtype;ref jsonb;observed jsonb;source_value jsonb;sid uuid;ci public.merchant_attendance_cycle_intents%rowtype;ch public.merchant_attendance_cycle_frame_heads%rowtype;
begin
 select * into a from public.merchant_attendance_operational_consumer_activations where merchant_id=p.merchant_id and consumer='reminders' order by revision desc limit 1;
 if a.action is distinct from 'activate' or a.revision<>p.activation_revision then return 'stopped';end if;
 select user_id into owner_id from public.merchants where id=p.merchant_id;
 select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id for share;
 select * into e from public.merchant_enterprise_employees where merchant_id=p.merchant_id and id=p.employee_id for share;
 if w.id is null or e.id is null or w.employee_id is distinct from p.employee_id or e.auth_user_id is distinct from p.employee_auth_user_id then return 'handover_needed';end if;
 if p.category='open_session' then
  if not w.active or e.status<>'active' or exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=p.merchant_id and employee_id=e.id and paused) then return 'stopped';end if;
  select * into r from public.merchant_enterprise_roles where merchant_id=p.merchant_id and id=e.role_id for share;
  if r.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true or not(r.permissions @> array['enterprise.view','attendance.self.view']) then return 'stopped';end if;
  sid:=public.faolla_attendance_operational_punch_current_start_v1(p.merchant_id,p.worker_id);
  if sid is distinct from p.source_id or public.faolla_attendance_administrative_boundary_v1(p.merchant_id,p.worker_id,p.source_id) is not null then return 'stopped';end if;
 elsif p.category='pending_review' then
  observed:=public.faolla_attendance_review_routing_observe_v1(p.merchant_id,p.target->>'family',p.source_id,p_at);
  if observed->>'status'<>'submitted' then return 'stopped';end if;
  select entry into ref from public.merchant_attendance_review_responsibility_entries where merchant_id=p.merchant_id and family=p.target->>'family' and operation_id=(p.target->>'responsibilityOperationId')::uuid;
  if not exists(select 1 from public.merchant_attendance_review_responsibility_heads h where h.merchant_id=p.merchant_id and h.family=p.target->>'family' and h.request_id=p.source_id and h.operation_id=(p.target->>'responsibilityOperationId')::uuid) then return 'stopped';end if;
  if observed->>'routeState'<>'assigned' or ref->'assignment' is distinct from p.recipient then return 'handover_needed';end if;
 elsif p.category='period_due' then
  select * into ci from public.merchant_attendance_cycle_intents where merchant_id=p.merchant_id and intent_id=p.source_id;
  select * into ch from public.merchant_attendance_cycle_frame_heads where merchant_id=p.merchant_id and worker_id=p.worker_id and frame_key=ci.frame_key;
  if ci.intent_id is null or ch.active_intent_id is distinct from ci.intent_id then return 'stopped';end if;
  begin perform public.faolla_attendance_cycle_authority_v1(p.merchant_id,ci.access,p.worker_id,ci.grant_id,ci.actor_auth_user_id,ci.from_date,ci.through_date,'send');
  exception when raise_exception then if sqlerrm in('attendance_access_denied','attendance_platform_paused') then return 'handover_needed';end if;raise;end;
 else raise exception 'attendance_reminder_invalid';end if;
 return 'active';
end;
$$;
create or replace function public.faolla_attendance_reminder_advance_v1(p public.merchant_attendance_reminder_plans,p_action text,p_at timestamptz,p_state text,p_due timestamptz,p_batch uuid,p_item jsonb,p_operation uuid default null)
returns void language plpgsql volatile set search_path=pg_catalog as $$
declare h public.merchant_attendance_reminder_heads%rowtype;v public.merchant_attendance_reminder_heads%rowtype;old_value jsonb;ev uuid;
begin
 select * into h from public.merchant_attendance_reminder_heads where merchant_id=p.merchant_id and budget_key=p.budget_key for update;
 old_value:=public.faolla_attendance_reminder_head_v1(h);ev:=(case when p_action='register' then public.faolla_attendance_reminder_id_v1(jsonb_build_array('attendance-reminder-register-v1',p.merchant_id,p.plan_id)) else gen_random_uuid() end);
 v.merchant_id:=p.merchant_id;v.budget_key:=p.budget_key;v.plan_id:=p.plan_id;v.revision:=coalesce(h.revision,0)+1;v.last_event_id:=ev;v.state:=p_state;
 v.delivered_count:=coalesce(h.delivered_count,0)+(case when p_action='delivery' then 1 else 0 end);
 v.last_delivered_at:=(case when p_action='delivery' then p_at else h.last_delivered_at end);v.next_due_at:=p_due;
 if v.delivered_count>(p.configuration->>'maxOccurrences')::integer or p_action='delivery' and (p_item->>'ordinal')::integer<>v.delivered_count then raise exception 'attendance_reminder_invalid';end if;
 insert into public.merchant_attendance_reminder_events values(p.merchant_id,ev,p.budget_key,p.plan_id,v.revision,p_action,v.delivered_count,p_at,old_value,public.faolla_attendance_reminder_head_v1(v),p_batch,p_item,p_operation);
 if h.plan_id is null then insert into public.merchant_attendance_reminder_heads values(v.*);
 else update public.merchant_attendance_reminder_heads set plan_id=v.plan_id,revision=v.revision,last_event_id=v.last_event_id,state=v.state,delivered_count=v.delivered_count,last_delivered_at=v.last_delivered_at,next_due_at=v.next_due_at where merchant_id=p.merchant_id and budget_key=p.budget_key;end if;
end;
$$;
create or replace function public.faolla_attendance_reminder_capture_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare raw jsonb:=to_jsonb(new);site text:=raw->>'merchant_id';category_name text;sid uuid;version_value text;wid uuid;eid uuid;auth uuid;
 source_value jsonb;recipient_value jsonb;target_value jsonb;anchor timestamptz;at_value timestamptz;config_value jsonb;budget text;old_plan public.merchant_attendance_reminder_plans%rowtype;
 plan_value public.merchant_attendance_reminder_plans%rowtype;head public.merchant_attendance_reminder_heads%rowtype;a public.merchant_attendance_operational_consumer_activations%rowtype;
 rr public.merchant_attendance_review_responsibility_entries%rowtype;ci public.merchant_attendance_cycle_intents%rowtype;state_value text;due timestamptz;registered boolean;
begin
 if tg_when<>'AFTER' or tg_level<>'ROW' or tg_op not in('INSERT','UPDATE') then raise exception 'attendance_reminder_invalid';end if;
 select * into a from public.merchant_attendance_operational_consumer_activations where merchant_id=site and consumer='reminders' order by revision desc limit 1;
 if a.action is distinct from 'activate' then return new;end if;
 perform 1 from public.merchants where id=site for share;perform 1 from public.merchant_attendance_settings where merchant_id=site for update;
 if not found then raise exception 'attendance_reminder_invalid';end if;
 at_value:=clock_timestamp();
 if tg_table_name='merchant_attendance_operational_punch_sessions' then
  category_name:='open_session';sid:=(raw->>'start_event_id')::uuid;version_value:=raw->'session'->>'sessionFingerprint';
  wid:=(raw->>'worker_id')::uuid;eid:=(raw->>'employee_id')::uuid;auth:=(raw->>'employee_auth_user_id')::uuid;
  source_value:=public.faolla_attendance_operational_punch_saved_source_v1(raw->'source_ref');anchor:=(raw->'session'->>'occurredAt')::timestamptz;
  recipient_value:=jsonb_build_object('kind','self','workerId',wid,'employeeId',eid,'authUserId',auth);
  target_value:=jsonb_build_object('kind',category_name,'workerId',wid,'startEventId',sid);
 elsif tg_table_name='merchant_attendance_review_responsibility_heads' then
  category_name:='pending_review';sid:=(raw->>'request_id')::uuid;
  select * into rr from public.merchant_attendance_review_responsibility_entries where merchant_id=site and family=raw->>'family' and operation_id=(raw->>'operation_id')::uuid;
  perform public.faolla_attendance_review_routing_entry_v1(rr);recipient_value:=rr.entry->'assignment';
  if recipient_value->>'kind'='needs_assignment' then return new;end if;
  version_value:=rr.entry->>'entryFingerprint';wid:=rr.worker_id;eid:=rr.employee_id;auth:=rr.employee_auth_user_id;anchor:=(rr.request_ref->>'submittedAt')::timestamptz;
  target_value:=jsonb_build_object('kind',category_name,'family',rr.family,'requestId',sid,'responsibilityRevision',rr.revision,'responsibilityOperationId',rr.operation_id);
  source_value:=(case when rr.source_ref is null then public.faolla_attendance_operational_source_v1(site,wid,eid,auth,at_value) else public.faolla_attendance_operational_punch_saved_source_v1(rr.source_ref) end);
 elsif tg_table_name='merchant_attendance_cycle_operations' then
  category_name:='period_due';sid:=(raw->>'intent_id')::uuid;
  if raw->>'action'<>'accept' then
   select * into plan_value from public.merchant_attendance_reminder_plans where merchant_id=site and category='period_due' and source_id=sid limit 1;
   if plan_value.plan_id is not null then select * into head from public.merchant_attendance_reminder_heads where merchant_id=site and budget_key=plan_value.budget_key;
    if head.state='active' then perform public.faolla_attendance_reminder_advance_v1(plan_value,'stop',at_value,'stopped',null,null,null);end if;end if;return new;
  end if;
  select * into ci from public.merchant_attendance_cycle_intents where merchant_id=site and intent_id=sid;perform public.faolla_attendance_cycle_intent_v1(ci);
  version_value:=ci.intent_fingerprint;wid:=ci.worker_id;eid:=ci.employee_id;auth:=ci.employee_auth_user_id;anchor:=ci.due_at;
  recipient_value:=(case when ci.access='owner' then jsonb_build_object('kind','owner','authUserId',ci.actor_auth_user_id)
   else jsonb_build_object('kind','delegate','authUserId',ci.actor_auth_user_id,'grantId',ci.grant_id) end);
  target_value:=jsonb_build_object('kind',category_name,'workerId',wid,'intentId',sid);source_value:=public.faolla_attendance_operational_punch_saved_source_v1(ci.source_ref);
 else raise exception 'attendance_reminder_invalid';end if;
 --A new route is a new immutable recipient plan, not a new source budget.
 budget:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-budget-v1',site,category_name,sid,(case when category_name='pending_review' then jsonb_build_array(raw->>'family',rr.request_ref->'submittedRevision') else null end)));
 --Settings serializes registration; qualify old authority before locking a new
 --head, preserving merchant/settings/worker/role/head lock order.
 select * into head from public.merchant_attendance_reminder_heads where merchant_id=site and budget_key=budget;
 if head.plan_id is not null then
  select * into old_plan from public.merchant_attendance_reminder_plans where merchant_id=site and plan_id=head.plan_id;
  if category_name<>'pending_review' then raise exception 'attendance_reminder_invalid';end if;
  if head.state='stopped' or old_plan.activation_revision<>a.revision then return new;end if;
  config_value:=old_plan.configuration;source_value:=public.faolla_attendance_operational_punch_saved_source_v1(old_plan.source_ref);anchor:=old_plan.anchor_at;
 else config_value:=public.faolla_attendance_reminder_config_layers_v1(source_value->'layers',category_name);end if;
 if config_value is null then return new;end if;
 plan_value.merchant_id:=site;plan_value.plan_id:=public.faolla_attendance_reminder_id_v1(jsonb_build_array('attendance-reminder-plan-v1',site,category_name,sid,version_value));
 plan_value.budget_key:=budget;plan_value.category:=category_name;plan_value.worker_id:=wid;plan_value.employee_id:=eid;plan_value.employee_auth_user_id:=auth;
 plan_value.source_id:=sid;plan_value.source_version:=version_value;plan_value.target:=target_value;plan_value.source_ref:=public.faolla_attendance_operational_punch_source_ref_v1(source_value);
 plan_value.recipient:=recipient_value;plan_value.recipient_key:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-recipient-v1',recipient_value));
 plan_value.configuration:=config_value;plan_value.anchor_at:=anchor;plan_value.activation_revision:=a.revision;plan_value.recorded_at:=at_value;
 plan_value.plan_fingerprint:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-plan-proof-v1',site,plan_value.plan_id,budget,category_name,wid,eid,auth,sid,version_value,target_value,source_value->'sourceFingerprint',recipient_value,config_value,public.faolla_attendance_operational_punch_stamp_v1(anchor),a.revision,public.faolla_attendance_operational_punch_stamp_v1(at_value)));
 if exists(select 1 from public.merchant_attendance_reminder_plans where merchant_id=site and plan_id=plan_value.plan_id) then return new;end if;
 state_value:=public.faolla_attendance_reminder_eligible_v1(plan_value,at_value);
 if coalesce(head.delivered_count,0)>=(config_value->>'maxOccurrences')::integer then state_value:='stopped';end if;
 due:=greatest(anchor+make_interval(mins=>(config_value->>'afterMinutes')::integer+coalesce(head.delivered_count,0)*(config_value->>'repeatMinutes')::integer),head.last_delivered_at+make_interval(mins=>(config_value->>'repeatMinutes')::integer));
 --Capture may itself run while SET CONSTRAINTS is flushing deferred source
 --facts in IMMEDIATE mode. Complete the real registration in this INSERT's
 --RETURNING expression before its AFTER proof checks the paired event/head.
 --Do not change constraint modes or accept a plan without its register event.
 insert into public.merchant_attendance_reminder_plans values(plan_value.*)
 returning public.faolla_attendance_reminder_advance_v1(merchant_attendance_reminder_plans,'register',at_value,state_value,(case when state_value='active' then due else null end),null,null) is null into registered;
 return new;
end;
$$;

-- BEGIN REMINDER EXECUTION
create or replace function public.faolla_attendance_reminder_command_v1(p_site text,p_kind text,p_actor uuid,p_command jsonb)
returns text language plpgsql stable set search_path=pg_catalog as $$
declare t jsonb;c jsonb;
begin
 if p_kind not in('auth','system') or (p_kind='system')<>(p_actor is null) or public.faolla_attendance_operational_rule_scalar_v1(p_command->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if p_command->>'action'='mark_read' then
  if p_kind<>'auth' or public.faolla_attendance_operational_rule_object_v1(p_command,array['action','operationId','batchId']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p_command->'batchId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  t:=jsonb_build_array('mark_read',p_command->'operationId',p_command->'batchId');
 elsif p_command->>'action'='run_due' then
  if public.faolla_attendance_operational_rule_object_v1(p_command,array['action','operationId','cursor']) is distinct from true then raise exception 'attendance_invalid_request';end if;
  c:=p_command->'cursor';
  if c<>'null'::jsonb then
   if public.faolla_attendance_operational_rule_object_v1(c,array['runOperationId','afterDueAt','afterPlanId','cutoffAt']) is distinct from true
    or public.faolla_attendance_operational_rule_scalar_v1(c->'runOperationId','uuid') is distinct from true
    or public.faolla_attendance_operational_rule_scalar_v1(c->'afterPlanId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
   perform public.faolla_attendance_operational_source_stamp_v1(c->>'afterDueAt');perform public.faolla_attendance_operational_source_stamp_v1(c->>'cutoffAt');
   if (c->>'afterDueAt')::timestamptz>(c->>'cutoffAt')::timestamptz then raise exception 'attendance_invalid_request';end if;
   c:=jsonb_build_array(c->'runOperationId',c->'afterDueAt',c->'afterPlanId',c->'cutoffAt');
  end if;t:=jsonb_build_array('run_due',p_command->'operationId',c);
 else raise exception 'attendance_invalid_request';end if;
 return public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-command-v1',p_site,p_kind,p_actor,t));
end;
$$;
create or replace function public.faolla_attendance_reminder_receipt_v1(p public.merchant_attendance_reminder_operations)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select case when p.operation_id is null then null else jsonb_build_object('operationId',p.operation_id,'action',p.action,'actorKind',p.actor_kind,'actorId',p.actor_id,
 'commandFingerprint',p.command_fingerprint,'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at),'result',p.result) end;
$$;
create or replace function public.faolla_attendance_reminder_run_v1(p_site text,p_kind text,p_actor uuid,p_command jsonb,p_allow boolean)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare fingerprint text;opid uuid;c jsonb;prior public.merchant_attendance_reminder_operations%rowtype;op public.merchant_attendance_reminder_operations%rowtype;
 stamp timestamptz;cutoff timestamptz;ws timestamptz;we timestamptz;owner_id uuid;enabled boolean;a public.merchant_attendance_operational_consumer_activations%rowtype;
 h public.merchant_attendance_reminder_heads%rowtype;plan_value public.merchant_attendance_reminder_plans%rowtype;row_value jsonb;selected jsonb:='[]';ready jsonb:='[]';group_value record;
 eligibility text;item jsonb;items jsonb;batch uuid;batch_ids jsonb:='[]';next_cursor jsonb;last_due timestamptz;last_plan uuid;due timestamptz;
 current_checks jsonb:='{}';current_key text;current_source jsonb;current_enabled boolean;
 checked integer:=0;delivered integer:=0;deferred integer:=0;stopped integer:=0;ordinal_value integer;result_value jsonb;sentinel boolean:=false;
begin
 fingerprint:=public.faolla_attendance_reminder_command_v1(p_site,p_kind,p_actor,p_command);opid:=(p_command->>'operationId')::uuid;
 if p_command->>'action'<>'run_due' or p_allow is null then raise exception 'attendance_invalid_request';end if;
 select * into op from public.merchant_attendance_reminder_operations where merchant_id=p_site and operation_id=opid;
 if op.operation_id is not null then
  if op.actor_kind<>p_kind or op.actor_id is distinct from p_actor or op.command is distinct from p_command or op.command_fingerprint<>fingerprint then raise exception 'attendance_operation_conflict';end if;
  return public.faolla_attendance_reminder_receipt_v1(op);
 end if;
 select user_id into owner_id from public.merchants where id=p_site for share;
 if owner_id is null or p_kind='auth' and owner_id<>p_actor then raise exception 'attendance_access_denied';end if;
 select s.enabled into enabled from public.merchant_attendance_settings s where s.merchant_id=p_site for update;if not found then raise exception 'attendance_settings_required';end if;
 --Recheck after waiting for the serialization lock. Another process may have
 --committed this exact operation; never turn its retry into a new run.
 select * into op from public.merchant_attendance_reminder_operations where merchant_id=p_site and operation_id=opid;
 if op.operation_id is not null then
  if op.actor_kind<>p_kind or op.actor_id is distinct from p_actor or op.command is distinct from p_command or op.command_fingerprint<>fingerprint then raise exception 'attendance_operation_conflict';end if;
  return public.faolla_attendance_reminder_receipt_v1(op);
 end if;
 stamp:=clock_timestamp();cutoff:=stamp;c:=p_command->'cursor';
 if c<>'null'::jsonb then
  select * into prior from public.merchant_attendance_reminder_operations where merchant_id=p_site and operation_id=(c->>'runOperationId')::uuid;
  if prior.action is distinct from 'run_due' or prior.actor_kind is distinct from p_kind or prior.actor_id is distinct from p_actor or prior.result->'nextCursor' is distinct from c then raise exception 'attendance_invalid_request';end if;
  cutoff:=(c->>'cutoffAt')::timestamptz;if cutoff>stamp then raise exception 'attendance_invalid_request';end if;
 end if;
 select * into a from public.merchant_attendance_operational_consumer_activations where merchant_id=p_site and consumer='reminders' order by revision desc limit 1;
 if p_allow and enabled and a.action='activate' then
  ws:=date_trunc('hour',stamp at time zone 'UTC') at time zone 'UTC';we:=ws+interval '1 hour';
  --Read the bounded candidate positions before any new head locks. Every
  --source writer shares the settings lock, so source qualification is stable.
  for h in select x.* from public.merchant_attendance_reminder_heads x where x.merchant_id=p_site and x.state='active' and x.next_due_at<=cutoff
   and (c='null'::jsonb or (x.next_due_at,x.plan_id)>((c->>'afterDueAt')::timestamptz,(c->>'afterPlanId')::uuid))
   order by x.next_due_at,x.plan_id limit 26 loop
   if checked=25 then sentinel:=true;exit;end if;checked:=checked+1;last_due:=h.next_due_at;last_plan:=h.plan_id;
   selected:=selected||jsonb_build_array(jsonb_build_object('planId',h.plan_id,'budgetKey',h.budget_key,'dueAt',public.faolla_attendance_operational_punch_stamp_v1(h.next_due_at)));
  end loop;
  --Fixed worker order avoids new-head→old-worker/role lock inversion.
  perform 1 from public.merchant_attendance_workers w where w.merchant_id=p_site and w.id in(select p.worker_id from public.merchant_attendance_reminder_plans p join jsonb_array_elements(selected) x on p.plan_id=(x->>'planId')::uuid where p.merchant_id=p_site) order by w.id for share;
  for row_value in select value from jsonb_array_elements(selected) order by value->>'planId' loop
   select * into plan_value from public.merchant_attendance_reminder_plans where merchant_id=p_site and plan_id=(row_value->>'planId')::uuid;
   eligibility:=public.faolla_attendance_reminder_qualify_v1(plan_value,stamp);
   if eligibility='active' then
    --Settings UPDATE and the fixed stamp serialize this rule-source snapshot.
    --Cache no live authority, request state, recipient, budget or saved rule.
    --The complete identity/category key is exact JSON text, not a hash alone.
    current_key:=jsonb_build_array(p_site,plan_value.worker_id,plan_value.employee_id,plan_value.employee_auth_user_id,plan_value.category)::text;
    if current_checks ? current_key then current_enabled:=(current_checks->>current_key)::boolean;
    else
     current_source:=public.faolla_attendance_operational_source_v1(p_site,plan_value.worker_id,plan_value.employee_id,plan_value.employee_auth_user_id,stamp);
     current_enabled:=public.faolla_attendance_reminder_config_layers_v1(current_source->'layers',plan_value.category) is not null;
     current_checks:=jsonb_set(current_checks,array[current_key],to_jsonb(current_enabled));
    end if;
    if not current_enabled then eligibility:='stopped';end if;
   end if;
   select * into h from public.merchant_attendance_reminder_heads where merchant_id=p_site and budget_key=plan_value.budget_key for update;
   if h.plan_id<>plan_value.plan_id or h.state<>'active' or h.next_due_at>(row_value->>'dueAt')::timestamptz then raise exception 'attendance_reminder_changed';end if;
   if eligibility<>'active' then perform public.faolla_attendance_reminder_advance_v1(plan_value,'stop',stamp,eligibility,null,null,null,opid);stopped:=stopped+1;continue;end if;
   if exists(select 1 from public.merchant_attendance_reminder_batches b where b.merchant_id=p_site and b.recipient_key=plan_value.recipient_key and b.category=plan_value.category and b.window_start=ws) then
    perform public.faolla_attendance_reminder_advance_v1(plan_value,'defer',stamp,'active',we,null,null,opid);deferred:=deferred+1;continue;
   end if;
   ordinal_value:=h.delivered_count+1;if ordinal_value>(plan_value.configuration->>'maxOccurrences')::integer then raise exception 'attendance_reminder_invalid';end if;
   ready:=ready||jsonb_build_array(jsonb_build_object('planId',plan_value.plan_id,'recipientKey',plan_value.recipient_key,'category',plan_value.category,
    'ordinal',ordinal_value,'target',plan_value.target,'observedAt',public.faolla_attendance_operational_punch_stamp_v1(stamp)));
  end loop;
  for group_value in select x->>'recipientKey' rk,x->>'category' cat from jsonb_array_elements(ready) x group by x->>'recipientKey',x->>'category' order by x->>'recipientKey',x->>'category' loop
   select * into plan_value from public.merchant_attendance_reminder_plans where merchant_id=p_site and plan_id=(select (x->>'planId')::uuid from jsonb_array_elements(ready) x where x->>'recipientKey'=group_value.rk and x->>'category'=group_value.cat limit 1);
   select jsonb_agg(x-'recipientKey'-'category' order by x->>'planId') into items from jsonb_array_elements(ready) x where x->>'recipientKey'=group_value.rk and x->>'category'=group_value.cat;
   batch:=gen_random_uuid();
   insert into public.merchant_attendance_reminder_batches values(p_site,batch,group_value.cat,plan_value.recipient,group_value.rk,(plan_value.recipient->>'authUserId')::uuid,ws,we,stamp,items,
    public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-batch-v1',p_site,batch,group_value.cat,plan_value.recipient,public.faolla_attendance_operational_punch_stamp_v1(ws),public.faolla_attendance_operational_punch_stamp_v1(we),public.faolla_attendance_operational_punch_stamp_v1(stamp),items)));
   batch_ids:=batch_ids||jsonb_build_array(batch);
   for item in select value from jsonb_array_elements(items) loop
    select * into plan_value from public.merchant_attendance_reminder_plans where merchant_id=p_site and plan_id=(item->>'planId')::uuid;
    ordinal_value:=(item->>'ordinal')::integer;
    due:=greatest(plan_value.anchor_at+make_interval(mins=>(plan_value.configuration->>'afterMinutes')::integer+ordinal_value*(plan_value.configuration->>'repeatMinutes')::integer),stamp+make_interval(mins=>(plan_value.configuration->>'repeatMinutes')::integer));
    perform public.faolla_attendance_reminder_advance_v1(plan_value,'delivery',stamp,(case when ordinal_value=(plan_value.configuration->>'maxOccurrences')::integer then 'stopped' else 'active' end),
     (case when ordinal_value=(plan_value.configuration->>'maxOccurrences')::integer then null else due end),batch,item,opid);delivered:=delivered+1;
   end loop;
  end loop;
  if sentinel then next_cursor:=jsonb_build_object('runOperationId',opid,'afterDueAt',public.faolla_attendance_operational_punch_stamp_v1(last_due),'afterPlanId',last_plan,'cutoffAt',public.faolla_attendance_operational_punch_stamp_v1(cutoff));end if;
 end if;
 result_value:=jsonb_build_object('kind','run','status',(case when p_allow and enabled and a.action='activate' then 'completed' else 'disabled' end),
  'checkedCount',checked,'deliveredCount',delivered,'deferredCount',deferred,'stoppedCount',stopped,'batchIds',batch_ids,'nextCursor',next_cursor);
 insert into public.merchant_attendance_reminder_operations values(p_site,opid,'run_due',p_kind,p_actor,p_command,fingerprint,stamp,result_value,null) returning * into op;
 return public.faolla_attendance_reminder_receipt_v1(op);
end;
$$;
create or replace function public.faolla_attendance_reminder_recipient_v1(p public.merchant_attendance_reminder_batches,p_actor uuid)
returns void language plpgsql volatile set search_path=pg_catalog as $$
declare item jsonb;plan_value public.merchant_attendance_reminder_plans%rowtype;owner_id uuid;qualified jsonb;ci public.merchant_attendance_cycle_intents%rowtype;
begin
 if p.batch_id is null or p.recipient->>'authUserId' is distinct from p_actor::text then raise exception 'attendance_access_denied';end if;
 select user_id into owner_id from public.merchants where id=p.merchant_id for share;
 if p.recipient->>'kind'='owner' and owner_id is distinct from p_actor then raise exception 'attendance_access_denied';end if;
 perform 1 from public.merchant_attendance_settings where merchant_id=p.merchant_id for share;
 --No source body is disclosed. Revalidate each bounded saved recipient route;
 --the approval/navigation target still requires its own fresh business GET.
 for item in select value from jsonb_array_elements(p.items) order by value->>'planId' loop
  select * into plan_value from public.merchant_attendance_reminder_plans where merchant_id=p.merchant_id and plan_id=(item->>'planId')::uuid;
  if plan_value.recipient is distinct from p.recipient then raise exception 'attendance_reminder_invalid';end if;
  if p.recipient->>'kind'='self' then
   perform 1 from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
    join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id where w.merchant_id=p.merchant_id and w.id=plan_value.worker_id and w.active and e.id=plan_value.employee_id and e.auth_user_id=p_actor
    and e.status='active' and r.status='active' and public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) and r.permissions @> array['enterprise.view','attendance.self.view']
    and not exists(select 1 from public.merchant_attendance_account_epochs ep where ep.merchant_id=e.merchant_id and ep.employee_id=e.id and ep.paused) for share of w,e,r;
   if not found then raise exception 'attendance_access_denied';end if;
  elsif p.recipient->>'kind'='delegate' then
   if p.category='pending_review' then
    qualified:=public.faolla_attendance_review_routing_qualify_v1(p.merchant_id,plan_value.target->>'family',plan_value.source_id,(p.recipient->>'grantId')::uuid,clock_timestamp());
    if qualified->'usable' is distinct from 'true'::jsonb or qualified->'assignment' is distinct from p.recipient then raise exception 'attendance_access_denied';end if;
   elsif p.category='period_due' then
    select * into ci from public.merchant_attendance_cycle_intents where merchant_id=p.merchant_id and intent_id=plan_value.source_id;
    perform public.faolla_attendance_cycle_authority_v1(p.merchant_id,'delegate',ci.worker_id,ci.grant_id,p_actor,ci.from_date,ci.through_date,'view');
   else raise exception 'attendance_reminder_invalid';end if;
  elsif p.recipient->>'kind'<>'owner' then raise exception 'attendance_reminder_invalid';end if;
 end loop;
end;
$$;
create or replace function public.faolla_attendance_reminder_batch_v1(p public.merchant_attendance_reminder_batches,p_actor uuid,p_detail boolean)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare read_at_value timestamptz;v jsonb;
begin
 perform public.faolla_attendance_reminder_recipient_v1(p,p_actor);
 select recorded_at into read_at_value from public.merchant_attendance_reminder_operations where merchant_id=p.merchant_id and batch_id=p.batch_id and actor_id=p_actor and action='mark_read' order by recorded_at,operation_id limit 1;
 v:=jsonb_build_object('batchId',p.batch_id,'category',p.category,'windowStart',public.faolla_attendance_operational_punch_stamp_v1(p.window_start),
  'windowEnd',public.faolla_attendance_operational_punch_stamp_v1(p.window_end),'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at),'itemCount',jsonb_array_length(p.items),'readAt',public.faolla_attendance_operational_punch_stamp_v1(read_at_value));
 if p_detail then v:=v||jsonb_build_object('items',p.items);end if;return v;
end;
$$;
create or replace function public.faolla_attendance_reminders_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text:=p_query->>'siteId';mode_name text:=p_query->>'mode';batch_id_value uuid;opid uuid;stamp timestamptz;fp text;data_value jsonb;receipt_value jsonb;
 op public.merchant_attendance_reminder_operations%rowtype;b public.merchant_attendance_reminder_batches%rowtype;c jsonb:=p_query->'cursor';items jsonb:='[]';cursor_value jsonb;last_cursor jsonb;n integer:=0;first_read timestamptz;
begin
 if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','batchId','operationId','cursor']) is distinct from true
  or public.faolla_attendance_application_window_scalar_v1(p_query->'siteId','site') is distinct from true or mode_name not in('list','detail','recover','check') then raise exception 'attendance_invalid_request';end if;
 if octet_length(convert_to(jsonb_build_object('query',p_query,'command',p_command)::text,'UTF8'))>8192 then raise exception 'attendance_invalid_request';end if;
 if mode_name='detail' then
  if public.faolla_attendance_operational_rule_scalar_v1(p_query->'batchId','uuid') is distinct from true or p_query->'operationId'<>'null'::jsonb or c<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  batch_id_value:=(p_query->>'batchId')::uuid;
 elsif mode_name='recover' then
  if p_command is not null or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true or p_query->'batchId'<>'null'::jsonb or c<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  opid:=(p_query->>'operationId')::uuid;
 else
  if p_query->'batchId'<>'null'::jsonb or p_query->'operationId'<>'null'::jsonb or mode_name='check' and c<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if c<>'null'::jsonb then
   if public.faolla_attendance_operational_rule_object_v1(c,array['beforeAt','beforeId']) is distinct from true or public.faolla_attendance_operational_rule_scalar_v1(c->'beforeId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;perform public.faolla_attendance_operational_source_stamp_v1(c->>'beforeAt');
  end if;
 end if;
 if p_command is not null then
  fp:=public.faolla_attendance_reminder_command_v1(site,'auth',p_auth_user_id,p_command);opid:=(p_command->>'operationId')::uuid;
  if (p_command->>'action'='mark_read' and (mode_name<>'detail' or p_command->>'batchId' is distinct from batch_id_value::text)) or (p_command->>'action'='run_due' and mode_name<>'check') then raise exception 'attendance_invalid_request';end if;
 end if;
 if opid is not null then
  select * into op from public.merchant_attendance_reminder_operations where merchant_id=site and operation_id=opid;
  if op.operation_id is not null then
   if op.actor_kind<>'auth' or op.actor_id<>p_auth_user_id then if p_command is not null then raise exception 'attendance_operation_conflict';end if;op:=null;
   elsif p_command is not null and (op.command is distinct from p_command or op.command_fingerprint<>fp) then raise exception 'attendance_operation_conflict';end if;
  end if;
  if mode_name='recover' or op.operation_id is not null then data_value:=jsonb_build_object('kind','receipt');receipt_value:=public.faolla_attendance_reminder_receipt_v1(op);end if;
 end if;
 if data_value is null then
  perform 1 from public.merchants where id=site for share;if not found then raise exception 'attendance_access_denied';end if;
  if p_command is null then perform 1 from public.merchant_attendance_settings where merchant_id=site for share;
  else perform 1 from public.merchant_attendance_settings where merchant_id=site for update;end if;
  if not found then raise exception 'attendance_settings_required';end if;
  --The original may have committed while this call waited on settings. Check
  --its exact actor/command again BEFORE current recipient/allow gates.
  if p_command is not null then
   select * into op from public.merchant_attendance_reminder_operations where merchant_id=site and operation_id=opid;
   if op.operation_id is not null then
    if op.actor_kind<>'auth' or op.actor_id<>p_auth_user_id or op.command is distinct from p_command or op.command_fingerprint<>fp then raise exception 'attendance_operation_conflict';end if;
    data_value:=jsonb_build_object('kind','receipt');receipt_value:=public.faolla_attendance_reminder_receipt_v1(op);
   end if;
  end if;
  if data_value is not null then null;
  elsif mode_name='check' then
   if not exists(select 1 from public.merchants where id=site and user_id=p_auth_user_id) then raise exception 'attendance_access_denied';end if;
   data_value:=jsonb_build_object('kind','receipt');if p_command is not null then receipt_value:=public.faolla_attendance_reminder_run_v1(site,'auth',p_auth_user_id,p_command,p_allow_write);end if;
  elsif mode_name='detail' then
   select * into b from public.merchant_attendance_reminder_batches where merchant_id=site and batch_id=batch_id_value;perform public.faolla_attendance_reminder_recipient_v1(b,p_auth_user_id);
   if p_command is null then data_value:=jsonb_build_object('kind','batch','batch',public.faolla_attendance_reminder_batch_v1(b,p_auth_user_id,true));
   else
    if not p_allow_write then raise exception 'attendance_reminder_disabled';end if;stamp:=clock_timestamp();
    select * into op from public.merchant_attendance_reminder_operations where merchant_id=site and operation_id=opid;
    if op.operation_id is not null then
     if op.actor_kind<>'auth' or op.actor_id<>p_auth_user_id or op.command is distinct from p_command or op.command_fingerprint<>fp then raise exception 'attendance_operation_conflict';end if;
    else
     select recorded_at into first_read from public.merchant_attendance_reminder_operations where merchant_id=site and batch_id=batch_id_value and actor_id=p_auth_user_id and action='mark_read' order by recorded_at,operation_id limit 1;
     first_read:=coalesce(first_read,stamp);insert into public.merchant_attendance_reminder_operations values(site,opid,'mark_read','auth',p_auth_user_id,p_command,fp,stamp,jsonb_build_object('kind','mark_read','batchId',batch_id_value,'readAt',public.faolla_attendance_operational_punch_stamp_v1(first_read)),batch_id_value) returning * into op;
    end if;data_value:=jsonb_build_object('kind','receipt');receipt_value:=public.faolla_attendance_reminder_receipt_v1(op);
   end if;
  else
   if p_command is not null then raise exception 'attendance_invalid_request';end if;
   for b in select x.* from public.merchant_attendance_reminder_batches x where x.merchant_id=site and x.recipient_auth_user_id=p_auth_user_id
    and (c='null'::jsonb or (x.recorded_at,x.batch_id)<((c->>'beforeAt')::timestamptz,(c->>'beforeId')::uuid)) order by x.recorded_at desc,x.batch_id desc limit 26 loop
    n:=n+1;if n=26 then cursor_value:=last_cursor;exit;end if;
    items:=items||jsonb_build_array(public.faolla_attendance_reminder_batch_v1(b,p_auth_user_id,false));last_cursor:=jsonb_build_object('beforeAt',public.faolla_attendance_operational_punch_stamp_v1(b.recorded_at),'beforeId',b.batch_id);
   end loop;data_value:=jsonb_build_object('kind','list','items',items,'nextCursor',cursor_value);
  end if;
 end if;
 data_value:=jsonb_build_object('protocol','attendance-reminders-v1','siteId',site,'actor',jsonb_build_object('kind','auth','authUserId',p_auth_user_id),'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'data',data_value,'receipt',receipt_value);
 if octet_length(convert_to(data_value::text,'UTF8'))>131072 then raise exception 'attendance_reminder_too_large';end if;return data_value;
end;
$$;
create or replace function public.faolla_attendance_reminders_run_v1(p_query jsonb,p_allow_run boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text:=p_query->>'siteId';mode_name text:=p_query->>'mode';op public.merchant_attendance_reminder_operations%rowtype;receipt_value jsonb;c jsonb;
begin
 if p_allow_run is null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','operationId','cursor']) is distinct from true or public.faolla_attendance_application_window_scalar_v1(p_query->'siteId','site') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true or mode_name not in('run','recover') or octet_length(convert_to(p_query::text,'UTF8'))>8192 then raise exception 'attendance_invalid_request';end if;
 if mode_name='recover' then
  if p_query->'cursor'<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  select * into op from public.merchant_attendance_reminder_operations where merchant_id=site and operation_id=(p_query->>'operationId')::uuid and actor_kind='system';receipt_value:=public.faolla_attendance_reminder_receipt_v1(op);
 else
  c:=jsonb_build_object('action','run_due','operationId',p_query->'operationId','cursor',p_query->'cursor');receipt_value:=public.faolla_attendance_reminder_run_v1(site,'system',null,c,p_allow_run);
 end if;
 return jsonb_build_object('protocol','attendance-reminders-v1','siteId',site,'actor',jsonb_build_object('kind','system'),'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'data',jsonb_build_object('kind','receipt'),'receipt',receipt_value);
end;
$$;
-- END REMINDER EXECUTION
create or replace function public.faolla_attendance_reminder_plan_proof_v1(p public.merchant_attendance_reminder_plans)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare s jsonb;rr public.merchant_attendance_review_responsibility_entries%rowtype;ci public.merchant_attendance_cycle_intents%rowtype;ps public.merchant_attendance_operational_punch_sessions%rowtype;budget text;target_value jsonb;recipient_value jsonb;
begin
 s:=public.faolla_attendance_operational_punch_saved_source_v1(p.source_ref);
 if s->>'siteId' is distinct from p.merchant_id or s->'workerIdentity'->>'workerId' is distinct from p.worker_id::text or s->'workerIdentity'->>'employeeId' is distinct from p.employee_id::text or s->'workerIdentity'->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
  or p.configuration is distinct from public.faolla_attendance_reminder_config_layers_v1(s->'layers',p.category) then raise exception 'attendance_reminder_invalid';end if;
 if p.category='open_session' then
  select * into ps from public.merchant_attendance_operational_punch_sessions where merchant_id=p.merchant_id and start_event_id=p.source_id;
  target_value:=jsonb_build_object('kind',p.category,'workerId',p.worker_id,'startEventId',p.source_id);
  recipient_value:=jsonb_build_object('kind','self','workerId',p.worker_id,'employeeId',p.employee_id,'authUserId',p.employee_auth_user_id);
  if ps.start_event_id is null or ps.worker_id<>p.worker_id or ps.employee_id<>p.employee_id or ps.employee_auth_user_id<>p.employee_auth_user_id or ps.session->>'sessionFingerprint' is distinct from p.source_version
   or ps.source_ref is distinct from p.source_ref or (ps.session->>'occurredAt')::timestamptz is distinct from p.anchor_at then raise exception 'attendance_reminder_invalid';end if;
  budget:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-budget-v1',p.merchant_id,p.category,p.source_id,null));
 elsif p.category='pending_review' then
  select * into rr from public.merchant_attendance_review_responsibility_entries where merchant_id=p.merchant_id and family=p.target->>'family' and operation_id=(p.target->>'responsibilityOperationId')::uuid;
  perform public.faolla_attendance_review_routing_entry_v1(rr);
  target_value:=jsonb_build_object('kind',p.category,'family',rr.family,'requestId',rr.request_id,'responsibilityRevision',rr.revision,'responsibilityOperationId',rr.operation_id);recipient_value:=rr.entry->'assignment';
  if rr.request_id<>p.source_id or rr.worker_id<>p.worker_id or rr.employee_id<>p.employee_id or rr.employee_auth_user_id<>p.employee_auth_user_id or rr.entry->>'entryFingerprint' is distinct from p.source_version
   or (rr.request_ref->>'submittedAt')::timestamptz is distinct from p.anchor_at or recipient_value->>'kind' not in('owner','delegate') then raise exception 'attendance_reminder_invalid';end if;
  budget:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-budget-v1',p.merchant_id,p.category,p.source_id,jsonb_build_array(rr.family,rr.request_ref->'submittedRevision')));
 elsif p.category='period_due' then
  select * into ci from public.merchant_attendance_cycle_intents where merchant_id=p.merchant_id and intent_id=p.source_id;perform public.faolla_attendance_cycle_intent_v1(ci);
  target_value:=jsonb_build_object('kind',p.category,'workerId',p.worker_id,'intentId',p.source_id);
  recipient_value:=(case when ci.access='owner' then jsonb_build_object('kind','owner','authUserId',ci.actor_auth_user_id) else jsonb_build_object('kind','delegate','authUserId',ci.actor_auth_user_id,'grantId',ci.grant_id) end);
  if ci.worker_id<>p.worker_id or ci.employee_id<>p.employee_id or ci.employee_auth_user_id<>p.employee_auth_user_id or ci.intent_fingerprint<>p.source_version or ci.source_ref is distinct from p.source_ref or ci.due_at is distinct from p.anchor_at then raise exception 'attendance_reminder_invalid';end if;
  budget:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-budget-v1',p.merchant_id,p.category,p.source_id,null));
 else raise exception 'attendance_reminder_invalid';end if;
 if p.target is distinct from target_value or p.recipient is distinct from recipient_value or p.budget_key is distinct from budget
  or p.recipient_key is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-recipient-v1',p.recipient))
  or p.plan_id is distinct from public.faolla_attendance_reminder_id_v1(jsonb_build_array('attendance-reminder-plan-v1',p.merchant_id,p.category,p.source_id,p.source_version))
  or p.plan_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-plan-proof-v1',p.merchant_id,p.plan_id,p.budget_key,p.category,p.worker_id,p.employee_id,p.employee_auth_user_id,p.source_id,p.source_version,p.target,s->'sourceFingerprint',p.recipient,p.configuration,public.faolla_attendance_operational_punch_stamp_v1(p.anchor_at),p.activation_revision,public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at)))
  or not exists(select 1 from public.merchant_attendance_operational_consumer_activations a where a.merchant_id=p.merchant_id and a.consumer='reminders' and a.revision=p.activation_revision and a.action='activate' and a.recorded_at<=p.recorded_at) then raise exception 'attendance_reminder_invalid';end if;
end;
$$;
create or replace function public.faolla_attendance_reminder_batch_proof_v1(p public.merchant_attendance_reminder_batches)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare batch_item jsonb;previous_id uuid;pid uuid;plan_value public.merchant_attendance_reminder_plans%rowtype;ev public.merchant_attendance_reminder_events%rowtype;
begin
 if p.window_start is distinct from (date_trunc('hour',p.recorded_at at time zone 'UTC') at time zone 'UTC')
  or p.recipient_key is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-recipient-v1',p.recipient)) or p.recipient->>'authUserId' is distinct from p.recipient_auth_user_id::text
  or p.batch_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-reminder-batch-v1',p.merchant_id,p.batch_id,p.category,p.recipient,public.faolla_attendance_operational_punch_stamp_v1(p.window_start),public.faolla_attendance_operational_punch_stamp_v1(p.window_end),public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at),p.items)) then raise exception 'attendance_reminder_invalid';end if;
 for batch_item in select value from jsonb_array_elements(p.items) loop
  if public.faolla_attendance_operational_rule_object_v1(batch_item,array['planId','ordinal','target','observedAt']) is distinct from true or public.faolla_attendance_operational_rule_scalar_v1(batch_item->'planId','uuid') is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(batch_item->'ordinal','positive') is distinct from true or (batch_item->>'ordinal')::bigint>10 or batch_item->>'observedAt' is distinct from public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at) then raise exception 'attendance_reminder_invalid';end if;
  pid:=(batch_item->>'planId')::uuid;if previous_id is not null and pid<=previous_id then raise exception 'attendance_reminder_invalid';end if;previous_id:=pid;
  select * into plan_value from public.merchant_attendance_reminder_plans where merchant_id=p.merchant_id and plan_id=pid;
  select * into ev from public.merchant_attendance_reminder_events where merchant_id=p.merchant_id and plan_id=pid and action='delivery' and ordinal=(batch_item->>'ordinal')::integer;
  if plan_value.plan_id is null or plan_value.category<>p.category or plan_value.recipient is distinct from p.recipient or batch_item->'target' is distinct from plan_value.target
   or ev.event_id is null or ev.item is distinct from batch_item or ev.batch_id<>p.batch_id or ev.recorded_at<>p.recorded_at then raise exception 'attendance_reminder_invalid';end if;
 end loop;
end;
$$;
create or replace function public.faolla_attendance_reminder_event_proof_v1(p public.merchant_attendance_reminder_events)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare prior public.merchant_attendance_reminder_events%rowtype;plan_value public.merchant_attendance_reminder_plans%rowtype;old_plan public.merchant_attendance_reminder_plans%rowtype;expected jsonb;count_value integer;last_at timestamptz;due timestamptz;state_value text;op public.merchant_attendance_reminder_operations%rowtype;b public.merchant_attendance_reminder_batches%rowtype;
begin
 select * into plan_value from public.merchant_attendance_reminder_plans where merchant_id=p.merchant_id and plan_id=p.plan_id;
 if plan_value.plan_id is null or plan_value.budget_key<>p.budget_key or p.recorded_at<plan_value.recorded_at then raise exception 'attendance_reminder_invalid';end if;
 if p.revision=1 then if p.previous_head is not null or p.action<>'register' then raise exception 'attendance_reminder_invalid';end if;
 else
  select * into prior from public.merchant_attendance_reminder_events where merchant_id=p.merchant_id and budget_key=p.budget_key and revision=p.revision-1;
  if prior.event_id is null or p.previous_head is distinct from prior.current_head or p.recorded_at<prior.recorded_at then raise exception 'attendance_reminder_invalid';end if;
 end if;
 count_value:=coalesce((p.previous_head->>'deliveredCount')::integer,0)+(case when p.action='delivery' then 1 else 0 end);
 last_at:=(case when p.action='delivery' then p.recorded_at else (p.previous_head->>'lastDeliveredAt')::timestamptz end);
 if count_value<>p.ordinal or count_value>(plan_value.configuration->>'maxOccurrences')::integer then raise exception 'attendance_reminder_invalid';end if;
 state_value:=p.current_head->>'state';due:=(p.current_head->>'nextDueAt')::timestamptz;
 expected:=jsonb_build_object('planId',p.plan_id,'revision',p.revision,'lastEventId',p.event_id,'state',state_value,'deliveredCount',count_value,'lastDeliveredAt',public.faolla_attendance_operational_punch_stamp_v1(last_at),'nextDueAt',public.faolla_attendance_operational_punch_stamp_v1(due));
 if p.current_head is distinct from expected or state_value not in('active','stopped','handover_needed') or (state_value='active')<>(due is not null) then raise exception 'attendance_reminder_invalid';end if;
 if p.action='register' then
  if p.run_operation_id is not null or p.event_id is distinct from public.faolla_attendance_reminder_id_v1(jsonb_build_array('attendance-reminder-register-v1',p.merchant_id,p.plan_id)) or p.recorded_at<>plan_value.recorded_at then raise exception 'attendance_reminder_invalid';end if;
  if p.previous_head is not null then
   select * into old_plan from public.merchant_attendance_reminder_plans where merchant_id=p.merchant_id and plan_id=(p.previous_head->>'planId')::uuid;
   if old_plan.category<>'pending_review' or plan_value.category<>'pending_review' or old_plan.budget_key<>plan_value.budget_key or old_plan.activation_revision<>plan_value.activation_revision
    or old_plan.configuration is distinct from plan_value.configuration or old_plan.source_ref is distinct from plan_value.source_ref or old_plan.anchor_at<>plan_value.anchor_at or p.previous_head->>'state'='stopped' then raise exception 'attendance_reminder_invalid';end if;
  end if;
 elsif p.action='delivery' then
  select * into b from public.merchant_attendance_reminder_batches where merchant_id=p.merchant_id and batch_id=p.batch_id;
  if p.previous_head->>'planId' is distinct from p.plan_id::text or p.previous_head->>'state'<>'active' or b.batch_id is null or not(b.items @> jsonb_build_array(p.item)) or b.recorded_at<>p.recorded_at
   or p.item is distinct from jsonb_build_object('planId',p.plan_id,'ordinal',count_value,'target',plan_value.target,'observedAt',public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at))
   or state_value is distinct from (case when count_value=(plan_value.configuration->>'maxOccurrences')::integer then 'stopped' else 'active' end)
   or due is distinct from (case when state_value='active' then greatest(plan_value.anchor_at+make_interval(mins=>(plan_value.configuration->>'afterMinutes')::integer+count_value*(plan_value.configuration->>'repeatMinutes')::integer),p.recorded_at+make_interval(mins=>(plan_value.configuration->>'repeatMinutes')::integer)) else null end) then raise exception 'attendance_reminder_invalid';end if;
 elsif p.action='defer' then
  if p.previous_head->>'planId' is distinct from p.plan_id::text or p.previous_head->>'state'<>'active' or state_value<>'active' or not exists(select 1 from public.merchant_attendance_reminder_batches x where x.merchant_id=p.merchant_id and x.recipient_key=plan_value.recipient_key and x.category=plan_value.category and x.window_start=(date_trunc('hour',p.recorded_at at time zone 'UTC') at time zone 'UTC') and x.window_end=due) then raise exception 'attendance_reminder_invalid';end if;
 else if p.previous_head->>'planId' is distinct from p.plan_id::text or p.previous_head->>'state'<>'active' or state_value='active' then raise exception 'attendance_reminder_invalid';end if;end if;
 if p.run_operation_id is not null then
  select * into op from public.merchant_attendance_reminder_operations where merchant_id=p.merchant_id and operation_id=p.run_operation_id;
  if op.operation_id is null or op.action<>'run_due' or op.recorded_at<>p.recorded_at or op.result->>'status'<>'completed' or p.action='register' then raise exception 'attendance_reminder_invalid';end if;
 elsif p.action='stop' then
  if plan_value.category<>'period_due' or state_value<>'stopped' or not exists(select 1 from public.merchant_attendance_cycle_operations x where x.merchant_id=p.merchant_id and x.intent_id=plan_value.source_id and x.revision=2 and x.action in('cancel','link') and x.recorded_at<=p.recorded_at) then raise exception 'attendance_reminder_invalid';end if;
 elsif p.action<>'register' then raise exception 'attendance_reminder_invalid';end if;
end;
$$;
create or replace function public.faolla_attendance_reminder_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare ev public.merchant_attendance_reminder_events%rowtype;
begin
 if tg_when<>'BEFORE' or tg_op in('DELETE','TRUNCATE') then raise exception using message='attendance_reminder_invalid',errcode='23514';end if;
 if tg_table_name='merchant_attendance_reminder_heads' then
  select * into ev from public.merchant_attendance_reminder_events where merchant_id=new.merchant_id and event_id=new.last_event_id;
  if ev.event_id is null or ev.budget_key<>new.budget_key or ev.current_head is distinct from public.faolla_attendance_reminder_head_v1(new)
   or (tg_op='UPDATE' and (old.merchant_id<>new.merchant_id or old.budget_key<>new.budget_key or ev.previous_head is distinct from public.faolla_attendance_reminder_head_v1(old)))
   or (tg_op='INSERT' and (ev.previous_head is not null or new.revision<>1)) then raise exception using message='attendance_reminder_invalid',errcode='23514';end if;
 elsif tg_op<>'INSERT' then raise exception using message='attendance_reminder_invalid',errcode='23514';end if;return new;
end;
$$;
create or replace function public.faolla_attendance_reminder_deferred_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare p public.merchant_attendance_reminder_plans%rowtype;h public.merchant_attendance_reminder_heads%rowtype;ev public.merchant_attendance_reminder_events%rowtype;op public.merchant_attendance_reminder_operations%rowtype;
 item jsonb;b public.merchant_attendance_reminder_batches%rowtype;n integer;d integer;f integer;s integer;ids jsonb;v jsonb;first_read timestamptz;
begin
 if tg_when<>'AFTER' or tg_op not in('INSERT','UPDATE') then raise exception 'attendance_reminder_invalid';end if;
 if tg_table_name='merchant_attendance_reminder_plans' then
  p:=new;perform public.faolla_attendance_reminder_plan_proof_v1(p);
  select * into ev from public.merchant_attendance_reminder_events where merchant_id=p.merchant_id and event_id=public.faolla_attendance_reminder_id_v1(jsonb_build_array('attendance-reminder-register-v1',p.merchant_id,p.plan_id));
  if ev.plan_id is distinct from p.plan_id or ev.action is distinct from 'register' then raise exception 'attendance_reminder_invalid';end if;
 elsif tg_table_name='merchant_attendance_reminder_heads' then
  select * into h from public.merchant_attendance_reminder_heads where merchant_id=new.merchant_id and budget_key=new.budget_key;
  select * into ev from public.merchant_attendance_reminder_events where merchant_id=h.merchant_id and event_id=h.last_event_id;
  if h.plan_id is null or ev.current_head is distinct from public.faolla_attendance_reminder_head_v1(h) or ev.budget_key<>h.budget_key then raise exception 'attendance_reminder_invalid';end if;
 elsif tg_table_name='merchant_attendance_reminder_events' then ev:=new;perform public.faolla_attendance_reminder_event_proof_v1(ev);
 elsif tg_table_name='merchant_attendance_reminder_batches' then b:=new;perform public.faolla_attendance_reminder_batch_proof_v1(b);
 elsif tg_table_name='merchant_attendance_reminder_operations' then
  op:=new;if op.command_fingerprint is distinct from public.faolla_attendance_reminder_command_v1(op.merchant_id,op.actor_kind,op.actor_id,op.command) or op.action is distinct from op.command->>'action' or op.operation_id::text is distinct from op.command->>'operationId' then raise exception 'attendance_reminder_invalid';end if;
  if op.action='mark_read' then
   select * into b from public.merchant_attendance_reminder_batches where merchant_id=op.merchant_id and batch_id=op.batch_id;
   select recorded_at into first_read from public.merchant_attendance_reminder_operations where merchant_id=op.merchant_id and batch_id=op.batch_id and actor_id=op.actor_id and action='mark_read' order by recorded_at,operation_id limit 1;
   if b.batch_id is null or op.command->>'batchId' is distinct from op.batch_id::text or b.recipient_auth_user_id<>op.actor_id or op.recorded_at<b.recorded_at or op.result is distinct from jsonb_build_object('kind','mark_read','batchId',op.batch_id,'readAt',public.faolla_attendance_operational_punch_stamp_v1(first_read)) then raise exception 'attendance_reminder_invalid';end if;
  else
   select count(*),count(*) filter(where action='delivery'),count(*) filter(where action='defer'),count(*) filter(where action='stop') into n,d,f,s from (select action from public.merchant_attendance_reminder_events where merchant_id=op.merchant_id and run_operation_id=op.operation_id order by event_id limit 26) bounded;
   if n>25 then raise exception 'attendance_reminder_invalid';end if;
   select coalesce(jsonb_agg(distinct batch_id order by batch_id),'[]') into ids from public.merchant_attendance_reminder_events where merchant_id=op.merchant_id and run_operation_id=op.operation_id and action='delivery';
   v:=op.result;
   if public.faolla_attendance_operational_rule_object_v1(v,array['kind','status','checkedCount','deliveredCount','deferredCount','stoppedCount','batchIds','nextCursor']) is distinct from true
    or v->>'kind'<>'run' or v->>'status' not in('completed','disabled') or v->'checkedCount' is distinct from to_jsonb(n) or v->'deliveredCount' is distinct from to_jsonb(d) or v->'deferredCount' is distinct from to_jsonb(f) or v->'stoppedCount' is distinct from to_jsonb(s)
    or jsonb_typeof(v->'batchIds') is distinct from 'array' or (select coalesce(jsonb_agg(x order by x),'[]') from jsonb_array_elements(v->'batchIds') x) is distinct from ids
    or v->>'status'='disabled' and (n<>0 or v->'nextCursor'<>'null'::jsonb) then raise exception 'attendance_reminder_invalid';end if;
   if v->'nextCursor'<>'null'::jsonb then
    item:=v->'nextCursor';if n<>25 or public.faolla_attendance_operational_rule_object_v1(item,array['runOperationId','afterDueAt','afterPlanId','cutoffAt']) is distinct from true or item->>'runOperationId' is distinct from op.operation_id::text
     or public.faolla_attendance_operational_rule_scalar_v1(item->'afterPlanId','uuid') is distinct from true then raise exception 'attendance_reminder_invalid';end if;
    perform public.faolla_attendance_operational_source_stamp_v1(item->>'afterDueAt');perform public.faolla_attendance_operational_source_stamp_v1(item->>'cutoffAt');
    if (item->>'afterDueAt')::timestamptz>(item->>'cutoffAt')::timestamptz or (item->>'cutoffAt')::timestamptz>op.recorded_at then raise exception 'attendance_reminder_invalid';end if;
   end if;
  end if;
 else raise exception 'attendance_reminder_invalid';end if;return new;
exception when raise_exception then raise exception using message='attendance_reminder_invalid',errcode='23514';
end;
$$;
-- BEGIN REMINDER FORWARD
do $reminder_forward$
declare recipe jsonb;change_value jsonb;f regprocedure;source_value text;new_source text;ns text;owner_id oid;def text;before_fn pg_proc%rowtype;after_fn pg_proc%rowtype;
begin
 select n.nspname,c.relowner into ns,owner_id from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 for recipe in select value from jsonb_array_elements($reminder_recipes$[
  {
    "name": "faolla_attendance_operational_consumer_activation_v1",
    "types": "jsonb,uuid,jsonb,boolean",
    "argumentNames": [
      "p_query",
      "p_auth_user_id",
      "p_command",
      "p_allow_activate"
    ],
    "defaults": 2,
    "resultType": "jsonb",
    "volatility": "v",
    "language": "plpgsql",
    "securityDefiner": true,
    "config": [
      "search_path=pg_catalog"
    ],
    "serviceExecute": true,
    "defaultExpression": "NULL::jsonb, false",
    "source": "202610080194_merchant_attendance_application_window.sql",
    "file": "202610080194_merchant_attendance_application_window.sql",
    "oldHash": "47c615dc8b28428b158efd3ea31bb551335bc95ba10ffd70555358f702a7877c",
    "core": null,
    "coreHash": null,
    "newHash": "cc1997523546034ef0c6fc4d94a1adce530275871ef6ac7f01f7271f5c066a7e",
    "changes": [
      {
        "from": "kind not in('application_window','review_routing','timesheet_cycle')",
        "to": "kind not in('application_window','review_routing','timesheet_cycle','reminders')",
        "count": 1
      },
      {
        "from": "kind in('application_window','review_routing','timesheet_cycle')",
        "to": "kind in('application_window','review_routing','timesheet_cycle','reminders')",
        "count": 1
      }
    ],
    "wrapper": "\ndeclare site text;kind text;mode_name text;op uuid;owner_id uuid;s public.merchant_attendance_settings%rowtype;\n head public.merchant_attendance_operational_consumer_activations%rowtype;saved public.merchant_attendance_operational_consumer_activations%rowtype;\n stamp timestamptz;t jsonb;can_activate boolean:=false;can_deactivate boolean:=false;\nbegin\n site:=p_query->>'siteId';kind:=p_query->>'consumer';mode_name:=p_query->>'mode';\n if p_auth_user_id is null or p_allow_activate is null or public.faolla_attendance_application_window_scalar_v1(p_query->'siteId','site') is distinct from true\n  or kind is null or kind not in('application_window','review_routing','timesheet_cycle','reminders') then raise exception 'attendance_invalid_request';end if;\n if mode_name='current' then\n  if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','consumer','mode']) is distinct from true then raise exception 'attendance_invalid_request';end if;\n elsif mode_name='recover' then\n  if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','consumer','mode','operationId']) is distinct from true\n   or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;\n  op:=(p_query->>'operationId')::uuid;\n else raise exception 'attendance_invalid_request';end if;\n if mode_name='recover' then\n  select * into saved from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=site and x.consumer=kind and x.operation_id=op and x.actor_auth_user_id=p_auth_user_id;\n  return jsonb_build_object('protocol','attendance-operational-consumer-activation-v1','siteId',site,'consumer',kind,'actorId',p_auth_user_id,\n   'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'canActivate',false,'canDeactivate',false,'current',null,'receipt',public.faolla_attendance_operational_consumer_item_v1(saved));\n end if;\n select user_id into owner_id from public.merchants where id=site for share;\n if owner_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;\n if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;\n else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;\n if s.merchant_id is null then raise exception 'attendance_settings_required';end if;\n select * into head from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=site and x.consumer=kind order by x.revision desc limit 1;\n perform public.faolla_attendance_operational_consumer_item_v1(head);\n if p_command is not null then\n  t:=public.faolla_attendance_operational_consumer_command_v1(site,kind,p_auth_user_id,p_command);op:=(p_command->>'operationId')::uuid;\n  select * into saved from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=site and x.operation_id=op;\n  if saved.operation_id is not null then\n   if saved.consumer<>kind or saved.actor_auth_user_id<>p_auth_user_id or saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;\n  else\n   if (p_command->>'expectedRevision')::bigint<>coalesce(head.revision,0) then raise exception 'attendance_operational_consumer_changed';end if;\n   if p_command->>'action'='activate' and (kind not in('application_window','review_routing','timesheet_cycle','reminders') or not p_allow_activate or not s.enabled) then raise exception 'attendance_operational_consumer_disabled';end if;\n   if coalesce(head.action,'deactivate')=p_command->>'action' then raise exception 'attendance_operational_consumer_unchanged';end if;\n   stamp:=clock_timestamp();if head.recorded_at>stamp then raise exception 'attendance_operational_consumer_changed';end if;\n   insert into public.merchant_attendance_operational_consumer_activations(merchant_id,consumer,operation_id,revision,actor_auth_user_id,action,reason,command,command_fingerprint,recorded_at)\n    values(site,kind,op,coalesce(head.revision,0)+1,p_auth_user_id,p_command->>'action',p_command->>'reason',p_command,public.faolla_attendance_operational_rule_hash_v1(t),stamp) returning * into saved;\n   head:=saved;\n  end if;\n else can_activate:=kind in('application_window','review_routing','timesheet_cycle','reminders') and p_allow_activate and s.enabled and coalesce(head.action,'deactivate')='deactivate';can_deactivate:=head.action='activate';end if;\n return jsonb_build_object('protocol','attendance-operational-consumer-activation-v1','siteId',site,'consumer',kind,'actorId',p_auth_user_id,\n  'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'canActivate',can_activate,'canDeactivate',coalesce(can_deactivate,false),\n  'current',public.faolla_attendance_operational_consumer_item_v1(head),'receipt',public.faolla_attendance_operational_consumer_item_v1(saved));\nend;\n"
  }
]$reminder_recipes$::jsonb) loop
  recipe:=replace(recipe::text,ns||'.','pub'||'lic.')::jsonb;
  f:=to_regprocedure('public.'||(recipe->>'name')||'('||(recipe->>'types')||')');
  select * into before_fn from pg_proc where oid=f;
  select replace(replace(prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.') into source_value from pg_proc where oid=f;
  if encode(sha256(convert_to(source_value,'UTF8')),'hex')=recipe->>'newHash' then continue;end if;
  if encode(sha256(convert_to(source_value,'UTF8')),'hex') is distinct from recipe->>'oldHash' then raise exception 'merchant_attendance_reminder_installation_conflict';end if;
  new_source:=source_value;
  for change_value in select value from jsonb_array_elements(recipe->'changes') loop
   if (length(new_source)-length(replace(new_source,change_value->>'from','')))/length(change_value->>'from')<>coalesce((change_value->>'count')::integer,1) then raise exception 'merchant_attendance_reminder_installation_conflict';end if;
   new_source:=replace(new_source,change_value->>'from',change_value->>'to');
  end loop;
  if recipe->>'core' is not null then
   if encode(sha256(convert_to(new_source,'UTF8')),'hex') is distinct from recipe->>'coreHash' then raise exception 'merchant_attendance_reminder_installation_conflict';end if;
   execute format('create function %I.%I(p_query jsonb,p_auth_user_id uuid,p_command jsonb,p_artifact jsonb,p_allow_write boolean,p_intent jsonb) returns jsonb language plpgsql set search_path=pg_catalog as %L',ns,recipe->>'core',replace(new_source,'pub'||'lic.',ns||'.'));
   execute format('alter function %I.%I(jsonb,uuid,jsonb,jsonb,boolean,jsonb) owner to %I',ns,recipe->>'core',pg_get_userbyid(owner_id));
   new_source:=recipe->>'wrapper';
  end if;
  if encode(sha256(convert_to(new_source,'UTF8')),'hex') is distinct from recipe->>'newHash' then raise exception 'merchant_attendance_reminder_installation_conflict';end if;
  def:=pg_get_functiondef(f);
  execute replace(def,(select prosrc from pg_proc where oid=f),replace(new_source,'pub'||'lic.',ns||'.'));
  select * into after_fn from pg_proc where oid=to_regprocedure('public.'||(recipe->>'name')||'('||(recipe->>'types')||')');
  if after_fn.oid is distinct from before_fn.oid or row(after_fn.proowner,after_fn.proacl,after_fn.proargtypes,after_fn.proargnames,after_fn.proargmodes,after_fn.pronargdefaults,
   after_fn.proconfig,after_fn.prosecdef,after_fn.provolatile,after_fn.prolang,after_fn.prorettype,after_fn.proretset,after_fn.proisstrict,after_fn.proleakproof,after_fn.prokind,after_fn.proparallel)
   is distinct from row(before_fn.proowner,before_fn.proacl,before_fn.proargtypes,before_fn.proargnames,before_fn.proargmodes,before_fn.pronargdefaults,
   before_fn.proconfig,before_fn.prosecdef,before_fn.provolatile,before_fn.prolang,before_fn.prorettype,before_fn.proretset,before_fn.proisstrict,before_fn.proleakproof,before_fn.prokind,before_fn.proparallel)
   or pg_get_expr(after_fn.proargdefaults,0) is distinct from pg_get_expr(before_fn.proargdefaults,0) then raise exception 'merchant_attendance_reminder_installation_conflict:forward_metadata:%',recipe->>'name';end if;
 end loop;
end;
$reminder_forward$;
-- END REMINDER FORWARD
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_reminder_plans'::regclass,
      'public.merchant_attendance_reminder_heads'::regclass,
      'public.merchant_attendance_reminder_events'::regclass,
      'public.merchant_attendance_reminder_batches'::regclass,
      'public.merchant_attendance_reminder_operations'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

-- BEGIN REMINDER FINALIZE
do $reminder_finalize$
declare ns text;owner_id oid;spec jsonb;t regclass;f regprocedure;
begin
 select n.nspname,v.relowner into ns,owner_id from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.merchant_attendance_settings'::regclass;
 for spec in select value from jsonb_array_elements($reminder_finalize_functions$[{"name":"faolla_attendance_reminder_id_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"uuid","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"addb44f8b3fbb33610adda8e583738966adb33f97ebb87795fdddfaccd5f44c2","defaultExpression":null},{"name":"faolla_attendance_reminder_config_v1","types":"jsonb,text","argumentNames":["p_source","p_category"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"5d737b34f4bc38d6f68e43b2dd5cd91572782c0aa3a0daeefdff52880ebd2dd2","defaultExpression":null},{"name":"faolla_attendance_reminder_config_layers_v1","types":"jsonb,text","argumentNames":["p_layers","p_category"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"ccc252d6180747cc4d9cbe5bc0509307845e702691c4c35c09b9cd6a7c51959d","defaultExpression":null},{"name":"faolla_attendance_reminder_head_v1","types":"public.merchant_attendance_reminder_heads","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"0ad15d99b26b3ca7c5e0b16ee20696062c2746c0219be59be6897106e5f91dd7","defaultExpression":null},{"name":"faolla_attendance_reminder_eligible_v1","types":"public.merchant_attendance_reminder_plans,timestamptz","argumentNames":["p","p_at"],"defaults":0,"resultType":"text","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"e098e5885e5dfaf2e53f074deb833a4ce7e99e984c6a93bade10c12aea3737e4","defaultExpression":null},{"name":"faolla_attendance_reminder_qualify_v1","types":"public.merchant_attendance_reminder_plans,timestamptz","argumentNames":["p","p_at"],"defaults":0,"resultType":"text","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"473addf4892f0a776c9c63105466a482194c0b0b72b214336da9d98f96878e57","defaultExpression":null},{"name":"faolla_attendance_reminder_advance_v1","types":"public.merchant_attendance_reminder_plans,text,timestamptz,text,timestamptz,uuid,jsonb,uuid","argumentNames":["p","p_action","p_at","p_state","p_due","p_batch","p_item","p_operation"],"defaults":1,"resultType":"void","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"0a486f4b48d90948aa00b6e4555ab7c49ae9e41a5814c3014b3a60fe2b7fc287","defaultExpression":"NULL::uuid"},{"name":"faolla_attendance_reminder_capture_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"06ffebf88abd0f233b9d26ecf77fdbbc5e646d582ec110d33c682ccddcb04f5f","defaultExpression":null},{"name":"faolla_attendance_reminder_command_v1","types":"text,text,uuid,jsonb","argumentNames":["p_site","p_kind","p_actor","p_command"],"defaults":0,"resultType":"text","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"dd544846a248bdbf2ca14456007a47b4700bf510109e87ffa722682e246d3040","defaultExpression":null},{"name":"faolla_attendance_reminder_receipt_v1","types":"public.merchant_attendance_reminder_operations","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"d0a7431e6000983a97b67adbf229d891b3aabfbba97804df446fdb5e2718106b","defaultExpression":null},{"name":"faolla_attendance_reminder_run_v1","types":"text,text,uuid,jsonb,boolean","argumentNames":["p_site","p_kind","p_actor","p_command","p_allow"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"251e587468e8176014ee4f8acbfb108196d4d5292cf62e6d33c3dbe55446b48c","defaultExpression":null},{"name":"faolla_attendance_reminder_recipient_v1","types":"public.merchant_attendance_reminder_batches,uuid","argumentNames":["p","p_actor"],"defaults":0,"resultType":"void","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"9c5088bc85a0cea069a2273756e884e2682054534a02f41610ab6a917625274d","defaultExpression":null},{"name":"faolla_attendance_reminder_batch_v1","types":"public.merchant_attendance_reminder_batches,uuid,boolean","argumentNames":["p","p_actor","p_detail"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"02e854dbb8876c1cc234ca4d4633d125ded82574875de588b9c074fad671b29f","defaultExpression":null},{"name":"faolla_attendance_reminders_v1","types":"jsonb,uuid,jsonb,boolean","argumentNames":["p_query","p_auth_user_id","p_command","p_allow_write"],"defaults":2,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"3d32b6b7c6f5eaef0b5aa7edb1262d52c04b53591c34debc4cafac4395d4e945","defaultExpression":"NULL::jsonb, false"},{"name":"faolla_attendance_reminders_run_v1","types":"jsonb,boolean","argumentNames":["p_query","p_allow_run"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"c798f0fe940b0107ae8cfbc76d84af85821bd13437ea3e28fbe87a6a25529d70","defaultExpression":"false"},{"name":"faolla_attendance_reminder_plan_proof_v1","types":"public.merchant_attendance_reminder_plans","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"bed800a5692bb335a5a22f8fbd7065644cdb5edf6942a4a797cd46c92c9389c8","defaultExpression":null},{"name":"faolla_attendance_reminder_batch_proof_v1","types":"public.merchant_attendance_reminder_batches","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1e647e5feea6e0591201295a1d8a1a25ff892e0bde70578f182a77751724fec8","defaultExpression":null},{"name":"faolla_attendance_reminder_event_proof_v1","types":"public.merchant_attendance_reminder_events","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"cf0a21575ca3e1552dd2325f21fee0edeb0b6dea387359375b50e1c5951a1008","defaultExpression":null},{"name":"faolla_attendance_reminder_guard_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1b229f813a30bb287b0600f4c30ecfcbed0945f83f098c9533f7d782ad5ab6d1","defaultExpression":null},{"name":"faolla_attendance_reminder_deferred_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1b6c37d226e746cab05ff29cad196d0d062f24bb5903d66ef5c76dd24cc7969a","defaultExpression":null}]$reminder_finalize_functions$::jsonb) loop
  f:=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));execute format('alter function %s owner to %I',f,pg_get_userbyid(owner_id));execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  if (spec->>'serviceExecute')::boolean then execute format('grant execute on function %s to service_role',f);end if;
 end loop;
 for spec in select value from jsonb_array_elements($reminder_finalize_tables$[{"name":"merchant_attendance_reminder_plans"},{"name":"merchant_attendance_reminder_heads"},{"name":"merchant_attendance_reminder_events"},{"name":"merchant_attendance_reminder_batches"},{"name":"merchant_attendance_reminder_operations"}]$reminder_finalize_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));execute format('alter table %s owner to %I',t,pg_get_userbyid(owner_id));execute format('alter table %s enable row level security',t);execute format('revoke all on table %s from public,anon,authenticated,service_role',t);
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='reminder_immutable') then
   execute format('create trigger reminder_immutable before insert or update or delete on %s for each row execute function %I.faolla_attendance_reminder_guard_v1()',t,ns);
   execute format('create trigger reminder_no_truncate before truncate on %s for each statement execute function %I.faolla_attendance_reminder_guard_v1()',t,ns);
   execute format('create constraint trigger reminder_proof after insert %s on %s deferrable initially deferred for each row execute function %I.faolla_attendance_reminder_deferred_v1()',case when spec->>'name'='merchant_attendance_reminder_heads' then 'or update' else '' end,t,ns);
  end if;
 end loop;
 for spec in select value from jsonb_array_elements($reminder_finalize_captures$[{"table":"merchant_attendance_operational_punch_sessions","type":5,"deferred":false},{"table":"merchant_attendance_review_responsibility_heads","type":21,"deferred":true},{"table":"merchant_attendance_cycle_operations","type":5,"deferred":true}]$reminder_finalize_captures$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'table'));
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='reminder_capture') then
   execute format('create %s trigger reminder_capture after insert %s on %s %s for each row execute function %I.faolla_attendance_reminder_capture_v1()',case when (spec->>'deferred')::boolean then 'constraint' else '' end,case when (spec->>'type')::integer=21 then 'or update' else '' end,t,case when (spec->>'deferred')::boolean then 'deferrable initially deferred' else '' end,ns);
  end if;
 end loop;
end;
$reminder_finalize$;
insert into public.faolla_schema_migrations(version,name) values(202610080201,'merchant_attendance_reminders') on conflict(version) do nothing;
do $reminder_postconditions$
declare installed boolean;ns text;owner_id oid;has190 boolean;spec jsonb;col jsonb;c jsonb;ix jsonb;f pg_proc%rowtype;t regclass;con pg_constraint%rowtype;idx pg_index%rowtype;tr pg_trigger%rowtype;expected_hash text;keys text[];refkeys text[];n integer;
begin
 select n.nspname,v.relowner into ns,owner_id from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.merchant_attendance_settings'::regclass;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080201 and name='merchant_attendance_reminders');
 if exists(select 1 from public.faolla_schema_migrations where version=202610080201 and name<>'merchant_attendance_reminders') or not installed
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080193 and name='merchant_attendance_operational_punch')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080198 and name='merchant_attendance_review_routing')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080200 and name='merchant_attendance_operational_cycle')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations')
  or exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission') then raise exception 'merchant_attendance_reminder_prerequisite_required';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 for spec in select value from jsonb_array_elements($reminder_postconditions_dependencies$[{"name":"faolla_attendance_administrative_boundary_v1","types":"text,uuid,uuid","argumentNames":["p_site","p_worker","p_start"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"30f4e7c06f9fd44bd90e321ae8f7f7ec44638ba50e6092ae27cc967dfce196bb","defaultExpression":null,"source":"202610080195_merchant_attendance_administrative_closure.sql"},{"name":"faolla_attendance_application_window_scalar_v1","types":"jsonb,text","argumentNames":["p","k"],"defaults":0,"resultType":"boolean","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db","defaultExpression":null,"source":"202610080194_merchant_attendance_application_window.sql"},{"name":"faolla_attendance_cycle_authority_v1","types":"text,text,uuid,uuid,uuid,date,date,text","argumentNames":["p_site","p_access","p_worker","p_grant","p_actor","p_from","p_through","p_action"],"defaults":0,"resultType":"void","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"891a994e9c1c1c13118f28c4c1b5a43ae62ee360708edc3ef34be0a30bdf834a","defaultExpression":null,"source":"202610080200_merchant_attendance_operational_cycle.sql"},{"name":"faolla_attendance_cycle_intent_v1","types":"public.merchant_attendance_cycle_intents","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"75bf87a8b1815c61d208fd760abb0540db31f7d2195d3cf499ada8cbf26c61c2","defaultExpression":null,"source":"202610080200_merchant_attendance_operational_cycle.sql"},{"name":"faolla_attendance_operational_punch_current_start_v1","types":"text,uuid","argumentNames":["p_site","p_worker"],"defaults":0,"resultType":"uuid","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"f6b47de540399f78360ffb1b24a4597a01878807825ca1cbaca820aebf39db01","defaultExpression":null,"source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_punch_saved_source_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d","defaultExpression":null,"source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_punch_source_ref_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7","defaultExpression":null,"source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_punch_stamp_v1","types":"timestamptz","argumentNames":["p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","defaultExpression":null,"source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_rule_hash_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","defaultExpression":null,"source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_rule_object_v1","types":"jsonb,text[]","argumentNames":["p","ks"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","defaultExpression":null,"source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_rule_scalar_v1","types":"jsonb,text","argumentNames":["p","k"],"defaults":0,"resultType":"boolean","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","defaultExpression":null,"source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_source_stamp_v1","types":"text","argumentNames":["p"],"defaults":0,"resultType":"timestamptz","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265","defaultExpression":null,"source":"202610080192_merchant_attendance_operational_source.sql"},{"name":"faolla_attendance_operational_source_tuple_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a","defaultExpression":null,"source":"202610080192_merchant_attendance_operational_source.sql"},{"name":"faolla_attendance_operational_source_v1","types":"text,uuid,uuid,uuid,timestamptz","argumentNames":["p_site","p_worker","p_employee","p_employee_auth","p_at"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee","defaultExpression":null,"source":"202610080192_merchant_attendance_operational_source.sql"},{"name":"faolla_attendance_review_routing_entry_v1","types":"public.merchant_attendance_review_responsibility_entries","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"c7ad8af0b4ae7950ba4d322112b8ec5282ea532b2f5f9432460e67500b4ef61b","defaultExpression":null,"source":"202610080198_merchant_attendance_review_routing.sql"},{"name":"faolla_attendance_review_routing_observe_v1","types":"text,text,uuid,timestamptz","argumentNames":["p_site","p_family","p_request","p_at"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"c67fdd792c1ea719c2ce86cd88beb40d057920b66ad5f892b45ad9c1f91e7167","defaultExpression":null,"source":"202610080198_merchant_attendance_review_routing.sql"},{"name":"faolla_attendance_review_routing_qualify_v1","types":"text,text,uuid,uuid,timestamptz","argumentNames":["p_site","p_family","p_request","p_grant","p_at"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"7a867d0c19f5b7dedae30db3f1e9007ad7792702949c333c919e22ac7c7bdff9","defaultExpression":null,"source":"202610080198_merchant_attendance_review_routing.sql"},{"name":"faolla_valid_merchant_enterprise_permissions_v1","types":"text[]","argumentNames":["p_permissions"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog, public"],"serviceExecute":false,"hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","defaultExpression":null,"source":"202610080190_merchant_attendance_correction_delegation_permission.sql","legacyHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc"},{"name":"faolla_attendance_operational_consumer_activation_v1","types":"jsonb,uuid,jsonb,boolean","argumentNames":["p_query","p_auth_user_id","p_command","p_allow_activate"],"defaults":2,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"cc1997523546034ef0c6fc4d94a1adce530275871ef6ac7f01f7271f5c066a7e","defaultExpression":"NULL::jsonb, false","source":"202610080194_merchant_attendance_application_window.sql","oldHash":"47c615dc8b28428b158efd3ea31bb551335bc95ba10ffd70555358f702a7877c","newHash":"cc1997523546034ef0c6fc4d94a1adce530275871ef6ac7f01f7271f5c066a7e"}]$reminder_postconditions_dependencies$::jsonb) loop
  select * into f from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));
  expected_hash:=coalesce(spec->>'hash',(case when installed then spec->>'newHash' else spec->>'oldHash' end));
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then expected_hash:=spec->>'legacyHash';end if;
  if f.oid is null or f.proowner<>owner_id or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.provolatile::text<>spec->>'volatility'
   or (select lanname from pg_language where oid=f.prolang)<>spec->>'language' or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f' or f.proparallel<>'u' or f.provariadic<>0 or f.proargmodes is not null or f.proallargtypes is not null
   or f.pronargs<>jsonb_array_length(spec->'argumentNames') or f.procost<>100 or f.prorows<>0 or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or f.pronargdefaults<>(spec->>'defaults')::integer or pg_get_expr(f.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash then raise exception 'merchant_attendance_reminder_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if (has_function_privilege(owner_id,f.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(owner_id,owner_id,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(owner_id,0::oid,'EXECUTE',false),jsonb_build_array(owner_id,owner_id,'EXECUTE',false)))) then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
  elsif exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>owner_id or a.privilege_type<>'EXECUTE' or a.is_grantable
    or a.grantee<>owner_id and (not(spec->>'serviceExecute')::boolean or a.grantee<>(select oid from pg_roles where rolname='service_role')))
   or (select count(*) from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))))<>(case when (spec->>'serviceExecute')::boolean then 2 else 1 end)
   or not has_function_privilege(owner_id,f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from (spec->>'serviceExecute')::boolean then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and (proname like 'faolla_attendance_reminder_%' or proname like 'faolla_attendance_reminders_%'))<>(case when installed then 20 else 0 end) then raise exception 'merchant_attendance_reminder_installation_conflict:function_inventory';end if;
 if (select count(*) from pg_class where relnamespace=(select oid from pg_namespace where nspname=ns) and relname like 'merchant_attendance_reminder_%' and relkind not in('i','I'))<>(case when installed then 5 else 0 end) then raise exception 'merchant_attendance_reminder_installation_conflict:relation_inventory';end if;
 for spec in select value from jsonb_array_elements($reminder_postconditions_tables$[{"name":"merchant_attendance_reminder_plans","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"plan_id","type":"uuid","nullable":false},{"name":"budget_key","type":"text","nullable":false},{"name":"category","type":"text","nullable":false},{"name":"worker_id","type":"uuid","nullable":false},{"name":"employee_id","type":"uuid","nullable":false},{"name":"employee_auth_user_id","type":"uuid","nullable":false},{"name":"source_id","type":"uuid","nullable":false},{"name":"source_version","type":"text","nullable":false},{"name":"target","type":"jsonb","nullable":false},{"name":"source_ref","type":"jsonb","nullable":false},{"name":"recipient","type":"jsonb","nullable":false},{"name":"recipient_key","type":"text","nullable":false},{"name":"configuration","type":"jsonb","nullable":false},{"name":"anchor_at","type":"timestamptz","nullable":false},{"name":"activation_revision","type":"bigint","nullable":false},{"name":"recorded_at","type":"timestamptz","nullable":false},{"name":"plan_fingerprint","type":"text","nullable":false}],"constraints":[{"name":"reminder_plans_pk","kind":"p","keys":["merchant_id","plan_id"],"reference":null,"referenceKeys":null},{"name":"reminder_plans_source_uq","kind":"u","keys":["merchant_id","category","source_id","source_version"],"reference":null,"referenceKeys":null},{"name":"reminder_plans_worker_fk","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"]},{"name":"reminder_plans_employee_fk","kind":"f","keys":["merchant_id","employee_id"],"reference":"merchant_enterprise_employees","referenceKeys":["merchant_id","id"]},{"name":"reminder_plans_shape_ck","kind":"c","expression":"category=any(array['open_session','pending_review','period_due']) and activation_revision>=1 and isfinite(anchor_at) and isfinite(recorded_at)\n  and budget_key~'^[0-9a-f]{64}$' and recipient_key~'^[0-9a-f]{64}$' and plan_fingerprint~'^[0-9a-f]{64}$'\n  and octet_length(convert_to(jsonb_build_array(target,source_ref,recipient,configuration)::text,'UTF8'))<=24576"}]},{"name":"merchant_attendance_reminder_heads","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"budget_key","type":"text","nullable":false},{"name":"plan_id","type":"uuid","nullable":false},{"name":"revision","type":"bigint","nullable":false},{"name":"last_event_id","type":"uuid","nullable":false},{"name":"state","type":"text","nullable":false},{"name":"delivered_count","type":"integer","nullable":false},{"name":"last_delivered_at","type":"timestamptz","nullable":true},{"name":"next_due_at","type":"timestamptz","nullable":true}],"constraints":[{"name":"reminder_heads_pk","kind":"p","keys":["merchant_id","budget_key"],"reference":null,"referenceKeys":null},{"name":"reminder_heads_plan_fk","kind":"f","keys":["merchant_id","plan_id"],"reference":"merchant_attendance_reminder_plans","referenceKeys":["merchant_id","plan_id"]},{"name":"reminder_heads_shape_ck","kind":"c","expression":"revision>=1 and revision<=9007199254740990 and delivered_count>=0 and delivered_count<=10\n  and state=any(array['active','stopped','handover_needed']) and (delivered_count=0)=(last_delivered_at is null)\n  and (state='active')=(next_due_at is not null) and (last_delivered_at is null or isfinite(last_delivered_at)) and (next_due_at is null or isfinite(next_due_at))"}]},{"name":"merchant_attendance_reminder_events","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"event_id","type":"uuid","nullable":false},{"name":"budget_key","type":"text","nullable":false},{"name":"plan_id","type":"uuid","nullable":false},{"name":"revision","type":"bigint","nullable":false},{"name":"action","type":"text","nullable":false},{"name":"ordinal","type":"integer","nullable":false},{"name":"recorded_at","type":"timestamptz","nullable":false},{"name":"previous_head","type":"jsonb","nullable":true},{"name":"current_head","type":"jsonb","nullable":false},{"name":"batch_id","type":"uuid","nullable":true},{"name":"item","type":"jsonb","nullable":true},{"name":"run_operation_id","type":"uuid","nullable":true}],"constraints":[{"name":"reminder_events_pk","kind":"p","keys":["merchant_id","event_id"],"reference":null,"referenceKeys":null},{"name":"reminder_events_stream_uq","kind":"u","keys":["merchant_id","budget_key","revision"],"reference":null,"referenceKeys":null},{"name":"reminder_events_plan_fk","kind":"f","keys":["merchant_id","plan_id"],"reference":"merchant_attendance_reminder_plans","referenceKeys":["merchant_id","plan_id"]},{"name":"reminder_events_shape_ck","kind":"c","expression":"action=any(array['register','delivery','defer','stop']) and revision>=1 and revision<=9007199254740990 and ordinal>=0 and ordinal<=10\n  and isfinite(recorded_at) and (action='delivery')=(batch_id is not null) and (action='delivery')=(item is not null)\n  and octet_length(convert_to(jsonb_build_array(previous_head,current_head,item)::text,'UTF8'))<=8192"}]},{"name":"merchant_attendance_reminder_batches","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"batch_id","type":"uuid","nullable":false},{"name":"category","type":"text","nullable":false},{"name":"recipient","type":"jsonb","nullable":false},{"name":"recipient_key","type":"text","nullable":false},{"name":"recipient_auth_user_id","type":"uuid","nullable":false},{"name":"window_start","type":"timestamptz","nullable":false},{"name":"window_end","type":"timestamptz","nullable":false},{"name":"recorded_at","type":"timestamptz","nullable":false},{"name":"items","type":"jsonb","nullable":false},{"name":"batch_fingerprint","type":"text","nullable":false}],"constraints":[{"name":"reminder_batches_pk","kind":"p","keys":["merchant_id","batch_id"],"reference":null,"referenceKeys":null},{"name":"reminder_batches_window_uq","kind":"u","keys":["merchant_id","recipient_key","category","window_start"],"reference":null,"referenceKeys":null},{"name":"reminder_batches_shape_ck","kind":"c","expression":"category=any(array['open_session','pending_review','period_due']) and recipient_key~'^[0-9a-f]{64}$' and batch_fingerprint~'^[0-9a-f]{64}$'\n  and isfinite(window_start) and isfinite(window_end) and isfinite(recorded_at) and window_end=window_start+'01:00:00'::interval\n  and recorded_at>=window_start and recorded_at<window_end and jsonb_typeof(items)='array' and jsonb_array_length(items)>=1 and jsonb_array_length(items)<=25\n  and octet_length(convert_to(jsonb_build_array(recipient,items)::text,'UTF8'))<=32768"}]},{"name":"merchant_attendance_reminder_operations","columns":[{"name":"merchant_id","type":"text","nullable":false},{"name":"operation_id","type":"uuid","nullable":false},{"name":"action","type":"text","nullable":false},{"name":"actor_kind","type":"text","nullable":false},{"name":"actor_id","type":"uuid","nullable":true},{"name":"command","type":"jsonb","nullable":false},{"name":"command_fingerprint","type":"text","nullable":false},{"name":"recorded_at","type":"timestamptz","nullable":false},{"name":"result","type":"jsonb","nullable":false},{"name":"batch_id","type":"uuid","nullable":true}],"constraints":[{"name":"reminder_operations_pk","kind":"p","keys":["merchant_id","operation_id"],"reference":null,"referenceKeys":null},{"name":"reminder_operations_shape_ck","kind":"c","expression":"action=any(array['run_due','mark_read']) and actor_kind=any(array['auth','system']) and (actor_kind='system')=(actor_id is null)\n  and (action='mark_read')=(batch_id is not null) and (action<>'mark_read' or actor_kind='auth') and command_fingerprint~'^[0-9a-f]{64}$' and isfinite(recorded_at)\n  and octet_length(convert_to(jsonb_build_array(command,result)::text,'UTF8'))<=16384"}]}]$reminder_postconditions_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));if installed<>(t is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:table:%',spec->>'name';end if;if not installed then continue;end if;
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=owner_id and relrowsecurity and not relforcerowsecurity and relpersistence='p' and not relispartition)
   or exists(select 1 from pg_policy where polrelid=t) or exists(select 1 from pg_class z cross join lateral aclexplode(coalesce(z.relacl,acldefault('r',z.relowner))) a where z.oid=t and (a.grantor<>owner_id or a.grantee<>owner_id))
   or exists(select 1 from pg_attribute z cross join lateral aclexplode(z.attacl) a where z.attrelid=t and (a.grantor<>owner_id or a.grantee<>owner_id)) then raise exception 'merchant_attendance_reminder_installation_conflict:table_acl:%',spec->>'name';end if;
  if (select count(*) from pg_attribute where attrelid=t and attnum>0)<>jsonb_array_length(spec->'columns') then raise exception 'merchant_attendance_reminder_installation_conflict:columns:%',spec->>'name';end if;n:=0;
  for col in select value from jsonb_array_elements(spec->'columns') loop n:=n+1;
   if not exists(select 1 from pg_attribute a join pg_type y on y.oid=a.atttypid where a.attrelid=t and a.attnum=n and a.attname=col->>'name' and a.atttypid=to_regtype(col->>'type') and a.atttypmod=-1 and not a.attisdropped and a.attnotnull=(not(col->>'nullable')::boolean) and not a.atthasdef and a.attidentity='' and a.attgenerated='' and a.attndims=0 and a.attcollation=y.typcollation) then raise exception 'merchant_attendance_reminder_installation_conflict:column:%.%',spec->>'name',col->>'name';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=t and contype<>'t')<>jsonb_array_length(spec->'constraints') then raise exception 'merchant_attendance_reminder_installation_conflict:constraints:%',spec->>'name';end if;
  for c in select value from jsonb_array_elements(spec->'constraints') loop
   select * into con from pg_constraint where conrelid=t and conname=c->>'name';
   if coalesce(c->>'kind','') not in('c','p','u','f') or con.oid is null or con.contype::text<>c->>'kind' or not con.convalidated or con.connoinherit is distinct from ((c->>'kind') in('p','u','f')) or not con.conislocal or con.coninhcount<>0 or con.condeferrable or con.condeferred then raise exception 'merchant_attendance_reminder_installation_conflict:constraint:%',c->>'name';end if;
   if con.contype='c' then
    if (select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(pg_get_expr(con.conbin,t),'''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) is distinct from (select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(c->>'expression','''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) then raise exception 'merchant_attendance_reminder_installation_conflict:check:%',c->>'name';end if;
   else
    select array_agg(a.attname::text order by z.ord) into keys from unnest(con.conkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=t and a.attnum=z.n;
    if keys is distinct from array(select jsonb_array_elements_text(c->'keys')) then raise exception 'merchant_attendance_reminder_installation_conflict:keys:%',c->>'name';end if;
    if con.contype='f' then
     select array_agg(a.attname::text order by z.ord) into refkeys from unnest(con.confkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=z.n;
     if con.confrelid is distinct from to_regclass(format('%I.%I',ns,c->>'reference')) or refkeys is distinct from array(select jsonb_array_elements_text(c->'referenceKeys')) or con.confmatchtype<>'s' or con.confupdtype<>'a' or con.confdeltype<>'a' then raise exception 'merchant_attendance_reminder_installation_conflict:foreign_key:%',c->>'name';end if;
    else
     select * into idx from pg_index where indexrelid=con.conindid;
     if idx.indexrelid is null or not(idx.indisvalid and idx.indisready and idx.indislive and idx.indisunique) or idx.indpred is not null or idx.indexprs is not null or idx.indnullsnotdistinct or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or idx.indisprimary<>(con.contype='p')
      or not exists(select 1 from pg_class v join pg_am a on a.oid=v.relam where v.oid=idx.indexrelid and v.relowner=owner_id and a.amname='btree')
      or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z] join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_reminder_installation_conflict:constraint_index:%',c->>'name';end if;
    end if;
   end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3 then raise exception 'merchant_attendance_reminder_installation_conflict:trigger_inventory:%',spec->>'name';end if;
  for tr in select * from pg_trigger where tgrelid=t and not tgisinternal loop
   if tr.tgname not in('reminder_immutable','reminder_no_truncate','reminder_proof') or tr.tgenabled<>'O' or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null
    or tr.tgfoid is distinct from to_regprocedure(format('%I.%I()',ns,(case when tr.tgname='reminder_proof' then 'faolla_attendance_reminder_deferred_v1' else 'faolla_attendance_reminder_guard_v1' end)))
    or tr.tgtype<>(case when tr.tgname='reminder_no_truncate' then 34 when tr.tgname='reminder_immutable' then 31 when spec->>'name'='merchant_attendance_reminder_heads' then 21 else 5 end)
    or tr.tgdeferrable<>(tr.tgname='reminder_proof') or tr.tginitdeferred<>(tr.tgname='reminder_proof') or (tr.tgconstraint<>0)<>(tr.tgname='reminder_proof') then raise exception 'merchant_attendance_reminder_installation_conflict:trigger:%',tr.tgname;end if;
  end loop;
  if (select count(*) from pg_index where indrelid=t)<>(select count(*) from jsonb_array_elements(spec->'constraints') constraint_item where constraint_item->>'kind' in('p','u'))+(select count(*) from jsonb_array_elements($reminder_postconditions_indexes$[{"name":"reminder_due_idx","table":"merchant_attendance_reminder_heads","keys":["merchant_id","next_due_at","plan_id"],"unique":false,"predicate":"state='active'"},{"name":"reminder_plan_budget_idx","table":"merchant_attendance_reminder_plans","keys":["merchant_id","budget_key","recorded_at","plan_id"],"unique":false,"predicate":null},{"name":"reminder_recipient_idx","table":"merchant_attendance_reminder_batches","keys":["merchant_id","recipient_auth_user_id","recorded_at","batch_id"],"unique":false,"predicate":null},{"name":"reminder_first_read_idx","table":"merchant_attendance_reminder_operations","keys":["merchant_id","batch_id","actor_id","recorded_at","operation_id"],"unique":false,"predicate":"action='mark_read'"},{"name":"reminder_delivery_budget_uq","table":"merchant_attendance_reminder_events","keys":["merchant_id","budget_key","ordinal"],"unique":true,"predicate":"action='delivery'"},{"name":"reminder_delivery_plan_uq","table":"merchant_attendance_reminder_events","keys":["merchant_id","plan_id","ordinal"],"unique":true,"predicate":"action='delivery'"},{"name":"reminder_run_event_idx","table":"merchant_attendance_reminder_events","keys":["merchant_id","run_operation_id","event_id"],"unique":false,"predicate":"run_operation_id is not null"}]$reminder_postconditions_indexes$::jsonb) index_item where index_item->>'table'=spec->>'name') then raise exception 'merchant_attendance_reminder_installation_conflict:index_inventory:%',spec->>'name';end if;
 end loop;
 for ix in select value from jsonb_array_elements($reminder_postconditions_indexes$[{"name":"reminder_due_idx","table":"merchant_attendance_reminder_heads","keys":["merchant_id","next_due_at","plan_id"],"unique":false,"predicate":"state='active'"},{"name":"reminder_plan_budget_idx","table":"merchant_attendance_reminder_plans","keys":["merchant_id","budget_key","recorded_at","plan_id"],"unique":false,"predicate":null},{"name":"reminder_recipient_idx","table":"merchant_attendance_reminder_batches","keys":["merchant_id","recipient_auth_user_id","recorded_at","batch_id"],"unique":false,"predicate":null},{"name":"reminder_first_read_idx","table":"merchant_attendance_reminder_operations","keys":["merchant_id","batch_id","actor_id","recorded_at","operation_id"],"unique":false,"predicate":"action='mark_read'"},{"name":"reminder_delivery_budget_uq","table":"merchant_attendance_reminder_events","keys":["merchant_id","budget_key","ordinal"],"unique":true,"predicate":"action='delivery'"},{"name":"reminder_delivery_plan_uq","table":"merchant_attendance_reminder_events","keys":["merchant_id","plan_id","ordinal"],"unique":true,"predicate":"action='delivery'"},{"name":"reminder_run_event_idx","table":"merchant_attendance_reminder_events","keys":["merchant_id","run_operation_id","event_id"],"unique":false,"predicate":"run_operation_id is not null"}]$reminder_postconditions_indexes$::jsonb) loop
  select * into idx from pg_index where indexrelid=to_regclass(format('%I.%I',ns,ix->>'name'));if installed<>(idx.indexrelid is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:index:%',ix->>'name';end if;if not installed then continue;end if;
  t:=to_regclass(format('%I.%I',ns,ix->>'table'));keys:=array(select jsonb_array_elements_text(ix->'keys'));
  if idx.indrelid<>t or not(idx.indisvalid and idx.indisready and idx.indislive) or idx.indisunique<>(ix->>'unique')::boolean or idx.indisprimary or idx.indisexclusion or idx.indnullsnotdistinct or idx.indexprs is not null or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys)
   or (select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(pg_get_expr(idx.indpred,t),'''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) is distinct from (select string_agg((case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end),'' order by z.ord) from regexp_matches(regexp_replace(ix->>'predicate','''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord))
   or not exists(select 1 from pg_class v join pg_am a on a.oid=v.relam where v.oid=idx.indexrelid and v.relowner=owner_id and a.amname='btree')
   or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z] join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_reminder_installation_conflict:index:%',ix->>'name';end if;
 end loop;
 if installed then
  for spec in select value from jsonb_array_elements($reminder_postconditions_functions$[{"name":"faolla_attendance_reminder_id_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"uuid","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"addb44f8b3fbb33610adda8e583738966adb33f97ebb87795fdddfaccd5f44c2","defaultExpression":null},{"name":"faolla_attendance_reminder_config_v1","types":"jsonb,text","argumentNames":["p_source","p_category"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"5d737b34f4bc38d6f68e43b2dd5cd91572782c0aa3a0daeefdff52880ebd2dd2","defaultExpression":null},{"name":"faolla_attendance_reminder_config_layers_v1","types":"jsonb,text","argumentNames":["p_layers","p_category"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"ccc252d6180747cc4d9cbe5bc0509307845e702691c4c35c09b9cd6a7c51959d","defaultExpression":null},{"name":"faolla_attendance_reminder_head_v1","types":"public.merchant_attendance_reminder_heads","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"0ad15d99b26b3ca7c5e0b16ee20696062c2746c0219be59be6897106e5f91dd7","defaultExpression":null},{"name":"faolla_attendance_reminder_eligible_v1","types":"public.merchant_attendance_reminder_plans,timestamptz","argumentNames":["p","p_at"],"defaults":0,"resultType":"text","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"e098e5885e5dfaf2e53f074deb833a4ce7e99e984c6a93bade10c12aea3737e4","defaultExpression":null},{"name":"faolla_attendance_reminder_qualify_v1","types":"public.merchant_attendance_reminder_plans,timestamptz","argumentNames":["p","p_at"],"defaults":0,"resultType":"text","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"473addf4892f0a776c9c63105466a482194c0b0b72b214336da9d98f96878e57","defaultExpression":null},{"name":"faolla_attendance_reminder_advance_v1","types":"public.merchant_attendance_reminder_plans,text,timestamptz,text,timestamptz,uuid,jsonb,uuid","argumentNames":["p","p_action","p_at","p_state","p_due","p_batch","p_item","p_operation"],"defaults":1,"resultType":"void","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"0a486f4b48d90948aa00b6e4555ab7c49ae9e41a5814c3014b3a60fe2b7fc287","defaultExpression":"NULL::uuid"},{"name":"faolla_attendance_reminder_capture_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"06ffebf88abd0f233b9d26ecf77fdbbc5e646d582ec110d33c682ccddcb04f5f","defaultExpression":null},{"name":"faolla_attendance_reminder_command_v1","types":"text,text,uuid,jsonb","argumentNames":["p_site","p_kind","p_actor","p_command"],"defaults":0,"resultType":"text","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"dd544846a248bdbf2ca14456007a47b4700bf510109e87ffa722682e246d3040","defaultExpression":null},{"name":"faolla_attendance_reminder_receipt_v1","types":"public.merchant_attendance_reminder_operations","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"d0a7431e6000983a97b67adbf229d891b3aabfbba97804df446fdb5e2718106b","defaultExpression":null},{"name":"faolla_attendance_reminder_run_v1","types":"text,text,uuid,jsonb,boolean","argumentNames":["p_site","p_kind","p_actor","p_command","p_allow"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"251e587468e8176014ee4f8acbfb108196d4d5292cf62e6d33c3dbe55446b48c","defaultExpression":null},{"name":"faolla_attendance_reminder_recipient_v1","types":"public.merchant_attendance_reminder_batches,uuid","argumentNames":["p","p_actor"],"defaults":0,"resultType":"void","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"9c5088bc85a0cea069a2273756e884e2682054534a02f41610ab6a917625274d","defaultExpression":null},{"name":"faolla_attendance_reminder_batch_v1","types":"public.merchant_attendance_reminder_batches,uuid,boolean","argumentNames":["p","p_actor","p_detail"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"02e854dbb8876c1cc234ca4d4633d125ded82574875de588b9c074fad671b29f","defaultExpression":null},{"name":"faolla_attendance_reminders_v1","types":"jsonb,uuid,jsonb,boolean","argumentNames":["p_query","p_auth_user_id","p_command","p_allow_write"],"defaults":2,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"3d32b6b7c6f5eaef0b5aa7edb1262d52c04b53591c34debc4cafac4395d4e945","defaultExpression":"NULL::jsonb, false"},{"name":"faolla_attendance_reminders_run_v1","types":"jsonb,boolean","argumentNames":["p_query","p_allow_run"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"c798f0fe940b0107ae8cfbc76d84af85821bd13437ea3e28fbe87a6a25529d70","defaultExpression":"false"},{"name":"faolla_attendance_reminder_plan_proof_v1","types":"public.merchant_attendance_reminder_plans","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"bed800a5692bb335a5a22f8fbd7065644cdb5edf6942a4a797cd46c92c9389c8","defaultExpression":null},{"name":"faolla_attendance_reminder_batch_proof_v1","types":"public.merchant_attendance_reminder_batches","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1e647e5feea6e0591201295a1d8a1a25ff892e0bde70578f182a77751724fec8","defaultExpression":null},{"name":"faolla_attendance_reminder_event_proof_v1","types":"public.merchant_attendance_reminder_events","argumentNames":["p"],"defaults":0,"resultType":"void","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"cf0a21575ca3e1552dd2325f21fee0edeb0b6dea387359375b50e1c5951a1008","defaultExpression":null},{"name":"faolla_attendance_reminder_guard_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1b229f813a30bb287b0600f4c30ecfcbed0945f83f098c9533f7d782ad5ab6d1","defaultExpression":null},{"name":"faolla_attendance_reminder_deferred_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"1b6c37d226e746cab05ff29cad196d0d062f24bb5903d66ef5c76dd24cc7969a","defaultExpression":null}]$reminder_postconditions_functions$::jsonb) loop
   select * into f from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));expected_hash:=spec->>'hash';
  if f.oid is null or f.proowner<>owner_id or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.provolatile::text<>spec->>'volatility'
   or (select lanname from pg_language where oid=f.prolang)<>spec->>'language' or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.proretset or f.proisstrict or f.proleakproof or f.prokind<>'f' or f.proparallel<>'u' or f.provariadic<>0 or f.proargmodes is not null or f.proallargtypes is not null
   or f.pronargs<>jsonb_array_length(spec->'argumentNames') or f.procost<>100 or f.prorows<>0 or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or f.pronargdefaults<>(spec->>'defaults')::integer or pg_get_expr(f.proargdefaults,0) is distinct from spec->>'defaultExpression'
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash then raise exception 'merchant_attendance_reminder_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if (has_function_privilege(owner_id,f.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(owner_id,owner_id,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(owner_id,0::oid,'EXECUTE',false),jsonb_build_array(owner_id,owner_id,'EXECUTE',false)))) then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
  elsif exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>owner_id or a.privilege_type<>'EXECUTE' or a.is_grantable
    or a.grantee<>owner_id and (not(spec->>'serviceExecute')::boolean or a.grantee<>(select oid from pg_roles where rolname='service_role')))
   or (select count(*) from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))))<>(case when (spec->>'serviceExecute')::boolean then 2 else 1 end)
   or not has_function_privilege(owner_id,f.oid,'EXECUTE') or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from (spec->>'serviceExecute')::boolean then raise exception 'merchant_attendance_reminder_installation_conflict:function_acl:%',spec->>'name';end if;
  end loop;
 end if;
 for spec in select value from jsonb_array_elements($reminder_postconditions_captures$[{"table":"merchant_attendance_operational_punch_sessions","type":5,"deferred":false},{"table":"merchant_attendance_review_responsibility_heads","type":21,"deferred":true},{"table":"merchant_attendance_cycle_operations","type":5,"deferred":true}]$reminder_postconditions_captures$::jsonb) loop
  select * into tr from pg_trigger where tgrelid=to_regclass(format('%I.%I',ns,spec->>'table')) and tgname='reminder_capture';
  if installed<>(tr.oid is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:capture:%',spec->>'table';end if;
  if installed and (tr.tgfoid is distinct from to_regprocedure(format('%I.faolla_attendance_reminder_capture_v1()',ns)) or tr.tgtype<>(spec->>'type')::integer or tr.tgenabled<>'O' or tr.tgdeferrable<>(spec->>'deferred')::boolean or tr.tginitdeferred<>(spec->>'deferred')::boolean or (tr.tgconstraint<>0)<>(spec->>'deferred')::boolean or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null) then raise exception 'merchant_attendance_reminder_installation_conflict:capture:%',spec->>'table';end if;
 end loop;
end;
$reminder_postconditions$;
-- END REMINDER FINALIZE
commit;
