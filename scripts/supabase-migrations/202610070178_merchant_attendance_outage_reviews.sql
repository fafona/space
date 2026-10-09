--214 Independent outage review foundation. No period/UI activation and no
--clock, correction, missing, account, or existing-function changes.
begin;
set local lock_timeout='3s';
do $outage_review_prerequisites$
declare installed boolean;n text;
begin
  if to_regclass('public.faolla_schema_migrations') is null or not exists(select 1 from public.faolla_schema_migrations where version=202610070177 and name='merchant_attendance_outage_links')
    or to_regprocedure('public.faolla_attendance_outage_link_preview_v1(public.merchant_attendance_outage_declarations,jsonb,bigint,bigint,bigint,boolean,jsonb)') is null
    or to_regclass('public.merchant_attendance_account_epochs') is null then raise exception 'merchant_attendance_outage_reviews_prerequisite_required';end if;
  select exists(select 1 from public.faolla_schema_migrations where version=202610070178 and name='merchant_attendance_outage_reviews') into installed;
  if exists(select 1 from public.faolla_schema_migrations where version=202610070178 and name<>'merchant_attendance_outage_reviews')
    or installed<>(to_regclass('public.merchant_attendance_outage_review_operations') is not null) then raise exception 'merchant_attendance_outage_reviews_installation_conflict';end if;
  foreach n in array array['faolla_attendance_outage_review_command_v1','faolla_attendance_outage_review_hash_v1','faolla_attendance_outage_review_original_v1',
    'faolla_attendance_outage_review_basis_v1','faolla_attendance_outage_review_entry_v1','faolla_attendance_outage_review_proposal_v1',
    'faolla_attendance_outage_review_guard_v1','faolla_attendance_outage_review_v1'] loop
    if installed<>exists(select 1 from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass) and proname=n) then
      raise exception 'merchant_attendance_outage_reviews_installation_conflict';end if;
  end loop;
end;
$outage_review_prerequisites$;

create or replace function public.faolla_attendance_outage_review_command_v1(p jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p is null or octet_length(convert_to(p::text,'UTF8'))>16384
    or public.faolla_attendance_shift_rule_binding_object_v1(p,array['action','operationId','expectedRevision','expectedResultVersion','expectedFingerprint','reason']) is distinct from true
    or jsonb_typeof(p->'action') is distinct from 'string' or p->>'action' not in('propose','confirm','dispute','resolve','reopen')
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'operationId','uuid') is distinct from true
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedRevision','head') is distinct from true
    or (p->>'expectedRevision')::numeric>(case when p->>'action' in('dispute','reopen') then 999 else 997 end)
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p->'expectedResultVersion','head') is distinct from true
    or (p->>'expectedResultVersion')::numeric>998
    or (p->>'expectedResultVersion')::numeric>(p->>'expectedRevision')::numeric
    or ((p->>'expectedRevision')::numeric=0) is distinct from ((p->>'expectedResultVersion')::numeric=0)
    or (p->>'action'<>'propose' and (p->>'expectedResultVersion')::numeric=0)
    or jsonb_typeof(p->'expectedFingerprint') is distinct from 'string' or p->>'expectedFingerprint'!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p->'reason') is distinct from 'string' or public.faolla_attendance_group_text_v1(p->>'reason',1,1000) is distinct from true then return false;end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
create or replace function public.faolla_attendance_outage_review_hash_v1(p_site text,p_access text,p_declaration uuid,p jsonb)
returns text language sql immutable set search_path=pg_catalog as $$
  select encode(sha256(convert_to('['||string_agg(value::text,',' order by ordinal)||']','UTF8')),'hex')
  from jsonb_array_elements(jsonb_build_array(p_site,p_access,p_declaration,p->'action',p->'operationId',p->'expectedRevision',p->'expectedResultVersion',p->'expectedFingerprint',p->'reason')) with ordinality a(value,ordinal);
$$;

