import assert from "node:assert/strict";
import test from "node:test";
import { attendanceRecordInstant, parseAttendanceScopeCommand, parseAttendanceScopeQuery, parseAttendanceScopeResult,
  parseAttendanceRecordsQuery, parseAttendanceRecordsResult } from "./merchantAttendanceManagement";
import { executeAttendanceRecords, executeAttendanceScopes, readAttendanceScopeJson } from "./merchantAttendanceManagement.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { DEFAULT_MERCHANT_ENTERPRISE_ROLES, getMissingMerchantEnterprisePermissionDependencies, parseMerchantEnterprisePermissionsStrict } from "./merchantEnterprise";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const grant={workerIds:[id(2)],locationIds:[id(3)],validFrom:"2026-01-01T00:00:00.000Z",validUntil:null};
const body={siteId:"99990001",employeeId:id(1),operationId:id(4),expectedRevision:0,action:"put",grantId:id(5),grant};
const base={siteId:"99990001",access:"manager",fromAt:"2026-09-01T00:00:00.000Z",toAt:"2026-09-02T00:00:00.000Z"};
const url=(patch:Record<string,string>={})=>`https://www.faolla.com/api/merchant-enterprise/attendance/records?${new URLSearchParams({...base,...patch})}`;
const row=(n=1)=>({id:id(100+n),workerId:id(2),locationId:id(3),workerName:"Worker",workerNo:"A",locationName:"Place",
  sequence:n,action:"clock_in",source:"web",timeZone:"UTC",breakPaid:null,occurredAt:`2026-09-01T12:00:00.${String(1000-n).padStart(6,"0")}Z`});
const result=(items:unknown[]=[row()])=>({siteId:base.siteId,access:"manager",scopeRevision:1,asOf:"2026-09-29T00:00:00.000000Z",items,nextCursor:null});
const error=(code:string)=>(e:unknown)=>e instanceof MerchantAttendanceError&&e.code===code;
test("record permission is explicit and not added to any default role",()=>{
  assert.ok(parseMerchantEnterprisePermissionsStrict(["enterprise.view","attendance.records.view"]));
  assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(["attendance.records.view"]),["enterprise.view"]);
  assert.ok(DEFAULT_MERCHANT_ENTERPRISE_ROLES.every(r=>!r.permissions.includes("attendance.records.view")));
});
test("scope command is one bounded explicit grant and normalizes only ID ordering",()=>{
  const value={...body,grant:{...grant,workerIds:[id(20),id(2)]}};const saved=structuredClone(value);
  const p=parseAttendanceScopeCommand(value);assert.deepEqual(p.command.grant?.workerIds,[id(2),id(20)]);assert.deepEqual(value,saved);
  assert.equal(parseAttendanceScopeCommand({...body,action:"remove",grant:null}).command.action,"remove");
});
for(const [name,patch] of [["actor override",{authUserId:id(9)}],["owner override",{isOwner:true}],
  ["negative version",{expectedRevision:-1}],["fractional version",{expectedRevision:1.1}],
  ["future unsafe version",{expectedRevision:Number.MAX_SAFE_INTEGER}],["remove with grant",{action:"remove"}],
  ["put without grant",{grant:null}],["wildcard",{grant:{...grant,workerIds:["*"]}}],
  ["excess workers",{grant:{...grant,workerIds:Array(201).fill(id(2))}}],["unknown action",{action:"replace-all"}]] as const)
  test(`scope command denies ${name}`,()=>assert.throws(()=>parseAttendanceScopeCommand({...body,...patch})));
