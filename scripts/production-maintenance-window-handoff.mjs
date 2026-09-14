import { isDeepStrictEqual } from "node:util";
import { validateBudgetRecoveryHandoffReport } from "./production-maintenance-budget-handoff.mjs";
import { validateWindowRenewalBaseline, verifyWindowRenewalBaseline } from "./production-maintenance-window-inspection.mjs";
import { validateMaintenanceWindowRenewalPredecessor,
  reconstructMaintenanceWindowRenewalPredecessor } from "./production-maintenance-window-renewal.mjs";

// This is the existing small version-3 physical T7 handoff, not a serialized
// predecessor or permission to launch any historical generation. The controller
// keeps the full immutable v8 history private and its own real-clock authority.
const T7 = "d9de5fe689226fcdd13a1e95039901b5d0f39167";
const UNUSED_TARGETS = ["78ca8104442172baf046b62f9184cf9c7f6a9279", "3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0"];
const fail = () => { throw new Error("maintenance_window_handoff_unverified"); };
export function validateWindowRenewalHandoffReport(raw, request) {
  try {
    const report = validateBudgetRecoveryHandoffReport(raw, request);
    validateWindowRenewalBaseline(report.budgetBaseline.stoppedBaseline);
    if (UNUSED_TARGETS.includes(report.targetSha)) fail();
    return report;
  } catch { fail(); }
}

export async function readWindowRenewalHandoffFields(originalRuntime, rawState, rawBaseline, observations = {}) {
  try {
    const baseline = validateWindowRenewalBaseline(rawBaseline);
    // This first full observation rejects hostile state/IO descriptors before
    // any property below is used. The final repetition detects caller mutation.
    await verifyWindowRenewalBaseline(rawState, baseline, observations);
    const clock = { bootId: baseline.bootId, now: (observations.now ?? Date.now)() };
    const predecessor = Object.getOwnPropertyDescriptor(rawState, "version")?.value === 8 ?
      validateMaintenanceWindowRenewalPredecessor(rawState, clock) :
      reconstructMaintenanceWindowRenewalPredecessor(rawState, clock);
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
    // During pre-renewal inspection targetSha is the known unused T9. The new
    // target exclusion is a controller/report concern, not a disk field check.
    const typed = validateBudgetRecoveryHandoffReport({ version: 3, operationId: request.operationId,
      targetSha: request.targetSha, expectedOldSha: request.expectedOldSha, state: "held", fields: output,
      budgetBaseline: { version: 3, predecessorStateDigest: baseline.stateDigest, previousTargetSha: T7, stoppedBaseline: baseline } }, request);
    await verifyWindowRenewalBaseline(rawState, baseline, observations);
    return typed.fields;
  } catch { fail(); }
}
