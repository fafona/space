// No path, target, PID, skip, rewrite, force, replay or publication command.
import path from'node:path';import{fileURLToPath}from'node:url';
import{withReviewedRetainedBookingExecution as withReviewedBookingExecution}from'./release-toolchain-authority.mjs';
import{withPreConnectAbortPreparationLocks}from'./online-release-retention-writer.mjs';
import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';
import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';
import{verifyPreConnectAbortPreparation}from'./release-toolchain-preconnect-profile.mjs';
import{qualifyClosedPreRouteIncident}from'./release-toolchain-active-generation-qualification.mjs';
import{closePreConnectAbort}from'./release-toolchain-preconnect-closure.mjs';
import{inspectClosedActiveBookingIncidentForPreparation}from'./release-toolchain-active-generation-closed-incident.mjs';
import{canonicalJson,publicFailure,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
try{need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory&&/^[a-f0-9]{40}$/.test(toolRevision),'unsupported_runtime');need(process.argv.length===3&&['qualify','close'].includes(process.argv[2]),'invalid_contract');
 const action=process.argv[2],result=await withReviewedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyPreConnectAbortPreparation},async()=>{const receipt=await withPreConnectAbortPreparationLocks({toolRevision},(lock,{window})=>action==='qualify'?qualifyClosedPreRouteIncident({lock,toolRevision,window}):closePreConnectAbort({lock,toolRevision,window}));if(action==='close')await inspectClosedActiveBookingIncidentForPreparation(toolRevision);return receipt;});console.log(canonicalJson(result));
}catch(error){console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),formalStateNotInferred:true,applicationPublished:false,mailEnabled:false}));process.exitCode=1;}
