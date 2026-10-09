-- C04-B local candidate. Administrative continuity, never a synthetic clock-out.
-- New ledger/operating boundary plus exact, hash-pinned forward compatibility.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $administrative_preflight$
declare spec jsonb;fn record;ns text;is_rpc boolean;installed boolean;expected_names text[];t regclass;object_name text;
begin
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.faolla_schema_migrations'::regclass;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure') into installed;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name<>'merchant_attendance_administrative_closure') then raise exception 'merchant_attendance_administrative_closure_installation_conflict';end if;
 for spec in select value from jsonb_array_elements('[{"version":202610060166,"name":"merchant_attendance_employment_lifecycle"},{"version":202610080183,"name":"merchant_attendance_period_continuation"},{"version":202610080184,"name":"merchant_attendance_period_delegated_source"},{"version":202610080186,"name":"merchant_attendance_period_delegated_artifacts"},{"version":202610080191,"name":"merchant_attendance_operational_rules"},{"version":202610080193,"name":"merchant_attendance_operational_punch"}]'::jsonb) loop
  if not exists(select 1 from public.faolla_schema_migrations where version=(spec->>'version')::bigint and name=spec->>'name') then raise exception 'merchant_attendance_administrative_closure_prerequisite_required';end if;
 end loop;
 foreach object_name in array array['merchant_attendance_administrative_closures','merchant_attendance_administrative_closure_entries'] loop
  t:=to_regclass(format('%I.%I',ns,object_name));
  if installed<>(t is not null) then raise exception 'merchant_attendance_administrative_closure_installation_conflict';end if;
  if installed and (not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=(select oid from pg_roles where rolname=current_user) and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where c.oid=t and (acl.grantee<>c.relowner or acl.grantor<>c.relowner))
   or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and (acl.grantee<>(select oid from pg_roles where rolname=current_user) or acl.grantor<>(select oid from pg_roles where rolname=current_user)))) then raise exception 'merchant_attendance_administrative_closure_installation_conflict';end if;
 end loop;
 expected_names:=array['faolla_attendance_administrative_scalar_v1','faolla_attendance_administrative_stamp_v1','faolla_attendance_administrative_scope_v1','faolla_attendance_administrative_frame_v1','faolla_attendance_administrative_context_v1','faolla_attendance_administrative_command_v1','faolla_attendance_administrative_hash_v1','faolla_attendance_administrative_event_v1','faolla_attendance_administrative_pause_v1','faolla_attendance_administrative_source_v1','faolla_attendance_administrative_receipt_v1','faolla_attendance_administrative_entry_v1','faolla_attendance_administrative_boundary_v1','faolla_attendance_administrative_current_v1','faolla_attendance_operating_head_v1','faolla_attendance_administrative_predecessor_v1','faolla_attendance_administrative_summary_v1','faolla_attendance_administrative_guard_v1','faolla_attendance_administrative_closures_v1','faolla_attendance_administrative_report_boundary_v1','faolla_attendance_administrative_current_field_v1','faolla_attendance_administrative_restore_v1','faolla_attendance_administrative_report_v1','faolla_attendance_administrative_source_result_v1','faolla_attendance_administrative_saved_source_v1'];
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns)
  and (left(proname,length('faolla_attendance_administrative_'))='faolla_attendance_administrative_' or proname='faolla_attendance_operating_head_v1'))<>(case when installed then 25 else 0 end) then raise exception 'merchant_attendance_administrative_closure_installation_conflict';end if;
 if not installed then return;end if;
 for spec in select value from jsonb_array_elements($administrative_new_before$
[
  {
    "name": "faolla_attendance_administrative_scalar_v1",
    "types": "jsonb,text",
    "argumentNames": [
      "p",
      "k"
    ],
    "defaults": 0,
    "resultType": "boolean",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "814c0a864d7b7383eaf12f06c374ca8440be70c5b1edb5781e665130217ad295"
  },
  {
    "name": "faolla_attendance_administrative_stamp_v1",
    "types": "timestamptz",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "text",
    "volatility": "i",
    "language": "sql",
    "securityDefiner": false,
    "hash": "6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2"
  },
  {
    "name": "faolla_attendance_administrative_scope_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "cced0de14b5545e78c9587eec063cd70e49a318259306624f388bb5065004013"
  },
  {
    "name": "faolla_attendance_administrative_frame_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "b1db19c72584d4f0617a0ac53f425f88e5ee9cae7f4e1600953d2f8adafea03f"
  },
  {
    "name": "faolla_attendance_administrative_context_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "boolean",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "6770c4f42f603523da703e91c080dd350dc074707142506e1e3982050a6ce8b1"
  },
  {
    "name": "faolla_attendance_administrative_command_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "c5ee520a78337d3fb2571743fd4ebf0e56c7abc9e529632731a0486ea7379187"
  },
  {
    "name": "faolla_attendance_administrative_hash_v1",
    "types": "text,uuid,text,jsonb",
    "argumentNames": [
      "p_site",
      "p_actor",
      "p_access",
      "p"
    ],
    "defaults": 0,
    "resultType": "text",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "40d352beb1e5896edb8f428d143ae689a6ca7c90036bf5c8372cae0beac00419"
  },
  {
    "name": "faolla_attendance_administrative_event_v1",
    "types": "public.merchant_attendance_events",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "sql",
    "securityDefiner": false,
    "hash": "fc6d90a50c6e1f08ff2e090278b3595a6591b0a7a3d9dbdb3d0ce912a1e3beb3"
  },
  {
    "name": "faolla_attendance_administrative_pause_v1",
    "types": "public.merchant_attendance_account_suspensions",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "sql",
    "securityDefiner": false,
    "hash": "a4300e0f28d15b88fb47d71aca7af2c794e8c4dfbfc0b8de3610cb49f4a28723"
  },
  {
    "name": "faolla_attendance_administrative_source_v1",
    "types": "text,uuid",
    "argumentNames": [
      "p_site",
      "p_worker"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "v",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "46ecdaebadbbcfccbbca974fe1ce8a2c2deab1b86da5937df33571b29b91bc3a"
  },
  {
    "name": "faolla_attendance_administrative_receipt_v1",
    "types": "public.merchant_attendance_administrative_closure_entries",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "cb0e6311ed78b29398f5f1bb52f6168258e21e22e802d79d21cbf3bf7afdbcc3"
  },
  {
    "name": "faolla_attendance_administrative_entry_v1",
    "types": "public.merchant_attendance_administrative_closure_entries",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "d663c9351beed34d63eee7ff75c19abb49e66e4cbc3ce1246fa3d17764ec4203"
  },
  {
    "name": "faolla_attendance_administrative_boundary_v1",
    "types": "text,uuid,uuid",
    "argumentNames": [
      "p_site",
      "p_worker",
      "p_start"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "30f4e7c06f9fd44bd90e321ae8f7f7ec44638ba50e6092ae27cc967dfce196bb"
  },
  {
    "name": "faolla_attendance_administrative_current_v1",
    "types": "text,uuid",
    "argumentNames": [
      "p_site",
      "p_worker"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "5bdbe3085ccc4fcf8dd87c6b64fe0e89fd561a58c280b66b33f0235049544490"
  },
  {
    "name": "faolla_attendance_operating_head_v1",
    "types": "text,uuid",
    "argumentNames": [
      "p_site",
      "p_worker"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "a765524a5112d6ea357143839212b1a279a6b95c6b947c3e98817727b9212e3e"
  },
  {
    "name": "faolla_attendance_administrative_predecessor_v1",
    "types": "text,uuid,public.merchant_attendance_events",
    "argumentNames": [
      "p_site",
      "p_worker",
      "p_first"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "1a130e666abe5e6fbb6f52941676803fa0051fcff0e3eac042c1eb6c3d8acb56"
  },
  {
    "name": "faolla_attendance_administrative_summary_v1",
    "types": "public.merchant_attendance_administrative_closures",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "f77edd7784a6b7035d6a2c13dfc38b21418a9d7ab7b886d8f277a8962b37a7f3"
  },
  {
    "name": "faolla_attendance_administrative_guard_v1",
    "types": "",
    "argumentNames": [],
    "defaults": 0,
    "resultType": "trigger",
    "volatility": "v",
    "language": "plpgsql",
    "securityDefiner": true,
    "hash": "e1bc07e02cd6a2a16a578ccd4140ffca04d2cad2293f4e25bfd0ab306f632a39"
  },
  {
    "name": "faolla_attendance_administrative_closures_v1",
    "types": "jsonb,uuid,jsonb,boolean",
    "argumentNames": [
      "p_query",
      "p_auth_user_id",
      "p_command",
      "p_allow_close"
    ],
    "defaults": 2,
    "resultType": "jsonb",
    "volatility": "v",
    "language": "plpgsql",
    "securityDefiner": true,
    "hash": "a74855ea4529a441e90105fed57fcbba285e9b60ba00da62441915335912d27c"
  },
  {
    "name": "faolla_attendance_administrative_report_boundary_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "i",
    "language": "sql",
    "securityDefiner": false,
    "hash": "546120e124c686ea41f5dfd5fd61c5f25fc6b5ccabbd5b8eea7e9e94ce732f04"
  },
  {
    "name": "faolla_attendance_administrative_current_field_v1",
    "types": "text,uuid",
    "argumentNames": [
      "p_site",
      "p_worker"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "82510b8f64f727b7fac1fb495c07a9f24ab6e7e2538845be4cef08b70e18619d"
  },
  {
    "name": "faolla_attendance_administrative_restore_v1",
    "types": "public.merchant_attendance_account_suspensions,jsonb",
    "argumentNames": [
      "p",
      "p_detail"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "bf2bc01adf51243429f6db8d7ec3ea87c73abde17270e06e28a30a499e24ece8"
  },
  {
    "name": "faolla_attendance_administrative_report_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "c2334334f6e37317749cc9dd95b5c268dcb602923dea888f4422be68c14a2eee"
  },
  {
    "name": "faolla_attendance_administrative_source_result_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "4466f706cd31a515157c9f1e2d926fecb264d09944181fc0fb6381d32e24f4ec"
  },
  {
    "name": "faolla_attendance_administrative_saved_source_v1",
    "types": "jsonb,timestamptz",
    "argumentNames": [
      "p",
      "p_recorded"
    ],
    "defaults": 0,
    "resultType": "boolean",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "7ce86192fc768e854d883ee39123e56294ce9e13643892a5bdc913aa4eed378d"
  }
]
$administrative_new_before$::jsonb) loop
  select p.*,l.lanname into fn from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));
  is_rpc:=spec->>'name'='faolla_attendance_administrative_closures_v1';
  if fn.oid is null or fn.proname<>all(expected_names) or fn.proowner<>(select oid from pg_roles where rolname=current_user)
   or fn.prokind<>'f' or fn.proretset or fn.proargmodes is not null or fn.proisstrict or fn.proleakproof or fn.proparallel<>'u'
   or fn.prorettype<>to_regtype(spec->>'resultType') or fn.provolatile<>spec->>'volatility' or fn.lanname<>spec->>'language'
   or fn.prosecdef<>(spec->>'securityDefiner')::boolean or fn.proconfig is distinct from array['search_path=pg_catalog']
   or fn.pronargdefaults<>(spec->>'defaults')::integer or coalesce(fn.proargnames,'{}'::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))
   or is_rpc and pg_get_expr(fn.proargdefaults,0) is distinct from 'NULL::jsonb, false'
   or encode(sha256(convert_to(replace(replace(fn.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or exists(select 1 from aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) acl where acl.grantor<>fn.proowner
    or acl.grantee<>fn.proowner and (not is_rpc or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
   or has_function_privilege('anon',fn.oid,'EXECUTE') or has_function_privilege('authenticated',fn.oid,'EXECUTE')
   or has_function_privilege('service_role',fn.oid,'EXECUTE')<>is_rpc then raise exception 'merchant_attendance_administrative_closure_function_conflict:%',spec->>'name';end if;
 end loop;
end;
$administrative_preflight$;

create or replace function public.faolla_attendance_administrative_scalar_v1(p jsonb,k text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare stamp timestamptz;v text:=p#>>'{}';
begin
 if k='site' then return jsonb_typeof(p)='string' and char_length(v)=8 and v~'^[0-9]{8}$';
 elsif k='stamp' then
  if jsonb_typeof(p) is distinct from 'string' or char_length(v)<>27 or v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then return false;end if;
  stamp:=v::timestamptz;return isfinite(stamp) and to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=v
   and substring(v,1,10) between '2000-01-01' and '2100-12-31';
 else return public.faolla_attendance_operational_rule_scalar_v1(p,k);end if;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return false;
end;
$$;
create or replace function public.faolla_attendance_administrative_stamp_v1(p timestamptz)
returns text language sql immutable set search_path=pg_catalog as $$
 select to_char(p at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;
create or replace function public.faolla_attendance_administrative_scope_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare k text;
begin
 if public.faolla_attendance_operational_rule_object_v1(p,array['workerId','employeeId','employeeAuthUserId','employmentPeriodId','startEventId','startSequence','startAt']) is distinct from true then raise exception 'attendance_administrative_closure_invalid';end if;
 foreach k in array array['workerId','employeeId','employeeAuthUserId','employmentPeriodId','startEventId'] loop
  if public.faolla_attendance_administrative_scalar_v1(p->k,'uuid') is distinct from true then raise exception 'attendance_administrative_closure_invalid';end if;
 end loop;
 if public.faolla_attendance_administrative_scalar_v1(p->'startSequence','positive') is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'startAt','stamp') is distinct from true then raise exception 'attendance_administrative_closure_invalid';end if;
 return p;
end;
$$;
create or replace function public.faolla_attendance_administrative_frame_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare scope jsonb;k text;
begin
 if public.faolla_attendance_operational_rule_object_v1(p,array['workerId','employeeId','employeeAuthUserId','employmentPeriodId','startEventId','startSequence','startAt','suspensionId','generation','tailEventId','tailSequence','tailAction','tailOccurredAt','timeZone']) is distinct from true then raise exception 'attendance_administrative_closure_invalid';end if;
 scope:=public.faolla_attendance_administrative_scope_v1(p-array['suspensionId','generation','tailEventId','tailSequence','tailAction','tailOccurredAt','timeZone']);
 if public.faolla_attendance_administrative_scalar_v1(p->'suspensionId','uuid') is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'tailEventId','uuid') is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'generation','positive') is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'tailSequence','positive') is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'tailOccurredAt','stamp') is distinct from true
  or jsonb_typeof(p->'tailAction') is distinct from 'string' or coalesce(p->>'tailAction','') not in('clock_in','break_start','break_end')
  or jsonb_typeof(p->'timeZone') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'timeZone',1,100) is distinct from true
  or (p->>'tailSequence')::bigint-(p->>'startSequence')::bigint not between 0 and 2001 or p->>'tailOccurredAt'<p->>'startAt' then raise exception 'attendance_administrative_closure_invalid';end if;
 if p->'tailSequence'=p->'startSequence' then
  if p->'tailEventId' is distinct from p->'startEventId' or p->>'tailAction'<>'clock_in' or p->'tailOccurredAt' is distinct from p->'startAt' then raise exception 'attendance_administrative_closure_invalid';end if;
 elsif p->'tailEventId'=p->'startEventId' or p->>'tailAction'='clock_in' then raise exception 'attendance_administrative_closure_invalid';end if;
 return scope;
end;
$$;
create or replace function public.faolla_attendance_administrative_context_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;
begin
 if public.faolla_attendance_operational_rule_object_v1(p,array['workerVersion','employeeVersion','settingsVersion','employmentRevision','sourceFingerprint']) is distinct from true then return false;end if;
 foreach k in array array['workerVersion','employeeVersion','settingsVersion'] loop
  if public.faolla_attendance_administrative_scalar_v1(p->k,'positive') is distinct from true then return false;end if;
 end loop;
 return public.faolla_attendance_administrative_scalar_v1(p->'employmentRevision','revision') is true and public.faolla_attendance_administrative_scalar_v1(p->'sourceFingerprint','hash') is true;
end;
$$;
create or replace function public.faolla_attendance_administrative_command_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare a text:=p->>'action';keys text[]:=array['operationId','startEventId','expectedRevision','reason','action'];extra jsonb;
begin
 if a in('record_unknown','close') then keys:=keys||array['workerId','expectedSourceFingerprint','verifiedEndAt'];
 elsif a='self_dispute' then keys:=keys||array['expectedClosedOperationId'];
 elsif a='owner_respond' then keys:=keys||array['disputeOperationId'];
 else raise exception 'attendance_invalid_request';end if;
 if public.faolla_attendance_operational_rule_object_v1(p,keys) is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'operationId','uuid') is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'startEventId','uuid') is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'expectedRevision','revision') is distinct from true
  or (p->>'expectedRevision')::bigint>=9007199254740990
  or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,500) is distinct from true then raise exception 'attendance_invalid_request';end if;
 if a in('record_unknown','close') then
  if public.faolla_attendance_administrative_scalar_v1(p->'workerId','uuid') is distinct from true
   or public.faolla_attendance_administrative_scalar_v1(p->'expectedSourceFingerprint','hash') is distinct from true
   or (a='record_unknown' and p->'verifiedEndAt' is distinct from 'null'::jsonb)
   or (a='close' and public.faolla_attendance_administrative_scalar_v1(p->'verifiedEndAt','stamp') is distinct from true) then raise exception 'attendance_invalid_request';end if;
  extra:=jsonb_build_array(p->'workerId',p->'expectedSourceFingerprint',p->'verifiedEndAt');
 elsif a='self_dispute' then
  if (p->>'expectedRevision')::bigint<1 or p->'expectedClosedOperationId'<>'null'::jsonb and public.faolla_attendance_administrative_scalar_v1(p->'expectedClosedOperationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  extra:=jsonb_build_array(p->'expectedClosedOperationId');
 else
  if (p->>'expectedRevision')::bigint<1 or public.faolla_attendance_administrative_scalar_v1(p->'disputeOperationId','uuid') is distinct from true or p->'operationId'=p->'disputeOperationId' then raise exception 'attendance_invalid_request';end if;
  extra:=jsonb_build_array(p->'disputeOperationId');
 end if;
 return jsonb_build_array(p->'operationId',p->'startEventId',a,p->'expectedRevision',p->'reason')||extra;
end;
$$;
create or replace function public.faolla_attendance_administrative_hash_v1(p_site text,p_actor uuid,p_access text,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare tuple jsonb;
begin
 if public.faolla_attendance_administrative_scalar_v1(to_jsonb(p_site),'site') is distinct from true or p_actor is null
  or p_access is distinct from (case when p->>'action'='self_dispute' then 'self' else 'owner' end) then raise exception 'attendance_invalid_request';end if;
 tuple:=jsonb_build_array('attendance-administrative-closure-command-v1',p_site,p_actor,p_access,public.faolla_attendance_administrative_command_v1(p));
 return encode(sha256(convert_to(tuple::text,'UTF8')),'hex');
end;
$$;

create table if not exists public.merchant_attendance_administrative_closures(
 merchant_id text not null references public.merchant_attendance_settings(merchant_id),start_event_id uuid not null references public.merchant_attendance_events(id),
 worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,employment_period_id uuid not null references public.merchant_attendance_employment_periods(id),
 case_scope jsonb not null,revision bigint not null check(revision between 1 and 9007199254740990),
 latest_source_operation_id uuid not null,closed_operation_id uuid,
 primary key(merchant_id,start_event_id),foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
 foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
 check(public.faolla_attendance_administrative_scope_v1(case_scope)=case_scope),
 check(case_scope->>'workerId'=worker_id::text and case_scope->>'employeeId'=employee_id::text and case_scope->>'employeeAuthUserId'=employee_auth_user_id::text
  and case_scope->>'startEventId'=start_event_id::text and case_scope->>'employmentPeriodId'=employment_period_id::text)
);
create index if not exists attendance_administrative_self_idx on public.merchant_attendance_administrative_closures(merchant_id,employee_auth_user_id,start_event_id);
create table if not exists public.merchant_attendance_administrative_closure_entries(
 merchant_id text not null,start_event_id uuid not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
 action text not null check(action in('record_unknown','close','self_dispute','owner_respond')),actor_auth_user_id uuid not null,actor_access text not null,
 command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz not null check(isfinite(recorded_at)),
 frame jsonb,context jsonb,source_text text,source_bytes integer,source_sha256 text,
 primary key(merchant_id,operation_id),unique(merchant_id,start_event_id,revision),
 foreign key(merchant_id,start_event_id) references public.merchant_attendance_administrative_closures(merchant_id,start_event_id),
 check(actor_access=case when action='self_dispute' then 'self' else 'owner' end),
 check(jsonb_typeof(command)='object' and octet_length(convert_to(command::text,'UTF8'))<=8192),
 check((action in('record_unknown','close') and frame is not null and context is not null and source_text is not null and source_bytes is not null and source_bytes between 1 and 1048576 and source_sha256 is not null and source_sha256~'^[0-9a-f]{64}$')
  or (action in('self_dispute','owner_respond') and frame is null and context is null and source_text is null and source_bytes is null and source_sha256 is null))
);
create unique index if not exists attendance_administrative_close_idx on public.merchant_attendance_administrative_closure_entries(merchant_id,start_event_id) where action='close';
create index if not exists attendance_administrative_dispute_idx on public.merchant_attendance_administrative_closure_entries(merchant_id,start_event_id,revision desc) where action='self_dispute';
create index if not exists attendance_administrative_source_idx on public.merchant_attendance_administrative_closure_entries(merchant_id,start_event_id,revision desc) where action in('record_unknown','close');

create or replace function public.faolla_attendance_administrative_event_v1(p public.merchant_attendance_events)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('id',p.id,'operationId',p.operation_id,'locationId',p.location_id,'sequence',p.sequence,'action',p.action,'source',p.source,'breakPaid',p.break_paid,
  'occurredAt',public.faolla_attendance_administrative_stamp_v1(p.occurred_at),'receivedAt',public.faolla_attendance_administrative_stamp_v1(p.received_at),'timeZone',p.time_zone,'actorEmployeeId',p.actor_employee_id);
$$;
create or replace function public.faolla_attendance_administrative_pause_v1(p public.merchant_attendance_account_suspensions)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select jsonb_build_object('suspensionId',p.suspension_id,'generation',p.generation,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'workerId',p.worker_id,
  'originalEventId',p.original_event_id,'originalSequence',p.original_sequence,'originalAction',p.original_action,'originalActorEmployeeId',p.original_actor_employee_id,'recordedAt',public.faolla_attendance_administrative_stamp_v1(p.recorded_at));
$$;

-- Caller has merchant/settings locks. This helper never impersonates an active
-- self reader and never reconstructs a new candidate from an old saved entry.
create or replace function public.faolla_attendance_administrative_source_v1(p_site text,p_worker uuid)
returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;s public.merchant_attendance_settings%rowtype;
 ep public.merchant_attendance_account_epochs%rowtype;pause public.merchant_attendance_account_suspensions%rowtype;employment public.merchant_attendance_employment_periods%rowtype;
 tail public.merchant_attendance_events%rowtype;first_event public.merchant_attendance_events%rowtype;ev public.merchant_attendance_events%rowtype;
 frame_value jsonb;context_value jsonb;source_value jsonb;events_value jsonb:='[]';chain jsonb;flags jsonb:='[]';source_text text;source_hash text;
 state_value text:='off';previous_seq bigint;previous_at timestamptz;now_at timestamptz:=clock_timestamp();n integer:=0;today date;
begin
 select * into s from public.merchant_attendance_settings where merchant_id=p_site;
 if s.merchant_id is null then raise exception 'attendance_administrative_closure_blocked';end if;
 select * into w from public.merchant_attendance_workers where merchant_id=p_site and id=p_worker for update;
 if w.id is null then raise exception 'attendance_administrative_closure_not_found';end if;
 select * into e from public.merchant_enterprise_employees where merchant_id=p_site and id=w.employee_id for share;
 select * into ep from public.merchant_attendance_account_epochs where merchant_id=p_site and employee_id=e.id;
 select * into pause from public.merchant_attendance_account_suspensions where merchant_id=p_site and suspension_id=ep.suspension_id;
 select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker order by sequence desc limit 1;
 if tail.id is not null and tail.action<>'clock_out' then
  select * into first_event from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker
   and sequence between greatest(1,tail.sequence-2001) and tail.sequence and action='clock_in' order by sequence desc limit 1;
  if first_event.id is null then flags:=flags||'"source_too_large"'::jsonb;end if;
 else flags:=flags||'"session_not_open"'::jsonb;end if;
 if e.id is null or e.auth_user_id is null or tail.id is not null and tail.actor_employee_id is distinct from e.id then flags:=flags||'"identity_changed"'::jsonb;end if;
 if w.active or ep.paused is distinct from true or pause.suspension_id is null then flags:=flags||'"not_paused"'::jsonb;
 elsif row(pause.worker_id,pause.employee_id,pause.employee_auth_user_id,pause.generation,pause.suspension_id)
  is distinct from row(w.id,e.id,e.auth_user_id,ep.generation,ep.suspension_id) or pause.was_active is null
  or row(pause.original_event_id,pause.original_sequence,pause.original_action,pause.original_actor_employee_id)
  is distinct from row(tail.id,tail.sequence,tail.action,tail.actor_employee_id) then flags:=flags||'"suspension_changed"'::jsonb;end if;
 chain:=public.faolla_attendance_employment_chain_v1(p_site,w.id,e.id,e.auth_user_id);
 select * into employment from public.merchant_attendance_employment_periods where merchant_id=p_site and worker_id=p_worker and id=(chain->'periods'->-1->>'id')::uuid;
 today:=(now_at at time zone s.time_zone)::date;
 if chain->'valid' is distinct from 'true'::jsonb or chain->'limited' is distinct from 'false'::jsonb or employment.id is null or employment.ends_on is not null or employment.starts_on>today then flags:=flags||'"employment_changed"'::jsonb;end if;
 if flags<>'[]'::jsonb then return jsonb_build_object('startEventId',first_event.id,'frame',null,'context',null,'sourceText',null,'sourceBytes',null,'blockers',flags);end if;
 -- A malformed second raw start cannot hide an earlier open segment. A real
 -- administrative predecessor is independently checked, never invented here.
 perform public.faolla_attendance_administrative_predecessor_v1(p_site,p_worker,first_event);
 previous_seq:=first_event.sequence-1;previous_at:=first_event.occurred_at;
 for ev in select * from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and sequence between first_event.sequence and tail.sequence order by sequence limit 2003 loop
  n:=n+1;if n>2002 then raise exception 'attendance_administrative_closure_too_large';end if;
  if ev.actor_employee_id is distinct from e.id then raise exception 'attendance_administrative_closure_changed';end if;
  if ev.sequence<>previous_seq+1 or ev.occurred_at<previous_at or ev.occurred_at>now_at or not isfinite(ev.occurred_at) then raise exception 'attendance_administrative_closure_invalid';end if;
  if n=1 and ev.action='clock_in' then state_value:='working';
  elsif ev.action='break_start' and state_value='working' and ev.break_paid is not null then state_value:='break';
  elsif ev.action='break_end' and state_value='break' then state_value:='working';else raise exception 'attendance_administrative_closure_invalid';end if;
  if ev.action<>'break_start' and ev.break_paid is not null then raise exception 'attendance_administrative_closure_invalid';end if;
  events_value:=events_value||jsonb_build_array(public.faolla_attendance_administrative_event_v1(ev));previous_seq:=ev.sequence;previous_at:=ev.occurred_at;
 end loop;
 if n<>tail.sequence-first_event.sequence+1 or n<1 then raise exception 'attendance_administrative_closure_invalid';end if;
 frame_value:=jsonb_build_object('workerId',w.id,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'employmentPeriodId',employment.id,
  'startEventId',first_event.id,'startSequence',first_event.sequence,'startAt',public.faolla_attendance_administrative_stamp_v1(first_event.occurred_at),
  'suspensionId',pause.suspension_id,'generation',pause.generation,'tailEventId',tail.id,'tailSequence',tail.sequence,'tailAction',tail.action,
  'tailOccurredAt',public.faolla_attendance_administrative_stamp_v1(tail.occurred_at),'timeZone',s.time_zone);
 perform public.faolla_attendance_administrative_frame_v1(frame_value);
 context_value:=jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'settingsVersion',s.version,'employmentRevision',chain->'revision');
 source_value:=jsonb_build_object('protocol','administrative-source-v1','siteId',p_site,'frame',frame_value,'context',context_value,'events',events_value,
  'suspension',public.faolla_attendance_administrative_pause_v1(pause),'employment',jsonb_build_object('periodId',employment.id,'startsOn',employment.starts_on,'endsOn',employment.ends_on),
  'epoch',jsonb_build_object('generation',ep.generation,'suspensionId',ep.suspension_id,'paused',ep.paused,'updatedAt',public.faolla_attendance_administrative_stamp_v1(ep.updated_at)));
 source_text:=source_value::text;if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_administrative_closure_too_large';end if;
 source_hash:=encode(sha256(convert_to(source_text,'UTF8')),'hex');context_value:=context_value||jsonb_build_object('sourceFingerprint',source_hash);
 if public.faolla_attendance_administrative_context_v1(context_value) is distinct from true then raise exception 'attendance_administrative_closure_invalid';end if;
 if exists(select 1 from public.merchant_attendance_administrative_closures where merchant_id=p_site and start_event_id=first_event.id and closed_operation_id is not null) then flags:=flags||'"already_closed"'::jsonb;end if;
 return jsonb_build_object('startEventId',first_event.id,'frame',frame_value,'context',context_value,'sourceText',source_text,'sourceBytes',octet_length(convert_to(source_text,'UTF8')),'blockers',flags);
end;
$$;

create or replace function public.faolla_attendance_administrative_receipt_v1(p public.merchant_attendance_administrative_closure_entries)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
begin
 if p.operation_id is null then return null;end if;
 if p.command_fingerprint is distinct from public.faolla_attendance_administrative_hash_v1(p.merchant_id,p.actor_auth_user_id,p.actor_access,p.command)
  or p.command->>'operationId' is distinct from p.operation_id::text or p.command->>'startEventId' is distinct from p.start_event_id::text
  or p.command->>'action' is distinct from p.action or p.command->'expectedRevision' is distinct from to_jsonb(p.revision-1)
  or public.faolla_attendance_administrative_scalar_v1(to_jsonb(public.faolla_attendance_administrative_stamp_v1(p.recorded_at)),'stamp') is distinct from true then raise exception 'attendance_administrative_closure_invalid';end if;
 return jsonb_build_object('operationId',p.operation_id,'startEventId',p.start_event_id,'revision',p.revision,'action',p.action,'actorId',p.actor_auth_user_id,
  'recordedAt',public.faolla_attendance_administrative_stamp_v1(p.recorded_at),'commandFingerprint',p.command_fingerprint);
end;
$$;
create or replace function public.faolla_attendance_administrative_entry_v1(p public.merchant_attendance_administrative_closure_entries)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare receipt jsonb;head public.merchant_attendance_administrative_closures%rowtype;pause public.merchant_attendance_account_suspensions%rowtype;
 employment public.merchant_attendance_employment_periods%rowtype;source_value jsonb;events_value jsonb;scope jsonb;
begin
 receipt:=public.faolla_attendance_administrative_receipt_v1(p);if receipt is null then return null;end if;
 select * into head from public.merchant_attendance_administrative_closures where merchant_id=p.merchant_id and start_event_id=p.start_event_id;
 if head.start_event_id is null or p.revision>head.revision then raise exception 'attendance_administrative_closure_invalid';end if;
 if p.action in('record_unknown','close') then
  scope:=public.faolla_attendance_administrative_frame_v1(p.frame);
  if scope is distinct from head.case_scope or public.faolla_attendance_administrative_context_v1(p.context) is distinct from true
   or p.command->>'workerId' is distinct from head.worker_id::text or p.command->>'expectedSourceFingerprint' is distinct from p.source_sha256
   or p.context->>'sourceFingerprint' is distinct from p.source_sha256 or p.source_bytes is distinct from octet_length(convert_to(p.source_text,'UTF8'))
   or p.source_sha256 is distinct from encode(sha256(convert_to(p.source_text,'UTF8')),'hex') then raise exception 'attendance_administrative_closure_invalid';end if;
  source_value:=p.source_text::jsonb;
  if source_value::text is distinct from p.source_text or public.faolla_attendance_operational_rule_object_v1(source_value,array['protocol','siteId','frame','context','events','suspension','employment','epoch']) is distinct from true
   or source_value->>'protocol' is distinct from 'administrative-source-v1' or source_value->>'siteId' is distinct from p.merchant_id
   or source_value->'frame' is distinct from p.frame or source_value->'context' is distinct from p.context-'sourceFingerprint'
   or jsonb_typeof(source_value->'events') is distinct from 'array' or jsonb_array_length(source_value->'events') not between 1 and 2002
   or p.frame->>'tailOccurredAt'>public.faolla_attendance_administrative_stamp_v1(p.recorded_at) then raise exception 'attendance_administrative_closure_invalid';end if;
  -- Immutable prefix only; a later real tail or epoch must not rewrite or
  -- invalidate an earlier unknown snapshot. No current owner/role is sampled.
  select jsonb_agg(public.faolla_attendance_administrative_event_v1(raw) order by raw.sequence) into events_value
   from (select * from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=head.worker_id
    and sequence between (p.frame->>'startSequence')::bigint and (p.frame->>'tailSequence')::bigint order by sequence limit 2003) raw;
  if events_value is distinct from source_value->'events' or jsonb_array_length(events_value)<>(p.frame->>'tailSequence')::bigint-(p.frame->>'startSequence')::bigint+1
   or events_value->0->>'id' is distinct from p.frame->>'startEventId' or events_value->-1->>'id' is distinct from p.frame->>'tailEventId'
   or exists(select 1 from jsonb_array_elements(events_value) ev where ev->>'actorEmployeeId' is distinct from head.employee_id::text) then raise exception 'attendance_administrative_closure_invalid';end if;
  select * into pause from public.merchant_attendance_account_suspensions where merchant_id=p.merchant_id and suspension_id=(p.frame->>'suspensionId')::uuid;
  select * into employment from public.merchant_attendance_employment_periods where merchant_id=p.merchant_id and id=head.employment_period_id;
  if pause.suspension_id is null or public.faolla_attendance_administrative_pause_v1(pause) is distinct from source_value->'suspension'
   or row(pause.worker_id,pause.employee_id,pause.employee_auth_user_id,pause.generation,pause.original_event_id,pause.original_sequence,pause.original_action)
    is distinct from row(head.worker_id,head.employee_id,head.employee_auth_user_id,(p.frame->>'generation')::bigint,(p.frame->>'tailEventId')::uuid,(p.frame->>'tailSequence')::bigint,p.frame->>'tailAction')
   or employment.id is null or employment.worker_id is distinct from head.worker_id
   or source_value->'employment' is distinct from jsonb_build_object('periodId',employment.id,'startsOn',employment.starts_on,'endsOn',null)
   or public.faolla_attendance_operational_rule_object_v1(source_value->'epoch',array['generation','suspensionId','paused','updatedAt']) is distinct from true
   or source_value->'epoch'->'generation' is distinct from p.frame->'generation' or source_value->'epoch'->'suspensionId' is distinct from p.frame->'suspensionId'
   or source_value->'epoch'->'paused' is distinct from 'true'::jsonb
   or public.faolla_attendance_administrative_scalar_v1(source_value->'epoch'->'updatedAt','stamp') is distinct from true
   or (source_value->'epoch'->>'updatedAt')::timestamptz<pause.recorded_at or (source_value->'epoch'->>'updatedAt')::timestamptz>p.recorded_at
   or pause.recorded_at>p.recorded_at then raise exception 'attendance_administrative_closure_invalid';end if;
  if p.action='close' and ((p.command->>'verifiedEndAt')::timestamptz<(p.frame->>'tailOccurredAt')::timestamptz or (p.command->>'verifiedEndAt')::timestamptz>p.recorded_at) then raise exception 'attendance_administrative_closure_invalid';end if;
 elsif p.frame is not null or p.context is not null or p.source_text is not null or p.source_sha256 is not null or p.source_bytes is not null then raise exception 'attendance_administrative_closure_invalid';
 end if;
 if p.action='self_dispute' and (p.actor_auth_user_id is distinct from head.employee_auth_user_id or p.revision<2) then raise exception 'attendance_administrative_closure_invalid';end if;
 if p.action='owner_respond' and not exists(select 1 from public.merchant_attendance_administrative_closure_entries x
  where x.merchant_id=p.merchant_id and x.operation_id=(p.command->>'disputeOperationId')::uuid and x.start_event_id=p.start_event_id and x.action='self_dispute' and x.revision<p.revision) then raise exception 'attendance_administrative_closure_invalid';end if;
 return receipt||jsonb_build_object('actorAccess',p.actor_access,'reason',p.command->'reason','verifiedEndAt',case when p.action='close' then p.command->'verifiedEndAt' else 'null'::jsonb end,
  'disputeOperationId',case when p.action='owner_respond' then p.command->'disputeOperationId' else 'null'::jsonb end,'frame',p.frame,'context',p.context);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'attendance_administrative_closure_invalid';
end;
$$;

create or replace function public.faolla_attendance_administrative_boundary_v1(p_site text,p_worker uuid,p_start uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare h public.merchant_attendance_administrative_closures%rowtype;e public.merchant_attendance_administrative_closure_entries%rowtype;item jsonb;
begin
 select * into h from public.merchant_attendance_administrative_closures where merchant_id=p_site and start_event_id=p_start;
 if h.start_event_id is null then return null;end if;
 if h.worker_id is distinct from p_worker then raise exception 'attendance_administrative_closure_invalid';end if;
 if h.closed_operation_id is null then return null;end if;
 select * into e from public.merchant_attendance_administrative_closure_entries where merchant_id=p_site and operation_id=h.closed_operation_id;
 item:=public.faolla_attendance_administrative_entry_v1(e);
 if item is null or e.start_event_id is distinct from p_start or e.action is distinct from 'close' or h.latest_source_operation_id is distinct from e.operation_id then raise exception 'attendance_administrative_closure_invalid';end if;
 return e.frame||jsonb_build_object('protocol','attendance-administrative-boundary-v1','siteId',p_site,'operationId',e.operation_id,'revision',e.revision,
  'verifiedEndAt',e.command->'verifiedEndAt','recordedAt',public.faolla_attendance_administrative_stamp_v1(e.recorded_at),'sourceFingerprint',e.source_sha256);
end;
$$;
create or replace function public.faolla_attendance_administrative_current_v1(p_site text,p_worker uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare tail public.merchant_attendance_events%rowtype;start_id uuid;b jsonb;
begin
 select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker order by sequence desc limit 1;
 if tail.id is null or tail.action='clock_out' then return null;end if;
 select id into start_id from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker
  and sequence between greatest(1,tail.sequence-2001) and tail.sequence and action='clock_in' order by sequence desc limit 1;
 if start_id is null then return null;end if;
 b:=public.faolla_attendance_administrative_boundary_v1(p_site,p_worker,start_id);if b is null then return null;end if;
 if b->>'tailEventId' is distinct from tail.id::text or b->'tailSequence' is distinct from to_jsonb(tail.sequence)
  or b->>'employeeId' is distinct from tail.actor_employee_id::text then raise exception 'attendance_administrative_closure_invalid';end if;
 return b;
end;
$$;
create or replace function public.faolla_attendance_operating_head_v1(p_site text,p_worker uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare tail public.merchant_attendance_events%rowtype;b jsonb;v jsonb;
begin
 select * into tail from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker order by sequence desc limit 1;
 b:=public.faolla_attendance_administrative_current_v1(p_site,p_worker);
 v:=jsonb_build_object('sequence',coalesce(tail.sequence,0),'status',case when tail.id is null or tail.action='clock_out' or b is not null then 'off' when tail.action='break_start' then 'break' else 'working' end,
  'lastEvent',public.faolla_attendance_event_receipt_v1(tail));
 if b is not null then v:=v||jsonb_build_object('administrativeBoundary',b);end if;return v;
end;
$$;
create or replace function public.faolla_attendance_administrative_predecessor_v1(p_site text,p_worker uuid,p_first public.merchant_attendance_events)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare prior public.merchant_attendance_events%rowtype;start_id uuid;b jsonb;
begin
 if p_first.merchant_id is distinct from p_site or p_first.worker_id is distinct from p_worker or p_first.action is distinct from 'clock_in' then raise exception 'attendance_administrative_closure_invalid';end if;
 if p_first.sequence=1 then return null;end if;
 select * into prior from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and sequence=p_first.sequence-1;
 if prior.id is null then raise exception 'attendance_session_invalid_records';end if;
 if prior.action='clock_out' then return null;end if;
 select id into start_id from public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker
  and sequence between greatest(1,prior.sequence-2001) and prior.sequence and action='clock_in' order by sequence desc limit 1;
 if start_id is null then raise exception 'attendance_session_invalid_records';end if;
 b:=public.faolla_attendance_administrative_boundary_v1(p_site,p_worker,start_id);
 if b is null or b->>'tailEventId' is distinct from prior.id::text or b->'tailSequence' is distinct from to_jsonb(prior.sequence)
  or b->>'employeeId' is distinct from p_first.actor_employee_id::text or (b->>'verifiedEndAt')::timestamptz>p_first.occurred_at then raise exception 'attendance_session_invalid_records';end if;
 return b;
end;
$$;

create or replace function public.faolla_attendance_administrative_summary_v1(p public.merchant_attendance_administrative_closures)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare current_entry public.merchant_attendance_administrative_closure_entries%rowtype;b jsonb;
begin
 if p.start_event_id is null then return null;end if;
 select * into current_entry from public.merchant_attendance_administrative_closure_entries where merchant_id=p.merchant_id and start_event_id=p.start_event_id and revision=p.revision;
 if current_entry.operation_id is null then raise exception 'attendance_administrative_closure_invalid';end if;
 perform public.faolla_attendance_administrative_receipt_v1(current_entry);b:=public.faolla_attendance_administrative_boundary_v1(p.merchant_id,p.worker_id,p.start_event_id);
 return jsonb_build_object('startEventId',p.start_event_id,'identity',jsonb_build_object('workerId',p.worker_id,'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id),
  'employmentPeriodId',p.employment_period_id,'state',case when b is null then 'pending' else 'closed' end,'revision',p.revision,'verifiedEndAt',b->'verifiedEndAt','closedOperationId',p.closed_operation_id,
  'hasDispute',exists(select 1 from public.merchant_attendance_administrative_closure_entries where merchant_id=p.merchant_id and start_event_id=p.start_event_id and action='self_dispute'),
  'updatedAt',public.faolla_attendance_administrative_stamp_v1(current_entry.recorded_at));
end;
$$;

create or replace function public.faolla_attendance_administrative_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare h public.merchant_attendance_administrative_closures%rowtype;e public.merchant_attendance_administrative_closure_entries%rowtype;prior public.merchant_attendance_administrative_closure_entries%rowtype;source_entry public.merchant_attendance_administrative_closure_entries%rowtype;
 closed_entry public.merchant_attendance_administrative_closure_entries%rowtype;
begin
 if tg_level<>'ROW' or tg_op not in('INSERT','UPDATE') then raise exception 'attendance_administrative_closure_invalid';end if;
 if tg_when='BEFORE' then
  if tg_relid<>'public.merchant_attendance_administrative_closures'::regclass then raise exception 'attendance_administrative_closure_invalid';end if;
  perform public.faolla_attendance_administrative_scope_v1(new.case_scope);
  if tg_op='INSERT' then
   if new.revision<>1 then raise exception 'attendance_administrative_closure_invalid';end if;
  elsif row(new.merchant_id,new.start_event_id,new.worker_id,new.employee_id,new.employee_auth_user_id,new.employment_period_id,new.case_scope)
   is distinct from row(old.merchant_id,old.start_event_id,old.worker_id,old.employee_id,old.employee_auth_user_id,old.employment_period_id,old.case_scope)
   or new.revision<>old.revision+1 or old.closed_operation_id is not null and (new.closed_operation_id is distinct from old.closed_operation_id or new.latest_source_operation_id is distinct from old.latest_source_operation_id) then raise exception 'attendance_administrative_closure_invalid';end if;
  return new;
 end if;
 if tg_when<>'AFTER' then raise exception 'attendance_administrative_closure_invalid';end if;
 select * into h from public.merchant_attendance_administrative_closures where merchant_id=new.merchant_id and start_event_id=new.start_event_id;
 if h.start_event_id is null then raise exception 'attendance_administrative_closure_invalid';end if;
 select * into e from public.merchant_attendance_administrative_closure_entries where merchant_id=h.merchant_id and start_event_id=h.start_event_id and revision=new.revision;
 if e.operation_id is null then raise exception 'attendance_administrative_closure_invalid';end if;
 perform public.faolla_attendance_administrative_entry_v1(e);
 if e.revision>1 then
  select * into prior from public.merchant_attendance_administrative_closure_entries where merchant_id=h.merchant_id and start_event_id=h.start_event_id and revision=e.revision-1;
  if prior.operation_id is null or prior.recorded_at>e.recorded_at then raise exception 'attendance_administrative_closure_invalid';end if;
 elsif e.action not in('record_unknown','close') then raise exception 'attendance_administrative_closure_invalid';end if;
 select * into source_entry from public.merchant_attendance_administrative_closure_entries where merchant_id=h.merchant_id and operation_id=h.latest_source_operation_id;
 if source_entry.start_event_id is distinct from h.start_event_id or source_entry.action not in('record_unknown','close') or source_entry.revision>h.revision
  or exists(select 1 from public.merchant_attendance_administrative_closure_entries where merchant_id=h.merchant_id and start_event_id=h.start_event_id and revision>source_entry.revision and action in('record_unknown','close')) then raise exception 'attendance_administrative_closure_invalid';end if;
 if h.closed_operation_id is not null then
  select * into closed_entry from public.merchant_attendance_administrative_closure_entries where merchant_id=h.merchant_id and operation_id=h.closed_operation_id;
  if closed_entry.start_event_id is distinct from h.start_event_id or closed_entry.action is distinct from 'close' or h.latest_source_operation_id is distinct from h.closed_operation_id then raise exception 'attendance_administrative_closure_invalid';end if;
  if e.action='record_unknown' and e.revision>closed_entry.revision then raise exception 'attendance_administrative_closure_invalid';end if;
 end if;
 if e.action='self_dispute' and e.command->>'expectedClosedOperationId' is distinct from (case when closed_entry.revision<e.revision then closed_entry.operation_id::text else null end) then raise exception 'attendance_administrative_closure_invalid';end if;
 return new;
end;
$$;

create or replace function public.faolla_attendance_administrative_closures_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_close boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;keys text[]:=array['siteId','access','mode'];worker uuid;start_id uuid;operation_value uuid;after_id uuid;before_revision bigint;
 h public.merchant_attendance_administrative_closures%rowtype;listed public.merchant_attendance_administrative_closures%rowtype;e public.merchant_attendance_administrative_closure_entries%rowtype;
 current_entry public.merchant_attendance_administrative_closure_entries%rowtype;source_entry public.merchant_attendance_administrative_closure_entries%rowtype;ref_entry public.merchant_attendance_administrative_closure_entries%rowtype;
 member public.merchant_enterprise_employees%rowtype;w public.merchant_attendance_workers%rowtype;owner_id uuid;
 source_value jsonb;scope_value jsonb;summary_value jsonb;detail_value jsonb;boundary_value jsonb;flags jsonb:='[]';items jsonb:='[]';data_value jsonb;result_value jsonb;
 revision_value bigint;stamp timestamptz;next_id uuid;next_revision bigint;n integer:=0;can_source boolean:=false;can_dispute boolean:=false;can_respond boolean:=false;row_value record;
begin
 if p_query is null or jsonb_typeof(p_query) is distinct from 'object' or p_auth_user_id is null then raise exception 'attendance_invalid_request';end if;
 site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
 if mode_name in('workers','list') then keys:=keys||array['afterId'];elsif mode_name='candidate' then keys:=keys||array['workerId'];
 elsif mode_name='detail' then keys:=keys||array['startEventId'];elsif mode_name='history' then keys:=keys||array['startEventId','beforeRevision'];
 elsif mode_name='recover' then keys:=keys||array['operationId'];else raise exception 'attendance_invalid_request';end if;
 if public.faolla_attendance_operational_rule_object_v1(p_query,keys) is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p_query->'siteId','site') is distinct from true or access_name is null or access_name not in('owner','self')
  or mode_name in('workers','candidate') and access_name<>'owner' then raise exception 'attendance_invalid_request';end if;
 if mode_name in('workers','list') then
  if p_query->'afterId'<>'null'::jsonb and public.faolla_attendance_administrative_scalar_v1(p_query->'afterId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;after_id:=(p_query->>'afterId')::uuid;
 elsif mode_name='candidate' then
  if public.faolla_attendance_administrative_scalar_v1(p_query->'workerId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;worker:=(p_query->>'workerId')::uuid;
 elsif mode_name in('detail','history') then
  if public.faolla_attendance_administrative_scalar_v1(p_query->'startEventId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;start_id:=(p_query->>'startEventId')::uuid;
  if mode_name='history' then
   if p_query->'beforeRevision'<>'null'::jsonb and public.faolla_attendance_administrative_scalar_v1(p_query->'beforeRevision','positive') is distinct from true then raise exception 'attendance_invalid_request';end if;before_revision:=(p_query->>'beforeRevision')::bigint;
  end if;
 else
  if public.faolla_attendance_administrative_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;operation_value:=(p_query->>'operationId')::uuid;
 end if;
 if p_command is not null then
  perform public.faolla_attendance_administrative_command_v1(p_command);operation_value:=(p_command->>'operationId')::uuid;
  if mode_name='recover' or access_name is distinct from (case when p_command->>'action'='self_dispute' then 'self' else 'owner' end)
   or (p_command->>'action' in('record_unknown','close') and (mode_name<>'candidate' or p_command->>'workerId' is distinct from worker::text))
   or (p_command->>'action' in('self_dispute','owner_respond') and (mode_name<>'detail' or p_command->>'startEventId' is distinct from start_id::text)) then raise exception 'attendance_invalid_request';end if;
 end if;
 if mode_name='recover' then
  -- Original-actor minimum receipt survives loss of owner, membership, settings
  -- and feature. Never invoke the full source checker or return current detail.
  select * into e from public.merchant_attendance_administrative_closure_entries where merchant_id=site and operation_id=operation_value and actor_auth_user_id=p_auth_user_id and actor_access=access_name;
  data_value:=jsonb_build_object('kind','receipt','receipt',public.faolla_attendance_administrative_receipt_v1(e));
 else
  select user_id into owner_id from public.merchants where id=site for share;
  if not found or access_name='owner' and owner_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
  if p_command is not null then perform 1 from public.merchant_attendance_settings where merchant_id=site for update;
  else perform 1 from public.merchant_attendance_settings where merchant_id=site for share;end if;
  if not found then raise exception 'attendance_administrative_closure_blocked';end if;
  if access_name='self' then
   select * into member from public.merchant_enterprise_employees where merchant_id=site and auth_user_id=p_auth_user_id;
   select * into w from public.merchant_attendance_workers where merchant_id=site and employee_id=member.id for share;
   select * into member from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id and auth_user_id=p_auth_user_id for share;
   if w.id is null or member.id is null then raise exception 'attendance_access_denied';end if;
  end if;
  if p_command is not null then
   if p_command->>'action' in('record_unknown','close') and p_allow_close is distinct from true then raise exception 'attendance_administrative_closure_disabled';end if;
   select * into e from public.merchant_attendance_administrative_closure_entries where merchant_id=site and operation_id=operation_value;
   if e.operation_id is not null then
    if e.actor_auth_user_id is distinct from p_auth_user_id or e.actor_access is distinct from access_name or e.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
    if access_name='self' and not exists(select 1 from public.merchant_attendance_administrative_closures where merchant_id=site and start_event_id=e.start_event_id and worker_id=w.id and employee_id=member.id and employee_auth_user_id=p_auth_user_id) then raise exception 'attendance_access_denied';end if;
    data_value:=jsonb_build_object('kind','receipt','receipt',public.faolla_attendance_administrative_receipt_v1(e));
   end if;
  end if;
  if data_value is null and mode_name='workers' then
   for row_value in select aw.id,aw.employee_id,ae.auth_user_id,aw.worker_no,aw.display_name,coalesce(ep.paused,false) paused
    from public.merchant_attendance_workers aw left join public.merchant_enterprise_employees ae on ae.merchant_id=aw.merchant_id and ae.id=aw.employee_id
    left join public.merchant_attendance_account_epochs ep on ep.merchant_id=aw.merchant_id and ep.employee_id=ae.id
    where aw.merchant_id=site and (after_id is null or aw.id>after_id) order by aw.id limit 26 loop
    n:=n+1;if n>25 then next_id:=(items->-1->>'workerId')::uuid;exit;end if;
    items:=items||jsonb_build_array(jsonb_build_object('workerId',row_value.id,'employeeId',row_value.employee_id,'employeeAuthUserId',row_value.auth_user_id,'workerNo',row_value.worker_no,'displayName',row_value.display_name,'paused',row_value.paused));
   end loop;
   data_value:=jsonb_build_object('kind','workers','items',items,'nextAfterId',next_id);
  elsif data_value is null and mode_name='list' then
   for listed in select * from public.merchant_attendance_administrative_closures c where c.merchant_id=site and (after_id is null or c.start_event_id>after_id)
    and (access_name='owner' or c.worker_id=w.id and c.employee_id=member.id and c.employee_auth_user_id=p_auth_user_id) order by c.start_event_id limit 26 loop
    n:=n+1;if n>25 then next_id:=(items->-1->>'startEventId')::uuid;exit;end if;items:=items||jsonb_build_array(public.faolla_attendance_administrative_summary_v1(listed));
   end loop;
   data_value:=jsonb_build_object('kind','list','items',items,'nextAfterId',next_id);
  elsif data_value is null then
   if mode_name='candidate' then
    source_value:=public.faolla_attendance_administrative_source_v1(site,worker);start_id:=(source_value->>'startEventId')::uuid;
   end if;
   select * into h from public.merchant_attendance_administrative_closures where merchant_id=site and start_event_id=start_id for update;
   if mode_name<>'candidate' and h.start_event_id is null then raise exception 'attendance_administrative_closure_not_found';end if;
   if access_name='self' and (h.worker_id is distinct from w.id or h.employee_id is distinct from member.id or h.employee_auth_user_id is distinct from p_auth_user_id) then raise exception 'attendance_access_denied';end if;
   if p_command is not null then
    if h.start_event_id is null and (p_command->>'expectedRevision')::bigint<>0 or h.start_event_id is not null and p_command->'expectedRevision' is distinct from to_jsonb(h.revision)
     or p_command->>'startEventId' is distinct from start_id::text then raise exception 'attendance_administrative_closure_changed';end if;
    revision_value:=coalesce(h.revision,0)+1;if revision_value>9007199254740990 then raise exception 'attendance_administrative_closure_blocked';end if;
    if p_command->>'action' in('record_unknown','close') then
     if source_value->'blockers' is distinct from '[]'::jsonb or source_value->'frame'='null'::jsonb then raise exception 'attendance_administrative_closure_blocked';end if;
     if source_value->'context'->>'sourceFingerprint' is distinct from p_command->>'expectedSourceFingerprint' then raise exception 'attendance_administrative_closure_changed';end if;
     scope_value:=public.faolla_attendance_administrative_frame_v1(source_value->'frame');
     if h.start_event_id is not null and scope_value is distinct from h.case_scope then raise exception 'attendance_administrative_closure_changed';end if;
     stamp:=clock_timestamp();
     if p_command->>'action'='close' then
      if (p_command->>'verifiedEndAt')::timestamptz<(source_value->'frame'->>'tailOccurredAt')::timestamptz or (p_command->>'verifiedEndAt')::timestamptz>stamp then raise exception 'attendance_invalid_request';end if;
      perform public.faolla_attendance_period_assert_open_v1(site,worker,jsonb_build_array(jsonb_build_object('startAt',source_value->'frame'->'startAt','endAt',p_command->'verifiedEndAt')));
     end if;
    else
     stamp:=clock_timestamp();
     if p_command->>'action'='self_dispute' then
      if p_command->>'expectedClosedOperationId' is distinct from h.closed_operation_id::text then raise exception 'attendance_administrative_closure_changed';end if;
     else
      select * into ref_entry from public.merchant_attendance_administrative_closure_entries where merchant_id=site and operation_id=(p_command->>'disputeOperationId')::uuid;
      if ref_entry.start_event_id is distinct from start_id or ref_entry.action is distinct from 'self_dispute' then raise exception 'attendance_administrative_closure_changed';end if;
      perform public.faolla_attendance_administrative_entry_v1(ref_entry);
     end if;
    end if;
    if h.start_event_id is null then
     insert into public.merchant_attendance_administrative_closures(merchant_id,start_event_id,worker_id,employee_id,employee_auth_user_id,employment_period_id,case_scope,revision,latest_source_operation_id,closed_operation_id)
      values(site,start_id,worker,(scope_value->>'employeeId')::uuid,(scope_value->>'employeeAuthUserId')::uuid,(scope_value->>'employmentPeriodId')::uuid,scope_value,revision_value,operation_value,case when p_command->>'action'='close' then operation_value else null end) returning * into h;
    else
     update public.merchant_attendance_administrative_closures set revision=revision_value,
      latest_source_operation_id=case when p_command->>'action' in('record_unknown','close') then operation_value else latest_source_operation_id end,
      closed_operation_id=case when p_command->>'action'='close' then operation_value else closed_operation_id end where merchant_id=site and start_event_id=start_id returning * into h;
    end if;
    insert into public.merchant_attendance_administrative_closure_entries(merchant_id,start_event_id,operation_id,revision,action,actor_auth_user_id,actor_access,command,command_fingerprint,recorded_at,frame,context,source_text,source_bytes,source_sha256)
     values(site,start_id,operation_value,revision_value,p_command->>'action',p_auth_user_id,access_name,p_command,public.faolla_attendance_administrative_hash_v1(site,p_auth_user_id,access_name,p_command),stamp,
      case when source_value is not null then source_value->'frame' else null end,case when source_value is not null then source_value->'context' else null end,
      source_value->>'sourceText',(source_value->>'sourceBytes')::integer,source_value->'context'->>'sourceFingerprint') returning * into e;
    perform public.faolla_attendance_administrative_entry_v1(e);data_value:=jsonb_build_object('kind','receipt','receipt',public.faolla_attendance_administrative_receipt_v1(e));
   elsif mode_name='history' then
    if before_revision is not null and before_revision>h.revision+1 then raise exception 'attendance_invalid_request';end if;
    for e in select * from public.merchant_attendance_administrative_closure_entries where merchant_id=site and start_event_id=start_id and (before_revision is null or revision<before_revision) order by revision desc limit 26 loop
     n:=n+1;if n>25 then next_revision:=(items->-1->>'revision')::bigint;exit;end if;items:=items||jsonb_build_array(public.faolla_attendance_administrative_entry_v1(e));
    end loop;
    if jsonb_array_length(items)<>least(25,coalesce(before_revision-1,h.revision)) then raise exception 'attendance_administrative_closure_invalid';end if;
    data_value:=jsonb_build_object('kind','history','startEventId',start_id,'items',items,'nextBeforeRevision',next_revision);
   else
    if h.start_event_id is not null then
     select * into current_entry from public.merchant_attendance_administrative_closure_entries where merchant_id=site and start_event_id=start_id and revision=h.revision;
     select * into source_entry from public.merchant_attendance_administrative_closure_entries where merchant_id=site and operation_id=h.latest_source_operation_id;
     perform public.faolla_attendance_administrative_entry_v1(source_entry);summary_value:=public.faolla_attendance_administrative_summary_v1(h);boundary_value:=public.faolla_attendance_administrative_boundary_v1(site,h.worker_id,start_id);
    end if;
    if mode_name='candidate' then
     flags:=source_value->'blockers';if not coalesce(p_allow_close,false) then flags:=flags||'"feature_disabled"'::jsonb;end if;
     if h.revision=9007199254740990 then flags:=flags||'"revision_limit"'::jsonb;end if;
     if source_value->'frame'<>'null'::jsonb and h.start_event_id is not null and public.faolla_attendance_administrative_frame_v1(source_value->'frame') is distinct from h.case_scope then
      flags:=flags||'"identity_changed"'::jsonb;source_value:=source_value||jsonb_build_object('frame',null,'context',null);
     end if;
     select coalesce(jsonb_agg(value order by value),'[]'::jsonb) into flags from (select distinct value from jsonb_array_elements(flags)) unique_flags;
     can_source:=flags='[]'::jsonb;
    else
     can_dispute:=access_name='self' and h.revision<9007199254740990;
     can_respond:=access_name='owner' and h.revision<9007199254740990 and summary_value->'hasDispute'='true'::jsonb;
    end if;
    detail_value:=jsonb_build_object('summary',summary_value,'frame',case when mode_name='candidate' then source_value->'frame' else source_entry.frame end,
     'context',case when mode_name='candidate' then source_value->'context' else source_entry.context end,'evidenceOperationId',case when mode_name='candidate' then null else source_entry.operation_id end,
     'currentEntry',public.faolla_attendance_administrative_entry_v1(current_entry),'closure',boundary_value,
     'capabilities',jsonb_build_object('canRecordUnknown',can_source,'canClose',can_source,'canDispute',can_dispute,'canRespond',can_respond),'blockers',flags);
    data_value:=jsonb_build_object('kind',mode_name,'detail',detail_value);
   end if;
  end if;
 end if;
 result_value:=jsonb_build_object('protocol','attendance-administrative-closures-v1','siteId',site,'access',access_name,'actorId',p_auth_user_id,'readAt',public.faolla_attendance_administrative_stamp_v1(clock_timestamp()),'data',data_value);
 if octet_length(convert_to(result_value::text,'UTF8'))>131072 then raise exception 'attendance_administrative_closure_too_large';end if;return result_value;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'attendance_invalid_request';
end;
$$;

-- Public reports carry only structural proof, never historical Auth or reason.
-- Callers must first obtain the full value from boundary_v1, which verifies the
-- immutable source, real raw prefix and saved employee/Auth identity.
create or replace function public.faolla_attendance_administrative_report_boundary_v1(p jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select case when p is null or p='null'::jsonb then null else jsonb_build_object(
  'protocol','attendance-administrative-report-boundary-v1','operationId',p->'operationId','startEventId',p->'startEventId','startSequence',p->'startSequence','startAt',p->'startAt',
  'tailEventId',p->'tailEventId','tailSequence',p->'tailSequence','tailAction',p->'tailAction','tailOccurredAt',p->'tailOccurredAt',
  'verifiedEndAt',p->'verifiedEndAt','recordedAt',p->'recordedAt','sourceFingerprint',p->'sourceFingerprint') end;
$$;
create or replace function public.faolla_attendance_administrative_current_field_v1(p_site text,p_worker uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare b jsonb:=public.faolla_attendance_administrative_current_v1(p_site,p_worker);
begin
 return case when b is null then '{}'::jsonb else jsonb_build_object('administrativeBoundary',b) end;
end;
$$;
create or replace function public.faolla_attendance_administrative_restore_v1(p public.merchant_attendance_account_suspensions,p_detail jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare b jsonb;chain jsonb;last_period jsonb;
begin
 if p.worker_id is null then return p_detail;end if;
 b:=public.faolla_attendance_administrative_current_v1(p.merchant_id,p.worker_id);
 if b is null then return p_detail;end if;
 chain:=public.faolla_attendance_employment_chain_v1(p.merchant_id,p.worker_id,p.employee_id,p.employee_auth_user_id);last_period:=chain->'periods'->-1;
 -- An operating close cannot by itself reactivate the old employment. The
 -- existing lifecycle must first close it and establish a later open period.
 if chain->'valid' is distinct from 'true'::jsonb or chain->'limited' is distinct from 'false'::jsonb
  or last_period is null or last_period->'endsOn' is distinct from 'null'::jsonb
  or last_period->>'id'=b->>'employmentPeriodId' then
  p_detail:=jsonb_set(p_detail,'{canRestore}','false'::jsonb);
  if not(p_detail->'blockers' ? 'employment_closed') then p_detail:=jsonb_set(p_detail,'{blockers}',(p_detail->'blockers')||'"employment_closed"'::jsonb);end if;
 end if;
 return p_detail;
end;
$$;

create or replace function public.faolla_attendance_administrative_report_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare item jsonb;items jsonb:='[]';own_boundary jsonb;prior_boundary jsonb;first_event public.merchant_attendance_events%rowtype;
 affected boolean:=false;complete_totals boolean:=true;unassessed integer:=0;site text:=p->>'siteId';worker uuid:=(p->>'workerId')::uuid;
begin
 if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items')>100 then raise exception 'attendance_period_source_invalid';end if;
 for item in select value from jsonb_array_elements(p->'items') loop
  select * into first_event from public.merchant_attendance_events where merchant_id=site and worker_id=worker and id=(item->>'startEventId')::uuid;
  own_boundary:=public.faolla_attendance_administrative_boundary_v1(site,worker,first_event.id);
  prior_boundary:=public.faolla_attendance_administrative_predecessor_v1(site,worker,first_event);
  if own_boundary is not null then
   if item->'effect' is distinct from 'null'::jsonb or item->'events'->0->>'id' is distinct from own_boundary->>'startEventId'
    or item->'events'->-1->>'id' is distinct from own_boundary->>'tailEventId'
    or item->'events'->-1->'sequence' is distinct from own_boundary->'tailSequence'
    or item->'events'->-1->>'action' is distinct from own_boundary->>'tailAction' then raise exception 'attendance_period_source_invalid';end if;
   unassessed:=unassessed+1;complete_totals:=false;
  elsif item->'events'->-1->>'action' is distinct from 'clock_out' then complete_totals:=false;end if;
  affected:=affected or own_boundary is not null or prior_boundary is not null;
  items:=items||jsonb_build_array(item||jsonb_build_object('administrativeBoundary',public.faolla_attendance_administrative_report_boundary_v1(own_boundary),
   'predecessorBoundary',public.faolla_attendance_administrative_report_boundary_v1(prior_boundary)));
 end loop;
 if not affected then return p;end if;
 return p||jsonb_build_object('sourceVersion','raw-and-approved-v3','items',items,'administrativeUnassessedCount',unassessed,'totalsComplete',complete_totals);
end;
$$;

-- Server-authorized source only. Gather full proofs after the public report's
-- scope filtering and the source collector's independent identity comparison.
create or replace function public.faolla_attendance_administrative_source_result_v1(p jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare child jsonb;item jsonb;part jsonb;b jsonb;key_name text;proofs jsonb:='[]';seen uuid[]:='{}';sid uuid;
 normalized jsonb:='[]';needs_review boolean:=false;range_from timestamptz:=(p->>'fromAt')::timestamptz;range_to timestamptz:=(p->>'toAt')::timestamptz;
begin
 for child in select value from jsonb_array_elements(p->'context'->'plans'->'sessions') loop
  item:=child->'item';
  foreach key_name in array array['administrativeBoundary','predecessorBoundary'] loop
   part:=item->key_name;if part is null or part='null'::jsonb then continue;end if;sid:=(part->>'startEventId')::uuid;
   b:=public.faolla_attendance_administrative_boundary_v1(p->>'siteId',(p->>'workerId')::uuid,sid);
   if b is null or public.faolla_attendance_administrative_report_boundary_v1(b) is distinct from part
    or b->>'employeeId' is distinct from p->>'employeeId' or b->>'employeeAuthUserId' is distinct from p->>'employeeAuthUserId'
    or (b->>'recordedAt')::timestamptz>(p->>'readAt')::timestamptz then raise exception 'attendance_period_source_identity_changed';end if;
   if not(sid=any(seen)) then seen:=array_append(seen,sid);proofs:=proofs||jsonb_build_array(b);end if;
   if key_name='administrativeBoundary' and (b->>'startAt')::timestamptz<range_to and ((b->>'startAt')::timestamptz>=range_from or (b->>'verifiedEndAt')::timestamptz>range_from) then needs_review:=true;end if;
  end loop;
 end loop;
 if proofs='[]'::jsonb then return p;end if;
 if jsonb_array_length(proofs)>200 then raise exception 'attendance_period_source_too_large';end if;
 select jsonb_agg(value order by value->>'startEventId') into proofs from jsonb_array_elements(proofs);
 -- All v5 session items use one exact structural shape. Unaffected public
 -- report branches retain their old shape when no report item needs proof.
 for child in select value from jsonb_array_elements(p->'context'->'plans'->'sessions') loop
  item:=child->'item';item:=jsonb_build_object('administrativeBoundary',null,'predecessorBoundary',null)||item;
  normalized:=normalized||jsonb_build_array(jsonb_set(child,'{item}',item));
 end loop;
 p:=jsonb_set(jsonb_set(p,'{context,plans,sessions}',normalized),'{context,administrativeClosures}',proofs)||jsonb_build_object('sourceVersion','attendance-period-source-v5');
 if needs_review and not(p->'blockers' ? 'administrative_hours_unassessed') then p:=jsonb_set(p,'{blockers}',(p->'blockers')||'"administrative_hours_unassessed"'::jsonb);end if;
 return p;
end;
$$;

-- Saved v5 proof is point-read from immutable close/source evidence, not
-- recalculated from current account state, owner, grant or current collector.
create or replace function public.faolla_attendance_administrative_saved_source_v1(p jsonb,p_recorded timestamptz)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare item jsonb;child jsonb;part jsonb;full_boundary jsonb;expected jsonb;proofs jsonb;seen uuid[]:='{}';used uuid[]:='{}';sid uuid;previous_id uuid;
 key_name text;keys text[];raw_item jsonb;matched jsonb;n integer:=0;raw_unknown integer:=0;raw_complete boolean:=true;has_raw_proof boolean:=false;
 proof_limit timestamptz:=coalesce(p_recorded,clock_timestamp());
begin
 --183 validates a candidate before assigning recorded_at. A persisted artifact
 --has a NOT NULL finite recorded_at and therefore retains its original bound.
 if p->>'sourceVersion' is distinct from 'attendance-period-source-v5' or not isfinite(proof_limit)
  or public.faolla_attendance_operational_rule_object_v1(p,array['sourceVersion','siteId','workerId','employeeId','employeeAuthUserId','timeZone','fromDate','throughDate','fromAt','toAt','dayBoundaries','report','context']) is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p->'siteId','site') is distinct from true then raise exception 'attendance_period_closure_invalid';end if;
 foreach key_name in array array['workerId','employeeId','employeeAuthUserId'] loop
  if public.faolla_attendance_administrative_scalar_v1(p->key_name,'uuid') is distinct from true then raise exception 'attendance_period_closure_invalid';end if;
 end loop;
 keys:=array['pendingCorrections','missing','leave','calendar','plans','reviews','administrativeClosures'];
 foreach key_name in array array['posthoc','workArrangements','outages'] loop if p->'context' ? key_name then keys:=array_append(keys,key_name);end if;end loop;
 if public.faolla_attendance_operational_rule_object_v1(p->'context',keys) is distinct from true
  or public.faolla_attendance_operational_rule_object_v1(p->'context'->'plans',array['items','sessions']) is distinct from true
  or jsonb_typeof(p->'context'->'plans'->'sessions') is distinct from 'array' or jsonb_array_length(p->'context'->'plans'->'sessions')>100
  or jsonb_typeof(p->'context'->'administrativeClosures') is distinct from 'array' or jsonb_array_length(p->'context'->'administrativeClosures') not between 1 and 200 then raise exception 'attendance_period_closure_invalid';end if;
 proofs:=p->'context'->'administrativeClosures';
 for full_boundary in select value from jsonb_array_elements(proofs) loop
  sid:=(full_boundary->>'startEventId')::uuid;
  if sid is null or previous_id is not null and sid<=previous_id or sid=any(seen) then raise exception 'attendance_period_closure_invalid';end if;
  previous_id:=sid;seen:=array_append(seen,sid);
  expected:=public.faolla_attendance_administrative_boundary_v1(p->>'siteId',(p->>'workerId')::uuid,sid);
  if expected is null or expected is distinct from full_boundary or expected->>'employeeId' is distinct from p->>'employeeId'
   or expected->>'employeeAuthUserId' is distinct from p->>'employeeAuthUserId' or (expected->>'recordedAt')::timestamptz>proof_limit then raise exception 'attendance_period_closure_invalid';end if;
 end loop;
 for child in select value from jsonb_array_elements(p->'context'->'plans'->'sessions') loop
  item:=child->'item';
  if public.faolla_attendance_operational_rule_object_v1(item,array['startEventId','events','effect','administrativeBoundary','predecessorBoundary']) is distinct from true
   or jsonb_typeof(item->'events') is distinct from 'array' or jsonb_array_length(item->'events') not between 1 and 2002 then raise exception 'attendance_period_closure_invalid';end if;
  foreach key_name in array array['administrativeBoundary','predecessorBoundary'] loop
   part:=item->key_name;if part='null'::jsonb then continue;end if;sid:=(part->>'startEventId')::uuid;
   select value into full_boundary from jsonb_array_elements(proofs) where value->>'startEventId'=sid::text;
   if full_boundary is null or public.faolla_attendance_administrative_report_boundary_v1(full_boundary) is distinct from part then raise exception 'attendance_period_closure_invalid';end if;
   if not(sid=any(used)) then used:=array_append(used,sid);end if;
   if key_name='administrativeBoundary' then
    if item->>'startEventId' is distinct from part->>'startEventId' or item->'effect' is distinct from 'null'::jsonb
     or item->'events'->0->>'id' is distinct from part->>'startEventId' or item->'events'->0->'sequence' is distinct from part->'startSequence'
     or item->'events'->-1->>'id' is distinct from part->>'tailEventId' or item->'events'->-1->'sequence' is distinct from part->'tailSequence'
     or item->'events'->-1->>'action' is distinct from part->>'tailAction' then raise exception 'attendance_period_closure_invalid';end if;
   else
    if (item->'events'->0->>'sequence')::bigint<>(part->>'tailSequence')::bigint+1
     or (item->'events'->0->>'occurredAt')::timestamptz<(part->>'verifiedEndAt')::timestamptz then raise exception 'attendance_period_closure_invalid';end if;
   end if;
  end loop;
 end loop;
 if cardinality(used)<>cardinality(seen) then raise exception 'attendance_period_closure_invalid';end if;
 -- Canonical report events omit only actorEmployeeId. The collected sessions
 -- preserve the same raw values and public proof, including related-plan rows.
 if jsonb_typeof(p->'report'->'base'->'items') is distinct from 'array' or jsonb_array_length(p->'report'->'base'->'items')>100 then raise exception 'attendance_period_closure_invalid';end if;
 for raw_item in select value from jsonb_array_elements(p->'report'->'base'->'items') loop
  select value->'item' into matched from jsonb_array_elements(p->'context'->'plans'->'sessions') where value->'item'->>'startEventId'=raw_item->>'startEventId';
  if matched is null then raise exception 'attendance_period_closure_invalid';end if;
  if p->'report'->'base'->>'sourceVersion'='raw-and-approved-v3' then
   if raw_item is distinct from matched then raise exception 'attendance_period_closure_invalid';end if;
  elsif p->'report'->'base'->>'sourceVersion'='raw-and-approved-v2' then
   if raw_item is distinct from matched-array['administrativeBoundary','predecessorBoundary']
    or matched->'administrativeBoundary'<>'null'::jsonb or matched->'predecessorBoundary'<>'null'::jsonb then raise exception 'attendance_period_closure_invalid';end if;
  else raise exception 'attendance_period_closure_invalid';end if;
  if matched->'administrativeBoundary'<>'null'::jsonb then raw_unknown:=raw_unknown+1;raw_complete:=false;end if;
  if matched->'events'->-1->>'action'<>'clock_out' then raw_complete:=false;end if;
  has_raw_proof:=has_raw_proof or matched->'administrativeBoundary'<>'null'::jsonb or matched->'predecessorBoundary'<>'null'::jsonb;n:=n+1;
 end loop;
 if p->'report'->'base'->>'sourceVersion'='raw-and-approved-v3' then
  if not has_raw_proof or p->'report'->'base'->'administrativeUnassessedCount' is distinct from to_jsonb(raw_unknown)
   or p->'report'->'base'->'totalsComplete' is distinct from to_jsonb(raw_complete) then raise exception 'attendance_period_closure_invalid';end if;
 elsif p->'report'->'base' ?| array['administrativeUnassessedCount','totalsComplete'] then raise exception 'attendance_period_closure_invalid';end if;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'attendance_period_closure_invalid';
end;
$$;

-- The only old-function changes in195. Exact original and replacement bodies,
-- fixed counted fragments, metadata and original ACL/OID are checked together.
do $administrative_forward$
declare spec jsonb;change jsonb;fn pg_proc%rowtype;new_fn pg_proc%rowtype;ns text;body_value text;canonical_body text;definition text;
 signature text;installed boolean;expected_hash text;expected_config text[];original_acl aclitem[];original_oid oid;original_defaults text;
begin
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.faolla_schema_migrations'::regclass;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure') into installed;
 for spec in select value from jsonb_array_elements($administrative_recipes$
[
  {
    "name": "faolla_attendance_operational_punch_core_self_v1",
    "types": "text,uuid,jsonb,uuid,jsonb",
    "source": "193recipe:202610020111_merchant_attendance_self_clock_identity.sql",
    "oldHash": "da1230e51a61288cc208211df474c9d2c296cd304161fd6733209c6eedc27bf9",
    "newHash": "f973638ea35c96cc4b985f38be28944cb14b4431faf25f9257224385b6dae02a",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "when v_last.id is null or v_last.action='clock_out' then 'off'",
        "to": "when v_last.id is null or v_last.action='clock_out' or public.faolla_attendance_administrative_current_v1(p_site_id,v_worker.id) is not null then 'off'",
        "count": 1
      },
      {
        "from": "'state',jsonb_build_object('sequence',v_sequence,'status',v_status,'lastEvent',public.faolla_attendance_event_receipt_v1(v_last))",
        "to": "'state',public.faolla_attendance_operating_head_v1(p_site_id,v_worker.id)",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_operational_punch_core_pin_v1",
    "types": "text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb",
    "source": "193recipe:202610020112_merchant_attendance_pin_clock_identity.sql",
    "oldHash": "f8952e91900866a9325ac0f2f1bf185cf84a13bfc7e5a13a9b9c21336833e029",
    "newHash": "efb61fde492e2ff04de46ee6ab132fcdd01a2dc1494b8d87da6b8c24c7c89580",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "when last_row.id is null or last_row.action='clock_out' then 'off'",
        "to": "when last_row.id is null or last_row.action='clock_out' or public.faolla_attendance_administrative_current_v1(p_site,w.id) is not null then 'off'",
        "count": 1
      },
      {
        "from": "'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row))",
        "to": "'state',public.faolla_attendance_operating_head_v1(p_site,w.id)",
        "count": 2
      }
    ]
  },
  {
    "name": "faolla_attendance_operational_punch_core_onsite_v1",
    "types": "text,uuid,jsonb,jsonb,uuid,boolean,jsonb",
    "source": "193recipe:202610010108_merchant_attendance_onsite_qr.sql",
    "oldHash": "fb4ef0bd317c450c52821d4c70c6a6756b0c2c9a0016a7c4e768947638deb98c",
    "newHash": "69dc67947b006f51b6ff278bd792eda134343666371a49cda5d677be7d9372ab",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "when last_row.id is null or last_row.action='clock_out' then 'off'",
        "to": "when last_row.id is null or last_row.action='clock_out' or public.faolla_attendance_administrative_current_v1(p_site,w.id) is not null then 'off'",
        "count": 1
      },
      {
        "from": "'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row))",
        "to": "'state',public.faolla_attendance_operating_head_v1(p_site,w.id)",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_operational_punch_core_location_v1",
    "types": "text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb",
    "source": "193recipe:202609300072_merchant_attendance_location_clock.sql",
    "oldHash": "388a36bcead29109e22b0be3b2eb514dc195e50863dcb5ae679859bf3259ec76",
    "newHash": "119ae50e697c068a27aeab6343db303faf7383ac9f1f06da65dcea187c6170ef",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "when v_last.id is null or v_last.action='clock_out' then 'off'",
        "to": "when v_last.id is null or v_last.action='clock_out' or public.faolla_attendance_administrative_current_v1(p_site_id,v_worker.id) is not null then 'off'",
        "count": 1
      },
      {
        "from": "'state',jsonb_build_object('sequence',v_sequence,'status',v_status,'lastEvent',public.faolla_attendance_event_receipt_v1(v_last))",
        "to": "'state',public.faolla_attendance_operating_head_v1(p_site_id,v_worker.id)",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_pin_schedule_v1",
    "types": "text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean",
    "source": "193recipe:202610050143_merchant_attendance_pin_schedule.sql",
    "oldHash": "7de7672594013ab90d78a44bf704e5e2e9870fd052fe4fbc0c236fc8fb7f454e",
    "newHash": "bf2960c1c02831214ef55e9086dd692f7c3c4df16d7d1ebe02cb1fc7797cb1f4",
    "securityDefiner": true,
    "serviceExecute": true,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "when last_row.id is null or last_row.action='clock_out' then 'off'",
        "to": "when last_row.id is null or last_row.action='clock_out' or public.faolla_attendance_administrative_current_v1(p_site,w.id) is not null then 'off'",
        "count": 1
      },
      {
        "from": "'state',jsonb_build_object('sequence',seq,'status',status_now,'lastEvent',public.faolla_attendance_event_receipt_v1(last_row))",
        "to": "'state',public.faolla_attendance_operating_head_v1(p_site,w.id)",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_operational_punch_core_location_v2",
    "types": "text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb",
    "source": "193recipe:202610020113_merchant_attendance_location_receipt_identity.sql",
    "oldHash": "628cfefc46d9216568da94dcb3904ec55ab649e1d81d435cf1b6f1ad2b0cf04a",
    "newHash": "8e100afb65a53d2b042297419aeb50419033011158e4e7a4671929259bd595b2",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "last_fact.id is not null and last_fact.action<>'clock_out' and",
        "to": "last_fact.id is not null and last_fact.action<>'clock_out' and public.faolla_attendance_administrative_current_v1(p_site_id,w.id) is null and",
        "count": 2
      }
    ]
  },
  {
    "name": "faolla_attendance_operational_punch_current_start_v1",
    "types": "text,uuid",
    "source": "202610080193_merchant_attendance_operational_punch.sql",
    "oldHash": "6fa51cfaa09299ee867150212816c20a11070e656b4c146a80f6a79bf3da05c8",
    "newHash": "f6b47de540399f78360ffb1b24a4597a01878807825ca1cbaca820aebf39db01",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "s",
    "resultType": "uuid",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "if last_fact.id is null or last_fact.action='clock_out' then return null;end if;",
        "to": "if last_fact.id is null or last_fact.action='clock_out' or public.faolla_attendance_administrative_current_v1(p_site,p_worker) is not null then return null;end if;",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_employment_detail_v1",
    "types": "text,uuid",
    "source": "202610060166_merchant_attendance_employment_lifecycle.sql",
    "oldHash": "4975898c9828bad8662e2d9d3d3f07caf527e16b92ad006021152238b75c56ae",
    "newHash": "2e568e46b05049bf866e2dae1f3776b1fb43d80f701655e0f79e6abff3e51d7a",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "if ev.id is not null and ev.action<>'clock_out' then base:=base||'\"open_session\"'::jsonb;end if;",
        "to": "if ev.id is not null and ev.action<>'clock_out' and public.faolla_attendance_administrative_current_v1(p_site,p_worker) is null then base:=base||'\"open_session\"'::jsonb;end if;",
        "count": 1
      },
      {
        "from": "'closeBlockers',cb,'rejoinBlockers',rb,'pending',jsonb_build_object('items',pending,'limited',limited,'historicalPending','not_checked'));",
        "to": "'closeBlockers',cb,'rejoinBlockers',rb,'pending',jsonb_build_object('items',pending,'limited',limited,'historicalPending','not_checked'))\n    || public.faolla_attendance_administrative_current_field_v1(p_site,p_worker);",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_account_detail_v1",
    "types": "public.merchant_attendance_account_suspensions",
    "source": "202610060166_merchant_attendance_employment_lifecycle.sql",
    "oldHash": "5febd1032b23026d4752757b17da831081e2f919d40b4554ca4d25c5be6746df",
    "newHash": "dbfec5c7ad10bf6fb45e5c441cf446d35cc6de83fe853d5cbba7ddac13707f17",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "  return result_json;",
        "to": "  return public.faolla_attendance_administrative_restore_v1(p,result_json);",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_self_session_v1",
    "types": "text,uuid,uuid",
    "source": "202610020110_merchant_attendance_self_history_identity.sql",
    "oldHash": "9d453f3cb731d0fef5070fe359d8eba9f79969c8cf11c0fcc1769c0d51c9beb3",
    "newHash": "18d0e7fb4e9ddb37a55d4f28fa49931649c24444faaeb994c9d86b5bb5fae92c",
    "securityDefiner": true,
    "serviceExecute": true,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "  v_rows jsonb;v_now timestamptz;v_end_sequence bigint;v_identity_unconfirmed boolean;",
        "to": "  v_rows jsonb;v_now timestamptz;v_end_sequence bigint;v_identity_unconfirmed boolean;\n  administrative_value jsonb;predecessor_value jsonb;",
        "count": 1
      },
      {
        "from": "  v_now:=clock_timestamp();",
        "to": "  v_now:=clock_timestamp();\n  administrative_value:=public.faolla_attendance_administrative_boundary_v1(p_site_id,v_worker.id,p_start_event_id);\n  predecessor_value:=public.faolla_attendance_administrative_predecessor_v1(p_site_id,v_worker.id,v_start);\n  if administrative_value is not null and (administrative_value->>'employeeId' is distinct from v_employee.id::text or administrative_value->>'employeeAuthUserId' is distinct from p_auth_user_id::text)\n    or predecessor_value is not null and predecessor_value->>'employeeAuthUserId' is distinct from p_auth_user_id::text then raise exception 'attendance_session_not_found';end if;",
        "count": 1
      },
      {
        "from": "  ) segment where action='clock_out' order by sequence limit 1;",
        "to": "  ) segment where action='clock_out' order by sequence limit 1;\n  if administrative_value is not null then v_end_sequence:=(administrative_value->>'tailSequence')::bigint;end if;",
        "count": 1
      },
      {
        "from": "  if v_start.sequence>1 and not exists(select 1 from public.merchant_attendance_events\n    where merchant_id=p_site_id and worker_id=v_worker.id and sequence=v_start.sequence-1 and action='clock_out')\n    then raise exception 'attendance_session_invalid_records';end if;",
        "to": "  -- Predecessor proof was checked without replacing any raw event above.",
        "count": 1
      },
      {
        "from": "'events',v_rows);",
        "to": "'events',v_rows)||case when administrative_value is not null or predecessor_value is not null then jsonb_build_object(\n      'administrativeBoundary',public.faolla_attendance_administrative_report_boundary_v1(administrative_value),'predecessorBoundary',public.faolla_attendance_administrative_report_boundary_v1(predecessor_value)) else '{}'::jsonb end;",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_session_v1",
    "types": "text,uuid,uuid,uuid,uuid,timestamp with time zone",
    "source": "202610050148_merchant_attendance_period_source.sql",
    "oldHash": "edf0415029ea7e2adbca4a35140aaff5db683a0e6652d3d88c24528cf523870c",
    "newHash": "d23cef1c4a301f655e3e9d43425671c0b56c5a598062302d25f851b3071d23e2",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;predecessor_value jsonb;\n",
        "count": 1
      },
      {
        "from": "  if first_event.sequence>1 and not exists(select 1 from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=p_worker\n    and x.sequence=first_event.sequence-1 and x.action='clock_out') then raise exception 'attendance_period_source_invalid';end if;",
        "to": "  administrative_value:=public.faolla_attendance_administrative_boundary_v1(p_site,p_worker,p_start);\n  predecessor_value:=public.faolla_attendance_administrative_predecessor_v1(p_site,p_worker,first_event);\n  if administrative_value is not null and (administrative_value->>'employeeId' is distinct from p_employee::text or administrative_value->>'employeeAuthUserId' is distinct from p_member_auth::text or (administrative_value->>'recordedAt')::timestamptz>p_observed)\n    or predecessor_value is not null and (predecessor_value->>'employeeAuthUserId' is distinct from p_member_auth::text or (predecessor_value->>'recordedAt')::timestamptz>p_observed) then raise exception 'attendance_period_source_identity_changed';end if;",
        "count": 1
      },
      {
        "from": "  if not proof then raise exception 'attendance_period_source_identity_unproven';end if;",
        "to": "  -- A real checked administrative close is independent identity evidence for\n  -- its own saved raw prefix, never a fabricated135/137 binding.\n  if administrative_value is not null then proof:=true;end if;\n  if not proof then raise exception 'attendance_period_source_identity_unproven';end if;",
        "count": 1
      },
      {
        "from": "and x.sequence>=first_event.sequence order by x.sequence limit 2003);",
        "to": "and x.sequence>=first_event.sequence and (administrative_value is null or x.sequence<=(administrative_value->>'tailSequence')::bigint) order by x.sequence limit 2003);",
        "count": 1
      },
      {
        "from": "  if state_name<>'completed' and not exists",
        "to": "  if administrative_value is not null and (last_id::text is distinct from administrative_value->>'tailEventId' or state_name='completed') then raise exception 'attendance_period_source_invalid';end if;\n  if state_name<>'completed' and administrative_value is null and not exists",
        "count": 1
      },
      {
        "from": "  return jsonb_build_object('item',jsonb_build_object('startEventId',p_start,'events',events,'effect',effect_item),'ruleBinding',binding,'relation',relation,'adoption',adoption,'planRuleApproval',plan_rule);",
        "to": "  return jsonb_build_object('item',jsonb_build_object('startEventId',p_start,'events',events,'effect',effect_item)\n    ||case when administrative_value is not null or predecessor_value is not null then jsonb_build_object('administrativeBoundary',public.faolla_attendance_administrative_report_boundary_v1(administrative_value),\n      'predecessorBoundary',public.faolla_attendance_administrative_report_boundary_v1(predecessor_value)) else '{}'::jsonb end,\n    'ruleBinding',binding,'relation',relation,'adoption',adoption,'planRuleApproval',plan_rule);",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_report_v2",
    "types": "text,uuid,jsonb",
    "source": "202610050153_merchant_attendance_period_session_capacity.sql",
    "oldHash": "9c98806622a8f997ced37f7e83aaf548bd3ca04524ce55775c2828ba3639f389",
    "newHash": "ca4922cc69e1549559852731a0a480453efc79ad357ce6263822c9d17fc30d0c",
    "securityDefiner": true,
    "serviceExecute": true,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events\n      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;",
        "to": "    if e.action<>'clock_in' or e.occurred_at>now_at then raise exception 'attendance_session_invalid_records';end if;\n    perform public.faolla_attendance_administrative_predecessor_v1(p_site_id,worker,e);\n    administrative_value:=public.faolla_attendance_administrative_boundary_v1(p_site_id,worker,e.id);",
        "count": 1
      },
      {
        "from": "      where action='clock_out' order by sequence limit 1;",
        "to": "      where action='clock_out' order by sequence limit 1;\n    if administrative_value is not null then end_sequence:=(administrative_value->>'tailSequence')::bigint;end if;",
        "count": 1
      },
      {
        "from": "raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else",
        "to": "raw_relevant:=e.occurred_at<to_at and (case when administrative_value is not null then e.occurred_at>=from_at or (administrative_value->>'verifiedEndAt')::timestamptz>from_at when end_sequence is null then now_at>from_at else",
        "count": 1
      },
      {
        "from": "  if octet_length(result::text)>1048576",
        "to": "  result:=public.faolla_attendance_administrative_report_v1(result);\n  if octet_length(result::text)>1048576",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_scoped_period_report_v2",
    "types": "text,uuid,jsonb",
    "source": "202610050153_merchant_attendance_period_session_capacity.sql",
    "oldHash": "d1b80ca099de46d8903e1e9277d81f6ea34982b37171d40bdc8b512ab18802b5",
    "newHash": "d4038ad2ac9319c3d5a4c013c90c996dab632b059f11f37d6c50b633c8581b6a",
    "securityDefiner": true,
    "serviceExecute": true,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events\n      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;",
        "to": "    if e.action<>'clock_in' or e.occurred_at>now_at then raise exception 'attendance_session_invalid_records';end if;\n    perform public.faolla_attendance_administrative_predecessor_v1(p_site_id,worker,e);\n    administrative_value:=public.faolla_attendance_administrative_boundary_v1(p_site_id,worker,e.id);",
        "count": 1
      },
      {
        "from": "      where action='clock_out' order by sequence limit 1;",
        "to": "      where action='clock_out' order by sequence limit 1;\n    if administrative_value is not null then end_sequence:=(administrative_value->>'tailSequence')::bigint;end if;",
        "count": 1
      },
      {
        "from": "raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else",
        "to": "raw_relevant:=e.occurred_at<to_at and (case when administrative_value is not null then e.occurred_at>=from_at or (administrative_value->>'verifiedEndAt')::timestamptz>from_at when end_sequence is null then now_at>from_at else",
        "count": 1
      },
      {
        "from": "  if octet_length(result::text)>1048576",
        "to": "  result:=public.faolla_attendance_administrative_report_v1(result);\n  if octet_length(result::text)>1048576",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_closure_report_v1",
    "types": "text,uuid,jsonb,jsonb",
    "source": "202610050155_merchant_attendance_period_fixed_boundaries.sql",
    "oldHash": "7b5afdd059188deb1edd06668b308b4830b1937b4ca904f90e527535660001bf",
    "newHash": "a5bb3f899956b4180af063e2599772fd8841268e09a0ead7f896ccfb34a188e4",
    "securityDefiner": true,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events\n      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;",
        "to": "    if e.action<>'clock_in' or e.occurred_at>now_at then raise exception 'attendance_session_invalid_records';end if;\n    perform public.faolla_attendance_administrative_predecessor_v1(p_site_id,worker,e);\n    administrative_value:=public.faolla_attendance_administrative_boundary_v1(p_site_id,worker,e.id);",
        "count": 1
      },
      {
        "from": "      where action='clock_out' order by sequence limit 1;",
        "to": "      where action='clock_out' order by sequence limit 1;\n    if administrative_value is not null then end_sequence:=(administrative_value->>'tailSequence')::bigint;end if;",
        "count": 1
      },
      {
        "from": "raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else",
        "to": "raw_relevant:=e.occurred_at<to_at and (case when administrative_value is not null then e.occurred_at>=from_at or (administrative_value->>'verifiedEndAt')::timestamptz>from_at when end_sequence is null then now_at>from_at else",
        "count": 1
      },
      {
        "from": "  if octet_length(result::text)>1048576",
        "to": "  result:=public.faolla_attendance_administrative_report_v1(result);\n  if octet_length(result::text)>1048576",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_closure_scoped_report_v1",
    "types": "text,uuid,jsonb,jsonb",
    "source": "202610050155_merchant_attendance_period_fixed_boundaries.sql",
    "oldHash": "c91507c9beb592495338f9e27ac2cb36911b4745f5b59eb7366773f05e7d3c25",
    "newHash": "b8f20e1682b2529762a66836ce0e075f7e715d3a7ccbf7cc5475a14640d29d62",
    "securityDefiner": true,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events\n      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;",
        "to": "    if e.action<>'clock_in' or e.occurred_at>now_at then raise exception 'attendance_session_invalid_records';end if;\n    perform public.faolla_attendance_administrative_predecessor_v1(p_site_id,worker,e);\n    administrative_value:=public.faolla_attendance_administrative_boundary_v1(p_site_id,worker,e.id);",
        "count": 1
      },
      {
        "from": "      where action='clock_out' order by sequence limit 1;",
        "to": "      where action='clock_out' order by sequence limit 1;\n    if administrative_value is not null then end_sequence:=(administrative_value->>'tailSequence')::bigint;end if;",
        "count": 1
      },
      {
        "from": "raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else",
        "to": "raw_relevant:=e.occurred_at<to_at and (case when administrative_value is not null then e.occurred_at>=from_at or (administrative_value->>'verifiedEndAt')::timestamptz>from_at when end_sequence is null then now_at>from_at else",
        "count": 1
      },
      {
        "from": "  if octet_length(result::text)>1048576",
        "to": "  result:=public.faolla_attendance_administrative_report_v1(result);\n  if octet_length(result::text)>1048576",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_pd_report_v1",
    "types": "text,uuid,jsonb",
    "source": "202610080184_merchant_attendance_period_delegated_source.sql",
    "oldHash": "dec5e9cf5233ac99fe1f5b0321928c0be82ff5a0cec1a1bac77a13f43c371451",
    "newHash": "0487d80ce4836d51e778859f7aff3b77513c8907e537c87a8a07a096f4b9047f",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events\n      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;",
        "to": "    if e.action<>'clock_in' or e.occurred_at>now_at then raise exception 'attendance_session_invalid_records';end if;\n    perform public.faolla_attendance_administrative_predecessor_v1(p_site_id,worker,e);\n    administrative_value:=public.faolla_attendance_administrative_boundary_v1(p_site_id,worker,e.id);",
        "count": 1
      },
      {
        "from": "      where action='clock_out' order by sequence limit 1;",
        "to": "      where action='clock_out' order by sequence limit 1;\n    if administrative_value is not null then end_sequence:=(administrative_value->>'tailSequence')::bigint;end if;",
        "count": 1
      },
      {
        "from": "raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else",
        "to": "raw_relevant:=e.occurred_at<to_at and (case when administrative_value is not null then e.occurred_at>=from_at or (administrative_value->>'verifiedEndAt')::timestamptz>from_at when end_sequence is null then now_at>from_at else",
        "count": 1
      },
      {
        "from": "  if octet_length(result::text)>1048576",
        "to": "  result:=public.faolla_attendance_administrative_report_v1(result);\n  if octet_length(result::text)>1048576",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_pd_fixed_report_v1",
    "types": "text,uuid,jsonb,jsonb",
    "source": "202610080184_merchant_attendance_period_delegated_source.sql",
    "oldHash": "49a60f91bf7a6a3f1467e90da6d0d6dda2daa928d33c08352f4ebbc6620d0368",
    "newHash": "36edf92610905cfce2a1c9eb2f89594dd6387abd00323f01f77baaa09d261e2a",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    if e.action<>'clock_in' or e.occurred_at>now_at or (e.sequence>1 and not exists(select 1 from public.merchant_attendance_events\n      where merchant_id=p_site_id and worker_id=worker and sequence=e.sequence-1 and action='clock_out')) then raise exception 'attendance_session_invalid_records';end if;",
        "to": "    if e.action<>'clock_in' or e.occurred_at>now_at then raise exception 'attendance_session_invalid_records';end if;\n    perform public.faolla_attendance_administrative_predecessor_v1(p_site_id,worker,e);\n    administrative_value:=public.faolla_attendance_administrative_boundary_v1(p_site_id,worker,e.id);",
        "count": 1
      },
      {
        "from": "      where action='clock_out' order by sequence limit 1;",
        "to": "      where action='clock_out' order by sequence limit 1;\n    if administrative_value is not null then end_sequence:=(administrative_value->>'tailSequence')::bigint;end if;",
        "count": 1
      },
      {
        "from": "raw_relevant:=e.occurred_at<to_at and (case when end_sequence is null then now_at>from_at else",
        "to": "raw_relevant:=e.occurred_at<to_at and (case when administrative_value is not null then e.occurred_at>=from_at or (administrative_value->>'verifiedEndAt')::timestamptz>from_at when end_sequence is null then now_at>from_at else",
        "count": 1
      },
      {
        "from": "  if octet_length(result::text)>1048576",
        "to": "  result:=public.faolla_attendance_administrative_report_v1(result);\n  if octet_length(result::text)>1048576",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_source_v1",
    "types": "jsonb,uuid",
    "source": "202610060175_merchant_attendance_plan_posthoc_periods.sql",
    "oldHash": "9bb7f3abfaf07c110b33286950d347bab5b94874a35a6d459aef409bf341d4ca",
    "newHash": "8dfbf0caff5c44a3c2af91b476d6eabcf66b12b1abd8543d658bf1b921d1d29e",
    "securityDefiner": true,
    "serviceExecute": true,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    select * into endpoint from",
        "to": "    administrative_value:=public.faolla_attendance_administrative_boundary_v1(site,wid,ev.id);\n    select * into endpoint from",
        "count": 1
      },
      {
        "from": "coalesce(endpoint.occurred_at,observed)>range_from",
        "to": "coalesce((administrative_value->>'verifiedEndAt')::timestamptz,endpoint.occurred_at,observed)>range_from",
        "count": 1
      },
      {
        "from": "if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;",
        "to": "if child->'item'->'events'->-1->>'action'<>'clock_out' and coalesce(child->'item'->'administrativeBoundary','null'::jsonb)='null'::jsonb then flags:=array_append(flags,'open_session');end if;",
        "count": 2
      },
      {
        "from": "  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;",
        "to": "  result:=public.faolla_attendance_administrative_source_result_v1(result);\n  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_closure_source_base_v1",
    "types": "jsonb,uuid",
    "source": "202610070179_merchant_attendance_outage_periods.sql",
    "oldHash": "512322083cd3b668f41d44322dec10f65b322388c8c4a470f34c5c691ba9eeb1",
    "newHash": "36a8dc6972a19c674d03ac99563bc5d082cd83bfb14473c5ed6be8ce700f0d07",
    "securityDefiner": true,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    select * into endpoint from",
        "to": "    administrative_value:=public.faolla_attendance_administrative_boundary_v1(site,wid,ev.id);\n    select * into endpoint from",
        "count": 1
      },
      {
        "from": "coalesce(endpoint.occurred_at,observed)>range_from",
        "to": "coalesce((administrative_value->>'verifiedEndAt')::timestamptz,endpoint.occurred_at,observed)>range_from",
        "count": 1
      },
      {
        "from": "if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;",
        "to": "if child->'item'->'events'->-1->>'action'<>'clock_out' and coalesce(child->'item'->'administrativeBoundary','null'::jsonb)='null'::jsonb then flags:=array_append(flags,'open_session');end if;",
        "count": 2
      },
      {
        "from": "  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;",
        "to": "  result:=public.faolla_attendance_administrative_source_result_v1(result);\n  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;",
        "count": 1
      },
      {
        "from": "'attendance-period-source-v3','attendance-period-source-v4')",
        "to": "'attendance-period-source-v3','attendance-period-source-v4','attendance-period-source-v5')",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_pd_source_v1",
    "types": "jsonb,uuid",
    "source": "202610080184_merchant_attendance_period_delegated_source.sql",
    "oldHash": "2f81f478bbc10f4831c53938a74c1617e293928c2534f231423674af84247ea5",
    "newHash": "ff93e8c242fceee3e75696d48cbc7fca0ef29b4b8e872c871eff5be7469d694f",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    select * into endpoint from",
        "to": "    administrative_value:=public.faolla_attendance_administrative_boundary_v1(site,wid,ev.id);\n    select * into endpoint from",
        "count": 1
      },
      {
        "from": "coalesce(endpoint.occurred_at,observed)>range_from",
        "to": "coalesce((administrative_value->>'verifiedEndAt')::timestamptz,endpoint.occurred_at,observed)>range_from",
        "count": 1
      },
      {
        "from": "if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;",
        "to": "if child->'item'->'events'->-1->>'action'<>'clock_out' and coalesce(child->'item'->'administrativeBoundary','null'::jsonb)='null'::jsonb then flags:=array_append(flags,'open_session');end if;",
        "count": 2
      },
      {
        "from": "  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;",
        "to": "  result:=public.faolla_attendance_administrative_source_result_v1(result);\n  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_pd_fixed_source_v1",
    "types": "jsonb,uuid",
    "source": "202610080184_merchant_attendance_period_delegated_source.sql",
    "oldHash": "bc3d453f954be5dfc3624992ae0cc803bbec9d943322b82737775f830c355631",
    "newHash": "4fd9583e075dd69bf90fc1c59b5af13658709ea8629f5623e73f43affec3c08a",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;\n",
        "count": 1
      },
      {
        "from": "    select * into endpoint from",
        "to": "    administrative_value:=public.faolla_attendance_administrative_boundary_v1(site,wid,ev.id);\n    select * into endpoint from",
        "count": 1
      },
      {
        "from": "coalesce(endpoint.occurred_at,observed)>range_from",
        "to": "coalesce((administrative_value->>'verifiedEndAt')::timestamptz,endpoint.occurred_at,observed)>range_from",
        "count": 1
      },
      {
        "from": "if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;",
        "to": "if child->'item'->'events'->-1->>'action'<>'clock_out' and coalesce(child->'item'->'administrativeBoundary','null'::jsonb)='null'::jsonb then flags:=array_append(flags,'open_session');end if;",
        "count": 2
      },
      {
        "from": "  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;",
        "to": "  result:=public.faolla_attendance_administrative_source_result_v1(result);\n  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;",
        "count": 1
      },
      {
        "from": "'attendance-period-source-v3','attendance-period-source-v4')",
        "to": "'attendance-period-source-v3','attendance-period-source-v4','attendance-period-source-v5')",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_closure_source_v1",
    "types": "jsonb,uuid",
    "source": "202610070179_merchant_attendance_outage_periods.sql",
    "oldHash": "a89321433586376f607a9277306803ff363f43d07b157a1bc40f7aaf08be0f24",
    "newHash": "f8e5831cc525021f0c26e833128bdcb2ec602bf7ad93289101440c3eb3061b3b",
    "securityDefiner": true,
    "serviceExecute": true,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "case when result->>'sourceVersion'='attendance-period-source-v3' then 'attendance-period-source-v3' else 'attendance-period-source-v2' end",
        "to": "case when result->>'sourceVersion' in('attendance-period-source-v3','attendance-period-source-v5') then result->>'sourceVersion' else 'attendance-period-source-v2' end",
        "count": 1
      },
      {
        "from": "jsonb_build_object('sourceVersion','attendance-period-source-v4')",
        "to": "jsonb_build_object('sourceVersion',case when result->>'sourceVersion'='attendance-period-source-v5' then 'attendance-period-source-v5' else 'attendance-period-source-v4' end)",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_pd_envelope_v1",
    "types": "jsonb,uuid",
    "source": "202610080184_merchant_attendance_period_delegated_source.sql",
    "oldHash": "638f45c85375206e9586f5409faca10bf29af5ecfb55ffd850fdef0dd7b2fc98",
    "newHash": "ceecd0c565d450544ea880040a4bcffb0c7eecedd7d85efb2f7aa51ebea93ec5",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "case when result->>'sourceVersion'='attendance-period-source-v3' then 'attendance-period-source-v3' else 'attendance-period-source-v2' end",
        "to": "case when result->>'sourceVersion' in('attendance-period-source-v3','attendance-period-source-v5') then result->>'sourceVersion' else 'attendance-period-source-v2' end",
        "count": 1
      },
      {
        "from": "jsonb_build_object('sourceVersion','attendance-period-source-v4')",
        "to": "jsonb_build_object('sourceVersion',case when result->>'sourceVersion'='attendance-period-source-v5' then 'attendance-period-source-v5' else 'attendance-period-source-v4' end)",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_artifact_shape_v2",
    "types": "public.merchant_attendance_period_artifacts",
    "source": "202610080186_merchant_attendance_period_delegated_artifacts.sql",
    "oldHash": "1bd3d764c31e8ff8c45a6a0e9147e39a9d4778fbb97bd50bb97d47d5a710f307",
    "newHash": "236910b6622f37a0a7a5988537ed1a68f92813f5f3cfe615806dbb1c5a1f4252",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "'attendance-period-source-v3','attendance-period-source-v4')",
        "to": "'attendance-period-source-v3','attendance-period-source-v4','attendance-period-source-v5')",
        "count": 1
      },
      {
        "from": "  return a;",
        "to": "  if src->>'sourceVersion'='attendance-period-source-v5' then\n    perform public.faolla_attendance_administrative_saved_source_v1(src,p.recorded_at);\n  end if;\n  return a;",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_period_artifact_checked_v1",
    "types": "public.merchant_attendance_period_artifacts",
    "source": "202610080186_merchant_attendance_period_delegated_artifacts.sql",
    "oldHash": "b44c3b760df3062d9f168fe8a6102c1585f6eb0f952a6b075c43284bf422aba8",
    "newHash": "e2abc95dfa6ef03c240a355908aec797166004e4919f036a227e9507f40000b9",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "  -- Saved bytes are checked directly, never regenerated from JSONB or tzdata.\n  return a;",
        "to": "  -- Saved bytes are checked directly, never regenerated from JSONB or tzdata.\n  if a->'source'->>'sourceVersion'='attendance-period-source-v5' then\n    if a->'source'->>'siteId' is distinct from p.merchant_id or a->'source'->>'workerId' is distinct from a->'worker'->>'workerId'\n      or a->'source'->>'employeeId' is distinct from a->'worker'->>'employeeId' or a->'source'->>'employeeAuthUserId' is distinct from a->'worker'->>'employeeAuthUserId'\n      or p.source_fingerprint is distinct from encode(sha256(convert_to((a->'source')::text,'UTF8')),'hex') then raise exception 'attendance_period_closure_invalid';end if;\n    perform public.faolla_attendance_administrative_saved_source_v1(a->'source',p.recorded_at);\n  end if;\n  return a;",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_retention_source_v1",
    "types": "text,text,uuid",
    "source": "202610080183_merchant_attendance_period_continuation.sql",
    "oldHash": "c754eee9f2374eb17a962ca5e42d12bf3ad4de028dd94015c9ca02e9e8e75f4c",
    "newHash": "f321927d58a9bcc773ab8186a67fdc291be23132b982d7a6c6dd316300074f7d",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "s",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog",
      "extra_float_digits=3"
    ],
    "changes": [
      {
        "from": "'attendance-period-source-v3','attendance-period-source-v4')",
        "to": "'attendance-period-source-v3','attendance-period-source-v4','attendance-period-source-v5')",
        "count": 1
      }
    ]
  }
,
  {
    "name": "faolla_attendance_shift_check_v1",
    "types": "jsonb,uuid",
    "source": "202610050143_merchant_attendance_pin_schedule.sql",
    "oldHash": "54632325e0d569c9835dfadc628632115c2f13a86c0466e852906a3f426bcfb0",
    "newHash": "e08de457e5288513a0b53b8ed705fa4fe4369b0f5d81757c64dd93e935070956",
    "securityDefiner": true,
    "serviceExecute": true,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;predecessor_value jsonb;\n",
        "count": 1
      },
      {
        "from": "  if first_event.sequence>1 and not exists(select 1 from public.merchant_attendance_events x\n    where x.merchant_id=site and x.worker_id=wid and x.sequence=first_event.sequence-1 and x.action='clock_out') then\n    raise exception 'attendance_shift_check_invalid';end if;",
        "to": "  administrative_value:=public.faolla_attendance_administrative_boundary_v1(site,wid,eid);\n  predecessor_value:=public.faolla_attendance_administrative_predecessor_v1(site,wid,first_event);\n  if administrative_value is not null and (administrative_value->>'employeeId' is distinct from employee::text or administrative_value->>'employeeAuthUserId' is distinct from member_auth::text)\n    or predecessor_value is not null and predecessor_value->>'employeeAuthUserId' is distinct from member_auth::text then raise exception 'attendance_shift_rule_binding_identity_changed';end if;",
        "count": 1
      },
      {
        "from": "and x.sequence>=first_event.sequence order by x.sequence limit 2003);",
        "to": "and x.sequence>=first_event.sequence and (administrative_value is null or x.sequence<=(administrative_value->>'tailSequence')::bigint) order by x.sequence limit 2003);",
        "count": 1
      },
      {
        "from": "  if state_name<>'completed' then\n",
        "to": "  if administrative_value is not null and (last_id::text is distinct from administrative_value->>'tailEventId' or previous_sequence is distinct from (administrative_value->>'tailSequence')::bigint or state_name='completed') then raise exception 'attendance_shift_check_invalid';end if;\n  if state_name<>'completed' and administrative_value is null then\n",
        "count": 1
      }
    ]
  },
  {
    "name": "faolla_attendance_pd_shift_v1",
    "types": "jsonb,uuid",
    "source": "202610080184_merchant_attendance_period_delegated_source.sql",
    "oldHash": "93e34a5b9e5a4063a708829c94d2e89fdbe636422863f03336e94db74aeb138a",
    "newHash": "95e9440e1aa03cdc31afd21356160ab6f205a887dc32228da1a9ac7d268d7a9b",
    "securityDefiner": false,
    "serviceExecute": false,
    "volatility": "v",
    "resultType": "jsonb",
    "config": [
      "search_path=pg_catalog"
    ],
    "changes": [
      {
        "from": "declare\n",
        "to": "declare\n  administrative_value jsonb;predecessor_value jsonb;\n",
        "count": 1
      },
      {
        "from": "  if first_event.sequence>1 and not exists(select 1 from public.merchant_attendance_events x\n    where x.merchant_id=site and x.worker_id=wid and x.sequence=first_event.sequence-1 and x.action='clock_out') then\n    raise exception 'attendance_shift_check_invalid';end if;",
        "to": "  administrative_value:=public.faolla_attendance_administrative_boundary_v1(site,wid,eid);\n  predecessor_value:=public.faolla_attendance_administrative_predecessor_v1(site,wid,first_event);\n  if administrative_value is not null and (administrative_value->>'employeeId' is distinct from employee::text or administrative_value->>'employeeAuthUserId' is distinct from member_auth::text)\n    or predecessor_value is not null and predecessor_value->>'employeeAuthUserId' is distinct from member_auth::text then raise exception 'attendance_shift_rule_binding_identity_changed';end if;",
        "count": 1
      },
      {
        "from": "and x.sequence>=first_event.sequence order by x.sequence limit 2003);",
        "to": "and x.sequence>=first_event.sequence and (administrative_value is null or x.sequence<=(administrative_value->>'tailSequence')::bigint) order by x.sequence limit 2003);",
        "count": 1
      },
      {
        "from": "  if state_name<>'completed' then\n",
        "to": "  if administrative_value is not null and (last_id::text is distinct from administrative_value->>'tailEventId' or previous_sequence is distinct from (administrative_value->>'tailSequence')::bigint or state_name='completed') then raise exception 'attendance_shift_check_invalid';end if;\n  if state_name<>'completed' and administrative_value is null then\n",
        "count": 1
      }
    ]
  }
]
$administrative_recipes$::jsonb) loop
  signature:=format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.'));
  select * into fn from pg_proc where oid=to_regprocedure(signature);
  expected_hash:=case when installed then spec->>'newHash' else spec->>'oldHash' end;
  expected_config:=array(select jsonb_array_elements_text(spec->'config'));
  if fn.oid is null or fn.proowner<>(select oid from pg_roles where rolname=current_user) or fn.prolang<>(select oid from pg_language where lanname='plpgsql')
    or fn.prokind<>'f' or fn.proretset or fn.proargmodes is not null or fn.proisstrict or fn.proleakproof or fn.proparallel<>'u'
    or fn.prorettype<>to_regtype(spec->>'resultType') or fn.provolatile<>spec->>'volatility'
    or fn.prosecdef<>(spec->>'securityDefiner')::boolean or fn.proconfig is distinct from expected_config
    or encode(sha256(convert_to(replace(replace(fn.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from expected_hash
    or has_function_privilege('anon',fn.oid,'EXECUTE') or has_function_privilege('authenticated',fn.oid,'EXECUTE')
    or has_function_privilege('service_role',fn.oid,'EXECUTE')<>(spec->>'serviceExecute')::boolean
    or exists(select 1 from aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) acl where acl.grantee<>fn.proowner
      and not((spec->>'serviceExecute')::boolean and acl.grantee=(select oid from pg_roles where rolname='service_role'))) then
    raise exception 'merchant_attendance_administrative_closure_forward_conflict:%',spec->>'name';end if;
  if installed then continue;end if;
  original_oid:=fn.oid;original_acl:=fn.proacl;original_defaults:=pg_get_expr(fn.proargdefaults,0);body_value:=replace(fn.prosrc,E'\r\n',E'\n');
  for change in select value from jsonb_array_elements(spec->'changes') loop
    if (length(body_value)-length(replace(body_value,change->>'from','')))/length(change->>'from')<>(change->>'count')::integer then
      raise exception 'merchant_attendance_administrative_closure_recipe_conflict:%',spec->>'name';end if;
    body_value:=replace(body_value,change->>'from',change->>'to');
  end loop;
  canonical_body:=replace(body_value,ns||'.','pub'||'lic.');
  if encode(sha256(convert_to(canonical_body,'UTF8')),'hex') is distinct from spec->>'newHash' then raise exception 'merchant_attendance_administrative_closure_recipe_hash:%',spec->>'name';end if;
  definition:=pg_get_functiondef(fn.oid);
  if (length(definition)-length(replace(definition,fn.prosrc,'')))/length(fn.prosrc)<>1 then raise exception 'merchant_attendance_administrative_closure_recipe_definition';end if;
  execute replace(definition,fn.prosrc,body_value);
  select * into new_fn from pg_proc where oid=to_regprocedure(signature);
  if new_fn.oid is distinct from original_oid or new_fn.proacl is distinct from original_acl
    or pg_get_expr(new_fn.proargdefaults,0) is distinct from original_defaults
    or (to_jsonb(new_fn)-array['prosrc','proargdefaults']) is distinct from (to_jsonb(fn)-array['prosrc','proargdefaults']) then raise exception 'merchant_attendance_administrative_closure_recipe_metadata';end if;
 end loop;
end;
$administrative_forward$;

-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_administrative_closures'::regclass,
      'public.merchant_attendance_administrative_closure_entries'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $administrative_storage$
declare t regclass;is_entry boolean;f record;
begin
 foreach t in array array['public.merchant_attendance_administrative_closures'::regclass,'public.merchant_attendance_administrative_closure_entries'::regclass] loop
  is_entry:=t='public.merchant_attendance_administrative_closure_entries'::regclass;
  execute format('alter table %s enable row level security',t);
  execute format('revoke all on %s from public,anon,authenticated,service_role',t);
  if not exists(select 1 from pg_trigger where tgrelid=t and tgname='administrative_closure_no_truncate') then
   execute format('create trigger administrative_closure_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);end if;
  if is_entry then
   if not exists(select 1 from pg_trigger where tgrelid=t and tgname='administrative_closure_immutable') then
    execute format('create trigger administrative_closure_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);end if;
   if not exists(select 1 from pg_trigger where tgrelid=t and tgname='administrative_closure_proof') then
    execute format('create constraint trigger administrative_closure_proof after insert on %s deferrable initially deferred for each row execute function public.faolla_attendance_administrative_guard_v1()',t);end if;
  else
   if not exists(select 1 from pg_trigger where tgrelid=t and tgname='administrative_closure_shape') then
    execute format('create trigger administrative_closure_shape before insert or update or delete on %s for each row execute function public.faolla_attendance_administrative_guard_v1()',t);end if;
   if not exists(select 1 from pg_trigger where tgrelid=t and tgname='administrative_closure_proof') then
    execute format('create constraint trigger administrative_closure_proof after insert or update on %s deferrable initially deferred for each row execute function public.faolla_attendance_administrative_guard_v1()',t);end if;
  end if;
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
  and (left(p.proname,length('faolla_attendance_administrative_'))='faolla_attendance_administrative_' or p.proname='faolla_attendance_operating_head_v1') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end;
$administrative_storage$;
grant execute on function public.faolla_attendance_administrative_closures_v1(jsonb,uuid,jsonb,boolean) to service_role;

do $administrative_function_postconditions$
declare spec jsonb;fn record;ns text;is_rpc boolean;installed boolean;expected_names text[];t regclass;object_name text;
begin
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.faolla_schema_migrations'::regclass;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure') into installed;
 
 expected_names:=array['faolla_attendance_administrative_scalar_v1','faolla_attendance_administrative_stamp_v1','faolla_attendance_administrative_scope_v1','faolla_attendance_administrative_frame_v1','faolla_attendance_administrative_context_v1','faolla_attendance_administrative_command_v1','faolla_attendance_administrative_hash_v1','faolla_attendance_administrative_event_v1','faolla_attendance_administrative_pause_v1','faolla_attendance_administrative_source_v1','faolla_attendance_administrative_receipt_v1','faolla_attendance_administrative_entry_v1','faolla_attendance_administrative_boundary_v1','faolla_attendance_administrative_current_v1','faolla_attendance_operating_head_v1','faolla_attendance_administrative_predecessor_v1','faolla_attendance_administrative_summary_v1','faolla_attendance_administrative_guard_v1','faolla_attendance_administrative_closures_v1','faolla_attendance_administrative_report_boundary_v1','faolla_attendance_administrative_current_field_v1','faolla_attendance_administrative_restore_v1','faolla_attendance_administrative_report_v1','faolla_attendance_administrative_source_result_v1','faolla_attendance_administrative_saved_source_v1'];
 if (select count(*) from pg_proc where pronamespace=(select oid from pg_namespace where nspname=ns)
  and (left(proname,length('faolla_attendance_administrative_'))='faolla_attendance_administrative_' or proname='faolla_attendance_operating_head_v1'))<>25 then raise exception 'merchant_attendance_administrative_closure_installation_conflict';end if;
 
 for spec in select value from jsonb_array_elements($administrative_new_after$
[
  {
    "name": "faolla_attendance_administrative_scalar_v1",
    "types": "jsonb,text",
    "argumentNames": [
      "p",
      "k"
    ],
    "defaults": 0,
    "resultType": "boolean",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "814c0a864d7b7383eaf12f06c374ca8440be70c5b1edb5781e665130217ad295"
  },
  {
    "name": "faolla_attendance_administrative_stamp_v1",
    "types": "timestamptz",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "text",
    "volatility": "i",
    "language": "sql",
    "securityDefiner": false,
    "hash": "6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2"
  },
  {
    "name": "faolla_attendance_administrative_scope_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "cced0de14b5545e78c9587eec063cd70e49a318259306624f388bb5065004013"
  },
  {
    "name": "faolla_attendance_administrative_frame_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "b1db19c72584d4f0617a0ac53f425f88e5ee9cae7f4e1600953d2f8adafea03f"
  },
  {
    "name": "faolla_attendance_administrative_context_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "boolean",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "6770c4f42f603523da703e91c080dd350dc074707142506e1e3982050a6ce8b1"
  },
  {
    "name": "faolla_attendance_administrative_command_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "c5ee520a78337d3fb2571743fd4ebf0e56c7abc9e529632731a0486ea7379187"
  },
  {
    "name": "faolla_attendance_administrative_hash_v1",
    "types": "text,uuid,text,jsonb",
    "argumentNames": [
      "p_site",
      "p_actor",
      "p_access",
      "p"
    ],
    "defaults": 0,
    "resultType": "text",
    "volatility": "i",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "40d352beb1e5896edb8f428d143ae689a6ca7c90036bf5c8372cae0beac00419"
  },
  {
    "name": "faolla_attendance_administrative_event_v1",
    "types": "public.merchant_attendance_events",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "sql",
    "securityDefiner": false,
    "hash": "fc6d90a50c6e1f08ff2e090278b3595a6591b0a7a3d9dbdb3d0ce912a1e3beb3"
  },
  {
    "name": "faolla_attendance_administrative_pause_v1",
    "types": "public.merchant_attendance_account_suspensions",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "sql",
    "securityDefiner": false,
    "hash": "a4300e0f28d15b88fb47d71aca7af2c794e8c4dfbfc0b8de3610cb49f4a28723"
  },
  {
    "name": "faolla_attendance_administrative_source_v1",
    "types": "text,uuid",
    "argumentNames": [
      "p_site",
      "p_worker"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "v",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "46ecdaebadbbcfccbbca974fe1ce8a2c2deab1b86da5937df33571b29b91bc3a"
  },
  {
    "name": "faolla_attendance_administrative_receipt_v1",
    "types": "public.merchant_attendance_administrative_closure_entries",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "cb0e6311ed78b29398f5f1bb52f6168258e21e22e802d79d21cbf3bf7afdbcc3"
  },
  {
    "name": "faolla_attendance_administrative_entry_v1",
    "types": "public.merchant_attendance_administrative_closure_entries",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "d663c9351beed34d63eee7ff75c19abb49e66e4cbc3ce1246fa3d17764ec4203"
  },
  {
    "name": "faolla_attendance_administrative_boundary_v1",
    "types": "text,uuid,uuid",
    "argumentNames": [
      "p_site",
      "p_worker",
      "p_start"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "30f4e7c06f9fd44bd90e321ae8f7f7ec44638ba50e6092ae27cc967dfce196bb"
  },
  {
    "name": "faolla_attendance_administrative_current_v1",
    "types": "text,uuid",
    "argumentNames": [
      "p_site",
      "p_worker"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "5bdbe3085ccc4fcf8dd87c6b64fe0e89fd561a58c280b66b33f0235049544490"
  },
  {
    "name": "faolla_attendance_operating_head_v1",
    "types": "text,uuid",
    "argumentNames": [
      "p_site",
      "p_worker"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "a765524a5112d6ea357143839212b1a279a6b95c6b947c3e98817727b9212e3e"
  },
  {
    "name": "faolla_attendance_administrative_predecessor_v1",
    "types": "text,uuid,public.merchant_attendance_events",
    "argumentNames": [
      "p_site",
      "p_worker",
      "p_first"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "1a130e666abe5e6fbb6f52941676803fa0051fcff0e3eac042c1eb6c3d8acb56"
  },
  {
    "name": "faolla_attendance_administrative_summary_v1",
    "types": "public.merchant_attendance_administrative_closures",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "f77edd7784a6b7035d6a2c13dfc38b21418a9d7ab7b886d8f277a8962b37a7f3"
  },
  {
    "name": "faolla_attendance_administrative_guard_v1",
    "types": "",
    "argumentNames": [],
    "defaults": 0,
    "resultType": "trigger",
    "volatility": "v",
    "language": "plpgsql",
    "securityDefiner": true,
    "hash": "e1bc07e02cd6a2a16a578ccd4140ffca04d2cad2293f4e25bfd0ab306f632a39"
  },
  {
    "name": "faolla_attendance_administrative_closures_v1",
    "types": "jsonb,uuid,jsonb,boolean",
    "argumentNames": [
      "p_query",
      "p_auth_user_id",
      "p_command",
      "p_allow_close"
    ],
    "defaults": 2,
    "resultType": "jsonb",
    "volatility": "v",
    "language": "plpgsql",
    "securityDefiner": true,
    "hash": "a74855ea4529a441e90105fed57fcbba285e9b60ba00da62441915335912d27c"
  },
  {
    "name": "faolla_attendance_administrative_report_boundary_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "i",
    "language": "sql",
    "securityDefiner": false,
    "hash": "546120e124c686ea41f5dfd5fd61c5f25fc6b5ccabbd5b8eea7e9e94ce732f04"
  },
  {
    "name": "faolla_attendance_administrative_current_field_v1",
    "types": "text,uuid",
    "argumentNames": [
      "p_site",
      "p_worker"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "82510b8f64f727b7fac1fb495c07a9f24ab6e7e2538845be4cef08b70e18619d"
  },
  {
    "name": "faolla_attendance_administrative_restore_v1",
    "types": "public.merchant_attendance_account_suspensions,jsonb",
    "argumentNames": [
      "p",
      "p_detail"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "bf2bc01adf51243429f6db8d7ec3ea87c73abde17270e06e28a30a499e24ece8"
  },
  {
    "name": "faolla_attendance_administrative_report_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "c2334334f6e37317749cc9dd95b5c268dcb602923dea888f4422be68c14a2eee"
  },
  {
    "name": "faolla_attendance_administrative_source_result_v1",
    "types": "jsonb",
    "argumentNames": [
      "p"
    ],
    "defaults": 0,
    "resultType": "jsonb",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "4466f706cd31a515157c9f1e2d926fecb264d09944181fc0fb6381d32e24f4ec"
  },
  {
    "name": "faolla_attendance_administrative_saved_source_v1",
    "types": "jsonb,timestamptz",
    "argumentNames": [
      "p",
      "p_recorded"
    ],
    "defaults": 0,
    "resultType": "boolean",
    "volatility": "s",
    "language": "plpgsql",
    "securityDefiner": false,
    "hash": "7ce86192fc768e854d883ee39123e56294ce9e13643892a5bdc913aa4eed378d"
  }
]
$administrative_new_after$::jsonb) loop
  select p.*,l.lanname into fn from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','public.',ns||'.')));
  is_rpc:=spec->>'name'='faolla_attendance_administrative_closures_v1';
  if fn.oid is null or fn.proname<>all(expected_names) or fn.proowner<>(select oid from pg_roles where rolname=current_user)
   or fn.prokind<>'f' or fn.proretset or fn.proargmodes is not null or fn.proisstrict or fn.proleakproof or fn.proparallel<>'u'
   or fn.prorettype<>to_regtype(spec->>'resultType') or fn.provolatile<>spec->>'volatility' or fn.lanname<>spec->>'language'
   or fn.prosecdef<>(spec->>'securityDefiner')::boolean or fn.proconfig is distinct from array['search_path=pg_catalog']
   or fn.pronargdefaults<>(spec->>'defaults')::integer or coalesce(fn.proargnames,'{}'::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argumentNames'))
   or is_rpc and pg_get_expr(fn.proargdefaults,0) is distinct from 'NULL::jsonb, false'
   or encode(sha256(convert_to(replace(replace(fn.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or exists(select 1 from aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) acl where acl.grantor<>fn.proowner
    or acl.grantee<>fn.proowner and (not is_rpc or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
   or has_function_privilege('anon',fn.oid,'EXECUTE') or has_function_privilege('authenticated',fn.oid,'EXECUTE')
   or has_function_privilege('service_role',fn.oid,'EXECUTE')<>is_rpc then raise exception 'merchant_attendance_administrative_closure_function_conflict:%',spec->>'name';end if;
 end loop;
end;
$administrative_function_postconditions$;


-- Empty transaction-only DDL probes pin CHECK/FK/key semantics without guessing
-- generated constraint names, deleting any relation or touching user rows.
create temporary table administrative_closure_head_check_probe(
 merchant_id text not null,start_event_id uuid not null,
 worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,employment_period_id uuid not null,
 case_scope jsonb not null,revision bigint not null check(revision between 1 and 9007199254740990),
 latest_source_operation_id uuid not null,closed_operation_id uuid,
 primary key(merchant_id,start_event_id),
 check(public.faolla_attendance_administrative_scope_v1(case_scope)=case_scope),
 check(case_scope->>'workerId'=worker_id::text and case_scope->>'employeeId'=employee_id::text and case_scope->>'employeeAuthUserId'=employee_auth_user_id::text
  and case_scope->>'startEventId'=start_event_id::text and case_scope->>'employmentPeriodId'=employment_period_id::text)
) on commit drop;
create temporary table administrative_closure_entry_check_probe(
 merchant_id text not null,start_event_id uuid not null,operation_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
 action text not null check(action in('record_unknown','close','self_dispute','owner_respond')),actor_auth_user_id uuid not null,actor_access text not null,
 command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz not null check(isfinite(recorded_at)),
 frame jsonb,context jsonb,source_text text,source_bytes integer,source_sha256 text,
 primary key(merchant_id,operation_id),unique(merchant_id,start_event_id,revision),
 check(actor_access=case when action='self_dispute' then 'self' else 'owner' end),
 check(jsonb_typeof(command)='object' and octet_length(convert_to(command::text,'UTF8'))<=8192),
 check((action in('record_unknown','close') and frame is not null and context is not null and source_text is not null and source_bytes is not null and source_bytes between 1 and 1048576 and source_sha256 is not null and source_sha256~'^[0-9a-f]{64}$')
  or (action in('self_dispute','owner_respond') and frame is null and context is null and source_text is null and source_bytes is null and source_sha256 is null))
) on commit drop;
create index administrative_closure_probe_self_idx on administrative_closure_head_check_probe(merchant_id,employee_auth_user_id,start_event_id);
create unique index administrative_closure_probe_close_idx on administrative_closure_entry_check_probe(merchant_id,start_event_id) where action='close';
create index administrative_closure_probe_dispute_idx on administrative_closure_entry_check_probe(merchant_id,start_event_id,revision desc) where action='self_dispute';
create index administrative_closure_probe_source_idx on administrative_closure_entry_check_probe(merchant_id,start_event_id,revision desc) where action in('record_unknown','close');
do $administrative_table_postconditions$
declare pair record;t regclass;probe regclass;actual jsonb;expected jsonb;is_entry boolean;role_name text;expected_owner oid:=(select oid from pg_roles where rolname=current_user);
begin
 for pair in select * from (values
  ('public.merchant_attendance_administrative_closures','pg_temp.administrative_closure_head_check_probe',false),
  ('public.merchant_attendance_administrative_closure_entries','pg_temp.administrative_closure_entry_check_probe',true)) x(real_name,probe_name,is_entry) loop
  t:=to_regclass(pair.real_name);probe:=to_regclass(pair.probe_name);is_entry:=pair.is_entry;
  if not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=expected_owner and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t) then raise exception 'merchant_attendance_administrative_closure_table_conflict';end if;
  select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
   into actual from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t and a.attnum>0 and not a.attisdropped;
  select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
   into expected from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=probe and a.attnum>0 and not a.attisdropped;
  if actual is distinct from expected then raise exception 'merchant_attendance_administrative_closure_columns_conflict';end if;
  select jsonb_agg(jsonb_build_array(c.contype,c.condeferrable,c.condeferred,c.convalidated,c.connoinherit,pg_get_constraintdef(c.oid,true)) order by c.contype,pg_get_constraintdef(c.oid,true))
   into actual from pg_constraint c where c.conrelid=t and c.contype in('p','u','c');
  select jsonb_agg(jsonb_build_array(c.contype,c.condeferrable,c.condeferred,c.convalidated,c.connoinherit,pg_get_constraintdef(c.oid,true)) order by c.contype,pg_get_constraintdef(c.oid,true))
   into expected from pg_constraint c where c.conrelid=probe;
  if actual is distinct from expected then raise exception 'merchant_attendance_administrative_closure_constraint_conflict';end if;
  -- Temporary probes intentionally have no cross-persistence FK. Compare the
  -- real fixed target/column mappings separately, without generated names.
  expected:=case when is_entry then '[{"keys":["merchant_id","start_event_id"],"table":"merchant_attendance_administrative_closures","ref":["merchant_id","start_event_id"]}]'::jsonb
   else '[{"keys":["merchant_id"],"table":"merchant_attendance_settings","ref":["merchant_id"]},{"keys":["start_event_id"],"table":"merchant_attendance_events","ref":["id"]},{"keys":["employment_period_id"],"table":"merchant_attendance_employment_periods","ref":["id"]},{"keys":["merchant_id","worker_id"],"table":"merchant_attendance_workers","ref":["merchant_id","id"]},{"keys":["merchant_id","employee_id"],"table":"merchant_enterprise_employees","ref":["merchant_id","id"]}]'::jsonb end;
  select jsonb_agg(jsonb_build_object('keys',array(select a.attname::text from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.ord),
   'table',ref.relname,'ref',array(select a.attname::text from unnest(c.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num order by k.ord)))
   into actual from pg_constraint c join pg_class ref on ref.oid=c.confrelid where c.conrelid=t and c.contype='f';
  if jsonb_array_length(actual) is distinct from jsonb_array_length(expected) or not(actual @> expected and expected @> actual)
   or exists(select 1 from pg_constraint c join pg_class ref on ref.oid=c.confrelid where c.conrelid=t and c.contype='f'
    and (ref.relnamespace<>(select relnamespace from pg_class where oid=t) or not c.convalidated or c.condeferrable or c.condeferred or c.confupdtype<>'a' or c.confdeltype<>'a' or c.confmatchtype<>'s')) then raise exception 'merchant_attendance_administrative_closure_reference_conflict';end if;
  select jsonb_agg(jsonb_build_array(am.amname,i.indisunique,i.indisprimary,i.indisvalid,i.indisready,i.indislive,i.indisexclusion,i.indimmediate,i.indnkeyatts,i.indnatts,
    i.indkey::text,i.indoption::text,i.indclass::text,i.indcollation::text,pg_get_expr(i.indexprs,i.indrelid),pg_get_expr(i.indpred,i.indrelid))
    order by i.indkey::text,i.indoption::text,i.indisunique,pg_get_expr(i.indpred,i.indrelid)) into actual
   from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indrelid=t;
  select jsonb_agg(jsonb_build_array(am.amname,i.indisunique,i.indisprimary,i.indisvalid,i.indisready,i.indislive,i.indisexclusion,i.indimmediate,i.indnkeyatts,i.indnatts,
    i.indkey::text,i.indoption::text,i.indclass::text,i.indcollation::text,pg_get_expr(i.indexprs,i.indrelid),pg_get_expr(i.indpred,i.indrelid))
    order by i.indkey::text,i.indoption::text,i.indisunique,pg_get_expr(i.indpred,i.indrelid)) into expected
   from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam where i.indrelid=probe;
  if actual is distinct from expected then raise exception 'merchant_attendance_administrative_closure_index_conflict';end if;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>3
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='administrative_closure_no_truncate' and tgtype=34 and tgenabled='O'
    and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure and tgnargs=0 and tgqual is null)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname=case when is_entry then 'administrative_closure_immutable' else 'administrative_closure_shape' end
    and tgtype=case when is_entry then 27 else 31 end and tgenabled='O' and tgnargs=0 and tgqual is null
    and tgfoid=case when is_entry then 'public.faolla_attendance_events_append_only_v1()'::regprocedure else 'public.faolla_attendance_administrative_guard_v1()'::regprocedure end)
   or not exists(select 1 from pg_trigger where tgrelid=t and tgname='administrative_closure_proof' and tgtype=case when is_entry then 5 else 21 end and tgenabled='O'
    and tgdeferrable and tginitdeferred and tgconstraint<>0 and tgnargs=0 and tgqual is null and tgfoid='public.faolla_attendance_administrative_guard_v1()'::regprocedure)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where c.oid=t and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
   or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and (acl.grantor<>expected_owner or acl.grantee<>expected_owner))
  then raise exception 'merchant_attendance_administrative_closure_security_conflict';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_administrative_closure_table_privilege';end if;
  end loop;
 end loop;
end;
$administrative_table_postconditions$;


insert into public.faolla_schema_migrations(version,name) values(202610080195,'merchant_attendance_administrative_closure') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
