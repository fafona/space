// Explicit local-only extension. The core probes retain full rollback guards;
// only new synthetic period rows are committed inside the owned disposable schema.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPeriodContinuationNative} from './merchant-attendance-period-continuation-native.mjs';
import {verifyPeriodContinuationRacesNative} from './fixtures/attendance-period-continuation-races-native.mjs';
import {verifyPeriodContinuationLiveBrowser} from './fixtures/attendance-period-continuation-live-browser.mjs';

export async function runPeriodContinuationLiveNative(args){
 return runPeriodContinuationNative(args,async ctx=>{
  assert.equal(ctx.d.syntheticOnly,true);assert.equal(ctx.h.syntheticOnly,true);
  const races=await verifyPeriodContinuationRacesNative(ctx);
  const browser=await verifyPeriodContinuationLiveBrowser(ctx);
  return {phase:231,races,browser,committedOnlyNewSyntheticPeriods:true,
   cleanupOwnedByParent:true,realAuth:false,productionAccess:false,newCluster:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPeriodContinuationLiveNative(process.argv.slice(2))
 .then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(JSON.stringify({error:'period_continuation_live_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
