-- Owner-only read access to existing immutable audit receipts. No data backfill.
begin;
set local lock_timeout='3s';
create index merchant_attendance_config_audit_time_idx on public.merchant_attendance_config_operations(merchant_id,recorded_at desc,operation_id desc);
create index merchant_attendance_scope_audit_time_idx on public.merchant_attendance_scope_operations(merchant_id,recorded_at desc,operation_id desc);

-- Explicit whitelist. Old worker snapshots did not capture employment starts_on:
-- return null, never reconstruct it from today's employment or the new command.
create function public.faolla_attendance_audit_value_v1(p_kind text,p_value jsonb,p_before boolean,p_target uuid) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare v jsonb;
begin
  if p_value is null or p_value='null'::jsonb then return null; end if;
  if p_kind in ('grant_put','grant_remove') then
    select g into v from jsonb_array_elements(p_value->'grants')g where g->>'id'=p_target::text;
    if v is null then return null; end if;
    return jsonb_build_object('id',v->'id','workerIds',v->'workerIds','locationIds',v->'locationIds','validFrom',v->'validFrom','validUntil',v->'validUntil');
  elsif p_kind='settings' then
    return jsonb_build_object('timeZone',p_value->case when p_before then 'time_zone' else 'timeZone' end,
      'enabled',p_value->'enabled','webClockEnabled',p_value->case when p_before then 'web_clock_enabled' else 'webClockEnabled' end,
      'webBreakPaid',p_value->case when p_before then 'web_break_paid' else 'webBreakPaid' end);
  elsif p_kind='location' then
    return jsonb_build_object('id',p_value->'id','name',p_value->'name','active',p_value->'active',
      'timeZone',p_value->case when p_before then 'time_zone' else 'timeZone' end);
  elsif p_kind='worker' then
    return jsonb_build_object('id',p_value->'id','active',p_value->'active',
      'employeeId',p_value->case when p_before then 'employee_id' else 'employeeId' end,
      'workerNo',p_value->case when p_before then 'worker_no' else 'workerNo' end,
      'displayName',p_value->case when p_before then 'display_name' else 'displayName' end,
      'locationId',p_value->case when p_before then 'default_location_id' else 'locationId' end,
      'startsOn',case when p_before then 'null'::jsonb else p_value->'startsOn' end);
  end if;
  raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_audit_value_v1(text,jsonb,boolean,uuid) from public,anon,authenticated,service_role;

