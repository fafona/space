//187 One already-existing, identity-checked synthetic PG15 only. No production,
//new database/dependency copy, real Auth or deployment. Root owns this lifecycle.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanAdoptionViewNative} from './fixtures/attendance-plan-adoption-view-native.mjs';
import {seedPlanExceptionHistoryNative} from './fixtures/attendance-plan-exception-history-native.mjs';
import {verifyWorkArrangementSecurityNative} from './fixtures/attendance-work-arrangements-security-native.mjs';
import {verifyWorkArrangementSealRaceNative} from './fixtures/attendance-work-arrangements-seal-race-native.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {lifecycleJson as json,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);
const prior=['202610030116_merchant_attendance_self_revision_history.sql','202610050146_merchant_attendance_plan_exception_source.sql',
  '202610050147_merchant_attendance_plan_exception_review.sql','202610050148_merchant_attendance_period_source.sql',
  '202610050149_merchant_attendance_period_closure.sql','202610050150_merchant_attendance_period_seal_guards.sql'];
const later=['202610050152_merchant_attendance_period_missing_context.sql','202610050153_merchant_attendance_period_session_capacity.sql',
  '202610050154_merchant_attendance_period_missing_root_capacity.sql','202610050155_merchant_attendance_period_fixed_boundaries.sql'];
const added=['202610060156_merchant_attendance_work_arrangements.sql','202610060157_merchant_attendance_work_arrangement_permission.sql',
  '202610060158_merchant_attendance_work_arrangement_periods.sql','202610060159_merchant_attendance_work_arrangement_exceptions.sql'];
