--Independent real-actor period delegation. No owner/self writer is replaced.
begin;
set local lock_timeout='3s';

do $period_delegated_closure_preflight$
declare installed boolean;dependency record;function_name text;function_row record;
begin
  for dependency in select * from (values(202610080183::bigint,'merchant_attendance_period_continuation'),
    (202610080184::bigint,'merchant_attendance_period_delegated_source'),(202610080185::bigint,'merchant_attendance_period_delegations'),
    (202610080186::bigint,'merchant_attendance_period_delegated_artifacts')) expected(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations x where x.version=dependency.version and x.name=dependency.name) then
      raise exception 'merchant_attendance_period_delegated_closure_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610080187 and name='merchant_attendance_period_delegated_closure') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610080187 and name<>'merchant_attendance_period_delegated_closure')
    or to_regprocedure('public.faolla_attendance_period_artifact_shape_v2(public.merchant_attendance_period_artifacts)') is null
    or to_regprocedure('public.faolla_attendance_period_delegation_guard_v1(text,uuid,uuid,text,uuid,date,date,uuid,boolean)') is null
    or to_regprocedure('public.faolla_attendance_period_delegated_source_v1(text,uuid,uuid,uuid,uuid,date,date,uuid)') is null then
    raise exception 'merchant_attendance_period_delegated_closure_installation_conflict';end if;
  foreach function_name in array array['faolla_attendance_period_delegated_hash_v1','faolla_attendance_period_delegated_closure_v1'] loop
    if (select count(*) from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=function_name)
      <>(case when installed then 1 else 0 end) then raise exception 'merchant_attendance_period_delegated_closure_installation_conflict';end if;
    if installed then
      select * into function_row from pg_proc p where p.pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and p.proname=function_name;
      if function_row.proowner<>(select oid from pg_roles where rolname=current_user) or function_row.prokind<>'f' or function_row.proretset or function_row.proargmodes is not null
        or function_row.proconfig is distinct from array['search_path=pg_catalog'] or function_row.prosecdef<>(function_name='faolla_attendance_period_delegated_closure_v1')
        or exists(select 1 from aclexplode(coalesce(function_row.proacl,acldefault('f',function_row.proowner))) a where a.grantee<>function_row.proowner
          and not(a.grantee=(select oid from pg_roles where rolname='service_role') and function_name='faolla_attendance_period_delegated_closure_v1')) then
        raise exception 'merchant_attendance_period_delegated_closure_installation_conflict';end if;
    end if;
  end loop;
end;
$period_delegated_closure_preflight$;

