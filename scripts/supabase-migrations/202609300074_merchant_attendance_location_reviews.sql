-- Review annotations only. Never rewrite punches, location results or wages.
begin;
set local lock_timeout='3s';
create table public.merchant_attendance_location_reviews (
  merchant_id text not null references public.merchant_attendance_settings(merchant_id) on delete restrict,
  event_id uuid not null references public.merchant_attendance_location_results(event_id) on delete restrict,
  revision bigint not null check(revision between 1 and 9007199254740990),
  operation_id uuid not null,
  actor_auth_user_id uuid not null,
  command jsonb not null check(jsonb_typeof(command)='object'),
  outcome text not null check(outcome in ('noted','follow_up','reopen')),
  note text not null check(char_length(btrim(note)) between 1 and 500 and note !~ '[[:cntrl:]]'),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,event_id,revision),
  unique(merchant_id,operation_id)
);
alter table public.merchant_attendance_location_reviews enable row level security;
revoke all on public.merchant_attendance_location_reviews from public,anon,authenticated,service_role;
create trigger merchant_attendance_location_reviews_no_rewrite before update or delete
  on public.merchant_attendance_location_reviews for each row execute function public.faolla_attendance_events_append_only_v1();
create trigger merchant_attendance_location_reviews_no_truncate before truncate
  on public.merchant_attendance_location_reviews for each statement execute function public.faolla_attendance_events_append_only_v1();