create function public.faolla_attendance_audit_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype; v_mode text; v_source text; v_from timestamptz; v_to timestamptz; v_as_of timestamptz;
  v_now timestamptz; v_cursor_at timestamptz; v_cursor uuid; v_operation uuid; v_rows jsonb; v_next jsonb:='null'::jsonb; r record;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    then raise exception 'attendance_invalid_request'; end if;
  v_mode:=p_query->>'mode'; v_source:=p_query->>'source';
  if coalesce(v_mode,'') not in ('list','detail') or coalesce(v_source,'') not in ('config','scope') then raise exception 'attendance_invalid_request'; end if;
  if v_mode='detail' then
    if (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['mode','source','operationId'])
      or coalesce(p_query->>'operationId','') !~ v_uuid then raise exception 'attendance_invalid_request'; end if;
    v_operation:=(p_query->>'operationId')::uuid;
  else
    if (select count(*) from jsonb_object_keys(p_query))<>7 or not(p_query ?& array['mode','source','fromAt','toAt','asOf','cursorAt','cursorId'])
      then raise exception 'attendance_invalid_request'; end if;
    v_from:=public.faolla_attendance_instant_v1(p_query->>'fromAt'); v_to:=public.faolla_attendance_instant_v1(p_query->>'toAt');
    if v_to<=v_from or v_to-v_from>interval '31 days'
      or (p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid)
      or ((p_query->'cursorId'='null'::jsonb)<>(p_query->'cursorAt'='null'::jsonb))
      or (p_query->'cursorId'<>'null'::jsonb and p_query->'asOf'='null'::jsonb) then raise exception 'attendance_invalid_request'; end if;
    v_cursor:=(p_query->>'cursorId')::uuid;
    if v_cursor is not null then v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt'); end if;
  end if;
  select * into m from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  v_now:=clock_timestamp();
  if v_mode='list' then
    v_as_of:=case when p_query->'asOf'='null'::jsonb then v_now else public.faolla_attendance_instant_v1(p_query->>'asOf') end;
    if v_as_of>v_now or (v_cursor is not null and (v_cursor_at<v_from or v_cursor_at>=least(v_to,v_as_of))) then raise exception 'attendance_invalid_request'; end if;
  end if;
  -- List branches use tenant/time bounds; detail branches use exact primary keys.
  -- Detail snapshots are selected only for one explicit receipt, not list pages.
  select coalesce(jsonb_agg(j order by recorded_at desc,operation_id desc),'[]'::jsonb) into v_rows from (
    select a.recorded_at,a.operation_id,jsonb_build_object('operationId',a.operation_id,
      'recordedAt',to_char(a.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'kind',a.kind,'version',a.version,'targetId',a.target_id,'employeeId',a.employee_id,
      'actorRef',md5('attendance-audit:'||p_site_id||':'||a.actor_auth_user_id::text),'byCurrentOwner',a.actor_auth_user_id=p_auth_user_id) j
    from (
      (select recorded_at,operation_id,command->>'kind' kind,version,(command->'values'->>'id')::uuid target_id,null::uuid employee_id,actor_auth_user_id
        from public.merchant_attendance_config_operations where v_mode='list' and v_source='config' and merchant_id=p_site_id
        and recorded_at>=v_from and recorded_at<least(v_to,v_as_of)
        and (v_cursor is null or (recorded_at,operation_id)<(v_cursor_at,v_cursor)) order by recorded_at desc,operation_id desc limit 26)
      union all
      (select recorded_at,operation_id,'grant_'||(command->>'action') kind,revision version,(command->>'grantId')::uuid target_id,employee_id,actor_auth_user_id
        from public.merchant_attendance_scope_operations where v_mode='list' and v_source='scope' and merchant_id=p_site_id
        and recorded_at>=v_from and recorded_at<least(v_to,v_as_of)
        and (v_cursor is null or (recorded_at,operation_id)<(v_cursor_at,v_cursor)) order by recorded_at desc,operation_id desc limit 26)
      union all
      (select recorded_at,operation_id,command->>'kind',version,(command->'values'->>'id')::uuid,null::uuid,actor_auth_user_id
        from public.merchant_attendance_config_operations where v_mode='detail' and v_source='config'
        and merchant_id=p_site_id and operation_id=v_operation)
      union all
      (select recorded_at,operation_id,'grant_'||(command->>'action'),revision,(command->>'grantId')::uuid,employee_id,actor_auth_user_id
        from public.merchant_attendance_scope_operations where v_mode='detail' and v_source='scope'
        and merchant_id=p_site_id and operation_id=v_operation)
    )a) page;
  if v_mode='detail' then
    if jsonb_array_length(v_rows)<>1 then raise exception 'attendance_audit_not_found'; end if;
    if v_source='config' then
      select before_value,after_value into r from public.merchant_attendance_config_operations where merchant_id=p_site_id and operation_id=v_operation;
    else
      select before_value,after_value into r from public.merchant_attendance_scope_operations where merchant_id=p_site_id and operation_id=v_operation;
    end if;
    return jsonb_build_object('siteId',p_site_id,'source',v_source,'mode',v_mode,'item',v_rows->0,
      'before',public.faolla_attendance_audit_value_v1(v_rows->0->>'kind',r.before_value,true,(v_rows->0->>'targetId')::uuid),
      'after',public.faolla_attendance_audit_value_v1(v_rows->0->>'kind',r.after_value,false,(v_rows->0->>'targetId')::uuid));
  end if;
  if jsonb_array_length(v_rows)>25 then v_rows:=v_rows-25;v_next:=jsonb_build_object('recordedAt',v_rows->24->>'recordedAt','operationId',v_rows->24->>'operationId'); end if;
  return jsonb_build_object('siteId',p_site_id,'source',v_source,'mode',v_mode,'asOf',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'items',v_rows,'nextCursor',v_next);
end; $$;
revoke all on function public.faolla_attendance_audit_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_audit_v1(text,uuid,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300069,'merchant_attendance_audit_read') on conflict(version) do nothing;
commit;
