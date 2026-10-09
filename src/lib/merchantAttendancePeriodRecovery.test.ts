import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {listKnownPeriodRecoveries,recoverKnownPeriod} from "./merchantAttendancePeriodRecovery";
import {listKnownAttendanceRecoveries,recoverKnownAttendance,type AttendanceRecoveryStorage} from "./merchantAttendanceRecovery";
import {periodDelegationPendingKey} from "./merchantAttendancePeriodDelegationClient";
import {periodDelegatedClosurePendingKey} from "./merchantAttendancePeriodDelegatedClosureClient";
import {periodDelegationCommandFingerprint,parsePeriodDelegationHttpQuery} from "./merchantAttendancePeriodDelegation";
import {periodDelegatedClosureFingerprintText,parsePeriodDelegatedClosureHttpQuery,type PeriodDelegatedClosureQuery,type PeriodDelegatedClosureCommand} from "./merchantAttendancePeriodDelegatedClosure";
const id=(n:number)=>`60000000-0000-4000-8000-${String(n).padStart(12,"0")}`,auth=id(1),siteId="99990001",stamp="2026-10-08T10:00:00.000001Z";
const current=()=>true;
async function fixture(){
  const values=new Map<string,string>(),storage:AttendanceRecoveryStorage={get length(){return values.size;},key:n=>[...values.keys()][n]??null,
    getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);}};
  const query={siteId,access:"owner" as const,mode:"detail" as const,catalog:null,grantId:id(8),afterId:null,operationId:null};
  const command={action:"revoke" as const,operationId:id(9),grantId:id(8),expectedRevision:1 as const,reason:"Synthetic only"};
  const fingerprint=await periodDelegationCommandFingerprint(query,command),grantKey=periodDelegationPendingKey(siteId,"owner",auth);
  storage.setItem(grantKey,JSON.stringify({version:1,anchorId:auth,actorId:auth,employeeId:null,query,command,commandFingerprint:fingerprint},null,2));
  const scope={siteId,actorEmployeeId:id(2),expectedAuthUserId:auth,grantId:id(18),workerId:id(3),targetEmployeeId:id(4),targetAuthUserId:id(5),authorizedFromDate:"2026-09-01",authorizedThroughDate:"2026-09-30"};
  const q:PeriodDelegatedClosureQuery={siteId,access:"delegate",grantId:scope.grantId,workerId:scope.workerId,fromDate:"2026-09-02",throughDate:"2026-09-03",mode:"detail",periodId:id(6),operationId:null,version:null,cursor:null};
  const c:PeriodDelegatedClosureCommand={action:"respond",operationId:id(7),periodId:id(6),expectedRevision:2,expectedVersion:1,expectedFingerprint:null,reason:"Synthetic reply"};
  const hash=createHash("sha256").update(periodDelegatedClosureFingerprintText(q,c)).digest("hex"),closureKey=periodDelegatedClosurePendingKey(scope);
  storage.setItem(closureKey,JSON.stringify({format:1,scope,query:q,command:c,commandFingerprint:hash},null,2));
  const receipt=(kind:string)=>kind==="period-closure"?{operationId:c.operationId,action:c.action,grantId:scope.grantId,grantRevision:1,periodId:c.periodId,periodRevision:3,actorId:auth,recordedAt:stamp,commandFingerprint:hash}
    :{operationId:command.operationId,action:command.action,grantId:command.grantId,grantRevision:2,periodId:null,periodRevision:null,actorId:auth,recordedAt:stamp,commandFingerprint:fingerprint};
  const response=(kind:string,r:unknown=receipt(kind))=>kind==="period-closure"?{ok:true,moduleEnabled:false,data:{protocol:"period-delegated-closure-v1",siteId,workerId:scope.workerId,grantId:scope.grantId,actorId:auth,employeeId:scope.actorEmployeeId,access:"delegate",readAt:stamp,usableActions:[],kind:"receipt",receipt:r}}
    :{ok:true,protocol:"period-delegation-v1",siteId,access:"owner",actorId:auth,employeeId:null,mode:"recover",canWrite:false,grants:[],catalogItems:[],nextAfterId:null,detail:null,receipt:r,readAt:stamp};
  return {values,storage,grantKey,closureKey,scope,q,c,response,receipt};
}
test("aggregate recognizes both bounded local period formats without disclosing target or reasons",async()=>{
  const f=await fixture(),before=[...f.values];const r=await listKnownAttendanceRecoveries(f.storage,auth,current);
  assert.deepEqual(r.entries.map(x=>x.kind).sort(),["period-closure","period-delegation"]);assert.equal(r.invalid,false);
  assert.doesNotMatch(JSON.stringify(r),/reason|workerId|targetEmployee|targetAuth|Synthetic/);assert.deepEqual([...f.values],before);
  assert.equal((await listKnownPeriodRecoveries(f.storage,id(99),current)).entries.length,0);
});
test("each format only exact GET recovers with feature off; CAS clears only its own bytes",async()=>{
  const f=await fixture(),entries=(await listKnownAttendanceRecoveries(f.storage,auth,current)).entries;let gets=0;
  for(const entry of entries){const r=await recoverKnownAttendance(entry,{authenticatedUserId:auth,storage:f.storage,isCurrentAuth:current,signal:new AbortController().signal,
    apiFetch:async(path,init)=>{gets++;assert.equal(init?.method,"GET");assert.equal(init?.body,undefined);
      const q=entry.kind==="period-closure"?parsePeriodDelegatedClosureHttpQuery("https://example.test"+path):parsePeriodDelegationHttpQuery("https://example.test"+path);
      assert.equal(q.mode,"recover");assert.equal(q.operationId,entry.operationId);return Response.json(f.response(entry.kind));}});
    assert.equal(r?.kind,entry.kind);assert.equal(r?.actorId,auth);assert.equal(f.storage.getItem(entry.storageKey),null);assert.doesNotMatch(JSON.stringify(r),/command|reason|workerId|targetAuth/);
  }assert.equal(gets,2);assert.equal(f.values.size,0);
});
test("malformed SHA, swapped complete scope and renamed slots are preserved and never offered",async()=>{
  for(const change of [(p:Record<string,unknown>)=>({...p,commandFingerprint:"f".repeat(64)}),(p:Record<string,unknown>)=>({...p,scope:{...p.scope as object,targetAuthUserId:id(999)}})]){
    const f=await fixture();f.storage.setItem(f.closureKey,JSON.stringify(change(JSON.parse(f.storage.getItem(f.closureKey)!))));const before=[...f.values];
    const r=await listKnownPeriodRecoveries(f.storage,auth,current);assert.equal(r.invalid,true);assert.deepEqual(r.entries.map(x=>x.kind),["period-delegation"]);assert.deepEqual([...f.values],before);
  }
});
test("null, wrong SHA, wrong actor and broken responses retain exact original pending bytes",async()=>{
  for(const variant of ["null","sha","actor","broken"]){const f=await fixture(),entry=(await listKnownPeriodRecoveries(f.storage,auth,current)).entries[1],raw=f.storage.getItem(entry.storageKey);let gets=0;
    const r=await recoverKnownPeriod(entry,{authenticatedUserId:auth,storage:f.storage,isCurrentAuth:current,signal:new AbortController().signal,apiFetch:async()=>{gets++;
      if(variant==="broken")return new Response('{"ok":',{headers:{"content-type":"application/json"}});
      const receipt=variant==="null"?null:{...f.receipt(entry.kind),...(variant==="sha"?{commandFingerprint:"0".repeat(64)}:{actorId:id(999)})};return Response.json(f.response(entry.kind,receipt));}});
    assert.equal(r,null);assert.equal(gets,1);assert.equal(f.storage.getItem(entry.storageKey),raw);
  }
});
test("concurrent replacement or changed Auth cannot clear or return old receipt",async()=>{
  for(const mode of ["storage","auth"]){const f=await fixture(),entry=(await listKnownPeriodRecoveries(f.storage,auth,current)).entries[1];let live=true;
    const r=recoverKnownPeriod(entry,{authenticatedUserId:auth,storage:f.storage,isCurrentAuth:()=>live,signal:new AbortController().signal,apiFetch:async()=>{
      if(mode==="storage")f.storage.setItem(entry.storageKey,"changed but preserved");else live=false;return Response.json(f.response(entry.kind));}});
    if(mode==="auth")await assert.rejects(r,/recovery_scope_changed/);else assert.equal(await r,null);
    assert(f.storage.getItem(entry.storageKey));
  }
});
test("already aborted recovery and forged descriptors send zero requests",async()=>{
  const f=await fixture(),entry=(await listKnownPeriodRecoveries(f.storage,auth,current)).entries[1],abort=new AbortController();abort.abort();let calls=0;
  const options={authenticatedUserId:auth,storage:f.storage,isCurrentAuth:current,signal:abort.signal,apiFetch:async()=>{calls++;throw Error("no");}};
  await assert.rejects(recoverKnownPeriod(entry,options));await assert.rejects(recoverKnownPeriod({...entry,operationId:id(99)},{...options,signal:new AbortController().signal}));assert.equal(calls,0);assert.equal(f.values.size,2);
});
test("abort ends a hanging digest without a late scan or network effect",async()=>{
  const f=await fixture(),abort=new AbortController(),original=crypto.subtle.digest;
  let release!:(v:ArrayBuffer)=>void;crypto.subtle.digest=(()=>new Promise<ArrayBuffer>(resolve=>{release=resolve;})) as typeof original;
  try{const scanning=listKnownPeriodRecoveries(f.storage,auth,current,abort.signal);await new Promise(resolve=>setTimeout(resolve,10));abort.abort();await assert.rejects(scanning,/recovery_scope_changed/);
    release(new Uint8Array(32).buffer);await Promise.resolve();assert.equal(f.values.size,2);
  }finally{crypto.subtle.digest=original;}
});
test("both new formats share the aggregate64-slot budget",async()=>{
  const f=await fixture();for(let i=0;i<63;i++)f.storage.setItem(`faolla:attendance:period-delegation:v1:malformed${i}`,"{}");
  await assert.rejects(listKnownAttendanceRecoveries(f.storage,auth,current),/recovery_storage_limit/);
});
