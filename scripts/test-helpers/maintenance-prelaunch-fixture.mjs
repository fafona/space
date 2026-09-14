import assert from "node:assert/strict";
import { withWindowRenewalFixture } from "./maintenance-window-fixture.mjs";
import { createMaintenanceWindowRenewalInspection, buildMaintenanceWindowRenewedState,
  validateMaintenanceWindowRenewalState, assertMaintenanceWindowRenewalProgress } from "../production-maintenance-window-renewal.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "../production-maintenance-launch-journal.mjs";
import { MAINTENANCE_PRELAUNCH_RECOVERY_INCIDENT as INCIDENT,
  MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION as AUTH, createMaintenancePrelaunchRecoveryInspection,
  buildMaintenancePrelaunchRecoveredState, assertMaintenancePrelaunchRecoveryProgress } from "../production-maintenance-prelaunch-recovery.mjs";

const NOW = Date.parse("2026-09-14T17:00:00Z"), TARGET = "e".repeat(40);
/** TEST ONLY. Add exactly one full synthetic failed-v9 byte string to the four
 * exact old fixture mappings. No real private state and no production override.
 * The shared awaited helper restores all crypto hooks after this test context. */
export async function withPrelaunchRecoveryFixture(t, action) {
  return withWindowRenewalFixture(t, async base => {
    const { copy, mappings, launch } = base;
    const clock = (now = NOW) => ({ bootId: INCIDENT.bootId, now });
    const old = base.fixture(), renewedAt = Date.parse("2026-09-14T13:58:00Z");
    const oldContext = { ...old.context, targetSha: INCIDENT.previousTargetSha, now: renewedAt,
      stoppedBaseline: { ...copy(old.context.stoppedBaseline), observedAt: renewedAt - 1000 } };
    const oldEvidence = { ...createMaintenanceWindowRenewalInspection(old.state, oldContext), toolsSha: INCIDENT.previousTargetSha,
      windowRenewalRunId: INCIDENT.priorRecoveryRunId, windowRenewalRunAttempt: 1, mainCIrunId: INCIDENT.priorMainCIrunId,
      historyDigest: "d".repeat(64), historyCheckedAt: renewedAt - 1000 };
    const initialV9 = buildMaintenanceWindowRenewedState(old.state, oldEvidence, oldContext);
    const failedV9 = { ...copy(initialV9), revision: 34, phase: "failed-held" };
    assertMaintenanceWindowRenewalProgress(initialV9, failedV9);
    const predecessor = { ...copy(failedV9), revision: 35 };
    // The v8 ingress is large synthetic padding. Only CURRENT v9 bookkeeping
    // changes here; its compact archived v8 ingress and all audits stay exact.
    predecessor.ingress.padding = "";
    const padding = INCIDENT.stateBytes - Buffer.byteLength(JSON.stringify(predecessor));
    assert(padding > 0); predecessor.ingress.padding = "z".repeat(padding);
    assertMaintenanceWindowRenewalProgress(failedV9, predecessor);
    validateMaintenanceWindowRenewalState(predecessor, clock(AUTH.authorizedAt));
    mappings.set(JSON.stringify(predecessor), INCIDENT.stateDigest);
    const nextState = previous => ({ ...copy(previous), revision: previous.revision + 1 });
    function fixture() {
      const state = copy(predecessor), context = { operationId: INCIDENT.operationId, previousTargetSha: INCIDENT.previousTargetSha,
        targetSha: TARGET, expectedOldSha: INCIDENT.expectedOldSha, expectedRevision: INCIDENT.revision, expectedDigest: INCIDENT.stateDigest,
        bootId: INCIDENT.bootId, now: NOW, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64),
        stoppedBaseline: { ...copy(state.windowRenewal.stoppedBaseline), observedAt: NOW - 1000 } };
      const inspection = createMaintenancePrelaunchRecoveryInspection(state, context);
      const evidence = { ...inspection, toolsSha: TARGET, prelaunchRecoveryRunId: "900000000000000011", prelaunchRecoveryRunAttempt: 1,
        mainCIrunId: "900000000000000012", historyDigest: "d".repeat(64), historyCheckedAt: NOW - 1000 };
      return { state, context, inspection, evidence };
    }
    const build = f => buildMaintenancePrelaunchRecoveredState(f.state, f.evidence, f.context);
    function journalSteps(initial) {
      const launched = { ...copy(initial), ...launch(initial, "99999999-2222-4333-8444-555555555555") }, binding = {
        operationId: initial.operationId, targetSha: initial.targetSha, appName: initial.appName, appPort: initial.appPort,
        daemon: launched.launchJournal.daemon, release: launched.launchJournal.release };
      let state = { ...nextState(initial), launchDisk: launched.launchDisk, launchJournal: createMaintenanceLaunchJournal(binding) };
      assertMaintenancePrelaunchRecoveryProgress(initial, state);
      const saved = [state], slot = launched.launchJournal.slots["paused-web"];
      let journal = planMaintenanceLaunch(state.launchJournal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, environmentDigest: slot.environmentDigest });
      let next = { ...nextState(state), launchJournal: journal }; assertMaintenancePrelaunchRecoveryProgress(state, next); saved.push(next); state = next;
      journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "attempted" });
      next = { ...nextState(state), launchJournal: journal }; assertMaintenancePrelaunchRecoveryProgress(state, next); saved.push(next); state = next;
      journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "confirmed",
        observation: { ...binding, role: "paused-web", sequence: 1, observedNonce: slot.nonce, environmentDigest: slot.environmentDigest, instance: slot.instance } });
      next = { ...nextState(state), launchJournal: journal }; assertMaintenancePrelaunchRecoveryProgress(state, next); saved.push(next); state = next;
      next = { ...nextState(state), candidate: launched.candidate, phase: "candidate" }; assertMaintenancePrelaunchRecoveryProgress(state, next); saved.push(next);
      return { saved, candidate: next, launched };
    }

    return await action({ ...base, originalV8: base.predecessor, initialV9, failedV9, predecessor,
      fixture, build, nextState, journalSteps, clock, NOW, TARGET, PRELAUNCH: INCIDENT, PRELAUNCH_AUTH: AUTH });
  });
}