test("scope GET has no all-employees fallback and rejects duplicate or foreign keys",()=>{
  const good=`https://www.faolla.com/?siteId=${body.siteId}&employeeId=${body.employeeId}`;
  assert.equal(parseAttendanceScopeQuery(good).employeeId,body.employeeId);
  for(const bad of ["https://www.faolla.com/?siteId=99990001",`${good}&employeeId=${id(8)}`,`${good}&role=owner`]) assert.throws(()=>parseAttendanceScopeQuery(bad));
});
test("scope read receipt stays separate from newer scope and uninitialized reads stay empty",()=>{
  const expected={siteId:body.siteId,employeeId:body.employeeId,operationId:body.operationId};
  const value={scope:{siteId:body.siteId,employeeId:body.employeeId,revision:2,grants:[{id:body.grantId,...grant}]},
    receipt:{operationId:body.operationId,revision:1,action:"put",grantId:body.grantId,secret:"omit"}};
  const p=parseAttendanceScopeResult(value,expected);assert.equal(p.scope.revision,2);assert.equal(p.receipt?.revision,1);assert.ok(!("secret" in p.receipt!));
  assert.equal(parseAttendanceScopeResult({scope:{...value.scope,revision:0,grants:[]},receipt:null},expected).scope.revision,0);
  for(const patch of [{scope:{...value.scope,employeeId:id(9)}},{receipt:{...value.receipt,revision:3}},
    {receipt:{...value.receipt,operationId:id(9)}},{scope:{...value.scope,revision:0}}])assert.throws(()=>parseAttendanceScopeResult({...value,...patch},expected));
});
test("record query preserves microseconds and bounds precisely at 31 days",()=>{
  assert.equal(attendanceRecordInstant(base.fromAt),"2026-09-01T00:00:00.000000Z");
  assert.equal(attendanceRecordInstant("2026-09-01T00:00:00.000001Z"),"2026-09-01T00:00:00.000001Z");
  assert.ok(parseAttendanceRecordsQuery(url({toAt:"2026-10-02T00:00:00.000000Z"})));
  assert.throws(()=>parseAttendanceRecordsQuery(url({toAt:"2026-10-02T00:00:00.000001Z"})));
  for(const value of ["2026-02-30T00:00:00.000Z","2026-09-01T00:00:00Z","2026-09-01T00:00:00.000+00:00","2026-09-01T00:00:00.0000001Z"])assert.throws(()=>attendanceRecordInstant(value));
});
for(const [name,patch] of [["offset",{offset:"100"}],["all date range",{toAt:"2026-12-31T00:00:00.000Z"}],
  ["reversed",{toAt:base.fromAt}],["missing access",{access:""}],["scope override",{scope:"all"}],
  ["half cursor",{cursorId:id(100)}],["cursor without asOf",{cursorId:id(100),cursorAt:row().occurredAt}],
  ["cursor before start",{cursorId:id(100),cursorAt:"2026-08-30T00:00:00.000Z",asOf:"2026-09-29T00:00:00.000Z"}]] as const)
  test(`record query denies ${name}`,()=>assert.throws(()=>parseAttendanceRecordsQuery(url(patch))));
