// Shared ordered boundary: old generation drain -> complete gate proof -> data work.
// No Nginx, DB, signals, timers, network or source admission is hidden here.
import {requireToolchain} from './release-toolchain-contracts.mjs';
export async function drainAndProbeIngress(operations,{startedAtMs,deadlineAtMs,window}){
 let previous=startedAtMs;
 const now=()=>{const value=operations.nowMs();requireToolchain(Number.isSafeInteger(value)&&value>=previous&&value>=startedAtMs,'ingress_clock_invalid');previous=value;return value;};
 requireToolchain(Number.isSafeInteger(startedAtMs)&&Number.isSafeInteger(deadlineAtMs)&&deadlineAtMs>startedAtMs&&deadlineAtMs-startedAtMs<=90000,'invalid_contract');
 requireToolchain(now()<deadlineAtMs,'ingress_not_drained');await operations.authorize();
 const workers=await operations.workers();await operations.begin({window,workers,startedAt:operations.now()});
 await operations.install();await operations.syntax();await operations.reload();
 let proof;while(now()<deadlineAtMs){
  await operations.authorize();proof=await operations.drain(workers);
  requireToolchain(Number.isSafeInteger(proof?.oldWorkersRemaining)&&proof.oldWorkersRemaining>=0&&Number.isSafeInteger(proof.applicationConnections)&&proof.applicationConnections>=0,'observation_mismatch');
  if(proof.oldWorkersRemaining===0&&proof.applicationConnections===0)break;await operations.wait(250);
 }
 requireToolchain(proof?.oldWorkersRemaining===0&&proof.applicationConnections===0&&now()<deadlineAtMs,'ingress_not_drained');
 await operations.authorize();await operations.probeGate();
 // A slow gate probe cannot consume the entire original drain budget unnoticed.
 requireToolchain(now()<deadlineAtMs,'ingress_not_drained');return {workers,proof};
}
