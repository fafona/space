import assert from "node:assert/strict";
import test from "node:test";
import {handlePinClock,pinClockDependencies} from "./route-handler";
import {TERMINAL_COOKIE} from "@/lib/merchantAttendanceTerminal";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
const base="https://www.faolla.com/api/merchant-enterprise/attendance/terminal-clock",id="00000000-0000-4000-8000-000000000070",secret="A".repeat(43);
const body={workerNo:"PIN-01",pin:"01738264",command:null,operationId:null};
const req=(b:unknown=body,cookie=`${TERMINAL_COOKIE}=99990001.${id}.${secret}`)=>new Request(base,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"application/json",cookie},body:JSON.stringify(b)});
const entitlement=async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof pinClockDependencies.entitlement>>;
test("PIN clock default flag, method, origin, duplicate cookie and injected authority fail before execution",async()=>{
  let calls=0;const d={enabled:()=>true,allow:()=>true,entitlement,execute:async()=>{calls++;throw Error('no');}};
  assert.equal((await handlePinClock(req(),{...d,enabled:()=>false})).status,404);
  assert.equal((await handlePinClock(new Request(base),d)).status,405);
  assert.equal((await handlePinClock(new Request('https://foreign.invalid/api/terminal-clock',{method:'POST'}),d)).status,403);
  for(const extra of [{verified:true},{siteId:'99990002'},{allowNew:true},{secret}])assert.equal((await handlePinClock(req({...body,...extra}),d)).status,400);
  assert.equal((await handlePinClock(req(body,''),d)).status,403);
  assert.equal((await handlePinClock(req(body,`${TERMINAL_COOKIE}=99990001.${id}.${secret}; ${TERMINAL_COOKIE}=99990001.${id}.${secret}`),d)).status,403);assert.equal(calls,0);
});
test("device cookie selects tenant; paused platform admission reaches final transaction as false",async()=>{
  let called=false;const r=await handlePinClock(req(),{enabled:()=>true,allow:()=>true,entitlement,execute:async i=>{
    called=true;assert.deepEqual(i,{...body,siteId:'99990001',terminalId:id,secret,allowNew:false});throw new MerchantAttendanceError('attendance_pin_denied');
  }});assert(called);assert.equal(r.status,403);assert.deepEqual(await r.json(),{ok:false,error:'attendance_pin_denied'});assert.equal(r.headers.get('set-cookie'),null);assert.match(r.headers.get('cache-control')!,/no-store/);
});
test("rate/body/query guards and unexpected upstream errors expose neither secrets nor transport",async()=>{
  const d={enabled:()=>true,allow:()=>true,entitlement,execute:async()=>{throw Error('private upstream '+secret);}};
  assert.equal((await handlePinClock(req(),{...d,allow:()=>false})).status,429);
  assert.equal((await handlePinClock(req({...body,padding:'x'.repeat(5000)}),d)).status,413);
  const withQuery=new Request(base+'?pin=12345678',req());assert.equal((await handlePinClock(withQuery,d)).status,400);
  const r=await handlePinClock(req(),d);assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,error:'attendance_unavailable'});
});

test("identity and original-receipt denials return only a private error, never partial worker state",async()=>{
  const operationId='00000000-0000-4000-8000-000000000500';
  for(const [error,status] of [['attendance_access_denied',403],['attendance_operation_conflict',409]] as const){
    for(const command of [null,{expectedWorkerId:'00000000-0000-4000-8000-000000000201',expectedEmployeeId:'00000000-0000-4000-8000-000000000101',
      locationId:'00000000-0000-4000-8000-000000000301',operationId,action:'clock_out',expectedSequence:1}]){
      let calls=0;
      const response=await handlePinClock(req({...body,command,operationId:command?null:operationId}),{
        enabled:()=>true,allow:()=>true,entitlement,execute:async input=>{
          calls++;assert.equal(input.command?.operationId??input.operationId,operationId);
          throw new MerchantAttendanceError(error);
        },
      });
      assert.equal(calls,1);assert.equal(response.status,status);
      assert.deepEqual(await response.json(),{ok:false,error});assert.match(response.headers.get('cache-control')!,/private.*no-store/);
      assert.equal(response.headers.get('set-cookie'),null);
    }
  }
});
