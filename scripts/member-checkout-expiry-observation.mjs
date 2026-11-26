// Owned PostgREST 14.5 test scheduling only. No application expiry policy changes.
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';

export const ownedExpiryObservationPolicy=Object.freeze({version:1,observationAfterMs:31000,proofAfterMs:34000,reads:2});

export async function observeOwnedGatewayExpiry({expiresAt,readStatus,signal,deadline,record},clock={wall:Date.now,mono:()=>performance.now(),sleep}){
  assert.ok(Number.isSafeInteger(expiresAt)&&expiresAt>0&&expiresAt<=Number.MAX_SAFE_INTEGER-34000);
  assert.equal(typeof readStatus,'function');assert.equal(typeof record,'function');assert.ok(signal instanceof AbortSignal);assert.ok(Number.isFinite(deadline));
  const check=()=>{signal.throwIfAborted();assert.ok(Number.isFinite(clock.mono())&&clock.mono()<deadline,'owned_expiry_deadline_exceeded');};
  const wall=()=>{const value=clock.wall();assert.ok(Number.isSafeInteger(value)&&value>0);return value;};
  const wait=async target=>{check();while(wall()<target){await clock.sleep(Math.min(250,target-wall()),undefined,{signal});check();}};
  const read=async phase=>{
    check();const startedAt=wall(),status=await readStatus();const endedAt=wall();
    const row=Object.freeze({phase,startedPastExpiryMs:startedAt-expiresAt,endedPastExpiryMs:endedAt-expiresAt,status});record(row);
    check();assert.ok(endedAt>=startedAt,'owned_expiry_clock_reversed');assert.ok([200,401].includes(status),'owned_expiry_status_unexpected');return row;
  };
  await wait(expiresAt+ownedExpiryObservationPolicy.observationAfterMs);
  const observation=await read('observation');
  // An already-late first sample cannot excuse an unexpected 200.
  if(observation.startedPastExpiryMs>=ownedExpiryObservationPolicy.proofAfterMs)assert.equal(observation.status,401,'owned_expiry_late_observation_not_refused');
  await wait(expiresAt+ownedExpiryObservationPolicy.proofAfterMs);
  const proof=await read('proof');assert.equal(proof.status,401,'owned_expiry_original_token_not_refused');
  return Object.freeze({version:1,observation,proof,reads:2,postgrestExpiredStatus:401,waitedPastExpiryMs:proof.endedPastExpiryMs,retriedOnFailure:false});
}
