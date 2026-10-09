//182 LOCAL diagnostic only: reuse the stopped, identity-checked synthetic PG15.
//No business/migration edits, new cluster, production access or browser run.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanAdoptionViewNative} from './fixtures/attendance-plan-adoption-view-native.mjs';
import {seedPlanExceptionHistoryNative} from './fixtures/attendance-plan-exception-history-native.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {verifyPeriodMissingRootCapacityNative} from './fixtures/attendance-period-missing-root-capacity-native.mjs';

const transactionalBeforeRanges=[
  '202610030116_merchant_attendance_self_revision_history.sql',
  '202610050146_merchant_attendance_plan_exception_source.sql',
  '202610050147_merchant_attendance_plan_exception_review.sql',
  '202610050148_merchant_attendance_period_source.sql',
  '202610050149_merchant_attendance_period_closure.sql',
  '202610050150_merchant_attendance_period_seal_guards.sql',
];
const rangesMigration='202610050151_merchant_attendance_period_source_ranges.sql';
const transactionalAfterRanges=[
  '202610050152_merchant_attendance_period_missing_context.sql',
  '202610050153_merchant_attendance_period_session_capacity.sql',
];
let phase='entry';
export async function runPeriodMissingRootNative(args){
  const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'];
  const previous=keys.map(key=>process.env[key]);let result;
  //Ephemeral synthetic-only secrets required by the existing fixture setup.
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{
    await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
      phase='prepare';const d=await preparePlanAdoptionViewNative(native,scope);
      for(const migration of transactionalBeforeRanges){phase='install:'+migration;d.exec(boundClockMigrationBody(native.root,migration));}
      //151 retains its own staged transactions/CONCURRENTLY statements.
      phase='install151';d.exec('select 1;');native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',rangesMigration),'utf8')));d.exec('select 1;');
      for(const migration of transactionalAfterRanges){phase='install:'+migration;d.exec(boundClockMigrationBody(native.root,migration));}
      phase='synthetic-history';const h=await seedPlanExceptionHistoryNative({d,native,scope});
      //The reused multi-channel setup resets this synthetic role's permissions.
      //Enable requests only for h's owned fixture role BEFORE the read baseline;
      //the diagnostic itself neither changes roles nor bypasses writer checks.
      d.exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request']) p order by p)
        where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)});`);
      const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
      phase='root-capacity153';const diagnosis=await verifyPeriodMissingRootCapacityNative({d,native,scope,h});
      assert.equal(d.fingerprint(),facts,'root_diagnostic_facts_not_restored');
      assert.equal(d.definitions(),definitions,'root_diagnostic_definitions_changed');
      assert.equal(d.tableCatalog(),catalog,'root_diagnostic_catalog_changed');
      native.pass('153 diagnostic only: missing-declaration root history capacity and unchanged actual unified reports');
      result={diagnosis,diagnosticOnly:true,businessReadersChanged:false,functionsUnchanged:true,
        baselineRestored:true,productionAccess:false,newCluster:false,browser:null,migrationCandidate:153};
    }));
    return result;
  }finally{
    keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runPeriodMissingRootNative(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(JSON.stringify({error:'period_missing_root_native_failed',phase,detail:String(error).slice(0,4500)}));process.exitCode=1;
  });
}
