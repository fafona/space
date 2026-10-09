-- Independent owner-only candidate rule evidence. No application, mutation,
-- historical sealing or claim of a database-wide MVCC/business-fact snapshot.
begin;
set local lock_timeout='3s';

do $rule_sources_prerequisites$
declare installed boolean;v bigint;n text;p text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_rule_sources_prerequisite_required';end if;
  for v,n in select * from (values
    (202609290064::bigint,'merchant_attendance_owner_configuration'),(202610030124::bigint,'merchant_attendance_groups'),
    (202610040127::bigint,'merchant_attendance_rule_versions'),(202610040129::bigint,'merchant_attendance_personal_rules')) x(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations where version=v and name=n) then raise exception 'merchant_attendance_rule_sources_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_rule_day_start_v1(text,text)','public.faolla_attendance_personal_rule_end_v1(text,text)',
    'public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)',
    'public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)',
    'public.faolla_attendance_rule_stream_checked_v1(public.merchant_attendance_rule_streams)',
    'public.faolla_attendance_rule_receipt_v1(public.merchant_attendance_rule_operations)',
    'public.faolla_attendance_group_text_v1(text,integer,integer)',
    'public.faolla_attendance_personal_rule_command_v1(jsonb)',
    'public.faolla_attendance_personal_rule_item_v1(public.merchant_attendance_personal_rule_operations)',
    'public.faolla_attendance_personal_rule_stream_checked_v1(public.merchant_attendance_personal_rule_streams)',
    'public.faolla_attendance_personal_rule_receipt_v1(public.merchant_attendance_personal_rule_operations)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_rule_sources_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040130 and name='merchant_attendance_rule_sources') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040130 and name<>'merchant_attendance_rule_sources')
    or installed<>(to_regprocedure('public.faolla_attendance_rule_sources_v1(jsonb,uuid)') is not null)
    or installed<>(to_regprocedure('public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)') is not null) then
    raise exception 'merchant_attendance_rule_sources_installation_conflict';end if;
end;
$rule_sources_prerequisites$;

