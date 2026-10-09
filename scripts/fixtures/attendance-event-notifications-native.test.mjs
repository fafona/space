import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./attendance-event-notifications-native.mjs',import.meta.url),'utf8');
const driver=readFileSync(new URL('../merchant-attendance-event-notifications-native.mjs',import.meta.url),'utf8');
test('200 runner imports are inert and reuse the explicit guarded predecessor',async()=>{
  const runner=await import('../merchant-attendance-event-notifications-native.mjs');assert.equal(typeof runner.runEventNotificationsNative,'function');
  assert.match(driver,/runScheduleDelegationNative\(args,/);assert.doesNotMatch(driver,/initdb|createDatabase|DATABASE_URL|SUPABASE_SERVICE_ROLE/);
});
test('200 fixture requires owned synthetic schema and preserves all old definitions',()=>{
  assert.match(source,/d\?\.syntheticOnly===true&&h\?\.syntheticOnly===true/);assert.match(source,/assertLifecycleSandbox/);
  assert.match(source,/assert\.equal\(definitions\(\),oldDefinitions\)/);assert.match(source,/d\.fingerprint\(oldTables\),facts/);
});
test('200 fault proof rolls all five sources back then retries exact commands after trigger removal',()=>{
  for(const name of ['schedule','schedule_delegation','work_arrangement','delegated_applications','plan_exception_review'])assert.match(source,new RegExp('faolla_attendance_'+name+'_event_v1'));
  assert.match(source,/for\(const expression of atomicExpressions\)\s+reject/);assert.match(source,/for\(const expression of atomicExpressions\)call\(expression\)/);
  assert.match(source,/finally\{exec\('drop trigger synthetic200_capture_fail/);assert.doesNotMatch(source,/disable trigger|session_replication_role/i);
});
test('200 verifies exact lock witnesses, current identity, no business ack, pagination and source collision',()=>{
  for(const marker of ['old_winner_not_backfilled','three_categories_share_operation_uuid','notification_read_must_not_ack_business','new_auth_does_not_inherit_messages','source_service_replay_wrote'])assert(source.includes(marker));
  assert.match(source,/lifecycleRace/);assert.match(source,/one\.items\.length,25/);assert.match(source,/two\.items\.length,8/);
});
test('200 native SQL expression quotes structured query and uses no configured connection',async()=>{
  const {eventNotificationsExpression}=await import('./attendance-event-notifications-native.mjs');
  const value=eventNotificationsExpression({siteId:'99990212'},'00000000-0000-4000-8000-000200000001');
  assert.match(value,/public\.faolla_attendance_event_notifications_v1\(/);assert.match(value,/null,true\)$/);
  assert.doesNotMatch(source,/process\.env\.(?:DATABASE_URL|PGPASSWORD|SUPABASE_SERVICE_ROLE)/);
});
