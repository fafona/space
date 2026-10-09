import assert from "node:assert/strict";
import test from "node:test";
import {parseRevisionApprovalReview as review,parseRevisionApprovalReviewQuery as reviewQuery,parseRevisionApprovalResult as result} from "./merchantAttendanceRevisionApproval";
import {revisionApprovalResponse as wire,recoverRevisionApproval as recover} from "../../scripts/fixtures/attendance-revision-approval-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
const q=(w=wire(),operationId:string|null=null)=>({siteId:w.siteId,requestId:w.requestId,operationId});
const rq=(w=wire())=>({siteId:w.siteId,requestId:w.requestId});
test("owner v2 explicitly validates both original and later captured sources without revision parity assumptions",()=>{
  for(const first of [true,false]){const w=wire(null,first),r=result(w,q(w));assert.equal(r.current.revision,first?1:2);assert.equal(r.review.submittedRevision,first?1:2);assert.equal(r.canApprove,true);}
  assert.deepEqual(reviewQuery(rq()),rq());
  for(const patch of [{operationId:null},{authUserId:id(99)},{requestId:"bad"},{siteId:"bad"}])assert.throws(()=>reviewQuery({...rq(),...patch}));
  for(const patch of [{sourceVersion:"revision-review-v1"},{requestState:["submitted"]},{requestState:"approved"},{submittedRevision:3},{ledgerRevision:1},{pendingRequestId:null},{extra:true}]){
    const w=wire();Object.assign(w.review,patch);assert.throws(()=>review(w.review,rq(w)));}
});
test("raw checks and rule blockers cannot be concealed or promoted to approval permissions",()=>{
  for(const blocker of ["binding_changed","self_review","rule_period_locked","basis_unavailable"]){
    const w=wire(),e=w.review.review.evidence;
    if(blocker==="binding_changed")e.bindingCurrent=false;if(blocker==="self_review")e.ownApplication=true;
    if(blocker==="basis_unavailable"){e.currentBasis=null;e.basisIssue="attendance_session_not_found";}
    if(blocker==="rule_period_locked"){w.review.review.application.rules!.issues=["period_locked"];w.review.review.application.rules!.lockedPeriodCount=1;}
    assert.throws(()=>result(w,q()));
    w.review.blockers=[blocker];w.review.checksPassed=false;w.review.rejectionChecksPassed=["rule_period_locked","basis_unavailable"].includes(blocker);
    w.blockers=[blocker];w.canApprove=false;w.canReject=w.review.rejectionChecksPassed;
    assert.equal(result(w,q()).canReject,w.canReject);w.canApprove=true;assert.throws(()=>result(w,q()));
  }
});
test("withdrawn owner history is explicit and cannot be approved even when a later request is pending",()=>{
  const w=wire(),r=w.review,a=r.review.application;r.requestState="withdrawn";r.ledgerRevision=3;r.pendingRequestId=null;
  a.item.status="withdrawn";a.item.revision=3;r.review.item.status="withdrawn";r.review.item.revision=3;
  a.withdrawal={reason:"撤回",recordedAt:"2026-09-30T13:01:00.000000Z"};r.blockers=["withdrawn"];r.checksPassed=false;r.rejectionChecksPassed=false;
  w.blockers=["withdrawn"];w.canApprove=false;w.canReject=false;assert.equal(result(w,q()).review.requestState,"withdrawn");
  r.ledgerRevision=4;r.pendingRequestId=id(901);assert.equal(result(w,q()).review.pendingRequestId,id(901));
  for(const patch of [{pendingRequestId:w.requestId},{ledgerRevision:2},{requestState:"submitted"}])assert.throws(()=>review({...r,...patch},rq()));
});
test("fresh approval and rejection require complete matching receipts and a genuine pre-write review",()=>{
  for(const action of ["approve","reject"] as const){const w=wire(action),r=result(w,q(w,id(500)));assert.equal(r.effectiveChanged,action==="approve");assert.equal(r.current.revision,action==="approve"?3:2);
    assert.equal(r.review.requestState,"submitted");assert.equal(r.canApprove,false);assert.equal(r.canReject,false);
    for(const patch of [{writeEnabled:false},{blockers:[]},{canApprove:true},{canReject:true},{replayed:true},{effectiveChanged:action!=="approve"}])assert.throws(()=>result({...w,...patch},q(w,id(500))));
    assert.throws(()=>result(w,q(w)));w.review.requestState=action==="approve"?"approved":"rejected";w.review.pendingRequestId=null;assert.throws(()=>result(w,q(w,id(500))));
  }
});
test("historical approvals/rejections recover with newer selected hours without replacing their original source",()=>{
  for(const action of ["approve","reject"] as const)for(const advance of [false,true]){
    const w=recover(wire(action),advance),r=result(w,q(w,id(500)));assert.equal(r.receipt!.action,action);assert.equal(r.current.revision,w.current.revision);
    assert.equal(r.review.base.revision,2);assert.equal(r.effectiveChanged,false);assert.equal(r.writeEnabled,false);
    const observed={...w,receipt:null,replayed:false};assert.equal(result(observed,q(w,id(999))).receipt,null);
    assert.throws(()=>result({...observed,replayed:true},q(w,id(999))));
  }
});
test("historical terminal evidence cannot pretend to be a new write or erase an already-decided state",()=>{
  const w=recover(wire("approve"),true);
  for(const patch of [{effectiveChanged:true},{replayed:false},{decision:null},{blockers:["base_changed"]},{canApprove:true},{canReject:true}])assert.throws(()=>result({...w,...patch},q(w,id(500))));
  for(const state of ["submitted","withdrawn","rejected"]){const v=structuredClone(w);v.review.requestState=state as typeof v.review.requestState;assert.throws(()=>result(v,q(v,id(500))));}
  const unknown={...wire(),receipt:null,replayed:false,effectiveChanged:false};assert.equal(result(unknown,q(unknown,id(999))).receipt,null);
});
test("selected current math, lineage, employee, timestamps and approval proposal are independent checks",()=>{
  for(const patch of [{workedUs:1},{revision:2},{revision:99},{requestId:id(999)},{operationId:id(999)},{employeeId:id(999)},{originalLastEventId:id(999)},
    {timeZone:"UTC"},{recordedAt:"2026-09-30T14:00:00.000000Z"},{policyRevision:2},{proposal:wire().current.proposal},{extra:true}]){
    const w=wire("approve");Object.assign(w.current,patch);assert.throws(()=>result(w,q(w,id(500))));}
  for(const patch of [{rootRequestId:id(99)},{rootOperationId:id(99)},{rootRecordedAt:"2026-09-30T12:10:00.000000Z"},{previousOperationId:null},{previousOperationId:id(200)}]){
    const w=wire("approve");Object.assign(w.current.lineage,patch);assert.throws(()=>result(w,q(w,id(500))));}
  const historical=recover(wire("approve"),true);historical.current.operationId=historical.decision!.operationId;assert.throws(()=>result(historical,q(historical,id(500))));
  const base=wire();base.review.base.workedUs++;assert.throws(()=>result(base,q()));
});
test("full immutable decision command binds actual predecessor, request, evidence and reason without nested tenant override",()=>{
  for(const patch of [{requestRevision:1},{baseOperationId:id(200)},{requestId:id(999)},{operationId:id(999)},{reason:"other"},{evidenceToken:"d".repeat(32)},
    {recordedAt:"2026-09-30T13:00:00.000000Z"},{recordedAt:"2026-09-30T14:03:00.000000Z"},{extra:true}]){
    const w=wire("reject");Object.assign(w.decision!,patch);w.receipt=structuredClone(w.decision);assert.throws(()=>result(w,q(w,id(500))));}
  for(const patch of [{siteId:"99990002"},{expectedRevision:1},{expectedEvidence:"bad"},{expectedBaseOperationId:id(200)},{authUserId:id(99)}]){
    const w=wire("reject");Object.assign(w.decision!.command,patch);w.receipt=structuredClone(w.decision);assert.throws(()=>result(w,q(w,id(500))));}
});
test("envelope protocol, tenant and exact fields must be correct; preflight cannot claim writes",()=>{
  for(const key of Object.keys(wire())){const w:Record<string,unknown>={...wire()};delete w[key];assert.throws(()=>result(w,q()));}
  for(const patch of [{protocol:"revision-decision-v1"},{siteId:"99990002"},{requestId:id(99)},{writeEnabled:1},{extra:true},{replayed:true},{effectiveChanged:true}])assert.throws(()=>result({...wire(),...patch},q()));
  const paused={...wire(),writeEnabled:false,canApprove:false,canReject:false};assert.equal(result(paused,q()).writeEnabled,false);
});
