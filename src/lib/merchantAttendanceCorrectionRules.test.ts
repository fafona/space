import assert from "node:assert/strict";
import test from "node:test";
import {parseCorrectionRules} from "./merchantAttendanceCorrectionRules";
import {parseCorrectionCommand,parseCorrectionResult} from "./merchantAttendanceCorrection";
import {executeAttendanceCorrection} from "./merchantAttendanceCorrection.server";
import {AttendanceCorrectionClient,parseCorrectionPending} from "./merchantAttendanceCorrectionClient";
import {parseCorrectionReviewResult} from "./merchantAttendanceCorrectionReview";
import {executeCorrectionReview} from "./merchantAttendanceCorrectionReview.server";
import {parseCorrectionControlResult} from "./merchantAttendanceCorrectionControls";
import {executeCorrectionControls} from "./merchantAttendanceCorrectionControls.server";
import {createCorrectionControlsFixture,controlSite,controlOwner} from "../../scripts/fixtures/attendance-correction-controls-model";
import {correctionRules,correctionNow,correctionBasis,correctionProposal,correctionSite as siteId,correctionWorker as workerId,
  correctionEmployee as employeeId,correctionStart as startEventId,correctionId as id,createCorrectionFixture} from "../../scripts/fixtures/attendance-correction-model";
