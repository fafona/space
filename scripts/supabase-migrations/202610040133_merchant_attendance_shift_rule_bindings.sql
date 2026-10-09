-- Private clock-in point binding only. No old table, writer, report or capture
-- is changed.134 calls the binder only after an actual NEW clock_in succeeds.
-- verified means a complete source selection, NOT normal attendance, payroll,
-- formal classification or a configured rule. Missing choices stay unconfigured.
begin;
set local lock_timeout='3s';
do $shift_rule_prerequisites$
declare installed boolean;t text;p text;dependency record;
begin
  if to_regclass('public.faolla_schema_migrations') is null or to_regclass('public.merchant_attendance_events') is null
    or to_regprocedure('pg_catalog.sha256(bytea)') is null then raise exception 'merchant_attendance_shift_rule_bindings_prerequisite_required';end if;
  for dependency in select * from (values
    (202609290064::bigint,'merchant_attendance_owner_configuration'),(202610030124::bigint,'merchant_attendance_groups'),
    (202610040127::bigint,'merchant_attendance_rule_versions'),(202610040129::bigint,'merchant_attendance_personal_rules'),
    (202610040130::bigint,'merchant_attendance_rule_sources')) d(version,name) loop
    if not exists(select 1 from public.faolla_schema_migrations m where m.version=dependency.version and m.name=dependency.name) then
      raise exception 'merchant_attendance_shift_rule_bindings_prerequisite_required';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_events_append_only_v1()',
    'public.faolla_attendance_group_assignment_detail_v1(public.merchant_attendance_group_assignments)',
    'public.faolla_attendance_group_checked_v1(public.merchant_attendance_groups)',
    'public.faolla_attendance_rule_stream_checked_v1(public.merchant_attendance_rule_streams)',
    'public.faolla_attendance_rule_receipt_v1(public.merchant_attendance_rule_operations)',
    'public.faolla_attendance_personal_rule_stream_checked_v1(public.merchant_attendance_personal_rule_streams)',
    'public.faolla_attendance_personal_rule_receipt_v1(public.merchant_attendance_personal_rule_operations)',
    'public.faolla_attendance_rule_sources_personal_checked_v1(public.merchant_attendance_personal_rule_operations,jsonb)',
    'public.faolla_attendance_rule_day_start_v1(text,text)','public.faolla_attendance_personal_rule_end_v1(text,text)'] loop
    if to_regprocedure(p) is null then raise exception 'merchant_attendance_shift_rule_bindings_prerequisite_required';end if;
  end loop;
  select exists(select 1 from public.faolla_schema_migrations where version=202610040133 and name='merchant_attendance_shift_rule_bindings') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610040133 and name<>'merchant_attendance_shift_rule_bindings') then
    raise exception 'merchant_attendance_shift_rule_bindings_installation_conflict';end if;
  foreach t in array array['merchant_attendance_shift_rule_sources','merchant_attendance_shift_rule_bindings'] loop
    if installed<>(to_regclass('public.'||t) is not null) then raise exception 'merchant_attendance_shift_rule_bindings_installation_conflict';end if;
  end loop;
  foreach p in array array['public.faolla_attendance_shift_rule_fields_v1(jsonb)',
    'public.faolla_attendance_shift_rule_source_valid_v1(text,text,uuid,text,integer)',
    'public.faolla_attendance_shift_rule_collect_v1(uuid,text,uuid)',
    'public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)'] loop
    if installed<>(to_regprocedure(p) is not null) then raise exception 'merchant_attendance_shift_rule_bindings_installation_conflict';end if;
  end loop;
end;
$shift_rule_prerequisites$;

-- Pure resolution of an already validated point graph. No clock, SQL sources,
-- timezone reinterpretation or implicit threshold defaults enter this function.
create or replace function public.faolla_attendance_shift_rule_fields_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare k text;layer text;item jsonb;choice jsonb;provenance jsonb;trace jsonb;fields jsonb:='{}';
  selected_state text;selected_minutes jsonb;selected_source jsonb;mode_name text;head bigint;gid jsonb;
