import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handlePinAdmin,pinAdminDependencies} from "./route-handler";
import {handlePinVerify} from "../terminal-pin/route-handler";
import {TERMINAL_COOKIE,terminalPairToken} from "@/lib/merchantAttendanceTerminal";
import {attendanceManagementRequest} from "@/lib/merchantAttendanceManagementClient";
import {parsePinVerification} from "@/lib/merchantAttendancePin";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const base="https://www.faolla.com/api/merchant-enterprise/attendance/",token=terminalPairToken("99990001",id(7),"A".repeat(43));
const entitlement=async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}) as Awaited<ReturnType<typeof pinAdminDependencies.entitlement>>;
const request=(path:string,body:unknown,cookie=TERMINAL_COOKIE+"="+token)=>new Request(base+path,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"application/json",cookie},body:JSON.stringify(body)});
test("default gates, wrong verbs/origins and absence of device cookie reject before business work",async()=>{
  assert.equal((await handlePinAdmin(new Request(base+'pin-credentials'),{enabled:()=>false})).status,404);
  assert.equal((await handlePinVerify(request('terminal-pin',{workerNo:'PIN-01',pin:'01738264'}),{enabled:()=>false})).status,404);
  assert.equal((await handlePinVerify(new Request(base+'terminal-pin'),{enabled:()=>true})).status,405);
  const badOrigin=new Request('https://foreign.invalid/api/merchant-enterprise/attendance/terminal-pin',{method:'POST'});assert.equal((await handlePinVerify(badOrigin,{enabled:()=>true})).status,403);
  assert.equal((await handlePinVerify(request('terminal-pin',{workerNo:'PIN-01',pin:'01738264'},''),{enabled:()=>true})).status,403);
});
test("verification identity comes only from unique secure device cookie; body cannot supply authorization",async()=>{
  const calls:unknown[]=[];const deps={enabled:()=>true,allow:()=>true,entitlement,execute:async(i:unknown)=>{calls.push(i);return {verified:true as const,workerNo:'PIN-01',workerName:'Synthetic',clockEnabled:false as const};}};
  const good=await handlePinVerify(request('terminal-pin',{workerNo:'PIN-01',pin:'01738264'}),deps);assert.equal(good.status,200);assert.match(good.headers.get('cache-control')!,/no-store/);assert.equal(good.headers.get('set-cookie'),null);
  const {ok,moduleEnabled,...verified}=await attendanceManagementRequest(async()=>good,'/synthetic');assert.equal(ok,true);assert.equal(moduleEnabled,true);assert.equal(parsePinVerification(verified).verified,true);
  assert.deepEqual(calls,[{siteId:'99990001',terminalId:id(7),secret:'A'.repeat(43),workerNo:'PIN-01',pin:'01738264',allowVerify:true}]);
  for(const extra of [{verified:true},{authUserId:id(99)},{siteId:'99990002'},{workerId:id(2)},{action:'clock_in'}])assert.equal((await handlePinVerify(request('terminal-pin',{workerNo:'PIN-01',pin:'01738264',...extra}),deps)).status,400);
  assert.equal((await handlePinVerify(request('terminal-pin',{workerNo:'PIN-01',pin:'01738264'},`${TERMINAL_COOKIE}=${token}; ${TERMINAL_COOKIE}=${token}`),deps)).status,403);assert.equal(calls.length,1);
});
test("owner credential route blocks recovery/invite authentication and binds authenticated principal",async()=>{
  const req=new Request(base+'pin-credentials?siteId=99990001&workerNo=PIN-01');let calls=0;
  const deps={enabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:id(99)} as User,authenticationMethods:['recovery'],accessToken:'synthetic'}),entitlement,execute:async()=>{calls++;throw Error('should not execute');}};
  assert.equal((await handlePinAdmin(req,deps)).status,403);assert.equal(calls,0);
});