import {correctionReviewDetail,reviewQuery} from "../../scripts/fixtures/attendance-correction-review-model";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
const context={mode:"prepare" as const,asOf:correctionNow,startAt:correctionProposal.startAt};
const q={siteId,expectedWorkerId:workerId,mode:"prepare" as const,startEventId};
const prepared=()=>({siteId,employeeId,workerId,asOf:correctionNow,canRequest:true,mode:"prepare",basis:correctionBasis(),revision:0,pendingRequestId:null,rulesEnforced:true,rules:correctionRules()});
const command=()=>({siteId,expectedWorkerId:workerId,action:"submit",operationId:id(500),expectedRevision:0,expectedPolicyRevision:1,reason:"Synthetic reason",startEventId,expectedLastEventId:id(11),proposal:correctionProposal});
function setup(wrap:(api:AttendanceApiFetch)=>AttendanceApiFetch=api=>api){
  const fixture=createCorrectionFixture(),values=new Map<string,string>();
  const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
  const client=new AttendanceCorrectionClient({siteId,employeeId,apiFetch:wrap(fixture.apiFetch),storage:()=>storage,randomId:()=>id(500)});
  return {fixture,values,storage,client};
}
test("rule metadata projects only employee-safe policy/count and checks exclusive deadline",()=>{
  const raw={...correctionRules(),reason:"private owner note",periodIds:[id(90)]};
  const value=parseCorrectionRules(raw,context);assert.deepEqual(value,correctionRules());assert.doesNotMatch(JSON.stringify(value),/private|periodIds/);
  const at=value.deadlineAt!;assert.throws(()=>parseCorrectionRules({...value,checkedAt:at},{...context,asOf:at}));
  assert.deepEqual(parseCorrectionRules({...value,checkedAt:at,issues:["window_expired"]},{...context,asOf:at}).issues,["window_expired"]);
});
test("malformed, mismatched, inferred legacy and approval-bearing rules fail closed",()=>{
  const r=correctionRules();
  for(const raw of [{...r,checkedAt:"2026-09-29T00:00:00.000000Z"},{...r,approvalAvailable:true},{...r,binding:"bound"},
    {...r,policy:null},{...r,deadlineAt:null},{...r,deadlineAt:"2026-10-05T23:00:00.000000Z"},
    {...r,lockedPeriodCount:1},{...r,issues:["period_locked"]},{...r,issues:["unknown"]},{...r,issues:["policy_missing","policy_missing"]},
    {...r,policy:{...r.policy,revision:0}},{...r,policy:{...r.policy,submissionWindowDays:366}},
    {...r,policy:{...r.policy,recordedAt:"2026-10-01T00:00:00.000000Z"}}])assert.throws(()=>parseCorrectionRules(raw,context));
  assert.throws(()=>parseCorrectionRules({...correctionRules("legacy"),policy:r.policy},{...context,mode:"detail",submittedAt:correctionNow}));
});
test("policy-less preparation and unbound legacy are distinct, and current lock count is bounded",()=>{
  assert.equal(parseCorrectionRules({...correctionRules(),policy:null,deadlineAt:null,issues:["policy_missing"]},context).policy,null);
  assert.equal(parseCorrectionRules(correctionRules("legacy"),{...context,mode:"detail",submittedAt:correctionNow}).binding,"legacy");
  assert.equal(parseCorrectionRules({...correctionRules(),lockedPeriodCount:200,issues:["period_limit"]},context).lockedPeriodCount,200);
  assert.throws(()=>parseCorrectionRules({...correctionRules(),lockedPeriodCount:201,issues:["period_limit"]},context));
});
test("natural-date deadline handles DST, repeated midnight and skipped deadline/eligible dates",()=>{
  for(const [zone,startAt,days,deadlineAt] of [
    ["Europe/Madrid","2026-03-28T23:00:00.000000Z",0,"2026-03-29T22:00:00.000000Z"],
    ["Europe/Madrid","2026-10-24T22:00:00.000000Z",0,"2026-10-25T23:00:00.000000Z"],
    ["America/Havana","2025-11-01T12:00:00.000000Z",0,"2025-11-02T04:00:00.000000Z"],
    ["Pacific/Apia","2011-12-29T12:00:00.000000Z",0,"2011-12-30T10:00:00.000000Z"],
    ["Pacific/Apia","2011-12-29T12:00:00.000000Z",1,"2011-12-30T10:00:00.000000Z"],
  ] as const){
    const rules={...correctionRules(),checkedAt:startAt,policy:{revision:1,recordedAt:startAt,submissionWindowDays:days,timeZone:zone},deadlineAt};
    assert.equal(parseCorrectionRules(rules,{mode:"prepare",asOf:startAt,startAt}).deadlineAt,deadlineAt);
  }
});
test("historical bound application uses submission instant even when read after its deadline",()=>{
  const r={...correctionRules("bound"),checkedAt:"2027-01-01T00:00:00.000000Z"};
  assert.deepEqual(parseCorrectionRules(r,{...context,mode:"detail",asOf:r.checkedAt,submittedAt:correctionNow}).issues,[]);
});
test("new commands carry positive policy version; old recovery bodies remain parseable, withdrawal cannot carry policy",()=>{
  const c=command();assert.equal(parseCorrectionCommand(c).command.action,"submit");
  const {expectedPolicyRevision,...legacy}=c;assert.equal(expectedPolicyRevision,1);assert.equal("expectedPolicyRevision" in parseCorrectionCommand(legacy).command,false);
  for(const v of [null,0,-1,"1",1.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>parseCorrectionCommand({...c,expectedPolicyRevision:v}));
  assert.throws(()=>parseCorrectionCommand({siteId,expectedWorkerId:workerId,action:"withdraw",operationId:id(1),requestId:id(2),expectedRevision:1,reason:"x",expectedPolicyRevision:1}));
});
test("live employee and owner parsing requires enforcement metadata, including empty lists",()=>{
  assert.equal(parseCorrectionResult(prepared(),q,true).rules?.policy?.revision,1);
  for(const v of [undefined,false])assert.throws(()=>parseCorrectionResult({...prepared(),rulesEnforced:v},q,true));
  assert.throws(()=>parseCorrectionResult({...prepared(),rules:undefined},q,true));
  const a=correctionReviewDetail();assert.ok(parseCorrectionReviewResult(a,reviewQuery,true));
  assert.throws(()=>parseCorrectionReviewResult({...a,rulesEnforced:undefined},reviewQuery,true));
  assert.throws(()=>parseCorrectionReviewResult({...a,application:{...a.application,rulesEnforced:undefined}},reviewQuery,true));
  assert.throws(()=>parseCorrectionResult({siteId,employeeId,workerId,asOf:correctionNow,canRequest:true,mode:"list",items:[],nextCursor:null},
    {siteId,expectedWorkerId:workerId,mode:"list",cursorAt:null,cursorId:null},true));
});
test("actual adapters reject pre-v2 responses rather than silently falling back",async()=>{
  const a=prepared();await assert.rejects(executeAttendanceCorrection({query:q,authUserId:id(1),command:null,moduleEnabled:true},{rpc:async()=>({data:{...a,rulesEnforced:undefined},error:null})}),/attendance_unavailable/);
  const owner=correctionReviewDetail();await assert.rejects(executeCorrectionReview({query:reviewQuery,authUserId:id(1)},{rpc:async()=>({data:{...owner,rulesEnforced:undefined},error:null})}),/attendance_unavailable/);
});
test("client pins displayed policy, stores it before send and recovers lost response without resubmit",async()=>{
  const s=setup();await s.client.initialize();await s.client.prepare(startEventId);s.fixture.mode("lost");await s.client.submit(correctionProposal,"Synthetic reason");
  const pending=s.client.getSnapshot().pending!;assert.equal(pending.command.action,"submit");
  if(pending.command.action!=="submit")throw Error("fixture");assert.equal(pending.command.expectedPolicyRevision,1);
  assert.equal(parseCorrectionPending(s.values.get(s.client.storageKey)!,siteId,employeeId).command.action,"submit");
  s.fixture.mode("normal");await s.client.initialize();assert.equal(s.client.getSnapshot().pending,null);assert.equal(s.fixture.writes(),1);
  assert.equal(s.fixture.calls.filter(c=>c.method==="POST").length,1);
});
for(const mode of ["policy_changed","period_locked"]){test(`uncertain ${mode} retry keeps exact policy and only permanent version fencing clears intent`,async()=>{
  const s=setup();await s.client.initialize();await s.client.prepare(startEventId);s.fixture.mode("unsent");await s.client.submit(correctionProposal,"Synthetic reason");
  const raw=s.values.get(s.client.storageKey);s.fixture.mode(mode);await s.client.retry();
  if(mode==="policy_changed")assert.equal(s.client.getSnapshot().pending,null);else assert.equal(s.values.get(s.client.storageKey),raw);
  assert.equal(s.fixture.writes(),0);
  const writes=s.fixture.calls.filter(c=>c.method==="POST");assert.equal(writes[0].body,writes[1].body);
});}
test("client cannot submit when no policy exists or original period is locked",async()=>{
  for(const missing of [true,false]){
    const s=setup(api=>async(path,init)=>{const res=await api(path,init);if(!path.includes("mode=prepare"))return res;
      const body=await res.json();body.rules=missing?{...correctionRules(),policy:null,deadlineAt:null,issues:["policy_missing"]}:{...correctionRules(),lockedPeriodCount:1,issues:["period_locked"]};return Response.json(body);});
    await s.client.initialize();await s.client.prepare(startEventId);assert.equal(s.client.getSnapshot().phase,"ready");await s.client.submit(correctionProposal,"Synthetic reason");assert.equal(s.fixture.calls.filter(c=>c.method==="POST").length,0);
  }
});
test("legacy unsent pending is read first, never auto-migrated and explicit retry releases policy-less request",async()=>{
  const s=setup();await s.client.initialize();await s.client.prepare(startEventId);s.fixture.mode("unsent");await s.client.submit(correctionProposal,"Synthetic reason");
  const p=JSON.parse(s.values.get(s.client.storageKey)!);delete p.command.expectedPolicyRevision;s.values.set(s.client.storageKey,JSON.stringify(p));
  s.fixture.mode("normal");await s.client.initialize();assert.ok(s.client.getSnapshot().pending);assert.equal(s.fixture.calls.filter(c=>c.method==="POST").length,1);
  await s.client.retry();assert.equal(s.client.getSnapshot().pending,null);assert.equal(s.fixture.writes(),0);
  assert.equal("expectedPolicyRevision" in JSON.parse(s.fixture.calls.at(-1)!.body!),false);
});
test("policy mismatch in successful receipt cannot clear pending intent",async()=>{
  const s=setup(api=>async(path,init)=>{const res=await api(path,init);if(init?.method!=="POST")return res;const body=await res.json();body.rules.policy.revision=2;return Response.json(body);});
  await s.client.initialize();await s.client.prepare(startEventId);await s.client.submit(correctionProposal,"Synthetic reason");
  assert.ok(s.client.getSnapshot().pending);assert.equal(s.client.getSnapshot().phase,"unconfirmed");
});
test("legacy committed pending recovers its old receipt using GET only without applying current policy",async()=>{
  let legacy=false;
  const s=setup(api=>async(path,init)=>{
    if(legacy&&path.includes("mode=detail")){
      const a=correctionReviewDetail().application;const pending=JSON.parse(s.values.get(s.client.storageKey)!);
      const r={...a,ok:true,moduleEnabled:false,canRequest:true,item:{...a.item,requestId:id(500)},reason:pending.command.reason,
        rules:correctionRules("legacy"),receipt:{operationId:id(500),requestId:id(500),revision:1,action:"submit",recordedAt:correctionNow}};
      return Response.json(r);
    }
    return api(path,init);
  });
  await s.client.initialize();await s.client.prepare(startEventId);s.fixture.mode("unsent");await s.client.submit(correctionProposal,"Synthetic reason");
  const p=JSON.parse(s.values.get(s.client.storageKey)!);delete p.command.expectedPolicyRevision;s.values.set(s.client.storageKey,JSON.stringify(p));
  s.fixture.mode("normal");legacy=true;await s.client.initialize();assert.equal(s.client.getSnapshot().pending,null);
  assert.equal(s.fixture.calls.filter(c=>c.method==="POST").length,1);assert.equal(s.client.getSnapshot().phase,"ready");
});
test("live controls expose enforcement readiness and reject old configuration-only response",async()=>{
  const q={siteId:controlSite,operationId:null,beforeRevision:null};
  const old={...createCorrectionControlsFixture().response(null,null),rulesEnforced:false};
  assert.equal(parseCorrectionControlResult(old,q).rulesEnforced,false);
  assert.throws(()=>parseCorrectionControlResult(old,q,true));
  await assert.rejects(executeCorrectionControls({query:q,command:null,authUserId:controlOwner,allowWrite:false},{rpc:async()=>({data:old,error:null})}),/attendance_unavailable/);
});
