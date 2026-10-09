import { validatePeriodWorkArrangements } from "./merchantAttendanceWorkArrangementContext";
import { validatePeriodPosthocContext } from "./merchantAttendancePeriodPosthocContext";
import { periodSourceWithoutOutages, validatePeriodOutageContext } from "./merchantAttendancePeriodOutageContext";
import { periodAdministrativeHoursUnassessed, periodSourceWithoutAdministrativeClosures, validatePeriodAdministrativeContext } from "./merchantAttendancePeriodAdministrativeContext";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { UNIFIED_REPORT_ERRORS, type UnifiedReport, type UnifiedAmounts } from "./merchantAttendanceUnifiedTimesheet";
import { parsePeriodDelegationArtifactAuthority, validatePeriodDelegatedArtifactFrame,
  type PeriodDelegatedReport, type PeriodDelegationArtifactAuthority } from "./merchantAttendancePeriodDelegatedArtifact";

export type PeriodClosureQuery = { siteId:string; access:"owner"|"self"; workerId:string; fromDate:string; throughDate:string;
  mode:"list"|"preview"|"detail"|"recover"|"export"; periodId:string|null; operationId:string|null; version:number|null };
export type PeriodClosureCommand = { action:"send"|"confirm"|"dispute"|"respond"|"seal"|"reopen"; operationId:string; periodId:string;
  expectedRevision:number; expectedVersion:number; expectedFingerprint:string|null; reason:string };
export type PeriodClosureWorker = { workerId:string; employeeId:string; employeeAuthUserId:string; workerName:string; workerNo:string };
export type PeriodClosureRange = { fromDate:string; throughDate:string; timeZone:string; startAt:string; endAt:string };
export type PeriodClosureSummary = PeriodClosureWorker & PeriodClosureRange & { periodId:string; revision:number; currentVersion:number;
  state:"open"|"review"|"confirmed"|"disputed"|"sealed"; sealed:boolean; confirmedVersion:number|null; unresolvedDispute:boolean };
export type PeriodClosureEntry = { operationId:string; revision:number; action:PeriodClosureCommand["action"]; version:number;
  actorId:string; reason:string; recordedAt:string; command:PeriodClosureCommand };
export type PeriodClosureLegacyArtifact = { protocol:"attendance-period-artifact-v1"; sourceFingerprint:string; source:Record<string,unknown>;
  worker:PeriodClosureWorker; period:PeriodClosureRange; report:UnifiedReport;
  dayBoundaries:{date:string;fromAt:string;toAt:string;skipped:boolean}[]; calculationVersion:"timesheet-v2-unified-v1" };
export type PeriodDelegatedArtifactDraft = Omit<PeriodClosureLegacyArtifact,"protocol"|"report"> & {
  protocol:"attendance-period-artifact-v2"; report:PeriodDelegatedReport };
export type PeriodDelegatedArtifact = PeriodDelegatedArtifactDraft & {authority:PeriodDelegationArtifactAuthority};
export type PeriodClosureArtifact = PeriodClosureLegacyArtifact | PeriodDelegatedArtifact;
export type PeriodClosureIdentity = { ownerId?:string; employeeId?:string; authUserId?:string };
type Common = { protocol:"period-closure-v1"; siteId:string; workerId:string; actorId:string; access:"owner"|"self"; readAt:string };
export type PeriodClosureResult = Common & (
  { kind:"list"; items:PeriodClosureSummary[] } |
  { kind:"preview"; preview:{artifact:PeriodClosureArtifact;blockers:string[];period:PeriodClosureSummary|null} } |
  { kind:"detail"; period:PeriodClosureSummary; artifact:PeriodClosureArtifact|null; artifactVersion:number|null;
    history:PeriodClosureEntry[]; sourceChanged:boolean|null; operation:PeriodClosureEntry|null; replayed:boolean });
