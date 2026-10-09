//230 explicit local acceptance only. The existing207 parent owns the stopped
//synthetic cluster, its disposable owned schema, public baseline and shutdown.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPlanPosthocReviewNative} from './merchant-attendance-plan-posthoc-review-native.mjs';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {verifyPosthocPartialLeaveNative,preparePosthocPartialLeaveBrowser} from './fixtures/attendance-plan-posthoc-partial-leave-native.mjs';
import {verifyPosthocPartialLeaveBrowser} from './fixtures/attendance-plan-posthoc-partial-leave-browser.mjs';

export function partialLeaveCheckArgs(args){
 assert(Array.isArray(args)&&args.every(v=>typeof v==='string'),'partial_leave_explicit_args_required');
 const browser=args.includes('--with-browser'),rest=args.filter(v=>v!=='--with-browser');
 assert(args.length===(browser?4:3)&&rest.length===3&&rest[0]==='--run-local'&&rest[1]==='--directory'
  &&path.isAbsolute(rest[2])&&rest[2].trim()===rest[2]&&!/[\u0000-\u001f\u007f]/.test(rest[2]),'partial_leave_explicit_args_required');
 return {nativeArgs:rest,browser};
}
const immutableTables=['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions',
 'merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts'];
function checkedArchive(value){
 assert(value&&typeof value.artifactText==='string'&&value.artifactText.length>0,'partial_leave_archive_required');
 assert.equal(value.artifactBytes,Buffer.byteLength(value.artifactText,'utf8'));
 assert.equal(value.artifactSha256,createHash('sha256').update(value.artifactText,'utf8').digest('hex'));
 return {artifactText:value.artifactText,artifactBytes:value.artifactBytes,artifactSha256:value.artifactSha256};
}
export async function runPosthocPartialLeaveCheck(args){
 const options=partialLeaveCheckArgs(args);
 return runPlanPosthocReviewNative(options.nativeArgs,async ctx=>{
  const {d,native,scope,archive,oldArchive}=ctx;
  assert.equal(d.syntheticOnly,true);assert.equal(ctx.h.syntheticOnly,true);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),original=checkedArchive(archive());
  assert.deepEqual(original,checkedArchive(oldArchive));
  let partial,browser=null;
  try{partial=await verifyPosthocPartialLeaveNative(ctx);}
  finally{
   assert.equal(d.fingerprint(),facts,'partial_leave_native_rollback_required');
   assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
   assert.deepEqual(checkedArchive(archive()),original);
  }
  assert.equal(partial.rollbackRestored,true);
  if(options.browser){
   const originals=d.fingerprint(immutableTables);
   const artifacts=()=>JSON.parse(d.exec("select coalesce(jsonb_agg(jsonb_build_object('id',artifact_id,'artifactText',artifact_text,'artifactBytes',artifact_bytes,'artifactSha256',artifact_sha256) order by artifact_id),'[]'::jsonb) from public.merchant_attendance_period_artifacts;"));
   const before=artifacts();assert(before.length>0&&before.length<=100);before.forEach(checkedArchive);
   try{
    const prepared=await preparePosthocPartialLeaveBrowser(ctx);
    browser=await verifyPosthocPartialLeaveBrowser(prepared);
   }finally{
    //This branch intentionally commits ONLY in the parent's disposable owned
    //schema so real HTTP/service calls can see each other's results. It is not
    //described as a rollback transaction; the parent drops its own schema and
    //verifies the pre-existing public database before shutdown, even on error.
    assert.equal(d.fingerprint(immutableTables),originals,'partial_leave_browser_changed_original_punches_or_rules');
    assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
    const after=new Map(artifacts().map(row=>[row.id,row]));
    for(const row of before)assert.deepEqual(after.get(row.id),row,'partial_leave_browser_changed_old_archive');
    assert.deepEqual(checkedArchive(archive()),original);
   }
  }
  native.pass('230 partial approved leave changes real edges; original punches, fixed rules and old archives preserved');
  return {phase:230,partial,browser,nativeRollbackRestored:true,browserUsesDisposableCommittedSchema:options.browser,
   immutableFactsPreserved:true,oldArchivesPreserved:true,cleanupOwner:'existing207 parent',newCluster:false,productionAccess:false,deployed:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPosthocPartialLeaveCheck(process.argv.slice(2))
 .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({error:'partial_leave_check_failed',detail:error?.stack??String(error)}));process.exitCode=1;});
