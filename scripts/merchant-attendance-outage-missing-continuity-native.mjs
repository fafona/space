//221 test-only: add actual missing-revision races to the fully checked219
//context. No new cluster, migration, production transport or historical edit.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutageContinuityNative} from './merchant-attendance-outage-continuity-native.mjs';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {verifyAttendanceOutageMissingRacesNative,outageMissingRaceWriteTables} from './fixtures/attendance-outage-missing-races-native.mjs';

export async function runAttendanceOutageMissingContinuityNative(args){
 return runAttendanceOutageContinuityNative(args,async ctx=>{
  const {d,native,scope,period,pq,periodId,archive,oldArchive,periodArchive,outageContinuityFoundation}=ctx;
  assert.equal(outageContinuityFoundation.phase,219);
  for(const key of ['oldRowsPreserved','oldFunctionsPreserved','oldArchivesPreserved'])assert.equal(outageContinuityFoundation[key],true,key);
  assert.equal(outageContinuityFoundation.sourceRaces.finalPendingRequestId,null);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const allowed=[...outageMissingRaceWriteTables];
  assert.equal(new Set(allowed).size,allowed.length);
  const protectedNames=d.inventory().filter(table=>!allowed.includes(table)),protectedBefore=d.fingerprint(protectedNames);
  const definitions=d.definitions(),catalog=d.tableCatalog(),saved=periodArchive();
  const oldRows=Object.fromEntries(allowed.map(table=>[table,JSON.parse(d.exec(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.${table} r;`))]));
  const missingRaces=await verifyAttendanceOutageMissingRacesNative(ctx);
  assert.equal(d.fingerprint(protectedNames),protectedBefore,'outage_missing_continuity_other_facts_changed');
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  for(const table of allowed)assert.equal(d.exec(`select not exists(select 1 from jsonb_array_elements(${json(oldRows[table])}) old_row where not exists(select 1 from public.${table} r where to_jsonb(r)=old_row));`),'t','outage_missing_continuity_old_rows_changed:'+table);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,saved.artifactText);assert.equal(periodArchive().artifactSha256,saved.artifactSha256);
  const current=await period(pq('detail','owner',periodId));assert(current.period.sealed);assert.equal(current.sourceChanged,false);
  return {phase:221,prerequisites:219,missingRaces,oldRowsPreserved:true,oldFunctionsPreserved:true,oldArchivesPreserved:true,
   concurrencyCommits:'caller-owned synthetic schema; outer lifecycle removes it and checks persistent baseline',
   browser:false,newCluster:false,productionAccess:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutageMissingContinuityNative(process.argv.slice(2))
 .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({error:'outage_missing_continuity_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
