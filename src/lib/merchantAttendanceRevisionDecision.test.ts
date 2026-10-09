import assert from "node:assert/strict";
import test from "node:test";
import {parseRevisionDecisionCommand as command,parseRevisionDecisionQuery as query,parseRevisionDecisionResult as parse,revisionDecisionReceiptMatches as matches,type RevisionDecisionRecord} from "./merchantAttendanceRevisionDecision";
import {previewCorrection} from "./merchantAttendanceCorrection";
import {revisionReviewResponse} from "../../scripts/fixtures/attendance-revision-review-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
function wire(action:"approve"|"reject"|null=null){
  const review=revisionReviewResponse(),b=review.base,a=review.review.application;
  const cmd={siteId:review.siteId,requestId:review.requestId,operationId:id(500),action:action??"approve",expectedRevision:1,expectedEvidence:"b".repeat(32),expectedBaseOperationId:b.operationId,reason:"Synthetic decision"};
  const record:RevisionDecisionRecord={requestId:review.requestId,operationId:cmd.operationId,action:cmd.action,requestRevision:1,baseOperationId:b.operationId,
    evidenceToken:cmd.expectedEvidence,reason:cmd.reason,recordedAt:"2026-09-30T14:01:00.000000Z",command:command(cmd).command};
  const proposal=action==="approve"?structuredClone(a.proposal):structuredClone(b.proposal),totals=previewCorrection(a.basis,proposal).proposed.totals!;
  const current={...b,proposal,...totals,action:"approve",originalLastEventId:a.basis.events.at(-1)!.id,employeeId:review.review.item.employeeId,calculationVersion:"declaration-v1",
    requestId:action==="approve"?review.requestId:b.requestId,operationId:action==="approve"?record.operationId:b.operationId,revision:action==="approve"?2:1,
    recordedAt:action==="approve"?record.recordedAt:b.recordedAt,lineage:{rootRequestId:b.requestId,rootOperationId:b.operationId,rootRecordedAt:b.recordedAt,previousOperationId:action==="approve"?b.operationId:null as string|null}};
  return {siteId:review.siteId,requestId:review.requestId,asOf:"2026-09-30T14:02:00.000000Z",protocol:"revision-decision-v1",review,evidenceToken:"c".repeat(32),
    blockers:action?["already_decided",...(action==="approve"?["base_changed"]:[])]:[],writeEnabled:true,canApprove:!action,canReject:!action,
    decision:action?record:null,receipt:action?structuredClone(record):null,current,replayed:false,effectiveChanged:action==="approve"};
}
const q=(v=wire(),operationId:string|null=null)=>({siteId:v.siteId,requestId:v.requestId,operationId});
test("private decision commands and queries contain exact bounds and base precondition, not principal fields",()=>{
  const c=wire("approve").decision!.command,payload={siteId:wire().siteId,...c};assert.deepEqual(command(payload).command,c);assert.deepEqual(query(q()),q());
  for(const patch of [{authUserId:id(1)},{expectedBaseOperationId:"bad"},{expectedRevision:0},{expectedEvidence:"token"},{reason:" x"}])assert.throws(()=>command({...payload,...patch}));
  for(const patch of [{authUserId:id(1)},{operationId:undefined},{requestId:"bad"}])assert.throws(()=>query({...q(),...patch}));
});
test("preflight has original effective source, exact eligibility, and explicit pause without mutation claims",()=>{
  const w=wire(),r=parse(w,q());assert.equal(r.current.revision,1);assert.equal(r.receipt,null);assert.equal(r.effectiveChanged,false);
  const paused={...w,writeEnabled:false,canApprove:false,canReject:false};assert.equal(parse(paused,q()).canApprove,false);
  for(const patch of [{canApprove:false},{canReject:false},{replayed:true},{effectiveChanged:true},{protocol:"revision-decision-v2"},{extra:true}])assert.throws(()=>parse({...w,...patch},q()));
});
test("approved/rejected results have exact receipt linkage; only approval replaces the source",()=>{
  for(const action of ["approve","reject"] as const){
    const w=wire(action),r=parse(w,q(w,id(500)));assert.equal(r.current.revision,action==="approve"?2:1);assert.equal(r.effectiveChanged,action==="approve");
    assert(matches(r.receipt!.command,r.receipt!));assert(!matches({...r.receipt!.command,reason:"other"},r.receipt!));
    assert.throws(()=>parse(w,q(w,null)));assert.throws(()=>parse({...w,canApprove:true},q(w,id(500))));
    assert.throws(()=>parse({...w,blockers:[]},q(w,id(500))));
  }
});
test("receipt recovery after pause does not claim a fresh write, and absent receipt remains uncertain",()=>{
  const w=wire("approve"),replay={...w,writeEnabled:false,replayed:true,effectiveChanged:false};assert.equal(parse(replay,q(w,id(500))).receipt?.operationId,id(500));
  assert.throws(()=>parse({...replay,effectiveChanged:true},q(w,id(500))));assert.throws(()=>parse({...replay,replayed:false},q(w,id(500))));
  const observed={...w,receipt:null,effectiveChanged:false};assert.equal(parse(observed,q(w,id(999))).receipt,null);
  assert.throws(()=>parse({...observed,replayed:true},q(w,id(999))));
});
test("selected effect math, original employee/event, root, proposal and terminal timestamp cannot be forged",()=>{
  for(const patch of [{workedUs:1},{revision:3},{requestId:id(997)},{operationId:id(997)},{employeeId:id(997)},{originalLastEventId:id(997)},
    {policyRevision:2},{recordedAt:"2026-09-30T14:00:00.000000Z"},{timeZone:"UTC"},{proposal:wire().current.proposal}]){
    const w=wire("approve");Object.assign(w.current,patch);assert.throws(()=>parse(w,q(w,id(500))));
  }
  for(const patch of [{rootRequestId:id(99)},{rootOperationId:id(99)},{rootRecordedAt:wire().asOf},{previousOperationId:id(99)}]){
    const w=wire("approve");Object.assign(w.current.lineage,patch);assert.throws(()=>parse(w,q(w,id(500))));
  }
});
test("immutable command and receipt disagreeing fields, hidden tenant or predating writes are rejected",()=>{
  for(const patch of [{requestRevision:2},{baseOperationId:id(99)},{evidenceToken:"f".repeat(32)},{reason:"different"},{requestId:id(99)}]){
    const w=wire("reject");Object.assign(w.decision!,patch);w.receipt=structuredClone(w.decision);assert.throws(()=>parse(w,q(w,id(500))));
  }
  const tenant=wire("reject");Object.assign(tenant.decision!.command,{siteId:tenant.siteId});tenant.receipt=structuredClone(tenant.decision);assert.throws(()=>parse(tenant,q(tenant,id(500))));
  const earlier=wire("reject");earlier.decision!.recordedAt="2026-09-30T13:30:00.000000Z";earlier.receipt=structuredClone(earlier.decision);assert.throws(()=>parse(earlier,q(earlier,id(500))));
});
test("missing binding/self-review/period blockers cannot turn preflight into write availability",()=>{
  for(const issue of ["binding_changed","self_review","rule_period_locked"]){
    const w=wire();if(issue==="binding_changed")w.review.review.evidence.bindingCurrent=false;
    if(issue==="self_review")w.review.review.evidence.ownApplication=true;
    if(issue==="rule_period_locked"){w.review.review.application.rules!.issues=["period_locked"];w.review.review.application.rules!.lockedPeriodCount=1;}
    w.review.blockers=[issue];w.review.checksPassed=false;w.review.rejectionChecksPassed=issue==="rule_period_locked";
    assert.throws(()=>parse(w,q()));w.blockers=[issue];w.canApprove=false;w.canReject=w.review.rejectionChecksPassed;
    assert.equal(parse(w,q()).canReject,issue==="rule_period_locked");
  }
});