begin
  if p is null or jsonb_typeof(p)<>'object' then raise exception 'attendance_shift_rule_source_invalid';end if;
  foreach layer in array array['personal','group','enterprise'] loop
    item:=case when layer='personal' then p->layer->'approval' else p->layer->'publication' end;
    if item is not null and item<>'null'::jsonb and not public.faolla_attendance_rule_values_v1(item->'rules') then
      raise exception 'attendance_shift_rule_source_invalid';end if;
  end loop;
  foreach k in array array['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes'] loop
    trace:='[]';selected_state:='unconfigured';selected_minutes:='null';selected_source:='null';
    foreach layer in array array['personal','group','enterprise'] loop
      item:=case when layer='personal' then p->layer->'approval' else p->layer->'publication' end;
      head:=(p->layer->>'revision')::bigint;gid:=case when layer='group' then p->layer->'group'->'groupId' else 'null'::jsonb end;
      if item is null or item='null'::jsonb then
        mode_name:=case when layer='personal' then 'missing_approval' when layer='group' and p->'group'='null'::jsonb then 'no_assignment' else 'missing_publication' end;
        choice:=null;provenance:='null';
      else
        choice:=item->'rules'->k;mode_name:=choice->>'mode';
        provenance:=jsonb_build_object('layer',layer,'groupId',gid,'ledgerRevision',head,
          'operationId',item->'operationId','revision',item->'revision','actorId',item->'actorId');
      end if;
      trace:=trace||jsonb_build_array(jsonb_build_object('layer',layer,'groupId',gid,'ledgerRevision',head,
        'mode',mode_name,'minutes',case when mode_name='value' then choice->'minutes' else 'null'::jsonb end,'source',provenance));
      if selected_state='unconfigured' and mode_name in('disabled','value') then
        selected_state:=mode_name;selected_minutes:=case when mode_name='value' then choice->'minutes' else 'null'::jsonb end;selected_source:=provenance;
      end if;
    end loop;
    fields:=fields||jsonb_build_object(k,jsonb_build_object('state',selected_state,'minutes',selected_minutes,'source',selected_source,'trace',trace));
  end loop;
  return fields;
end;
$$;

-- Stored raw UTF8 bytes/hash stay verifiable without current tzdata. The source
-- is a small normalized graph, not a131 archive or a claim of past application.
create or replace function public.faolla_attendance_shift_rule_source_valid_v1(p_text text,p_site text,p_worker uuid,p_hash text,p_bytes integer)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare p jsonb;k text;u text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_text is null or p_site is null or p_worker is null or p_hash is null or p_bytes is null or p_bytes not between 1 and 65536
    or p_bytes<>octet_length(convert_to(p_text,'UTF8')) or p_hash !~ '^[0-9a-f]{64}$'
    or p_hash<>encode(sha256(convert_to(p_text,'UTF8')),'hex') then return false;end if;
  p:=p_text::jsonb;
  if jsonb_typeof(p)<>'object' or (select count(*) from jsonb_object_keys(p))<>15
    or not(p ?& array['protocol','algorithmVersion','bindingPolicy','siteId','workerId','employeeId','employeeAuthUserId','workerVersion',
      'settingsVersion','timeZone','assignment','enterprise','group','personal','fields'])
    or p->>'protocol' is distinct from 'shift-rule-point-v1' or p->>'algorithmVersion' is distinct from 'personal-group-enterprise-point-v1'
    or p->>'bindingPolicy' is distinct from 'clock-in-whole-shift-v1' or p->>'siteId' is distinct from p_site
    or p->>'workerId' is distinct from p_worker::text or coalesce(p->>'employeeId','') !~ u or coalesce(p->>'employeeAuthUserId','') !~ u
    or jsonb_typeof(p->'timeZone')<>'string' or length(p->>'timeZone') not between 1 and 100 then return false;end if;
  foreach k in array array['workerVersion','settingsVersion'] loop
    if jsonb_typeof(p->k)<>'number' or coalesce(p->>k,'') !~ '^[1-9][0-9]{0,15}$'
      or (p->>k)::numeric>9007199254740990 then return false;end if;
  end loop;
  if jsonb_typeof(p->'enterprise')<>'object' or jsonb_typeof(p->'personal')<>'object'
    or jsonb_typeof(p->'assignment') not in('object','null') or jsonb_typeof(p->'group') not in('object','null')
    or (p->'assignment'='null'::jsonb)<>(p->'group'='null'::jsonb)
    or p->'fields' is distinct from public.faolla_attendance_shift_rule_fields_v1(p) then return false;end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or raise_exception then return false;
end;
$$;

