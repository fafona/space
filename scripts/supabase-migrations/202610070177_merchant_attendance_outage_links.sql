--212 Explicit evidence preparation only. No clock/effect/missing writer,
--period, confirmation, resolution, original-operation conclusion or backfill.
begin;
set local lock_timeout='3s';
do $outage_links_prerequisites$
declare installed boolean;n text;
begin
  if to_regclass('public.faolla_schema_migrations') is null or not exists(select 1 from public.faolla_schema_migrations where version=202610070176 and name='merchant_attendance_outage_foundation')
    or to_regprocedure('public.faolla_attendance_period_session_v1(text,uuid,uuid,uuid,uuid,timestamp with time zone)') is null
    or to_regprocedure('public.faolla_attendance_plan_posthoc_missing_v1(text,uuid,uuid,uuid,uuid)') is null
    or to_regprocedure('public.faolla_attendance_plan_posthoc_reference_v1(jsonb)') is null
    or to_regclass('public.merchant_attendance_missing_current_v1') is null then raise exception 'merchant_attendance_outage_links_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610070177 and name='merchant_attendance_outage_links') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610070177 and name<>'merchant_attendance_outage_links')
    or installed<>(to_regclass('public.merchant_attendance_outage_link_operations') is not null) then raise exception 'merchant_attendance_outage_links_installation_conflict';end if;
  foreach n in array array['faolla_attendance_outage_link_refs_v1','faolla_attendance_outage_link_command_v1','faolla_attendance_outage_link_hash_v1',
    'faolla_attendance_outage_link_source_v1','faolla_attendance_outage_link_preview_v1','faolla_attendance_outage_link_entry_v1',
    'faolla_attendance_outage_link_guard_v1','faolla_attendance_outage_links_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n) then
      raise exception 'merchant_attendance_outage_links_installation_conflict';end if;
  end loop;
end;
$outage_links_prerequisites$;

create or replace function public.faolla_attendance_outage_link_refs_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare x jsonb;k text;seen text[]:=array[]::text[];
begin
  if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p) not between 1 and 10 then return false;end if;
  for x in select value from jsonb_array_elements(p) loop
    if public.faolla_attendance_plan_posthoc_reference_v1(x) is distinct from true then return false;end if;
    k:=(x->>'kind')||':'||coalesce(x->>'startEventId',x->>'rootRequestId');
    if k=any(seen) then return false;end if;seen:=array_append(seen,k);
  end loop;
  return true;
end;
$$;
create or replace function public.faolla_attendance_outage_link_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p is null or octet_length(convert_to(p::text,'UTF8'))>16384 or jsonb_typeof(p->'action') is distinct from 'string' or p->>'action' not in('apply','revoke')
    or public.faolla_attendance_shift_rule_binding_object_v1(p,case p->>'action' when 'apply' then array['action','operationId','expectedRevision','expectedFingerprint','sources','reason']
      else array['action','operationId','expectedRevision','expectedFingerprint','reason'] end) is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedRevision','head') is distinct from true
    or (p->>'expectedRevision')::numeric not between (case when p->>'action'='revoke' then 1 else 0 end) and (case when p->>'action'='apply' then 98 else 99 end)
    or jsonb_typeof(p->'expectedFingerprint') is distinct from 'string' or p->>'expectedFingerprint'!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,1000) is distinct from true then return false;end if;
  return p->>'action'='revoke' or public.faolla_attendance_outage_link_refs_v1(p->'sources') is true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
