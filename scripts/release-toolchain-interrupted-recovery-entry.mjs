import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {withReviewedRetainedBookingExecution} from './release-toolchain-authority.mjs';
import {withInterruptedPublicationRecoveryLocks} from './online-release-retention-writer.mjs';
import {verifyInterruptedRecoveryPreparation,qualifyInterruptedRecovery,recoverInterruptedPublication} from './release-toolchain-interrupted-recovery-host.mjs';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {BOOKING_PREPARATION_REVISION} from './release-toolchain-booking-profile.mjs';
import {canonicalJson,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
export async function runInterruptedRecovery(action){
 const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory&&/^[a-f0-9]{40}$/.test(toolRevision)&&['qualify','recover'].includes(action),'unsupported_runtime');
 return withReviewedRetainedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyInterruptedRecoveryPreparation},()=>withInterruptedPublicationRecoveryLocks({toolRevision},(lock,{window})=>(action==='qualify'?qualifyInterruptedRecovery:recoverInterruptedPublication)({lock,toolRevision,window})));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{need(process.argv.length===3,'invalid_contract');console.log(canonicalJson(await runInterruptedRecovery(process.argv[2])));}catch(e){console.error(canonicalJson({...publicFailure(e,{stage:'candidate'}),applicationPublished:false,mailEnabled:false,publicationRetryAllowed:false}));process.exitCode=1;}}
