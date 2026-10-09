--240: independent eight-field approval ledger only. No old rule DTO/writer,
--clock, request, notification or archive is replaced or consumed here.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $operational_preflight$
declare installed boolean;n text;
begin
 if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_operational_rules_prerequisite_required';end if;
 foreach n in array array['public.faolla_attendance_group_text_v1(text,integer,integer)',
  'public.faolla_attendance_rule_day_start_v1(text,text)','public.faolla_attendance_personal_rule_end_v1(text,text)',
  'public.faolla_attendance_group_date_v1(text,text)','public.faolla_attendance_valid_zone_v1(text)',
  'public.faolla_attendance_events_append_only_v1()'] loop
  if to_regprocedure(n) is null then raise exception 'merchant_attendance_operational_rules_prerequisite_required';end if;
 end loop;
 foreach n in array array['merchants','merchant_attendance_settings','merchant_attendance_groups','merchant_attendance_workers',
  'merchant_enterprise_employees','merchant_attendance_locations','merchant_attendance_account_epochs'] loop
  if to_regclass('public.'||n) is null then raise exception 'merchant_attendance_operational_rules_prerequisite_required';end if;
 end loop;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name<>'merchant_attendance_operational_rules') then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules') into installed;
 foreach n in array array['merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'] loop
  if installed<>(to_regclass('public.'||n) is not null) then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
 end loop;
 if installed<>(to_regprocedure('public.faolla_attendance_operational_rules_v1(jsonb,uuid,jsonb,boolean)') is not null) then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
end;
$operational_preflight$;

do $operational_reentry$
declare installed boolean;n text;t regclass;f regprocedure;entry_value record;metadata record;expected_owner oid;ns text;role_name text;is_op boolean;idx oid;
begin
 select exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules') into installed;
 if not installed then
  if exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_settings'::regclass) and (proname like 'faolla_attendance_operational_rule_%' or proname='faolla_attendance_operational_rules_v1')) then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
  return;
 end if;
 select p.proowner into expected_owner from pg_proc p where p.oid='public.faolla_attendance_group_text_v1(text,integer,integer)'::regprocedure;
 select nspname into ns from pg_namespace where oid=(select relnamespace from pg_class where oid='public.merchant_attendance_operational_rule_streams'::regclass);
 for entry_value in select * from (values
  ('public.faolla_attendance_operational_rule_object_v1(jsonb,text[])','c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7','boolean','i','sql',false),
  ('public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)','99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce','boolean','i','plpgsql',false),
  ('public.faolla_attendance_operational_rule_scope_v1(jsonb)','9e323d5672d38255e4f92bc2b0d5f0dd4e6190cbe04b7773bc80e40618f57275','jsonb','i','plpgsql',false),
  ('public.faolla_attendance_operational_rule_context_tuple_v1(jsonb,jsonb)','e0bc60a2402351503edb4ea94cd1791b95644c3f098af0aaefeac253c8264179','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_values_v1(jsonb)','ff59e8fceee61f8a60694614de50200e48f3e51ffb3d355e73d8f18f22af012b','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_command_v1(jsonb)','ba2f97fd74fac4343a513b6edf5c9faa34f44c89108908e7e411759b4fa6b5f1','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_hash_v1(jsonb)','fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7','text','i','sql',false),
  ('public.faolla_attendance_operational_rule_context_v1(text,jsonb)','0ffee88bfc9457553cdf5c17caeac906833d5fba986275facd2bb38fcedfdee3','jsonb','v','plpgsql',false),
  ('public.faolla_attendance_operational_rule_references_v1(text,jsonb,jsonb,jsonb)','68ca4f0221d201560dde8ec88f9552e1423364dfdf717cfb1a9ea09882237dd5','jsonb','v','plpgsql',false),
  ('public.faolla_attendance_operational_rule_references_tuple_v1(jsonb,jsonb,jsonb)','642dd54d586411b6ac0aa435ad0ad53630eb2a5ed7a74d0559248bf942795a26','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_item_v1(public.merchant_attendance_operational_rule_operations)','6fbb4c8e283366e526e208fae0b53dc41110161bdfd99e0af196a050c2448396','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_receipt_v1(public.merchant_attendance_operational_rule_operations)','1e37a768f3b5e265dc195ea509c3395e00825495265c433a241b1be1203d5669','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_preview_v1(text,jsonb,bigint,jsonb,text,text)','073fd2f8d00e73d2685a4cd521ff3f429d7ba0b91414289f1a405c7d9e310535','jsonb','v','plpgsql',false),
  ('public.faolla_attendance_operational_rule_check_v1(text,text,bigint)','25809b0d345f18bc1558029cf1a1063285744d7b89d76b3e34462231542d7fc8','void','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_guard_v1()','5d10e43cc5b6e25a9d1872f4084389e32e831c664e08ef479d912ea9fcc36535','trigger','v','plpgsql',false),
  ('public.faolla_attendance_operational_rules_v1(jsonb,uuid,jsonb,boolean)','c729c0c16e81c29dec02e7f78ebc77d4a2c7f4b3448724f6c5064a3f771ef7fb','jsonb','v','plpgsql',true)
 ) expected(signature,source_hash,return_type,volatility,language_name,is_rpc) loop
  f:=to_regprocedure(entry_value.signature);
  select p.*,l.lanname into metadata from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or metadata.proowner is distinct from expected_owner or metadata.prosecdef is distinct from (entry_value.is_rpc or f='public.faolla_attendance_operational_rule_guard_v1()'::regprocedure)
   or metadata.proconfig is distinct from array['search_path=pg_catalog'] or metadata.provolatile::text is distinct from entry_value.volatility
   or metadata.lanname is distinct from entry_value.language_name or metadata.prorettype is distinct from to_regtype(entry_value.return_type)
   or metadata.proretset or metadata.proisstrict or metadata.proleakproof
   or encode(sha256(convert_to(replace(replace(metadata.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from entry_value.source_hash
   or exists(select 1 from aclexplode(coalesce(metadata.proacl,acldefault('f',metadata.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not entry_value.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from entry_value.is_rpc
  then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns)
   and (proname like 'faolla_attendance_operational_rule_%' or proname='faolla_attendance_operational_rules_v1'))<>16 then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
 foreach n in array array['merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'] loop
  t:=to_regclass('public.'||n);is_op:=n='merchant_attendance_operational_rule_operations';
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or exists(select 1 from pg_constraint where conrelid=t and not convalidated)
   or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_no_truncate' and tgtype=34 and tgenabled='O'
    and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and tgnargs=0 and tgqual is null)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname=case when is_op then 'operational_rule_immutable' else 'operational_rule_shape' end
    and tgtype=case when is_op then 27 else 31 end and tgenabled='O' and tgnargs=0 and tgqual is null
    and tgfoid=case when is_op then 'public.faolla_attendance_events_append_only_v1()'::regprocedure else 'public.faolla_attendance_operational_rule_guard_v1()'::regprocedure end)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_proof' and tgtype=case when is_op then 5 else 21 end and tgenabled='O'
    and tgdeferrable and tginitdeferred and tgconstraint<>0 and tgnargs=0 and tgqual is null and tgfoid='public.faolla_attendance_operational_rule_guard_v1()'::regprocedure)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
  end loop;
 end loop;
 foreach n in array array['attendance_operational_rule_effective_idx','attendance_operational_rule_unique_time_idx','attendance_operational_rule_personal_catalog_idx'] loop
  idx:=to_regclass('public.'||n);
  if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam
   where i.indexrelid=idx and i.indisvalid and i.indisready and i.indislive and not i.indisexclusion and a.amname='btree'
    and i.indnkeyatts=case when n='attendance_operational_rule_effective_idx' then 4 else 3 end and i.indnatts=i.indnkeyatts
    and i.indisunique=(n='attendance_operational_rule_unique_time_idx')
    and i.indrelid=case when n='attendance_operational_rule_personal_catalog_idx' then 'public.merchant_attendance_operational_rule_streams'::regclass else 'public.merchant_attendance_operational_rule_publications'::regclass end
    and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[0])='merchant_id'
    and i.indoption[0]=0
    and (case when n='attendance_operational_rule_personal_catalog_idx' then
      i.indkey[1]=0 and pg_get_expr(i.indexprs,i.indrelid)='(scope ->> ''kind''::text)' and i.indpred is null
      and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[2])='stream_key'
      and i.indcollation[2]='pg_catalog."C"'::regcollation and i.indoption[1]=0 and i.indoption[2]=0
     else i.indexprs is null and pg_get_expr(i.indpred,i.indrelid)='(withdrawn_revision IS NULL)'
      and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[1])='stream_key'
      and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[2])='effective_at' and i.indoption[1]=0
      and i.indoption[2]=case when n='attendance_operational_rule_effective_idx' then 3 else 0 end
      and (n<>'attendance_operational_rule_effective_idx' or (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[3])='published_revision' and i.indoption[3]=3)
     end))
  then raise exception 'merchant_attendance_operational_rules_index_conflict';end if;
 end loop;
end;
$operational_reentry$;

create or replace function public.faolla_attendance_operational_rule_object_v1(p jsonb,ks text[])
returns boolean language sql immutable set search_path=pg_catalog as $$
 select p is not null and jsonb_typeof(p)='object' and p ?& ks
  and case when jsonb_typeof(p)='object' then (select count(*) from jsonb_object_keys(p))=cardinality(ks) else false end;
