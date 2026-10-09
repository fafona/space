import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleAttendanceScopedTimesheet as handle,attendanceScopedTimesheetDependencies as defaults} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {attendanceScopedTimesheetQueryString,parseAttendanceScopedTimesheetResult} from "@/lib/merchantAttendanceScopedTimesheet";
import {scopedSelfQuery as self,scopedManagerQuery as manager,scopedSheetWire} from "../../../../../../scripts/fixtures/attendance-scoped-timesheet-model";
import {timesheetOwner} from "../../../../../../scripts/fixtures/attendance-timesheet-model";
const url=(q=self)=>`https://www.faolla.com/api/merchant-enterprise/attendance/scoped-timesheet?${attendanceScopedTimesheetQueryString(q)}`;
function setup(extra:Partial<typeof defaults>={}){
  const calls:Parameters<typeof defaults.execute>[0][]=[];
  const deps:typeof defaults={enabled:()=>true,accessEnabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id:timesheetOwner} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute:async input=>{calls.push(input);return parseAttendanceScopedTimesheetResult(scopedSheetWire(input.query.access),input.query);},...extra};return {deps,calls};
}
test("default-off, explicit access gate, GET-only and origin/Fetch-Metadata restrictions precede auth",async()=>{
  let authenticated=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{authenticated=true;throw Error("should not run");}});
  assert.equal((await handle(new Request(url()),deps)).status,404);deps.enabled=()=>true;deps.accessEnabled=()=>false;assert.equal((await handle(new Request(url()),deps)).status,404);deps.accessEnabled=()=>true;
  for(const method of ["POST","PATCH","DELETE"])assert.equal((await handle(new Request(url(),{method}),deps)).status,405);
  for(const request of [new Request(url().replace("www.","merchant.")),new Request(url(),{headers:{origin:"https://evil.invalid"}}),new Request(url(),{headers:{"sec-fetch-site":"cross-site"}})])assert.equal((await handle(request,deps)).status,403);
  assert.equal(authenticated,false);
});
test("employees/managers require password authentication, not OAuth/recovery/invitation",async()=>{
  for(const q of [self,manager])for(const methods of [[],["oauth"],["invite"],["magiclink"],["recovery"],["password","recovery"]]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id:timesheetOwner} as User,accessToken:"synthetic",authenticationMethods:methods})});
    assert.equal((await handle(new Request(url(q)),deps)).status,403);assert.equal(calls.length,0);
  }
});
test("scope selection is not authority, only server principal reaches RPC, paused history allowed",async()=>{
  for(const q of [self,manager]){const {deps,calls}=setup();const r=await handle(new Request(url(q)),deps);assert.equal(r.status,200);assert.deepEqual(calls,[{query:q,authUserId:timesheetOwner}]);
    assert.equal(r.headers.get("cache-control"),"private, no-store");assert.equal(r.headers.get("x-content-type-options"),"nosniff");assert.match(r.headers.get("vary")!,/Cookie.*Authorization/);
    const body=await r.json();assert.equal(body.moduleEnabled,false);assert.equal(body.coverage,"authorized-complete-sessions-v1");assert.equal("employeeId" in body,false);
  }
});
test("forged identities, missing pair, duplicate filters and overlong range never execute",async()=>{
  const {deps,calls}=setup();for(const request of [url()+"&workerId=forged",url()+"&authUserId="+timesheetOwner,url()+"&scopeRevision=1",url()+"&access=manager",url().replace("2026-09-30","2026-10-02"),url(manager).replace(/&locationId=[^&]+/,"")])assert.equal((await handle(new Request(request),deps)).status,400);
  assert.equal(calls.length,0);
});
test("entitlement revoked on next read, rebind/rate limits and bounded errors clear result",async()=>{
  const {deps,calls}=setup();await handle(new Request(url()),deps);deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);};
  assert.equal((await handle(new Request(url()),deps)).status,403);assert.equal(calls.length,1);
  for(const [code,status] of [["attendance_worker_changed",409],["attendance_access_denied",403],["attendance_report_too_large",422]] as const){const r=await handle(new Request(url()),setup({execute:async()=>{throw new MerchantAttendanceError(code);}}).deps);assert.equal(r.status,status);assert.deepEqual(await r.json(),{ok:false,error:code});}
  const r=await handle(new Request(url()),setup({allow:()=>false}).deps);assert.equal(r.status,429);assert.equal(r.headers.get("retry-after"),"60");
  assert.deepEqual(await (await handle(new Request(url()),setup({execute:async()=>{throw Error("private SQL");}}).deps)).json(),{ok:false,error:"attendance_unavailable"});
});
test("common and existing self/records switches are all independently required",()=>{
  const keys=["FAOLLA_ATTENDANCE_TIMESHEET_ENABLED","FAOLLA_ATTENDANCE_SCOPED_TIMESHEET_ENABLED","FAOLLA_ATTENDANCE_SELF_ENABLED","FAOLLA_ATTENDANCE_RECORDS_ENABLED"],saved=keys.map(k=>process.env[k]);
  try{keys.forEach(k=>process.env[k]="1");assert(defaults.enabled());assert(defaults.accessEnabled("self"));assert(defaults.accessEnabled("manager"));
    for(const k of keys){delete process.env[k];if(k===keys[2]){assert.equal(defaults.accessEnabled("self"),false);assert(defaults.accessEnabled("manager"));}else if(k===keys[3]){assert.equal(defaults.accessEnabled("manager"),false);assert(defaults.accessEnabled("self"));}else assert.equal(defaults.enabled(),false);process.env[k]="1";}
  }finally{keys.forEach((k,n)=>{if(saved[n]===undefined)delete process.env[k];else process.env[k]=saved[n];});}
});
