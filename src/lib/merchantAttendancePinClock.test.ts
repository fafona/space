import assert from "node:assert/strict";
import test from "node:test";
import {parsePinClockBody,parsePinClockResult,parsePinClockRequest,pinClockMessage,PIN_CLOCK_ERRORS,type PinClockResult,type PinClockCommand} from "./merchantAttendancePinClock";
import {PIN_ERRORS,pinMessage} from "./merchantAttendancePin";
import {TERMINAL_ERRORS} from "./merchantAttendanceTerminal";
import {AttendancePinClockClient,parsePinClockPending,pinClockPendingKey,type PinClockPending} from "./merchantAttendancePinClockClient";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,siteId="99990001",pin="01738264";
const device={siteId,terminalId:id(70),label:"合成终端"};
const paired={paired:true,siteId,clockEnabled:false,attendanceEnabled:true,terminal:{id:id(70),locationId:id(301),label:device.label,locationName:"合成地点",timeZone:"UTC",state:"active",createdAt:"2026-10-01T10:00:00.000000Z",pairExpiresAt:"2026-10-01T10:05:00.000000Z",pairedAt:"2026-10-01T10:01:00.000000Z",deviceExpiresAt:"2026-10-31T10:01:00.000000Z",revokedAt:null}};
const cleanResult=():PinClockResult=>({siteId,terminalId:device.terminalId,workerId:id(201),employeeId:id(101),workerNo:"PIN-01",workerName:"合成人员",locationId:id(301),state:{sequence:0,status:"off",lastEvent:null},receipt:null,replayed:false,canStart:true,canFinish:true,blockReason:null});
const command=():PinClockCommand=>({expectedWorkerId:id(201),expectedEmployeeId:id(101),locationId:id(301),operationId:id(500),action:"clock_in",expectedSequence:0});
const accepted=(c:PinClockCommand):PinClockResult=>{const event={id:id(600),siteId,workerId:c.expectedWorkerId,locationId:c.locationId,operationId:c.operationId,sequence:c.expectedSequence+1,action:c.action,breakPaid:null,occurredAt:"2026-10-01T10:00:00.000Z",timeZone:"UTC"};return {...cleanResult(),state:{sequence:event.sequence,status:"working",lastEvent:event},receipt:event};};
const reply=(body:object)=>new Response(JSON.stringify({ok:true,moduleEnabled:true,...body}),{headers:{"content-type":"application/json"}});
function memory(){const map=new Map<string,string>();return {map,get length(){return map.size;},key:(n:number)=>[...map.keys()][n]??null,getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};}

test("PIN clock identity denial explains the stopped operation without changing owner-only administration messages",()=>{
  const code="attendance_access_denied";
  const message="无法确认当前员工的考勤权限或记录归属，已停止读取和打卡。如有待确认编号，请保留并联系企业负责人核验。";
  assert.equal(pinClockMessage(code),message);
  assert.equal(pinClockMessage(new Error(code)),message);
  assert.equal(PIN_CLOCK_ERRORS[code],403);
  assert.equal(pinMessage(code),TERMINAL_ERRORS[code].message);
  assert.equal(PIN_ERRORS[code].message,"仅当前企业负责人可以管理终端。");
  for(const [other,value] of Object.entries(PIN_ERRORS))if(other!==code){
    assert.equal(pinClockMessage(other),value.message);
    assert.equal(PIN_CLOCK_ERRORS[other],value.status);
  }
});