export type PeriodClosureResponse = {ok:true;moduleEnabled:boolean;data:PeriodClosureResult};
export const PERIOD_CLOSURE_ERRORS:Readonly<Record<string,number>> = { ...UNIFIED_REPORT_ERRORS,attendance_work_arrangement_too_large:422,attendance_work_arrangement_invalid:503,attendance_work_arrangement_binding_changed:409,
  attendance_period_closure_invalid:503, attendance_period_source_invalid:503, attendance_period_identity_unproven:409,
  attendance_period_source_identity_changed:409, attendance_period_source_identity_unproven:409,
  attendance_period_source_too_large:422, attendance_period_source_changed:409, attendance_period_blocked:409,
  attendance_period_sealed:409, attendance_period_not_sealed:409, attendance_period_not_confirmed:409,
  attendance_period_not_found:404, attendance_period_limit:422, attendance_period_overlap:409,
  attendance_period_protocol_required:409, attendance_period_storage_limit:422,
  attendance_period_identity_changed:409, attendance_operation_conflict:409, attendance_version_conflict:409,
  attendance_operation_not_found:404, attendance_invalid_request:400, attendance_not_available:404,
  attendance_module_disabled:403, attendance_invalid_content_type:415, attendance_body_too_large:413,
  attendance_rate_limited:429, attendance_unavailable:503 };
export const periodClosureFail = (code="attendance_period_closure_invalid"):never => {throw new MerchantAttendanceError(code);};
export const periodClosureObject = (v:unknown):Record<string,unknown> => v!==null&&typeof v==="object"&&!Array.isArray(v)
  && Object.getPrototypeOf(v)===Object.prototype && Object.keys(v).every(k=>!["__proto__","prototype","constructor"].includes(k))
  && Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>Object.hasOwn(d,"value")&&d.enumerable) ? v as Record<string,unknown> : periodClosureFail();
const obj=periodClosureObject;
const exact=(v:unknown,keys:string[])=>{const x=obj(v);if(Object.keys(x).length!==keys.length||keys.some(k=>!Object.hasOwn(x,k)))periodClosureFail();return x;};
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)?v:periodClosureFail();
const text=(v:unknown,max:number,empty=false)=>typeof v==="string"&&v===v.trim()&&v.length<=max&&(empty||v.length>0)&&!/[\u0000-\u001f\u007f]/.test(v)?v:periodClosureFail();
const integer=(v:unknown,min=0,max=9007199254740989)=>Number.isSafeInteger(v)&&!Object.is(v,-0)&&Number(v)>=min&&Number(v)<=max?Number(v):periodClosureFail();
const bool=(v:unknown)=>typeof v==="boolean"?v:periodClosureFail();
const date=(v:unknown)=>typeof v==="string"&&/^(?:20\d{2}|2100)-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v?v:periodClosureFail();
const instant=(v:unknown)=>typeof v==="string"&&/^(?:20\d{2}|2100|2101)-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,23)===v.slice(0,23)?v:periodClosureFail();
const fingerprint=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v)?v:periodClosureFail();
function boundedTree(raw:unknown){let count=0;function walk(v:unknown,d:number){if(++count>160000||d>32)periodClosureFail();if(v===null||typeof v==="boolean")return;
  if(typeof v==="number"){if(!Number.isFinite(v))periodClosureFail();return;}if(typeof v==="string"){if(v.length>2097152)periodClosureFail();return;}
  if(Array.isArray(v)){if(v.length>5000||Object.getPrototypeOf(v)!==Array.prototype||Object.keys(v).length!==v.length
    ||Object.entries(Object.getOwnPropertyDescriptors(v)).some(([k,p])=>k!=="length"&&(!/^(0|[1-9]\d*)$/.test(k)||!Object.hasOwn(p,"value")||!p.enumerable)))periodClosureFail();for(const x of v)walk(x,d+1);return;}for(const x of Object.values(obj(v)))walk(x,d+1);}
  walk(raw,0);if(new TextEncoder().encode(JSON.stringify(raw)).length>4194304)periodClosureFail();}
export function periodClosureSame(a:unknown,b:unknown):boolean {if(a===b)return true;if(a===null||b===null||typeof a!=="object"||typeof b!=="object")return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>periodClosureSame(v,b[i]));
  const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>,keys=Object.keys(aa);return keys.length===Object.keys(bb).length&&keys.every(k=>Object.hasOwn(bb,k)&&periodClosureSame(aa[k],bb[k]));}
