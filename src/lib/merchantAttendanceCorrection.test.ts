import assert from "node:assert/strict";
import test from "node:test";
import {parseCorrectionProposal,parseCorrectionCommand,parseCorrectionQuery,parseCorrectionResult,previewCorrection,correctionQueryString,type CorrectionQuery} from "./merchantAttendanceCorrection";
import {executeAttendanceCorrection,readCorrectionJson} from "./merchantAttendanceCorrection.server";
import {DEFAULT_MERCHANT_ENTERPRISE_ROLES,getMissingMerchantEnterprisePermissionDependencies,parseMerchantEnterprisePermissionsStrict} from "./merchantEnterprise";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const siteId="99990001",workerId=id(2),employeeId=id(3),start=id(10),asOf="2026-09-30T12:00:00.000000Z";
const proposal={startAt:"2026-09-28T08:00:00.000000Z",endAt:"2026-09-28T17:00:00.000000Z",breaks:[{startAt:"2026-09-28T12:00:00.000000Z",endAt:"2026-09-28T12:30:00.000000Z",paid:false}]};
const basis={siteId,employeeId,workerId,asOf,events:[{id:start,locationId:id(4),sequence:1,action:"clock_in" as const,occurredAt:proposal.startAt,timeZone:"Europe/Madrid",breakPaid:null,source:"web" as const},
  {id:id(11),locationId:id(4),sequence:2,action:"clock_out" as const,occurredAt:"2026-09-28T16:00:00.000000Z",timeZone:"Europe/Madrid",breakPaid:null,source:"web" as const}]};
