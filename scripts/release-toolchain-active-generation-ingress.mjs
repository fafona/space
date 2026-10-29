// New active profile only. The original inactive gate and its validator are
// unchanged. The temporary response identifies the ACTUAL Nginx worker so a
// single 503 cannot conceal another still-ungated worker in the same cohort.
import {isDeepStrictEqual} from 'node:util';
import {createProductionBookingIngressPlan,bookingIngressSnippet,BOOKING_INGRESS_MAIN_SHA256} from './booking-handoff-ingress.mjs';
import {assertActiveBookingWindow} from './release-toolchain-active-generation-contract.mjs';
import {canonicalJson,sha256,requireToolchain as need} from './release-toolchain-contracts.mjs';
const same=(a,b)=>need(isDeepStrictEqual(a,b),'evidence_invalid');
export function activeBookingIngressSnippet(window){assertActiveBookingWindow(window,{nowMs:Date.parse(window?.startedAt)});const original=bookingIngressSnippet(window),before='"operation":"'+window.id+'"}',after='"operation":"'+window.id+'","workerPid":$pid}';need(original.split(before).length===2,'evidence_invalid');return original.replace(before,after);}
export function createActiveBookingIngressPlan({vhostText,mainSha256,window}){
 const original=createProductionBookingIngressPlan({vhostText,mainSha256,window}),before=bookingIngressSnippet(window),snippet=activeBookingIngressSnippet(window);need(original.afterText.split(before).length===2,'evidence_invalid');const afterText=original.afterText.replace(before,snippet);
 return{...original,schemaVersion:2,kind:'booking-already-active-ingress-gate',afterText,afterSha256:sha256(afterText),snippetSha256:sha256(snippet)};
}
export function assertActiveBookingIngressPlan(plan){same(plan,createActiveBookingIngressPlan({vhostText:plan?.beforeText,mainSha256:BOOKING_INGRESS_MAIN_SHA256,window:plan?.window}));return true;}
export function activeBookingIngressRestorationText(plan,current){assertActiveBookingIngressPlan(plan);need(current===plan.beforeText||current===plan.afterText,'owned_resource_changed');return plan.beforeText;}
function cohort(rows){need(Array.isArray(rows)&&rows.length>0&&rows.length<=128,'observation_mismatch');const result=rows.map(value=>{need(Number.isSafeInteger(value?.pid)&&value.pid>1&&/^[1-9][0-9]*$/.test(value.startTicks??''),'observation_mismatch');return{pid:value.pid,startTicks:value.startTicks};}).sort((a,b)=>a.pid-b.pid);need(new Set(result.map(value=>value.pid)).size===result.length,'observation_mismatch');return result;}
// Pure IO seam: no signal, reload, arbitrary PID, admission or retry of a
// mutation. Failed responses are never counted. A changing cohort must itself
// be completely observed gated before returning; deadline cannot be renewed.
export async function proveActiveBookingGatedWorkerCohort(operations,window){
 const first=operations.nowMs();assertActiveBookingWindow(window,{nowMs:first});const deadline=Math.min(first+15000,Date.parse(window.deadlineAt)),seen=new Map(),expected=operations.expectedWorkerCount??null;need(expected===null||Number.isSafeInteger(expected)&&expected>0&&expected<=128,'invalid_contract');let last=first;
 for(let index=0;index<256;index++){
  const at=operations.nowMs();need(Number.isSafeInteger(at)&&at>=last,'ingress_clock_invalid');last=at;need(at<deadline,'gate_not_confirmed');await operations.verify();const before=cohort(await operations.workers()),response=await operations.probe();
  if(response?.status===503&&response.value?.ok===false&&response.value.error==='booking_temporarily_paused'&&response.value.operation===window.id){const row=before.find(row=>row.pid===response.value.workerPid);if(row)seen.set(row.pid,row.startTicks);}
  await operations.verify();const after=cohort(await operations.workers()),now=operations.nowMs();need(Number.isSafeInteger(now)&&now>=last&&now<deadline,'gate_not_confirmed');last=now;
  if((expected===null||after.length===expected)&&isDeepStrictEqual(before,after)&&after.every(row=>seen.get(row.pid)===row.startTicks))return{kind:'active-booking-current-nginx-cohort-gated',window:structuredClone(window),workers:after,workersSha256:sha256(canonicalJson(after)),completedAt:new Date(now).toISOString(),mutationPerformed:false};
  await operations.wait(25);
 }
 need(false,'gate_not_confirmed');
}
