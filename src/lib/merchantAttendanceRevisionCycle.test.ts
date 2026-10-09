import assert from "node:assert/strict";
import test from "node:test";
import {parseRevisionCycleCommand as command,parseRevisionCycleResult as result} from "./merchantAttendanceRevisionCycle";
import {revisionQuery as q,revisionResponse as old,revisionCommand as legacy,revisionDetail as detail} from "../../scripts/fixtures/attendance-revision-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
import {wire,receipt,advance} from "../../scripts/fixtures/attendance-revision-cycle-model";
test("new commands require exact current predecessor without restricting request revision parity",()=>{
  const v=wire("submitted"),query=receipt(v),c=v.receipt!.command;assert.deepEqual(command(c),c);assert.equal(query.operationId,c.operationId);
  for(const n of [0,1,2,11])assert.equal(command({...c,expectedRevision:n}).expectedRevision,n);
  assert.throws(()=>command(legacy));
  for(const key of Object.keys(c)){const missing:Record<string,unknown>={...c};delete missing[key];assert.throws(()=>command(missing));}
  for(const patch of [{expectedEffectiveOperationId:"bad"},{actorAuthUserId:id(1)},{action:"approve"},{expectedRevision:-1},{expectedRevision:1.5},
    {expectedRevision:9007199254740989},{expectedPolicyRevision:0},{reason:" "},{reason:"line\n"},{reason:"🙂".repeat(501)},{proposal:{...legacy.proposal,extra:true}}])assert.throws(()=>command({...c,...patch}));
  const withdrawn=wire("withdrawn");receipt(withdrawn,"withdraw");assert.deepEqual(command(withdrawn.receipt!.command),withdrawn.receipt!.command);
});
test("self v2 rejects unknown keys, cross-tenant/worker/root identities and old protocol responses",()=>{
  for(const initial of [wire(),wire("prepare",true)])assert.equal(result(initial,q).protocol,"revision-self-v2");
  assert.throws(()=>result(old(),q));
  for(const key of Object.keys(wire())){const v:Record<string,unknown>={...wire()};delete v[key];assert.throws(()=>result(v,q));}
  for(const patch of [{siteId:"99990002"},{workerId:id(999)},{employeeId:id(999)},{rootRequestId:id(999)},{protocol:"revision-self-v1"},
    {mode:"detail"},{approvalAvailable:true},{effectiveChanged:true},{canSubmit:1},{receipt:{}},{canWithdraw:true},{secret:"private"},{revision:-1}])assert.throws(()=>result({...wire(),...patch},q));
});
test("all terminal states parse; approval is not pending and even-numbered submissions remain valid",()=>{
  for(const state of ["submitted","withdrawn","approved","rejected"] as const){const v=wire(state),r=result(v,detail());assert.equal(r.item?.status,state);assert.equal(r.canWithdraw,state==="submitted");}
  const even=wire("submitted");assert.equal(result(even,detail()).item!.submittedRevision,2);
  const done=wire("approved",true);assert.equal(done.revision,1);assert.equal(result(done,detail()).pendingRequestId,null);
  for(const state of ["approved","rejected","withdrawn"] as const)for(const patch of [{pendingRequestId:legacy.operationId},{canWithdraw:true}])assert.throws(()=>result({...wire(state),...patch},detail()));
  for(const patch of [{pendingRequestId:null},{canSubmit:true},{canWithdraw:false},{revision:3}])assert.throws(()=>result({...even,...patch},detail()));
  const malformed=wire("submitted");malformed.pendingRequestId=null;malformed.canSubmit=true;malformed.canWithdraw=false;
  Object.assign(malformed.item!,{status:["rejected"]});assert.throws(()=>result(malformed,detail()));
});
test("historical based-on and own approval stay independent from latest effective version",()=>{
  for(const status of ["approved","rejected","withdrawn"] as const){const v=wire(status),before=structuredClone(v.item);advance(v);assert.deepEqual(result(v,detail()).item,before);}
  const v=wire("approved");advance(v);v.item!.decisionEffect=structuredClone(v.current);assert.throws(()=>result(v,detail()));
  const swapped=wire("approved");swapped.item!.basedOn=structuredClone(swapped.current);assert.throws(()=>result(swapped,detail()));
  const pending=wire("submitted");advance(pending);assert.throws(()=>result(pending,detail()));
});
test("source amounts and immutable lineage are independently checked, including root and later predecessors",()=>{
  for(const patch of [{workedUs:1},{paidBreakUs:1},{employeeId:id(99)},{originalLastEventId:id(99)},{timeZone:"UTC"},{calculationVersion:"raw"},
    {revision:99},{requestId:q.baseRequestId},{operationId:legacy.expectedBaseOperationId},{recordedAt:"2026-09-30T11:00:00.000000Z"},{policyRevision:0},{extra:true}]){
    const v=wire();Object.assign(v.current,patch);assert.throws(()=>result(v,q));}
  for(const patch of [{rootRequestId:id(99)},{rootOperationId:id(99)},{rootRecordedAt:"2026-09-30T12:31:00.000000Z"},{previousOperationId:null},{previousOperationId:id(999)},{extra:true}]){
    const v=wire();Object.assign(v.current.lineage,patch);assert.throws(()=>result(v,q));}
  for(const patch of [{workedUs:1},{revision:2},{operationId:id(99)}]){const v=wire("prepare",true);Object.assign(v.current,patch);assert.throws(()=>result(v,q));}
  const later=wire("approved");later.current.lineage.previousOperationId=legacy.expectedBaseOperationId;assert.throws(()=>result(later,detail()));
  for(const part of ["basedOn","decisionEffect"] as const){const v=wire("approved");v.item![part]!.workedUs++;assert.throws(()=>result(v,detail()));}
});
test("decision payloads must bind submitted revision, actual predecessor, action and matching own outcome",()=>{
  for(const patch of [{action:"reject"},{requestId:id(99)},{operationId:id(99)},{requestRevision:1},{baseOperationId:id(99)},{evidenceToken:"b".repeat(32)},
    {reason:"other"},{recordedAt:"2026-09-30T12:59:00.000000Z"},{recordedAt:"2026-09-30T15:00:00.000000Z"},{extra:true}]){
    const v=wire("approved");Object.assign(v.item!.decision!,patch);assert.throws(()=>result(v,detail()));}
  for(const patch of [{siteId:q.siteId},{expectedRevision:1},{expectedBaseOperationId:legacy.expectedBaseOperationId},{expectedEvidence:"bad"}]){
    const v=wire("approved");Object.assign(v.item!.decision!.command,patch);assert.throws(()=>result(v,detail()));}
  for(const patch of [{decision:null},{decisionEffect:null},{status:"submitted"},{withdrawal:{reason:"fake",recordedAt:"2026-09-30T13:02:00.000000Z"}}]){
    const v=wire("approved");Object.assign(v.item!,patch);assert.throws(()=>result(v,detail()));}
  const reject=wire("rejected");reject.item!.decisionEffect=wire("approved").item!.decisionEffect;assert.throws(()=>result(reject,detail()));
});
test("old and new submit receipts recover after decisions; legacy shape is recovery-only and bound to first approval",()=>{
  for(const legacyBase of [false,true])for(const state of ["submitted","approved","rejected","withdrawn"] as const){
    const v=wire(state,legacyBase),q=receipt(v,"submit",legacyBase);v.canSubmit=false;if(state!=="submitted")advance(v);
    assert.deepEqual(result(v,q).receipt?.command,v.receipt!.command);
  }
  const invalid=wire("approved");const query=receipt(invalid,"submit",true);assert.throws(()=>result(invalid,query));
  for(const patch of [{expectedRevision:0},{expectedEffectiveOperationId:legacy.expectedBaseOperationId},{expectedBaseOperationId:id(291)},{reason:"other"},{expectedPolicyRevision:2}]){
    const v=wire("approved"),q=receipt(v);Object.assign(v.receipt!.command,patch);assert.throws(()=>result(v,q));}
  for(const patch of [{operationId:id(99)},{requestId:id(99)},{revision:3},{action:"withdraw"},{recordedAt:"2026-09-30T13:01:00.000000Z"},{extra:true}]){
    const v=wire("approved"),q=receipt(v);Object.assign(v.receipt!,patch);assert.throws(()=>result(v,q));}
});
test("withdrawal receipt is distinct from submit and neither implies today's pending state",()=>{
  const v=wire("withdrawn"),q=receipt(v,"withdraw");advance(v);v.canSubmit=false;assert.equal(result(v,q).receipt?.action,"withdraw");
  const sub=receipt(v);assert.equal(result(v,sub).receipt?.action,"submit");
  for(const patch of [{revision:2},{submittedRevision:3},{withdrawal:null},{status:"rejected"}]){const w=wire("withdrawn");Object.assign(w.item!,patch);assert.throws(()=>result(w,detail()));}
  const w=wire("withdrawn"),r=receipt(w,"withdraw");w.receipt!.command.reason="other";assert.throws(()=>result(w,r));
  const unknown=wire("approved");assert.equal(result(unknown,detail(id(999))).receipt,null);
  const unsolicited=wire("submitted");receipt(unsolicited);assert.throws(()=>result(unsolicited,detail()));
});
test("current preparation rules cannot come from a historical proposal, and permissions never imply new writes",()=>{
  const v=wire("rejected");v.currentRules.issues=["period_locked"];v.currentRules.lockedPeriodCount=1;assert.throws(()=>result(v,detail()));
  v.canSubmit=false;assert.equal(result(v,detail()).canSubmit,false);
  const ownPending=wire("submitted");ownPending.canSubmit=false;assert.equal(result(ownPending,detail()).canWithdraw,true);
  const historical=wire("approved");historical.revision++;historical.pendingRequestId=id(900);historical.canSubmit=false;
  assert.equal(result(historical,detail()).pendingRequestId,id(900));
  for(const pendingRequestId of [q.baseRequestId,legacy.expectedBaseOperationId,historical.current.requestId,historical.current.operationId])assert.throws(()=>result({...historical,pendingRequestId},detail()));
  const root=wire("prepare",true);root.pendingRequestId=id(900);root.canSubmit=false;assert.throws(()=>result(root,q));
});
test("raw employee basis must be completed, supported and older than the immutable root approval",()=>{
  for(const kind of ["open","other-worker","other-employee","unknown-source","future","overflow"]){
    const v=wire();if(kind==="open")v.basis.events.pop();if(kind==="other-worker")v.basis.workerId=id(99);if(kind==="other-employee")v.basis.employeeId=id(99);
    if(kind==="unknown-source")Object.assign(v.basis.events[0],{source:"unknown"});if(kind==="future")v.basis.asOf=v.current.recordedAt;if(kind==="overflow")v.basis.events=Array(203).fill(v.basis.events[0]);
    assert.throws(()=>result(v,q));
  }
});
