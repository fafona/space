import { isDeepStrictEqual, types } from "node:util";
import { validateFailedCandidateBaseline, verifyFailedCandidateBaseline } from "./production-maintenance-failed-candidate-inspection.mjs";

// Private deploy-shell output only. PREVIOUS describes the actual stopped T5
// disk baseline, not a running predecessor or permission to restart anything.
// The original O proof is separately frozen and retains worker-policy meaning.
const fail = () => { throw new Error("maintenance_attempt_handoff_unverified"); };
function report(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = ["version", "predecessor", "stoppedBaseline"], descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value")) || descriptors.version.value !== 1) fail();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
export async function readFailedCandidateHandoffFields(originalRuntime, rawAttemptRecovery, observations = {}) {
  try {
    const attempt = report(rawAttemptRecovery), baseline = validateFailedCandidateBaseline(attempt.stoppedBaseline);
    // This verifies the exact whole predecessor d8e8, journal instance, both
    // real stopped generations, both frozen filesets, port and actual T5 link.
    await verifyFailedCandidateBaseline(attempt.predecessor, baseline, observations);
    if (!process.argv[1] || process.argv[1] === "-") fail();
    const runtime = await import("./production-maintenance-runtime.mjs");
    const proof = runtime.validateRuntimeProof(originalRuntime);
    if (!isDeepStrictEqual(proof, attempt.predecessor.runtime)) fail();
    // Validate O against O. Do not require its rollout values to equal T5's
    // legitimately changed configuration, and do not mix O's file IDs with T5.
    await runtime.readRuntimeHandoffEnvironment(proof, observations.runtime);
    const candidate = runtime.validateCandidateProof(attempt.predecessor.candidate, proof);
    const candidateOnly = { version: 1, input: { ...proof.input, expectedOldSha: candidate.targetSha }, bootId: proof.bootId,
      disk: candidate.disk, environment: candidate.environment, daemon: candidate.daemon, web: candidate.web,
      worker: { state: "absent", managed: null } };
    const fields = await runtime.readDeploymentHandoffFields(candidateOnly, observations.runtime);
    fields.PREVIOUS_AUTOMATION_WORKER_STATE = proof.worker.state;
    fields.PREVIOUS_AUTOMATION_WORKER_RUNNING = proof.worker.state === "running" ? "1" : "0";
    if (fields.PREVIOUS_LINK_TARGET !== baseline.current.target || fields.PREVIOUS_RUNTIME_DIR !== baseline.current.target ||
        fields.PREVIOUS_BUILD_ID !== candidate.targetSha) fail();
    await verifyFailedCandidateBaseline(attempt.predecessor, baseline, observations);
    return fields;
  } catch { fail(); }
}
