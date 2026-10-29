// No arbitrary target, PID, state, timing, alternate path or skip parameters.
import path from 'node:path';import{fileURLToPath}from'node:url';import{randomUUID}from'node:crypto';
import{withReviewedBookingExecution}from'./release-toolchain-authority.mjs';
import{withOnlineRetentionLocks}from'./online-release-retention-writer.mjs';
import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';
import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';
import{verifyClosedActiveBookingPreparation}from'./release-toolchain-active-generation-profile.mjs';
import{qualifyClosedPreRouteIncident,verifyLatestActiveBookingQualification}from'./release-toolchain-active-generation-qualification.mjs';
import{preservePreRouteRefusal}from'./release-toolchain-pre-route-evidence.mjs';
import{canonicalJson,publicFailure,requireToolchain as need}from'./release-toolchain-contracts.mjs';
const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
try{need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory&&/^[a-f0-9]{40}$/.test(toolRevision),'unsupported_runtime');need(process.argv.length===3&&['qualify','preserve'].includes(process.argv[2]),'invalid_contract');
 const result=await withReviewedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyClosedActiveBookingPreparation},()=>withOnlineRetentionLocks(async lock=>{if(process.argv[2]==='preserve'){verifyLatestActiveBookingQualification({lock,toolRevision});return preservePreRouteRefusal({lock,toolRevision});}const at=Date.now(),window={id:randomUUID(),startedAt:new Date(at).toISOString(),deadlineAt:new Date(at+600000).toISOString()};return qualifyClosedPreRouteIncident({lock,toolRevision,window});}));console.log(canonicalJson(result));
}catch(error){console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),formalStateNotInferred:true,applicationPublished:false,mailEnabled:false}));process.exitCode=1;}
