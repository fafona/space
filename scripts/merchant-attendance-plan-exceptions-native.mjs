import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePlanAdoptionViewNative} from './fixtures/attendance-plan-adoption-view-native.mjs';
import {seedPlanExceptionHistoryNative} from './fixtures/attendance-plan-exception-history-native.mjs';
import {verifyPlanExceptionContextNative} from './fixtures/attendance-plan-exception-context-native.mjs';
import {boundClockMigrationBody,quote} from './fixtures/attendance-bound-clocks-native.mjs';
import {lifecycleJson as json,lifecycleId as id,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);let phase='entry';
export async function runPlanExceptionsNative(args,browserCheck=null){
  let result;const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],previous=keys.map(k=>process.env[k]);
  process.env[keys[0]]=randomBytes(32).toString('hex');process.env[keys[1]]=randomBytes(32).toString('base64url');
  try { await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
    phase='prepare';const d=await preparePlanAdoptionViewNative(native,scope),{exec,site,worker,owner,slots}=d;
    exec(boundClockMigrationBody(native.root,'202610030116_merchant_attendance_self_revision_history.sql'));
    const sourceMigration='202610050146_merchant_attendance_plan_exception_source.sql';
    phase='install146';const oldDefinitions=d.definitions(),oldFacts=d.fingerprint();exec(boundClockMigrationBody(native.root,sourceMigration));
    assert.equal(d.previousViewDefinitions(),d.oldViewDefinitions);const installed=d.fingerprint(),defs=d.definitions();exec(boundClockMigrationBody(native.root,sourceMigration));assert.equal(d.fingerprint(),installed);assert.equal(d.definitions(),defs);
    const {projectPlanExceptionSource}=require('../src/lib/merchantAttendancePlanExceptions.server.ts');
    const q={siteId:site,workerId:worker,slotId:slots.main.id};
    const sourceRaw=()=>JSON.parse(exec(`set local role service_role;select public.faolla_attendance_plan_exception_source_v1(${json(q)},${quote(owner)});`));
    phase='empty-source';const before=d.fingerprint(),empty=projectPlanExceptionSource(sourceRaw(),q,owner);assert.equal(empty.eligible,false);assert(empty.blockers.includes('no_associated_sessions'));assert.equal(d.fingerprint(),before);
    phase='actual-clock';const clock=await d.request(d.command(),d.selected(slots.main),null,{bindRules:()=>true});assert.equal(clock.status,200,JSON.stringify(clock));await d.oldClock();
    const source=projectPlanExceptionSource(sourceRaw(),q,owner);assert.equal(source.source.sessions.length,1);assert.equal(source.source.approval.operationId,d.mainApproval.operationId);assert(source.blockers.includes('plan_not_ended'));assert.equal(source.candidate.late.state,'blocked');
    native.pass('146 actual adopted clock under owner auth yields fixed approval and blocked future-plan candidate; old facts preserved on reads');
    phase='install147';const reviewMigration='202610050147_merchant_attendance_plan_exception_review.sql';exec(boundClockMigrationBody(native.root,reviewMigration));
    const installed147=d.fingerprint(),defs147=d.definitions();exec(boundClockMigrationBody(native.root,reviewMigration));assert.equal(d.fingerprint(),installed147);assert.equal(d.definitions(),defs147);
    const {executePlanExceptions}=require('../src/lib/merchantAttendancePlanExceptions.server.ts');
    const {handlePlanExceptions}=require('../src/app/api/merchant-enterprise/attendance/plan-exceptions/route-handler.ts');
    const {planExceptionQueryString,parsePlanExceptionResponse}=require('../src/lib/merchantAttendancePlanExceptions.ts');
    const rq=(mode='detail',access='owner',operationId=null)=>({siteId:site,access,mode,workerId:worker,slotId:slots.main.id,operationId,beforeAt:null,beforeId:null});
    const expr=(q,actor,c=null,allow=true)=>`public.faolla_attendance_plan_exception_review_v1(${json(q)},${quote(actor)},${json(c)},${allow})`;
    const calls=[],failures=[],service={rpc:async(name,args)=>{assert.equal(name,'faolla_attendance_plan_exception_review_v1');calls.push(args);
      try{return {data:JSON.parse(exec(`set local role service_role;select ${expr(args.p_query,args.p_auth_user_id,args.p_command,args.p_allow_write)};`)),error:null};}
      catch(e){failures.push(String(e));const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}}};
    const handle=(req,overrides={})=>handlePlanExceptions(req,{enabled:()=>true,siteEnabled:()=>true,authenticate:async()=>({user:{id:owner},authenticationMethods:['password']}),allow:()=>true,
      entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),execute:input=>executePlanExceptions(input,service),...overrides});
    const send=async(query,command=null,overrides={})=>{
      const actor=query.access==='owner'?owner:d.auth,req=new Request('https://www.faolla.com/api/merchant-enterprise/attendance/plan-exceptions'+(command?'':'?'+planExceptionQueryString(query)),
        {method:command?'POST':'GET',headers:{host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin',...(command?{'content-type':'application/json'}:{})},...(command?{body:JSON.stringify({query,command})}:{})});
      const response=await handle(req,{authenticate:async()=>({user:{id:actor},authenticationMethods:['password']}),...overrides});
      return {status:response.status,body:await response.json(),headers:response.headers};};
    const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({body:r.body,lastSql:failures.at(-1)}));return r.body;};
    const read=async(q=rq(),overrides={})=>parsePlanExceptionResponse(await expect(send(q,null,overrides)),q,{authUserId:q.access==='owner'?owner:d.auth});
    const mkDecision=(view,n,outcome='follow_up')=>({operationId:id(n),expectedRevision:view.detail.revision,expectedFingerprint:view.detail.current.fingerprint,employeeId:d.employee,employeeAuthUserId:d.auth,outcome,note:'Synthetic174 owner investigation'});
    phase='review-detail';const initial=await read();assert.equal(initial.detail.revision,0);assert.equal(initial.detail.stale,null);assert.equal(initial.detail.current.eligible,false);
    const bad=mkDecision(initial,174001,'confirmed'),baseFacts=d.fingerprint();await expect(send(rq('decide','owner',bad.operationId),bad),409);assert.equal(d.fingerprint(),baseFacts);
    const command=mkDecision(initial,174002);const savedBody=await expect(send(rq('decide','owner',command.operationId),command));assert.equal(savedBody.data.detail.revision,1);assert.equal(savedBody.data.receipt.operationId,command.operationId);
    phase='owner-recovery';const original=await read(rq('recover','owner',command.operationId));assert.deepEqual(original.receipt,savedBody.data.receipt);assert.equal(original.detail.currentValidation,'not_checked');
    const after=d.fingerprint();await expect(send(rq('decide','owner',command.operationId),command,{entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}})}));assert.equal(d.fingerprint(),after);
    await expect(send(rq('decide','owner',command.operationId),{...command,note:'changed'}),409);assert.equal(d.fingerprint(),after);
    phase='self-note';const selfView=await read(rq('detail','self'));assert.equal(selfView.detail.currentValidation,'not_checked');assert.equal(selfView.detail.current,null);assert.equal(selfView.detail.canNote,true);
    const note={operationId:id(174003),expectedRevision:1,decisionOperationId:command.operationId,note:'Synthetic174 employee explanation'};
    const noteBody=await expect(send(rq('note','self',note.operationId),note));assert.equal(noteBody.data.detail.revision,2);assert.equal(noteBody.data.receipt.item.kind,'note');
    phase='explicit-read';const ack={operationId:id(174004),decisionOperationId:command.operationId},ackBody=await expect(send(rq('ack','self',ack.operationId),ack));assert.equal(ackBody.data.readReceipt.operationId,ack.operationId);assert.equal(ackBody.data.detail.revision,2);
    const ackFacts=d.fingerprint();const restored=await read(rq('recover','self',ack.operationId));assert.deepEqual(restored.readReceipt,ackBody.data.readReceipt);await expect(send(rq('ack','self',ack.operationId),ack));assert.equal(d.fingerprint(),ackFacts);
    const wrongAck={...ack,operationId:id(174005)};await expect(send(rq('ack','self',wrongAck.operationId),wrongAck),409);assert.equal(d.fingerprint(),ackFacts);
    for(const access of ['owner','self']){const listq={...rq('list',access),workerId:null,slotId:null},list=await read(listq);assert.equal(list.items.length,1);assert.equal(list.items[0].latestDecision.operationId,command.operationId);assert.equal(list.items[0].latestDecision.readAt,ackBody.data.readReceipt.readAt);}
    native.pass('147 real GET/POST handler-service-SQL owner followup, self explanation, explicit read, lists and exact replay without old attendance writes');
    phase='source-cas';const old=await read(),oldCommand=mkDecision(old,174006),newClock=await d.request(d.command(),d.selected(slots.main));assert.equal(newClock.status,200);await d.oldClock();
    const stale=await read();assert.equal(stale.detail.stale,true);const beforeReject=d.fingerprint();await expect(send(rq('decide','owner',oldCommand.operationId),oldCommand),409);assert.equal(d.fingerprint(),beforeReject);
    const next=mkDecision(stale,174007),nextBody=await expect(send(rq('decide','owner',next.operationId),next));assert.equal(nextBody.data.detail.revision,3);assert.equal(nextBody.data.detail.stale,false);assert.equal(nextBody.data.detail.history.length,3);
    phase='auth-and-pause';const deny=(q,actor,c,code,allow=true)=>`do $deny$ begin begin perform ${expr(q,actor,c,allow)};raise assert_failure;exception when others then if sqlerrm<>${quote(code)} then raise;end if;end;end;$deny$;`;
    exec(`begin;set local role service_role;${deny(rq(),id(174090),null,'attendance_access_denied')}reset role;rollback;`);
    exec(`begin;update public.merchant_enterprise_employees set auth_user_id='${id(174091)}' where merchant_id='${site}' and id='${d.employee}';set local role service_role;${deny(rq('recover','owner',command.operationId),owner,null,'attendance_plan_exception_review_identity_changed')}reset role;rollback;`);
    const paused=await read(rq(),{entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}})});assert.equal(paused.detail.canDecide,false);
    const pauseCommand=mkDecision(paused,174008);await expect(send(rq('decide','owner',pauseCommand.operationId),pauseCommand,{entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}})}),403);
    const beforeGate=calls.length;await expect(send(rq(),null,{enabled:()=>false}),404);await expect(send(rq(),null,{siteEnabled:()=>false}),404);assert.equal(calls.length,beforeGate);
    native.pass('147 current identity/pause/site fences, new-source CAS, preserved earlier decisions and explicit employee read semantics');
    phase='race';const current=await read(),one=mkDecision(current,174009),two=mkDecision(current,174010);
    const holder=`reset role;${d.guard}set local role service_role;select ${expr(rq('decide','owner',one.operationId),owner,one)};`;
    const waiter=`reset role;${d.guard}set local role service_role;${deny(rq('decide','owner',two.operationId),owner,two,'attendance_version_conflict')}`;
    exec(`begin;${holder}${waiter}reset role;rollback;`);const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},holder,waiter);assert(race.witnessed);assert.equal(race.right.error,null);
    native.pass('147 exact blocked-PID case revision race admits one decision and rejects the stale contender');
    phase='inactive-original-recovery';const inactiveBefore=d.fingerprint();
    const inactiveNote={operationId:id(174020),expectedRevision:4,decisionOperationId:one.operationId,note:'Synthetic174 inactive must reject new note'};
    const inactiveAck={operationId:id(174021),decisionOperationId:one.operationId};
    exec(`begin;update public.merchant_attendance_workers set active=false where merchant_id='${site}' and id='${worker}';set local role service_role;
      select ${expr(rq('recover','self',note.operationId),d.auth)};
      select ${expr(rq('note','self',note.operationId),d.auth,note,false)};
      select ${expr(rq('ack','self',ack.operationId),d.auth,ack,false)};
      ${deny(rq('note','self',inactiveNote.operationId),d.auth,inactiveNote,'attendance_access_denied')}
      ${deny(rq('ack','self',inactiveAck.operationId),d.auth,inactiveAck,'attendance_access_denied')}
      reset role;rollback;`);assert.equal(d.fingerprint(),inactiveBefore);
    native.pass('147 inactive worker cannot add a note/read acknowledgment but exact prior operations remain recoverable');
    phase='ended-history';const history=await seedPlanExceptionHistoryNative({d,native,scope});
    const historical=projectPlanExceptionSource(history.sourceRaw,history.query,owner);assert.equal(historical.eligible,true);
    const hq=(mode='detail',access='owner',operationId=null)=>({...rq(mode,access,operationId),workerId:history.workerId,slotId:history.slot.id});
    const hs=async(query,command=null)=>{const actor=query.access==='owner'?owner:history.employeeAuthUserId;
      return parsePlanExceptionResponse(await expect(send(query,command,{authenticate:async()=>({user:{id:actor},authenticationMethods:['password']})})),query,{authUserId:actor},command);};
    const firstHistory=await hs(hq());
    const confirmed={operationId:id(174022),expectedRevision:firstHistory.detail.revision,expectedFingerprint:firstHistory.detail.current.fingerprint,
      employeeId:history.employeeId,employeeAuthUserId:history.employeeAuthUserId,outcome:'confirmed',note:'Synthetic174 checked late and early evidence'};
    const confirmedView=await hs(hq('decide','owner',confirmed.operationId),confirmed);assert.equal(confirmedView.receipt.item.outcome,'confirmed');
    assert.equal(confirmedView.receipt.item.evidence.candidate.late.state,'triggered');assert.equal(confirmedView.receipt.item.evidence.candidate.early.state,'triggered');
    const employeeHistory=await hs(hq('detail','self'));assert.equal(employeeHistory.detail.latestDecision.outcome,'confirmed');assert.equal(employeeHistory.detail.currentValidation,'not_checked');
    const historyNow=await hs(hq()),excused={...confirmed,operationId:id(174023),expectedRevision:historyNow.detail.revision,expectedFingerprint:historyNow.detail.current.fingerprint,outcome:'excused',note:'Synthetic174 owner accepted explained exception'};
    const excusedView=await hs(hq('decide','owner',excused.operationId),excused);assert.equal(excusedView.detail.revision,2);assert.equal(excusedView.detail.history.length,2);assert.equal(excusedView.detail.latestDecision.outcome,'excused');
    const recoveredHistory=await hs(hq('recover','owner',confirmed.operationId));assert.deepEqual(recoveredHistory.receipt,confirmedView.receipt);
    native.pass('146/147 ended synthetic history: exact late0/early10 evidence, real confirmed and excused decisions, preserved earlier receipt and self result');
    phase='browser';d.exceptionBrowser={site,owner,auth:d.auth,employee:d.employee,worker,slotId:slots.main.id,handle,
      sourceQuery:{siteId:site,workerId:worker,fromDate:d.today,throughDate:d.day(1)},handleSources:d.handleSources,handlePlan:d.handlePlan,
      changeSource:async()=>{const row=await d.request(d.command(),d.selected(slots.main));assert.equal(row.status,200);await d.oldClock();}};
    const browser=browserCheck?await browserCheck(d):null;
    if(browser)native.pass('174 actual owner-parent and self-workspace browser flows, dirty Escape guard, dropped-response recovery and stale-source fences');
    phase='context';const context=await verifyPlanExceptionContextNative({d,native,scope,h:history,project:projectPlanExceptionSource});
    native.pass('146 real calendar, pending/approved leave and latest approved correction probes remain explicit and roll back all fixture writes');
    phase='reapply';const done=d.fingerprint();exec(boundClockMigrationBody(native.root,reviewMigration));assert.equal(d.fingerprint(),done);assert.equal(d.definitions(),defs147);
    result={sourceChecks:3,reviewChecks:6,context,browser,handlerSql:calls.length,exactPidRaces:1,historicalSeed:{rows:history.syntheticHistoricalRows,actualPastPublication:false,allConstraintsEnabled:true},oldDefinitionHash:oldDefinitions,initialFactHash:oldFacts,productionAccess:false,newCluster:false};
  }));return result; } finally { keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),withBrowser=args.at(-1)==='--with-browser';if(withBrowser)args.pop();
  const run=async()=>runPlanExceptionsNative(args,withBrowser?(await import('./fixtures/attendance-plan-exception-browser.mjs')).runPlanExceptionBrowserAcceptance:null);
  run().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify({error:'plan_exceptions_native_failed',phase,detail:String(e).slice(0,3500)}));process.exitCode=1;});
}
