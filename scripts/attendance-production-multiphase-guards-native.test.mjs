import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {
 attendanceMultiphaseNativePieces,attendanceMultiphaseNativeIndexNames,validateAttendanceMultiphaseNativeIdentity,checkAttendanceProductionMultiphaseGuards,
} from './attendance-production-multiphase-guards-native.mjs';
import {loadAttendanceProductionScope,attendanceProtectedMultiphaseMigrations} from './attendance-production-database-migrations.mjs';
const rootDir=new URL('../',import.meta.url).pathname.replace(/^\/([a-z]:)/i,'$1');
const identity=()=>({databaseName:'faolla_attendance_multiphase_fixture',databaseOid:'16400',systemIdentifier:'7694613959029145000',serverVersionNum:'150019',port:16445,marker:'faolla-attendance-multiphase-20261010:12345678-1234-1234-1234-123456789abc'});
const scope=await loadAttendanceProductionScope({rootOwned:false});
test('all eight actual pinned concurrent-index names accept original line breaks or spaces after the identifier',()=>{
 assert.deepEqual(attendanceMultiphaseNativeIndexNames(scope.sources),[
  'attendance_correction_proposal_period_idx','attendance_missing_delegation_list_idx',
  'attendance_review_routing_application_idx','attendance_review_routing_correction_idx','attendance_review_routing_missing_idx',
  'attendance_revision_proposal_period_idx','attendance_schedule_publication_idx','attendance_shift_schedule_slot_idx',
 ]);
 const statements=attendanceProtectedMultiphaseMigrations.flatMap(plan=>{
  const migration=scope.sources.find(source=>source.fileName===plan.fileName);
  return plan.concurrentIndexes.map(({start,end})=>migration.source.slice(start,end));
 });
 assert.equal(statements.filter(source=>/^create index concurrently if not exists [a-z0-9_]+\n/.test(source)).length,5);
 assert.equal(statements.filter(source=>/^create index concurrently if not exists [a-z0-9_]+ /.test(source)).length,3);
});
test('native helper is inert and transports are allowed only for the exact fresh fixture identity, never formal/default DB',async()=>{
 assert.equal(validateAttendanceMultiphaseNativeIdentity(identity()).port,16445);
 let calls=0;const query=()=>{calls++;throw Error('unexpected transport');};
 for(const change of [{databaseName:'postgres'},{databaseOid:'5'},{systemIdentifier:'7612049595342295079'},{serverVersionNum:'160001'},{port:5432.5},{port:80},{marker:'unowned'},{extra:true}])
  await assert.rejects(()=>checkAttendanceProductionMultiphaseGuards({rootDir,identity:{...identity(),...change},query,openConnection:()=>{}}));
 assert.equal(calls,0);
 await assert.rejects(()=>checkAttendanceProductionMultiphaseGuards({rootDir,identity:identity(),query}),/transport/);assert.equal(calls,0);
});
for(const plan of attendanceProtectedMultiphaseMigrations)test(`${plan.fileName}: native fixture extracts every real guard and exact original transaction-free gap, not original DO bodies`,()=>{
 const prior=scope.sources.findIndex(migration=>migration.fileName===plan.fileName),migration=scope.sources[prior];
 const pieces=attendanceMultiphaseNativePieces(migration,prior,scope.manifest);
 assert.equal(pieces.entries.length,plan.transactions.length);assert.equal(pieces.exits.length,plan.transactions.length);assert.equal(pieces.gaps.length,plan.transactions.length-1);
 let original=pieces.wrapped;
 for(let phase=0;phase<plan.transactions.length;phase++){
  const entry=pieces.entries[phase],exit=pieces.exits[phase];original=original.replace(entry,'').replace(exit,'');
  assert(entry.includes("current_user<>'supabase_admin'"));assert(entry.includes('pg_try_advisory_xact_lock(20260731,1)'));assert(entry.includes('on commit drop;'));
  assert(exit.includes('attendance_production_legacy_rows_changed')&&exit.includes('attendance_production_legacy_columns_changed'));
  assert.equal(exit.includes('attendance_production_registration_missing'),phase===plan.transactions.length-1);
  if(phase<pieces.gaps.length)assert.equal(pieces.gaps[phase],migration.source.slice(plan.transactions[phase].commit+7,plan.transactions[phase+1].begin));
 }
 assert.equal(original,migration.source);assert.equal(createHash('sha256').update(original).digest('hex'),plan.sha256);
 for(const {start,end} of plan.concurrentIndexes)assert(pieces.gaps.some(gap=>gap.includes(migration.source.slice(start,end))));
 assert.throws(()=>attendanceMultiphaseNativePieces({...migration,source:migration.source+'\n'},prior,scope.manifest),/source_pin/);
});
test('native mechanism source has bounded real failures, preserved prior commits, duplicates, metadata, independent business and xact lock sessions',async()=>{
 const source=await readFile(new URL('./attendance-production-multiphase-guards-native.mjs',import.meta.url),'utf8');
 for(const marker of ['requests<=1000','Buffer.byteLength(source)<600000','result.timedOut===false','fresh_database_required',
  'phase-commits-original-concurrent-indexes-and-business-gap','legitimate-between-phase','mid-phase-fault','duplicate-count','old-column','registry-name','phase-registration',
  'attendance_phase_native_failed_transaction_changed_facts','pg_advisory_xact_lock(20260731,1)','full149CompatibilityProven:false','originalMigrationBodiesInstalled:false'])assert(source.includes(marker),marker);
 assert(!/from ['"](?:node:child_process|pg)|process\.env|process\.argv|https?:|drop database|drop schema|preserve rows|pg_advisory_lock\(/i.test(source));
 assert(!source.includes("replace('supabase_admin','postgres')"));
});
