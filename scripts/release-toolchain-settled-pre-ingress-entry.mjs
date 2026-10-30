// No alternate action, resource selector, expired lease or retry argument.
import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';
import{withReviewedRetainedBookingExecution}from'./release-toolchain-authority.mjs';import{withSettledPreIngressLocks}from'./online-release-retention-writer.mjs';
import{verifySettledPreIngressPreparation,closeSettledPreIngress,readSettledPreIngressClosed,inspectSettledPreIngressContinuation}from'./release-toolchain-settled-pre-ingress-host.mjs';
import{qualifyClosedPreRouteIncident,verifyLatestActiveBookingQualification}from'./release-toolchain-active-generation-qualification.mjs';import{SETTLED_PRE_INGRESS as S}from'./release-toolchain-settled-pre-ingress-contract.mjs';import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';import{captureProcessFact}from'./check-production-runtime-supervision.mjs';import{canonicalJson,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(source);
const underReviewed=work=>withReviewedRetainedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifySettledPreIngressPreparation},()=>withSettledPreIngressLocks({toolRevision},work));
export async function ensureSettledPreIngressBeforePublication(revision){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&source==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===source&&revision===toolRevision&&process.argv.length===3&&process.argv[2]==='publish'&&canonicalJson(captureProcessFact(process.pid).commandLine)===canonicalJson(['/usr/bin/node',source+'/scripts/release-toolchain-active-generation-publish-entry.mjs','publish']),'unsupported_runtime');
 if(fs.existsSync(S.root))return readSettledPreIngressClosed(toolRevision);
 await underReviewed((lock,{window})=>fs.existsSync('/var/lib/faolla-booking-active-qualifications/'+P.operationId+'/'+toolRevision)?verifyLatestActiveBookingQualification({lock,toolRevision}):qualifyClosedPreRouteIncident({lock,toolRevision,window}));
 const result=await underReviewed((lock,{window})=>closeSettledPreIngress({lock,toolRevision,window}));await inspectSettledPreIngressContinuation(toolRevision,null);return result;
}