export function parsePeriodClosureQuery(raw:unknown):PeriodClosureQuery {try{const v=exact(raw,["siteId","access","workerId","fromDate","throughDate","mode","periodId","operationId","version"]);
  const siteId=text(v.siteId,8);if(!/^\d{8}$/.test(siteId)||!["owner","self"].includes(String(v.access))||!["list","preview","detail","recover","export"].includes(String(v.mode)))periodClosureFail();
  const fromDate=date(v.fromDate),throughDate=date(v.throughDate),days=(Date.parse(throughDate)-Date.parse(fromDate))/86400000;
  if(days<0||days>30)periodClosureFail();const periodId=v.periodId===null?null:uuid(v.periodId),operationId=v.operationId===null?null:uuid(v.operationId),version=v.version===null?null:integer(v.version,1,20);
  if(v.mode==="list"&&(periodId!==null||operationId!==null||version!==null)||v.mode==="preview"&&(operationId!==null||version!==null)
    ||["detail","recover","export"].includes(String(v.mode))&&periodId===null
    ||(v.mode==="recover")!==(operationId!==null)||v.mode==="export"&&version===null)periodClosureFail();
  return {siteId,access:v.access as PeriodClosureQuery["access"],workerId:uuid(v.workerId),fromDate,throughDate,mode:v.mode as PeriodClosureQuery["mode"],periodId,operationId,version};
 }catch{return periodClosureFail("attendance_invalid_request");}}
export function periodClosureQueryString(q:PeriodClosureQuery){const p=new URLSearchParams();for(const [k,v] of Object.entries(parsePeriodClosureQuery(q)))if(v!==null)p.set(k,String(v));return p.toString();}
export function parsePeriodClosureHttpQuery(url:string):PeriodClosureQuery{const p=new URL(url).searchParams,allowed=["siteId","access","workerId","fromDate","throughDate","mode","periodId","operationId","version"];
  for(const k of p.keys())if(!allowed.includes(k)||p.getAll(k).length!==1)periodClosureFail("attendance_invalid_request");
  const raw=Object.fromEntries(allowed.map(k=>[k,p.get(k)]));if(raw.version!==null){if(!/^[1-9]\d?$/.test(raw.version))periodClosureFail("attendance_invalid_request");return parsePeriodClosureQuery({...raw,version:Number(raw.version)});}return parsePeriodClosureQuery(raw);}
function command(raw:unknown):PeriodClosureCommand{const v=exact(raw,["action","operationId","periodId","expectedRevision","expectedVersion","expectedFingerprint","reason"]);
  if(!["send","confirm","dispute","respond","seal","reopen"].includes(String(v.action)))periodClosureFail();
  const action=v.action as PeriodClosureCommand["action"],expectedRevision=integer(v.expectedRevision,0,100),expectedVersion=integer(v.expectedVersion,0,20),reason=text(v.reason,500,["send","confirm"].includes(action));
  const expectedFingerprint=v.expectedFingerprint===null?null:fingerprint(v.expectedFingerprint);
  if(action!=="send"&&(expectedRevision===0||expectedVersion===0)||["send","confirm","seal"].includes(action)&&expectedFingerprint===null)periodClosureFail();
  return {action,operationId:uuid(v.operationId),periodId:uuid(v.periodId),expectedRevision,expectedVersion,expectedFingerprint,reason};}
export function parsePeriodClosureCommand(q:PeriodClosureQuery,raw:unknown):PeriodClosureCommand{try{const c=command(raw);if(q.mode!=="detail"||q.periodId!==c.periodId||q.version!==null
  ||q.access==="owner"&&["confirm","dispute"].includes(c.action)||q.access==="self"&&!["confirm","dispute"].includes(c.action))periodClosureFail();return c;}catch{return periodClosureFail("attendance_invalid_request");}}