create table if not exists public.merchant_attendance_outage_review_operations(
  merchant_id text not null,declaration_id uuid not null,operation_id uuid not null,revision integer not null check(revision between 1 and 1000),
  access text not null check(access in('owner','self')),action text not null check(action in('propose','confirm','dispute','resolve','reopen')),
  actor_auth_user_id uuid not null,actor_employee_id uuid,worker_id uuid not null,employee_id uuid not null,employee_auth_user_id uuid not null,
  result_version integer not null check(result_version between 1 and 998),result_fingerprint text not null check(result_fingerprint~'^[0-9a-f]{64}$'),
  command jsonb not null,command_fingerprint text not null check(command_fingerprint~'^[0-9a-f]{64}$'),evidence jsonb,
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  primary key(merchant_id,operation_id),unique(merchant_id,declaration_id,revision),
  foreign key(merchant_id,declaration_id) references public.merchant_attendance_outage_declarations(merchant_id,declaration_id),
  foreign key(merchant_id,worker_id) references public.merchant_attendance_workers(merchant_id,id),
  foreign key(merchant_id,employee_id) references public.merchant_enterprise_employees(merchant_id,id),
  check(((access='owner' and action in('propose','resolve','reopen') and actor_employee_id is null)
    or (access='self' and action in('confirm','dispute') and actor_employee_id is not null and actor_employee_id=employee_id and actor_auth_user_id=employee_auth_user_id)) is true),
  check((public.faolla_attendance_outage_review_command_v1(command) is true and command->>'operationId'=operation_id::text and command->>'action'=action
    and (command->>'expectedRevision')::integer=revision-1 and (command->>'expectedResultVersion')::integer=result_version-(case when action='propose' then 1 else 0 end)
    and command->>'expectedFingerprint'=result_fingerprint and command_fingerprint=public.faolla_attendance_outage_review_hash_v1(merchant_id,access,declaration_id,command)) is true),
  check(((action='propose' and evidence is not null and octet_length(convert_to(evidence::text,'UTF8'))<=131072
      and result_fingerprint=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')) or (action<>'propose' and evidence is null)) is true)
);
alter table public.merchant_attendance_outage_review_operations enable row level security;
revoke all on public.merchant_attendance_outage_review_operations from public,anon,authenticated,service_role;

--Only immutable rows are consulted here. Never validate a historical receipt
--using current sources, active status, credentials, timezone data, or epochs.
create or replace function public.faolla_attendance_outage_review_entry_v1(p public.merchant_attendance_outage_review_operations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare d public.merchant_attendance_outage_declarations%rowtype;previous public.merchant_attendance_outage_review_operations%rowtype;
  proposal public.merchant_attendance_outage_review_operations%rowtype;link public.merchant_attendance_outage_link_operations%rowtype;
  original jsonb;checked jsonb;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  select * into d from public.merchant_attendance_outage_declarations where merchant_id=p.merchant_id and declaration_id=p.declaration_id;
  if d.declaration_id is null or p.recorded_at<d.recorded_at
    or row(p.worker_id,p.employee_id,p.employee_auth_user_id) is distinct from row(d.worker_id,d.employee_id,d.employee_auth_user_id)
    or public.faolla_attendance_outage_review_command_v1(p.command) is distinct from true
    or p.command_fingerprint is distinct from public.faolla_attendance_outage_review_hash_v1(p.merchant_id,p.access,p.declaration_id,p.command) then raise exception 'attendance_outage_review_invalid';end if;
  if p.revision>1 then
    select * into previous from public.merchant_attendance_outage_review_operations where merchant_id=p.merchant_id and declaration_id=p.declaration_id and revision=p.revision-1;
    if previous.operation_id is null or previous.recorded_at>p.recorded_at then raise exception 'attendance_outage_review_invalid';end if;
  end if;
  if p.action='propose' then
    if previous.action='resolve' or p.result_version<>coalesce(previous.result_version,0)+1
      or public.faolla_attendance_shift_rule_binding_object_v1(p.evidence,array['protocol','siteId','declarationId','linkOperationId','linkRevision','linkFingerprint','linkEvidence','original']) is distinct from true
      or p.evidence->>'protocol' is distinct from 'outage-review-evidence-v1' or p.evidence->>'siteId' is distinct from p.merchant_id
      or p.evidence->>'declarationId' is distinct from p.declaration_id::text
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.evidence->'linkOperationId','uuid') is distinct from true
      or public.faolla_attendance_shift_rule_binding_scalar_v1(p.evidence->'linkRevision','version') is distinct from true
      or (p.evidence->>'linkRevision')::numeric>99 then raise exception 'attendance_outage_review_invalid';end if;
    select * into link from public.merchant_attendance_outage_link_operations where merchant_id=p.merchant_id and operation_id=(p.evidence->>'linkOperationId')::uuid;
    checked:=public.faolla_attendance_outage_link_entry_v1(link);
    if link.operation_id is null or link.declaration_id<>p.declaration_id or link.action<>'apply' or link.recorded_at>p.recorded_at
      or p.evidence->'linkRevision' is distinct from to_jsonb(link.revision) or p.evidence->>'linkFingerprint' is distinct from link.source_fingerprint
      or p.evidence->'linkEvidence' is distinct from link.evidence or p.result_fingerprint is distinct from encode(sha256(convert_to(p.evidence::text,'UTF8')),'hex') then raise exception 'attendance_outage_review_invalid';end if;
    original:=p.evidence->'original';
    if public.faolla_attendance_shift_rule_binding_object_v1(original,array['status','operationId','channel','eventId']) is distinct from true
      or jsonb_typeof(original->'status') is distinct from 'string' or original->>'status' not in('not_required','verified','unresolved')
      or original->'operationId' is distinct from coalesce(to_jsonb(d.original_operation_id),'null'::jsonb)
      or original->'channel' is distinct from coalesce(to_jsonb(d.original_channel),'null'::jsonb)
      or (d.original_operation_id is null) is distinct from (original->>'status'='not_required')
      or (original->>'status'='verified' and (public.faolla_attendance_shift_rule_binding_scalar_v1(original->'eventId','uuid') is distinct from true or d.original_channel not in('web','location','onsite','pin')))
      or (original->>'status'<>'verified' and original->'eventId' is distinct from 'null'::jsonb) then raise exception 'attendance_outage_review_invalid';end if;
    if original->>'status'='verified' and not exists(select 1 from public.merchant_attendance_events ev where ev.id=(original->>'eventId')::uuid
      and row(ev.merchant_id,ev.worker_id,ev.actor_employee_id,ev.operation_id) is not distinct from row(d.merchant_id,d.worker_id,d.employee_id,d.original_operation_id)
      and exists(select 1 from jsonb_array_elements(link.evidence->'items') item(value) join public.merchant_attendance_events first_event
        on first_event.id=(item.value->'reference'->>'startEventId')::uuid and first_event.merchant_id=d.merchant_id and first_event.worker_id=d.worker_id
        where item.value->'reference'->>'kind'='session' and ev.sequence between first_event.sequence and (item.value->'reference'->>'lastSequence')::bigint)) then raise exception 'attendance_outage_review_invalid';end if;
  else
    if previous.operation_id is null or p.result_version<>previous.result_version
      or (p.action='confirm' and previous.action not in('propose','dispute','reopen'))
      or (p.action='resolve' and previous.action<>'confirm') or (p.action='reopen' and previous.action<>'resolve') then raise exception 'attendance_outage_review_invalid';end if;
    select * into proposal from public.merchant_attendance_outage_review_operations where merchant_id=p.merchant_id and declaration_id=p.declaration_id
      and result_version=p.result_version and action='propose' order by revision desc limit 1;
    if proposal.operation_id is null or proposal.revision>=p.revision or proposal.result_fingerprint<>p.result_fingerprint then raise exception 'attendance_outage_review_invalid';end if;
    if p.action in('confirm','resolve') and (proposal.evidence->'original'->>'status'='unresolved'
      or exists(select 1 from jsonb_array_elements(proposal.evidence->'linkEvidence'->'items') item(value)
        where item.value->'open' is distinct from 'false'::jsonb or item.value->'pending' is distinct from 'false'::jsonb)) then raise exception 'attendance_outage_review_invalid';end if;
  end if;
  return jsonb_build_object('operationId',p.operation_id,'revision',p.revision,'action',p.action,'actorId',p.actor_auth_user_id,'resultVersion',p.result_version,
    'resultFingerprint',p.result_fingerprint,'reason',p.command->'reason','recordedAt',to_char(p.recorded_at at time zone 'UTC',fmt));
end;
$$;
create or replace function public.faolla_attendance_outage_review_proposal_v1(p public.merchant_attendance_outage_review_operations)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare item jsonb;
begin
  if p.operation_id is null then return null;end if;
  if p.action<>'propose' then raise exception 'attendance_outage_review_invalid';end if;
  item:=public.faolla_attendance_outage_review_entry_v1(p);
  return item||jsonb_build_object('evidence',p.evidence,'sourceText',p.evidence::text);
end;
$$;
create or replace function public.faolla_attendance_outage_review_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform public.faolla_attendance_outage_review_entry_v1(new);return new;
end;
$$;
do $outage_review_triggers$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_review_operations'::regclass and tgname='attendance_outage_review_immutable') then
    create trigger attendance_outage_review_immutable before update or delete on public.merchant_attendance_outage_review_operations for each row execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_review_operations'::regclass and tgname='attendance_outage_review_no_truncate') then
    create trigger attendance_outage_review_no_truncate before truncate on public.merchant_attendance_outage_review_operations for each statement execute function public.faolla_attendance_events_append_only_v1();end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_outage_review_operations'::regclass and tgname='attendance_outage_review_valid') then
    create trigger attendance_outage_review_valid after insert on public.merchant_attendance_outage_review_operations for each row execute function public.faolla_attendance_outage_review_guard_v1();end if;
end;
$outage_review_triggers$;

--PRIVATE historical original-operation proof, not a replay/authentication
--shortcut. Missing, contradictory and unsupported channel proofs stay unknown.
create or replace function public.faolla_attendance_outage_review_original_v1(d public.merchant_attendance_outage_declarations,p_link_evidence jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare ev public.merchant_attendance_events%rowtype;pr public.merchant_attendance_pin_clock_receipts%rowtype;
  qr public.merchant_attendance_onsite_receipts%rowtype;lr public.merchant_attendance_location_clock_notices%rowtype;
  gr public.merchant_attendance_location_results%rowtype;item jsonb;proof jsonb;actual_ref jsonb;c jsonb;k text;failure text;
  known boolean:=false;ok boolean:=false;paired bigint;issued bigint;expires bigint;event_ms numeric;unresolved jsonb;
begin
  if d.original_operation_id is null then return jsonb_build_object('status','not_required','operationId',null,'channel',null,'eventId',null);end if;
  unresolved:=jsonb_build_object('status','unresolved','operationId',d.original_operation_id,'channel',d.original_channel,'eventId',null);
  if d.original_channel not in('web','location','onsite','pin') or p_link_evidence is null then return unresolved;end if;
  select * into ev from public.merchant_attendance_events where merchant_id=d.merchant_id and worker_id=d.worker_id and operation_id=d.original_operation_id;
  if ev.id is null or ev.actor_employee_id is distinct from d.employee_id then return unresolved;end if;
  for item in select value from jsonb_array_elements(p_link_evidence->'items') loop
    if item->'reference'->>'kind'<>'session' then continue;end if;
    begin
      proof:=public.faolla_attendance_period_session_v1(d.merchant_id,d.worker_id,(item->'reference'->>'startEventId')::uuid,d.employee_id,d.employee_auth_user_id,clock_timestamp());
    exception when raise_exception then
      get stacked diagnostics failure=message_text;
      if failure in('attendance_period_source_identity_changed','attendance_period_source_identity_unproven','attendance_worker_changed',
        'attendance_period_source_invalid','attendance_report_invalid_data') then return unresolved;else raise;end if;
    end;
    actual_ref:=jsonb_build_object('kind','session','startEventId',item->'reference'->'startEventId',
      'lastEventId',proof->'item'->'events'->-1->'id','lastSequence',proof->'item'->'events'->-1->'sequence',
      'effectOperationId',proof->'item'->'effect'->'operationId','effectRevision',proof->'item'->'effect'->'revision');
    if actual_ref=item->'reference' and exists(select 1 from jsonb_array_elements(proof->'item'->'events') original_event(value) where original_event.value->>'id'=ev.id::text) then known:=true;exit;end if;
  end loop;
  if not known then return unresolved;end if;
  --Lookup by event_id alone: contradictory/cross-scope sidecars must not vanish
  --behind a merchant filter and accidentally turn a location event into web.
  select * into pr from public.merchant_attendance_pin_clock_receipts where event_id=ev.id;
  select * into qr from public.merchant_attendance_onsite_receipts where event_id=ev.id;
  select * into lr from public.merchant_attendance_location_clock_notices where event_id=ev.id;
  select * into gr from public.merchant_attendance_location_results where event_id=ev.id;
  if d.original_channel='web' then
    ok:=ev.source='web' and pr.event_id is null and qr.event_id is null and lr.event_id is null and gr.event_id is null;
  elsif d.original_channel in('pin','onsite') then
    if ev.occurred_at<>ev.received_at or date_trunc('milliseconds',ev.occurred_at)<>ev.occurred_at then return unresolved;end if;
    if d.original_channel='pin' then
      ok:=ev.source='kiosk' and pr.event_id=ev.id and qr.event_id is null and lr.event_id is null and gr.event_id is null and pr.terminal_id is not null
        and row(pr.merchant_id,pr.worker_id,pr.employee_id,pr.operation_id) is not distinct from row(d.merchant_id,d.worker_id,d.employee_id,d.original_operation_id);c:=pr.command;
    else
      ok:=ev.source='web' and qr.event_id=ev.id and pr.event_id is null and lr.event_id is null and gr.event_id is null and qr.terminal_id is not null
        and row(qr.merchant_id,qr.worker_id,qr.employee_id,qr.operation_id) is not distinct from row(d.merchant_id,d.worker_id,d.employee_id,d.original_operation_id);c:=qr.command;
      if public.faolla_attendance_shift_rule_binding_object_v1(qr.claims,array['v','purpose','siteId','terminalId','locationId','pairedAtMs','issuedAtMs','expiresAtMs','nonce']) is distinct from true
        or qr.claims->'v' is distinct from '1'::jsonb or qr.claims->>'purpose' is distinct from 'faolla.attendance.onsite'
        or qr.claims->>'siteId' is distinct from d.merchant_id or qr.claims->>'terminalId' is distinct from qr.terminal_id::text
        or qr.claims->>'locationId' is distinct from ev.location_id::text or qr.claims->>'nonce' is distinct from qr.nonce::text
        or public.faolla_attendance_shift_rule_binding_scalar_v1(qr.claims->'terminalId','uuid') is distinct from true
        or public.faolla_attendance_shift_rule_binding_scalar_v1(qr.claims->'nonce','uuid') is distinct from true then return unresolved;end if;
      foreach k in array array['pairedAtMs','issuedAtMs','expiresAtMs'] loop
        if jsonb_typeof(qr.claims->k) is distinct from 'number' or coalesce(qr.claims->>k,'')!~'^(0|[1-9][0-9]{0,15})$'
          or (qr.claims->>k)::numeric>9007199254740991 then return unresolved;end if;
      end loop;
      paired:=(qr.claims->>'pairedAtMs')::bigint;issued:=(qr.claims->>'issuedAtMs')::bigint;expires:=(qr.claims->>'expiresAtMs')::bigint;
      event_ms:=floor(extract(epoch from ev.occurred_at)*1000);
      if issued<paired or expires-issued<>45000 or event_ms<issued or event_ms>=expires then return unresolved;end if;
    end if;
    ok:=ok and public.faolla_attendance_shift_rule_binding_object_v1(c,array['operationId','locationId','action','expectedSequence','expectedWorkerId','expectedEmployeeId']) is true
      and c->>'operationId'=ev.operation_id::text and c->>'action'=ev.action and c->>'locationId'=ev.location_id::text and c->'expectedSequence'=to_jsonb(ev.sequence-1)
      and c->>'expectedWorkerId'=d.worker_id::text and c->>'expectedEmployeeId'=d.employee_id::text;
  else
    c:=lr.command;
    ok:=ev.source='web' and ev.occurred_at=ev.received_at and lr.event_id=ev.id and gr.event_id=ev.id and pr.event_id is null and qr.event_id is null
      and row(lr.merchant_id,lr.worker_id,lr.employee_id,lr.location_id) is not distinct from row(d.merchant_id,d.worker_id,d.employee_id,ev.location_id)
      and public.faolla_attendance_shift_rule_binding_object_v1(c,array['operationId','locationId','action','expectedSequence','settingsVersion','workerVersion','locationVersion','noticeRevision','safeFinish']) is true
      and c->>'operationId'=ev.operation_id::text and c->>'action'=ev.action and c->>'locationId'=ev.location_id::text and c->'expectedSequence'=to_jsonb(ev.sequence-1)
      and c->'safeFinish'=to_jsonb(lr.safe_finish) and c->'noticeRevision'=coalesce(to_jsonb(lr.notice_revision),'null'::jsonb);
    foreach k in array array['settingsVersion','workerVersion','locationVersion'] loop
      ok:=ok and public.faolla_attendance_shift_rule_binding_scalar_v1(c->k,'version') is true;
    end loop;
    if lr.safe_finish then
      --113's real safe-finish success did not CAS these version assertions.
      --Preserve its immutable command; do not invent a stronger old success.
      ok:=ok and lr.notice_revision is null and ev.action in('break_end','clock_out');
    else
      ok:=ok and lr.notice_revision is not null and c->'settingsVersion'=to_jsonb(gr.settings_version)
        and c->'workerVersion'=to_jsonb(gr.worker_version) and c->'locationVersion'=to_jsonb(gr.location_version);
    end if;
  end if;
  if ok is distinct from true then return unresolved;end if;
  return jsonb_build_object('status','verified','operationId',d.original_operation_id,'channel',d.original_channel,'eventId',ev.id);
end;
$$;

--PRIVATE: caller holds merchant/settings/worker/employee locks. The returned
--candidate does not include review revision, response, read time or seal state.
create or replace function public.faolla_attendance_outage_review_basis_v1(d public.merchant_attendance_outage_declarations,
  p_worker_version bigint,p_employee_version bigint,p_generation bigint,p_identity boolean)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare link public.merchant_attendance_outage_link_operations%rowtype;checked jsonb;preview jsonb;original jsonb;evidence jsonb;fp text;
  blockers jsonb:='[]';preparable boolean:=false;
begin
  select * into link from public.merchant_attendance_outage_link_operations where merchant_id=d.merchant_id and declaration_id=d.declaration_id order by revision desc limit 1;
  if link.operation_id is null then blockers:='["link_missing"]';
  else
    checked:=public.faolla_attendance_outage_link_entry_v1(link);
    if link.action='revoke' then blockers:='["link_revoked"]';
    else
      preview:=public.faolla_attendance_outage_link_preview_v1(d,link.sources,p_worker_version,p_employee_version,p_generation,p_identity,link.evidence);
      blockers:=preview->'blockers';preparable:=preview->'eligible'='true'::jsonb;
      original:=public.faolla_attendance_outage_review_original_v1(d,nullif(preview->'evidence','null'::jsonb));
      if preview->'evidence'<>'null'::jsonb then
        evidence:=jsonb_build_object('protocol','outage-review-evidence-v1','siteId',d.merchant_id,'declarationId',d.declaration_id,
          'linkOperationId',link.operation_id,'linkRevision',link.revision,'linkFingerprint',link.source_fingerprint,'linkEvidence',preview->'evidence','original',original);
        if octet_length(convert_to(evidence::text,'UTF8'))>131072 then raise exception 'attendance_outage_review_too_large';end if;
        fp:=encode(sha256(convert_to(evidence::text,'UTF8')),'hex');
      end if;
    end if;
  end if;
  if original is null then original:=jsonb_build_object('status',case when d.original_operation_id is null then 'not_required' else 'unresolved' end,
    'operationId',d.original_operation_id,'channel',d.original_channel,'eventId',null);end if;
  if original->>'status'='unresolved' then blockers:=blockers||'"original_unknown"'::jsonb;end if;
  if not p_identity then blockers:=blockers||'"identity_changed"'::jsonb;end if;
  return jsonb_build_object('evidence',evidence,'fingerprint',fp,'linkOperationId',link.operation_id,'linkRevision',coalesce(link.revision,0),
    'linkFingerprint',link.source_fingerprint,'blockers',(select coalesce(jsonb_agg(value order by value),'[]') from (select distinct value from jsonb_array_elements(blockers)) b),
    'preparable',preparable);
end;
$$;

create or replace function public.faolla_attendance_outage_review_v1(p_query jsonb,p_auth_user_id uuid,p_command jsonb default null,p_allow_write boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare site text;access_name text;mode_name text;action_name text;did uuid;op uuid;before_rev integer;keys text[];
  d public.merchant_attendance_outage_declarations%rowtype;w public.merchant_attendance_workers%rowtype;e public.merchant_enterprise_employees%rowtype;
  s public.merchant_attendance_settings%rowtype;r public.merchant_enterprise_roles%rowtype;epoch public.merchant_attendance_account_epochs%rowtype;
  head public.merchant_attendance_outage_review_operations%rowtype;proposal_row public.merchant_attendance_outage_review_operations%rowtype;
  response_row public.merchant_attendance_outage_review_operations%rowtype;saved public.merchant_attendance_outage_review_operations%rowtype;history_row public.merchant_attendance_outage_review_operations%rowtype;
  revision_no integer:=0;version_no integer:=0;generation_no bigint;identity_ok boolean;member_ready boolean;source_ready boolean:=false;
  basis jsonb;blocks jsonb;current_item jsonb;proposal_item jsonb;response_item jsonb;status_item jsonb;receipt jsonb;history jsonb:='[]';truncated boolean:=false;
  can_write boolean:=false;can_propose boolean:=false;can_confirm boolean:=false;can_resolve boolean:=false;is_resolved boolean:=false;
  evidence jsonb;result_fp text;entry jsonb;stamp timestamptz;result jsonb;n integer:=0;fmt constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_auth_user_id is null or p_allow_write is null or p_query is null or octet_length(convert_to(p_query::text,'UTF8'))>8192
    or jsonb_typeof(p_query->'siteId') is distinct from 'string' or p_query->>'siteId'!~'^[0-9]{8}$'
    or jsonb_typeof(p_query->'access') is distinct from 'string' or p_query->>'access' not in('owner','self')
    or jsonb_typeof(p_query->'mode') is distinct from 'string' or p_query->>'mode' not in('detail','history','recover')
    or public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'declarationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;
  site:=p_query->>'siteId';access_name:=p_query->>'access';mode_name:=p_query->>'mode';did:=(p_query->>'declarationId')::uuid;
  keys:=array['siteId','access','mode','declarationId']||case mode_name when 'history' then array['beforeRevision'] when 'recover' then array['operationId'] else array[]::text[] end;
  if public.faolla_attendance_shift_rule_binding_object_v1(p_query,keys) is distinct from true then raise exception 'attendance_invalid_request';end if;
  if mode_name='history' then
    if p_query->'beforeRevision'<>'null'::jsonb and (public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'beforeRevision','version') is distinct from true
      or (p_query->>'beforeRevision')::numeric>1001) then raise exception 'attendance_invalid_request';end if;
    before_rev:=(p_query->>'beforeRevision')::integer;
  elsif mode_name='recover' then
    if public.faolla_attendance_shift_rule_binding_scalar_v1(p_query->'operationId','uuid') is distinct from true then raise exception 'attendance_invalid_request';end if;op:=(p_query->>'operationId')::uuid;
  end if;
  if p_command is not null then
    if mode_name<>'detail' or public.faolla_attendance_outage_review_command_v1(p_command) is distinct from true
      or (access_name='self') is distinct from (p_command->>'action' in('confirm','dispute')) then raise exception 'attendance_invalid_request';end if;
    op:=(p_command->>'operationId')::uuid;action_name:=p_command->>'action';
  end if;
  --Same serialization boundary as176/177, status capture and period writers.
  --Do not acquire an employee lock and subsequently upgrade settings/worker.
  perform 1 from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share;
  if not found then raise exception 'attendance_access_denied';end if;
  select * into s from public.merchant_attendance_settings where merchant_id=site for update;
  if not found then raise exception 'attendance_settings_required';end if;
  select * into d from public.merchant_attendance_outage_declarations where merchant_id=site and declaration_id=did;
  if d.declaration_id is null then raise exception 'attendance_outage_review_not_found';end if;
  select * into w from public.merchant_attendance_workers where merchant_id=site and id=d.worker_id for update;
  select * into e from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share;
  identity_ok:=row(w.id,w.employee_id,e.id,e.auth_user_id) is not distinct from row(d.worker_id,d.employee_id,d.employee_id,d.employee_auth_user_id);
  if access_name='self' then
    if not identity_ok or e.auth_user_id is distinct from p_auth_user_id or e.status<>'active' then raise exception 'attendance_access_denied';end if;
    select * into r from public.merchant_enterprise_roles where merchant_id=site and id=e.role_id for share;
    if r.id is null or r.status<>'active' or public.faolla_valid_merchant_enterprise_permissions_v1(r.permissions) is distinct from true
      or not r.permissions @> array['enterprise.view','attendance.self.view','attendance.self.request']::text[] then raise exception 'attendance_access_denied';end if;
  end if;
  select * into epoch from public.merchant_attendance_account_epochs where merchant_id=site and employee_id=d.employee_id;
  generation_no:=coalesce(epoch.generation,0);
  --Current authorization is still required. Exact historical recovery precedes
  --all current source, pause, flag, revision-cap, and new-action checks.
  if op is not null then
    select * into saved from public.merchant_attendance_outage_review_operations where merchant_id=site and operation_id=op;
    if saved.operation_id is not null then
      if saved.declaration_id<>did or saved.access<>access_name or saved.actor_auth_user_id<>p_auth_user_id
        or (access_name='self' and row(saved.worker_id,saved.employee_id,saved.employee_auth_user_id,saved.actor_employee_id)
          is distinct from row(w.id,e.id,e.auth_user_id,e.id)) then raise exception 'attendance_access_denied';end if;
      if p_command is not null and saved.command is distinct from p_command then raise exception 'attendance_operation_conflict';end if;
    elsif mode_name='recover' then raise exception 'attendance_outage_review_not_found';end if;
  end if;
  if saved.operation_id is null then
    select * into head from public.merchant_attendance_outage_review_operations where merchant_id=site and declaration_id=did order by revision desc limit 1;
    revision_no:=coalesce(head.revision,0);version_no:=coalesce(head.result_version,0);
    if head.operation_id is not null then
      current_item:=public.faolla_attendance_outage_review_entry_v1(head);
      select * into proposal_row from public.merchant_attendance_outage_review_operations where merchant_id=site and declaration_id=did and result_version=version_no and action='propose' order by revision desc limit 1;
      if proposal_row.operation_id is null then raise exception 'attendance_outage_review_invalid';end if;
      proposal_item:=public.faolla_attendance_outage_review_proposal_v1(proposal_row);
      select * into response_row from public.merchant_attendance_outage_review_operations where merchant_id=site and declaration_id=did and result_version=version_no and action in('confirm','dispute') order by revision desc limit 1;
      if response_row.operation_id is not null then response_item:=public.faolla_attendance_outage_review_entry_v1(response_row);end if;
    end if;
    if p_command is not null then
      if not p_allow_write then raise exception 'attendance_outage_review_disabled';end if;
      if action_name not in('dispute','reopen') and not s.enabled then raise exception 'attendance_platform_paused';end if;
      if revision_no<>(p_command->>'expectedRevision')::integer or version_no<>(p_command->>'expectedResultVersion')::integer then raise exception 'attendance_outage_review_changed';end if;
      if revision_no>=1000 or (action_name not in('dispute','reopen') and revision_no>=998) then raise exception 'attendance_outage_review_limit';end if;
      if action_name<>'propose' and (proposal_row.operation_id is null or proposal_row.result_fingerprint is distinct from p_command->>'expectedFingerprint') then raise exception 'attendance_outage_review_changed';end if;
    end if;
    --Safety actions and history do not recollect a broken/oversized source.
    if mode_name='detail' and (p_command is null or action_name in('propose','confirm','resolve')) then
      basis:=public.faolla_attendance_outage_review_basis_v1(d,w.version,e.version,generation_no,identity_ok);
      blocks:=basis->'blockers';
      member_ready:=identity_ok and coalesce(w.active,false) and coalesce(e.status='active',false);
      if not member_ready then blocks:=blocks||'"employee_unavailable"'::jsonb;end if;
      if coalesce(epoch.paused,false) then blocks:=blocks||'"account_suspended"'::jsonb;end if;
      if proposal_row.operation_id is null then blocks:=blocks||'"result_missing"'::jsonb;
      else
        if row(basis->>'linkOperationId',basis->>'linkRevision',basis->>'linkFingerprint') is distinct from
          row(proposal_row.evidence->>'linkOperationId',proposal_row.evidence->>'linkRevision',proposal_row.evidence->>'linkFingerprint') then blocks:=blocks||'"link_changed"'::jsonb;end if;
        if basis->>'fingerprint' is distinct from proposal_row.result_fingerprint then blocks:=blocks||'"result_changed"'::jsonb;end if;
      end if;
      source_ready:=proposal_row.operation_id is not null and blocks='[]'::jsonb;
      if response_row.action='dispute' then blocks:=blocks||'"disputed"'::jsonb;
      elsif response_row.action is distinct from 'confirm' then blocks:=blocks||'"unconfirmed"'::jsonb;end if;
      if head.action='reopen' then blocks:=blocks||'"reopened"'::jsonb;end if;
      select coalesce(jsonb_agg(value order by value),'[]') into blocks from (select distinct value from jsonb_array_elements(blocks)) b;
      can_write:=p_allow_write and revision_no<1000;
      can_propose:=access_name='owner' and can_write and s.enabled and revision_no<=997 and identity_ok
        and basis->'preparable'='true'::jsonb and basis->>'fingerprint' is not null and head.action is distinct from 'resolve';
      can_confirm:=access_name='self' and can_write and s.enabled and revision_no<=997 and source_ready and head.action in('propose','dispute','reopen');
      can_resolve:=access_name='owner' and can_write and s.enabled and revision_no<=997 and source_ready and head.action='confirm' and response_row.action='confirm';
      is_resolved:=coalesce(head.action='resolve' and source_ready and response_row.action='confirm',false);
      status_item:=jsonb_build_object('basisFingerprint',basis->'fingerprint','linkOperationId',basis->'linkOperationId','linkRevision',basis->'linkRevision',
        'linkFingerprint',basis->'linkFingerprint','blockers',blocks,'canPropose',coalesce(can_propose,false),'canConfirm',coalesce(can_confirm,false),
        'canResolve',coalesce(can_resolve,false),'resolved',is_resolved);
    end if;
    if p_command is not null then
      if action_name='propose' then
        if not coalesce(can_propose,false) then raise exception 'attendance_outage_review_blocked';end if;
        if basis->>'fingerprint' is distinct from p_command->>'expectedFingerprint' then raise exception 'attendance_outage_review_changed';end if;
        evidence:=basis->'evidence';result_fp:=basis->>'fingerprint';version_no:=version_no+1;
      else
        result_fp:=proposal_row.result_fingerprint;
        if (action_name='confirm' and not coalesce(can_confirm,false)) or (action_name='resolve' and not coalesce(can_resolve,false))
          or (action_name='reopen' and head.action is distinct from 'resolve') then raise exception 'attendance_outage_review_blocked';end if;
      end if;
      stamp:=clock_timestamp();
      if stamp<d.recorded_at or stamp<head.recorded_at then raise exception 'attendance_outage_review_changed';end if;
      insert into public.merchant_attendance_outage_review_operations(merchant_id,declaration_id,operation_id,revision,access,action,actor_auth_user_id,actor_employee_id,
        worker_id,employee_id,employee_auth_user_id,result_version,result_fingerprint,command,command_fingerprint,evidence,recorded_at)
        values(site,did,op,revision_no+1,access_name,action_name,p_auth_user_id,case when access_name='self' then e.id else null end,
          d.worker_id,d.employee_id,d.employee_auth_user_id,version_no,result_fp,p_command,public.faolla_attendance_outage_review_hash_v1(site,access_name,did,p_command),evidence,stamp) returning * into saved;
    elsif mode_name='history' then
      for history_row in select x.* from public.merchant_attendance_outage_review_operations x where x.merchant_id=site and x.declaration_id=did
        and (before_rev is null or x.revision<before_rev) order by x.revision desc limit 26 loop
        n:=n+1;if n>25 then truncated:=true;exit;end if;
        history:=history||jsonb_build_array(public.faolla_attendance_outage_review_entry_v1(history_row));
      end loop;
      current_item:=null;proposal_item:=null;response_item:=null;status_item:=null;can_write:=false;
    end if;
  end if;
  if saved.operation_id is not null then
    entry:=public.faolla_attendance_outage_review_entry_v1(saved);
    select * into proposal_row from public.merchant_attendance_outage_review_operations where merchant_id=site and declaration_id=did and result_version=saved.result_version and action='propose' order by revision desc limit 1;
    if proposal_row.operation_id is null then raise exception 'attendance_outage_review_invalid';end if;
    receipt:=jsonb_build_object('operationId',saved.operation_id,'commandFingerprint',saved.command_fingerprint,'entry',entry,
      'proposal',public.faolla_attendance_outage_review_proposal_v1(proposal_row));
    revision_no:=saved.revision;version_no:=saved.result_version;
    current_item:=null;proposal_item:=null;response_item:=null;status_item:=null;history:='[]';truncated:=false;can_write:=false;
  end if;
  result:=jsonb_build_object('protocol','attendance-outage-review-v1','siteId',site,'access',access_name,'mode',mode_name,'actorId',p_auth_user_id,'declarationId',did,
    'readAt',to_char(clock_timestamp() at time zone 'UTC',fmt),'canWrite',can_write,'revision',revision_no,'resultVersion',version_no,'current',current_item,
    'proposal',proposal_item,'response',response_item,'status',status_item,'history',history,'historyTruncated',truncated,'receipt',receipt);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then raise exception 'attendance_outage_review_too_large';end if;
  return result;
end;
$$;

revoke all on function public.faolla_attendance_outage_review_command_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_review_hash_v1(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_review_original_v1(public.merchant_attendance_outage_declarations,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_review_basis_v1(public.merchant_attendance_outage_declarations,bigint,bigint,bigint,boolean) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_review_entry_v1(public.merchant_attendance_outage_review_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_review_proposal_v1(public.merchant_attendance_outage_review_operations) from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_review_guard_v1() from public,anon,authenticated,service_role;
revoke all on function public.faolla_attendance_outage_review_v1(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.faolla_attendance_outage_review_v1(jsonb,uuid,jsonb,boolean) to service_role;
do $outage_review_permissions$
declare p record;r text;priv text;t regclass:='public.merchant_attendance_outage_review_operations'::regclass;n integer:=0;
begin
  for p in select oid,proname,prosecdef,proconfig from pg_proc where pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)
    and proname=any(array['faolla_attendance_outage_review_command_v1','faolla_attendance_outage_review_hash_v1','faolla_attendance_outage_review_original_v1',
      'faolla_attendance_outage_review_basis_v1','faolla_attendance_outage_review_entry_v1','faolla_attendance_outage_review_proposal_v1','faolla_attendance_outage_review_guard_v1','faolla_attendance_outage_review_v1']) loop
    n:=n+1;
    if p.prosecdef<>(p.proname in('faolla_attendance_outage_review_v1','faolla_attendance_outage_review_guard_v1'))
      or p.proconfig is distinct from array['search_path=pg_catalog']::text[]
      or exists(select 1 from pg_proc x cross join lateral aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) a where x.oid=p.oid and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'merchant_attendance_outage_reviews_permission_conflict';end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r,p.oid,'EXECUTE') is distinct from (r='service_role' and p.proname='faolla_attendance_outage_review_v1') then raise exception 'merchant_attendance_outage_reviews_permission_conflict';end if;
    end loop;
  end loop;
  if n<>8 or not (select relrowsecurity from pg_class where oid=t) or exists(select 1 from pg_policy where polrelid=t)
    or exists(select 1 from pg_class x cross join lateral aclexplode(coalesce(x.relacl,acldefault('r',x.relowner))) a where x.oid=t and a.grantee=0) then raise exception 'merchant_attendance_outage_reviews_permission_conflict';end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    for priv in select a.privilege_type from pg_class c cross join lateral aclexplode(acldefault('r',c.relowner)) a where c.oid=t loop
      if has_table_privilege(r,t,priv) then raise exception 'merchant_attendance_outage_reviews_permission_conflict';end if;
    end loop;
  end loop;
  if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal and tgenabled='O' and (
    (tgname='attendance_outage_review_immutable' and tgtype=27 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
    or (tgname='attendance_outage_review_no_truncate' and tgtype=34 and tgfoid='public.faolla_attendance_events_append_only_v1()'::regprocedure)
    or (tgname='attendance_outage_review_valid' and tgtype=5 and tgfoid='public.faolla_attendance_outage_review_guard_v1()'::regprocedure)))<>3 then raise exception 'merchant_attendance_outage_reviews_installation_conflict';end if;
end;
$outage_review_permissions$;
insert into public.faolla_schema_migrations(version,name) values(202610070178,'merchant_attendance_outage_reviews') on conflict(version) do nothing;
notify pgrst, 'reload schema';
commit;