test("PIN clock request forbids identity overrides, toggle/time claims and mismatched bindings",()=>{
  const b={workerNo:"PIN-01",pin,command:command(),operationId:null};assert.deepEqual(parsePinClockBody(b),b);
  for(const patch of [{verified:true},{siteId},{time:Date.now()}])assert.throws(()=>parsePinClockBody({...b,...patch}));
  for(const patch of [{action:"toggle"},{expectedEmployeeId:null},{expectedSequence:-1},{source:"web"}])assert.throws(()=>parsePinClockBody({...b,command:{...command(),...patch}}));
  assert.throws(()=>parsePinClockRequest({command:command(),operationId:id(500)}));
  const q={...device,workerNo:"PIN-01",command:command(),operationId:null};assert.equal(parsePinClockResult(accepted(command()),q).receipt?.sequence,1);
  for(const patch of [{employeeId:id(102)},{terminalId:id(71)},{verifier:"leak"},{canFinish:false},{blockReason:"unknown"}])assert.throws(()=>parsePinClockResult({...accepted(command()),...patch},q));
});
test("pending metadata is strictly device/person scoped, canonical and contains no secret fields",()=>{
  const saved:PinClockPending={version:1,siteId,terminalId:device.terminalId,workerNo:"PIN-01",command:command()};
  assert.equal(parsePinClockPending(JSON.stringify(saved),device,"pin-01").command.operationId,id(500));
  assert.equal(pinClockPendingKey(device,"PIN-01"),pinClockPendingKey(device,"pin-01"));
  assert.notEqual(pinClockPendingKey(device,"PIN-01"),pinClockPendingKey(device,"PIN-02"));
  for(const patch of [{pin},{secret:"private"},{terminalId:id(71)},{workerNo:"PIN-02"}])assert.throws(()=>parsePinClockPending(JSON.stringify({...saved,...patch}),device,"PIN-01"));
});
test("successful action clears canonical pending even when original command field order differs",async()=>{
  const store=memory();let writes=0;
  const client=new AttendancePinClockClient({storage:()=>store,randomId:()=>id(500),apiFetch:async(url,init)=>{
    if(url.endsWith('terminal-device'))return reply(paired);const b=JSON.parse(String(init?.body));if(!b.command)return reply(cleanResult());
    writes++;assert.equal(store.length,1);assert(![...store.map.values()].join().includes(pin));return reply(accepted(b.command));
  }});
  try{await client.initialize();await client.read('PIN-01',pin);assert.equal(client.getSnapshot().phase,'ready');await client.punch('clock_in');assert.equal(client.getSnapshot().phase,'confirmed');assert.equal(store.length,0);await client.punch('clock_out');assert.equal(writes,1);}finally{client.dispose();}
});
test("lost response survives recreation; another worker does not overwrite it; original recovery never writes",async()=>{
  const store=memory();let writes=0,receipt:PinClockResult|null=null;
  const apiFetch:ConstructorParameters<typeof AttendancePinClockClient>[0]['apiFetch']=async(url,init)=>{
    if(url.endsWith('terminal-device'))return reply(paired);const b=JSON.parse(String(init?.body));
    if(b.command){writes++;receipt=accepted(b.command);throw Error('synthetic_response_lost');}
    if(b.workerNo==='PIN-02')return reply({...cleanResult(),workerNo:'PIN-02',workerId:id(202),employeeId:id(102)});
    return reply(b.operationId?receipt!:cleanResult());
  };
  const a=new AttendancePinClockClient({storage:()=>store,randomId:()=>id(500),apiFetch});
  await a.initialize();await a.read('PIN-01',pin);await a.punch('clock_in');assert.equal(a.getSnapshot().phase,'unconfirmed');a.dispose();
  const b=new AttendancePinClockClient({storage:()=>store,apiFetch});
  try{await b.initialize();assert.equal(writes,1);await b.read('PIN-02',pin);assert.equal(b.getSnapshot().pending,null);assert.equal(store.length,1);await b.read('PIN-01',pin);assert.equal(store.length,0);assert.equal(writes,1);assert.match(b.getSnapshot().message,/原打卡已确认/);}finally{b.dispose();}
});
test("unconfirmed missing receipt permits only explicit original command retry",async()=>{
  const store=memory();let writes=0;const seen:string[]=[];
  const c=new AttendancePinClockClient({storage:()=>store,randomId:()=>id(500),apiFetch:async(url,init)=>{
    if(url.endsWith('terminal-device'))return reply(paired);const b=JSON.parse(String(init?.body));if(!b.command)return reply(cleanResult());
    writes++;seen.push(b.command.operationId);if(writes===1)throw Error('before_commit');return reply(accepted(b.command));
  }});
  try{await c.initialize();await c.read('PIN-01',pin);await c.punch('clock_in');await c.read('PIN-01',pin);assert.equal(c.getSnapshot().phase,'unconfirmed');assert.equal(writes,1);await c.punch(null);assert.equal(c.getSnapshot().phase,'confirmed');assert.deepEqual(seen,[id(500),id(500)]);assert.equal(store.length,0);}finally{c.dispose();}
});
test("storage failure or 32 pending entries prevents new write without losing other intents",async()=>{
  for(const broken of [true,false]){
    const store=memory();if(broken)store.setItem=()=>{throw Error('blocked');};else for(let n=0;n<32;n++)store.map.set('faolla:attendance:pin-clock:v1:'+n,'placeholder');
    let writes=0;const c=new AttendancePinClockClient({storage:()=>store,apiFetch:async(url,init)=>{if(url.endsWith('terminal-device'))return reply(paired);const b=JSON.parse(String(init?.body));if(b.command)writes++;return reply(cleanResult());}});
    try{await c.initialize();await c.read('PIN-01',pin);await c.punch('clock_in');assert.equal(c.getSnapshot().phase,'blocked');assert.equal(writes,0);assert.equal(store.length,broken?0:32);}finally{c.dispose();}
  }
});
test("clearing shared screen during pending read ignores late result and cannot punch",async()=>{
  const store=memory();let release!:(r:Response)=>void,writes=0;const c=new AttendancePinClockClient({storage:()=>store,apiFetch:async(url,init)=>{
    if(url.endsWith('terminal-device'))return reply(paired);if(JSON.parse(String(init?.body)).command)writes++;return new Promise<Response>(r=>{release=r;});
  }});
  try{await c.initialize();const reading=c.read('PIN-01',pin);c.clear();release(reply(cleanResult()));await reading;assert.equal(c.getSnapshot().result,null);await c.punch('clock_in');assert.equal(writes,0);}finally{c.dispose();}
});
test("memory-only PIN action window expires without requests or storage writes",async()=>{
  let calls=0;const store=memory(),c=new AttendancePinClockClient({storage:()=>store,secretMs:5,apiFetch:async url=>{calls++;return reply(url.endsWith('terminal-device')?paired:cleanResult());}});
  try{await c.initialize();await c.read('PIN-01',pin);await new Promise(r=>setTimeout(r,40));assert.equal(c.getSnapshot().result,null);await c.punch('clock_in');assert.equal(calls,2);assert.equal(store.length,0);}finally{c.dispose();}
});

