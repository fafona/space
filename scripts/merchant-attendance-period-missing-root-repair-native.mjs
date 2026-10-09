//183 LOCAL acceptance only. Reuse one stopped, identity-checked synthetic PG15.
//No production, new cluster, browser, historical migration edits or deployment.
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
import {verifyPeriodSourceNative} from './fixtures/attendance-period-source-native.mjs';
import {verifyPeriodMissingRootRepairInstallNative,verifyPeriodMissingRootRepairNative} from './fixtures/attendance-period-missing-root-repair-native.mjs';

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
];
const repairMigration='202610050154_merchant_attendance_period_missing_root_capacity.sql';
let phase='entry';
export async function runPeriodMissingRootRepairNative(args){
  const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'];
  const previous=keys.map(key=>process.env[key]);let result;
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{
    await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
      phase='prepare';const d=await preparePlanAdoptionViewNative(native,scope);
      for(const migration of beforeRanges){phase='install:'+migration;d.exec(boundClockMigrationBody(native.root,migration));}
      //151 owns staged transactions and concurrent index creation.
      phase='install151';d.exec('select 1;');native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',rangesMigration),'utf8')));d.exec('select 1;');
      for(const migration of afterRanges){phase='install:'+migration;d.exec(boundClockMigrationBody(native.root,migration));}
      phase='synthetic-history';const h=await seedPlanExceptionHistoryNative({d,native,scope});
      //Only the explicitly owned synthetic role is prepared before the baseline.
      d.exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.export']) p order by p)
        where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)});`);
      const unrelatedFunctionsSql=`select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid))
        from pg_proc p where p.pronamespace=${d.owned.oid} and p.prokind='f' and p.proname<>'faolla_attendance_period_source_v1';`;
      const unrelatedFunctions=d.exec(unrelatedFunctionsSql);
      phase='source153';const source=await verifyPeriodSourceNative({d,native,scope,h});
      native.pass('153 complete source and real Node artifact projection before migration');
      phase='archive-install154';const install=await verifyPeriodMissingRootRepairInstallNative({d,native,scope,h,source});
      native.pass('154 atomic installation: old fixed archive and normal canonical source preserved');
      phase='install154';d.exec(boundClockMigrationBody(native.root,repairMigration));
      assert.equal(d.exec(unrelatedFunctionsSql),unrelatedFunctions,'repair_changed_unrelated_functions_or_acls');
      const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
      phase='repair154';const repair=await verifyPeriodMissingRootRepairNative({d,native,scope,h});
      assert.equal(d.fingerprint(),facts,'repair_acceptance_facts_not_restored');
      assert.equal(d.definitions(),definitions,'repair_acceptance_definitions_changed');
      assert.equal(d.tableCatalog(),catalog,'repair_acceptance_catalog_changed');
      assert.equal(d.exec(unrelatedFunctionsSql),unrelatedFunctions,'repair_acceptance_changed_unrelated_functions');
      native.pass('154 root capacity, related limit, legitimate revisions and invalid historical approval relationships');
      result={source153:{checks:source.checks,sourceReads:source.sourceReads,negativeChecks:source.negativeChecks},install,repair,
        onlyPeriodSourceReaderChanged:true,unrelatedFunctionsAndAclsUnchanged:true,baselineRestored:true,
        productionAccess:false,newCluster:false,browser:null,deployment:false,migrationCandidate:154};
    }));
    return result;
  }finally{
    keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runPeriodMissingRootRepairNative(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(JSON.stringify({error:'period_missing_root_repair_native_failed',phase,detail:String(error).slice(0,6000)}));process.exitCode=1;
  });
}
