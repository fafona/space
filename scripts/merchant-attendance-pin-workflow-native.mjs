// Real PIN writer -> existing history/correction/approval/report executors.
// One existing, ownership-checked local database; no production or direct event inserts.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkPinClock} from './merchant-attendance-pin-clock-native.mjs';
const require=createRequire(import.meta.url);
const {executePinAdmin}=require('../src/lib/merchantAttendancePin.server.ts');
const {executePinClock}=require('../src/lib/merchantAttendancePinClock.server.ts');
const {executeAttendanceSelf}=require('../src/lib/merchantAttendanceSelf.server.ts');
const {executeAttendanceHistory}=require('../src/lib/merchantAttendanceHistory.server.ts');
const {executeAttendanceCorrection}=require('../src/lib/merchantAttendanceCorrection.server.ts');
const {executeCurrentCorrectionDecision}=require('../src/lib/merchantAttendanceCurrentCorrectionDecision.server.ts');
const {executeRevisionCycle}=require('../src/lib/merchantAttendanceRevisionCycle.server.ts');
const {executeRevisionDecision}=require('../src/lib/merchantAttendanceRevisionDecision.server.ts');
const {executeUnifiedTimesheet}=require('../src/lib/merchantAttendanceUnifiedTimesheet.server.ts');
const {executeUnifiedExport}=require('../src/lib/merchantAttendanceUnifiedExport.server.ts');
const lit=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'";
export const workflowJson=v=>v==null?'null':lit(JSON.stringify(v))+'::jsonb';
export function workflowCsvWorkedUs(csv){
  const rows=csv.split('\r\n').filter(row=>row.startsWith('"汇总","selected",'));assert.equal(rows.length,1);
  const fields=[...rows[0].matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>m[1]);
  assert(/^\d+$/.test(fields[13]));return Number(fields[13]);
}
const instant=ms=>new Date(ms).toISOString().replace('Z','000Z');
export async function checkPinWorkflow(native,browserCheck=null){
  await checkPinClock(native,async env=>{
    const {root,exec,id,site,owner,location,pass}=env,json=workflowJson;
    const folder=path.join(root,'scripts/supabase-migrations');
    const names=readdirSync(folder).filter(n=>/^\d{12}_/.test(n)&&((Number(n.slice(0,12))>=202609300087&&Number(n.slice(0,12))<=202610010103)||/^2026093000(68|79)_/.test(n)||n.startsWith('202610010105_'))).sort();
    assert.equal(names.length,20);for(const name of names)exec(readFileSync(path.join(folder,name),'utf8'));
    // Only synthetic configuration in the disposable, owned namespace.
    exec(`update public.merchant_enterprise_roles set permissions=array_append(permissions,'attendance.self.request') where id='${id(30)}';`);
    const people=[3,4,5].map(n=>({auth:id(n),employee:id(100+n),worker:id(200+n),no:`PIN-0${n}`,pin:n===3?'02718364':n===4?'08374629':'06592847'}));
    for(const p of people){
      exec(`insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${p.employee}','${site}','${p.auth}','workflow${p.no}@example.test','链路员工 ${p.no}','${id(30)}','active');
        insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${p.worker}','${site}','${p.employee}','${p.no}','链路员工 ${p.no}','${location}',true);
        insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${p.worker}','2020-01-01');`);
      await executePinAdmin({siteId:site,authUserId:owner,workerNo:p.no,operationId:null,allowSet:true,command:{action:'set',operationId:randomUUID(),expectedRevision:0,workerId:p.worker,employeeId:p.employee,pin:p.pin,salt:randomBytes(16).toString('hex')}},env.service);
    }
    exec(`set role service_role;select public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json({action:'set_policy',operationId:randomUUID(),expectedRevision:0,expectedSettingsVersion:1,submissionWindowDays:30,reason:'Synthetic PIN workflow policy'})},null,null,true);`);
    const service={rpc:async(name,a)=>{
      if(['faolla_attendance_pin_begin_v1','faolla_attendance_pin_clock_v1','faolla_attendance_terminal_device_v1'].includes(name))return env.service.rpc(name,a);
      assert.equal(a.p_site_id,site);assert([owner,id(1),...people.map(p=>p.auth)].includes(a.p_auth_user_id));
      const params=[lit(site),lit(a.p_auth_user_id)];
      if(['faolla_attendance_correction_self_v3','faolla_attendance_revision_self_v2'].includes(name))params.push(json(a.p_query),json(a.p_command),String(a.p_platform_enabled===true));
      else if(['faolla_attendance_correction_decide_v2','faolla_attendance_revision_decide_v2'].includes(name))params.push(lit(a.p_request_id),json(a.p_command),lit(a.p_operation_id),String(a.p_allow_write===true));
      else if(name==='faolla_attendance_unified_export_v1')params.push(lit(a.p_operation_id),json(a.p_query));
      else if(name==='faolla_attendance_self_v1')params.push(json(a.p_command),lit(a.p_operation_id));
      else if(['faolla_attendance_self_history_v1','faolla_attendance_unified_report_v1','faolla_attendance_correction_owner_review_v3'].includes(name))params.push(json(a.p_query));
      else assert.equal(name,'faolla_attendance_self_context_v1');
      try{return {data:JSON.parse(exec(`set role service_role;select public.${name}(${params.join(',')});`)),error:null};}
      catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}
    }};
    const raw=()=>exec("select md5(jsonb_agg(to_jsonb(e) order by worker_id,sequence)::text) from public.merchant_attendance_events e;");
    const receipts=()=>exec("select md5(jsonb_agg(to_jsonb(r) order by event_id)::text) from public.merchant_attendance_pin_clock_receipts r;");
    const p=people[0],events=[];
    for(const [sequence,action] of ['clock_in','break_start','break_end','clock_out'].entries()){
      const r=await executePinClock({...env.input,workerNo:p.no,pin:p.pin,command:{expectedWorkerId:p.worker,expectedEmployeeId:p.employee,locationId:location,action,expectedSequence:sequence,operationId:randomUUID()}},service);
      events.push(r.receipt);assert.equal(r.state.sequence,sequence+1);
    }
    const now=Date.now(),fromDate=new Date(now-86400000).toISOString().slice(0,10),throughDate=new Date(now+86400000).toISOString().slice(0,10);
    const historyInput=person=>({siteId:site,authUserId:person.auth,expectedWorkerId:person.worker,fromAt:fromDate+'T00:00:00.000000Z',toAt:throughDate+'T23:59:59.999999Z',asOf:null,cursorAt:null,cursorId:null});
    const history=await executeAttendanceHistory(historyInput(p),service);assert.equal(history.items.length,4);
    assert.deepEqual(history.items.map(e=>e.id).sort(),events.map(e=>e.id).sort());assert(history.items.every(e=>e.source==='kiosk'));
    assert.equal(exec(`select count(*) from public.merchant_attendance_events where worker_id='${p.worker}' and actor_employee_id='${p.employee}';`),'4');
    assert.equal((await executeAttendanceHistory(historyInput(people[1]),service)).items.length,0);
    await assert.rejects(executeAttendanceHistory({...historyInput(p),authUserId:people[1].auth},service),/attendance_worker_changed/);
    pass('real scrypt PIN four-action facts appear in self history with exact receipt IDs, kiosk source/member, and no cross-employee leakage');
    const rawBefore=raw(),receiptsBefore=receipts();
    const end=Math.floor((now-3600000)/60000)*60000;
    const proposal={startAt:instant(end-3600000),endAt:instant(end),breaks:[{startAt:instant(end-2700000),endAt:instant(end-1800000),paid:false}]};
    const report=async(person=p,access='owner')=>executeUnifiedTimesheet({authUserId:access==='owner'?owner:person.auth,query:access==='owner'?{siteId:site,access,workerId:person.worker,fromDate,throughDate}:{siteId:site,access:'self',expectedWorkerId:person.worker,fromDate,throughDate,workerId:null,locationId:null}},service);
    const correction=(query,command=null,authUserId=p.auth)=>executeAttendanceCorrection({query,command,authUserId,moduleEnabled:true},service);
    const prepare={siteId:site,mode:'prepare',expectedWorkerId:p.worker,startEventId:events[0].id};
    const basis=await correction(prepare);assert.deepEqual(basis.basis.events.map(e=>e.id),events.map(e=>e.id));
    const original=await report();assert.equal(original.base.rows.length,1);assert.equal(original.totals.selected.workedUs,original.totals.original.workedUs);
    const rid=randomUUID(),detail={siteId:site,mode:'detail',expectedWorkerId:p.worker,requestId:rid,operationId:null};
    const submit={action:'submit',operationId:rid,expectedRevision:basis.revision,expectedPolicyRevision:1,startEventId:events[0].id,expectedLastEventId:events[3].id,reason:'Synthetic real PIN correction',proposal};
    assert.equal((await correction(detail,submit)).item.status,'submitted');
    assert.equal((await report()).totals.selected.workedUs,original.totals.original.workedUs);
    const decide=(command=null,query={siteId:site,requestId:rid,operationId:null})=>executeCurrentCorrectionDecision({query,command,authUserId:owner,allowWrite:true},service);
    const review=await decide();assert.equal(review.canApprove,true);
    const approved=await decide({action:'approve',operationId:randomUUID(),requestId:rid,expectedRevision:1,expectedEvidence:review.evidenceToken,reason:'Synthetic owner approval'});
    assert.equal(approved.current.workedUs,45*60000000);assert.equal((await report()).totals.selected.workedUs,45*60000000);
    pass('PIN-backed correction remains pending without affecting totals; owner approval records 45 minutes, deducting the declared 15-minute break');
    let latest=approved.current;
    for(const [index,minutes] of [40,35].entries()){
      const rq={siteId:site,mode:'prepare',expectedWorkerId:p.worker,baseRequestId:rid,requestId:null,operationId:null};
      const cycle=(query,command=null)=>executeRevisionCycle({query,command,authUserId:p.auth,moduleEnabled:true},service);
      const r=await cycle(rq),revisionId=randomUUID(),nextProposal={...proposal,endAt:instant(end-(45-minutes)*60000)};
      const rc={action:'submit',operationId:revisionId,expectedRevision:r.revision,expectedBaseOperationId:approved.current.operationId,expectedEffectiveOperationId:r.current.operationId,expectedPolicyRevision:1,reason:'Synthetic PIN next revision',proposal:nextProposal};
      await cycle({...rq,mode:'detail',requestId:revisionId},rc);
      assert.equal((await report()).totals.selected.workedUs,latest.workedUs);
      const query={siteId:site,requestId:revisionId,operationId:null},review=await executeRevisionDecision({query,command:null,authUserId:owner,allowWrite:true},service);
      assert.equal(review.canApprove,true);
      const decision={action:'approve',operationId:randomUUID(),requestId:revisionId,expectedRevision:review.review.submittedRevision,expectedEvidence:review.evidenceToken,expectedBaseOperationId:review.current.operationId,reason:'Synthetic revised approval'};
      latest=(await executeRevisionDecision({query,command:decision,authUserId:owner,allowWrite:true},service)).current;
      assert.equal(latest.revision,index+2);assert.equal(latest.workedUs,minutes*60000000);
      // Replay of a decided revision never adds its minutes a second time.
      assert.equal((await executeRevisionDecision({query,command:decision,authUserId:owner,allowWrite:true},service)).replayed,true);
      assert.equal((await report()).totals.selected.workedUs,minutes*60000000);
    }
    const historical=await decide();assert.equal(historical.decisionEffect.workedUs,45*60000000);assert.equal(historical.current.workedUs,35*60000000);
    assert.equal((await report(p,'self')).totals.selected.workedUs,35*60000000);
    const exported=await executeUnifiedExport({authUserId:owner,command:{siteId:site,operationId:randomUUID(),query:{access:'owner',workerId:p.worker,locationId:null,expectedWorkerId:null,expectedTimeZone:'Europe/Madrid',expectedScopeRevision:null,fromDate,throughDate}}},service);
    assert(exported.csv.includes(latest.operationId));assert.equal(workflowCsvWorkedUs(exported.csv),35*60000000);assert(!exported.csv.includes(people[1].worker));
    assert.equal(raw(),rawBefore);assert.equal(receipts(),receiptsBefore);
    pass('two consecutive revisions, decision replay, self/owner reports and CSV select only latest 35 minutes; original PIN facts/receipts remain byte-identical');
    const q={...detail};await assert.rejects(correction(q,null,people[1].auth),/attendance_worker_changed|attendance_access_denied/);
    exec(`update public.merchant_enterprise_employees set status='disabled' where id='${p.employee}';`);
    try{await assert.rejects(executeAttendanceHistory(historyInput(p),service),/attendance_access_denied/);await assert.rejects(report(p,'self'),/attendance_access_denied/);assert.equal((await report()).totals.selected.workedUs,35*60000000);}
    finally{exec(`update public.merchant_enterprise_employees set status='active' where id='${p.employee}';`);}
    pass('revoked member cannot read history/report; current owner retains existing auditable approved record without raw-data changes');
    const mixed=people[2],mixedEvents=[];
    for(const [sequence,action] of ['clock_in','break_start','break_end','clock_out'].entries()){
      const command={expectedWorkerId:mixed.worker,locationId:location,action,expectedSequence:sequence,operationId:randomUUID()};
      const result=sequence%2===0?await executePinClock({...env.input,workerNo:mixed.no,pin:mixed.pin,command:{...command,expectedEmployeeId:mixed.employee}},service)
        :await executeAttendanceSelf({siteId:site,authUserId:mixed.auth,command,operationId:null},service);
      mixedEvents.push(result.receipt.id);
    }
    const mixedBefore=raw(),mixedReceipts=receipts();
    const prepared=await correction({siteId:site,mode:'prepare',expectedWorkerId:mixed.worker,startEventId:mixedEvents[0]},null,mixed.auth);
    assert.deepEqual(prepared.basis.events.map(e=>e.source),['kiosk','web','kiosk','web']);assert.deepEqual(prepared.basis.events.map(e=>e.id),mixedEvents);
    const mixedRequest=randomUUID(),mixedQuery={siteId:site,requestId:mixedRequest,operationId:null};
    await correction({...mixedQuery,mode:'detail',expectedWorkerId:mixed.worker},{...submit,operationId:mixedRequest,expectedRevision:prepared.revision,startEventId:mixedEvents[0],expectedLastEventId:mixedEvents[3]},mixed.auth);
    const mixedReview=await executeCurrentCorrectionDecision({query:mixedQuery,command:null,authUserId:owner,allowWrite:true},service);assert(mixedReview.canApprove);
    await executeCurrentCorrectionDecision({query:mixedQuery,command:{action:'approve',operationId:randomUUID(),requestId:mixedRequest,expectedRevision:1,expectedEvidence:mixedReview.evidenceToken,reason:'Synthetic mixed PIN/web approval'},authUserId:owner,allowWrite:true},service);
    assert.equal((await report(mixed)).totals.selected.workedUs,45*60000000);assert.equal((await report(mixed,'self')).totals.selected.workedUs,45*60000000);
    assert.equal(raw(),mixedBefore);assert.equal(receipts(),mixedReceipts);
    pass('real PIN/web alternating four-action session uses one sequence and reaches self correction, owner approval and both reports without rewriting either source');
    if(browserCheck)await browserCheck({...env,service,people,proposal,fromDate,throughDate,raw,receipts,report,historyInput});
    env.reset();
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runAttendanceLabelsReuse(process.argv.slice(2),checkPinWorkflow);
