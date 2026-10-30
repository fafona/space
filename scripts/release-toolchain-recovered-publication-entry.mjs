// One canonical entry for qualification -> audited disposition -> the existing
// publisher. No force, skip, target, resource-path or expired-lease option.
import * as fs from'node:fs';import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';
import{withReviewedRetainedBookingExecution}from'./release-toolchain-authority.mjs';
import{withRecoveredPublicationDispositionLocks}from'./online-release-retention-writer.mjs';
import{verifyRecoveredPublicationPreparation,closeRecoveredPublication,readRecoveredPublicationClosed,inspectRecoveredPublicationContinuation}from'./release-toolchain-recovered-publication-host.mjs';
import{qualifyClosedPreRouteIncident,verifyLatestActiveBookingQualification}from'./release-toolchain-active-generation-qualification.mjs';
import{RECOVERED_PUBLICATION as R}from'./release-toolchain-recovered-publication-contract.mjs';
import{INTERRUPTED_RECOVERY as H}from'./release-toolchain-interrupted-recovery-contract.mjs';
import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';
import{captureProcessFact}from'./check-production-runtime-supervision.mjs';import{canonicalJson,publicFailure,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(source);
const invocation=()=>need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&source==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===source&&/^[a-f0-9]{40}$/.test(toolRevision),'unsupported_runtime');
export function hasRecoveredPublicationDisposition(){return fs.existsSync(H.root+'/recovery/completed.json')||fs.existsSync(R.root);}
async function underReviewed(work){return withReviewedRetainedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyRecoveredPublicationPreparation},()=>withRecoveredPublicationDispositionLocks({toolRevision},work));}
export async function runRecoveredPublicationDisposition(action){invocation();need(['qualify','close'].includes(action),'invalid_contract');const result=await underReviewed((lock,{window})=>(action==='qualify'?qualifyClosedPreRouteIncident:closeRecoveredPublication)({lock,toolRevision,window}));if(action==='close')await inspectRecoveredPublicationContinuation(toolRevision,null);return result;}
export async function ensureRecoveredPublicationBeforePublication(revision){
 invocation();need(revision===toolRevision&&process.argv.length===3&&process.argv[2]==='publish'&&canonicalJson(captureProcessFact(process.pid).commandLine)===canonicalJson(['/usr/bin/node',source+'/scripts/release-toolchain-active-generation-publish-entry.mjs','publish']),'unsupported_runtime');
 if(fs.existsSync(R.root))return readRecoveredPublicationClosed(toolRevision);
 // Qualification and disposition use distinct genuinely acquired fresh scopes.
 // An incomplete/failed qualification is not retried or replaced implicitly.
 await underReviewed((lock,{window})=>fs.existsSync('/var/lib/faolla-booking-active-qualifications/'+P.operationId+'/'+toolRevision)?verifyLatestActiveBookingQualification({lock,toolRevision}):qualifyClosedPreRouteIncident({lock,toolRevision,window}));
 const result=await underReviewed((lock,{window})=>closeRecoveredPublication({lock,toolRevision,window}));await inspectRecoveredPublicationContinuation(toolRevision,null);return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{need(process.argv.length===3,'invalid_contract');console.log(canonicalJson(await runRecoveredPublicationDisposition(process.argv[2])));}catch(error){console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),applicationPublished:false,mailEnabled:false,formalStateNotInferred:true}));process.exitCode=1;}}