create or replace function public.faolla_attendance_outage_link_hash_v1(p_site text,p_declaration uuid,p jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare tuple jsonb;refs text:='[';x jsonb;r jsonb;part text;body text;
begin
  for x in select value from jsonb_array_elements(coalesce(p->'sources','[]'::jsonb)) loop
    r:=case when x->>'kind'='session' then jsonb_build_array(x->'kind',x->'startEventId',x->'lastEventId',x->'lastSequence',x->'effectOperationId',x->'effectRevision')
      else jsonb_build_array(x->'kind',x->'requestId',x->'rootRequestId',x->'approvalOperationId') end;
    select '['||string_agg(value::text,',' order by ordinal)||']' into part from jsonb_array_elements(r) with ordinality a(value,ordinal);
    refs:=refs||case when refs='[' then '' else ',' end||part;
  end loop;
  refs:=refs||']';
  tuple:=jsonb_build_array(p_site,'owner',p_declaration,p->'action',p->'operationId',p->'expectedRevision',p->'expectedFingerprint',null,p->'reason');
  select '['||string_agg(case when ordinal=8 then refs else value::text end,',' order by ordinal)||']' into body from jsonb_array_elements(tuple) with ordinality a(value,ordinal);
  return encode(sha256(convert_to(body,'UTF8')),'hex');
end;
$$;

--PRIVATE: caller has locked settings, saved worker and current employee. This
--uses 148 historical identity proofs, not today's worker binding as evidence.
--171's narrow missing edge proof has no slot/claim/140 adoption prerequisite.
create or replace function public.faolla_attendance_outage_link_source_v1(p public.merchant_attendance_outage_declarations,p_ref jsonb,p_at timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog set timezone='UTC' as $$
declare proof jsonb;events jsonb;first_event jsonb;last_event jsonb;effect jsonb;actual_ref jsonb;original jsonb;selected jsonb;
  pending_items jsonb:='[]';pending_row record;n integer:=0;location_id uuid;zone_name text;open_source boolean:=false;basis jsonb;
  missing_row public.merchant_attendance_missing_requests%rowtype;requested public.merchant_attendance_missing_requests%rowtype;
  terminal public.merchant_attendance_missing_entries%rowtype;current_ids uuid[];fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_ref->>'kind'='session' then
    proof:=public.faolla_attendance_period_session_v1(p.merchant_id,p.worker_id,(p_ref->>'startEventId')::uuid,p.employee_id,p.employee_auth_user_id,p_at);
    events:=proof->'item'->'events';first_event:=events->0;last_event:=events->-1;effect:=nullif(proof->'item'->'effect','null'::jsonb);
    open_source:=last_event->>'action'<>'clock_out';location_id:=(first_event->>'locationId')::uuid;zone_name:=first_event->>'timeZone';
    actual_ref:=jsonb_build_object('kind','session','startEventId',p_ref->'startEventId','lastEventId',last_event->'id','lastSequence',last_event->'sequence',
      'effectOperationId',effect->'operationId','effectRevision',effect->'revision');
    original:=jsonb_build_object('startAt',first_event->'occurredAt','endAt',case when open_source then 'null'::jsonb else last_event->'occurredAt' end);
    selected:=case when effect is null then original else jsonb_build_object('startAt',to_char((effect->'proposal'->>'startAt')::timestamptz at time zone 'UTC',fmt),
      'endAt',to_char((effect->'proposal'->>'endAt')::timestamptz at time zone 'UTC',fmt)) end;
    --No period/date filter: a pending correction may itself move outside the
    --declaration. Validate every selected pending row before hashing its facts.
    for pending_row in select x.* from (
      select 'correction' kind,ce.request_id,ce.operation_id,ce.revision,ce.employee_id,ce.actor_auth_user_id,to_jsonb(ce) facts
        from public.merchant_attendance_correction_entries ce where ce.merchant_id=p.merchant_id and ce.worker_id=p.worker_id
        and ce.start_event_id=(p_ref->>'startEventId')::uuid and ce.action='submit'
        and not exists(select 1 from public.merchant_attendance_correction_entries tail where tail.merchant_id=ce.merchant_id and tail.request_id=ce.request_id and tail.revision>ce.revision)
        and not exists(select 1 from public.merchant_attendance_correction_decisions decision where decision.merchant_id=ce.merchant_id and decision.request_id=ce.request_id)
      union all
      select 'revision',rr.request_id,rr.operation_id,rr.revision,rr.employee_id,rr.actor_auth_user_id,to_jsonb(rr)
        from public.merchant_attendance_revision_requests rr join public.merchant_attendance_correction_effects base on base.merchant_id=rr.merchant_id and base.request_id=rr.base_request_id
        where rr.merchant_id=p.merchant_id and base.worker_id=p.worker_id and base.start_event_id=(p_ref->>'startEventId')::uuid and rr.action='submit'
        and not exists(select 1 from public.merchant_attendance_revision_requests tail where tail.merchant_id=rr.merchant_id and tail.request_id=rr.request_id and tail.revision>rr.revision)
        and not exists(select 1 from public.merchant_attendance_revision_decisions decision where decision.merchant_id=rr.merchant_id and decision.request_id=rr.request_id)
      ) x order by x.kind,x.request_id,x.operation_id limit 101 loop
      n:=n+1;if n>100 then raise exception 'attendance_outage_links_too_large';end if;
      if row(pending_row.employee_id,pending_row.actor_auth_user_id) is distinct from row(p.employee_id,p.employee_auth_user_id) then raise exception 'attendance_worker_changed';end if;
      pending_items:=pending_items||jsonb_build_array(jsonb_build_object('kind',pending_row.kind,'requestId',pending_row.request_id,
        'operationId',pending_row.operation_id,'revision',pending_row.revision,'facts',pending_row.facts));
    end loop;
    --Whole immutable rows include timestamptz. This private function's fixed
    --UTC serialization keeps the hash independent of the caller's timezone;
    --it neither changes stored instants nor recomputes their civil boundaries.
    basis:=jsonb_build_object('item',proof->'item','pending',pending_items);
  else
    select * into requested from public.merchant_attendance_missing_requests r where r.merchant_id=p.merchant_id and r.request_id=(p_ref->>'requestId')::uuid;
    if requested.request_id is null then raise exception 'attendance_outage_links_not_found';end if;
    if row(requested.worker_id,requested.employee_id,requested.actor_auth_user_id) is distinct from row(p.worker_id,p.employee_id,p.employee_auth_user_id)
      or coalesce(requested.root_request_id,requested.request_id) is distinct from (p_ref->>'rootRequestId')::uuid then raise exception 'attendance_worker_changed';end if;
    perform public.faolla_attendance_plan_posthoc_missing_v1(p.merchant_id,p.worker_id,p.employee_id,p.employee_auth_user_id,requested.request_id);
    --Root point lookup includes later approved heads which moved out of range.
    --Never hide a malformed head by filtering its current employee or dates.
    current_ids:=array(select r.request_id from public.merchant_attendance_missing_current_v1 r where r.merchant_id=p.merchant_id
      and coalesce(r.root_request_id,r.request_id)=(p_ref->>'rootRequestId')::uuid limit 2);
    if cardinality(current_ids)<>1 then raise exception 'attendance_outage_links_invalid';end if;
    select * into missing_row from public.merchant_attendance_missing_requests r where r.merchant_id=p.merchant_id and r.request_id=current_ids[1];
    proof:=public.faolla_attendance_plan_posthoc_missing_v1(p.merchant_id,p.worker_id,p.employee_id,p.employee_auth_user_id,missing_row.request_id);
    if proof->'current' is distinct from 'true'::jsonb then raise exception 'attendance_outage_links_invalid';end if;
    actual_ref:=proof->'reference';location_id:=missing_row.location_id;zone_name:=missing_row.time_zone;
    original:=null;selected:=jsonb_build_object('startAt',to_char(missing_row.start_at at time zone 'UTC',fmt),'endAt',to_char(missing_row.end_at at time zone 'UTC',fmt));
    select * into terminal from public.merchant_attendance_missing_entries where merchant_id=p.merchant_id and request_id=missing_row.request_id and revision=2;
    for pending_row in select c.request_id,c.employee_id,c.actor_auth_user_id,to_jsonb(c) facts,to_jsonb(submit) receipt
      from public.merchant_attendance_missing_requests c join public.merchant_attendance_missing_entries submit
        on submit.merchant_id=c.merchant_id and submit.request_id=c.request_id and submit.revision=1
      where c.merchant_id=p.merchant_id and c.supersedes_request_id=missing_row.request_id
        and not exists(select 1 from public.merchant_attendance_missing_entries terminal_row where terminal_row.merchant_id=c.merchant_id and terminal_row.request_id=c.request_id and terminal_row.revision=2)
      order by c.request_id limit 2 loop
      if row(pending_row.employee_id,pending_row.actor_auth_user_id) is distinct from row(p.employee_id,p.employee_auth_user_id) then raise exception 'attendance_worker_changed';end if;
      pending_items:=pending_items||jsonb_build_array(jsonb_build_object('requestId',pending_row.request_id,'facts',pending_row.facts,'receipt',pending_row.receipt));
    end loop;
    if jsonb_array_length(pending_items)>1 or (jsonb_array_length(pending_items)>0) is distinct from (proof->>'pending')::boolean then raise exception 'attendance_outage_links_invalid';end if;
    basis:=jsonb_build_object('request',to_jsonb(missing_row),'approval',to_jsonb(terminal),'pending',pending_items);
  end if;
  return jsonb_build_object('reference',actual_ref,'locationId',location_id,'timeZone',zone_name,'original',original,'selected',selected,
    'evidenceFingerprint',encode(sha256(convert_to(basis::text,'UTF8')),'hex'),'pending',jsonb_array_length(pending_items)>0,'open',open_source);
end;
$$;

create or replace function public.faolla_attendance_outage_link_preview_v1(p public.merchant_attendance_outage_declarations,p_refs jsonb,
  p_worker_version bigint,p_employee_version bigint,p_generation bigint,p_identity boolean,p_saved jsonb default null)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare x jsonb;item jsonb;items jsonb:='[]';observations jsonb:='[]';evidence jsonb;source_text text;fingerprint text;
  blocks text[]:=array[]::text[];failure text;changed boolean;available boolean;all_available boolean:=true;at_index integer:=0;
  a timestamptz;b timestamptz;tail_at timestamptz;from_at timestamptz:=(p.declared_interval->>'startAt')::timestamptz;to_at timestamptz:=(p.declared_interval->>'endAt')::timestamptz;
begin
  for x in select value from jsonb_array_elements(p_refs) loop
    item:=null;changed:=false;available:=false;
    if not p_identity then blocks:=array_append(blocks,'identity_changed');
    else
      begin item:=public.faolla_attendance_outage_link_source_v1(p,x,clock_timestamp());
      exception when raise_exception then get stacked diagnostics failure=message_text;
        if failure in('attendance_period_source_identity_changed','attendance_period_source_identity_unproven','attendance_worker_changed') then blocks:=array_append(blocks,'identity_changed');
        elsif failure in('attendance_period_source_invalid','attendance_report_invalid_data','attendance_plan_posthoc_adoption_invalid','attendance_plan_posthoc_adoption_changed','attendance_outage_links_not_found','attendance_outage_links_invalid') then blocks:=array_append(blocks,'source_unavailable');
        elsif failure in('attendance_period_source_too_large','attendance_report_too_large') then raise exception 'attendance_outage_links_too_large';
        else raise;end if;
      end;
    end if;
    if item is not null then
      changed:=item->'reference' is distinct from x or (p_saved is not null and item is distinct from p_saved->'items'->at_index);
      available:=true;
      if changed then blocks:=array_append(blocks,'source_changed');end if;
      a:=(item->'selected'->>'startAt')::timestamptz;b:=(item->'selected'->>'endAt')::timestamptz;
      if (item->>'open')::boolean then
        blocks:=array_append(blocks,'source_open');
        select occurred_at into tail_at from public.merchant_attendance_events where merchant_id=p.merchant_id and worker_id=p.worker_id and id=(item->'reference'->>'lastEventId')::uuid;
        if not ((tail_at>a and a<to_at and tail_at>from_at) or (tail_at=a and a>=from_at and a<to_at)) then blocks:=array_append(blocks,'source_outside_declaration');all_available:=false;end if;
      elsif not (a<b and a<to_at and b>from_at) then blocks:=array_append(blocks,'source_outside_declaration');all_available:=false;end if;
      if (item->>'pending')::boolean then blocks:=array_append(blocks,'pending_source');end if;
      items:=items||jsonb_build_array(item);
    end if;
    all_available:=all_available and available and not changed;
    observations:=observations||jsonb_build_array(jsonb_build_object('reference',x,'current',item,'available',available,'changed',changed,
      'open',coalesce((item->>'open')::boolean,false),'pending',coalesce((item->>'pending')::boolean,false)));
    at_index:=at_index+1;
  end loop;
  if p_identity and jsonb_array_length(items)=jsonb_array_length(p_refs) then
    evidence:=jsonb_build_object('protocol','outage-link-evidence-v1','siteId',p.merchant_id,'declarationId',p.declaration_id,'workerId',p.worker_id,
      'employeeId',p.employee_id,'employeeAuthUserId',p.employee_auth_user_id,'workerVersion',p_worker_version,'employeeVersion',p_employee_version,
      'generation',p_generation,'declaredInterval',p.declared_interval,'items',items);
    source_text:=evidence::text;if octet_length(convert_to(source_text,'UTF8'))>131072 then raise exception 'attendance_outage_links_too_large';end if;
    fingerprint:=encode(sha256(convert_to(source_text,'UTF8')),'hex');
    if p_saved is not null and evidence is distinct from p_saved then blocks:=array_append(blocks,'source_changed');all_available:=false;end if;
  end if;
  return jsonb_build_object('fingerprint',fingerprint,'evidence',evidence,'sourceText',source_text,'eligible',all_available and evidence is not null,
    'observations',observations,'blockers',(select coalesce(jsonb_agg(k order by k),'[]') from (select distinct unnest(blocks) k) b));
end;
$$;

create table if not exists public.merchant_attendance_outage_link_operations(
  merchant_id text not null,declaration_id uuid not null,operation_id uuid not null,revision integer not null check(revision between 1 and 100),
  actor_auth_user_id uuid not null,action text not null check(action in('apply','revoke')),command jsonb not null,
  command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),sources jsonb not null,evidence jsonb,
  source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,declaration_id,revision),
  foreign key(merchant_id,declaration_id) references public.merchant_attendance_outage_declarations(merchant_id,declaration_id),
  check(public.faolla_attendance_outage_link_command_v1(command) is true and command->>'operationId'=operation_id::text and command->>'action'=action
    and (command->>'expectedRevision')::integer=revision-1 and command->>'expectedFingerprint'=source_fingerprint
    and command_fingerprint=public.faolla_attendance_outage_link_hash_v1(merchant_id,declaration_id,command)),
  check(((action='apply' and revision<=99 and sources=command->'sources' and evidence is not null
      and octet_length(convert_to(evidence::text,'UTF8'))<=131072 and source_fingerprint=encode(sha256(convert_to(evidence::text,'UTF8')),'hex'))
    or (action='revoke' and sources='[]'::jsonb and evidence is null)) is true)
);
alter table public.merchant_attendance_outage_link_operations enable row level security;
revoke all on public.merchant_attendance_outage_link_operations from public,anon,authenticated,service_role;