create function public.faolla_attendance_location_review_entry_v1(p_row public.merchant_attendance_location_reviews,p_actor uuid)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select case when p_row.revision is null then null else jsonb_build_object('revision',p_row.revision,'outcome',p_row.outcome,'note',p_row.note,
    'recordedAt',to_char(p_row.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actorRef',md5('attendance-location-review:'||p_row.merchant_id||':'||p_row.actor_auth_user_id::text),'byCurrentOwner',p_row.actor_auth_user_id=p_actor) end;
$$;
revoke all on function public.faolla_attendance_location_review_entry_v1(public.merchant_attendance_location_reviews,uuid) from public,anon,authenticated,service_role;

create function public.faolla_attendance_location_reviews_v1(p_site_id text,p_auth_user_id uuid,p_query jsonb,p_command jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  m public.merchants%rowtype; v_event public.merchant_attendance_events%rowtype;
  v_summary public.merchant_attendance_location_results%rowtype;
  v_latest public.merchant_attendance_location_reviews%rowtype; v_receipt public.merchant_attendance_location_reviews%rowtype;
  v_mode text; v_status text; v_event_id uuid; v_operation uuid; v_from timestamptz; v_to timestamptz; v_as_of timestamptz; v_now timestamptz;
  v_cursor_at timestamptz; v_cursor uuid; v_worker uuid; v_location uuid; v_count integer:=0;
  v_items jsonb:='[]'::jsonb; v_item jsonb; v_history jsonb; v_next jsonb:='null'::jsonb; v_last_scan jsonb; v_state text; r record;
  v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_site_id is null or p_site_id !~ '^\d{8}$' or p_auth_user_id is null or p_query is null or jsonb_typeof(p_query)<>'object'
    then raise exception 'attendance_invalid_request'; end if;
  v_mode:=p_query->>'mode';
  if coalesce(v_mode,'') not in ('list','detail') then raise exception 'attendance_invalid_request'; end if;
  if v_mode='detail' then
    if (select count(*) from jsonb_object_keys(p_query))<>3 or not(p_query ?& array['mode','eventId','operationId'])
      or coalesce(p_query->>'eventId','') !~ v_uuid
      or (p_query->'operationId'<>'null'::jsonb and coalesce(p_query->>'operationId','') !~ v_uuid) then raise exception 'attendance_invalid_request'; end if;
    v_event_id:=(p_query->>'eventId')::uuid;v_operation:=(p_query->>'operationId')::uuid;
  else
    if p_command is not null or (select count(*) from jsonb_object_keys(p_query))<>9 or not(p_query ?& array[
      'mode','fromAt','toAt','workerId','locationId','status','asOf','cursorAt','cursorId'])
      or coalesce(p_query->>'status','') not in ('all','pending','reviewed','follow_up')
      or (p_query->'workerId'<>'null'::jsonb and coalesce(p_query->>'workerId','') !~ v_uuid)
      or (p_query->'locationId'<>'null'::jsonb and coalesce(p_query->>'locationId','') !~ v_uuid)
      or (p_query->'cursorId'<>'null'::jsonb and coalesce(p_query->>'cursorId','') !~ v_uuid)
      or ((p_query->'cursorId'='null'::jsonb)<>(p_query->'cursorAt'='null'::jsonb))
      or (p_query->'cursorId'<>'null'::jsonb and p_query->'asOf'='null'::jsonb) then raise exception 'attendance_invalid_request'; end if;
    v_from:=public.faolla_attendance_instant_v1(p_query->>'fromAt');v_to:=public.faolla_attendance_instant_v1(p_query->>'toAt');
    if v_to<=v_from or v_to-v_from>interval '31 days' then raise exception 'attendance_invalid_request'; end if;
    v_status:=p_query->>'status';v_worker:=(p_query->>'workerId')::uuid;v_location:=(p_query->>'locationId')::uuid;v_cursor:=(p_query->>'cursorId')::uuid;
    if v_cursor is not null then v_cursor_at:=public.faolla_attendance_instant_v1(p_query->>'cursorAt'); end if;
  end if;
  if p_command is not null then
    if jsonb_typeof(p_command)<>'object' or v_operation is not null then raise exception 'attendance_invalid_request'; end if;
    if (select count(*) from jsonb_object_keys(p_command))<>5 or not(p_command ?& array['eventId','operationId','expectedRevision','outcome','note'])
      or coalesce(p_command->>'eventId','')<>v_event_id::text or coalesce(p_command->>'operationId','') !~ v_uuid
      or coalesce(p_command->>'outcome','') not in ('noted','follow_up','reopen') or jsonb_typeof(p_command->'outcome')<>'string'
      or jsonb_typeof(p_command->'expectedRevision')<>'number' or coalesce(p_command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$'
      or (p_command->>'expectedRevision')::numeric>=9007199254740990
      or jsonb_typeof(p_command->'note')<>'string' or char_length(btrim(p_command->>'note')) not between 1 and 500
      or (p_command->>'note') ~ '[[:cntrl:]]' or (p_command->>'note')<>btrim(p_command->>'note') then raise exception 'attendance_invalid_request'; end if;
    v_operation:=(p_command->>'operationId')::uuid;
  end if;
  -- Current owner only, on every page/detail/retry. A manager's records.view
  -- permission does not confer review authority. No client-selected actor.
  select * into m from public.merchants where id=p_site_id for share;
  if not found or not coalesce(p_auth_user_id=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]),false)
    then raise exception 'attendance_access_denied'; end if;
  perform 1 from public.merchant_attendance_settings where merchant_id=p_site_id for share;
  v_now:=clock_timestamp();
  if v_mode='detail' then
    select * into v_event from public.merchant_attendance_events where merchant_id=p_site_id and id=v_event_id;
    if not found or v_event.occurred_at>=v_now then raise exception 'attendance_review_not_found'; end if;
    -- Review writers serialize per existing summary, never update its contents.
    if p_command is null then
      select * into v_summary from public.merchant_attendance_location_results where event_id=v_event_id for share;
    else
      select * into v_summary from public.merchant_attendance_location_results where event_id=v_event_id for update;
    end if;
    if not found or not v_summary.needs_review then raise exception 'attendance_review_not_found'; end if;
    select * into v_latest from public.merchant_attendance_location_reviews where merchant_id=p_site_id and event_id=v_event_id order by revision desc limit 1;
    select * into v_receipt from public.merchant_attendance_location_reviews where merchant_id=p_site_id and operation_id=v_operation;
    if v_receipt.revision is not null and (v_receipt.event_id<>v_event_id or v_receipt.actor_auth_user_id<>p_auth_user_id) then
      if p_command is not null then raise exception 'attendance_operation_conflict'; end if;
      v_receipt:=null;
    end if;
    if p_command is not null then
      if v_receipt.revision is not null then
        if v_receipt.command<>p_command then raise exception 'attendance_operation_conflict'; end if;
      else
        if (p_command->>'expectedRevision')::bigint<>coalesce(v_latest.revision,0) then raise exception 'attendance_version_conflict'; end if;
        if p_command->>'outcome'='reopen' and coalesce(v_latest.outcome,'reopen')='reopen' then raise exception 'attendance_invalid_request'; end if;
        v_now:=clock_timestamp();
        if v_latest.recorded_at>v_now then raise exception 'attendance_version_conflict'; end if;
        insert into public.merchant_attendance_location_reviews(merchant_id,event_id,revision,operation_id,actor_auth_user_id,command,outcome,note,recorded_at)
          values(p_site_id,v_event_id,coalesce(v_latest.revision,0)+1,v_operation,p_auth_user_id,p_command,p_command->>'outcome',p_command->>'note',v_now) returning * into v_receipt;
      end if;
    end if;
    v_as_of:=clock_timestamp();
  else
    v_as_of:=case when p_query->'asOf'='null'::jsonb then v_now else public.faolla_attendance_instant_v1(p_query->>'asOf') end;
    if v_as_of>v_now or (v_cursor is not null and (v_cursor_at<v_from or v_cursor_at>=least(v_to,v_as_of))) then raise exception 'attendance_invalid_request'; end if;
  end if;
  -- Only 51 tenant/time candidates are examined per list request. Optional
  -- worker/place/status/reason filters apply AFTER the bounded index scan;
  -- an empty result with a continuation is not an empty whole date range.
  for r in
    with candidates as materialized (
      (select e.* from public.merchant_attendance_events e where v_mode='list' and e.merchant_id=p_site_id
        and e.occurred_at>=v_from and e.occurred_at<least(v_to,v_as_of)
        and (v_cursor is null or (e.occurred_at,e.id)<(v_cursor_at,v_cursor)) order by e.occurred_at desc,e.id desc limit 51)
      union all
      (select e.* from public.merchant_attendance_events e where v_mode='detail' and e.merchant_id=p_site_id and e.id=v_event_id limit 1)
    )
    select e.*,w.display_name worker_name,w.worker_no,l.name location_name,s.reason,s.needs_review,
      coalesce(a.revision,0) review_revision,a.outcome review_outcome
      from candidates e join public.merchant_attendance_workers w on w.merchant_id=p_site_id and w.id=e.worker_id
      join public.merchant_attendance_locations l on l.merchant_id=p_site_id and l.id=e.location_id
      left join public.merchant_attendance_location_results s on s.event_id=e.id
      left join lateral (select revision,outcome from public.merchant_attendance_location_reviews a
        where a.merchant_id=p_site_id and a.event_id=e.id order by revision desc limit 1) a on true
      order by e.occurred_at desc,e.id desc
  loop
    if v_count=50 then v_next:=v_last_scan;exit;end if;
    v_count:=v_count+1;
    v_last_scan:=jsonb_build_object('occurredAt',to_char(r.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',r.id);
    v_state:=case r.review_outcome when 'noted' then 'reviewed' when 'follow_up' then 'follow_up' else 'pending' end;
    if not coalesce(r.needs_review,false) or (v_mode='list' and ((v_worker is not null and r.worker_id<>v_worker)
      or (v_location is not null and r.location_id<>v_location) or (v_status<>'all' and v_state<>v_status))) then continue;end if;
    v_item:=jsonb_build_object('id',r.id,'workerId',r.worker_id,'locationId',r.location_id,'workerName',r.worker_name,'workerNo',r.worker_no,
      'locationName',r.location_name,'sequence',r.sequence,'action',r.action,'source',r.source,'timeZone',r.time_zone,'breakPaid',r.break_paid,
      'occurredAt',to_char(r.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reason',r.reason,'reviewState',v_state,'reviewRevision',r.review_revision);
    v_items:=v_items||jsonb_build_array(v_item);
  end loop;
  if v_mode='list' then
    return jsonb_build_object('siteId',p_site_id,'mode','list','asOf',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'items',v_items,'scanned',v_count,'nextCursor',v_next);
  end if;
  if v_item is null then raise exception 'attendance_review_not_found'; end if;
  select coalesce(jsonb_agg(public.faolla_attendance_location_review_entry_v1(a,p_auth_user_id) order by a.revision desc),'[]'::jsonb) into v_history
    from (select * from public.merchant_attendance_location_reviews where merchant_id=p_site_id and event_id=v_event_id order by revision desc limit 21) a;
  return jsonb_build_object('siteId',p_site_id,'mode','detail','asOf',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'item',v_item,
    'summary',jsonb_build_object('capturedAt',case when v_summary.captured_at is null then null else to_char(v_summary.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'accuracyMeters',v_summary.accuracy_meters,'distanceMeters',v_summary.distance_meters,'settingsVersion',v_summary.settings_version,'workerVersion',v_summary.worker_version,
      'locationVersion',v_summary.location_version,'algorithmVersion',v_summary.algorithm_version),
    'history',case when jsonb_array_length(v_history)>20 then v_history-20 else v_history end,'historyTruncated',jsonb_array_length(v_history)>20,
    'receipt',case when v_receipt.revision is null then null else public.faolla_attendance_location_review_entry_v1(v_receipt,p_auth_user_id)||jsonb_build_object('operationId',v_receipt.operation_id) end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'attendance_invalid_request';
  when unique_violation then raise exception 'attendance_operation_conflict';
end; $$;
revoke all on function public.faolla_attendance_location_reviews_v1(text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_location_reviews_v1(text,uuid,jsonb,jsonb) to service_role;
comment on table public.merchant_attendance_location_reviews is
  'Append-only owner review annotations. Original location reason/needs_review, event times, attendance totals and wages never changed. Outcomes are not payroll approval or identity proof.';
insert into public.faolla_schema_migrations(version,name) values(202609300074,'merchant_attendance_location_reviews') on conflict(version) do nothing;
commit;
