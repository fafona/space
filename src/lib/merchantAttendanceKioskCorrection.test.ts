import assert from "node:assert/strict";
import test from "node:test";
import {parseCorrectionResult} from "./merchantAttendanceCorrection";
import {parseCorrectionReviewResult} from "./merchantAttendanceCorrectionReview";
import {parseCurrentCorrectionDecision} from "./merchantAttendanceCurrentCorrectionDecision";
import {parseAttendanceRevisionResult} from "./merchantAttendanceRevision";
import {parseRevisionCycleResult} from "./merchantAttendanceRevisionCycle";
import {parseRevisionApprovalResult} from "./merchantAttendanceRevisionApproval";
import {correctionBasis,correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
import {correctionReviewDetail,reviewQuery} from "../../scripts/fixtures/attendance-correction-review-model";
import {decisionResponse,decisionQuery} from "../../scripts/fixtures/attendance-correction-decision-model";
import {revisionResponse,revisionQuery} from "../../scripts/fixtures/attendance-revision-model";
import {wire as cycleWire} from "../../scripts/fixtures/attendance-revision-cycle-model";
import {revisionApprovalResponse} from "../../scripts/fixtures/attendance-revision-approval-model";

// Change synthetic session projections only, never actual records or source attribution.
function changeBases<T>(value:T,change:(basis:Record<string,unknown>)=>void):T {
  const copy=structuredClone(value);
  const visit=(v:unknown)=>{
    if(!v||typeof v!=="object")return;
    const o=v as Record<string,unknown>;
    if(Array.isArray(o.events)&&typeof o.workerId==="string"&&typeof o.employeeId==="string")change(o);
    for(const child of Object.values(o))visit(child);
  };visit(copy);return copy;
}
const sources=(value:unknown,items:readonly string[])=>changeBases(value,b=>{
  (b.events as Record<string,unknown>[]).forEach((e,n)=>{e.source=items[n%items.length];});
});
const cases:{name:string;wire:()=>unknown;parse:(v:unknown)=>unknown}[]=[
  {name:"self correction",wire:()=>{const b=correctionBasis();return {siteId:b.siteId,employeeId:b.employeeId,workerId:b.workerId,asOf:b.asOf,mode:"prepare",canRequest:true,basis:b,revision:0,pendingRequestId:null};},
    parse:v=>parseCorrectionResult(v,{siteId:correctionBasis().siteId,expectedWorkerId:correctionBasis().workerId,mode:"prepare",startEventId:id(10)})},
  {name:"owner evidence",wire:correctionReviewDetail,parse:v=>parseCorrectionReviewResult(v,reviewQuery)},
  {name:"current correction",wire:()=>{
    const {timesheetIntegrated,...r}=decisionResponse("approve");assert.equal(timesheetIntegrated,false);
    const e=r.effective!,b=r.review.application.basis;
    return {...r,protocol:"correction-decision-v2",current:{...e,action:"approve",originalLastEventId:b.events.at(-1)!.id,employeeId:b.employeeId,
      lineage:{rootRequestId:decisionQuery.requestId,rootOperationId:e.operationId,rootRecordedAt:e.recordedAt,previousOperationId:null}},
    blockers:[...r.blockers,"already_effective"],writeEnabled:true,replayed:false,effectiveChanged:false};
  },parse:v=>parseCurrentCorrectionDecision(v,decisionQuery)},
  {name:"initial revision",wire:revisionResponse,parse:v=>parseAttendanceRevisionResult(v,revisionQuery)},
  {name:"continuous revision",wire:cycleWire,parse:v=>parseRevisionCycleResult(v,revisionQuery)},
  {name:"revision approval",wire:revisionApprovalResponse,parse:v=>{const w=revisionApprovalResponse();return parseRevisionApprovalResult(v,{siteId:w.siteId,requestId:w.requestId,operationId:null});}},
];
for(const c of cases){
  for(const pattern of [["web"],["kiosk"],["kiosk","web"],["web","kiosk"]])test(`${c.name} accepts ${pattern.join("/")} without relabeling or mutating evidence`,()=>{
    const wire=sources(c.wire(),pattern),before=structuredClone(wire),parsed=c.parse(wire);
    assert.deepEqual(wire,before);
    const found:string[]=[];changeBases(parsed,b=>{found.push(...(b.events as {source:string}[]).map(e=>e.source));});
    assert(found.length>=2);assert.equal(found[0],pattern[0]);assert.equal(found[1],pattern[1]??pattern[0]);
  });
  test(`${c.name} still rejects unknown/null source and mismatched worker/member`,()=>{
    for(const source of ["unknown","",null])assert.throws(()=>c.parse(changeBases(c.wire(),b=>{Object.assign((b.events as object[])[0],{source});})));
    for(const key of ["workerId","employeeId"])assert.throws(()=>c.parse(changeBases(c.wire(),b=>{b[key]=id(999);})));
  });
}
