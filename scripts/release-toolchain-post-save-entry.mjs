// No supplied paths, PIDs, timing, target, skip, save or activation option.
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {withReviewedBookingExecution} from './release-toolchain-authority.mjs';
import {withPostSaveBookingPreparationLocks} from './online-release-retention-writer.mjs';
import {BOOKING_PREPARATION_REVISION} from './release-toolchain-booking-profile.mjs';
import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {verifyPostSavePreparation} from './release-toolchain-post-save-profile.mjs';
import {qualifyPostSaveBookingIncident} from './release-toolchain-active-generation-qualification.mjs';
import {completePostSaveBookingIncident} from './release-toolchain-post-save-closure.mjs';
import {inspectClosedActiveBookingIncidentForPreparation} from './release-toolchain-active-generation-closed-incident.mjs';
import {canonicalJson,publicFailure,requireToolchain as need} from './release-toolchain-contracts.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
try{
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory&&/^[a-f0-9]{40}$/.test(toolRevision),'unsupported_runtime');need(process.argv.length===3&&['qualify','close'].includes(process.argv[2]),'invalid_contract');
 const action=process.argv[2],result=await withReviewedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyPostSavePreparation},async()=>{const result=await withPostSaveBookingPreparationLocks({toolRevision},(lock,{window})=>action==='qualify'?qualifyPostSaveBookingIncident({lock,toolRevision,window}):completePostSaveBookingIncident({lock,toolRevision,window}));if(action==='close')await inspectClosedActiveBookingIncidentForPreparation(toolRevision);return result;});console.log(canonicalJson(result));
}catch(error){console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),closureConfirmed:false,formalStateNotInferred:true,mailEnabled:false}));process.exitCode=1;}
