--Explicit delegated archives. No old bytes, source rules, writers or budgets
--are changed. The caller's eight-field candidate is NOT a stored archive:
--187 must inject the fresh locked send authority before this shape boundary.
begin;
set local lock_timeout='3s';

do $delegated_artifact_preflight$
declare installed boolean;spec record;f record;namespace_oid oid;expected_hash text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610080184 and name='merchant_attendance_period_delegated_source')
    or not exists(select 1 from public.faolla_schema_migrations where version=202610080185 and name='merchant_attendance_period_delegations')
    or to_regprocedure('public.faolla_attendance_period_delegation_proof_v1(public.merchant_attendance_period_delegation_operations)') is null then
    raise exception 'merchant_attendance_period_delegated_artifacts_prerequisite_required';end if;
  select relnamespace into namespace_oid from pg_class where oid='public.faolla_schema_migrations'::regclass;
  select exists(select 1 from public.faolla_schema_migrations where version=202610080186 and name='merchant_attendance_period_delegated_artifacts') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610080186 and name<>'merchant_attendance_period_delegated_artifacts') then
    raise exception 'merchant_attendance_period_delegated_artifacts_installation_conflict';end if;
  for spec in select * from (values
    ('faolla_attendance_period_artifact_checked_v1',false,false,'jsonb',1,'72d9ea85c9fb0a300a96b2cd8c4a38ac75f4910de0ad402b9a17d1d09faafe79','b44c3b760df3062d9f168fe8a6102c1585f6eb0f952a6b075c43284bf422aba8'),
    ('faolla_attendance_period_storage_insert_v2',false,true,'trigger',0,'596649f7edd6ec194e4047e4b0707eba9a6a8905208ddcb5981db0d1db2bd3dd','f52ee1c5442c6ae7a2086c337a070faae37b1c53f92da0b4267fba2679c30e31'),
    ('faolla_attendance_period_artifact_shape_v2',true,false,'jsonb',1,null,'1bd3d764c31e8ff8c45a6a0e9147e39a9d4778fbb97bd50bb97d47d5a710f307'),
    ('faolla_attendance_period_artifact_authority_v2',true,true,'trigger',0,null,'e0cf735af961aa6016ba9060bc2ed075684c3fb06704eaa21c17ec2e73963b23')
  ) x(function_name,is_new,is_definer,return_type,argument_count,old_hash,new_hash) loop
    if (select count(*) from pg_proc where pronamespace=namespace_oid and proname=spec.function_name)<>(case when spec.is_new and not installed then 0 else 1 end) then
      raise exception 'merchant_attendance_period_delegated_artifacts_function_conflict';end if;
    if spec.is_new and not installed then continue;end if;
    select * into f from pg_proc where pronamespace=namespace_oid and proname=spec.function_name;
    expected_hash:=case when installed then spec.new_hash else spec.old_hash end;
    if f.proowner<>(select relowner from pg_class where oid='public.faolla_schema_migrations'::regclass)
      or f.prokind<>'f' or f.proretset or f.proargmodes is not null or f.pronargdefaults<>0 or f.pronargs<>spec.argument_count
      or f.prorettype<>spec.return_type::regtype or f.prolang<>(select oid from pg_language where lanname='plpgsql')
      or f.prosecdef<>spec.is_definer or f.provolatile<>'v' or f.proconfig is distinct from array['search_path=pg_catalog']
      or spec.argument_count=1 and (f.proargtypes[0]<>'public.merchant_attendance_period_artifacts'::regtype or f.proargnames is distinct from array['p'])
      or encode(sha256(convert_to(replace(replace(f.prosrc,chr(13),''),quote_ident((select nspname from pg_namespace where oid=f.pronamespace))||'.','public'||'.'),'UTF8')),'hex')<>expected_hash
      or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner) then
      raise exception 'merchant_attendance_period_delegated_artifacts_function_conflict';end if;
  end loop;
  if installed is distinct from exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_period_artifacts'::regclass
      and tgname='attendance_period_artifact_authority') then raise exception 'merchant_attendance_period_delegated_artifacts_trigger_conflict';end if;
  if installed and not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_period_artifacts'::regclass
    and tgname='attendance_period_artifact_authority' and tgfoid=to_regprocedure('public.faolla_attendance_period_artifact_authority_v2()')
    and tgtype=5 and tgenabled='O' and tgdeferrable and tginitdeferred and tgconstraint<>0 and not tgisinternal) then
    raise exception 'merchant_attendance_period_delegated_artifacts_trigger_conflict';end if;