export function parsePeriodClosureBody(raw:unknown){try{const v=exact(raw,["query","command"]),query=parsePeriodClosureQuery(v.query);return {query,command:parsePeriodClosureCommand(query,v.command)};}catch{return periodClosureFail("attendance_invalid_request");}}
function worker(raw:unknown):PeriodClosureWorker{const v=exact(raw,["workerId","employeeId","employeeAuthUserId","workerName","workerNo"]);return {workerId:uuid(v.workerId),employeeId:uuid(v.employeeId),employeeAuthUserId:uuid(v.employeeAuthUserId),workerName:text(v.workerName,120),workerNo:text(v.workerNo,40)};}
function range(raw:unknown):PeriodClosureRange{const v=exact(raw,["fromDate","throughDate","timeZone","startAt","endAt"]),fromDate=date(v.fromDate),throughDate=date(v.throughDate),startAt=instant(v.startAt),endAt=instant(v.endAt);
  if(fromDate>throughDate||(Date.parse(throughDate)-Date.parse(fromDate))/86400000>30||startAt>=endAt)periodClosureFail();return {fromDate,throughDate,timeZone:text(v.timeZone,100),startAt,endAt};}
function summary(raw:unknown,q:PeriodClosureQuery,who:PeriodClosureIdentity):PeriodClosureSummary{const v=exact(raw,["workerId","employeeId","employeeAuthUserId","workerName","workerNo","fromDate","throughDate","timeZone","startAt","endAt","periodId","revision","currentVersion","state","sealed","confirmedVersion","unresolvedDispute"]);
  const w=worker(Object.fromEntries(["workerId","employeeId","employeeAuthUserId","workerName","workerNo"].map(k=>[k,v[k]]))),r=range(Object.fromEntries(["fromDate","throughDate","timeZone","startAt","endAt"].map(k=>[k,v[k]])));
  if(w.workerId!==q.workerId||r.fromDate!==q.fromDate||r.throughDate!==q.throughDate||q.access==="self"&&(who.employeeId&&who.employeeId!==w.employeeId||who.authUserId&&who.authUserId!==w.employeeAuthUserId))periodClosureFail();
  const currentVersion=integer(v.currentVersion,1,20),confirmedVersion=v.confirmedVersion===null?null:integer(v.confirmedVersion,1,currentVersion),sealed=bool(v.sealed),state=v.state as PeriodClosureSummary["state"];
  if(!["open","review","confirmed","disputed","sealed"].includes(state)||sealed!==(state==="sealed")||sealed&&confirmedVersion!==currentVersion)periodClosureFail();
  return {...w,...r,periodId:uuid(v.periodId),revision:integer(v.revision,1,100),currentVersion,state,sealed,confirmedVersion,unresolvedDispute:bool(v.unresolvedDispute)};}
const amountKeys=["elapsedUs","breakUs","paidBreakUs","workedUs"] as const;
function amounts(raw:unknown,difference=false){const v=exact(raw,[...amountKeys]);for(const k of amountKeys)integer(v[k],difference?-9007199254740989:0);if(Number(v.workedUs)!==Number(v.elapsedUs)-Number(v.breakUs))periodClosureFail();return v;}
function totals(raw:unknown):UnifiedAmounts{const v=obj(raw);for(const k of ["original","recordedSelected","missingSelected","selected","difference"] as const)amounts(v[k],k==="difference");
  for(const k of amountKeys){if(Number(obj(v.selected)[k])!==Number(obj(v.recordedSelected)[k])+Number(obj(v.missingSelected)[k])||Number(obj(v.difference)[k])!==Number(obj(v.selected)[k])-Number(obj(v.original)[k]))periodClosureFail();}return v as unknown as UnifiedAmounts;}