create table if not exists public.merchant_attendance_shift_rule_sources (
  merchant_id text not null,source_id uuid not null,worker_id uuid not null,
  source_text text not null,source_sha256 text not null,source_bytes integer not null,created_at timestamptz not null check(isfinite(created_at)),
  primary key(merchant_id,source_id),unique(merchant_id,source_id,worker_id),unique(merchant_id,worker_id,source_sha256),
  check(public.faolla_attendance_shift_rule_source_valid_v1(source_text,merchant_id,worker_id,source_sha256,source_bytes))
);
create table if not exists public.merchant_attendance_shift_rule_bindings (
  merchant_id text not null,start_event_id uuid not null,worker_id uuid not null,operation_id uuid not null,
  sequence bigint not null check(sequence between 1 and 9007199254740990),location_id uuid not null,occurred_at timestamptz not null,
  event_time_zone text not null,channel text not null check(channel in('self','location','pin','onsite')),request_auth_user_id uuid null,
  employee_id uuid null,employee_auth_user_id uuid null,worker_version bigint null,settings_version bigint null,
  status text not null check(status in('verified','unverified')),reason text null,source_id uuid null,
  algorithm_version text not null check(algorithm_version='personal-group-enterprise-point-v1'),
  binding_policy text not null check(binding_policy='clock-in-whole-shift-v1'),recorded_at timestamptz not null,
  primary key(merchant_id,start_event_id),unique(start_event_id),unique(merchant_id,worker_id,operation_id),
  foreign key(merchant_id,source_id,worker_id) references public.merchant_attendance_shift_rule_sources(merchant_id,source_id,worker_id),
  check(isfinite(occurred_at) and isfinite(recorded_at)),
  check((channel='pin' and request_auth_user_id is null) or (channel<>'pin' and request_auth_user_id is not null)),
  check(worker_version is null or worker_version between 1 and 9007199254740990),check(settings_version is null or settings_version between 1 and 9007199254740990),
  check((status='verified' and reason is null and source_id is not null and employee_id is not null and employee_auth_user_id is not null
      and worker_version is not null and settings_version is not null and recorded_at>=occurred_at)
    or (status='unverified' and source_id is null and reason is not null and reason in('source_unavailable','source_invalid','source_conflict',
      'identity_unavailable','identity_changed','inactive_worker','inactive_employee','invalid_date','assignment_overlap','inactive_group',
      'personal_overlap','source_cap','source_quota','source_too_large')))
);
create index if not exists attendance_shift_rule_bindings_worker_idx on public.merchant_attendance_shift_rule_bindings(merchant_id,worker_id,occurred_at,start_event_id);
alter table public.merchant_attendance_shift_rule_sources enable row level security;
alter table public.merchant_attendance_shift_rule_bindings enable row level security;
revoke all on public.merchant_attendance_shift_rule_sources,public.merchant_attendance_shift_rule_bindings from public,anon,authenticated,service_role;
do $shift_rule_triggers$
declare t text;
begin
  foreach t in array array['merchant_attendance_shift_rule_sources','merchant_attendance_shift_rule_bindings'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_immutable') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public.faolla_attendance_events_append_only_v1()',t||'_immutable',t);end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_no_truncate') then
      execute format('create trigger %I before truncate on public.%I for each statement execute function public.faolla_attendance_events_append_only_v1()',t||'_no_truncate',t);end if;
  end loop;
end;
$shift_rule_triggers$;

-- Called only inside134, after an old clock RPC retained its settings SHARE,
-- employee/role locks and worker UPDATE lock.124/127/129 require settings UPDATE
-- before all source mutations, including first-row inserts: no phantom gap.
-- No new merchant lock, settings upgrade, owner130 impersonation or client graph.
create or replace function public.faolla_attendance_shift_rule_collect_v1(p_event_id uuid,p_channel text,p_auth_user_id uuid)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;s public.merchant_attendance_settings%rowtype;
  w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  a public.merchant_attendance_group_assignments%rowtype;chosen_assignment public.merchant_attendance_group_assignments%rowtype;
  g public.merchant_attendance_groups%rowtype;stream public.merchant_attendance_rule_streams%rowtype;publication public.merchant_attendance_rule_operations%rowtype;
  publication_withdrawal public.merchant_attendance_rule_operations%rowtype;
  ps public.merchant_attendance_personal_rule_streams%rowtype;approval public.merchant_attendance_personal_rule_operations%rowtype;
  personal_withdrawal public.merchant_attendance_personal_rule_operations%rowtype;
  assignment_candidates public.merchant_attendance_group_assignments[];personal_candidates public.merchant_attendance_personal_rule_operations[];
  publication_candidates public.merchant_attendance_rule_operations[];
  at_day date;start_at timestamptz;end_at timestamptz;original_end_at timestamptz;chosen_start timestamptz;chosen_end timestamptz;
  boundary_cache jsonb:='{}';personal_check_cache jsonb:='{}';boundary_key text;assignment_item jsonb:='null';group_item jsonb:='null';enterprise_item jsonb;
  personal_item jsonb;publication_item jsonb;point jsonb;detail jsonb;channel_receipt jsonb;scope_key text;head bigint;personal_head bigint:=0;gid uuid;
  count_active integer:=0;personal_active integer:=0;source_count integer:=0;candidate_count integer;
