import assert from "node:assert/strict";
import test from "node:test";
import {parseCurrentCorrectionResponse as parse} from "./merchantAttendanceCurrentCorrectionResponse";
import {decisionResponse,currentDecisionResult,decisionQuery as q,decisionCommand as c} from "../../scripts/fixtures/attendance-correction-decision-model";
const wire=(revision=1)=>({ok:true,moduleEnabled:true,...currentDecisionResult(decisionResponse("approve",true),{revision})});
const query={...q,operationId:c.operationId};
test("HTTP normalized history/current protocol is independently checked without mutating source",()=>{
  for(const revision of [1,2,6]){const value=wire(revision),before=structuredClone(value),result=parse(value,query);assert.deepEqual(value,before);
    assert.equal(result.decisionEffect?.revision,1);assert.equal(result.current?.revision,revision);assert.equal(result.replayed,true);assert.equal(result.effectiveChanged,false);}
});
test("HTTP envelope rejects legacy, downgrade, mixed SQL fields, forged integration or unverified module gate",()=>{
  assert.throws(()=>parse({ok:true,moduleEnabled:true,...decisionResponse("approve",true)},query));
  for(const patch of [{ok:false},{ok:undefined},{moduleEnabled:"true"},{moduleEnabled:false},{writeEnabled:false},{protocol:"correction-decision-v1"},
    {effective:wire().decisionEffect},{timesheetIntegrated:false},{actorAuthUserId:"hidden"},{decisionEffect:undefined}])assert.throws(()=>parse({...wire(),...patch},query));
});
test("paused HTTP recovery preserves latest revision while disabling writes and validating all source identities",()=>{
  const body={ok:true,moduleEnabled:false,...currentDecisionResult(decisionResponse("approve",true),{revision:6,writeEnabled:false})};
  const result=parse(body,query);assert.equal(result.current?.revision,6);assert.equal(result.canApprove,false);assert.equal(result.canReject,false);
  for(const change of [(v:typeof body)=>{v.current!.workedUs++;},(v:typeof body)=>{v.decisionEffect!.workedUs++;},(v:typeof body)=>{v.current!.lineage.rootOperationId=v.current!.operationId;}]){const bad=structuredClone(body);change(bad);assert.throws(()=>parse(bad,query));}
});
test("rejected history may display another current root without acquiring an approval outcome",()=>{
  const value={ok:true,moduleEnabled:true,...currentDecisionResult(decisionResponse("reject"),{otherRoot:true})};const result=parse(value,q);
  assert.equal(result.decisionEffect,null);assert.notEqual(result.current?.lineage.rootRequestId,q.requestId);assert.equal(result.canApprove,false);
});
