// Read-only settlement, not mutation authority. PM2 reports online before its
// instrumentation has finished registering. Keep the complete strict config
// comparison; never broaden the set of permitted changes to hide that race.
import {isDeepStrictEqual} from 'node:util';
import {bookingReadyWorkerConfiguration,assertBookingReadyWorkerRawTransition} from './booking-ready-worker.mjs';
import {requireToolchain as need,canonicalJson} from './release-toolchain-contracts.mjs';
const METADATA=Object.freeze(['created_at','pm_uptime','restart_time','pm_exec_path','exit_code','node_version','version','prev_restart_delay','unstable_restarts']);
export function assertActiveBookingWorkerConfigurationTransition(before,after){
 const expected={...before};for(const key of METADATA)if(Object.hasOwn(after,key))expected[key]=after[key];
 need(isDeepStrictEqual(after,expected),'observation_mismatch');return true;
}
export function activeBookingWorkerObservation(row,runtime,identity){
 return{pid:row.pid,restartCount:row.pm2_env.restart_time,script:row.pm2_env.pm_exec_path,status:row.pm2_env.status,
  configured:bookingReadyWorkerConfiguration(row.pm2_env),raw:runtime,identity};
}
export async function waitForActiveBookingWorkerSettlement({observe,before,script,now=()=>performance.now(),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 need(before?.pid>0&&Number.isSafeInteger(before.restartCount)&&typeof script==='string'&&script!==before.script,'invalid_contract');
 const deadline=now()+10000;let candidatePid=null,firstSeen=null,stableSince=null,last=null;
 for(let index=0;index<100&&now()<deadline;index++){
  let after;try{after=await observe();}catch(error){if(!['ENOENT','ESRCH'].includes(error.code)&&error.code!=='operation_unconfirmed')throw error;}
  const actual=after?.pid>0&&after.pid!==before.pid&&after.restartCount===before.restartCount+1&&after.script===script&&after.status==='online';
  if(actual){
   if(candidatePid!==after.pid){need(candidatePid===null,'attempt_unknown');candidatePid=after.pid;firstSeen=now();}
   let matches=false;try{assertActiveBookingWorkerConfigurationTransition(before.configured,after.configured);assertBookingReadyWorkerRawTransition(before.raw,after.raw,before.configured,after.configured);matches=true;}catch(error){if(error.code!=='observation_mismatch'&&!error.message?.startsWith('booking_ready_worker_'))throw error;}
   if(matches){const text=canonicalJson(after);if(text!==last){last=text;stableSince=now();}
    // Both minimum startup age and repeated *complete* observations are needed.
    if(now()-firstSeen>=1500&&now()-stableSince>=250)return after;
   }else{last=null;stableSince=null;}
  }else{last=null;stableSince=null;}
  await delay(100);
 }
 need(false,'attempt_unknown');
}
