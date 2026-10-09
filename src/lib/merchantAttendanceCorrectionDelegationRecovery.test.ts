import assert from "node:assert/strict";
import test from "node:test";
import {listKnownCorrectionDelegationRecoveries,recoverKnownCorrectionDelegation} from "./merchantAttendanceCorrectionDelegationRecovery";
import {listKnownAttendanceRecoveries,recoverKnownAttendance,type AttendanceRecoveryStorage} from "./merchantAttendanceRecovery";
import {correctionDelegationPendingKey} from "./merchantAttendanceCorrectionDelegationClient";
import {correctionDelegationCommandFingerprint,parseCorrectionDelegationHttpQuery,type CorrectionDelegationAccess} from "./merchantAttendanceCorrectionDelegation";
import {correctionDelegationId as id,correctionDelegationQuery as query,correctionDelegationCommand as command,correctionDelegationGrantCommand,
  correctionDelegationReceiptHttp,correctionDelegationWire,correctionDelegationOwner as owner,correctionDelegationAuth as auth,correctionDelegationEmployee as employee} from "./merchantAttendanceCorrectionDelegationTestFixtures";
const current=()=>true;
async function fixture(access:CorrectionDelegationAccess="delegate"){
  const values=new Map<string,string>(),storage:AttendanceRecoveryStorage={get length(){return values.size;},key:n=>[...values.keys()][n]??null,
    getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);}};
  const q=query(access,access==="owner"?"list":"decide"),c=access==="owner"?correctionDelegationGrantCommand():command(),actor=access==="owner"?owner:auth,anchor=access==="owner"?owner:employee;
  const hash=await correctionDelegationCommandFingerprint(q.siteId,access,c),key=correctionDelegationPendingKey(q.siteId,access,anchor);
  const raw=JSON.stringify({version:1,anchorId:anchor,actorId:actor,employeeId:access==="owner"?null:employee,query:q,command:c,commandFingerprint:hash},null,2);storage.setItem(key,raw);
  const recover={...query(access,"recover"),operationId:"decision" in c?c.decision.operationId:c.operationId};
  const response=await correctionDelegationReceiptHttp(recover,c);
  return {values,storage,q,c,key,raw,actor,hash,recover,response};
}
test("aggregate discovers owner and delegate correction intents locally with no reason or request disclosure",async()=>{
  for(const access of ["owner","delegate"] as const){const f=await fixture(access),before=[...f.values];const result=await listKnownAttendanceRecoveries(f.storage,f.actor,current);
    assert.equal(result.invalid,false);assert.equal(result.entries.length,1);assert.equal(result.entries[0].kind,"correction");assert.doesNotMatch(JSON.stringify(result),/Synthetic|reason|workerId|requestId|proposal/);assert.deepEqual([...f.values],before);
    assert.deepEqual((await listKnownCorrectionDelegationRecoveries(f.storage,id(99),current)).entries,[]);
  }
});
test("owner grant and delegate decision recover by one exact GET only, with flag off, then CAS clear",async()=>{
  for(const access of ["owner","delegate"] as const){const f=await fixture(access),entry=(await listKnownAttendanceRecoveries(f.storage,f.actor,current)).entries[0];let calls=0;
    const r=await recoverKnownAttendance(entry,{authenticatedUserId:f.actor,storage:f.storage,isCurrentAuth:current,signal:new AbortController().signal,apiFetch:async(path,init)=>{
      calls++;assert.equal(init?.method,"GET");assert.equal(init?.body,undefined);assert.deepEqual(parseCorrectionDelegationHttpQuery("https://synthetic.test"+path),f.recover);return Response.json(f.response);}});
    assert.equal(calls,1);assert.equal(r?.kind,"correction");assert.equal(r?.actorId,f.actor);assert.equal(f.storage.getItem(f.key),null);assert.doesNotMatch(JSON.stringify(r),/command|reason|workerId|proposal/);
  }
});
test("bad hash, foreign key and malformed local intent remain unchanged and unavailable",async()=>{
  for(const variant of ["hash","key","body"]){const f=await fixture();if(variant==="key"){f.values.delete(f.key);f.values.set(f.key.replace(employee,id(98)),f.raw);}else f.values.set(f.key,variant==="hash"?JSON.stringify({...JSON.parse(f.raw),commandFingerprint:"f".repeat(64)}):"{");
    const before=[...f.values],r=await listKnownCorrectionDelegationRecoveries(f.storage,f.actor,current);assert.equal(r.invalid,true);assert.equal(r.entries.length,0);assert.deepEqual([...f.values],before);
  }
});
test("null, wrong hash, wrong actor, extra body and malformed responses never settle original intent",async()=>{
  for(const variant of ["null","hash","actor","body","broken"]){const f=await fixture(),entry=(await listKnownCorrectionDelegationRecoveries(f.storage,f.actor,current)).entries[0];
    const wire=variant==="null"?{ok:true,...correctionDelegationWire(f.recover)}:variant==="hash"?{...f.response,receipt:{...f.response.receipt,commandFingerprint:"f".repeat(64)}}:variant==="actor"?{...f.response,actorId:id(99)}:variant==="body"?{...f.response,reason:"forbidden body"}:f.response;
    const r=await recoverKnownCorrectionDelegation(entry,{authenticatedUserId:f.actor,storage:f.storage,isCurrentAuth:current,signal:new AbortController().signal,
      apiFetch:async()=>variant==="broken"?new Response('{"ok":',{headers:{"content-type":"application/json"}}):Response.json(wire)});
    assert.equal(r,null);assert.equal(f.storage.getItem(f.key),f.raw);
  }
});
test("storage replacement and foreign Auth while reading cannot clear or publish",async()=>{
  for(const mode of ["storage","auth"]){const f=await fixture(),entry=(await listKnownCorrectionDelegationRecoveries(f.storage,f.actor,current)).entries[0];let live=true;
    const result=recoverKnownCorrectionDelegation(entry,{authenticatedUserId:f.actor,storage:f.storage,isCurrentAuth:()=>live,signal:new AbortController().signal,apiFetch:async()=>{
      if(mode==="storage")f.values.set(f.key,"replacement preserved");else live=false;return Response.json(f.response);}});
    if(mode==="auth")await assert.rejects(result,/recovery_scope_changed/);else assert.equal(await result,null);assert(f.storage.getItem(f.key));
  }
});
test("forged descriptor and aborted recovery cannot issue HTTP",async()=>{
  const f=await fixture(),entry=(await listKnownCorrectionDelegationRecoveries(f.storage,f.actor,current)).entries[0],a=new AbortController();let calls=0;
  const options={authenticatedUserId:f.actor,storage:f.storage,isCurrentAuth:current,signal:a.signal,apiFetch:async()=>{calls++;throw Error("no");}};
  await assert.rejects(recoverKnownCorrectionDelegation({...entry,operationId:id(99)},options));a.abort();await assert.rejects(recoverKnownCorrectionDelegation(entry,options));assert.equal(calls,0);assert.equal(f.storage.getItem(f.key),f.raw);
});
test("abort interrupts hung local SHA; late digest cannot disclose or mutate",async()=>{
  const f=await fixture(),a=new AbortController(),original=crypto.subtle.digest;let release!:(v:ArrayBuffer)=>void;
  crypto.subtle.digest=(()=>new Promise<ArrayBuffer>(resolve=>{release=resolve;})) as typeof original;
  try{const scan=listKnownCorrectionDelegationRecoveries(f.storage,f.actor,current,a.signal);await new Promise(resolve=>setTimeout(resolve,5));a.abort();await assert.rejects(scan,/recovery_scope_changed/);release(new ArrayBuffer(32));await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.storage.getItem(f.key),f.raw);}
  finally{crypto.subtle.digest=original;}
});
test("late response body after abort cannot clear the matching intent",async()=>{
  const f=await fixture(),entry=(await listKnownCorrectionDelegationRecoveries(f.storage,f.actor,current)).entries[0],a=new AbortController();let body!:ReadableStreamDefaultController<Uint8Array>,started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});const work=recoverKnownCorrectionDelegation(entry,{authenticatedUserId:f.actor,storage:f.storage,isCurrentAuth:current,signal:a.signal,
    apiFetch:async()=>{started();return new Response(new ReadableStream({start(c){body=c;},cancel(){}}),{headers:{"content-type":"application/json"}});}});
  await ready;a.abort();await assert.rejects(work,/recovery_scope_changed/);try{body.enqueue(new TextEncoder().encode(JSON.stringify(f.response)));body.close();}catch{}assert.equal(f.storage.getItem(f.key),f.raw);
});
test("aggregate global 64 intent ceiling includes correction without widening other formats",async()=>{
  const f=await fixture();for(let n=0;n<65;n++)f.values.set(`faolla:attendance:correction-delegation:v1:99990001:delegate:${id(100+n)}`,f.raw);
  await assert.rejects(listKnownAttendanceRecoveries(f.storage,f.actor,current),/recovery_storage_limit/);
});
