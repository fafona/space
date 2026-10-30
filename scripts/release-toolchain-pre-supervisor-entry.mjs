// No alternate action, resource selector, expired lease or retry argument.
import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';
import{withReviewedRetainedBookingExecution}from'./release-toolchain-authority.mjs';import{withPreSupervisorLocks}from'./online-release-retention-writer.mjs';
import{verifyPreSupervisorPreparation,closePreSupervisor,readPreSupervisorClosed,inspectPreSupervisorContinuation}from'./release-toolchain-pre-supervisor-host.mjs';
import{qualifyClosedPreRouteIncident,verifyLatestActiveBookingQualification}from'./release-toolchain-active-generation-qualification.mjs';import{PRE_SUPERVISOR as S}from'./release-toolchain-pre-supervisor-contract.mjs';import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';import{captureProcessFact}from'./check-production-runtime-supervision.mjs';import{canonicalJson,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(source);
const underReviewed=work=>withReviewedRetainedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyPreSupervisorPreparation},()=>withPreSupervisorLocks({toolRevision},work));
export async function ensurePreSupervisorBeforePublication(revision){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&source==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===source&&revision===toolRevision&&process.argv.length===3&&process.argv[2]==='publish'&&canonicalJson(captureProcessFact(process.pid).commandLine)===canonicalJson(['/usr/bin/node',source+'/scripts/release-toolchain-active-generation-publish-entry.mjs','publish']),'unsupported_runtime');
 if(fs.existsSync(S.root))return readPreSupervisorClosed(toolRevision);
 await underReviewed((lock,{window})=>fs.existsSync('/var/lib/faolla-booking-active-qualifications/'+P.operationId+'/'+toolRevision)?verifyLatestActiveBookingQualification({lock,toolRevision}):qualifyClosedPreRouteIncident({lock,toolRevision,window}));
 const result=await underReviewed((lock,{window})=>closePreSupervisor({lock,toolRevision,window}));await inspectPreSupervisorContinuation(toolRevision,null);return result;
}
