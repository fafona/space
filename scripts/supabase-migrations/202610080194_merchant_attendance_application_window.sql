--194 local candidate: new submissions only; original receipt/withdraw paths stay old.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $window_preflight$
declare ns text;expected_owner oid;installed boolean;f regprocedure;info record;expected record;t regclass;role_name text;object_name text;
begin
 select n.nspname,c.relowner into ns,expected_owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080194 and name='merchant_attendance_application_window');
 if exists(select 1 from public.faolla_schema_migrations where version=202610080194 and name<>'merchant_attendance_application_window')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080193 and name='merchant_attendance_operational_punch')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080192 and name='merchant_attendance_operational_source')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules') then raise exception 'merchant_attendance_application_window_prerequisite_required';end if;
 for expected in select * from (values
  ('public.faolla_attendance_correction_self_v2(text,uuid,jsonb,jsonb,boolean)','2df21c6bffffa0e53355e611c93165b3599e16332186c26c52140b24d7a07a69','aec67706b1a458b95d5dcbba297f5b8e8da0d0823a385b98026bd86e9cea36af',false,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled']::text[]),
  ('public.faolla_attendance_revision_self_v1(text,uuid,jsonb,jsonb,boolean)','c55d82877324bdf5c749c80dc8aa5d6d196ba3d3e01be85f5043ed7151910884','715a483eeea26ada9ef5016e2153e9d96444d2d4411abd8fdc671d220e6e912a',true,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled']::text[]),
  ('public.faolla_attendance_revision_self_v2(text,uuid,jsonb,jsonb,boolean)','99fe46d30908e9a40fd24c9167fafc74af47dfbc2a6c9092f4d21e6302e002e3','30aa5c17e979d68d4d09b2fe5df819984a9e656c04994e066a48c63b55d08d46',true,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled']::text[]),
  ('public.faolla_attendance_missing_v1(jsonb,uuid,jsonb,boolean)','9f842ddc91530b80b23a670a5a418c3fc38f9a5fb6fb4b545c8a1b00fdad063f','7b172173e1f5b8ad8db24e9cdb34529a591d66c8263d2019ead7332d6f6be661',true,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[])
 ) original(signature,original_hash,wrapper_hash,is_rpc,argnames) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or not info.prosecdef or info.provolatile<>'v' or info.lanname<>'plpgsql'
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.prorettype<>'jsonb'::regtype or info.pronargdefaults<>2
   or info.proargnames is distinct from expected.argnames or info.proretset or info.proisstrict or info.proleakproof
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from (case when installed then expected.wrapper_hash else expected.original_hash end)
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('public.faolla_attendance_operational_source_tuple_v1(jsonb)','df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a'),
  ('public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamptz)','9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee'),
  ('public.faolla_attendance_operational_punch_stamp_v1(timestamptz)','6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2'),
  ('public.faolla_attendance_operational_punch_source_ref_v1(jsonb)','31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7'),
  ('public.faolla_attendance_operational_punch_saved_source_v1(jsonb)','f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d')
 ) dependency(signature,source_hash) loop
  f:=to_regprocedure(expected.signature);select * into info from pg_proc p where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef or info.proconfig is distinct from array['search_path=pg_catalog']
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner or a.grantee<>expected_owner)
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('service_role',f,'EXECUTE')
   then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 end loop;
 if (select count(*) from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns)
  and (p.proname like 'faolla_attendance_application_window_%' or p.proname like 'faolla_attendance_operational_consumer_%'))<>(case when installed then 16 else 0 end) then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 foreach object_name in array array['merchant_attendance_operational_consumer_activations','merchant_attendance_application_window_proofs'] loop
  if (to_regclass('public.'||object_name) is not null)<>installed then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 end loop;
 if not installed then return;end if;
 for expected in select * from (values
  ('public.faolla_attendance_application_window_scalar_v1(jsonb,text)','fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db','boolean','i',false,false,0,array['p','k']::text[]),
  ('public.faolla_attendance_operational_consumer_command_v1(text,text,uuid,jsonb)','f22ef2fbe33e4214733482e36d121ded8cb9db2f48c3f84fef42faf70de641c7','jsonb','s',false,false,0,array['p_site','p_consumer','p_actor','p']::text[]),
  ('public.faolla_attendance_operational_consumer_item_v1(public.merchant_attendance_operational_consumer_activations)','018cf97af523313e0759e0cc378d80ba1d8bf98b0501ecbaab322b5819afc5a4','jsonb','s',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean)','d4cdaae19d5488037fe732553be3e7cec835db5dc057f0160f8515f55cf9408d','jsonb','v',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_activate']::text[]),
  ('public.faolla_attendance_application_window_query_v1(jsonb)','68022aba03c58075eaac3b9b98c62759f02fb19fdafca2d350cc30d0ff312d51','jsonb','s',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_application_window_command_v1(jsonb,uuid,jsonb)','ecc448d7cb4b3939d24c3726f1c305dc6ef2e784ce486d90931f5c388f73b40f','jsonb','s',false,false,0,array['p_query','p_actor','p']::text[]),
  ('public.faolla_attendance_application_window_facts_v1(text,text,uuid)','46256fe102ad1400927fe7195b9043c6db86e8affb19b931f4c0342f828b9dc6','jsonb','s',false,false,0,array['p_site','p_family','p_operation']::text[]),
  ('public.faolla_attendance_application_window_value_v1(text,jsonb,bigint,timestamptz,uuid,timestamptz,timestamptz)','dcc89ad6143fdcef106cbc201532fe3265778c5b17d2eb82a7c0928e5ef28fc2','jsonb','s',false,false,0,array['p_family','p_source','p_activation','p_anchor','p_root','p_root_anchor','p_root_deadline']::text[]),
  ('public.faolla_attendance_application_window_proof_v1(public.merchant_attendance_application_window_proofs)','548056e2b851f7114f531fe65612555bf40ac7402aa983884fb9a2b71adee81c','jsonb','s',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_application_window_gate_v1(text,boolean,uuid,timestamp with time zone)','5f7e3dfa3e51cc1baaab8d95c10a2b7b91fba556d9fd744b65e7bb686b3d9d09','void','s',false,false,0,array['p_site','p_managed','p_root','p_at']::text[]),
  ('public.faolla_attendance_application_window_v1(jsonb,uuid,jsonb,boolean)','7883e28e57dee6ba9ecb4cad48df0b0265a0d166a1272a49638cd393fdd7a511','jsonb','v',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[]),
  ('public.faolla_attendance_application_window_guard_v1()','6a06c7dcb0c318b52eec2ee5e21ae1c168107e8a0faef96fa563364e47636262','trigger','v',true,false,0,array[]::text[]),
  ('public.faolla_attendance_application_window_core_correction_v1(text,uuid,jsonb,jsonb,boolean,boolean)','fdedf2502bf938235e67d30407fa37b21a019c07b6e8ea02ad1740b77601e7b4','jsonb','v',false,false,3,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled','p_managed']::text[]),
  ('public.faolla_attendance_application_window_core_revision_v1(text,uuid,jsonb,jsonb,boolean,boolean)','2cf04d4eca7a72cbfcff4a307eaa91db932c9d447243314bb5aa81728ca401b4','jsonb','v',false,false,3,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled','p_managed']::text[]),
  ('public.faolla_attendance_application_window_core_revision_v2(text,uuid,jsonb,jsonb,boolean,boolean)','f99b9a5cb8ba6472725197b8333201754b7dd5f585bb40200df6af274815567c','jsonb','v',false,false,3,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled','p_managed']::text[]),
  ('public.faolla_attendance_application_window_core_missing_v1(jsonb,uuid,jsonb,boolean,boolean)','43eda2cad5becf065932b51d8720a8d2615dd070ef17252b6c6912215a59b46a','jsonb','v',false,false,3,array['p_query','p_auth_user_id','p_command','p_allow_write','p_managed']::text[])
 ) own(signature,source_hash,result_type,volatility,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility or info.lanname<>'plpgsql'
   or info.prorettype is distinct from to_regtype(expected.result_type) or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults
   or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_operational_consumer_activations',array['merchant_id','consumer','operation_id','revision','actor_auth_user_id','action','reason','command','command_fingerprint','recorded_at']::text[],array['text','text','uuid','bigint','uuid','text','text','jsonb','text','timestamp with time zone']::text[],7,1),
  ('merchant_attendance_application_window_proofs',array['merchant_id','family','operation_id','request_id','worker_id','employee_id','employee_auth_user_id','actor_auth_user_id','query','command','command_fingerprint','window_snapshot','source_ref','recorded_at']::text[],array['text','text','uuid','uuid','uuid','uuid','uuid','uuid','jsonb','jsonb','text','jsonb','jsonb','timestamp with time zone']::text[],4,3)
 ) tbl(table_name,columns,types,checks,fkeys) loop
  t:=to_regclass('public.'||expected.table_name);
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or array(select a.attname::text from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.columns
   or array(select format_type(a.atttypid,a.atttypmod) from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.types
   or exists(select 1 from pg_attribute where attrelid=t and attnum>0 and (attisdropped or not attnotnull or atthasdef or attidentity<>'' or attgenerated<>'' or attndims<>0))
   or exists(select 1 from pg_constraint where conrelid=t and (not convalidated or contype='c' and connoinherit))
   or (select count(*) from pg_constraint where conrelid=t and contype='c')<>expected.checks or (select count(*) from pg_constraint where conrelid=t and contype='f')<>expected.fkeys
   or (select count(*) from pg_constraint where conrelid=t and contype='p')<>1 or (select count(*) from pg_constraint where conrelid=t and contype='u')<>1
   or exists(select 1 from pg_constraint where conrelid=t and contype not in('c','f','p','u','t'))
   or (select count(*) from pg_index where indrelid=t)<>2
   or exists(select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_am am on am.oid=ic.relam where i.indrelid=t
    and (not i.indisvalid or not i.indisready or not i.indislive or not i.indisunique or i.indpred is not null or i.indexprs is not null or am.amname<>'btree' or ic.relowner<>expected_owner))
   or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='application_window_immutable' and tgtype=27 and tgenabled='O' and tgnargs=0 and tgqual is null and tgfoid='public.faolla_attendance_application_window_guard_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='application_window_no_truncate' and tgtype=34 and tgenabled='O' and tgnargs=0 and tgqual is null and tgfoid='public.faolla_attendance_application_window_guard_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='application_window_proof' and tgtype=5 and tgenabled='O' and tgnargs=0 and tgqual is null and tgdeferrable and tginitdeferred and tgfoid='public.faolla_attendance_application_window_guard_v1()'::regprocedure)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
  end loop;
 end loop;
end;
$window_preflight$;

create or replace function public.faolla_attendance_application_window_scalar_v1(p jsonb,k text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare s text:=p#>>'{}';d date;
begin
 if k='site' then return jsonb_typeof(p)='string' and char_length(s)=8 and s~'^[0-9]{8}$';
 elsif k='date' then
  if jsonb_typeof(p) is distinct from 'string' or char_length(s)<>10 or s!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
  d:=s::date;return to_char(d,'YYYY-MM-DD')=s and d between date '2000-01-01' and date '2100-12-31';
 else return public.faolla_attendance_operational_rule_scalar_v1(p,k);end if;
exception when invalid_text_representation or datetime_field_overflow then return false;
end;
$$;

create or replace function public.faolla_attendance_operational_consumer_command_v1(p_site text,p_consumer text,p_actor uuid,p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
 if p_actor is null or public.faolla_attendance_operational_rule_object_v1(p,array['siteId','consumer','operationId','action','expectedRevision','reason']) is distinct from true
  or p->>'siteId' is distinct from p_site or p->>'consumer' is distinct from p_consumer
  or public.faolla_attendance_application_window_scalar_v1(to_jsonb(p_site),'site') is distinct from true
  or p_consumer is null or p_consumer not in('application_window','review_routing','timesheet_cycle','reminders')
  or public.faolla_attendance_operational_rule_scalar_v1(p->'operationId','uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(p->'expectedRevision','revision') is distinct from true
  or (p->>'expectedRevision')::bigint>=9007199254740990 or p->>'action' is null or p->>'action' not in('activate','deactivate')
  or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,200) is distinct from true then raise exception 'attendance_invalid_request';end if;
 return jsonb_build_array('attendance-operational-consumer-activation-command-v1',p_site,p_consumer,p_actor,
  jsonb_build_array(p->>'operationId',p->>'action',(p->>'expectedRevision')::bigint,p->>'reason'));
end;
$$;
create table if not exists public.merchant_attendance_operational_consumer_activations (
 merchant_id text not null references public.merchant_attendance_settings(merchant_id),consumer text not null,
 operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),actor_auth_user_id uuid not null,
 action text not null check(action in('activate','deactivate')),reason text not null,command jsonb not null,command_fingerprint text not null,
 recorded_at timestamptz not null check(isfinite(recorded_at)),primary key(merchant_id,operation_id),unique(merchant_id,consumer,revision),
 check(consumer in('application_window','review_routing','timesheet_cycle','reminders')),
 check(command->>'siteId'=merchant_id and command->>'consumer'=consumer and command->>'operationId'=operation_id::text and command->>'action'=action and command->>'reason'=reason),
 check((command->>'expectedRevision')::bigint=revision-1),
 check(command_fingerprint=public.faolla_attendance_operational_rule_hash_v1(public.faolla_attendance_operational_consumer_command_v1(merchant_id,consumer,actor_auth_user_id,command)))
);
create table if not exists public.merchant_attendance_application_window_proofs (
 merchant_id text not null references public.merchant_attendance_settings(merchant_id),family text not null,
 operation_id uuid not null,request_id uuid not null,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
 actor_auth_user_id uuid not null,query jsonb not null,command jsonb not null,command_fingerprint text not null,window_snapshot jsonb not null,source_ref jsonb not null,
 recorded_at timestamptz not null check(isfinite(recorded_at)),primary key(merchant_id,operation_id),unique(merchant_id,family,request_id),
 foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
 foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
 check(family in('correction','correction_revision','missing','missing_revision')),
 check(octet_length(convert_to(source_ref::text,'UTF8'))<=16384),
 check(octet_length(convert_to(query::text,'UTF8'))+octet_length(convert_to(command::text,'UTF8'))+octet_length(convert_to(window_snapshot::text,'UTF8'))<=32768)
);
create or replace function public.faolla_attendance_operational_consumer_item_v1(p public.merchant_attendance_operational_consumer_activations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
 if p.operation_id is null then return null;end if;
 if p.command_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(public.faolla_attendance_operational_consumer_command_v1(p.merchant_id,p.consumer,p.actor_auth_user_id,p.command))
  or p.revision is distinct from (p.command->>'expectedRevision')::bigint+1 or p.command->>'operationId' is distinct from p.operation_id::text
  or p.action is distinct from p.command->>'action' or p.reason is distinct from p.command->>'reason' or not isfinite(p.recorded_at) then raise exception 'attendance_operational_consumer_invalid';end if;
 return jsonb_build_object('siteId',p.merchant_id,'consumer',p.consumer,'operationId',p.operation_id,'revision',p.revision,'actorId',p.actor_auth_user_id,
  'action',p.action,'reason',p.reason,'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at),'commandFingerprint',p.command_fingerprint);
end;
$$;
create or replace function public.faolla_attendance_operational_consumer_activation_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_activate boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;kind text;mode_name text;op uuid;owner_id uuid;s public.merchant_attendance_settings%rowtype;
 head public.merchant_attendance_operational_consumer_activations%rowtype;saved public.merchant_attendance_operational_consumer_activations%rowtype;
 stamp timestamptz;t jsonb;can_activate boolean:=false;can_deactivate boolean:=false;
begin
 site:=p_query->>'siteId';kind:=p_query->>'consumer';mode_name:=p_query->>'mode';
 if p_auth_user_id is null or p_allow_activate is null or public.faolla_attendance_application_window_scalar_v1(p_query->'siteId','site') is distinct from true
  or kind is null or kind not in('application_window','review_routing','timesheet_cycle','reminders') then raise exception 'attendance_invalid_request';end if;
 if mode_name='current' then
  if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','consumer','mode']) is distinct from true then raise exception 'attendance_invalid_request';end if;
 elsif mode_name='recover' then
  if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','consumer','mode','operationId']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  op:=(p_query->>'operationId')::uuid;
 else raise exception 'attendance_invalid_request';end if;
 if mode_name='recover' then
  select * into saved from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=site and x.consumer=kind and x.operation_id=op and x.actor_auth_user_id=p_auth_user_id;
  return jsonb_build_object('protocol','attendance-operational-consumer-activation-v1','siteId',site,'consumer',kind,'actorId',p_auth_user_id,
   'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'canActivate',false,'canDeactivate',false,'current',null,'receipt',public.faolla_attendance_operational_consumer_item_v1(saved));
 end if;
 select user_id into owner_id from public.merchants where id=site for share;
 if owner_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
 if p_command is null then select * into s from public.merchant_attendance_settings where merchant_id=site for share;
 else select * into s from public.merchant_attendance_settings where merchant_id=site for update;end if;
 if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
 select * into head from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=site and x.consumer=kind order by x.revision desc limit 1;
 perform public.faolla_attendance_operational_consumer_item_v1(head);
 if p_command is not null then
  t:=public.faolla_attendance_operational_consumer_command_v1(site,kind,p_auth_user_id,p_command);op:=(p_command->>'operationId')::uuid;
  select * into saved from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=site and x.operation_id=op;
  if saved.operation_id is not null then
   if saved.consumer<>kind or saved.actor_auth_user_id<>p_auth_user_id or saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
  else
   if (p_command->>'expectedRevision')::bigint<>coalesce(head.revision,0) then raise exception 'attendance_operational_consumer_changed';end if;
   if p_command->>'action'='activate' and (kind<>'application_window' or not p_allow_activate or not s.enabled) then raise exception 'attendance_operational_consumer_disabled';end if;
   if coalesce(head.action,'deactivate')=p_command->>'action' then raise exception 'attendance_operational_consumer_unchanged';end if;
   stamp:=clock_timestamp();if head.recorded_at>stamp then raise exception 'attendance_operational_consumer_changed';end if;
   insert into public.merchant_attendance_operational_consumer_activations(merchant_id,consumer,operation_id,revision,actor_auth_user_id,action,reason,command,command_fingerprint,recorded_at)
    values(site,kind,op,coalesce(head.revision,0)+1,p_auth_user_id,p_command->>'action',p_command->>'reason',p_command,public.faolla_attendance_operational_rule_hash_v1(t),stamp) returning * into saved;
   head:=saved;
  end if;
 else can_activate:=kind='application_window' and p_allow_activate and s.enabled and coalesce(head.action,'deactivate')='deactivate';can_deactivate:=head.action='activate';end if;
 return jsonb_build_object('protocol','attendance-operational-consumer-activation-v1','siteId',site,'consumer',kind,'actorId',p_auth_user_id,
  'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),'canActivate',can_activate,'canDeactivate',coalesce(can_deactivate,false),
  'current',public.faolla_attendance_operational_consumer_item_v1(head),'receipt',public.faolla_attendance_operational_consumer_item_v1(saved));
end;
$$;
create or replace function public.faolla_attendance_application_window_query_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare f text:=p->>'family';m text:=p->>'mode';k text;keys text[];t jsonb;
begin
 if public.faolla_attendance_application_window_scalar_v1(p->'siteId','site') is distinct from true or f is null
  or f not in('correction','correction_revision','missing','missing_revision') or octet_length(convert_to(p::text,'UTF8'))>4096 then raise exception 'attendance_invalid_request';end if;
 if m='recover' then keys:=array['siteId','mode','family','operationId'];
 elsif m='detail' then keys:=array['siteId','mode','family','workerId','requestId'];
 elsif m='prepare' then
  keys:=array['siteId','mode','family','workerId'];
  if f='correction' then keys:=keys||array['startEventId'];
  elsif f='correction_revision' then keys:=keys||array['baseRequestId'];
  else keys:=keys||array['fromDate','throughDate','proposedStartAt','supersedesRequestId'];end if;
 else raise exception 'attendance_invalid_request';end if;
 if public.faolla_attendance_operational_rule_object_v1(p,keys) is distinct from true then raise exception 'attendance_invalid_request';end if;
 foreach k in array keys loop
  if k in('workerId','startEventId','baseRequestId','requestId','operationId') and public.faolla_attendance_operational_rule_scalar_v1(p->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 end loop;
 if m='prepare' and f in('missing','missing_revision') then
  if public.faolla_attendance_application_window_scalar_v1(p->'fromDate','date') is distinct from true or public.faolla_attendance_application_window_scalar_v1(p->'throughDate','date') is distinct from true
   or (p->>'throughDate')::date-(p->>'fromDate')::date not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  perform public.faolla_attendance_operational_source_stamp_v1(p->>'proposedStartAt');
  if (f='missing' and p->'supersedesRequestId' is distinct from 'null'::jsonb)
   or (f='missing_revision' and public.faolla_attendance_operational_rule_scalar_v1(p->'supersedesRequestId','uuid') is distinct from true) then raise exception 'attendance_invalid_request';end if;
 end if;
 t:=jsonb_build_array(p->>'siteId',m,f);
 if m='recover' then return t||jsonb_build_array(p->>'operationId');end if;
 t:=t||jsonb_build_array(p->>'workerId');
 if m='detail' then return t||jsonb_build_array(p->>'requestId');end if;
 if f='correction' then return t||jsonb_build_array(p->>'startEventId');end if;
 if f='correction_revision' then return t||jsonb_build_array(p->>'baseRequestId');end if;
 return t||jsonb_build_array(p->>'fromDate',p->>'throughDate',p->>'proposedStartAt',p->>'supersedesRequestId');
end;
$$;
create or replace function public.faolla_attendance_application_window_command_v1(p_query jsonb,p_actor uuid,p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare f text:=p_query->>'family';c jsonb:=p->'command';proposal jsonb;breaks jsonb:='[]';piece jsonb;t jsonb;keys text[];k text;q jsonb;
begin
 q:=public.faolla_attendance_application_window_query_v1(p_query);
 if p_actor is null or p_query->>'mode'<>'prepare' or public.faolla_attendance_operational_rule_object_v1(p,array['command','expectedWindowFingerprint']) is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(p->'expectedWindowFingerprint','hash') is distinct from true
  or octet_length(convert_to(p::text,'UTF8'))>16384 then raise exception 'attendance_invalid_request';end if;
 if f='correction' then keys:=array['action','operationId','expectedRevision','reason','startEventId','expectedLastEventId','expectedPolicyRevision','proposal'];
 elsif f='correction_revision' then keys:=array['action','operationId','expectedRevision','reason','expectedBaseOperationId','expectedPolicyRevision','expectedEffectiveOperationId','proposal'];
 else keys:=array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','locationId','timeZone','proposal'];
  if f='missing_revision' then keys:=keys||array['supersedesRequestId','expectedApprovalOperationId'];end if;
 end if;
 if public.faolla_attendance_operational_rule_object_v1(c,keys) is distinct from true or c->>'action' is distinct from (case when f='missing_revision' then 'revise' else 'submit' end)
  or jsonb_typeof(c->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(c->>'reason',1,case when f in('correction','correction_revision') then 500 else 200 end) is distinct from true then raise exception 'attendance_invalid_request';end if;
 foreach k in array keys loop
  if k in('operationId','startEventId','expectedLastEventId','expectedBaseOperationId','expectedEffectiveOperationId','expectedWorkerId','locationId','supersedesRequestId','expectedApprovalOperationId')
   and public.faolla_attendance_operational_rule_scalar_v1(c->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  if k in('expectedRevision','expectedSettingsVersion','expectedPolicyRevision') and (public.faolla_attendance_operational_rule_scalar_v1(c->k,case when k='expectedRevision' then 'revision' else 'positive' end) is distinct from true
   or (c->>k)::bigint>(case when k='expectedRevision' then 9007199254740988 else 9007199254740989 end)) then raise exception 'attendance_invalid_request';end if;
 end loop;
 proposal:=public.faolla_attendance_correction_proposal_v1(c->'proposal',timestamptz '2101-01-01T00:00:00Z');
 if proposal is distinct from c->'proposal' then raise exception 'attendance_invalid_request';end if;
 for piece in select value from jsonb_array_elements(proposal->'breaks') loop breaks:=breaks||jsonb_build_array(jsonb_build_array(piece->>'startAt',piece->>'endAt',piece->'paid'));end loop;
 proposal:=jsonb_build_array(proposal->>'startAt',proposal->>'endAt',breaks);
 if f='correction' then
  if c->'startEventId' is distinct from p_query->'startEventId' then raise exception 'attendance_invalid_request';end if;
  t:=jsonb_build_array(c->>'action',c->>'operationId',(c->>'expectedRevision')::bigint,c->>'reason',c->>'startEventId',c->>'expectedLastEventId',(c->>'expectedPolicyRevision')::bigint,proposal);
 elsif f='correction_revision' then
  t:=jsonb_build_array(c->>'action',c->>'operationId',(c->>'expectedRevision')::bigint,c->>'reason',c->>'expectedBaseOperationId',(c->>'expectedPolicyRevision')::bigint,c->>'expectedEffectiveOperationId',proposal);
 else
  if c->'expectedWorkerId' is distinct from p_query->'workerId' or c->'proposal'->'startAt' is distinct from p_query->'proposedStartAt'
   or f='missing_revision' and c->'supersedesRequestId' is distinct from p_query->'supersedesRequestId' or jsonb_typeof(c->'timeZone') is distinct from 'string'
   or public.faolla_attendance_valid_zone_v1(c->>'timeZone') is distinct from true then raise exception 'attendance_invalid_request';end if;
  t:=jsonb_build_array(c->>'action',c->>'operationId',c->>'reason',c->>'expectedWorkerId',(c->>'expectedSettingsVersion')::bigint,(c->>'expectedPolicyRevision')::bigint,c->>'locationId',c->>'timeZone',proposal,c->>'supersedesRequestId',c->>'expectedApprovalOperationId');
 end if;
 return jsonb_build_array('attendance-application-window-command-v1',p_actor,q,t,p->>'expectedWindowFingerprint');
end;
$$;
create or replace function public.faolla_attendance_application_window_facts_v1(p_site text,p_family text,p_operation uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare c public.merchant_attendance_correction_entries%rowtype;b public.merchant_attendance_correction_rule_bindings%rowtype;
 r public.merchant_attendance_revision_requests%rowtype;m public.merchant_attendance_missing_requests%rowtype;me public.merchant_attendance_missing_entries%rowtype;
 cmd jsonb;wid uuid;eid uuid;actor uuid;stamp timestamptz;anchor timestamptz;root_id uuid;root_anchor timestamptz;
begin
 if p_family='correction' then
  select * into c from public.merchant_attendance_correction_entries x where x.merchant_id=p_site and x.operation_id=p_operation and x.action='submit';
  if c.operation_id is null then return null;end if;
  select * into b from public.merchant_attendance_correction_rule_bindings x where x.merchant_id=p_site and x.request_id=p_operation;
  if b.request_id is null or b.recorded_at<>c.recorded_at or (b.command-'expectedPolicyRevision') is distinct from c.command then raise exception 'attendance_application_window_invalid';end if;
  cmd:=b.command;wid:=c.worker_id;eid:=c.employee_id;actor:=c.actor_auth_user_id;stamp:=c.recorded_at;anchor:=(c.basis->'events'->0->>'occurredAt')::timestamptz;
 elsif p_family='correction_revision' then
  select * into r from public.merchant_attendance_revision_requests x where x.merchant_id=p_site and x.operation_id=p_operation and x.action='submit';
  if r.operation_id is null then return null;end if;
  select * into c from public.merchant_attendance_correction_entries x where x.merchant_id=p_site and x.operation_id=r.base_request_id and x.action='submit';
  if c.operation_id is null or row(c.worker_id,c.employee_id,c.actor_auth_user_id) is distinct from row(r.worker_id,r.employee_id,r.actor_auth_user_id) then raise exception 'attendance_application_window_invalid';end if;
  cmd:=r.command;wid:=r.worker_id;eid:=r.employee_id;actor:=r.actor_auth_user_id;stamp:=r.recorded_at;anchor:=(c.basis->'events'->0->>'occurredAt')::timestamptz;root_id:=c.operation_id;
 elsif p_family in('missing','missing_revision') then
  select * into m from public.merchant_attendance_missing_requests x where x.merchant_id=p_site and x.request_id=p_operation;
  if m.request_id is null then return null;end if;
  select * into me from public.merchant_attendance_missing_entries x where x.merchant_id=p_site and x.operation_id=p_operation and x.action='submit';
  if me.operation_id is null or me.request_id<>m.request_id or me.recorded_at<>m.submitted_at or me.actor_auth_user_id<>m.actor_auth_user_id
   or (p_family='missing_revision')<>(m.supersedes_request_id is not null) then raise exception 'attendance_application_window_invalid';end if;
  cmd:=me.command;wid:=m.worker_id;eid:=m.employee_id;actor:=m.actor_auth_user_id;stamp:=m.submitted_at;anchor:=m.start_at;root_id:=m.root_request_id;
  if root_id is not null then
   select x.start_at into root_anchor from public.merchant_attendance_missing_requests x where x.merchant_id=p_site and x.request_id=root_id
    and x.worker_id=wid and x.employee_id=eid and x.actor_auth_user_id=actor and x.root_request_id is null;
   if root_anchor is null then raise exception 'attendance_application_window_invalid';end if;
  end if;
 else raise exception 'attendance_invalid_request';end if;
 return jsonb_build_object('workerId',wid,'employeeId',eid,'employeeAuthUserId',actor,'recordedAt',public.faolla_attendance_operational_punch_stamp_v1(stamp),
  'anchorAt',public.faolla_attendance_operational_punch_stamp_v1(anchor),'rootRequestId',root_id,'rootAnchorAt',public.faolla_attendance_operational_punch_stamp_v1(root_anchor),'command',cmd);
end;
$$;
create or replace function public.faolla_attendance_application_window_value_v1(p_family text,p_source jsonb,p_activation bigint,p_anchor timestamptz,p_root uuid,p_root_anchor timestamptz,p_root_deadline timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare t jsonb;k text;choice_value jsonb;days integer;baseline jsonb;deadline timestamptz;extra timestamptz;root_limit timestamptz:=p_root_deadline;effective timestamptz;v jsonb;
begin
 t:=public.faolla_attendance_operational_source_tuple_v1(p_source);
 if p_source->>'sourceFingerprint' is distinct from public.faolla_attendance_operational_rule_hash_v1(t) or p_activation is null or p_activation not between 0 and 9007199254740990
  or p_anchor is null or not isfinite(p_anchor) or p_family not in('correction','correction_revision','missing','missing_revision') then raise exception 'attendance_application_window_invalid';end if;
 baseline:=p_source->'baselineCorrectionPolicyRef';
 if baseline='null'::jsonb then raise exception 'attendance_correction_policy_required';end if;
 foreach k in array array['personal','group','enterprise'] loop
  choice_value:=p_source->'layers'->k->'rules'->'correctionWindow';
  if choice_value->>'mode'='value' then days:=(choice_value->'value'->>'days')::integer;exit;
  elsif choice_value->>'mode'='disabled' then exit;end if;
 end loop;
 deadline:=public.faolla_attendance_control_day_boundary_v1((p_anchor at time zone (baseline->>'timeZone'))::date+(baseline->>'submissionWindowDays')::integer+1,baseline->>'timeZone');
 if days is not null then extra:=public.faolla_attendance_control_day_boundary_v1((p_anchor at time zone (baseline->>'timeZone'))::date+days+1,baseline->>'timeZone');end if;
 if p_root_anchor is not null then
  root_limit:=least(root_limit,public.faolla_attendance_control_day_boundary_v1((p_root_anchor at time zone (baseline->>'timeZone'))::date+(baseline->>'submissionWindowDays')::integer+1,baseline->>'timeZone'));
 end if;
 effective:=least(deadline,extra,root_limit);
 if deadline is null or effective is null or not isfinite(effective) then raise exception 'attendance_application_window_invalid';end if;
 v:=jsonb_build_object('workerId',p_source->'workerIdentity'->'workerId','employeeId',p_source->'workerIdentity'->'employeeId',
  'employeeAuthUserId',p_source->'workerIdentity'->'employeeAuthUserId','observedAt',p_source->'at','activationRevision',p_activation,
  'sourceFingerprint',p_source->'sourceFingerprint','baselinePolicy',baseline,'selectedDays',days,'anchorAt',public.faolla_attendance_operational_punch_stamp_v1(p_anchor),
  'rootRequestId',p_root,'rootDeadlineAt',public.faolla_attendance_operational_punch_stamp_v1(root_limit),'baselineDeadlineAt',public.faolla_attendance_operational_punch_stamp_v1(deadline),
  'operationalDeadlineAt',public.faolla_attendance_operational_punch_stamp_v1(extra),'effectiveDeadlineAt',public.faolla_attendance_operational_punch_stamp_v1(effective));
 return v||jsonb_build_object('windowFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-application-window-v1',p_family,p_activation,t-3,
  v->>'anchorAt',p_root,v->>'rootDeadlineAt',days,v->>'baselineDeadlineAt',v->>'operationalDeadlineAt',v->>'effectiveDeadlineAt')));
end;
$$;
create or replace function public.faolla_attendance_application_window_proof_v1(p public.merchant_attendance_application_window_proofs)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare facts jsonb;src jsonb;expected jsonb;root_proof public.merchant_attendance_application_window_proofs%rowtype;root_deadline timestamptz;
 activation public.merchant_attendance_operational_consumer_activations%rowtype;
begin
 if p.operation_id is null then return null;end if;
 facts:=public.faolla_attendance_application_window_facts_v1(p.merchant_id,p.family,p.operation_id);
 if facts is null or p.request_id<>p.operation_id or facts->'command' is distinct from p.command->'command'
  or facts->>'workerId' is distinct from p.worker_id::text or facts->>'employeeId' is distinct from p.employee_id::text
  or facts->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text or p.actor_auth_user_id<>p.employee_auth_user_id
  or facts->>'recordedAt' is distinct from public.faolla_attendance_operational_punch_stamp_v1(p.recorded_at)
  or p.query->>'siteId' is distinct from p.merchant_id or p.query->>'family' is distinct from p.family or p.query->>'workerId' is distinct from p.worker_id::text
  or p.command->'command'->>'operationId' is distinct from p.operation_id::text
  or p.command_fingerprint is distinct from public.faolla_attendance_operational_rule_hash_v1(public.faolla_attendance_application_window_command_v1(p.query,p.actor_auth_user_id,p.command)) then raise exception 'attendance_application_window_invalid';end if;
 if p.family='correction_revision' and p.query->'baseRequestId' is distinct from facts->'rootRequestId' then raise exception 'attendance_application_window_invalid';end if;
 src:=public.faolla_attendance_operational_punch_saved_source_v1(p.source_ref);
 if src->>'siteId' is distinct from p.merchant_id or src->'workerIdentity'->>'workerId' is distinct from p.worker_id::text
  or src->'workerIdentity'->>'employeeId' is distinct from p.employee_id::text or src->'workerIdentity'->>'employeeAuthUserId' is distinct from p.employee_auth_user_id::text
  or src->>'at' is distinct from facts->>'recordedAt' then raise exception 'attendance_application_window_invalid';end if;
 select * into activation from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=p.merchant_id and x.consumer='application_window'
  and x.revision=(p.window_snapshot->>'activationRevision')::bigint;
 if activation.operation_id is null or activation.action<>'activate' or activation.recorded_at>p.recorded_at
  or exists(select 1 from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=p.merchant_id and x.consumer='application_window'
   and x.revision=activation.revision+1 and x.recorded_at<=p.recorded_at) then raise exception 'attendance_application_window_invalid';end if;
 perform public.faolla_attendance_operational_consumer_item_v1(activation);
 if facts->>'rootRequestId' is not null then
  select * into root_proof from public.merchant_attendance_application_window_proofs x where x.merchant_id=p.merchant_id and x.operation_id=(facts->>'rootRequestId')::uuid;
  if root_proof.operation_id is not null then
   if root_proof.family not in('correction','missing') or root_proof.window_snapshot->>'rootRequestId' is not null
    or row(root_proof.worker_id,root_proof.employee_id,root_proof.employee_auth_user_id) is distinct from row(p.worker_id,p.employee_id,p.employee_auth_user_id) then raise exception 'attendance_application_window_invalid';end if;
   perform public.faolla_attendance_application_window_proof_v1(root_proof);
   root_deadline:=(root_proof.window_snapshot->>'effectiveDeadlineAt')::timestamptz;
  end if;
 end if;
 expected:=public.faolla_attendance_application_window_value_v1(p.family,src,activation.revision,(facts->>'anchorAt')::timestamptz,
  (facts->>'rootRequestId')::uuid,(facts->>'rootAnchorAt')::timestamptz,root_deadline);
 if expected is distinct from p.window_snapshot or p.command->'expectedWindowFingerprint' is distinct from p.window_snapshot->'windowFingerprint'
  or p.recorded_at>=(p.window_snapshot->>'effectiveDeadlineAt')::timestamptz then raise exception 'attendance_application_window_invalid';end if;
 return jsonb_build_object('operationId',p.operation_id,'requestId',p.request_id,'family',p.family,'workerId',p.worker_id,'employeeId',p.employee_id,
  'employeeAuthUserId',p.employee_auth_user_id,'actorId',p.actor_auth_user_id,'recordedAt',facts->'recordedAt','commandFingerprint',p.command_fingerprint,
  'windowFingerprint',p.window_snapshot->'windowFingerprint','effectiveDeadlineAt',p.window_snapshot->'effectiveDeadlineAt');
end;
$$;
create or replace function public.faolla_attendance_application_window_gate_v1(p_site text,p_managed boolean,p_root uuid,p_at timestamptz)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare h public.merchant_attendance_operational_consumer_activations%rowtype;root_proof public.merchant_attendance_application_window_proofs%rowtype;
begin
 if p_managed is null then raise exception 'attendance_application_window_invalid';end if;
 --A captured root deadline remains a historical limit even after deactivation.
 --Only its immutable proof is read, never today's operational source.
 if p_root is not null then
  if p_at is null or not isfinite(p_at) then raise exception 'attendance_application_window_invalid';end if;
  select * into root_proof from public.merchant_attendance_application_window_proofs x where x.merchant_id=p_site and x.operation_id=p_root;
  if root_proof.operation_id is not null then
   if root_proof.family not in('correction','missing') or root_proof.window_snapshot->>'rootRequestId' is not null then raise exception 'attendance_application_window_invalid';end if;
   perform public.faolla_attendance_application_window_proof_v1(root_proof);
   if p_at>=(root_proof.window_snapshot->>'effectiveDeadlineAt')::timestamptz then raise exception 'attendance_correction_window_expired';end if;
  end if;
 end if;
 if p_managed then return;end if;
 select * into h from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=p_site and x.consumer='application_window' order by x.revision desc limit 1;
 perform public.faolla_attendance_operational_consumer_item_v1(h);
 if h.action='activate' then raise exception 'attendance_application_window_protocol_required';end if;
end;
$$;
create or replace function public.faolla_attendance_application_window_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text:=p_query->>'siteId';f text:=p_query->>'family';m text:=p_query->>'mode';wid uuid;eid uuid;rid uuid;op uuid;
 c jsonb:=p_command->'command';t jsonb;old_query jsonb;app jsonb;src jsonb;facts jsonb;win jsonb;receipt jsonb;result_value jsonb;bundle jsonb;
 proof public.merchant_attendance_application_window_proofs%rowtype;root_proof public.merchant_attendance_application_window_proofs%rowtype;
 rev public.merchant_attendance_revision_requests%rowtype;missing public.merchant_attendance_missing_requests%rowtype;
 h public.merchant_attendance_operational_consumer_activations%rowtype;
 at_value timestamptz;read_at timestamptz;anchor timestamptz;root_id uuid;root_anchor timestamptz;root_deadline timestamptz;day_value text;
 can_submit boolean:=false;old_can boolean:=false;
begin
 perform public.faolla_attendance_application_window_query_v1(p_query);
 if p_auth_user_id is null or p_allow_write is null or p_command is not null and m<>'prepare' then raise exception 'attendance_invalid_request';end if;
 if p_command is not null then
  t:=public.faolla_attendance_application_window_command_v1(p_query,p_auth_user_id,p_command);op:=(c->>'operationId')::uuid;
 elsif m='recover' then op:=(p_query->>'operationId')::uuid;end if;
 --Only immutable proof is used here. No current employee, source, activation or owner lookup.
 if op is not null then
  select * into proof from public.merchant_attendance_application_window_proofs x where x.merchant_id=site and x.operation_id=op;
  if proof.operation_id is not null then
   if proof.family<>f or proof.actor_auth_user_id<>p_auth_user_id then
    if p_command is not null then raise exception 'attendance_operation_conflict';end if;proof:=null;
   elsif p_command is not null and (proof.query is distinct from p_query or proof.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
  end if;
  if m='recover' or proof.operation_id is not null then
   receipt:=public.faolla_attendance_application_window_proof_v1(proof);
   return jsonb_build_object('result',jsonb_build_object('protocol','attendance-application-window-v1','siteId',site,'actorId',p_auth_user_id,'family',f,
    'mode',case when p_command is null then 'recover' else 'receipt' end,'readAt',public.faolla_attendance_operational_punch_stamp_v1(clock_timestamp()),
    'canSubmit',false,'application',null,'window',null,'receipt',receipt),'source',null);
  end if;
 end if;
 wid:=(p_query->>'workerId')::uuid;rid:=(p_query->>'requestId')::uuid;
 perform 1 from public.merchants x where x.id=site for share;if not found then raise exception 'attendance_access_denied';end if;
 if p_command is null then perform 1 from public.merchant_attendance_settings x where x.merchant_id=site for share;
 else perform 1 from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
 if not found then raise exception 'attendance_settings_required';end if;
 if p_command is not null then
  if not p_allow_write then raise exception 'attendance_application_window_disabled';end if;
  --A legacy operation never gains a synthetic new proof, even if its old body matches.
  if exists(select 1 from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.operation_id=op)
   or exists(select 1 from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.operation_id=op)
   or exists(select 1 from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.operation_id=op) then raise exception 'attendance_operation_conflict';end if;
 end if;
 if f='correction' then
  if p_command is not null then old_query:=jsonb_build_object('mode','detail','expectedWorkerId',wid,'requestId',op,'operationId',null);
  elsif m='prepare' then old_query:=jsonb_build_object('mode','prepare','expectedWorkerId',wid,'startEventId',p_query->'startEventId');
  else old_query:=jsonb_build_object('mode','detail','expectedWorkerId',wid,'requestId',rid,'operationId',null);end if;
  app:=public.faolla_attendance_decision_decorate_v1(site,public.faolla_attendance_application_window_core_correction_v1(site,p_auth_user_id,old_query,c,p_allow_write,true));
 elsif f='correction_revision' then
  root_id:=(p_query->>'baseRequestId')::uuid;
  if m='detail' then
   select * into rev from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.operation_id=rid and x.action='submit';
   if rev.operation_id is null or rev.worker_id<>wid or rev.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_application_window_not_found';end if;root_id:=rev.base_request_id;
  end if;
  old_query:=jsonb_build_object('mode',case when p_command is not null or m='detail' then 'detail' else 'prepare' end,'expectedWorkerId',wid,'baseRequestId',root_id,
   'requestId',case when p_command is not null then op when m='detail' then rid else null end,'operationId',null);
  app:=public.faolla_attendance_application_window_core_revision_v2(site,p_auth_user_id,old_query,c,p_allow_write,true);
 else
  if m='detail' then
   select * into missing from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=rid;
   if missing.request_id is null or missing.worker_id<>wid or missing.actor_auth_user_id<>p_auth_user_id
    or (f='missing_revision')<>(missing.supersedes_request_id is not null) then raise exception 'attendance_application_window_not_found';end if;
   day_value:=to_char(missing.submitted_at at time zone 'UTC','YYYY-MM-DD');
  end if;
  old_query:=jsonb_build_object('siteId',site,'access','self','fromDate',coalesce(day_value,p_query->>'fromDate'),'throughDate',coalesce(day_value,p_query->>'throughDate'),
   'requestId',case when p_command is not null then null when m='detail' then rid else (p_query->>'supersedesRequestId')::uuid end,'operationId',null,'beforeAt',null,'beforeId',null);
  app:=public.faolla_attendance_application_window_core_missing_v1(old_query,p_auth_user_id,c,p_allow_write,true);
 end if;
 if app->>'workerId' is distinct from wid::text or public.faolla_attendance_operational_rule_scalar_v1(app->'employeeId','uuid') is distinct from true then raise exception 'attendance_access_denied';end if;
 eid:=(app->>'employeeId')::uuid;
 if m='detail' then
  select * into proof from public.merchant_attendance_application_window_proofs x where x.merchant_id=site and x.family=f and x.request_id=rid;
  if proof.operation_id is not null then
   if proof.actor_auth_user_id<>p_auth_user_id or proof.worker_id<>wid or proof.employee_id<>eid then raise exception 'attendance_access_denied';end if;
   perform public.faolla_attendance_application_window_proof_v1(proof);win:=proof.window_snapshot;src:=public.faolla_attendance_operational_punch_saved_source_v1(proof.source_ref);
  end if;
 else
  select * into h from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=site and x.consumer='application_window' order by x.revision desc limit 1;
  perform public.faolla_attendance_operational_consumer_item_v1(h);
  if p_command is not null and h.action is distinct from 'activate' then raise exception 'attendance_application_window_disabled';end if;
  if p_command is not null then
   facts:=public.faolla_attendance_application_window_facts_v1(site,f,op);
   if facts is null or facts->>'workerId' is distinct from wid::text or facts->>'employeeId' is distinct from eid::text or facts->>'employeeAuthUserId' is distinct from p_auth_user_id::text then raise exception 'attendance_application_window_invalid';end if;
   at_value:=(facts->>'recordedAt')::timestamptz;anchor:=(facts->>'anchorAt')::timestamptz;root_id:=(facts->>'rootRequestId')::uuid;root_anchor:=(facts->>'rootAnchorAt')::timestamptz;
  else
   at_value:=clock_timestamp();
   if f in('correction','correction_revision') then anchor:=(app->'basis'->'events'->0->>'occurredAt')::timestamptz;
   else
    anchor:=(p_query->>'proposedStartAt')::timestamptz;
    if f='missing_revision' then
     if app->'detail'->>'requestId' is distinct from p_query->>'supersedesRequestId' or app->'detail'->>'status' is distinct from 'approved'
      or app->'detail'->'lineage'->'canRevise' is distinct from 'true'::jsonb then raise exception 'attendance_missing_revision_stale';end if;
     root_id:=(app->'detail'->'lineage'->>'rootRequestId')::uuid;
     select x.start_at into root_anchor from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=root_id
      and x.worker_id=wid and x.employee_id=eid and x.actor_auth_user_id=p_auth_user_id and x.root_request_id is null;
     if root_anchor is null then raise exception 'attendance_application_window_invalid';end if;
    end if;
   end if;
  end if;
  src:=public.faolla_attendance_operational_source_v1(site,wid,eid,p_auth_user_id,at_value);
  if root_id is not null then
   select * into root_proof from public.merchant_attendance_application_window_proofs x where x.merchant_id=site and x.operation_id=root_id;
   if root_proof.operation_id is not null then
    if row(root_proof.worker_id,root_proof.employee_id,root_proof.employee_auth_user_id) is distinct from row(wid,eid,p_auth_user_id)
     or root_proof.family not in('correction','missing') or root_proof.window_snapshot->>'rootRequestId' is not null then raise exception 'attendance_application_window_invalid';end if;
    perform public.faolla_attendance_application_window_proof_v1(root_proof);root_deadline:=(root_proof.window_snapshot->>'effectiveDeadlineAt')::timestamptz;
   end if;
  end if;
  win:=public.faolla_attendance_application_window_value_v1(f,src,coalesce(h.revision,0),anchor,root_id,root_anchor,root_deadline);
  if p_command is not null then
   if win->'windowFingerprint' is distinct from p_command->'expectedWindowFingerprint' or win->'baselinePolicy'->'revision' is distinct from c->'expectedPolicyRevision' then raise exception 'attendance_application_window_changed';end if;
   if at_value>=(win->>'effectiveDeadlineAt')::timestamptz then raise exception 'attendance_application_window_expired';end if;
   insert into public.merchant_attendance_application_window_proofs(merchant_id,family,operation_id,request_id,worker_id,employee_id,employee_auth_user_id,actor_auth_user_id,
    query,command,command_fingerprint,window_snapshot,source_ref,recorded_at)
    values(site,f,op,op,wid,eid,p_auth_user_id,p_auth_user_id,p_query,p_command,public.faolla_attendance_operational_rule_hash_v1(t),win,
     public.faolla_attendance_operational_punch_source_ref_v1(src),at_value) returning * into proof;
   receipt:=public.faolla_attendance_application_window_proof_v1(proof);app:=null;win:=null;src:=null;m:='receipt';
  else old_can:=case when f='correction_revision' then app->'canSubmit'='true'::jsonb else app->'canRequest'='true'::jsonb end;end if;
 end if;
 read_at:=clock_timestamp();can_submit:=m='prepare' and coalesce(old_can,false) and p_allow_write and h.action='activate' and read_at<(win->>'effectiveDeadlineAt')::timestamptz;
 result_value:=jsonb_build_object('protocol','attendance-application-window-v1','siteId',site,'actorId',p_auth_user_id,'family',f,'mode',m,
  'readAt',public.faolla_attendance_operational_punch_stamp_v1(read_at),'canSubmit',coalesce(can_submit,false),'application',app,'window',win,'receipt',receipt);
 bundle:=jsonb_build_object('result',result_value,'source',src);
 if octet_length(convert_to(bundle::text,'UTF8'))>524288 or octet_length(convert_to(result_value::text,'UTF8'))>262144 then raise exception 'attendance_application_window_too_large';end if;
 return bundle;
exception when raise_exception then
 if sqlerrm='attendance_operational_source_too_large' then raise exception 'attendance_application_window_too_large';end if;
 if sqlerrm in('attendance_operational_source_identity_changed','attendance_operational_source_not_found') then raise exception 'attendance_application_window_changed';end if;
 if sqlerrm like 'attendance_operational_source_%' or sqlerrm like 'attendance_operational_punch_%' then raise exception 'attendance_application_window_invalid';end if;
 raise;
end;
$$;
create or replace function public.faolla_attendance_application_window_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare predecessor public.merchant_attendance_operational_consumer_activations%rowtype;
begin
 if tg_op<>'INSERT' then raise exception 'attendance_application_window_immutable';end if;
 if tg_table_name='merchant_attendance_operational_consumer_activations' then
  perform public.faolla_attendance_operational_consumer_item_v1(new);
  if new.revision=1 then if new.action<>'activate' then raise exception 'attendance_operational_consumer_invalid';end if;
  else
   select * into predecessor from public.merchant_attendance_operational_consumer_activations x where x.merchant_id=new.merchant_id and x.consumer=new.consumer and x.revision=new.revision-1;
   if predecessor.operation_id is null or predecessor.action=new.action or predecessor.recorded_at>new.recorded_at then raise exception 'attendance_operational_consumer_invalid';end if;
  end if;
 else perform public.faolla_attendance_application_window_proof_v1(new);end if;
 return new;
end;
$$;
do $window_extract$
declare ns text;r jsonb;change_value jsonb;f regprocedure;body_value text;args text;occurrences integer;old_hash text;
 manifest constant jsonb:=$window_recipes$
[
  {
    "file": "202609300085_merchant_attendance_correction_rule_binding.sql",
    "name": "faolla_attendance_correction_self_v2",
    "core": "faolla_attendance_application_window_core_correction_v1",
    "types": "text,uuid,jsonb,jsonb,boolean",
    "argnames": [
      "p_site_id",
      "p_auth_user_id",
      "p_query",
      "p_command",
      "p_platform_enabled"
    ],
    "rpc": false,
    "originalHash": "2df21c6bffffa0e53355e611c93165b3599e16332186c26c52140b24d7a07a69",
    "coreHash": "fdedf2502bf938235e67d30407fa37b21a019c07b6e8ea02ad1740b77601e7b4",
    "wrapperHash": "aec67706b1a458b95d5dcbba297f5b8e8da0d0823a385b98026bd86e9cea36af",
    "wrapper": "\nbegin\n return public.faolla_attendance_application_window_core_correction_v1(p_site_id,p_auth_user_id,p_query,p_command,p_platform_enabled,false);\nend;\n",
    "changes": [
      {
        "from": "  -- v1 still owns identity",
        "to": "  if p_command->>'action'='submit' and not old_operation then perform public.faolla_attendance_application_window_gate_v1(p_site_id,p_managed,null,null);end if;\n  -- v1 still owns identity",
        "count": 1
      }
    ]
  },
  {
    "file": "202610010095_merchant_attendance_revision_cycles.sql",
    "name": "faolla_attendance_revision_self_v1",
    "core": "faolla_attendance_application_window_core_revision_v1",
    "types": "text,uuid,jsonb,jsonb,boolean",
    "argnames": [
      "p_site_id",
      "p_auth_user_id",
      "p_query",
      "p_command",
      "p_platform_enabled"
    ],
    "rpc": true,
    "originalHash": "c55d82877324bdf5c749c80dc8aa5d6d196ba3d3e01be85f5043ed7151910884",
    "coreHash": "2cf04d4eca7a72cbfcff4a307eaa91db932c9d447243314bb5aa81728ca401b4",
    "wrapperHash": "715a483eeea26ada9ef5016e2153e9d96444d2d4411abd8fdc671d220e6e912a",
    "wrapper": "\nbegin\n return public.faolla_attendance_application_window_core_revision_v1(p_site_id,p_auth_user_id,p_query,p_command,p_platform_enabled,false);\nend;\n",
    "changes": [
      {
        "from": "        if rules->'issues' ? 'window_expired'",
        "to": "        perform public.faolla_attendance_application_window_gate_v1(p_site_id,p_managed,base.request_id,now_at);\n        if rules->'issues' ? 'window_expired'",
        "count": 1
      }
    ]
  },
  {
    "file": "202610010095_merchant_attendance_revision_cycles.sql",
    "name": "faolla_attendance_revision_self_v2",
    "core": "faolla_attendance_application_window_core_revision_v2",
    "types": "text,uuid,jsonb,jsonb,boolean",
    "argnames": [
      "p_site_id",
      "p_auth_user_id",
      "p_query",
      "p_command",
      "p_platform_enabled"
    ],
    "rpc": true,
    "originalHash": "99fe46d30908e9a40fd24c9167fafc74af47dfbc2a6c9092f4d21e6302e002e3",
    "coreHash": "f99b9a5cb8ba6472725197b8333201754b7dd5f585bb40200df6af274815567c",
    "wrapperHash": "30aa5c17e979d68d4d09b2fe5df819984a9e656c04994e066a48c63b55d08d46",
    "wrapper": "\nbegin\n return public.faolla_attendance_application_window_core_revision_v2(p_site_id,p_auth_user_id,p_query,p_command,p_platform_enabled,false);\nend;\n",
    "changes": [
      {
        "from": "        if rules->'issues' ? 'window_expired'",
        "to": "        perform public.faolla_attendance_application_window_gate_v1(p_site_id,p_managed,base.request_id,now_at);\n        if rules->'issues' ? 'window_expired'",
        "count": 1
      }
    ]
  },
  {
    "file": "202610010103_merchant_attendance_missing_revisions.sql",
    "name": "faolla_attendance_missing_v1",
    "core": "faolla_attendance_application_window_core_missing_v1",
    "types": "jsonb,uuid,jsonb,boolean",
    "argnames": [
      "p_query",
      "p_auth_user_id",
      "p_command",
      "p_allow_write"
    ],
    "rpc": true,
    "originalHash": "9f842ddc91530b80b23a670a5a418c3fc38f9a5fb6fb4b545c8a1b00fdad063f",
    "coreHash": "43eda2cad5becf065932b51d8720a8d2615dd070ef17252b6c6912215a59b46a",
    "wrapperHash": "7b172173e1f5b8ad8db24e9cdb34529a591d66c8263d2019ead7332d6f6be661",
    "wrapper": "\nbegin\n return public.faolla_attendance_application_window_core_missing_v1(p_query,p_auth_user_id,p_command,p_allow_write,false);\nend;\n",
    "changes": [
      {
        "from": "      if now_at>=target.deadline_at",
        "to": "      perform public.faolla_attendance_application_window_gate_v1(site,p_managed,target.root_request_id,now_at);\n      if now_at>=target.deadline_at",
        "count": 1
      }
    ]
  }
]
$window_recipes$::jsonb;
begin
 if exists(select 1 from public.faolla_schema_migrations where version=202610080194) then return;end if;
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 for r in select value from jsonb_array_elements(manifest) loop
  f:=to_regprocedure('public.'||(r->>'name')||'('||(r->>'types')||')');
  select replace(p.prosrc,E'\r\n',E'\n'),pg_get_function_arguments(p.oid) into body_value,args from pg_proc p where p.oid=f;
  old_hash:=encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex');
  if old_hash is distinct from r->>'originalHash' then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
  for change_value in select value from jsonb_array_elements(r->'changes') loop
   occurrences:=(length(body_value)-length(replace(body_value,change_value->>'from','')))/nullif(length(change_value->>'from'),0);
   if occurrences is distinct from (change_value->>'count')::integer then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
   body_value:=replace(body_value,change_value->>'from',change_value->>'to');
  end loop;
  if encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from r->>'coreHash'
   or encode(sha256(convert_to(replace(r->>'wrapper',ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from r->>'wrapperHash' then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
  execute format('create function %I.%I(%s,p_managed boolean default false) returns jsonb language plpgsql set search_path=pg_catalog as %L',ns,r->>'core',args,body_value);
  execute format('create or replace function %I.%I(%s) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',ns,r->>'name',args,r->>'wrapper');
 end loop;
end;
$window_extract$;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_operational_consumer_activations'::regclass,
      'public.merchant_attendance_application_window_proofs'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $window_security$
declare ns text;f regprocedure;t regclass;table_name text;
begin
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080194) then return;end if;
 for f in select p.oid::regprocedure from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns)
  and (p.proname like 'faolla_attendance_application_window_%' or p.proname like 'faolla_attendance_operational_consumer_%') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
 foreach table_name in array array['merchant_attendance_operational_consumer_activations','merchant_attendance_application_window_proofs'] loop
  t:=to_regclass('public.'||table_name);
  execute format('alter table %s enable row level security',t);
  execute format('revoke all on %s from public,anon,authenticated,service_role',t);
  execute format('create trigger application_window_immutable before update or delete on %s for each row execute function public.faolla_attendance_application_window_guard_v1()',t);
  execute format('create trigger application_window_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_application_window_guard_v1()',t);
  execute format('create constraint trigger application_window_proof after insert on %s deferrable initially deferred for each row execute function public.faolla_attendance_application_window_guard_v1()',t);
 end loop;
end;
$window_security$;
grant execute on function public.faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean) to service_role;
grant execute on function public.faolla_attendance_application_window_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $window_postconditions$
declare ns text;expected_owner oid;installed boolean;f regprocedure;info record;expected record;t regclass;role_name text;object_name text;
begin
 select n.nspname,c.relowner into ns,expected_owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_settings'::regclass;
 installed:=exists(select 1 from public.faolla_schema_migrations where version=202610080194 and name='merchant_attendance_application_window');
 if exists(select 1 from public.faolla_schema_migrations where version=202610080194 and name<>'merchant_attendance_application_window')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080193 and name='merchant_attendance_operational_punch')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080192 and name='merchant_attendance_operational_source')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules') then raise exception 'merchant_attendance_application_window_prerequisite_required';end if;
 for expected in select * from (values
  ('public.faolla_attendance_correction_self_v2(text,uuid,jsonb,jsonb,boolean)','2df21c6bffffa0e53355e611c93165b3599e16332186c26c52140b24d7a07a69','aec67706b1a458b95d5dcbba297f5b8e8da0d0823a385b98026bd86e9cea36af',false,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled']::text[]),
  ('public.faolla_attendance_revision_self_v1(text,uuid,jsonb,jsonb,boolean)','c55d82877324bdf5c749c80dc8aa5d6d196ba3d3e01be85f5043ed7151910884','715a483eeea26ada9ef5016e2153e9d96444d2d4411abd8fdc671d220e6e912a',true,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled']::text[]),
  ('public.faolla_attendance_revision_self_v2(text,uuid,jsonb,jsonb,boolean)','99fe46d30908e9a40fd24c9167fafc74af47dfbc2a6c9092f4d21e6302e002e3','30aa5c17e979d68d4d09b2fe5df819984a9e656c04994e066a48c63b55d08d46',true,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled']::text[]),
  ('public.faolla_attendance_missing_v1(jsonb,uuid,jsonb,boolean)','9f842ddc91530b80b23a670a5a418c3fc38f9a5fb6fb4b545c8a1b00fdad063f','7b172173e1f5b8ad8db24e9cdb34529a591d66c8263d2019ead7332d6f6be661',true,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[])
 ) original(signature,original_hash,wrapper_hash,is_rpc,argnames) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or not info.prosecdef or info.provolatile<>'v' or info.lanname<>'plpgsql'
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.prorettype<>'jsonb'::regtype or info.pronargdefaults<>2
   or info.proargnames is distinct from expected.argnames or info.proretset or info.proisstrict or info.proleakproof
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.wrapper_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('public.faolla_attendance_operational_source_tuple_v1(jsonb)','df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a'),
  ('public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamptz)','9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee'),
  ('public.faolla_attendance_operational_punch_stamp_v1(timestamptz)','6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2'),
  ('public.faolla_attendance_operational_punch_source_ref_v1(jsonb)','31e3cf7da541768bfe88b06b896720cf6d32cb47a8550f2375bc4fc8716c62e7'),
  ('public.faolla_attendance_operational_punch_saved_source_v1(jsonb)','f53cef420fc594df65958da59a049b029e16adf882b6e6647ff6124cfa80739d')
 ) dependency(signature,source_hash) loop
  f:=to_regprocedure(expected.signature);select * into info from pg_proc p where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef or info.proconfig is distinct from array['search_path=pg_catalog']
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner or a.grantee<>expected_owner)
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('service_role',f,'EXECUTE')
   then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 end loop;
 if (select count(*) from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns)
  and (p.proname like 'faolla_attendance_application_window_%' or p.proname like 'faolla_attendance_operational_consumer_%'))<>16 then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 for expected in select * from (values
  ('public.faolla_attendance_application_window_scalar_v1(jsonb,text)','fa75ce0a10f746cece393962aca52ffcdb191887d4ea6ed06a40b3867ef717db','boolean','i',false,false,0,array['p','k']::text[]),
  ('public.faolla_attendance_operational_consumer_command_v1(text,text,uuid,jsonb)','f22ef2fbe33e4214733482e36d121ded8cb9db2f48c3f84fef42faf70de641c7','jsonb','s',false,false,0,array['p_site','p_consumer','p_actor','p']::text[]),
  ('public.faolla_attendance_operational_consumer_item_v1(public.merchant_attendance_operational_consumer_activations)','018cf97af523313e0759e0cc378d80ba1d8bf98b0501ecbaab322b5819afc5a4','jsonb','s',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_operational_consumer_activation_v1(jsonb,uuid,jsonb,boolean)','d4cdaae19d5488037fe732553be3e7cec835db5dc057f0160f8515f55cf9408d','jsonb','v',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_activate']::text[]),
  ('public.faolla_attendance_application_window_query_v1(jsonb)','68022aba03c58075eaac3b9b98c62759f02fb19fdafca2d350cc30d0ff312d51','jsonb','s',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_application_window_command_v1(jsonb,uuid,jsonb)','ecc448d7cb4b3939d24c3726f1c305dc6ef2e784ce486d90931f5c388f73b40f','jsonb','s',false,false,0,array['p_query','p_actor','p']::text[]),
  ('public.faolla_attendance_application_window_facts_v1(text,text,uuid)','46256fe102ad1400927fe7195b9043c6db86e8affb19b931f4c0342f828b9dc6','jsonb','s',false,false,0,array['p_site','p_family','p_operation']::text[]),
  ('public.faolla_attendance_application_window_value_v1(text,jsonb,bigint,timestamptz,uuid,timestamptz,timestamptz)','dcc89ad6143fdcef106cbc201532fe3265778c5b17d2eb82a7c0928e5ef28fc2','jsonb','s',false,false,0,array['p_family','p_source','p_activation','p_anchor','p_root','p_root_anchor','p_root_deadline']::text[]),
  ('public.faolla_attendance_application_window_proof_v1(public.merchant_attendance_application_window_proofs)','548056e2b851f7114f531fe65612555bf40ac7402aa983884fb9a2b71adee81c','jsonb','s',false,false,0,array['p']::text[]),
  ('public.faolla_attendance_application_window_gate_v1(text,boolean,uuid,timestamp with time zone)','5f7e3dfa3e51cc1baaab8d95c10a2b7b91fba556d9fd744b65e7bb686b3d9d09','void','s',false,false,0,array['p_site','p_managed','p_root','p_at']::text[]),
  ('public.faolla_attendance_application_window_v1(jsonb,uuid,jsonb,boolean)','7883e28e57dee6ba9ecb4cad48df0b0265a0d166a1272a49638cd393fdd7a511','jsonb','v',true,true,2,array['p_query','p_auth_user_id','p_command','p_allow_write']::text[]),
  ('public.faolla_attendance_application_window_guard_v1()','6a06c7dcb0c318b52eec2ee5e21ae1c168107e8a0faef96fa563364e47636262','trigger','v',true,false,0,array[]::text[]),
  ('public.faolla_attendance_application_window_core_correction_v1(text,uuid,jsonb,jsonb,boolean,boolean)','fdedf2502bf938235e67d30407fa37b21a019c07b6e8ea02ad1740b77601e7b4','jsonb','v',false,false,3,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled','p_managed']::text[]),
  ('public.faolla_attendance_application_window_core_revision_v1(text,uuid,jsonb,jsonb,boolean,boolean)','2cf04d4eca7a72cbfcff4a307eaa91db932c9d447243314bb5aa81728ca401b4','jsonb','v',false,false,3,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled','p_managed']::text[]),
  ('public.faolla_attendance_application_window_core_revision_v2(text,uuid,jsonb,jsonb,boolean,boolean)','f99b9a5cb8ba6472725197b8333201754b7dd5f585bb40200df6af274815567c','jsonb','v',false,false,3,array['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled','p_managed']::text[]),
  ('public.faolla_attendance_application_window_core_missing_v1(jsonb,uuid,jsonb,boolean,boolean)','43eda2cad5becf065932b51d8720a8d2615dd070ef17252b6c6912215a59b46a','jsonb','v',false,false,3,array['p_query','p_auth_user_id','p_command','p_allow_write','p_managed']::text[])
 ) own(signature,source_hash,result_type,volatility,is_definer,is_rpc,defaults,argnames) loop
  f:=to_regprocedure(expected.signature);select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef is distinct from expected.is_definer
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility or info.lanname<>'plpgsql'
   or info.prorettype is distinct from to_regtype(expected.result_type) or info.proretset or info.proisstrict or info.proleakproof or info.pronargdefaults<>expected.defaults
   or coalesce(info.proargnames,array[]::text[]) is distinct from expected.argnames
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not expected.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from expected.is_rpc then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
 end loop;
 for expected in select * from (values
  ('merchant_attendance_operational_consumer_activations',array['merchant_id','consumer','operation_id','revision','actor_auth_user_id','action','reason','command','command_fingerprint','recorded_at']::text[],array['text','text','uuid','bigint','uuid','text','text','jsonb','text','timestamp with time zone']::text[],7,1),
  ('merchant_attendance_application_window_proofs',array['merchant_id','family','operation_id','request_id','worker_id','employee_id','employee_auth_user_id','actor_auth_user_id','query','command','command_fingerprint','window_snapshot','source_ref','recorded_at']::text[],array['text','text','uuid','uuid','uuid','uuid','uuid','uuid','jsonb','jsonb','text','jsonb','jsonb','timestamp with time zone']::text[],4,3)
 ) tbl(table_name,columns,types,checks,fkeys) loop
  t:=to_regclass('public.'||expected.table_name);
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or array(select a.attname::text from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.columns
   or array(select format_type(a.atttypid,a.atttypmod) from pg_attribute a where a.attrelid=t and a.attnum>0 and not a.attisdropped order by a.attnum) is distinct from expected.types
   or exists(select 1 from pg_attribute where attrelid=t and attnum>0 and (attisdropped or not attnotnull or atthasdef or attidentity<>'' or attgenerated<>'' or attndims<>0))
   or exists(select 1 from pg_constraint where conrelid=t and (not convalidated or contype='c' and connoinherit))
   or (select count(*) from pg_constraint where conrelid=t and contype='c')<>expected.checks or (select count(*) from pg_constraint where conrelid=t and contype='f')<>expected.fkeys
   or (select count(*) from pg_constraint where conrelid=t and contype='p')<>1 or (select count(*) from pg_constraint where conrelid=t and contype='u')<>1
   or exists(select 1 from pg_constraint where conrelid=t and contype not in('c','f','p','u','t'))
   or (select count(*) from pg_index where indrelid=t)<>2
   or exists(select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_am am on am.oid=ic.relam where i.indrelid=t
    and (not i.indisvalid or not i.indisready or not i.indislive or not i.indisunique or i.indpred is not null or i.indexprs is not null or am.amname<>'btree' or ic.relowner<>expected_owner))
   or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='application_window_immutable' and tgtype=27 and tgenabled='O' and tgnargs=0 and tgqual is null and tgfoid='public.faolla_attendance_application_window_guard_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='application_window_no_truncate' and tgtype=34 and tgenabled='O' and tgnargs=0 and tgqual is null and tgfoid='public.faolla_attendance_application_window_guard_v1()'::regprocedure)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='application_window_proof' and tgtype=5 and tgenabled='O' and tgnargs=0 and tgqual is null and tgdeferrable and tginitdeferred and tgfoid='public.faolla_attendance_application_window_guard_v1()'::regprocedure)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_application_window_installation_conflict';end if;
  end loop;
 end loop;
end;
$window_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610080194,'merchant_attendance_application_window') on conflict(version) do nothing;
commit;
