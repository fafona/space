-- Current-owner, single original clock-in point evidence. No writer, table,
-- index, historical repair, current rule resolution or timezone replay changes.
begin;
set local lock_timeout='3s';
do $shift_rule_reader_prerequisites$
declare installed boolean;p text;dependency record;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_shift_rule_binding_reader_prerequisite_required';end if;
  for dependency in select * from (values
    (202609290064::bigint,'merchant_attendance_owner_configuration'),
    (202610040133::bigint,'merchant_attendance_shift_rule_bindings')) d(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then
      raise exception 'merchant_attendance_shift_rule_binding_reader_prerequisite_required';end if;
  end loop;
  if to_regclass('public.merchant_attendance_shift_rule_bindings') is null or to_regclass('public.merchant_attendance_shift_rule_sources') is null
    or to_regprocedure('public.faolla_attendance_shift_rule_source_valid_v1(text,text,uuid,text,integer)') is null
    or to_regprocedure('public.faolla_attendance_rule_values_v1(jsonb)') is null
    or to_regprocedure('public.faolla_attendance_group_text_v1(text,integer,integer)') is null then
    raise exception 'merchant_attendance_shift_rule_binding_reader_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040135 and name='merchant_attendance_shift_rule_binding_reader') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040135 and name<>'merchant_attendance_shift_rule_binding_reader') then
    raise exception 'merchant_attendance_shift_rule_binding_reader_installation_conflict';end if;
  foreach p in array array['public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])',
    'public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)',
    'public.faolla_attendance_shift_rule_binding_graph_v1(jsonb,timestamp with time zone)',
    'public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_shift_rule_binding_reader_installation_conflict';end if;
  end loop;
end;
$shift_rule_reader_prerequisites$;

-- Small private structural validators. Dates are civil Gregorian labels only;
-- saved UTC instants are checked as UTC, NEVER rederived with current tzdata.
create or replace function public.faolla_attendance_shift_rule_binding_object_v1(p jsonb,keys text[])
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p is null or jsonb_typeof(p)<>'object' or keys is null then return false;end if;
  return p ?& keys and (select count(*) from jsonb_object_keys(p))=cardinality(keys);
end;
$$;
create or replace function public.faolla_attendance_shift_rule_binding_scalar_v1(p jsonb,kind text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare v text;stamp timestamptz;d date;hi integer;lo integer:=1;
begin
  if p is null or kind is null then return false;end if;
  v:=p#>>'{}';
  if kind in('version','head') then
    return jsonb_typeof(p)='number' and v~'^(0|[1-9][0-9]{0,15})$'
      and v::numeric between (case when kind='head' then 0 else 1 end) and 9007199254740990;
  end if;
  if jsonb_typeof(p)<>'string' then return false;end if;
  if kind='uuid' then return v~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  elsif kind='date' then
    if v!~'^\d{4}-\d{2}-\d{2}$' then return false;end if;d:=v::date;
    return d between date '2000-01-01' and date '2100-12-31' and to_char(d,'YYYY-MM-DD')=v;
  elsif kind in('stamp3','stamp6') then
    if kind='stamp3' and v!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      or kind='stamp6' and v!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$' then return false;end if;
    stamp:=v::timestamptz;
    return isfinite(stamp) and to_char(stamp at time zone 'UTC',case when kind='stamp3' then 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"' else 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"' end)=v;
  end if;
  hi:=case kind when 'zone' then 100 when 'text40' then 40 when 'text80' then 80 when 'text120' then 120 when 'reason' then 200 when 'description' then 200 else 0 end;
  if kind='description' then lo:=0;end if;
  return hi>0 and public.faolla_attendance_group_text_v1(v,lo,hi);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return false;
end;
$$;

-- Validate only the immutable graph produced by133. No ledger/table lookups,
-- current owner equality for historical authors, or current IANA conversions.
-- Its fields are separately recomputed by133's pure source_valid_v1 checker.
create or replace function public.faolla_attendance_shift_rule_binding_graph_v1(p jsonb,point_at timestamptz)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare a jsonb;d jsonb;g jsonb;scope_item jsonb;item jsonb;part jsonb;cmd jsonb;first_item jsonb;previous_item jsonb;
  layer text;k text;i integer;n integer;head bigint;group_revision bigint;worker_version bigint;settings_version bigint;
  item_keys text[]:=array['assignmentId','groupId','groupName','workerId','workerName','workerNo','employeeId','timeZone','startsOn','endsOn','createdAt','updatedAt','revision','status'];
begin
  if p is null or point_at is null or not isfinite(point_at) or not public.faolla_attendance_shift_rule_binding_object_v1(p,
    array['protocol','algorithmVersion','bindingPolicy','siteId','workerId','employeeId','employeeAuthUserId','workerVersion','settingsVersion','timeZone','assignment','enterprise','group','personal','fields'])
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p->'timeZone','zone') then return false;end if;
  worker_version:=(p->>'workerVersion')::bigint;settings_version:=(p->>'settingsVersion')::bigint;
  a:=p->'assignment';
  if a<>'null'::jsonb then
    if not public.faolla_attendance_shift_rule_binding_object_v1(a,array['detail','workerVersion','settingsVersion','groupRevision','fromAt','toAt','originalFromAt','originalToAt']) then return false;end if;
    foreach k in array array['workerVersion','settingsVersion','groupRevision'] loop
      if not public.faolla_attendance_shift_rule_binding_scalar_v1(a->k,'version') then return false;end if;
    end loop;
    if (a->>'workerVersion')::bigint>worker_version or (a->>'settingsVersion')::bigint>settings_version
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(a->'fromAt','stamp6') or a->'originalFromAt' is distinct from a->'fromAt'
      or (a->>'fromAt')::timestamptz>point_at then return false;end if;
    foreach k in array array['toAt','originalToAt'] loop
      if a->k<>'null'::jsonb and (not public.faolla_attendance_shift_rule_binding_scalar_v1(a->k,'stamp6')
        or (a->>k)::timestamptz<=(a->>'fromAt')::timestamptz) then return false;end if;
    end loop;
    if a->'toAt'<>'null'::jsonb and (a->>'toAt')::timestamptz<=point_at then return false;end if;
    d:=a->'detail';
    if not public.faolla_attendance_shift_rule_binding_object_v1(d,item_keys||array['history','canEnd','canCancel'])
      or jsonb_typeof(d->'history')<>'array' or jsonb_array_length(d->'history') not between 1 and 2
      or d->'revision' is distinct from to_jsonb(jsonb_array_length(d->'history')) or d->'canCancel' is distinct from 'true'::jsonb
      or d->'canEnd' is distinct from to_jsonb(d->>'status'='assigned' and d->'endsOn'='null'::jsonb)
      or d->'workerId' is distinct from p->'workerId' or d->'employeeId' is distinct from p->'employeeId'
      or (d->'endsOn'='null'::jsonb)<>(a->'toAt'='null'::jsonb) then return false;end if;
    n:=jsonb_array_length(d->'history');previous_item:=null;
    for i in 0..n-1 loop
      part:=d->'history'->i;item:=part->'item';cmd:=part->'command';
      if not public.faolla_attendance_shift_rule_binding_object_v1(part,array['command','item'])
        or not public.faolla_attendance_shift_rule_binding_object_v1(item,item_keys) then return false;end if;
      foreach k in array array['assignmentId','groupId','workerId','employeeId'] loop
        if not public.faolla_attendance_shift_rule_binding_scalar_v1(item->k,'uuid') then return false;end if;
      end loop;
      if not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'groupName','text80')
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'workerName','text120')
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'workerNo','text40')
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'timeZone','zone')
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'startsOn','date')
        or item->'endsOn'<>'null'::jsonb and (not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'endsOn','date') or item->>'endsOn'<item->>'startsOn')
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'createdAt','stamp6')
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'updatedAt','stamp6')
        or item->>'createdAt'>item->>'updatedAt' or date_trunc('milliseconds',(item->>'updatedAt')::timestamptz)>point_at
        or item->'revision' is distinct from to_jsonb(i+1)
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(cmd->'operationId','uuid')
        or not public.faolla_attendance_shift_rule_binding_scalar_v1(cmd->'reason','reason') then return false;end if;
      if i=0 then
        first_item:=item;
        if not public.faolla_attendance_shift_rule_binding_object_v1(cmd,array['operationId','action','reason','groupId','workerId','expectedGroupRevision','expectedWorkerVersion','expectedSettingsVersion','timeZone','startsOn','endsOn'])
          or cmd->>'action' is distinct from 'assign' or item->>'status' is distinct from 'assigned'
          or cmd->'operationId' is distinct from item->'assignmentId' or item->'createdAt' is distinct from item->'updatedAt'
          or cmd->'groupId' is distinct from item->'groupId' or cmd->'workerId' is distinct from item->'workerId'
          or cmd->'expectedGroupRevision' is distinct from a->'groupRevision' or cmd->'expectedWorkerVersion' is distinct from a->'workerVersion'
          or cmd->'expectedSettingsVersion' is distinct from a->'settingsVersion' or cmd->'timeZone' is distinct from item->'timeZone'
          or cmd->'startsOn' is distinct from item->'startsOn' or cmd->'endsOn' is distinct from item->'endsOn'
          or (item->'endsOn'='null'::jsonb)<>(a->'originalToAt'='null'::jsonb) then return false;end if;
      else
        if not public.faolla_attendance_shift_rule_binding_object_v1(cmd,array['operationId','action','reason','assignmentId','expectedRevision','endsOn'])
          or cmd->>'action' is distinct from 'end' or item->>'status' is distinct from 'ended'
          or cmd->'assignmentId' is distinct from first_item->'assignmentId' or cmd->'operationId'=first_item->'assignmentId'
          or cmd->'expectedRevision' is distinct from '1'::jsonb or cmd->'endsOn' is distinct from item->'endsOn'
          or first_item->'endsOn'<>'null'::jsonb or item->'endsOn'='null'::jsonb or item->>'updatedAt'<previous_item->>'updatedAt'
          or item-array['endsOn','updatedAt','revision','status'] is distinct from first_item-array['endsOn','updatedAt','revision','status'] then return false;end if;
      end if;
      previous_item:=item;
    end loop;
    if previous_item is distinct from d-array['history','canEnd','canCancel']
      or n=1 and a->'toAt' is distinct from a->'originalToAt' then return false;end if;
    if not public.faolla_attendance_shift_rule_binding_object_v1(p->'group',array['group','revision','publication']) then return false;end if;
    g:=p->'group'->'group';
    if not public.faolla_attendance_shift_rule_binding_object_v1(g,array['groupId','revision','name','description','active','createdAt','updatedAt'])
      or g->'groupId' is distinct from d->'groupId' or not public.faolla_attendance_shift_rule_binding_scalar_v1(g->'revision','version')
      or (g->>'revision')::bigint<(a->>'groupRevision')::bigint or g->'active' is distinct from 'true'::jsonb
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(g->'name','text80')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(g->'description','description')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(g->'createdAt','stamp6')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(g->'updatedAt','stamp6') or g->>'createdAt'>g->>'updatedAt' then return false;end if;
    group_revision:=(g->>'revision')::bigint;
  elsif p->'group'<>'null'::jsonb then return false;end if;
  foreach layer in array array['enterprise','group'] loop
    scope_item:=p->layer;if layer='group' and scope_item='null'::jsonb then continue;end if;
    if not public.faolla_attendance_shift_rule_binding_object_v1(scope_item,case when layer='group' then array['group','revision','publication'] else array['revision','publication'] end)
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(scope_item->'revision','head') then return false;end if;
    head:=(scope_item->>'revision')::bigint;item:=scope_item->'publication';if item='null'::jsonb then continue;end if;
    if not public.faolla_attendance_shift_rule_binding_object_v1(item,array['revision','operationId','actorId','action','reason','recordedAt','settingsVersion','groupRevision','timeZone','rules','effectiveOn','effectiveAt','publishedRevision'])
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'revision','version') or (item->>'revision')::bigint not between 2 and head
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'operationId','uuid') or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'actorId','uuid')
      or item->>'action' is distinct from 'publish' or item->'publishedRevision' is distinct from 'null'::jsonb
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'reason','reason')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'recordedAt','stamp6')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'settingsVersion','version') or (item->>'settingsVersion')::bigint>settings_version
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'timeZone','zone')
      or not public.faolla_attendance_rule_values_v1(item->'rules')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'effectiveOn','date')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'effectiveAt','stamp3')
      or (item->>'effectiveAt')::timestamptz>point_at or date_trunc('milliseconds',(item->>'recordedAt')::timestamptz)>point_at
      or (item->>'recordedAt')::timestamptz>=(item->>'effectiveAt')::timestamptz then return false;end if;
    if layer='enterprise' then
      if item->'groupRevision' is distinct from 'null'::jsonb then return false;end if;
    elsif not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'groupRevision','version') or (item->>'groupRevision')::bigint>group_revision then return false;end if;
  end loop;
  scope_item:=p->'personal';
  if not public.faolla_attendance_shift_rule_binding_object_v1(scope_item,array['revision','approval'])
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(scope_item->'revision','head') then return false;end if;
  head:=(scope_item->>'revision')::bigint;item:=scope_item->'approval';
  if item<>'null'::jsonb then
    if not public.faolla_attendance_shift_rule_binding_object_v1(item,array['revision','operationId','actorId','action','reason','recordedAt','employeeId','employeeAuthUserId','workerVersion','settingsVersion','timeZone','startsOn','endsOn','fromAt','toAt','rules','approvedRevision'])
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'revision','version') or (item->>'revision')::bigint>head
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'operationId','uuid') or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'actorId','uuid')
      or item->>'action' is distinct from 'approve' or item->'approvedRevision' is distinct from 'null'::jsonb
      or item->'employeeId' is distinct from p->'employeeId' or item->'employeeAuthUserId' is distinct from p->'employeeAuthUserId'
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'workerVersion','version') or (item->>'workerVersion')::bigint>worker_version
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'settingsVersion','version') or (item->>'settingsVersion')::bigint>settings_version
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'reason','reason')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'timeZone','zone')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'recordedAt','stamp6')
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'startsOn','date') or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'endsOn','date')
      or (item->>'endsOn')::date-(item->>'startsOn')::date not between 0 and 30
      or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'fromAt','stamp3') or not public.faolla_attendance_shift_rule_binding_scalar_v1(item->'toAt','stamp3')
      or (item->>'fromAt')::timestamptz>point_at or (item->>'toAt')::timestamptz<=point_at
      or date_trunc('milliseconds',(item->>'recordedAt')::timestamptz)>point_at
      or (item->>'recordedAt')::timestamptz>=(item->>'fromAt')::timestamptz
      or not public.faolla_attendance_rule_values_v1(item->'rules')
      or not exists(select 1 from jsonb_each(item->'rules') r where r.value->>'mode'<>'inherit') then return false;end if;
  end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then return false;