let phase='entry';
export async function runWorkArrangementsNative(args,browserCheck=null,capacityCheck=null){
  const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],previous=keys.map(k=>process.env[k]);let result;
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    phase='prepare';const d=await preparePlanAdoptionViewNative(native,scope),{exec}=d;
    for(const m of prior)exec(boundClockMigrationBody(native.root,m));
    native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations/202610050151_merchant_attendance_period_source_ranges.sql'),'utf8')));
    for(const m of later)exec(boundClockMigrationBody(native.root,m));
    const h=await seedPlanExceptionHistoryNative({d,native,scope});
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.request','attendance.self.export']) p order by p)
      where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)});`);
    const {executePeriodClosures}=require('../src/lib/merchantAttendancePeriodClosure.server.ts');
    const {executeWorkArrangement}=require('../src/lib/merchantAttendanceWorkArrangement.server.ts');
    const {handleWorkArrangement}=require('../src/app/api/merchant-enterprise/attendance/work-arrangements/route-handler.ts');
    const {workArrangementQueryString,parseWorkArrangementResponse}=require('../src/lib/merchantAttendanceWorkArrangement.ts');
    const {executePlanExceptionSource,executePlanExceptions}=require('../src/lib/merchantAttendancePlanExceptions.server.ts');
    const pid=id(187900001);let counter=187900010,calls=0,negativeChecks=0,readChecks=0;
    const service={rpc:async(name,a)=>{calls++;let expression;
      if(name==='faolla_attendance_period_closure_v1')expression=`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${json(a.p_artifact)},${a.p_allow_write})`;
      else if(['faolla_attendance_work_arrangement_v1','faolla_attendance_plan_exception_review_v1'].includes(name))expression=`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${a.p_allow_write})`;
      else{assert(['faolla_attendance_period_closure_source_v1','faolla_attendance_plan_exception_source_v1'].includes(name));expression=`public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)})`;}
      try{return {data:JSON.parse(exec('set local role service_role;select '+expression+';')),error:null};}
      catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}}};
    const pq=(mode='preview',access='owner',periodId=pid,version=null)=>({siteId:d.site,access,workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate,mode,periodId,operationId:null,version});
    const period=(q,c=null,enabled=true)=>executePeriodClosures({query:q,command:c,authUserId:q.access==='owner'?d.owner:h.employeeAuthUserId,moduleEnabled:enabled},service);
    const pc=(action,current,fp=null)=>({action,operationId:id(counter++),periodId:pid,expectedRevision:current?.period.revision??0,
      expectedVersion:current?.period.currentVersion??0,expectedFingerprint:fp??current?.artifact?.sourceFingerprint??null,reason:'Synthetic187 work arrangement acceptance'});
    phase='save-old155';let preview=await period(pq('preview','owner',null)),current=await period(pq('detail'),pc('send',null,preview.preview.artifact.sourceFingerprint));
    current=await period(pq('detail','self'),pc('confirm',current));current=await period(pq('detail'),pc('seal',current));
    const archive=()=>exec(`set local role service_role;select public.faolla_attendance_period_closure_v1(${json(pq('export','owner',pid,1))},${quote(d.owner)},null,null,false);`);
    const oldArchive=JSON.parse(archive()),oldTables=d.inventory(),oldFacts=d.fingerprint(oldTables.filter(t=>t!=='faolla_schema_migrations'));
    phase='install';for(const m of added)exec(boundClockMigrationBody(native.root,m));
    assert.equal(d.fingerprint(oldTables.filter(t=>t!=='faolla_schema_migrations')),oldFacts);
    phase='reapply';const installedFacts=d.fingerprint(),installedDefs=d.definitions();for(const m of added)exec(boundClockMigrationBody(native.root,m));
    assert.equal(d.fingerprint(),installedFacts);assert.equal(d.definitions(),installedDefs);
    const fixed=JSON.parse(archive());assert.equal(fixed.artifactText,oldArchive.artifactText);assert.equal(fixed.artifactSha256,oldArchive.artifactSha256);
    native.pass('156–159 install/reentry preserve old155 archive and existing facts');
    exec(`update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.work_arrangement']) p order by p)
      where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)});`);
    const wq=(access='self',patch={})=>({siteId:d.site,access,requestId:null,operationId:null,beforeAt:null,beforeId:null,preview:null,...patch});
    const actor=q=>q.access==='owner'?d.owner:h.employeeAuthUserId;
    const work=(q,c=null,allowWrite=true)=>executeWorkArrangement({query:q,command:c,authUserId:actor(q),allowWrite},service);
    const read=async q=>{const before=d.fingerprint(),r=await work(q);assert.equal(d.fingerprint(),before);readChecks++;return r;};
    const negative=async(code,fn)=>{const before=d.fingerprint();await assert.rejects(fn,error=>error?.code===code);assert.equal(d.fingerprint(),before);negativeChecks++;};
    const home=await read(wq()),span={kind:'trip',timeZone:home.timeZone,startAt:h.slot.startAt,endAt:h.slot.endAt};
    const submit=(kind='trip',patch={})=>({action:'submit',operationId:id(counter++),reason:'Synthetic187 work arrangement',expectedWorkerId:h.workerId,
      expectedSettingsVersion:home.settingsVersion,expectedPolicyRevision:0,...span,kind,...patch});
    phase='sealed-submit';await negative('attendance_period_sealed',()=>work(wq(),submit()));
    current=await period(pq('detail'),pc('reopen',current),false);
    phase='pending';const previewWork=await read(wq('self',{preview:span}));assert.equal(previewWork.preview.canSubmit,true);
    const submitted=submit(),fresh=await work(wq(),submitted),requestId=fresh.receipt.item.requestId;
    const recovered=await read(wq('self',{operationId:submitted.operationId}));assert.deepEqual(recovered.receipt,fresh.receipt);
    const replayBefore=d.fingerprint();assert.deepEqual((await work(wq(),submitted,false)).receipt,fresh.receipt);assert.equal(d.fingerprint(),replayBefore);
    preview=await period(pq());assert(preview.preview.blockers.includes('pending_work_arrangement'));
    assert.equal(preview.preview.artifact.source.sourceVersion,'attendance-period-source-v2');assert.equal(preview.preview.artifact.source.context.workArrangements.length,1);
    current=await period(pq('detail'),pc('send',current,preview.preview.artifact.sourceFingerprint));current=await period(pq('detail','self'),pc('confirm',current));
    await negative('attendance_period_blocked',()=>period(pq('detail'),pc('seal',current)));
    const reviewQ={siteId:d.site,workerId:h.workerId,slotId:h.slot.id};
    let evidence=await executePlanExceptionSource({query:reviewQ,authUserId:d.owner},service);assert(evidence.blockers.includes('work_arrangement_pending'));
    let detail=(await read(wq('owner',{requestId}))).detail;assert(detail.conflicts.some(c=>c.source==='schedule'));
    const approve={action:'approve',operationId:id(counter++),requestId,expectedRevision:1,reason:'Synthetic explicit schedule overlap',expectedConflictsFingerprint:detail.conflictsFingerprint,confirmConflicts:true};
    await negative('attendance_work_arrangement_conflict_confirmation_required',()=>work(wq('owner',{requestId}),{...approve,confirmConflicts:false}));
    await negative('attendance_work_arrangement_conflicts_changed',()=>work(wq('owner',{requestId}),{...approve,expectedConflictsFingerprint:'0'.repeat(64)}));
    phase='approved-context';await work(wq('owner',{requestId}),approve);
    await negative('attendance_period_source_changed',()=>period(pq('detail'),pc('seal',current)));
    evidence=await executePlanExceptionSource({query:reviewQ,authUserId:d.owner},service);assert.equal(evidence.eligible,true);assert.equal(evidence.source.context.workArrangements.items[0].status,'approved');
    const reviewOp=id(counter++),reviewQuery={...reviewQ,access:'owner',mode:'decide',operationId:reviewOp,beforeAt:null,beforeId:null};
    const reviewed=await executePlanExceptions({query:reviewQuery,authUserId:d.owner,moduleEnabled:true,command:{operationId:reviewOp,expectedRevision:0,
      expectedFingerprint:evidence.fingerprint,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome:'excused',note:'Synthetic explicit human decision; no automatic exemption'}},service);
    assert.equal(reviewed.detail.latestDecision.evidence.contextRefs.workArrangements.items.length,1);
    preview=await period(pq());current=await period(pq('detail'),pc('send',current,preview.preview.artifact.sourceFingerprint));current=await period(pq('detail','self'),pc('confirm',current));
    const sealRace=await verifyWorkArrangementSealRaceNative({d,native,scope,h,current,period,pq,pc,submit,wq});
    current=sealRace.current;assert.equal(current.period.sealed,true);
    const cancel={action:'cancel',operationId:id(counter++),requestId,expectedRevision:2,reason:'Synthetic arrangement cancellation'};
    await negative('attendance_period_sealed',()=>work(wq('owner',{requestId}),cancel));
    current=await period(pq('detail'),pc('reopen',current),false);await work(wq('owner',{requestId}),cancel);
    assert.equal((await read(wq('self',{requestId}))).detail.status,'cancelled');
    assert.equal(JSON.parse(archive()).artifactText,oldArchive.artifactText);
    native.pass('real submit/recover/conflict approval/manual exception/new archive/confirmed seal/reopen/cancel with old bytes unchanged');
    phase='other-actions';
    const shifted=days=>({startAt:new Date(Date.parse(span.startAt)+days*86400000).toISOString(),endAt:new Date(Date.parse(span.endAt)+days*86400000).toISOString()});
    const remoteDay=shifted(4).startAt.slice(0,10),remoteStart=remoteDay+'T23:00:00.000Z';
    const remoteEnd=new Date(Date.parse(remoteStart)+3*3600000).toISOString();
    const remote=submit('remote',{startAt:remoteStart,endAt:remoteEnd}),field=submit('field',shifted(5));
    const overnight=await work(wq(),remote);assert.equal(overnight.receipt.item.startAt,remoteStart);assert.equal(overnight.receipt.item.endAt,remoteEnd);
    assert.notEqual(remoteStart.slice(0,10),remoteEnd.slice(0,10));await work(wq(),field);
    await work(wq('self',{requestId:remote.operationId}),{action:'withdraw',operationId:id(counter++),requestId:remote.operationId,expectedRevision:1,reason:'Synthetic withdrawal'});
    await work(wq('owner',{requestId:field.operationId}),{action:'reject',operationId:id(counter++),requestId:field.operationId,expectedRevision:1,reason:'Synthetic rejection'});
    await negative('attendance_work_arrangement_outside_window',()=>work(wq(),submit('trip',shifted(-40))));
    const policy={action:'set_policy',operationId:id(counter++),expectedRevision:0,retrospectiveDays:60,reason:'Synthetic separate retrospective policy'};
    await work(wq('owner'),policy);const old=submit('trip',{...shifted(-40),expectedPolicyRevision:1});await work(wq(),old);
    await negative('attendance_platform_paused',()=>work(wq(),submit('remote',{...shifted(6),expectedPolicyRevision:1}),false));
    await negative('attendance_operation_conflict',()=>work(wq(),{...remote,reason:'Different original command'}));
    native.pass('three categories, withdrawals/rejections, independent30→60day policy, pause and immutable operation conflicts');
    phase='handler';const handle=(request,access='self',enabled=true)=>handleWorkArrangement(request,{enabled:()=>enabled,allow:()=>true,
      authenticate:async()=>({user:{id:access==='owner'?d.owner:h.employeeAuthUserId},authenticationMethods:['password']}),
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),execute:i=>executeWorkArrangement(i,service)});
    const req=new Request('https://www.faolla.com/api/merchant-enterprise/attendance/work-arrangements?'+workArrangementQueryString(wq()),
      {headers:{host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin'}});
    const response=await handle(req),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));parseWorkArrangementResponse(body,wq());
    const browser=browserCheck?await browserCheck({d,h,native,scope,handle,work,wq,read,submit,span,service}):null;
    if(browser)native.pass('actual UI flow with synthetic Auth and parent initialization, real new handler/service/SQL, zero external requests');
    phase='security';const security=await verifyWorkArrangementSecurityNative({d,native,scope,h,work,wq});
    phase='capacity';const capacity=capacityCheck?await capacityCheck({d,native,scope,h,work,wq}):null;
    const lastFacts=d.fingerprint(),lastDefs=d.definitions();for(const m of added)exec(boundClockMigrationBody(native.root,m));assert.equal(d.fingerprint(),lastFacts);assert.equal(d.definitions(),lastDefs);
    result={readChecks,negativeChecks,rpcCalls:calls,old155ArchiveBytes:oldArchive.artifactBytes,oldArchivePreserved:true,migrationReentry:true,
      threeKinds:true,overnight:true,periodAndExceptionContexts:true,browser,security,sealRace:sealRace.result,capacity,productionAccess:false,newCluster:false,deployment:false};
  }));return result;}finally{keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.includes('--with-browser');
  const browserCheck=withBrowser?(await import('./fixtures/attendance-work-arrangement-browser.mjs')).runWorkArrangementBrowserAcceptance:null;
  runWorkArrangementsNative(args.filter(x=>x!=='--with-browser'),browserCheck).then(value=>console.log(JSON.stringify(value))).catch(error=>{
    console.error(JSON.stringify({error:'work_arrangements_native_failed',phase,detail:String(error).slice(0,7500)}));process.exitCode=1;});
}
