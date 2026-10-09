//219 test-only. Extend the already checked218 owned context: two rollback
//matrices first, then two real source races committed only in that same schema.
//The original lifecycle owns exact-schema cleanup and persistent-baseline proof.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceOutageBoundariesNative} from './merchant-attendance-outage-boundaries-native.mjs';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {outageNativeTables} from './fixtures/attendance-outage-native.mjs';
import {outageLinksNativeTables} from './fixtures/attendance-outage-links-native.mjs';
import {outageReviewsNativeTables} from './fixtures/attendance-outage-reviews-native.mjs';
import {verifyAttendanceOutageHistoryNative} from './fixtures/attendance-outage-history-native.mjs';
import {verifyAttendanceOutageAuthorizationNative} from './fixtures/attendance-outage-authorization-native.mjs';
import {verifyAttendanceOutageSourceRacesNative} from './fixtures/attendance-outage-source-races-native.mjs';

export async function runAttendanceOutageContinuityNative(args,after=null){
 assert(after===null||typeof after==='function','outage_continuity_owned_extension_invalid');
 return runAttendanceOutageBoundariesNative(args,async ctx=>{
  const {d,native,scope,period,pq,periodId,archive,oldArchive,periodArchive,outageBoundariesFoundation}=ctx;
  assert.equal(outageBoundariesFoundation.phase,218);assert.equal(outageBoundariesFoundation.oldRowsPreserved,true);
  assert.equal(outageBoundariesFoundation.oldFunctionsPreserved,true);assert.equal(outageBoundariesFoundation.oldArchivesPreserved,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const before=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),saved=periodArchive();
  const history=await verifyAttendanceOutageHistoryNative(ctx);
  assert.equal(d.fingerprint(),before,'outage_history_did_not_rollback');
  const authorization=await verifyAttendanceOutageAuthorizationNative(ctx);
  assert.equal(d.fingerprint(),before,'outage_authorization_did_not_rollback');
  const allowed=[...outageNativeTables,...outageLinksNativeTables,...outageReviewsNativeTables,
   'merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings'];
  const protectedNames=d.inventory().filter(t=>!allowed.includes(t)),protectedBefore=d.fingerprint(protectedNames);
  const originals=Object.fromEntries(allowed.map(t=>[t,JSON.parse(d.exec(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.${t} r;`))]));
  const sourceRaces=await verifyAttendanceOutageSourceRacesNative(ctx);
  assert.equal(d.fingerprint(protectedNames),protectedBefore);assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);
  for(const t of allowed)assert.equal(d.exec(`select not exists(select 1 from jsonb_array_elements(${json(originals[t])}) old_row where not exists(select 1 from public.${t} r where to_jsonb(r)=old_row));`),'t','outage_continuity_old_rows_changed:'+t);
  assert.equal(archive().artifactText,oldArchive.artifactText);assert.equal(archive().artifactSha256,oldArchive.artifactSha256);
  assert.equal(periodArchive().artifactText,saved.artifactText);assert.equal(periodArchive().artifactSha256,saved.artifactSha256);
  const unchanged=await period(pq('detail','owner',periodId));assert(unchanged.period.sealed);assert.equal(unchanged.sourceChanged,false);
  const result={phase:219,prerequisites:218,history,authorization,sourceRaces,oldRowsPreserved:true,oldFunctionsPreserved:true,oldArchivesPreserved:true,
   concurrencyCommits:'caller-owned synthetic schema; outer lifecycle removes it and checks persistent baseline',browser:false,newCluster:false,productionAccess:false,deployed:false};
  if(after!==null)return {...result,extension:await after({...ctx,outageContinuityFoundation:result})};
  return result;
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceOutageContinuityNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'outage_continuity_native_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