-- Private, per-RPC memoization of129's constant-depth receipt checks. The
-- caller owns this cache; it is never accepted from an HTTP query or persisted.
-- Only successful command bodies and original lower-bound date results are
-- memoized. Every operation envelope, snapshot and relationship is rechecked.
create or replace function public.faolla_attendance_rule_sources_personal_checked_v1(
  p public.merchant_attendance_personal_rule_operations,p_cache jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare previous public.merchant_attendance_personal_rule_operations%rowtype;target public.merchant_attendance_personal_rule_operations%rowtype;
  context public.merchant_attendance_personal_rule_operations%rowtype;expected jsonb;commands jsonb[];command jsonb;command_key text;
  command_cache jsonb:=coalesce(p_cache->'commands','{}'::jsonb);boundary_cache jsonb:=coalesce(p_cache->'boundaries','{}'::jsonb);
  boundary_key text;context_from_at timestamptz;context_to_at timestamptz;
  u constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p.operation_id is null or jsonb_typeof(command_cache) is distinct from 'object'
    or jsonb_typeof(boundary_cache) is distinct from 'object' then raise exception 'attendance_personal_rule_invalid';end if;
  commands:=array[p.command];
  if p.revision>1 then
    select * into previous from public.merchant_attendance_personal_rule_operations where merchant_id=p.merchant_id and worker_id=p.worker_id and revision=p.revision-1;
    if previous.operation_id is null then raise exception 'attendance_personal_rule_invalid';end if;
    commands:=array_append(commands,previous.command);
  end if;
  if p.action='withdraw' then
    select * into target from public.merchant_attendance_personal_rule_operations where merchant_id=p.merchant_id and worker_id=p.worker_id and revision=p.approved_revision;
    if target.operation_id is null then raise exception 'attendance_personal_rule_invalid';end if;
    commands:=array_append(commands,target.command);
  end if;
  foreach command in array commands loop
    -- These three fields are omitted from the memo key, so validate their
    -- complete129 envelope on EVERY call, including cached previous/target.
    if command is null or jsonb_typeof(command)<>'object' or not(command ?& array['operationId','action','expectedRevision','reason'])
      or jsonb_typeof(command->'operationId')<>'string' or coalesce(command->>'operationId','') !~ u
      or jsonb_typeof(command->'action')<>'string' or jsonb_typeof(command->'reason')<>'string'
      or not public.faolla_attendance_group_text_v1(command->>'reason',1,200)
      or jsonb_typeof(command->'expectedRevision')<>'number' or coalesce(command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (command->>'expectedRevision')::numeric>9007199254740989 then raise exception 'attendance_personal_rule_invalid';end if;
    command_key:=(command-array['operationId','expectedRevision','reason'])::text;
    if command_cache->command_key is distinct from 'true'::jsonb then
      if not public.faolla_attendance_personal_rule_command_v1(command) then raise exception 'attendance_personal_rule_invalid';end if;
      command_cache:=command_cache||jsonb_build_object(command_key,true);
    end if;
    -- Unlike the other body constraints, this relation also depends on the
    -- uncached envelope. A valid body must not authorize a lower revision.
    if command->>'action'='withdraw' and (command->>'approvedRevision')::numeric>(command->>'expectedRevision')::numeric then
      raise exception 'attendance_personal_rule_invalid';end if;
  end loop;
  if p.command->>'operationId' is distinct from p.operation_id::text or p.command->>'action' is distinct from p.action
    or (p.command->>'expectedRevision')::bigint is distinct from p.revision-1 then raise exception 'attendance_personal_rule_invalid';end if;
  expected:=public.faolla_attendance_personal_rule_item_v1(p);
  if p.snapshot is distinct from expected then raise exception 'attendance_personal_rule_invalid';end if;
  if p.revision>1 then
    if previous.recorded_at>p.recorded_at or previous.snapshot is distinct from public.faolla_attendance_personal_rule_item_v1(previous)
      or previous.employee_id is distinct from p.employee_id or previous.employee_auth_user_id is distinct from p.employee_auth_user_id then
      raise exception 'attendance_personal_rule_invalid';end if;
  elsif p.action<>'approve' then raise exception 'attendance_personal_rule_invalid';end if;
  if p.action='approve' then context:=p;
  elsif p.action='withdraw' then
    if target.action<>'approve' or target.revision>=p.revision or target.recorded_at>p.recorded_at
      or p.recorded_at>=target.from_at or target.snapshot is distinct from public.faolla_attendance_personal_rule_item_v1(target)
      or target.command->>'operationId' is distinct from target.operation_id::text or target.command->>'action' is distinct from target.action
      or (target.command->>'expectedRevision')::bigint is distinct from target.revision-1
      or p.command->'approvedRevision' is distinct from to_jsonb(p.approved_revision)
      or row(p.employee_id,p.employee_auth_user_id,p.worker_version,p.settings_version,p.time_zone,p.starts_on,p.ends_on,p.from_at,p.to_at,p.rules)
        is distinct from row(target.employee_id,target.employee_auth_user_id,target.worker_version,target.settings_version,target.time_zone,target.starts_on,target.ends_on,target.from_at,target.to_at,target.rules) then
      raise exception 'attendance_personal_rule_invalid';end if;
    context:=target;
  else raise exception 'attendance_personal_rule_invalid';end if;
  if context.command->'expectedWorkerVersion' is distinct from to_jsonb(context.worker_version)
    or context.command->'expectedSettingsVersion' is distinct from to_jsonb(context.settings_version)
    or context.command->>'employeeId' is distinct from context.employee_id::text
    or context.command->>'employeeAuthUserId' is distinct from context.employee_auth_user_id::text
    or context.command->>'timeZone' is distinct from context.time_zone or context.rules is distinct from context.command->'rules'
    or context.command->>'startsOn' is distinct from to_char(context.starts_on,'YYYY-MM-DD')
    or context.command->>'endsOn' is distinct from to_char(context.ends_on,'YYYY-MM-DD')
    or context.starts_on<=(context.recorded_at at time zone context.time_zone)::date or context.from_at<=context.recorded_at then
    raise exception 'attendance_personal_rule_invalid';end if;
  boundary_key:=jsonb_build_array('start',context.time_zone,context.command->>'startsOn')::text;
  context_from_at:=(boundary_cache->>boundary_key)::timestamptz;
  if context_from_at is null then
    context_from_at:=public.faolla_attendance_rule_day_start_v1(context.command->>'startsOn',context.time_zone);
    if context_from_at is null then raise exception 'attendance_personal_rule_invalid';end if;
    boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,context_from_at);
  end if;
  boundary_key:=jsonb_build_array('end',context.time_zone,context.command->>'endsOn')::text;
  context_to_at:=(boundary_cache->>boundary_key)::timestamptz;
  if context_to_at is null then
    context_to_at:=public.faolla_attendance_personal_rule_end_v1(context.command->>'endsOn',context.time_zone);
    if context_to_at is null then raise exception 'attendance_personal_rule_invalid';end if;
    boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,context_to_at);
  end if;
  if context.from_at is distinct from context_from_at or context.to_at is distinct from context_to_at then
    raise exception 'attendance_personal_rule_invalid';end if;
  return jsonb_build_object('commands',command_cache,'boundaries',boundary_cache);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
  raise exception 'attendance_personal_rule_invalid';
