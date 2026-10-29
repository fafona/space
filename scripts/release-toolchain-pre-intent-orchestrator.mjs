// One canonical controller, separate genuine lock windows. Existing historical
// review caches keep their original ten-minute freshness checks; each current
// source review/refresh and every native/host/backup check remains mandatory.
import * as fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';
import{PRE_INTENT as H}from'./release-toolchain-pre-intent-pins.mjs';
import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';
import{withReviewedRetainedBookingExecution}from'./release-toolchain-authority.mjs';
import{withPreIntentAbortPreparationLocks}from'./online-release-retention-writer.mjs';
import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';
import{verifyPreIntentAbortPreparation}from'./release-toolchain-pre-intent-profile.mjs';
import{qualifyClosedPreRouteIncident,verifyLatestActiveBookingQualification}from'./release-toolchain-active-generation-qualification.mjs';
import{closePreIntentAbort}from'./release-toolchain-pre-intent-closure.mjs';
import{inspectClosedActiveBookingIncidentForPreparation}from'./release-toolchain-active-generation-closed-incident.mjs';
import{captureProcessFact}from'./check-production-runtime-supervision.mjs';
import{requireToolchain as need}from'./release-toolchain-contracts.mjs';
// No effects or authority in this seam. A failed qualification/closure/audit
// can never enter the ordinary publication that follows the production call.
export async function executePreIntentQualificationAndClose(operations){
 await operations.qualifyOrVerifyExisting();const receipt=await operations.closeWithNewWindow();await operations.auditReleasedClosure(receipt);return receipt;
}
export async function ensurePinnedPreIntentReconciledBeforePublication(toolRevision){
 const directory='/var/lib/faolla-online-code/'+toolRevision;
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&path.dirname(path.dirname(fileURLToPath(import.meta.url)))===directory&&process.cwd()===directory&&process.argv.length===3&&process.argv[2]==='publish','unsupported_runtime');
 need(JSON.stringify(captureProcessFact(process.pid).commandLine)===JSON.stringify(['/usr/bin/node',directory+'/scripts/release-toolchain-active-generation-publish-entry.mjs','publish']),'unsupported_runtime');
 if(toolRevision===H.toolRevision||fs.existsSync(H.root)||!fs.existsSync('/var/lib/faolla-booking-active-publications/'+P.candidate+'/'+H.windowId))return null;
 return withReviewedRetainedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyPreIntentAbortPreparation},()=>executePreIntentQualificationAndClose({
  qualifyOrVerifyExisting:()=>withPreIntentAbortPreparationLocks({toolRevision},async(lock,{window})=>{
   const root='/var/lib/faolla-booking-active-qualifications/'+P.operationId+'/'+toolRevision;
   // A present partial/failed attempt is refused by the original latest reader,
   // never hidden by creating another attempt. Only absence starts qualification.
   return fs.existsSync(root)?verifyLatestActiveBookingQualification({lock,toolRevision}):qualifyClosedPreRouteIncident({lock,toolRevision,window});
  }),
  closeWithNewWindow:()=>withPreIntentAbortPreparationLocks({toolRevision},(lock,{window})=>closePreIntentAbort({lock,toolRevision,window})),
  auditReleasedClosure:()=>inspectClosedActiveBookingIncidentForPreparation(toolRevision)
 }));
}
