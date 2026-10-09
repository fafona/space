import assert from "node:assert/strict";
import test from "node:test";
import {attendancePin,parsePinBody,parsePinQuery,parsePinStatus,parsePinVerification} from "./merchantAttendancePin";
import {deriveAttendancePin,PIN_SCRYPT_OPTIONS,executePinAdmin,executePinVerification} from "./merchantAttendancePin.server";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const siteId="99990001",q={siteId,workerNo:"PIN-01",operationId:null};
const command={action:"set" as const,operationId:id(4),expectedRevision:0,workerId:id(2),employeeId:id(3),pin:"01738264",salt:"ab".repeat(16)};
const status=()=>({siteId,workerId:id(2),employeeId:id(3),workerNo:"PIN-01",workerName:"合成人员",ready:true,revision:0,enabled:false,bindingCurrent:false,changedAt:null,receipt:null});
test("PIN exact body/query refuses injected identity, role, verified result, commands and malformed secrets",()=>{
  assert.equal(attendancePin("01738264"),"01738264");assert.deepEqual(parsePinBody({siteId,workerNo:q.workerNo,command}),{...q,command});
  assert.deepEqual(parsePinQuery('https://synthetic.invalid/?siteId=99990001&workerNo=PIN-01'),q);
  for(const pin of ["1234567","1234567890123","１２３４５６７８"," 12345678","1234\n678"])assert.throws(()=>attendancePin(pin));
  for(const patch of [{verified:true},{action:"clock_in"},{employeeId:null},{salt:"x"},{expectedRevision:-1}])assert.throws(()=>parsePinBody({siteId,workerNo:q.workerNo,command:{...command,...patch}}));
  for(const suffix of ['&workerId='+id(1),'&workerNo=other','&pin=12345678'])assert.throws(()=>parsePinQuery('https://synthetic.invalid/?siteId=99990001&workerNo=PIN-01'+suffix));
});
test("PIN metadata binds current worker number, version and exact receipt without verifier leakage",()=>{
  assert.deepEqual(parsePinStatus(status(),q),status());
  for(const patch of [{siteId:"99990002"},{workerNo:"another"},{verifier:"private"},{salt:"secret"},{revision:1},{enabled:true},{employeeId:null}])assert.throws(()=>parsePinStatus({...status(),...patch},q));
  assert.throws(()=>parsePinStatus({...status(),receipt:{operationId:id(4),revision:1,action:"set"}},q));
  assert.deepEqual(parsePinVerification({verified:true,workerNo:"PIN-01",workerName:"合成",clockEnabled:false}),{verified:true,workerNo:"PIN-01",workerName:"合成",clockEnabled:false});
  for(const patch of [{clockEnabled:true},{verified:false},{sessionToken:"secret"},{workerId:id(1)}])assert.throws(()=>parsePinVerification({verified:true,workerNo:"PIN-01",workerName:"合成",clockEnabled:false,...patch}));
});
test("real scrypt parameters, tenant/member domain separation and salt protect PIN without new dependencies",async()=>{
  assert.deepEqual(PIN_SCRYPT_OPTIONS,{N:131072,r:8,p:1,maxmem:160*1024*1024});
  const binding={siteId,workerId:id(2),employeeId:id(3)},pepper="synthetic-test-only",a=await deriveAttendancePin(command.pin,command.salt,binding,pepper);
  assert.match(a,/^[a-f0-9]{64}$/);assert.equal(a,await deriveAttendancePin(command.pin,command.salt,binding,pepper));
  for(const args of [{pin:"01738265",salt:command.salt,binding},{pin:command.pin,salt:"cd".repeat(16),binding},{pin:command.pin,salt:command.salt,binding:{...binding,siteId:"99990002"}},{pin:command.pin,salt:command.salt,binding:{...binding,employeeId:id(9)}}])
    assert.notEqual(a,await deriveAttendancePin(args.pin,args.salt,args.binding,pepper));
});
test("owner access is checked before KDF or write; no transport details or verifier leak on denial",async()=>{
  let calls=0;await assert.rejects(executePinAdmin({...q,authUserId:id(99),allowSet:true,command},{rpc:async()=>{calls++;return {data:null,error:{message:"attendance_access_denied"}};}}),/attendance_access_denied/);assert.equal(calls,1);
  await assert.rejects(executePinAdmin({...q,authUserId:id(99),allowSet:true,command:null},{rpc:async()=>{throw Error("private connection");}}),/attendance_unavailable/);
});
test("missing dedicated pepper fails before device lookup rather than reusing login credentials",async()=>{
  const old=process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;delete process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;let calls=0;
  try{await assert.rejects(executePinVerification({siteId,terminalId:id(7),secret:"test",workerNo:q.workerNo,pin:command.pin,allowVerify:true},{rpc:async()=>{calls++;return {data:null,error:null};}}),/attendance_pin_unconfigured/);assert.equal(calls,0);}
  finally{if(old!==undefined)process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=old;}
});
test("KDF admission has one in-flight operation and releases after a rejected owner read",async()=>{
  let entered!:()=>void,release!:()=>void;
  const inside=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const input={...q,authUserId:id(99),allowSet:true,command};let calls=0;
  const service={rpc:async()=>{calls++;entered();await hold;return {data:null,error:{message:"attendance_access_denied"}};}};
  const first=assert.rejects(executePinAdmin(input,service),/attendance_access_denied/);
  await inside;
  try{await assert.rejects(executePinAdmin(input,service),/attendance_pin_busy/);assert.equal(calls,1);}
  finally{release();await first;}
  await assert.rejects(executePinAdmin(input,service),/attendance_access_denied/);assert.equal(calls,2);
});
