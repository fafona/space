-- C23 local synthetic candidate. One explicit location precision disposal.
-- Coverage is captured from new database facts, never backfilled by a caller.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $disposal_preflight$
declare installed boolean;t regclass;n text;guard pg_proc%rowtype;
begin
 if not exists(select 1 from public.faolla_schema_migrations where version=202610080195 and name='merchant_attendance_administrative_closure')
  or not exists(select 1 from public.faolla_schema_migrations where version=202610080196 and name='merchant_attendance_independent_workers') then raise exception 'merchant_attendance_disposal_prerequisite_required';end if;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080197 and name='merchant_attendance_retention_disposal') into installed;
 if exists(select 1 from public.faolla_schema_migrations where version=202610080197 and name<>'merchant_attendance_retention_disposal') then raise exception 'merchant_attendance_disposal_installation_conflict';end if;
 foreach n in array array['merchant_attendance_disposal_event_coverage','merchant_attendance_disposal_artifact_coverage','merchant_attendance_disposal_artifact_event_refs','merchant_attendance_disposal_approvals','merchant_attendance_disposal_executions'] loop
  t:=to_regclass('public.'||n);
  if installed<>(t is not null) then raise exception 'merchant_attendance_disposal_installation_conflict';end if;
  if installed and (not exists(select 1 from pg_class where oid=t and relkind='r' and relowner=(select oid from pg_roles where rolname=current_user) and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t)
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and (a.grantee<>c.relowner or a.grantor<>c.relowner))
   or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and (acl.grantee<>(select oid from pg_roles where rolname=current_user) or acl.grantor<>(select oid from pg_roles where rolname=current_user)))) then raise exception 'merchant_attendance_disposal_permission_conflict';end if;
 end loop;
 select * into guard from pg_proc where oid='public.faolla_attendance_events_append_only_v1()'::regprocedure;
 if guard.proowner<>(select oid from pg_roles where rolname=current_user) or guard.prosecdef or guard.prorettype<>'trigger'::regtype or guard.prolang<>(select oid from pg_language where lanname='plpgsql')
  or guard.proconfig is distinct from array['search_path=pg_catalog'] or guard.provolatile<>'v' or guard.pronargdefaults<>0 or guard.proretset or guard.proisstrict or guard.proleakproof
  or encode(sha256(convert_to(replace(guard.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'66b7826feb67a63b33b563d77176ef0ef81b49479657efbd80fbcefcb5512b0a'
  or exists(select 1 from aclexplode(coalesce(guard.proacl,acldefault('f',guard.proowner))) acl where acl.grantee<>guard.proowner or acl.grantor<>guard.proowner) then raise exception 'merchant_attendance_disposal_shared_guard_changed';end if;
end;
$disposal_preflight$;
do $disposal_new_preflight$
declare manifest jsonb:=$disposal_functions_before$
[
 {
  "name": "faolla_attendance_disposal_stamp_v1",
  "types": "timestamptz",
  "argnames": [
   "p"
  ],
  "hash": "6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2",
  "language": "sql",
  "result": "text",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_sha_v1",
  "types": "jsonb",
  "argnames": [
   "p"
  ],
  "hash": "fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7",
  "language": "sql",
  "result": "text",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_command_v1",
  "types": "jsonb",
  "argnames": [
   "p"
  ],
  "hash": "63e2ce735a839f2d078e9add7d8a88e0f14f4bdc4266040a376f402c7660a8e3",
  "language": "plpgsql",
  "result": "boolean",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_hash_v1",
  "types": "text,uuid,jsonb",
  "argnames": [
   "p_site",
   "p_actor",
   "p"
  ],
  "hash": "57a36b51cf5111b5a2e8e5bb0815e806eb45340e9c6544096cd52dcc3a94dc04",
  "language": "plpgsql",
  "result": "text",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_event_capture_v1",
  "types": "",
  "argnames": [],
  "hash": "e8205ee4ee7a8f9a9d0dd88c3384697f918dc18c3ff198aa1051a2c32c91693d",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_json_v1",
  "types": "text",
  "argnames": [
   "p"
  ],
  "hash": "d839369c35afcea3841409190085835ca93bb63323dafc45f9ff833fb492e1c8",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_artifact_refs_v1",
  "types": "public.merchant_attendance_period_artifacts",
  "argnames": [
   "p"
  ],
  "hash": "1157d39b88958af5ac068f6d4f00eaa451489db7c75c6b1d9a71cff62af9a44f",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "v",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_artifact_capture_v1",
  "types": "",
  "argnames": [],
  "hash": "af696546fa9c6ebb5f9d3bde2f71e67f98b79f297323175899c0ba65511d518a",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_session_v1",
  "types": "public.merchant_attendance_events,timestamptz",
  "argnames": [
   "p",
   "p_as_of"
  ],
  "hash": "5ab788ca1bbda56a17f8c4b4f4d4a8ceef057293c65c6301df2612a959e17600",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_hold_v1",
  "types": "text,text,uuid,timestamptz",
  "argnames": [
   "p_site",
   "p_category",
   "p_record",
   "p_as_of"
  ],
  "hash": "a66a6d38518eb64cc88716cf39c00ffcbd634146ce72a5b6799c59ce7598067a",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_hold_tuple_v1",
  "types": "jsonb",
  "argnames": [
   "p"
  ],
  "hash": "d19472532c279406d169659e7549bf2b01b8b3e7dec9497eafa1709cd39078c1",
  "language": "sql",
  "result": "jsonb",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_preview_v1",
  "types": "text,uuid,timestamptz",
  "argnames": [
   "p_site",
   "p_event",
   "p_as_of"
  ],
  "hash": "9b3f1adcb14280684f446f5b94d6d7141e78941aacf0a53b999462df6dfc4a9d",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_unchanged_v1",
  "types": "public.merchant_attendance_location_results",
  "argnames": [
   "p"
  ],
  "hash": "edc896aafdc57ca80f1c9850b839e2ea8b6a9c785fc08a097c520f96150fd607",
  "language": "sql",
  "result": "text",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_projection_v1",
  "types": "public.merchant_attendance_location_results",
  "argnames": [
   "p"
  ],
  "hash": "aac0bab032fe0842bef0f923fd11e8fd2f57483c7665388288717b19de54b3a6",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_matches_v1",
  "types": "jsonb,jsonb",
  "argnames": [
   "p",
   "c"
  ],
  "hash": "081495888812d763aeea89e94b6bb48b9f9ffe149eb7063e2daba7abba665db6",
  "language": "sql",
  "result": "boolean",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_location_guard_v1",
  "types": "",
  "argnames": [],
  "hash": "2ca333a85db8f36f5a91f2c713bdfc56d1c8f2cca222eb5687cacffe7a345215",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_proof_v1",
  "types": "",
  "argnames": [],
  "hash": "a3e6e44358f3913e5a5d7e07a1804c691ebe0fceb6acf7105a60c6469ebdefc7",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_receipt_v1",
  "types": "text,uuid,uuid",
  "argnames": [
   "p_site",
   "p_operation",
   "p_actor"
  ],
  "hash": "17058c1d009ba869f762ee3282e2f61e4ee5ac3ccccbe026cfd1c26e0e375340",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_retention_disposal_v1",
  "types": "jsonb,uuid,jsonb,boolean",
  "argnames": [
   "p_query",
   "p_auth_user_id",
   "p_command",
   "p_allow_write"
  ],
  "hash": "9547e00f6a18817a32d16847c7a988d4ac5749a2979e6111a2a136a0c2898dee",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": true,
  "defaults": 2
 },
 {
  "name": "faolla_attendance_disposal_artifact_proof_v1",
  "types": "",
  "argnames": [],
  "hash": "7390e47b8de6976f5e515664acc045b7ee039eabca60149af6b035b91e3a95cc",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 }
]
$disposal_functions_before$::jsonb;spec jsonb;fn pg_proc%rowtype;ns text;installed boolean;expected_owner oid:=(select oid from pg_roles where rolname=current_user);f regprocedure;
begin
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_events'::regclass;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080197) into installed;
 for spec in select value from jsonb_array_elements(manifest) loop
  f:=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','pub'||'lic.',ns||'.')));
  if not installed then
   if f is not null or exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_events'::regclass) and proname=spec->>'name') then raise exception 'merchant_attendance_disposal_installation_conflict';end if;
   continue;
  end if;
  select * into fn from pg_proc where oid=f;
  if f is null or fn.proowner<>expected_owner or fn.prolang<>(select oid from pg_language where lanname=spec->>'language') or fn.prorettype<>to_regtype(spec->>'result')
   or fn.provolatile::text is distinct from spec->>'volatility' or fn.prosecdef is distinct from (spec->>'securityDefiner')::boolean
   or fn.proconfig is distinct from array['search_path=pg_catalog'] or fn.proretset or fn.proisstrict or fn.proleakproof or fn.proparallel<>'u'
   or fn.prokind<>'f' or fn.provariadic<>0 or fn.prosupport<>0 or fn.proargmodes is not null or fn.proallargtypes is not null
   or coalesce(fn.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argnames'))
   or fn.pronargdefaults<>(spec->>'defaults')::integer or (fn.pronargdefaults>0 and pg_get_expr(fn.proargdefaults,0) is distinct from 'NULL::jsonb, false')
   or encode(sha256(convert_to(replace(replace(fn.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or exists(select 1 from aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and (not (spec->>'rpc')::boolean or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'rpc')::boolean then raise exception 'merchant_attendance_disposal_function_changed';end if;
 end loop;
 if installed and (select count(*) from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_events'::regclass)
  and (proname like 'faolla_attendance_disposal_%' or proname='faolla_attendance_retention_disposal_v1'))<>jsonb_array_length(manifest) then raise exception 'merchant_attendance_disposal_function_changed';end if;
end;
$disposal_new_preflight$;


-- One atomic DDL boundary: every newly covered event is born after both captures.
lock table public.merchant_attendance_events,public.merchant_attendance_period_artifacts,public.merchant_attendance_location_results in share row exclusive mode;

create or replace function public.faolla_attendance_disposal_stamp_v1(p timestamptz)
returns text language sql immutable set search_path=pg_catalog as $$
 select to_char(p at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;
create or replace function public.faolla_attendance_disposal_sha_v1(p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
 select encode(sha256(convert_to(p::text,'UTF8')),'hex');
$$;
create or replace function public.faolla_attendance_disposal_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare k text;
begin
 if p is null or octet_length(convert_to(p::text,'UTF8'))>8192 or jsonb_typeof(p->'action') is distinct from 'string'
  or p->>'action' not in('approve','execute') or public.faolla_attendance_shift_rule_binding_object_v1(p,case when p->>'action'='approve' then
    array['action','operationId','eventId','fields','previewAt','expectedSourceFingerprint','expectedPolicyFingerprint','expectedDependencyFingerprint','expectedHoldFingerprint','expectedPreviewFingerprint','reason']
   else array['action','operationId','eventId','approvalOperationId'] end) is distinct from true then return false;end if;
 foreach k in array array['operationId','eventId'] loop
  if public.faolla_attendance_shift_rule_binding_scalar_v1(p->k,'uuid') is distinct from true then return false;end if;
 end loop;
 if p->>'action'='execute' then return public.faolla_attendance_shift_rule_binding_scalar_v1(p->'approvalOperationId','uuid') is true;end if;
 if p->'fields' is distinct from '["captured_at","accuracy_meters","distance_meters"]'::jsonb
  or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'previewAt','stamp6') is distinct from true
  or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,500) is distinct from true then return false;end if;
 foreach k in array array['expectedSourceFingerprint','expectedPolicyFingerprint','expectedDependencyFingerprint','expectedHoldFingerprint','expectedPreviewFingerprint'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or p->>k!~'^[0-9a-f]{64}$' then return false;end if;
 end loop;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

create or replace function public.faolla_attendance_disposal_hash_v1(p_site text,p_actor uuid,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare c jsonb;
begin
 if p_site is null or p_site!~'^[0-9]{8}$' or p_actor is null or public.faolla_attendance_disposal_command_v1(p) is distinct from true then raise exception 'attendance_retention_disposal_invalid';end if;
 if p->>'action'='approve' then c:=jsonb_build_array(p->'action',p->'operationId',p->'eventId',p->'fields',p->'previewAt',p->'expectedSourceFingerprint',p->'expectedPolicyFingerprint',p->'expectedDependencyFingerprint',p->'expectedHoldFingerprint',p->'expectedPreviewFingerprint',p->'reason');
 else c:=jsonb_build_array(p->'action',p->'operationId',p->'eventId',p->'approvalOperationId');end if;
 return public.faolla_attendance_disposal_sha_v1(jsonb_build_array('attendance-retention-disposal-command-v1',p_site,p_actor,c));
end;
$$;

create table if not exists public.merchant_attendance_disposal_event_coverage(
 event_id uuid primary key constraint disposal_event_coverage_event_fk references public.merchant_attendance_events(id) on delete restrict,
 merchant_id text not null,worker_id uuid not null,sequence bigint not null check(sequence between 1 and 9007199254740991),
 coverage_version integer not null check(coverage_version=1),recorded_at timestamptz not null check(isfinite(recorded_at)),
 unique(merchant_id,event_id),constraint disposal_event_coverage_worker_fk foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id)
);
create table if not exists public.merchant_attendance_disposal_artifact_coverage(
 merchant_id text not null,artifact_id uuid not null,artifact_sha256 text not null check(artifact_sha256~'^[0-9a-f]{64}$'),
 source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),coverage_version integer not null check(coverage_version=1),
 status text not null check(status in('complete','incomplete')),reference_count integer not null check(reference_count between 0 and 65536),
 references_fingerprint text not null check(references_fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz not null check(isfinite(recorded_at)),
 primary key(merchant_id,artifact_id),constraint disposal_artifact_coverage_artifact_fk foreign key(merchant_id,artifact_id) references public.merchant_attendance_period_artifacts(merchant_id,artifact_id)
);
create index if not exists attendance_disposal_incomplete_artifact_idx on public.merchant_attendance_disposal_artifact_coverage(merchant_id,artifact_id) where status='incomplete';
create table if not exists public.merchant_attendance_disposal_artifact_event_refs(
 merchant_id text not null,event_id uuid not null constraint disposal_artifact_refs_event_fk references public.merchant_attendance_events(id),artifact_id uuid not null,
 coverage_version integer not null check(coverage_version=1),primary key(merchant_id,event_id,artifact_id),
 constraint disposal_artifact_refs_coverage_fk foreign key(merchant_id,artifact_id) references public.merchant_attendance_disposal_artifact_coverage(merchant_id,artifact_id)
);
create index if not exists attendance_disposal_artifact_refs_idx on public.merchant_attendance_disposal_artifact_event_refs(merchant_id,artifact_id,event_id);
create table if not exists public.merchant_attendance_disposal_approvals(
 merchant_id text not null constraint disposal_approvals_settings_fk references public.merchant_attendance_settings(merchant_id),operation_id uuid not null,event_id uuid not null constraint disposal_approvals_event_fk references public.merchant_attendance_events(id),
 actor_auth_user_id uuid not null,command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 preview_at timestamptz not null check(isfinite(preview_at)),source_fingerprint text not null,policy_fingerprint text not null,dependency_fingerprint text not null,
 hold_fingerprint text not null,preview_fingerprint text not null,recorded_at timestamptz not null check(isfinite(recorded_at) and recorded_at>=preview_at),
 primary key(merchant_id,operation_id),unique(merchant_id,operation_id,event_id),
 check((public.faolla_attendance_disposal_command_v1(command) is true and command->>'action'='approve' and command->>'operationId'=operation_id::text and command->>'eventId'=event_id::text
  and command_fingerprint=public.faolla_attendance_disposal_hash_v1(merchant_id,actor_auth_user_id,command)
  and command->>'previewAt'=public.faolla_attendance_disposal_stamp_v1(preview_at)
  and command->>'expectedSourceFingerprint'=source_fingerprint and command->>'expectedPolicyFingerprint'=policy_fingerprint
  and command->>'expectedDependencyFingerprint'=dependency_fingerprint and command->>'expectedHoldFingerprint'=hold_fingerprint and command->>'expectedPreviewFingerprint'=preview_fingerprint) is true)
);
create table if not exists public.merchant_attendance_disposal_executions(
 merchant_id text not null,operation_id uuid not null,event_id uuid not null,approval_operation_id uuid not null,actor_auth_user_id uuid not null,
 command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 before_source_fingerprint text not null check(before_source_fingerprint~'^[0-9a-f]{64}$'),after_source_fingerprint text not null check(after_source_fingerprint~'^[0-9a-f]{64}$'),
 unchanged_fingerprint text not null check(unchanged_fingerprint~'^[0-9a-f]{64}$'),transaction_id xid8 not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
 primary key(merchant_id,operation_id),unique(event_id),unique(merchant_id,approval_operation_id),
 constraint disposal_executions_approval_fk foreign key(merchant_id,approval_operation_id,event_id) references public.merchant_attendance_disposal_approvals(merchant_id,operation_id,event_id),
 check((public.faolla_attendance_disposal_command_v1(command) is true and command->>'action'='execute' and command->>'operationId'=operation_id::text and command->>'eventId'=event_id::text
  and command->>'approvalOperationId'=approval_operation_id::text and command_fingerprint=public.faolla_attendance_disposal_hash_v1(merchant_id,actor_auth_user_id,command)) is true)
);

alter table public.merchant_attendance_location_results add column if not exists disposal_operation_id uuid;

create or replace function public.faolla_attendance_disposal_event_capture_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' or tg_relid<>'public.merchant_attendance_events'::regclass then raise exception 'attendance_retention_disposal_invalid';end if;
 insert into public.merchant_attendance_disposal_event_coverage(event_id,merchant_id,worker_id,sequence,coverage_version,recorded_at)
  values(new.id,new.merchant_id,new.worker_id,new.sequence,1,clock_timestamp());
 return new;
end;
$$;

-- Full checked artifact traversal. Resource exhaustion creates incomplete
-- coverage; it never truncates a normal writer's archive or rejects its send.
create or replace function public.faolla_attendance_disposal_json_v1(p text)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
begin
 if p is null or left(ltrim(p),1) not in('{','[') then return null;end if;
 return p::jsonb;
exception when invalid_text_representation then return null;
end;
$$;
create or replace function public.faolla_attendance_disposal_artifact_refs_v1(p public.merchant_attendance_period_artifacts)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare body jsonb;node record;matched text[];ids uuid[]:=array[]::uuid[];candidate uuid;ev public.merchant_attendance_events%rowtype;
 count_nodes integer:=0;bytes bigint:=0;complete boolean:=true;reference_limit boolean:=false;out_ids jsonb:='[]';
begin
 body:=public.faolla_attendance_period_artifact_checked_v1(p);
 if body->>'protocol' not in('attendance-period-artifact-v1','attendance-period-artifact-v2')
  or coalesce(body->'source'->>'sourceVersion','') not in('attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3','attendance-period-source-v4','attendance-period-source-v5') then complete:=false;end if;
 for node in
  with recursive walk(value,depth,key_name) as (
   select body,0,''::text
   union all
   select child.value,w.depth+1,child.key_name from walk w cross join lateral(
    select e.value,e.key key_name from jsonb_each(case when jsonb_typeof(w.value)='object' then w.value else '{}'::jsonb end)e
    union all select a.value,'' from jsonb_array_elements(case when jsonb_typeof(w.value)='array' then w.value else '[]'::jsonb end)a
    union all select j,'' from (select public.faolla_attendance_disposal_json_v1(w.value#>>'{}') j where jsonb_typeof(w.value)='string') embedded where j is not null
   )child where w.depth<65)
  select * from walk limit 262145
 loop
  count_nodes:=count_nodes+1;
  if count_nodes>262144 or node.depth>64 then complete:=false;exit;end if;
  if jsonb_typeof(node.value)='string' then
   bytes:=bytes+octet_length(convert_to(node.value#>>'{}','UTF8'));
   if bytes>8388608 then complete:=false;exit;end if;
   if node.key_name in('sourceText','artifactText') and public.faolla_attendance_disposal_json_v1(node.value#>>'{}') is null then complete:=false;end if;
   for matched in select regexp_matches(node.value#>>'{}','[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}','gi') loop
    if cardinality(ids)>=65536 then complete:=false;reference_limit:=true;exit;end if;
    ids:=array_append(ids,lower(matched[1])::uuid);
   end loop;
   if reference_limit then exit;end if;
  end if;
 end loop;
 -- Point checks force the event PK access path; no full events-table hash join.
 for candidate in select distinct id from unnest(ids) id order by id loop
  select * into ev from public.merchant_attendance_events where id=candidate;
  if ev.id is not null then
   if ev.merchant_id is distinct from p.merchant_id then complete:=false;
   else out_ids:=out_ids||jsonb_build_array(candidate);end if;
  end if;
 end loop;
 return jsonb_build_object('status',case when complete then 'complete' else 'incomplete' end,'eventIds',out_ids,
  'referencesFingerprint',public.faolla_attendance_disposal_sha_v1(jsonb_build_array('attendance-retention-disposal-artifact-refs-v1',p.merchant_id,p.artifact_id,p.artifact_sha256,p.source_fingerprint,out_ids)));
end;
$$;
create or replace function public.faolla_attendance_disposal_artifact_capture_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare refs jsonb;c public.merchant_attendance_disposal_artifact_coverage%rowtype;actual jsonb;
begin
 if tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' or tg_relid<>'public.merchant_attendance_period_artifacts'::regclass then raise exception 'attendance_retention_disposal_invalid';end if;
 refs:=public.faolla_attendance_disposal_artifact_refs_v1(new);
 with inserted_coverage as (
  insert into public.merchant_attendance_disposal_artifact_coverage(merchant_id,artifact_id,artifact_sha256,source_fingerprint,coverage_version,status,reference_count,references_fingerprint,recorded_at)
   values(new.merchant_id,new.artifact_id,new.artifact_sha256,new.source_fingerprint,1,refs->>'status',jsonb_array_length(refs->'eventIds'),refs->>'referencesFingerprint',clock_timestamp())
   returning merchant_id,artifact_id
 )
 insert into public.merchant_attendance_disposal_artifact_event_refs(merchant_id,event_id,artifact_id,coverage_version)
  select inserted_coverage.merchant_id,(id_value#>>'{}')::uuid,inserted_coverage.artifact_id,1
  from inserted_coverage cross join lateral jsonb_array_elements(refs->'eventIds') id_value;
 select * into c from public.merchant_attendance_disposal_artifact_coverage where merchant_id=new.merchant_id and artifact_id=new.artifact_id;
 select coalesce(jsonb_agg(event_id order by event_id),'[]'::jsonb) into actual from public.merchant_attendance_disposal_artifact_event_refs where merchant_id=new.merchant_id and artifact_id=new.artifact_id;
 if c.artifact_id is null or c.reference_count<>jsonb_array_length(actual) or actual is distinct from refs->'eventIds' or c.references_fingerprint is distinct from refs->>'referencesFingerprint' then raise exception 'attendance_retention_disposal_invalid';end if;
 return new;
end;
$$;

-- These metadata collectors never include the three precision values in a
-- preview or approval. Immutable original events, not a correction/admin
-- boundary, must prove a genuine closed session.
create or replace function public.faolla_attendance_disposal_session_v1(p public.merchant_attendance_events,p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare first_event public.merchant_attendance_events%rowtype;e public.merchant_attendance_events%rowtype;
 state text:='off';expected bigint;last_at timestamptz;n integer:=0;seen boolean:=false;items jsonb:='[]';
 unknown_value constant jsonb:='{"state":"unknown","sessionId":null,"sourceFingerprint":null}';
begin
 select * into first_event from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id
  and sequence between greatest(1,p.sequence-2001) and p.sequence and action='clock_in' order by sequence desc limit 1;
 if first_event.id is null then return unknown_value;end if;
 expected:=first_event.sequence;
 for e in select * from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id
  and sequence>=first_event.sequence order by sequence limit 2003 loop
  n:=n+1;
  if n>2002 or e.sequence<>expected or e.actor_employee_id is distinct from first_event.actor_employee_id
   or e.source not in('web','kiosk') or e.received_at>p_as_of or e.occurred_at>p_as_of or last_at is not null and e.occurred_at<last_at
   or (e.action='break_start')<>(e.break_paid is not null) then return unknown_value;end if;
  if state='off' and e.action='clock_in' then state:='working';
  elsif state='working' and e.action='break_start' then state:='break';
  elsif state='break' and e.action='break_end' then state:='working';
  elsif state='working' and e.action='clock_out' then state:='closed';else return unknown_value;end if;
  items:=items||jsonb_build_array(jsonb_build_array(e.id,e.sequence,e.action,e.source,e.break_paid,e.location_id,e.actor_employee_id,
   public.faolla_attendance_disposal_stamp_v1(e.occurred_at),public.faolla_attendance_disposal_stamp_v1(e.received_at),e.time_zone));
  seen:=seen or e.id=p.id;expected:=expected+1;last_at:=e.occurred_at;
  if state='closed' then exit;end if;
 end loop;
 if not seen then return unknown_value;end if;
 return jsonb_build_object('state',case when state='closed' then 'closed' else 'open' end,'sessionId',first_event.id,
  'sourceFingerprint',public.faolla_attendance_disposal_sha_v1(jsonb_build_array('attendance-retention-disposal-raw-session-v1',p.merchant_id,p.worker_id,items)));
end;
$$;
create or replace function public.faolla_attendance_disposal_hold_v1(p_site text,p_category text,p_record uuid,p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare h public.merchant_attendance_preservation_operations%rowtype;canonical jsonb;
begin
 select * into h from public.merchant_attendance_preservation_operations where merchant_id=p_site and category=p_category and record_id=p_record order by revision desc limit 1;
 if h.operation_id is not null then
  perform public.faolla_attendance_retention_receipt_v1(h.command,h.actor_auth_user_id,h.revision,h.command_fingerprint,h.recorded_at);
  canonical:=jsonb_build_object('siteId',p_site,'category',p_category,'recordId',p_record,'source',public.faolla_attendance_retention_source_v1(p_site,p_category,p_record));
  if h.source_snapshot is distinct from canonical or h.source_fingerprint is distinct from public.faolla_attendance_disposal_sha_v1(canonical) then raise exception 'attendance_retention_disposal_invalid';end if;
  if h.recorded_at>p_as_of then raise exception 'attendance_retention_disposal_changed';end if;
 end if;
 return jsonb_build_object('revision',coalesce(h.revision,0),'held',coalesce(h.action='hold',false),'operationId',h.operation_id,'recordedAt',public.faolla_attendance_disposal_stamp_v1(h.recorded_at));
end;
$$;
create or replace function public.faolla_attendance_disposal_hold_tuple_v1(p jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_array(p->'revision',p->'held',p->'operationId',p->'recordedAt');
$$;
create or replace function public.faolla_attendance_disposal_preview_v1(p_site text,p_event uuid,p_as_of timestamptz)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;loc public.merchant_attendance_location_results%rowtype;c public.merchant_attendance_disposal_event_coverage%rowtype;
 ar record;source_value jsonb;canonical jsonb;policy jsonb;session_value jsonb;review_value jsonb;snapshot_value jsonb;dependencies jsonb;preservation jsonb;location_value jsonb;basis jsonb;
 artifacts jsonb:='[]';artifact_tuples jsonb:='[]';artifact_holds jsonb:='[]';hold_tuples jsonb:='[]';ah jsonb;lh jsonb;eh jsonb;
 event_covered boolean;artifacts_complete boolean;artifact_limit boolean:=false;disposed boolean;has_snapshot boolean;has_artifact_hold boolean:=false;n integer:=0;
 coverage_value text;due_at timestamptz;blockers jsonb:='[]';source_sha text;policy_sha text;dependency_sha text;hold_sha text;preview_sha text;
 guard_spec record;guard_trigger pg_trigger%rowtype;guard_function pg_proc%rowtype;guard_namespace text;
begin
 if p_site is distinct from '99990197' or p_event is null or p_as_of is null or not isfinite(p_as_of) then raise exception 'attendance_invalid_request';end if;
 select catalog_namespace.nspname into guard_namespace from pg_class catalog_table join pg_namespace catalog_namespace on catalog_namespace.oid=catalog_table.relnamespace where catalog_table.oid='public.merchant_attendance_events'::regclass;
 -- Constant-size catalog checks prove the shared capture boundary is still
 -- enabled. A disabled/replaced capture never silently becomes complete.
 for guard_spec in select * from(values
   ('merchant_attendance_events','disposal_event_capture','faolla_attendance_disposal_event_capture_v1','e8205ee4ee7a8f9a9d0dd88c3384697f918dc18c3ff198aa1051a2c32c91693d',false),
   ('merchant_attendance_events','disposal_event_proof','faolla_attendance_disposal_proof_v1','a3e6e44358f3913e5a5d7e07a1804c691ebe0fceb6acf7105a60c6469ebdefc7',true),
   ('merchant_attendance_period_artifacts','disposal_artifact_capture','faolla_attendance_disposal_artifact_capture_v1','af696546fa9c6ebb5f9d3bde2f71e67f98b79f297323175899c0ba65511d518a',true),
   ('merchant_attendance_disposal_artifact_coverage','disposal_artifact_coverage_proof','faolla_attendance_disposal_artifact_proof_v1','7390e47b8de6976f5e515664acc045b7ee039eabca60149af6b035b91e3a95cc',true)
 ) pinned(table_name,trigger_name,function_name,source_sha,deferred) loop
  select * into guard_trigger from pg_trigger where tgrelid=to_regclass('public.'||guard_spec.table_name) and tgname=guard_spec.trigger_name;
  select * into guard_function from pg_proc where oid=to_regprocedure('public.'||guard_spec.function_name||'()');
  if guard_trigger.oid is null or guard_function.oid is null or guard_trigger.tgfoid<>guard_function.oid or guard_trigger.tgtype<>5 or guard_trigger.tgenabled<>'O'
   or guard_trigger.tgdeferrable is distinct from guard_spec.deferred or guard_trigger.tginitdeferred is distinct from guard_spec.deferred
   or (guard_trigger.tgconstraint<>0) is distinct from guard_spec.deferred or guard_trigger.tgnargs<>0 or guard_trigger.tgqual is not null
   or guard_function.proowner<>(select oid from pg_roles where rolname=current_user) or not guard_function.prosecdef or guard_function.proconfig is distinct from array['search_path=pg_catalog']
   or guard_function.prolang<>(select oid from pg_language where lanname='plpgsql') or guard_function.prorettype<>'trigger'::regtype or guard_function.provolatile<>'v'
   or encode(sha256(convert_to(replace(replace(guard_function.prosrc,E'\r\n',E'\n'),guard_namespace||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from guard_spec.source_sha
   or exists(select 1 from aclexplode(coalesce(guard_function.proacl,acldefault('f',guard_function.proowner))) acl where acl.grantee<>guard_function.proowner or acl.grantor<>guard_function.proowner)
   then raise exception 'attendance_retention_disposal_invalid';end if;
 end loop;
 select * into guard_function from pg_proc where oid='public.faolla_attendance_disposal_artifact_refs_v1(public.merchant_attendance_period_artifacts)'::regprocedure;
 if encode(sha256(convert_to(replace(replace(guard_function.prosrc,E'\r\n',E'\n'),guard_namespace||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from '1157d39b88958af5ac068f6d4f00eaa451489db7c75c6b1d9a71cff62af9a44f'
  or guard_function.prosecdef or guard_function.proconfig is distinct from array['search_path=pg_catalog']
  or exists(select 1 from aclexplode(coalesce(guard_function.proacl,acldefault('f',guard_function.proowner))) acl where acl.grantee<>guard_function.proowner or acl.grantor<>guard_function.proowner) then raise exception 'attendance_retention_disposal_invalid';end if;

 select * into ev from public.merchant_attendance_events where merchant_id=p_site and id=p_event;
 select * into loc from public.merchant_attendance_location_results where event_id=ev.id;
 if ev.id is null or loc.event_id is null then raise exception 'attendance_retention_disposal_not_found';end if;
 if ev.received_at>p_as_of then raise exception 'attendance_retention_disposal_changed';end if;
 source_value:=public.faolla_attendance_retention_source_v1(p_site,'location_results',p_event);
 canonical:=jsonb_build_object('siteId',p_site,'category','location_results','recordId',p_event,'source',source_value);
 source_sha:=public.faolla_attendance_disposal_sha_v1(canonical);
 policy:=public.faolla_attendance_retention_policy_v1(p_site,'location_results');
 if policy->>'recordedAt' is not null and (policy->>'recordedAt')::timestamptz>p_as_of then raise exception 'attendance_retention_disposal_changed';end if;
 select * into c from public.merchant_attendance_disposal_event_coverage where event_id=p_event;
 event_covered:=c.event_id is not null and c.merchant_id=ev.merchant_id and c.worker_id=ev.worker_id and c.sequence=ev.sequence and c.coverage_version=1;
 disposed:=loc.disposal_operation_id is not null;
 -- Pre-boundary immutable artifacts cannot reference a not-yet-existing new
 -- event. Missing new coverage is rejected by the pinned deferred capture;
 -- never scan all historical artifacts or treat old absent coverage as failure.
 artifacts_complete:=not exists(select 1 from public.merchant_attendance_disposal_artifact_coverage where merchant_id=p_site and status='incomplete');
 -- Reverse lookup is the only 25-selection limit. Full capture is never cut to25.
 for ar in select r.artifact_id,a.source_fingerprint,cov.artifact_sha256,cov.source_fingerprint as covered_source,a.artifact_sha256 as actual_sha,cov.status
  from public.merchant_attendance_disposal_artifact_event_refs r join public.merchant_attendance_period_artifacts a on a.merchant_id=r.merchant_id and a.artifact_id=r.artifact_id
  join public.merchant_attendance_disposal_artifact_coverage cov on cov.merchant_id=r.merchant_id and cov.artifact_id=r.artifact_id
  where r.merchant_id=p_site and r.event_id=p_event order by r.artifact_id limit 26 loop
  n:=n+1;if n>25 then artifact_limit:=true;exit;end if;
  if ar.actual_sha is distinct from ar.artifact_sha256 or ar.source_fingerprint is distinct from ar.covered_source or ar.status<>'complete' then artifacts_complete:=false;end if;
  artifacts:=artifacts||jsonb_build_array(jsonb_build_object('artifactId',ar.artifact_id,'sourceFingerprint',ar.source_fingerprint));
  artifact_tuples:=artifact_tuples||jsonb_build_array(jsonb_build_array(ar.artifact_id,ar.source_fingerprint));
  ah:=public.faolla_attendance_disposal_hold_v1(p_site,'period_artifact',ar.artifact_id,p_as_of);
  artifact_holds:=artifact_holds||jsonb_build_array(ah||jsonb_build_object('artifactId',ar.artifact_id));
  hold_tuples:=hold_tuples||jsonb_build_array(jsonb_build_array(ar.artifact_id)||public.faolla_attendance_disposal_hold_tuple_v1(ah));
  has_artifact_hold:=has_artifact_hold or (ah->>'held')::boolean;
 end loop;
 coverage_value:=case when artifact_limit then 'over_limit' when artifacts_complete then 'complete' else 'unknown' end;
 session_value:=public.faolla_attendance_disposal_session_v1(ev,p_as_of);
 review_value:=jsonb_build_object('coverage','complete','hasReview',exists(select 1 from public.merchant_attendance_location_reviews where merchant_id=p_site and event_id=p_event),
  'hasDiscussion',exists(select 1 from public.merchant_attendance_location_discussion where merchant_id=p_site and event_id=p_event));
 has_snapshot:=exists(select 1 from public.merchant_attendance_preservation_operations where merchant_id=p_site and category='location_results' and record_id=p_event);
 snapshot_value:=jsonb_build_object('coverage','complete','hasAnySnapshot',has_snapshot);
 lh:=public.faolla_attendance_disposal_hold_v1(p_site,'location_results',p_event,p_as_of);eh:=public.faolla_attendance_disposal_hold_v1(p_site,'events',p_event,p_as_of);
 dependencies:=jsonb_build_object('session',session_value,'review',review_value,'locationSnapshotHistory',snapshot_value,'artifacts',jsonb_build_object('coverage',coverage_value,'items',artifacts));
 preservation:=jsonb_build_object('coverage','complete','location',lh,'event',eh,'artifacts',artifact_holds);
 location_value:=jsonb_build_object('evidenceId',p_event,'workerId',ev.worker_id,'sourceFingerprint',source_sha,'anchorAt',public.faolla_attendance_disposal_stamp_v1(ev.received_at),
  'reason',loc.reason,'needsReview',loc.needs_review,'precisionPresent',jsonb_build_object('capturedAt',loc.captured_at is not null,'accuracyMeters',loc.accuracy_meters is not null,'distanceMeters',loc.distance_meters is not null));
 basis:=jsonb_build_object('protocol','attendance-retention-disposal-input-v1','siteId',p_site,'asOf',public.faolla_attendance_disposal_stamp_v1(p_as_of),'location',location_value,'policy',policy,'dependencies',dependencies,'preservation',preservation);
 if policy->>'retentionDays' is null then blockers:=blockers||'"policy_unconfigured"'::jsonb;
 else due_at:=ev.received_at+(policy->>'retentionDays')::integer*interval '86400 seconds';if p_as_of<due_at then blockers:=blockers||'"not_due"'::jsonb;end if;end if;
 if loc.reason<>'inside' then blockers:=blockers||'"not_inside"'::jsonb;end if;
 if loc.captured_at is null or loc.accuracy_meters is null or loc.distance_meters is null then blockers:=blockers||'"precision_not_present"'::jsonb;end if;
 if session_value->>'state'<>'closed' then blockers:=blockers||'"session_not_closed"'::jsonb;end if;
 if (review_value->>'hasReview')::boolean then blockers:=blockers||'"location_review"'::jsonb;end if;
 if (review_value->>'hasDiscussion')::boolean then blockers:=blockers||'"location_discussion"'::jsonb;end if;
 if has_snapshot then blockers:=blockers||'"historical_location_snapshot"'::jsonb;end if;
 if coverage_value<>'complete' then blockers:=blockers||'"artifact_dependencies_incomplete"'::jsonb;end if;
 if (lh->>'held')::boolean then blockers:=blockers||'"location_held"'::jsonb;end if;
 if (eh->>'held')::boolean then blockers:=blockers||'"event_held"'::jsonb;end if;
 if has_artifact_hold then blockers:=blockers||'"artifact_held"'::jsonb;end if;
 if not event_covered then blockers:=blockers||'"dependency_coverage_unknown"'::jsonb;end if;
 if not artifacts_complete then blockers:=blockers||'"artifact_coverage_incomplete"'::jsonb;end if;
 if artifact_limit then blockers:=blockers||'"artifact_dependency_limit"'::jsonb;end if;
 if disposed then blockers:=blockers||'"already_disposed"'::jsonb;end if;
 policy_sha:=public.faolla_attendance_disposal_sha_v1(jsonb_build_array('attendance-retention-disposal-policy-v1',p_site,jsonb_build_array(policy->'category',policy->'revision',policy->'retentionDays',policy->'operationId',policy->'recordedAt')));
 dependency_sha:=public.faolla_attendance_disposal_sha_v1(jsonb_build_array('attendance-retention-disposal-dependencies-v1',p_site,p_event,jsonb_build_array(
  jsonb_build_array(session_value->'state',session_value->'sessionId',session_value->'sourceFingerprint'),jsonb_build_array(review_value->'coverage',review_value->'hasReview',review_value->'hasDiscussion'),
  jsonb_build_array(snapshot_value->'coverage',snapshot_value->'hasAnySnapshot'),jsonb_build_array(coverage_value,artifact_tuples))));
 hold_sha:=public.faolla_attendance_disposal_sha_v1(jsonb_build_array('attendance-retention-disposal-holds-v1',p_site,p_event,jsonb_build_array('complete',public.faolla_attendance_disposal_hold_tuple_v1(lh),public.faolla_attendance_disposal_hold_tuple_v1(eh),hold_tuples)));
 preview_sha:=public.faolla_attendance_disposal_sha_v1(jsonb_build_array('attendance-retention-disposal-preview-v1',p_site,public.faolla_attendance_disposal_stamp_v1(p_as_of),
  jsonb_build_array(p_event,ev.worker_id,source_sha,location_value->'anchorAt',loc.reason,loc.needs_review,jsonb_build_array(loc.captured_at is not null,loc.accuracy_meters is not null,loc.distance_meters is not null)),
  jsonb_build_array('captured_at','accuracy_meters','distance_meters'),policy_sha,dependency_sha,hold_sha,public.faolla_attendance_disposal_stamp_v1(due_at),blockers));
 return jsonb_build_object('protocol','attendance-retention-disposal-trusted-preview-v1','siteId',p_site,'asOf',public.faolla_attendance_disposal_stamp_v1(p_as_of),'eventId',p_event,'workerId',ev.worker_id,
  'fields',jsonb_build_array('captured_at','accuracy_meters','distance_meters'),'dueAt',public.faolla_attendance_disposal_stamp_v1(due_at),'candidateState',case when blockers='[]'::jsonb then 'candidate' else 'blocked' end,
  'blockers',blockers,'sourceFingerprint',source_sha,'policyFingerprint',policy_sha,'dependencyFingerprint',dependency_sha,'holdFingerprint',hold_sha,'previewFingerprint',preview_sha,'basis',basis,
  'coverage',jsonb_build_object('eventCovered',event_covered,'artifactsComplete',artifacts_complete,'artifactLimitExceeded',artifact_limit,'alreadyDisposed',disposed));
end;
$$;

create or replace function public.faolla_attendance_disposal_unchanged_v1(p public.merchant_attendance_location_results)
returns text language sql immutable set search_path=pg_catalog as $$
 select public.faolla_attendance_disposal_sha_v1(to_jsonb(p)-array['captured_at','accuracy_meters','distance_meters','disposal_operation_id']);
$$;
create or replace function public.faolla_attendance_disposal_projection_v1(p public.merchant_attendance_location_results)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare x public.merchant_attendance_disposal_executions%rowtype;a public.merchant_attendance_disposal_approvals%rowtype;ev public.merchant_attendance_events%rowtype;
begin
 if p.disposal_operation_id is null then return null;end if;
 select * into ev from public.merchant_attendance_events where id=p.event_id;
 select * into x from public.merchant_attendance_disposal_executions where merchant_id=ev.merchant_id and operation_id=p.disposal_operation_id and event_id=p.event_id;
 select * into a from public.merchant_attendance_disposal_approvals where merchant_id=x.merchant_id and operation_id=x.approval_operation_id and event_id=x.event_id;
 if ev.id is null or x.operation_id is null or a.operation_id is null or ev.merchant_id<>'99990197' or p.reason<>'inside' or p.needs_review
  or p.captured_at is not null or p.accuracy_meters is not null or p.distance_meters is not null or x.actor_auth_user_id is distinct from a.actor_auth_user_id
  or x.recorded_at<a.recorded_at or x.recorded_at<ev.received_at or x.before_source_fingerprint is distinct from a.source_fingerprint
  or x.unchanged_fingerprint is distinct from public.faolla_attendance_disposal_unchanged_v1(p)
  or public.faolla_attendance_disposal_command_v1(a.command) is distinct from true or public.faolla_attendance_disposal_command_v1(x.command) is distinct from true
  or a.command_fingerprint is distinct from public.faolla_attendance_disposal_hash_v1(a.merchant_id,a.actor_auth_user_id,a.command)
  or x.command_fingerprint is distinct from public.faolla_attendance_disposal_hash_v1(x.merchant_id,x.actor_auth_user_id,x.command) then raise exception 'attendance_retention_disposal_invalid';end if;
 return jsonb_build_object('protocol','attendance-location-precision-disposal-v1','operationId',x.operation_id,'disposedAt',public.faolla_attendance_disposal_stamp_v1(x.recorded_at),
  'fields',jsonb_build_array('captured_at','accuracy_meters','distance_meters'));
end;
$$;
create or replace function public.faolla_attendance_disposal_matches_v1(p jsonb,c jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select (p->>'candidateState'='candidate' and p->'blockers'='[]'::jsonb and p->>'sourceFingerprint'=c->>'expectedSourceFingerprint'
  and p->>'policyFingerprint'=c->>'expectedPolicyFingerprint' and p->>'dependencyFingerprint'=c->>'expectedDependencyFingerprint'
  and p->>'holdFingerprint'=c->>'expectedHoldFingerprint' and p->>'previewFingerprint'=c->>'expectedPreviewFingerprint'
  and p->>'asOf'=c->>'previewAt' and p->>'eventId'=c->>'eventId' and p->'fields'=c->'fields') is true;
$$;
create or replace function public.faolla_attendance_disposal_location_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare x public.merchant_attendance_disposal_executions%rowtype;ev public.merchant_attendance_events%rowtype;src jsonb;
begin
 if tg_when<>'BEFORE' or tg_level<>'ROW' or tg_relid<>'public.merchant_attendance_location_results'::regclass then raise exception 'attendance_retention_disposal_invalid';end if;
 if tg_op='INSERT' then if new.disposal_operation_id is not null then raise exception 'attendance_retention_disposal_invalid';end if;return new;end if;
 if tg_op<>'UPDATE' or old.disposal_operation_id is not null or new.disposal_operation_id is null or old.reason<>'inside' or old.needs_review
  or old.captured_at is null or old.accuracy_meters is null or old.distance_meters is null
  or new.captured_at is not null or new.accuracy_meters is not null or new.distance_meters is not null
  or (to_jsonb(new)-array['captured_at','accuracy_meters','distance_meters','disposal_operation_id']) is distinct from
     (to_jsonb(old)-array['captured_at','accuracy_meters','distance_meters','disposal_operation_id']) then raise exception 'attendance_retention_disposal_invalid';end if;
 select * into ev from public.merchant_attendance_events where id=old.event_id;
 select * into x from public.merchant_attendance_disposal_executions where merchant_id=ev.merchant_id and operation_id=new.disposal_operation_id and event_id=old.event_id;
 src:=jsonb_build_object('siteId',ev.merchant_id,'category','location_results','recordId',ev.id,'source',public.faolla_attendance_retention_source_v1(ev.merchant_id,'location_results',ev.id));
 if x.operation_id is null or x.transaction_id is distinct from pg_current_xact_id() or x.before_source_fingerprint is distinct from public.faolla_attendance_disposal_sha_v1(src)
  or x.unchanged_fingerprint is distinct from public.faolla_attendance_disposal_unchanged_v1(old) then raise exception 'attendance_retention_disposal_invalid';end if;
 perform public.faolla_attendance_disposal_projection_v1(new);return new;
end;
$$;
create or replace function public.faolla_attendance_disposal_proof_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;x public.merchant_attendance_disposal_executions%rowtype;loc public.merchant_attendance_location_results%rowtype;
 a public.merchant_attendance_disposal_approvals%rowtype;c public.merchant_attendance_disposal_event_coverage%rowtype;p jsonb;src jsonb;owner_id uuid;
begin
 if tg_level<>'ROW' or tg_op<>'INSERT' and not(tg_relid='public.merchant_attendance_location_results'::regclass and tg_op='UPDATE') then raise exception 'attendance_retention_disposal_invalid';end if;
 if tg_relid='public.merchant_attendance_disposal_approvals'::regclass then
  if tg_when<>'BEFORE' or new.merchant_id<>'99990197' then raise exception 'attendance_retention_disposal_invalid';end if;
  select user_id into owner_id from public.merchants where id=new.merchant_id;
  p:=public.faolla_attendance_disposal_preview_v1(new.merchant_id,new.event_id,new.preview_at);
  if owner_id is distinct from new.actor_auth_user_id or public.faolla_attendance_disposal_matches_v1(p,new.command) is distinct from true
   or new.recorded_at<new.preview_at or (p->>'dueAt')::timestamptz>new.recorded_at then raise exception 'attendance_retention_disposal_invalid';end if;
  return new;
 elsif tg_relid='public.merchant_attendance_disposal_executions'::regclass and tg_when='BEFORE' then
  select * into a from public.merchant_attendance_disposal_approvals where merchant_id=new.merchant_id and operation_id=new.approval_operation_id and event_id=new.event_id;
  select user_id into owner_id from public.merchants where id=new.merchant_id;
  if new.merchant_id<>'99990197' or a.operation_id is null or owner_id is distinct from new.actor_auth_user_id or a.actor_auth_user_id is distinct from new.actor_auth_user_id
   or new.transaction_id is distinct from pg_current_xact_id() or new.before_source_fingerprint is distinct from a.source_fingerprint or new.recorded_at<a.recorded_at then raise exception 'attendance_retention_disposal_invalid';end if;
  p:=public.faolla_attendance_disposal_preview_v1(new.merchant_id,new.event_id,a.preview_at);
  if public.faolla_attendance_disposal_matches_v1(p,a.command) is distinct from true or (p->>'dueAt')::timestamptz>new.recorded_at then raise exception 'attendance_retention_disposal_invalid';end if;
  return new;
 elsif tg_relid='public.merchant_attendance_events'::regclass or tg_relid='public.merchant_attendance_disposal_event_coverage'::regclass then
  if tg_when<>'AFTER' then raise exception 'attendance_retention_disposal_invalid';end if;
  if tg_relid='public.merchant_attendance_events'::regclass then select * into ev from public.merchant_attendance_events where id=new.id;
  else select * into ev from public.merchant_attendance_events where id=new.event_id;end if;
  select * into c from public.merchant_attendance_disposal_event_coverage where event_id=ev.id;
  if c.event_id is null or row(c.merchant_id,c.worker_id,c.sequence,c.coverage_version) is distinct from row(ev.merchant_id,ev.worker_id,ev.sequence,1) then raise exception 'attendance_retention_disposal_invalid';end if;
  return new;
 end if;
 if tg_when<>'AFTER' then raise exception 'attendance_retention_disposal_invalid';end if;
 if tg_relid='public.merchant_attendance_disposal_executions'::regclass then select * into x from public.merchant_attendance_disposal_executions where merchant_id=new.merchant_id and operation_id=new.operation_id;
 elsif tg_relid='public.merchant_attendance_location_results'::regclass then select * into x from public.merchant_attendance_disposal_executions where event_id=new.event_id;
 else raise exception 'attendance_retention_disposal_invalid';end if;
 select * into loc from public.merchant_attendance_location_results where event_id=x.event_id;
 select * into a from public.merchant_attendance_disposal_approvals where merchant_id=x.merchant_id and operation_id=x.approval_operation_id;
 if x.operation_id is null or loc.event_id is null or loc.disposal_operation_id is distinct from x.operation_id or x.transaction_id is distinct from pg_current_xact_id()
  or a.operation_id is null or x.actor_auth_user_id is distinct from a.actor_auth_user_id then raise exception 'attendance_retention_disposal_invalid';end if;
 perform public.faolla_attendance_disposal_projection_v1(loc);
 src:=jsonb_build_object('siteId',x.merchant_id,'category','location_results','recordId',x.event_id,'source',public.faolla_attendance_retention_source_v1(x.merchant_id,'location_results',x.event_id));
 if x.after_source_fingerprint is distinct from public.faolla_attendance_disposal_sha_v1(src) then raise exception 'attendance_retention_disposal_invalid';end if;
 return new;
end;
$$;
create or replace function public.faolla_attendance_disposal_receipt_v1(p_site text,p_operation uuid,p_actor uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare a public.merchant_attendance_disposal_approvals%rowtype;x public.merchant_attendance_disposal_executions%rowtype;cmd jsonb;recorded timestamptz;fingerprint text;approval uuid;
begin
 select * into a from public.merchant_attendance_disposal_approvals where merchant_id=p_site and operation_id=p_operation and actor_auth_user_id=p_actor;
 select * into x from public.merchant_attendance_disposal_executions where merchant_id=p_site and operation_id=p_operation and actor_auth_user_id=p_actor;
 if a.operation_id is not null and x.operation_id is not null then raise exception 'attendance_retention_disposal_invalid';end if;
 if a.operation_id is not null then cmd:=a.command;recorded:=a.recorded_at;fingerprint:=a.command_fingerprint;approval:=a.operation_id;
 elsif x.operation_id is not null then cmd:=x.command;recorded:=x.recorded_at;fingerprint:=x.command_fingerprint;approval:=x.approval_operation_id;else return null;end if;
 if public.faolla_attendance_disposal_command_v1(cmd) is distinct from true or cmd->>'operationId' is distinct from p_operation::text
  or fingerprint is distinct from public.faolla_attendance_disposal_hash_v1(p_site,p_actor,cmd) then raise exception 'attendance_retention_disposal_invalid';end if;
 -- Minimum immutable receipt only: no source/policy re-read, owner or flag.
 return jsonb_build_object('operationId',p_operation,'action',cmd->'action','eventId',cmd->'eventId','approvalOperationId',approval,
  'actorId',p_actor,'recordedAt',public.faolla_attendance_disposal_stamp_v1(recorded),'commandFingerprint',fingerprint);
end;
$$;
create or replace function public.faolla_attendance_retention_disposal_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;mode_name text;event_value uuid;operation_value uuid;owner_id uuid;ev public.merchant_attendance_events%rowtype;
 loc public.merchant_attendance_location_results%rowtype;a public.merchant_attendance_disposal_approvals%rowtype;x public.merchant_attendance_disposal_executions%rowtype;
 p jsonb;receipt jsonb;data_value jsonb;now_at timestamptz;as_of timestamptz;src jsonb;marker jsonb;after_sha text;cmd_sha text;
begin
 if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','mode','eventId','operationId']) is distinct from true
  or public.faolla_attendance_administrative_scalar_v1(p_query->'siteId','site') is distinct from true then raise exception 'attendance_invalid_request';end if;
 site:=p_query->>'siteId';mode_name:=p_query->>'mode';
 if mode_name='recover' then
  if p_command is not null or p_query->'eventId' is distinct from 'null'::jsonb or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  receipt:=public.faolla_attendance_disposal_receipt_v1(site,(p_query->>'operationId')::uuid,p_auth_user_id);data_value:=jsonb_build_object('kind','receipt','receipt',receipt);
 elsif mode_name='preview' then
  if site<>'99990197' or p_query->'operationId' is distinct from 'null'::jsonb or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'eventId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  event_value:=(p_query->>'eventId')::uuid;
  if p_command is not null and (public.faolla_attendance_disposal_command_v1(p_command) is distinct from true or p_command->>'eventId' is distinct from event_value::text) then raise exception 'attendance_invalid_request';end if;
  select user_id into owner_id from public.merchants where id=site for share;
  if not found or owner_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_retention_disposal_blocked';end if;
  select * into ev from public.merchant_attendance_events where merchant_id=site and id=event_value;
  if ev.id is null then raise exception 'attendance_retention_disposal_not_found';end if;
  perform 1 from public.merchant_attendance_workers where merchant_id=site and id=ev.worker_id for update;
  select * into loc from public.merchant_attendance_location_results where event_id=event_value for update;
  if not found then raise exception 'attendance_retention_disposal_not_found';end if;
  now_at:=clock_timestamp();
  if p_command is null then
   p:=public.faolla_attendance_disposal_preview_v1(site,event_value,now_at);data_value:=jsonb_build_object('kind','preview','preview',p);
  else
   if p_allow_write is distinct from true then raise exception 'attendance_retention_disposal_disabled';end if;
   operation_value:=(p_command->>'operationId')::uuid;cmd_sha:=public.faolla_attendance_disposal_hash_v1(site,p_auth_user_id,p_command);
   select * into a from public.merchant_attendance_disposal_approvals where merchant_id=site and operation_id=operation_value;
   select * into x from public.merchant_attendance_disposal_executions where merchant_id=site and operation_id=operation_value;
   if a.operation_id is not null or x.operation_id is not null then
    if a.operation_id is not null and (a.actor_auth_user_id is distinct from p_auth_user_id or a.command is distinct from p_command)
     or x.operation_id is not null and (x.actor_auth_user_id is distinct from p_auth_user_id or x.command is distinct from p_command) then raise exception 'attendance_operation_conflict';end if;
   elsif p_command->>'action'='approve' then
    as_of:=(p_command->>'previewAt')::timestamptz;if as_of>now_at then raise exception 'attendance_retention_disposal_changed';end if;
    p:=public.faolla_attendance_disposal_preview_v1(site,event_value,as_of);
    if p->>'candidateState'<>'candidate' then raise exception 'attendance_retention_disposal_blocked';end if;
    if public.faolla_attendance_disposal_matches_v1(p,p_command) is distinct from true then raise exception 'attendance_retention_disposal_changed';end if;
    if (p->>'dueAt')::timestamptz>now_at then raise exception 'attendance_retention_disposal_blocked';end if;
    insert into public.merchant_attendance_disposal_approvals values(site,operation_value,event_value,p_auth_user_id,p_command,cmd_sha,as_of,p->>'sourceFingerprint',p->>'policyFingerprint',p->>'dependencyFingerprint',p->>'holdFingerprint',p->>'previewFingerprint',now_at);
   else
    select * into a from public.merchant_attendance_disposal_approvals where merchant_id=site and operation_id=(p_command->>'approvalOperationId')::uuid and event_id=event_value;
    if a.operation_id is null then raise exception 'attendance_retention_disposal_not_found';end if;
    if a.actor_auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied';end if;
    if exists(select 1 from public.merchant_attendance_disposal_executions where event_id=event_value or merchant_id=site and approval_operation_id=a.operation_id) then raise exception 'attendance_retention_disposal_changed';end if;
    p:=public.faolla_attendance_disposal_preview_v1(site,event_value,a.preview_at);
    if p->>'candidateState'<>'candidate' then raise exception 'attendance_retention_disposal_blocked';end if;
    if public.faolla_attendance_disposal_matches_v1(p,a.command) is distinct from true then raise exception 'attendance_retention_disposal_changed';end if;
    if (p->>'dueAt')::timestamptz>now_at then raise exception 'attendance_retention_disposal_blocked';end if;
    marker:=jsonb_build_object('protocol','attendance-location-precision-disposal-v1','operationId',operation_value,'disposedAt',public.faolla_attendance_disposal_stamp_v1(now_at),'fields',jsonb_build_array('captured_at','accuracy_meters','distance_meters'));
    src:=public.faolla_attendance_retention_source_v1(site,'location_results',event_value)||jsonb_build_object('capturedAt',null,'accuracyMeters',null,'distanceMeters',null,'disposal',marker);
    after_sha:=public.faolla_attendance_disposal_sha_v1(jsonb_build_object('siteId',site,'category','location_results','recordId',event_value,'source',src));
    insert into public.merchant_attendance_disposal_executions values(site,operation_value,event_value,a.operation_id,p_auth_user_id,p_command,cmd_sha,a.source_fingerprint,after_sha,public.faolla_attendance_disposal_unchanged_v1(loc),pg_current_xact_id(),now_at);
    update public.merchant_attendance_location_results set captured_at=null,accuracy_meters=null,distance_meters=null,disposal_operation_id=operation_value where event_id=event_value;
   end if;
   data_value:=jsonb_build_object('kind','receipt','receipt',public.faolla_attendance_disposal_receipt_v1(site,operation_value,p_auth_user_id));
  end if;
 else raise exception 'attendance_invalid_request';end if;
 return jsonb_build_object('protocol','attendance-retention-disposal-v1','siteId',site,'actorId',p_auth_user_id,'readAt',public.faolla_attendance_disposal_stamp_v1(clock_timestamp()),'data',data_value);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_retention_disposal_invalid';
end;
$$;

create or replace function public.faolla_attendance_disposal_artifact_proof_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare a public.merchant_attendance_period_artifacts%rowtype;refs jsonb;actual jsonb;c public.merchant_attendance_disposal_artifact_coverage%rowtype;
begin
 if tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' or tg_relid<>'public.merchant_attendance_disposal_artifact_coverage'::regclass then raise exception 'attendance_retention_disposal_invalid';end if;
 select * into a from public.merchant_attendance_period_artifacts where merchant_id=new.merchant_id and artifact_id=new.artifact_id;
 select * into c from public.merchant_attendance_disposal_artifact_coverage where merchant_id=new.merchant_id and artifact_id=new.artifact_id;
 refs:=public.faolla_attendance_disposal_artifact_refs_v1(a);
 select coalesce(jsonb_agg(event_id order by event_id),'[]'::jsonb) into actual from public.merchant_attendance_disposal_artifact_event_refs where merchant_id=a.merchant_id and artifact_id=a.artifact_id;
 if a.artifact_id is null or c.artifact_sha256 is distinct from a.artifact_sha256 or c.source_fingerprint is distinct from a.source_fingerprint
  or c.status is distinct from refs->>'status' or c.references_fingerprint is distinct from refs->>'referencesFingerprint'
  or c.reference_count<>jsonb_array_length(actual) or actual is distinct from refs->'eventIds' then raise exception 'attendance_retention_disposal_invalid';end if;
 return new;
end;
$$;

-- Pin each exact old body and metadata, replace only a single projection, then
-- compare OID, ACL, defaults and every non-body pg_proc attribute unchanged.
do $disposal_forward$
declare manifest jsonb:=$disposal_recipes$
[
 {"name":"faolla_attendance_operational_punch_core_location_v1","types":"text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb","oldHash":"ef07a7f2c161e441c0ad83568ecab882448589a3e584002adf4136cbb45d7580","newHash":"4c4335d63408ada61d869321c20745f081caa8635df4359b56d5b977d92a3b8c","securityDefiner":false,"serviceExecute":false,"volatility":"v","config":["search_path=pg_catalog"],"changes":[{"from":"'accuracyMeters',v_result.accuracy_meters,'distanceMeters',v_result.distance_meters) end,","to":"'accuracyMeters',v_result.accuracy_meters,'distanceMeters',v_result.distance_meters)\n      || case when v_result.disposal_operation_id is null then '{}'::jsonb else jsonb_build_object('disposal',public.faolla_attendance_disposal_projection_v1(v_result)) end end,"}]},
 {"name":"faolla_attendance_retention_source_v1","types":"text,text,uuid","oldHash":"f321927d58a9bcc773ab8186a67fdc291be23132b982d7a6c6dd316300074f7d","newHash":"ef046cc3a5f45f709f6e03e9fdafa9d04cff5864b789d5a81a8a447c8e7be226","securityDefiner":false,"serviceExecute":false,"volatility":"s","config":["search_path=pg_catalog","extra_float_digits=3"],"changes":[{"from":"'accuracyMeters',loc.accuracy_meters,'distanceMeters',loc.distance_meters);","to":"'accuracyMeters',loc.accuracy_meters,'distanceMeters',loc.distance_meters)\n        || case when loc.disposal_operation_id is null then '{}'::jsonb else jsonb_build_object('disposal',public.faolla_attendance_disposal_projection_v1(loc)) end;"}]}
]
$disposal_recipes$::jsonb;spec jsonb;change_value jsonb;fn pg_proc%rowtype;new_fn pg_proc%rowtype;body_value text;definition text;defaults_value text;original_oid oid;original_acl aclitem[];
 installed boolean;ns text;expected_owner oid:=(select oid from pg_roles where rolname=current_user);
begin
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_events'::regclass;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080197) into installed;
 for spec in select value from jsonb_array_elements(manifest) loop
  select * into fn from pg_proc where oid=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',spec->>'types'));
  if fn.oid is null or fn.proowner<>expected_owner or fn.prolang<>(select oid from pg_language where lanname='plpgsql') or fn.prorettype<>'jsonb'::regtype
   or fn.prosecdef is distinct from (spec->>'securityDefiner')::boolean or fn.provolatile::text is distinct from spec->>'volatility'
   or to_jsonb(fn.proconfig) is distinct from spec->'config' or fn.proretset or fn.proisstrict or fn.proleakproof or fn.proparallel<>'u'
   or fn.proargnames is distinct from (case when spec->>'name'='faolla_attendance_retention_source_v1' then array['p_site','p_category','p_record'] else array['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock','p_intent'] end)
   or fn.pronargdefaults<>(case when spec->>'name'='faolla_attendance_retention_source_v1' then 0 else 6 end)
   or spec->>'name'<>'faolla_attendance_retention_source_v1' and pg_get_expr(fn.proargdefaults,0) is distinct from 'NULL::jsonb, NULL::uuid, NULL::jsonb, false, false, NULL::jsonb'
   or encode(sha256(convert_to(replace(replace(fn.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from (case when installed then spec->>'newHash' else spec->>'oldHash' end)
   or exists(select 1 from aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) acl where acl.grantor<>expected_owner or acl.grantee<>expected_owner)
   or has_function_privilege('anon',fn.oid,'EXECUTE') or has_function_privilege('authenticated',fn.oid,'EXECUTE') or has_function_privilege('service_role',fn.oid,'EXECUTE') then raise exception 'merchant_attendance_disposal_legacy_changed';end if;
  if not installed then
   original_oid:=fn.oid;original_acl:=fn.proacl;defaults_value:=pg_get_expr(fn.proargdefaults,0);body_value:=replace(fn.prosrc,E'\r\n',E'\n');
   for change_value in select value from jsonb_array_elements(spec->'changes') loop
    if (length(body_value)-length(replace(body_value,replace(change_value->>'from','pub'||'lic.',ns||'.'),'')))/length(replace(change_value->>'from','pub'||'lic.',ns||'.'))<>1 then raise exception 'merchant_attendance_disposal_legacy_changed';end if;
    body_value:=replace(body_value,replace(change_value->>'from','pub'||'lic.',ns||'.'),replace(change_value->>'to','pub'||'lic.',ns||'.'));
   end loop;
   if encode(sha256(convert_to(replace(body_value,ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'newHash' then raise exception 'merchant_attendance_disposal_legacy_changed';end if;
   definition:=pg_get_functiondef(fn.oid);execute replace(definition,fn.prosrc,body_value);
   select * into new_fn from pg_proc where oid=original_oid;
   if new_fn.oid is distinct from original_oid or new_fn.proacl is distinct from original_acl
    or (to_jsonb(new_fn)-array['prosrc','proargdefaults']) is distinct from (to_jsonb(fn)-array['prosrc','proargdefaults'])
    or pg_get_expr(new_fn.proargdefaults,0) is distinct from defaults_value then raise exception 'merchant_attendance_disposal_legacy_changed';end if;
  end if;
 end loop;
end;
$disposal_forward$;

-- Derive the measured constraint expression/column set on this PostgreSQL;
-- never guess a generated constraint name or loosen an unrelated check.
create temporary table disposal_location_check_probe(
 reason text,needs_review boolean,captured_at timestamptz,accuracy_meters double precision,distance_meters integer,disposal_operation_id uuid,
 constraint original_measured check(case when reason in ('inside','outside','uncertain','stale','future') then
  captured_at is not null and accuracy_meters is not null and distance_meters is not null else captured_at is null and accuracy_meters is null and distance_meters is null end),
 constraint disposed_measured check((disposal_operation_id is null and case when reason in ('inside','outside','uncertain','stale','future') then
  captured_at is not null and accuracy_meters is not null and distance_meters is not null else captured_at is null and accuracy_meters is null and distance_meters is null end)
  or (disposal_operation_id is not null and reason='inside' and not needs_review and captured_at is null and accuracy_meters is null and distance_meters is null))
) on commit drop;
do $disposal_location_constraint$
declare old_expr text;new_expr text;expected_expr text;constraint_value record;n integer:=0;installed boolean;
begin
 select pg_get_expr(conbin,conrelid) into old_expr from pg_constraint where conrelid='pg_temp.disposal_location_check_probe'::regclass and conname='original_measured';
 select pg_get_expr(conbin,conrelid) into new_expr from pg_constraint where conrelid='pg_temp.disposal_location_check_probe'::regclass and conname='disposed_measured';
 select exists(select 1 from public.faolla_schema_migrations where version=202610080197) into installed;expected_expr:=case when installed then new_expr else old_expr end;
 for constraint_value in select * from pg_constraint where conrelid='public.merchant_attendance_location_results'::regclass and contype='c' and pg_get_expr(conbin,conrelid)=expected_expr loop
  n:=n+1;
  if not constraint_value.convalidated or constraint_value.connoinherit or array(select a.attname::text from unnest(constraint_value.conkey) k join pg_attribute a on a.attrelid=constraint_value.conrelid and a.attnum=k order by a.attname)
   is distinct from (case when installed then array['accuracy_meters','captured_at','disposal_operation_id','distance_meters','needs_review','reason'] else array['accuracy_meters','captured_at','distance_meters','reason'] end) then raise exception 'merchant_attendance_disposal_constraint_changed';end if;
  if not installed then
   execute format('alter table public.merchant_attendance_location_results drop constraint %I',constraint_value.conname);
   execute 'alter table public.merchant_attendance_location_results add constraint attendance_location_precision_disposal_check check ('||new_expr||')';
  end if;
 end loop;
 if n<>1 then raise exception 'merchant_attendance_disposal_constraint_changed';end if;
end;
$disposal_location_constraint$;

do $disposal_trigger_boundary$
declare installed boolean;t record;old_function oid;
begin
 select exists(select 1 from public.faolla_schema_migrations where version=202610080197) into installed;
 select * into t from pg_trigger where tgrelid='public.merchant_attendance_location_results'::regclass and tgname='merchant_attendance_location_results_no_rewrite';
 old_function:=case when installed then 'public.faolla_attendance_disposal_location_guard_v1()'::regprocedure else 'public.faolla_attendance_events_append_only_v1()'::regprocedure end;
 if t.oid is null or t.tgfoid<>old_function or t.tgtype<>(case when installed then 31 else 27 end) or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgdeferrable or t.tginitdeferred then raise exception 'merchant_attendance_disposal_trigger_changed';end if;
 if not installed then
  drop trigger merchant_attendance_location_results_no_rewrite on public.merchant_attendance_location_results;
  create trigger merchant_attendance_location_results_no_rewrite before insert or update or delete on public.merchant_attendance_location_results for each row execute function public.faolla_attendance_disposal_location_guard_v1();
  create constraint trigger disposal_location_proof after update on public.merchant_attendance_location_results deferrable initially deferred for each row execute function public.faolla_attendance_disposal_proof_v1();
  create trigger disposal_event_capture after insert on public.merchant_attendance_events for each row execute function public.faolla_attendance_disposal_event_capture_v1();
  create constraint trigger disposal_event_proof after insert on public.merchant_attendance_events deferrable initially deferred for each row execute function public.faolla_attendance_disposal_proof_v1();
  create constraint trigger disposal_artifact_capture after insert on public.merchant_attendance_period_artifacts deferrable initially deferred for each row execute function public.faolla_attendance_disposal_artifact_capture_v1();
  create constraint trigger disposal_coverage_proof after insert on public.merchant_attendance_disposal_event_coverage deferrable initially deferred for each row execute function public.faolla_attendance_disposal_proof_v1();
  create constraint trigger disposal_artifact_coverage_proof after insert on public.merchant_attendance_disposal_artifact_coverage deferrable initially deferred for each row execute function public.faolla_attendance_disposal_artifact_proof_v1();
  create trigger disposal_approval_proof before insert on public.merchant_attendance_disposal_approvals for each row execute function public.faolla_attendance_disposal_proof_v1();
  create trigger disposal_execution_basis before insert on public.merchant_attendance_disposal_executions for each row execute function public.faolla_attendance_disposal_proof_v1();
  create constraint trigger disposal_execution_proof after insert on public.merchant_attendance_disposal_executions deferrable initially deferred for each row execute function public.faolla_attendance_disposal_proof_v1();
 end if;
end;
$disposal_trigger_boundary$;

-- Revoke the bootstrap role only when it is not the private table owner.
do $pilot_private_table_bootstrap_acl$
declare target regclass;
begin
  for target in
    select c.oid::regclass from pg_catalog.pg_class c
    where c.oid=any(array[
      'public.merchant_attendance_disposal_event_coverage'::regclass,
      'public.merchant_attendance_disposal_artifact_coverage'::regclass,
      'public.merchant_attendance_disposal_artifact_event_refs'::regclass,
      'public.merchant_attendance_disposal_approvals'::regclass,
      'public.merchant_attendance_disposal_executions'::regclass
    ]) and c.relowner<>(select oid from pg_catalog.pg_roles where rolname='postgres')
  loop
    execute format('revoke all privileges on table %s from postgres',target);
  end loop;
end;
$pilot_private_table_bootstrap_acl$;

do $disposal_private_tables$
declare n text;installed boolean;t regclass;
begin
 select exists(select 1 from public.faolla_schema_migrations where version=202610080197) into installed;
 foreach n in array array['merchant_attendance_disposal_event_coverage','merchant_attendance_disposal_artifact_coverage','merchant_attendance_disposal_artifact_event_refs','merchant_attendance_disposal_approvals','merchant_attendance_disposal_executions'] loop
  t:=to_regclass('public.'||n);
  if not installed then
   execute format('alter table %s enable row level security',t);execute format('revoke all on %s from public,anon,authenticated,service_role',t);
   execute format('create trigger disposal_immutable before update or delete on %s for each row execute function public.faolla_attendance_events_append_only_v1()',t);
   execute format('create trigger disposal_no_truncate before truncate on %s for each statement execute function public.faolla_attendance_events_append_only_v1()',t);
  end if;
 end loop;
end;
$disposal_private_tables$;

-- PRIVATE functions are never callable by a client/service; only the exact RPC
-- obtains service EXECUTE. Do not touch inherited shared archive guards.
do $disposal_function_permissions$
declare f record;installed boolean;
begin
 select exists(select 1 from public.faolla_schema_migrations where version=202610080197) into installed;
 if not installed then
  for f in select oid from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_events'::regclass)
   and (proname like 'faolla_attendance_disposal_%' or proname='faolla_attendance_retention_disposal_v1') loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  end loop;
  grant execute on function public.faolla_attendance_retention_disposal_v1(jsonb,uuid,jsonb,boolean) to service_role;
 end if;
end;
$disposal_function_permissions$;

-- Independent temporary definitions verify columns/defaults/check expressions
-- and PK/unique shape. PostgreSQL forbids temporary-to-permanent foreign keys;
-- all eight genuine foreign keys are independently pinned below instead.
create temporary table probe_merchant_attendance_disposal_event_coverage(
 event_id uuid primary key,
 merchant_id text not null,worker_id uuid not null,sequence bigint not null check(sequence between 1 and 9007199254740991),
 coverage_version integer not null check(coverage_version=1),recorded_at timestamptz not null check(isfinite(recorded_at)),
 unique(merchant_id,event_id)
) on commit drop;
create temporary table probe_merchant_attendance_disposal_artifact_coverage(
 merchant_id text not null,artifact_id uuid not null,artifact_sha256 text not null check(artifact_sha256~'^[0-9a-f]{64}$'),
 source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),coverage_version integer not null check(coverage_version=1),
 status text not null check(status in('complete','incomplete')),reference_count integer not null check(reference_count between 0 and 65536),
 references_fingerprint text not null check(references_fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz not null check(isfinite(recorded_at)),
 primary key(merchant_id,artifact_id)
) on commit drop;
create temporary table probe_merchant_attendance_disposal_artifact_event_refs(
 merchant_id text not null,event_id uuid not null,artifact_id uuid not null,
 coverage_version integer not null check(coverage_version=1),primary key(merchant_id,event_id,artifact_id)
) on commit drop;
create temporary table probe_merchant_attendance_disposal_approvals(
 merchant_id text not null,operation_id uuid not null,event_id uuid not null,
 actor_auth_user_id uuid not null,command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 preview_at timestamptz not null check(isfinite(preview_at)),source_fingerprint text not null,policy_fingerprint text not null,dependency_fingerprint text not null,
 hold_fingerprint text not null,preview_fingerprint text not null,recorded_at timestamptz not null check(isfinite(recorded_at) and recorded_at>=preview_at),
 primary key(merchant_id,operation_id),unique(merchant_id,operation_id,event_id),
 check((public.faolla_attendance_disposal_command_v1(command) is true and command->>'action'='approve' and command->>'operationId'=operation_id::text and command->>'eventId'=event_id::text
  and command_fingerprint=public.faolla_attendance_disposal_hash_v1(merchant_id,actor_auth_user_id,command)
  and command->>'previewAt'=public.faolla_attendance_disposal_stamp_v1(preview_at)
  and command->>'expectedSourceFingerprint'=source_fingerprint and command->>'expectedPolicyFingerprint'=policy_fingerprint
  and command->>'expectedDependencyFingerprint'=dependency_fingerprint and command->>'expectedHoldFingerprint'=hold_fingerprint and command->>'expectedPreviewFingerprint'=preview_fingerprint) is true)
) on commit drop;
create temporary table probe_merchant_attendance_disposal_executions(
 merchant_id text not null,operation_id uuid not null,event_id uuid not null,approval_operation_id uuid not null,actor_auth_user_id uuid not null,
 command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),
 before_source_fingerprint text not null check(before_source_fingerprint~'^[0-9a-f]{64}$'),after_source_fingerprint text not null check(after_source_fingerprint~'^[0-9a-f]{64}$'),
 unchanged_fingerprint text not null check(unchanged_fingerprint~'^[0-9a-f]{64}$'),transaction_id xid8 not null,recorded_at timestamptz not null check(isfinite(recorded_at)),
 primary key(merchant_id,operation_id),unique(event_id),unique(merchant_id,approval_operation_id),
 check((public.faolla_attendance_disposal_command_v1(command) is true and command->>'action'='execute' and command->>'operationId'=operation_id::text and command->>'eventId'=event_id::text
  and command->>'approvalOperationId'=approval_operation_id::text and command_fingerprint=public.faolla_attendance_disposal_hash_v1(merchant_id,actor_auth_user_id,command)) is true)
) on commit drop;
do $disposal_table_postconditions$
declare n text;t regclass;probe regclass;actual jsonb;expected jsonb;role_name text;
 foreign_keys jsonb:=$disposal_foreign_keys$
[
 ["merchant_attendance_disposal_event_coverage","disposal_event_coverage_event_fk",["event_id"],"merchant_attendance_events",["id"],"a","r","s",true,true,false,false],
 ["merchant_attendance_disposal_event_coverage","disposal_event_coverage_worker_fk",["merchant_id","worker_id"],"merchant_attendance_workers",["merchant_id","id"],"a","a","s",true,true,false,false],
 ["merchant_attendance_disposal_artifact_coverage","disposal_artifact_coverage_artifact_fk",["merchant_id","artifact_id"],"merchant_attendance_period_artifacts",["merchant_id","artifact_id"],"a","a","s",true,true,false,false],
 ["merchant_attendance_disposal_artifact_event_refs","disposal_artifact_refs_event_fk",["event_id"],"merchant_attendance_events",["id"],"a","a","s",true,true,false,false],
 ["merchant_attendance_disposal_artifact_event_refs","disposal_artifact_refs_coverage_fk",["merchant_id","artifact_id"],"merchant_attendance_disposal_artifact_coverage",["merchant_id","artifact_id"],"a","a","s",true,true,false,false],
 ["merchant_attendance_disposal_approvals","disposal_approvals_settings_fk",["merchant_id"],"merchant_attendance_settings",["merchant_id"],"a","a","s",true,true,false,false],
 ["merchant_attendance_disposal_approvals","disposal_approvals_event_fk",["event_id"],"merchant_attendance_events",["id"],"a","a","s",true,true,false,false],
 ["merchant_attendance_disposal_executions","disposal_executions_approval_fk",["merchant_id","approval_operation_id","event_id"],"merchant_attendance_disposal_approvals",["merchant_id","operation_id","event_id"],"a","a","s",true,true,false,false]
]
$disposal_foreign_keys$::jsonb;
begin
 foreach n in array array['merchant_attendance_disposal_event_coverage','merchant_attendance_disposal_artifact_coverage','merchant_attendance_disposal_artifact_event_refs','merchant_attendance_disposal_approvals','merchant_attendance_disposal_executions'] loop
  t:=to_regclass('public.'||n);probe:=to_regclass('pg_temp.probe_'||n);
  select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,atthasdef,attidentity,attgenerated,attndims) order by attnum) into actual from pg_attribute where attrelid=t and attnum>0 and not attisdropped;
  select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,atthasdef,attidentity,attgenerated,attndims) order by attnum) into expected from pg_attribute where attrelid=probe and attnum>0 and not attisdropped;
  if actual is distinct from expected or exists(select 1 from pg_attribute where attrelid=t and attisdropped)
   or not exists(select 1 from pg_class where oid=t and relowner=(select oid from pg_roles where rolname=current_user) and relkind='r' and relrowsecurity and not relforcerowsecurity)
   or exists(select 1 from pg_policy where polrelid=t) then raise exception 'merchant_attendance_disposal_table_changed';end if;
  select jsonb_agg(jsonb_build_array(contype,case when contype='c' then pg_get_expr(conbin,conrelid) else pg_get_constraintdef(oid) end,convalidated,connoinherit,condeferrable,condeferred) order by contype,case when contype='c' then pg_get_expr(conbin,conrelid) else pg_get_constraintdef(oid) end) into actual from pg_constraint where conrelid=t and contype in('c','p','u');
  select jsonb_agg(jsonb_build_array(contype,case when contype='c' then pg_get_expr(conbin,conrelid) else pg_get_constraintdef(oid) end,convalidated,connoinherit,condeferrable,condeferred) order by contype,case when contype='c' then pg_get_expr(conbin,conrelid) else pg_get_constraintdef(oid) end) into expected from pg_constraint where conrelid=probe and contype in('c','p','u');
  if actual is distinct from expected or exists(select 1 from pg_constraint where conrelid=t and contype not in('c','p','f','u','t'))
   or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where c.oid=t and (acl.grantee<>c.relowner or acl.grantor<>c.relowner))
   or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=t and (acl.grantee<>(select oid from pg_roles where rolname=current_user) or acl.grantor<>(select oid from pg_roles where rolname=current_user))) then raise exception 'merchant_attendance_disposal_table_changed';end if;
  -- Exact sorted catalog tuples reject missing, extra, renamed or altered FKs.
  -- Referenced OIDs, both ordered column sets, every action/match and all
  -- validation/deferral flags are independently bound; no name normalization.
  select jsonb_agg(jsonb_build_array(c.conname,
   array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum order by k.n),
   c.confrelid::text,
   array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum order by k.n),
   c.confupdtype::text,c.confdeltype::text,c.confmatchtype::text,c.convalidated,c.connoinherit,c.condeferrable,c.condeferred) order by c.conname)
   into actual from pg_constraint c where c.conrelid=t and c.contype='f';
  select jsonb_agg(jsonb_build_array(spec->1,spec->2,to_regclass('public.'||(spec->>3))::oid::text,spec->4,
   spec->5,spec->6,spec->7,spec->8,spec->9,spec->10,spec->11) order by spec->>1)
   into expected from jsonb_array_elements(foreign_keys) spec where spec->>0=n;
  if actual is distinct from expected then raise exception 'merchant_attendance_disposal_foreign_key_changed';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'merchant_attendance_disposal_permission_conflict';end if;
  end loop;
 end loop;
end;
$disposal_table_postconditions$;

create index probe_disposal_incomplete_idx on probe_merchant_attendance_disposal_artifact_coverage(merchant_id,artifact_id) where status='incomplete';
create index probe_disposal_refs_idx on probe_merchant_attendance_disposal_artifact_event_refs(merchant_id,artifact_id,event_id);
do $disposal_index_postconditions$
declare n text;t regclass;probe regclass;actual jsonb;expected jsonb;
begin
 foreach n in array array['merchant_attendance_disposal_event_coverage','merchant_attendance_disposal_artifact_coverage','merchant_attendance_disposal_artifact_event_refs','merchant_attendance_disposal_approvals','merchant_attendance_disposal_executions'] loop
  t:=to_regclass('public.'||n);probe:=to_regclass('pg_temp.probe_'||n);
  select jsonb_agg(jsonb_build_array(i.indkey::text,i.indnkeyatts,i.indisunique,i.indisprimary,pg_get_expr(i.indpred,i.indrelid),pg_get_expr(i.indexprs,i.indrelid),a.amname) order by i.indkey::text,i.indisunique,i.indisprimary,coalesce(pg_get_expr(i.indpred,i.indrelid),'')) into actual
   from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indrelid=t;
  select jsonb_agg(jsonb_build_array(i.indkey::text,i.indnkeyatts,i.indisunique,i.indisprimary,pg_get_expr(i.indpred,i.indrelid),pg_get_expr(i.indexprs,i.indrelid),a.amname) order by i.indkey::text,i.indisunique,i.indisprimary,coalesce(pg_get_expr(i.indpred,i.indrelid),'')) into expected
   from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am a on a.oid=c.relam where i.indrelid=probe;
  if actual is distinct from expected or exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid=t
   and (not i.indisvalid or not i.indisready or not i.indislive or i.indisexclusion or c.relowner<>(select oid from pg_roles where rolname=current_user))) then raise exception 'merchant_attendance_disposal_index_changed';end if;
 end loop;
end;
$disposal_index_postconditions$;

do $disposal_trigger_postconditions$
declare spec record;t pg_trigger%rowtype;n text;expected integer;
begin
 for spec in select * from(values
  ('merchant_attendance_events','disposal_event_capture',5,'faolla_attendance_disposal_event_capture_v1',false),
  ('merchant_attendance_events','disposal_event_proof',5,'faolla_attendance_disposal_proof_v1',true),
  ('merchant_attendance_period_artifacts','disposal_artifact_capture',5,'faolla_attendance_disposal_artifact_capture_v1',true),
  ('merchant_attendance_location_results','merchant_attendance_location_results_no_rewrite',31,'faolla_attendance_disposal_location_guard_v1',false),
  ('merchant_attendance_location_results','merchant_attendance_location_results_no_truncate',34,'faolla_attendance_events_append_only_v1',false),
  ('merchant_attendance_location_results','disposal_location_proof',17,'faolla_attendance_disposal_proof_v1',true),
  ('merchant_attendance_disposal_event_coverage','disposal_coverage_proof',5,'faolla_attendance_disposal_proof_v1',true),
  ('merchant_attendance_disposal_artifact_coverage','disposal_artifact_coverage_proof',5,'faolla_attendance_disposal_artifact_proof_v1',true),
  ('merchant_attendance_disposal_approvals','disposal_approval_proof',7,'faolla_attendance_disposal_proof_v1',false),
  ('merchant_attendance_disposal_executions','disposal_execution_basis',7,'faolla_attendance_disposal_proof_v1',false),
  ('merchant_attendance_disposal_executions','disposal_execution_proof',5,'faolla_attendance_disposal_proof_v1',true)
 ) e(table_name,trigger_name,trigger_type,function_name,deferred) loop
  select * into t from pg_trigger where tgrelid=to_regclass('public.'||spec.table_name) and tgname=spec.trigger_name;
  if t.oid is null or t.tgtype<>spec.trigger_type or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgoldtable is not null or t.tgnewtable is not null
   or t.tgfoid<>to_regprocedure('public.'||spec.function_name||'()') or t.tgdeferrable is distinct from spec.deferred or t.tginitdeferred is distinct from spec.deferred
   or (t.tgconstraint<>0) is distinct from spec.deferred then raise exception 'merchant_attendance_disposal_trigger_changed';end if;
 end loop;
 foreach n in array array['merchant_attendance_disposal_event_coverage','merchant_attendance_disposal_artifact_coverage','merchant_attendance_disposal_artifact_event_refs','merchant_attendance_disposal_approvals','merchant_attendance_disposal_executions'] loop
  expected:=case n when 'merchant_attendance_disposal_artifact_event_refs' then 2 when 'merchant_attendance_disposal_executions' then 4 else 3 end;
  if (select count(*) from pg_trigger where tgrelid=to_regclass('public.'||n) and not tgisinternal)<>expected then raise exception 'merchant_attendance_disposal_trigger_changed';end if;
  if (select count(*) from pg_trigger where tgrelid=to_regclass('public.'||n) and tgname in('disposal_immutable','disposal_no_truncate'))<>2 then raise exception 'merchant_attendance_disposal_trigger_changed';end if;
  for t in select * from pg_trigger where tgrelid=to_regclass('public.'||n) and tgname in('disposal_immutable','disposal_no_truncate') loop
   if t.tgtype<>(case when t.tgname='disposal_immutable' then 27 else 34 end) or t.tgfoid<>'public.faolla_attendance_events_append_only_v1()'::regprocedure
    or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgdeferrable or t.tginitdeferred then raise exception 'merchant_attendance_disposal_trigger_changed';end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.merchant_attendance_location_results'::regclass and attname='disposal_operation_id' and atttypid='uuid'::regtype
  and not attnotnull and not atthasdef and not attisdropped and attidentity='' and attgenerated='' and attndims=0) then raise exception 'merchant_attendance_disposal_column_changed';end if;
end;
$disposal_trigger_postconditions$;
do $disposal_new_postconditions$
declare manifest jsonb:=$disposal_functions_after$
[
 {
  "name": "faolla_attendance_disposal_stamp_v1",
  "types": "timestamptz",
  "argnames": [
   "p"
  ],
  "hash": "6d0b940b342a28ef5abe117ceb132f80180680cf1a7ac65af88be475f7f879a2",
  "language": "sql",
  "result": "text",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_sha_v1",
  "types": "jsonb",
  "argnames": [
   "p"
  ],
  "hash": "fb2a49a586549a672210138c64c1464a251e6e3c7b7b6b2e8662d2b96239abe7",
  "language": "sql",
  "result": "text",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_command_v1",
  "types": "jsonb",
  "argnames": [
   "p"
  ],
  "hash": "63e2ce735a839f2d078e9add7d8a88e0f14f4bdc4266040a376f402c7660a8e3",
  "language": "plpgsql",
  "result": "boolean",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_hash_v1",
  "types": "text,uuid,jsonb",
  "argnames": [
   "p_site",
   "p_actor",
   "p"
  ],
  "hash": "57a36b51cf5111b5a2e8e5bb0815e806eb45340e9c6544096cd52dcc3a94dc04",
  "language": "plpgsql",
  "result": "text",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_event_capture_v1",
  "types": "",
  "argnames": [],
  "hash": "e8205ee4ee7a8f9a9d0dd88c3384697f918dc18c3ff198aa1051a2c32c91693d",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_json_v1",
  "types": "text",
  "argnames": [
   "p"
  ],
  "hash": "d839369c35afcea3841409190085835ca93bb63323dafc45f9ff833fb492e1c8",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_artifact_refs_v1",
  "types": "public.merchant_attendance_period_artifacts",
  "argnames": [
   "p"
  ],
  "hash": "1157d39b88958af5ac068f6d4f00eaa451489db7c75c6b1d9a71cff62af9a44f",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "v",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_artifact_capture_v1",
  "types": "",
  "argnames": [],
  "hash": "af696546fa9c6ebb5f9d3bde2f71e67f98b79f297323175899c0ba65511d518a",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_session_v1",
  "types": "public.merchant_attendance_events,timestamptz",
  "argnames": [
   "p",
   "p_as_of"
  ],
  "hash": "5ab788ca1bbda56a17f8c4b4f4d4a8ceef057293c65c6301df2612a959e17600",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_hold_v1",
  "types": "text,text,uuid,timestamptz",
  "argnames": [
   "p_site",
   "p_category",
   "p_record",
   "p_as_of"
  ],
  "hash": "a66a6d38518eb64cc88716cf39c00ffcbd634146ce72a5b6799c59ce7598067a",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_hold_tuple_v1",
  "types": "jsonb",
  "argnames": [
   "p"
  ],
  "hash": "d19472532c279406d169659e7549bf2b01b8b3e7dec9497eafa1709cd39078c1",
  "language": "sql",
  "result": "jsonb",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_preview_v1",
  "types": "text,uuid,timestamptz",
  "argnames": [
   "p_site",
   "p_event",
   "p_as_of"
  ],
  "hash": "9b3f1adcb14280684f446f5b94d6d7141e78941aacf0a53b999462df6dfc4a9d",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_unchanged_v1",
  "types": "public.merchant_attendance_location_results",
  "argnames": [
   "p"
  ],
  "hash": "edc896aafdc57ca80f1c9850b839e2ea8b6a9c785fc08a097c520f96150fd607",
  "language": "sql",
  "result": "text",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_projection_v1",
  "types": "public.merchant_attendance_location_results",
  "argnames": [
   "p"
  ],
  "hash": "aac0bab032fe0842bef0f923fd11e8fd2f57483c7665388288717b19de54b3a6",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_matches_v1",
  "types": "jsonb,jsonb",
  "argnames": [
   "p",
   "c"
  ],
  "hash": "081495888812d763aeea89e94b6bb48b9f9ffe149eb7063e2daba7abba665db6",
  "language": "sql",
  "result": "boolean",
  "volatility": "i",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_location_guard_v1",
  "types": "",
  "argnames": [],
  "hash": "2ca333a85db8f36f5a91f2c713bdfc56d1c8f2cca222eb5687cacffe7a345215",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_proof_v1",
  "types": "",
  "argnames": [],
  "hash": "a3e6e44358f3913e5a5d7e07a1804c691ebe0fceb6acf7105a60c6469ebdefc7",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_disposal_receipt_v1",
  "types": "text,uuid,uuid",
  "argnames": [
   "p_site",
   "p_operation",
   "p_actor"
  ],
  "hash": "17058c1d009ba869f762ee3282e2f61e4ee5ac3ccccbe026cfd1c26e0e375340",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "s",
  "securityDefiner": false,
  "rpc": false,
  "defaults": 0
 },
 {
  "name": "faolla_attendance_retention_disposal_v1",
  "types": "jsonb,uuid,jsonb,boolean",
  "argnames": [
   "p_query",
   "p_auth_user_id",
   "p_command",
   "p_allow_write"
  ],
  "hash": "9547e00f6a18817a32d16847c7a988d4ac5749a2979e6111a2a136a0c2898dee",
  "language": "plpgsql",
  "result": "jsonb",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": true,
  "defaults": 2
 },
 {
  "name": "faolla_attendance_disposal_artifact_proof_v1",
  "types": "",
  "argnames": [],
  "hash": "7390e47b8de6976f5e515664acc045b7ee039eabca60149af6b035b91e3a95cc",
  "language": "plpgsql",
  "result": "trigger",
  "volatility": "v",
  "securityDefiner": true,
  "rpc": false,
  "defaults": 0
 }
]
$disposal_functions_after$::jsonb;spec jsonb;fn pg_proc%rowtype;ns text;installed boolean;expected_owner oid:=(select oid from pg_roles where rolname=current_user);f regprocedure;
begin
 select n.nspname into ns from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='public.merchant_attendance_events'::regclass;
 select exists(select 1 from public.faolla_schema_migrations where version=202610080197) into installed;
 for spec in select value from jsonb_array_elements(manifest) loop
  f:=to_regprocedure(format('%I.%I(%s)',ns,spec->>'name',replace(spec->>'types','pub'||'lic.',ns||'.')));
  
  select * into fn from pg_proc where oid=f;
  if f is null or fn.proowner<>expected_owner or fn.prolang<>(select oid from pg_language where lanname=spec->>'language') or fn.prorettype<>to_regtype(spec->>'result')
   or fn.provolatile::text is distinct from spec->>'volatility' or fn.prosecdef is distinct from (spec->>'securityDefiner')::boolean
   or fn.proconfig is distinct from array['search_path=pg_catalog'] or fn.proretset or fn.proisstrict or fn.proleakproof or fn.proparallel<>'u'
   or fn.prokind<>'f' or fn.provariadic<>0 or fn.prosupport<>0 or fn.proargmodes is not null or fn.proallargtypes is not null
   or coalesce(fn.proargnames,array[]::text[]) is distinct from array(select jsonb_array_elements_text(spec->'argnames'))
   or fn.pronargdefaults<>(spec->>'defaults')::integer or (fn.pronargdefaults>0 and pg_get_expr(fn.proargdefaults,0) is distinct from 'NULL::jsonb, false')
   or encode(sha256(convert_to(replace(replace(fn.prosrc,E'\r\n',E'\n'),ns||'.','pub'||'lic.'),'UTF8')),'hex') is distinct from spec->>'hash'
   or exists(select 1 from aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) acl where acl.grantor<>expected_owner
    or acl.grantee<>expected_owner and (not (spec->>'rpc')::boolean or acl.grantee<>(select oid from pg_roles where rolname='service_role') or acl.privilege_type<>'EXECUTE' or acl.is_grantable))
   or has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or has_function_privilege('service_role',f,'EXECUTE') is distinct from (spec->>'rpc')::boolean then raise exception 'merchant_attendance_disposal_function_changed';end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.merchant_attendance_events'::regclass)
  and (proname like 'faolla_attendance_disposal_%' or proname='faolla_attendance_retention_disposal_v1'))<>jsonb_array_length(manifest) then raise exception 'merchant_attendance_disposal_function_changed';end if;
end;
$disposal_new_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610080197,'merchant_attendance_retention_disposal') on conflict(version) do nothing;
commit;


