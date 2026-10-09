// Pure synthetic protocol fixtures, never a database or real authentication.
import { createHash } from "node:crypto";
import { periodClosureUiArtifact, periodClosureUiCommand, periodClosureUiEntry, periodClosureUiQuery, periodClosureUiSummary,
  periodClosureUiOwner, periodClosureUiAuth, periodClosureUiPeriod } from "./attendance-period-closure-ui-model";
import { scheduleEvidenceWire } from "./attendance-schedule-evidence-model";
import type { PeriodClosureV2Query, PeriodClosureV2Command } from "../../src/lib/merchantAttendancePeriodClosureV2";

export const v2FixtureSha=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
export function periodClosureV2FixtureQuery(mode:PeriodClosureV2Query["mode"]="detail",access:"owner"|"self"="owner"):PeriodClosureV2Query {
  const original=periodClosureUiQuery(["history","versions"].includes(mode)?"detail":mode as "detail",access);
  return {...original,mode,cursor:null};
}
export function periodClosureV2FixtureResult(q=periodClosureV2FixtureQuery(),c:PeriodClosureV2Command|null=null) {
  const artifact=periodClosureUiArtifact(),period={...periodClosureUiSummary(),periodId:q.periodId??periodClosureUiPeriod},
    common={protocol:"period-closure-v2" as const,siteId:q.siteId,workerId:q.workerId,
      actorId:q.access==="owner"?periodClosureUiOwner:periodClosureUiAuth,access:q.access,readAt:"2026-09-11T12:00:00.000001Z"};
  if(q.mode==="list")return {...common,kind:"list" as const,items:[{...period,openedAt:"2026-09-11T10:00:00.000001Z"}],nextCursor:null};
  if(q.mode==="preview")return {...common,kind:"preview" as const,preview:{artifact,blockers:[],period:q.periodId?period:null}};
  if(q.mode==="history"||q.mode==="versions")throw Error("use exact page-specific fixtures for paginated evidence");
  const command=c??(q.mode==="recover"?{...periodClosureUiCommand(),operationId:q.operationId!}:null);
  const operation=command?periodClosureUiEntry(command):null;
  if(operation){period.revision=operation.revision;period.currentVersion=operation.version;}
  return {...common,kind:"detail" as const,period,artifact,artifactVersion:q.version??operation?.version??period.currentVersion,
    sourceChanged:q.mode==="recover"||q.mode==="export"?null:false,operation,replayed:q.mode==="recover"};
}
export function periodClosureV2FixtureRaw(q=periodClosureV2FixtureQuery(),c:PeriodClosureV2Command|null=null) {
  const result=periodClosureV2FixtureResult(q,c);if(result.kind!=="detail")return result;
  const artifactText=JSON.stringify(result.artifact);
  return {...result,artifactText,artifactBytes:Buffer.byteLength(artifactText,"utf8"),artifactSha256:v2FixtureSha(artifactText)};
}
export function periodClosureV2FixtureSource() {
  const report=scheduleEvidenceWire().attendance,a=periodClosureUiArtifact(),q=periodClosureUiQuery(),
    base=structuredClone(report.base) as unknown as Record<string,unknown>;delete base.asOf;
  const context={pendingCorrections:[],missing:[],leave:[],calendar:[],plans:{items:[],sessions:[]},reviews:[]};
  const canonical={sourceVersion:"attendance-period-source-v1",siteId:q.siteId,workerId:q.workerId,
    employeeId:a.worker.employeeId,employeeAuthUserId:a.worker.employeeAuthUserId,timeZone:"UTC",fromDate:q.fromDate,throughDate:q.throughDate,
    fromAt:report.base.fromAt,toAt:report.base.toAt,dayBoundaries:a.dayBoundaries,
    report:{version:report.version,base,missing:[],complete:true,payrollReady:false},context};
  const sourceText=JSON.stringify(canonical);
  return {...canonical,report,sourceCanonical:canonical,sourceText,sourceFingerprint:v2FixtureSha(sourceText),
    readAt:report.base.asOf,blockers:[] as string[],complete:true,validation:"owner_checked"};
}
