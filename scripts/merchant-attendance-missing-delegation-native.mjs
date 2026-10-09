//189 Reuses the established guarded cluster and minimal preparation, not187's
//post-callback157 reinstall (which would undo161's new permission catalog).
//No new cluster, database copy, production connection or full application build.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanAdoptionViewNative} from './fixtures/attendance-plan-adoption-view-native.mjs';
import {seedPlanExceptionHistoryNative} from './fixtures/attendance-plan-exception-history-native.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {verifyMissingDelegationNative} from './fixtures/attendance-missing-delegation-native.mjs';
const require=createRequire(import.meta.url);
const beforeIndex=['202610030116_merchant_attendance_self_revision_history.sql','202610050146_merchant_attendance_plan_exception_source.sql',
  '202610050147_merchant_attendance_plan_exception_review.sql','202610050148_merchant_attendance_period_source.sql',
  '202610050149_merchant_attendance_period_closure.sql','202610050150_merchant_attendance_period_seal_guards.sql'];
const afterIndex=['202610050152_merchant_attendance_period_missing_context.sql','202610050153_merchant_attendance_period_session_capacity.sql',
  '202610050154_merchant_attendance_period_missing_root_capacity.sql','202610050155_merchant_attendance_period_fixed_boundaries.sql'];
const beforeDelegation=['202610060156_merchant_attendance_work_arrangements.sql','202610060157_merchant_attendance_work_arrangement_permission.sql',
  '202610060158_merchant_attendance_work_arrangement_periods.sql','202610060159_merchant_attendance_work_arrangement_exceptions.sql'];
export async function runMissingDelegationNative(args,browserCheck=null){
  const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],previous=keys.map(k=>process.env[k]);let result;
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    const d=await preparePlanAdoptionViewNative(native,scope),{exec}=d;
    for(const m of beforeIndex)exec(boundClockMigrationBody(native.root,m));
    native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050151_merchant_attendance_period_source_ranges.sql'),'utf8')));
    for(const m of afterIndex)exec(boundClockMigrationBody(native.root,m));
    const h=await seedPlanExceptionHistoryNative({d,native,scope});
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.export']) p order by p)
      where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)});`);
    const {executePeriodClosures}=require('../src/lib/merchantAttendancePeriodClosure.server.ts');
    const periodId=id(189900001);let operation=189900010;
    const pq=(mode='preview',access='owner',pid=null)=>({siteId:d.site,access,workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate,mode,periodId:pid,operationId:null,version:null});
    const service={rpc:async(name,a)=>{const expression=name==='faolla_attendance_period_closure_v1'
      ?`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${json(a.p_artifact)},${a.p_allow_write})`
      :`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)})`;
      assert(['faolla_attendance_period_closure_v1','faolla_attendance_period_closure_source_v1'].includes(name));
      try{return {data:JSON.parse(exec('set local role service_role;select '+expression+';')),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const period=(q,c=null)=>executePeriodClosures({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,moduleEnabled:true},service);
    const preview=await period(pq());
    const command=(action,current=null)=>({action,operationId:id(operation++),periodId,expectedRevision:current?.period.revision??0,expectedVersion:current?.period.currentVersion??0,
      expectedFingerprint:current?.artifact.sourceFingerprint??preview.preview.artifact.sourceFingerprint,reason:'Synthetic189 original155 compatibility archive'});
    let current=await period(pq('detail','owner',periodId),command('send'));
    current=await period(pq('detail','self',periodId),command('confirm',current));current=await period(pq('detail','owner',periodId),command('seal',current));assert(current.period.sealed);
    const archive=()=>JSON.parse(exec(`set local role service_role;select public.faolla_attendance_period_closure_v1(${json({...pq('export','owner',periodId),version:1})},${quote(d.owner)},null,null,false);`));
    const original=archive();for(const m of beforeDelegation)exec(boundClockMigrationBody(native.root,m));
    assert.equal(archive().artifactText,original.artifactText);
    result=await verifyMissingDelegationNative({d,h,native,scope},browserCheck);
    const retained=archive();assert.equal(retained.artifactText,original.artifactText);assert.equal(retained.artifactSha256,original.artifactSha256);
    native.pass('original155 sealed archive bytes and fingerprint retained through161 and complete new approval/browser flow');
    result={...result,old155ArchiveBytes:original.artifactBytes,old155ArchivePreserved:true};
  }));return result;}finally{keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.includes('--with-browser');
  const browserCheck=withBrowser?(await import('./fixtures/attendance-missing-delegation-browser.mjs')).runMissingDelegationBrowserAcceptance:null;
  runMissingDelegationNative(args.filter(x=>x!=='--with-browser'),browserCheck).then(r=>console.log(JSON.stringify(r))).catch(error=>{
    console.error(JSON.stringify({error:'missing_delegation_native_failed',detail:String(error).slice(0,14000)}));process.exitCode=1;});
}