test("record response has bounded whitelist, stable cursor and strictly descending microsecond order",()=>{
  const items=Array.from({length:50},(_,i)=>row(i+1));const tail=items.at(-1)!;
  const value={...result(items),internal:"omit",nextCursor:{id:tail.id,occurredAt:tail.occurredAt}};
  const parsed=parseAttendanceRecordsResult(value,parseAttendanceRecordsQuery(url()));assert.equal(parsed.items.length,50);assert.ok(!("internal" in parsed));
  const small=parseAttendanceRecordsResult(result([{...row(),authUserId:id(9),latitude:40,operationId:id(8)}]),parseAttendanceRecordsQuery(url()));
  assert.deepEqual(Object.keys(small.items[0]).sort(),Object.keys(row()).sort());
  assert.equal(parseAttendanceRecordsResult(result([{...row(),sequence:Number.MAX_SAFE_INTEGER}]),parseAttendanceRecordsQuery(url())).items[0].sequence,Number.MAX_SAFE_INTEGER);
  for(const patch of [{items:[...items,row(51)]},{items:[row(2),row(1)]},{items:[row(),row()]},
    {nextCursor:{...value.nextCursor,id:id(9)}},{scopeRevision:null},{siteId:"99990002"},{items:[{...row(),breakPaid:true}]},
    {items:[{...row(),source:"unknown"}]},{items:[{...row(),occurredAt:base.toAt}]}])
    assert.throws(()=>parseAttendanceRecordsResult({...value,...patch},parseAttendanceRecordsQuery(url())));
});
test("response cannot change chosen filters, requested asOf or continue above old cursor",()=>{
  const changes:Record<string,string>[]=[{workerId:id(9)},{locationId:id(9)},{asOf:"2026-09-28T00:00:00.000Z"},
    {asOf:result().asOf,cursorAt:row(2).occurredAt,cursorId:row(2).id}];
  for(const patch of changes)assert.throws(()=>parseAttendanceRecordsResult(result(),parseAttendanceRecordsQuery(url(patch))));
});
test("RPC adapter validates scope receipt and never forwards internal errors",async()=>{
  const p=parseAttendanceScopeCommand(body),input={...p,authUserId:id(9),operationId:null};
  const value={scope:{siteId:body.siteId,employeeId:body.employeeId,revision:1,grants:[{id:body.grantId,...grant}]},
    receipt:{operationId:body.operationId,revision:1,action:"put",grantId:body.grantId}};
  let called=false;
  const saved=await executeAttendanceScopes(input,{rpc:async(name,args)=>{called=true;assert.equal(name,"faolla_attendance_scopes_v1");assert.equal(args.p_auth_user_id,id(9));return{data:value,error:null};}});
  assert.ok(called);assert.equal(saved.receipt?.revision,1);
  for(const patch of [{receipt:null},{receipt:{...value.receipt,grantId:id(9)}},{scope:{...value.scope,revision:2},receipt:{...value.receipt,revision:2}}])
    await assert.rejects(executeAttendanceScopes(input,{rpc:async()=>({data:{...value,...patch},error:null})}),error("attendance_unavailable"));
  await assert.rejects(executeAttendanceScopes(input,{rpc:async()=>({data:null,error:{message:"database private key"}})}),error("attendance_unavailable"));
  await assert.rejects(executeAttendanceScopes(input,null),error("attendance_unavailable"));
});
test("record RPC adapter selects fields and rejects an invalid page",async()=>{
  const input={...parseAttendanceRecordsQuery(url()),authUserId:id(9)};
  assert.equal((await executeAttendanceRecords(input,{rpc:async(name,args)=>{assert.equal(name,"faolla_attendance_records_v1");assert.equal(args.p_auth_user_id,id(9));return{data:result(),error:null};}})).items.length,1);
  await assert.rejects(executeAttendanceRecords(input,{rpc:async()=>({data:result([{...row(),workerId:"*"}]),error:null})}),error("attendance_unavailable"));
  await assert.rejects(executeAttendanceRecords(input,{rpc:async()=>({data:null,error:{message:"attendance_access_denied"}})}),error("attendance_access_denied"));
});
test("one grant JSON reader enforces actual UTF-8 bytes and rejects malformed streams",async()=>{
  const req=(value:string,headers:Record<string,string>={})=>new Request("https://www.faolla.com/",{method:"POST",headers:{"content-type":"application/json",...headers},body:value});
  assert.deepEqual(await readAttendanceScopeJson(req(JSON.stringify(body))),body);
  const large={...body,grant:{...grant,workerIds:Array.from({length:200},(_,i)=>id(i+100)),locationIds:Array.from({length:50},(_,i)=>id(i+500))}};
  assert.ok(parseAttendanceScopeCommand(await readAttendanceScopeJson(req(JSON.stringify(large)))));
  await assert.rejects(readAttendanceScopeJson(req(JSON.stringify({padding:"界".repeat(6000)}))),error("attendance_body_too_large"));
  await assert.rejects(readAttendanceScopeJson(req("{}",{"content-length":"20000"})),error("attendance_body_too_large"));
  await assert.rejects(readAttendanceScopeJson(req("{}",{"content-type":"text/plain"})),error("attendance_invalid_content_type"));
  await assert.rejects(readAttendanceScopeJson(req("{")),error("attendance_invalid_request"));
});
