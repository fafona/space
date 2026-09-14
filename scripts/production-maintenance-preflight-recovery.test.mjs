import assert from 'node:assert/strict';
import test from 'node:test';
import { withPreflightRecoveryFixture } from './test-helpers/maintenance-preflight-fixture.mjs';
import { MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION as AUTH, MAINTENANCE_PREFLIGHT_RECOVERY_INCIDENT as INCIDENT,
  validateMaintenancePreflightRecoveryState, validateMaintenancePreflightRecoveryPredecessor,
  reconstructMaintenancePreflightRecoveryPredecessor, assertMaintenancePreflightRecoveryProgress,
  encodeMaintenancePreflightRecoveryEvidence, decodeMaintenancePreflightRecoveryEvidence } from './production-maintenance-preflight-recovery.mjs';
test('one fixed preflight recovery retains exact failed v10 and same unused chance', {concurrency:false}, async t=>
 withPreflightRecoveryFixture(t,async base=>{
  const {fixture,build,copy,clock,predecessor,journalSteps,nextState}=base;
  const f=fixture(), next=build(f);
  assert.equal(next.version,11);assert.equal(next.revision,39);assert.equal(next.phase,'held');assert.equal(next.activeAttempt,3);
  assert.equal(INCIDENT.stateDigest,'06654f0d57a38ac823983762308a6dba2042d3b6a6b0c701116781bed4b6840c');
  assert.equal(INCIDENT.stateBytes,1923312);assert.equal(INCIDENT.revision,38);
  assert.equal(AUTH.authorizedAt,Date.parse('2026-09-14T17:48:01Z'));
  assert.equal(AUTH.expiresAt,Date.parse('2026-09-14T20:00:00Z'));assert.equal(AUTH.maximumAdditionalAttempts,0);
  for(const key of ['candidate','resumed','launchDisk','launchJournal','finalDump'])assert.equal(next[key],null);
  for(const key of ['runtime','database','recovery','continuation','buildRecovery','deadlineExtension','attemptRecovery','secondAttemptRecovery','budgetRecovery','windowRenewal','prelaunchRecovery'])assert.deepEqual(next[key],predecessor[key]);
  assert.equal(JSON.stringify(reconstructMaintenancePreflightRecoveryPredecessor(next,clock())),JSON.stringify(predecessor));
  assert.deepEqual(decodeMaintenancePreflightRecoveryEvidence(encodeMaintenancePreflightRecoveryEvidence(f.evidence)),f.evidence);
  assertMaintenancePreflightRecoveryProgress(f.state,next);
  for(const patch of [{phase:'held'},{revision:37},{version:9},{activeAttempt:4},{candidate:{}},{launchJournal:{}},{extra:true}])
   assert.throws(()=>validateMaintenancePreflightRecoveryPredecessor({...copy(predecessor),...patch},clock()));
  for(const now of [AUTH.authorizedAt-1,AUTH.expiresAt,AUTH.expiresAt+1])assert.throws(()=>validateMaintenancePreflightRecoveryState(next,clock(now)));
  for(const mutate of [s=>s.prelaunchRecovery.recoveredAt++,s=>s.preflightRecovery.authorization.expiresAt++,s=>s.preflightRecovery.predecessor.stateDigest='a'.repeat(64),s=>s.activeAttempt++]){
   const bad=copy(next);mutate(bad);assert.throws(()=>assertMaintenancePreflightRecoveryProgress(next,{...bad,revision:40}));
  }
  const failed={...nextState(next),phase:'failed-held'};assertMaintenancePreflightRecoveryProgress(next,failed);
  assert.throws(()=>assertMaintenancePreflightRecoveryProgress(failed,{...nextState(failed),phase:'held'}));
  const {candidate}=journalSteps(next);validateMaintenancePreflightRecoveryState(candidate,clock());
  assert.throws(()=>assertMaintenancePreflightRecoveryProgress(candidate,{...nextState(candidate),launchJournal:null}));
 }));
