// Qualification of NEW source after the exact 6e closure. No close/reconcile,
// publication, old-attempt retry, caller timestamps, PID/path or skip options.
import * as fs from'node:fs';import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{randomUUID}from'node:crypto';
import{PROC_WITNESS_PRIOR as H}from'./release-toolchain-proc-witness-contract.mjs';
import{withReviewedRetainedBookingExecution}from'./release-toolchain-authority.mjs';
import{withOnlineRetentionLocks}from'./online-release-retention-writer.mjs';
import{BOOKING_PREPARATION_REVISION}from'./release-toolchain-booking-profile.mjs';
import{verifyClosedActiveBookingPreparation}from'./release-toolchain-active-generation-profile.mjs';
import{qualifyClosedPreRouteIncident}from'./release-toolchain-active-generation-qualification.mjs';
import{ACTIVE_BOOKING_INCIDENT as P}from'./release-toolchain-active-generation-contract.mjs';
import{canonicalJson,publicFailure,requireToolchain as need}from'./release-toolchain-contracts.mjs';
export async function qualifyProcWitnessSource(){
 const directory=path.dirname(path.dirname(fileURLToPath(import.meta.url))),toolRevision=path.basename(directory);
 need(process.platform==='linux'&&process.getuid?.()===0&&process.execPath==='/usr/bin/node'&&directory==='/var/lib/faolla-online-code/'+toolRevision&&process.cwd()===directory&&/^[a-f0-9]{40}$/.test(toolRevision)&&toolRevision!==H.toolRevision,'unsupported_runtime');
 need(process.argv.length===3&&process.argv[2]==='qualify'&&fs.existsSync(H.closedDirectory+'/closed.json'),'invalid_contract');
 return withReviewedRetainedBookingExecution({applicationRevision:P.candidate,preparationRevision:BOOKING_PREPARATION_REVISION,verifyPreparation:verifyClosedActiveBookingPreparation},()=>withOnlineRetentionLocks(lock=>{
  need(!fs.existsSync('/var/lib/faolla-booking-active-qualifications/'+P.operationId+'/'+toolRevision),'attempt_replay_forbidden');
  const start=Date.now(),window={id:randomUUID(),startedAt:new Date(start).toISOString(),deadlineAt:new Date(start+600000).toISOString()};
  return qualifyClosedPreRouteIncident({lock,toolRevision,window});
 }));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)qualifyProcWitnessSource().then(value=>console.log(canonicalJson(value)),error=>{console.error(canonicalJson({...publicFailure(error,{stage:'candidate'}),formalStateNotInferred:true,applicationPublished:false,mailEnabled:false}));process.exitCode=1;});
