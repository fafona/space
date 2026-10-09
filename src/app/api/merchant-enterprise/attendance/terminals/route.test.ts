import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleTerminalAdmin, terminalAdminDependencies } from "./route-handler";
import { handleTerminalDevice, terminalDeviceDependencies } from "../terminal-device/route-handler";
import { TERMINAL_API, TERMINAL_DEVICE_API, TERMINAL_COOKIE, type TerminalDevice } from "@/lib/merchantAttendanceTerminal";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
const origin="https://www.faolla.com",id="00000000-0000-4000-8000-000000000001",siteId="99990001",secret="A".repeat(43),deviceSecret="B".repeat(42)+"A";
const token=`${siteId}.${id}.${secret}`,deviceToken=`${siteId}.${id}.${deviceSecret}`;
const body={siteId,command:{action:"create",terminalId:id,locationId:id,label:"Front",pairSecret:secret}};
const request=(path:string,value?:unknown,headers:Record<string,string>={})=>new Request(origin+path,{method:value===undefined?"GET":"POST",headers:{"Content-Type":"application/json",origin,...headers},body:value===undefined?undefined:JSON.stringify(value)});
const entitlement=async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}) as Awaited<ReturnType<typeof terminalAdminDependencies.entitlement>>;
const active:TerminalDevice={siteId,clockEnabled:false,attendanceEnabled:false,terminal:{id,label:"Front",locationId:id,locationName:"Shop",timeZone:"UTC",state:"active",
  createdAt:"2026-10-01T10:00:00.000000Z",pairExpiresAt:"2026-10-01T10:05:00.000000Z",pairedAt:"2026-10-01T10:01:00.000000Z",deviceExpiresAt:"2026-10-31T10:01:00.000000Z",revokedAt:null}};
function admin(extra:Partial<typeof terminalAdminDependencies>={}){return {enabled:()=>true,authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["oauth"]}),entitlement,allow:()=>true,
  execute:async()=>({siteId,items:[],nextCursor:null}),...extra};}
function device(extra:Partial<typeof terminalDeviceDependencies>={}){return {enabled:()=>true,entitlement,allow:()=>true,secret:()=>deviceSecret,execute:async()=>active,...extra};}
test("terminal admin/device default gate denies before any credentials or writes",async()=>{
  for(const r of [await handleTerminalAdmin(request(TERMINAL_API),admin({enabled:()=>false})),await handleTerminalDevice(request(TERMINAL_DEVICE_API),device({enabled:()=>false}))]){
    assert.equal(r.status,404);assert.equal(r.headers.get("cache-control"),"private, no-store");assert.equal(r.headers.get("set-cookie"),null);
  }
});
test("terminal admin checks trusted origin, safe owner session and bounded JSON",async()=>{
  assert.equal((await handleTerminalAdmin(request(TERMINAL_API,body,{origin:"https://evil.example"}),admin())).status,403);
  for(const authenticationMethods of [[],["recovery"],["magiclink"],["password","invite"]])assert.equal((await handleTerminalAdmin(request(TERMINAL_API,body),admin({authenticate:async()=>({user:{id} as User,accessToken:"test",authenticationMethods})}))).status,403);
  assert.equal((await handleTerminalAdmin(request(TERMINAL_API,{...body,padding:"x".repeat(4200)}),admin())).status,413);
  assert.equal((await handleTerminalAdmin(request(TERMINAL_API+"?token=secret",body),admin())).status,400);
});
test("paused module is passed to SQL; owner identity comes only from validated session",async()=>{
  let passed=false;const r=await handleTerminalAdmin(request(TERMINAL_API,body),admin({entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof entitlement>>,
    execute:async(input)=>{assert.equal(input.authUserId,id);assert.equal(input.allowCreate,false);passed=true;return {siteId,items:[],nextCursor:null};}}));assert.equal(r.status,200);assert(passed);
});
test("device pair sets a host-only HttpOnly Secure Strict cookie, never returns its key in JSON",async()=>{
  const r=await handleTerminalDevice(request(TERMINAL_DEVICE_API,{action:"pair",token}),device({execute:async input=>{
    assert.equal(input.secret,secret);assert.equal(input.deviceSecret,deviceSecret);assert.equal(input.allowPair,true);return active;
  }}));assert.equal(r.status,200);const cookie=r.headers.get("set-cookie")??"";
  for(const value of [TERMINAL_COOKIE,deviceToken,"HttpOnly","Secure","SameSite=strict","Path=/","Max-Age=2592000"])assert(cookie.includes(value),value);
  assert(!cookie.includes("Domain="));const text=await r.text();assert(!text.includes(secret));assert(!text.includes(deviceSecret));assert(!text.includes("accessToken"));
});
test("device GET uses only device cookie and never owner auth or query credential",async()=>{
  let called=0;const deps=device({execute:async input=>{called++;assert.equal(input.secret,deviceSecret);assert.equal(input.deviceSecret,null);return active;}});
  const r=await handleTerminalDevice(request(TERMINAL_DEVICE_API,undefined,{cookie:`${TERMINAL_COOKIE}=${deviceToken}`,authorization:"Bearer owner-session"}),deps);
  assert.equal(r.status,200);assert.equal(r.headers.get("set-cookie"),null);
  assert.equal((await handleTerminalDevice(request(TERMINAL_DEVICE_API+"?token="+token),deps)).status,400);
  const unpaired=await handleTerminalDevice(request(TERMINAL_DEVICE_API,undefined,{authorization:"Bearer owner-session"}),deps);assert.equal((await unpaired.json()).paired,false);assert.equal(called,1);
});
test("device pair rejects cookie replacement, duplicates, cross-origin and failed RPC without issuing cookie",async()=>{
  const checks=[request(TERMINAL_DEVICE_API,{action:"pair",token},{cookie:`${TERMINAL_COOKIE}=${deviceToken}`}),
    request(TERMINAL_DEVICE_API,undefined,{cookie:`${TERMINAL_COOKIE}=${deviceToken}; ${TERMINAL_COOKIE}=${deviceToken}`}),
    request(TERMINAL_DEVICE_API,{action:"pair",token},{origin:"https://evil.example"}),request(TERMINAL_DEVICE_API,{action:"pair",token:"bad"})];
  for(const r of checks){const response=await handleTerminalDevice(r,device({execute:async()=>{throw Error("must not call");}}));assert(response.status>=400);assert.equal(response.headers.get("set-cookie"),null);}
  const denied=await handleTerminalDevice(request(TERMINAL_DEVICE_API,{action:"pair",token}),device({execute:async()=>{throw new MerchantAttendanceError("attendance_terminal_denied");}}));assert.equal(denied.status,403);assert.equal(denied.headers.get("set-cookie"),null);
});
test("clearing browser cookie is CSRF checked, does not invoke DB or require owner login",async()=>{
  const deps=device({execute:async()=>{throw Error("no write");},entitlement:async()=>{throw Error("no entitlement needed");}});
  const r=await handleTerminalDevice(request(TERMINAL_DEVICE_API,{action:"clear"}),deps);assert.equal(r.status,200);assert.match(r.headers.get("set-cookie")??"",/Max-Age=0/);
  assert.equal((await handleTerminalDevice(request(TERMINAL_DEVICE_API,{action:"clear"},{origin:"https://evil.example"}),deps)).status,403);
});
