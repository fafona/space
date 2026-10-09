//218: complete217 baseline, then bounded capacity rollback and six actual
//lock-witnessed orderings. All commits stay in the existing owned test schema;
//the established outer runner verifies cleanup/public baseline and stops PG.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutageSubjectNative} from './merchant-attendance-outage-subject-native.mjs';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {outageNativeTables} from './fixtures/attendance-outage-native.mjs';
import {outageLinksNativeTables} from './fixtures/attendance-outage-links-native.mjs';
import {outageReviewsNativeTables} from './fixtures/attendance-outage-reviews-native.mjs';
import {outagePeriodWriteTables} from './fixtures/attendance-outage-periods-native.mjs';
import {verifyAttendanceOutageCapacityNative} from './fixtures/attendance-outage-capacity-native.mjs';
import {verifyAttendanceOutageReviewRacesNative} from './fixtures/attendance-outage-review-races-native.mjs';
import {verifyAttendanceOutageSealRacesNative} from './fixtures/attendance-outage-seal-races-native.mjs';
export async function runAttendanceOutageBoundariesNative(args,after=null){
 assert(after===null||typeof after==='function','outage_boundaries_owned_extension_invalid');
 return runAttendanceOutageSubjectNative(args,async ctx=>{
  const {d,native,scope,period,pq,periodId,archive,oldArchive,periodArchive,outageSubjectFoundation}=ctx;
  assert.equal(outageSubjectFoundation.phase,217);assert.equal(outageSubjectFoundation.rollbackRestored,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const before=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),saved=periodArchive();
  const capacity=await verifyAttendanceOutageCapacityNative(ctx);assert.equal(d.fingerprint(),before,'outage_capacity_did_not_rollback');
  const allowed=[...outageNativeTables,...outageLinksNativeTables,...outageReviewsNativeTables,...outagePeriodWriteTables];
  const protectedNames=d.inventory().filter(t=>!allowed.includes(t)),protectedBefore=d.fingerprint(protectedNames);
  const originals=Object.fromEntries(allowed.map(t=>[t,JSON.parse(d.exec(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.${t} r;`))]));
  const reviews=await verifyAttendanceOutageReviewRacesNative(ctx),seals=await verifyAttendanceOutageSealRacesNative(ctx);
  assert.equal(d.fingerprint(protectedNames),protectedBefore);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  for(const t of allowed)assert.equal(d.exec(`select ${json(originals[t])} <@ coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.${t} r;`),'t','outage_boundary_old_rows_changed:'+t);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,saved.artifactText);assert.equal(periodArchive().artifactSha256,saved.artifactSha256);
  const unchanged=await period(pq('detail','owner',periodId));assert(unchanged.period.sealed);assert.equal(unchanged.sourceChanged,false);
  const result={phase:218,prerequisites:217,capacity,reviews,seals,oldRowsPreserved:true,oldFunctionsPreserved:true,oldArchivesPreserved:true,
   concurrencyCommits:'caller-owned synthetic schema; outer lifecycle removes it and checks persistent baseline',browser:false,newCluster:false,productionAccess:false,deployed:false};
  if(after!==null)return {...result,extension:await after({...ctx,outageBoundariesFoundation:result})};
  return result;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutageBoundariesNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'outage_boundaries_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