const submit={siteId,expectedWorkerId:workerId,action:"submit",operationId:id(20),expectedRevision:0,startEventId:start,expectedLastEventId:id(11),proposal,reason:"忘记记录实际离店时间"};
const prepare:CorrectionQuery={siteId,expectedWorkerId:workerId,mode:"prepare",startEventId:start};
const detail:CorrectionQuery={siteId,expectedWorkerId:workerId,mode:"detail",requestId:id(20),operationId:id(20)};
const list:CorrectionQuery={siteId,expectedWorkerId:workerId,mode:"list",cursorAt:null,cursorId:null};
const common={siteId,employeeId,workerId,asOf,canRequest:true};
const item={requestId:id(20),startEventId:start,revision:1,status:"submitted",submittedAt:asOf,startAt:proposal.startAt,endAt:proposal.endAt};
const result=()=>({...common,mode:"detail",item,basis,proposal,reason:submit.reason,withdrawal:null,receipt:{operationId:id(20),requestId:id(20),revision:1,action:"submit",recordedAt:asOf}});
test("request permission is independent of clock, has view dependencies and is not added to default roles",()=>{
  assert.ok(parseMerchantEnterprisePermissionsStrict(["enterprise.view","attendance.self.view","attendance.self.request"]));
  assert.ok(getMissingMerchantEnterprisePermissionDependencies(["attendance.self.request"]).length);
  assert.ok(DEFAULT_MERCHANT_ENTERPRISE_ROLES.every(r=>!r.permissions.includes("attendance.self.request")));
});
test("correction proposals preserve UTC microseconds and reject overlap, zero duration, excess breaks and future ends",()=>{
  assert.deepEqual(parseCorrectionProposal(proposal,asOf),proposal);
  const valid={startAt:"2026-09-28T08:00:00.000001Z",endAt:"2026-09-28T08:00:00.000002Z",breaks:[]};assert.deepEqual(parseCorrectionProposal(valid),valid);
  for(const bad of [{...proposal,latitude:1},{...proposal,endAt:proposal.startAt},{...proposal,endAt:"2026-11-01T08:00:00.000000Z"},
    {...proposal,breaks:[{...proposal.breaks[0],endAt:proposal.breaks[0].startAt}]},{...proposal,breaks:[...proposal.breaks,...proposal.breaks]},
    {...proposal,breaks:[{...proposal.breaks[0],paid:"false"}]},{...proposal,breaks:Array(33).fill(proposal.breaks[0])},
    {...proposal,breaks:[{...proposal.breaks[0],startAt:"2026-09-27T08:00:00.000000Z"}]},{...proposal,startAt:"2026-09-28T08:00"}])assert.throws(()=>parseCorrectionProposal(bad,asOf));
  assert.throws(()=>parseCorrectionProposal(proposal,"2026-09-28T16:59:59.999999Z"));
});
test("submit/withdraw commands accept no approval, actor, location, effective-time or note overrides",()=>{
  const parsed=parseCorrectionCommand(submit);assert.equal(parsed.command.action,"submit");
  for(const patch of [{authUserId:id(6)},{employeeId:id(6)},{status:"approved"},{effective:true},{timeZone:"UTC"},{locationId:id(4)},
    {reason:" "},{reason:" a"},{reason:"a\n"},{reason:"a\u0085"},{reason:"好".repeat(501)},{expectedRevision:9007199254740989},{action:"approve"}])assert.throws(()=>parseCorrectionCommand({...submit,...patch}));
  assert.equal(parseCorrectionCommand({...submit,reason:"😀".repeat(500)}).command.reason.length,1000);
  const withdrawal={siteId,expectedWorkerId:workerId,action:"withdraw",operationId:id(21),requestId:id(20),expectedRevision:1,reason:"撤回重新核对"};
  assert.equal(parseCorrectionCommand(withdrawal).command.action,"withdraw");assert.throws(()=>parseCorrectionCommand({...withdrawal,proposal}));
});
test("prepare/list/detail queries require the current worker pin and exact mode-specific keys",()=>{
  for(const q of [prepare,list,detail])assert.deepEqual(parseCorrectionQuery(`https://local.invalid/?${correctionQueryString(q)}`),q);
  for(const extra of ["employeeId=x","ownerId=x","status=approved","limit=500","asOf=x","expectedWorkerId="+workerId])
    assert.throws(()=>parseCorrectionQuery(`https://local.invalid/?${correctionQueryString(prepare)}&${extra}`));
  assert.throws(()=>parseCorrectionQuery(`https://local.invalid/?${correctionQueryString({...list,cursorId:id(20)})}`));
  assert.throws(()=>parseCorrectionQuery(`https://local.invalid/?siteId=${siteId}&mode=list`));
});
test("prepare and detail responses whitelist identity/basis and preserve declared versus original times",()=>{
  const p=parseCorrectionResult({...common,mode:"prepare",basis,revision:0,pendingRequestId:null,authUserId:id(1)},prepare);
  assert.equal(p.mode,"prepare");assert.doesNotMatch(JSON.stringify(p),/authUserId/);
  const d=parseCorrectionResult({...result(),command:{secret:true},actor_auth_user_id:id(1)},detail);
  assert.equal(d.mode,"detail");if(d.mode!=="detail")throw Error("fixture");
  assert.equal(d.proposal.endAt,proposal.endAt);assert.equal(d.basis.events.at(-1)?.occurredAt,basis.events.at(-1)?.occurredAt);
  assert.doesNotMatch(JSON.stringify(d),/secret|actor_auth_user_id/);
});
test("corrupt or cross-identity detail, receipt and withdrawal responses cannot masquerade as confirmation",()=>{
  for(const bad of [{...result(),workerId:id(9)},{...result(),siteId:"99990002"},{...result(),canRequest:1},
    {...result(),basis:{...basis,employeeId:id(9)}},{...result(),basis:{...basis,events:[{...basis.events[0],source:"unknown"},basis.events[1]]}},
    {...result(),item:{...item,requestId:id(99)}},{...result(),item:{...item,status:"approved"}},
    {...result(),proposal:{...proposal,endAt:"2026-09-28T18:00:00.000000Z"}},{...result(),receipt:{...result().receipt,operationId:id(99)}},
    {...result(),receipt:{...result().receipt,revision:2}},{...result(),withdrawal:{reason:"x",recordedAt:asOf}}])assert.throws(()=>parseCorrectionResult(bad,detail));
  const withdrawn={...result(),item:{...item,status:"withdrawn",revision:2},withdrawal:{reason:"撤回",recordedAt:asOf}};
  assert.equal(parseCorrectionResult(withdrawn,detail).mode,"detail"); // Original submit receipt survives a later withdrawal.
});
test("list is bounded, cursor-ordered and never includes reasons or proposal details",()=>{
  const items=Array.from({length:25},(_,n)=>({...item,requestId:id(100-n)}));
  const payload={...common,mode:"list",items,nextCursor:{recordedAt:asOf,requestId:items.at(-1)!.requestId}};
  const parsed=parseCorrectionResult({...payload,items:items.map(i=>({...i,reason:"private",basis}))},list);
  assert.equal(parsed.mode,"list");assert.doesNotMatch(JSON.stringify(parsed),/private|"basis"/);
  for(const bad of [{...payload,items:items.slice().reverse()},{...payload,items:[...items,items[0]]},
    {...payload,items:[...items.slice(0,24),items[0]]},{...payload,items:[]},{...payload,nextCursor:{recordedAt:asOf,requestId:id(999)}}])assert.throws(()=>parseCorrectionResult(bad,list));
});
test("preview changes no inputs/current state and explicitly remains an unapproved declaration",()=>{
  const before=JSON.stringify(basis),p=previewCorrection(basis,proposal);
  assert.equal(JSON.stringify(basis),before);assert.equal(p.kind,"unapproved_declaration");
  assert.equal(p.original.totals?.workedUs,8*3600000000);assert.equal(p.proposed.totals?.workedUs,8.5*3600000000);
  assert.equal("events" in p.proposed,false);assert.equal("approved" in p,false);
  const open={...basis,events:[basis.events[0]]};const o=previewCorrection(open,proposal);assert.equal(o.original.totals,null);assert.equal(o.proposed.status,"completed");
});
test("declaration preview uses original location timezone and handles DST, midnight and paid breaks separately",()=>{
  for(const [startAt,endAt,hours] of [["2026-03-28T23:00:00.000000Z","2026-03-29T22:00:00.000000Z",23],
    ["2026-10-24T22:00:00.000000Z","2026-10-25T23:00:00.000000Z",25]] as const){
    const p=previewCorrection(basis,{startAt,endAt,breaks:[]});assert.equal(p.proposed.totals?.elapsedUs,hours*3600000000);assert.equal(p.proposed.days.length,1);
  }
  const p=previewCorrection(basis,{startAt:"2026-09-28T21:00:00.000000Z",endAt:"2026-09-29T02:00:00.000000Z",
    breaks:[{startAt:"2026-09-28T21:30:00.000000Z",endAt:"2026-09-28T22:30:00.000000Z",paid:true}]});
  assert.equal(p.proposed.days.length,2);assert.equal(p.proposed.totals?.workedUs,4*3600000000);assert.equal(p.proposed.totals?.paidBreakUs,3600000000);
});
test("adapter binds server identity/platform flag and requires an exact command receipt",async()=>{
  const parsed=parseCorrectionCommand(submit),q={...detail,operationId:null};
  const data=await executeAttendanceCorrection({query:q,authUserId:id(1),moduleEnabled:false,command:parsed.command},{rpc:async(name,args)=>{
    assert.equal(name,"faolla_attendance_correction_self_v3");assert.equal(args.p_auth_user_id,id(1));assert.equal(args.p_platform_enabled,false);
    assert.equal("siteId" in (args.p_query as object),false);return {data:{...result(),item:{...item,decision:null},decisionsAvailable:true,rulesEnforced:true,rules:{binding:"legacy",checkedAt:asOf,approvalAvailable:false,policy:null,deadlineAt:null,lockedPeriodCount:0,issues:["legacy_unbound"]}},error:null};}});
  assert.equal(data.mode,"detail");
  for(const raw of [{...result(),receipt:null},{...result(),reason:"other"},{...result(),basis:{...basis,events:[basis.events[0]]}}])
    await assert.rejects(executeAttendanceCorrection({query:q,authUserId:id(1),moduleEnabled:true,command:parsed.command},{rpc:async()=>({data:raw,error:null})}),/attendance_unavailable/);
  await assert.rejects(executeAttendanceCorrection({query:prepare,authUserId:id(1),moduleEnabled:true,command:parsed.command},{rpc:async()=>{throw Error("should not run");}}),/attendance_invalid_request/);
});
test("adapter distinguishes validation, conflicts and unavailable service without leaking SQL",async()=>{
  const input={query:detail,authUserId:id(1),moduleEnabled:true,command:null};
  await assert.rejects(executeAttendanceCorrection(input,null),/attendance_unavailable/);
  for(const code of ["attendance_correction_pending","attendance_correction_basis_changed","attendance_access_denied","secret SQL","toString"])
    await assert.rejects(executeAttendanceCorrection(input,{rpc:async()=>({data:null,error:{message:code}})}),new RegExp(code.startsWith("attendance_")?code:"attendance_unavailable"));
});
test("request body parser is UTF-8 byte bounded, strict and accepts the largest supported multilingual proposal",async()=>{
  const url="https://www.faolla.com/local";
  const body={...submit,reason:"😀".repeat(500),proposal:{...proposal,breaks:Array.from({length:32},(_,n)=>({startAt:`2026-09-28T10:${String(n).padStart(2,"0")}:00.000000Z`,endAt:`2026-09-28T10:${String(n).padStart(2,"0")}:30.000000Z`,paid:false}))}};
  const request=(text:string,headers={"content-type":"application/json"})=>new Request(url,{method:"POST",headers,body:text});
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).length<=8192);assert.deepEqual(await readCorrectionJson(request(JSON.stringify(body))),body);
  await assert.rejects(readCorrectionJson(request("{")),/attendance_invalid_request/);
  await assert.rejects(readCorrectionJson(request("{}",{"content-type":"text/plain"})),/attendance_invalid_content_type/);
  await assert.rejects(readCorrectionJson(request("x".repeat(8193))),/attendance_body_too_large/);
  await assert.rejects(readCorrectionJson(new Request(url,{method:"POST",headers:{"content-type":"application/json","content-length":"9000"},body:"{}"})),/attendance_body_too_large/);
  await assert.rejects(readCorrectionJson(new Request(url,{method:"POST",headers:{"content-type":"application/json"},body:new Uint8Array([0xff])})),/attendance_invalid_request/);
});
test("stalled/aborted request body is canceled instead of holding the route indefinitely",async()=>{
  let canceled=false;const stream=new ReadableStream<Uint8Array>({cancel(){canceled=true;}});
  const req=new Request("https://local.invalid",{method:"POST",headers:{"content-type":"application/json"},body:stream,duplex:"half"} as RequestInit);
  await assert.rejects(readCorrectionJson(req,10),/attendance_invalid_request/);assert.equal(canceled,true);
  const abort=new AbortController();abort.abort();
  await assert.rejects(readCorrectionJson(new Request("https://local.invalid",{method:"POST",headers:{"content-type":"application/json"},body:"{}",signal:abort.signal})),/attendance_invalid_request/);
});
