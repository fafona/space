import assert from "node:assert/strict";
import test from "node:test";
import {correctionDecisionQueryString,parseCorrectionDecisionQuery,parseCorrectionDecisionCommand,parseCorrectionDecisionResult,
  correctionDecisionReceiptMatches} from "./merchantAttendanceCorrectionDecision";
import {parseCorrectionDecisionRecord} from "./merchantAttendanceCorrectionDecisionRecord";
import {executeCorrectionDecision} from "./merchantAttendanceCorrectionDecision.server";
import {parseCorrectionResult,correctionStatusLabel} from "./merchantAttendanceCorrection";
import {parseCorrectionReviewResult} from "./merchantAttendanceCorrectionReview";
import {decisionResponse,decisionQuery as q,decisionCommand as c,decisionOwner,decisionAt,decisionAsOf} from "../../scripts/fixtures/attendance-correction-decision-model";
import {correctionId as id,correctionNow,correctionRules} from "../../scripts/fixtures/attendance-correction-model";
const body=()=>({siteId:q.siteId,...c});
const context={requestId:q.requestId,revision:1,submittedAt:correctionNow,asOf:decisionAsOf};

test("decision command is exact, bounded and never accepts caller identity/permission/effect",()=>{
  assert.deepEqual(parseCorrectionDecisionCommand(body()),{siteId:q.siteId,command:c});
  for(const patch of [{actor:decisionOwner},{allowWrite:true},{effective:{}},{reason:" "},{reason:" leading"},{reason:"x\n"},{reason:"x\u0085y"},
    {reason:"🙂".repeat(501)},{action:["approve"]},{action:"withdraw"},{expectedRevision:0},{expectedRevision:1.5},{expectedRevision:9007199254740990},
    {expectedEvidence:c.expectedEvidence.toUpperCase()},{expectedEvidence:"x"},{operationId:"not-a-uuid"},{siteId:"999900001"}])
    assert.throws(()=>parseCorrectionDecisionCommand({...body(),...patch}));
  assert.equal(parseCorrectionDecisionCommand({...body(),reason:"🙂".repeat(500)}).command.reason.length,1000);
  for(const key of Object.keys(body())){const value:Record<string,unknown>=body();delete value[key];assert.throws(()=>parseCorrectionDecisionCommand(value));}
});
test("decision query is read-only, exact and canonical with optional recovery operation",()=>{
  const url=`https://local.invalid/?${correctionDecisionQueryString(q)}`;
  assert.deepEqual(parseCorrectionDecisionQuery(url),q);
  assert.deepEqual(parseCorrectionDecisionQuery(`${url}&operationId=${c.operationId}`),{...q,operationId:c.operationId});
  for(const extra of ["&action=approve","&siteId=99990002","&requestId="+q.requestId,"&operationId=","&authUserId="+decisionOwner])
    assert.throws(()=>parseCorrectionDecisionQuery(url+extra));
});
test("decision summary projects public receipt only and validates exact chronology/context",()=>{
  const d=decisionResponse("approve").decision!;
  assert.deepEqual(parseCorrectionDecisionRecord({...d,actorAuthUserId:decisionOwner,command:body(),review_snapshot:{}},context),d);
  assert.equal(parseCorrectionDecisionRecord(null,context),null);
  for(const patch of [{requestId:id(9)},{requestRevision:2},{action:["approve"]},{action:"cancel"},{recordedAt:correctionNow},
    {recordedAt:"2026-09-30T12:00:02.000003Z"},{reason:"changed\t"},{evidenceToken:"ABC"},{operationId:""}])
    assert.throws(()=>parseCorrectionDecisionRecord({...d,...patch},context));
  for(const bad of [undefined,[],{}])assert.throws(()=>parseCorrectionDecisionRecord(bad,context));
});
test("preflight is projected and never grants payroll/report integration",()=>{
  const raw=decisionResponse();assert.deepEqual(parseCorrectionDecisionResult({...raw,privateSecret:"never-return"},q),raw);
  for(const patch of [{siteId:"99990002"},{asOf:"2026-09-29T12:00:00.000000Z"},{timesheetIntegrated:true},{canApprove:1},
    {blockers:["unknown"]},{blockers:["open_session","open_session"]},{blockers:["open_session"],canApprove:true},{canReject:false,canApprove:true}])
    assert.throws(()=>parseCorrectionDecisionResult({...raw,...patch},q));
  assert.equal(parseCorrectionDecisionResult({...raw,canApprove:false,canReject:false},q).canApprove,false);
});
test("server eligibility cannot override independent raw, employment, binding or self-review checks",()=>{
  const changes:[string,(r:ReturnType<typeof decisionResponse>)=>void][]=[
    ["gap",r=>{r.review.evidence.employmentPeriods=[];}],
    ["self",r=>{r.review.evidence.ownApplication=true;}],
    ["binding",r=>{r.review.evidence.bindingCurrent=false;}],
    ["open",r=>{r.review.application.basis.events.pop();r.review.evidence.currentBasis!.events.pop();}],
    ["changed",r=>{r.review.application.basis.events.pop();}]
  ];
  for(const [name,change] of changes){const r=decisionResponse();change(r);assert.throws(()=>parseCorrectionDecisionResult(r,q),name);}
});
test("legacy or locked applications may be rejected, but never approved by a clear-looking flag",()=>{
  for(const kind of ["legacy","locked"]){const r=decisionResponse();
    if(kind==="legacy")r.review.application.rules=correctionRules("legacy");
    else r.review.application.rules={...r.review.application.rules!,lockedPeriodCount:1,issues:["period_locked"]};
    assert.throws(()=>parseCorrectionDecisionResult(r,q));r.canApprove=false;
    r.blockers=[kind==="legacy"?"rule_legacy_unbound":"rule_period_locked"];
    assert.equal(parseCorrectionDecisionResult(r,q).canReject,true);
  }
});
test("exact effective declaration is mandatory for approval and forbidden for rejection",()=>{
  for(const action of ["approve","reject"] as const){const r=decisionResponse(action);assert.deepEqual(parseCorrectionDecisionResult(r,q),r);}
  const approved=decisionResponse("approve"),rejected=decisionResponse("reject");
  assert.throws(()=>parseCorrectionDecisionResult({...approved,effective:null},q));
  assert.throws(()=>parseCorrectionDecisionResult({...rejected,effective:approved.effective},q));
  assert.throws(()=>parseCorrectionDecisionResult({...approved,decision:null},q));
  assert.throws(()=>parseCorrectionDecisionResult({...approved,canReject:true},q));
  assert.throws(()=>parseCorrectionDecisionResult({...approved,blockers:[]},q));
});
test("effect binds request, operation, policy, immutable declaration and every microsecond total",()=>{
  const r=decisionResponse("approve"),e=r.effective!;
  for(const patch of [{requestId:id(9)},{operationId:id(9)},{revision:2},{policyRevision:2},{timeZone:"UTC"},{recordedAt:decisionAsOf},
    {calculationVersion:"payroll-v1"},{elapsedUs:e.elapsedUs+1},{workedUs:e.workedUs+1},{breakUs:e.breakUs+1},{paidBreakUs:1},
    {proposal:{...e.proposal,breaks:[]}}])assert.throws(()=>parseCorrectionDecisionResult({...r,effective:{...e,...patch}},q));
});
test("receipt recovery is exact and may return null after ownership changes",()=>{
  const r=decisionResponse("approve",true),query={...q,operationId:c.operationId};
  assert.deepEqual(parseCorrectionDecisionResult(r,query),r);
  assert.throws(()=>parseCorrectionDecisionResult(r,q));
  assert.throws(()=>parseCorrectionDecisionResult({...r,receipt:{...r.receipt!,reason:"not same decision"}},query));
  assert.equal(parseCorrectionDecisionResult({...r,receipt:null},query).receipt,null);
  assert.equal(correctionDecisionReceiptMatches(c,r.receipt!),true);
  for(const patch of [{action:"reject" as const},{requestId:id(9)},{operationId:id(9)},{expectedRevision:2},{expectedEvidence:"f".repeat(32)},{reason:"other"}])
    assert.equal(correctionDecisionReceiptMatches({...c,...patch},r.receipt!),false);
});
test("server delegates authenticated identity/write gate to one atomic RPC and validates receipt",async()=>{
  const calls:unknown[]=[],r=decisionResponse("approve",true);
  const parsed=await executeCorrectionDecision({query:q,command:c,authUserId:decisionOwner,allowWrite:false},
    {rpc:async(name,args)=>{calls.push({name,args});return {data:r,error:null};}});
  assert.deepEqual(parsed,r);assert.deepEqual(calls,[{name:"faolla_attendance_correction_decide_v1",args:{p_site_id:q.siteId,p_auth_user_id:decisionOwner,
    p_request_id:q.requestId,p_command:c,p_operation_id:null,p_allow_write:false}}]);
  for(const data of [{...r,receipt:null},{...r,receipt:{...r.receipt!,reason:"wrong body"}},decisionResponse("reject",true),{...r,siteId:"99990002"}])
    await assert.rejects(executeCorrectionDecision({query:q,command:c,authUserId:decisionOwner,allowWrite:true},{rpc:async()=>({data,error:null})}),/attendance_unavailable/);
});
test("server rejects mixed queries before RPC and masks backend internals",async()=>{
  let calls=0;const service={rpc:async()=>{calls++;return {data:decisionResponse(),error:null};}};
  for(const query of [{...q,operationId:c.operationId},{...q,requestId:id(9)}])
    await assert.rejects(executeCorrectionDecision({query,command:c,authUserId:decisionOwner,allowWrite:true},service),/attendance_invalid_request/);
  assert.equal(calls,0);
  const input={query:q,command:null,authUserId:decisionOwner,allowWrite:false};
  assert.equal((await executeCorrectionDecision(input,service)).receipt,null);
  await assert.rejects(executeCorrectionDecision(input,null),/attendance_unavailable/);
  for(const [message,expected] of [["private_table_failure","attendance_unavailable"],["attendance_correction_decided","attendance_correction_decided"],
    ["attendance_correction_evidence_changed","attendance_correction_evidence_changed"],["attendance_access_denied","attendance_access_denied"]])
    await assert.rejects(executeCorrectionDecision(input,{rpc:async()=>({data:null,error:{message}})}),new RegExp(expected));
});
test("live v3 self/owner detail explicitly displays final outcome and forbids withdrawal",()=>{
  for(const action of ["approve","reject"] as const){const r=decisionResponse(action),review=r.review,a=review.application;
    review.asOf=decisionAsOf;a.asOf=decisionAsOf;a.rules!.checkedAt=decisionAsOf;review.evidence.currentBasis!.asOf=decisionAsOf;
    review.item.decision=r.decision;a.item.decision=r.decision;
    const sq={siteId:q.siteId,expectedWorkerId:a.workerId,mode:"detail" as const,requestId:q.requestId,operationId:null};
    assert.deepEqual(parseCorrectionResult(a,sq,true,true),a);
    assert.deepEqual(parseCorrectionReviewResult(review,{...q,mode:"detail"},true,true),review);
    assert.match(correctionStatusLabel(a.item),action==="approve"?/批准/:/驳回/);
    assert.throws(()=>parseCorrectionResult({...a,canRequest:true},sq,true,true));
    assert.throws(()=>parseCorrectionResult({...a,decisionsAvailable:undefined},sq,true,true));
    assert.throws(()=>parseCorrectionResult({...a,item:{...a.item,decision:undefined}},sq,true,true));
    assert.throws(()=>parseCorrectionResult({...a,item:{...a.item,status:"withdrawn"}},sq,true,true));
    assert.throws(()=>parseCorrectionReviewResult({...review,item:{...review.item,decision:null}},{...q,mode:"detail"},true,true));
    assert.equal(a.item.decision?.recordedAt,decisionAt);
  }
});
