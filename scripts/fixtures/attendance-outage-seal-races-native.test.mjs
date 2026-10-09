import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createOutageSealRacePlan} from './attendance-outage-seal-races-native.mjs';
const source=readFileSync(new URL('./attendance-outage-seal-races-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',worker:'worker',employee:'employee',auth:'auth',location:'location',sealedDay:'2026-10-04',workerVersion:3,employeeVersion:4,generation:2};
test('two independently identified past periods do not overlap the old archive day',()=>{
 const a=createOutageSealRacePlan(input,'declaration_first'),b=createOutageSealRacePlan(input,'seal_first');
 assert.equal(a.query.fromDate,'2026-10-02');assert.equal(b.query.fromDate,'2026-10-01');assert.notEqual(a.periodId,b.periodId);
 assert.equal(a.declaration.expectedWorkerVersion,3);assert.equal(a.declaration.expectedEmployeeVersion,4);assert.equal(a.declaration.expectedGeneration,2);
 assert.equal(a.declaration.originalOperationId,null);assert.equal(a.declaration.interval.startOffsetMinutes,0);
 assert.throws(()=>createOutageSealRacePlan(input,'unknown'));
});
test('setup uses actual service send/self-confirm and true lock-witnessed ordering, not fabricated seals',()=>{
 for(const s of ['callPeriod(q,send)',"callPeriod({...q,access:'self'},confirm)",'await lifecycleRace(','assert.equal(race.witnessed,true)',
  'set constraints all immediate','attendance_period_source_changed','period_entries','recoveredDeclaration.receipt.recordId'])assert(source.includes(s),s);
 assert(!/insert into|update public|delete from|disable trigger|session_replication_role/.test(source));
});
test('both committed orderings preserve old rows and archive bytes with explicit original-ID checks',()=>{
 for(const s of ['outage_seal_old_row_changed','afterArchive.artifactText,beforeArchive.artifactText','afterArchive.artifactSha256,beforeArchive.artifactSha256',
  "now.period.sealed,order==='seal_first'",'now.sourceChanged,true','unresolved_outage','originalSend.operation.command,send','originalSeal.operation.command,seal',
  'assert(replay.replayed)','attendance_operation_not_found','committedOnlyInOwnedSchema:true'])assert(source.includes(s),s);
});
test('inert caller-owned fixture cannot start environments, weaken limits or pretend transaction rollback',()=>{
 for(const s of ['initdb','CREATE DATABASE','pg_ctl','pg_dump','spawn(','listen(','playwright','process.env','rollbackRestored:true'])assert(!source.includes(s),s);
 assert(source.includes('assertLifecycleSandbox'));assert(source.includes('d.definitions(),defs'));assert(source.includes('d.tableCatalog(),catalog'));
});