end;
$$;

create or replace function public.faolla_attendance_shift_rule_binding_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;wid uuid;eid uuid;s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  ev public.merchant_attendance_events%rowtype;b public.merchant_attendance_shift_rule_bindings%rowtype;a public.merchant_attendance_shift_rule_sources%rowtype;
  graph jsonb;source_item jsonb:=null;binding_item jsonb:=null;state_name text:='missing';reason_name text:='binding_missing';read_at timestamptz;result jsonb;
  stamp_format constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or not public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','workerId','startEventId'])
    or octet_length(convert_to(p_query::text,'UTF8'))>4096 or jsonb_typeof(p_query->'siteId')<>'string' or coalesce(p_query->>'siteId','')!~'^\d{8}$'
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'startEventId','uuid') then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;eid:=(p_query->>'startEventId')::uuid;
  --131/132 owner-read lock order. Read authorization is independent of activity,
  -- module pause, the historical author, and the original clock's request auth.
  perform 1 from public.merchants where id=site and user_id=p_auth_user_id for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for share;
  if not found then raise exception 'attendance_worker_not_found';end if;
  if w.employee_id is not null then select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;end if;
  if w.employee_id is null or e.id is null or e.auth_user_id is null then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
  select * into ev from public.merchant_attendance_events where merchant_id=site and worker_id=wid and id=eid;
  if ev.id is null or ev.action<>'clock_in' then raise exception 'attendance_shift_rule_binding_not_found';end if;
  if ev.actor_employee_id is distinct from w.employee_id then raise exception 'attendance_shift_rule_binding_identity_changed';end if;
  if not public.faolla_attendance_group_text_v1(w.display_name,1,120) or not public.faolla_attendance_group_text_v1(w.worker_no,1,40)
    or w.version not between 1 and 9007199254740990 or s.version not between 1 and 9007199254740990
    or ev.sequence not between 1 and 9007199254740990 or not isfinite(ev.occurred_at) or ev.break_paid is not null or ev.source not in('web','kiosk')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(ev.time_zone),'zone')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(ev.operation_id),'uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(ev.location_id),'uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(e.id),'uuid')
    or not public.faolla_attendance_shift_rule_binding_scalar_v1(to_jsonb(e.auth_user_id),'uuid') then raise exception 'attendance_shift_rule_binding_invalid';end if;
  select * into b from public.merchant_attendance_shift_rule_bindings where merchant_id=site and start_event_id=eid;
  if b.start_event_id is not null then
    -- Even an unverified stored binding cannot be disclosed under a replacement
    -- employee/Auth pairing. Missing means no saved historical Auth proof.
    if b.employee_id is distinct from w.employee_id or b.employee_auth_user_id is distinct from e.auth_user_id then
      raise exception 'attendance_shift_rule_binding_identity_changed';end if;
    if row(b.worker_id,b.operation_id,b.sequence,b.location_id,b.occurred_at,b.event_time_zone)
      is distinct from row(ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone)
      or b.algorithm_version<>'personal-group-enterprise-point-v1' or b.binding_policy<>'clock-in-whole-shift-v1'
      or not isfinite(b.recorded_at) or b.channel not in('self','location','pin','onsite')
      or (b.channel='pin')<>(ev.source='kiosk') or b.channel='pin' and b.request_auth_user_id is not null
      or b.channel<>'pin' and b.request_auth_user_id is distinct from e.auth_user_id
      or b.worker_version is not null and b.worker_version not between 1 and w.version
      or b.settings_version is not null and b.settings_version not between 1 and s.version then raise exception 'attendance_shift_rule_binding_invalid';end if;
    state_name:=b.status;reason_name:=b.reason;
    if b.status='verified' then
      if b.reason is not null or b.source_id is null or b.worker_version is null or b.settings_version is null or b.recorded_at<ev.occurred_at then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      select * into a from public.merchant_attendance_shift_rule_sources where merchant_id=site and source_id=b.source_id and worker_id=wid;
      if a.source_id is null or not isfinite(a.created_at) or a.created_at>b.recorded_at
        or public.faolla_attendance_shift_rule_source_valid_v1(a.source_text,site,wid,a.source_sha256,a.source_bytes) is distinct from true then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
      graph:=a.source_text::jsonb;
      if graph->>'employeeId' is distinct from b.employee_id::text or graph->>'employeeAuthUserId' is distinct from b.employee_auth_user_id::text
        or graph->'workerVersion' is distinct from to_jsonb(b.worker_version) or graph->'settingsVersion' is distinct from to_jsonb(b.settings_version)
        or not public.faolla_attendance_shift_rule_binding_graph_v1(graph,ev.occurred_at) then raise exception 'attendance_shift_rule_binding_invalid';end if;
      -- The original text is returned unchanged. Dedup source_id may belong to
      -- an earlier clock-in; corporate graph zone may differ from event zone.
      source_item:=jsonb_build_object('sourceId',a.source_id,'sourceText',a.source_text,'sourceSha256',a.source_sha256,'sourceBytes',a.source_bytes,'canonicalFormat','pg-jsonb-text-utf8-v1');
    elsif b.status='unverified' then
      if b.source_id is not null or b.reason is null or b.reason not in('source_unavailable','source_invalid','source_conflict','identity_unavailable','identity_changed',
        'inactive_worker','inactive_employee','invalid_date','assignment_overlap','inactive_group','personal_overlap','source_cap','source_quota','source_too_large') then
        raise exception 'attendance_shift_rule_binding_invalid';end if;
    else raise exception 'attendance_shift_rule_binding_invalid';end if;
    binding_item:=jsonb_build_object('channel',b.channel,'requestAuthUserId',b.request_auth_user_id,'employeeId',b.employee_id,'employeeAuthUserId',b.employee_auth_user_id,
      'workerVersion',b.worker_version,'settingsVersion',b.settings_version,'algorithmVersion',b.algorithm_version,'bindingPolicy',b.binding_policy,
      'recordedAt',to_char(b.recorded_at at time zone 'UTC',stamp_format),'source',source_item);
  end if;
  read_at:=clock_timestamp();
  if read_at<ev.occurred_at or b.recorded_at is not null and read_at<b.recorded_at then raise exception 'attendance_shift_rule_binding_invalid';end if;
  result:=jsonb_build_object('protocol','shift-rule-binding-v1','readOnly',true,'formalReady',false,'siteId',site,'actorId',p_auth_user_id,
    'worker',jsonb_build_object('workerId',w.id,'workerName',w.display_name,'workerNo',w.worker_no,'employeeId',w.employee_id,'employeeAuthUserId',e.auth_user_id,'version',w.version,'active',w.active,'employeeActive',e.status='active'),
    'event',jsonb_build_object('startEventId',ev.id,'operationId',ev.operation_id,'sequence',ev.sequence,'locationId',ev.location_id,'occurredAt',to_char(ev.occurred_at at time zone 'UTC',stamp_format),'timeZone',ev.time_zone,'source',ev.source,'employeeId',ev.actor_employee_id),
    'status',state_name,'reason',reason_name,'binding',binding_item,'readAt',to_char(read_at at time zone 'UTC',stamp_format));
  --64KiB source text plus JSON escaping and fixed metadata, not more sources.
  if octet_length(convert_to(result::text,'UTF8'))>262144 then raise exception 'attendance_shift_rule_binding_invalid';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
  raise exception 'attendance_shift_rule_binding_invalid';