--Saved projection is validated without re-reading current work sources or
--today's timezone. It remains readable after source changes and revocation.
create or replace function public.faolla_attendance_outage_link_entry_v1(p public.merchant_attendance_outage_link_operations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare d public.merchant_attendance_outage_declarations%rowtype;previous public.merchant_attendance_outage_link_operations%rowtype;
  x jsonb;span jsonb;k text;n integer:=0;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  select * into d from public.merchant_attendance_outage_declarations where merchant_id=p.merchant_id and declaration_id=p.declaration_id;
  if d.declaration_id is null or p.recorded_at<d.recorded_at or public.faolla_attendance_outage_link_command_v1(p.command) is distinct from true
    or p.command_fingerprint<>public.faolla_attendance_outage_link_hash_v1(p.merchant_id,p.declaration_id,p.command) then raise exception 'attendance_outage_links_invalid';end if;
  if p.revision>1 then
    select * into previous from public.merchant_attendance_outage_link_operations where merchant_id=p.merchant_id and declaration_id=p.declaration_id and revision=p.revision-1;
    if previous.operation_id is null or previous.recorded_at>p.recorded_at then raise exception 'attendance_outage_links_invalid';end if;
  end if;
  if p.action='revoke' then
    if previous.action is distinct from 'apply' or p.source_fingerprint is distinct from previous.source_fingerprint or p.sources<>'[]'::jsonb or p.evidence is not null then raise exception 'attendance_outage_links_invalid';end if;
  else
    if public.faolla_attendance_shift_rule_binding_object_v1(p.evidence,array['protocol','siteId','declarationId','workerId','employeeId','employeeAuthUserId','workerVersion','employeeVersion','generation','declaredInterval','items']) is distinct from true
      or p.evidence->>'protocol' is distinct from 'outage-link-evidence-v1' or p.evidence->>'siteId' is distinct from d.merchant_id
      or p.evidence->>'declarationId' is distinct from d.declaration_id::text or p.evidence->>'workerId' is distinct from d.worker_id::text
      or p.evidence->>'employeeId' is distinct from d.employee_id::text or p.evidence->>'employeeAuthUserId' is distinct from d.employee_auth_user_id::text
      or p.evidence->'declaredInterval' is distinct from d.declared_interval or jsonb_typeof(p.evidence->'items') is distinct from 'array'
      or jsonb_array_length(p.evidence->'items') is distinct from jsonb_array_length(p.sources)
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.evidence->'workerVersion','version') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.evidence->'employeeVersion','version') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.evidence->'generation','head') is distinct from true
      or p.source_fingerprint<>encode(sha256(convert_to(p.evidence::text,'UTF8')),'hex') then raise exception 'attendance_outage_links_invalid';end if;
    for x in select value from jsonb_array_elements(p.evidence->'items') loop
      if public.faolla_attendance_shift_rule_binding_object_v1(x,array['reference','locationId','timeZone','original','selected','evidenceFingerprint','pending','open']) is distinct from true
        or x->'reference' is distinct from p.sources->n or public.faolla_attendance_shift_rule_binding_scalar_v1(x->'locationId','uuid') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(x->'timeZone','zone') is distinct from true
        or jsonb_typeof(x->'evidenceFingerprint') is distinct from 'string' or x->>'evidenceFingerprint'!~'^[0-9a-f]{64}$'
        or jsonb_typeof(x->'pending') is distinct from 'boolean' or jsonb_typeof(x->'open') is distinct from 'boolean'
        or (x->'reference'->>'kind'='missing' and (x->'original'<>'null'::jsonb or x->'open'<>'false'::jsonb)) then raise exception 'attendance_outage_links_invalid';end if;
      foreach k in array array['original','selected'] loop
        span:=x->k;
        if span='null'::jsonb and k='original' and x->'reference'->>'kind'='missing' then continue;end if;
        if public.faolla_attendance_shift_rule_binding_object_v1(span,array['startAt','endAt']) is distinct from true
          or public.faolla_attendance_shift_rule_binding_scalar_v1(span->'startAt','stamp6') is distinct from true
          or (span->'endAt'<>'null'::jsonb and public.faolla_attendance_shift_rule_binding_scalar_v1(span->'endAt','stamp6') is distinct from true)
          or (span->'endAt'='null'::jsonb) is distinct from (x->>'open')::boolean
          or (span->>'endAt')::timestamptz<(span->>'startAt')::timestamptz or (span->>'startAt')::timestamptz>p.recorded_at
          or (span->>'endAt')::timestamptz>p.recorded_at then raise exception 'attendance_outage_links_invalid';end if;
      end loop;
      if x->'reference'->>'kind'='session' and (x->'reference'->'effectOperationId'='null'::jsonb and x->'selected' is distinct from x->'original'
        or x->'reference'->'effectOperationId'<>'null'::jsonb and (x->>'open')::boolean) then raise exception 'attendance_outage_links_invalid';end if;
      n:=n+1;
    end loop;
  end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'action',p.action,'actorId',p.actor_auth_user_id,'reason',p.command->'reason',
    'sources',p.sources,'evidence',p.evidence,'sourceText',case when p.evidence is null then null else p.evidence::text end,'fingerprint',p.source_fingerprint,
    'recordedAt',to_char(p.recorded_at at time zone 'UTC',fmt));
