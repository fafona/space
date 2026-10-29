// No alternate target, resource, path, timing, skip or inactive mode.
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {withReviewedRetainedBookingExecution as withReviewedBookingExecution} from './release-toolchain-authority.mjs';import {withOnlineRetentionLocks} from './online-release-retention-writer.mjs';
import {BOOKING_PREPARATION_REVISION} from './release-toolchain-booking-profile.mjs';import {verifyClosedActiveBookingPreparation} from './release-toolchain-active-generation-profile.mjs';
import {publishClosedActiveBookingUnderHeldLocks,auditReleasedActiveBookingPublication} from './release-toolchain-active-generation-publication.mjs';import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {canonicalJson,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
import {ensurePinnedPreIntentReconciledBeforePublication} from './release-toolchain-pre-intent-orchestrator.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
try{need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory&&/^[a-f0-9]{40}$/.test(toolRevision),'unsupported_runtime');need(process.argv.length===3&&process.argv[2]==='publish','invalid_contract');
 await ensurePinnedPreIntentReconciledBeforePublication(toolRevision);
 const result=await withReviewedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyClosedActiveBookingPreparation},async()=>{const receipt=await withOnlineRetentionLocks(lock=>publishClosedActiveBookingUnderHeldLocks({lock,toolRevision}));return auditReleasedActiveBookingPublication(receipt);});console.log(canonicalJson(result));
}catch(error){console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),publicationConfirmed:false,publicationState:'unconfirmed-evidence-preserved',formalStateNotInferred:true,mailEnabled:false}));process.exitCode=1;}
