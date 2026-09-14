import { isDeepStrictEqual } from "node:util";
import { validateBudgetRecoveryHandoffReport } from "./production-maintenance-budget-handoff.mjs";
import { validatePrelaunchRecoveryBaseline, verifyPrelaunchRecoveryBaseline } from "./production-maintenance-prelaunch-inspection.mjs";
import { validateMaintenancePrelaunchRecoveryPredecessor,
  reconstructMaintenancePrelaunchRecoveryPredecessor } from "./production-maintenance-prelaunch-recovery.mjs";

// This is the existing small version-3 physical T7 handoff, not a serialized
// predecessor or permission to launch any historical generation. The controller
// keeps the full immutable v9 history private and its own real-clock authority.
const T7 = "d9de5fe689226fcdd13a1e95039901b5d0f39167";
const UNUSED_TARGETS = ["67ddb91bf618e9716b79df6bf97f08d3865919b7", "78ca8104442172baf046b62f9184cf9c7f6a9279", "3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0"];
const fail = () => { throw new Error("maintenance_prelaunch_handoff_unverified"); };
export function validatePrelaunchRecoveryHandoffReport(raw, request) {
  try {
    const report = validateBudgetRecoveryHandoffReport(raw, request);
    validatePrelaunchRecoveryBaseline(report.budgetBaseline.stoppedBaseline);
    if (UNUSED_TARGETS.includes(report.targetSha)) fail();
    return report;
  } catch { fail(); }
}

export async function readPrelaunchRecoveryHandoffFields(originalRuntime, rawState, rawBaseline, observations = {}) {
  try {
    const baseline = validatePrelaunchRecoveryBaseline(rawBaseline);
    // This first full observation rejects hostile state/IO descriptors before
    // any property below is used. The final repetition detects caller mutation.
    await verifyPrelaunchRecoveryBaseline(rawState, baseline, observations);
    const clock = { bootId: baseline.bootId, now: (observations.now ?? Date.now)() };
    const predecessor = Object.getOwnPropertyDescriptor(rawState, "version")?.value === 9 ?
      validateMaintenancePrelaunchRecoveryPredecessor(rawState, clock) :
      reconstructMaintenancePrelaunchRecoveryPredecessor(rawState, clock);
    const targetSha = Object.getOwnPropertyDescriptor(rawState, "targetSha").value;
    const archived = predecessor.budgetRecovery.predecessor.state;
    if (!process.argv[1] || process.argv[1] === "-") fail();
    const runtime = await import("./production-maintenance-runtime.mjs");
    const proof = runtime.validateRuntimeProof(originalRuntime);
    if (!isDeepStrictEqual(proof, predecessor.runtime) || !isDeepStrictEqual(proof, archived.runtime)) fail();
    // O's frozen environment and worker semantics remain O; the rollback disk
    // and environment below are the actual stopped T7, never relabelled O.
    await runtime.readRuntimeHandoffEnvironment(proof, observations.runtime);
    const candidate = runtime.validateCandidateProof(archived.candidate, proof);
    const candidateOnly = { version: 1, input: { ...proof.input, expectedOldSha: T7 }, bootId: proof.bootId,
      disk: candidate.disk, environment: candidate.environment, daemon: candidate.daemon, web: candidate.web,
      worker: { state: "absent", managed: null } };
    const output = await runtime.readDeploymentHandoffFields(candidateOnly, observations.runtime);
    output.PREVIOUS_AUTOMATION_WORKER_STATE = proof.worker.state;
    output.PREVIOUS_AUTOMATION_WORKER_RUNNING = proof.worker.state === "running" ? "1" : "0";
    // Reuse the exact existing 27-key validator. This local typed envelope is
    // only field validation, never emitted as a held report by this function.
    const request = { ...proof.input, operationId: predecessor.operationId, targetSha };
    // During pre-recovery inspection targetSha is the known unused T10. The new
    // target exclusion is a controller/report concern, not a disk field check.
    const typed = validateBudgetRecoveryHandoffReport({ version: 3, operationId: request.operationId,
      targetSha: request.targetSha, expectedOldSha: request.expectedOldSha, state: "held", fields: output,
      budgetBaseline: { version: 3, predecessorStateDigest: baseline.stateDigest, previousTargetSha: T7, stoppedBaseline: baseline } }, request);
    await verifyPrelaunchRecoveryBaseline(rawState, baseline, observations);
    return typed.fields;
  } catch { fail(); }
}
