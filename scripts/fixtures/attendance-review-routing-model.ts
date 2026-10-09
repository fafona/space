// Synthetic protocol fixtures only: no database grant, login or approval proof.
// Hashes deliberately use an independent scalar-array encoder, not the parser.
import {createHash} from "node:crypto";
import type {ReviewRoutingAssignment,ReviewRoutingCommand,ReviewRoutingData,ReviewRoutingEntry,ReviewRoutingFamily,ReviewRoutingObservation,ReviewRoutingQuery,ReviewRoutingReceipt,ReviewRoutingRequest,ReviewRoutingResult} from "../../src/lib/merchantAttendanceReviewRouting";
export type RoutingMutable<T> = T extends object ? {-readonly [P in keyof T]:RoutingMutable<T[P]>} : T;
export const routingId=(n:number)=>`19800000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const routingSite="99990001",routingOwner=routingId(1),routingReadAt="2026-10-08T12:00:00.000000Z";
export function routingEncode(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(routingEncode).join(", ")+"]";
  if(value===null||typeof value==="boolean"||typeof value==="string"||typeof value==="number"&&Number.isSafeInteger(value)&&!Object.is(value,-0))return JSON.stringify(value);
  throw Error("synthetic_tuple_invalid");
}
export const routingHash=(value:unknown)=>createHash("sha256").update(routingEncode(value),"utf8").digest("hex");
export function routingRequest(family:ReviewRoutingFamily="correction",n=100):RoutingMutable<ReviewRoutingRequest>{
  return {family,category:family==="correction_revision"?"correction":family==="missing_revision"?"missing":family,requestId:routingId(n),workerId:routingId(2),employeeId:routingId(3),employeeAuthUserId:routingId(4),
    submittedRevision:family==="correction"?3:family==="correction_revision"?5:1,submittedAt:"2026-10-08T08:00:00.000000Z",kind:family==="work_arrangement"?"trip":null};
}
export const routingRequestTuple=(r:ReviewRoutingRequest)=>[r.family,r.category,r.requestId,r.workerId,r.employeeId,r.employeeAuthUserId,r.submittedRevision,r.submittedAt,r.kind];
export function routingEntryHash(r:ReviewRoutingRequest,e:Omit<ReviewRoutingEntry,"entryFingerprint">):string{
  const o=e.origin,a=e.assignment,origin=o.kind==="manual_registration"?[o.kind]:[o.kind,o.activationRevision,o.observedAt,o.sourceFingerprint,o.selection,o.selectedLayer,o.desired.kind==="owner"?["owner"]:["delegate",o.desired.employeeId,o.desired.authUserId]];
  const assignment=a.kind==="owner"?[a.kind,a.authUserId]:a.kind==="needs_assignment"?[a.kind,a.reason,[a.desired.employeeId,a.desired.authUserId]]:[a.kind,a.employeeId,a.authUserId,a.grantId,a.grantType,a.delegateGeneration,a.employeeGeneration,a.epochProofKind,a.validFrom,a.validUntil];
  return routingHash(["attendance-review-routing-entry-v1",routingSite,routingRequestTuple(r),e.operationId,e.revision,e.action,e.actorId,e.recordedAt,e.reason,e.previousOperationId,origin,assignment,e.commandFingerprint]);
}
export function routingDelegate(family:ReviewRoutingFamily="correction"):RoutingMutable<Extract<ReviewRoutingAssignment,{kind:"delegate"}>>{
  return {kind:"delegate",employeeId:routingId(10),authUserId:routingId(11),grantId:routingId(12),grantType:family==="correction"?"correction":family==="missing"||family==="missing_revision"?"missing":"application",
    delegateGeneration:2,employeeGeneration:3,epochProofKind:family==="correction"?"embedded":"sidecar",validFrom:"2026-10-08T07:00:00.000000Z",validUntil:"2026-12-01T00:00:00.000000Z"};
}
export function routingCapture(r=routingRequest(),patch:Partial<ReviewRoutingEntry>={}):RoutingMutable<ReviewRoutingEntry>{
  const e={operationId:r.requestId,revision:1,action:"capture" as const,actorId:r.employeeAuthUserId,recordedAt:"2026-10-08T08:00:00.001000Z",reason:null,previousOperationId:null,
    origin:{kind:"rule_capture" as const,activationRevision:1,observedAt:"2026-10-08T08:00:00.001000Z",sourceFingerprint:"a".repeat(64),selection:r.family==="correction_revision"?"owner_only_revision" as const:"unconfigured" as const,selectedLayer:null,desired:{kind:"owner" as const}},
    assignment:{kind:"owner" as const,authUserId:routingOwner},commandFingerprint:null,...patch};
  return structuredClone({...e,entryFingerprint:routingEntryHash(r,e)}) as RoutingMutable<ReviewRoutingEntry>;
}
export function routingObservation(r:ReviewRoutingRequest,current:ReviewRoutingEntry|null,owner=routingOwner,patch:Partial<ReviewRoutingObservation>={}):RoutingMutable<ReviewRoutingObservation>{
  const a=current?.assignment;
  const o={requestRevision:r.submittedRevision,requestHeadOperationId:r.requestId,status:"submitted" as const,bindingCurrent:true,
    routeState:!a?"unregistered" as const:a.kind==="needs_assignment"?"needs_assignment" as const:a.kind==="owner"&&a.authUserId!==owner?"handover_needed" as const:"assigned" as const,
    reason:a?.kind==="needs_assignment"?a.reason:a?.kind==="owner"&&a.authUserId!==owner?"owner_changed" as const:null,checkedAt:routingReadAt,...patch};
  return {...o,observationFingerprint:routingHash(["attendance-review-routing-observation-v1",routingSite,routingRequestTuple(r),current?.entryFingerprint??null,owner,o.requestRevision,o.requestHeadOperationId,o.status,o.bindingCurrent,o.routeState,o.reason])};
}
export function routingResult(data:ReviewRoutingData,receipt:ReviewRoutingReceipt|null=null,actorId=routingOwner):RoutingMutable<ReviewRoutingResult>{
  return structuredClone({protocol:"attendance-review-routing-v1",siteId:routingSite,actorId,readAt:routingReadAt,data,receipt}) as RoutingMutable<ReviewRoutingResult>;
}
export function routingDetail(family:ReviewRoutingFamily="correction",current?:ReviewRoutingEntry|null){
  const request=routingRequest(family),head=current===undefined?routingCapture(request):current,observation=routingObservation(request,head);
  const query={siteId:routingSite,mode:"detail" as const,family,requestId:request.requestId};
  const data={kind:"detail" as const,request,current:head,observation,canRegister:family!=="correction_revision"&&observation.routeState==="unregistered",canTakeOver:false};
  return {query,wire:routingResult(data),request,current:head};
}
export function routingCommand(patch:Partial<ReviewRoutingCommand>={}):RoutingMutable<ReviewRoutingCommand>{return {action:"register",operationId:routingId(300),expectedResponsibilityRevision:0,expectedResponsibilityOperationId:null,expectedRequestRevision:3,expectedObservationFingerprint:"b".repeat(64),grantId:routingId(12),reason:"明确登记 😀",...patch};}
export function routingCommandHash(q:Extract<ReviewRoutingQuery,{mode:"detail"|"self"}>,c:ReviewRoutingCommand,actor=routingOwner){
  return routingHash(["attendance-review-routing-command-v1",q.siteId,actor,q.family,q.requestId,[c.action,c.operationId,c.expectedResponsibilityRevision,c.expectedResponsibilityOperationId,c.expectedRequestRevision,c.expectedObservationFingerprint,c.grantId,c.reason]]);
}
export function routingReceipt(q=routingDetail().query,c=routingCommand(),actor=routingOwner):RoutingMutable<ReviewRoutingReceipt>{return {operationId:c.operationId,family:q.family,requestId:q.requestId,revision:c.expectedResponsibilityRevision+1,action:c.action,actorId:actor,recordedAt:"2026-10-08T08:10:00.000000Z",commandFingerprint:routingCommandHash(q,c,actor)};}
export function routingManualHistory(r=routingRequest(),count=27):RoutingMutable<ReviewRoutingEntry>[] {
  const items:RoutingMutable<ReviewRoutingEntry>[]=[];
  for(let n=1;n<=count;n++){
    const e={operationId:routingId(400+n),revision:n,action:n%2?"register" as const:"take_over" as const,actorId:routingOwner,recordedAt:`2026-10-08T09:00:${String(n).padStart(2,"0")}.000000Z`,reason:"合成旧责任记录，不是实际历史",previousOperationId:n===1?null:items[n-2].operationId,
      origin:{kind:"manual_registration" as const},assignment:n%2?routingDelegate(r.family):{kind:"owner" as const,authUserId:routingOwner},commandFingerprint:"c".repeat(64)};
    items.push({...e,entryFingerprint:routingEntryHash(r,e)});
  }
  return items.reverse();
}