end;
$delegated_artifact_preflight$;

--Private shape only. It never asserts an authorization has been persisted.
--The ordinary checker and deferred constraint below provide that proof.
create or replace function public.faolla_attendance_period_artifact_shape_v2(p public.merchant_attendance_period_artifacts)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=p.artifact_text::jsonb;authority jsonb:=a->'authority';src jsonb:=a->'source';w jsonb:=a->'worker';frame jsonb:=a->'period';
  k text;stamp timestamptz;authorized_stamp timestamptz;granted_stamp timestamptz;first_day date;last_day date;
  fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p.merchant_id is null or p.merchant_id!~'^[0-9]{8}$' or length(p.merchant_id)<>8 or p.period_id is null or p.artifact_id is null
    or p.artifact_text is null or p.artifact_bytes is null or p.artifact_bytes not between 1 and 2097152
    or p.recorded_at is null or not isfinite(p.recorded_at)
    or p.artifact_bytes is distinct from octet_length(convert_to(p.artifact_text,'UTF8'))
    or p.artifact_sha256 is distinct from encode(sha256(convert_to(p.artifact_text,'UTF8')),'hex')
    or public.faolla_attendance_shift_rule_binding_object_v1(a,array['protocol','sourceFingerprint','source','worker','period','report','dayBoundaries','calculationVersion','authority']) is distinct from true
    or a->>'protocol' is distinct from 'attendance-period-artifact-v2' or a->>'calculationVersion' is distinct from 'timesheet-v2-unified-v1'
    or a->>'sourceFingerprint' is distinct from p.source_fingerprint
    or public.faolla_attendance_shift_rule_binding_object_v1(w,array['workerId','employeeId','employeeAuthUserId','workerName','workerNo']) is distinct from true
    or public.faolla_attendance_shift_rule_binding_object_v1(frame,array['fromDate','throughDate','timeZone','startAt','endAt']) is distinct from true
    or public.faolla_attendance_shift_rule_binding_object_v1(authority,array['protocol','siteId','grantId','grantRevision','actorEmployeeId','actorAuthUserId','workerId','employeeId','employeeAuthUserId','delegateGeneration','employeeGeneration','fromDate','throughDate','action','includeExisting','grantedAt','authorizedAt','periodId']) is distinct from true
    or authority->>'protocol' is distinct from 'period-delegation-authority-v1' or authority->>'siteId' is distinct from p.merchant_id
    or authority->'grantRevision' is distinct from '1'::jsonb or authority->>'action' is distinct from 'send'
    or authority->>'periodId' is distinct from p.period_id::text or jsonb_typeof(authority->'includeExisting') is distinct from 'boolean'
    or jsonb_typeof(src) is distinct from 'object' or jsonb_typeof(a->'report') is distinct from 'object'
    or jsonb_typeof(a->'dayBoundaries') is distinct from 'array' then raise exception 'attendance_period_closure_invalid';end if;
  foreach k in array array['grantId','actorEmployeeId','actorAuthUserId','workerId','employeeId','employeeAuthUserId','periodId'] loop
    if public.faolla_attendance_shift_rule_binding_scalar_v1(authority->k,'uuid') is distinct from true then raise exception 'attendance_period_closure_invalid';end if;
  end loop;
  foreach k in array array['workerName','workerNo'] loop
    if jsonb_typeof(w->k) is distinct from 'string' or w->>k is distinct from btrim(w->>k) or char_length(w->>k)<1
      or char_length(w->>k)>(case when k='workerName' then 120 else 40 end) or (w->>k)~'[[:cntrl:]]' then
      raise exception 'attendance_period_closure_invalid';end if;
  end loop;
  if jsonb_typeof(frame->'timeZone') is distinct from 'string' or char_length(frame->>'timeZone') not between 1 and 100
    or (frame->>'timeZone')~'[[:cntrl:]]' then raise exception 'attendance_period_closure_invalid';end if;
  foreach k in array array['startAt','endAt'] loop
    if jsonb_typeof(frame->k) is distinct from 'string' or (frame->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then
      raise exception 'attendance_period_closure_invalid';end if;
    stamp:=(frame->>k)::timestamptz;
    if not isfinite(stamp) or to_char(stamp at time zone 'UTC',fmt) is distinct from frame->>k then raise exception 'attendance_period_closure_invalid';end if;
  end loop;
  if (frame->>'startAt')::timestamptz>=(frame->>'endAt')::timestamptz then raise exception 'attendance_period_closure_invalid';end if;
  foreach k in array array['delegateGeneration','employeeGeneration'] loop
    if jsonb_typeof(authority->k) is distinct from 'number' or (authority->>k)!~'^(0|[1-9][0-9]{0,15})$'
      or (authority->>k)::numeric>9007199254740990 then raise exception 'attendance_period_closure_invalid';end if;
  end loop;
  foreach k in array array['grantedAt','authorizedAt'] loop
    if jsonb_typeof(authority->k) is distinct from 'string' or (authority->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then
      raise exception 'attendance_period_closure_invalid';end if;
    stamp:=(authority->>k)::timestamptz;
    if not isfinite(stamp) or to_char(stamp at time zone 'UTC',fmt) is distinct from authority->>k then raise exception 'attendance_period_closure_invalid';end if;
  end loop;
  granted_stamp:=(authority->>'grantedAt')::timestamptz;authorized_stamp:=(authority->>'authorizedAt')::timestamptz;
  if granted_stamp>authorized_stamp or authorized_stamp>p.recorded_at
    or authority->>'actorEmployeeId'=authority->>'employeeId' or authority->>'actorAuthUserId'=authority->>'employeeAuthUserId'
    or authority->>'workerId' is distinct from w->>'workerId' or authority->>'employeeId' is distinct from w->>'employeeId'
    or authority->>'employeeAuthUserId' is distinct from w->>'employeeAuthUserId'
    or authority->>'fromDate' is distinct from frame->>'fromDate' or authority->>'throughDate' is distinct from frame->>'throughDate'
    or src->>'siteId' is distinct from p.merchant_id or src->>'workerId' is distinct from w->>'workerId'
    or src->>'employeeId' is distinct from w->>'employeeId' or src->>'employeeAuthUserId' is distinct from w->>'employeeAuthUserId'
    or coalesce(src->>'sourceVersion','') not in('attendance-period-source-v1','attendance-period-source-v2','attendance-period-source-v3','attendance-period-source-v4')
    or src->>'sourceFingerprint' is not null or p.source_fingerprint is distinct from encode(sha256(convert_to(src::text,'UTF8')),'hex')
    or octet_length(convert_to(src::text,'UTF8'))>1048576
    or src->>'fromDate' is distinct from frame->>'fromDate' or src->>'throughDate' is distinct from frame->>'throughDate'
    or src->>'timeZone' is distinct from frame->>'timeZone' or src->>'fromAt' is distinct from frame->>'startAt' or src->>'toAt' is distinct from frame->>'endAt'
    or src->'dayBoundaries' is distinct from a->'dayBoundaries' or jsonb_array_length(a->'dayBoundaries') not between 1 and 31
    or a->'report'->>'version' is distinct from 'attendance-unified-v1' or a->'report'->'complete' is distinct from 'true'::jsonb
    or a->'report'->'payrollReady' is distinct from 'false'::jsonb or a->'report'->>'access' is distinct from 'delegate'
    or a->'report'->'base'->>'calculationVersion' is distinct from 'attendance-timesheet-v1'
    or a->'report'->'base'->>'workerId' is distinct from w->>'workerId' or a->'report'->'base'->>'employeeId' is distinct from w->>'employeeId'
    or a->'report'->'base'->>'fromDate' is distinct from frame->>'fromDate' or a->'report'->'base'->>'throughDate' is distinct from frame->>'throughDate'
    or a->'report'->'base'->>'timeZone' is distinct from frame->>'timeZone' or a->'report'->'base'->>'fromAt' is distinct from frame->>'startAt'
    or a->'report'->'base'->>'toAt' is distinct from frame->>'endAt' then raise exception 'attendance_period_closure_invalid';end if;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(frame->k) is distinct from 'string' or (frame->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((frame->>k)::date,'YYYY-MM-DD') is distinct from frame->>k then raise exception 'attendance_period_closure_invalid';end if;
  end loop;
  first_day:=(frame->>'fromDate')::date;last_day:=(frame->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 30 then raise exception 'attendance_period_closure_invalid';end if;
  return a;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
  raise exception 'attendance_period_closure_invalid';
end;
$$;

create or replace function public.faolla_attendance_period_artifact_checked_v1(p public.merchant_attendance_period_artifacts)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare a jsonb:=p.artifact_text::jsonb;
  delegated public.merchant_attendance_period_delegation_operations%rowtype;creation public.merchant_attendance_period_entries%rowtype;
  version_row public.merchant_attendance_period_versions%rowtype;head public.merchant_attendance_period_closures%rowtype;
begin
  --Only persisted delegated archives take this new branch. No current grant,
  --actor, timezone algorithm or source collector is consulted on a saved read.
  if a->>'protocol'='attendance-period-artifact-v2' then
    a:=public.faolla_attendance_period_artifact_shape_v2(p);
    select * into delegated from public.merchant_attendance_period_delegation_operations x where x.merchant_id=p.merchant_id and x.operation_id=p.artifact_id;
    select * into creation from public.merchant_attendance_period_entries x where x.merchant_id=p.merchant_id and x.operation_id=p.artifact_id;
    select * into version_row from public.merchant_attendance_period_versions x where x.merchant_id=p.merchant_id and x.operation_id=p.artifact_id;
    select * into head from public.merchant_attendance_period_closures x where x.merchant_id=p.merchant_id and x.period_id=p.period_id;
    if delegated.operation_id is null or creation.operation_id is null or version_row.operation_id is null or head.period_id is null
      or delegated.period_id is distinct from p.period_id or delegated.action is distinct from 'send'
      or delegated.authority is distinct from a->'authority' or delegated.recorded_at is distinct from p.recorded_at
      or public.faolla_attendance_period_delegation_proof_v1(delegated) is distinct from true
      or creation.period_id is distinct from p.period_id or creation.action is distinct from 'send'
      or creation.recorded_at is distinct from p.recorded_at or creation.actor_auth_user_id is distinct from delegated.actor_auth_user_id
      or creation.command->>'expectedFingerprint' is distinct from p.source_fingerprint
      or version_row.period_id is distinct from p.period_id or version_row.artifact_id is distinct from p.artifact_id
      or version_row.version is distinct from creation.version or version_row.recorded_at is distinct from p.recorded_at then
      raise exception 'attendance_period_closure_invalid';end if;
    perform public.faolla_attendance_period_entry_v2(creation);
    perform public.faolla_attendance_period_summary_v1(head,a);
    return a;
  end if;
  --149 legacy branch below is unchanged, including its original constraints.
  if p.artifact_id is null or p.artifact_text is null or p.artifact_bytes not between 1 and 2097152
    or p.artifact_bytes is distinct from octet_length(convert_to(p.artifact_text,'UTF8'))
    or p.artifact_sha256 is distinct from encode(sha256(convert_to(p.artifact_text,'UTF8')),'hex')
    or public.faolla_attendance_shift_rule_binding_object_v1(a,array['protocol','sourceFingerprint','source','worker','period','report','dayBoundaries','calculationVersion']) is distinct from true
    or a->>'protocol' is distinct from 'attendance-period-artifact-v1' or a->>'calculationVersion' is distinct from 'timesheet-v2-unified-v1'
    or a->>'sourceFingerprint' is distinct from p.source_fingerprint
    or public.faolla_attendance_shift_rule_binding_object_v1(a->'worker',array['workerId','employeeId','employeeAuthUserId','workerName','workerNo']) is distinct from true
    or public.faolla_attendance_shift_rule_binding_object_v1(a->'period',array['fromDate','throughDate','timeZone','startAt','endAt']) is distinct from true
    or jsonb_typeof(a->'source') is distinct from 'object' or jsonb_typeof(a->'report') is distinct from 'object'
    or jsonb_typeof(a->'dayBoundaries') is distinct from 'array'
    or a->'report'->>'version' is distinct from 'attendance-unified-v1' or a->'report'->'complete' is distinct from 'true'::jsonb
    or a->'report'->'payrollReady' is distinct from 'false'::jsonb or a->'report'->>'access' is distinct from 'owner'
    or a->'report'->'base'->>'calculationVersion' is distinct from 'attendance-timesheet-v1' then raise exception 'attendance_period_closure_invalid';end if;
  -- Saved bytes are checked directly, never regenerated from JSONB or tzdata.
  return a;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_period_closure_invalid';
end;
$$;

create or replace function public.faolla_attendance_period_storage_insert_v2()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare body jsonb;c public.merchant_attendance_period_closures%rowtype;
begin
  if tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' or tg_relid<>'public.merchant_attendance_period_artifacts'::regclass then
    raise exception 'attendance_period_closure_invalid';end if;
  --Every old/new period writer holds this lock before worker/employee locks.
  --Only a genuinely new artifact INSERT reaches this atomic charge.
  perform 1 from public.merchant_attendance_settings where merchant_id=new.merchant_id for update;
  if not found then raise exception 'attendance_settings_required';end if;
  if new.artifact_text::jsonb->>'protocol'='attendance-period-artifact-v2' then
    body:=public.faolla_attendance_period_artifact_shape_v2(new);
  else body:=public.faolla_attendance_period_artifact_checked_v1(new);end if;
  select * into c from public.merchant_attendance_period_closures where merchant_id=new.merchant_id and period_id=new.period_id;
  if c.period_id is null then raise exception 'attendance_period_closure_invalid';end if;
  perform public.faolla_attendance_period_summary_v1(c,body);
  insert into public.merchant_attendance_period_storage(merchant_id,used_bytes) values(new.merchant_id,0) on conflict(merchant_id) do nothing;
  update public.merchant_attendance_period_storage set used_bytes=used_bytes+new.artifact_bytes
    where merchant_id=new.merchant_id and used_bytes<=67108864-new.artifact_bytes;
  if not found then raise exception 'attendance_period_storage_limit';end if;
  insert into public.merchant_attendance_period_artifact_metadata(merchant_id,artifact_id,worker_name,worker_no)
    values(new.merchant_id,new.artifact_id,body->'worker'->>'workerName',body->'worker'->>'workerNo');
  return new;
end;
$$;

create or replace function public.faolla_attendance_period_artifact_authority_v2()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' or tg_relid<>'public.merchant_attendance_period_artifacts'::regclass then
    raise exception 'attendance_period_closure_invalid';end if;
  if new.artifact_text::jsonb->>'protocol'='attendance-period-artifact-v2' then
    perform public.faolla_attendance_period_artifact_checked_v1(new);
  end if;
  return new;
end;
$$;

do $delegated_artifact_constraint$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_period_artifacts'::regclass and tgname='attendance_period_artifact_authority') then
    create constraint trigger attendance_period_artifact_authority after insert on public.merchant_attendance_period_artifacts
      deferrable initially deferred for each row execute function public.faolla_attendance_period_artifact_authority_v2();
  end if;
end;
$delegated_artifact_constraint$;
revoke all on function public.faolla_attendance_period_artifact_shape_v2(public.merchant_attendance_period_artifacts) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_artifact_checked_v1(public.merchant_attendance_period_artifacts) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_storage_insert_v2() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_artifact_authority_v2() from public,anon,authenticated,service_role;

do $delegated_artifact_permissions$
declare signature text;role_name text;f record;
begin
  foreach signature in array array['public.faolla_attendance_period_artifact_shape_v2(public.merchant_attendance_period_artifacts)',
    'public.faolla_attendance_period_artifact_checked_v1(public.merchant_attendance_period_artifacts)',
    'public.faolla_attendance_period_storage_insert_v2()','public.faolla_attendance_period_artifact_authority_v2()'] loop
    select * into f from pg_proc where oid=signature::regprocedure;
    if f.proowner<>(select relowner from pg_class where oid='public.faolla_schema_migrations'::regclass)
      or f.proconfig is distinct from array['search_path=pg_catalog'] or f.prosecdef<>(f.proname in('faolla_attendance_period_storage_insert_v2','faolla_attendance_period_artifact_authority_v2'))
      or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner) then
      raise exception 'merchant_attendance_period_delegated_artifacts_permission_conflict';end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'merchant_attendance_period_delegated_artifacts_permission_conflict';end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_period_artifacts'::regclass and tgname='attendance_period_artifact_authority'
    and tgfoid='public.faolla_attendance_period_artifact_authority_v2()'::regprocedure and tgtype=5 and tgenabled='O'
    and tgdeferrable and tginitdeferred and tgconstraint<>0 and not tgisinternal) then raise exception 'merchant_attendance_period_delegated_artifacts_trigger_conflict';end if;
end;
$delegated_artifact_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610080186,'merchant_attendance_period_delegated_artifacts') on conflict(version) do nothing;
commit;
