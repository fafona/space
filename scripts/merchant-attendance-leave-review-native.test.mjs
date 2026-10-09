// Pure plan/source assertions. They do not claim PostgreSQL or the UI ran.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {leaveReviewQuery,leaveReviewSeedPlan,leaveReviewMigrationPlan,leaveReviewNativeFailure,prepareLeaveReviewNativeFixture,checkAttendanceLeaveReviewNative}
  from './merchant-attendance-leave-review-native.mjs';
import {leaveQueryInput,leaveNativeSubmit,leaveNativeAction} from './merchant-attendance-leave-native.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=readFileSync(new URL('./merchant-attendance-leave-review-native.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const scope={schema:'attendance_race_'+'e'.repeat(32),sql(s){return s.replaceAll('public.',this.schema+'.');}};
const data={site:'99990001',owner:id(99),employeeAuth:id(1),queryInput:leaveQueryInput,action:leaveNativeAction,time:{startAt:'2026-10-06T08:00:00.000Z'},
  submit:(n,patch)=>leaveNativeSubmit(n,'2026-10-06T08:00:00.000Z','2026-10-06T16:00:00.000Z',patch)};
test('inert fixture/check reuses the owned133 base with no import-time services and retains real writer/notification interfaces',()=>{
  assert.equal(typeof prepareLeaveReviewNativeFixture,'function');assert.equal(typeof checkAttendanceLeaveReviewNative,'function');
  for(const text of ['await prepareLeaveNotificationsNativeFixture(native,scope)','assert.deepEqual(assertLifecycleSandbox(','owned.schema,scope.schema',
    'return {...base,reviewQuery,review','reviewSourceDefinition:oldDefinition','runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox'])assert(source.includes(text));
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|fetch\(|dotenv|disable trigger|create or replace function/i);
});
test('migration adaptation installs exact126 source with only owned-schema and transaction-wrapper changes',()=>{
  const m=leaveReviewMigrationPlan(root,scope);assert.equal(m.name,'202610040126_merchant_attendance_leave_review.sql');
  assert.equal(m.source,readFileSync(new URL(`./supabase-migrations/${m.name}`,import.meta.url),'utf8'));
  assert.equal(m.body,m.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(m.statement,scope.sql(m.body));assert.doesNotMatch(m.statement,/\bpublic\./);
  assert.throws(()=>leaveReviewMigrationPlan(root,{...scope,schema:'public'}));assert.throws(()=>leaveReviewMigrationPlan(root,{...scope,sql:s=>s}));
  for(const text of ['leave_review_changed_old_definition_acl','leave_review_install_changed_business','leave_review_reapply_changed_installation','leave_review_reapply_changed_facts'])assert(source.includes(text));
});
test('seed plan constructs actual original RPC statements for56 nonoverlapping future requests and50 closed histories without fabricated success rows',()=>{
  const plan=leaveReviewSeedPlan(data);assert.equal(plan.rows.length,56);assert.equal(plan.closedIds.length,50);assert.equal(plan.pendingIds.length,6);
  assert.deepEqual(new Set(plan.rows.slice(0,50).map(r=>r.status)),new Set(['approved','withdrawn','cancelled','rejected']));
  assert(plan.rows.slice(50).every(r=>r.status==='submitted'&&r.revision===1));assert.equal(plan.rows[2].revision,3);
  for(let n=1;n<plan.rows.length;n++)assert(plan.rows[n].startAt>plan.rows[n-1].endAt);
  const statements=plan.batches.join('\n');assert.equal((statements.match(/public\.faolla_attendance_leave_v1\(/g)||[]).length,107);
  for(const batch of plan.batches){assert(batch.startsWith('set local role service_role;'));assert((batch.match(/perform public\./g)||[]).length<=10);}
  assert.doesNotMatch(statements,/insert into|update |delete |notify_v1|review_v1|clock_timestamp\(\).*interval/i);
  assert.throws(()=>leaveReviewSeedPlan({...data,site:'99990002'}));assert.throws(()=>leaveReviewSeedPlan({...data,employeeAuth:id(2)}));
});
test('review query exact3 preserves paired source cursor and actual adapter has only query/auth arguments',()=>{
  assert.deepEqual(leaveReviewQuery(),{siteId:'99990001',afterAt:null,afterId:null});
  assert.deepEqual(leaveReviewQuery({afterAt:'2026-10-04T00:00:00.123456Z',afterId:id(1001)}),{siteId:'99990001',afterAt:'2026-10-04T00:00:00.123456Z',afterId:id(1001)});
  assert(source.includes("`public.${rpc}(${json(query)},'${actor}')`"));assert(source.includes('set local role service_role;select ${expression(query,actor)}'));
  assert(source.includes('expectedRows:allRows.filter(r=>r.status===\'submitted\')'));
  assert(source.includes('from public.merchant_attendance_leave_requests where merchant_id='));assert(!source.includes('expectedRows:review('));
});
test('native paging distinguishes candidates from matches, empty first page, exact50 final page and live source withdrawal',()=>{
  for(const text of ['assert.equal(first.scanned,50)','assert.deepEqual(first.items,[])','assert.deepEqual(first.nextCursor,data.pageBoundary)',
    'assert.equal(second.scanned,6)','assert.deepEqual(second.items,data.expectedRows)','assert.equal(exactLast.scanned,50)','assert.equal(exactLast.nextCursor,null)',
    'assert.equal(empty.scanned,0)','leave_review_future_intervals_required','actual withdrawal closes pending','fresh scan sees withdrawal without snapshot',
    'original detail rechecks current terminal','leave_review_withdraw_probe_not_restored'])assert(source.includes(text));
  assert.doesNotMatch(source,/setTimeout|while\s*\(/);
});
test('bounded corrupt-source case inserts only a new explicit adversarial row, never rewrites old facts or hides exceptions',()=>{
  const probe=source.slice(source.indexOf("phase='bounded-invalid-source'"),source.indexOf("phase='live-original-withdrawal'"));
  assert(probe.includes('Deliberately invalid NEW synthetic terminal row'));assert(probe.includes("data.action(4901,'cancel',data.pendingIds[0])"));
  assert(probe.includes('insert into public.merchant_attendance_leave_entries'));assert(probe.includes('51st candidate must not be interpreted'));
  assert(probe.includes("denied('attendance_leave_invalid',expression(after))"));assert(probe.includes('leave_review_bad_source_probe_not_restored'));
  assert.doesNotMatch(source,/update public\.merchant_attendance_leave_|delete from public\.merchant_attendance_leave_|alter table|disable trigger/);
  assert(source.includes('end;$checks$;rollback;'));assert(source.includes('leave_review_read_or_rollback_changed_facts'));
});
test('native fences current owner/tenant and preserves unbound history with private ACLs and safe failure reporting',()=>{
  for(const text of ['current replacement owner sees history','owner history ignores present worker/member labels and binding','legitimate foreign owner gets only foreign request',
    'leave_review_browser_execute_allowed','leave_review_private_source_allowed','leave_review_private_helper_allowed',
    'requests:57,entries:108,closedCandidates:50,pending:6,pages:2,notifications:0,readMarkers:0'])assert(source.includes(text));
  const e=leaveReviewNativeFailure(Error('ERROR: attendance_leave_invalid\nPRIVATE token/email\nPL/pgSQL function x line 9 at RAISE'));
  assert.equal(e.code,'attendance_leave_invalid');assert.equal(e.sourceLine,9);assert(!JSON.stringify(e).includes('PRIVATE'));
  assert.equal(leaveReviewNativeFailure(Error('ERROR: synthetic_password')).code,'local_check_failed');
});