for(const [error,status] of [["attendance_access_denied",403],["attendance_operation_conflict",409],["attendance_worker_changed",409]] as const){
  test(`PIN ${error} on a new read clears the shared display and memory-only action authorization`,async()=>{
    let denied=false,calls=0,writes=0;const store=memory();
    const c=new AttendancePinClockClient({storage:()=>store,apiFetch:async(url,init)=>{
      if(url.endsWith('terminal-device'))return reply(paired);
      calls++;const body=JSON.parse(String(init?.body));if(body.command)writes++;
      if(denied)return Response.json({ok:false,error},{status});
      return reply({...accepted(command()),receipt:null});
    }});
    try{
      await c.initialize();await c.read('PIN-01',pin);assert.ok(c.getSnapshot().result?.state.lastEvent);
      denied=true;await c.read('PIN-01',pin);assert.equal(c.getSnapshot().phase,'blocked');
      assert.equal(c.getSnapshot().message,pinClockMessage(error));
      assert.equal(c.getSnapshot().result,null);await c.punch('clock_out');await c.punch(null);
      assert.equal(calls,2);assert.equal(writes,0);assert.equal(store.length,0);
    }finally{c.dispose();}
  });
}

test("PIN identity rejection and later failed recovery keep exact pending across recreation without a second command",async()=>{
  const store=memory();let mode:'normal'|'denied'|'unavailable'|'recovered'='normal',writes=0;
  const requests:Array<{command:PinClockCommand|null;operationId:string|null}>=[];
  const apiFetch:ConstructorParameters<typeof AttendancePinClockClient>[0]['apiFetch']=async(url,init)=>{
    if(url.endsWith('terminal-device'))return reply(paired);
    const body=JSON.parse(String(init?.body));requests.push({command:body.command,operationId:body.operationId});
    if(body.command){writes++;return Response.json({ok:false,error:'attendance_access_denied'},{status:403});}
    if(mode==='denied')return Response.json({ok:false,error:'attendance_access_denied'},{status:403});
    if(mode==='unavailable')return Response.json({ok:false,error:'attendance_unavailable'},{status:503});
    return reply(mode==='recovered'?accepted(command()):cleanResult());
  };
  const a=new AttendancePinClockClient({storage:()=>store,randomId:()=>id(500),apiFetch});
  let b:AttendancePinClockClient|null=null;
  try{
    await a.initialize();await a.read('PIN-01',pin);await a.punch('clock_in');
    assert.equal(a.getSnapshot().phase,'unconfirmed');assert.equal(a.getSnapshot().result,null);
    assert.ok(a.getSnapshot().message.startsWith(pinClockMessage('attendance_access_denied')));
    const key=pinClockPendingKey(device,'PIN-01'),raw=store.getItem(key);assert.ok(raw);
    assert.equal(JSON.parse(raw!).command.operationId,id(500));assert(!raw!.includes(pin));
    mode='denied';await a.read('PIN-01',pin);assert.equal(a.getSnapshot().phase,'blocked');
    assert.equal(a.getSnapshot().message,pinClockMessage('attendance_access_denied'));
    assert.ok(a.getSnapshot().pending);assert.equal(a.getSnapshot().result,null);assert.equal(store.getItem(key),raw);
    mode='unavailable';await a.read('PIN-01',pin);await a.punch(null);assert.equal(writes,1);assert.equal(store.getItem(key),raw);
    a.dispose();b=new AttendancePinClockClient({storage:()=>store,apiFetch});await b.initialize();
    await b.punch(null);mode='denied';await b.read('PIN-01',pin);await b.punch(null);
    assert.equal(writes,1);assert.equal(store.getItem(key),raw);
    mode='recovered';await b.read('PIN-01',pin);assert.equal(store.length,0);assert.equal(writes,1);
    assert.equal(b.getSnapshot().result?.receipt?.operationId,id(500));
    assert(requests.slice(2).every(r=>r.command===null&&r.operationId===id(500)), 'recovery is PIN-authenticated read, never automatic write');
  }finally{a.dispose();b?.dispose();}
});
