import test from "node:test";
import assert from "node:assert/strict";
import { REVIEW_ROUTING_FAMILIES, parseReviewRoutingBody, parseReviewRoutingQuery, parseReviewRoutingHttpQuery, parseReviewRoutingJson, parseReviewRoutingResult, parseReviewRoutingResponse, reviewRoutingQueryString, reviewRoutingCommandFingerprint, reviewRoutingCommandFingerprintText, reviewRoutingReceiptMatches } from "./merchantAttendanceReviewRouting";
import { routingId, routingSite, routingOwner, routingReadAt, routingRequest, routingCapture, routingObservation, routingDetail, routingResult, routingCommand, routingReceipt, routingCommandHash, routingEntryHash, routingManualHistory, routingDelegate, routingEncode } from "../../scripts/fixtures/attendance-review-routing-model";

test("198 all six request families retain exact saved identity and captured origin", async () => {
  for (const family of REVIEW_ROUTING_FAMILIES) {
    const f = routingDetail(family), parsed = await parseReviewRoutingResult(f.wire, f.query, routingOwner);
    assert.deepEqual(parsed, f.wire); assert.ok(Object.isFrozen(parsed.data));
    const changed = structuredClone(f.wire); if (changed.data.kind !== "detail") throw Error(); changed.data.request.employeeAuthUserId = routingId(55);
    await assert.rejects(parseReviewRoutingResult(changed, f.query, routingOwner));
  }
});
test("198 command tuple is independently pinned and scoped to actual actor, request and full intent", async () => {
  const q = routingDetail().query, c = routingCommand();
  assert.equal(await reviewRoutingCommandFingerprint(q, routingOwner, c), routingCommandHash(q, c));
  assert.equal(reviewRoutingCommandFingerprintText(q, routingOwner, c), routingEncode(["attendance-review-routing-command-v1",routingSite,routingOwner,q.family,q.requestId,[c.action,c.operationId,c.expectedResponsibilityRevision,c.expectedResponsibilityOperationId,c.expectedRequestRevision,c.expectedObservationFingerprint,c.grantId,c.reason]]));
  for (const changed of [{...c,reason:"其他意图"},{...c,expectedRequestRevision:4},{...c,expectedObservationFingerprint:"c".repeat(64)}]) assert.notEqual(await reviewRoutingCommandFingerprint(q,routingOwner,changed),routingCommandHash(q,c));
});
test("198 query modes and exclusive cursors round trip without extra/duplicate fields", () => {
  const f=routingDetail(); const queries=[f.query,{...f.query,mode:"self" as const},{...f.query,mode:"history" as const,beforeRevision:2},{...f.query,mode:"grants" as const,cursor:null},{siteId:routingSite,mode:"list" as const,cursor:null},{siteId:routingSite,mode:"recover" as const,family:f.query.family,operationId:routingId(300)}];
  for(const q of queries) assert.deepEqual(parseReviewRoutingHttpQuery("https://local.invalid/?"+reviewRoutingQueryString(q)),q);
  for(const q of [{...f.query,mode:"history",beforeRevision:1},{...f.query,extra:true},{...f.query,siteId:routingSite+"\n"}]) assert.throws(()=>parseReviewRoutingQuery(q));
  assert.throws(()=>parseReviewRoutingHttpQuery("https://local.invalid/?"+reviewRoutingQueryString(f.query)+"&siteId="+routingSite));
  assert.throws(()=>parseReviewRoutingJson('{"x":1,"x":2}',"request"));
});
test("198 capture and manual entry structural constraints survive attacker-recomputed hashes", async () => {
  const f=routingDetail(); if(f.wire.data.kind!=="detail"||!f.wire.data.current)throw Error();
  for(const patch of [{recordedAt:"2026-10-08T08:00:00.002000Z"},{actorId:routingOwner},{reason:"伪造来源"},{revision:2,previousOperationId:routingId(77)},{assignment:{...routingDelegate(),kind:"delegate" as const}}]) {
    const e={...f.wire.data.current,...patch}; e.entryFingerprint=routingEntryHash(f.request,e);
    const w=routingResult({...f.wire.data,current:e,observation:routingObservation(f.request,e)}); await assert.rejects(parseReviewRoutingResult(w,f.query,routingOwner));
  }
  const manual=routingManualHistory(f.request,1)[0]; manual.origin={kind:"rule_capture",activationRevision:1,observedAt:manual.recordedAt,sourceFingerprint:"a".repeat(64),selection:"unconfigured",selectedLayer:null,desired:{kind:"owner"}}; manual.entryFingerprint=routingEntryHash(f.request,manual);
  await assert.rejects(parseReviewRoutingResult(routingResult({kind:"history",request:f.request,items:[manual],nextBeforeRevision:null}),{...f.query,mode:"history",beforeRevision:null},routingOwner));
});
test("198 actual owner change is observed without rewriting original owner assignment",async()=>{
  const f=routingDetail(),newOwner=routingId(50); if(f.wire.data.kind!=="detail"||!f.current)throw Error();
  const d={...f.wire.data,observation:routingObservation(f.request,f.current,newOwner),canTakeOver:true}; const p=await parseReviewRoutingResult(routingResult(d,null,newOwner),f.query,newOwner);
  assert.equal(p.data.kind,"detail"); if(p.data.kind==="detail")assert.equal(p.data.observation.reason,"owner_changed"); assert.deepEqual(f.current.assignment,{kind:"owner",authUserId:routingOwner});
  await assert.rejects(parseReviewRoutingResult(routingResult({...d,observation:routingObservation(f.request,f.current)},null,newOwner),f.query,newOwner));
});
test("198 capture delegate is valid at saved entry time, not required to remain valid at read time",async()=>{
  const r=routingRequest("leave"),a=routingDelegate("leave"); a.validUntil="2026-10-08T09:00:00.000000Z";
  const e=routingCapture(r,{assignment:a,origin:{kind:"rule_capture",activationRevision:1,observedAt:"2026-10-08T08:00:00.001000Z",sourceFingerprint:"a".repeat(64),selection:"value",selectedLayer:"personal",desired:{kind:"delegate",employeeId:a.employeeId,authUserId:a.authUserId}}});
  const q={siteId:routingSite,mode:"detail" as const,family:r.family,requestId:r.requestId}; const o=routingObservation(r,e,routingOwner,{routeState:"handover_needed",reason:"grant_unavailable"});
  await parseReviewRoutingResult(routingResult({kind:"detail",request:r,current:e,observation:o,canRegister:true,canTakeOver:true}),q,routingOwner);
  a.validUntil=e.recordedAt; const bad=routingCapture(r,{...e,assignment:a}); await assert.rejects(parseReviewRoutingResult(routingResult({kind:"detail",request:r,current:bad,observation:routingObservation(r,bad),canRegister:false,canTakeOver:false}),q,routingOwner));
});
test("198 histories are contiguous, exclusive, bounded and retain initial origin",async()=>{
  const f=routingDetail(),items=routingManualHistory(f.request),q={...f.query,mode:"history" as const,beforeRevision:null};
  const first=routingResult({kind:"history",request:f.request,items:items.slice(0,25),nextBeforeRevision:3}); await parseReviewRoutingResult(first,q,routingOwner);
  await parseReviewRoutingResult(routingResult({kind:"history",request:f.request,items:items.slice(25),nextBeforeRevision:null}),{...q,beforeRevision:3},routingOwner);
  for(const page of [items,items.slice(1,25),[items[0],items[2]],items.slice(0,25).reverse()]) await assert.rejects(parseReviewRoutingResult(routingResult({kind:"history",request:f.request,items:page,nextBeforeRevision:3}),q,routingOwner));
});
test("198 list pagination uses UTC then C family then reverse UUID and exact terminal cursor",async()=>{
  const q={siteId:routingSite,mode:"list" as const,cursor:null},rows=Array.from({length:25},(_,i)=>{const r=routingRequest("leave",125-i),current=routingCapture(r);return{request:r,current,observation:routingObservation(r,current)};});
  const last=rows.at(-1)!; const nextCursor={kind:"list" as const,siteId:routingSite,beforeAt:last.current.recordedAt,beforeFamily:last.request.family,beforeRequestId:last.request.requestId};
  await parseReviewRoutingResult(routingResult({kind:"list",items:rows,nextCursor}),q,routingOwner);
  await assert.rejects(parseReviewRoutingResult(routingResult({kind:"list",items:[rows[0],rows[0]],nextCursor:null}),q,routingOwner));
  await assert.rejects(parseReviewRoutingResult(routingResult({kind:"list",items:rows,nextCursor:{...nextCursor,beforeRequestId:routingId(1)}}),q,routingOwner));
});
test("198 grant choices are paged by all three IDs and don't invent revision delegate choices",async()=>{
  const f=routingDetail("leave"),q={...f.query,mode:"grants" as const,cursor:null}; const a=routingDelegate("leave");
  const g={grantId:a.grantId,delegateEmployeeId:a.employeeId,delegateAuthUserId:a.authUserId,delegateName:"办理人",validFrom:a.validFrom,validUntil:"2026-10-08T11:59:59.999999Z",usable:true,reason:null};
  await parseReviewRoutingResult(routingResult({kind:"grants",request:f.request,items:[g],nextCursor:null}),q,routingOwner);
  await assert.rejects(parseReviewRoutingResult(routingResult({kind:"grants",request:f.request,items:[g,g],nextCursor:null}),q,routingOwner));
  const revision=routingDetail("correction_revision");await assert.rejects(parseReviewRoutingResult(routingResult({kind:"grants",request:revision.request,items:[g],nextCursor:null}),{...revision.query,mode:"grants",cursor:null},routingOwner));
});
test("198 self is a minimal explicitly scoped result and rejects authority/material additions",async()=>{
  const f=routingDetail(),q={...f.query,mode:"self" as const}; const d={kind:"self" as const,family:f.query.family,requestId:f.query.requestId,submittedAt:f.request.submittedAt,route:"owner" as const,handoverNeeded:false,capturedAt:f.current?.recordedAt??null};
  const w=routingResult(d,null,f.request.employeeAuthUserId);await parseReviewRoutingResult(w,q,f.request.employeeAuthUserId);
  for(const extra of [{delegateAuthUserId:routingId(10)},{grantId:routingId(12)},{canApprove:true},{request:f.request}])await assert.rejects(parseReviewRoutingResult({...w,data:{...d,...extra}},q,f.request.employeeAuthUserId));
});
test("198 recovery returns minimal original actor receipt and matches saved full command",async()=>{
  const q=routingDetail().query,c=routingCommand(),receipt=routingReceipt(q,c),recover={siteId:routingSite,mode:"recover" as const,family:q.family,operationId:c.operationId};
  const parsed=await parseReviewRoutingResult(routingResult({kind:"receipt"},receipt),recover,routingOwner);assert.ok(parsed.receipt&&reviewRoutingReceiptMatches(parsed.receipt,q,c,routingOwner,routingCommandHash(q,c)));
  assert.equal(reviewRoutingReceiptMatches(receipt,q,{...c,reason:"其他意图"},routingOwner,routingCommandHash(q,{...c,reason:"其他意图"})),false);
  await parseReviewRoutingResult(routingResult({kind:"receipt"},null),recover,routingOwner);
  await assert.rejects(parseReviewRoutingResult(routingResult({kind:"receipt"},receipt,routingId(90)),recover,routingId(90)));
  await assert.rejects(parseReviewRoutingResult(routingResult({kind:"receipt"},receipt),recover,routingOwner,c));
  await parseReviewRoutingResult(routingResult({kind:"receipt"},receipt),q,routingOwner,c);
});
test("198 in-flight untrusted response is cloned before digest awaits",async()=>{
  const f=routingDetail(),promise=parseReviewRoutingResult(f.wire,f.query,routingOwner); if(f.wire.data.kind!=="detail"||!f.wire.data.current)throw Error();
  f.wire.data.current.assignment={kind:"owner",authUserId:routingId(90)}; const result=await promise; if(result.data.kind!=="detail"||!result.data.current)throw Error();assert.deepEqual(result.data.current.assignment,{kind:"owner",authUserId:routingOwner});
});
test("198 request/body and error envelopes reject unsafe data without SQL leakage",async()=>{
  const q=routingDetail().query,c=routingCommand(); assert.deepEqual(parseReviewRoutingBody({query:q,command:c}),{query:q,command:c});
  for(const v of [{query:{...q,mode:"self"},command:c},{query:q,command:{...c,reason:"  不规范"}},{query:q,command:{...c,grantId:null}},{query:q,command:{...c,expectedResponsibilityRevision:9007199254740990}}])assert.throws(()=>parseReviewRoutingBody(v));
  const valid=await parseReviewRoutingResponse({ok:false,error:{code:"attendance_review_routing_changed",message:"已变化"}},q,routingOwner);assert.equal(valid.ok,false);
  await assert.rejects(parseReviewRoutingResponse({ok:false,error:{code:"private_sql_detail",message:"秘密"}},q,routingOwner));
  assert.equal(routingReadAt.length,27);
});
