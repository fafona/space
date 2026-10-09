--241: private single-worker source only. No grants, HTTP, tables or consumers.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

--Dependency versions are pinned to the reviewed read chain, not merely to
--the freshly-created getter. Namespace normalization also supports owned tests.
do $source_preflight$
declare installed boolean;ns text;expected_owner oid;f regprocedure;expected record;info record;object_name text;idx record;
begin
 if to_regclass('public.faolla_schema_migrations') is null
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules')
 then raise exception 'merchant_attendance_operational_source_prerequisite_required';end if;
 foreach object_name in array array['merchants','merchant_attendance_settings','merchant_attendance_workers','merchant_enterprise_employees',
  'merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations',
  'merchant_attendance_correction_controls','merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'] loop
  if to_regclass('public.'||object_name) is null then raise exception 'merchant_attendance_operational_source_prerequisite_required';end if;
 end loop;
 select p.proowner into expected_owner from pg_proc p where p.oid=to_regprocedure('public.faolla_attendance_operational_rule_hash_v1(jsonb)');
 if expected_owner is null or expected_owner<>(select oid from pg_roles where rolname=current_user) then raise exception 'merchant_attendance_operational_source_owner_required';end if;
 select n.nspname into ns from pg_namespace n where n.oid=(select c.relnamespace from pg_class c where c.oid='public.merchant_attendance_settings'::regclass);
 for expected in select * from (values
  ('public.faolla_attendance_operational_rule_object_v1(jsonb,text[])','c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7','boolean','i','sql'),
  ('public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)','99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce','boolean','i','plpgsql'),
  ('public.faolla_attendance_operational_rule_scope_v1(jsonb)','9e323d5672d38255e4f92bc2b0d5f0dd4e6190cbe04b7773bc80e40618f57275','jsonb','i','plpgsql'),
  ('public.faolla_attendance_operational_rule_context_tuple_v1(jsonb,jsonb)','e0bc60a2402351503edb4ea94cd1791b95644c3f098af0aaefeac253c8264179','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_rule_values_v1(jsonb)','ff59e8fceee61f8a60694614de50200e48f3e51ffb3d355e73d8f18f22af012b','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_rule_command_v1(jsonb)','ba2f97fd74fac4343a513b6edf5c9faa34f44c89108908e7e411759b4fa6b5f1','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_rule_hash_v1(jsonb)','fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7','text','i','sql'),
  ('public.faolla_attendance_operational_rule_references_tuple_v1(jsonb,jsonb,jsonb)','642dd54d586411b6ac0aa435ad0ad53630eb2a5ed7a74d0559248bf942795a26','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_rule_item_v1(public.merchant_attendance_operational_rule_operations)','6fbb4c8e283366e526e208fae0b53dc41110161bdfd99e0af196a050c2448396','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_rule_check_v1(text,text,bigint)','25809b0d345f18bc1558029cf1a1063285744d7b89d76b3e34462231542d7fc8','void','s','plpgsql'),
  ('public.faolla_attendance_group_text_v1(text,integer,integer)','b440810c3afb56de19592e1492e16b12cf6faf800ac2f9d0a8e7bdeca2ecc562','boolean','i','sql'),
  ('public.faolla_attendance_group_date_v1(text,text)','78b42d44e8e4a547db264ec59f7866627284a959b82f0c46f0d646fba5931c8b','boolean','s','plpgsql'),
  ('public.faolla_attendance_group_command_v1(jsonb)','579d7fa2487e8220179294ba36500b39e1a7e828024e8377ad69578da13d61c5','boolean','s','plpgsql'),
  ('public.faolla_attendance_group_item_v1(public.merchant_attendance_groups)','19231ed0c7b2ecf95e91a27dc92caaefcf6aa3b81b908b54b216574c882c6acf','jsonb','s','sql'),
  ('public.faolla_attendance_group_receipt_v1(public.merchant_attendance_group_operations,public.merchant_attendance_groups)','0e0897b6905d35b557c49667d1b039f7601e939bceef00d521206d760239ce4a','jsonb','v','plpgsql'),
  ('public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)','045838f03a886a8d133419c37148a0c747b58d2a6c6ebe0c8aa85d4d53edd392','jsonb','v','plpgsql'),
  ('public.faolla_attendance_group_assignment_item_v1(public.merchant_attendance_group_assignments)','475397dc4b3caf6ce0aab4058456d877e456b3744c3703f810cb80750fe67d82','jsonb','s','sql'),
  ('public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)','aa65e21fdec5f8854145dfa71ee3d3e3e4eff34bca59a4cda18bf52fb6af0a82','jsonb','v','plpgsql'),
  ('public.faolla_attendance_valid_zone_v1(text)','3681c82259aaf0653bbddf12e3904144a53030f6213b0e96cdf6f8d40702657d','boolean','s','sql'),
  ('public.faolla_attendance_rule_day_start_v1(text,text)','5aa3bbe223feed69419c53e22f1d77783b45f8bcae461c3d7d20d340a01faaf1','timestamptz','s','plpgsql'),
  ('public.faolla_attendance_personal_rule_end_v1(text,text)','db3c640e28878a9ac45f16e0af49df6bd0549169f7af6f5b317159d553f8bd25','timestamptz','s','plpgsql')
 ) pinned(signature,source_hash,return_type,volatility,language_name) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility
   or info.lanname is distinct from expected.language_name or info.prorettype is distinct from to_regtype(expected.return_type)
   or info.proretset or info.proisstrict or info.proleakproof
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) acl where acl.grantor<>expected_owner or acl.grantee<>expected_owner)
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('service_role',f,'EXECUTE')
  then raise exception 'merchant_attendance_operational_source_dependency_changed';end if;
 end loop;
 --These three existing partial Btrees bound predecessor/window probes.
 for expected in select * from (values
  ('attendance_group_assignments_overlap_idx','merchant_attendance_group_assignments',array['merchant_id','worker_id','starts_on','ends_on']::text[],array[0,0,0,0]::integer[],'(status <> ''cancelled''::text)'),
  ('attendance_correction_policy_idx','merchant_attendance_correction_controls',array['merchant_id','recorded_at','revision']::text[],array[0,3,3]::integer[],'(action = ''set_policy''::text)'),
  ('attendance_operational_rule_effective_idx','merchant_attendance_operational_rule_publications',array['merchant_id','stream_key','effective_at','published_revision']::text[],array[0,0,3,3]::integer[],'(withdrawn_revision IS NULL)')
 ) indexes(index_name,table_name,columns,options,predicate) loop
  select i.*,c.relowner,a.amname into idx from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indexrelid=to_regclass('public.'||expected.index_name);
  if idx.indexrelid is null or idx.relowner is distinct from expected_owner or idx.amname<>'btree' or not idx.indisvalid or not idx.indisready or not idx.indislive
   or idx.indisunique or idx.indisexclusion or idx.indexprs is not null
   or idx.indrelid is distinct from to_regclass('public.'||expected.table_name)
   or idx.indnkeyatts<>cardinality(expected.columns) or idx.indnatts<>idx.indnkeyatts
   or pg_get_expr(idx.indpred,idx.indrelid) is distinct from expected.predicate
   or array(select a.attname::text from generate_series(0,idx.indnkeyatts-1) q(ordinal) join pg_attribute a on a.attrelid=idx.indrelid and a.attnum=idx.indkey[q.ordinal] order by q.ordinal) is distinct from expected.columns
   or array(select idx.indoption[q.ordinal]::integer from generate_series(0,idx.indnkeyatts-1) q(ordinal) order by q.ordinal) is distinct from expected.options
  then raise exception 'merchant_attendance_operational_source_index_conflict';end if;
 end loop;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080192 and name<>'merchant_attendance_operational_source') then raise exception 'merchant_attendance_operational_source_installation_conflict';end if;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080192 and name='merchant_attendance_operational_source') into installed;
 if (select count(*) from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns)
  and p.proname like 'faolla_attendance_operational_source_%')<>(case when installed then 5 else 0 end) then raise exception 'merchant_attendance_operational_source_installation_conflict';end if;
 if not installed then return;end if;
 for expected in select * from (values
  ('public.faolla_attendance_operational_source_stamp_v1(text)','4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265','timestamptz','i','plpgsql'),
  ('public.faolla_attendance_operational_source_layer_v1(text,jsonb,timestamp with time zone)','26cf463e0e5da24c8783c4f085ca8076984243bb787033782cba4a281d58fc40','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_baseline_v1(text,timestamp with time zone,bigint)','6770099ab00f8827425c14773a8823509350c2745d742a998aff0dc7015019bf','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_tuple_v1(jsonb)','df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamp with time zone)','9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee','jsonb','v','plpgsql')
 ) pinned(signature,source_hash,return_type,volatility,language_name) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility
   or info.lanname is distinct from expected.language_name or info.prorettype is distinct from to_regtype(expected.return_type)
   or info.proretset or info.proisstrict or info.proleakproof
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) acl where acl.grantor<>expected_owner or acl.grantee<>expected_owner)
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('service_role',f,'EXECUTE')
  then raise exception 'merchant_attendance_operational_source_installation_conflict';end if;
 end loop;
