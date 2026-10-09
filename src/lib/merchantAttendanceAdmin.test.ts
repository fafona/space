import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendanceAdminCommand, parseAttendanceAdminQuery, parseAttendanceAdminResult, attendanceAdminMessage } from "./merchantAttendanceAdmin";
import { executeAttendanceAdmin } from "./merchantAttendanceAdmin.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const settings = { timeZone:"Europe/Madrid", enabled:false, webClockEnabled:false, webBreakPaid:false };
const base = { siteId:"99990001", operationId:id(1), expectedVersion:0, kind:"settings", values:settings };
test("strict command accepts explicit settings, location and employee-bound worker only", () => {
  assert.equal(parseAttendanceAdminCommand(base).command.kind,"settings");
  const location = {id:id(2),name:" Main ",timeZone:"UTC",active:false};
  const parsed = parseAttendanceAdminCommand({...base,kind:"location",values:location}).command;
  assert.equal(parsed.kind,"location");
  if (parsed.kind === "location") assert.equal(parsed.values.timeZone,"UTC");
  assert.equal(parseAttendanceAdminCommand({...base,kind:"worker",values:{id:id(3),employeeId:id(4),workerNo:"A1",displayName:"One",locationId:id(2),active:false,startsOn:"2024-02-29"}}).command.kind,"worker");
});
for(const value of [null,[],{}, {...base,authUserId:id(2)}, {...base,expectedVersion:-1}, {...base,expectedVersion:"1"}, {...base,expectedVersion:Number.MAX_SAFE_INTEGER}, {...base,kind:"delete"}, {...base,operationId:"bad"}, {...base,siteId:"99990001 "}, {...base,values:{...settings,enabled:"true"}}, {...base,values:{...settings,timeZone:"Europe/Fake"}}, {...base,values:{...settings,latitude:1}}])
  test(`invalid admin input ${JSON.stringify(value)?.slice(0,100)}`,()=>assert.throws(()=>parseAttendanceAdminCommand(value)));
test("worker input cannot invent fields, dates or implicit linkage",()=>{
  const worker={id:id(3),employeeId:id(4),workerNo:"A1",displayName:"One",locationId:id(2),active:false,startsOn:"2024-02-29"};
  for(const values of [{...worker,startsOn:"2025-02-29"},{...worker,employeeId:null},{...worker,workerNo:"\nA"},{...worker,endsOn:null},{...worker,active:1}])assert.throws(()=>parseAttendanceAdminCommand({...base,kind:"worker",values}));
});
test("bounded keyset queries reject duplicates, offsets, unknown views and identity claims",()=>{
  const url="https://www.faolla.com/api/merchant-enterprise/attendance/admin?siteId=99990001";
  assert.deepEqual(parseAttendanceAdminQuery(url),{siteId:"99990001",view:"settings",cursor:null,search:"",operationId:null});
  for(const suffix of ["&siteId=99990002","&offset=1000","&workerId="+id(1),"&view=audit","&cursor=bad","&search="+"a".repeat(81)])assert.throws(()=>parseAttendanceAdminQuery(url+suffix));
});
test("response whitelists identities and validates tenant, view, page and receipt",()=>{
  const data={siteId:base.siteId,version:1,settings,view:"settings" as const,items:[],nextCursor:null,receipt:{operationId:id(1),version:1,kind:"settings",targetId:null},internalKey:"must not leak"};
  const expected={siteId:base.siteId,view:"settings" as const,operationId:id(1)};
  assert.equal(Object.hasOwn(parseAttendanceAdminResult(data,expected),"internalKey"),false);
  for(const invalid of [{...data,siteId:"99990002"},{...data,version:0},{...data,receipt:{...data.receipt,operationId:id(2)}},{...data,receipt:{...data.receipt,version:2}},{...data,items:[{}]},{...data,nextCursor:id(2)}])assert.throws(()=>parseAttendanceAdminResult(invalid,expected));
});
test("RPC failures and unexpected response bodies are sanitized",async()=>{
  const input={siteId:base.siteId,authUserId:id(5),view:"settings" as const,cursor:null,search:"",command:null,operationId:null};
  await assert.rejects(()=>executeAttendanceAdmin(input,{rpc:async()=>({data:null,error:{message:"password=private"}})}),/attendance_unavailable/);
  await assert.rejects(()=>executeAttendanceAdmin(input,{rpc:async()=>({data:{secret:true},error:null})}),/attendance_unavailable/);
  assert.ok(!attendanceAdminMessage("constructor").includes("function"));
});
