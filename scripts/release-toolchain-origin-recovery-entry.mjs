// Fixed source / existing-operation qualification and closure commands only.
// Publication is still the original canonical publisher with all its checks.
import * as fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {withReviewedRetainedBookingExecution} from './release-toolchain-authority.mjs';import {withOriginRecoveryPreparationLocks} from './online-release-retention-writer.mjs';
import {verifyOriginRecoveryPreparation,closeOriginRecoveredFailure,inspectOriginRecoveryContinuation,readOriginRecoveryClosed} from './release-toolchain-origin-recovery-closure.mjs';
import {qualifyClosedPreRouteIncident,verifyLatestActiveBookingQualification} from './release-toolchain-active-generation-qualification.mjs';
import {ORIGIN_RECOVERY as H} from './release-toolchain-origin-recovery-contract.mjs';import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';import {BOOKING_PREPARATION_REVISION} from './release-toolchain-booking-profile.mjs';
import {captureProcessFact} from './check-production-runtime-supervision.mjs';import {canonicalJson,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
const invocation=()=>need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory&&/^[a-f0-9]{40}$/.test(toolRevision)&&toolRevision!==H.priorTool,'unsupported_runtime');
export async function runOriginRecoveryPreparation(action){
 invocation();need(['qualify','close'].includes(action),'invalid_contract');return withReviewedRetainedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyOriginRecoveryPreparation},async()=>{
  const result=await withOriginRecoveryPreparationLocks({toolRevision},(lock,{window})=>action==='qualify'?qualifyClosedPreRouteIncident({lock,toolRevision,window}):closeOriginRecoveredFailure({lock,toolRevision,window}));if(action==='close')await inspectOriginRecoveryContinuation(toolRevision,null);return result;
 });
}
export async function ensureOriginRecoveredBeforePublication(revision){
 invocation();sameRevision(revision);need(process.argv.length===3&&process.argv[2]==='publish'&&JSON.stringify(captureProcessFact(process.pid).commandLine)===JSON.stringify(['/usr/bin/node',directory+'/scripts/release-toolchain-active-generation-publish-entry.mjs','publish']),'unsupported_runtime');
 if(fs.existsSync(H.root))return readOriginRecoveryClosed(toolRevision);if(!fs.existsSync(H.publication))return null;
 return withReviewedRetainedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyOriginRecoveryPreparation},async()=>{
  await withOriginRecoveryPreparationLocks({toolRevision},(lock,{window})=>fs.existsSync('/var/lib/faolla-booking-active-qualifications/'+P.operationId+'/'+toolRevision)?verifyLatestActiveBookingQualification({lock,toolRevision}):qualifyClosedPreRouteIncident({lock,toolRevision,window}));
  const result=await withOriginRecoveryPreparationLocks({toolRevision},(lock,{window})=>closeOriginRecoveredFailure({lock,toolRevision,window}));await inspectOriginRecoveryContinuation(toolRevision,null);return result;
 });
}
function sameRevision(revision){need(revision===toolRevision,'source_changed');}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{need(process.argv.length===3,'invalid_contract');const result=await runOriginRecoveryPreparation(process.argv[2]);console.log(canonicalJson(result));}catch(error){console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),formalStateNotInferred:true,applicationPublished:false,mailEnabled:false}));process.exitCode=1;}}
