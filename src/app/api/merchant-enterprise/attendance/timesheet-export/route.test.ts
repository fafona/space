import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleTimesheetExport as handle,timesheetExportDependencies as defaults} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {timesheetExportCommand as cmd,timesheetExportWire as wire} from "../../../../../../scripts/fixtures/attendance-timesheet-export-model";
import {timesheetId as id} from "../../../../../../scripts/fixtures/attendance-timesheet-model";
const url="https://www.faolla.com/api/merchant-enterprise/attendance/timesheet-export";
const request=(body:unknown=cmd(),headers:Record<string,string>={},method="POST",target=url)=>new Request(target,{method,headers:{origin:"https://www.faolla.com","content-type":"application/json",...headers},...(method==="GET"?{}:{body:typeof body==="string"?body:JSON.stringify(body)})});
function setup(extra:Partial<typeof defaults>={}){
  const calls:Parameters<typeof defaults.execute>[0][]=[];
  const deps:typeof defaults={enabled:()=>true,accessEnabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id:id(1)} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute:async input=>{calls.push(input);return {receipt:wire(input.command).receipt,replayed:true,csv:null,filename:null,viewerEmployeeId:null,accessValidUntil:null};},...extra};return {deps,calls};
}
test("timesheet export is default-off, POST-only, canonical same-origin and bounded before execution",async()=>{
  let auth=0;const {deps,calls}=setup({authenticate:async()=>{auth++;throw Error("unexpected");},enabled:()=>false});
  assert.equal((await handle(request(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handle(request({}, {},"GET"),deps)).status,405);
  for(const headers of [{origin:"https://evil.invalid"},{origin:""},{"sec-fetch-site":"cross-site"}] as Record<string,string>[])assert.equal((await handle(request(cmd(),headers),deps)).status,403);
  assert.equal((await handle(request(cmd(),{},"POST",url.replace("www.","merchant.")),deps)).status,403);assert.equal(auth,0);assert.equal(calls.length,0);
  const ok=setup();for(const [r,status] of [[request(cmd(),{},"POST",url+"?authUserId="+id(1)),400],[request({...cmd(),authUserId:id(9)}),400],[request(cmd(),{"content-type":"text/plain"}),415],[request(" ".repeat(8193)),413],[request("{"),400]] as const)assert.equal((await handle(r,ok.deps)).status,status);
  assert.equal(ok.calls.length,0);
});
test("owner requires full authentication and scoped exports require password; caller identity comes from auth",async()=>{
  for(const access of ["owner","self","manager"] as const)for(const methods of [[],["recovery"],["password","invite"],...(access==="owner"?[]:[["oauth"]])]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id:id(1)} as User,accessToken:"synthetic",authenticationMethods:methods})});
    assert.equal((await handle(request(cmd(access)),deps)).status,403);assert.equal(calls.length,0);
  }
  for(const access of ["owner","self","manager"] as const){const {deps,calls}=setup();const r=await handle(request(cmd(access)),deps);assert.equal(r.status,200);assert.deepEqual(calls,[{command:cmd(access),authUserId:id(1)}]);
    assert.equal((await r.json()).moduleEnabled,false);assert.equal(r.headers.get("cache-control"),"private, no-store");assert.equal(r.headers.get("x-content-type-options"),"nosniff");}
});
test("every export checks enterprise entitlement and access switch, rate/errors expose no source",async()=>{
  const disabled=setup({accessEnabled:()=>false});assert.equal((await handle(request(),disabled.deps)).status,404);assert.equal(disabled.calls.length,0);
  const revoked=setup({entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}});assert.equal((await handle(request(),revoked.deps)).status,403);assert.equal(revoked.calls.length,0);
  const limited=await handle(request(),setup({allow:()=>false}).deps);assert.equal(limited.status,429);assert.equal(limited.headers.get("retry-after"),"60");
  for(const [code,status] of [["attendance_export_denied",403],["attendance_operation_conflict",409],["attendance_report_zone_changed",409],["attendance_version_conflict",409],["attendance_report_too_large",422],["private SQL",503]] as const){
    const response=await handle(request(),setup({execute:async()=>{throw new MerchantAttendanceError(code);}}).deps);assert.equal(response.status,status);assert.deepEqual(await response.json(),{ok:false,error:status===503?"attendance_unavailable":code});
  }
});
test("new export flag does not enable old read routes or bypass access feature switches",()=>{
  const keys=["FAOLLA_ATTENDANCE_TIMESHEET_EXPORT_ENABLED","FAOLLA_ATTENDANCE_TIMESHEET_ENABLED","FAOLLA_ATTENDANCE_ADMIN_ENABLED","FAOLLA_ATTENDANCE_SCOPED_TIMESHEET_ENABLED","FAOLLA_ATTENDANCE_SELF_ENABLED","FAOLLA_ATTENDANCE_RECORDS_ENABLED"],saved=keys.map(k=>process.env[k]);
  try{keys.forEach(k=>process.env[k]="1");assert(defaults.enabled());for(const access of ["owner","self","manager"] as const)assert(defaults.accessEnabled(access));
    for(const [n,access] of [[2,"owner"],[4,"self"],[5,"manager"]] as const){delete process.env[keys[n]];assert.equal(defaults.accessEnabled(access),false);process.env[keys[n]]="1";}
    delete process.env[keys[3]];assert(!defaults.accessEnabled("self"));assert(!defaults.accessEnabled("manager"));assert(defaults.accessEnabled("owner"));
    for(const n of [0,1]){delete process.env[keys[n]];assert(!defaults.enabled());process.env[keys[n]]="1";}
  }finally{keys.forEach((k,n)=>{if(saved[n]===undefined)delete process.env[k];else process.env[k]=saved[n];});}
});