// Archive reads validate stored values; NEVER rerun current Intl/day-boundary or
// current report algorithms. A new calculation belongs in a new source version.
function artifactCore(raw:unknown,kind:"legacy"|"draft"|"saved",completeSource=false){boundedTree(raw);const v=exact(raw,["protocol","sourceFingerprint","source","worker","period","report","dayBoundaries","calculationVersion",...(kind==="saved"?["authority"]:[])]);
  if(v.protocol!==(kind==="legacy"?"attendance-period-artifact-v1":"attendance-period-artifact-v2")||v.calculationVersion!=="timesheet-v2-unified-v1")periodClosureFail();const w=worker(v.worker),p=range(v.period),r=obj(v.report),b=obj(r.base);
  if(r.version!=="attendance-unified-v1"||r.complete!==true||r.payrollReady!==false||!(kind==="legacy"?["owner","self"].includes(String(r.access)):r.access==="delegate")||b.workerId!==w.workerId||b.fromDate!==p.fromDate||b.throughDate!==p.throughDate||b.timeZone!==p.timeZone||b.fromAt!==p.startAt||b.toAt!==p.endAt)periodClosureFail();
  totals(r.totals);if(!Array.isArray(r.days)||r.days.length>31||!Array.isArray(r.missing)||!Array.isArray(b.rows)||r.missing.length+b.rows.length>100)periodClosureFail();
  validatePeriodAdministrativeContext(v.source,w,p,r,completeSource);
  for(const d of r.days as unknown[]){date(obj(d).date);totals(d);}for(const row of b.rows as unknown[]){const x=obj(row),s=obj(x.selected),o=obj(x.original);uuid(x.startEventId);instant(s.startAt);if(s.endAt!==null)instant(s.endAt);instant(o.startAt);if(o.endAt!==null)instant(o.endAt);
    if(!(obj(v.source).sourceVersion==="attendance-period-source-v5"&&x.administrativeBoundary)){amounts(x.selectedInPeriod);amounts(x.originalInPeriod);}}
  for(const m of r.missing as unknown[]){const x=obj(m);uuid(x.requestId);uuid(x.operationId);const s=obj(x.proposal);instant(s.startAt);instant(s.endAt);amounts(x.inPeriod);}
  if(!Array.isArray(v.dayBoundaries)||v.dayBoundaries.length<1||v.dayBoundaries.length>31)periodClosureFail();const seen=new Set<string>();
  const boundaries=(v.dayBoundaries as unknown[]).map(raw=>{const d=exact(raw,["date","fromAt","toAt","skipped"]),day=date(d.date),fromAt=instant(d.fromAt),toAt=instant(d.toAt),skipped=bool(d.skipped);if(seen.has(day)||day<p.fromDate||day>p.throughDate||fromAt>toAt||skipped!==(fromAt===toAt))periodClosureFail();seen.add(day);return {date:day,fromAt,toAt,skipped};});
  if(boundaries.length!==1+(Date.parse(p.throughDate)-Date.parse(p.fromDate))/86400000||boundaries[0].fromAt!==p.startAt||boundaries.at(-1)!.toAt!==p.endAt||boundaries.some((d,i)=>i>0&&boundaries[i-1].toAt!==d.fromAt))periodClosureFail();
  const previousSource=periodSourceWithoutAdministrativeClosures(v.source,completeSource);
  validatePeriodOutageContext(previousSource,w,p,completeSource);
  const legacySource=periodSourceWithoutOutages(previousSource,completeSource);
  validatePeriodWorkArrangements(legacySource,w,p);
  validatePeriodPosthocContext(legacySource,w,p,completeSource);
  return {v,sourceFingerprint:fingerprint(v.sourceFingerprint),source:obj(v.source),worker:w,period:p,report:r,dayBoundaries:boundaries,calculationVersion:"timesheet-v2-unified-v1" as const};}
/** Only this candidate parser permits a v2 artifact without immutable authority. */
export function parsePeriodDelegatedArtifactDraft(raw:unknown):PeriodDelegatedArtifactDraft{
  const {v:_wire,...core}=artifactCore(raw,"draft");void _wire;
  const draft:PeriodDelegatedArtifactDraft={...core,protocol:"attendance-period-artifact-v2",report:core.report as unknown as PeriodDelegatedReport};
  validatePeriodDelegatedArtifactFrame(draft);return draft;
}
export function parsePeriodClosureArtifact(raw:unknown):PeriodClosureArtifact{
  const kind=obj(raw).protocol==="attendance-period-artifact-v2"?"saved":"legacy",{v,...core}=artifactCore(raw,kind);
  if(kind==="legacy")return {...core,protocol:"attendance-period-artifact-v1",report:core.report as unknown as UnifiedReport};
  const draft:PeriodDelegatedArtifactDraft={...core,protocol:"attendance-period-artifact-v2",report:core.report as unknown as PeriodDelegatedReport};
  validatePeriodDelegatedArtifactFrame(draft);
  return {...draft,authority:parsePeriodDelegationArtifactAuthority(v.authority,draft)};
}
/** Private fresh-source reuse only. This never changes saved-archive parsing,
 * claims a persisted artifact or grants period/write authority. */