end;
$$;
create or replace function public.faolla_attendance_outage_link_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.faolla_attendance_outage_link_entry_v1(new);return new;
end;
$$;
do $outage_links_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_link_operations'::regclass and tgname='attendance_outage_link_immutable') then
    create trigger attendance_outage_link_immutable before update or delete on public.merchant_attendance_outage_link_operations for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_link_operations'::regclass and tgname='attendance_outage_link_no_truncate') then
    create trigger attendance_outage_link_no_truncate before truncate on public.merchant_attendance_outage_link_operations for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_link_operations'::regclass and tgname='attendance_outage_link_valid') then
    create trigger attendance_outage_link_valid after insert on public.merchant_attendance_outage_link_operations for each row execute function public.faolla_attendance_outage_link_guard_v1();end if;
end;
$outage_links_triggers$;

create or replace function public.faolla_attendance_outage_links_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;did uuid;op uuid;before_rev integer;keys text[];refs jsonb;
  d public.merchant_attendance_outage_declarations%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  s public.merchant_attendance_settings%rowtype;r public.merchant_enterprise_roles%rowtype;generation_no bigint;identity_ok boolean;
  head public.merchant_attendance_outage_link_operations%rowtype;saved public.merchant_attendance_outage_link_operations%rowtype;row_item public.merchant_attendance_outage_link_operations%rowtype;
  revision_no integer:=0;current_item jsonb;preview jsonb;receipt jsonb;history jsonb:='[]';truncated boolean:=false;can_write boolean:=false;
  entry jsonb;evidence jsonb;fp text;stamp timestamptz;result jsonb;n integer:=0;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>16384
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or p_query->>'mode' not in('detail','preview','history','recover')
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'declarationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';did:=(p_query->>'declarationId')::uuid;
  keys:=array['siteId','access','mode','declarationId']||case mode_name when 'preview' then array['sources'] when 'history' then array['beforeRevision'] when 'recover' then array['operationId'] else array[]::text[] end;
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,keys) is distinct from true then raise exception 'attendance_invalid_request';end if;
  if mode_name='preview' then
    if access_name<>'owner' or public.faolla_attendance_outage_link_refs_v1(p_query->'sources') is distinct from true then raise exception 'attendance_invalid_request';end if;refs:=p_query->'sources';
  elsif mode_name='history' then
    if p_query->'beforeRevision'<>'null'::jsonb and (public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeRevision','version') is distinct from true or (p_query->>'beforeRevision')::numeric>101) then raise exception 'attendance_invalid_request';end if;
    before_rev:=(p_query->>'beforeRevision')::integer;
  elsif mode_name='recover' then
    if access_name<>'owner' or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
  end if;
  if p_command is not null then
    if mode_name<>'detail' or access_name<>'owner' or public.faolla_attendance_outage_link_command_v1(p_command) is distinct from true then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;
  end if;
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into d from public.merchant_attendance_outage_declarations where merchant_id=site and declaration_id=did;
  if d.declaration_id is null then raise exception 'attendance_outage_links_not_found';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=d.worker_id for update;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  identity_ok:=row(w.id,w.employee_id,e.id,e.auth_user_id) is not distinct from row(d.worker_id,d.employee_id,d.employee_id,d.employee_auth_user_id);
  if access_name='self' then
    if not identity_ok or e.auth_user_id is distinct from p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if r.id is null or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not r.permissions @> array['enterprise.view','attendance.self.view','attendance.self.request']::text[] then raise exception 'attendance_access_denied';end if;
  end if;
  select coalesce((select generation from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=d.employee_id),0) into generation_no;
  --Point recovery precedes all source, head-cap, active, flag and CAS checks.
  if op is not null then
    select * into saved from public.merchant_attendance_outage_link_operations where merchant_id=site and operation_id=op;
    if saved.operation_id is not null then
      if saved.declaration_id<>did or saved.actor_auth_user_id<>p_auth_user_id then raise exception 'attendance_access_denied';end if;
      if p_command is not null and saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
      entry:=public.faolla_attendance_outage_link_entry_v1(saved);revision_no:=saved.revision;
      receipt:=jsonb_build_object('operationId',saved.operation_id,'commandFingerprint',saved.command_fingerprint,'entry',entry);
    elsif mode_name='recover' then raise exception 'attendance_outage_links_not_found';end if;
  end if;
  if receipt is null then
    select * into head from public.merchant_attendance_outage_link_operations where merchant_id=site and declaration_id=did order by revision desc limit 1;
    revision_no:=coalesce(head.revision,0);
    if head.operation_id is not null then current_item:=public.faolla_attendance_outage_link_entry_v1(head);end if;
    if p_command is not null then
      if not p_allow_write then raise exception 'attendance_outage_links_disabled';end if;
      if not s.enabled then raise exception 'attendance_platform_paused';end if;
      if revision_no<>(p_command->>'expectedRevision')::integer or revision_no>=100 or p_command->>'action'='apply' and revision_no>=99 then raise exception 'attendance_outage_links_changed';end if;
      if p_command->>'action'='revoke' then
        if head.action is distinct from 'apply' or head.source_fingerprint is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_outage_links_changed';end if;
        refs:='[]';evidence:=null;fp:=head.source_fingerprint;
      else
        if not identity_ok then raise exception 'attendance_outage_links_changed';end if;
        refs:=p_command->'sources';preview:=public.faolla_attendance_outage_link_preview_v1(d,refs,w.version,e.version,generation_no,true);
        if preview->>'eligible' is distinct from 'true' then raise exception 'attendance_outage_links_blocked';end if;
        if preview->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_outage_links_changed';end if;
        evidence:=preview->'evidence';fp:=preview->>'fingerprint';
      end if;
      stamp:=clock_timestamp();
      insert into public.merchant_attendance_outage_link_operations(merchant_id,declaration_id,operation_id,revision,actor_auth_user_id,action,command,command_fingerprint,sources,evidence,source_fingerprint,recorded_at)
        values(site,did,op,revision_no+1,p_auth_user_id,p_command->>'action',p_command,public.faolla_attendance_outage_link_hash_v1(site,did,p_command),refs,evidence,fp,stamp) returning * into saved;
      entry:=public.faolla_attendance_outage_link_entry_v1(saved);revision_no:=saved.revision;
      receipt:=jsonb_build_object('operationId',op,'commandFingerprint',saved.command_fingerprint,'entry',entry);current_item:=null;preview:=null;
    elsif mode_name='history' then
      current_item:=null;
      for row_item in select x.* from public.merchant_attendance_outage_link_operations x where x.merchant_id=site and x.declaration_id=did
        and (before_rev is null or x.revision<before_rev) order by x.revision desc limit 26 loop
        n:=n+1;if n>25 then truncated:=true;exit;end if;entry:=public.faolla_attendance_outage_link_entry_v1(row_item);
        history:=history||jsonb_build_array(jsonb_build_object('operationId',row_item.operation_id,'revision',row_item.revision,'action',row_item.action,'actorId',row_item.actor_auth_user_id,
          'reason',row_item.command->'reason','fingerprint',row_item.source_fingerprint,'sourceCount',jsonb_array_length(row_item.sources),'recordedAt',entry->'recordedAt'));
      end loop;
    else
      can_write:=access_name='owner' and p_allow_write and s.enabled and revision_no<100;
      if mode_name='preview' then
        preview:=public.faolla_attendance_outage_link_preview_v1(d,refs,w.version,e.version,generation_no,identity_ok);
      elsif head.action='apply' then
        preview:=public.faolla_attendance_outage_link_preview_v1(d,head.sources,w.version,e.version,generation_no,identity_ok,head.evidence);
      end if;
    end if;
  end if;
  result:=jsonb_build_object('protocol','attendance-outage-links-v1','siteId',site,'access',access_name,'mode',mode_name,'actorId',p_auth_user_id,'declarationId',did,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'canWrite',can_write,'revision',revision_no,'current',current_item,'preview',preview,
    'history',history,'historyTruncated',truncated,'receipt',receipt);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_outage_links_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_outage_link_refs_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_link_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_link_hash_v1(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_link_source_v1(public.merchant_attendance_outage_declarations,jsonb,timestamp with time zone) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_link_preview_v1(public.merchant_attendance_outage_declarations,jsonb,bigint,bigint,bigint,boolean,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_link_entry_v1(public.merchant_attendance_outage_link_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_link_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_links_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.faolla_attendance_outage_links_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $outage_links_permissions$
declare p record;r text;priv text;t regclass:='public.merchant_attendance_outage_link_operations'::regclass;n integer:=0;
begin
  for p in select oid,proname,prosecdef,proconfig from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
    and proname=any(array['faolla_attendance_outage_link_refs_v1','faolla_attendance_outage_link_command_v1','faolla_attendance_outage_link_hash_v1',
      'faolla_attendance_outage_link_source_v1','faolla_attendance_outage_link_preview_v1','faolla_attendance_outage_link_entry_v1','faolla_attendance_outage_link_guard_v1','faolla_attendance_outage_links_v1']) loop
    n:=n+1;
    if p.prosecdef<>(p.proname in('faolla_attendance_outage_links_v1','faolla_attendance_outage_link_guard_v1'))
      or (case when p.proname='faolla_attendance_outage_link_source_v1' then
        (cardinality(p.proconfig) is distinct from 2 or p.proconfig[1] is distinct from 'search_path=pg_catalog' or lower(p.proconfig[2]) is distinct from 'timezone=utc')
        else p.proconfig is distinct from array['search_path=pg_catalog']::text[] end)
      or exists(select 1 from pg_proc x cross join lateral aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) a where x.oid=p.oid and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'merchant_attendance_outage_links_permission_conflict';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p.oid,'EXECUTE') is distinct from (r='service_role' and p.proname='faolla_attendance_outage_links_v1') then raise exception 'merchant_attendance_outage_links_permission_conflict';end if;
    end loop;
  end loop;
  if n<>8 or not (select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
    or exists(select 1 from pg_class x cross join lateral aclexplode(coalesce(x.relacl,acldefault('r',x.relowner))) a where x.oid=t and a.grantee=0) then raise exception 'merchant_attendance_outage_links_permission_conflict';end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    for priv in select a.privilege_type from pg_class c cross join lateral aclexplode(acldefault('r',c.relowner)) a where c.oid=t loop
      if has_table_privilege(r,t,priv) then raise exception 'merchant_attendance_outage_links_permission_conflict';end if;
    end loop;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal and tgenabled='O' and (
    (tgname='attendance_outage_link_immutable' and tgtype=27 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
    or (tgname='attendance_outage_link_no_truncate' and tgtype=34 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
    or (tgname='attendance_outage_link_valid' and tgtype=5 and tgfoid='public.faolla_attendance_outage_link_guard_v1()'::regprocedure)))<>3 then
    raise exception 'merchant_attendance_outage_links_installation_conflict';end if;
end;
$outage_links_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610070177,'merchant_attendance_outage_links') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
