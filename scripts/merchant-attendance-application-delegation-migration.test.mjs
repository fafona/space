//191 static proofs only; PostgreSQL execution belongs to the root agent.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const filename='202610060162_merchant_attendance_application_delegation.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,'');
const has=(source,...parts)=>{for(const part of parts)assert(source.includes(part),part);};
const order=(source,...parts)=>{let at=-1;for(const part of parts){const next=source.indexOf(part,at+1);assert(next>at,part);at=next;}};
const fn=name=>{const a=sql.indexOf('create or replace function public.'+name+'('),b=sql.indexOf('$$;',a);assert(a>=0&&b>a,name);return sql.slice(a,b+3);};
const prefix='faolla_attendance_application_delegation_';
const command=fn(prefix+'command_v1'),hash=fn(prefix+'hash_v1'),usable=fn(prefix+'usable_v1'),review=fn(prefix+'review_v1'),receipt=fn(prefix+'receipt_v1');
const owner=fn('faolla_attendance_application_delegations_v1'),delegate=fn('faolla_attendance_delegated_applications_v1');
test('162 additive atomic migration has three private new tables and ten new functions only',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  assert.equal((clean.match(/create table if not exists public\./g)||[]).length,3);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[
    prefix+'command_v1',prefix+'hash_v1',prefix+'usable_v1',prefix+'grant_v1',prefix+'request_v1',prefix+'review_v1',
    prefix+'receipt_v1',prefix+'guard_v1','faolla_attendance_application_delegations_v1','faolla_attendance_delegated_applications_v1']);
  assert.doesNotMatch(clean,/\b(?:update public\.|delete from|truncate public\.|drop (?:table|function|index)|disable trigger|session_replication_role|set_config|statement_timeout|pg_advisory)/i);
  for(const m of clean.matchAll(/insert into public\.(\w+)/g))assert.match(m[1],/^(?:merchant_attendance_application_delegation(?:s|_revocations|_decisions)|merchant_attendance_leave_(?:entries|notifications)|merchant_attendance_work_arrangement_entries|faolla_schema_migrations)$/);
  assert.doesNotMatch(clean,/faolla_attendance_(?:leave_v1|leave_notify_v1|work_arrangement_v1|missing_v1)\(/);
});
test('prerequisites are registered and reentry rejects unregistered partial definitions',()=>{
  has(sql,"set local lock_timeout='3s'","(202610030122::bigint,'merchant_attendance_leave_requests')","(202610040125::bigint,'merchant_attendance_leave_notifications')",
    "(202610050150::bigint,'merchant_attendance_period_seal_guards')","(202610060156::bigint,'merchant_attendance_work_arrangements')",
    'installed<>(to_regclass','installed<>exists',"where oid='public.faolla_schema_migrations'::regclass");
  assert.doesNotMatch(sql,/'public'::regnamespace/);
  order(sql,'$application_delegation_postconditions$;', "values(202610060162,'merchant_attendance_application_delegation')",'commit;');
});
test('exact grant has mandatory category, canonical kinds, includePending and no location',()=>{
  has(command,"array['action','operationId','delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','category','kinds','includePending','validFrom','validUntil','reason']",
    "jsonb_typeof(d->'includePending') is distinct from 'boolean'","(values('trip',1),('field',2),('remote',3))",
    "d->'kinds' is distinct from kinds","d->>'category'='leave' and kinds<>'[]'::jsonb","d->>'category'='work_arrangement' and kinds='[]'::jsonb",
    "d->>'delegateEmployeeId'=d->>'employeeId'","d->>'delegateAuthUserId'=d->>'employeeAuthUserId'");
  assert.doesNotMatch(command,/locationId|default_location/);
});
test('command rejects null/extra keys and preserves old five or seven key decision commands',()=>{
  has(command,"coalesce(d->>'action','') not in('approve','reject')","array['grantId','expectedGrantRevision','expectedEvidenceFingerprint','decision']",
    "array['action','operationId','requestId','expectedRevision','reason']","array['action','operationId','requestId','expectedRevision','reason','expectedConflictsFingerprint','confirmConflicts']",
    "d->'expectedRevision' is distinct from '1'::jsonb","jsonb_typeof(d->'confirmConflicts') is distinct from 'boolean'",'>8192');
  has(delegate,"g.category='leave' and public.faolla_attendance_shift_rule_binding_object_v1(decision","g.category='work_arrangement' and public.faolla_attendance_work_arrangement_command_v1(decision)");
});
test('fixed scalar hash tuple includes grant, category kinds, explicit history policy and decision evidence',()=>{
  has(hash,"jsonb_build_array('attendance-application-delegation-v1',p_site,p_access)","string_agg(value,',' order by ord)",
    "p->>'category',kinds,(p->>'includePending')::boolean","p->>'expectedEvidenceFingerprint',d->>'requestId'",
    "d->>'expectedConflictsFingerprint',d->'confirmConflicts'","encode(sha256(convert_to(v::text,'UTF8')),'hex')");
});
test('authorization uses current two identities and category role with no self scope',()=>{
  has(usable,'p_at>=p.valid_from and p_at<p.valid_until','merchant_attendance_application_delegation_revocations',
    'de.id=p.delegate_employee_id and de.auth_user_id=p.delegate_auth_user_id',"de.status='active'",
    "'attendance.leave.review' else 'attendance.work_arrangement.review'",'w.employee_id=p.employee_id and te.auth_user_id=p.employee_auth_user_id',
    'de.auth_user_id<>te.auth_user_id');
  has(owner,"r.permissions && array['attendance.leave.review','attendance.work_arrangement.review']","case when p_command->>'category'='leave' then 'attendance.leave.review'");
});
test('both RPCs use only true actors and fixed lock order',()=>{
  for(const source of [owner,delegate]){
    has(source,'p_capture_notifications is null','from public.merchants m','for share','from public.merchant_attendance_settings x','for update',
      'from public.merchant_attendance_workers x','order by x.id for share');
    order(source,'from public.merchants m','from public.merchant_attendance_settings x','from public.merchant_attendance_workers x');
    assert.doesNotMatch(source,/m\.user_id\s*[,)]|p_auth_user_id\s*:=/);
  }
  has(owner,'m.user_id=p_auth_user_id');
  has(delegate,'x.id in(de.role_id,te.role_id) order by x.id for share');
});
test('feature off leaves only recover and safe owner revoke; pause grants remain empty',()=>{
  has(owner,"not p_allow_write and mode_name<>'recover' and action_name is distinct from 'revoke'");
  order(delegate,"if mode_name='recover' then","else\n    if not p_allow_write then");
  has(delegate,'where can_write and x.merchant_id=site','can_write:=p_allow_write and s.enabled');
});
test('lists filter saved identities, kind, explicit history and pending before bounded pagination',()=>{
  has(delegate,'x.employee_id=g.employee_id and x.actor_auth_user_id=g.employee_auth_user_id','g.kinds ? x.kind',
    '(g.include_pending or x.submitted_at>=g.recorded_at)','t.revision=2','order by c.submitted_at desc,c.request_id desc limit 26',
    '(x.submitted_at,x.request_id)<(cursor_at,cursor_id)');
  assert.doesNotMatch(delegate,/location_id|default_location/);
});
test('review checks saved request identities and employment before calculating evidence',()=>{
  has(review,"(r->>'worker_id')::uuid<>p.worker_id","(r->>'employee_id')::uuid<>p.employee_id","(r->>'actor_auth_user_id')::uuid<>p.employee_auth_user_id",
    "not p.include_pending and (r->>'submitted_at')::timestamptz<p.recorded_at","body->>'status'<>'submitted'","coverage<>1","merchant_attendance_employment_periods",
    "source:=jsonb_build_object('policy','person-application-review-v1'","'employment',employment,'bindingOk',binding_ok,'sealed',sealed");
  assert.doesNotMatch(review,/to_jsonb\(r\)|'observedAt'|'readAt'/);
});
test('work conflict fingerprint reuses old complete collector; leave never relaxes old approved overlap',()=>{
  has(review,'full_conflicts:=public.faolla_attendance_work_arrangement_conflicts_v1','x.end_at>a',
    "d.revision=2 and d.action='approve'",'t.revision=3','order by x.start_at,x.request_id limit 101',
    'jsonb_array_length(full_conflicts)>=100',"p.category='leave' and jsonb_array_length(full_conflicts)>0");
  has(delegate,"raise exception 'attendance_leave_overlap'","raise exception 'attendance_work_arrangement_conflicts_changed'","raise exception 'attendance_work_arrangement_conflict_confirmation_required'");
});
test('cross-category unauthorized conflict bodies remain hidden and block approval',()=>{
  has(review,'g.category=category_name',"(category_name='leave' or g.kinds ? kind_name)",
    "(other_submitted>=g.recorded_at or g.include_pending and other->>'status'='submitted')",
    'public.faolla_attendance_application_delegation_usable_v1(g,p_at)',
    "jsonb_build_object('source',case when piece->>'source'='schedule' then 'schedule' else 'application' end",
    "'kind',kind_name,'startAt',piece->'startAt','endAt',piece->'endAt','timeZone',piece->'timeZone'",
    'else hidden:=true','sealed or hidden');
  has(delegate,"review->'hiddenConflict' is distinct from 'false'::jsonb then raise exception 'attendance_access_denied'");
});
test('source CAS and expiry are checked after locked current review, before any decision insertion',()=>{
  order(delegate,'review:=public.faolla_attendance_application_delegation_review_v1',
    "p_command->>'expectedEvidenceFingerprint' is distinct from item->>'evidenceFingerprint'",
    'stamp:=clock_timestamp();','public.faolla_attendance_application_delegation_usable_v1(g,stamp)',
    'insert into public.merchant_attendance_leave_entries');
  has(delegate,"if stamp<(req_json->>'submitted_at')::timestamptz then raise exception 'attendance_version_conflict'");
});
test('only new approve is gated on sealed period, rejects remain available',()=>{
  order(delegate,"action_name:=decision->>'action'","if action_name='approve' then",'perform public.faolla_attendance_period_assert_open_v1');
  assert.equal((delegate.match(/perform public\.faolla_attendance_period_assert_open_v1/g)||[]).length,1);
  has(delegate,"'startAt',to_char((item->>'startAt')::timestamptz at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')",
    "'endAt',to_char((item->>'endAt')::timestamptz at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
  assert.doesNotMatch(delegate,/jsonb_build_object\('startAt',item->'startAt','endAt',item->'endAt'\)/);
});
test('old exact terminal entry, optional notification and mandatory authority are one transaction',()=>{
  order(delegate,'insert into public.merchant_attendance_leave_entries','if p_capture_notifications then',
    'insert into public.merchant_attendance_leave_notifications','insert into public.merchant_attendance_work_arrangement_entries',
    'insert into public.merchant_attendance_application_delegation_decisions','receipt:=public.faolla_attendance_application_delegation_receipt_v1(authority);');
  has(delegate,'values(site,op,target_request_id,2,action_name,p_auth_user_id,decision,snapshot,stamp)',
    "g.category='leave' and p_capture_notifications");
  assert.doesNotMatch(delegate,/exception when others|when check_violation|return.*error/);
  has(sql,'leave_operation_id uuid generated always as','work_operation_id uuid generated always as',
    'references public.merchant_attendance_leave_entries(merchant_id,operation_id)','references public.merchant_attendance_work_arrangement_entries(merchant_id,operation_id)');
});
test('historical receipt checks actual old row, grant and optional notification without current owner/permission gates',()=>{
  has(receipt,"entry_json->>'actor_auth_user_id' is distinct from p.delegate_auth_user_id::text",
    "entry_json->'command' is distinct from p.command->'decision'",'p.command_fingerprint is distinct from public.faolla_attendance_application_delegation_hash_v1',
    'if p.captured_notification then','n.recipient_auth_user_id','p.employee_auth_user_id,2,p.action,p.recorded_at',
    "'category',p.category","'actorId',p.delegate_auth_user_id");
  assert.doesNotMatch(receipt,/m\.user_id|permissions|_usable_v1\(|'reason',|'workerName',/);
});
test('recovery requires original actor and same employee/Auth, not activity or role; never backfills legacy',()=>{
  const a=delegate.indexOf("if mode_name='recover' then"),b=delegate.indexOf("else\n    if not p_allow_write then",a),recover=delegate.slice(a,b);
  has(recover,'x.auth_user_id=p_auth_user_id for share','authority.delegate_auth_user_id<>p_auth_user_id or authority.delegate_employee_id<>de.id');
  assert.doesNotMatch(recover,/\.status|permissions|insert into|_usable_v1/);
  has(delegate,'elsif exists(select 1 from public.merchant_attendance_leave_entries','or exists(select 1 from public.merchant_attendance_work_arrangement_entries',
    "raise exception 'attendance_operation_conflict'");
  has(owner,'g.actor_auth_user_id<>p_auth_user_id','rv.actor_auth_user_id<>p_auth_user_id');
});
test('private storage and helpers reject direct service access, RPCs alone service executable',()=>{
  has(sql,"enable row level security","revoke all on table %s from public,anon,authenticated,service_role",'before update or delete','before truncate',
    'before insert on public.merchant_attendance_application_delegation_decisions',
    "g.tgtype=27 and g.tgenabled='O'","g.tgtype=34 and g.tgenabled='O'","g.tgtype=7 and g.tgenabled='O'",
    "proconfig=array['search_path=pg_catalog']",'not prosecdef','and prosecdef','pg_policy');
  assert.equal((sql.match(/^grant execute on function /gm)||[]).length,2);
  has(sql,'faolla_attendance_delegated_applications_v1(jsonb,uuid,jsonb,boolean,boolean) to service_role',
    'faolla_attendance_application_delegations_v1(jsonb,uuid,jsonb,boolean,boolean) to service_role');
});
test('new-only lookup index and all object ACLs are reentry validated; fixed budgets never truncate conflicts',()=>{
  assert.equal((clean.match(/create index /g)||[]).length,1);
  has(sql,"am.amname='btree'",'i.indisvalid and i.indisready and i.indislive','i.indpred is null and i.indexprs is null','o.opcdefault','o.opcintype=a.atttypid',
    'i.indoption[z-1]<>0','i.indcollation[z-1]',"merchant_attendance_application_delegations'::regclass",
    '>131072','>1048576',"raise exception 'attendance_application_delegation_too_large'");
});
