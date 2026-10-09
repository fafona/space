import assert from "node:assert/strict";
import test from "node:test";
import {parsePinClockResult,type PinClockResult} from "./merchantAttendancePinClock";
import type {IndependentBinding} from "./merchantAttendanceIndependent";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const input={siteId:"99990001",terminalId:id(1),workerNo:"IND-01",command:null,operationId:null};
const clean=():PinClockResult=>({siteId:input.siteId,terminalId:input.terminalId,workerNo:input.workerNo,workerName:"Synthetic",workerId:id(2),employeeId:id(3),locationId:id(4),state:{sequence:0,status:"off",lastEvent:null},receipt:null,replayed:false,canStart:true,canFinish:true,blockReason:null});
const boundary=():IndependentBinding=>({protocol:"attendance-independent-binding-boundary-v1",siteId:input.siteId,workerId:id(2),subjectId:id(5),bindingOperationId:id(6),employeeId:id(3),employeeAuthUserId:id(7),workerVersion:2,generation:1,lastIndependentEventId:null,lastSequence:0,boundAt:"2026-10-08T10:00:01.000000Z"});
test("196 PIN bootstrap leaves the absent-field old shape unchanged and accepts the exact closed boundary",()=>{
 const old=clean();assert.deepEqual(parsePinClockResult(old,input),old);
 const zero={...old,state:{...old.state,independentBindingBoundary:boundary()}};assert.deepEqual(parsePinClockResult(zero,input),zero);
 const last={id:id(8),siteId:input.siteId,workerId:id(2),operationId:id(9),locationId:id(4),sequence:4,action:"clock_out" as const,breakPaid:null,occurredAt:"2026-10-08T10:00:00.000Z",timeZone:"UTC"};
 const closed={...old,state:{sequence:4,status:"off" as const,lastEvent:last,independentBindingBoundary:{...boundary(),lastIndependentEventId:last.id,lastSequence:4}}};
 assert.deepEqual(parsePinClockResult(closed,input),closed);
});
test("196 PIN state rejects unknown/forged identity, non-off, wrong tail/sequence and malformed boundary",()=>{
 const old=clean(),base=boundary();
 for(const patch of [{siteId:"99990002"},{workerId:id(12)},{employeeId:id(13)},{protocol:"unknown"},{lastSequence:1,lastIndependentEventId:id(14)},{extra:true}])assert.throws(()=>parsePinClockResult({...old,state:{...old.state,independentBindingBoundary:{...base,...patch}}},input));
 for(const invalid of [null,{},"unknown"]){assert.throws(()=>parsePinClockResult({...old,state:{...old.state,independentBindingBoundary:invalid}},input));}
 assert.throws(()=>parsePinClockResult({...old,state:{...old.state,independentBindingBoundary:base,status:"working"}},input));
 const withGetter={...base};Object.defineProperty(withGetter,"employeeId",{get(){throw Error("must not invoke");},enumerable:true});assert.throws(()=>parsePinClockResult({...old,state:{...old.state,independentBindingBoundary:withGetter}},input));
 const last={id:id(8),siteId:input.siteId,workerId:id(2),operationId:id(9),locationId:id(4),sequence:4,action:"clock_out" as const,breakPaid:null,occurredAt:"2026-10-08T10:00:01.000001Z",timeZone:"UTC"};
 assert.throws(()=>parsePinClockResult({...old,state:{sequence:4,status:"off",lastEvent:last,independentBindingBoundary:{...base,lastSequence:4,lastIndependentEventId:last.id}}},input));
 assert.throws(()=>parsePinClockResult({...old,state:{...old.state,independentBindingBoundary:base,unknownBoundary:base}},input));
});
