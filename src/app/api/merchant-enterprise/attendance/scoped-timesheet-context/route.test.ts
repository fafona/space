import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleAttendanceScopedContext as handle,attendanceScopedContextDependencies as defaults} from "./route-handler";
import {scopedContextFixture,scopedActor} from "../../../../../../scripts/fixtures/attendance-scoped-timesheet-client-model";
import {parseScopedContext} from "@/lib/merchantAttendanceScopedTimesheetContext";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {executeScopedContext} from "@/lib/merchantAttendanceScopedTimesheetContext.server";
const url="https://www.faolla.com/api/merchant-enterprise/attendance/scoped-timesheet-context?siteId=99990009&access=manager";
function setup(){
  const calls:Parameters<typeof defaults.execute>[0][]=[];
  const deps:typeof defaults={enabled:()=>true,accessEnabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id:scopedActor("manager")} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute:async input=>{calls.push(input);return parseScopedContext(scopedContextFixture(input.query),input.query);}};
  return {deps,calls};
}
test("context default and access gates, method and origin reject before authentication",async()=>{
  const {deps,calls}=setup();let auth=0;deps.authenticate=async()=>{auth++;throw Error("no");};
  deps.enabled=()=>false;assert.equal((await handle(new Request(url),deps)).status,404);deps.enabled=()=>true;deps.accessEnabled=()=>false;assert.equal((await handle(new Request(url),deps)).status,404);deps.accessEnabled=()=>true;
  for(const request of [new Request(url,{method:"POST"}),new Request(url,{headers:{origin:"https://other.invalid"}}),new Request(url,{headers:{"sec-fetch-site":"cross-site"}}),new Request(url.replace("www.","merchant."))])assert([403,405].includes((await handle(request,deps)).status));
  assert.equal(auth,0);assert.equal(calls.length,0);
});
test("scoped context is password-only, current principal and paused read-only response",async()=>{
  const {deps,calls}=setup();const response=await handle(new Request(url),deps);assert.equal(response.status,200);assert.equal((await response.json()).moduleEnabled,false);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(calls[0].authUserId,scopedActor("manager"));
  for(const methods of [[],["oauth"],["invite"],["recovery"],["password","recovery"]]){deps.authenticate=async()=>({user:{id:scopedActor("manager")} as User,accessToken:"synthetic",authenticationMethods:methods});assert.equal((await handle(new Request(url),deps)).status,403);}
  assert.equal(calls.length,1);
});
test("invalid cursor and caller identities never execute, stale version and rate limit have no data",async()=>{
  const {deps,calls}=setup();for(const suffix of ["&workerId=x","&authUserId=x","&scopeRevision=1","&cursor=x","&search=x&search=y"])assert.equal((await handle(new Request(url+suffix),deps)).status,400);assert.equal(calls.length,0);
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_version_conflict");};const stale=await handle(new Request(url),deps);assert.equal(stale.status,409);assert.deepEqual(await stale.json(),{ok:false,error:"attendance_version_conflict"});
  deps.allow=()=>false;const limited=await handle(new Request(url),deps);assert.equal(limited.status,429);assert.equal(limited.headers.get("retry-after"),"60");
});
test("context adapter calls only dedicated scoped RPC and masks invalid data / private errors",async()=>{
  const q={siteId:"99990009",access:"manager" as const,search:"",cursor:null,scopeRevision:null},calls:unknown[]=[];
  const result=await executeScopedContext({query:q,authUserId:scopedActor("manager")},{rpc:async(name,args)=>{calls.push({name,args});return {data:scopedContextFixture(q),error:null};}});
  assert.equal(result.items.length,25);assert.deepEqual(calls,[{name:"faolla_attendance_scoped_report_context_v1",args:{p_site_id:q.siteId,p_auth_user_id:scopedActor("manager"),p_query:{access:q.access,search:"",cursor:null,scopeRevision:null}}}]);
  for(const data of [null,{...scopedContextFixture(q),scopeRevision:0}])await assert.rejects(()=>executeScopedContext({query:q,authUserId:scopedActor("manager")},{rpc:async()=>({data,error:null})}),/attendance_unavailable/);
  await assert.rejects(()=>executeScopedContext({query:q,authUserId:scopedActor("manager")},{rpc:async()=>({data:null,error:{message:"private sql"}})}),/attendance_unavailable/);
});
