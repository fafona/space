import assert from "node:assert/strict";
import test from "node:test";
import {parseCurrentCorrectionDecision as parse} from "./merchantAttendanceCurrentCorrectionDecision";
import {executeCurrentCorrectionDecision as execute} from "./merchantAttendanceCurrentCorrectionDecision.server";
import {parseCorrectionDecisionResult} from "./merchantAttendanceCorrectionDecision";
import {previewCorrection} from "./merchantAttendanceCorrection";
import {decisionResponse,decisionQuery as q,decisionCommand as command,decisionOwner} from "../../scripts/fixtures/attendance-correction-decision-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
import type {RevisionCycleEffect} from "./merchantAttendanceRevisionCycle";
function wire(action:"approve"|"reject"|null=null,revision=1,receipt=false){
  const {timesheetIntegrated,...initial}=decisionResponse(action,receipt);assert.equal(timesheetIntegrated,false);
  let current:RevisionCycleEffect|null=null;
  if(initial.effective){
    const e=initial.effective,b=initial.review.application.basis;
    current={...e,action:"approve",originalLastEventId:b.events.at(-1)!.id,employeeId:b.employeeId,
      lineage:{rootRequestId:q.requestId,rootOperationId:e.operationId,rootRecordedAt:e.recordedAt,previousOperationId:null}};
    if(revision>1){
      current.proposal={...current.proposal,endAt:"2026-09-28T15:00:00.000000Z",breaks:[]};
      Object.assign(current,previewCorrection(b,current.proposal).proposed.totals,{requestId:id(301),operationId:id(302),revision,recordedAt:"2026-09-30T12:00:01.500001Z"});
      current.lineage.previousOperationId=revision===2?e.operationId:id(303);
    }
    initial.blockers.push("already_effective");
  }
  return {...initial,protocol:"correction-decision-v2",current,writeEnabled:true,replayed:receipt,effectiveChanged:false};
}
test("explicit current decision protocol preserves immutable first result separately from all later versions",()=>{
  for(const revision of [1,2,6,2147483647]){
    const w=wire("approve",revision),before=structuredClone(w),r=parse(w,q);
    assert.equal(r.decisionEffect?.revision,1);assert.equal(r.current?.revision,revision);assert.deepEqual(r.decisionEffect,w.effective);assert.deepEqual(w,before);
    assert.equal("effective" in r,false);assert.equal("timesheetIntegrated" in r,false);assert.throws(()=>parseCorrectionDecisionResult(w,q));
  }
  assert.throws(()=>parse(decisionResponse("approve"),q));
});
test("pending/rejected decisions do not manufacture their own approved source; another root may be current",()=>{
  for(const action of [null,"reject"] as const){const r=parse(wire(action),q);assert.equal(r.decisionEffect,null);assert.equal(r.current,null);}
  const rejected=wire("reject");rejected.current=wire("approve").current;
  assert.throws(()=>parse(rejected,q));
  const current=rejected.current!;current.requestId=id(900);current.operationId=id(901);current.lineage.rootRequestId=id(900);current.lineage.rootOperationId=id(901);
  rejected.blockers.push("already_effective");assert.equal(parse(rejected,q).current?.requestId,id(900));
});
test("latest source validates root identity, source time, employee, event, bounds and every amount",()=>{
  for(const patch of [{requestId:q.requestId},{operationId:command.operationId},{revision:0},{revision:1},{revision:2147483648},{policyRevision:0},
    {employeeId:id(99)},{originalLastEventId:id(99)},{recordedAt:"2026-09-30T12:00:00.000000Z"},{workedUs:1},{timeZone:"UTC"},{action:"reject"},{lineage:null}]){
    const w=wire("approve",6);Object.assign(w.current!,patch);assert.throws(()=>parse(w,q));
  }
  for(const patch of [{rootRequestId:id(99)},{rootOperationId:id(99)},{rootRecordedAt:"2026-09-30T12:00:01.100000Z"},{previousOperationId:null},{previousOperationId:id(302)},{previousOperationId:command.operationId},{extra:true}]){
    const w=wire("approve",6);Object.assign(w.current!.lineage,patch);assert.throws(()=>parse(w,q));
  }
});
test("first effect is not replaceable with current hours and current cannot be missing after approval",()=>{
  const w=wire("approve",6);assert.throws(()=>parse({...w,current:null},q));
  assert.throws(()=>parse({...w,effective:{...w.effective,...w.current}},q));
  const first=wire("approve");first.current!.policyRevision=2;assert.throws(()=>parse(first,q));
  const noBlock=wire("approve");noBlock.blockers=noBlock.blockers.filter(k=>k!=="already_effective");assert.throws(()=>parse(noBlock,q));
});
test("fresh result and recovery cannot be interchanged or claim new changes while paused",()=>{
  const query={...q,operationId:command.operationId},recovered=wire("approve",6,true);
  assert.equal(parse({...recovered,writeEnabled:false},query).replayed,true);
  for(const patch of [{replayed:false,effectiveChanged:true},{effectiveChanged:true},{receipt:null}])assert.throws(()=>parse({...recovered,...patch},query));
  const fresh={...wire("approve",1,true),replayed:false,effectiveChanged:true};assert.equal(parse(fresh,query).effectiveChanged,true);
  assert.throws(()=>parse({...fresh,writeEnabled:false},query));assert.throws(()=>parse({...fresh,effectiveChanged:false},query));
  const pending=wire();for(const patch of [{canApprove:false},{canReject:false},{writeEnabled:false},{replayed:true},{effectiveChanged:true}])assert.throws(()=>parse({...pending,...patch},q));
  assert.equal(parse({...pending,writeEnabled:false,canApprove:false,canReject:false},q).canApprove,false);
});
test("candidate executor binds authenticated principal and exact immutable receipt on fresh and historical recovery",async()=>{
  const calls:unknown[]=[],data={...wire("approve",1,true),replayed:false,effectiveChanged:true};
  const input={query:q,command,authUserId:decisionOwner,allowWrite:true};
  const r=await execute(input,{rpc:async(name,args)=>{calls.push({name,args});return {data,error:null};}});
  assert.equal(r.current?.revision,1);assert.deepEqual(calls,[{name:"faolla_attendance_correction_decide_v2",args:{p_site_id:q.siteId,p_auth_user_id:decisionOwner,p_request_id:q.requestId,p_command:command,p_operation_id:null,p_allow_write:true}}]);
  const recovered={...wire("approve",6,true),writeEnabled:false};assert.equal((await execute({...input,allowWrite:false},{rpc:async()=>({data:recovered,error:null})})).current?.revision,6);
  assert.equal((await execute({...input,command:null,query:{...q,operationId:command.operationId},allowWrite:false},{rpc:async()=>({data:recovered,error:null})})).replayed,true);
});
test("executor rejects nested principal/query changes and non-boolean gates before SQL",async()=>{
  let calls=0;const service={rpc:async()=>{calls++;return {data:wire(),error:null};}},input={query:q,command,authUserId:decisionOwner,allowWrite:true};
  for(const patch of [{command:{...command,siteId:"99990008"}},{query:{...q,operationId:command.operationId}},{query:{...q,requestId:id(99)}},{allowWrite:1 as unknown as boolean}])await assert.rejects(execute({...input,...patch},service),/attendance_invalid_request/);
  assert.equal(calls,0);
});
test("executor masks broken transport, mismatched receipts and read-only responses claiming fresh writes without retry",async()=>{
  const input={query:q,command,authUserId:decisionOwner,allowWrite:true};let calls=0;
  await assert.rejects(execute(input,{rpc:async()=>{calls++;throw Error("secret connection");}}),/attendance_unavailable/);assert.equal(calls,1);
  const fresh={...wire("approve",1,true),replayed:false,effectiveChanged:true};
  for(const data of [{...fresh,receipt:null},{...fresh,writeEnabled:false},{...fresh,receipt:{...fresh.receipt!,reason:"wrong"}}])await assert.rejects(execute(input,{rpc:async()=>({data,error:null})}),/attendance_unavailable/);
  await assert.rejects(execute({...input,query:{...q,operationId:command.operationId},command:null},{rpc:async()=>({data:fresh,error:null})}),/attendance_unavailable/);
  for(const [message,error] of [["internal_sql_secret","attendance_unavailable"],["attendance_access_denied","attendance_access_denied"],["attendance_report_version_required","attendance_report_version_required"]])await assert.rejects(execute(input,{rpc:async()=>({data:null,error:{message}})}),new RegExp(error));
});
