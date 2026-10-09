-- Complete, bounded single-worker period source. No archive/write policy lives
-- here. The worker UPDATE lock is acquired BEFORE all old readers; it also
-- fences147's SHARE-locked notes/new cases. No lock upgrade after sampling.
begin;
set local lock_timeout='3s';

do $period_source_prerequisites$
declare installed boolean;dependency record;signature text;
begin
  if to_regclass('public.faolla_schema_migrations') is null then raise exception 'merchant_attendance_period_source_prerequisite_required';end if;
  for dependency in select * from (values
    (202610010093::bigint,'merchant_attendance_versioned_reports'),
    (202610010103::bigint,'merchant_attendance_missing_revisions'),
    (202610030116::bigint,'merchant_attendance_self_revision_history'),
    (202610030122::bigint,'merchant_attendance_leave_requests'),
    (202610030123::bigint,'merchant_attendance_calendar'),
    (202610040135::bigint,'merchant_attendance_shift_rule_binding_reader'),
    (202610050144::bigint,'merchant_attendance_self_schedule_adoption'),
    (202610050146::bigint,'merchant_attendance_plan_exception_source'),
    (202610050147::bigint,'merchant_attendance_plan_exception_review')) required(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then
      raise exception 'merchant_attendance_period_source_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610050148 and name='merchant_attendance_period_source') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610050148 and name<>'merchant_attendance_period_source') then
    raise exception 'merchant_attendance_period_source_installation_conflict';end if;
  foreach signature in array array[
    'public.faolla_attendance_period_plan_rule_v1(text,uuid,uuid,uuid,uuid,uuid)',
    'public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamp with time zone)',
    'public.faolla_attendance_period_canonical_v1(jsonb)',
    'public.faolla_attendance_period_source_v1(jsonb,uuid)'] loop
    if installed<>(to_regprocedure(signature) is not null) then raise exception 'merchant_attendance_period_source_installation_conflict';end if;
  end loop;
end;
$period_source_prerequisites$;

-- PRIVATE fixed operation lookup, never owner impersonation or automatic rule
-- adoption. Callers choose either the held stream head or an immutable sidecar
-- reference explicitly; a subsequent head cannot replace that fixed reference.
create or replace function public.faolla_attendance_period_plan_rule_v1(p_site text,p_worker uuid,p_slot uuid,p_employee uuid,p_member_auth uuid,p_operation uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare op public.merchant_attendance_plan_rule_operations%rowtype;artifact public.merchant_attendance_plan_rule_artifacts%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;slot_item jsonb;layer text;part jsonb;
  w public.merchant_attendance_workers%rowtype;s public.merchant_attendance_settings%rowtype;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_operation is null then return null;end if;
  select * into op from public.merchant_attendance_plan_rule_operations x where x.merchant_id=p_site and x.operation_id=p_operation;
  select * into artifact from public.merchant_attendance_plan_rule_artifacts x where x.merchant_id=p_site and x.source_id=op.source_id;
  select * into slot_row from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site and x.id=p_slot;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.id=p_worker;
  select * into s from public.merchant_attendance_settings x where x.merchant_id=p_site;
  if op.operation_id is null or slot_row.id is null or slot_row.worker_id is distinct from p_worker or slot_row.employee_id is distinct from p_employee
    or row(op.worker_id,op.slot_id,op.employee_id,op.employee_auth_user_id) is distinct from row(p_worker,p_slot,p_employee,p_member_auth)
    or row(artifact.worker_id,artifact.slot_id,artifact.employee_id,artifact.employee_auth_user_id) is distinct from row(p_worker,p_slot,p_employee,p_member_auth) then
    raise exception 'attendance_period_source_identity_changed';end if;
  slot_item:=public.faolla_attendance_self_schedule_slot_v1(slot_row)->'slot';
  if artifact.source_id is null or public.faolla_attendance_plan_rule_command_v1(op.command) is distinct from true
    or op.command->>'operationId' is distinct from op.operation_id::text or op.command->'expectedRevision' is distinct from to_jsonb(op.revision-1)
    or op.command->>'employeeId' is distinct from p_employee::text or op.command->>'employeeAuthUserId' is distinct from p_member_auth::text
    or op.command->>'expectedFingerprint' is distinct from artifact.source_sha256
    or artifact.source_sha256 is distinct from encode(sha256(convert_to(artifact.source::text,'UTF8')),'hex')
    or artifact.source_bytes is distinct from octet_length(convert_to(artifact.source::text,'UTF8'))
    or public.faolla_attendance_plan_rule_source_v1(artifact.source) is distinct from true
    or op.observed_at>op.recorded_at or op.recorded_at>=slot_row.start_at
    or artifact.source->'slot'->>'id' is distinct from p_slot::text or artifact.source->'slot'->>'revision' is distinct from slot_row.revision::text
    or artifact.source->'slot'->'startAt' is distinct from slot_item->'startAt' or artifact.source->'slot'->'endAt' is distinct from slot_item->'endAt'
    or artifact.source->'slot'->'locationId' is distinct from slot_item->'locationId' or artifact.source->'slot'->'timeZone' is distinct from slot_item->'timeZone'
    or artifact.source->>'siteId' is distinct from p_site or artifact.source->>'workerId' is distinct from p_worker::text
    or artifact.source->>'employeeId' is distinct from p_employee::text or artifact.source->>'employeeAuthUserId' is distinct from p_member_auth::text
    or (artifact.source->>'workerVersion')::bigint>w.version or (artifact.source->>'settingsVersion')::bigint>s.version then raise exception 'attendance_period_source_invalid';end if;
  foreach layer in array array['personal','group','enterprise'] loop
    part:=case when layer='personal' then artifact.source->layer->'approval' else artifact.source->layer->'publication' end;
    if part is not null and part<>'null'::jsonb and (part->>'recordedAt')::timestamptz>op.observed_at then raise exception 'attendance_period_source_invalid';end if;
  end loop;
  return jsonb_build_object('operationId',op.operation_id,'revision',op.revision,'actorId',op.actor_auth_user_id,'command',op.command,
    'observedAt',to_char(op.observed_at at time zone 'UTC',fmt),'recordedAt',to_char(op.recorded_at at time zone 'UTC',fmt),
    'sourceId',artifact.source_id,'sourceSha256',artifact.source_sha256,'sourceBytes',artifact.source_bytes,'source',artifact.source);
end;
$$;

-- PRIVATE: only the authorized outer collector supplies these identity values,
-- under merchant/settings/worker/employee locks. No owner impersonation. Unlike
-- the old scoped report, a mixed/unproven historical identity is never omitted.
create or replace function public.faolla_attendance_period_session_v1(p_site text,p_worker uuid,p_start uuid,p_employee uuid,p_member_auth uuid,p_observed timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare
  first_event public.merchant_attendance_events%rowtype;ev public.merchant_attendance_events%rowtype;
  candidates public.merchant_attendance_events[];events jsonb:='[]';n integer:=0;previous_sequence bigint;previous_at timestamptz;state_name text:='off';last_id uuid;
  b public.merchant_attendance_shift_rule_bindings%rowtype;a public.merchant_attendance_shift_rule_sources%rowtype;
  rel public.merchant_attendance_shift_schedule_relations%rowtype;sidecar public.merchant_attendance_shift_plan_adoptions%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  request_row public.merchant_attendance_correction_entries%rowtype;revision_row public.merchant_attendance_revision_requests%rowtype;
  w public.merchant_attendance_workers%rowtype;s public.merchant_attendance_settings%rowtype;
  binding jsonb:=null;source_item jsonb:=null;graph jsonb;relation jsonb:=null;adoption jsonb:=null;slot_context jsonb;effect_item jsonb:=null;plan_rule jsonb:=null;
  expected_reason text;current_cancelled boolean:=null;proof boolean:=false;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  select * into first_event from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=p_worker and x.id=p_start;
  if first_event.id is null or first_event.action<>'clock_in' or first_event.actor_employee_id is distinct from p_employee
    or p_member_auth is null then raise exception 'attendance_period_source_identity_changed';end if;
  if first_event.sequence>1 and not exists(select 1 from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=p_worker
    and x.sequence=first_event.sequence-1 and x.action='clock_out') then raise exception 'attendance_period_source_invalid';end if;
  select * into w from public.merchant_attendance_workers x where x.merchant_id=p_site and x.id=p_worker;
  select * into s from public.merchant_attendance_settings x where x.merchant_id=p_site;
  select * into b from public.merchant_attendance_shift_rule_bindings x where x.merchant_id=p_site and x.start_event_id=p_start;
  if b.start_event_id is not null then
    if b.employee_id is distinct from p_employee or b.employee_auth_user_id is distinct from p_member_auth then
      raise exception 'attendance_period_source_identity_changed';end if;
    if row(b.worker_id,b.operation_id,b.sequence,b.location_id,b.occurred_at,b.event_time_zone)
      is distinct from row(p_worker,first_event.operation_id,first_event.sequence,first_event.location_id,first_event.occurred_at,first_event.time_zone)
      or b.algorithm_version<>'personal-group-enterprise-point-v1' or b.binding_policy<>'clock-in-whole-shift-v1'
      or not isfinite(b.recorded_at) or b.recorded_at>p_observed or (b.channel='pin')<>(first_event.source='kiosk')
      or b.channel='pin' and b.request_auth_user_id is not null or b.channel<>'pin' and b.request_auth_user_id is distinct from p_member_auth
      or b.worker_version is not null and b.worker_version not between 1 and w.version
      or b.settings_version is not null and b.settings_version not between 1 and s.version then raise exception 'attendance_period_source_invalid';end if;
    if b.status='verified' then
      select * into a from public.merchant_attendance_shift_rule_sources x where x.merchant_id=p_site and x.worker_id=p_worker and x.source_id=b.source_id;
      if a.source_id is null or a.created_at>b.recorded_at or b.recorded_at<first_event.occurred_at
        or public.faolla_attendance_shift_rule_source_valid_v1(a.source_text,p_site,p_worker,a.source_sha256,a.source_bytes) is distinct from true then
        raise exception 'attendance_period_source_invalid';end if;
      graph:=a.source_text::jsonb;
      if graph->>'employeeId' is distinct from p_employee::text or graph->>'employeeAuthUserId' is distinct from p_member_auth::text
        or graph->'workerVersion' is distinct from to_jsonb(b.worker_version) or graph->'settingsVersion' is distinct from to_jsonb(b.settings_version)
        or public.faolla_attendance_shift_rule_binding_graph_v1(graph,first_event.occurred_at) is distinct from true then raise exception 'attendance_period_source_invalid';end if;
      source_item:=jsonb_build_object('sourceId',a.source_id,'sourceText',a.source_text,'sourceSha256',a.source_sha256,'sourceBytes',a.source_bytes,'canonicalFormat','pg-jsonb-text-utf8-v1');
    elsif b.status<>'unverified' or b.source_id is not null or b.reason is null then raise exception 'attendance_period_source_invalid';end if;
    binding:=jsonb_build_object('status',b.status,'reason',b.reason,'channel',b.channel,'employeeId',b.employee_id,'employeeAuthUserId',b.employee_auth_user_id,
      'workerVersion',b.worker_version,'settingsVersion',b.settings_version,'algorithmVersion',b.algorithm_version,'bindingPolicy',b.binding_policy,
      'recordedAt',to_char(b.recorded_at at time zone 'UTC',fmt),'source',source_item);proof:=true;
  end if;
  select * into rel from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=p_site and x.start_event_id=p_start;
  select * into sidecar from public.merchant_attendance_shift_plan_adoptions x where x.merchant_id=p_site and x.start_event_id=p_start;
  if rel.start_event_id is not null then
    if rel.employee_id is distinct from p_employee or rel.employee_auth_user_id is distinct from p_member_auth then raise exception 'attendance_period_source_identity_changed';end if;
    if row(rel.worker_id,rel.operation_id,rel.sequence,rel.location_id,rel.occurred_at,rel.event_time_zone)
      is distinct from row(p_worker,first_event.operation_id,first_event.sequence,first_event.location_id,first_event.occurred_at,first_event.time_zone)
      or rel.binding_policy<>'employee-explicit-clock-in-v1' or rel.recorded_at>p_observed then raise exception 'attendance_period_source_invalid';end if;
    if rel.selection is not null then
      select * into slot_row from public.merchant_attendance_schedule_slots x where x.merchant_id=p_site and x.id=rel.slot_id;
      if slot_row.id is null or slot_row.worker_id<>p_worker or slot_row.employee_id<>p_employee or slot_row.revision<>rel.slot_revision
        or rel.selection is distinct from jsonb_build_object('slotId',slot_row.id,'revision',slot_row.revision) then raise exception 'attendance_period_source_invalid';end if;
      slot_context:=public.faolla_attendance_self_schedule_slot_v1(slot_row);
      if (rel.slot_snapshot-'cancelled') is distinct from ((slot_context->'slot')-'cancelled')
        or rel.publication_snapshot is distinct from nullif(slot_context->'publication','null'::jsonb) then raise exception 'attendance_period_source_invalid';end if;
      if slot_context->'publication'->>'employeeAuthUserId' is not null and slot_context->'publication'->>'employeeAuthUserId'<>p_member_auth::text then
        raise exception 'attendance_period_source_identity_changed';end if;
      current_cancelled:=(slot_context->'slot'->>'cancelled')::boolean;
      if (rel.slot_snapshot->>'cancelled')::boolean then
        if not current_cancelled or rel.cancellation_snapshot is distinct from nullif(slot_context->'cancellation','null'::jsonb)
          or (slot_context->'cancellation'->>'revision')::bigint>rel.schedule_revision then raise exception 'attendance_period_source_invalid';end if;
      elsif rel.cancellation_snapshot is not null or current_cancelled and (slot_context->'cancellation'->>'revision')::bigint<=rel.schedule_revision then
        raise exception 'attendance_period_source_invalid';end if;
      expected_reason:=case when (rel.slot_snapshot->>'cancelled')::boolean then 'cancelled' when slot_row.location_id<>first_event.location_id then 'location_changed'
        when rel.reason='outside_window' then 'outside_window' when not(slot_context->'slot'->>'hasPublicationEvidence')::boolean then 'publication_missing' else null end;
      if rel.reason is distinct from expected_reason or rel.status is distinct from (case when expected_reason is null then 'linked' else 'unverified' end) then raise exception 'attendance_period_source_invalid';end if;
    elsif rel.status<>'unselected' or rel.reason is not null or rel.slot_id is not null or rel.slot_snapshot is not null
      or rel.publication_snapshot is not null or rel.cancellation_snapshot is not null then raise exception 'attendance_period_source_invalid';end if;
    relation:=jsonb_build_object('startEventId',rel.start_event_id,'operationId',rel.operation_id,'selection',rel.selection,'status',rel.status,'reason',rel.reason,
      'slot',rel.slot_snapshot,'observedRevision',rel.schedule_revision,'recordedAt',to_char(rel.recorded_at at time zone 'UTC',fmt),'currentCancelled',current_cancelled);
    if sidecar.start_event_id is not null then
      if row(sidecar.worker_id,sidecar.operation_id,sidecar.employee_id,sidecar.employee_auth_user_id,sidecar.slot_id,sidecar.recorded_at)
        is distinct from row(rel.worker_id,rel.operation_id,rel.employee_id,rel.employee_auth_user_id,rel.slot_id,rel.recorded_at) then raise exception 'attendance_period_source_invalid';end if;
      adoption:=public.faolla_attendance_shift_plan_adoption_v1(rel,p_member_auth,sidecar.approval_operation_id,false,sidecar.channel);
      if sidecar.adoption is distinct from adoption then raise exception 'attendance_period_source_invalid';end if;
      plan_rule:=public.faolla_attendance_period_plan_rule_v1(p_site,p_worker,rel.slot_id,p_employee,p_member_auth,sidecar.approval_operation_id);
    else
      -- Legacy137 has no sidecar. It still has a precise self-only receipt proof;
      -- do not invent retrospective adoption or accept a source string as proof.
      perform public.faolla_attendance_self_schedule_receipt_v1(rel,p_member_auth);
    end if;
    proof:=true;
  elsif sidecar.start_event_id is not null then raise exception 'attendance_period_source_invalid';end if;
  if not proof then raise exception 'attendance_period_source_identity_unproven';end if;
  candidates:=array(select x from public.merchant_attendance_events x where x.merchant_id=p_site and x.worker_id=p_worker
    and x.sequence>=first_event.sequence order by x.sequence limit 2003);
  previous_sequence:=first_event.sequence-1;previous_at:=first_event.occurred_at;
  foreach ev in array candidates loop
    n:=n+1;if n>2002 then raise exception 'attendance_period_source_too_large';end if;
    if ev.actor_employee_id is distinct from p_employee then raise exception 'attendance_period_source_identity_changed';end if;
    if ev.sequence<>previous_sequence+1 or ev.occurred_at<previous_at or ev.occurred_at>p_observed or not isfinite(ev.occurred_at)
      or ev.source not in('web','kiosk') or ev.break_paid is null and ev.action='break_start' or ev.break_paid is not null and ev.action<>'break_start' then
      raise exception 'attendance_period_source_invalid';end if;
    if n=1 and ev.action='clock_in' then state_name:='working';
    elsif ev.action='break_start' and state_name='working' then state_name:='break';
    elsif ev.action='break_end' and state_name='break' then state_name:='working';
    elsif ev.action='clock_out' and state_name='working' then state_name:='completed';
    else raise exception 'attendance_period_source_invalid';end if;
    events:=events||jsonb_build_array(jsonb_build_object('id',ev.id,'locationId',ev.location_id,'sequence',ev.sequence,'action',ev.action,
      'occurredAt',to_char(ev.occurred_at at time zone 'UTC',fmt),'timeZone',ev.time_zone,'breakPaid',ev.break_paid,'source',ev.source));
    previous_sequence:=ev.sequence;previous_at:=ev.occurred_at;last_id:=ev.id;
    exit when state_name='completed';
  end loop;
  if state_name<>'completed' and not exists(select 1 from (select x.id from public.merchant_attendance_events x
    where x.merchant_id=p_site and x.worker_id=p_worker order by x.sequence desc limit 1) tail where tail.id=last_id) then raise exception 'attendance_period_source_invalid';end if;
  select * into eff from public.merchant_attendance_effect_current_v2 x where x.merchant_id=p_site and x.worker_id=p_worker and x.start_event_id=p_start;
  if eff.request_id is not null then
    if state_name<>'completed' or eff.employee_id is distinct from p_employee or eff.original_last_event_id is distinct from last_id::text then raise exception 'attendance_period_source_invalid';end if;
    select * into request_row from public.merchant_attendance_correction_entries x where x.merchant_id=p_site and x.operation_id=eff.root_request_id and x.action='submit';
    if request_row.start_event_id is distinct from p_start or request_row.worker_id is distinct from p_worker
      or request_row.employee_id is distinct from p_employee or request_row.actor_auth_user_id is distinct from p_member_auth then raise exception 'attendance_period_source_identity_changed';end if;
    if eff.revision>1 then
      select * into revision_row from public.merchant_attendance_revision_requests x where x.merchant_id=p_site and x.operation_id=eff.request_id and x.action='submit';
      if revision_row.worker_id is distinct from p_worker or revision_row.employee_id is distinct from p_employee
        or revision_row.actor_auth_user_id is distinct from p_member_auth or revision_row.base_request_id is distinct from eff.root_request_id then raise exception 'attendance_period_source_identity_changed';end if;
    end if;
    effect_item:=public.faolla_attendance_effect_evidence_v2(eff,p_observed);
  end if;
  return jsonb_build_object('item',jsonb_build_object('startEventId',p_start,'events',events,'effect',effect_item),'ruleBinding',binding,'relation',relation,'adoption',adoption,'planRuleApproval',plan_rule);
end;
$$;

-- A whitelist of observation/access-only fields, NOT a recursive deletion of
-- arbitrary timestamps. recordedAt/submittedAt, private identity and lineage stay.
create or replace function public.faolla_attendance_period_canonical_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare base jsonb;report jsonb;item jsonb;items jsonb:='[]';missing jsonb:='[]';events jsonb;
begin
  base:=(p->'report'->'base')-array['asOf','access','viewerEmployeeId','scopeRevision','locationId','coverage','accessValidUntil'];
  for item in select value from jsonb_array_elements(base->'items') loop
    select coalesce(jsonb_agg(value-'actorEmployeeId' order by ord),'[]'::jsonb) into events from jsonb_array_elements(item->'events') with ordinality t(value,ord);
    items:=items||jsonb_build_array(jsonb_set(item,'{events}',events));
  end loop;
  base:=jsonb_set(base,'{items}',items);
  for item in select value from jsonb_array_elements(p->'report'->'missing') loop
    missing:=missing||jsonb_build_array(jsonb_set(item,'{employeeId}',p->'employeeId'));
  end loop;
  report:=((p->'report')-'access')||jsonb_build_object('base',base,'missing',missing);
  return jsonb_build_object('sourceVersion',p->'sourceVersion','siteId',p->'siteId','workerId',p->'workerId','employeeId',p->'employeeId',
    'employeeAuthUserId',p->'employeeAuthUserId','timeZone',p->'timeZone','fromDate',p->'fromDate','throughDate',p->'throughDate',
    'fromAt',p->'fromAt','toAt',p->'toAt','dayBoundaries',p->'dayBoundaries','report',report,'context',p->'context');
end;
$$;

create or replace function public.faolla_attendance_period_source_v1(p_query jsonb,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  site text;wid uuid;access_name text;first_day date;last_day date;range_from timestamptz;range_to timestamptz;observed timestamptz;read_at timestamptz;
  s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;emp public.merchant_enterprise_employees%rowtype;role_row public.merchant_enterprise_roles%rowtype;
  report jsonb;base jsonb;result jsonb;canonical jsonb;source_text text;day_items jsonb:='[]';d date;a timestamptz;b timestamptz;
  item jsonb;child jsonb;summary jsonb;context jsonb;plans jsonb:='[]';sessions jsonb:='[]';reviews jsonb:='[]';leaves jsonb:='[]';calendars jsonb:='[]';missing jsonb:='[]';pending jsonb:='[]';
  flags text[]:='{}';blockers jsonb;ids uuid[];other_ids uuid[];root_ids uuid[];candidate_ids uuid[];session_ids uuid[]:='{}';report_ids uuid[]:='{}';place_ids uuid[]:='{}';place uuid;target_id uuid;
  ev public.merchant_attendance_events%rowtype;endpoint public.merchant_attendance_events%rowtype;eff public.merchant_attendance_effect_current_v2%rowtype;
  slot_row public.merchant_attendance_schedule_slots%rowtype;relation_row public.merchant_attendance_shift_schedule_relations%rowtype;
  leave_row public.merchant_attendance_leave_requests%rowtype;leave_op public.merchant_attendance_leave_entries%rowtype;
  calendar_row public.merchant_attendance_calendar_entries%rowtype;calendar_op public.merchant_attendance_calendar_operations%rowtype;
  missing_row public.merchant_attendance_missing_requests%rowtype;missing_first public.merchant_attendance_missing_entries%rowtype;missing_op public.merchant_attendance_missing_entries%rowtype;
  correction_row public.merchant_attendance_correction_entries%rowtype;correction_tail public.merchant_attendance_correction_entries%rowtype;
  revision_row public.merchant_attendance_revision_requests%rowtype;revision_tail public.merchant_attendance_revision_requests%rowtype;root_effect public.merchant_attendance_correction_effects%rowtype;
  case_row public.merchant_attendance_plan_exception_cases%rowtype;review_head public.merchant_attendance_plan_exception_entries%rowtype;
  rule_stream public.merchant_attendance_plan_rule_streams%rowtype;rule_operation public.merchant_attendance_plan_rule_operations%rowtype;current_approval jsonb;
  decision_row public.merchant_attendance_plan_exception_entries%rowtype;note_row public.merchant_attendance_plan_exception_entries%rowtype;read_row public.merchant_attendance_plan_exception_reads%rowtype;
  current_source jsonb;status_name text;bounds jsonb:='{}';cache_key text;boundary_date date;total_events integer:=0;expected_report_count integer:=0;
  fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,array['siteId','access','workerId','fromDate','throughDate']) is distinct from true
    or p_auth_user_id is null or coalesce(p_query->>'siteId','')!~'^\d{8}$' or jsonb_typeof(p_query->'siteId')<>'string'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self') or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'workerId','uuid') is distinct from true
    or public.faolla_attendance_group_date_v1(p_query->>'fromDate') is distinct from true or public.faolla_attendance_group_date_v1(p_query->>'throughDate') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';wid:=(p_query->>'workerId')::uuid;access_name:=p_query->>'access';first_day:=(p_query->>'fromDate')::date;last_day:=(p_query->>'throughDate')::date;
  if last_day-first_day not between 0 and 30 then raise exception 'attendance_invalid_request';end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for share;
  -- First match self without locks to avoid locking another person's worker;
  -- recheck the authenticated identity under the employee lock below.
  if access_name='self' and not exists(select 1 from public.merchant_attendance_workers x join public.merchant_enterprise_employees e
    on e.merchant_id=x.merchant_id and e.id=x.employee_id where x.merchant_id=site and x.id=wid and e.auth_user_id=p_auth_user_id) then raise exception 'attendance_access_denied';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=wid for update;
  if not found then raise exception 'attendance_worker_not_found';end if;
  select * into emp from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  if emp.id is null or emp.auth_user_id is null then raise exception 'attendance_period_source_identity_changed';end if;
  if access_name='self' then
    if emp.auth_user_id<>p_auth_user_id or emp.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into role_row from public.merchant_enterprise_roles where merchant_id=site and id=emp.role_id for share;
    if role_row.status is distinct from 'active' or public.faolla_valid_merchant_enterprise_permissions_v1(role_row.permissions) is distinct from true
      or not('enterprise.view'=any(role_row.permissions)) or not('attendance.self.view'=any(role_row.permissions)) then raise exception 'attendance_access_denied';end if;
  end if;
  if s.merchant_id is null then raise exception 'attendance_settings_required';end if;
  report:=public.faolla_attendance_unified_report_v1(site,p_auth_user_id,case when access_name='owner' then
    jsonb_build_object('access','owner','workerId',wid,'fromDate',first_day,'throughDate',last_day) else
    jsonb_build_object('access','self','workerId',null,'locationId',null,'expectedWorkerId',wid,'fromDate',first_day,'throughDate',last_day) end);
  base:=report->'base';range_from:=(base->>'fromAt')::timestamptz;range_to:=(base->>'toAt')::timestamptz;observed:=(base->>'asOf')::timestamptz;
  if base->>'siteId' is distinct from site or base->>'workerId' is distinct from wid::text or base->>'employeeId' is distinct from emp.id::text
    or report->>'access' is distinct from access_name or report->>'complete' is distinct from 'true' or base->>'complete' is distinct from 'true'
    or report->>'payrollReady' is distinct from 'false' then raise exception 'attendance_period_source_invalid';end if;
  if range_to>observed then flags:=array_append(flags,'period_in_progress');end if;
  for d in select generate_series(first_day::timestamp,last_day::timestamp,interval '1 day')::date loop
    a:=public.faolla_attendance_control_day_boundary_v1(d,s.time_zone);b:=public.faolla_attendance_control_day_boundary_v1(d+1,s.time_zone);
    day_items:=day_items||jsonb_build_array(jsonb_build_object('date',d,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),'skipped',a=b));
  end loop;
  -- Mirror the unfiltered owner candidate set. The scoped reader may silently
  -- omit a mixed-identity session; compare the complete private set explicitly.
  candidate_ids:=array(with inside as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at>=range_from and x.occurred_at<range_to order by x.occurred_at,x.sequence limit 101),
    preceding as(select x.id from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.action='clock_in'
      and x.occurred_at<range_from order by x.occurred_at desc,x.sequence desc limit 1),
    moved as(select x.start_event_id id from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid
      and x.start_at>=range_from-interval '744 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.start_event_id limit 101)
    select id from (select id from inside union select id from preceding union select id from moved) all_candidates order by id limit 101);
  if cardinality(candidate_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for ev in select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.id=any(candidate_ids) order by x.sequence loop
    select * into endpoint from (select x.* from public.merchant_attendance_events x where x.merchant_id=site and x.worker_id=wid and x.sequence>=ev.sequence order by x.sequence limit 2003) tail
      where tail.action='clock_out' order by tail.sequence limit 1;
    select * into eff from public.merchant_attendance_effect_current_v2 x where x.merchant_id=site and x.worker_id=wid and x.start_event_id=ev.id;
    if not(ev.occurred_at<range_to and (ev.occurred_at>=range_from or coalesce(endpoint.occurred_at,observed)>range_from))
      and not(coalesce(eff.start_at<range_to and eff.end_at>range_from,false)) then continue;end if;
    child:=public.faolla_attendance_period_session_v1(site,wid,ev.id,emp.id,emp.auth_user_id,observed);
    if not exists(select 1 from jsonb_array_elements(base->'items') x where x.value->>'startEventId'=ev.id::text) then raise exception 'attendance_period_source_identity_changed';end if;
    expected_report_count:=expected_report_count+1;report_ids:=array_append(report_ids,ev.id);session_ids:=array_append(session_ids,ev.id);sessions:=sessions||jsonb_build_array(child);
    total_events:=total_events+jsonb_array_length(child->'item'->'events');
    if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
  end loop;
  if expected_report_count<>jsonb_array_length(base->'items') or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;

  -- Full original plan membership, including cancelled plans and associations
  -- whose original/latest endpoints moved outside this period. No auto matching.
  ids:=array(select x.id from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for slot_row in select x.* from public.merchant_attendance_schedule_slots x where x.merchant_id=site and x.id=any(ids) order by x.id loop
    if slot_row.end_at<=range_from then continue;end if;
    if slot_row.employee_id<>emp.id then raise exception 'attendance_period_source_identity_changed';end if;
    item:=public.faolla_attendance_self_schedule_slot_v1(slot_row);
    if item->'publication'->>'employeeAuthUserId' is null then raise exception 'attendance_period_source_identity_unproven';end if;
    if item->'publication'->>'employeeId' is distinct from emp.id::text or item->'publication'->>'employeeAuthUserId' is distinct from emp.auth_user_id::text then
      raise exception 'attendance_period_source_identity_changed';end if;
    current_approval:=null;
    select * into rule_stream from public.merchant_attendance_plan_rule_streams x where x.merchant_id=site and x.slot_id=slot_row.id;
    if rule_stream.slot_id is not null then
      if row(rule_stream.worker_id,rule_stream.employee_id,rule_stream.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
      select * into rule_operation from public.merchant_attendance_plan_rule_operations x where x.merchant_id=site and x.slot_id=slot_row.id and x.revision=rule_stream.revision;
      if rule_operation.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
      current_approval:=public.faolla_attendance_period_plan_rule_v1(site,wid,slot_row.id,emp.id,emp.auth_user_id,rule_operation.operation_id);
    end if;
    plans:=plans||jsonb_build_array(item||jsonb_build_object('currentApproval',current_approval));
    other_ids:=array(select x.start_event_id from public.merchant_attendance_shift_schedule_relations x where x.merchant_id=site and x.slot_id=slot_row.id and x.slot_id is not null order by x.start_event_id limit 11);
    if cardinality(other_ids)>10 then raise exception 'attendance_period_source_too_large';end if;
    foreach target_id in array other_ids loop
      if target_id=any(session_ids) then continue;end if;
      child:=public.faolla_attendance_period_session_v1(site,wid,target_id,emp.id,emp.auth_user_id,observed);
      sessions:=sessions||jsonb_build_array(child);session_ids:=array_append(session_ids,target_id);total_events:=total_events+jsonb_array_length(child->'item'->'events');
      if cardinality(session_ids)>100 or total_events>4000 then raise exception 'attendance_period_source_too_large';end if;
      if child->'item'->'events'->-1->>'action'<>'clock_out' then flags:=array_append(flags,'open_session');end if;
    end loop;
  end loop;
  select coalesce(jsonb_agg(value order by value->'item'->>'startEventId'),'[]'::jsonb) into sessions from jsonb_array_elements(sessions);

  -- Leave retains current terminal state, not a payroll deduction/excuse.
  ids:=array(select x.request_id from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '8784 hours' and x.start_at<range_to order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for leave_row in select x.* from public.merchant_attendance_leave_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if leave_row.end_at<=range_from then continue;end if;
    if leave_row.employee_id<>emp.id or leave_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    summary:=public.faolla_attendance_leave_summary_v1(leave_row);
    select * into leave_op from public.merchant_attendance_leave_entries x where x.merchant_id=site and x.request_id=leave_row.request_id and x.revision=(summary->>'revision')::integer;
    leaves:=leaves||jsonb_build_array(jsonb_build_object('workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,'summary',summary,
      'operationId',leave_op.operation_id,'recordedAt',to_char(leave_op.recorded_at at time zone 'UTC',fmt)));
    if summary->>'status'='submitted' then flags:=array_append(flags,'pending_leave');end if;
  end loop;
  -- Saved locations only. No current default location and no unrelated people.
  place_ids:=array(select distinct id from (select (event->>'locationId')::uuid id from jsonb_array_elements(sessions) r cross join lateral jsonb_array_elements(r->'item'->'events') event
    union all select (value->>'locationId')::uuid from jsonb_array_elements(report->'missing')
    union all select (value->'slot'->>'locationId')::uuid from jsonb_array_elements(plans)) places where id is not null order by id limit 101);
  if cardinality(place_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  ids:=array(select x.entry_id from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id is null
    and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2 order by x.from_date,x.through_date limit 101);
  foreach place in array place_ids loop
    other_ids:=array(select x.entry_id from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.location_id=place
      and x.from_date>=(range_from at time zone 'UTC')::date-367 and x.from_date<=(range_to at time zone 'UTC')::date+2 order by x.from_date,x.through_date limit 101);
    ids:=ids||other_ids;if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  end loop;
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for calendar_row in select x.* from public.merchant_attendance_calendar_entries x where x.merchant_id=site and x.entry_id=any(ids) order by x.entry_id loop
    summary:=public.faolla_attendance_calendar_summary_v1(calendar_row);
    foreach boundary_date in array array[calendar_row.from_date,calendar_row.through_date+1] loop
      cache_key:=jsonb_build_array(calendar_row.time_zone,boundary_date)::text;
      if not(bounds ? cache_key) then bounds:=bounds||jsonb_build_object(cache_key,to_char(public.faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone) at time zone 'UTC',fmt));end if;
    end loop;
    a:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.from_date)::text)::timestamptz;b:=(bounds->>jsonb_build_array(calendar_row.time_zone,calendar_row.through_date+1)::text)::timestamptz;
    if a>=range_to or b<=range_from then continue;end if;
    select * into calendar_op from public.merchant_attendance_calendar_operations x where x.merchant_id=site and x.entry_id=calendar_row.entry_id and x.revision=(summary->>'revision')::integer;
    calendars:=calendars||jsonb_build_array(jsonb_build_object('summary',summary,'operationId',calendar_op.operation_id,'fromAt',to_char(a at time zone 'UTC',fmt),'toAt',to_char(b at time zone 'UTC',fmt),'recordedAt',to_char(calendar_op.recorded_at at time zone 'UTC',fmt)));
  end loop;

  -- All relevant missing requests, not merely approved-current report rows.
  ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.worker_id=wid
    and x.start_at>=range_from-interval '24 hours' and x.start_at<range_to order by x.start_at,x.end_at limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for missing_row in select x.* from public.merchant_attendance_missing_requests x where x.merchant_id=site and x.request_id=any(ids) order by x.request_id loop
    if missing_row.end_at<=range_from then continue;end if;
    if missing_row.employee_id<>emp.id or missing_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    select * into missing_first from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id and x.revision=1;
    select * into missing_op from public.merchant_attendance_missing_entries x where x.merchant_id=site and x.request_id=missing_row.request_id order by x.revision desc limit 1;
    if missing_first.operation_id is distinct from missing_row.request_id or missing_first.action is distinct from 'submit'
      or missing_first.actor_auth_user_id is distinct from emp.auth_user_id or missing_first.command->'proposal' is distinct from missing_row.proposal
      or missing_op.revision not between 1 and 2 or missing_op.recorded_at<missing_first.recorded_at then raise exception 'attendance_period_source_invalid';end if;
    root_ids:=array(select x.request_id from public.merchant_attendance_missing_requests x where x.merchant_id=site
      and coalesce(x.root_request_id,x.request_id)=coalesce(missing_row.root_request_id,missing_row.request_id) limit 101);
    if cardinality(root_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
    status_name:=case missing_op.action when 'submit' then 'submitted' when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' end;
    if status_name is null then raise exception 'attendance_period_source_invalid';end if;
    missing:=missing||jsonb_build_array(jsonb_build_object('requestId',missing_row.request_id,'operationId',missing_op.operation_id,'revision',missing_op.revision,'status',status_name,
      'startAt',to_char(missing_row.start_at at time zone 'UTC',fmt),'endAt',to_char(missing_row.end_at at time zone 'UTC',fmt),'recordedAt',to_char(missing_op.recorded_at at time zone 'UTC',fmt),
      'supersedesRequestId',missing_row.supersedes_request_id,'rootRequestId',coalesce(missing_row.root_request_id,missing_row.request_id),
      'isCurrentApproved',status_name='approved' and not exists(select 1 from public.merchant_attendance_missing_requests x join public.merchant_attendance_missing_entries terminal
        on terminal.merchant_id=x.merchant_id and terminal.request_id=x.request_id and terminal.revision=2 and terminal.action='approve'
        where x.merchant_id=site and x.request_id=any(root_ids) and x.supersedes_request_id=missing_row.request_id)));
    if status_name='submitted' then flags:=array_append(flags,'pending_missing');end if;
  end loop;

  -- Existing worker history indexes: bound BEFORE status/proposal filtering.
  -- A large history is an explicit refusal, never an empty pending section.
  ids:=array(select x.request_id from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.worker_id=wid and x.action='submit' order by x.recorded_at desc,x.request_id desc limit 101);
  other_ids:=array(select x.request_id from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.worker_id=wid and x.action='submit' order by x.employee_id,x.actor_auth_user_id,x.recorded_at desc,x.request_id desc limit 101);
  if cardinality(ids)>100 or cardinality(other_ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for correction_row in select x.* from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=any(ids) and x.action='submit' order by x.request_id loop
    select * into correction_tail from public.merchant_attendance_correction_entries x where x.merchant_id=site and x.request_id=correction_row.request_id order by x.revision desc limit 1;
    if correction_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_correction_decisions x where x.merchant_id=site and x.request_id=correction_row.request_id) then continue;end if;
    a:=(correction_row.proposal->>'startAt')::timestamptz;b:=(correction_row.proposal->>'endAt')::timestamptz;
    if not(correction_row.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if correction_row.employee_id<>emp.id or correction_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if public.faolla_attendance_correction_proposal_v1(correction_row.proposal,correction_row.recorded_at) is distinct from correction_row.proposal then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','correction','requestId',correction_row.request_id,'operationId',correction_row.operation_id,'revision',correction_row.revision,
      'startEventId',correction_row.start_event_id,'startAt',correction_row.proposal->'startAt','endAt',correction_row.proposal->'endAt','recordedAt',to_char(correction_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  for revision_row in select x.* from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=any(other_ids) and x.action='submit' order by x.request_id loop
    select * into revision_tail from public.merchant_attendance_revision_requests x where x.merchant_id=site and x.request_id=revision_row.request_id order by x.revision desc limit 1;
    if revision_tail.action<>'submit' or exists(select 1 from public.merchant_attendance_revision_decisions x where x.merchant_id=site and x.request_id=revision_row.request_id) then continue;end if;
    select * into root_effect from public.merchant_attendance_correction_effects x where x.merchant_id=site and x.request_id=revision_row.base_request_id;
    a:=(revision_row.command->'proposal'->>'startAt')::timestamptz;b:=(revision_row.command->'proposal'->>'endAt')::timestamptz;
    if not(root_effect.start_event_id=any(session_ids)) and (a>=range_to or b<=range_from) then continue;end if;
    if revision_row.employee_id<>emp.id or revision_row.actor_auth_user_id<>emp.auth_user_id then raise exception 'attendance_period_source_identity_changed';end if;
    if root_effect.worker_id is distinct from wid or root_effect.start_event_id is null
      or public.faolla_attendance_correction_proposal_v1(revision_row.command->'proposal',revision_row.recorded_at) is distinct from revision_row.command->'proposal' then raise exception 'attendance_period_source_invalid';end if;
    pending:=pending||jsonb_build_array(jsonb_build_object('kind','revision','requestId',revision_row.request_id,'operationId',revision_row.operation_id,'revision',revision_row.revision,
      'startEventId',root_effect.start_event_id,'startAt',revision_row.command->'proposal'->'startAt','endAt',revision_row.command->'proposal'->'endAt','recordedAt',to_char(revision_row.recorded_at at time zone 'UTC',fmt)));
  end loop;
  if jsonb_array_length(pending)>100 then raise exception 'attendance_period_source_too_large';end if;
  if jsonb_array_length(pending)>0 then flags:=array_append(flags,'pending_correction');end if;

  -- Only the complete already-collected plan membership is relevant: plans in
  -- this period plus saved plan references of original/latest related sessions.
  -- At most 200 distinct IDs (100 plans + 100 sessions), each looked up through
  -- existing147 UNIQUE(merchant_id,slot_id). Unrelated lifetime cases do not
  -- consume the period's 100-case budget; no history scan or silent truncation.
  other_ids:=array(select distinct candidate.slot_id from (
    select (value->'slot'->>'id')::uuid slot_id from jsonb_array_elements(plans)
    union all select (value->'relation'->'slot'->>'id')::uuid slot_id from jsonb_array_elements(sessions)
  ) candidate where candidate.slot_id is not null order by candidate.slot_id);
  if cardinality(other_ids)>200 then raise exception 'attendance_period_source_too_large';end if;
  ids:=array(select picked.case_id from unnest(other_ids) selected(slot_id)
    cross join lateral(select x.case_id from public.merchant_attendance_plan_exception_cases x
      where x.merchant_id=site and x.slot_id=selected.slot_id limit 1) picked
    order by picked.case_id limit 101);
  if cardinality(ids)>100 then raise exception 'attendance_period_source_too_large';end if;
  for case_row in select x.* from public.merchant_attendance_plan_exception_cases x where x.merchant_id=site and x.case_id=any(ids) order by x.case_id loop
    if row(case_row.worker_id,case_row.employee_id,case_row.employee_auth_user_id) is distinct from row(wid,emp.id,emp.auth_user_id) then raise exception 'attendance_period_source_identity_changed';end if;
    select * into review_head from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id order by x.revision desc limit 1;
    select * into decision_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='decision' order by x.revision desc limit 1;
    select * into note_row from public.merchant_attendance_plan_exception_entries x where x.merchant_id=site and x.case_id=case_row.case_id and x.kind='note' order by x.revision desc limit 1;
    select * into read_row from public.merchant_attendance_plan_exception_reads x where x.merchant_id=site and x.decision_operation_id=decision_row.operation_id;
    if review_head.operation_id is null or decision_row.operation_id is null then raise exception 'attendance_period_source_invalid';end if;
    item:=public.faolla_attendance_plan_exception_review_entry_v1(decision_row);
    summary:=case when note_row.operation_id is null then null else public.faolla_attendance_plan_exception_review_entry_v1(note_row) end;
    reviews:=reviews||jsonb_build_array(jsonb_build_object('caseId',case_row.case_id,'slotId',case_row.slot_id,'revision',review_head.revision,'latestDecision',item,'latestNote',summary,
      'read',case when read_row.operation_id is null then null else jsonb_build_object('operationId',read_row.operation_id,'decisionOperationId',read_row.decision_operation_id,'readAt',to_char(read_row.read_at at time zone 'UTC',fmt)) end));
    -- Validation is deliberately outside canonical content. A self read cannot
    -- call146 as the owner.149 owner send/seal performs the real fresh check.
    if access_name='self' then flags:=array_append(flags,'unresolved_review');
    else
      current_source:=public.faolla_attendance_plan_exception_source_v1(jsonb_build_object('siteId',site,'workerId',wid,'slotId',case_row.slot_id),p_auth_user_id);
      if decision_row.command->>'outcome'='follow_up' or note_row.revision>decision_row.revision
        or decision_row.evidence->>'fingerprint' is distinct from current_source->>'fingerprint' then flags:=array_append(flags,'unresolved_review');end if;
    end if;
  end loop;
  read_at:=clock_timestamp();if read_at<observed then raise exception 'attendance_period_source_invalid';end if;
  select coalesce(jsonb_agg(to_jsonb(reason) order by ord),'[]'::jsonb) into blockers from unnest(array['period_in_progress','open_session','pending_correction','pending_missing','pending_leave','unresolved_review']) with ordinality t(reason,ord) where reason=any(flags);
  context:=jsonb_build_object('pendingCorrections',pending,'missing',missing,'leave',leaves,'calendar',calendars,'plans',jsonb_build_object('items',plans,'sessions',sessions),'reviews',reviews);
  result:=jsonb_build_object('sourceVersion','attendance-period-source-v1','siteId',site,'workerId',wid,'employeeId',emp.id,'employeeAuthUserId',emp.auth_user_id,
    'timeZone',s.time_zone,'fromDate',first_day,'throughDate',last_day,'fromAt',base->'fromAt','toAt',base->'toAt','readAt',to_char(read_at at time zone 'UTC',fmt),
    'dayBoundaries',day_items,'report',report,'context',context,'blockers',blockers,'complete',true,'validation',case when access_name='owner' then 'owner_checked' else 'self_not_checked' end);
  canonical:=public.faolla_attendance_period_canonical_v1(result);source_text:=canonical::text;
  if octet_length(convert_to(source_text,'UTF8'))>1048576 then raise exception 'attendance_period_source_too_large';end if;
  result:=result||jsonb_build_object('sourceCanonical',canonical,'sourceText',source_text,'sourceFingerprint',encode(sha256(convert_to(source_text,'UTF8')),'hex'));
  -- Internal SQL envelope carries raw and canonical material for server-side
  -- verification. The HTTP service projects a smaller archive artifact.
  if octet_length(convert_to(result::text,'UTF8'))>4194304 then raise exception 'attendance_period_source_too_large';end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then raise exception 'attendance_period_source_invalid';
end;
$$;

revoke all on function public.faolla_attendance_period_plan_rule_v1(text,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_canonical_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_period_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.faolla_attendance_period_source_v1(jsonb,uuid) to service_role;
do $period_source_postconditions$
declare signature text;role_name text;
begin
  foreach signature in array array['public.faolla_attendance_period_plan_rule_v1(text,uuid,uuid,uuid,uuid,uuid)','public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamp with time zone)',
    'public.faolla_attendance_period_canonical_v1(jsonb)','public.faolla_attendance_period_source_v1(jsonb,uuid)'] loop
    foreach role_name in array array['anon','authenticated'] loop
      if has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'merchant_attendance_period_source_installation_conflict';end if;
    end loop;
    if has_function_privilege('service_role',signature,'EXECUTE')<>(signature='public.faolla_attendance_period_source_v1(jsonb,uuid)') then
      raise exception 'merchant_attendance_period_source_installation_conflict';end if;
  end loop;
end;
$period_source_postconditions$;
insert into public.faolla_schema_migrations(version,name) values(202610050148,'merchant_attendance_period_source') on conflict(version) do nothing;
commit;