create or replace function public.faolla_attendance_period_delegated_hash_v1(p_query jsonb,p_command jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare tuple_value jsonb;key_name text;first_day date;last_day date;
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','grantId','workerId','fromDate','throughDate','mode','periodId','operationId','version','cursor']) is distinct from true
    or public.faolla_attendance_period_closure_command_v2(p_command) is distinct from true or octet_length(p_query::text)>4096
    or p_query->>'access' is distinct from 'delegate' or p_query->>'mode' is distinct from 'detail'
    or p_query->'operationId' is distinct from 'null'::jsonb or p_query->'version' is distinct from 'null'::jsonb or p_query->'cursor' is distinct from 'null'::jsonb
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or coalesce(p_query->>'siteId','')!~'^[0-9]{8}$' or length(p_query->>'siteId')<>8
    or p_command->>'periodId' is distinct from p_query->>'periodId' or coalesce(p_command->>'action','') not in('send','respond','seal','reopen') then raise exception 'attendance_invalid_request';end if;
  foreach key_name in array array['grantId','workerId','periodId'] loop
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->key_name,'uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  end loop;
  foreach key_name in array array['fromDate','throughDate'] loop
    if jsonb_typeof(p_query->key_name) is distinct from 'string' or coalesce(p_query->>key_name,'')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((p_query->>key_name)::date,'YYYY-MM-DD') is distinct from p_query->>key_name then raise exception 'attendance_invalid_request';end if;
  end loop;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  tuple_value:=jsonb_build_array('attendance-period-delegated-closure-v1',p_query->>'siteId',p_query->>'access',p_query->>'grantId',p_query->>'workerId',
    p_query->>'fromDate',p_query->>'throughDate',p_query->>'mode',p_query->>'periodId',p_query->'operationId',p_query->'version',p_query->'cursor',
    p_command->>'action',p_command->>'operationId',p_command->>'periodId',(p_command->>'expectedRevision')::integer,(p_command->>'expectedVersion')::integer,
    p_command->'expectedFingerprint',p_command->>'reason');
  return encode(sha256(convert_to(tuple_value::text,'UTF8')),'hex');
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end;
$$;

create or replace function public.faolla_attendance_period_delegated_closure_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_artifact jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;access_name text;mode_name text;wid uuid;pid uuid;op uuid;requested_version integer;first_day date;last_day date;action_name text;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  c public.merchant_attendance_period_closures%rowtype;listed public.merchant_attendance_period_closures%rowtype;
  saved public.merchant_attendance_period_entries%rowtype;entry_row public.merchant_attendance_period_entries%rowtype;
  a public.merchant_attendance_period_artifacts%rowtype;v public.merchant_attendance_period_versions%rowtype;
  source_result jsonb;artifact_json jsonb;artifact_text text;artifact_size integer;common jsonb;items jsonb:='[]';summary jsonb;
  replayed boolean:=false;changed boolean;is_new boolean;new_version boolean;now_at timestamptz;prior_at timestamptz;fmt text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
  k text;expected_worker jsonb;expected_period jsonb;
  gid uuid;actor_employee uuid;grant_authority jsonb;usable_actions jsonb;receipt_value jsonb;prospective jsonb;
  grant_row public.merchant_attendance_period_delegations%rowtype;delegated public.merchant_attendance_period_delegation_operations%rowtype;
  actor_member public.merchant_enterprise_employees%rowtype;
  cursor_value jsonb;next_cursor jsonb;cursor_scope jsonb;at_revision integer;before_revision integer;at_version integer;before_version integer;
  at_opened timestamptz;before_opened timestamptz;at_pid uuid;before_pid uuid;last_revision integer;last_version integer;
  last_opened timestamptz;last_pid uuid;version_meta jsonb;page_entry jsonb;page_top integer;
begin
  if p_auth_user_id is null or p_allow_write is null or public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','grantId','workerId','fromDate','throughDate','mode','periodId','operationId','version','cursor']) is distinct from true
    or octet_length(p_query::text)>4096 then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';
  if jsonb_typeof(p_query->'siteId') is distinct from 'string' or jsonb_typeof(p_query->'access') is distinct from 'string'
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or length(site)<>8 or site!~'^[0-9]{8}$'
    or access_name is distinct from 'delegate' or mode_name not in('list','preview','detail','recover','history','versions') then raise exception 'attendance_invalid_request';end if;
  foreach k in array array['grantId','workerId','periodId','operationId'] loop
    if k not in('grantId','workerId') and p_query->k='null'::jsonb then continue;end if;
    if jsonb_typeof(p_query->k) is distinct from 'string' or length(p_query->>k)<>36
      or (p_query->>k)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'attendance_invalid_request';end if;
  end loop;
  foreach k in array array['fromDate','throughDate'] loop
    if jsonb_typeof(p_query->k) is distinct from 'string' or length(p_query->>k)<>10 or (p_query->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((p_query->>k)::date,'YYYY-MM-DD') is distinct from p_query->>k then raise exception 'attendance_invalid_request';end if;
  end loop;
  gid:=(p_query->>'grantId')::uuid;wid:=(p_query->>'workerId')::uuid;pid:=(p_query->>'periodId')::uuid;op:=(p_query->>'operationId')::uuid;
  first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if first_day<date '2000-01-01' or last_day>date '2100-12-31' or last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  if p_query->'version'<>'null'::jsonb then
    if jsonb_typeof(p_query->'version') is distinct from 'number' or (p_query->>'version')!~'^[1-9][0-9]{0,9}$' or (p_query->>'version')::numeric>2147483647 then raise exception 'attendance_invalid_request';end if;
    requested_version:=(p_query->>'version')::integer;
  end if;
  if mode_name='list' and (pid is not null or op is not null or requested_version is not null)
    or mode_name='preview' and (op is not null or requested_version is not null)
    or mode_name in('detail','recover','history','versions') and pid is null
    or (mode_name='recover')<>(op is not null)
    or mode_name in('history','versions','recover') and requested_version is not null then raise exception 'attendance_invalid_request';end if;
  cursor_value:=p_query->'cursor';
  if cursor_value<>'null'::jsonb then
    if mode_name not in('list','history','versions')
      or public.faolla_attendance_shift_rule_binding_object_v1(cursor_value,
        (case mode_name when 'list' then array['kind','siteId','access','grantId','workerId','fromDate','throughDate','periodId','atOpenedAt','atPeriodId','beforeOpenedAt','beforePeriodId']
          when 'history' then array['kind','siteId','access','grantId','workerId','fromDate','throughDate','periodId','atRevision','beforeRevision']
          else array['kind','siteId','access','grantId','workerId','fromDate','throughDate','periodId','atVersion','beforeVersion'] end)) is distinct from true then raise exception 'attendance_invalid_request';end if;
    if cursor_value->>'kind' is distinct from mode_name then raise exception 'attendance_invalid_request';end if;
    foreach k in array array['siteId','access','grantId','workerId','fromDate','throughDate','periodId'] loop
      if cursor_value->k is distinct from p_query->k then raise exception 'attendance_invalid_request';end if;
    end loop;
    if mode_name='list' then
      if public.faolla_attendance_shift_rule_binding_scalar_v1(cursor_value->'atOpenedAt','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(cursor_value->'beforeOpenedAt','stamp6') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(cursor_value->'atPeriodId','uuid') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(cursor_value->'beforePeriodId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
      at_opened:=(cursor_value->>'atOpenedAt')::timestamptz;at_pid:=(cursor_value->>'atPeriodId')::uuid;
      before_opened:=(cursor_value->>'beforeOpenedAt')::timestamptz;before_pid:=(cursor_value->>'beforePeriodId')::uuid;
      if (before_opened,before_pid)>(at_opened,at_pid) then raise exception 'attendance_invalid_request';end if;
    else
      foreach k in array (case when mode_name='history' then array['atRevision','beforeRevision'] else array['atVersion','beforeVersion'] end) loop
        if jsonb_typeof(cursor_value->k) is distinct from 'number' or (cursor_value->>k)!~'^[1-9][0-9]{0,9}$'
          or (cursor_value->>k)::numeric>2147483647 then raise exception 'attendance_invalid_request';end if;
      end loop;
      if mode_name='history' then
        at_revision:=(cursor_value->>'atRevision')::integer;before_revision:=(cursor_value->>'beforeRevision')::integer;
        if before_revision>at_revision then raise exception 'attendance_invalid_request';end if;
      else
        at_version:=(cursor_value->>'atVersion')::integer;before_version:=(cursor_value->>'beforeVersion')::integer;
        if before_version>at_version then raise exception 'attendance_invalid_request';end if;
      end if;
    end if;
  end if;
  if p_command is not null and cursor_value<>'null'::jsonb then raise exception 'attendance_invalid_request';end if;
  if p_command is not null then
    if public.faolla_attendance_period_closure_command_v2(p_command) is distinct from true or mode_name<>'detail' or requested_version is not null
      or p_command->>'periodId' is distinct from pid::text then raise exception 'attendance_invalid_request';end if;
    action_name:=p_command->>'action';op:=(p_command->>'operationId')::uuid;
    if action_name not in('send','respond','seal','reopen') then raise exception 'attendance_access_denied';end if;
  end if;
  if p_artifact is not null and action_name is distinct from 'send' then raise exception 'attendance_invalid_request';end if;

  if p_allow_write is distinct from true and mode_name<>'recover' then raise exception 'attendance_period_delegation_disabled';end if;
  perform 1 from public.merchants x where x.id=site for share;
  if not found then raise exception 'attendance_access_denied';end if;
  if mode_name='recover' then select * into s from public.merchant_attendance_settings x where x.merchant_id=site for share;
  else select * into s from public.merchant_attendance_settings x where x.merchant_id=site for update;end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;

  --Only exact original actor/member receipts bypass fresh authority. No worker,
  --artifact, source, current role or current grant is consulted by this branch.
  if op is not null then
    select * into delegated from public.merchant_attendance_period_delegation_operations x where x.merchant_id=site and x.operation_id=op;
    if mode_name='recover' or delegated.operation_id is not null then
      select * into actor_member from public.merchant_enterprise_employees x where x.merchant_id=site and x.auth_user_id=p_auth_user_id for share;
      if actor_member.id is null then raise exception 'attendance_access_denied';end if;actor_employee:=actor_member.id;
      if delegated.operation_id is not null then
        if delegated.actor_employee_id<>actor_employee or delegated.actor_auth_user_id<>p_auth_user_id
          or delegated.grant_id<>gid or delegated.worker_id<>wid or delegated.period_id<>pid then raise exception 'attendance_access_denied';end if;
        foreach k in array array['siteId','access','grantId','workerId','fromDate','throughDate','periodId'] loop
          if delegated.query->k is distinct from p_query->k then raise exception 'attendance_access_denied';end if;
        end loop;
        if delegated.command_fingerprint is distinct from public.faolla_attendance_period_delegated_hash_v1(delegated.query,delegated.command)
          or public.faolla_attendance_period_delegation_proof_v1(delegated) is distinct from true then raise exception 'attendance_period_delegation_invalid';end if;
        if p_command is not null and (delegated.query is distinct from p_query or delegated.command is distinct from p_command
          or delegated.command_fingerprint is distinct from public.faolla_attendance_period_delegated_hash_v1(p_query,p_command)) then raise exception 'attendance_operation_conflict';end if;
        receipt_value:=public.faolla_attendance_period_delegation_receipt_v1(site,op,p_auth_user_id,'delegate',actor_employee);
      elsif exists(select 1 from public.merchant_attendance_period_entries x where x.merchant_id=site and x.operation_id=op)
        or exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=site and x.grant_id=op)
        or exists(select 1 from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=site and x.operation_id=op) then raise exception 'attendance_access_denied';end if;
      return jsonb_build_object('protocol','period-delegated-closure-v1','siteId',site,'access','delegate','actorId',p_auth_user_id,
        'employeeId',actor_employee,'workerId',wid,'grantId',gid,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),
        'usableActions','[]'::jsonb,'kind','receipt','receipt',receipt_value);
    end if;
    if exists(select 1 from public.merchant_attendance_period_entries x where x.merchant_id=site and x.operation_id=op)
      or exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=site and x.grant_id=op)
      or exists(select 1 from public.merchant_attendance_period_delegation_revocations x where x.merchant_id=site and x.operation_id=op) then raise exception 'attendance_operation_conflict';end if;
  end if;

  --185 owns the common settings/worker/sorted-members/role lock order. New
  --reopen is NOT the owner-only paused exception: every delegated action gates.
  grant_authority:=public.faolla_attendance_period_delegation_guard_v1(site,gid,p_auth_user_id,coalesce(action_name,'view'),wid,first_day,last_day,pid,p_allow_write);
  actor_employee:=(grant_authority->>'actorEmployeeId')::uuid;
  select * into grant_row from public.merchant_attendance_period_delegations x where x.merchant_id=site and x.grant_id=gid;
  usable_actions:=public.faolla_attendance_period_delegation_actions_v1(grant_row,(grant_authority->>'authorizedAt')::timestamptz);
  select * into w from public.merchant_attendance_workers x where x.merchant_id=site and x.id=wid;
  select * into e from public.merchant_enterprise_employees x where x.merchant_id=site and x.id=w.employee_id;
  if pid is not null then select * into c from public.merchant_attendance_period_closures x where x.merchant_id=site and x.period_id=pid;end if;

  common:=jsonb_build_object('protocol','period-delegated-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,'grantId',gid,'employeeId',actor_employee,'usableActions',usable_actions,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  cursor_scope:=jsonb_build_object('kind',mode_name,'siteId',site,'access',access_name,'grantId',gid,'workerId',wid,'fromDate',first_day,'throughDate',last_day,'periodId',pid);
  if mode_name='list' then
    if cursor_value<>'null'::jsonb and (not exists(select 1 from public.merchant_attendance_period_closures x
        where x.merchant_id=site and x.worker_id=wid and x.period_id=at_pid and x.opened_at=at_opened
          and x.from_date between first_day-30 and last_day and x.through_date>=first_day
          and x.from_date>=grant_row.from_date and x.through_date<=grant_row.through_date
          and (grant_row.include_existing or x.opened_at>=grant_row.recorded_at))
      or not exists(select 1 from public.merchant_attendance_period_closures x
        where x.merchant_id=site and x.worker_id=wid and x.period_id=before_pid and x.opened_at=before_opened
          and x.from_date between first_day-30 and last_day and x.through_date>=first_day
          and x.from_date>=grant_row.from_date and x.through_date<=grant_row.through_date
          and (grant_row.include_existing or x.opened_at>=grant_row.recorded_at))) then raise exception 'attendance_invalid_request';end if;
    for listed in select x.* from public.merchant_attendance_period_closures x where x.merchant_id=site and x.worker_id=wid
      and x.from_date between first_day-30 and last_day and x.through_date>=first_day
          and x.from_date>=grant_row.from_date and x.through_date<=grant_row.through_date
          and (grant_row.include_existing or x.opened_at>=grant_row.recorded_at)
      and (at_opened is null or (x.opened_at,x.period_id)<=(at_opened,at_pid))
      and (before_opened is null or (x.opened_at,x.period_id)<(before_opened,before_pid))
      order by x.opened_at desc,x.period_id desc limit 26 loop
      if at_opened is null then at_opened:=listed.opened_at;at_pid:=listed.period_id;end if;
      if jsonb_array_length(items)=25 then
        next_cursor:=cursor_scope||jsonb_build_object('atOpenedAt',to_char(at_opened at time zone 'UTC',fmt),'atPeriodId',at_pid,
          'beforeOpenedAt',to_char(last_opened at time zone 'UTC',fmt),'beforePeriodId',last_pid);exit;end if;
      if listed.employee_id<>e.id or listed.employee_auth_user_id<>e.auth_user_id then raise exception 'attendance_period_identity_changed';end if;
      items:=items||jsonb_build_array(public.faolla_attendance_period_summary_v2(listed)||jsonb_build_object('openedAt',to_char(listed.opened_at at time zone 'UTC',fmt)));
      last_opened:=listed.opened_at;last_pid:=listed.period_id;
    end loop;
    return common||jsonb_build_object('kind','list','items',items,'nextCursor',next_cursor);
  end if;
  if mode_name in('history','versions') then
    if c.period_id is null then raise exception 'attendance_period_not_found';end if;
    summary:=public.faolla_attendance_period_summary_v2(c);
    if mode_name='history' then
      at_revision:=coalesce(at_revision,c.revision);
      if at_revision>c.revision or before_revision is not null and not exists(select 1 from public.merchant_attendance_period_entries x
        where x.merchant_id=site and x.period_id=pid and x.revision=before_revision) then raise exception 'attendance_invalid_request';end if;
      page_top:=case when before_revision is null then at_revision else before_revision-1 end;
      for entry_row in select x.* from public.merchant_attendance_period_entries x where x.merchant_id=site and x.period_id=pid
        and x.revision<=at_revision and (before_revision is null or x.revision<before_revision) order by x.revision desc limit 51 loop
        if entry_row.revision<>page_top-jsonb_array_length(items) then raise exception 'attendance_period_closure_invalid';end if;
        if jsonb_array_length(items)=50 then next_cursor:=cursor_scope||jsonb_build_object('atRevision',at_revision,'beforeRevision',last_revision);exit;end if;
        if entry_row.version>c.current_version or entry_row.recorded_at<c.opened_at or entry_row.recorded_at>c.updated_at
          or prior_at<entry_row.recorded_at then raise exception 'attendance_period_closure_invalid';end if;
        items:=items||jsonb_build_array(public.faolla_attendance_period_entry_v2(entry_row));last_revision:=entry_row.revision;prior_at:=entry_row.recorded_at;
      end loop;
      if jsonb_array_length(items)<>least(50,page_top) or (page_top>50)<>(next_cursor is not null) then raise exception 'attendance_period_closure_invalid';end if;
    else
      at_version:=coalesce(at_version,c.current_version);
      if at_version>c.current_version or before_version is not null and not exists(select 1 from public.merchant_attendance_period_versions x
        where x.merchant_id=site and x.period_id=pid and x.version=before_version) then raise exception 'attendance_invalid_request';end if;
      page_top:=case when before_version is null then at_version else before_version-1 end;
      for v in select x.* from public.merchant_attendance_period_versions x where x.merchant_id=site and x.period_id=pid
        and x.version<=at_version and (before_version is null or x.version<before_version) order by x.version desc limit 21 loop
        if v.version<>page_top-jsonb_array_length(items) then raise exception 'attendance_period_closure_invalid';end if;
        if jsonb_array_length(items)=20 then next_cursor:=cursor_scope||jsonb_build_object('atVersion',at_version,'beforeVersion',last_version);exit;end if;
        select * into entry_row from public.merchant_attendance_period_entries where merchant_id=site and operation_id=v.operation_id;
        page_entry:=public.faolla_attendance_period_entry_v2(entry_row);
        if page_entry is null or entry_row.period_id<>pid or entry_row.version<>v.version or entry_row.action<>'send' or entry_row.recorded_at<>v.recorded_at
          or v.recorded_at<c.opened_at or v.recorded_at>c.updated_at or prior_at<v.recorded_at then raise exception 'attendance_period_closure_invalid';end if;
        select jsonb_build_object('version',v.version,'operationId',v.operation_id,'recordedAt',to_char(v.recorded_at at time zone 'UTC',fmt),
          'artifactId',x.artifact_id,'sourceFingerprint',x.source_fingerprint,'artifactBytes',x.artifact_bytes,'artifactSha256',x.artifact_sha256) into version_meta
          from public.merchant_attendance_period_artifacts x where x.merchant_id=site and x.period_id=pid and x.artifact_id=v.artifact_id;
        if version_meta is null then raise exception 'attendance_period_closure_invalid';end if;
        items:=items||jsonb_build_array(version_meta);last_version:=v.version;prior_at:=v.recorded_at;
      end loop;
      if jsonb_array_length(items)<>least(20,page_top) or (page_top>20)<>(next_cursor is not null) then raise exception 'attendance_period_closure_invalid';end if;
    end if;
    return common||jsonb_build_object('kind',mode_name,'period',summary,'items',items,'nextCursor',next_cursor);
  end if;
  if mode_name='preview' then
    if pid is not null and c.period_id is null then raise exception 'attendance_period_not_found';end if;
    if c.period_id is not null then
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid
        and artifact_id=(select artifact_id from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version);
      summary:=public.faolla_attendance_period_summary_v1(c,public.faolla_attendance_period_artifact_checked_v1(a));
    end if;
    source_result:=public.faolla_attendance_period_delegated_source_v1(site,wid,e.id,e.auth_user_id,p_auth_user_id,first_day,last_day,pid);
    return jsonb_build_object('protocol','period-delegated-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,'grantId',gid,'employeeId',actor_employee,'usableActions',usable_actions,
      'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'kind','preview','period',summary,'source',source_result);
  end if;

  if p_command is not null and saved.operation_id is null then
    --All delegated writes, including reopen, already passed the current185 gate.
    is_new:=c.period_id is null;
    if is_new and action_name<>'send' then raise exception 'attendance_period_not_found';end if;
    if (p_command->>'expectedRevision')::integer<>coalesce(c.revision,0) or (p_command->>'expectedVersion')::integer<>coalesce(c.current_version,0) then raise exception 'attendance_version_conflict';end if;
    if coalesce(c.revision,0)>=2147483647 or coalesce(c.revision,0)>=2147483646 and action_name<>'reopen' then raise exception 'attendance_period_limit';end if;
    if action_name='send' then
      if c.sealed then raise exception 'attendance_period_sealed';end if;
      if public.faolla_attendance_shift_rule_binding_object_v1(p_artifact,array['protocol','sourceFingerprint','source','worker','period','report','dayBoundaries','calculationVersion']) is distinct from true
        or p_artifact->>'protocol' is distinct from 'attendance-period-artifact-v2' then raise exception 'attendance_invalid_request';end if;
      source_result:=public.faolla_attendance_period_delegated_source_v1(site,wid,e.id,e.auth_user_id,p_auth_user_id,first_day,last_day,pid);
      --179 also blocks relevant unresolved outage reviews before a fresh send.
      --Other old blockers retain their old review/seal semantics.
      if (source_result->'blockers' ? 'period_in_progress' or source_result->'blockers' ? 'unresolved_outage') then raise exception 'attendance_period_blocked';end if;
      if source_result->>'sourceFingerprint' is distinct from p_command->>'expectedFingerprint'
        or p_artifact->>'sourceFingerprint' is distinct from source_result->>'sourceFingerprint'
        or p_artifact->'source' is distinct from source_result->'sourceCanonical' then raise exception 'attendance_period_source_changed';end if;
      expected_worker:=jsonb_build_object('workerId',wid,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'workerName',w.display_name,'workerNo',w.worker_no);
      expected_period:=jsonb_build_object('fromDate',first_day,'throughDate',last_day,'timeZone',source_result->'timeZone','startAt',source_result->'fromAt','endAt',source_result->'toAt');
      if p_artifact->'worker' is distinct from expected_worker or p_artifact->'period' is distinct from expected_period
        or p_artifact->'dayBoundaries' is distinct from source_result->'dayBoundaries'
        or p_artifact->'report'->>'access' is distinct from 'delegate'
        or p_artifact->'report'->'base'->>'workerId' is distinct from wid::text
        or p_artifact->'report'->'base'->>'employeeId' is distinct from e.id::text
        or p_artifact->'report'->'base'->>'fromAt' is distinct from source_result->>'fromAt'
        or p_artifact->'report'->'base'->>'toAt' is distinct from source_result->>'toAt' then raise exception 'attendance_period_closure_invalid';end if;
      -- Validate every fresh supplied body, even if this source fingerprint can
      -- reuse an existing immutable artifact (or need no new logical version).
      now_at:=clock_timestamp();
      if now_at<(source_result->>'readAt')::timestamptz or now_at<(grant_authority->>'authorizedAt')::timestamptz or c.updated_at>now_at then raise exception 'attendance_version_conflict';end if;
      prospective:=p_artifact||jsonb_build_object('authority',grant_authority);
      artifact_text:=prospective::text;artifact_size:=octet_length(convert_to(artifact_text,'UTF8'));
      if artifact_size>2097152 then raise exception 'attendance_period_source_too_large';end if;
      a.merchant_id:=site;a.period_id:=pid;a.artifact_id:=op;a.source_fingerprint:=source_result->>'sourceFingerprint';
      a.artifact_text:=artifact_text;a.artifact_sha256:=encode(sha256(convert_to(artifact_text,'UTF8')),'hex');a.artifact_bytes:=artifact_size;a.recorded_at:=now_at;
      perform public.faolla_attendance_period_artifact_shape_v2(a);
      if not is_new and expected_period is distinct from jsonb_build_object('fromDate',c.from_date,'throughDate',c.through_date,'timeZone',c.time_zone,
        'startAt',to_char(c.start_at at time zone 'UTC',fmt),'endAt',to_char(c.end_at at time zone 'UTC',fmt)) then raise exception 'attendance_period_source_changed';end if;
      --The stored authority and prospective body share this locked timestamp.
      if is_new then
        --All stored periods were proven non-overlapping at183 installation;
        --settings UPDATE serializes every later insert. Read one predecessor.
        if exists(select 1 from (select x.end_at from public.merchant_attendance_period_closures x
          where x.merchant_id=site and x.worker_id=wid and x.start_at<(source_result->>'toAt')::timestamptz
          order by x.start_at desc,x.period_id desc limit 1) predecessor
          where predecessor.end_at>(source_result->>'fromAt')::timestamptz) then raise exception 'attendance_period_overlap';end if;
        insert into public.merchant_attendance_period_closures(merchant_id,period_id,worker_id,employee_id,employee_auth_user_id,from_date,through_date,time_zone,start_at,end_at,
          revision,current_version,state,sealed,confirmed_version,unresolved_dispute,opened_at,updated_at)
          values(site,pid,wid,e.id,e.auth_user_id,first_day,last_day,source_result->>'timeZone',(source_result->>'fromAt')::timestamptz,(source_result->>'toAt')::timestamptz,
            1,1,'review',false,null,false,now_at,now_at) returning * into c;
        new_version:=true;
      else
        select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version;
        select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and artifact_id=v.artifact_id;
        artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
        if a.source_fingerprint=source_result->>'sourceFingerprint' and artifact_json->'source' is distinct from source_result->'sourceCanonical' then
          raise exception 'attendance_period_closure_invalid';end if;
        new_version:=c.state='open' or a.source_fingerprint<>source_result->>'sourceFingerprint';
        if new_version and c.current_version>=2147483647 then raise exception 'attendance_period_limit';end if;
      end if;
      if new_version then
        select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and source_fingerprint=source_result->>'sourceFingerprint';
        if a.artifact_id is null then
          --Shared artifact INSERT trigger is the only ongoing budget charge.
          a.merchant_id:=site;a.period_id:=pid;a.artifact_id:=op;a.source_fingerprint:=source_result->>'sourceFingerprint';
          a.artifact_text:=artifact_text;a.artifact_sha256:=encode(sha256(convert_to(artifact_text,'UTF8')),'hex');a.artifact_bytes:=artifact_size;a.recorded_at:=now_at;
          perform public.faolla_attendance_period_artifact_shape_v2(a);
          insert into public.merchant_attendance_period_artifacts select (a).*;
        else
          artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
          if artifact_json->'source' is distinct from source_result->'sourceCanonical' then raise exception 'attendance_period_closure_invalid';end if;
        end if;
        if not is_new then c.current_version:=c.current_version+1;end if;
        insert into public.merchant_attendance_period_versions(merchant_id,period_id,version,artifact_id,operation_id,recorded_at)
          values(site,pid,c.current_version,a.artifact_id,op,now_at);
        c.confirmed_version:=null;c.state:=case when c.unresolved_dispute then 'disputed' else 'review' end;
      end if;
    else
      select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=c.current_version;
      select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and artifact_id=v.artifact_id;
      artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
      if action_name='seal' then
        if c.sealed then raise exception 'attendance_period_sealed';end if;
        if c.state='open' then raise exception 'attendance_period_not_confirmed';end if;
        if p_command->>'expectedFingerprint' is distinct from a.source_fingerprint then raise exception 'attendance_period_source_changed';end if;
        source_result:=public.faolla_attendance_period_delegated_source_v1(site,wid,e.id,e.auth_user_id,p_auth_user_id,first_day,last_day,pid);
        if source_result->>'sourceFingerprint' is distinct from a.source_fingerprint
          or source_result->'sourceCanonical' is distinct from artifact_json->'source' then raise exception 'attendance_period_source_changed';end if;
        if source_result->>'validation' is distinct from 'delegate_checked' or source_result->'blockers' is distinct from '[]'::jsonb then raise exception 'attendance_period_blocked';end if;
        if c.confirmed_version is distinct from c.current_version or c.unresolved_dispute then raise exception 'attendance_period_not_confirmed';end if;
        c.sealed:=true;c.state:='sealed';
      elsif action_name='reopen' then
        if not c.sealed then raise exception 'attendance_period_not_sealed';end if;
        c.sealed:=false;c.state:='open';c.confirmed_version:=null;
      end if;
      -- respond appends the real delegate's explanation only; it cannot clear a dispute,
      -- invent the employee's confirmation or rewrite a sealed version.
      now_at:=clock_timestamp();
      if now_at<(grant_authority->>'authorizedAt')::timestamptz or c.updated_at>now_at or source_result is not null and now_at<(source_result->>'readAt')::timestamptz then raise exception 'attendance_version_conflict';end if;
    end if;
    c.revision:=(p_command->>'expectedRevision')::integer+1;c.updated_at:=now_at;
    insert into public.merchant_attendance_period_entries(merchant_id,period_id,operation_id,revision,version,actor_auth_user_id,action,command,recorded_at)
      values(site,pid,op,c.revision,c.current_version,p_auth_user_id,action_name,p_command,now_at) returning * into saved;
    update public.merchant_attendance_period_closures set revision=c.revision,current_version=c.current_version,state=c.state,sealed=c.sealed,
      confirmed_version=c.confirmed_version,unresolved_dispute=c.unresolved_dispute,updated_at=c.updated_at where merchant_id=site and period_id=pid;
    insert into public.merchant_attendance_period_delegation_operations(merchant_id,operation_id,grant_id,period_id,period_revision,period_version,
      actor_auth_user_id,actor_employee_id,worker_id,employee_id,employee_auth_user_id,action,query,command,command_fingerprint,authority,authorized_at,recorded_at)
    values(site,op,gid,pid,c.revision,c.current_version,p_auth_user_id,actor_employee,wid,e.id,e.auth_user_id,action_name,p_query,p_command,
      public.faolla_attendance_period_delegated_hash_v1(p_query,p_command),grant_authority,(grant_authority->>'authorizedAt')::timestamptz,now_at);
    --Validate full creation authority after entry/version/sidecar exist. The186
    --deferred constraint is an additional guard, not permission to skip proof.
    select * into v from public.merchant_attendance_period_versions x where x.merchant_id=site and x.period_id=pid and x.version=c.current_version;
    select * into a from public.merchant_attendance_period_artifacts x where x.merchant_id=site and x.period_id=pid and x.artifact_id=v.artifact_id;
    perform public.faolla_attendance_period_artifact_checked_v1(a);
    receipt_value:=public.faolla_attendance_period_delegation_receipt_v1(site,op,p_auth_user_id,'delegate',actor_employee);
    if receipt_value is null then raise exception 'attendance_period_delegation_invalid';end if;
    return jsonb_build_object('protocol','period-delegated-closure-v1','siteId',site,'access','delegate','actorId',p_auth_user_id,
      'employeeId',actor_employee,'workerId',wid,'grantId',gid,'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),
      'usableActions','[]'::jsonb,'kind','receipt','receipt',receipt_value);
  end if;

  if c.period_id is null then raise exception 'attendance_period_not_found';end if;
  if requested_version is null then requested_version:=c.current_version;end if;
  select * into v from public.merchant_attendance_period_versions where merchant_id=site and period_id=pid and version=requested_version;
  if v.version is null then raise exception 'attendance_period_not_found';end if;
  select * into a from public.merchant_attendance_period_artifacts where merchant_id=site and period_id=pid and artifact_id=v.artifact_id;
  artifact_json:=public.faolla_attendance_period_artifact_checked_v1(a);
  summary:=public.faolla_attendance_period_summary_v1(c,artifact_json);
  --Point-check the authoritative current head; bounded history lives only in
  --its dedicated seek endpoint. Recovery never reads unrelated operations.
  perform public.faolla_attendance_period_summary_v2(c);
  --Fixed historical reads return saved bytes after current scoped authority;
  --only explicit current detail collects current sources.
  if p_command is null and mode_name='detail' and p_query->'version'='null'::jsonb then
    begin
      source_result:=public.faolla_attendance_period_delegated_source_v1(site,wid,e.id,e.auth_user_id,p_auth_user_id,first_day,last_day,pid);
      changed:=source_result->>'sourceFingerprint' is distinct from a.source_fingerprint;
    exception when raise_exception then
      -- A current source that cannot now be collected does not erase a saved
      -- archive or strand reopening. Authorization and unknown errors still fail.
      if sqlerrm=any(array['attendance_period_source_invalid','attendance_period_source_too_large',
        'attendance_period_source_identity_changed','attendance_period_identity_unproven',
        'attendance_period_source_identity_unproven','attendance_report_invalid_data',
        'attendance_report_too_large','attendance_report_reconciliation_required','attendance_session_invalid_records']) then
        changed:=null;
      else raise;end if;
    end;
  end if;
  common:=jsonb_build_object('protocol','period-delegated-closure-v1','siteId',site,'workerId',wid,'actorId',p_auth_user_id,'access',access_name,'grantId',gid,'employeeId',actor_employee,'usableActions',usable_actions,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt));
  return common||jsonb_build_object('kind','detail','period',summary,'artifact',artifact_json,'artifactText',a.artifact_text,
    'artifactSha256',a.artifact_sha256,'artifactBytes',a.artifact_bytes,'artifactVersion',requested_version,
    'sourceChanged',changed,'operation',public.faolla_attendance_period_entry_v2(saved),'replayed',replayed);
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'attendance_invalid_request';
end;
$$;

revoke all on function public.faolla_attendance_period_delegated_hash_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_delegated_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_delegated_closure_v1(jsonb,uuid,jsonb,jsonb,boolean) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610080187,'merchant_attendance_period_delegated_closure') on conflict(version) do nothing;
do $period_delegated_closure_postconditions$
declare function_id regprocedure;role_name text;
begin
  function_id:='public.faolla_attendance_period_delegated_hash_v1(jsonb,jsonb)'::regprocedure;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,function_id,'EXECUTE') then raise exception 'merchant_attendance_period_delegated_closure_acl_failed';end if;
  end loop;
  function_id:='public.faolla_attendance_period_delegated_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure;
  if not has_function_privilege('service_role',function_id,'EXECUTE') or has_function_privilege('anon',function_id,'EXECUTE') or has_function_privilege('authenticated',function_id,'EXECUTE') then
    raise exception 'merchant_attendance_period_delegated_closure_acl_failed';end if;
  if not exists(select 1 from public.faolla_schema_migrations where version=202610080187 and name='merchant_attendance_period_delegated_closure') then
    raise exception 'merchant_attendance_period_delegated_closure_installation_conflict';end if;
end;
$period_delegated_closure_postconditions$;
notify pgrst, 'reload schema';
commit;
