// Pure wrapper contracts; importing this test never starts PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-period-continuation-native.mjs',import.meta.url),'utf8');
test('231 reuses only the explicit215 owned fixture and requires absolute local arguments',()=>{
 for(const token of ['args.length===3',"args[0]==='--run-local'","args[1]==='--directory'",'path.isAbsolute(args[2])',
  'runAttendanceOutagePeriodsNative(options,async ctx=>','ctx.outagePeriodsFoundation.phase,215','assertLifecycleSandbox',
  'd.syntheticOnly,true','h.syntheticOnly,true'])assert(source.includes(token),token);
 for(const token of ['initdb','CREATE DATABASE','pg_dump','spawn(','playwright','listen(','npm run build','supabase.co'])assert(!source.includes(token),token);
});
test('only three approved existing function definitions are excepted;182 protects all predecessors',()=>{
 const approved=source.match(/continuationChangedFunctions=Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1];assert(approved);
 assert.deepEqual([...approved.matchAll(/'([^']+)'/g)].map(m=>m[1]),[
  'faolla_attendance_period_closure_v1(jsonb,uuid,jsonb,jsonb,boolean)',
  'faolla_attendance_period_assert_open_v1(text,uuid,jsonb)',
  'faolla_attendance_retention_source_v1(text,text,uuid)']);
 for(const token of ['oid<>all(array[${signatures}])','continuation_prerequisite_changed_existing_functions',
  'continuation_install_changed_unapproved_functions','pg_get_functiondef(oid),proowner,proacl,proconfig,prosecdef'])assert(source.includes(token),token);
});
test('migration reentry, existing index identity, archive bytes and final rollback are checked',()=>{
 for(const token of ['continuation_existing_index_changed','continuation_install_changed_existing_rows',
  'Buffer.byteLength(value.artifactText,\'utf8\')',"createHash('sha256').update(value.artifactText,'utf8')",
  'install();assert.equal(d.fingerprint(),installed)','assert.equal(d.definitions(),installedDefs)',
  'assert.equal(d.tableCatalog(),installedCatalog)','acceptance=await verifyPeriodContinuationNative(ctx)',
  'capacity=await verifyPeriodContinuationCapacityNative(ctx)',
  'counts=await verifyPeriodContinuationCountsNative(ctx)',
  'finally {','continuation_probe_did_not_rollback','acceptance.rollbackRestored,true','capacity.rollbackRestored,true','counts.rollbackRestored,true'])assert(source.includes(token),token);
});
test('entry is inert without explicit execution and never reports browser or deployment acceptance',()=>{
 assert(source.includes('path.resolve(process.argv[1])===fileURLToPath(import.meta.url)'));
 assert(source.includes('process.exitCode=1'));assert(source.includes('newCluster:false,productionAccess:false,browser:false,deployed:false'));
});
test('optional local extension runs only after complete rollback and does not claim its committed test rows rolled back',()=>{
 assert(source.includes("after===null||typeof after==='function'"));
 const positions=['finally {','continuation_probe_did_not_rollback','counts.rollbackRestored,true','const extension=after?await after(ctx):undefined'].map(s=>source.indexOf(s));
 assert(positions.every((p,i)=>p>=0&&(i===0||p>positions[i-1])));
 assert(source.includes('coreRollbackRestored:true,rollbackRestored:after===null'));
});
