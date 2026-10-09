//207 synthetic collector-shaped cases; SQL authority and real transactions are
//verified separately by the root-owned175 native acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validatePeriodPosthocContext } from "./merchantAttendancePeriodPosthocContext";
import { parsePlanPosthocEvidence } from "./merchantAttendancePlanPosthocEvidence";
import { parsePeriodClosureArtifact, type PeriodClosureRange, type PeriodClosureWorker } from "./merchantAttendancePeriodClosure";
import { projectPeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
import { validatePeriodWorkArrangements } from "./merchantAttendanceWorkArrangementContext";
import { buildPeriodClosureOutput, periodClosureSavedContext, PeriodClosureSavedReport } from "../components/enterprise/MerchantAttendancePeriodClosureWorkspace";
import { createPlanPosthocFormalCases } from "../../scripts/fixtures/attendance-plan-posthoc-formal-cases";
import { exceptionUiEvidence, exceptionUiId as id } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { periodClosureUiArtifact, periodClosureUiQuery } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { scheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";
import { workArrangementDetail } from "../../scripts/fixtures/attendance-work-arrangement-model";
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const range:PeriodClosureRange={fromDate:"2026-10-07",throughDate:"2026-10-09",timeZone:"UTC",startAt:"2026-10-07T00:00:00.000000Z",endAt:"2026-10-10T00:00:00.000000Z"};
function fixture(group="full_leave_no_work_no_rule"){
 const c=createPlanPosthocFormalCases().find(c=>c.group===group)!;assert(c);
 const f=c.facts,b=f.source.basis,e=exceptionUiEvidence();
 const {source: _fullApproval,...approval}=f.source.approval??{};void _fullApproval;
 const evidence=structuredClone(parsePlanPosthocEvidence({...e,policy:"owner-confirmed-plan-edges-posthoc-v3",fingerprint:f.fingerprint,observedAt:f.readAt,
  eligible:c.expectedDerived5.eligible,blockers:c.expectedDerived5.blockers,candidate:c.expectedDerived5.candidate,approval:f.source.approval?approval:null,
  sessions:b.sessions.map(s=>({startEventId:s.startEventId,lastEventId:s.lastEventId,lastSequence:s.lastSequence,effectOperationId:s.effect?.operationId??null})),
  contextRefs:{...e.contextRefs,leave:{limited:f.source.leave.limited,items:f.source.leave.items.map(x=>({requestId:x.requestId,operationId:x.operationId,revision:x.revision}))}},
  evaluation:{state:c.expectedDerived5.state,slot:{slotId:f.slot.id,locationId:f.slot.locationId,timeZone:f.slot.timeZone,startAt:f.slot.startAt,endAt:f.slot.endAt},
   posthoc:f.source.posthoc,observations:f.source.observations,leaveEdges:c.expectedDerived5.leaveEdges}}));
 const worker:PeriodClosureWorker={workerId:f.worker.workerId,employeeId:f.worker.employeeId,employeeAuthUserId:f.worker.employeeAuthUserId,workerName:f.worker.workerName,workerNo:f.worker.workerNo};
 const decision={operationId:id(207001),revision:2,actorId:f.actorId,kind:"decision",outcome:evidence.evaluation.state==="not_applicable"?"not_applicable":"confirmed",
  note:"Synthetic saved decision",decisionOperationId:null,recordedAt:f.readAt,evidence};
 const source={sourceVersion:"attendance-period-source-v3",siteId:f.siteId,workerId:worker.workerId,employeeId:worker.employeeId,employeeAuthUserId:worker.employeeAuthUserId,
  timeZone:range.timeZone,fromDate:range.fromDate,throughDate:range.throughDate,fromAt:range.startAt,toAt:range.endAt,
  context:{pendingCorrections:[],missing:[],leave:[],calendar:[],plans:{items:[{slot:f.slot}],sessions:[]},
   reviews:[{caseId:id(207000),slotId:f.slot.id,revision:2,latestDecision:decision,latestNote:null as unknown,read:null as unknown}],
   posthoc:[{slotId:f.slot.id,...structuredClone(f.source.posthoc)}]}};
 return {source,worker,range,slot:f.slot,decision};
}
function rawSource(withHead=true){
 const x=fixture(),template=scheduleEvidenceWire({empty:true}).attendance;
 //Mechanical date relocation of an empty valid source, not new work arithmetic.
 const report=JSON.parse(JSON.stringify(template).replace(/2026-09-(\d\d)/g,(_,day)=>new Date(Date.UTC(2026,8,Number(day)+36)).toISOString().slice(0,10))) as typeof template;
 const previous=periodClosureUiArtifact(),dayBoundaries=previous.dayBoundaries.map((d,n)=>({date:"2026-10-0"+(7+n),fromAt:"2026-10-0"+(7+n)+"T00:00:00.000000Z",toAt:"2026-10-"+String(8+n).padStart(2,"0")+"T00:00:00.000000Z",skipped:false}));
 const context:Record<string,unknown>=structuredClone(x.source.context);
 if(!withHead){delete context.posthoc;context.reviews=[];}
 const raw={...x.source,sourceVersion:withHead?"attendance-period-source-v3":"attendance-period-source-v1",context,dayBoundaries,report};
 const base=structuredClone(report.base) as unknown as Record<string,unknown>;
 for(const key of ["asOf","access","viewerEmployeeId","scopeRevision","locationId","coverage","accessValidUntil"])delete base[key];
 const canonical={...raw,report:{...report,base}} as Record<string,unknown>;
 delete (canonical.report as Record<string,unknown>).access;
 const sourceText=JSON.stringify(canonical);
 return {...raw,sourceCanonical:canonical,sourceText,sourceFingerprint:sha(sourceText),readAt:report.base.asOf,blockers:[],complete:true,validation:"owner_checked"};
}
const query={...periodClosureUiQuery(),fromDate:range.fromDate,throughDate:range.throughDate};
const bad=(source:unknown,x=fixture())=>assert.throws(()=>validatePeriodPosthocContext(source,x.worker,x.range),/attendance_period_closure_invalid/);

test("v3 full leave/not-applicable and required saved evidence validate without expanding the old report",()=>{
 for(const group of ["full_leave_no_work_no_rule","original_associated_zero_and_five_minute_rules"]){
  const x=fixture(group);assert.equal(validatePeriodPosthocContext(x.source,x.worker,x.range).length,1);
 }
 const before=projectPeriodClosureSource(rawSource(false),query),after=projectPeriodClosureSource(rawSource(),query);
 assert.deepEqual(after.artifact.report,before.artifact.report);assert.deepEqual(after.artifact.report.totals,before.artifact.report.totals);
 assert.notEqual(after.artifact.sourceFingerprint,before.artifact.sourceFingerprint);assert.equal(after.artifact.calculationVersion,before.artifact.calculationVersion);
});
test("new head makes an old saved v1 decision visible, with revoke/current-head distinction rather than fake current evidence",()=>{
 const x=fixture();x.source.context.reviews[0].latestDecision.evidence=exceptionUiEvidence() as typeof x.decision.evidence;
 x.decision.outcome="follow_up";
 assert.equal(validatePeriodPosthocContext(x.source,x.worker,x.range).length,1);
 const head=x.source.context.posthoc[0];head.revision=2;head.current!.revision=2;head.current!.action="revoke";head.current!.operationId=id(207010);head.selected=[];head.approval=null;
 assert.equal(validatePeriodPosthocContext(x.source,x.worker,x.range)[0].current!.action,"revoke");
});
test("saved old v3 decision can precede the latest apply/revoke, but cannot attest another same-revision head",()=>{
 const x=fixture();const head=x.source.context.posthoc[0];head.revision=2;head.current!.revision=2;head.current!.operationId=id(207010);head.current!.action="revoke";head.selected=[];head.approval=null;
 assert.equal(validatePeriodPosthocContext(x.source,x.worker,x.range).length,1);
 const forged=fixture();forged.source.context.posthoc[0].current!.reason="Different same-revision head";bad(forged.source);
});
test("context requires exact current dual identity, anchored sorted unique heads and no downgraded or empty v3 marker",()=>{
 for(const change of [
  (x:ReturnType<typeof fixture>)=>{x.source.employeeAuthUserId=id(999);},
  (x:ReturnType<typeof fixture>)=>{x.source.context.posthoc[0].current!.employeeId=id(999);},
  (x:ReturnType<typeof fixture>)=>{x.source.context.posthoc[0].slotId=id(999);},
  (x:ReturnType<typeof fixture>)=>{x.source.context.posthoc.push(structuredClone(x.source.context.posthoc[0]));},
  (x:ReturnType<typeof fixture>)=>{x.source.context.posthoc=[];},
  (x:ReturnType<typeof fixture>)=>{x.source.sourceVersion="attendance-period-source-v1";},
  (x:ReturnType<typeof fixture>)=>{x.source.context.reviews=[];},
 ]){const x=fixture();change(x);bad(x.source);}
});
test("compact malformed leave geometry, scope and outcome never become a valid period decision",()=>{
 for(const change of [
  (x:ReturnType<typeof fixture>)=>{x.decision.evidence.evaluation.leaveEdges.fullCoverage=false;},
  (x:ReturnType<typeof fixture>)=>{x.decision.evidence.evaluation.slot.locationId=id(999);},
  (x:ReturnType<typeof fixture>)=>{x.decision.outcome="confirmed";},
  (x:ReturnType<typeof fixture>)=>{x.decision.revision=1;x.source.context.reviews[0].revision=1;},
  (x:ReturnType<typeof fixture>)=>{x.decision.recordedAt="2026-10-08T00:00:00.000000Z";},
 ]){const x=fixture();change(x);bad(x.source);}
});
test("saved employee note and explicit read remain bound to decision and current employee Auth",()=>{
 const x=fixture(),review=x.source.context.reviews[0];review.revision=3;
 review.latestNote={operationId:id(207020),revision:3,actorId:x.worker.employeeAuthUserId,kind:"note",outcome:null,note:"Employee explanation",decisionOperationId:x.decision.operationId,recordedAt:x.decision.recordedAt,evidence:null};
 review.read={operationId:id(207021),decisionOperationId:x.decision.operationId,readAt:x.decision.recordedAt};
 assert.equal(validatePeriodPosthocContext(x.source,x.worker,x.range).length,1);
 (review.latestNote as {actorId:string}).actorId=id(999);bad(x.source);
});
test("v3 optional work-arrangement context retains v2 identity/span/nonempty enforcement",()=>{
 const x=fixture();assert.deepEqual(validatePeriodWorkArrangements(x.source,x.worker,x.range),[]);
 const {conflicts,conflictsFingerprint,issues,sealed,canWithdraw,canApprove,canReject,canCancel,...item}=workArrangementDetail();void conflicts;void conflictsFingerprint;void issues;void sealed;void canWithdraw;void canApprove;void canReject;void canCancel;
 //Use the already-valid historical work item and its own period; only the wrapper version differs.
 const worker={workerId:item.workerId,employeeId:item.employeeId,employeeAuthUserId:item.employeeAuthUserId},period={startAt:item.startAt,endAt:item.endAt};
 const source={sourceVersion:"attendance-period-source-v3",context:{workArrangements:[item]}};
 assert.equal(validatePeriodWorkArrangements(source,worker,period).length,1);
 assert.throws(()=>validatePeriodWorkArrangements({...source,context:{workArrangements:[]}},worker,period));
 assert.throws(()=>validatePeriodWorkArrangements(source,{...worker,employeeAuthUserId:id(999)},period));
});
test("old artifacts are byte-equivalent; new archived context/CSV/print is read offline without Intl or recalculated work",()=>{
 const old=periodClosureUiArtifact(),legacy=JSON.stringify(old),artifact=projectPeriodClosureSource(rawSource(),query).artifact,original=JSON.stringify(artifact);
 const saved=Intl.DateTimeFormat;
 try{
  Intl.DateTimeFormat=function(){throw new Error("No current timezone interpretation");} as unknown as typeof Intl.DateTimeFormat;
  assert.deepEqual(parsePeriodClosureArtifact(old),old);assert.equal(JSON.stringify(old),legacy);assert.equal(JSON.stringify(parsePeriodClosureArtifact(artifact)),original);
  const entries=periodClosureSavedContext(artifact),posthoc=entries.find(x=>x.key==="posthoc");assert(posthoc);
  assert.deepEqual(posthoc.value,(artifact.source.context as Record<string,unknown>).posthoc);
  const output=buildPeriodClosureOutput(artifact,id(207050),1);
  const rows=output.csv.replace(/^\ufeff/,"").trimEnd().split("\r\n").map(row=>[...row.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(cell=>cell[1].replaceAll('""','"')));
  for(const entry of entries){const row=rows.filter(row=>row[0]==="保存上下文完整证据"&&row[3]===entry.key);assert.equal(row.length,1);assert.deepEqual(JSON.parse(row[0][10]),entry.value);}
  const decode=(text:string)=>text.replace(/&(?:amp|lt|gt|quot|#39);/g,entity=>({"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'"})[entity]!);
  const printed=[...output.html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map(cell=>decode(cell[1])));
  for(const entry of entries){const row=printed.filter(row=>row[0]==="保存上下文完整证据"&&row[3]===entry.key);assert.equal(row.length,1);assert.deepEqual(JSON.parse(row[0][10]),entry.value);}
  assert(renderToStaticMarkup(<PeriodClosureSavedReport artifact={artifact}/>).includes("posthoc"));
 }finally{Intl.DateTimeFormat=saved;}
});
