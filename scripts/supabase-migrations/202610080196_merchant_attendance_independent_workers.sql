--196 C04-A: new independent subjects, never fabricated membership/Auth.
--SOURCE candidate/default off. No history adoption, nullable retrofit or backfill.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $independent_prerequisites$
declare installed boolean;n text;
begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610010106 and name='merchant_attendance_pin_credentials') then
  raise exception 'merchant_attendance_independent_prerequisite_required';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name<>'merchant_attendance_independent_workers') then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080196);
 foreach n in array array['independent_subjects','independent_entries','independent_credentials','independent_leases','independent_event_sources','independent_member_bindings'] loop
  if installed<>(to_regclass('public.merchant_attendance_'||n) is not null) then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 end loop;
end;
$independent_prerequisites$;

do $independent_preflight$
declare installed boolean;ns text;expected_owner oid;spec jsonb;col jsonb;c jsonb;ix jsonb;f pg_proc%rowtype;t regclass;con pg_constraint%rowtype;idx pg_index%rowtype;
 actual jsonb;keys text[];refkeys text[];expected_hash text;signature text;has190 boolean;tr record;count_expected integer;
begin
 select n.nspname into ns from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.faolla_schema_migrations'::regclass;
 expected_owner:=(select oid from pg_roles where rolname=current_user);
 if exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name<>'merchant_attendance_independent_workers') then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name='merchant_attendance_independent_workers');
 
 if exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations') then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 for spec in select value from jsonb_array_elements($independent_preflight_dependencies$[{"name":"faolla_attendance_control_day_boundary_v1","types":"date,text","argumentNames":["p_date","p_zone"],"defaults":0,"resultType":"timestamptz","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"6c1479bd60a7349acc92fe7a2b7552509751e65be5651cc48d102c00834164a8","source":"202609300084_merchant_attendance_correction_controls.sql"},{"name":"faolla_attendance_group_date_v1","types":"text,text","argumentNames":["p","z"],"defaults":1,"resultType":"boolean","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","source":"202610030124_merchant_attendance_groups.sql"},{"name":"faolla_attendance_group_text_v1","types":"text,integer,integer","argumentNames":["p","lo","hi"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","source":"202610030124_merchant_attendance_groups.sql"},{"name":"faolla_attendance_operational_punch_stamp_v1","types":"timestamptz","argumentNames":["p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_rule_hash_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_rule_object_v1","types":"jsonb,text[]","argumentNames":["p","ks"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_rule_scalar_v1","types":"jsonb,text","argumentNames":["p","k"],"defaults":0,"resultType":"boolean","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_terminal_device_v1","types":"text,uuid,text,text,boolean","argumentNames":["p_site","p_id","p_secret_hash","p_device_hash","p_allow_pair"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"268246908e643bebaba3519ae75117ef677d787de57535f571bee8d929ca7e99","source":"202610010104_merchant_attendance_terminals.sql"},{"name":"faolla_valid_merchant_enterprise_permissions_v1","types":"text[]","argumentNames":["p_permissions"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog, public"],"serviceExecute":false,"hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","source":"202610080190_merchant_attendance_correction_delegation_permission.sql","legacyHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc"},{"name":"faolla_attendance_operational_punch_core_self_v1","types":"text,uuid,jsonb,uuid,jsonb","oldHash":"f973638ea35c96cc4b985f38be28944cb14b4431faf25f9257224385b6dae02a","newHash":"e727b905e679330a066722a41d0c45c893ce5f7b27d68d007bc2a07c86950995","argumentNames":["p_site_id","p_auth_user_id","p_command","p_operation_id","p_intent"],"defaults":3,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":null},{"name":"faolla_attendance_operational_punch_core_pin_v1","types":"text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb","oldHash":"efb61fde492e2ff04de46ee6ab132fcdd01a2dc1494b8d87da6b8c24c7c89580","newHash":"727b4f342048d27213d97b8c866451235f2742d9caea95b5413c161854a46de7","argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_verified","p_request","p_allow_new","p_intent"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":null},{"name":"faolla_attendance_pin_schedule_v1","types":"text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean","oldHash":"bf2960c1c02831214ef55e9086dd692f7c3c4df16d7d1ebe02cb1fc7797cb1f4","newHash":"3bcf5680fd0db0e264773a6c51a3520d52abe20cc097cb9afef35e5a9d8c8e43","argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_verified","p_request","p_allow_new","p_selection","p_allow_schedule","p_bind_rules"],"defaults":3,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"serviceExecute":true,"config":["search_path=pg_catalog"],"hash":null},{"name":"faolla_attendance_operational_punch_core_onsite_v1","types":"text,uuid,jsonb,jsonb,uuid,boolean,jsonb","oldHash":"69dc67947b006f51b6ff278bd792eda134343666371a49cda5d677be7d9372ab","newHash":"d69fd7357056805bf06c1e3c69f3dc7bfbf765dd93993d0214df78a3fac3e656","argumentNames":["p_site","p_auth","p_claims","p_command","p_operation","p_allow_new","p_intent"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":null},{"name":"faolla_attendance_operational_punch_core_location_v1","types":"text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb","oldHash":"119ae50e697c068a27aeab6343db303faf7383ac9f1f06da65dcea187c6170ef","newHash":"ef07a7f2c161e441c0ad83568ecab882448589a3e584002adf4136cbb45d7580","argumentNames":["p_site_id","p_auth_user_id","p_expected_worker_id","p_command","p_operation_id","p_assertion","p_allow_new_sessions","p_require_clock","p_intent"],"defaults":6,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":null},{"name":"faolla_attendance_operational_punch_core_location_v2","types":"text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb","oldHash":"8e100afb65a53d2b042297419aeb50419033011158e4e7a4671929259bd595b2","newHash":"26c882df63eba5f4d94a8cd8116f9767f9ba550a3ef17bec99d09f5c26294a0f","argumentNames":["p_site_id","p_auth_user_id","p_expected_worker_id","p_command","p_operation_id","p_assertion","p_allow_new_sessions","p_require_clock","p_intent"],"defaults":6,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":null},{"name":"faolla_attendance_operating_head_v1","types":"text,uuid","oldHash":"a765524a5112d6ea357143839212b1a279a6b95c6b947c3e98817727b9212e3e","newHash":"f42309a7f8ca97327b95bc9e1c29ae60e2791dc43323ad5d3bee2e0f61d48085","argumentNames":["p_site","p_worker"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":null}]$independent_preflight_dependencies$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.'));
  select * into f from pg_proc where oid=to_regprocedure(signature);
  expected_hash:=coalesce(spec->>'hash',case when installed then spec->>'newHash' else spec->>'oldHash' end);
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then expected_hash:=spec->>'legacyHash';end if;
  if f.oid is null or f.proowner<>expected_owner or f.prokind<>'f' or f.proretset or f.proisstrict or f.proleakproof or f.proargmodes is not null or f.proparallel<>'u'
   or f.prolang<>(select oid from pg_language where lanname=spec->>'language') or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.provolatile::text<>spec->>'volatility' or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames')) or f.pronargdefaults<>(spec->>'defaults')::integer
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash
   then raise exception 'merchant_attendance_independent_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if (has_function_privilege(expected_owner,f.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)))) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  else
   if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE')<>(spec->>'serviceExecute')::boolean
    or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>expected_owner or a.grantee<>expected_owner and not((spec->>'serviceExecute')::boolean and a.grantee=(select oid from pg_roles where rolname='service_role') and a.privilege_type='EXECUTE' and not a.is_grantable)) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and left(proname,30)='faolla_attendance_independent_')<>(case when installed then 20 else 0 end) then raise exception 'merchant_attendance_independent_installation_conflict:function_inventory';end if;
 for spec in select value from jsonb_array_elements($independent_preflight_tables$[{"name":"merchant_attendance_independent_subjects","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"kind","type":"text","nullable":false,"default":"'independent'"},{"name":"state","type":"text","nullable":false,"default":null},{"name":"enabled","type":"boolean","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"revision","type":"bigint","nullable":false,"default":null},{"name":"created_operation_id","type":"uuid","nullable":false,"default":null},{"name":"created_by","type":"uuid","nullable":false,"default":null},{"name":"created_at","type":"timestamptz","nullable":false,"default":null},{"name":"updated_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_subjects_kind_ck1","kind":"c","expression":"kind='independent'"},{"name":"ind196_subjects_state_ck2","kind":"c","expression":"state=any(array['independent','bound'])"},{"name":"ind196_subjects_generation_ck3","kind":"c","expression":"generation>=0 and generation<=9007199254740990"},{"name":"ind196_subjects_revision_ck4","kind":"c","expression":"revision>=1 and revision<=9007199254740990"},{"name":"ind196_subjects_created_at_ck5","kind":"c","expression":"isfinite(created_at)"},{"name":"ind196_subjects_updated_at_ck6","kind":"c","expression":"isfinite(updated_at) and updated_at>=created_at"},{"name":"ind196_subjects_pk7","kind":"p","keys":["merchant_id","subject_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_subjects_uq8","kind":"u","keys":["merchant_id","worker_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_subjects_fk9","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_subjects_ck10","kind":"c","expression":"state<>'bound' or not enabled"}]},{"name":"merchant_attendance_independent_entries","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"operation_id","type":"uuid","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"action","type":"text","nullable":false,"default":null},{"name":"actor_auth_user_id","type":"uuid","nullable":false,"default":null},{"name":"command","type":"jsonb","nullable":false,"default":null},{"name":"command_fingerprint","type":"text","nullable":false,"default":null},{"name":"subject_revision","type":"bigint","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"worker_version","type":"bigint","nullable":false,"default":null},{"name":"credential_revision","type":"bigint","nullable":true,"default":null},{"name":"credential_id","type":"uuid","nullable":true,"default":null},{"name":"material_commitment","type":"text","nullable":true,"default":null},{"name":"recorded_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_entries_action_ck1","kind":"c","expression":"action=any(array['create','enable','disable','issue_pin','revoke_pin','bind_member'])"},{"name":"ind196_entries_command_fingerprint_ck2","kind":"c","expression":"command_fingerprint~'^[0-9a-f]{64}$'"},{"name":"ind196_entries_subject_revision_ck3","kind":"c","expression":"subject_revision>=1 and subject_revision<=9007199254740990"},{"name":"ind196_entries_generation_ck4","kind":"c","expression":"generation>=0 and generation<=9007199254740990"},{"name":"ind196_entries_worker_version_ck5","kind":"c","expression":"worker_version>=1 and worker_version<=9007199254740990"},{"name":"ind196_entries_credential_revision_ck6","kind":"c","expression":"credential_revision>=0 and credential_revision<=9007199254740990"},{"name":"ind196_entries_material_commitment_ck7","kind":"c","expression":"material_commitment~'^[0-9a-f]{64}$'"},{"name":"ind196_entries_recorded_at_ck8","kind":"c","expression":"isfinite(recorded_at)"},{"name":"ind196_entries_pk9","kind":"p","keys":["merchant_id","operation_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_entries_uq10","kind":"u","keys":["merchant_id","subject_id","subject_revision"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_entries_fk11","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_entries_fk12","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_entries_ck13","kind":"c","expression":"(action='issue_pin')=(material_commitment is not null)"},{"name":"ind196_entries_ck14","kind":"c","expression":"(action='issue_pin')=(credential_id is not null)"}]},{"name":"merchant_attendance_independent_credentials","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"credential_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"revision","type":"bigint","nullable":false,"default":null},{"name":"enabled","type":"boolean","nullable":false,"default":null},{"name":"salt","type":"text","nullable":true,"default":null},{"name":"verifier","type":"text","nullable":true,"default":null},{"name":"issue_operation_id","type":"uuid","nullable":false,"default":null},{"name":"changed_at","type":"timestamptz","nullable":false,"default":null},{"name":"attempts","type":"integer","nullable":false,"default":"0"},{"name":"window_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_credentials_generation_ck1","kind":"c","expression":"generation>=0 and generation<=9007199254740990"},{"name":"ind196_credentials_revision_ck2","kind":"c","expression":"revision>=1 and revision<=9007199254740990"},{"name":"ind196_credentials_changed_at_ck3","kind":"c","expression":"isfinite(changed_at)"},{"name":"ind196_credentials_attempts_ck4","kind":"c","expression":"attempts>=0 and attempts<=10"},{"name":"ind196_credentials_window_at_ck5","kind":"c","expression":"isfinite(window_at)"},{"name":"ind196_credentials_pk6","kind":"p","keys":["merchant_id","subject_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_credentials_uq7","kind":"u","keys":["merchant_id","credential_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_credentials_fk8","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_credentials_fk9","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_credentials_fk10","kind":"f","keys":["merchant_id","issue_operation_id"],"reference":"merchant_attendance_independent_entries","referenceKeys":["merchant_id","operation_id"],"deferred":true,"initiallyDeferred":true,"delete":"a"},{"name":"ind196_credentials_ck11","kind":"c","expression":"(enabled and salt~'^[0-9a-f]{32}$' and verifier~'^[0-9a-f]{64}$' and salt is not null and verifier is not null)\n  or (not enabled and salt is null and verifier is null)"}]},{"name":"merchant_attendance_independent_leases","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"terminal_id","type":"uuid","nullable":false,"default":null},{"name":"lease_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"worker_version","type":"bigint","nullable":false,"default":null},{"name":"credential_id","type":"uuid","nullable":false,"default":null},{"name":"credential_revision","type":"bigint","nullable":false,"default":null},{"name":"budget_window","type":"timestamptz","nullable":false,"default":null},{"name":"budget_ordinal","type":"integer","nullable":false,"default":null},{"name":"created_at","type":"timestamptz","nullable":false,"default":null},{"name":"expires_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_leases_versions_ck","kind":"c","expression":"generation>=0 and generation<=9007199254740990 and worker_version>=1 and worker_version<=9007199254740990 and credential_revision>=1 and credential_revision<=9007199254740990"},{"name":"ind196_leases_budget_window_ck1","kind":"c","expression":"isfinite(budget_window)"},{"name":"ind196_leases_budget_ordinal_ck2","kind":"c","expression":"budget_ordinal>=1 and budget_ordinal<=60"},{"name":"ind196_leases_created_at_ck3","kind":"c","expression":"isfinite(created_at)"},{"name":"ind196_leases_pk4","kind":"p","keys":["merchant_id","terminal_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_leases_uq5","kind":"u","keys":["merchant_id","lease_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_leases_ck6","kind":"c","expression":"expires_at=created_at+'00:00:30'::interval"},{"name":"ind196_leases_fk7","kind":"f","keys":["merchant_id","terminal_id"],"reference":"merchant_attendance_terminals","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_leases_fk8","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_leases_fk9","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"}]},{"name":"merchant_attendance_independent_event_sources","columns":[{"name":"event_id","type":"uuid","nullable":false,"default":null},{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"operation_id","type":"uuid","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"credential_id","type":"uuid","nullable":false,"default":null},{"name":"credential_revision","type":"bigint","nullable":false,"default":null},{"name":"credential_issue_operation_id","type":"uuid","nullable":false,"default":null},{"name":"terminal_id","type":"uuid","nullable":false,"default":null},{"name":"worker_version","type":"bigint","nullable":false,"default":null},{"name":"settings_version","type":"bigint","nullable":false,"default":null},{"name":"location_version","type":"bigint","nullable":false,"default":null},{"name":"command","type":"jsonb","nullable":false,"default":null},{"name":"command_fingerprint","type":"text","nullable":false,"default":null},{"name":"recorded_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_event_sources_pk1","kind":"p","keys":["event_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_event_sources_event_id_fk2","kind":"f","keys":["event_id"],"reference":"merchant_attendance_events","referenceKeys":["id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_event_sources_generation_ck3","kind":"c","expression":"generation>=0 and generation<=9007199254740990"},{"name":"ind196_event_sources_credential_revision_ck4","kind":"c","expression":"credential_revision>=1 and credential_revision<=9007199254740990"},{"name":"ind196_event_sources_versions_ck","kind":"c","expression":"worker_version>=1 and worker_version<=9007199254740990 and settings_version>=1 and settings_version<=9007199254740990 and location_version>=1 and location_version<=9007199254740990"},{"name":"ind196_event_sources_command_fingerprint_ck5","kind":"c","expression":"command_fingerprint~'^[0-9a-f]{64}$'"},{"name":"ind196_event_sources_recorded_at_ck6","kind":"c","expression":"isfinite(recorded_at)"},{"name":"ind196_event_sources_uq7","kind":"u","keys":["merchant_id","worker_id","operation_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_event_sources_fk8","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_event_sources_fk9","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_event_sources_fk10","kind":"f","keys":["merchant_id","credential_issue_operation_id"],"reference":"merchant_attendance_independent_entries","referenceKeys":["merchant_id","operation_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_event_sources_fk11","kind":"f","keys":["merchant_id","terminal_id"],"reference":"merchant_attendance_terminals","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"}]},{"name":"merchant_attendance_independent_member_bindings","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"operation_id","type":"uuid","nullable":false,"default":null},{"name":"employee_id","type":"uuid","nullable":false,"default":null},{"name":"employee_auth_user_id","type":"uuid","nullable":false,"default":null},{"name":"worker_version","type":"bigint","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"last_independent_event_id","type":"uuid","nullable":true,"default":null},{"name":"last_sequence","type":"bigint","nullable":false,"default":null},{"name":"actor_auth_user_id","type":"uuid","nullable":false,"default":null},{"name":"command_fingerprint","type":"text","nullable":false,"default":null},{"name":"bound_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_member_bindings_versions_ck","kind":"c","expression":"worker_version>=2 and worker_version<=9007199254740990 and generation>=1 and generation<=9007199254740990"},{"name":"ind196_member_bindings_last_independent_event_id_fk1","kind":"f","keys":["last_independent_event_id"],"reference":"merchant_attendance_events","referenceKeys":["id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_member_bindings_last_sequence_ck2","kind":"c","expression":"last_sequence>=0 and last_sequence<=9007199254740990"},{"name":"ind196_member_bindings_command_fingerprint_ck3","kind":"c","expression":"command_fingerprint~'^[0-9a-f]{64}$'"},{"name":"ind196_member_bindings_bound_at_ck4","kind":"c","expression":"isfinite(bound_at)"},{"name":"ind196_member_bindings_pk5","kind":"p","keys":["merchant_id","subject_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_member_bindings_uq6","kind":"u","keys":["merchant_id","worker_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_member_bindings_uq7","kind":"u","keys":["merchant_id","operation_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_member_bindings_fk8","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_member_bindings_fk9","kind":"f","keys":["merchant_id","operation_id"],"reference":"merchant_attendance_independent_entries","referenceKeys":["merchant_id","operation_id"],"deferred":true,"initiallyDeferred":true,"delete":"a"},{"name":"ind196_member_bindings_fk10","kind":"f","keys":["merchant_id","employee_id"],"reference":"merchant_enterprise_employees","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_member_bindings_ck11","kind":"c","expression":"(last_sequence=0)=(last_independent_event_id is null)"}]}]$independent_preflight_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));
  if installed<>(t is not null) then raise exception 'merchant_attendance_independent_installation_conflict:table:%',spec->>'name';end if;
  if not installed then continue;end if;
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity and relpersistence='p' and not relispartition)
   or exists(select 1 from pg_policy where polrelid=t)
   or exists(select 1 from pg_class v cross join lateral aclexplode(coalesce(v.relacl,acldefault('r',v.relowner))) a where v.oid=t and (a.grantee<>expected_owner or a.grantor<>expected_owner))
   or exists(select 1 from pg_attribute v cross join lateral aclexplode(v.attacl) a where v.attrelid=t and (a.grantee<>expected_owner or a.grantor<>expected_owner)) then raise exception 'merchant_attendance_independent_installation_conflict:table_acl:%',spec->>'name';end if;
  if (select count(*) from pg_attribute where attrelid=t and attnum>0)<>jsonb_array_length(spec->'columns') then raise exception 'merchant_attendance_independent_installation_conflict:columns:%',spec->>'name';end if;
  count_expected:=0;
  for col in select value from jsonb_array_elements(spec->'columns') loop
   count_expected:=count_expected+1;
   if not exists(select 1 from pg_attribute a join pg_type ty on ty.oid=a.atttypid left join pg_attrdef d on d.adrelid=t and d.adnum=a.attnum
    where a.attrelid=t and a.attnum=count_expected and a.attname=col->>'name' and a.atttypid=to_regtype(col->>'type') and a.atttypmod=-1
    and not a.attisdropped and a.attidentity='' and a.attgenerated='' and a.attnotnull=(not(col->>'nullable')::boolean) and a.attcollation=ty.typcollation
    and (select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(pg_get_expr(d.adbin,t),'''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) is not distinct from (select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(col->>'default','''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord))) then raise exception 'merchant_attendance_independent_installation_conflict:column:%.%',spec->>'name',col->>'name';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=t)<>jsonb_array_length(spec->'constraints') then raise exception 'merchant_attendance_independent_installation_conflict:constraints:%',spec->>'name';end if;
  for c in select value from jsonb_array_elements(spec->'constraints') loop
   select * into con from pg_constraint where conrelid=t and conname=c->>'name';
   if coalesce(c->>'kind','') not in('c','p','u','f') or con.oid is null or con.contype::text<>c->>'kind' or not con.convalidated
    or con.connoinherit is distinct from ((c->>'kind') in('p','u','f')) or con.conislocal is distinct from true or con.coninhcount<>0
    or con.condeferrable<>coalesce((c->>'deferred')::boolean,false) or con.condeferred<>coalesce((c->>'initiallyDeferred')::boolean,false) then raise exception 'merchant_attendance_independent_installation_conflict:constraint:%.%',spec->>'name',c->>'name';end if;
   if con.contype='c' then
    if (select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(pg_get_expr(con.conbin,t),'''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) is distinct from (select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(c->>'expression','''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) then raise exception 'merchant_attendance_independent_installation_conflict:check:%.%',spec->>'name',c->>'name';end if;
   else
    select array_agg(a.attname::text order by z.ord) into keys from unnest(con.conkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=t and a.attnum=z.n;
    if keys is distinct from array(select jsonb_array_elements_text(c->'keys')) then raise exception 'merchant_attendance_independent_installation_conflict:constraint_keys:%',c->>'name';end if;
    if con.contype='f' then
     select array_agg(a.attname::text order by z.ord) into refkeys from unnest(con.confkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=z.n;
     if con.confrelid is distinct from to_regclass(format('%I.%I',ns,c->>'reference')) or refkeys is distinct from array(select jsonb_array_elements_text(c->'referenceKeys'))
      or con.confmatchtype<>'s' or con.confupdtype<>'a' or con.confdeltype::text<>c->>'delete' then raise exception 'merchant_attendance_independent_installation_conflict:foreign_key:%',c->>'name';end if;
    else
     select * into idx from pg_index where indexrelid=con.conindid;
     if idx.indexrelid is null or not(idx.indisvalid and idx.indisready and idx.indislive and idx.indisunique) or idx.indpred is not null or idx.indexprs is not null
      or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or idx.indnullsnotdistinct
      or not exists(select 1 from pg_class z join pg_am a on a.oid=z.relam where z.oid=idx.indexrelid and z.relowner=expected_owner and a.amname='btree')
      or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z]
       join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_independent_installation_conflict:constraint_index:%',c->>'name';end if;
    end if;
   end if;
  end loop;
  count_expected:=case when spec->>'name' in('merchant_attendance_independent_entries','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings') then 2 else 0 end;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>count_expected then raise exception 'merchant_attendance_independent_installation_conflict:triggers:%',spec->>'name';end if;
  for tr in select * from pg_trigger where tgrelid=t and not tgisinternal loop
   if tr.tgname not in('independent_immutable','independent_no_truncate') or tr.tgfoid<>to_regprocedure(format('%I.faolla_attendance_independent_guard_v1()',ns))
    or tr.tgtype<>(case when tr.tgname='independent_immutable' then 31 else 34 end) or tr.tgenabled<>'O' or tr.tgdeferrable or tr.tginitdeferred
    or tr.tgconstraint<>0 or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null then raise exception 'merchant_attendance_independent_installation_conflict:trigger:%',tr.tgname;end if;
  end loop;
  if (select count(*) from pg_index where indrelid=t)<>(select count(*) from jsonb_array_elements(spec->'constraints') v where v->>'kind' in('p','u'))
   +(case when spec->>'name' in('merchant_attendance_independent_leases','merchant_attendance_independent_event_sources') then 1 else 0 end) then raise exception 'merchant_attendance_independent_installation_conflict:index_inventory:%',spec->>'name';end if;
 end loop;
 for ix in select value from jsonb_array_elements($independent_preflight_indexes$[{"name":"attendance_independent_lease_subject_idx","table":"merchant_attendance_independent_leases","keys":["merchant_id","subject_id","terminal_id"]},{"name":"attendance_independent_source_subject_idx","table":"merchant_attendance_independent_event_sources","keys":["merchant_id","subject_id","event_id"]}]$independent_preflight_indexes$::jsonb) loop
  select * into idx from pg_index where indexrelid=to_regclass(format('%I.%I',ns,ix->>'name'));
  if installed<>(idx.indexrelid is not null) then raise exception 'merchant_attendance_independent_installation_conflict:index:%',ix->>'name';end if;
  if not installed then continue;end if;
  select array_agg(a.attname::text order by z.ord) into keys from unnest(idx.indkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=idx.indrelid and a.attnum=z.n;
  if idx.indrelid<>to_regclass(format('%I.%I',ns,ix->>'table')) or keys is distinct from array(select jsonb_array_elements_text(ix->'keys'))
   or not(idx.indisvalid and idx.indisready and idx.indislive) or idx.indisunique or idx.indisprimary or idx.indpred is not null or idx.indexprs is not null
   or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or not exists(select 1 from pg_class z join pg_am a on a.oid=z.relam where z.oid=idx.indexrelid and z.relowner=expected_owner and a.amname='btree')
   or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=idx.indrelid and a.attname=keys[z]
    join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_independent_installation_conflict:index_shape:%',ix->>'name';end if;
 end loop;
 if not installed then return;end if;
 for spec in select value from jsonb_array_elements($independent_preflight_functions$[{"name":"faolla_attendance_independent_scalar_v1","types":"jsonb,text","argumentNames":["p","k"],"defaults":0,"resultType":"boolean","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"a3a0121cbb19210074802f404631eebc48bcaceb2f585c921a94548b9191276d"},{"name":"faolla_attendance_independent_text_v1","types":"text,integer,integer","argumentNames":["p","lo","hi"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"ac9ef43eae2eb7946af62d07d128732dcd6efbe9baeca956a9cbeabe34daa5c9"},{"name":"faolla_attendance_independent_command_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"f2e26335f15c0fdcb86e5cb7f5492c9e0f1fdf56dd03c5f60148a80f23b986ca"},{"name":"faolla_attendance_independent_clock_command_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"e32cd78012dd50709c4964a340b2d568f96ce2a98445c9cdd8a2ae2a0ee31c37"},{"name":"faolla_attendance_independent_admin_hash_v1","types":"text,uuid,jsonb","argumentNames":["p_site","p_auth","p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"654b0148881c9efafdefcaa3ece775fe0a3d1a1e8525eedc23cca2aeeb70efcb"},{"name":"faolla_attendance_independent_clock_hash_v1","types":"text,uuid,jsonb","argumentNames":["p_site","p_terminal","p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"a8a07a7b3153c18e908f00bc101a8f6fd861b362235ad9350f41c8eac03e4e61"},{"name":"faolla_attendance_independent_material_hash_v1","types":"text,uuid,uuid,bigint,bigint,uuid,text,text","argumentNames":["p_site","p_worker","p_subject","p_generation","p_revision","p_operation","p_salt","p_verifier"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"d63aa1239d9964f16a9315935d486df25fba48bd9d328ef3967ada14cea6d0b3"},{"name":"faolla_attendance_independent_subject_v1","types":"public.merchant_attendance_independent_subjects","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"8d52a2ef476f26d901b91a06b300b5a170e62387eaee03281a861c9ede2b4320"},{"name":"faolla_attendance_independent_head_v1","types":"text,uuid,uuid","argumentNames":["p_site","p_worker","p_subject"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"21eb62ecdfc08d4bf553b08aa2e895e85a9fc05c1f59610f3dccb8f72c928621"},{"name":"faolla_attendance_independent_receipt_v1","types":"public.merchant_attendance_independent_entries","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"882f13eeefc384d03eb3178648f4fa2ab1cd2890b6ed869336b5e9dbbc6df334"},{"name":"faolla_attendance_independent_clock_receipt_v1","types":"public.merchant_attendance_independent_event_sources","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"2bc9d92fa75ece3a3334ea0b88463945addcf7794b8dc07a7edfce95bec600ec"},{"name":"faolla_attendance_independent_boundary_v1","types":"public.merchant_attendance_independent_member_bindings","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"067ecfc192485c414fcf55e9345a0fb9dcf3286f8a0cb5bc7fe2e0921ab48770"},{"name":"faolla_attendance_independent_bootstrap_v1","types":"text,uuid,uuid,uuid,uuid,bigint","argumentNames":["p_site","p_worker","p_employee","p_auth","p_last","p_sequence"],"defaults":0,"resultType":"boolean","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"5d889eabedbb535958987d68ca59b85f4f2942da455566ddf938a6ebd8e74b5c"},{"name":"faolla_attendance_independent_guard_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"11a8d826bae099d9bcafad651222d8ef126f728670f16fc3143473fc42e40040"},{"name":"faolla_attendance_independent_bootstrap_intent_v1","types":"text,uuid,uuid,uuid,uuid,bigint,jsonb,uuid","argumentNames":["p_site","p_worker","p_employee","p_auth","p_last","p_sequence","p_command","p_operation"],"defaults":0,"resultType":"boolean","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"d6a4bdeca5983e68c3dd3305bb36b21e6e4513efb3ddcabfc2373fac0f1df7d7"},{"name":"faolla_attendance_independent_current_boundary_v1","types":"text,uuid","argumentNames":["p_site","p_worker"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"043f3b0f90ee92820463fa6149dfad3bbc74c05ac42729b81b739f81c15cdd81"},{"name":"faolla_attendance_independent_report_v1","types":"text,uuid,date,date,uuid","argumentNames":["p_site","p_subject","p_from","p_through","p_cursor"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"973fc3e6a226fb4f14a98097935eb6be8e0e8be52103f75adc5906447f08fbcd"},{"name":"faolla_attendance_independent_admin_v1","types":"text,uuid,jsonb,jsonb,jsonb,boolean","argumentNames":["p_site","p_auth","p_query","p_command","p_material","p_allow_new"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"95f6be0160c2b667dae62536b9c94c0abc4d76edc573c0eb7f747e0042e529bb"},{"name":"faolla_attendance_independent_begin_v1","types":"text,uuid,text,text,uuid,boolean","argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_allow_new"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"2b206a250b7c9bc3927137983ee6f239af3cd15e04a80f06615d374dc2a954ce"},{"name":"faolla_attendance_independent_finish_v1","types":"text,uuid,text,text,uuid,boolean,jsonb,boolean","argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_verified","p_request","p_allow_new"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"ca07eda14465c67359b4db6f307a7e4612f45878bcb91f3608f6b27a7786369e"}]$independent_preflight_functions$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.'));select * into f from pg_proc where oid=to_regprocedure(signature);
  if f.oid is null or f.proowner<>expected_owner or f.prokind<>'f' or f.proretset or f.proisstrict or f.proleakproof or f.proargmodes is not null or f.proparallel<>'u'
   or f.prolang<>(select oid from pg_language where lanname=spec->>'language') or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.provolatile::text<>spec->>'volatility' or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames')) or f.pronargdefaults<>(spec->>'defaults')::integer
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   then raise exception 'merchant_attendance_independent_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if (has_function_privilege(expected_owner,f.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)))) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  else
   if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE')<>(spec->>'serviceExecute')::boolean
    or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>expected_owner or a.grantee<>expected_owner and not((spec->>'serviceExecute')::boolean and a.grantee=(select oid from pg_roles where rolname='service_role') and a.privilege_type='EXECUTE' and not a.is_grantable)) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  end if;
 end loop;
end;
$independent_preflight$;

create table if not exists public.merchant_attendance_independent_subjects(
 merchant_id text not null,
 subject_id uuid not null,
 worker_id uuid not null,
 constraint ind196_subjects_kind_ck1 check(kind='independent'),
 kind text not null default 'independent',
 constraint ind196_subjects_state_ck2 check(state in('independent','bound')),
 state text not null,
 enabled boolean not null,
 constraint ind196_subjects_generation_ck3 check(generation between 0 and 9007199254740990),
 generation bigint not null,
 constraint ind196_subjects_revision_ck4 check(revision between 1 and 9007199254740990),
 revision bigint not null,
 created_operation_id uuid not null,
 created_by uuid not null,
 constraint ind196_subjects_created_at_ck5 check(isfinite(created_at)),
 created_at timestamptz not null,
 constraint ind196_subjects_updated_at_ck6 check(isfinite(updated_at) and updated_at>=created_at),
 updated_at timestamptz not null,
 constraint ind196_subjects_pk7 primary key(merchant_id,subject_id),
 constraint ind196_subjects_uq8 unique(merchant_id,worker_id),
 constraint ind196_subjects_fk9 foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
 constraint ind196_subjects_ck10 check(state<>'bound' or not enabled)
);
create table if not exists public.merchant_attendance_independent_entries(
 merchant_id text not null,
 operation_id uuid not null,
 subject_id uuid not null,
 worker_id uuid not null,
 constraint ind196_entries_action_ck1 check(action in('create','enable','disable','issue_pin','revoke_pin','bind_member')),
 action text not null,
 actor_auth_user_id uuid not null,
 command jsonb not null,
 constraint ind196_entries_command_fingerprint_ck2 check(command_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null,
 constraint ind196_entries_subject_revision_ck3 check(subject_revision between 1 and 9007199254740990),
 subject_revision bigint not null,
 constraint ind196_entries_generation_ck4 check(generation between 0 and 9007199254740990),
 generation bigint not null,
 constraint ind196_entries_worker_version_ck5 check(worker_version between 1 and 9007199254740990),
 worker_version bigint not null,
 constraint ind196_entries_credential_revision_ck6 check(credential_revision between 0 and 9007199254740990),
 credential_revision bigint,
 credential_id uuid,
 constraint ind196_entries_material_commitment_ck7 check(material_commitment~'^[0-9a-f]{64}$'),
 material_commitment text,
 constraint ind196_entries_recorded_at_ck8 check(isfinite(recorded_at)),
 recorded_at timestamptz not null,
 constraint ind196_entries_pk9 primary key(merchant_id,operation_id),
 constraint ind196_entries_uq10 unique(merchant_id,subject_id,subject_revision),
 constraint ind196_entries_fk11 foreign key(merchant_id,subject_id) references public.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_entries_fk12 foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
 constraint ind196_entries_ck13 check((action='issue_pin')=(material_commitment is not null)),
 constraint ind196_entries_ck14 check((action='issue_pin')=(credential_id is not null))
);
create table if not exists public.merchant_attendance_independent_credentials(
 merchant_id text not null,
 subject_id uuid not null,
 credential_id uuid not null,
 worker_id uuid not null,
 constraint ind196_credentials_generation_ck1 check(generation between 0 and 9007199254740990),
 generation bigint not null,
 constraint ind196_credentials_revision_ck2 check(revision between 1 and 9007199254740990),
 revision bigint not null,
 enabled boolean not null,
 salt text,
 verifier text,
 issue_operation_id uuid not null,
 constraint ind196_credentials_changed_at_ck3 check(isfinite(changed_at)),
 changed_at timestamptz not null,
 constraint ind196_credentials_attempts_ck4 check(attempts between 0 and 10),
 attempts integer not null default 0,
 constraint ind196_credentials_window_at_ck5 check(isfinite(window_at)),
 window_at timestamptz not null,
 constraint ind196_credentials_pk6 primary key(merchant_id,subject_id),
 constraint ind196_credentials_uq7 unique(merchant_id,credential_id),
 constraint ind196_credentials_fk8 foreign key(merchant_id,subject_id) references public.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_credentials_fk9 foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
 constraint ind196_credentials_fk10 foreign key(merchant_id,issue_operation_id) references public.merchant_attendance_independent_entries(merchant_id,operation_id) deferrable initially deferred,
 constraint ind196_credentials_ck11 check((enabled and salt~'^[0-9a-f]{32}$' and verifier~'^[0-9a-f]{64}$' and salt is not null and verifier is not null)
  or (not enabled and salt is null and verifier is null))
);
create table if not exists public.merchant_attendance_independent_leases(
 merchant_id text not null,
 terminal_id uuid not null,
 lease_id uuid not null,
 worker_id uuid not null,
 subject_id uuid not null,
 generation bigint not null,
 worker_version bigint not null,
 credential_id uuid not null,
 credential_revision bigint not null,
 constraint ind196_leases_versions_ck check(generation between 0 and 9007199254740990 and worker_version between 1 and 9007199254740990 and credential_revision between 1 and 9007199254740990),
 constraint ind196_leases_budget_window_ck1 check(isfinite(budget_window)),
 budget_window timestamptz not null,
 constraint ind196_leases_budget_ordinal_ck2 check(budget_ordinal between 1 and 60),
 budget_ordinal integer not null,
 constraint ind196_leases_created_at_ck3 check(isfinite(created_at)),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 constraint ind196_leases_pk4 primary key(merchant_id,terminal_id),
 constraint ind196_leases_uq5 unique(merchant_id,lease_id),
 constraint ind196_leases_ck6 check(expires_at=created_at+interval '30 seconds'),
 constraint ind196_leases_fk7 foreign key(merchant_id,terminal_id) references public.merchant_attendance_terminals(merchant_id,id) on delete restrict,
 constraint ind196_leases_fk8 foreign key(merchant_id,subject_id) references public.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_leases_fk9 foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict
);
create index if not exists attendance_independent_lease_subject_idx on public.merchant_attendance_independent_leases(merchant_id,subject_id,terminal_id);
create table if not exists public.merchant_attendance_independent_event_sources(
 constraint ind196_event_sources_pk1 primary key(event_id),
 constraint ind196_event_sources_event_id_fk2 foreign key(event_id) references public.merchant_attendance_events(id) on delete restrict,
 event_id uuid,
 merchant_id text not null,
 subject_id uuid not null,
 worker_id uuid not null,
 operation_id uuid not null,
 constraint ind196_event_sources_generation_ck3 check(generation between 0 and 9007199254740990),
 generation bigint not null,
 credential_id uuid not null,
 constraint ind196_event_sources_credential_revision_ck4 check(credential_revision between 1 and 9007199254740990),
 credential_revision bigint not null,
 credential_issue_operation_id uuid not null,
 terminal_id uuid not null,
 worker_version bigint not null,
 settings_version bigint not null,
 location_version bigint not null,
 constraint ind196_event_sources_versions_ck check(worker_version between 1 and 9007199254740990 and settings_version between 1 and 9007199254740990 and location_version between 1 and 9007199254740990),
 command jsonb not null,
 constraint ind196_event_sources_command_fingerprint_ck5 check(command_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null,
 constraint ind196_event_sources_recorded_at_ck6 check(isfinite(recorded_at)),
 recorded_at timestamptz not null,
 constraint ind196_event_sources_uq7 unique(merchant_id,worker_id,operation_id),
 constraint ind196_event_sources_fk8 foreign key(merchant_id,subject_id) references public.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_event_sources_fk9 foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id) on delete restrict,
 constraint ind196_event_sources_fk10 foreign key(merchant_id,credential_issue_operation_id) references public.merchant_attendance_independent_entries(merchant_id,operation_id) on delete restrict,
 constraint ind196_event_sources_fk11 foreign key(merchant_id,terminal_id) references public.merchant_attendance_terminals(merchant_id,id) on delete restrict
);
create index if not exists attendance_independent_source_subject_idx on public.merchant_attendance_independent_event_sources(merchant_id,subject_id,event_id);
create table if not exists public.merchant_attendance_independent_member_bindings(
 merchant_id text not null,
 subject_id uuid not null,
 worker_id uuid not null,
 operation_id uuid not null,
 employee_id uuid not null,
 employee_auth_user_id uuid not null,
 worker_version bigint not null,
 generation bigint not null,
 constraint ind196_member_bindings_versions_ck check(worker_version between 2 and 9007199254740990 and generation between 1 and 9007199254740990),
 constraint ind196_member_bindings_last_independent_event_id_fk1 foreign key(last_independent_event_id) references public.merchant_attendance_events(id) on delete restrict,
 last_independent_event_id uuid,
 constraint ind196_member_bindings_last_sequence_ck2 check(last_sequence between 0 and 9007199254740990),
 last_sequence bigint not null,
 actor_auth_user_id uuid not null,
 constraint ind196_member_bindings_command_fingerprint_ck3 check(command_fingerprint~'^[0-9a-f]{64}$'),
 command_fingerprint text not null,
 constraint ind196_member_bindings_bound_at_ck4 check(isfinite(bound_at)),
 bound_at timestamptz not null,
 constraint ind196_member_bindings_pk5 primary key(merchant_id,subject_id),
 constraint ind196_member_bindings_uq6 unique(merchant_id,worker_id),
 constraint ind196_member_bindings_uq7 unique(merchant_id,operation_id),
 constraint ind196_member_bindings_fk8 foreign key(merchant_id,subject_id) references public.merchant_attendance_independent_subjects(merchant_id,subject_id) on delete restrict,
 constraint ind196_member_bindings_fk9 foreign key(merchant_id,operation_id) references public.merchant_attendance_independent_entries(merchant_id,operation_id) deferrable initially deferred,
 constraint ind196_member_bindings_fk10 foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id) on delete restrict,
 constraint ind196_member_bindings_ck11 check((last_sequence=0)=(last_independent_event_id is null))
);

create or replace function public.faolla_attendance_independent_scalar_v1(p jsonb,k text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
 if k='uint' or k='positive' then return coalesce(jsonb_typeof(p)='number' and p::text~'^(0|[1-9][0-9]{0,15})$' and p::numeric<=9007199254740990 and (k='uint' or p::numeric>=1),false);end if;
 if k='date' then return coalesce(jsonb_typeof(p)='string' and public.faolla_attendance_group_date_v1(p#>>'{}') and p#>>'{}'>='2000-01-01' and p#>>'{}'<='2100-12-31',false);end if;
 return public.faolla_attendance_operational_rule_scalar_v1(p,k);
exception when others then return false;
end;
$$;
create or replace function public.faolla_attendance_independent_text_v1(p text,lo integer,hi integer)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(p=btrim(p) and public.faolla_attendance_group_text_v1(p,lo,hi),false);
$$;
create or replace function public.faolla_attendance_independent_command_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare a text:=p->>'action';ks text[];k text;v jsonb;
begin
 ks:=array['action','operationId','subjectId','reason','expectedSettingsVersion'];
 if a='create' then ks:=ks||array['workerId','workerNo','displayName','locationId','startsOn'];
 elsif a in('enable','disable','issue_pin','revoke_pin','bind_member') then
  ks:=ks||array['expectedSubjectRevision','expectedGeneration','expectedWorkerVersion'];
  if a in('issue_pin','revoke_pin','bind_member') then ks:=ks||array['expectedCredentialRevision'];end if;
  if a='bind_member' then ks:=ks||array['targetEmployeeId','targetAuthUserId','expectedLastEventId','expectedSequence'];end if;
 else raise exception 'attendance_invalid_request';end if;
 if public.faolla_attendance_operational_rule_object_v1(p,ks) is distinct from true or not public.faolla_attendance_independent_text_v1(p->>'reason',1,500) then raise exception 'attendance_invalid_request';end if;
 foreach k in array array['operationId','subjectId','workerId','locationId','targetEmployeeId','targetAuthUserId'] loop
  if p ? k and public.faolla_attendance_independent_scalar_v1(p->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 end loop;
 foreach k in array array['expectedSettingsVersion','expectedSubjectRevision','expectedWorkerVersion'] loop
  if p ? k and public.faolla_attendance_independent_scalar_v1(p->k,'positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
 end loop;
 foreach k in array array['expectedGeneration','expectedCredentialRevision','expectedSequence'] loop
  if p ? k and public.faolla_attendance_independent_scalar_v1(p->k,'uint') is distinct from true then raise exception 'attendance_invalid_request';end if;
 end loop;
 if a='create' then
  if not public.faolla_attendance_independent_text_v1(p->>'workerNo',1,40) or not public.faolla_attendance_independent_text_v1(p->>'displayName',1,120)
   or public.faolla_attendance_independent_scalar_v1(p->'startsOn','date') is distinct from true then raise exception 'attendance_invalid_request';end if;
  return jsonb_build_array(p->>'workerId',p->'expectedSettingsVersion',p->>'workerNo',p->>'displayName',p->>'locationId',p->>'startsOn',p->>'reason');
 end if;
 v:=jsonb_build_array(p->'expectedSubjectRevision',p->'expectedGeneration',p->'expectedWorkerVersion',p->'expectedSettingsVersion',p->>'reason');
 if a in('issue_pin','revoke_pin','bind_member') then v:=v||jsonb_build_array(p->'expectedCredentialRevision');end if;
 if a='bind_member' then
  if p->'expectedLastEventId'<>'null'::jsonb and public.faolla_attendance_independent_scalar_v1(p->'expectedLastEventId','uuid') is distinct from true
   or (p->'expectedSequence'='0'::jsonb)<>(p->'expectedLastEventId'='null'::jsonb) then raise exception 'attendance_invalid_request';end if;
  v:=v||jsonb_build_array(p->>'targetEmployeeId',p->>'targetAuthUserId',p->>'expectedLastEventId',p->'expectedSequence');
 end if;return v;
end;
$$;
create or replace function public.faolla_attendance_independent_clock_command_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare k text;
begin
 if public.faolla_attendance_operational_rule_object_v1(p,array['operationId','subjectId','workerId','generation','credentialId','credentialRevision','expectedWorkerVersion','expectedSettingsVersion','locationId','expectedLocationVersion','expectedSequence','action','breakPaid']) is distinct from true
  or p->>'action' is null or p->>'action' not in('clock_in','break_start','break_end','clock_out') then raise exception 'attendance_invalid_request';end if;
 foreach k in array array['operationId','subjectId','workerId','credentialId','locationId'] loop
  if public.faolla_attendance_independent_scalar_v1(p->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 end loop;
 foreach k in array array['credentialRevision','expectedWorkerVersion','expectedSettingsVersion','expectedLocationVersion'] loop
  if public.faolla_attendance_independent_scalar_v1(p->k,'positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
 end loop;
 if public.faolla_attendance_independent_scalar_v1(p->'generation','uint') is distinct from true or public.faolla_attendance_independent_scalar_v1(p->'expectedSequence','uint') is distinct from true
  or (case when p->>'action'='break_start' then jsonb_typeof(p->'breakPaid') is distinct from 'boolean' else p->'breakPaid' is distinct from 'null'::jsonb end) then raise exception 'attendance_invalid_request';end if;
 return jsonb_build_array(p->>'operationId',p->>'subjectId',p->>'workerId',p->'generation',p->>'credentialId',p->'credentialRevision',p->'expectedWorkerVersion',p->'expectedSettingsVersion',p->>'locationId',p->'expectedLocationVersion',p->'expectedSequence',p->>'action',p->'breakPaid');
end;
$$;
create or replace function public.faolla_attendance_independent_admin_hash_v1(p_site text,p_auth uuid,p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
 select public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-independent-admin-command-v1',p_site,p_auth::text,p->>'action',p->>'operationId',p->>'subjectId',public.faolla_attendance_independent_command_v1(p)));
$$;
create or replace function public.faolla_attendance_independent_clock_hash_v1(p_site text,p_terminal uuid,p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
 select public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-independent-clock-command-v1',p_site,p_terminal::text,public.faolla_attendance_independent_clock_command_v1(p)));
$$;
--PRIVATE material never leaves the server; deliberately separate from publicSHA.
create or replace function public.faolla_attendance_independent_material_hash_v1(p_site text,p_worker uuid,p_subject uuid,p_generation bigint,p_revision bigint,p_operation uuid,p_salt text,p_verifier text)
returns text language sql immutable set search_path=pg_catalog as $$
 select public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-independent-pin-material-v1',p_site,p_worker::text,p_subject::text,p_generation,p_revision,p_operation::text,p_salt,p_verifier));
$$;

create or replace function public.faolla_attendance_independent_subject_v1(p public.merchant_attendance_independent_subjects)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;first_day date;
begin
 select * into w from public.merchant_attendance_workers where merchant_id=p.merchant_id and id=p.worker_id;
 select starts_on into first_day from public.merchant_attendance_employment_periods where merchant_id=p.merchant_id and worker_id=p.worker_id order by starts_on limit 1;
 if w.id is null or first_day is null or (p.state='independent')<>(w.employee_id is null) or p.enabled is distinct from w.active and p.state='independent' then raise exception 'attendance_independent_invalid';end if;
 return jsonb_build_object('subjectId',p.subject_id,'workerId',p.worker_id,'workerNo',w.worker_no,'displayName',w.display_name,'startsOn',first_day,
  'locationId',w.default_location_id,'enabled',p.enabled,'generation',p.generation,'revision',p.revision,'workerVersion',w.version,'state',p.state,
  'createdAt',public.faolla_attendance_operational_punch_stamp_v1(p.created_at));
end;
$$;
create or replace function public.faolla_attendance_independent_head_v1(p_site text,p_worker uuid,p_subject uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare e public.merchant_attendance_events%rowtype;b public.merchant_attendance_independent_member_bindings%rowtype;
begin
 select * into b from public.merchant_attendance_independent_member_bindings where merchant_id=p_site and worker_id=p_worker and subject_id=p_subject;
 if b.subject_id is not null then
  select * into e from public.merchant_attendance_events where id=b.last_independent_event_id and merchant_id=p_site and worker_id=p_worker;
  if row(e.id,coalesce(e.sequence,0)) is distinct from row(b.last_independent_event_id,b.last_sequence) or e.id is not null and e.action<>'clock_out' then raise exception 'attendance_independent_invalid';end if;
 else select * into e from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker order by sequence desc limit 1;end if;
 if e.id is not null and not exists(select 1 from public.merchant_attendance_independent_event_sources x where x.event_id=e.id and x.merchant_id=p_site and x.worker_id=p_worker and x.subject_id=p_subject) then
  raise exception 'attendance_independent_identity_changed';end if;
 return jsonb_build_object('sequence',coalesce(e.sequence,0),'status',case when e.id is null or e.action='clock_out' then 'off' when e.action='break_start' then 'break' else 'working' end,
  'lastEventId',e.id,'lastAction',e.action,'lastAt',public.faolla_attendance_operational_punch_stamp_v1(e.occurred_at));
end;
$$;
create or replace function public.faolla_attendance_independent_receipt_v1(p public.merchant_attendance_independent_entries)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('operationId',p.operation_id,'subjectId',p.subject_id,'workerId',p.worker_id,'action',p.action,'actorId',p.actor_auth_user_id,
  'subjectRevision',p.subject_revision,'generation',p.generation,'workerVersion',p.worker_version,'credentialRevision',p.credential_revision,
  'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at),'commandFingerprint',p.command_fingerprint);
$$;
create or replace function public.faolla_attendance_independent_clock_receipt_v1(p public.merchant_attendance_independent_event_sources)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare e public.merchant_attendance_events%rowtype;i public.merchant_attendance_independent_entries%rowtype;c jsonb:=p.command;
begin
 select * into e from public.merchant_attendance_events where id=p.event_id;
 select * into i from public.merchant_attendance_independent_entries where merchant_id=p.merchant_id and operation_id=p.credential_issue_operation_id;
 if e.id is null or row(e.merchant_id,e.worker_id,e.operation_id,e.actor_employee_id,e.source) is distinct from row(p.merchant_id,p.worker_id,p.operation_id,null::uuid,'kiosk'::text)
  or e.sequence is distinct from (c->>'expectedSequence')::bigint+1 or e.action is distinct from c->>'action' or e.break_paid is distinct from (c->>'breakPaid')::boolean
  or e.location_id::text is distinct from c->>'locationId' or e.occurred_at>e.received_at or e.received_at>p.recorded_at
  or row(p.subject_id::text,p.worker_id::text,p.operation_id::text,p.credential_id::text) is distinct from row(c->>'subjectId',c->>'workerId',c->>'operationId',c->>'credentialId')
  or p.generation is distinct from (c->>'generation')::bigint or p.credential_revision is distinct from (c->>'credentialRevision')::bigint
  or p.worker_version is distinct from (c->>'expectedWorkerVersion')::bigint or p.settings_version is distinct from (c->>'expectedSettingsVersion')::bigint
  or p.location_version is distinct from (c->>'expectedLocationVersion')::bigint
  or p.command_fingerprint is distinct from public.faolla_attendance_independent_clock_hash_v1(p.merchant_id,p.terminal_id,c)
  or row(i.subject_id,i.worker_id,i.action,i.generation,i.credential_id,i.credential_revision) is distinct from row(p.subject_id,p.worker_id,'issue_pin'::text,p.generation,p.credential_id,p.credential_revision)
  or i.recorded_at>e.occurred_at or i.material_commitment is null then raise exception 'attendance_independent_invalid';end if;
 return jsonb_build_object('operationId',p.operation_id,'command',c,'commandFingerprint',p.command_fingerprint,
  'event',jsonb_build_object('id',e.id,'operationId',e.operation_id,'sequence',e.sequence,'action',e.action,'locationId',e.location_id,
   'occurredAt',public.faolla_attendance_operational_punch_stamp_v1(e.occurred_at),'receivedAt',public.faolla_attendance_operational_punch_stamp_v1(e.received_at),
   'timeZone',e.time_zone,'breakPaid',e.break_paid,'source','kiosk','actorEmployeeId',null),
  'source',jsonb_build_object('subjectId',p.subject_id,'generation',p.generation,'credentialId',p.credential_id,'credentialRevision',p.credential_revision,
   'credentialIssueOperationId',p.credential_issue_operation_id,'terminalId',p.terminal_id,'workerVersion',p.worker_version,'settingsVersion',p.settings_version,'locationVersion',p.location_version,'commandFingerprint',p.command_fingerprint));
end;
$$;
create or replace function public.faolla_attendance_independent_boundary_v1(p public.merchant_attendance_independent_member_bindings)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('protocol','attendance-independent-binding-boundary-v1','siteId',p.merchant_id,'workerId',p.worker_id,'subjectId',p.subject_id,
  'bindingOperationId',p.operation_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'workerVersion',p.worker_version,'generation',p.generation,
  'lastIndependentEventId',p.last_independent_event_id,'lastSequence',p.last_sequence,'boundAt',public.faolla_attendance_operational_punch_stamp_v1(p.bound_at));
$$;
--A saved binding proves only a closed exact boundary, never an old receipt.
create or replace function public.faolla_attendance_independent_bootstrap_v1(p_site text,p_worker uuid,p_employee uuid,p_auth uuid,p_last uuid,p_sequence bigint)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare b public.merchant_attendance_independent_member_bindings%rowtype;s public.merchant_attendance_independent_subjects%rowtype;
 w public.merchant_attendance_workers%rowtype;e public.merchant_attendance_events%rowtype;x public.merchant_attendance_independent_event_sources%rowtype;i public.merchant_attendance_independent_entries%rowtype;
begin
 select * into b from public.merchant_attendance_independent_member_bindings where merchant_id=p_site and worker_id=p_worker;
 if b.subject_id is null or row(b.employee_id,b.employee_auth_user_id,b.last_independent_event_id,b.last_sequence) is distinct from row(p_employee,p_auth,p_last,p_sequence) then return false;end if;
 select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=b.subject_id;
 select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=p_worker;
 select * into i from public.merchant_attendance_independent_entries where merchant_id=p_site and operation_id=b.operation_id;
 if s.state<>'bound' or s.enabled or s.generation<>b.generation or w.employee_id is distinct from p_employee or w.version<b.worker_version
  or not exists(select 1 from public.merchant_enterprise_employees where merchant_id=p_site and id=p_employee and auth_user_id=p_auth and status='active')
  or i.action is distinct from 'bind_member' or i.command_fingerprint is distinct from b.command_fingerprint
  or row(i.subject_id,i.worker_id,i.worker_version,i.generation,i.recorded_at,i.actor_auth_user_id) is distinct from row(b.subject_id,b.worker_id,b.worker_version,b.generation,b.bound_at,b.actor_auth_user_id)
  or i.command->>'targetEmployeeId' is distinct from p_employee::text or i.command->>'targetAuthUserId' is distinct from p_auth::text
  or (i.command->>'expectedLastEventId')::uuid is distinct from b.last_independent_event_id or (i.command->>'expectedSequence')::bigint is distinct from b.last_sequence then return false;end if;
 select * into e from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker order by sequence desc limit 1;
 if row(e.id,coalesce(e.sequence,0)) is distinct from row(p_last,p_sequence) then return false;end if;
 if p_last is null then return p_sequence=0;end if;
 select * into x from public.merchant_attendance_independent_event_sources where event_id=p_last;
 if e.actor_employee_id is not null or e.action<>'clock_out' or x.subject_id is distinct from b.subject_id or e.occurred_at>b.bound_at then return false;end if;
 perform public.faolla_attendance_independent_clock_receipt_v1(x);return true;
end;
$$;
create or replace function public.faolla_attendance_independent_guard_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
declare s public.merchant_attendance_independent_subjects%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_attendance_events%rowtype;
begin
 if tg_op<>'INSERT' then raise exception 'attendance_independent_immutable';end if;
 if tg_table_name='merchant_attendance_independent_event_sources' then
  perform public.faolla_attendance_independent_clock_receipt_v1(new);
 elsif tg_table_name='merchant_attendance_independent_entries' then
  if new.command_fingerprint is distinct from public.faolla_attendance_independent_admin_hash_v1(new.merchant_id,new.actor_auth_user_id,new.command)
   or new.command->>'operationId' is distinct from new.operation_id::text or new.command->>'subjectId' is distinct from new.subject_id::text or new.command->>'action' is distinct from new.action then raise exception 'attendance_independent_invalid';end if;
  select * into s from public.merchant_attendance_independent_subjects where merchant_id=new.merchant_id and subject_id=new.subject_id;
  select * into w from public.merchant_attendance_workers where merchant_id=new.merchant_id and id=new.worker_id;
  if row(s.worker_id,s.revision,s.generation,w.version) is distinct from row(new.worker_id,new.subject_revision,new.generation,new.worker_version)
   or s.updated_at<>new.recorded_at or w.updated_at<>new.recorded_at then raise exception 'attendance_independent_invalid';end if;
  if new.action='create' then
   if row(new.subject_revision,new.generation,new.worker_version,s.created_operation_id,s.created_by,s.created_at,w.created_at,w.employee_id)
    is distinct from row(1::bigint,0::bigint,1::bigint,new.operation_id,new.actor_auth_user_id,new.recorded_at,new.recorded_at,null::uuid)
    or new.command->>'workerId' is distinct from new.worker_id::text or s.enabled or s.state<>'independent'
    or not exists(select 1 from public.merchant_attendance_employment_periods where merchant_id=new.merchant_id and worker_id=new.worker_id and starts_on=(new.command->>'startsOn')::date) then raise exception 'attendance_independent_invalid';end if;
  elsif row(new.subject_revision,new.generation,new.worker_version) is distinct from row((new.command->>'expectedSubjectRevision')::bigint+1,
   (new.command->>'expectedGeneration')::bigint+case when new.action in('disable','revoke_pin','bind_member') then 1 else 0 end,(new.command->>'expectedWorkerVersion')::bigint+1) then raise exception 'attendance_independent_invalid';end if;
 elsif tg_table_name='merchant_attendance_independent_member_bindings' then
  select * into e from public.merchant_attendance_events where merchant_id=new.merchant_id and worker_id=new.worker_id order by sequence desc limit 1;
  if row(e.id,coalesce(e.sequence,0)) is distinct from row(new.last_independent_event_id,new.last_sequence)
   or e.id is not null and (e.action<>'clock_out' or e.actor_employee_id is not null or not exists(select 1 from public.merchant_attendance_independent_event_sources x where x.event_id=e.id and x.subject_id=new.subject_id)) then raise exception 'attendance_independent_invalid';end if;
  if not exists(select 1 from public.merchant_attendance_independent_entries i where i.merchant_id=new.merchant_id and i.operation_id=new.operation_id and i.action='bind_member'
   and i.subject_id=new.subject_id and i.worker_id=new.worker_id and i.command_fingerprint=new.command_fingerprint and i.actor_auth_user_id=new.actor_auth_user_id
   and i.worker_version=new.worker_version and i.generation=new.generation and i.recorded_at=new.bound_at
   and i.command->>'targetEmployeeId'=new.employee_id::text and i.command->>'targetAuthUserId'=new.employee_auth_user_id::text
   and (i.command->>'expectedLastEventId')::uuid is not distinct from new.last_independent_event_id and (i.command->>'expectedSequence')::bigint=new.last_sequence) then raise exception 'attendance_independent_invalid';end if;
 else raise exception 'attendance_independent_invalid';end if;return new;
end;
$$;
create or replace function public.faolla_attendance_independent_bootstrap_intent_v1(p_site text,p_worker uuid,p_employee uuid,p_auth uuid,p_last uuid,p_sequence bigint,p_command jsonb,p_operation uuid)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare op uuid;
begin
 if p_command is null then
  -- The existing location Node adapter pre-reads a fresh operation before its
  -- first write. Only genuine absence may use the closed binding bootstrap;
  -- an existing original operation still belongs to its recorded actor.
  if p_operation is not null and exists(select 1 from public.merchant_attendance_events
   where merchant_id=p_site and worker_id=p_worker and operation_id=p_operation) then return false;end if;
 else
  if p_operation is not null or p_command->>'action' is distinct from 'clock_in'
   or public.faolla_attendance_independent_scalar_v1(p_command->'operationId','uuid') is distinct from true then return false;end if;
  op:=(p_command->>'operationId')::uuid;
  if exists(select 1 from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and operation_id=op) then return false;end if;
 end if;
 return public.faolla_attendance_independent_bootstrap_v1(p_site,p_worker,p_employee,p_auth,p_last,p_sequence);
end;
$$;
create or replace function public.faolla_attendance_independent_current_boundary_v1(p_site text,p_worker uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare b public.merchant_attendance_independent_member_bindings%rowtype;
begin
 select * into b from public.merchant_attendance_independent_member_bindings where merchant_id=p_site and worker_id=p_worker;
 if b.subject_id is null or not public.faolla_attendance_independent_bootstrap_v1(p_site,p_worker,b.employee_id,b.employee_auth_user_id,b.last_independent_event_id,b.last_sequence) then return null;end if;
 return public.faolla_attendance_independent_boundary_v1(b);
end;
$$;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_independent_subjects'::regclass,
      'public.merchant_attendance_independent_entries'::regclass,
      'public.merchant_attendance_independent_credentials'::regclass,
      'public.merchant_attendance_independent_leases'::regclass,
      'public.merchant_attendance_independent_event_sources'::regclass,
      'public.merchant_attendance_independent_member_bindings'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $independent_storage$
declare n text;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080196) then return;end if;
 foreach n in array array['independent_subjects','independent_entries','independent_credentials','independent_leases','independent_event_sources','independent_member_bindings'] loop
  execute format('alter table public.%I enable row level security','merchant_attendance_'||n);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role','merchant_attendance_'||n);
 end loop;
 foreach n in array array['independent_entries','independent_event_sources','independent_member_bindings'] loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.merchant_attendance_'||n) and tgname='independent_immutable') then
   execute format('create trigger independent_immutable before insert or update or delete on public.%I for each row execute function public.faolla_attendance_independent_guard_v1()','merchant_attendance_'||n);
   execute format('create trigger independent_no_truncate before truncate on public.%I for each statement execute function public.faolla_attendance_independent_guard_v1()','merchant_attendance_'||n);
  end if;
 end loop;
end;
$independent_storage$;

--Complete sessions, not clipped intervals. Missing proofs are errors, not zero.
create or replace function public.faolla_attendance_independent_report_v1(p_site text,p_subject uuid,p_from date,p_through date,p_cursor uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare s public.merchant_attendance_independent_subjects%rowtype;w public.merchant_attendance_workers%rowtype;l public.merchant_attendance_locations%rowtype;
 b public.merchant_attendance_independent_member_bindings%rowtype;e public.merchant_attendance_events%rowtype;tail public.merchant_attendance_events%rowtype;x public.merchant_attendance_independent_event_sources%rowtype;
 ids uuid[];start_id uuid;items jsonb:='[]';events jsonb;value jsonb;from_at timestamptz;to_at timestamptz;read_at timestamptz:=clock_timestamp();
 cursor_sequence bigint:=0;previous_sequence bigint;previous_at timestamptz;status_name text;event_count integer;total_events integer:=0;seen integer:=0;last_start uuid;next_id uuid;
begin
 if p_from is null or p_through is null or p_through-p_from not between 0 and 30 or p_from<date '2000-01-01' or p_through>date '2100-12-31' then raise exception 'attendance_invalid_request';end if;
 select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=p_subject;
 select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=s.worker_id;
 select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=w.default_location_id;
 select * into b from public.merchant_attendance_independent_member_bindings where merchant_id=p_site and subject_id=p_subject;
 if s.subject_id is null or w.id is null or l.id is null then raise exception 'attendance_independent_not_found';end if;
 from_at:=public.faolla_attendance_control_day_boundary_v1(p_from,l.time_zone);to_at:=public.faolla_attendance_control_day_boundary_v1(p_through+1,l.time_zone);
 if from_at>to_at or to_at-from_at>interval '33 days' then raise exception 'attendance_independent_invalid';end if;
 if p_cursor is not null then
  select * into e from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and id=p_cursor and action='clock_in';cursor_sequence:=e.sequence;
  select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and sequence>=e.sequence and action='clock_out' order by sequence limit 1;
  if cursor_sequence is null or e.occurred_at>=to_at or coalesce(tail.occurred_at,read_at)<=from_at or not exists(select 1 from public.merchant_attendance_independent_event_sources where event_id=p_cursor and subject_id=p_subject) then raise exception 'attendance_invalid_request';end if;
 end if;
 ids:=array(with inside as(select id from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and action='clock_in' and sequence>cursor_sequence and occurred_at>=from_at and occurred_at<to_at order by sequence limit 27),
  prior as(select id from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and action='clock_in' and sequence>cursor_sequence and occurred_at<from_at order by sequence desc limit 1)
  select q.id from (select id from inside union select id from prior) q join public.merchant_attendance_events z on z.id=q.id
  where z.sequence>cursor_sequence order by z.sequence limit 27);
 foreach start_id in array ids loop
  exit when from_at=to_at;
  select * into e from public.merchant_attendance_events where id=start_id;
  select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and sequence>=e.sequence and action='clock_out' order by sequence limit 1;
  if e.occurred_at>=to_at or coalesce(tail.occurred_at,read_at)<=from_at then continue;end if;
  select * into x from public.merchant_attendance_independent_event_sources where event_id=start_id;
  if x.subject_id is distinct from p_subject then
   if b.subject_id is not null and e.sequence>b.last_sequence and e.actor_employee_id=b.employee_id then continue;end if;
   raise exception 'attendance_independent_identity_changed';end if;
  seen:=seen+1;if seen=26 then next_id:=last_start;exit;end if;
  events:='[]';previous_sequence:=e.sequence-1;previous_at:=e.occurred_at;status_name:='off';event_count:=0;tail:=null;
  for e in select * from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and sequence>previous_sequence order by sequence limit 2003 loop
   event_count:=event_count+1;total_events:=total_events+1;if event_count>2002 or total_events>4000 then raise exception 'attendance_independent_too_large';end if;
   select * into x from public.merchant_attendance_independent_event_sources where event_id=e.id;
   if x.subject_id is distinct from p_subject or e.sequence<>previous_sequence+1 or e.occurred_at<previous_at or e.occurred_at>read_at or e.received_at>read_at then raise exception 'attendance_independent_identity_changed';end if;
   if status_name='off' and e.action='clock_in' then status_name:='working';
   elsif status_name='working' and e.action='break_start' then status_name:='break';
   elsif status_name='break' and e.action='break_end' then status_name:='working';
   elsif status_name='working' and e.action='clock_out' then status_name:='completed';
   else raise exception 'attendance_independent_invalid';end if;
   events:=events||jsonb_build_array(public.faolla_attendance_independent_clock_receipt_v1(x));previous_sequence:=e.sequence;previous_at:=e.occurred_at;tail:=e;
   exit when status_name='completed';
  end loop;
  items:=items||jsonb_build_array(jsonb_build_object('startEventId',start_id,'endEventId',case when status_name='completed' then tail.id else null end,'complete',status_name='completed','events',events));last_start:=start_id;
 end loop;
 value:=jsonb_build_object('protocol','attendance-independent-raw-v1','siteId',p_site,'subjectId',p_subject,'workerId',w.id,'workerNo',w.worker_no,'displayName',w.display_name,
  'timeZone',l.time_zone,'fromDate',p_from,'throughDate',p_through,'fromAt',public.faolla_attendance_operational_punch_stamp_v1(from_at),'toAt',public.faolla_attendance_operational_punch_stamp_v1(to_at),
  'readAt',public.faolla_attendance_operational_punch_stamp_v1(read_at),'items',items,'nextCursor',next_id,'pageComplete',true,'rangeComplete',p_cursor is null and next_id is null,'rulesAssessment','unassessed','fixedPeriodEligible',false);
 if octet_length(convert_to(value::text,'UTF8'))>1048576 then raise exception 'attendance_independent_too_large';end if;return value;
end;
$$;

create or replace function public.faolla_attendance_independent_admin_v1(p_site text,p_auth uuid,p_query jsonb,p_command jsonb,p_material jsonb,p_allow_new boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare m public.merchants%rowtype;config public.merchant_attendance_settings%rowtype;s public.merchant_attendance_independent_subjects%rowtype;
 w public.merchant_attendance_workers%rowtype;c public.merchant_attendance_independent_credentials%rowtype;i public.merchant_attendance_independent_entries%rowtype;
 b public.merchant_attendance_independent_member_bindings%rowtype;e public.merchant_enterprise_employees%rowtype;r public.merchant_enterprise_roles%rowtype;l public.merchant_attendance_locations%rowtype;
 tail public.merchant_attendance_events%rowtype;x public.merchant_attendance_independent_event_sources%rowtype;
 mode_name text:=p_query->>'mode';a text:=p_command->>'action';ks text[];owner_now boolean;target_subject uuid;stamp timestamptz;fp text;commitment text;
 op uuid;v_credential_revision bigint;v_credential_id uuid;items jsonb:='[]';data_value jsonb;receipt jsonb:='null';result jsonb;seen integer:=0;last_id uuid;next_id uuid;
begin
 if p_site is null or p_site!~'^[0-9]{8}$' or p_auth is null or p_query->>'siteId' is distinct from p_site then raise exception 'attendance_invalid_request';end if;
 ks:=array['siteId','mode'];
 if mode_name='list' then ks:=ks||array['cursor','search','state'];
 elsif mode_name in('members','locations') then ks:=ks||array['cursor','search'];
 elsif mode_name in('detail','recover','history') then ks:=ks||array['subjectId'];
  if mode_name='recover' then ks:=ks||array['operationId'];end if;
  if mode_name='history' then ks:=ks||array['fromDate','throughDate','cursor'];end if;
 else raise exception 'attendance_invalid_request';end if;
 if public.faolla_attendance_operational_rule_object_v1(p_query,ks) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if p_query ? 'cursor' and p_query->'cursor'<>'null'::jsonb and public.faolla_attendance_independent_scalar_v1(p_query->'cursor','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode_name in('list','members','locations') then
  if not public.faolla_attendance_independent_text_v1(p_query->>'search',0,80) then raise exception 'attendance_invalid_request';end if;
  if mode_name='list' and (p_query->>'state' is null or p_query->>'state' not in('all','independent','bound')) then raise exception 'attendance_invalid_request';end if;
 else
  if public.faolla_attendance_independent_scalar_v1(p_query->'subjectId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;target_subject:=(p_query->>'subjectId')::uuid;
 end if;
 if mode_name='recover' and public.faolla_attendance_independent_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 if mode_name='history' and (public.faolla_attendance_independent_scalar_v1(p_query->'fromDate','date') is distinct from true or public.faolla_attendance_independent_scalar_v1(p_query->'throughDate','date') is distinct from true) then raise exception 'attendance_invalid_request';end if;
 if p_command is not null then
  perform public.faolla_attendance_independent_command_v1(p_command);
  if mode_name<>'detail' or p_command->>'subjectId' is distinct from target_subject::text then raise exception 'attendance_invalid_request';end if;
  op:=(p_command->>'operationId')::uuid;fp:=public.faolla_attendance_independent_admin_hash_v1(p_site,p_auth,p_command);
  if a='issue_pin' then
   if public.faolla_attendance_operational_rule_object_v1(p_material,array['salt','verifier','commitment']) is distinct from true
    or coalesce(p_material->>'salt','')!~'^[0-9a-f]{32}$' or coalesce(p_material->>'verifier','')!~'^[0-9a-f]{64}$' or coalesce(p_material->>'commitment','')!~'^[0-9a-f]{64}$' then raise exception 'attendance_invalid_request';end if;
  elsif p_material is not null then raise exception 'attendance_invalid_request';end if;
 elsif p_material is not null then raise exception 'attendance_invalid_request';end if;
 select * into m from public.merchants where id=p_site for share;
 owner_now:=m.id is not null and coalesce(p_auth=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false);
 if mode_name='recover' then
  select * into i from public.merchant_attendance_independent_entries where merchant_id=p_site and operation_id=(p_query->>'operationId')::uuid;
  if not owner_now and (i.operation_id is null or i.actor_auth_user_id<>p_auth) then raise exception 'attendance_access_denied';end if;
  if i.operation_id is not null and i.subject_id<>target_subject then raise exception 'attendance_operation_conflict';end if;
 elsif not owner_now then raise exception 'attendance_access_denied';end if;
 if p_command is null then select * into config from public.merchant_attendance_settings where merchant_id=p_site for share;
 else select * into config from public.merchant_attendance_settings where merchant_id=p_site for update;end if;
 if config.merchant_id is null then raise exception 'attendance_settings_required';end if;stamp:=clock_timestamp();
 if p_command is not null then
  select * into i from public.merchant_attendance_independent_entries where merchant_id=p_site and operation_id=op;
  if i.operation_id is not null then
   if i.subject_id<>target_subject or i.actor_auth_user_id<>p_auth or i.command is distinct from p_command or i.command_fingerprint<>fp then raise exception 'attendance_operation_conflict';end if;
   if a='issue_pin' then
    commitment:=public.faolla_attendance_independent_material_hash_v1(p_site,i.worker_id,i.subject_id,i.generation,i.credential_revision,op,p_material->>'salt',p_material->>'verifier');
    if commitment is distinct from i.material_commitment or commitment is distinct from p_material->>'commitment' then raise exception 'attendance_operation_conflict';end if;
   end if;
  else
   if a in('create','enable','issue_pin','bind_member') and p_allow_new is distinct from true then raise exception 'attendance_independent_disabled';end if;
   if config.version<>(p_command->>'expectedSettingsVersion')::bigint then raise exception 'attendance_independent_changed';end if;
   if a='create' then
    select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(p_command->>'locationId')::uuid for share;
    if l.id is null or not l.active then raise exception 'attendance_location_denied';end if;
    if exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site and (id=(p_command->>'workerId')::uuid or lower(btrim(worker_no))=lower(p_command->>'workerNo')))
     or exists(select 1 from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject) then raise exception 'attendance_operation_conflict';end if;
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id,version,created_at,updated_at)
     values((p_command->>'workerId')::uuid,p_site,null,p_command->>'workerNo',p_command->>'displayName',false,l.id,1,stamp,stamp) returning * into w;
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values(p_site,w.id,(p_command->>'startsOn')::date);
    insert into public.merchant_attendance_independent_subjects values(p_site,target_subject,w.id,'independent','independent',false,0,1,op,p_auth,stamp,stamp) returning * into s;
   else
    --settings UPDATE is acquired before the optional member locks. Never lock
    --worker and then wait on the old member/role-before-worker path.
    if a='bind_member' then
     select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=(p_command->>'targetEmployeeId')::uuid for share;
     select * into r from public.merchant_enterprise_roles where merchant_id=p_site and id=e.role_id for share;
     if e.id is null or e.status<>'active' or e.auth_user_id is distinct from (p_command->>'targetAuthUserId')::uuid or r.status is distinct from 'active'
      or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true or not(array['enterprise.view','attendance.self.view','attendance.self.clock']::text[]<@r.permissions)
      or exists(select 1 from public.merchant_attendance_workers where merchant_id=p_site and employee_id=e.id) then raise exception 'attendance_employee_invalid';end if;
    end if;
    select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject;
    select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=s.worker_id for update;
    select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject for update;
    select * into c from public.merchant_attendance_independent_credentials where merchant_id=p_site and subject_id=target_subject for update;
    if s.subject_id is null or w.id is null then raise exception 'attendance_independent_not_found';end if;
    if s.state<>'independent' or w.employee_id is not null then raise exception 'attendance_independent_bound';end if;
    if row(s.revision,s.generation,w.version) is distinct from row((p_command->>'expectedSubjectRevision')::bigint,(p_command->>'expectedGeneration')::bigint,(p_command->>'expectedWorkerVersion')::bigint)
     or p_command ? 'expectedCredentialRevision' and coalesce(c.revision,0)<>(p_command->>'expectedCredentialRevision')::bigint then raise exception 'attendance_independent_changed';end if;
    if s.revision>=9007199254740990 or w.version>=9007199254740990 or s.updated_at>stamp or c.changed_at>stamp then raise exception 'attendance_independent_changed';end if;
    if a in('disable','revoke_pin','bind_member') and s.generation>=9007199254740990 then raise exception 'attendance_independent_changed';end if;
    if a='enable' and s.enabled or a='disable' and not s.enabled or a='revoke_pin' and not coalesce(c.enabled,false) then raise exception 'attendance_independent_unchanged';end if;
    if a in('enable','issue_pin') then
     select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=w.default_location_id for share;
     if l.id is null or not l.active then raise exception 'attendance_location_denied';end if;
     if a='issue_pin' and l.radius_meters is not null then raise exception 'attendance_location_verification_required';end if;
    end if;
    if a='bind_member' then
     select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;
     if tail.id is not null and tail.action<>'clock_out' then raise exception 'attendance_open_sessions';end if;
     if row(tail.id,coalesce(tail.sequence,0)) is distinct from row((p_command->>'expectedLastEventId')::uuid,(p_command->>'expectedSequence')::bigint) then raise exception 'attendance_independent_changed';end if;
     if tail.id is not null then
      select * into x from public.merchant_attendance_independent_event_sources where event_id=tail.id;
      if x.subject_id is distinct from s.subject_id or tail.actor_employee_id is not null then raise exception 'attendance_independent_identity_changed';end if;
      perform public.faolla_attendance_independent_clock_receipt_v1(x);
     end if;
    end if;
    v_credential_revision:=coalesce(c.revision,0);
    if a='issue_pin' then
     if v_credential_revision>=9007199254740990 then raise exception 'attendance_independent_changed';end if;
     v_credential_revision:=v_credential_revision+1;v_credential_id:=coalesce(c.credential_id,gen_random_uuid());
     commitment:=public.faolla_attendance_independent_material_hash_v1(p_site,w.id,s.subject_id,s.generation,v_credential_revision,op,p_material->>'salt',p_material->>'verifier');
     if commitment is distinct from p_material->>'commitment' then raise exception 'attendance_invalid_request';end if;
     insert into public.merchant_attendance_independent_credentials values(p_site,s.subject_id,v_credential_id,w.id,s.generation,v_credential_revision,true,p_material->>'salt',p_material->>'verifier',op,stamp,0,stamp)
      on conflict(merchant_id,subject_id) do update set generation=excluded.generation,revision=excluded.revision,enabled=true,salt=excluded.salt,verifier=excluded.verifier,issue_operation_id=op,changed_at=stamp,attempts=0,window_at=stamp;
    end if;
    if a in('disable','revoke_pin','bind_member') and c.subject_id is not null then
     if v_credential_revision>=9007199254740990 then raise exception 'attendance_independent_changed';end if;v_credential_revision:=v_credential_revision+1;
     update public.merchant_attendance_independent_credentials set enabled=false,salt=null,verifier=null,revision=v_credential_revision,changed_at=stamp where merchant_id=p_site and subject_id=s.subject_id;
    end if;
    delete from public.merchant_attendance_independent_leases where merchant_id=p_site and subject_id=s.subject_id;
    update public.merchant_attendance_independent_subjects set revision=revision+1,generation=generation+case when a in('disable','revoke_pin','bind_member') then 1 else 0 end,
     enabled=case when a='enable' then true when a in('disable','bind_member') then false else enabled end,state=case when a='bind_member' then 'bound' else state end,updated_at=stamp
     where merchant_id=p_site and subject_id=s.subject_id returning * into s;
    update public.merchant_attendance_workers set version=version+1,active=case when a='enable' then true when a='disable' then false else active end,
     employee_id=case when a='bind_member' then e.id else employee_id end,updated_at=stamp where merchant_id=p_site and id=w.id returning * into w;
   end if;
   insert into public.merchant_attendance_independent_entries values(p_site,op,s.subject_id,w.id,a,p_auth,p_command,fp,s.revision,s.generation,w.version,
    case when a in('issue_pin','revoke_pin','disable','bind_member') then coalesce(v_credential_revision,0) else null end,case when a='issue_pin' then v_credential_id else null end,commitment,stamp) returning * into i;
   if a='bind_member' then
    insert into public.merchant_attendance_independent_member_bindings values(p_site,s.subject_id,w.id,op,e.id,e.auth_user_id,w.version,s.generation,tail.id,coalesce(tail.sequence,0),p_auth,fp,stamp);
   end if;
  end if;
 end if;
 if p_command is not null or mode_name='recover' then
  if i.operation_id is not null then receipt:=public.faolla_attendance_independent_receipt_v1(i);end if;data_value:=jsonb_build_object('kind','receipt');
 elsif mode_name='members' then
  --Read-only current-owner choices. The bind writer repeats the same checks
  --under its original employee/role-before-worker locks; a list grants nothing.
  for e in select z.* from public.merchant_enterprise_employees z join public.merchant_enterprise_roles role on role.merchant_id=z.merchant_id and role.id=z.role_id
   where z.merchant_id=p_site and z.status='active' and z.auth_user_id is not null and role.status='active'
    and public.faolla_valid_merchant_enterprise_permissions_v1(role.permissions) is true and array['enterprise.view','attendance.self.view','attendance.self.clock']::text[]<@role.permissions
    and not exists(select 1 from public.merchant_attendance_workers used where used.merchant_id=p_site and used.employee_id=z.id)
    and ((p_query->>'cursor')::uuid is null or z.id>(p_query->>'cursor')::uuid)
    and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.display_name))>0)
   order by z.id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;
   items:=items||jsonb_build_array(jsonb_build_object('employeeId',e.id,'authUserId',e.auth_user_id,'displayName',e.display_name));last_id:=e.id;
  end loop;data_value:=jsonb_build_object('kind','members','items',items,'nextCursor',next_id);
 elsif mode_name='locations' then
  for l in select z.* from public.merchant_attendance_locations z where z.merchant_id=p_site and z.active
   and ((p_query->>'cursor')::uuid is null or z.id>(p_query->>'cursor')::uuid)
   and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.name))>0)
   order by z.id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;
   items:=items||jsonb_build_array(jsonb_build_object('locationId',l.id,'name',l.name,'timeZone',l.time_zone));last_id:=l.id;
  end loop;data_value:=jsonb_build_object('kind','locations','items',items,'nextCursor',next_id);
 elsif mode_name='list' then
  for s in select q.* from public.merchant_attendance_independent_subjects q join public.merchant_attendance_workers z on z.merchant_id=q.merchant_id and z.id=q.worker_id
   where q.merchant_id=p_site and ((p_query->>'cursor')::uuid is null or q.subject_id>(p_query->>'cursor')::uuid)
    and (p_query->>'state'='all' or q.state=p_query->>'state') and (p_query->>'search'='' or position(lower(p_query->>'search') in lower(z.worker_no||' '||z.display_name))>0)
   order by q.subject_id limit 26 loop
   seen:=seen+1;if seen=26 then next_id:=last_id;exit;end if;items:=items||jsonb_build_array(public.faolla_attendance_independent_subject_v1(s));last_id:=s.subject_id;
  end loop;data_value:=jsonb_build_object('kind','list','items',items,'nextCursor',next_id);
 else
  select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=target_subject;
  if s.subject_id is null then raise exception 'attendance_independent_not_found';end if;
  if mode_name='history' then data_value:=jsonb_build_object('kind','history','report',public.faolla_attendance_independent_report_v1(p_site,s.subject_id,(p_query->>'fromDate')::date,(p_query->>'throughDate')::date,(p_query->>'cursor')::uuid));
  else
   select * into c from public.merchant_attendance_independent_credentials where merchant_id=p_site and subject_id=s.subject_id;
   select * into b from public.merchant_attendance_independent_member_bindings where merchant_id=p_site and subject_id=s.subject_id;
   data_value:=jsonb_build_object('kind','detail','subject',public.faolla_attendance_independent_subject_v1(s),
    'credential',jsonb_build_object('credentialId',c.credential_id,'revision',coalesce(c.revision,0),'enabled',coalesce(c.enabled,false),'generation',c.generation,'changedAt',public.faolla_attendance_operational_punch_stamp_v1(c.changed_at)),
    'head',public.faolla_attendance_independent_head_v1(p_site,s.worker_id,s.subject_id),'binding',case when b.subject_id is null then null else public.faolla_attendance_independent_boundary_v1(b) end);
  end if;
 end if;
 result:=jsonb_build_object('protocol','attendance-independent-admin-v1','siteId',p_site,'actorId',p_auth,'readAt',case when data_value->>'kind'='history' then data_value->'report'->>'readAt' else public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()) end,'settingsVersion',config.version,'data',data_value,'receipt',receipt);
 if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_independent_too_large';end if;return result;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'attendance_invalid_request';
end;
$$;

--The old106 attempt row is the shared device budget/serialization point.
--Denied results are deliberately identical and still receive dummy server KDF.
create or replace function public.faolla_attendance_independent_begin_v1(p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_allow_new boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare device jsonb;d public.merchant_attendance_pin_attempts%rowtype;w public.merchant_attendance_workers%rowtype;
 s public.merchant_attendance_independent_subjects%rowtype;c public.merchant_attendance_independent_credentials%rowtype;
 q public.merchant_attendance_independent_leases%rowtype;l public.merchant_attendance_locations%rowtype;stamp timestamptz;
 denied jsonb:=jsonb_build_object('allowed',false,'leaseId',null,'binding',null,'salt',null,'verifier',null);
begin
 if p_lease is null or not public.faolla_attendance_independent_text_v1(p_no,1,40) then raise exception 'attendance_invalid_request';end if;
 device:=public.faolla_attendance_terminal_device_v1(p_site,p_terminal,p_secret_hash,null,false);
 insert into public.merchant_attendance_pin_attempts(merchant_id,terminal_id,attempts,window_at) values(p_site,p_terminal,0,clock_timestamp()) on conflict do nothing;
 select * into d from public.merchant_attendance_pin_attempts where merchant_id=p_site and terminal_id=p_terminal for update;
 stamp:=clock_timestamp();if stamp<d.window_at then raise exception 'attendance_time_reversed';end if;
 if d.lease_expires>stamp then return denied;end if;
 select * into q from public.merchant_attendance_independent_leases where merchant_id=p_site and terminal_id=p_terminal;
 if q.lease_id is not null and q.expires_at>stamp and q.budget_window=d.window_at and q.budget_ordinal=d.attempts then return denied;end if;
 if stamp>=d.window_at+interval '1 minute' then d.window_at:=stamp;d.attempts:=0;end if;
 if d.attempts>=60 then return denied;end if;
 update public.merchant_attendance_pin_attempts set attempts=d.attempts+1,window_at=d.window_at,lease_id=null,lease_expires=null,worker_id=null,employee_id=null,credential_revision=null
  where merchant_id=p_site and terminal_id=p_terminal;
 delete from public.merchant_attendance_independent_leases where merchant_id=p_site and terminal_id=p_terminal;
 select * into w from public.merchant_attendance_workers where merchant_id=p_site and lower(btrim(worker_no))=lower(p_no) for update;
 select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and worker_id=w.id for update;
 select * into c from public.merchant_attendance_independent_credentials where merchant_id=p_site and subject_id=s.subject_id for update;
 select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(device->'terminal'->>'locationId')::uuid;
 stamp:=clock_timestamp();
 if w.id is null or w.employee_id is not null or not w.active or s.state is distinct from 'independent' or not coalesce(s.enabled,false)
  or not coalesce(c.enabled,false) or row(c.worker_id,c.generation) is distinct from row(w.id,s.generation)
  or l.id is null or not l.active or l.id is distinct from w.default_location_id or l.radius_meters is not null
  or stamp>=(device->'terminal'->>'deviceExpiresAt')::timestamptz or stamp<(device->'terminal'->>'pairedAt')::timestamptz
  or (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site and worker_id=w.id
   and starts_on<=(stamp at time zone l.time_zone)::date and (ends_on is null or ends_on>=(stamp at time zone l.time_zone)::date))<>1 then return denied;end if;
 if stamp<c.window_at or stamp<c.changed_at or stamp<s.updated_at then raise exception 'attendance_time_reversed';end if;
 if stamp>=c.window_at+interval '15 minutes' then c.attempts:=0;c.window_at:=stamp;end if;
 if c.attempts>=10 then return denied;end if;
 update public.merchant_attendance_independent_credentials set attempts=c.attempts+1,window_at=c.window_at where merchant_id=p_site and subject_id=s.subject_id;
 insert into public.merchant_attendance_independent_leases values(p_site,p_terminal,p_lease,w.id,s.subject_id,s.generation,w.version,c.credential_id,c.revision,d.window_at,d.attempts+1,stamp,stamp+interval '30 seconds');
 return jsonb_build_object('allowed',true,'leaseId',p_lease,
  'binding',jsonb_build_object('siteId',p_site,'workerId',w.id,'subjectId',s.subject_id,'generation',s.generation,'credentialRevision',c.revision),'salt',c.salt,'verifier',c.verifier);
end;
$$;

create or replace function public.faolla_attendance_independent_finish_v1(p_site text,p_terminal uuid,p_secret_hash text,p_no text,p_lease uuid,p_verified boolean,p_request jsonb,p_allow_new boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare device jsonb;d public.merchant_attendance_pin_attempts%rowtype;q public.merchant_attendance_independent_leases%rowtype;
 w public.merchant_attendance_workers%rowtype;s public.merchant_attendance_independent_subjects%rowtype;c public.merchant_attendance_independent_credentials%rowtype;
 config public.merchant_attendance_settings%rowtype;l public.merchant_attendance_locations%rowtype;
 tail public.merchant_attendance_events%rowtype;e public.merchant_attendance_events%rowtype;x public.merchant_attendance_independent_event_sources%rowtype;
 kind text:=p_request->>'kind';ks text[];command_value jsonb;stamp timestamptz;seq bigint;status_name text;action_name text;fp text;
 data_value jsonb;subject_value jsonb;receipt jsonb:='null';value jsonb;op uuid;
begin
 if p_lease is null or not public.faolla_attendance_independent_text_v1(p_no,1,40) then raise exception 'attendance_invalid_request';end if;
 ks:=array['kind'];
 if kind='clock' then ks:=ks||array['command'];perform public.faolla_attendance_independent_clock_command_v1(p_request->'command');command_value:=p_request->'command';
 elsif kind='recover' then ks:=ks||array['subjectId','workerId','operationId','commandFingerprint'];
 elsif kind='personal' then ks:=ks||array['subjectId','workerId','fromDate','throughDate','cursor'];
 elsif kind is distinct from 'state' then raise exception 'attendance_invalid_request';end if;
 if public.faolla_attendance_operational_rule_object_v1(p_request,ks) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if kind in('recover','personal') and (public.faolla_attendance_independent_scalar_v1(p_request->'subjectId','uuid') is distinct from true or public.faolla_attendance_independent_scalar_v1(p_request->'workerId','uuid') is distinct from true) then raise exception 'attendance_invalid_request';end if;
 if kind='recover' and (public.faolla_attendance_independent_scalar_v1(p_request->'operationId','uuid') is distinct from true or public.faolla_attendance_independent_scalar_v1(p_request->'commandFingerprint','hash') is distinct from true) then raise exception 'attendance_invalid_request';end if;
 if kind='personal' and (public.faolla_attendance_independent_scalar_v1(p_request->'fromDate','date') is distinct from true or public.faolla_attendance_independent_scalar_v1(p_request->'throughDate','date') is distinct from true
  or p_request->'cursor'<>'null'::jsonb and public.faolla_attendance_independent_scalar_v1(p_request->'cursor','uuid') is distinct from true) then raise exception 'attendance_invalid_request';end if;
 device:=public.faolla_attendance_terminal_device_v1(p_site,p_terminal,p_secret_hash,null,false);
 select * into d from public.merchant_attendance_pin_attempts where merchant_id=p_site and terminal_id=p_terminal for update;
 select * into q from public.merchant_attendance_independent_leases where merchant_id=p_site and terminal_id=p_terminal;
 stamp:=clock_timestamp();
 if q.lease_id is null or q.lease_id is distinct from p_lease or q.expires_at<=stamp or q.created_at>stamp
  or row(q.budget_window,q.budget_ordinal) is distinct from row(d.window_at,d.attempts) or d.lease_id is not null then
  return jsonb_build_object('error','attendance_pin_invalid');end if;
 --Consume before any business subtransaction. Expected denials retain this.
 delete from public.merchant_attendance_independent_leases where merchant_id=p_site and terminal_id=p_terminal and lease_id=p_lease;
 if p_verified is distinct from true then return jsonb_build_object('error','attendance_pin_invalid');end if;
 begin
  select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=q.worker_id for update;
  select * into s from public.merchant_attendance_independent_subjects where merchant_id=p_site and subject_id=q.subject_id for update;
  select * into c from public.merchant_attendance_independent_credentials where merchant_id=p_site and subject_id=q.subject_id for update;
  select * into config from public.merchant_attendance_settings where merchant_id=p_site;
  select * into l from public.merchant_attendance_locations where merchant_id=p_site and id=(device->'terminal'->>'locationId')::uuid;
  stamp:=clock_timestamp();
  if w.id is null or w.employee_id is not null or lower(btrim(w.worker_no))<>lower(p_no) or not w.active or s.state is distinct from 'independent' or not coalesce(s.enabled,false)
   or row(s.worker_id,s.generation,w.version,c.credential_id,c.revision,c.generation) is distinct from row(w.id,q.generation,q.worker_version,q.credential_id,q.credential_revision,q.generation)
   or not coalesce(c.enabled,false) or c.changed_at>stamp or s.updated_at>stamp or q.expires_at<=stamp
   or stamp>=(device->'terminal'->>'deviceExpiresAt')::timestamptz or stamp<(device->'terminal'->>'pairedAt')::timestamptz then raise exception 'attendance_pin_invalid';end if;
  if l.id is null or not l.active or l.id is distinct from w.default_location_id then raise exception 'attendance_location_denied';end if;
  if l.radius_meters is not null then raise exception 'attendance_location_verification_required';end if;
  if (select count(*) from public.merchant_attendance_employment_periods where merchant_id=p_site and worker_id=w.id and starts_on<=(stamp at time zone l.time_zone)::date and (ends_on is null or ends_on>=(stamp at time zone l.time_zone)::date))<>1 then raise exception 'attendance_not_employed';end if;
  if kind in('recover','personal') and row(s.subject_id::text,w.id::text) is distinct from row(p_request->>'subjectId',p_request->>'workerId') then raise exception 'attendance_independent_identity_changed';end if;
  select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id order by sequence desc limit 1;
  if tail.id is not null then
   select * into x from public.merchant_attendance_independent_event_sources where event_id=tail.id;
   if x.subject_id is distinct from s.subject_id then raise exception 'attendance_independent_identity_changed';end if;perform public.faolla_attendance_independent_clock_receipt_v1(x);
  end if;
  seq:=coalesce(tail.sequence,0);status_name:=case when tail.id is null or tail.action='clock_out' then 'off' when tail.action='break_start' then 'break' else 'working' end;
  if kind='clock' then
   op:=(command_value->>'operationId')::uuid;fp:=public.faolla_attendance_independent_clock_hash_v1(p_site,p_terminal,command_value);
   select * into e from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and operation_id=op;
   if e.id is not null then
    select * into x from public.merchant_attendance_independent_event_sources where event_id=e.id;
    if row(x.subject_id,x.terminal_id,x.command_fingerprint) is distinct from row(s.subject_id,p_terminal,fp) or x.command is distinct from command_value then raise exception 'attendance_operation_conflict';end if;
   else
    if row(command_value->>'subjectId',command_value->>'workerId',command_value->>'credentialId',command_value->>'locationId') is distinct from row(s.subject_id::text,w.id::text,c.credential_id::text,l.id::text)
     or row((command_value->>'generation')::bigint,(command_value->>'credentialRevision')::bigint,(command_value->>'expectedWorkerVersion')::bigint,(command_value->>'expectedSettingsVersion')::bigint,(command_value->>'expectedLocationVersion')::bigint)
       is distinct from row(s.generation,c.revision,w.version,config.version,l.version) then raise exception 'attendance_independent_changed';end if;
    if (command_value->>'expectedSequence')::bigint<>seq or seq>=9007199254740990 then raise exception 'attendance_sequence_conflict';end if;
    action_name:=command_value->>'action';
    if action_name in('clock_in','break_start') and (p_allow_new is distinct from true or not config.enabled) then raise exception 'attendance_independent_disabled';end if;
    if tail.occurred_at>stamp then raise exception 'attendance_time_reversed';end if;
    if not(action_name='clock_in' and status_name='off' or action_name='break_start' and status_name='working' or action_name='break_end' and status_name='break' or action_name='clock_out' and status_name='working') then raise exception 'attendance_invalid_transition';end if;
    if action_name='break_start' and (command_value->>'breakPaid')::boolean is distinct from config.web_break_paid then raise exception 'attendance_independent_changed';end if;
    insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
     values(p_site,w.id,l.id,op,seq+1,action_name,'kiosk',(command_value->>'breakPaid')::boolean,stamp,stamp,l.time_zone,null) returning * into e;
    insert into public.merchant_attendance_independent_event_sources values(e.id,p_site,s.subject_id,w.id,op,s.generation,c.credential_id,c.revision,c.issue_operation_id,p_terminal,w.version,config.version,l.version,command_value,fp,stamp) returning * into x;
   end if;receipt:=public.faolla_attendance_independent_clock_receipt_v1(x);
  elsif kind='recover' then
   select * into x from public.merchant_attendance_independent_event_sources where merchant_id=p_site and worker_id=w.id and operation_id=(p_request->>'operationId')::uuid;
   if x.event_id is not null then
    if row(x.subject_id,x.terminal_id,x.command_fingerprint) is distinct from row(s.subject_id,p_terminal,p_request->>'commandFingerprint') then raise exception 'attendance_operation_conflict';end if;
    receipt:=public.faolla_attendance_independent_clock_receipt_v1(x);
   elsif exists(select 1 from public.merchant_attendance_events where merchant_id=p_site and worker_id=w.id and operation_id=(p_request->>'operationId')::uuid) then raise exception 'attendance_operation_conflict';end if;
  end if;
  subject_value:=jsonb_build_object('subjectId',s.subject_id,'workerId',w.id,'workerNo',w.worker_no,'displayName',w.display_name,'generation',s.generation,'workerVersion',w.version,
   'credentialId',c.credential_id,'credentialRevision',c.revision,'settingsVersion',config.version,'locationId',l.id,'locationVersion',l.version,'timeZone',l.time_zone);
  if kind='personal' then data_value:=jsonb_build_object('kind','personal','report',public.faolla_attendance_independent_report_v1(p_site,s.subject_id,(p_request->>'fromDate')::date,(p_request->>'throughDate')::date,(p_request->>'cursor')::uuid));
  elsif kind='recover' then data_value:=jsonb_build_object('kind','receipt','receipt',receipt);
  elsif kind='clock' then data_value:=jsonb_build_object('kind','clock','subject',subject_value,'head',public.faolla_attendance_independent_head_v1(p_site,w.id,s.subject_id),'receipt',receipt);
  else data_value:=jsonb_build_object('kind','state','subject',subject_value,'head',public.faolla_attendance_independent_head_v1(p_site,w.id,s.subject_id));end if;
  value:=jsonb_build_object('protocol','attendance-independent-terminal-v1','siteId',p_site,'terminalId',p_terminal,'readAt',case when kind='personal' then data_value->'report'->>'readAt' else public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()) end,'data',data_value);
  if octet_length(convert_to(value::text,'UTF8'))>1048576 then raise exception 'attendance_independent_too_large';end if;return value;
 exception when raise_exception then
  if sqlerrm in('attendance_pin_invalid','attendance_location_denied','attendance_location_verification_required','attendance_not_employed','attendance_independent_identity_changed','attendance_operation_conflict','attendance_independent_changed','attendance_sequence_conflict','attendance_independent_disabled','attendance_time_reversed','attendance_invalid_transition','attendance_independent_too_large') then return jsonb_build_object('error',sqlerrm);end if;raise;
 end;
end;
$$;

do $independent_forward$
declare spec jsonb;change jsonb;f pg_proc%rowtype;after_fn pg_proc%rowtype;ns text;body_value text;signature text;definition text;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080196) then return;end if;
 select n.nspname into ns from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.faolla_schema_migrations'::regclass;
 for spec in select value from jsonb_array_elements($independent_recipes$[{"name":"faolla_attendance_operational_punch_core_self_v1","types":"text,uuid,jsonb,uuid,jsonb","oldHash":"f973638ea35c96cc4b985f38be28944cb14b4431faf25f9257224385b6dae02a","newHash":"e727b905e679330a066722a41d0c45c893ce5f7b27d68d007bc2a07c86950995","changes":[{"from":"if v_last.id is not null and v_last.actor_employee_id is distinct from v_employee.id then","to":"if v_last.id is not null and v_last.actor_employee_id is distinct from v_employee.id\n    and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site_id,v_worker.id,v_employee.id,p_auth_user_id,v_last.id,v_last.sequence,p_command,p_operation_id) then","count":1}],"argumentNames":["p_site_id","p_auth_user_id","p_command","p_operation_id","p_intent"],"defaults":3,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"]},{"name":"faolla_attendance_operational_punch_core_pin_v1","types":"text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb","oldHash":"efb61fde492e2ff04de46ee6ab132fcdd01a2dc1494b8d87da6b8c24c7c89580","newHash":"727b4f342048d27213d97b8c866451235f2742d9caea95b5413c161854a46de7","changes":[{"from":"if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id then","to":"if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id\n      and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site,w.id,w.employee_id,(select auth_user_id from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id),last_row.id,last_row.sequence,c,case when c is null then op else null end) then","count":1}],"argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_verified","p_request","p_allow_new","p_intent"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"]},{"name":"faolla_attendance_pin_schedule_v1","types":"text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean","oldHash":"bf2960c1c02831214ef55e9086dd692f7c3c4df16d7d1ebe02cb1fc7797cb1f4","newHash":"3bcf5680fd0db0e264773a6c51a3520d52abe20cc097cb9afef35e5a9d8c8e43","changes":[{"from":"if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id then","to":"if last_row.id is not null and last_row.actor_employee_id is distinct from w.employee_id\n      and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site,w.id,w.employee_id,(select auth_user_id from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id),last_row.id,last_row.sequence,c,case when c is null then op else null end) then","count":1}],"argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_verified","p_request","p_allow_new","p_selection","p_allow_schedule","p_bind_rules"],"defaults":3,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"serviceExecute":true,"config":["search_path=pg_catalog"]},{"name":"faolla_attendance_operational_punch_core_onsite_v1","types":"text,uuid,jsonb,jsonb,uuid,boolean,jsonb","oldHash":"69dc67947b006f51b6ff278bd792eda134343666371a49cda5d677be7d9372ab","newHash":"d69fd7357056805bf06c1e3c69f3dc7bfbf765dd93993d0214df78a3fac3e656","changes":[{"from":"if last_row.id is not null and last_row.actor_employee_id is distinct from e.id\n    then","to":"if last_row.id is not null and last_row.actor_employee_id is distinct from e.id\n    and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site,w.id,e.id,p_auth,last_row.id,last_row.sequence,p_command,p_operation)\n    then","count":1}],"argumentNames":["p_site","p_auth","p_claims","p_command","p_operation","p_allow_new","p_intent"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"]},{"name":"faolla_attendance_operational_punch_core_location_v1","types":"text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb","oldHash":"119ae50e697c068a27aeab6343db303faf7383ac9f1f06da65dcea187c6170ef","newHash":"ef07a7f2c161e441c0ad83568ecab882448589a3e584002adf4136cbb45d7580","changes":[{"from":"v_sequence:=coalesce(v_last.sequence,0);","to":"if v_last.id is not null and v_last.actor_employee_id is distinct from v_employee.id\n    and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site_id,v_worker.id,v_employee.id,p_auth_user_id,v_last.id,v_last.sequence,p_command,p_operation_id) then raise exception 'attendance_access_denied';end if;\n  v_sequence:=coalesce(v_last.sequence,0);","count":1}],"argumentNames":["p_site_id","p_auth_user_id","p_expected_worker_id","p_command","p_operation_id","p_assertion","p_allow_new_sessions","p_require_clock","p_intent"],"defaults":6,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"]},{"name":"faolla_attendance_operational_punch_core_location_v2","types":"text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb","oldHash":"8e100afb65a53d2b042297419aeb50419033011158e4e7a4671929259bd595b2","newHash":"26c882df63eba5f4d94a8cd8116f9767f9ba550a3ef17bec99d09f5c26294a0f","changes":[{"from":"null,op,null,p_allow_new_sessions,p_require_clock or p_command is not null,p_intent)","to":"null,case when p_command->>'action'='clock_in' and public.faolla_attendance_independent_bootstrap_intent_v1(p_site_id,w.id,e.id,p_auth_user_id,(select id from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=w.id order by sequence desc limit 1),(select sequence from public.merchant_attendance_events where merchant_id=p_site_id and worker_id=w.id order by sequence desc limit 1),p_command,null) then null else op end,null,p_allow_new_sessions,p_require_clock or p_command is not null,p_intent)","count":1},{"from":"if last_fact.id is not null and last_fact.actor_employee_id is distinct from e.id then","to":"if last_fact.id is not null and last_fact.actor_employee_id is distinct from e.id\n    and not public.faolla_attendance_independent_bootstrap_intent_v1(p_site_id,w.id,e.id,p_auth_user_id,last_fact.id,last_fact.sequence,p_command,p_operation_id) then","count":1}],"argumentNames":["p_site_id","p_auth_user_id","p_expected_worker_id","p_command","p_operation_id","p_assertion","p_allow_new_sessions","p_require_clock","p_intent"],"defaults":6,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"]},{"name":"faolla_attendance_operating_head_v1","types":"text,uuid","oldHash":"a765524a5112d6ea357143839212b1a279a6b95c6b947c3e98817727b9212e3e","newHash":"f42309a7f8ca97327b95bc9e1c29ae60e2791dc43323ad5d3bee2e0f61d48085","changes":[{"from":"if b is not null then v:=v||jsonb_build_object('administrativeBoundary',b);end if;return v;","to":"if b is not null then v:=v||jsonb_build_object('administrativeBoundary',b);end if;\n b:=public.faolla_attendance_independent_current_boundary_v1(p_site,p_worker);\n if b is not null then v:=v||jsonb_build_object('independentBindingBoundary',b);end if;return v;","count":1}],"argumentNames":["p_site","p_worker"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"]}]$independent_recipes$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',spec->>'types');select * into f from pg_proc where oid=to_regprocedure(signature);
  if encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'oldHash' then raise exception 'merchant_attendance_independent_forward_conflict:%',spec->>'name';end if;
  body_value:=replace(f.prosrc,E'\r\n',E'\n');
  for change in select value from jsonb_array_elements(spec->'changes') loop
   if (length(body_value)-length(replace(body_value,replace(change->>'from','public.',ns||'.'),'')))/length(replace(change->>'from','public.',ns||'.'))<>(change->>'count')::integer then raise exception 'merchant_attendance_independent_recipe_conflict:%',spec->>'name';end if;
   body_value:=replace(body_value,replace(change->>'from','public.',ns||'.'),replace(change->>'to','public.',ns||'.'));
  end loop;
  if encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'newHash' then raise exception 'merchant_attendance_independent_recipe_hash:%',spec->>'name';end if;
  definition:=pg_get_functiondef(f.oid);
  if (length(definition)-length(replace(definition,f.prosrc,'')))/length(f.prosrc)<>1 then raise exception 'merchant_attendance_independent_recipe_definition';end if;
  execute replace(definition,f.prosrc,body_value);
  select * into after_fn from pg_proc where oid=to_regprocedure(signature);
  if after_fn.oid is distinct from f.oid or after_fn.proacl is distinct from f.proacl or pg_get_expr(after_fn.proargdefaults,0) is distinct from pg_get_expr(f.proargdefaults,0)
   or (to_jsonb(after_fn)-array['prosrc','proargdefaults']) is distinct from (to_jsonb(f)-array['prosrc','proargdefaults']) then raise exception 'merchant_attendance_independent_recipe_metadata';end if;
 end loop;
end;
$independent_forward$;

do $independent_function_security$
declare f record;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080196) then return;end if;
 for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and left(p.proname,length('faolla_attendance_independent_'))='faolla_attendance_independent_' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;
$independent_function_security$;
grant execute on function public.faolla_attendance_independent_admin_v1(text,uuid,jsonb,jsonb,jsonb,boolean) to service_role;
grant execute on function public.faolla_attendance_independent_begin_v1(text,uuid,text,text,uuid,boolean) to service_role;
grant execute on function public.faolla_attendance_independent_finish_v1(text,uuid,text,text,uuid,boolean,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610080196,'merchant_attendance_independent_workers') on conflict(version) do nothing;

do $independent_postconditions$
declare installed boolean;ns text;expected_owner oid;spec jsonb;col jsonb;c jsonb;ix jsonb;f pg_proc%rowtype;t regclass;con pg_constraint%rowtype;idx pg_index%rowtype;
 actual jsonb;keys text[];refkeys text[];expected_hash text;signature text;has190 boolean;tr record;count_expected integer;
begin
 select n.nspname into ns from pg_class v join pg_namespace n on n.oid=v.relnamespace where v.oid='public.faolla_schema_migrations'::regclass;
 expected_owner:=(select oid from pg_roles where rolname=current_user);
 if exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name<>'merchant_attendance_independent_workers') then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name='merchant_attendance_independent_workers');
 if not installed then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name<>'merchant_attendance_correction_delegation_permission')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations') then raise exception 'merchant_attendance_independent_installation_conflict';end if;
 has190:=exists(select 1 from public.faolla_schema_migrations where version=202610080190 and name='merchant_attendance_correction_delegation_permission');
 for spec in select value from jsonb_array_elements($independent_postconditions_dependencies$[{"name":"faolla_attendance_control_day_boundary_v1","types":"date,text","argumentNames":["p_date","p_zone"],"defaults":0,"resultType":"timestamptz","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"6c1479bd60a7349acc92fe7a2b7552509751e65be5651cc48d102c00834164a8","source":"202609300084_merchant_attendance_correction_controls.sql"},{"name":"faolla_attendance_group_date_v1","types":"text,text","argumentNames":["p","z"],"defaults":1,"resultType":"boolean","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b","source":"202610030124_merchant_attendance_groups.sql"},{"name":"faolla_attendance_group_text_v1","types":"text,integer,integer","argumentNames":["p","lo","hi"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562","source":"202610030124_merchant_attendance_groups.sql"},{"name":"faolla_attendance_operational_punch_stamp_v1","types":"timestamptz","argumentNames":["p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2","source":"202610080193_merchant_attendance_operational_punch.sql"},{"name":"faolla_attendance_operational_rule_hash_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7","source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_rule_object_v1","types":"jsonb,text[]","argumentNames":["p","ks"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7","source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_operational_rule_scalar_v1","types":"jsonb,text","argumentNames":["p","k"],"defaults":0,"resultType":"boolean","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce","source":"202610080191_merchant_attendance_operational_rules.sql"},{"name":"faolla_attendance_terminal_device_v1","types":"text,uuid,text,text,boolean","argumentNames":["p_site","p_id","p_secret_hash","p_device_hash","p_allow_pair"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"268246908e643bebaba3519ae75117ef677d787de57535f571bee8d929ca7e99","source":"202610010104_merchant_attendance_terminals.sql"},{"name":"faolla_valid_merchant_enterprise_permissions_v1","types":"text[]","argumentNames":["p_permissions"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog, public"],"serviceExecute":false,"hash":"a2461e9bb6f3673523a9d3ccc7a57892b2bda75501045d2a71658fcd642d0254","source":"202610080190_merchant_attendance_correction_delegation_permission.sql","legacyHash":"edc7756cfdca5b75cf9419c199cda5982ebac77b25fc58ce4ebdbf5f229550bc"},{"name":"faolla_attendance_operational_punch_core_self_v1","types":"text,uuid,jsonb,uuid,jsonb","oldHash":"f973638ea35c96cc4b985f38be28944cb14b4431faf25f9257224385b6dae02a","newHash":"e727b905e679330a066722a41d0c45c893ce5f7b27d68d007bc2a07c86950995","argumentNames":["p_site_id","p_auth_user_id","p_command","p_operation_id","p_intent"],"defaults":3,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":"e727b905e679330a066722a41d0c45c893ce5f7b27d68d007bc2a07c86950995"},{"name":"faolla_attendance_operational_punch_core_pin_v1","types":"text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb","oldHash":"efb61fde492e2ff04de46ee6ab132fcdd01a2dc1494b8d87da6b8c24c7c89580","newHash":"727b4f342048d27213d97b8c866451235f2742d9caea95b5413c161854a46de7","argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_verified","p_request","p_allow_new","p_intent"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":"727b4f342048d27213d97b8c866451235f2742d9caea95b5413c161854a46de7"},{"name":"faolla_attendance_pin_schedule_v1","types":"text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean","oldHash":"bf2960c1c02831214ef55e9086dd692f7c3c4df16d7d1ebe02cb1fc7797cb1f4","newHash":"3bcf5680fd0db0e264773a6c51a3520d52abe20cc097cb9afef35e5a9d8c8e43","argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_verified","p_request","p_allow_new","p_selection","p_allow_schedule","p_bind_rules"],"defaults":3,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"serviceExecute":true,"config":["search_path=pg_catalog"],"hash":"3bcf5680fd0db0e264773a6c51a3520d52abe20cc097cb9afef35e5a9d8c8e43"},{"name":"faolla_attendance_operational_punch_core_onsite_v1","types":"text,uuid,jsonb,jsonb,uuid,boolean,jsonb","oldHash":"69dc67947b006f51b6ff278bd792eda134343666371a49cda5d677be7d9372ab","newHash":"d69fd7357056805bf06c1e3c69f3dc7bfbf765dd93993d0214df78a3fac3e656","argumentNames":["p_site","p_auth","p_claims","p_command","p_operation","p_allow_new","p_intent"],"defaults":1,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":"d69fd7357056805bf06c1e3c69f3dc7bfbf765dd93993d0214df78a3fac3e656"},{"name":"faolla_attendance_operational_punch_core_location_v1","types":"text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb","oldHash":"119ae50e697c068a27aeab6343db303faf7383ac9f1f06da65dcea187c6170ef","newHash":"ef07a7f2c161e441c0ad83568ecab882448589a3e584002adf4136cbb45d7580","argumentNames":["p_site_id","p_auth_user_id","p_expected_worker_id","p_command","p_operation_id","p_assertion","p_allow_new_sessions","p_require_clock","p_intent"],"defaults":6,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":"ef07a7f2c161e441c0ad83568ecab882448589a3e584002adf4136cbb45d7580"},{"name":"faolla_attendance_operational_punch_core_location_v2","types":"text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb","oldHash":"8e100afb65a53d2b042297419aeb50419033011158e4e7a4671929259bd595b2","newHash":"26c882df63eba5f4d94a8cd8116f9767f9ba550a3ef17bec99d09f5c26294a0f","argumentNames":["p_site_id","p_auth_user_id","p_expected_worker_id","p_command","p_operation_id","p_assertion","p_allow_new_sessions","p_require_clock","p_intent"],"defaults":6,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":"26c882df63eba5f4d94a8cd8116f9767f9ba550a3ef17bec99d09f5c26294a0f"},{"name":"faolla_attendance_operating_head_v1","types":"text,uuid","oldHash":"a765524a5112d6ea357143839212b1a279a6b95c6b947c3e98817727b9212e3e","newHash":"f42309a7f8ca97327b95bc9e1c29ae60e2791dc43323ad5d3bee2e0f61d48085","argumentNames":["p_site","p_worker"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"serviceExecute":false,"config":["search_path=pg_catalog"],"hash":"f42309a7f8ca97327b95bc9e1c29ae60e2791dc43323ad5d3bee2e0f61d48085"}]$independent_postconditions_dependencies$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.'));
  select * into f from pg_proc where oid=to_regprocedure(signature);
  expected_hash:=coalesce(spec->>'hash',case when installed then spec->>'newHash' else spec->>'oldHash' end);
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' and not has190 then expected_hash:=spec->>'legacyHash';end if;
  if f.oid is null or f.proowner<>expected_owner or f.prokind<>'f' or f.proretset or f.proisstrict or f.proleakproof or f.proargmodes is not null or f.proparallel<>'u'
   or f.prolang<>(select oid from pg_language where lanname=spec->>'language') or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.provolatile::text<>spec->>'volatility' or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames')) or f.pronargdefaults<>(spec->>'defaults')::integer
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash
   then raise exception 'merchant_attendance_independent_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if (has_function_privilege(expected_owner,f.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)))) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  else
   if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE')<>(spec->>'serviceExecute')::boolean
    or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>expected_owner or a.grantee<>expected_owner and not((spec->>'serviceExecute')::boolean and a.grantee=(select oid from pg_roles where rolname='service_role') and a.privilege_type='EXECUTE' and not a.is_grantable)) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns) and left(proname,30)='faolla_attendance_independent_')<>(case when installed then 20 else 0 end) then raise exception 'merchant_attendance_independent_installation_conflict:function_inventory';end if;
 for spec in select value from jsonb_array_elements($independent_postconditions_tables$[{"name":"merchant_attendance_independent_subjects","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"kind","type":"text","nullable":false,"default":"'independent'"},{"name":"state","type":"text","nullable":false,"default":null},{"name":"enabled","type":"boolean","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"revision","type":"bigint","nullable":false,"default":null},{"name":"created_operation_id","type":"uuid","nullable":false,"default":null},{"name":"created_by","type":"uuid","nullable":false,"default":null},{"name":"created_at","type":"timestamptz","nullable":false,"default":null},{"name":"updated_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_subjects_kind_ck1","kind":"c","expression":"kind='independent'"},{"name":"ind196_subjects_state_ck2","kind":"c","expression":"state=any(array['independent','bound'])"},{"name":"ind196_subjects_generation_ck3","kind":"c","expression":"generation>=0 and generation<=9007199254740990"},{"name":"ind196_subjects_revision_ck4","kind":"c","expression":"revision>=1 and revision<=9007199254740990"},{"name":"ind196_subjects_created_at_ck5","kind":"c","expression":"isfinite(created_at)"},{"name":"ind196_subjects_updated_at_ck6","kind":"c","expression":"isfinite(updated_at) and updated_at>=created_at"},{"name":"ind196_subjects_pk7","kind":"p","keys":["merchant_id","subject_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_subjects_uq8","kind":"u","keys":["merchant_id","worker_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_subjects_fk9","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_subjects_ck10","kind":"c","expression":"state<>'bound' or not enabled"}]},{"name":"merchant_attendance_independent_entries","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"operation_id","type":"uuid","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"action","type":"text","nullable":false,"default":null},{"name":"actor_auth_user_id","type":"uuid","nullable":false,"default":null},{"name":"command","type":"jsonb","nullable":false,"default":null},{"name":"command_fingerprint","type":"text","nullable":false,"default":null},{"name":"subject_revision","type":"bigint","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"worker_version","type":"bigint","nullable":false,"default":null},{"name":"credential_revision","type":"bigint","nullable":true,"default":null},{"name":"credential_id","type":"uuid","nullable":true,"default":null},{"name":"material_commitment","type":"text","nullable":true,"default":null},{"name":"recorded_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_entries_action_ck1","kind":"c","expression":"action=any(array['create','enable','disable','issue_pin','revoke_pin','bind_member'])"},{"name":"ind196_entries_command_fingerprint_ck2","kind":"c","expression":"command_fingerprint~'^[0-9a-f]{64}$'"},{"name":"ind196_entries_subject_revision_ck3","kind":"c","expression":"subject_revision>=1 and subject_revision<=9007199254740990"},{"name":"ind196_entries_generation_ck4","kind":"c","expression":"generation>=0 and generation<=9007199254740990"},{"name":"ind196_entries_worker_version_ck5","kind":"c","expression":"worker_version>=1 and worker_version<=9007199254740990"},{"name":"ind196_entries_credential_revision_ck6","kind":"c","expression":"credential_revision>=0 and credential_revision<=9007199254740990"},{"name":"ind196_entries_material_commitment_ck7","kind":"c","expression":"material_commitment~'^[0-9a-f]{64}$'"},{"name":"ind196_entries_recorded_at_ck8","kind":"c","expression":"isfinite(recorded_at)"},{"name":"ind196_entries_pk9","kind":"p","keys":["merchant_id","operation_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_entries_uq10","kind":"u","keys":["merchant_id","subject_id","subject_revision"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_entries_fk11","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_entries_fk12","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_entries_ck13","kind":"c","expression":"(action='issue_pin')=(material_commitment is not null)"},{"name":"ind196_entries_ck14","kind":"c","expression":"(action='issue_pin')=(credential_id is not null)"}]},{"name":"merchant_attendance_independent_credentials","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"credential_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"revision","type":"bigint","nullable":false,"default":null},{"name":"enabled","type":"boolean","nullable":false,"default":null},{"name":"salt","type":"text","nullable":true,"default":null},{"name":"verifier","type":"text","nullable":true,"default":null},{"name":"issue_operation_id","type":"uuid","nullable":false,"default":null},{"name":"changed_at","type":"timestamptz","nullable":false,"default":null},{"name":"attempts","type":"integer","nullable":false,"default":"0"},{"name":"window_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_credentials_generation_ck1","kind":"c","expression":"generation>=0 and generation<=9007199254740990"},{"name":"ind196_credentials_revision_ck2","kind":"c","expression":"revision>=1 and revision<=9007199254740990"},{"name":"ind196_credentials_changed_at_ck3","kind":"c","expression":"isfinite(changed_at)"},{"name":"ind196_credentials_attempts_ck4","kind":"c","expression":"attempts>=0 and attempts<=10"},{"name":"ind196_credentials_window_at_ck5","kind":"c","expression":"isfinite(window_at)"},{"name":"ind196_credentials_pk6","kind":"p","keys":["merchant_id","subject_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_credentials_uq7","kind":"u","keys":["merchant_id","credential_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_credentials_fk8","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_credentials_fk9","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_credentials_fk10","kind":"f","keys":["merchant_id","issue_operation_id"],"reference":"merchant_attendance_independent_entries","referenceKeys":["merchant_id","operation_id"],"deferred":true,"initiallyDeferred":true,"delete":"a"},{"name":"ind196_credentials_ck11","kind":"c","expression":"(enabled and salt~'^[0-9a-f]{32}$' and verifier~'^[0-9a-f]{64}$' and salt is not null and verifier is not null)\n  or (not enabled and salt is null and verifier is null)"}]},{"name":"merchant_attendance_independent_leases","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"terminal_id","type":"uuid","nullable":false,"default":null},{"name":"lease_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"worker_version","type":"bigint","nullable":false,"default":null},{"name":"credential_id","type":"uuid","nullable":false,"default":null},{"name":"credential_revision","type":"bigint","nullable":false,"default":null},{"name":"budget_window","type":"timestamptz","nullable":false,"default":null},{"name":"budget_ordinal","type":"integer","nullable":false,"default":null},{"name":"created_at","type":"timestamptz","nullable":false,"default":null},{"name":"expires_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_leases_versions_ck","kind":"c","expression":"generation>=0 and generation<=9007199254740990 and worker_version>=1 and worker_version<=9007199254740990 and credential_revision>=1 and credential_revision<=9007199254740990"},{"name":"ind196_leases_budget_window_ck1","kind":"c","expression":"isfinite(budget_window)"},{"name":"ind196_leases_budget_ordinal_ck2","kind":"c","expression":"budget_ordinal>=1 and budget_ordinal<=60"},{"name":"ind196_leases_created_at_ck3","kind":"c","expression":"isfinite(created_at)"},{"name":"ind196_leases_pk4","kind":"p","keys":["merchant_id","terminal_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_leases_uq5","kind":"u","keys":["merchant_id","lease_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_leases_ck6","kind":"c","expression":"expires_at=created_at+'00:00:30'::interval"},{"name":"ind196_leases_fk7","kind":"f","keys":["merchant_id","terminal_id"],"reference":"merchant_attendance_terminals","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_leases_fk8","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_leases_fk9","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"}]},{"name":"merchant_attendance_independent_event_sources","columns":[{"name":"event_id","type":"uuid","nullable":false,"default":null},{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"operation_id","type":"uuid","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"credential_id","type":"uuid","nullable":false,"default":null},{"name":"credential_revision","type":"bigint","nullable":false,"default":null},{"name":"credential_issue_operation_id","type":"uuid","nullable":false,"default":null},{"name":"terminal_id","type":"uuid","nullable":false,"default":null},{"name":"worker_version","type":"bigint","nullable":false,"default":null},{"name":"settings_version","type":"bigint","nullable":false,"default":null},{"name":"location_version","type":"bigint","nullable":false,"default":null},{"name":"command","type":"jsonb","nullable":false,"default":null},{"name":"command_fingerprint","type":"text","nullable":false,"default":null},{"name":"recorded_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_event_sources_pk1","kind":"p","keys":["event_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_event_sources_event_id_fk2","kind":"f","keys":["event_id"],"reference":"merchant_attendance_events","referenceKeys":["id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_event_sources_generation_ck3","kind":"c","expression":"generation>=0 and generation<=9007199254740990"},{"name":"ind196_event_sources_credential_revision_ck4","kind":"c","expression":"credential_revision>=1 and credential_revision<=9007199254740990"},{"name":"ind196_event_sources_versions_ck","kind":"c","expression":"worker_version>=1 and worker_version<=9007199254740990 and settings_version>=1 and settings_version<=9007199254740990 and location_version>=1 and location_version<=9007199254740990"},{"name":"ind196_event_sources_command_fingerprint_ck5","kind":"c","expression":"command_fingerprint~'^[0-9a-f]{64}$'"},{"name":"ind196_event_sources_recorded_at_ck6","kind":"c","expression":"isfinite(recorded_at)"},{"name":"ind196_event_sources_uq7","kind":"u","keys":["merchant_id","worker_id","operation_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_event_sources_fk8","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_event_sources_fk9","kind":"f","keys":["merchant_id","worker_id"],"reference":"merchant_attendance_workers","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_event_sources_fk10","kind":"f","keys":["merchant_id","credential_issue_operation_id"],"reference":"merchant_attendance_independent_entries","referenceKeys":["merchant_id","operation_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_event_sources_fk11","kind":"f","keys":["merchant_id","terminal_id"],"reference":"merchant_attendance_terminals","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"}]},{"name":"merchant_attendance_independent_member_bindings","columns":[{"name":"merchant_id","type":"text","nullable":false,"default":null},{"name":"subject_id","type":"uuid","nullable":false,"default":null},{"name":"worker_id","type":"uuid","nullable":false,"default":null},{"name":"operation_id","type":"uuid","nullable":false,"default":null},{"name":"employee_id","type":"uuid","nullable":false,"default":null},{"name":"employee_auth_user_id","type":"uuid","nullable":false,"default":null},{"name":"worker_version","type":"bigint","nullable":false,"default":null},{"name":"generation","type":"bigint","nullable":false,"default":null},{"name":"last_independent_event_id","type":"uuid","nullable":true,"default":null},{"name":"last_sequence","type":"bigint","nullable":false,"default":null},{"name":"actor_auth_user_id","type":"uuid","nullable":false,"default":null},{"name":"command_fingerprint","type":"text","nullable":false,"default":null},{"name":"bound_at","type":"timestamptz","nullable":false,"default":null}],"constraints":[{"name":"ind196_member_bindings_versions_ck","kind":"c","expression":"worker_version>=2 and worker_version<=9007199254740990 and generation>=1 and generation<=9007199254740990"},{"name":"ind196_member_bindings_last_independent_event_id_fk1","kind":"f","keys":["last_independent_event_id"],"reference":"merchant_attendance_events","referenceKeys":["id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_member_bindings_last_sequence_ck2","kind":"c","expression":"last_sequence>=0 and last_sequence<=9007199254740990"},{"name":"ind196_member_bindings_command_fingerprint_ck3","kind":"c","expression":"command_fingerprint~'^[0-9a-f]{64}$'"},{"name":"ind196_member_bindings_bound_at_ck4","kind":"c","expression":"isfinite(bound_at)"},{"name":"ind196_member_bindings_pk5","kind":"p","keys":["merchant_id","subject_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_member_bindings_uq6","kind":"u","keys":["merchant_id","worker_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_member_bindings_uq7","kind":"u","keys":["merchant_id","operation_id"],"reference":null,"referenceKeys":null,"deferred":false,"initiallyDeferred":false,"delete":"a"},{"name":"ind196_member_bindings_fk8","kind":"f","keys":["merchant_id","subject_id"],"reference":"merchant_attendance_independent_subjects","referenceKeys":["merchant_id","subject_id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_member_bindings_fk9","kind":"f","keys":["merchant_id","operation_id"],"reference":"merchant_attendance_independent_entries","referenceKeys":["merchant_id","operation_id"],"deferred":true,"initiallyDeferred":true,"delete":"a"},{"name":"ind196_member_bindings_fk10","kind":"f","keys":["merchant_id","employee_id"],"reference":"merchant_enterprise_employees","referenceKeys":["merchant_id","id"],"deferred":false,"initiallyDeferred":false,"delete":"r"},{"name":"ind196_member_bindings_ck11","kind":"c","expression":"(last_sequence=0)=(last_independent_event_id is null)"}]}]$independent_postconditions_tables$::jsonb) loop
  t:=to_regclass(format('%I.%I',ns,spec->>'name'));
  if installed<>(t is not null) then raise exception 'merchant_attendance_independent_installation_conflict:table:%',spec->>'name';end if;
  if not installed then continue;end if;
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity and relpersistence='p' and not relispartition)
   or exists(select 1 from pg_policy where polrelid=t)
   or exists(select 1 from pg_class v cross join lateral aclexplode(coalesce(v.relacl,acldefault('r',v.relowner))) a where v.oid=t and (a.grantee<>expected_owner or a.grantor<>expected_owner))
   or exists(select 1 from pg_attribute v cross join lateral aclexplode(v.attacl) a where v.attrelid=t and (a.grantee<>expected_owner or a.grantor<>expected_owner)) then raise exception 'merchant_attendance_independent_installation_conflict:table_acl:%',spec->>'name';end if;
  if (select count(*) from pg_attribute where attrelid=t and attnum>0)<>jsonb_array_length(spec->'columns') then raise exception 'merchant_attendance_independent_installation_conflict:columns:%',spec->>'name';end if;
  count_expected:=0;
  for col in select value from jsonb_array_elements(spec->'columns') loop
   count_expected:=count_expected+1;
   if not exists(select 1 from pg_attribute a join pg_type ty on ty.oid=a.atttypid left join pg_attrdef d on d.adrelid=t and d.adnum=a.attnum
    where a.attrelid=t and a.attnum=count_expected and a.attname=col->>'name' and a.atttypid=to_regtype(col->>'type') and a.atttypmod=-1
    and not a.attisdropped and a.attidentity='' and a.attgenerated='' and a.attnotnull=(not(col->>'nullable')::boolean) and a.attcollation=ty.typcollation
    and (select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(pg_get_expr(d.adbin,t),'''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) is not distinct from (select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(col->>'default','''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord))) then raise exception 'merchant_attendance_independent_installation_conflict:column:%.%',spec->>'name',col->>'name';end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid=t)<>jsonb_array_length(spec->'constraints') then raise exception 'merchant_attendance_independent_installation_conflict:constraints:%',spec->>'name';end if;
  for c in select value from jsonb_array_elements(spec->'constraints') loop
   select * into con from pg_constraint where conrelid=t and conname=c->>'name';
   if coalesce(c->>'kind','') not in('c','p','u','f') or con.oid is null or con.contype::text<>c->>'kind' or not con.convalidated
    or con.connoinherit is distinct from ((c->>'kind') in('p','u','f')) or con.conislocal is distinct from true or con.coninhcount<>0
    or con.condeferrable<>coalesce((c->>'deferred')::boolean,false) or con.condeferred<>coalesce((c->>'initiallyDeferred')::boolean,false) then raise exception 'merchant_attendance_independent_installation_conflict:constraint:%.%',spec->>'name',c->>'name';end if;
   if con.contype='c' then
    if (select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(pg_get_expr(con.conbin,t),'''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) is distinct from (select string_agg(case when left(z.token[1],1)=chr(39) then z.token[1] else lower(regexp_replace(regexp_replace(z.token[1],'::(text|bigint|integer)(\[\])?|::name(?![[:alnum:]_\[])','','g'),'[[:space:]()\[\]"]','','g')) end,'' order by z.ord) from regexp_matches(regexp_replace(c->>'expression','''([0-9]+)''::bigint','\1','g'),'(''(?:[^'']|'''')*''|[^'']+)','g') with ordinality z(token,ord)) then raise exception 'merchant_attendance_independent_installation_conflict:check:%.%',spec->>'name',c->>'name';end if;
   else
    select array_agg(a.attname::text order by z.ord) into keys from unnest(con.conkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=t and a.attnum=z.n;
    if keys is distinct from array(select jsonb_array_elements_text(c->'keys')) then raise exception 'merchant_attendance_independent_installation_conflict:constraint_keys:%',c->>'name';end if;
    if con.contype='f' then
     select array_agg(a.attname::text order by z.ord) into refkeys from unnest(con.confkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=z.n;
     if con.confrelid is distinct from to_regclass(format('%I.%I',ns,c->>'reference')) or refkeys is distinct from array(select jsonb_array_elements_text(c->'referenceKeys'))
      or con.confmatchtype<>'s' or con.confupdtype<>'a' or con.confdeltype::text<>c->>'delete' then raise exception 'merchant_attendance_independent_installation_conflict:foreign_key:%',c->>'name';end if;
    else
     select * into idx from pg_index where indexrelid=con.conindid;
     if idx.indexrelid is null or not(idx.indisvalid and idx.indisready and idx.indislive and idx.indisunique) or idx.indpred is not null or idx.indexprs is not null
      or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or idx.indnullsnotdistinct
      or not exists(select 1 from pg_class z join pg_am a on a.oid=z.relam where z.oid=idx.indexrelid and z.relowner=expected_owner and a.amname='btree')
      or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=t and a.attname=keys[z]
       join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indkey[z-1]<>a.attnum or idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_independent_installation_conflict:constraint_index:%',c->>'name';end if;
    end if;
   end if;
  end loop;
  count_expected:=case when spec->>'name' in('merchant_attendance_independent_entries','merchant_attendance_independent_event_sources','merchant_attendance_independent_member_bindings') then 2 else 0 end;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>count_expected then raise exception 'merchant_attendance_independent_installation_conflict:triggers:%',spec->>'name';end if;
  for tr in select * from pg_trigger where tgrelid=t and not tgisinternal loop
   if tr.tgname not in('independent_immutable','independent_no_truncate') or tr.tgfoid<>to_regprocedure(format('%I.faolla_attendance_independent_guard_v1()',ns))
    or tr.tgtype<>(case when tr.tgname='independent_immutable' then 31 else 34 end) or tr.tgenabled<>'O' or tr.tgdeferrable or tr.tginitdeferred
    or tr.tgconstraint<>0 or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgargs<>''::bytea or tr.tgoldtable is not null or tr.tgnewtable is not null then raise exception 'merchant_attendance_independent_installation_conflict:trigger:%',tr.tgname;end if;
  end loop;
  if (select count(*) from pg_index where indrelid=t)<>(select count(*) from jsonb_array_elements(spec->'constraints') v where v->>'kind' in('p','u'))
   +(case when spec->>'name' in('merchant_attendance_independent_leases','merchant_attendance_independent_event_sources') then 1 else 0 end) then raise exception 'merchant_attendance_independent_installation_conflict:index_inventory:%',spec->>'name';end if;
 end loop;
 for ix in select value from jsonb_array_elements($independent_postconditions_indexes$[{"name":"attendance_independent_lease_subject_idx","table":"merchant_attendance_independent_leases","keys":["merchant_id","subject_id","terminal_id"]},{"name":"attendance_independent_source_subject_idx","table":"merchant_attendance_independent_event_sources","keys":["merchant_id","subject_id","event_id"]}]$independent_postconditions_indexes$::jsonb) loop
  select * into idx from pg_index where indexrelid=to_regclass(format('%I.%I',ns,ix->>'name'));
  if installed<>(idx.indexrelid is not null) then raise exception 'merchant_attendance_independent_installation_conflict:index:%',ix->>'name';end if;
  if not installed then continue;end if;
  select array_agg(a.attname::text order by z.ord) into keys from unnest(idx.indkey) with ordinality z(n,ord) join pg_attribute a on a.attrelid=idx.indrelid and a.attnum=z.n;
  if idx.indrelid<>to_regclass(format('%I.%I',ns,ix->>'table')) or keys is distinct from array(select jsonb_array_elements_text(ix->'keys'))
   or not(idx.indisvalid and idx.indisready and idx.indislive) or idx.indisunique or idx.indisprimary or idx.indpred is not null or idx.indexprs is not null
   or idx.indnatts<>cardinality(keys) or idx.indnkeyatts<>cardinality(keys) or not exists(select 1 from pg_class z join pg_am a on a.oid=z.relam where z.oid=idx.indexrelid and z.relowner=expected_owner and a.amname='btree')
   or exists(select 1 from generate_series(1,cardinality(keys)) z join pg_attribute a on a.attrelid=idx.indrelid and a.attname=keys[z]
    join pg_opclass o on o.oid=idx.indclass[z-1] where idx.indoption[z-1]<>0 or idx.indcollation[z-1]<>a.attcollation or not o.opcdefault or o.opcintype<>a.atttypid or o.opcnamespace<>'pg_catalog'::regnamespace) then raise exception 'merchant_attendance_independent_installation_conflict:index_shape:%',ix->>'name';end if;
 end loop;
 if not installed then return;end if;
 for spec in select value from jsonb_array_elements($independent_postconditions_functions$[{"name":"faolla_attendance_independent_scalar_v1","types":"jsonb,text","argumentNames":["p","k"],"defaults":0,"resultType":"boolean","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"a3a0121cbb19210074802f404631eebc48bcaceb2f585c921a94548b9191276d"},{"name":"faolla_attendance_independent_text_v1","types":"text,integer,integer","argumentNames":["p","lo","hi"],"defaults":0,"resultType":"boolean","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"ac9ef43eae2eb7946af62d07d128732dcd6efbe9baeca956a9cbeabe34daa5c9"},{"name":"faolla_attendance_independent_command_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"f2e26335f15c0fdcb86e5cb7f5492c9e0f1fdf56dd03c5f60148a80f23b986ca"},{"name":"faolla_attendance_independent_clock_command_v1","types":"jsonb","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"i","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"e32cd78012dd50709c4964a340b2d568f96ce2a98445c9cdd8a2ae2a0ee31c37"},{"name":"faolla_attendance_independent_admin_hash_v1","types":"text,uuid,jsonb","argumentNames":["p_site","p_auth","p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"654b0148881c9efafdefcaa3ece775fe0a3d1a1e8525eedc23cca2aeeb70efcb"},{"name":"faolla_attendance_independent_clock_hash_v1","types":"text,uuid,jsonb","argumentNames":["p_site","p_terminal","p"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"a8a07a7b3153c18e908f00bc101a8f6fd861b362235ad9350f41c8eac03e4e61"},{"name":"faolla_attendance_independent_material_hash_v1","types":"text,uuid,uuid,bigint,bigint,uuid,text,text","argumentNames":["p_site","p_worker","p_subject","p_generation","p_revision","p_operation","p_salt","p_verifier"],"defaults":0,"resultType":"text","volatility":"i","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"d63aa1239d9964f16a9315935d486df25fba48bd9d328ef3967ada14cea6d0b3"},{"name":"faolla_attendance_independent_subject_v1","types":"public.merchant_attendance_independent_subjects","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"8d52a2ef476f26d901b91a06b300b5a170e62387eaee03281a861c9ede2b4320"},{"name":"faolla_attendance_independent_head_v1","types":"text,uuid,uuid","argumentNames":["p_site","p_worker","p_subject"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"21eb62ecdfc08d4bf553b08aa2e895e85a9fc05c1f59610f3dccb8f72c928621"},{"name":"faolla_attendance_independent_receipt_v1","types":"public.merchant_attendance_independent_entries","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"882f13eeefc384d03eb3178648f4fa2ab1cd2890b6ed869336b5e9dbbc6df334"},{"name":"faolla_attendance_independent_clock_receipt_v1","types":"public.merchant_attendance_independent_event_sources","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"2bc9d92fa75ece3a3334ea0b88463945addcf7794b8dc07a7edfce95bec600ec"},{"name":"faolla_attendance_independent_boundary_v1","types":"public.merchant_attendance_independent_member_bindings","argumentNames":["p"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"sql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"067ecfc192485c414fcf55e9345a0fb9dcf3286f8a0cb5bc7fe2e0921ab48770"},{"name":"faolla_attendance_independent_bootstrap_v1","types":"text,uuid,uuid,uuid,uuid,bigint","argumentNames":["p_site","p_worker","p_employee","p_auth","p_last","p_sequence"],"defaults":0,"resultType":"boolean","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"5d889eabedbb535958987d68ca59b85f4f2942da455566ddf938a6ebd8e74b5c"},{"name":"faolla_attendance_independent_guard_v1","types":"","argumentNames":[],"defaults":0,"resultType":"trigger","volatility":"v","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"11a8d826bae099d9bcafad651222d8ef126f728670f16fc3143473fc42e40040"},{"name":"faolla_attendance_independent_bootstrap_intent_v1","types":"text,uuid,uuid,uuid,uuid,bigint,jsonb,uuid","argumentNames":["p_site","p_worker","p_employee","p_auth","p_last","p_sequence","p_command","p_operation"],"defaults":0,"resultType":"boolean","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"d6a4bdeca5983e68c3dd3305bb36b21e6e4513efb3ddcabfc2373fac0f1df7d7"},{"name":"faolla_attendance_independent_current_boundary_v1","types":"text,uuid","argumentNames":["p_site","p_worker"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"043f3b0f90ee92820463fa6149dfad3bbc74c05ac42729b81b739f81c15cdd81"},{"name":"faolla_attendance_independent_report_v1","types":"text,uuid,date,date,uuid","argumentNames":["p_site","p_subject","p_from","p_through","p_cursor"],"defaults":0,"resultType":"jsonb","volatility":"s","language":"plpgsql","securityDefiner":false,"config":["search_path=pg_catalog"],"serviceExecute":false,"hash":"973fc3e6a226fb4f14a98097935eb6be8e0e8be52103f75adc5906447f08fbcd"},{"name":"faolla_attendance_independent_admin_v1","types":"text,uuid,jsonb,jsonb,jsonb,boolean","argumentNames":["p_site","p_auth","p_query","p_command","p_material","p_allow_new"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"95f6be0160c2b667dae62536b9c94c0abc4d76edc573c0eb7f747e0042e529bb"},{"name":"faolla_attendance_independent_begin_v1","types":"text,uuid,text,text,uuid,boolean","argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_allow_new"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"2b206a250b7c9bc3927137983ee6f239af3cd15e04a80f06615d374dc2a954ce"},{"name":"faolla_attendance_independent_finish_v1","types":"text,uuid,text,text,uuid,boolean,jsonb,boolean","argumentNames":["p_site","p_terminal","p_secret_hash","p_no","p_lease","p_verified","p_request","p_allow_new"],"defaults":0,"resultType":"jsonb","volatility":"v","language":"plpgsql","securityDefiner":true,"config":["search_path=pg_catalog"],"serviceExecute":true,"hash":"ca07eda14465c67359b4db6f307a7e4612f45878bcb91f3608f6b27a7786369e"}]$independent_postconditions_functions$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.'));select * into f from pg_proc where oid=to_regprocedure(signature);
  if f.oid is null or f.proowner<>expected_owner or f.prokind<>'f' or f.proretset or f.proisstrict or f.proleakproof or f.proargmodes is not null or f.proparallel<>'u'
   or f.prolang<>(select oid from pg_language where lanname=spec->>'language') or f.prorettype<>to_regtype(replace(spec->>'resultType','public.',ns||'.'))
   or f.provolatile::text<>spec->>'volatility' or f.prosecdef<>(spec->>'securityDefiner')::boolean or f.proconfig is distinct from array(select jsonb_array_elements_text(spec->'config'))
   or coalesce(f.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames')) or f.pronargdefaults<>(spec->>'defaults')::integer
   or encode(sha256(convert_to(replace(replace(f.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   then raise exception 'merchant_attendance_independent_installation_conflict:function:%',spec->>'name';end if;
  if spec->>'name'='faolla_valid_merchant_enterprise_permissions_v1' then
   if (has_function_privilege(expected_owner,f.oid,'EXECUTE') is distinct from true
    or (select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]')
     from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a) not in(
      jsonb_build_array(jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)),
      jsonb_build_array(jsonb_build_array(expected_owner,0::oid,'EXECUTE',false),jsonb_build_array(expected_owner,expected_owner,'EXECUTE',false)))) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  else
   if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE')<>(spec->>'serviceExecute')::boolean
    or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantor<>expected_owner or a.grantee<>expected_owner and not((spec->>'serviceExecute')::boolean and a.grantee=(select oid from pg_roles where rolname='service_role') and a.privilege_type='EXECUTE' and not a.is_grantable)) then raise exception 'merchant_attendance_independent_installation_conflict:function_acl:%',spec->>'name';end if;
  end if;
 end loop;
end;
$independent_postconditions$;
commit;
