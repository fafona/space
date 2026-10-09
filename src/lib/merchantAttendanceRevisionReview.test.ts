import assert from "node:assert/strict";
import test from "node:test";
import {parseAttendanceRevisionReviewQuery as query,parseAttendanceRevisionReviewResult as parse,attendanceRevisionReviewComparison as compare,attendanceRevisionReviewQueryString as qs} from "./merchantAttendanceRevisionReview";
import {executeAttendanceRevisionReview} from "./merchantAttendanceRevisionReview.server";
import {revisionReviewQuery as q,revisionReviewResponse as wire} from "../../scripts/fixtures/attendance-revision-review-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
test("revision review only accepts exact site and request, never caller identities or a decision",()=>{
  assert.deepEqual(query("https://local.invalid/?"+qs(q)),q);
  for(const suffix of ["&requestId="+id(10),"&authUserId="+id(10),"&workerId="+id(10),"&action=approve","&operationId="+id(10),"&mode=list"])assert.throws(()=>query("https://local.invalid/?"+qs(q)+suffix));
  for(const v of [{siteId:q.siteId},{requestId:q.requestId},{...q,requestId:"invalid"}])assert.throws(()=>query("https://local.invalid/?"+new URLSearchParams(Object.entries(v))));
});
test("three-way preview keeps raw, prior approved and requested totals separate; never applies pending delta",()=>{
  const source=wire(),snapshot=structuredClone(source),r=parse(source,q),c=compare(r);
  assert.equal(c.kind,"unapproved_revision_comparison");assert.equal(c.original.totals?.workedUs,28800000000);assert.equal(c.approved.totals?.workedUs,30600000000);
  assert.equal(c.requested.totals?.workedUs,28800000000);assert.equal(c.changeFromApproved.workedUs,-1800000000);assert.equal(r.approvalAvailable,false);assert.equal(r.effectiveChanged,false);
  assert.deepEqual(source,snapshot);
  for(const patch of [{reviewOnly:false},{approvalAvailable:true},{effectiveChanged:true},{checksPassed:false},{rejectionChecksPassed:false},{evidenceToken:"grant"},{secret:"private"}])assert.throws(()=>parse({...wire(),...patch},q));
});
test("review strictly binds first approval, source amounts, chronology and current request ledger state",()=>{
  for(const patch of [{requestId:q.requestId},{operationId:q.requestId},{revision:2},{policyRevision:0},{workedUs:1},{timeZone:"UTC"},{recordedAt:wire().asOf},{proposal:wire().review.application.proposal}]){
    const v=wire();Object.assign(v.base,patch);assert.throws(()=>parse(v,q));
  }
  for(const patch of [{submittedRevision:2},{ledgerRevision:2},{pendingRequestId:null},{requestId:id(1)}])assert.throws(()=>parse({...wire(),...patch},q));
  const v=wire("withdrawn");v.ledgerRevision=3;v.pendingRequestId=id(999);assert.equal(parse(v,q).review.item.status,"withdrawn");
  for(const pendingRequestId of [q.requestId,v.base.requestId,v.base.operationId])assert.throws(()=>parse({...v,pendingRequestId},q));
});
test("missing blockers cannot disguise employment, self-review, binding or period-lock failures",()=>{
  for(const kind of ["employment_gap","self_review","binding_changed","rule_period_locked"]){
    const v=wire();if(kind==="employment_gap")v.review.evidence.employmentPeriods=[];
    if(kind==="self_review")v.review.evidence.ownApplication=true;if(kind==="binding_changed")v.review.evidence.bindingCurrent=false;
    if(kind==="rule_period_locked"){v.review.application.rules!.issues=["period_locked"];v.review.application.rules!.lockedPeriodCount=1;}
    assert.throws(()=>parse(v,q));v.blockers=[kind];v.checksPassed=false;v.rejectionChecksPassed=!["self_review","binding_changed"].includes(kind);assert.equal(parse(v,q).checksPassed,false);
  }
  for(const blockers of [["already_effective"],["unknown"],["effective_overlap","effective_overlap"],["employment_gap"]])assert.throws(()=>parse({...wire(),blockers,checksPassed:false},q));
  assert.equal(parse({...wire(),blockers:["effective_overlap"],checksPassed:false},q).rejectionChecksPassed,true);
});
test("withdrawal and exact evidence timestamps are validated without losing historical comparison",()=>{
  const v=wire("withdrawn");assert.equal(compare(parse(v,q)).changeFromApproved.workedUs,-1800000000);
  for(const mutate of [(r:typeof v)=>{r.checksPassed=true;},(r:typeof v)=>{r.rejectionChecksPassed=true;},(r:typeof v)=>{r.review.asOf="2026-10-01T00:00:00.000000Z";},
    (r:typeof v)=>{r.review.evidence.currentBasis!.employeeId=id(999);},(r:typeof v)=>{r.review.application.rules!.binding="preparation";}]){const x=wire("withdrawn");mutate(x);assert.throws(()=>parse(x,q));}
});
test("review service calls only read RPC with server identity and sanitizes internal failures",async()=>{
  let calls=0;
  const service={rpc:async(name:string,args:Record<string,unknown>)=>{calls++;assert.equal(name,"faolla_attendance_revision_owner_review_v1");assert.deepEqual(args,{p_site_id:q.siteId,p_request_id:q.requestId,p_auth_user_id:id(77)});return {data:wire(),error:null};}};
  assert.equal((await executeAttendanceRevisionReview({query:q,authUserId:id(77)},service)).reviewOnly,true);assert.equal(calls,1);
  for(const code of ["attendance_access_denied","attendance_correction_not_found","attendance_revision_invalid_base","secret SQL"]){await assert.rejects(executeAttendanceRevisionReview({query:q,authUserId:id(77)},{rpc:async()=>({data:null,error:{message:code}})}),new RegExp(code.includes("invalid_base")||code==="secret SQL"?"attendance_unavailable":code));}
  await assert.rejects(executeAttendanceRevisionReview({query:q,authUserId:id(77)},{rpc:async()=>({data:{...wire(),checksPassed:false},error:null})}),/attendance_unavailable/);
});