end;
$$;
revoke all on function public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb) from public,anon,authenticated,service_role;

create or replace function public.faolla_attendance_rule_sources_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
<<rule_sources>>
declare site text;wid uuid;first_day date;last_day date;from_at timestamptz;to_at timestamptz;read_at timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  g public.merchant_attendance_groups%rowtype;assignment public.merchant_attendance_group_assignments%rowtype;
  stream public.merchant_attendance_rule_streams%rowtype;publication public.merchant_attendance_rule_operations%rowtype;
  personal_stream public.merchant_attendance_personal_rule_streams%rowtype;
  approval public.merchant_attendance_personal_rule_operations%rowtype;withdrawal public.merchant_attendance_personal_rule_operations%rowtype;
  assignment_candidates public.merchant_attendance_group_assignments[];personal_candidates public.merchant_attendance_personal_rule_operations[];
  worker_item jsonb;item jsonb;result jsonb;publication_items jsonb;withdrawal_item jsonb;
  assignment_items jsonb:='[]';rule_items jsonb:='[]';personal_items jsonb:='[]';
  assignment_limited boolean:=false;rule_limited boolean:=false;personal_limited boolean:=false;
  group_ids uuid[]:='{}';gid uuid;scope_key text;head_revision bigint;personal_revision bigint:=0;publication_count integer:=0;
  boundary_cache jsonb:='{}';boundary_key text;interval_from_at timestamptz;interval_to_at timestamptz;
  personal_check_cache jsonb:='{}';
