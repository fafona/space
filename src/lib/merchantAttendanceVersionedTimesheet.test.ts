import assert from "node:assert/strict";
import test from "node:test";
import {parseAttendanceTimesheetResult as parse} from "./merchantAttendanceTimesheet";
import {parseAttendanceScopedTimesheetResult as scoped} from "./merchantAttendanceScopedTimesheet";
import {parseTimesheetExportSource as source,buildTimesheetExportCsv as csv} from "./merchantAttendanceTimesheetExport";
import {sheetWire,sheetEffect,sheetEvent,timesheetQuery as q,timesheetId as id} from "../../scripts/fixtures/attendance-timesheet-model";
import {scopedSheetWire,scopedSelfQuery,scopedManagerQuery} from "../../scripts/fixtures/attendance-scoped-timesheet-model";
import {timesheetExportCommand as command,timesheetExportWire as exportWire} from "../../scripts/fixtures/attendance-timesheet-export-model";

const v2="raw-and-approved-v2" as const;
function effect(revision=2){
  const base=sheetEffect({startAt:"2026-09-05T08:00:00.000000Z",endAt:"2026-09-05T15:00:00.000001Z",breaks:[]});
  return {...base,revision,requestId:revision===1?id(30):id(31),operationId:revision===1?id(40):id(41),
    lineage:{rootRequestId:id(30),rootOperationId:id(40),rootRecordedAt:revision===1?base.recordedAt:"2026-09-24T20:00:00.000000Z",
      previousOperationId:revision===1?null:revision===2?id(40):id(42)}};
}
function wire(revision=2){const w=sheetWire();return {...w,sourceVersion:v2,items:w.items.map(i=>({...i,effect:effect(revision)}))};}
test("v2 is explicit; legacy report callers never silently accept a revised source",()=>{
  assert.throws(()=>parse(wire(),q));assert.throws(()=>parse(sheetWire(),q,v2));
  assert.equal(parse(sheetWire(),q).sourceVersion,undefined);
  for(const revision of [1,2,3,2147483647]){
    const r=parse(wire(revision),q,v2);assert.equal(r.rows.length,1);assert.equal(r.rows[0].correction?.revision,revision);
    assert.equal(r.totals.original.workedUs,28800000000);assert.equal(r.totals.selected.workedUs,25200000001);
    assert.equal(r.sourceVersion,v2);assert.equal(r.rows[0].correction?.lineage?.rootOperationId,id(40));
  }
});
test("v2 provenance rejects absent, cyclic, future or incompatible predecessor/root references",()=>{
  for(const patch of [{revision:0},{revision:1.5},{revision:2147483648},{revision:1},{lineage:null},{lineage:{}},{recordedAt:"2026-09-23T20:00:00.000000Z"}]){
    const w=wire();Object.assign(w.items[0].effect,patch);assert.throws(()=>parse(w,q,v2));
  }
  for(const patch of [{rootRequestId:id(31)},{rootOperationId:id(41)},{rootRecordedAt:"2026-09-25T20:00:00.000000Z"},
    {rootRecordedAt:"2026-09-04T20:00:00.000000Z"},{previousOperationId:null},{previousOperationId:id(41)},{previousOperationId:id(99)},{extra:true}]){
    const w=wire();Object.assign(w.items[0].effect.lineage,patch);assert.throws(()=>parse(w,q,v2));
  }
  const w=wire(3);w.items[0].effect.lineage.previousOperationId=id(40);assert.throws(()=>parse(w,q,v2));
});
test("v2 independently recalculates microseconds and still rejects duplicates and overlapping sources",()=>{
  const w=wire();w.items[0].effect.workedUs++;assert.throws(()=>parse(w,q,v2));
  const doubled=wire();doubled.items.push(structuredClone(doubled.items[0]));assert.throws(()=>parse(doubled,q,v2));
  const original=wire(1);original.items[0].effect.lineage.previousOperationId=id(40);assert.throws(()=>parse(original,q,v2));
});
test("scoped v2 preserves complete-session and employee authorization validation",()=>{
  for(const access of ["self","manager"] as const){
    const base=scopedSheetWire(access),w={...base,sourceVersion:v2,items:base.items.map(i=>({...i,effect:{...effect(),employeeId:id(2)}}))};
    const query=access==="self"?scopedSelfQuery:scopedManagerQuery,r=scoped(w,query,v2);
    assert.equal(r.totals.selected.workedUs,25200000001);assert.equal("employeeId" in r,false);assert.throws(()=>scoped(w,query));
    if(access==="self")w.items[0].events[1].actorEmployeeId=id(91);else w.items[0].events[1].locationId=id(91);
    assert.throws(()=>scoped(w,query,v2));
  }
});
test("different sessions cannot reuse one root approval identity",()=>{
  const w=wire(),next={...sheetEffect({startAt:"2026-09-06T08:00:00.000000Z",endAt:"2026-09-06T15:00:00.000000Z",breaks:[]},id(104)),
    revision:2,requestId:id(32),operationId:id(43),lineage:{...effect().lineage}};
  w.items.push({startEventId:id(103),events:[sheetEvent(3,"clock_in","2026-09-06T08:00:00.000000Z"),sheetEvent(4,"clock_out","2026-09-06T16:00:00.000000Z")],effect:next});
  assert.throws(()=>parse(w,q,v2));
  Object.assign(next.lineage,{rootRequestId:id(33),rootOperationId:id(44),previousOperationId:id(44)});
  assert.equal(parse(w,q,v2).rows.length,2);
});
test("owner/self/manager exports flatten root and selected sources without serializing objects or actor identities",()=>{
  for(const access of ["owner","self","manager"] as const){
    const c=command(access),base=exportWire(c),w={...base,report:{...base.report,sourceVersion:v2,items:base.report.items.map(i=>({...i,effect:{...effect(),employeeId:id(2)}}))}};
    const r=source(w,c,v2);assert(r.report);const text=csv(r.report,r.receipt);
    for(const value of [v2,"lineage.rootOperationId","lineage.previousOperationId",id(40),id(41),"25200000001"])assert(text.includes(value));
    assert(!text.includes("[object Object]"));assert(!text.includes("actorEmployeeId"));assert.throws(()=>source(w,c));
    const replay=source({...w,replayed:true,report:null},c,v2);assert.equal(replay.report,null);
  }
});