export function parseCompletePeriodClosureSourceArtifact(raw:unknown):PeriodClosureLegacyArtifact{
  const {v:_wire,...core}=artifactCore(raw,"legacy",true);void _wire;
  return {...core,protocol:"attendance-period-artifact-v1",report:core.report as unknown as UnifiedReport};
}
function entry(raw:unknown):PeriodClosureEntry{const v=exact(raw,["operationId","revision","action","version","actorId","reason","recordedAt","command"]),c=command(v.command);if(v.action!==c.action||v.operationId!==c.operationId||v.reason!==c.reason||v.revision!==c.expectedRevision+1
  ||v.version!==c.expectedVersion&&(c.action!=="send"||v.version!==c.expectedVersion+1))periodClosureFail();
  return {operationId:uuid(v.operationId),revision:integer(v.revision,1,100),action:c.action,version:integer(v.version,1,20),actorId:uuid(v.actorId),reason:c.reason,recordedAt:instant(v.recordedAt),command:c};}
export function parsePeriodClosureResult(raw:unknown,q:PeriodClosureQuery,who:PeriodClosureIdentity={},cmd?:PeriodClosureCommand|null):PeriodClosureResult{boundedTree(raw);const v=obj(raw);
  exact(v,["protocol","siteId","workerId","actorId","access","readAt","kind",...(v.kind==="list"?["items"]:v.kind==="preview"?["preview"]:["period","artifact","artifactVersion","history","sourceChanged","operation","replayed"])]);
  if(v.protocol!=="period-closure-v1"||v.siteId!==q.siteId||v.workerId!==q.workerId||v.access!==q.access)periodClosureFail();const actorId=uuid(v.actorId);if(who.authUserId&&who.authUserId!==actorId||q.access==="owner"&&who.ownerId&&who.ownerId!==actorId)periodClosureFail();
  const common:Common={protocol:"period-closure-v1",siteId:q.siteId,workerId:q.workerId,access:q.access,actorId,readAt:instant(v.readAt)};
  if(q.access==="self")who={...who,authUserId:actorId};
  if(v.kind==="list"&&q.mode==="list"){if(!Array.isArray(v.items)||v.items.length>20)periodClosureFail();const items=(v.items as unknown[]).map(x=>summary(x,q,who));if(new Set(items.map(x=>x.periodId)).size!==items.length||q.access==="self"&&items.some(x=>x.employeeAuthUserId!==actorId))periodClosureFail();return {...common,kind:"list",items};}
  if(v.kind==="preview"&&q.mode==="preview"){const p=exact(v.preview,["artifact","blockers","period"]),a=parsePeriodClosureArtifact(p.artifact),head=p.period===null?null:summary(p.period,q,who);if(head&&head.periodId!==q.periodId||q.periodId!==null&&!head||a.worker.workerId!==q.workerId||a.period.fromDate!==q.fromDate||a.period.throughDate!==q.throughDate||q.access==="self"&&(who.employeeId&&a.worker.employeeId!==who.employeeId||who.authUserId&&a.worker.employeeAuthUserId!==who.authUserId)||!Array.isArray(p.blockers)||p.blockers.length>30)periodClosureFail();
    if(a.protocol==="attendance-period-artifact-v2"&&(a.authority.siteId!==q.siteId||a.authority.periodId!==(head?.periodId??q.periodId)))periodClosureFail();
    // An existing period must never preview a newly interpreted timezone/range
    // beside an old head. Reject that mismatch before exposing a Send action.
    if(head&&(a.worker.employeeId!==head.employeeId||a.worker.employeeAuthUserId!==head.employeeAuthUserId
      ||a.period.timeZone!==head.timeZone||a.period.startAt!==head.startAt||a.period.endAt!==head.endAt))periodClosureFail();
    const blockers=(p.blockers as unknown[]).map(x=>text(x,100));
    if(periodAdministrativeHoursUnassessed(a.source)!==blockers.includes("administrative_hours_unassessed"))periodClosureFail();
    return {...common,kind:"preview",preview:{artifact:a,blockers,period:head}};}
  if(v.kind!=="detail"||!["detail","recover","export"].includes(q.mode))periodClosureFail();const p=summary(v.period,q,who);if(p.periodId!==q.periodId)periodClosureFail();
  const a=v.artifact===null?null:parsePeriodClosureArtifact(v.artifact),artifactVersion=v.artifactVersion===null?null:integer(v.artifactVersion,1,p.currentVersion);if((a===null)!==(artifactVersion===null)||q.access==="self"&&p.employeeAuthUserId!==actorId||q.version!==null&&q.version!==artifactVersion||a&&(a.worker.employeeId!==p.employeeId||a.worker.employeeAuthUserId!==p.employeeAuthUserId||a.worker.workerId!==p.workerId||a.period.startAt!==p.startAt||a.period.endAt!==p.endAt))periodClosureFail();
  if(a?.protocol==="attendance-period-artifact-v2"&&(a.authority.siteId!==q.siteId||a.authority.periodId!==p.periodId))periodClosureFail();
  if(!Array.isArray(v.history)||v.history.length>100)periodClosureFail();const history=(v.history as unknown[]).map(entry);if(history.some((x,i)=>x.command.periodId!==p.periodId||x.revision>p.revision||i>0&&history[i-1].revision>=x.revision))periodClosureFail();
  const operation=v.operation===null?null:entry(v.operation),replayed=bool(v.replayed);if(history.length!==p.revision||history.some((x,i)=>x.revision!==i+1)||new Set(history.map(x=>x.operationId)).size!==history.length
    ||operation&&(!history.some(x=>periodClosureSame(x,operation))||operation.actorId!==actorId||operation.version!==artifactVersion)
    ||replayed&&!operation||cmd&&(!operation||!periodClosureSame(operation.command,cmd))||q.mode==="recover"&&(!operation||operation.operationId!==q.operationId))periodClosureFail();
  return {...common,kind:"detail",period:p,artifact:a,artifactVersion,history,sourceChanged:v.sourceChanged===null?null:bool(v.sourceChanged),operation,replayed};}
