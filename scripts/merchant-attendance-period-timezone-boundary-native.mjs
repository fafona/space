//184 LOCAL diagnosis only. Existing154 business functions remain unchanged.
//Reuse one stopped identity-checked synthetic PG15; no production or browser.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanAdoptionViewNative} from './fixtures/attendance-plan-adoption-view-native.mjs';
import {seedPlanExceptionHistoryNative} from './fixtures/attendance-plan-exception-history-native.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyPeriodTimezoneBoundaryNative} from './fixtures/attendance-period-timezone-boundary-native.mjs';

const beforeRanges=[
  '202610030116_merchant_attendance_self_revision_history.sql',
  '202610050146_merchant_attendance_plan_exception_source.sql',
  '202610050147_merchant_attendance_plan_exception_review.sql',
  '202610050148_merchant_attendance_period_source.sql',
  '202610050149_merchant_attendance_period_closure.sql',
  '202610050150_merchant_attendance_period_seal_guards.sql',
];
const rangesMigration='202610050151_merchant_attendance_period_source_ranges.sql';
const afterRanges=[
  '202610050152_merchant_attendance_period_missing_context.sql',
  '202610050153_merchant_attendance_period_session_capacity.sql',
  '202610050154_merchant_attendance_period_missing_root_capacity.sql',
];
let phase='entry';
export async function runPeriodTimezoneBoundaryNative(args){
  const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'];
  const previous=keys.map(key=>process.env[key]);let result;
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{
    await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
      phase='prepare';const d=await preparePlanAdoptionViewNative(native,scope);
      for(const migration of beforeRanges){phase='install:'+migration;d.exec(boundClockMigrationBody(native.root,migration));}
      //151 retains its original separate transactions/CONCURRENTLY stages.
      phase='install151';d.exec('select 1;');native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',rangesMigration),'utf8')));d.exec('select 1;');
      for(const migration of afterRanges){phase='install:'+migration;d.exec(boundClockMigrationBody(native.root,migration));}
      phase='synthetic-history';const h=await seedPlanExceptionHistoryNative({d,native,scope});
      const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
      phase='timezone-boundary154';const diagnosis=await verifyPeriodTimezoneBoundaryNative({d,native,scope,h});
      assert.equal(d.fingerprint(),facts,'timezone_diagnostic_facts_not_restored');
      assert.equal(d.definitions(),definitions,'timezone_diagnostic_functions_changed');
      assert.equal(d.tableCatalog(),catalog,'timezone_diagnostic_catalog_changed');
      native.pass('154 timezone diagnosis: actual settings protections, reachable empty-period continuation and preserved archives');
      result={diagnosis,diagnosticOnly:true,businessFunctionsChanged:false,baselineRestored:true,
        productionAccess:false,newCluster:false,browser:null,deployment:false,migrationCandidate:154};
    }));
    return result;
  }finally{
    keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runPeriodTimezoneBoundaryNative(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(JSON.stringify({error:'period_timezone_boundary_native_failed',phase,detail:String(error).slice(0,6000)}));process.exitCode=1;
  });
}
