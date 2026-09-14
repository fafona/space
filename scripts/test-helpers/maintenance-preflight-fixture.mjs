import assert from "node:assert/strict";
import { withPrelaunchRecoveryFixture } from "./maintenance-prelaunch-fixture.mjs";
import { createMaintenancePrelaunchRecoveryInspection, buildMaintenancePrelaunchRecoveredState,
  validateMaintenancePrelaunchRecoveryState, assertMaintenancePrelaunchRecoveryProgress } from "../production-maintenance-prelaunch-recovery.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "../production-maintenance-launch-journal.mjs";
import { MAINTENANCE_PREFLIGHT_RECOVERY_INCIDENT as INCIDENT, MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION as AUTH,
  createMaintenancePreflightRecoveryInspection, buildMaintenancePreflightRecoveredState,
  assertMaintenancePreflightRecoveryProgress } from "../production-maintenance-preflight-recovery.mjs";
const NOW=Date.parse("2026-09-14T18:10:00Z"), TARGET="f".repeat(40);
// TEST ONLY: add one exact synthetic byte mapping; all production hashes remain real.
export async function withPreflightRecoveryFixture(t, action) {
 return withPrelaunchRecoveryFixture(t, async base=>{
  const {copy,mappings,launch}=base, clock=(now=NOW)=>({bootId:INCIDENT.bootId,now});
  const old=base.fixture(), recoveredAt=Date.parse("2026-09-14T16:21:11Z");
  const contextOld={...old.context,targetSha:INCIDENT.previousTargetSha,now:recoveredAt,
    stoppedBaseline:{...copy(old.state.windowRenewal.stoppedBaseline),observedAt:recoveredAt-1000}};
  const evidenceOld={...createMaintenancePrelaunchRecoveryInspection(old.state,contextOld),toolsSha:INCIDENT.previousTargetSha,
    prelaunchRecoveryRunId:INCIDENT.priorRecoveryRunId,prelaunchRecoveryRunAttempt:1,mainCIrunId:INCIDENT.priorMainCIrunId,
    historyDigest:"d".repeat(64),historyCheckedAt:recoveredAt-1000};
  const initialV10=buildMaintenancePrelaunchRecoveredState(old.state,evidenceOld,contextOld);
  const failedV10={...copy(initialV10),revision:37,phase:"failed-held"};
  assertMaintenancePrelaunchRecoveryProgress(initialV10,failedV10);
  const predecessor={...copy(failedV10),revision:38};
  predecessor.ingress.padding="";
  const padding=INCIDENT.stateBytes-Buffer.byteLength(JSON.stringify(predecessor));assert(padding>0);
  predecessor.ingress.padding="q".repeat(padding);
  assertMaintenancePrelaunchRecoveryProgress(failedV10,predecessor);
  validateMaintenancePrelaunchRecoveryState(predecessor,clock(AUTH.authorizedAt));
  mappings.set(JSON.stringify(predecessor),INCIDENT.stateDigest);
  const nextState=previous=>({...copy(previous),revision:previous.revision+1});
  function fixture() {
   const state=copy(predecessor), context={operationId:INCIDENT.operationId,previousTargetSha:INCIDENT.previousTargetSha,
    targetSha:TARGET,expectedOldSha:INCIDENT.expectedOldSha,expectedRevision:INCIDENT.revision,expectedDigest:INCIDENT.stateDigest,
    bootId:INCIDENT.bootId,now:NOW,sourceDiffDigest:"b".repeat(64),migrationDigest:"c".repeat(64),
    stoppedBaseline:{...copy(state.prelaunchRecovery.stoppedBaseline),observedAt:NOW-1000}};
   const inspection=createMaintenancePreflightRecoveryInspection(state,context);
   const evidence={...inspection,toolsSha:TARGET,preflightRecoveryRunId:"900000000000000021",preflightRecoveryRunAttempt:1,
    mainCIrunId:"900000000000000022",historyDigest:"d".repeat(64),historyCheckedAt:NOW-1000};
   return {state,context,inspection,evidence};
  }
  const build=f=>buildMaintenancePreflightRecoveredState(f.state,f.evidence,f.context);
    function journalSteps(initial) {
      const launched = { ...copy(initial), ...launch(initial, "99999999-2222-4333-8444-555555555555") }, binding = {
        operationId: initial.operationId, targetSha: initial.targetSha, appName: initial.appName, appPort: initial.appPort,
        daemon: launched.launchJournal.daemon, release: launched.launchJournal.release };
      let state = { ...nextState(initial), launchDisk: launched.launchDisk, launchJournal: createMaintenanceLaunchJournal(binding) };
      assertMaintenancePreflightRecoveryProgress(initial, state);
      const saved = [state], slot = launched.launchJournal.slots["paused-web"];
      let journal = planMaintenanceLaunch(state.launchJournal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, environmentDigest: slot.environmentDigest });
      let next = { ...nextState(state), launchJournal: journal }; assertMaintenancePreflightRecoveryProgress(state, next); saved.push(next); state = next;
      journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "attempted" });
      next = { ...nextState(state), launchJournal: journal }; assertMaintenancePreflightRecoveryProgress(state, next); saved.push(next); state = next;
      journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "confirmed",
        observation: { ...binding, role: "paused-web", sequence: 1, observedNonce: slot.nonce, environmentDigest: slot.environmentDigest, instance: slot.instance } });
      next = { ...nextState(state), launchJournal: journal }; assertMaintenancePreflightRecoveryProgress(state, next); saved.push(next); state = next;
      next = { ...nextState(state), candidate: launched.candidate, phase: "candidate" }; assertMaintenancePreflightRecoveryProgress(state, next); saved.push(next);
      return { saved, candidate: next, launched };
    }

  return await action({...base,initialV10,failedV10,predecessor,fixture,build,nextState,journalSteps,clock,NOW,TARGET,PREFLIGHT:INCIDENT,PREFLIGHT_AUTH:AUTH});
 });
}
