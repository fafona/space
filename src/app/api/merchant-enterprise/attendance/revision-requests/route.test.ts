import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleAttendanceRevision as handle,attendanceRevisionDependencies as defaults} from "./route-handler";
import {attendanceRevisionQueryString} from "@/lib/merchantAttendanceRevision";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {revisionQuery as q,revisionCommand as c,revisionWithdrawal as w} from "../../../../../../scripts/fixtures/attendance-revision-model";
import {correctionId as id} from "../../../../../../scripts/fixtures/attendance-correction-model";
import {wire as cycleWire} from "../../../../../../scripts/fixtures/attendance-revision-cycle-model";
const url="https://www.faolla.com/api/merchant-enterprise/attendance/revision-requests",get=()=>new Request(url+"?"+attendanceRevisionQueryString(q));
const currentCommand={...c,expectedEffectiveOperationId:c.expectedBaseOperationId};
const body=(command:unknown=currentCommand)=>({siteId:q.siteId,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,command});
const post=(value:unknown=body(),headers:Record<string,string>={},target=url)=>new Request(target,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"application/json",...headers},body:typeof value==="string"?value:JSON.stringify(value)});
function setup(extra:Partial<typeof defaults>={}){
  const calls:Parameters<typeof defaults.execute>[0][]=[];
  const deps:typeof defaults={enabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:id(77)} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute:async input=>{calls.push(input);const r=cycleWire(input.command?.action==="submit"?"submitted":input.command?.action==="withdraw"?"withdrawn":"prepare",true);r.canSubmit=false;return r;},...extra};return {deps,calls};
}
test("revision routes default off, reject forbidden methods and cross-origin mutations/reads before authentication",async()=>{
  let auth=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{auth=true;throw Error("unexpected");}});assert.equal((await handle(get(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handle(new Request(url,{method:"DELETE"}),deps)).status,405);
  for(const r of [post(body(),{origin:"https://evil.invalid"}),post(body(),{origin:""}),post(body(),{},url.replace("www.","merchant.")),new Request(get(),{headers:{origin:"https://evil.invalid"}}),new Request(get(),{headers:{"sec-fetch-site":"cross-site"}})])assert.equal((await handle(r,deps)).status,403);
  assert.equal(auth,false);
});
test("only password-authenticated employee identity enters the new service and enterprise qualification is fresh",async()=>{
  for(const methods of [[],["oauth"],["invite"],["magiclink"],["recovery"],["password","recovery"]]){const {deps,calls}=setup({authenticate:async()=>({user:{id:id(77)} as User,accessToken:"synthetic",authenticationMethods:methods})});assert.equal((await handle(post(),deps)).status,403);assert.equal(calls.length,0);}
  const {deps,calls}=setup();assert.equal((await handle(get(),deps)).status,200);assert.equal(calls[0].authUserId,id(77));
  deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);};assert.equal((await handle(get(),deps)).status,403);assert.equal(calls.length,1);
});
test("POST derives request from command, bounds body, never trusts caller actor or enables paused collection",async()=>{
  const {deps,calls}=setup();for(const command of [currentCommand,w]){const r=await handle(post(body(command)),deps);assert.equal(r.status,200);const latest=calls.at(-1)!;assert.equal(latest.query.requestId,command.action==="submit"?command.operationId:command.requestId);assert.equal(latest.moduleEnabled,false);assert.deepEqual(latest.command,command);
    assert.equal(r.headers.get("cache-control"),"private, no-store");assert.equal(r.headers.get("x-content-type-options"),"nosniff");assert.equal((await r.json()).effectiveChanged,false);}
  for(const [request,status] of [[post({...body(),authUserId:id(9)}),400],[post(body(),{"content-type":"text/plain"}),415],[post(" ".repeat(8193)),413],[post("{"),400],[post(body(),{},url+"?operationId="+c.operationId),400]] as const)assert.equal((await handle(request,deps)).status,status);
  assert.equal((await handle(post(body(c)),deps)).status,400);assert.equal(calls.length,2);
});
test("bounded errors expose no application data and rate guard adds retry-after",async()=>{
  for(const [code,status] of [["attendance_revision_base_not_found",404],["attendance_revision_base_changed",409],["attendance_revision_unchanged",409],["attendance_report_version_required",409],["attendance_correction_period_locked",409],["attendance_correction_window_expired",409],["attendance_access_denied",403],["attendance_revision_too_large",422],["private SQL",503]] as const){const response=await handle(post(),setup({execute:async()=>{throw new MerchantAttendanceError(code);}}).deps);assert.equal(response.status,status);assert.deepEqual(await response.json(),{ok:false,error:status===503?"attendance_unavailable":code});}
  const r=await handle(post(),setup({allow:()=>false}).deps);assert.equal(r.status,429);assert.equal(r.headers.get("retry-after"),"60");
});
test("new revision request, correction and self switches are all required",()=>{
  const keys=["FAOLLA_ATTENDANCE_REVISION_REQUESTS_ENABLED","FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED","FAOLLA_ATTENDANCE_SELF_ENABLED","FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED"],saved=keys.map(k=>process.env[k]);
  try{keys.forEach(k=>process.env[k]="1");assert(defaults.enabled());for(const k of keys){delete process.env[k];assert(!defaults.enabled());process.env[k]="1";}}
  finally{keys.forEach((k,n)=>{if(saved[n]===undefined)delete process.env[k];else process.env[k]=saved[n];});}
});
