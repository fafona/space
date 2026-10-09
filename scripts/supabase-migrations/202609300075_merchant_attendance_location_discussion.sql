-- Explicit employee-facing correspondence, separate from private owner reviews.
-- Local candidate only. No backfill, punch correction, notification or activation.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_location_discussion (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  event_id uuid not null references public.merchant_attendance_location_results(event_id) on delete restrict,
  revision bigint not null check(revision between 1 and 9007199254740990),
  operation_id uuid not null,
  actor_auth_user_id uuid not null,
  author text not null check(author in ('self','owner')),
  command jsonb not null check(jsonb_typeof(command)='object'),
  note text not null check(char_length(btrim(note)) between 1 and 500 and note !~ '[[:cntrl:]]'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,event_id,revision), unique(merchant_id,operation_id)
);
alter table public.merchant_attendance_location_discussion enable row level security;
revoke all on public.merchant_attendance_location_discussion from public,anon,authenticated,service_role;
create trigger merchant_attendance_location_discussion_no_rewrite before update or delete
  on public.merchant_attendance_location_discussion for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_discussion_no_truncate before truncate
  on public.merchant_attendance_location_discussion for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_location_discussion_entry_v1(p_row public.merchant_attendance_location_discussion)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select case when p_row.revision is null then null else jsonb_build_object('revision',p_row.revision,'author',p_row.author,
    'note',p_row.note,'recordedAt',to_char(p_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) end;
$$;
revoke all on function public.faolla_attendance_location_discussion_entry_v1(public.merchant_attendance_location_discussion) from public,anon,authenticated,service_role;

create function public.faolla_attendance_location_discussion_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype; emp public.merchant_enterprise_employees%rowtype; role_row public.merchant_enterprise_roles%rowtype;
  worker public.merchant_attendance_workers%rowtype; ev public.merchant_attendance_events%rowtype;
  receipt public.merchant_attendance_location_discussion%rowtype; latest public.merchant_attendance_location_discussion%rowtype;
  v_access text; v_mode text; v_event uuid; v_op uuid; v_expected_worker uuid; v_from timestamptz; v_to timestamptz;
  v_as_of timestamptz; v_now timestamptz; v_cursor_at timestamptz; v_cursor_id uuid; v_can_post boolean:=false;
  v_items jsonb:='[]'::jsonb; v_item jsonb; v_history jsonb; v_next jsonb:='null'::jsonb; v_count integer:=0; r record;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    then raise exception 'attendance_invalid_request'; end if;
  v_access:=p_query->>'access';v_mode:=p_query->>'mode';
  if coalesce(v_access,'') not in ('self','owner') or coalesce(v_mode,'') not in ('list','detail')
    or not(p_query ? 'expectedWorkerId') or (p_query->'expectedWorkerId'<>'null'::jsonb and coalesce(p_query->>'expectedWorkerId','') !~ v_uuid)
    or (v_access='owner' and p_query->'expectedWorkerId'<>'null'::jsonb) then raise exception 'attendance_invalid_request'; end if;
  v_expected_worker:=(p_query->>'expectedWorkerId')::uuid;
  if v_mode='detail' then
    if (select count(*) from jsonb_object_keys(p_query))<>5 or not(p_query ?& array['access','mode','expectedWorkerId','eventId','operationId'])
      or coalesce(p_query->>'eventId','') !~ v_uuid or (p_query->'operationId'<>'null'::jsonb and coalesce(p_query->>'operationId','') !~ v_uuid)
      or (v_access='self' and v_expected_worker is null) then raise exception 'attendance_invalid_request'; end if;
    v_event:=(p_query->>'eventId')::uuid;v_op:=(p_query->>'operationId')::uuid;
  else
    if p_command is not null or (select count(*) from jsonb_object_keys(p_query))<>8
      or not(p_query ?& array['access','mode','expectedWorkerId','fromAt','toAt','asOf','cursorAt','cursorId'])
      or (p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid)
      or ((p_query->'cursorId'='null'::jsonb)<>(p_query->'cursorAt'='null'::jsonb))
      or (p_query->'cursorId'<>'null'::jsonb and (p_query->'asOf'='null'::jsonb or (v_access='self' and v_expected_worker is null)))
      then raise exception 'attendance_invalid_request'; end if;
    v_from:=public.faolla_attendance_instant_v1(p_query->>'fromAt');v_to:=public.faolla_attendance_instant_v1(p_query->>'toAt');
    if v_to<=v_from or v_to-v_from>interval '31 days' then raise exception 'attendance_invalid_request'; end if;
    v_cursor_id:=(p_query->>'cursorId')::uuid;
    if v_cursor_id is not null then v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt'); end if;
  end if;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' or (select count(*) from jsonb_object_keys(p_command))<>4
      or not(p_command ?& array['eventId','operationId','expectedRevision','note']) or p_command->>'eventId' is distinct from v_event::text
      or v_op is not null or coalesce(p_command->>'operationId','') !~ v_uuid
      or jsonb_typeof(p_command->'expectedRevision')<>'number' or coalesce(p_command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedRevision')::numeric>9007199254740989 or jsonb_typeof(p_command->'note')<>'string'
      or char_length(btrim(p_command->>'note')) not between 1 and 500 or p_command->>'note' ~ '[[:cntrl:]]'
      or p_command->>'note'<>btrim(p_command->>'note') then raise exception 'attendance_invalid_request'; end if;
    v_op:=(p_command->>'operationId')::uuid;
  end if;
  select * into m from public.merchants where id=p_site_id for share;
  if not found then raise exception 'attendance_access_denied'; end if;
  if v_access='owner' and not coalesce(p_auth_user_id=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  if not found then raise exception 'attendance_settings_required'; end if;
  if v_access='self' then
    select * into emp from public.merchant_enterprise_employees where merchant_id=p_site_id and auth_user_id=p_auth_user_id for share;
    if not found or emp.status<>'active' then raise exception 'attendance_access_denied'; end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=p_site_id and id=emp.role_id for share;
    if not found or role_row.status<>'active' or not public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions)
      or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied'; end if;
    select * into worker from public.merchant_attendance_workers where merchant_id=p_site_id and employee_id=emp.id for share;
    if not found then raise exception 'attendance_access_denied'; end if;
    if v_expected_worker is not null and worker.id<>v_expected_worker then raise exception 'attendance_worker_changed'; end if;
    v_can_post:='attendance.self.clock'=any(role_row.permissions);
  else v_can_post:=true; end if;
  v_now:=clock_timestamp();
  if v_mode='list' then
    v_as_of:=case when p_query->'asOf'='null'::jsonb then v_now else public.faolla_attendance_instant_v1(p_query->>'asOf') end;
    if v_as_of>v_now or (v_cursor_id is not null and (v_cursor_at<v_from or v_cursor_at>=least(v_to,v_as_of))) then raise exception 'attendance_invalid_request'; end if;
    -- Scan at most 51 original facts, then match anomalies. No unbounded count or
    -- search for 50 matching conversations. Last scanned row advances empty pages.
    for r in with candidates as materialized (
      -- Separate mutually exclusive branches retain the tenant-time versus
      -- tenant-worker-time index prefix even with a cached generic plan.
      (select e.* from public.merchant_attendance_events e where v_access='owner' and e.merchant_id=p_site_id
        and e.occurred_at>=v_from and e.occurred_at<least(v_to,v_as_of)
        and (v_cursor_id is null or (e.occurred_at,e.id)<(v_cursor_at,v_cursor_id)) order by e.occurred_at desc,e.id desc limit 51)
      union all
      (select e.* from public.merchant_attendance_events e where v_access='self' and e.merchant_id=p_site_id and e.worker_id=worker.id
        and e.occurred_at>=v_from and e.occurred_at<least(v_to,v_as_of)
        and (v_cursor_id is null or (e.occurred_at,e.id)<(v_cursor_at,v_cursor_id)) order by e.occurred_at desc,e.id desc limit 51)
    ) select c.*,s.reason,s.needs_review,w.display_name,rv.outcome,d.revision,d.author from candidates c
      left join public.merchant_attendance_location_results s on s.event_id=c.id
      join public.merchant_attendance_workers w on w.merchant_id=p_site_id and w.id=c.worker_id
      left join lateral (select a.outcome from public.merchant_attendance_location_reviews a where a.merchant_id=p_site_id and a.event_id=c.id order by a.revision desc limit 1) rv on true
      left join lateral (select a.revision,a.author from public.merchant_attendance_location_discussion a where a.merchant_id=p_site_id and a.event_id=c.id order by a.revision desc limit 1) d on true
      order by c.occurred_at desc,c.id desc
    loop
      v_count:=v_count+1; if v_count=51 then exit; end if;
      v_next:=jsonb_build_object('occurredAt',to_char(r.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',r.id);
      if coalesce(r.needs_review,false) and (v_access='owner' or r.actor_employee_id=emp.id) then
        v_items:=v_items||jsonb_build_array(jsonb_build_object('eventId',r.id,'workerId',r.worker_id,'workerName',r.display_name,
          'occurredAt',v_next->'occurredAt','action',r.action,'reason',r.reason,
          'reviewState',case r.outcome when 'noted' then 'reviewed' when 'follow_up' then 'follow_up' else 'pending' end,
          'revision',coalesce(r.revision,0),'lastAuthor',r.author));
      end if;
    end loop;
    return jsonb_build_object('siteId',p_site_id,'access',v_access,'mode','list','employeeId',emp.id,'workerId',worker.id,'canPost',v_can_post,
      'asOf',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'items',v_items,'scanned',least(v_count,50),
      'nextCursor',case when v_count=51 then v_next else 'null'::jsonb end);
  end if;
  select * into ev from public.merchant_attendance_events where merchant_id=p_site_id and id=v_event;
  if not found or (v_access='self' and (ev.worker_id<>worker.id or ev.actor_employee_id is distinct from emp.id)) then raise exception 'attendance_review_not_found'; end if;
  -- Same per-event lock as internal reviews. Serialization never updates evidence.
  if p_command is null then perform 1 from public.merchant_attendance_location_results where event_id=v_event and needs_review for share;
  else perform 1 from public.merchant_attendance_location_results where event_id=v_event and needs_review for update; end if;
  if not found then raise exception 'attendance_review_not_found'; end if;
  select * into latest from public.merchant_attendance_location_discussion where merchant_id=p_site_id and event_id=v_event order by revision desc limit 1;
  select * into receipt from public.merchant_attendance_location_discussion where merchant_id=p_site_id and operation_id=v_op;
  if receipt.revision is not null and (receipt.event_id<>v_event or receipt.actor_auth_user_id<>p_auth_user_id or receipt.author<>v_access) then
    if p_command is not null then raise exception 'attendance_operation_conflict'; end if; receipt:=null;
  end if;
  if p_command is not null then
    if receipt.revision is not null then
      if receipt.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
    else
      if not v_can_post then raise exception 'attendance_access_denied'; end if;
      if coalesce(latest.revision,0)<>(p_command->>'expectedRevision')::bigint then raise exception 'attendance_version_conflict'; end if;
      begin
        insert into public.merchant_attendance_location_discussion(merchant_id,event_id,revision,operation_id,actor_auth_user_id,author,command,note,recorded_at)
          values(p_site_id,v_event,coalesce(latest.revision,0)+1,v_op,p_auth_user_id,v_access,p_command,p_command->>'note',
            greatest(clock_timestamp(),ev.occurred_at,latest.recorded_at)) returning * into receipt;
      exception when unique_violation then raise exception 'attendance_operation_conflict'; end;
      latest:=receipt;
    end if;
  end if;
  v_as_of:=greatest(clock_timestamp(),ev.occurred_at,latest.recorded_at);
  select jsonb_build_object('eventId',ev.id,'workerId',ev.worker_id,'workerName',w.display_name,
    'occurredAt',to_char(ev.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',ev.action,'reason',s.reason,
    'reviewState',case rv.outcome when 'noted' then 'reviewed' when 'follow_up' then 'follow_up' else 'pending' end,
    'revision',coalesce(latest.revision,0),'lastAuthor',latest.author) into v_item
    from public.merchant_attendance_location_results s join public.merchant_attendance_workers w on w.merchant_id=p_site_id and w.id=ev.worker_id
    left join lateral (select a.outcome from public.merchant_attendance_location_reviews a where a.merchant_id=p_site_id and a.event_id=v_event order by a.revision desc limit 1) rv on true where s.event_id=v_event;
  select coalesce(jsonb_agg(public.faolla_attendance_location_discussion_entry_v1(a) order by a.revision desc),'[]'::jsonb) into v_history
    from (select * from public.merchant_attendance_location_discussion where merchant_id=p_site_id and event_id=v_event order by revision desc limit 20) a;
  return jsonb_build_object('siteId',p_site_id,'access',v_access,'mode','detail','employeeId',emp.id,'workerId',worker.id,'canPost',v_can_post,
    'asOf',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'item',v_item,'history',v_history,
    'historyTruncated',coalesce(latest.revision,0)>20,'receipt',case when receipt.revision is null then null
      else public.faolla_attendance_location_discussion_entry_v1(receipt)||jsonb_build_object('operationId',receipt.operation_id) end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
end; $$;
revoke all on function public.faolla_attendance_location_discussion_v1(text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_discussion_v1(text,uuid,jsonb,jsonb) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202609300075,'merchant_attendance_location_discussion') on conflict(version) do nothing;
commit;