begin
  select * into ev from public.merchant_attendance_events where id=p_event_id;
  if ev.id is null or ev.action<>'clock_in' or p_channel is null or p_channel not in('self','location','pin','onsite')
    or (p_channel='pin')<>(p_auth_user_id is null) or (p_channel='pin')<>(ev.source='kiosk') then raise exception 'attendance_shift_rule_source_invalid';end if;
  -- Verify the original immutable channel receipt, not just the broad web/kiosk
  -- event source.134 has already checked the original response and operation.
  if p_channel='pin' then select to_jsonb(r) into channel_receipt from public.merchant_attendance_pin_clock_receipts r where r.event_id=ev.id;
  elsif p_channel='onsite' then select to_jsonb(r) into channel_receipt from public.merchant_attendance_onsite_receipts r where r.event_id=ev.id;
  elsif p_channel='location' then select to_jsonb(r) into channel_receipt from public.merchant_attendance_location_clock_notices r where r.event_id=ev.id;
  else
    if exists(select 1 from public.merchant_attendance_pin_clock_receipts where event_id=ev.id)
      or exists(select 1 from public.merchant_attendance_onsite_receipts where event_id=ev.id)
      or exists(select 1 from public.merchant_attendance_location_clock_notices where event_id=ev.id) then raise exception 'attendance_shift_rule_source_invalid';end if;
  end if;
  if p_channel<>'self' then
    if channel_receipt is null or channel_receipt->>'merchant_id' is distinct from ev.merchant_id
      or channel_receipt->>'worker_id' is distinct from ev.worker_id::text or channel_receipt->>'employee_id' is distinct from ev.actor_employee_id::text
      or channel_receipt->'command'->>'operationId' is distinct from ev.operation_id::text
      or channel_receipt->'command'->>'action' is distinct from 'clock_in'
      or channel_receipt->'command'->>'locationId' is distinct from ev.location_id::text
      or channel_receipt->'command'->'expectedSequence' is distinct from to_jsonb(ev.sequence-1)
      or p_channel in('pin','onsite') and (channel_receipt->>'operation_id' is distinct from ev.operation_id::text
        or channel_receipt->'command'->>'expectedWorkerId' is distinct from ev.worker_id::text
        or channel_receipt->'command'->>'expectedEmployeeId' is distinct from ev.actor_employee_id::text)
      or p_channel='location' and (channel_receipt->>'location_id' is distinct from ev.location_id::text
        or channel_receipt->'safe_finish' is distinct from 'false'::jsonb) then raise exception 'attendance_shift_rule_source_invalid';end if;
  end if;
  select * into s from public.merchant_attendance_settings where merchant_id=ev.merchant_id;
  select * into w from public.merchant_attendance_workers where merchant_id=ev.merchant_id and id=ev.worker_id;
  if s.merchant_id is null or w.id is null then raise exception 'attendance_shift_rule_source_invalid';end if;
  if w.employee_id is null or ev.actor_employee_id is null then raise exception 'attendance_shift_rule_identity_unavailable';end if;
  if w.employee_id is distinct from ev.actor_employee_id then raise exception 'attendance_shift_rule_identity_changed';end if;
  select * into e from public.merchant_enterprise_employees where merchant_id=ev.merchant_id and id=ev.actor_employee_id;
  if e.id is null or e.auth_user_id is null then raise exception 'attendance_shift_rule_identity_unavailable';end if;
  if p_channel<>'pin' and p_auth_user_id is distinct from e.auth_user_id then raise exception 'attendance_shift_rule_identity_changed';end if;
  if not w.active then raise exception 'attendance_shift_rule_inactive_worker';end if;
  if e.status is distinct from 'active' then raise exception 'attendance_shift_rule_inactive_employee';end if;
  if s.version not between 1 and 9007199254740990 or w.version not between 1 and 9007199254740990
    or not public.faolla_attendance_valid_zone_v1(s.time_zone) then raise exception 'attendance_shift_rule_source_invalid';end if;
  at_day:=(ev.occurred_at at time zone 'UTC')::date;
  if at_day not between date '2000-01-01' and date '2100-12-31' then raise exception 'attendance_shift_rule_invalid_date';end if;

  -- Coarse UTC-label +/-2 candidates cannot omit any IANA local boundary.
  -- Cap BEFORE expensive boundary/history work. A cap is unverified, not a
  -- partial enterprise fallback. Cancelled rows cannot be active at this point.
  assignment_candidates:=array(select x from public.merchant_attendance_group_assignments x where x.merchant_id=ev.merchant_id and x.worker_id=ev.worker_id
    and x.status<>'cancelled' and x.starts_on<=at_day+2 and (x.ends_on is null or x.ends_on>=at_day-2) order by x.assignment_id limit 101);
  candidate_count:=cardinality(assignment_candidates);source_count:=candidate_count;
  if candidate_count>100 then raise exception 'attendance_shift_rule_source_cap';end if;
  foreach a in array assignment_candidates loop
    boundary_key:=jsonb_build_array('start',a.time_zone,a.starts_on)::text;start_at:=(boundary_cache->>boundary_key)::timestamptz;
    if start_at is null then
      start_at:=public.faolla_attendance_rule_day_start_v1(to_char(a.starts_on,'YYYY-MM-DD'),a.time_zone);
      if start_at is null then raise exception 'attendance_shift_rule_invalid_date';end if;
      boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,start_at);
    end if;
    end_at:=null;
    if a.ends_on is not null then
      boundary_key:=jsonb_build_array('end',a.time_zone,a.ends_on)::text;end_at:=(boundary_cache->>boundary_key)::timestamptz;
      if end_at is null then
        end_at:=public.faolla_attendance_personal_rule_end_v1(to_char(a.ends_on,'YYYY-MM-DD'),a.time_zone);
        if end_at is null then raise exception 'attendance_shift_rule_invalid_date';end if;
        boundary_cache:=boundary_cache||jsonb_build_object(boundary_key,end_at);
      end if;
    end if;
    if start_at>ev.occurred_at or end_at<=ev.occurred_at then continue;end if;
    count_active:=count_active+1;if count_active>1 then raise exception 'attendance_shift_rule_assignment_overlap';end if;
    chosen_assignment:=a;chosen_start:=start_at;chosen_end:=end_at;
  end loop;
  if chosen_assignment.assignment_id is not null then
    a:=chosen_assignment;detail:=public.faolla_attendance_group_assignment_detail_v1(a);
    if a.employee_id is distinct from e.id then raise exception 'attendance_shift_rule_identity_changed';end if;
    -- Events are millisecond precision. Retained locks establish source order;
    -- do not pretend the truncated event distinguishes earlier microseconds in
    -- the same millisecond. Keep the original6us metadata in the saved graph.
    if a.worker_version>w.version or a.settings_version>s.version or date_trunc('milliseconds',a.updated_at)>ev.occurred_at then raise exception 'attendance_shift_rule_source_conflict';end if;
    select * into g from public.merchant_attendance_groups where merchant_id=ev.merchant_id and group_id=a.group_id;
    if g.group_id is null then raise exception 'attendance_shift_rule_source_invalid';end if;
    if not g.active then raise exception 'attendance_shift_rule_inactive_group';end if;
    if a.group_revision>g.revision then raise exception 'attendance_shift_rule_source_conflict';end if;
    group_item:=public.faolla_attendance_group_checked_v1(g);gid:=g.group_id;original_end_at:=null;
    if a.original_ends_on is not null then
      original_end_at:=public.faolla_attendance_personal_rule_end_v1(to_char(a.original_ends_on,'YYYY-MM-DD'),a.time_zone);
      if original_end_at is null then raise exception 'attendance_shift_rule_invalid_date';end if;
    end if;
    assignment_item:=jsonb_build_object('detail',detail,'workerVersion',a.worker_version,'settingsVersion',a.settings_version,'groupRevision',a.group_revision,
      'fromAt',to_char(chosen_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'toAt',to_char(chosen_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'originalFromAt',to_char(chosen_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'originalToAt',to_char(original_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
  -- Current head revision and indexed latest UNWITHDRAWN publication, not the
  -- latest25 history page and not a draft. Exact UTC endpoint equality applies.
  foreach scope_key in array array['enterprise',gid::text] loop
    if scope_key is null then continue;end if;
    head:=0;publication_item:=null;
    select * into stream from public.merchant_attendance_rule_streams x where x.merchant_id=ev.merchant_id and x.stream_key=scope_key;
    if found then head:=stream.revision;perform public.faolla_attendance_rule_stream_checked_v1(stream);end if;
    -- Fetch at most101 indexed candidates; charge each inspected candidate
    -- before filtering withdrawals and stop at the first valid publication.
    -- Older uninspected history must not permanently disable a growing ledger.
    publication_candidates:=array(select x from public.merchant_attendance_rule_operations x where x.merchant_id=ev.merchant_id and x.stream_key=scope_key
      and x.action='publish' and x.effective_at<=ev.occurred_at order by x.effective_at desc limit 101);
    foreach publication in array publication_candidates loop
      source_count:=source_count+1;if source_count>100 then raise exception 'attendance_shift_rule_source_cap';end if;
      if publication.revision>head or publication.settings_version>s.version or date_trunc('milliseconds',publication.recorded_at)>ev.occurred_at
        or scope_key<>'enterprise' and publication.group_revision>g.revision then raise exception 'attendance_shift_rule_source_conflict';end if;
      select * into publication_withdrawal from public.merchant_attendance_rule_operations wd where wd.merchant_id=ev.merchant_id and wd.stream_key=scope_key
        and wd.action='withdraw' and wd.published_revision=publication.revision;
      if found then
        if publication_withdrawal.revision>head then raise exception 'attendance_shift_rule_source_conflict';end if;
        perform public.faolla_attendance_rule_receipt_v1(publication_withdrawal);continue;
      end if;
      perform public.faolla_attendance_rule_receipt_v1(publication);publication_item:=publication.snapshot;exit;
    end loop;
    if scope_key='enterprise' then enterprise_item:=jsonb_build_object('revision',head,'publication',publication_item);
    else group_item:=jsonb_build_object('group',group_item,'revision',head,'publication',publication_item);end if;
  end loop;

  -- The personal stream remains identity-anchored even when no approval covers
  -- this instant. A stale identity MUST NOT silently fall through to a group.
  select * into ps from public.merchant_attendance_personal_rule_streams where merchant_id=ev.merchant_id and worker_id=ev.worker_id;
  if found then
    if ps.employee_id is distinct from e.id or ps.employee_auth_user_id is distinct from e.auth_user_id then raise exception 'attendance_shift_rule_identity_changed';end if;
    personal_head:=ps.revision;perform public.faolla_attendance_personal_rule_stream_checked_v1(ps);
  end if;
  -- At most31 civil dates is at most816 elapsed hours under129's boundary
  -- algorithm. Use its existing interval index and cap BEFORE end/withdrawal
  -- filtering, so arbitrarily many withdrawn approvals cannot bypass the cap.
  personal_candidates:=array(select x from public.merchant_attendance_personal_rule_operations x where x.merchant_id=ev.merchant_id and x.worker_id=ev.worker_id
    and x.action='approve' and x.from_at>=ev.occurred_at-interval '816 hours' and x.from_at<=ev.occurred_at
    order by x.from_at,x.to_at limit 101);
  source_count:=source_count+cardinality(personal_candidates);
  if source_count>100 then raise exception 'attendance_shift_rule_source_cap';end if;
  personal_item:=jsonb_build_object('revision',personal_head,'approval',null);
  foreach approval in array personal_candidates loop
    if approval.to_at<=ev.occurred_at then continue;end if;
    if approval.employee_id is distinct from e.id or approval.employee_auth_user_id is distinct from e.auth_user_id then raise exception 'attendance_shift_rule_identity_changed';end if;
    if approval.revision>personal_head or approval.worker_version>w.version or approval.settings_version>s.version or date_trunc('milliseconds',approval.recorded_at)>ev.occurred_at then
      raise exception 'attendance_shift_rule_source_conflict';end if;
    select * into personal_withdrawal from public.merchant_attendance_personal_rule_operations wd where wd.merchant_id=ev.merchant_id and wd.worker_id=ev.worker_id
      and wd.action='withdraw' and wd.approved_revision=approval.revision;
    if found then
      if personal_withdrawal.revision>personal_head then raise exception 'attendance_shift_rule_source_conflict';end if;
      personal_check_cache:=public.faolla_attendance_rule_sources_personal_checked_v1(personal_withdrawal,personal_check_cache);continue;
    end if;
    personal_active:=personal_active+1;if personal_active>1 then raise exception 'attendance_shift_rule_personal_overlap';end if;
    -- Reuse130's private receipt-equivalent checker with invocation-local
    -- command/date caches. Never call its owner-facing source RPC or keep a
    -- global cache; metadata/identity/withdrawal relationships are checked anew.
    personal_check_cache:=public.faolla_attendance_rule_sources_personal_checked_v1(approval,personal_check_cache);
    personal_item:=jsonb_build_object('revision',personal_head,'approval',approval.snapshot);
  end loop;
  point:=jsonb_build_object('protocol','shift-rule-point-v1','algorithmVersion','personal-group-enterprise-point-v1','bindingPolicy','clock-in-whole-shift-v1',
    'siteId',ev.merchant_id,'workerId',w.id,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'workerVersion',w.version,'settingsVersion',s.version,
    'timeZone',s.time_zone,'assignment',assignment_item,'enterprise',enterprise_item,'group',group_item,'personal',personal_item);
  point:=point||jsonb_build_object('fields',public.faolla_attendance_shift_rule_fields_v1(point));
  if octet_length(convert_to(point::text,'UTF8'))>65536 then raise exception 'attendance_shift_rule_source_too_large';end if;
  return point;
end;
$$;

create or replace function public.faolla_attendance_bind_shift_rules_v1(p_event_id uuid,p_channel text,p_auth_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;artifact public.merchant_attendance_shift_rule_sources%rowtype;
  member_auth uuid;worker_revision bigint;settings_revision bigint;point jsonb;body text;digest text;body_bytes integer;stamp timestamptz;
  n integer;b bigint;reason_name text;failure_state text;failure_message text;
begin
  -- This additional narrow guard forbids historical repair/backfill. New clock
  -- timestamps are milliseconds, so use the same truncation for the lower bound.
  -- No xmin comparison: PIN's successful insert may belong to a subtransaction.
  select * into ev from public.merchant_attendance_events where id=p_event_id;
  if ev.id is null or ev.action<>'clock_in' or ev.occurred_at<>ev.received_at
    or ev.received_at<date_trunc('milliseconds',statement_timestamp()) or ev.received_at>clock_timestamp()
    or p_channel is null or p_channel not in('self','location','pin','onsite') or (p_channel='pin')<>(p_auth_user_id is null) then return;end if;
  begin
    if exists(select 1 from public.merchant_attendance_shift_rule_bindings where start_event_id=p_event_id) then return;end if;
    select e.auth_user_id into member_auth from public.merchant_enterprise_employees e where e.merchant_id=ev.merchant_id and e.id=ev.actor_employee_id;
    select w.version into worker_revision from public.merchant_attendance_workers w where w.merchant_id=ev.merchant_id and w.id=ev.worker_id;
    select s.version into settings_revision from public.merchant_attendance_settings s where s.merchant_id=ev.merchant_id;
    point:=public.faolla_attendance_shift_rule_collect_v1(p_event_id,p_channel,p_auth_user_id);
    body:=point::text;body_bytes:=octet_length(convert_to(body,'UTF8'));digest:=encode(sha256(convert_to(body,'UTF8')),'hex');
    -- An already committed immutable identical source needs no quota lock.
    select * into artifact from public.merchant_attendance_shift_rule_sources x where x.merchant_id=ev.merchant_id and x.worker_id=ev.worker_id and x.source_sha256=digest;
    if not found then
      -- Merchant-only, non-waiting serialization of NEW artifact quotas. Retest
      -- after the lock; a concurrent transaction may have committed the source.
      if not pg_try_advisory_xact_lock(hashtextextended('faolla:shift-rule-sources:v1:'||ev.merchant_id,0)) then raise exception 'attendance_shift_rule_source_unavailable';end if;
      select * into artifact from public.merchant_attendance_shift_rule_sources x where x.merchant_id=ev.merchant_id and x.worker_id=ev.worker_id and x.source_sha256=digest;
    end if;
    if artifact.source_id is null then
      select count(*),coalesce(sum(source_bytes),0) into n,b from (select source_bytes from public.merchant_attendance_shift_rule_sources
        where merchant_id=ev.merchant_id and worker_id=ev.worker_id limit 257) bounded;
      if n>=256 or b+body_bytes>8388608 then raise exception 'attendance_shift_rule_source_quota';end if;
      select count(*),coalesce(sum(source_bytes),0) into n,b from (select source_bytes from public.merchant_attendance_shift_rule_sources
        where merchant_id=ev.merchant_id limit 4097) bounded;
      if n>=4096 or b+body_bytes>67108864 then raise exception 'attendance_shift_rule_source_quota';end if;
      stamp:=clock_timestamp();if stamp<ev.occurred_at then raise exception 'attendance_shift_rule_source_conflict';end if;
      insert into public.merchant_attendance_shift_rule_sources(merchant_id,source_id,worker_id,source_text,source_sha256,source_bytes,created_at)
        values(ev.merchant_id,ev.id,ev.worker_id,body,digest,body_bytes,stamp) returning * into artifact;
    end if;
    if artifact.source_text<>body or artifact.source_bytes<>body_bytes then raise exception 'attendance_shift_rule_source_conflict';end if;
    stamp:=clock_timestamp();if stamp<ev.occurred_at then raise exception 'attendance_shift_rule_source_conflict';end if;
    insert into public.merchant_attendance_shift_rule_bindings(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
      channel,request_auth_user_id,employee_id,employee_auth_user_id,worker_version,settings_version,status,reason,source_id,algorithm_version,binding_policy,recorded_at)
      values(ev.merchant_id,ev.id,ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,p_channel,p_auth_user_id,
        ev.actor_employee_id,member_auth,worker_revision,settings_revision,'verified',null,artifact.source_id,'personal-group-enterprise-point-v1','clock-in-whole-shift-v1',stamp);
    return;
  exception when others then
    get stacked diagnostics failure_state=returned_sqlstate,failure_message=message_text;
    -- Cancellation/assertion are not caught by OTHERS. Never turn connection,
    -- transaction, resource, operator/system or internal catastrophes into success.
    if left(failure_state,2) in('08','40','53','54','57','58','XX') then raise;end if;
    reason_name:=case when failure_message in('attendance_shift_rule_source_invalid','attendance_shift_rule_source_conflict',
      'attendance_shift_rule_identity_unavailable','attendance_shift_rule_identity_changed','attendance_shift_rule_inactive_worker',
      'attendance_shift_rule_inactive_employee','attendance_shift_rule_invalid_date','attendance_shift_rule_assignment_overlap',
      'attendance_shift_rule_inactive_group','attendance_shift_rule_personal_overlap','attendance_shift_rule_source_cap',
      'attendance_shift_rule_source_quota','attendance_shift_rule_source_too_large') then substr(failure_message,length('attendance_shift_rule_')+1)
      when failure_message in('attendance_group_invalid','attendance_rule_invalid','attendance_personal_rule_invalid') then 'source_invalid'
      else 'source_unavailable' end;
  end;
  -- Only binder work rolled back above. The old event and consumed PIN lease
  -- are outside that subtransaction. No error detail, SQL text or fake defaults.
  begin
    insert into public.merchant_attendance_shift_rule_bindings(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,
      channel,request_auth_user_id,employee_id,employee_auth_user_id,worker_version,settings_version,status,reason,source_id,algorithm_version,binding_policy,recorded_at)
      values(ev.merchant_id,ev.id,ev.worker_id,ev.operation_id,ev.sequence,ev.location_id,ev.occurred_at,ev.time_zone,p_channel,p_auth_user_id,
        ev.actor_employee_id,member_auth,worker_revision,settings_revision,'unverified',reason_name,null,'personal-group-enterprise-point-v1','clock-in-whole-shift-v1',clock_timestamp());
  exception when others then
    get stacked diagnostics failure_state=returned_sqlstate;
    if left(failure_state,2) in('08','40','53','54','57','58','XX') then raise;end if;
    -- Storage unavailable: preserve clock success but do not claim a binding.
    -- Future readers must treat an absent row as unverified, never resolve anew.
    return;
  end;
end;
$$;
revoke all on function public.faolla_attendance_shift_rule_fields_v1(jsonb),
  public.faolla_attendance_shift_rule_source_valid_v1(text,text,uuid,text,integer),
  public.faolla_attendance_shift_rule_collect_v1(uuid,text,uuid),public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)
  from public,anon,authenticated,service_role;
insert into public.faolla_schema_migrations(version,name) values(202610040133,'merchant_attendance_shift_rule_bindings') on conflict(version) do nothing;
do $shift_rule_postconditions$
declare t regclass;r text;p regprocedure;
begin
  if not exists(select 1 from public.faolla_schema_migrations where version=202610040133 and name='merchant_attendance_shift_rule_bindings') then
    raise exception 'merchant_attendance_shift_rule_bindings_registry_postcondition_failed';end if;
  foreach t in array array['public.merchant_attendance_shift_rule_sources'::regclass,'public.merchant_attendance_shift_rule_bindings'::regclass] loop
    if not (select relrowsecurity from pg_class where oid=t) then raise exception 'merchant_attendance_shift_rule_bindings_acl_postcondition_failed';end if;
    if not exists(select 1 from pg_trigger where tgrelid=t and not tgisinternal and tgenabled='O' and tgtype=27
        and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
      or not exists(select 1 from pg_trigger where tgrelid=t and not tgisinternal and tgenabled='O' and tgtype=34
        and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure) then raise exception 'merchant_attendance_shift_rule_bindings_immutable_postcondition_failed';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_class c where c.oid=t and (pg_has_role(r,c.relowner,'USAGE') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where case when a.grantee=0 then true else pg_has_role(r,a.grantee,'USAGE') end))) then raise exception 'merchant_attendance_shift_rule_bindings_acl_postcondition_failed';end if;
    end loop;
  end loop;
  foreach p in array array['public.faolla_attendance_shift_rule_fields_v1(jsonb)'::regprocedure,
    'public.faolla_attendance_shift_rule_source_valid_v1(text,text,uuid,text,integer)'::regprocedure,
    'public.faolla_attendance_shift_rule_collect_v1(uuid,text,uuid)'::regprocedure,
    'public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)'::regprocedure] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p,'EXECUTE') then raise exception 'merchant_attendance_shift_rule_bindings_acl_postcondition_failed';end if;
    end loop;
    if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where f.oid=p and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'merchant_attendance_shift_rule_bindings_acl_postcondition_failed';end if;
  end loop;
end;
$shift_rule_postconditions$;
notify pgrst, 'reload schema';
commit;