$$;
create or replace function public.faolla_attendance_operational_rule_scalar_v1(p jsonb,k text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
 if p is null then return false;end if;
 if k='uuid' then return jsonb_typeof(p)='string' and char_length(p#>>'{}')=36 and (p#>>'{}')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
 elsif k='hash' then return jsonb_typeof(p)='string' and char_length(p#>>'{}')=64 and (p#>>'{}')~'^[0-9a-f]{64}$';
 elsif k in('revision','positive') then return jsonb_typeof(p)='number' and (p#>>'{}')~'^(0|[1-9][0-9]{0,15})$'
  and (p#>>'{}')::numeric between (case when k='positive' then 1 else 0 end) and 9007199254740990;
 else return false;end if;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
create or replace function public.faolla_attendance_operational_rule_scope_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare k text;
begin
 if p->>'kind'='enterprise' and public.faolla_attendance_operational_rule_object_v1(p,array['kind']) is true then return jsonb_build_array('enterprise');
 elsif p->>'kind'='group' and public.faolla_attendance_operational_rule_object_v1(p,array['kind','groupId']) is true
  and public.faolla_attendance_operational_rule_scalar_v1(p->'groupId','uuid') is true then return jsonb_build_array('group',p->>'groupId');
 elsif p->>'kind'='personal' and public.faolla_attendance_operational_rule_object_v1(p,array['kind','workerId','employeeId','employeeAuthUserId']) is true then
  foreach k in array array['workerId','employeeId','employeeAuthUserId'] loop
   if public.faolla_attendance_operational_rule_scalar_v1(p->k,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  return jsonb_build_array('personal',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId');
 end if;
 raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_operational_rule_context_tuple_v1(p jsonb,s jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare v jsonb;a jsonb;
begin
 perform public.faolla_attendance_operational_rule_scope_v1(s);
 if public.faolla_attendance_operational_rule_object_v1(p,array['settingsVersion','timeZone','subject']) is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(p->'settingsVersion','positive') is distinct from true
  or jsonb_typeof(p->'timeZone') is distinct from 'string' or public.faolla_attendance_valid_zone_v1(p->>'timeZone') is distinct from true then raise exception 'attendance_invalid_request';end if;
 v:=p->'subject';a:='null'::jsonb;
 if s->>'kind'='enterprise' then
  if v is distinct from 'null'::jsonb then raise exception 'attendance_invalid_request';end if;
 elsif s->>'kind'='group' then
  if public.faolla_attendance_operational_rule_object_v1(v,array['groupRevision']) is distinct from true or public.faolla_attendance_operational_rule_scalar_v1(v->'groupRevision','positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
  a:=jsonb_build_array('group',(v->>'groupRevision')::bigint);
 else
  if public.faolla_attendance_operational_rule_object_v1(v,array['workerVersion','employeeVersion']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(v->'workerVersion','positive') is distinct from true or public.faolla_attendance_operational_rule_scalar_v1(v->'employeeVersion','positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
  a:=jsonb_build_array('personal',(v->>'workerVersion')::bigint,(v->>'employeeVersion')::bigint);
 end if;
 return jsonb_build_array((p->>'settingsVersion')::bigint,p->>'timeZone',a);
end;
$$;

--A validating tuple, not JSON object serialization. Every nested branch is
--exact; finite fixed fields/arrays also bound depth/nodes without recursive input.
create or replace function public.faolla_attendance_operational_rule_values_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;m text;c jsonb;v jsonb;z jsonb;t jsonb;out_value jsonb:='[]';part jsonb;arr jsonb;last_text text;position integer;prior integer;n bigint;d date;
begin
 if p is null or octet_length(convert_to(p::text,'UTF8'))>32768 or public.faolla_attendance_operational_rule_object_v1(p,
  array['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders']) is distinct from true then raise exception 'attendance_invalid_request';end if;
 foreach k in array array['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders'] loop
  c:=p->k;m:=c->>'mode';
  if m in('inherit','disabled') and public.faolla_attendance_operational_rule_object_v1(c,array['mode']) is true then
   out_value:=out_value||jsonb_build_array(jsonb_build_array(m));continue;
  end if;
  if m is distinct from 'value' or public.faolla_attendance_operational_rule_object_v1(c,array['mode','value']) is distinct from true then raise exception 'attendance_invalid_request';end if;
  v:=c->'value';part:=null;
  if k in('allowedChannels','locationScope') then
   if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) not between 1 and (case when k='allowedChannels' then 4 else 25 end) then raise exception 'attendance_invalid_request';end if;
   prior:=0;last_text:='';
   for z in select value from jsonb_array_elements(v) loop
    if k='allowedChannels' then
     position:=array_position(array['self','location','pin','onsite'],z#>>'{}');
     if jsonb_typeof(z) is distinct from 'string' or position is null or position<=prior then raise exception 'attendance_invalid_request';end if;prior:=position;
    else
     if public.faolla_attendance_operational_rule_scalar_v1(z,'uuid') is distinct from true or (z#>>'{}') collate "C"<=last_text collate "C" then raise exception 'attendance_invalid_request';end if;last_text:=z#>>'{}';
    end if;
   end loop;part:=v;
  elsif k='shiftSource' then
   if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') not in('published_selection','unplanned') then raise exception 'attendance_invalid_request';end if;part:=v;
  elsif k='breakTypes' then
   if public.faolla_attendance_operational_rule_object_v1(v,array['allowed','selection']) is distinct from true
    or jsonb_typeof(v->'allowed') is distinct from 'array' or jsonb_typeof(v->'selection') is distinct from 'string'
    or v->>'selection' not in('fixed','explicit') then raise exception 'attendance_invalid_request';end if;
   arr:=v->'allowed';if arr not in('["paid"]'::jsonb,'["unpaid"]'::jsonb,'["paid","unpaid"]'::jsonb)
    or v->>'selection'='fixed' and jsonb_array_length(arr)<>1 then raise exception 'attendance_invalid_request';end if;
   part:=jsonb_build_array(arr,v->>'selection');
  elsif k='correctionWindow' then
   if public.faolla_attendance_operational_rule_object_v1(v,array['days']) is distinct from true
    or public.faolla_attendance_operational_rule_scalar_v1(v->'days','revision') is distinct from true or (v->>'days')::bigint>365 then raise exception 'attendance_invalid_request';end if;part:=v->'days';
  elsif k='reviewRouting' then
   if public.faolla_attendance_operational_rule_object_v1(v,array['correction','missing','leave','work_arrangement']) is distinct from true then raise exception 'attendance_invalid_request';end if;part:='[]';
   foreach last_text in array array['correction','missing','leave','work_arrangement'] loop
    z:=v->last_text;
    if z='"owner"'::jsonb then t:=jsonb_build_array('owner');
    else
     if public.faolla_attendance_operational_rule_object_v1(z,array['delegateEmployeeId','delegateAuthUserId']) is distinct from true
      or public.faolla_attendance_operational_rule_scalar_v1(z->'delegateEmployeeId','uuid') is distinct from true or public.faolla_attendance_operational_rule_scalar_v1(z->'delegateAuthUserId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
     t:=jsonb_build_array('delegate',z->>'delegateEmployeeId',z->>'delegateAuthUserId');
    end if;part:=part||jsonb_build_array(t);
   end loop;
  elsif k='timesheetCycle' then
   if v->>'kind' in('monthly','manual') and public.faolla_attendance_operational_rule_object_v1(v,array['kind']) is true then part:=jsonb_build_array(v->>'kind');
   elsif v->>'kind'='weekly' and public.faolla_attendance_operational_rule_object_v1(v,array['kind','weekStartsOn']) is true then
    if public.faolla_attendance_operational_rule_scalar_v1(v->'weekStartsOn','positive') is distinct from true or (v->>'weekStartsOn')::bigint>7 then raise exception 'attendance_invalid_request';end if;
    part:=jsonb_build_array('weekly',(v->>'weekStartsOn')::integer);
   elsif v->>'kind'='fortnightly' and public.faolla_attendance_operational_rule_object_v1(v,array['kind','anchorDate']) is true then
    if jsonb_typeof(v->'anchorDate') is distinct from 'string' or coalesce(v->>'anchorDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(v->>'anchorDate',4)='0000' then raise exception 'attendance_invalid_request';end if;
    d:=(v->>'anchorDate')::date;if to_char(d,'YYYY-MM-DD')<>v->>'anchorDate' then raise exception 'attendance_invalid_request';end if;part:=jsonb_build_array('fortnightly',v->>'anchorDate');
   else raise exception 'attendance_invalid_request';end if;
  else
   if public.faolla_attendance_operational_rule_object_v1(v,array['open_session','pending_review','period_due']) is distinct from true then raise exception 'attendance_invalid_request';end if;part:='[]';
   foreach last_text in array array['open_session','pending_review','period_due'] loop
    z:=v->last_text;
    if z->>'mode'='disabled' and public.faolla_attendance_operational_rule_object_v1(z,array['mode']) is true then t:=jsonb_build_array('disabled');
    else
     if z->>'mode' is distinct from 'enabled' or public.faolla_attendance_operational_rule_object_v1(z,array['mode','afterMinutes','repeatMinutes','maxOccurrences']) is distinct from true then raise exception 'attendance_invalid_request';end if;
     foreach m in array array['afterMinutes','repeatMinutes','maxOccurrences'] loop
      if public.faolla_attendance_operational_rule_scalar_v1(z->m,'positive') is distinct from true then raise exception 'attendance_invalid_request';end if;n:=(z->>m)::bigint;
      if n>(case when m='maxOccurrences' then 10 else 44640 end) or m='repeatMinutes' and n<60 then raise exception 'attendance_invalid_request';end if;
     end loop;t:=jsonb_build_array('enabled',(z->>'afterMinutes')::integer,(z->>'repeatMinutes')::integer,(z->>'maxOccurrences')::integer);
    end if;part:=part||jsonb_build_array(t);
   end loop;
  end if;
  out_value:=out_value||jsonb_build_array(jsonb_build_array('value',part));
 end loop;
 return out_value;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
create or replace function public.faolla_attendance_operational_rule_command_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare a text;r jsonb;s jsonb;
begin
 if p is null or octet_length(convert_to(p::text,'UTF8'))>40960 or jsonb_typeof(p->'siteId') is distinct from 'string' or char_length(p->>'siteId')<>8 or coalesce(p->>'siteId','')!~'^[0-9]{8}$'
  or public.faolla_attendance_operational_rule_scalar_v1(p->'operationId','uuid') is distinct from true
  or public.faolla_attendance_operational_rule_scalar_v1(p->'expectedRevision','revision') is distinct from true or (p->>'expectedRevision')::bigint>=9007199254740990
  or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,200) is distinct from true then raise exception 'attendance_invalid_request';end if;
 s:=public.faolla_attendance_operational_rule_scope_v1(p->'scope');a:=p->>'action';
 r:=jsonb_build_array(p->>'siteId',s,a,p->>'operationId',(p->>'expectedRevision')::bigint,p->>'reason');
 if a='save_draft' then
  if public.faolla_attendance_operational_rule_object_v1(p,array['siteId','scope','action','operationId','expectedRevision','reason','expectedContext','rules']) is distinct from true then raise exception 'attendance_invalid_request';end if;
  return r||jsonb_build_array(public.faolla_attendance_operational_rule_context_tuple_v1(p->'expectedContext',p->'scope'),public.faolla_attendance_operational_rule_values_v1(p->'rules'));
 elsif a='publish' then
  if public.faolla_attendance_operational_rule_object_v1(p,array['siteId','scope','action','operationId','expectedRevision','reason','sourceDraftRevision','effectiveOn','endsOn','previewFingerprint']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p->'sourceDraftRevision','positive') is distinct from true or (p->>'sourceDraftRevision')::bigint>(p->>'expectedRevision')::bigint
   or public.faolla_attendance_operational_rule_scalar_v1(p->'previewFingerprint','hash') is distinct from true
   or jsonb_typeof(p->'effectiveOn') is distinct from 'string' or public.faolla_attendance_group_date_v1(p->>'effectiveOn') is distinct from true then raise exception 'attendance_invalid_request';end if;
  if p->'scope'->>'kind'='personal' then
   if jsonb_typeof(p->'endsOn') is distinct from 'string' or public.faolla_attendance_group_date_v1(p->>'endsOn') is distinct from true or (p->>'endsOn')::date<(p->>'effectiveOn')::date then raise exception 'attendance_invalid_request';end if;
  elsif p->'endsOn' is distinct from 'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  return r||jsonb_build_array((p->>'sourceDraftRevision')::bigint,p->>'effectiveOn',p->>'endsOn',p->>'previewFingerprint');
 elsif a='withdraw' then
  if public.faolla_attendance_operational_rule_object_v1(p,array['siteId','scope','action','operationId','expectedRevision','reason','publishedRevision']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p->'publishedRevision','positive') is distinct from true or (p->>'publishedRevision')::bigint>(p->>'expectedRevision')::bigint then raise exception 'attendance_invalid_request';end if;
  return r||jsonb_build_array((p->>'publishedRevision')::bigint);
 end if;raise exception 'attendance_invalid_request';
end;
$$;

create table if not exists public.merchant_attendance_operational_rule_streams (
 merchant_id text not null references public.merchant_attendance_settings(merchant_id),stream_key text not null,scope jsonb not null,
 revision bigint not null check(revision between 1 and 9007199254740990),draft_revision bigint null,
 created_at timestamptz not null,updated_at timestamptz not null,
 primary key(merchant_id,stream_key),
 check(stream_key=public.faolla_attendance_operational_rule_scope_v1(scope)::text),
 check(draft_revision is null or draft_revision between 1 and revision),
 check(isfinite(created_at) and isfinite(updated_at) and updated_at>=created_at)
);
create table if not exists public.merchant_attendance_operational_rule_operations (
 merchant_id text not null,stream_key text not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
 scope jsonb not null,actor_auth_user_id uuid not null,action text not null check(action in('save_draft','publish','withdraw')),
 command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),item jsonb not null,
 draft_revision_after bigint null,recorded_at timestamptz not null check(isfinite(recorded_at)),
 primary key(merchant_id,operation_id),unique(merchant_id,stream_key,revision),
 foreign key(merchant_id,stream_key) references public.merchant_attendance_operational_rule_streams(merchant_id,stream_key) deferrable initially deferred,
 check(stream_key=public.faolla_attendance_operational_rule_scope_v1(scope)::text),
 check(public.faolla_attendance_operational_rule_command_v1(command) is not null),
 check(command->>'siteId'=merchant_id and command->'scope'=scope and command->>'operationId'=operation_id::text and command->>'action'=action and (command->>'expectedRevision')::bigint=revision-1),
 check(draft_revision_after is null or draft_revision_after between 1 and revision),
 check((action='save_draft' and draft_revision_after=revision) or action='publish' and draft_revision_after is null or action='withdraw'),
 check(revision<>1 or action='save_draft')
);
create table if not exists public.merchant_attendance_operational_rule_publications (
 merchant_id text not null,stream_key text not null,published_revision bigint not null,operation_id uuid not null,
 effective_at timestamptz not null,ends_at timestamptz null,withdrawn_revision bigint null,
 primary key(merchant_id,stream_key,published_revision),unique(merchant_id,operation_id),
 foreign key(merchant_id,stream_key,published_revision) references public.merchant_attendance_operational_rule_operations(merchant_id,stream_key,revision) deferrable initially deferred,
 foreign key(merchant_id,operation_id) references public.merchant_attendance_operational_rule_operations(merchant_id,operation_id) deferrable initially deferred,
 foreign key(merchant_id,stream_key,withdrawn_revision) references public.merchant_attendance_operational_rule_operations(merchant_id,stream_key,revision) deferrable initially deferred,
 check(isfinite(effective_at) and (ends_at is null or isfinite(ends_at) and ends_at>effective_at)),
 check(withdrawn_revision is null or withdrawn_revision>published_revision)
);
create index if not exists attendance_operational_rule_effective_idx on public.merchant_attendance_operational_rule_publications(merchant_id,stream_key,effective_at desc,published_revision desc) where withdrawn_revision is null;
create unique index if not exists attendance_operational_rule_unique_time_idx on public.merchant_attendance_operational_rule_publications(merchant_id,stream_key,effective_at) where withdrawn_revision is null;
create index if not exists attendance_operational_rule_personal_catalog_idx on public.merchant_attendance_operational_rule_streams(merchant_id,(scope->>'kind'),stream_key collate "C");

create or replace function public.faolla_attendance_operational_rule_hash_v1(p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
 select encode(sha256(convert_to(p::text,'UTF8')),'hex');
$$;
create or replace function public.faolla_attendance_operational_rule_context_v1(p_site text,p_scope jsonb)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
 e public.merchant_enterprise_employees%rowtype;g public.merchant_attendance_groups%rowtype;c jsonb;v jsonb:='null';active_value boolean:=true;
begin
 perform public.faolla_attendance_operational_rule_scope_v1(p_scope);
 select * into s from public.merchant_attendance_settings x where x.merchant_id=p_site for share;
 if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
 c:=jsonb_build_object('settingsVersion',s.version,'timeZone',s.time_zone,'subject',null);
 if p_scope->>'kind'='group' then
  select * into g from public.merchant_attendance_groups x where x.merchant_id=p_site and x.group_id=(p_scope->>'groupId')::uuid for share;
  if g.group_id is null then raise exception 'attendance_operational_rule_not_found';end if;
  c:=jsonb_set(c,'{subject}',jsonb_build_object('groupRevision',g.revision));v:=jsonb_build_object('groupActive',g.active);active_value:=g.active;
 elsif p_scope->>'kind'='personal' then
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.id=(p_scope->>'workerId')::uuid for share;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=(p_scope->>'employeeId')::uuid for share;
  if w.id is null or e.id is null or w.employee_id is distinct from e.id or e.auth_user_id is distinct from (p_scope->>'employeeAuthUserId')::uuid then
   return jsonb_build_object('context',null,'subject',null,'usable',false);
  end if;
  active_value:=e.status='active' and not exists(select 1 from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=e.id and x.paused);
  c:=jsonb_set(c,'{subject}',jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version));
  v:=jsonb_build_object('workerActive',w.active,'employeeActive',active_value);active_value:=active_value and w.active;
 end if;
 perform public.faolla_attendance_operational_rule_context_tuple_v1(c,p_scope);
 return jsonb_build_object('context',c,'subject',v,'usable',active_value);
end;
$$;
create or replace function public.faolla_attendance_operational_rule_references_v1(p_site text,p_scope jsonb,p_rules jsonb,p_subject jsonb)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare ids uuid[]:='{}';id_value uuid;z jsonb;k text;l public.merchant_attendance_locations%rowtype;e public.merchant_enterprise_employees%rowtype;
 locs jsonb:='[]';routes jsonb:='[]';members jsonb:='{}';active_value boolean;
begin
 perform public.faolla_attendance_operational_rule_values_v1(p_rules);
 --At most four routing members, sorted once. No role/grant/worker scan or source.
 if p_rules->'reviewRouting'->>'mode'='value' then
  select array_agg(distinct (value->>'delegateEmployeeId')::uuid order by (value->>'delegateEmployeeId')::uuid) into ids
   from jsonb_each(p_rules->'reviewRouting'->'value') where jsonb_typeof(value)='object';
  foreach id_value in array coalesce(ids,'{}'::uuid[]) loop
   select * into e from public.merchant_enterprise_employees x where x.merchant_id=p_site and x.id=id_value for share;
   if e.id is null then raise exception 'attendance_operational_rule_not_found';end if;
   active_value:=e.status='active' and not exists(select 1 from public.merchant_attendance_account_epochs x where x.merchant_id=p_site and x.employee_id=e.id and x.paused);
   members:=members||jsonb_build_object(e.id::text,jsonb_build_object('employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'employeeVersion',e.version,'active',active_value));
  end loop;
  foreach k in array array['correction','missing','leave','work_arrangement'] loop
   z:=p_rules->'reviewRouting'->'value'->k;if z='"owner"'::jsonb then continue;end if;
   if members->(z->>'delegateEmployeeId')->>'employeeAuthUserId' is distinct from z->>'delegateAuthUserId' then raise exception 'attendance_operational_rule_changed';end if;
   routes:=routes||jsonb_build_array((members->(z->>'delegateEmployeeId'))||jsonb_build_object('category',k));
  end loop;
 end if;
 if p_rules->'locationScope'->>'mode'='value' then
  for z in select value from jsonb_array_elements(p_rules->'locationScope'->'value') loop
   select * into l from public.merchant_attendance_locations x where x.merchant_id=p_site and x.id=(z#>>'{}')::uuid for share;
   if l.id is null then raise exception 'attendance_operational_rule_not_found';end if;
   locs:=locs||jsonb_build_array(jsonb_build_object('locationId',l.id,'version',l.version,'active',l.active));
  end loop;
 end if;
 return jsonb_build_object('subject',p_subject,'locations',locs,'routes',routes);
end;
$$;
create or replace function public.faolla_attendance_operational_rule_references_tuple_v1(p jsonb,s jsonb,r jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare v jsonb;a jsonb:='null';locs jsonb:='[]';routes jsonb:='[]';k text;z jsonb;i integer:=0;
begin
 perform public.faolla_attendance_operational_rule_scope_v1(s);perform public.faolla_attendance_operational_rule_values_v1(r);
 if public.faolla_attendance_operational_rule_object_v1(p,array['subject','locations','routes']) is distinct from true
  or jsonb_typeof(p->'locations') is distinct from 'array' or jsonb_typeof(p->'routes') is distinct from 'array'
  or jsonb_array_length(p->'locations')>25 or jsonb_array_length(p->'routes')>4 then raise exception 'attendance_invalid_request';end if;
 v:=p->'subject';
 if s->>'kind'='enterprise' then
  if v is distinct from 'null'::jsonb then raise exception 'attendance_invalid_request';end if;
 elsif s->>'kind'='group' then
  if public.faolla_attendance_operational_rule_object_v1(v,array['groupActive']) is distinct from true or jsonb_typeof(v->'groupActive') is distinct from 'boolean' then raise exception 'attendance_invalid_request';end if;a:=jsonb_build_array('group',v->'groupActive');
 else
  if public.faolla_attendance_operational_rule_object_v1(v,array['workerActive','employeeActive']) is distinct from true
   or jsonb_typeof(v->'workerActive') is distinct from 'boolean' or jsonb_typeof(v->'employeeActive') is distinct from 'boolean' then raise exception 'attendance_invalid_request';end if;a:=jsonb_build_array('personal',v->'workerActive',v->'employeeActive');
 end if;
 for v in select value from jsonb_array_elements(p->'locations') loop
  if public.faolla_attendance_operational_rule_object_v1(v,array['locationId','version','active']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(v->'locationId','uuid') is distinct from true or public.faolla_attendance_operational_rule_scalar_v1(v->'version','positive') is distinct from true
   or jsonb_typeof(v->'active') is distinct from 'boolean' or r->'locationScope'->'value'->i is distinct from v->'locationId' then raise exception 'attendance_invalid_request';end if;
  locs:=locs||jsonb_build_array(jsonb_build_array(v->>'locationId',(v->>'version')::bigint,v->'active'));i:=i+1;
 end loop;
 if i<>(case when r->'locationScope'->>'mode'='value' then jsonb_array_length(r->'locationScope'->'value') else 0 end) then raise exception 'attendance_invalid_request';end if;i:=0;
 if r->'reviewRouting'->>'mode'='value' then
  foreach k in array array['correction','missing','leave','work_arrangement'] loop
   z:=r->'reviewRouting'->'value'->k;if z='"owner"'::jsonb then continue;end if;v:=p->'routes'->i;
   if public.faolla_attendance_operational_rule_object_v1(v,array['category','employeeId','employeeAuthUserId','employeeVersion','active']) is distinct from true
    or v->>'category' is distinct from k or v->'employeeId' is distinct from z->'delegateEmployeeId' or v->'employeeAuthUserId' is distinct from z->'delegateAuthUserId'
    or public.faolla_attendance_operational_rule_scalar_v1(v->'employeeVersion','positive') is distinct from true or jsonb_typeof(v->'active') is distinct from 'boolean' then raise exception 'attendance_invalid_request';end if;
   routes:=routes||jsonb_build_array(jsonb_build_array(k,v->>'employeeId',v->>'employeeAuthUserId',(v->>'employeeVersion')::bigint,v->'active'));i:=i+1;
  end loop;
 end if;
 if i<>jsonb_array_length(p->'routes') then raise exception 'attendance_invalid_request';end if;
 return jsonb_build_array(a,locs,routes);
end;
$$;

create or replace function public.faolla_attendance_operational_rule_item_v1(p public.merchant_attendance_operational_rule_operations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare v jsonb:=p.item;base_keys text[]:=array['scope','operationId','actorId','revision','reason','recordedAt','commandFingerprint'];ks text[];fp text;ctx jsonb;refs jsonb;rule_tuple jsonb;expected_command jsonb;
begin
 if p.operation_id is null or p.stream_key is distinct from public.faolla_attendance_operational_rule_scope_v1(p.scope)::text
  or p.command->>'siteId' is distinct from p.merchant_id or p.command->'scope' is distinct from p.scope or p.command->>'operationId' is distinct from p.operation_id::text
  or p.command->>'action' is distinct from p.action or (p.command->>'expectedRevision')::bigint is distinct from p.revision-1 then raise exception 'attendance_operational_rule_invalid';end if;
 fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-command-v1',p.actor_auth_user_id::text,public.faolla_attendance_operational_rule_command_v1(p.command)));
 if fp is distinct from p.command_fingerprint or v->>'commandFingerprint' is distinct from fp or v->'scope' is distinct from p.scope
  or v->>'operationId' is distinct from p.operation_id::text or v->>'actorId' is distinct from p.actor_auth_user_id::text
  or v->'revision' is distinct from to_jsonb(p.revision) or v->>'reason' is distinct from p.command->>'reason'
  or v->>'recordedAt' is distinct from to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  or v->>'action' is distinct from p.action then raise exception 'attendance_operational_rule_invalid';end if;
 expected_command:=jsonb_build_object('siteId',p.merchant_id,'scope',p.scope,'action',p.action,'operationId',p.operation_id,'expectedRevision',p.revision-1,'reason',v->>'reason');
 if p.action='withdraw' then
  ks:=base_keys||array['action','publishedRevision'];expected_command:=expected_command||jsonb_build_object('publishedRevision',v->'publishedRevision');
 else
  ctx:=public.faolla_attendance_operational_rule_context_tuple_v1(v->'context',p.scope);
  rule_tuple:=public.faolla_attendance_operational_rule_values_v1(v->'rules');refs:=public.faolla_attendance_operational_rule_references_tuple_v1(v->'references',p.scope,v->'rules');
  if v->>'rulesFingerprint' is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-values-v1',rule_tuple))
   or v->>'referenceFingerprint' is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-references-v1',p.merchant_id,public.faolla_attendance_operational_rule_scope_v1(p.scope),ctx,refs)) then raise exception 'attendance_operational_rule_invalid';end if;
  ks:=base_keys||array['action','context','rules','rulesFingerprint','references','referenceFingerprint'];
  if p.action='save_draft' then
   expected_command:=expected_command||jsonb_build_object('expectedContext',v->'context','rules',v->'rules');
  else
   ks:=ks||array['sourceDraftRevision','effectiveOn','endsOn','effectiveAt','endsAt','previewFingerprint'];
   expected_command:=expected_command||jsonb_build_object('sourceDraftRevision',v->'sourceDraftRevision','effectiveOn',v->'effectiveOn','endsOn',v->'endsOn','previewFingerprint',v->'previewFingerprint');
   if v->>'effectiveAt' is distinct from to_char(public.faolla_attendance_rule_day_start_v1(v->>'effectiveOn',v->'context'->>'timeZone') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    or v->>'endsAt' is distinct from (case when v->>'endsOn' is null then null else to_char(public.faolla_attendance_personal_rule_end_v1(v->>'endsOn',v->'context'->>'timeZone') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end)
    or (v->>'effectiveAt')::timestamptz<=p.recorded_at or (v->>'effectiveOn')::date<=(p.recorded_at at time zone (v->'context'->>'timeZone'))::date
    or v->>'previewFingerprint' is distinct from public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-publish-preview-v1',p.merchant_id,public.faolla_attendance_operational_rule_scope_v1(p.scope),p.revision-1,
     (v->>'sourceDraftRevision')::bigint,v->>'rulesFingerprint',v->>'referenceFingerprint',v->>'effectiveOn',v->>'endsOn',v->>'effectiveAt',v->>'endsAt')) then raise exception 'attendance_operational_rule_invalid';end if;
  end if;
 end if;
 if public.faolla_attendance_operational_rule_object_v1(v,ks) is distinct from true or expected_command is distinct from p.command then raise exception 'attendance_operational_rule_invalid';end if;
 return v;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_operational_rule_invalid';
end;
$$;
create or replace function public.faolla_attendance_operational_rule_receipt_v1(p public.merchant_attendance_operational_rule_operations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
 perform public.faolla_attendance_operational_rule_item_v1(p);
 return jsonb_build_object('operationId',p.operation_id,'actorId',p.actor_auth_user_id,'scope',p.scope,'action',p.action,'revision',p.revision,
  'recordedAt',to_char(p.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',p.command_fingerprint);
end;
$$;
create or replace function public.faolla_attendance_operational_rule_preview_v1(p_site text,p_scope jsonb,p_head bigint,p_draft jsonb,p_day text,p_end text)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare info jsonb;refs jsonb;r jsonb;b timestamptz;e timestamptz;stamp timestamptz;
begin
 info:=public.faolla_attendance_operational_rule_context_v1(p_site,p_scope);
 if info->'usable' is distinct from 'true'::jsonb or info->'context' is distinct from p_draft->'context' then raise exception 'attendance_operational_rule_changed';end if;
 refs:=public.faolla_attendance_operational_rule_references_v1(p_site,p_scope,p_draft->'rules',info->'subject');
 if refs is distinct from p_draft->'references' then raise exception 'attendance_operational_rule_changed';end if;
 if exists(select 1 from jsonb_array_elements(refs->'locations') x where x->'active' is distinct from 'true'::jsonb)
  or exists(select 1 from jsonb_array_elements(refs->'routes') x where x->'active' is distinct from 'true'::jsonb) then raise exception 'attendance_operational_rule_changed';end if;
 if public.faolla_attendance_group_date_v1(p_day) is distinct from true or (p_scope->>'kind'='personal') is distinct from (p_end is not null)
  or p_end is not null and (public.faolla_attendance_group_date_v1(p_end) is distinct from true or p_end::date<p_day::date) then raise exception 'attendance_invalid_request';end if;
 b:=public.faolla_attendance_rule_day_start_v1(p_day,p_draft->'context'->>'timeZone');
 e:=case when p_end is not null then public.faolla_attendance_personal_rule_end_v1(p_end,p_draft->'context'->>'timeZone') else null end;
 stamp:=clock_timestamp();
 if b is null or p_day::date<=(stamp at time zone (p_draft->'context'->>'timeZone'))::date or b<=stamp
  or p_end is not null and (e is null or e<=b) then raise exception 'attendance_operational_rule_future_required';end if;
 r:=jsonb_build_object('kind','preview','scope',p_scope,'revision',p_head,'sourceDraftRevision',(p_draft->>'revision')::bigint,
  'context',p_draft->'context','rulesFingerprint',p_draft->'rulesFingerprint','references',refs,'referenceFingerprint',p_draft->'referenceFingerprint',
  'effectiveOn',p_day,'endsOn',p_end,'effectiveAt',to_char(b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'endsAt',to_char(e at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'applied',false);
 return r||jsonb_build_object('previewFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-publish-preview-v1',p_site,
  public.faolla_attendance_operational_rule_scope_v1(p_scope),p_head,(p_draft->>'revision')::bigint,r->>'rulesFingerprint',r->>'referenceFingerprint',p_day,p_end,r->>'effectiveAt',r->>'endsAt')));
end;
$$;

--Constant-size relation proofs: exact prior operation, exact saved draft and
--publication/withdrawal, never recursively replay the whole stream.
create or replace function public.faolla_attendance_operational_rule_check_v1(p_site text,p_key text,p_revision bigint)
returns void language plpgsql stable set search_path=pg_catalog as $$
declare o public.merchant_attendance_operational_rule_operations%rowtype;prev public.merchant_attendance_operational_rule_operations%rowtype;
 src public.merchant_attendance_operational_rule_operations%rowtype;wd public.merchant_attendance_operational_rule_operations%rowtype;
 h public.merchant_attendance_operational_rule_streams%rowtype;idx public.merchant_attendance_operational_rule_publications%rowtype;v jsonb;
 head_op public.merchant_attendance_operational_rule_operations%rowtype;first_op public.merchant_attendance_operational_rule_operations%rowtype;
begin
 select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p_site and x.stream_key=p_key and x.revision=p_revision;
 if o.operation_id is null then raise exception 'attendance_operational_rule_invalid';end if;v:=public.faolla_attendance_operational_rule_item_v1(o);
 select * into h from public.merchant_attendance_operational_rule_streams x where x.merchant_id=p_site and x.stream_key=p_key;
 if h.stream_key is null or h.scope is distinct from o.scope or o.revision>h.revision then raise exception 'attendance_operational_rule_invalid';end if;
 select * into head_op from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p_site and x.stream_key=p_key order by x.revision desc limit 1;
 select * into first_op from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p_site and x.stream_key=p_key and x.revision=1;
 if head_op.revision is distinct from h.revision or head_op.draft_revision_after is distinct from h.draft_revision or head_op.recorded_at is distinct from h.updated_at
  or first_op.action is distinct from 'save_draft' or first_op.recorded_at is distinct from h.created_at then raise exception 'attendance_operational_rule_invalid';end if;
 if o.revision=1 then
  if o.action<>'save_draft' or h.created_at is distinct from o.recorded_at then raise exception 'attendance_operational_rule_invalid';end if;
 else
  select * into prev from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p_site and x.stream_key=p_key and x.revision=o.revision-1;
  if prev.operation_id is null or prev.scope is distinct from o.scope or prev.recorded_at>o.recorded_at then raise exception 'attendance_operational_rule_invalid';end if;
  perform public.faolla_attendance_operational_rule_item_v1(prev);
 end if;
 if o.action='save_draft' then
  if o.draft_revision_after is distinct from o.revision then raise exception 'attendance_operational_rule_invalid';end if;
 elsif o.action='publish' then
  if o.draft_revision_after is not null or prev.draft_revision_after is distinct from (v->>'sourceDraftRevision')::bigint then raise exception 'attendance_operational_rule_invalid';end if;
  select * into src from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p_site and x.stream_key=p_key and x.revision=(v->>'sourceDraftRevision')::bigint;
  if src.action is distinct from 'save_draft' then raise exception 'attendance_operational_rule_invalid';end if;perform public.faolla_attendance_operational_rule_item_v1(src);
  if (v-array['scope','operationId','actorId','revision','reason','recordedAt','commandFingerprint','action','sourceDraftRevision','effectiveOn','endsOn','effectiveAt','endsAt','previewFingerprint'])
    is distinct from (src.item-array['scope','operationId','actorId','revision','reason','recordedAt','commandFingerprint','action']) then raise exception 'attendance_operational_rule_invalid';end if;
  select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=p_site and x.stream_key=p_key and x.published_revision=o.revision;
  if idx.operation_id is distinct from o.operation_id or idx.effective_at is distinct from (v->>'effectiveAt')::timestamptz or idx.ends_at is distinct from (v->>'endsAt')::timestamptz then raise exception 'attendance_operational_rule_invalid';end if;
  if idx.withdrawn_revision is not null then
   select * into wd from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p_site and x.stream_key=p_key and x.revision=idx.withdrawn_revision;
   if wd.action is distinct from 'withdraw' or (wd.item->>'publishedRevision')::bigint is distinct from o.revision or wd.recorded_at>=idx.effective_at then raise exception 'attendance_operational_rule_invalid';end if;perform public.faolla_attendance_operational_rule_item_v1(wd);
  end if;
 else
  if o.draft_revision_after is distinct from prev.draft_revision_after then raise exception 'attendance_operational_rule_invalid';end if;
  select * into src from public.merchant_attendance_operational_rule_operations x where x.merchant_id=p_site and x.stream_key=p_key and x.revision=(v->>'publishedRevision')::bigint;
  select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=p_site and x.stream_key=p_key and x.published_revision=(v->>'publishedRevision')::bigint;
  if src.action is distinct from 'publish' or idx.withdrawn_revision is distinct from o.revision or o.recorded_at>=idx.effective_at then raise exception 'attendance_operational_rule_invalid';end if;perform public.faolla_attendance_operational_rule_item_v1(src);
 end if;
end;
$$;
create or replace function public.faolla_attendance_operational_rule_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare o public.merchant_attendance_operational_rule_operations%rowtype;h public.merchant_attendance_operational_rule_streams%rowtype;first_op public.merchant_attendance_operational_rule_operations%rowtype;
 adjacent public.merchant_attendance_operational_rule_publications%rowtype;
begin
 if TG_WHEN='BEFORE' then
  if TG_TABLE_NAME='merchant_attendance_operational_rule_streams' then
   if TG_OP='DELETE' or TG_OP='UPDATE' and ((to_jsonb(new)-array['revision','draft_revision','updated_at']) is distinct from (to_jsonb(old)-array['revision','draft_revision','updated_at']) or new.revision<>old.revision+1) then raise exception 'attendance_operational_rule_invalid';end if;
   select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=new.merchant_id and x.stream_key=new.stream_key and x.revision=new.revision;
   if o.operation_id is null or new.draft_revision is distinct from o.draft_revision_after or new.updated_at is distinct from o.recorded_at then raise exception 'attendance_operational_rule_invalid';end if;
  else
   if TG_OP='DELETE' or TG_OP='UPDATE' and ((to_jsonb(new)-'withdrawn_revision') is distinct from (to_jsonb(old)-'withdrawn_revision') or old.withdrawn_revision is not null or new.withdrawn_revision is null) then raise exception 'attendance_operational_rule_invalid';end if;
   if TG_OP='INSERT' and new.withdrawn_revision is not null then raise exception 'attendance_operational_rule_invalid';end if;
   select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=new.merchant_id and x.stream_key=new.stream_key and x.revision=case when TG_OP='INSERT' then new.published_revision else new.withdrawn_revision end;
   if o.operation_id is null or TG_OP='INSERT' and (o.action<>'publish' or o.operation_id<>new.operation_id or (o.item->>'effectiveAt')::timestamptz is distinct from new.effective_at or (o.item->>'endsAt')::timestamptz is distinct from new.ends_at)
    or TG_OP='UPDATE' and (o.action<>'withdraw' or (o.item->>'publishedRevision')::bigint<>new.published_revision or o.recorded_at>=new.effective_at) then raise exception 'attendance_operational_rule_invalid';end if;
   if TG_OP='INSERT' then
    if o.scope->>'kind'='personal' then
     select * into adjacent from public.merchant_attendance_operational_rule_publications x where x.merchant_id=new.merchant_id and x.stream_key=new.stream_key and x.withdrawn_revision is null and x.effective_at<=new.effective_at order by x.effective_at desc,x.published_revision desc limit 1;
     if adjacent.operation_id is not null and adjacent.ends_at>new.effective_at then raise exception 'attendance_operational_rule_overlap';end if;
     select * into adjacent from public.merchant_attendance_operational_rule_publications x where x.merchant_id=new.merchant_id and x.stream_key=new.stream_key and x.withdrawn_revision is null and x.effective_at>=new.effective_at order by x.effective_at,x.published_revision limit 1;
     if adjacent.operation_id is not null and adjacent.effective_at<new.ends_at then raise exception 'attendance_operational_rule_overlap';end if;
    else
     select * into adjacent from public.merchant_attendance_operational_rule_publications x where x.merchant_id=new.merchant_id and x.stream_key=new.stream_key and x.withdrawn_revision is null order by x.effective_at desc,x.published_revision desc limit 1;
     if adjacent.operation_id is not null and adjacent.effective_at>=new.effective_at then raise exception 'attendance_operational_rule_overlap';end if;
    end if;
   end if;
  end if;
  perform public.faolla_attendance_operational_rule_item_v1(o);return new;
 end if;
 --Every deferred event rechecks its own immutable operation, and the final head.
 if TG_TABLE_NAME='merchant_attendance_operational_rule_operations' then
  perform public.faolla_attendance_operational_rule_check_v1(new.merchant_id,new.stream_key,new.revision);
 elsif TG_TABLE_NAME='merchant_attendance_operational_rule_publications' then
  perform public.faolla_attendance_operational_rule_check_v1(new.merchant_id,new.stream_key,new.published_revision);
 end if;
 select * into h from public.merchant_attendance_operational_rule_streams x where x.merchant_id=new.merchant_id and x.stream_key=new.stream_key;
 select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=new.merchant_id and x.stream_key=new.stream_key order by x.revision desc limit 1;
 select * into first_op from public.merchant_attendance_operational_rule_operations x where x.merchant_id=new.merchant_id and x.stream_key=new.stream_key and x.revision=1;
 if h.stream_key is null or o.operation_id is null or first_op.operation_id is null or h.scope is distinct from o.scope or h.revision is distinct from o.revision
  or h.draft_revision is distinct from o.draft_revision_after or h.updated_at is distinct from o.recorded_at or h.created_at is distinct from first_op.recorded_at then raise exception 'attendance_operational_rule_invalid';end if;
 perform public.faolla_attendance_operational_rule_check_v1(h.merchant_id,h.stream_key,h.revision);return new;
end;
$$;

create or replace function public.faolla_attendance_operational_rules_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;scope_value jsonb;key_value text;op uuid;action_name text;current_rev bigint:=0;at_rev bigint;before_rev bigint;next_rev bigint;
 h public.merchant_attendance_operational_rule_streams%rowtype;o public.merchant_attendance_operational_rule_operations%rowtype;draft_op public.merchant_attendance_operational_rule_operations%rowtype;
 target public.merchant_attendance_operational_rule_operations%rowtype;entry public.merchant_attendance_operational_rule_operations%rowtype;idx public.merchant_attendance_operational_rule_publications%rowtype;
 s public.merchant_attendance_settings%rowtype;m public.merchants%rowtype;w record;e record;
 info jsonb;refs jsonb;data_value jsonb;receipt_value jsonb;preview_value jsonb;current_value jsonb;next_value jsonb;draft_value jsonb;items jsonb:='[]';cursor_value jsonb;count_seen integer:=0;last_rev bigint;withdrawn bigint;
 stamp timestamptz;read_stamp timestamptz;can_write boolean:=false;tuple_value jsonb;fp text;v jsonb;catalog_name text;after_id uuid;last_id uuid;after_scope_key text;last_scope jsonb;
begin
 if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>8192
  or jsonb_typeof(p_query->'siteId') is distinct from 'string' or char_length(p_query->>'siteId')<>8 or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$' then raise exception 'attendance_invalid_request';end if;
 site:=p_query->>'siteId';mode_name:=p_query->>'mode';scope_value:=p_query->'scope';
 if mode_name='recover' then
  if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','operationId']) is distinct from true
   or public.faolla_attendance_operational_rule_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
 elsif mode_name='catalog' then
  if p_command is not null then raise exception 'attendance_invalid_request';end if;catalog_name:=p_query->>'catalog';
  if catalog_name in('workers','routes') then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','catalog','afterId']) is distinct from true
    or p_query->'afterId' is distinct from 'null'::jsonb and public.faolla_attendance_operational_rule_scalar_v1(p_query->'afterId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;after_id:=(p_query->>'afterId')::uuid;
  elsif catalog_name='saved_personal' then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','catalog','afterScope']) is distinct from true then raise exception 'attendance_invalid_request';end if;
   if p_query->'afterScope' is distinct from 'null'::jsonb then
    if p_query->'afterScope'->>'kind' is distinct from 'personal' then raise exception 'attendance_invalid_request';end if;after_scope_key:=public.faolla_attendance_operational_rule_scope_v1(p_query->'afterScope')::text;
   end if;
  else raise exception 'attendance_invalid_request';end if;
 else
  key_value:=public.faolla_attendance_operational_rule_scope_v1(scope_value)::text;
  if mode_name='detail' then
   if public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope']) is distinct from true then raise exception 'attendance_invalid_request';end if;
  elsif mode_name='history' then
   if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope','cursor']) is distinct from true then raise exception 'attendance_invalid_request';end if;
   cursor_value:=p_query->'cursor';
   if cursor_value is distinct from 'null'::jsonb then
    if public.faolla_attendance_operational_rule_object_v1(cursor_value,array['siteId','scope','atRevision','beforeRevision']) is distinct from true
     or cursor_value->>'siteId' is distinct from site or cursor_value->'scope' is distinct from scope_value
     or public.faolla_attendance_operational_rule_scalar_v1(cursor_value->'atRevision','positive') is distinct from true
     or public.faolla_attendance_operational_rule_scalar_v1(cursor_value->'beforeRevision','positive') is distinct from true then raise exception 'attendance_invalid_request';end if;
    at_rev:=(cursor_value->>'atRevision')::bigint;before_rev:=(cursor_value->>'beforeRevision')::bigint;
    if before_rev<=1 or before_rev>at_rev then raise exception 'attendance_invalid_request';end if;
   end if;
  elsif mode_name='preview' then
   if p_command is not null or public.faolla_attendance_operational_rule_object_v1(p_query,array['siteId','mode','scope','sourceDraftRevision','effectiveOn','endsOn']) is distinct from true
    or public.faolla_attendance_operational_rule_scalar_v1(p_query->'sourceDraftRevision','positive') is distinct from true
    or jsonb_typeof(p_query->'effectiveOn') is distinct from 'string' or jsonb_typeof(p_query->'endsOn') not in('null','string') then raise exception 'attendance_invalid_request';end if;
  else raise exception 'attendance_invalid_request';end if;
 end if;
 if p_command is not null then
  tuple_value:=public.faolla_attendance_operational_rule_command_v1(p_command);
  if mode_name<>'detail' or p_command->>'siteId' is distinct from site or p_command->'scope' is distinct from scope_value then raise exception 'attendance_invalid_request';end if;
  op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
 end if;

 --Known-operation GET is deliberately independent of current ownership/binding.
 --It returns only this actual actor's minimal immutable receipt; no source read.
 select * into m from public.merchants x where x.id=site for share;
 if m.id is null or mode_name<>'recover' and m.user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
 if mode_name='recover' then
  select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=op;
  if o.operation_id is not null then
   if o.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(o);
  end if;data_value:=jsonb_build_object('kind','receipt');
 else
  if p_command is null then select * into s from public.merchant_attendance_settings x where x.merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  if op is not null then
   select * into o from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=op;
   if o.operation_id is not null then
    if o.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
    if o.scope is distinct from scope_value or o.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
    receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(o);data_value:=jsonb_build_object('kind','receipt');
   end if;
  end if;
  if data_value is null and mode_name='catalog' then
   if catalog_name='workers' then
    for w in select x.id,x.display_name,e2.id employee_id,e2.auth_user_id from public.merchant_attendance_workers x
     join public.merchant_enterprise_employees e2 on e2.merchant_id=x.merchant_id and e2.id=x.employee_id
     where x.merchant_id=site and x.active and e2.status='active' and e2.auth_user_id is not null and (after_id is null or x.id>after_id) order by x.id limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if w.display_name is null or char_length(w.display_name) not between 1 and 120 or w.display_name~'[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_operational_rule_invalid';end if;
     items:=items||jsonb_build_array(jsonb_build_object('workerId',w.id,'workerName',w.display_name,'employeeId',w.employee_id,'employeeAuthUserId',w.auth_user_id));last_id:=w.id;
    end loop;
   elsif catalog_name='routes' then
    for e in select x.id,x.display_name,x.auth_user_id from public.merchant_enterprise_employees x where x.merchant_id=site and x.status='active' and x.auth_user_id is not null
     and (after_id is null or x.id>after_id) order by x.id limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if e.display_name is null or char_length(e.display_name) not between 1 and 120 or e.display_name~'[[:cntrl:]\u007f-\u009f]' then raise exception 'attendance_operational_rule_invalid';end if;
     items:=items||jsonb_build_array(jsonb_build_object('employeeId',e.id,'employeeName',e.display_name,'employeeAuthUserId',e.auth_user_id));last_id:=e.id;
    end loop;
   else
    for h in select x.* from public.merchant_attendance_operational_rule_streams x where x.merchant_id=site and x.scope->>'kind'='personal'
     and (after_scope_key is null or x.stream_key collate "C">after_scope_key collate "C") order by x.stream_key collate "C" limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;perform public.faolla_attendance_operational_rule_check_v1(site,h.stream_key,h.revision);
     items:=items||jsonb_build_array(jsonb_build_object('scope',h.scope,'revision',h.revision,'updatedAt',to_char(h.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));last_scope:=h.scope;
    end loop;
   end if;
   data_value:=jsonb_build_object('kind','catalog','catalog',catalog_name,'items',items)||case when catalog_name='saved_personal' then jsonb_build_object('nextScope',case when count_seen=26 then last_scope else null end)
    else jsonb_build_object('nextId',case when count_seen=26 then last_id else null end) end;
  elsif data_value is null then
   select * into h from public.merchant_attendance_operational_rule_streams x where x.merchant_id=site and x.stream_key=key_value;
   if h.stream_key is not null then
    current_rev:=h.revision;perform public.faolla_attendance_operational_rule_check_v1(site,key_value,current_rev);
    if h.draft_revision is not null then
     select * into draft_op from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision=h.draft_revision;
     if draft_op.action is distinct from 'save_draft' then raise exception 'attendance_operational_rule_invalid';end if;draft_value:=public.faolla_attendance_operational_rule_item_v1(draft_op);
    end if;
   end if;
   if p_command is not null then
    if (p_command->>'expectedRevision')::bigint<>current_rev then raise exception 'attendance_operational_rule_changed';end if;
    if current_rev>=9007199254740990 then raise exception 'attendance_operational_rule_limit';end if;next_rev:=current_rev+1;
    if action_name in('save_draft','publish') then
     if not p_allow_write then raise exception 'attendance_operational_rule_disabled';end if;
     info:=public.faolla_attendance_operational_rule_context_v1(site,scope_value);
     if info->'usable' is distinct from 'true'::jsonb then raise exception 'attendance_operational_rule_changed';end if;
     if action_name='save_draft' then
      if info->'context' is distinct from p_command->'expectedContext' then raise exception 'attendance_operational_rule_changed';end if;
      refs:=public.faolla_attendance_operational_rule_references_v1(site,scope_value,p_command->'rules',info->'subject');
     else
      if draft_value is null or h.draft_revision is distinct from (p_command->>'sourceDraftRevision')::bigint then raise exception 'attendance_operational_rule_changed';end if;
      preview_value:=public.faolla_attendance_operational_rule_preview_v1(site,scope_value,current_rev,draft_value,p_command->>'effectiveOn',p_command->>'endsOn');
      if preview_value->>'previewFingerprint' is distinct from p_command->>'previewFingerprint' then raise exception 'attendance_operational_rule_changed';end if;
      --Enterprise/group increasing starts; personal arbitrary non-overlapping
      --finite windows use only the two indexed neighbours, not all history.
      if scope_value->>'kind'='personal' then
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at<=(preview_value->>'effectiveAt')::timestamptz order by x.effective_at desc,x.published_revision desc limit 1;
       if idx.operation_id is not null and idx.ends_at>(preview_value->>'effectiveAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at>=(preview_value->>'effectiveAt')::timestamptz order by x.effective_at,x.published_revision limit 1;
       if idx.operation_id is not null and idx.effective_at<(preview_value->>'endsAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
      else
       select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null order by x.effective_at desc,x.published_revision desc limit 1;
       if idx.operation_id is not null and idx.effective_at>=(preview_value->>'effectiveAt')::timestamptz then raise exception 'attendance_operational_rule_overlap';end if;
      end if;
     end if;
    else
     select * into target from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision=(p_command->>'publishedRevision')::bigint;
     if target.action is distinct from 'publish' then raise exception 'attendance_operational_rule_not_found';end if;perform public.faolla_attendance_operational_rule_check_v1(site,key_value,target.revision);
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.published_revision=target.revision;
     if idx.withdrawn_revision is not null then raise exception 'attendance_operational_rule_changed';end if;
    end if;
    stamp:=clock_timestamp();
    if h.updated_at is not null and stamp<h.updated_at then raise exception 'attendance_operational_rule_invalid';end if;
    if action_name='publish' and ((preview_value->>'effectiveAt')::timestamptz<=stamp or (preview_value->>'effectiveOn')::date<=(stamp at time zone (draft_value->'context'->>'timeZone'))::date)
     or action_name='withdraw' and stamp>=idx.effective_at then raise exception 'attendance_operational_rule_future_required';end if;
    fp:=public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-command-v1',p_auth_user_id::text,tuple_value));
    v:=jsonb_build_object('scope',scope_value,'operationId',op,'actorId',p_auth_user_id,'revision',next_rev,'action',action_name,'reason',p_command->>'reason',
     'recordedAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'commandFingerprint',fp);
    if action_name='save_draft' then
     v:=v||jsonb_build_object('context',info->'context','rules',p_command->'rules','references',refs,
      'rulesFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-values-v1',public.faolla_attendance_operational_rule_values_v1(p_command->'rules'))),
      'referenceFingerprint',public.faolla_attendance_operational_rule_hash_v1(jsonb_build_array('attendance-operational-rule-references-v1',site,public.faolla_attendance_operational_rule_scope_v1(scope_value),
       public.faolla_attendance_operational_rule_context_tuple_v1(info->'context',scope_value),public.faolla_attendance_operational_rule_references_tuple_v1(refs,scope_value,p_command->'rules'))));
    elsif action_name='publish' then
     v:=v||(preview_value-array['kind','scope','revision','applied'])||jsonb_build_object('rules',draft_value->'rules');
    else v:=v||jsonb_build_object('publishedRevision',target.revision);end if;
    entry.merchant_id:=site;entry.stream_key:=key_value;entry.scope:=scope_value;entry.operation_id:=op;entry.revision:=next_rev;entry.actor_auth_user_id:=p_auth_user_id;
    entry.action:=action_name;entry.command:=p_command;entry.command_fingerprint:=fp;entry.item:=v;entry.recorded_at:=stamp;
    entry.draft_revision_after:=case when action_name='save_draft' then next_rev when action_name='withdraw' then h.draft_revision else null end;
    perform public.faolla_attendance_operational_rule_item_v1(entry);
    insert into public.merchant_attendance_operational_rule_operations select entry.*;
    if h.stream_key is null then
     insert into public.merchant_attendance_operational_rule_streams(merchant_id,stream_key,scope,revision,draft_revision,created_at,updated_at) values(site,key_value,scope_value,next_rev,entry.draft_revision_after,stamp,stamp);
    else
     update public.merchant_attendance_operational_rule_streams set revision=next_rev,draft_revision=entry.draft_revision_after,updated_at=stamp where merchant_id=site and stream_key=key_value;
    end if;
    if action_name='publish' then
     insert into public.merchant_attendance_operational_rule_publications(merchant_id,stream_key,published_revision,operation_id,effective_at,ends_at) values(site,key_value,next_rev,op,(v->>'effectiveAt')::timestamptz,(v->>'endsAt')::timestamptz);
    elsif action_name='withdraw' then
     update public.merchant_attendance_operational_rule_publications set withdrawn_revision=next_rev where merchant_id=site and stream_key=key_value and published_revision=target.revision;
    end if;
    perform public.faolla_attendance_operational_rule_check_v1(site,key_value,next_rev);
    receipt_value:=public.faolla_attendance_operational_rule_receipt_v1(entry);data_value:=jsonb_build_object('kind','receipt');
   elsif mode_name='history' then
    if at_rev is null then at_rev:=current_rev;elsif at_rev>current_rev then raise exception 'attendance_invalid_request';end if;
    for entry in select x.* from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.stream_key=key_value and x.revision<=at_rev
     and (before_rev is null or x.revision<before_rev) order by x.revision desc limit 26 loop
     count_seen:=count_seen+1;exit when count_seen=26;
     if entry.revision is distinct from (case when count_seen=1 then least(at_rev,coalesce(before_rev-1,at_rev)) else last_rev-1 end) then raise exception 'attendance_operational_rule_invalid';end if;
     perform public.faolla_attendance_operational_rule_check_v1(site,key_value,entry.revision);withdrawn:=null;
     if entry.action='publish' then
      select x.withdrawn_revision into withdrawn from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.published_revision=entry.revision;
      if withdrawn>at_rev then withdrawn:=null;end if;
     end if;
     items:=items||jsonb_build_array(jsonb_build_object('item',entry.item,'withdrawnByRevision',withdrawn));last_rev:=entry.revision;
    end loop;
    if count_seen<26 and (at_rev>0 and last_rev is distinct from 1) then raise exception 'attendance_operational_rule_invalid';end if;
    data_value:=jsonb_build_object('kind','history','scope',scope_value,'atRevision',at_rev,'items',items,'nextCursor',
     case when count_seen=26 then jsonb_build_object('siteId',site,'scope',scope_value,'atRevision',at_rev,'beforeRevision',last_rev) else null end);
   else
    info:=public.faolla_attendance_operational_rule_context_v1(site,scope_value);
    if h.stream_key is null and info->'context'='null'::jsonb then raise exception 'attendance_operational_rule_not_found';end if;
    can_write:=p_allow_write and info->'usable'='true'::jsonb and current_rev<9007199254740990;
    if mode_name='preview' then
     if not p_allow_write then raise exception 'attendance_operational_rule_disabled';end if;
     if draft_value is null or h.draft_revision is distinct from (p_query->>'sourceDraftRevision')::bigint then raise exception 'attendance_operational_rule_changed';end if;
     data_value:=public.faolla_attendance_operational_rule_preview_v1(site,scope_value,current_rev,draft_value,p_query->>'effectiveOn',p_query->>'endsOn');
    else
     read_stamp:=clock_timestamp();
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at<=read_stamp order by x.effective_at desc,x.published_revision desc limit 1;
     if idx.operation_id is not null and (idx.ends_at is null or idx.ends_at>read_stamp) then
      perform public.faolla_attendance_operational_rule_check_v1(site,key_value,idx.published_revision);
      select x.item into current_value from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=idx.operation_id;
     end if;
     select * into idx from public.merchant_attendance_operational_rule_publications x where x.merchant_id=site and x.stream_key=key_value and x.withdrawn_revision is null and x.effective_at>read_stamp order by x.effective_at,x.published_revision limit 1;
     if idx.operation_id is not null then
      perform public.faolla_attendance_operational_rule_check_v1(site,key_value,idx.published_revision);
      select x.item into next_value from public.merchant_attendance_operational_rule_operations x where x.merchant_id=site and x.operation_id=idx.operation_id;
     end if;
     data_value:=jsonb_build_object('kind','detail','scope',scope_value,'revision',current_rev,'context',info->'context','draft',draft_value,'currentPublication',current_value,'nextPublication',next_value,'canWithdraw',next_value is not null and current_rev<9007199254740990);
    end if;
   end if;
  end if;
 end if;
 read_stamp:=coalesce(read_stamp,clock_timestamp());
 v:=jsonb_build_object('protocol','attendance-operational-rule-ledger-v1','siteId',site,'actorId',p_auth_user_id,'readAt',to_char(read_stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'canWrite',can_write,'data',data_value,'receipt',receipt_value);
 if octet_length(convert_to(v::text,'UTF8'))>262144 then raise exception 'attendance_operational_rule_too_large';end if;return v;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_parameter_value then raise exception 'attendance_invalid_request';
end;
$$;
-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_operational_rule_streams'::regclass,
      'public.merchant_attendance_operational_rule_operations'::regclass,
      'public.merchant_attendance_operational_rule_publications'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $operational_security$
declare n text;t regclass;f regprocedure;
begin
 foreach n in array array['merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'] loop
  t:=to_regclass('public.'||n);
  execute format('alter table %s enable row level security',t);
  execute format('revoke all on %s from public,anon,authenticated,service_role',t);
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_no_truncate') then
   execute format('create trigger operational_rule_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  if n='merchant_attendance_operational_rule_operations' then
   if not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_immutable') then
    execute format('create trigger operational_rule_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
   if not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_proof') then
    execute format('create constraint trigger operational_rule_proof after insert on %s deferrable initially deferred for each row execute function public.faolla_attendance_operational_rule_guard_v1()',t);end if;
  else
   if not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_shape') then
    execute format('create trigger operational_rule_shape before insert or update or delete on %s for each row execute function public.faolla_attendance_operational_rule_guard_v1()',t);end if;
   if not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_proof') then
    execute format('create constraint trigger operational_rule_proof after insert or update on %s deferrable initially deferred for each row execute function public.faolla_attendance_operational_rule_guard_v1()',t);end if;
  end if;
 end loop;
 for f in select p.oid::regprocedure from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_operational_rule_streams'::regclass)
  and p.proname in('faolla_attendance_operational_rule_object_v1','faolla_attendance_operational_rule_scalar_v1','faolla_attendance_operational_rule_scope_v1',
   'faolla_attendance_operational_rule_context_tuple_v1','faolla_attendance_operational_rule_values_v1','faolla_attendance_operational_rule_command_v1','faolla_attendance_operational_rule_hash_v1',
   'faolla_attendance_operational_rule_context_v1','faolla_attendance_operational_rule_references_v1','faolla_attendance_operational_rule_references_tuple_v1',
   'faolla_attendance_operational_rule_item_v1','faolla_attendance_operational_rule_receipt_v1','faolla_attendance_operational_rule_preview_v1','faolla_attendance_operational_rule_check_v1',
   'faolla_attendance_operational_rule_guard_v1','faolla_attendance_operational_rules_v1') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end;
$operational_security$;
grant execute on function public.faolla_attendance_operational_rules_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $operational_postconditions$
declare installed boolean;n text;t regclass;f regprocedure;entry_value record;metadata record;expected_owner oid;ns text;role_name text;is_op boolean;idx oid;
begin
 select exists(select 1 from public.faolla_schema_migrations where version=202610080191 and name='merchant_attendance_operational_rules') into installed;

 select p.proowner into expected_owner from pg_proc p where p.oid='public.faolla_attendance_group_text_v1(text,integer,integer)'::regprocedure;
 select nspname into ns from pg_namespace where oid=(select relnamespace from pg_class where oid='public.merchant_attendance_operational_rule_streams'::regclass);
 for entry_value in select * from (values
  ('public.faolla_attendance_operational_rule_object_v1(jsonb,text[])','c2424b9408e816d4f5aee7b271d4e91ea6faf10c7643a940223a1d3896e56ca7','boolean','i','sql',false),
  ('public.faolla_attendance_operational_rule_scalar_v1(jsonb,text)','99d575e267fe9ec7b8f56dbe92ac412405913695ae3a3085dc1a035c33614fce','boolean','i','plpgsql',false),
  ('public.faolla_attendance_operational_rule_scope_v1(jsonb)','9e323d5672d38255e4f92bc2b0d5f0dd4e6190cbe04b7773bc80e40618f57275','jsonb','i','plpgsql',false),
  ('public.faolla_attendance_operational_rule_context_tuple_v1(jsonb,jsonb)','e0bc60a2402351503edb4ea94cd1791b95644c3f098af0aaefeac253c8264179','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_values_v1(jsonb)','ff59e8fceee61f8a60694614de50200e48f3e51ffb3d355e73d8f18f22af012b','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_command_v1(jsonb)','ba2f97fd74fac4343a513b6edf5c9faa34f44c89108908e7e411759b4fa6b5f1','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_hash_v1(jsonb)','fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7','text','i','sql',false),
  ('public.faolla_attendance_operational_rule_context_v1(text,jsonb)','0ffee88bfc9457553cdf5c17caeac906833d5fba986275facd2bb38fcedfdee3','jsonb','v','plpgsql',false),
  ('public.faolla_attendance_operational_rule_references_v1(text,jsonb,jsonb,jsonb)','68ca4f0221d201560dde8ec88f9552e1423364dfdf717cfb1a9ea09882237dd5','jsonb','v','plpgsql',false),
  ('public.faolla_attendance_operational_rule_references_tuple_v1(jsonb,jsonb,jsonb)','642dd54d586411b6ac0aa435ad0ad53630eb2a5ed7a74d0559248bf942795a26','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_item_v1(public.merchant_attendance_operational_rule_operations)','6fbb4c8e283366e526e208fae0b53dc41110161bdfd99e0af196a050c2448396','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_receipt_v1(public.merchant_attendance_operational_rule_operations)','1e37a768f3b5e265dc195ea509c3395e00825495265c433a241b1be1203d5669','jsonb','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_preview_v1(text,jsonb,bigint,jsonb,text,text)','073fd2f8d00e73d2685a4cd521ff3f429d7ba0b91414289f1a405c7d9e310535','jsonb','v','plpgsql',false),
  ('public.faolla_attendance_operational_rule_check_v1(text,text,bigint)','25809b0d345f18bc1558029cf1a1063285744d7b89d76b3e34462231542d7fc8','void','s','plpgsql',false),
  ('public.faolla_attendance_operational_rule_guard_v1()','5d10e43cc5b6e25a9d1872f4084389e32e831c664e08ef479d912ea9fcc36535','trigger','v','plpgsql',false),
  ('public.faolla_attendance_operational_rules_v1(jsonb,uuid,jsonb,boolean)','c729c0c16e81c29dec02e7f78ebc77d4a2c7f4b3448724f6c5064a3f771ef7fb','jsonb','v','plpgsql',true)
 ) expected(signature,source_hash,return_type,volatility,language_name,is_rpc) loop
  f:=to_regprocedure(entry_value.signature);
  select p.*,l.lanname into metadata from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=f;
  if f is null or metadata.proowner is distinct from expected_owner or metadata.prosecdef is distinct from (entry_value.is_rpc or f='public.faolla_attendance_operational_rule_guard_v1()'::regprocedure)
   or metadata.proconfig is distinct from array['search_path=pg_catalog'] or metadata.provolatile::text is distinct from entry_value.volatility
   or metadata.lanname is distinct from entry_value.language_name or metadata.prorettype is distinct from to_regtype(entry_value.return_type)
   or metadata.proretset or metadata.proisstrict or metadata.proleakproof
   or encode(sha256(convert_to(replace(replace(metadata.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from entry_value.source_hash
   or exists(select 1 from aclexplode(coalesce(metadata.proacl,acldefault('f',metadata.proowner))) a where a.grantor<>expected_owner
    or a.grantee<>expected_owner and (not entry_value.is_rpc or a.grantee<>(select oid from pg_roles where rolname='service_role') or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from entry_value.is_rpc
  then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns)
   and (proname like 'faolla_attendance_operational_rule_%' or proname='faolla_attendance_operational_rules_v1'))<>16 then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
 foreach n in array array['merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'] loop
  t:=to_regclass('public.'||n);is_op:=n='merchant_attendance_operational_rule_operations';
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or exists(select 1 from pg_constraint where conrelid=t and not convalidated)
   or (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_no_truncate' and tgtype=34 and tgenabled='O'
    and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and tgnargs=0 and tgqual is null)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname=case when is_op then 'operational_rule_immutable' else 'operational_rule_shape' end
    and tgtype=case when is_op then 27 else 31 end and tgenabled='O' and tgnargs=0 and tgqual is null
    and tgfoid=case when is_op then 'public.faolla_attendance_events_append_only_v1()'::regprocedure else 'public.faolla_attendance_operational_rule_guard_v1()'::regprocedure end)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='operational_rule_proof' and tgtype=case when is_op then 5 else 21 end and tgenabled='O'
    and tgdeferrable and tginitdeferred and tgconstraint<>0 and tgnargs=0 and tgqual is null and tgfoid='public.faolla_attendance_operational_rule_guard_v1()'::regprocedure)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantor<>expected_owner or a.grantee<>expected_owner))
   or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_operational_rules_installation_conflict';end if;
  end loop;
 end loop;
 foreach n in array array['attendance_operational_rule_effective_idx','attendance_operational_rule_unique_time_idx','attendance_operational_rule_personal_catalog_idx'] loop
  idx:=to_regclass('public.'||n);
  if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam
   where i.indexrelid=idx and i.indisvalid and i.indisready and i.indislive and not i.indisexclusion and a.amname='btree'
    and i.indnkeyatts=case when n='attendance_operational_rule_effective_idx' then 4 else 3 end and i.indnatts=i.indnkeyatts
    and i.indisunique=(n='attendance_operational_rule_unique_time_idx')
    and i.indrelid=case when n='attendance_operational_rule_personal_catalog_idx' then 'public.merchant_attendance_operational_rule_streams'::regclass else 'public.merchant_attendance_operational_rule_publications'::regclass end
    and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[0])='merchant_id'
    and i.indoption[0]=0
    and (case when n='attendance_operational_rule_personal_catalog_idx' then
      i.indkey[1]=0 and pg_get_expr(i.indexprs,i.indrelid)='(scope ->> ''kind''::text)' and i.indpred is null
      and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[2])='stream_key'
      and i.indcollation[2]='pg_catalog."C"'::regcollation and i.indoption[1]=0 and i.indoption[2]=0
     else i.indexprs is null and pg_get_expr(i.indpred,i.indrelid)='(withdrawn_revision IS NULL)'
      and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[1])='stream_key'
      and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[2])='effective_at' and i.indoption[1]=0
      and i.indoption[2]=case when n='attendance_operational_rule_effective_idx' then 3 else 0 end
      and (n<>'attendance_operational_rule_effective_idx' or (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[3])='published_revision' and i.indoption[3]=3)
     end))
  then raise exception 'merchant_attendance_operational_rules_index_conflict';end if;
 end loop;
end;
$operational_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610080191,'merchant_attendance_operational_rules') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
