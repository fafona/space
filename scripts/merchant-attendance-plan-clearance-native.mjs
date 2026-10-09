//202 targeted acceptance. Reuse the one explicitly selected stopped local PG15
//cluster; install prerequisites, not the unrelated191-200 scenario chain.
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
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {verifyPlanClearanceNative} from './fixtures/attendance-plan-clearance-native.mjs';
const require=createRequire(import.meta.url);
const beforeIndex=['202610030116_merchant_attendance_self_revision_history.sql','202610050146_merchant_attendance_plan_exception_source.sql',
  '202610050147_merchant_attendance_plan_exception_review.sql','202610050148_merchant_attendance_period_source.sql',
  '202610050149_merchant_attendance_period_closure.sql','202610050150_merchant_attendance_period_seal_guards.sql'];
const afterIndex=['202610050152_merchant_attendance_period_missing_context.sql','202610050153_merchant_attendance_period_session_capacity.sql',
  '202610050154_merchant_attendance_period_missing_root_capacity.sql','202610050155_merchant_attendance_period_fixed_boundaries.sql'];
const beforeEnterprise=['202610040125_merchant_attendance_leave_notifications.sql','202610060156_merchant_attendance_work_arrangements.sql','202610060157_merchant_attendance_work_arrangement_permission.sql',
  '202610060158_merchant_attendance_work_arrangement_periods.sql','202610060159_merchant_attendance_work_arrangement_exceptions.sql',
  '202610060160_merchant_attendance_missing_delegation.sql','202610060161_merchant_attendance_missing_delegation_permission.sql',
  '202610060162_merchant_attendance_application_delegation.sql','202610060163_merchant_attendance_application_delegation_permissions.sql'];
const afterEnterprise=['202610060164_merchant_attendance_account_suspensions.sql','202610060166_merchant_attendance_employment_lifecycle.sql','202610030120_merchant_attendance_schedule_overview.sql',
  '202610060167_merchant_attendance_schedule_delegation.sql','202610060168_merchant_attendance_schedule_delegation_permissions.sql',
  '202610060169_merchant_attendance_event_notifications.sql'];
export async function runPlanClearanceNative(args,browserCheck=null){
  const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],prior=keys.map(k=>process.env[k]);let result;
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    const d=await preparePlanAdoptionViewNative(native,scope),{exec}=d;
    const install=name=>{try{const original=readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8');
      if(/create index concurrently/i.test(original)){exec('select 1;');return native.query(scope.sql(original));}
      return exec(boundClockMigrationBody(native.root,name).replace(/(set search_path\s*=\s*)public\b/g,`$1${d.owned.schema}`));}
      catch(error){throw new Error('install:'+name+':'+String(error),{cause:error});}};
    for(const name of beforeIndex)install(name);
    try{native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050151_merchant_attendance_period_source_ranges.sql'),'utf8')));}
    catch(error){throw new Error('install151:'+String(error),{cause:error});}
    for(const name of afterIndex)install(name);
    const h=await seedPlanExceptionHistoryNative({d,native,scope});
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.export']) p order by p)
      where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)});`);
    const {executePeriodClosures}=require('../src/lib/merchantAttendancePeriodClosure.server.ts');let n=202900010;
    const periodId=id(202900001),pq=(mode='preview',access='owner',pid=null)=>({siteId:d.site,access,workerId:h.workerId,
      fromDate:h.slot.workDate,throughDate:h.slot.workDate,mode,periodId:pid,operationId:null,version:null});
    const service={rpc:async(name,a)=>{assert(['faolla_attendance_period_closure_v1','faolla_attendance_period_closure_source_v1'].includes(name));
      const expression=name==='faolla_attendance_period_closure_v1'?`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${json(a.p_artifact)},${a.p_allow_write})`
        :`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)})`;
      try{return {data:JSON.parse(exec('set local role service_role;select '+expression+';')),error:null};}
      catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
    const period=(q,c=null,allow=true)=>executePeriodClosures({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,moduleEnabled:allow},service);
    const initial=await period(pq());
    const pc=(action,current=null,fingerprint=null)=>({action,operationId:id(n++),periodId,expectedRevision:current?.period.revision??0,
      expectedVersion:current?.period.currentVersion??0,expectedFingerprint:fingerprint??current?.artifact.sourceFingerprint??initial.preview.artifact.sourceFingerprint,
      reason:'Synthetic202 explicit period operation'});
    let current=await period(pq('detail','owner',periodId),pc('send'));
    current=await period(pq('detail','self',periodId),pc('confirm',current));current=await period(pq('detail','owner',periodId),pc('seal',current));assert(current.period.sealed);
    const archive=()=>JSON.parse(exec(`set local role service_role;select public.faolla_attendance_period_closure_v1(${json({...pq('export','owner',periodId),version:1})},${quote(d.owner)},null,null,false);`));
    const original=archive();for(const name of beforeEnterprise)install(name);
    await prepareAttendanceEmployeeManagement(native,scope);
    //The helper validates exact required019 objects in this owned schema. As in
    //193, this marker describes the synthetic preparation, not production.
    exec("insert into public.faolla_schema_migrations(version,name) values(202608020019,'merchant_enterprise_audit');");
    for(const name of afterEnterprise)install(name);
    result=await verifyPlanClearanceNative({d,h,native,scope,install,period,pq,pc,periodId,archive},browserCheck);
    assert.equal(archive().artifactText,original.artifactText);assert.equal(archive().artifactSha256,original.artifactSha256);
    native.pass('202 original155 sealed artifact text/hash retained through170 and complete clearance lifecycle');
    result={...result,old155ArchiveBytes:original.artifactBytes,old155ArchivePreserved:true,newCluster:false,production:false,deployed:false};
  }));return result;}finally{keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.includes('--with-browser');
  const browserCheck=withBrowser?(await import('./fixtures/attendance-plan-clearance-browser.mjs')).runPlanClearanceBrowserAcceptance:null;
  runPlanClearanceNative(args.filter(x=>x!=='--with-browser'),browserCheck).then(value=>console.log(JSON.stringify(value)))
    .catch(error=>{console.error(JSON.stringify({error:'plan_clearance_native_failed',detail:String(error).slice(0,24000)}));process.exitCode=1;});
}
