// Independently reviewed fixed-source entry. QUALIFY and RECONCILE only; no
// publish, arbitrary target/path, supplied proof, skip flag or activation mode.
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {withReviewedBookingExecution} from './release-toolchain-authority.mjs';
import {withActiveBookingIncidentPreparationLocks} from './online-release-retention-writer.mjs';
import {BOOKING_PREPARATION_REVISION} from './release-toolchain-booking-profile.mjs';
import {verifyActiveBookingIncidentPreparation} from './release-toolchain-active-generation-profile.mjs';
import {qualifyActiveBookingIncident} from './release-toolchain-active-generation-qualification.mjs';
import {reconcileActiveBookingIncidentUnderHeldLocks} from './release-toolchain-active-generation-closure.mjs';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {canonicalJson,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
async function main(){
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory&&/^[a-f0-9]{40}$/.test(toolRevision),'unsupported_runtime');
 need(process.argv.length===3&&['qualify','reconcile'].includes(process.argv[2]),'invalid_contract');const action=process.argv[2];
 return withReviewedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyActiveBookingIncidentPreparation},()=>withActiveBookingIncidentPreparationLocks({toolRevision},(lock,{window})=>action==='qualify'?qualifyActiveBookingIncident({lock,toolRevision,window}):reconcileActiveBookingIncidentUnderHeldLocks({lock,toolRevision,window})));
}
try{console.log(canonicalJson(await main()));}catch(error){console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),applicationPublished:false,mailEnabled:false}));process.exitCode=1;}