end;
$$;
revoke all on function public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[]),
  public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text),public.faolla_attendance_shift_rule_binding_graph_v1(jsonb,timestamptz),
  public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid) to service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040135,'merchant_attendance_shift_rule_binding_reader') on conflict(version) do nothing;
do $shift_rule_reader_postconditions$
declare p regprocedure;r text;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040135 and name='merchant_attendance_shift_rule_binding_reader') then
    raise exception 'merchant_attendance_shift_rule_binding_reader_registry_postcondition_failed';end if;
  foreach p in array array['public.faolla_attendance_shift_rule_binding_object_v1(jsonb,text[])'::regprocedure,
    'public.faolla_attendance_shift_rule_binding_scalar_v1(jsonb,text)'::regprocedure,
    'public.faolla_attendance_shift_rule_binding_graph_v1(jsonb,timestamptz)'::regprocedure,'public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid)'::regprocedure] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p,'EXECUTE') is distinct from (r='service_role' and p='public.faolla_attendance_shift_rule_binding_v1(jsonb,uuid)'::regprocedure) then
        raise exception 'merchant_attendance_shift_rule_binding_reader_acl_postcondition_failed';end if;
    end loop;
    if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where f.oid=p and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'merchant_attendance_shift_rule_binding_reader_acl_postcondition_failed';end if;
  end loop;
end;
$shift_rule_reader_postconditions$;
notify pgrst, 'reload schema';
commit;
