// Static contracts only. SQL installation, dense fixtures and EXPLAIN belong to
// the root-owned local runtime; no capacity or planner claim follows from regex.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610050151_merchant_attendance_period_source_ranges.sql';
const read=name=>readFileSync(new URL(`./supabase-migrations/${name}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const source=read(filename),clean=source.replace(/--[^\n]*/g,'');
const old=read('202610050148_merchant_attendance_period_source.sql');
const reader=text=>{const at=text.indexOf('create or replace function public.faolla_attendance_period_source_v1(');assert(at>=0);return text.slice(at,text.indexOf('\n$$;',at)+4);};
const body=reader(source),prior=reader(old),has=(text,...parts)=>{for(const part of parts)assert(text.includes(part),part);};
const order=(text,...parts)=>{let at=-1;for(const part of parts){const next=text.indexOf(part,at+1);assert(next>at,part);at=next;}};
const between=(text,a,b)=>{const first=text.indexOf(a),last=text.indexOf(b,first);assert(first>=0&&last>first);return text.slice(first,last);};

test('151 adds two indexes and replaces only148 reader, without business writes or schema copies',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),['faolla_attendance_period_source_v1']);
  assert.deepEqual([...clean.matchAll(/create index concurrently if not exists (\w+)/g)].map(x=>x[1]),
    ['attendance_correction_proposal_period_idx','attendance_revision_proposal_period_idx']);
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(x=>x[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/create\s+(?:table|trigger)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop\s+(?:table|function|index)|reindex/i);
  assert.doesNotMatch(clean,/statement_timeout|pg_advisory|lock\s+table|session_replication_role|disable trigger/i);
});

test('concurrent builds remain outside transactions and cutover is after exact readiness validation',()=>{
  assert.equal((clean.match(/^begin;/gm)||[]).length,2);assert.equal((clean.match(/^commit;/gm)||[]).length,2);
  order(clean,'begin;',"set local lock_timeout='3s'",'$period_source_ranges_index_preflight$;','commit;',
    'create index concurrently if not exists attendance_correction_proposal_period_idx',
    'create index concurrently if not exists attendance_revision_proposal_period_idx','begin;',"set local lock_timeout='3s'",
    '$period_source_ranges_index_ready$;','create or replace function public.faolla_attendance_period_source_v1(',
    'insert into public.faolla_schema_migrations','commit;');
  const preflight=clean.slice(0,clean.indexOf('commit;'));
  assert.doesNotMatch(preflight,/create (?:or replace )?function|create table|insert into public|grant execute/);
});

test('exact151 registry and066/148/149/150 dependencies precede any DDL',()=>{
  has(clean,'202609290066::bigint','202610050148::bigint','202610050149::bigint','202610050150::bigint',
    "version=202610050151 and name<>'merchant_attendance_period_source_ranges'",
    "f.provolatile='i' and f.prorettype='timestamptz'::regtype");
  has(read('202609290066_merchant_attendance_scopes_records.sql'),'language plpgsql immutable',"(\\d{3}|\\d{6})Z$");
});

test('valid orphan indexes may be adopted but wrong/invalid/partial-state objects are never repaired',()=>{
  const pre=between(clean,'do $period_source_ranges_index_preflight$','commit;');
  const post=between(clean,'do $period_source_ranges_index_ready$','create or replace function');
  has(pre,'if installed and idx is null','idx is not null and not exists');has(post,'if idx is null');
  for(const part of [pre,post])has(part,"i.indrelid=to_regclass('public.'||spec.table_name)","am.amname='btree'",
    'i.indisvalid and i.indisready and i.indislive','not i.indisunique and not i.indisexclusion',
    'i.indnatts=5 and i.indnkeyatts=5','i.indexprs is not null and i.indpred is not null',
    "pg_get_indexdef(idx,1,true)='merchant_id'","pg_get_indexdef(idx,2,true)='worker_id'","pg_get_indexdef(idx,5,true)='request_id'",
    "='action=''submit'''",'expected_start','expected_end','i.indcollation[0]','i.indcollation[4]=0',
    'unnest(i.indoption::smallint[])',"'text_ops'","'uuid_ops'","'timestamptz_ops'",'oc.opcdefault');
});

test('both partial range indexes use real UTC parsing for3/6 digits, not lexical or timezone conversion',()=>{
  const ddl=between(clean,'create index concurrently','begin;');
  has(ddl,"public.faolla_attendance_instant_v1(proposal->>'startAt')","public.faolla_attendance_instant_v1(proposal->>'endAt')",
    "public.faolla_attendance_instant_v1(command->'proposal'->>'startAt')","public.faolla_attendance_instant_v1(command->'proposal'->>'endAt')");
  assert.equal((ddl.match(/where action='submit'/g)||[]).length,2);
  assert.doesNotMatch(ddl,/day_boundary|at time zone|::timestamptz/);
});

test('authorization/locks/raw candidate and long-open completeness remain byte-for-byte148',()=>{
  assert.equal(body.slice(0,body.indexOf('  -- Full original plan membership')),prior.slice(0,prior.indexOf('  -- Full original plan membership')));
  order(body,'from public.merchants where id=site','from public.merchant_attendance_settings where merchant_id=site for share',
    'from public.merchant_attendance_workers where merchant_id=site and id=wid for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share',
    'faolla_attendance_unified_report_v1(site,p_auth_user_id');
  has(body,'preceding as(','x.occurred_at<range_from order by x.occurred_at desc,x.sequence desc limit 1',
    'expected_report_count<>jsonb_array_length(base->\'items\')','total_events>4000');
});

test('plan/missing/leave exact half-open overlap precedes existing101 sentinels',()=>{
  assert.equal((body.match(/x\.start_at>=range_from-interval '24 hours' and x\.start_at<range_to and x\.end_at>range_from order by x\.start_at,x\.end_at limit 101/g)||[]).length,2);
  has(body,"x.start_at>=range_from-interval '8784 hours' and x.start_at<range_to and x.end_at>range_from order by x.start_at,x.end_at limit 101");
  has(body,'leave_row.employee_id<>emp.id or leave_row.actor_auth_user_id<>emp.auth_user_id',
    'missing_row.employee_id<>emp.id or missing_row.actor_auth_user_id<>emp.auth_user_id');
});

test('calendar counts exact overlaps only and preserves cached saved-zone interpretation',()=>{
  const section=between(body,'  -- Date indexes narrow each saved scope','  -- All relevant missing requests');
  has(section,'x.location_id is null','x.location_id=any(place_ids)',
    "x.from_date>=(range_from at time zone 'UTC')::date-367","x.through_date>=(range_from at time zone 'UTC')::date-2",
    'order by candidates.entry_id','if not(bounds ? cache_key)','faolla_attendance_control_day_boundary_v1(boundary_date,calendar_row.time_zone)');
  order(section,'if a>=range_to or b<=range_from then continue',"if jsonb_array_length(calendars)>=100 then raise exception",
    'faolla_attendance_calendar_summary_v1(calendar_row)','calendars:=calendars||');
  assert.doesNotMatch(section,/limit 101|cardinality\(ids\)>100|default_location/);
});

test('related original/latest sessions independently preserve moved-out proposals through latest stream heads',()=>{
  const section=between(body,'  -- A pending head can affect','  if cardinality(ids)>100 or cardinality(other_ids)>100');
  assert.equal((section.match(/from unnest\(session_ids\) related_session\(start_event_id\)/g)||[]).length,2);
  has(section,'x.start_event_id=related_session.start_event_id','order by x.revision desc limit 1',
    'root.worker_id=wid and root.start_event_id=related_session.start_event_id',
    'x.base_request_id=root.request_id order by x.revision desc limit 1',"where head.action='submit'");
  assert.doesNotMatch(section,/recorded_at desc|employee_id=emp|actor_auth_user_id=emp/);
});

test('indexed moved-in proposals reject later heads/withdrawals/decisions before dedup and relevant caps',()=>{
  const section=between(body,'  -- A pending head can affect','  for correction_row in');
  has(section,"faolla_attendance_instant_v1(x.proposal->>'startAt')>=range_from-interval '744 hours'",
    "faolla_attendance_instant_v1(x.command->'proposal'->>'startAt')>=range_from-interval '744 hours'",
    "faolla_attendance_instant_v1(x.proposal->>'endAt')>range_from","faolla_attendance_instant_v1(x.command->'proposal'->>'endAt')>range_from",
    'newer.start_event_id=x.start_event_id and newer.revision>x.revision','newer.base_request_id=x.base_request_id and newer.revision>x.revision',
    'merchant_attendance_correction_decisions decided','merchant_attendance_revision_decisions decided');
  assert.equal((section.match(/select request_id from related union select request_id from moved/g)||[]).length,2);
  assert.equal((section.match(/order by request_id limit 101/g)||[]).length,2);
  has(body,"if jsonb_array_length(pending)>100 then raise exception 'attendance_period_source_too_large'");
});

test('existing pending validation,147 identity/freshness and final canonical contract remain unchanged',()=>{
  assert.equal(body.slice(body.indexOf('  for correction_row in')),prior.slice(prior.indexOf('  for correction_row in')));
  has(body,'correction_row.employee_id<>emp.id or correction_row.actor_auth_user_id<>emp.auth_user_id',
    'revision_row.employee_id<>emp.id or revision_row.actor_auth_user_id<>emp.auth_user_id',
    "'sourceVersion','attendance-period-source-v1'",'faolla_attendance_period_canonical_v1(result)',
    "octet_length(convert_to(source_text,'UTF8'))>1048576","octet_length(convert_to(result::text,'UTF8'))>4194304");
});

test('reader-only service ACL and security-definer/search_path are retained and rechecked',()=>{
  has(clean,'revoke all on function public.faolla_attendance_period_source_v1(jsonb,uuid) from public,anon,authenticated,service_role;',
    'grant execute on function public.faolla_attendance_period_source_v1(jsonb,uuid) to service_role;',
    "array['anon','authenticated']","p.prosecdef and p.proconfig @> array['search_path=pg_catalog']",
    "a.grantee=0 and a.privilege_type='EXECUTE'");
  assert.equal((clean.match(/grant execute on function/g)||[]).length,1);
});
