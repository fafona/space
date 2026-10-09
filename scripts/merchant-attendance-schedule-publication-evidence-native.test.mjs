// Pure/static checks only: importing this file never starts PostgreSQL/browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {checkAttendanceSchedulePublicationEvidence,schedulePublicationEvidenceMigration,schedulePublicationEvidenceMigrationSql,
  schedulePublicationEvidenceExpression,schedulePublicationEvidenceSlots,schedulePublicationEvidenceLabels,schedulePublicationEvidenceFailure}
  from './merchant-attendance-schedule-publication-evidence-native.mjs';

const source=readFileSync(new URL('./merchant-attendance-schedule-publication-evidence-native.mjs',import.meta.url),'utf8');
const root=fileURLToPath(new URL('../',import.meta.url));

test('inert standalone checker uses one owned sandbox and no old full native suites',()=>{
  assert.equal(typeof checkAttendanceSchedulePublicationEvidence,'function');
  assert(Object.isFrozen(schedulePublicationEvidenceLabels));assert.equal(schedulePublicationEvidenceLabels.length,8);
  assert.equal(new Set(schedulePublicationEvidenceLabels).size,8);
  assert.match(source,/withAttendanceConcurrencySandbox\(native,async scope/);
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.doesNotMatch(source,/checkAttendanceSchedule\(|checkAttendanceBoundClocks|prepareBoundClocks|\b(?:spawn|spawnSync|execSync|createServer|listen)\s*\(/);
});

test('migration namespace qualification preserves both commits and concurrent index outside transactions',()=>{
  const schema='attendance_race_'+'a'.repeat(32),scope={schema,sql:text=>qualifyAttendanceSandbox(text,schema)};
  const actual=schedulePublicationEvidenceMigrationSql(root,scope);
  const original=readFileSync(new URL('./supabase-migrations/'+schedulePublicationEvidenceMigration,import.meta.url),'utf8');
  assert.equal(schedulePublicationEvidenceMigration,'202610050136_merchant_attendance_schedule_publication_evidence.sql');
  assert.equal(actual,scope.sql(original));assert.equal((actual.match(/^begin;$/gm)||[]).length,2);assert.equal((actual.match(/^commit;$/gm)||[]).length,2);
  const concurrent=actual.indexOf('create index concurrently');assert(actual.lastIndexOf('commit;',concurrent)<concurrent);
  assert(actual.indexOf('\nbegin;',concurrent)>concurrent);assert.doesNotMatch(actual,/\bpublic\./);
  assert.match(source,/native\.query\(migration\)/);assert.doesNotMatch(source,/exec\(migration\)|migration\.replace\(/);
  assert.throws(()=>schedulePublicationEvidenceMigrationSql(root,{...scope,schema:'public'}));
});

test('RPC expression only accepts exact original or additive service names and four exact arguments',()=>{
  const args={p_query:{siteId:'99990001'},p_auth_user_id:id(99),p_command:{reason:"O'Hara"},p_allow_write:true};
  for(const name of ['faolla_attendance_schedule_v1','faolla_attendance_schedule_evidenced_v1']){
    const sql=schedulePublicationEvidenceExpression(name,args);assert(sql.startsWith('public.'+name+'('));assert(sql.includes("O''Hara"));assert(sql.endsWith(',true)'));
  }
  assert.throws(()=>schedulePublicationEvidenceExpression('arbitrary_rpc',args));
  assert.throws(()=>schedulePublicationEvidenceExpression('faolla_attendance_schedule_v1',{...args,p_allow_write:'true'}));
  assert.throws(()=>schedulePublicationEvidenceExpression('faolla_attendance_schedule_v1',{...args,p_auth_user_id:"';select 1;--"}));
  assert.throws(()=>schedulePublicationEvidenceExpression('faolla_attendance_schedule_v1',{...args,extra:true}));
});

test('bounded slot factory emits exact minute-aligned nonoverlapping UTC pairs without DST claims',()=>{
  assert.deepEqual(schedulePublicationEvidenceSlots('2026-10-25'),[['2026-10-25T00:00:00.000Z','2026-10-25T00:01:00.000Z']]);
  const slots=schedulePublicationEvidenceSlots('2026-10-25',32,64);assert.equal(slots.length,32);
  assert.deepEqual(slots[0],['2026-10-25T02:08:00.000Z','2026-10-25T02:09:00.000Z']);
  assert.deepEqual(slots.at(-1),['2026-10-25T03:10:00.000Z','2026-10-25T03:11:00.000Z']);
  for(const input of [['2026-02-30',1,0],['2026-10-25',33,0],['2026-10-25',0,0],['2026-10-25',2,719],['2026-10-25',1,-1]])assert.throws(()=>schedulePublicationEvidenceSlots(...input));
});

test('actual service and old099 publication chain has no replacement fake receipt or result normalizer',()=>{
  for(const marker of ["require('../src/lib/merchantAttendanceSchedule.server.ts')",'executeAttendanceSchedule({query,command,authUserId,allowWrite},service)',
    'schedulePublicationEvidenceExpression(name,input)',"enabled('0')","enabled('1','99990002')","assert.equal(names.at(-1),oldRpc)",
    "assert.equal(names.at(-1),newRpc)",'checkEvidence(single)','checkEvidence(bulk)',"{commands:4,slots:35,cancellations:0,evidence:2}"])assert(source.includes(marker),marker);
  assert.doesNotMatch(source,/response\.receipt\s*=|result\.receipt\s*=|replayed\s*:/);
});

test('receipt replay cancel and unbound rejection preserve original identity without bypassing active-binding constraints',()=>{
  for(const marker of ['replay_backfilled_or_replaced_evidence','await run(off,q,false)','await run(outside,q,false)',
    "status='disabled',auth_user_id=null",'attendance_schedule_worker_invalid','unbound_changed_original_receipt','unbound_replay_replaced_identity','unbound_backfilled_old_operation',
    'attendance_operation_conflict','attendance_version_conflict','attendance_access_denied','attendance_platform_paused'])assert(source.includes(marker),marker);
  assert.doesNotMatch(source,/disable\s+trigger|session_replication_role|drop\s+constraint|set\s+auth_user_id=null\s*,\s*status='active'/i);
  assert.match(source,/unboundSuccessfulPublishClaimed:false/);
});

test('insertion fault is caught inside a statement subtransaction with command slot evidence assertions before rollback',()=>{
  for(const marker of ['qa_schedule_publication_forced_failure check(false) not valid','exception when check_violation',
    'snapshot_failure_not_observed','snapshot_failure_left_command','snapshot_failure_left_slots','snapshot_failure_left_evidence',
    'assert.equal(fingerprint(),beforeFailure)','assert.equal(catalog(),installed)'])assert(source.includes(marker),marker);
  const start=source.indexOf('phase=\'atomic-snapshot-failure\''),end=source.indexOf("phase='two-connection-races'");
  const probe=source.slice(start,end);assert(probe.indexOf('snapshot_failure_left_slots')<probe.indexOf('rollback;'));
});

test('four real connection races reuse exact PID lock witness and check duplicate stale identity and config outcomes',()=>{
  assert.match(source,/lifecycleRace\(nativeScope\(native,scope\)/);assert.match(source,/assert\.equal\(result\.witnessed,true\)/);
  for(const marker of ['dup.right.error,null','JSON.parse(dup.left).receipt,JSON.parse(dup.right.output).receipt',
    'versionRace.right.error,null','identityRace.right.error,null','employee_auth_user_id:id(3),worker_version:2',
    'configRace.right.error,null','expectedSettingsVersion:2','checkEvidence(newConfig,{location_version:2})','actualConnectionRaces:4'])assert(source.includes(marker),marker);
  assert.doesNotMatch(source,/setTimeout|pg_sleep/);
});

test('101-slot case asserts empty bounded listing but independent real-slot oracle and immutable receipt survive',()=>{
  for(const marker of ['for(const count of [32,32,32,5])','assert.equal(offset,101)','assert.equal(denseResult.rangeLimited,true)',
    'assert.deepEqual(denseResult.entries,[])','evidenceRow(denseLast.operationId).slots.length,5','assert.deepEqual(recovered.receipt,denseResult.receipt)',
    'assert.deepEqual(row.slots,original.slots)','order by s.id','recorded_at>=published_at'])assert(source.includes(marker),marker);
});

test('owned valid orphan adoption wrong-index rollback and saved evidence reapply cannot drop external objects',()=>{
  for(const marker of ['136_replaced_valid_orphan_index','qa_schedule_publication_saved_idx','merchant_attendance_schedule_publication_index_conflict',
    '136_reapply_changed_saved_evidence','pg_get_constraintdef','schedule_publication_install_changed_old_catalog',
    'publication_changed_unrelated_business_facts','{commands:13,slots:140,cancellations:1,evidence:10}',
    'has_table_privilege','has_function_privilege','direct_write_accepted','append_only_rewrite_accepted','attendance_events_append_only'])assert(source.includes(marker),marker);
  assert.doesNotMatch(source,/drop\s+(?:table|schema|index)|update\s+pg_index|new\s+Pool|process\.env\.(?:DATABASE|SUPABASE)/i);
  assert.match(source,/finally\{for\(const \[key,value\]of previous\)\{if\(value===undefined\)delete process\.env\[key\];else process\.env\[key\]=value;/);
});

test('failure reporting does not print SQL identities or opaque server details',()=>{
  assert.deepEqual(schedulePublicationEvidenceFailure(Error('untrusted secret SELECT ...')),{error:'schedule_publication_evidence_native_failed',phase:'entry',code:'local_check_failed'});
  assert.equal(schedulePublicationEvidenceFailure(Error('ERROR: attendance_schedule_publication_evidence_invalid\nDETAIL: private')).code,'attendance_schedule_publication_evidence_invalid');
  assert.match(source,/console\.error\(schedulePublicationEvidenceFailure\(error\)\)/);
});
