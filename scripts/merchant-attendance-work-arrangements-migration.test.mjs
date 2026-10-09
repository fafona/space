//187 static contract/scope proofs only; actual PostgreSQL acceptance is root-owned.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const filename='202610060156_merchant_attendance_work_arrangements.sql';
const sql=readFileSync(new URL('./supabase-migrations/'+filename,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=sql.replace(/--[^\n]*/g,'');
const has=(s,...parts)=>{for(const p of parts)assert(s.includes(p),p);};
const order=(s,...parts)=>{let i=-1;for(const p of parts){const j=s.indexOf(p,i+1);assert(j>i,p);i=j;}};
const fn=n=>{const a=sql.indexOf('create or replace function public.'+n+'('),b=sql.indexOf('$$;',a);assert(a>=0&&b>a,n);return sql.slice(a,b+3);};
const command=fn('faolla_attendance_work_arrangement_command_v1'),summary=fn('faolla_attendance_work_arrangement_summary_v1');
const context=fn('faolla_attendance_work_arrangement_context_v1'),conflicts=fn('faolla_attendance_work_arrangement_conflicts_v1'),rpc=fn('faolla_attendance_work_arrangement_v1');

test('156 is an atomic additive candidate with six new functions, three tables, no old writers',()=>{
  assert.deepEqual(validateMigrationSource(filename,sql),[]);
  assert.equal((clean.match(/^begin;/gm)||[]).length,1);assert.equal((clean.match(/^commit;/gm)||[]).length,1);
  has(clean,"set local lock_timeout='3s'","values(202610060156,'merchant_attendance_work_arrangements')");
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(x=>x[1]),[
    'faolla_attendance_work_arrangement_command_v1','faolla_attendance_work_arrangement_policy_v1','faolla_attendance_work_arrangement_summary_v1',
    'faolla_attendance_work_arrangement_context_v1','faolla_attendance_work_arrangement_conflicts_v1','faolla_attendance_work_arrangement_v1']);
  assert.equal((clean.match(/create table if not exists/g)||[]).length,3);
  for(const match of clean.matchAll(/(?:insert into|alter table|create index if not exists \w+ on) public\.(\w+)/g))assert.match(match[1],/^(?:merchant_attendance_work_arrangement_|faolla_schema_migrations)/);
  assert.doesNotMatch(clean,/\b(?:update public\.|delete from|truncate public\.|drop (?:table|function|index)|disable trigger|session_replication_role|set_config|statement_timeout|pg_advisory)/i);
});
test('preflight checks predecessors and rejects partial installations before business DDL',()=>{
  const header=sql.slice(0,sql.indexOf('create or replace function'));
  for(const [v,n] of [[202609290061,'merchant_attendance_foundation'],[202610030122,'merchant_attendance_leave_requests'],[202610050137,'merchant_attendance_self_schedule'],[202610050149,'merchant_attendance_period_closure'],[202610050150,'merchant_attendance_period_seal_guards']])has(header,"("+v+"::bigint,'"+n+"')");
  has(header,'m.version=dependency.version and m.name=dependency.name',"version=202610060156 and name<>'merchant_attendance_work_arrangements'",'installed<>(to_regclass', 'installed<>exists');
  has(header,"pronamespace=(select relnamespace from pg_class where oid='public.faolla_schema_migrations'::regclass)");
  assert.doesNotMatch(header,/'public'::regnamespace/);
  order(sql,'$work_arrangement_prerequisites$;','create or replace function','$work_arrangement_postconditions$;',"values(202610060156,",'commit;');
});
test('exact command schemas separate three kinds and retain zero-day policy, minute intervals, reason and CAS',()=>{
  has(command,"array['action','operationId','reason','expectedWorkerId','expectedSettingsVersion','expectedPolicyRevision','kind','timeZone','startAt','endAt']",
    "not in('trip','field','remote')","p->'reason','reason'","p->'expectedPolicyRevision','head'","date_trunc('minute'","b>a and b-a<=interval '366 days'",
    "between 0 and 365","array['action','operationId','reason','requestId','expectedRevision','expectedConflictsFingerprint','confirmConflicts']",
    "action_name='cancel' then 2 else 1","jsonb_typeof(p->'confirmConflicts')='boolean'");
  assert.doesNotMatch(command,/clock_in|clock_out|leave_type/);
});
test('all persisted facts are immutable and each request must have its deferred original submit receipt',()=>{
  has(clean,'attendance_work_arrangement_submit_fk','references public.merchant_attendance_work_arrangement_entries(merchant_id,operation_id) deferrable initially deferred',
    'before update or delete','before truncate','faolla_attendance_events_append_only_v1()',"revision=3 and action='cancel'",'unique(merchant_id,request_id,revision)');
  const footer=sql.slice(sql.indexOf('do $work_arrangement_postconditions$'));
  has(footer,"g.tgname=c.relname||'_immutable'","g.tgtype=27","g.tgname=c.relname||'_no_truncate'","g.tgtype=34","g.tgenabled='O'",'convalidated and condeferrable and condeferred','confkey=array[');
});
test('new range/self/owner indexes have exact valid btree metadata and no automatic repair',()=>{
  has(clean,'(merchant_id,worker_id,employee_id,actor_auth_user_id,submitted_at desc,request_id desc)',
    '(merchant_id,submitted_at desc,request_id desc)','(merchant_id,worker_id,start_at,end_at)',
    "am.amname='btree'",'i.indisvalid and i.indisready and i.indislive','not i.indisunique','i.indpred is null and i.indexprs is null',
    'i.indnkeyatts=cardinality(spec.keys)','i.indoption[z-1]<>spec.options[z]','i.indcollation[z-1]','opc.opcdefault','opc.opcintype=a.atttypid');
  assert.doesNotMatch(clean,/drop index|reindex/i);
});
test('new tables deny all API DML and helpers are private while only the new RPC is service executable',()=>{
  assert.equal((clean.match(/enable row level security/g)||[]).length,3);
  has(clean,'from public,anon,authenticated,service_role','exists(select 1 from pg_policy where polrelid=t)','aclexplode','pg_has_role',
    "not prosecdef and proconfig=array['search_path=pg_catalog']","prosecdef and proconfig=array['search_path=pg_catalog']");
  assert.deepEqual([...clean.matchAll(/grant execute on function ([^;]+);/g)].map(x=>x[1]),['public.faolla_attendance_work_arrangement_v1(jsonb,uuid,jsonb,boolean) to service_role']);
  assert.equal((clean.match(/revoke all on function public\.faolla_attendance_work_arrangement_/g)||[]).length,6);
});
test('summary validates exact submit snapshots and finite 1→2→3 history without current-owner rewriting',()=>{
  has(summary,'order by revision limit 4','n>3 or entry.revision<>n','entry.recorded_at<p.submitted_at','entry.recorded_at<prior_at',
    'entry.snapshot is distinct from item','entry.actor_auth_user_id<>p.actor_auth_user_id',"entry.action='approve' and entry.actor_auth_user_id=p.actor_auth_user_id",
    "n=3 and (entry.action<>'cancel' or prior_action<>'approve')","entry.command->>'expectedPolicyRevision'",'policy_row.retrospective_days<>p.retrospective_days');
  assert.doesNotMatch(summary,/from public\.merchants|current_user|user_id=p_auth/);
});
test('private context keeps all states, exact overlap before cap, bounded history, and post-selection dual identity',()=>{
  order(context,'x.worker_id=p_worker',"x.start_at>=p_from-interval '8784 hours'",'x.start_at<p_to and x.end_at>p_from','limit 101','jsonb_array_length(items)>=100','req.employee_id<>p_employee or req.actor_auth_user_id<>p_member_auth','faolla_attendance_work_arrangement_summary_v1(req)');
  has(context,"item||jsonb_build_object('reason',req.reason,'history',history)",'1048576');
  assert.doesNotMatch(context,/status.*(?:submitted|approved)|action in|current_timestamp|readAt|clock_timestamp/);
});
test('conflicts use exact half-open intersections and terminal exclusion before caps, total ≤100 across three sources',()=>{
  assert.equal((conflicts.match(/limit 101 loop/g)||[]).length,3);
  assert.equal((conflicts.match(/jsonb_array_length\(items\)>=100/g)||[]).length,3);
  assert.equal((conflicts.match(/x.start_at<p_end and x.end_at>p_start/g)||[]).length,3);
  assert.equal((conflicts.match(/e\.action in\('withdraw','reject','cancel'\)/g)||[]).length,2);
  has(conflicts,'leave_row.employee_id<>p_employee','slot_row.employee_id<>p_employee',"checked->'publication'->>'employeeAuthUserId'<>p_member_auth::text",
    "jsonb_agg(value order by value->>'source',value->>'id')");
});
test('RPC query has seven exact keys, preview is self-only and cannot coexist with commands/cursors/receipts',()=>{
  has(rpc,"array['siteId','access','requestId','operationId','beforeAt','beforeId','preview']","access_name<>'self' or target_id is not null or op is not null or cursor_at is not null or p_command is not null",
    "array['kind','timeZone','startAt','endAt']","if op is not null or cursor_at is not null or preview_input is not null",'p_allow_write boolean default false');
});
test('real authority and period-compatible merchant/settings/worker/employee lock order precedes snapshots',()=>{
  order(rpc,"from public.merchants where id=site and (access_name='self' or user_id=p_auth_user_id) for share",
    'from public.merchant_attendance_settings where merchant_id=site for share','from public.merchant_attendance_settings where merchant_id=site for update',
    'from public.merchant_attendance_workers where merchant_id=site and id=target_worker for update',
    'from public.merchant_enterprise_employees where merchant_id=site and id=w.employee_id for share');
  has(rpc,'emp.auth_user_id is distinct from p_auth_user_id',"'enterprise.view'=any(role_row.permissions)","'attendance.self.view'=any(role_row.permissions)",
    'req.worker_id is distinct from w.id or req.employee_id<>emp.id or req.actor_auth_user_id<>p_auth_user_id');
});
test('exact immutable original operation recovers before disabled, policy, time, seal and conflict gates',()=>{
  order(rpc,'entry.actor_auth_user_id<>p_auth_user_id','entry.command is distinct from p_command','if recovered then',
    "'item',public.faolla_attendance_work_arrangement_summary_v1(req,entry.revision)",'if p_command is not null and (not p_allow_write or not s.enabled)');
  has(rpc,'saved_policy.actor_auth_user_id<>p_auth_user_id','target_id<>entry.request_id',"(entry.action in('submit','withdraw'))<>(access_name='self')");
});
test('submission preserves enterprise zone, independent policy and civil-day employment/retrospective window',()=>{
  has(rpc,"'attendance.self.work_arrangement'=any(role_row.permissions)","p_command->>'timeZone'<>s.time_zone",'req.time_zone:=s.time_zone',
    "p_command->>'expectedPolicyRevision'","generate_series(first_day::timestamp,last_day::timestamp,interval '1 day')",
    "(now_at at time zone s.time_zone)::date-(policy->>'retrospectiveDays')::integer",'if coverage<>1 then employment_ok:=false',
    "'attendance_work_arrangement_outside_window'","'attendance_work_arrangement_outside_employment'");
  has(fn('faolla_attendance_work_arrangement_policy_v1'),"'revision',0,'retrospectiveDays',30");
});
test('approval is never self, conflict fingerprint is re-read under locks, and overlap needs explicit confirmation',()=>{
  has(rpc,"if action_name='approve' and req.actor_auth_user_id=p_auth_user_id then raise exception 'attendance_access_denied'",
    "if not binding_ok then raise exception 'attendance_work_arrangement_binding_changed'",
    "encode(sha256(convert_to(conflicts::text,'UTF8')),'hex')","p_command->>'expectedConflictsFingerprint' is distinct from conflicts_hash",
    "jsonb_array_length(conflicts)>0 and p_command->'confirmConflicts'<>'true'::jsonb",
    "'attendance_work_arrangement_conflict_confirmation_required'");
});
test('only fresh submit/approve/cancel call existing seal guard and closing actions never claim checked new conflicts',()=>{
  order(rpc,"if action_name in('submit','approve','cancel') then",'faolla_attendance_period_assert_open_v1(site,w.id,jsonb_build_array',
    'insert into public.merchant_attendance_work_arrangement_entries');
  has(rpc,"if binding_ok and (action_name is null or action_name in('submit','approve')) then",
    "if action_name in('withdraw','reject','cancel') then detail:=null;end if;",
    "can_cancel:=access_name='owner' and item->>'status'='approved' and p_allow_write and s.enabled and not sealed");
});
test('bounded pagination and 128KiB reply are explicit; owner never masquerades as employee',()=>{
  has(rpc,'order by x.submitted_at desc,x.request_id desc limit 26','exit when seen=26',
    "'employeeId',case when access_name='self' then emp.id else null end","'workerId',case when access_name='self' then w.id else null end",
    "'nextCursor',case when seen=26 then next_cursor else null end",'131072');
  assert.doesNotMatch(rpc,/faolla_attendance_(?:self|location_clock|onsite_clock|pin_clock|unified_report)_v\d\(/);
});