end;
$source_preflight$;

create or replace function public.faolla_attendance_operational_source_stamp_v1(p text)
returns timestamptz language plpgsql immutable set search_path=pg_catalog as $$
declare t timestamptz;
begin
 if p is null or char_length(p)<>27 or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then raise exception 'attendance_operational_source_invalid';end if;
 t:=p::timestamptz;
 if not isfinite(t) or to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') is distinct from p then raise exception 'attendance_operational_source_invalid';end if;
 return t;
exception when invalid_text_representation or datetime_field_overflow then raise exception 'attendance_operational_source_invalid';
end;
$$;

create or replace function public.faolla_attendance_operational_source_layer_v1(p_site text,p_scope jsonb,p_at timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare key_value text;h public.merchant_attendance_operational_rule_streams%rowtype;
 idx public.merchant_attendance_operational_rule_publications%rowtype;o public.merchant_attendance_operational_rule_operations%rowtype;v jsonb;
begin
 key_value:=public.faolla_attendance_operational_rule_scope_v1(p_scope)::text;
 select * into h from public.merchant_attendance_operational_rule_streams x where x.merchant_id=p_site and x.stream_key=key_value;
 if h.stream_key is null then return null;end if;
 if h.scope is distinct from p_scope then raise exception 'attendance_operational_source_invalid';end if;
 perform public.faolla_attendance_operational_rule_check_v1(p_site,key_value,h.revision);
 --Do not filter expired ends before LIMIT: a personal gap is a complete absence,
 --not a request to walk an arbitrarily long expired publication history.
 select * into idx from public.merchant_attendance_operational_rule_publications x
  where x.merchant_id=p_site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at<=p_at
  order by x.effective_at desc,x.published_revision desc limit 1;
 if idx.operation_id is null then return null;end if;
 perform public.faolla_attendance_operational_rule_check_v1(p_site,key_value,idx.published_revision);
 if idx.ends_at is not null and idx.ends_at<=p_at then return null;end if;
 select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p_site and x.operation_id=idx.operation_id;
 if o.action is distinct from 'publish' or o.scope is distinct from p_scope or o.recorded_at>p_at then raise exception 'attendance_operational_source_invalid';end if;
 v:=public.faolla_attendance_operational_rule_item_v1(o);
 return jsonb_build_object('scope',p_scope,'operationId',o.operation_id,'revision',o.revision,'context',v->'context',
  'effectiveAt',v->'effectiveAt','endsAt',v->'endsAt','rulesFingerprint',v->'rulesFingerprint','referenceFingerprint',v->'referenceFingerprint',
  'rules',v->'rules','references',v->'references');
end;
$$;

create or replace function public.faolla_attendance_operational_source_baseline_v1(p_site text,p_at timestamptz,p_settings_version bigint)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare p public.merchant_attendance_correction_controls%rowtype;c jsonb;
begin
 select * into p from public.merchant_attendance_correction_controls x
  where x.merchant_id=p_site and x.action='set_policy' and x.recorded_at<=p_at order by x.recorded_at desc,x.revision desc limit 1;
 if p.revision is null then return null;end if;c:=p.command;
 if public.faolla_attendance_operational_rule_object_v1(c,array['action','operationId','expectedRevision','expectedSettingsVersion','reason','submissionWindowDays']) is distinct from true
  or public.faolla_attendance_operational_rule_object_v1(p.payload,array['submissionWindowDays','timeZone']) is distinct from true
  or c->>'action' is distinct from 'set_policy' or c->>'operationId' is distinct from p.operation_id::text
  or public.faolla_attendance_operational_rule_scalar_v1(to_jsonb(p.operation_id),'uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(to_jsonb(p.revision),'positive') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(c->'expectedRevision','revision') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(c->'expectedSettingsVersion','positive') is distinct from true
  or (c->>'expectedRevision')::bigint+1<>p.revision or (c->>'expectedSettingsVersion')::bigint>p_settings_version
  or jsonb_typeof(c->'submissionWindowDays') is distinct from 'number' or coalesce(c->>'submissionWindowDays','') !~ '^(0|[1-9][0-9]{0,2})$'
  or (c->>'submissionWindowDays')::integer>365 or c->'submissionWindowDays' is distinct from p.payload->'submissionWindowDays'
  or jsonb_typeof(c->'reason') is distinct from 'string' or c->>'reason' is distinct from p.reason
  or char_length(p.reason) not between 1 and 500 or p.reason<>btrim(p.reason) or p.reason ~ '[[:cntrl:]]'
  or jsonb_typeof(p.payload->'timeZone') is distinct from 'string' or public.faolla_attendance_valid_zone_v1(p.payload->>'timeZone') is distinct from true
  or not isfinite(p.recorded_at) then raise exception 'attendance_operational_source_invalid';end if;
 return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,
  'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'submissionWindowDays',p.payload->'submissionWindowDays','timeZone',p.payload->'timeZone');
end;
$$;

create or replace function public.faolla_attendance_operational_source_tuple_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare i jsonb;s jsonb;g jsonb;b jsonb;l jsonb;v jsonb;k text;field_name text;scope_value jsonb;ctx jsonb;rt jsonb;ft jsonb;
 it jsonb;st jsonb;gt jsonb:='null';bt jsonb:='null';lt jsonb:='[]';at_value timestamptz;from_value timestamptz;to_value timestamptz;
begin
 if public.faolla_attendance_operational_rule_object_v1(p,array['protocol','siteId','workerIdentity','at','settingsRef','groupAssignmentRef','layers','baselineCorrectionPolicyRef','sourceFingerprint']) is distinct from true
  or p->>'protocol' is distinct from 'attendance-operational-rule-source-v1' or jsonb_typeof(p->'siteId') is distinct from 'string'
  or char_length(p->>'siteId')<>8 or p->>'siteId' !~ '^[0-9]{8}$'
  or public.faolla_attendance_operational_rule_scalar_v1(p->'sourceFingerprint','hash') is distinct from true
  or octet_length(convert_to(p::text,'UTF8'))>262144 then raise exception 'attendance_operational_source_invalid';end if;
 at_value:=public.faolla_attendance_operational_source_stamp_v1(p->>'at');
 if at_value<timestamptz '2000-01-01T00:00:00Z' or at_value>=timestamptz '2101-01-01T00:00:00Z' then raise exception 'attendance_operational_source_invalid';end if;
 i:=p->'workerIdentity';s:=p->'settingsRef';g:=p->'groupAssignmentRef';b:=p->'baselineCorrectionPolicyRef';
 if public.faolla_attendance_operational_rule_object_v1(i,array['workerId','employeeId','employeeAuthUserId','workerVersion','employeeVersion']) is distinct from true
  or public.faolla_attendance_operational_rule_object_v1(s,array['version','timeZone']) is distinct from true
  or public.faolla_attendance_operational_rule_object_v1(p->'layers',array['enterprise','group','personal']) is distinct from true then raise exception 'attendance_operational_source_invalid';end if;
 foreach k in array array['workerId','employeeId','employeeAuthUserId'] loop
  if public.faolla_attendance_operational_rule_scalar_v1(i->k,'uuid') is distinct from true then raise exception 'attendance_operational_source_invalid';end if;
 end loop;
 foreach k in array array['workerVersion','employeeVersion'] loop
  if public.faolla_attendance_operational_rule_scalar_v1(i->k,'positive') is distinct from true then raise exception 'attendance_operational_source_invalid';end if;
 end loop;
 if public.faolla_attendance_operational_rule_scalar_v1(s->'version','positive') is distinct from true or jsonb_typeof(s->'timeZone') is distinct from 'string'
  or public.faolla_attendance_valid_zone_v1(s->>'timeZone') is distinct from true then raise exception 'attendance_operational_source_invalid';end if;
 it:=jsonb_build_array(i->>'workerId',i->>'employeeId',i->>'employeeAuthUserId',(i->>'workerVersion')::bigint,(i->>'employeeVersion')::bigint);
 st:=jsonb_build_array((s->>'version')::bigint,s->>'timeZone');
 if g is distinct from 'null'::jsonb then
  if public.faolla_attendance_operational_rule_object_v1(g,array['assignmentId','revision','operationId','groupId','currentGroupRevision','workerId','employeeId','savedWorkerVersion','savedSettingsVersion','timeZone','startsOn','endsOn','fromAt','toAt']) is distinct from true then raise exception 'attendance_operational_source_invalid';end if;
  foreach k in array array['assignmentId','operationId','groupId','workerId','employeeId'] loop
   if public.faolla_attendance_operational_rule_scalar_v1(g->k,'uuid') is distinct from true then raise exception 'attendance_operational_source_invalid';end if;
  end loop;
  foreach k in array array['revision','currentGroupRevision','savedWorkerVersion','savedSettingsVersion'] loop
   if public.faolla_attendance_operational_rule_scalar_v1(g->k,'positive') is distinct from true then raise exception 'attendance_operational_source_invalid';end if;
  end loop;
  if (g->>'revision')::bigint not in(1,2) or (g->>'revision'='1') is distinct from (g->>'operationId'=g->>'assignmentId')
   or g->'workerId' is distinct from i->'workerId' or g->'employeeId' is distinct from i->'employeeId'
   or (g->>'savedWorkerVersion')::bigint>(i->>'workerVersion')::bigint or (g->>'savedSettingsVersion')::bigint>(s->>'version')::bigint
   or jsonb_typeof(g->'timeZone') is distinct from 'string' or public.faolla_attendance_valid_zone_v1(g->>'timeZone') is distinct from true
   or jsonb_typeof(g->'startsOn') is distinct from 'string' or public.faolla_attendance_group_date_v1(g->>'startsOn',g->>'timeZone') is distinct from true
   or (g->'endsOn'='null'::jsonb) is distinct from (g->'toAt'='null'::jsonb)
   or g->>'revision'='2' and g->'endsOn'='null'::jsonb then raise exception 'attendance_operational_source_invalid';end if;
  from_value:=public.faolla_attendance_operational_source_stamp_v1(g->>'fromAt');to_value:=null;
  if g->'endsOn'<>'null'::jsonb then
   if jsonb_typeof(g->'endsOn') is distinct from 'string' or public.faolla_attendance_group_date_v1(g->>'endsOn',g->>'timeZone') is distinct from true
    or (g->>'endsOn')::date<(g->>'startsOn')::date then raise exception 'attendance_operational_source_invalid';end if;
   to_value:=public.faolla_attendance_operational_source_stamp_v1(g->>'toAt');
   if to_value is distinct from public.faolla_attendance_personal_rule_end_v1(g->>'endsOn',g->>'timeZone') then raise exception 'attendance_operational_source_invalid';end if;
  end if;
  if from_value is distinct from public.faolla_attendance_rule_day_start_v1(g->>'startsOn',g->>'timeZone') or from_value>at_value
   or to_value is not null and (to_value<=from_value or to_value<=at_value) then raise exception 'attendance_operational_source_invalid';end if;
  gt:=jsonb_build_array(g->>'assignmentId',(g->>'revision')::bigint,g->>'operationId',g->>'groupId',(g->>'currentGroupRevision')::bigint,
   g->>'workerId',g->>'employeeId',(g->>'savedWorkerVersion')::bigint,(g->>'savedSettingsVersion')::bigint,g->>'timeZone',g->>'startsOn',g->>'endsOn',g->>'fromAt',g->>'toAt');
 end if;
 foreach field_name in array array['enterprise','group','personal'] loop
  l:=p->'layers'->field_name;
  if l='null'::jsonb then lt:=lt||jsonb_build_array(null);continue;end if;
  if public.faolla_attendance_operational_rule_object_v1(l,array['scope','operationId','revision','context','effectiveAt','endsAt','rulesFingerprint','referenceFingerprint','rules','references']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(l->'operationId','uuid') is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(l->'revision','positive') is distinct from true then raise exception 'attendance_operational_source_invalid';end if;
  scope_value:=jsonb_build_object('kind',field_name);
  if field_name='group' then
   if g='null'::jsonb then raise exception 'attendance_operational_source_invalid';end if;
   scope_value:=scope_value||jsonb_build_object('groupId',g->'groupId');
  elsif field_name='personal' then scope_value:=scope_value||jsonb_build_object('workerId',i->'workerId','employeeId',i->'employeeId','employeeAuthUserId',i->'employeeAuthUserId');end if;
  if l->'scope' is distinct from scope_value then raise exception 'attendance_operational_source_invalid';end if;
  ctx:=public.faolla_attendance_operational_rule_context_tuple_v1(l->'context',scope_value);
  rt:=public.faolla_attendance_operational_rule_values_v1(l->'rules');ft:=public.faolla_attendance_operational_rule_references_tuple_v1(l->'references',scope_value,l->'rules');
  if (l->'context'->>'settingsVersion')::bigint>(s->>'version')::bigint
   or field_name='group' and (l->'context'->'subject'->>'groupRevision')::bigint>(g->>'currentGroupRevision')::bigint
   or field_name='personal' and ((l->'context'->'subject'->>'workerVersion')::bigint>(i->>'workerVersion')::bigint or (l->'context'->'subject'->>'employeeVersion')::bigint>(i->>'employeeVersion')::bigint)
   or l->>'rulesFingerprint' is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-values-v1',rt))
   or l->>'referenceFingerprint' is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-references-v1',p->>'siteId',public.faolla_attendance_operational_rule_scope_v1(scope_value),ctx,ft))
   or field_name='group' and l->'references'->'subject'->'groupActive' is distinct from 'true'::jsonb
   or field_name='personal' and (l->'references'->'subject'->'workerActive' is distinct from 'true'::jsonb or l->'references'->'subject'->'employeeActive' is distinct from 'true'::jsonb)
   or exists(select 1 from jsonb_array_elements(l->'references'->'locations') x where x->'active' is distinct from 'true'::jsonb)
   or exists(select 1 from jsonb_array_elements(l->'references'->'routes') x where x->'active' is distinct from 'true'::jsonb) then raise exception 'attendance_operational_source_invalid';end if;
  from_value:=public.faolla_attendance_operational_source_stamp_v1(l->>'effectiveAt');to_value:=null;
  if (field_name='personal') is distinct from (l->'endsAt'<>'null'::jsonb) then raise exception 'attendance_operational_source_invalid';end if;
  if l->'endsAt'<>'null'::jsonb then to_value:=public.faolla_attendance_operational_source_stamp_v1(l->>'endsAt');end if;
  if from_value>at_value or to_value is not null and (to_value<=from_value or to_value<=at_value) then raise exception 'attendance_operational_source_invalid';end if;
  lt:=lt||jsonb_build_array(jsonb_build_array(public.faolla_attendance_operational_rule_scope_v1(scope_value),l->>'operationId',(l->>'revision')::bigint,ctx,
   l->>'effectiveAt',l->>'endsAt',l->>'rulesFingerprint',l->>'referenceFingerprint',rt,ft));
 end loop;
 if b is distinct from 'null'::jsonb then
  if public.faolla_attendance_operational_rule_object_v1(b,array['operationId','revision','recordedAt','submissionWindowDays','timeZone']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(b->'operationId','uuid') is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(b->'revision','positive') is distinct from true
   or jsonb_typeof(b->'submissionWindowDays') is distinct from 'number' or coalesce(b->>'submissionWindowDays','') !~ '^(0|[1-9][0-9]{0,2})$'
   or (b->>'submissionWindowDays')::integer>365 or jsonb_typeof(b->'timeZone') is distinct from 'string'
   or public.faolla_attendance_valid_zone_v1(b->>'timeZone') is distinct from true
   or public.faolla_attendance_operational_source_stamp_v1(b->>'recordedAt')>at_value then raise exception 'attendance_operational_source_invalid';end if;
  bt:=jsonb_build_array(b->>'operationId',(b->>'revision')::bigint,b->>'recordedAt',(b->>'submissionWindowDays')::integer,b->>'timeZone');
 end if;
 return jsonb_build_array('attendance-operational-rule-source-v1',p->>'siteId',it,p->>'at',st,gt,lt,bt);
end;
$$;

create or replace function public.faolla_attendance_operational_source_v1(p_site text,p_worker uuid,p_employee uuid,p_employee_auth uuid,p_at timestamptz)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
 a public.merchant_attendance_group_assignments%rowtype;chosen public.merchant_attendance_group_assignments%rowtype;g public.merchant_attendance_groups%rowtype;
 candidate record;d date;lo date;hi date;window_count integer:=0;hit_count integer:=0;previous_id uuid;previous_end date;
 from_value timestamptz;to_value timestamptz;chosen_from timestamptz;chosen_to timestamptz;detail jsonb;group_ref jsonb:='null';layers jsonb;
 operation_value uuid;result jsonb;scope_value jsonb;fingerprint text;parameters_valid boolean:=false;
begin
 if p_site is null or char_length(p_site)<>8 or p_site !~ '^[0-9]{8}$' or p_worker is null or p_employee is null or p_employee_auth is null
  or p_at is null or not isfinite(p_at) or p_at<timestamptz '2000-01-01T00:00:00Z' or p_at>=timestamptz '2101-01-01T00:00:00Z'
  or public.faolla_attendance_operational_rule_scalar_v1(to_jsonb(p_worker),'uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(to_jsonb(p_employee),'uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(to_jsonb(p_employee_auth),'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
 parameters_valid:=true;
 --No owner spoof or action authorization. A caller intending to write must
 --already hold settings UPDATE; these compatible SHARE locks never upgrade it.
 perform 1 from public.merchants x where x.id=p_site for share;
 if not found then raise exception 'attendance_operational_source_not_found';end if;
 select * into s from public.merchant_attendance_settings x where x.merchant_id=p_site for share;
 if not found then raise exception 'attendance_settings_required';end if;
 select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.id=p_worker for share;
 if not found then raise exception 'attendance_operational_source_not_found';end if;
 select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=p_employee for share;
 if e.id is null or w.employee_id is distinct from e.id or e.auth_user_id is distinct from p_employee_auth then raise exception 'attendance_operational_source_identity_changed';end if;
 --These are current identity facts, not a new active/role/grant permission gate.
 d:=(p_at at time zone 'UTC')::date;lo:=d-2;hi:=d+2;
 for candidate in
  with preceding as (select x as assignment,false as inside_window from public.merchant_attendance_group_assignments x
   where x.merchant_id=p_site and x.worker_id=p_worker and x.status<>'cancelled' and x.starts_on<lo order by x.starts_on desc limit 1),
  inside as (select x as assignment,true as inside_window from public.merchant_attendance_group_assignments x
   where x.merchant_id=p_site and x.worker_id=p_worker and x.status<>'cancelled' and x.starts_on>=lo and x.starts_on<=hi order by x.starts_on limit 6)
  select bounded.assignment,bounded.inside_window from (select * from preceding union all select * from inside) bounded order by (bounded.assignment).starts_on
 loop
  a:=candidate.assignment;
  if candidate.inside_window then window_count:=window_count+1;if window_count>5 then raise exception 'attendance_operational_source_too_large';end if;end if;
  detail:=public.faolla_attendance_group_assignment_detail_v1(a);
  if a.revision not in(1,2) or a.status not in('assigned','ended') or a.updated_at>p_at
   or previous_id is not null and (previous_end is null or previous_end>=a.starts_on) then raise exception 'attendance_operational_source_invalid';end if;
  previous_id:=a.assignment_id;previous_end:=a.ends_on;
  from_value:=public.faolla_attendance_rule_day_start_v1(to_char(a.starts_on,'YYYY-MM-DD'),a.time_zone);to_value:=null;
  if a.ends_on is not null then to_value:=public.faolla_attendance_personal_rule_end_v1(to_char(a.ends_on,'YYYY-MM-DD'),a.time_zone);end if;
  if from_value is null or a.ends_on is not null and (to_value is null or to_value<=from_value) then raise exception 'attendance_operational_source_invalid';end if;
  if from_value<=p_at and (to_value is null or to_value>p_at) then
   hit_count:=hit_count+1;if hit_count>1 then raise exception 'attendance_operational_source_ambiguous';end if;
   if a.employee_id is distinct from p_employee then raise exception 'attendance_operational_source_identity_changed';end if;
   chosen:=a;chosen_from:=from_value;chosen_to:=to_value;
   operation_value:=(detail->'history'->-1->'command'->>'operationId')::uuid;
  end if;
 end loop;
 if hit_count=1 then
  select * into g from public.merchant_attendance_groups x where x.merchant_id=p_site and x.group_id=chosen.group_id for share;
  if g.group_id is null then raise exception 'attendance_operational_source_invalid';end if;
  perform public.faolla_attendance_group_checked_v1(g);
  if not g.active then raise exception 'attendance_operational_source_group_inactive';end if;
  group_ref:=jsonb_build_object('assignmentId',chosen.assignment_id,'revision',chosen.revision,'operationId',operation_value,
   'groupId',g.group_id,'currentGroupRevision',g.revision,'workerId',p_worker,'employeeId',chosen.employee_id,
   'savedWorkerVersion',chosen.worker_version,'savedSettingsVersion',chosen.settings_version,'timeZone',chosen.time_zone,
   'startsOn',to_char(chosen.starts_on,'YYYY-MM-DD'),'endsOn',to_char(chosen.ends_on,'YYYY-MM-DD'),
   'fromAt',to_char(chosen_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'toAt',to_char(chosen_to at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 end if;
 scope_value:=jsonb_build_object('kind','personal','workerId',p_worker,'employeeId',p_employee,'employeeAuthUserId',p_employee_auth);
 layers:=jsonb_build_object('enterprise',public.faolla_attendance_operational_source_layer_v1(p_site,jsonb_build_object('kind','enterprise'),p_at),
  'group',case when hit_count=1 then public.faolla_attendance_operational_source_layer_v1(p_site,jsonb_build_object('kind','group','groupId',g.group_id),p_at) else null end,
  'personal',public.faolla_attendance_operational_source_layer_v1(p_site,scope_value,p_at));
 result:=jsonb_build_object('protocol','attendance-operational-rule-source-v1','siteId',p_site,
  'workerIdentity',jsonb_build_object('workerId',p_worker,'employeeId',p_employee,'employeeAuthUserId',p_employee_auth,'workerVersion',w.version,'employeeVersion',e.version),
  'at',to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'settingsRef',jsonb_build_object('version',s.version,'timeZone',s.time_zone),
  'groupAssignmentRef',group_ref,'layers',layers,'baselineCorrectionPolicyRef',public.faolla_attendance_operational_source_baseline_v1(p_site,p_at,s.version),
  'sourceFingerprint',repeat('0',64));
 if octet_length(convert_to(result::text,'UTF8'))>262144 then raise exception 'attendance_operational_source_too_large';end if;
 fingerprint:=public.faolla_attendance_operational_rule_hash_v1(public.faolla_attendance_operational_source_tuple_v1(result));
 return jsonb_set(result,'{sourceFingerprint}',to_jsonb(fingerprint));
exception when raise_exception then
 if sqlerrm='attendance_invalid_request' and not parameters_valid then raise;end if;
 if sqlerrm in('attendance_settings_required','attendance_operational_source_not_found','attendance_operational_source_identity_changed',
  'attendance_operational_source_ambiguous','attendance_operational_source_group_inactive','attendance_operational_source_too_large','attendance_operational_source_invalid') then raise;end if;
 raise exception 'attendance_operational_source_invalid';
 when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_operational_source_invalid';
end;
$$;

revoke all on function public.faolla_attendance_operational_source_stamp_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_operational_source_layer_v1(text,jsonb,timestamp with time zone) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_operational_source_baseline_v1(text,timestamp with time zone,bigint) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_operational_source_tuple_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamp with time zone) from public,anon,authenticated,service_role;
do $source_postconditions$
declare ns text;expected_owner oid;f regprocedure;expected record;info record;
begin
 select p.proowner into expected_owner from pg_proc p where p.oid='public.faolla_attendance_operational_rule_hash_v1(jsonb)'::regprocedure;
 select n.nspname into ns from pg_namespace n where n.oid=(select c.relnamespace from pg_class c where c.oid='public.merchant_attendance_settings'::regclass);
 for expected in select * from (values
  ('public.faolla_attendance_operational_source_stamp_v1(text)','4c2243afe68dfe18fd9de9954ff48803c7b256cd64a7d0e25cb04ff540620265','timestamptz','i','plpgsql'),
  ('public.faolla_attendance_operational_source_layer_v1(text,jsonb,timestamp with time zone)','26cf463e0e5da24c8783c4f085ca8076984243bb787033782cba4a281d58fc40','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_baseline_v1(text,timestamp with time zone,bigint)','6770099ab00f8827425c14773a8823509350c2745d742a998aff0dc7015019bf','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_tuple_v1(jsonb)','df3dcf85c4372135967e37153987cc308524026a72d63238043263745bb6a61a','jsonb','s','plpgsql'),
  ('public.faolla_attendance_operational_source_v1(text,uuid,uuid,uuid,timestamp with time zone)','9a547b0446c317483eb27a3d604011ec671218cda50ff2cf544c002af825cbee','jsonb','v','plpgsql')
 ) pinned(signature,source_hash,return_type,volatility,language_name) loop
  f:=to_regprocedure(expected.signature);
  select p.*,l.lanname into info from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or info.proowner is distinct from expected_owner or info.prosecdef
   or info.proconfig is distinct from array['search_path=pg_catalog'] or info.provolatile::text is distinct from expected.volatility
   or info.lanname is distinct from expected.language_name or info.prorettype is distinct from to_regtype(expected.return_type)
   or info.proretset or info.proisstrict or info.proleakproof
   or encode(sha256(convert_to(replace(replace(info.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected.source_hash
   or exists(select 1 from aclexplode(coalesce(info.proacl,acldefault('f',info.proowner))) acl where acl.grantor<>expected_owner or acl.grantee<>expected_owner)
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('service_role',f,'EXECUTE')
  then raise exception 'merchant_attendance_operational_source_postcondition_failed';end if;
 end loop;
 if (select count(*) from pg_proc p where p.pronamespace=(select n.oid from pg_namespace n where n.nspname=ns)
  and p.proname like 'faolla_attendance_operational_source_%')<>5 then raise exception 'merchant_attendance_operational_source_postcondition_failed';end if;
end;
$source_postconditions$;

insert into public.faolla_schema_migrations(version,name) values(202610080192,'merchant_attendance_operational_source') on conflict(version) do nothing;
commit;