export function parsePeriodClosureResponse(raw:unknown,q:PeriodClosureQuery,who:PeriodClosureIdentity={},cmd?:PeriodClosureCommand|null):PeriodClosureResponse{const v=exact(raw,["ok","moduleEnabled","data"]);if(v.ok!==true)periodClosureFail();return {ok:true,moduleEnabled:bool(v.moduleEnabled),data:parsePeriodClosureResult(v.data,q,who,cmd)};}
export function periodClosureMessage(code:string){return ({attendance_period_sealed:"该员工周期已封存，请负责人填写理由重开后再补正或申报漏卡。",attendance_period_source_changed:"资料已变化，请重新读取并送审新版本；旧确认不会继承。",attendance_period_blocked:"仍有未结束班次或待处理问题，暂不能封存。",attendance_period_not_confirmed:"须先由员工明确确认，处理完争议后才能封存。",attendance_period_identity_unproven:"历史归属尚无法可靠核实，不能交给当前员工签认。",attendance_period_identity_changed:"员工归属已变化，旧资料已隐藏。",attendance_period_limit:"周期版本或操作已达本地首版上限，请联系负责人核查。",attendance_period_overlap:"这个员工已有相交的周期，请进入原周期处理。",attendance_operation_not_found:"暂未找到该操作回执，请保留编号稍后核查，不要重复提交。",attendance_access_denied:"当前权限已失效，资料已隐藏。",attendance_version_conflict:"周期已被其他操作更新，请重新读取。"} as Record<string,string>)[code]??"暂时无法完成周期核对，请保留操作编号并重新核查。";}
