import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleRevisionHistory as handle,revisionHistoryDependencies as defaults} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {revisionHistoryQueryString} from "@/lib/merchantAttendanceRevisionHistory";
import {historyOwnerQuery as ownerQ,historySelfQuery as selfQ,historyOwner,historyValue} from "../../../../../../scripts/fixtures/attendance-revision-history-model";
const url='https://www.faolla.com/api/merchant-enterprise/attendance/revision-history',get=(q=ownerQ)=>new Request(url+'?'+revisionHistoryQueryString(q));
function setup(extra:Partial<typeof defaults>={}){
  const calls:Parameters<typeof defaults.execute>[0][]=[];
  const deps:typeof defaults={enabled:()=>true,accessEnabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:historyOwner} as User,accessToken:'synthetic',authenticationMethods:['password']}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute:async input=>{calls.push(input);return historyValue(input.query);},...extra};return {deps,calls};
}
test('history flags, GET-only and canonical/same-origin guards precede authentication',async()=>{
  let authenticated=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{authenticated=true;throw Error('unreachable');}});assert.equal((await handle(get(),deps)).status,404);deps.enabled=()=>true;
  for(const method of ['POST','PUT','DELETE'])assert.equal((await handle(new Request(url,{method}),deps)).status,405);
  for(const r of [new Request(get().url.replace('www.','merchant.')),new Request(get().url,{headers:{origin:'https://other.invalid'}}),new Request(get().url,{headers:{'sec-fetch-site':'cross-site'}})])assert.equal((await handle(r,deps)).status,403);
  deps.accessEnabled=()=>false;assert.equal((await handle(get(),deps)).status,404);assert.equal(authenticated,false);
});
test('owner accepts full password/OAuth but self requires password; partial invitations/recovery never read history',async()=>{
  for(const q of [ownerQ,selfQ])for(const methods of [[],['password'],['oauth'],['invite'],['recovery'],['magiclink'],['password','recovery']]){
    const allowed=methods.length===1&&(methods[0]==='password'||q.access==='owner'&&methods[0]==='oauth'),s=setup({authenticate:async()=>({user:{id:historyOwner} as User,accessToken:'synthetic',authenticationMethods:methods})});
    const r=await handle(get(q),s.deps);assert.equal(r.status,allowed?200:403);assert.equal(s.calls.length,allowed?1:0);if(allowed)assert.deepEqual(s.calls[0],{query:q,authUserId:historyOwner});
  }
});
test('paused history is read-only/no-store and entitlement is rechecked before each service call',async()=>{
  const s=setup(),r=await handle(get(),s.deps);assert.equal(r.status,200);const v=await r.json();assert.equal(v.moduleEnabled,false);assert.equal(v.readOnly,true);
  assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('vary')!,/Cookie.*Authorization/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  s.deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError('enterprise_management_disabled',403);};assert.equal((await handle(get(),s.deps)).status,403);assert.equal(s.calls.length,1);
});
test('actor/approval/worker-scope injection and duplicate query cannot reach service',async()=>{
  const s=setup();for(const extra of ['&authUserId='+historyOwner,'&action=approve','&canApprove=true','&siteId='+ownerQ.siteId,'&expectedWorkerId='+historyOwner])assert.equal((await handle(new Request(get().url+extra),s.deps)).status,400);
  assert.equal((await handle(new Request(get(selfQ).url+'&employeeId='+historyOwner),s.deps)).status,400);assert.equal(s.calls.length,0);
});
test('history service errors and bounded rate limiter mask internal SQL details',async()=>{
  for(const [code,status] of [['attendance_worker_changed',409],['attendance_revision_base_not_found',404],['attendance_revision_history_too_large',422],['attendance_revision_history_invalid',503],['secret_table',503]] as const){
    const r=await handle(get(),setup({execute:async()=>{throw new MerchantAttendanceError(code);}}).deps);assert.equal(r.status,status);assert.equal((await r.json()).error,code==='secret_table'?'attendance_unavailable':code);
  }
  const r=await handle(get(),setup({allow:()=>false}).deps);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
});
test('history master flag and both existing workflow switch sets default closed independently',()=>{
  const owner=['ADMIN','CORRECTION_REVIEW','REVISION_REVIEW','REVISION_DECISIONS'],self=['SELF','CORRECTIONS','REVISION_REQUESTS','REVISION_CYCLES'],keys=['REVISION_HISTORY',...owner,...self].map(k=>'FAOLLA_ATTENDANCE_'+k+'_ENABLED'),saved=keys.map(k=>process.env[k]);
  try{keys.forEach(k=>process.env[k]='1');assert(defaults.enabled());for(const [access,list] of [['owner',owner],['self',self]] as const){assert(defaults.accessEnabled(access));for(const suffix of list){const key='FAOLLA_ATTENDANCE_'+suffix+'_ENABLED';delete process.env[key];assert(!defaults.accessEnabled(access));assert(defaults.accessEnabled(access==='owner'?'self':'owner'));process.env[key]='1';}}
    delete process.env.FAOLLA_ATTENDANCE_REVISION_HISTORY_ENABLED;assert(!defaults.enabled());
  }finally{keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