begin
  if p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    or (select count(*) from jsonb_object_keys(p_query))<>4 or not(p_query ?& array['siteId','workerId','fromDate','throughDate'])
    or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','') !~ '^\d{8}$'
    or jsonb_typeof(p_query->'workerId')<>'string' or coalesce(p_query->>'workerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_query->'fromDate')<>'string' or jsonb_typeof(p_query->'throughDate')<>'string'
    or not public.faolla_attendance_group_date_v1(p_query->>'fromDate') or not public.faolla_attendance_group_date_v1(p_query->>'throughDate') then
    raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day-first_day not between 0 and 6 then raise exception 'attendance_invalid_request';end if;

  -- Same order as129. Under READ COMMITTED each statement can refresh its MVCC
  -- view: coherence comes from retained locks, not from one RPC or one timestamp.
  -- All supported124/127/129 writers require settings UPDATE BEFORE their ledger
  -- changes. SHARE blocks those changes, including first-stream insert phantoms.
  -- Worker/employee SHARE additionally pin the current dual identity. No global
  -- or table locks; no lock upgrade; no settings activity gate for historical reads.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if s.version not between 1 and 9007199254740990 or w.version not between 1 and 9007199254740990
    or not public.faolla_attendance_valid_zone_v1(s.time_zone) or not public.faolla_attendance_group_text_v1(w.display_name,1,120)
    or not public.faolla_attendance_group_text_v1(w.worker_no,1,40) or w.employee_id is not null and e.id is null then
    raise exception 'attendance_rule_sources_invalid';end if;
  from_at:=public.faolla_attendance_rule_day_start_v1(p_query->>'fromDate',s.time_zone);
  to_at:=public.faolla_attendance_personal_rule_end_v1(p_query->>'throughDate',s.time_zone);
  if from_at is null or to_at is null or to_at<=from_at then raise exception 'attendance_invalid_request';end if;
  worker_item:=jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,
    'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',coalesce(e.status='active',false));

  -- A bound ledger is never projected onto a new employee or new Auth identity,
  -- even if this window happens not to contain one of its approvals.
  select * into personal_stream from public.merchant_attendance_personal_rule_streams where merchant_id=site and worker_id=wid;
  if found then
    if personal_stream.employee_id is distinct from w.employee_id or personal_stream.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_personal_rule_identity_changed';end if;
    personal_revision:=personal_stream.revision;perform public.faolla_attendance_personal_rule_stream_checked_v1(personal_stream);
  end if;

  -- Original interval candidates retain cancelled/ended histories. A current
  -- projection is not a frozen historical assignment or a unique-group claim.
  assignment_candidates:=array(select a from public.merchant_attendance_group_assignments a where a.merchant_id=site and a.worker_id=wid
    and a.starts_on<=last_day+2 and (a.original_ends_on is null or a.original_ends_on>=first_day-2) order by a.assignment_id limit 101);
  assignment_limited:=cardinality(assignment_candidates)>100;
  if not assignment_limited then
    foreach assignment in array assignment_candidates loop
      item:=public.faolla_attendance_group_assignment_detail_v1(assignment);
      boundary_key:=jsonb_build_array('start',assignment.time_zone,assignment.starts_on)::text;
      interval_from_at:=(boundary_cache->>boundary_key)::timestamptz;
      if interval_from_at is null then
        interval_from_at:=public.faolla_attendance_rule_day_start_v1(to_char(assignment.starts_on,'YYYY-MM-DD'),assignment.time_zone);
        if interval_from_at is null then raise exception 'attendance_rule_sources_invalid';end if;
        boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,interval_from_at);
      end if;
      interval_to_at:=null;
      if assignment.original_ends_on is not null then
        boundary_key:=jsonb_build_array('end',assignment.time_zone,assignment.original_ends_on)::text;
        interval_to_at:=(boundary_cache->>boundary_key)::timestamptz;
        if interval_to_at is null then
          interval_to_at:=public.faolla_attendance_personal_rule_end_v1(to_char(assignment.original_ends_on,'YYYY-MM-DD'),assignment.time_zone);
          if interval_to_at is null then raise exception 'attendance_rule_sources_invalid';end if;
          boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,interval_to_at);
        end if;
      end if;
      if interval_from_at>=to_at or interval_to_at<=from_at then continue;end if;
      select * into g from public.merchant_attendance_groups where merchant_id=site and group_id=assignment.group_id for share;
      if not found then raise exception 'attendance_rule_sources_invalid';end if;
      assignment_items:=assignment_items||jsonb_build_array(jsonb_build_object('detail',item,'currentGroup',public.faolla_attendance_group_checked_v1(g)));
      if not(g.group_id=any(group_ids)) then group_ids:=array_append(group_ids,g.group_id);end if;
    end loop;
  end if;

  rule_limited:=assignment_limited or cardinality(group_ids)+1>100;
  if not rule_limited then
    for gid in select id from (select null::uuid id union all select unnest(group_ids)) targets order by id nulls first loop
      scope_key:=coalesce(gid::text,'enterprise');publication_items:='[]';head_revision:=0;
      select * into stream from public.merchant_attendance_rule_streams x where x.merchant_id=site and x.stream_key=scope_key;
      if found then head_revision:=stream.revision;perform public.faolla_attendance_rule_stream_checked_v1(stream);end if;
      -- Indexed carry-in is independent of the newest25 operation history.
      for publication in
        with preceding as (select p.* from public.merchant_attendance_rule_operations p where p.merchant_id=site and p.stream_key=scope_key
          and p.action='publish' and p.effective_at<=from_at and not exists(select 1 from public.merchant_attendance_rule_operations wd
            where wd.merchant_id=p.merchant_id and wd.stream_key=p.stream_key and wd.action='withdraw' and wd.published_revision=p.revision)
          order by p.effective_at desc limit 1),
        inside as (select p.* from public.merchant_attendance_rule_operations p where p.merchant_id=site and p.stream_key=scope_key
          and p.action='publish' and p.effective_at>from_at and p.effective_at<to_at and not exists(select 1 from public.merchant_attendance_rule_operations wd
            where wd.merchant_id=p.merchant_id and wd.stream_key=p.stream_key and wd.action='withdraw' and wd.published_revision=p.revision)
          order by p.effective_at limit 101)
        select * from (select * from preceding union all select * from inside) bounded order by revision limit 101 loop
        publication_count:=publication_count+1;
        if publication_count>100 then rule_limited:=true;rule_items:='[]';exit;end if;
        if publication.revision>head_revision then raise exception 'attendance_rule_sources_invalid';end if;
        perform public.faolla_attendance_rule_receipt_v1(publication);publication_items:=publication_items||jsonb_build_array(publication.snapshot);
      end loop;
      exit when rule_limited;
      rule_items:=rule_items||jsonb_build_array(jsonb_build_object('groupId',gid,'revision',head_revision,'publications',publication_items));
    end loop;
  end if;

  --129 allows at most31 civil dates, and its start/end binary searches each
  -- remain within36h of the UTC date label. Thus every valid interval is <=34
  -- actual days. This conservative indexed lower bound cannot omit a carry-in;
  -- cap101 BEFORE endpoint filtering/receipt work, including withdrawn history.
  personal_candidates:=array(select p from public.merchant_attendance_personal_rule_operations p where p.merchant_id=site and p.worker_id=wid
    and p.action='approve' and p.from_at>=rule_sources.from_at-interval '816 hours' and p.from_at<rule_sources.to_at order by p.from_at,p.to_at limit 101);
  personal_limited:=cardinality(personal_candidates)>100;
  if not personal_limited then
    foreach approval in array personal_candidates loop
      if approval.to_at<=from_at then continue;end if;
      if approval.revision>personal_revision or approval.employee_id is distinct from w.employee_id or approval.employee_auth_user_id is distinct from e.auth_user_id then
        raise exception 'attendance_rule_sources_invalid';end if;
      personal_check_cache:=public.faolla_attendance_rule_sources_personal_checked_v1(approval,personal_check_cache);withdrawal_item:=null;
      select * into withdrawal from public.merchant_attendance_personal_rule_operations p where p.merchant_id=site and p.worker_id=wid
        and p.action='withdraw' and p.approved_revision=approval.revision;
      if found then
        if withdrawal.revision>personal_revision then raise exception 'attendance_rule_sources_invalid';end if;
        personal_check_cache:=public.faolla_attendance_rule_sources_personal_checked_v1(withdrawal,personal_check_cache);withdrawal_item:=withdrawal.snapshot;
      end if;
      personal_items:=personal_items||jsonb_build_array(jsonb_build_object('approval',approval.snapshot,'withdrawal',withdrawal_item));
    end loop;
  end if;
  select coalesce(jsonb_agg(value order by (value->'approval'->>'revision')::bigint),'[]'::jsonb) into personal_items from jsonb_array_elements(personal_items);
  read_at:=clock_timestamp();
  if personal_stream.updated_at is not null and read_at<personal_stream.updated_at then raise exception 'attendance_rule_sources_invalid';end if;
  result:=jsonb_build_object('protocol','rule-sources-v1','siteId',site,'actorId',p_auth_user_id,'fromDate',p_query->>'fromDate','throughDate',p_query->>'throughDate',
    'worker',worker_item,'settingsVersion',s.version,'timeZone',s.time_zone,'fromAt',to_char(from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'toAt',to_char(to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'readAt',to_char(read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'assignments',jsonb_build_object('limited',assignment_limited,'items',assignment_items),'rules',jsonb_build_object('limited',rule_limited,'items',rule_items),
    'personal',jsonb_build_object('revision',personal_revision,'limited',personal_limited,'items',personal_items));
  if octet_length(result::text)>1048576 then raise exception 'attendance_rule_sources_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
  raise exception 'attendance_invalid_request';
end;
$$;
revoke all on function public.faolla_attendance_rule_sources_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_rule_sources_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040130,'merchant_attendance_rule_sources') on conflict(version) do nothing;

do $rule_sources_postconditions$
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040130 and name='merchant_attendance_rule_sources') then
    raise exception 'merchant_attendance_rule_sources_registry_postcondition_failed';end if;
  if not has_function_privilege('service_role','public.faolla_attendance_rule_sources_v1(jsonb,uuid)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_rule_sources_v1(jsonb,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_rule_sources_v1(jsonb,uuid)','EXECUTE') then
    raise exception 'merchant_attendance_rule_sources_acl_postcondition_failed';end if;
  if has_function_privilege('service_role','public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)','EXECUTE')
    or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)'::regprocedure
        and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'merchant_attendance_rule_sources_acl_postcondition_failed';end if;
end;
$rule_sources_postconditions$;
notify pgrst, 'reload schema';
commit;
