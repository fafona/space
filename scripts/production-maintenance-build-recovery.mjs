import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { isProxy } from "node:util/types";
import { assertMaintenanceContinuationProgress, validateMaintenanceContinuationState } from "./production-maintenance-continuation.mjs";

/** Pure protocol for ONE failed build before any launch. No I/O, ambient clock,
 * process control or state persistence. The controller must verify real source,
 * all registry metadata, authenticated run history and full held checks again,
 * then perform one existing-lock/raw-byte/revision CAS. These typed digests are
 * not authorization. No original deadline, audit or frozen proof is replaced.
 */
export const MAINTENANCE_BUILD_RECOVERY_INCIDENT = Object.freeze({
  operationId: "eb81284a-09c4-4514-8f16-38eaf6acc1e4",
  originalTargetSha: "1b09cdbf25ec1b4164e200486f009500b6551ed4",
  recoveredTargetSha: "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf",
  previousTargetSha: "46f007fbd9e417f93c01e398c77cf38ec814547d",
  expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6",
  revision: 7, createdAt: 1789236034129,
  stateDigest: "56d5c39c287ec24ce96fb40943d283bee19a950462e7c384934b6461b42c5ffa",
  backupRunId: "34724943157", backupRunAttempt: 1,
  migrationRunId: "34721155156", migrationRunAttempt: 1,
  readinessRunId: "34728212357", readinessRunAttempt: 1,
  failedDeployRunId: "34728263285", failedDeployRunAttempt: 1,
});
export const MAINTENANCE_BUILD_RECOVERY_MAX_EVIDENCE_BYTES = 16 * 1024;
export const MAINTENANCE_BUILD_RECOVERY_HISTORY_MAX_AGE_MS = 5 * 60 * 1000;
const INCIDENT = MAINTENANCE_BUILD_RECOVERY_INCIDENT, MAX_AGE_MS = 12 * 60 * 60 * 1000, STATE_BYTES = 4 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/, HASH = /^[0-9a-f]{64}$/, BOOT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN = /^[1-9][0-9]{0,19}$/;
const RUN_KEYS = ["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt", "failedDeployRunId", "failedDeployRunAttempt"];
const INSPECTION_KEYS = ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha", "revision", "stateDigest", "createdAt", "sourceDiffDigest", "migrationDigest", "recoveryDigest", "continuationDigest", ...RUN_KEYS];
const EVIDENCE_KEYS = [...INSPECTION_KEYS, "toolsSha", "buildRecoveryRunId", "buildRecoveryRunAttempt", "mainCIrunId", "historyDigest", "historyCheckedAt"];
const CONTEXT_KEYS = ["operationId", "previousTargetSha", "targetSha", "expectedOldSha", "expectedRevision", "expectedDigest", "bootId", "now", "sourceDiffDigest", "migrationDigest"];
const LAUNCH_KEYS = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const FIXED_KEYS = ["operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "tokenHash", "publicSupabaseUrl", "runtime", "database", "recovery", "continuation", "buildRecovery"];
const PRIOR_RUNS = ["34715768455", "34715352249", "34715932102", "34721155156", "34721256683", "34721317710", "34724808528", "34724337523", "34724943157", "34728212357", "34728263285"];
const fail = () => { throw new Error("maintenance_build_recovery_invalid"); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const time = value => integer(value) && value <= 8640000000000000;
const matches = (pattern, value) => typeof value === "string" && value.trim() === value && pattern.test(value);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const project = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const newTarget = value => matches(SHA, value) && ![INCIDENT.originalTargetSha, INCIDENT.recoveredTargetSha, INCIDENT.previousTargetSha, INCIDENT.expectedOldSha].includes(value);

function capture(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 100000 || depth > 64) fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (!value || typeof value !== "object" || isProxy(value)) fail();
  const array = Array.isArray(value);
  if (![array ? Array.prototype : Object.prototype, ...(array ? [] : [null])].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (array && (value.length > 100000 || keys.length !== value.length + 1)) fail();
  const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === "length") continue;
    const property = descriptors[key];
    if (typeof key !== "string" || !property.enumerable || !Object.hasOwn(property, "value") ||
        (array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) fail();
    Object.defineProperty(result, key, { value: capture(property.value, budget, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return result;
}
function bounded(value, maximum = STATE_BYTES) {
  const result = capture(value); if (Buffer.byteLength(JSON.stringify(result)) > maximum) fail(); return result;
}
function freeze(value) {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value;
}
function checkClock(value) {
  if (!exact(value, ["bootId", "now"]) || !matches(BOOT, value.bootId) || !time(value.now)) fail();
}
function checkOriginalContinuation(state, clock) {
  try { validateMaintenanceContinuationState(state, clock); } catch { fail(); }
  const recovery = state.recovery.evidence, continuation = state.continuation.evidence;
  if (state.operationId !== INCIDENT.operationId || state.expectedOldSha !== INCIDENT.expectedOldSha || state.createdAt !== INCIDENT.createdAt ||
      state.targetSha !== INCIDENT.previousTargetSha || recovery.previousTargetSha !== INCIDENT.originalTargetSha ||
      recovery.targetSha !== INCIDENT.recoveredTargetSha || recovery.recoveryRunId !== "34715768455" || recovery.recoveryRunAttempt !== 1 ||
      recovery.mainCIrunId !== "34715352249" || continuation.previousTargetSha !== INCIDENT.recoveredTargetSha ||
      continuation.targetSha !== INCIDENT.previousTargetSha || continuation.continuationRunId !== "34724808528" ||
      continuation.continuationRunAttempt !== 1 || continuation.mainCIrunId !== "34724337523") fail();
}
function checkInspection(value) {
  if (!exact(value, INSPECTION_KEYS) || value.version !== 1 || value.state !== "build-recovery-inspected" ||
      value.operationId !== INCIDENT.operationId || value.previousTargetSha !== INCIDENT.previousTargetSha || value.expectedOldSha !== INCIDENT.expectedOldSha ||
      value.revision !== INCIDENT.revision || value.createdAt !== INCIDENT.createdAt || value.stateDigest !== INCIDENT.stateDigest ||
      !newTarget(value.targetSha) || RUN_KEYS.some(key => value[key] !== INCIDENT[key]) ||
      ![value.sourceDiffDigest, value.migrationDigest, value.recoveryDigest, value.continuationDigest].every(item => matches(HASH, item))) fail();
  return project(value, INSPECTION_KEYS);
}
function checkEvidence(value) {
  if (!exact(value, EVIDENCE_KEYS)) fail(); checkInspection(project(value, INSPECTION_KEYS));
  if (value.toolsSha !== value.targetSha || !matches(RUN, value.buildRecoveryRunId) || value.buildRecoveryRunAttempt !== 1 || !matches(RUN, value.mainCIrunId) ||
      value.buildRecoveryRunId === value.mainCIrunId || PRIOR_RUNS.includes(value.buildRecoveryRunId) || PRIOR_RUNS.includes(value.mainCIrunId) ||
      !matches(HASH, value.historyDigest) || !time(value.historyCheckedAt) || value.historyCheckedAt < INCIDENT.createdAt ||
      value.historyCheckedAt - INCIDENT.createdAt > MAX_AGE_MS) fail();
  return project(value, EVIDENCE_KEYS);
}
function checkContext(value) {
  if (!exact(value, CONTEXT_KEYS) || value.operationId !== INCIDENT.operationId || value.previousTargetSha !== INCIDENT.previousTargetSha ||
      value.expectedOldSha !== INCIDENT.expectedOldSha || value.expectedRevision !== INCIDENT.revision || value.expectedDigest !== INCIDENT.stateDigest ||
      !newTarget(value.targetSha) || ![value.sourceDiffDigest, value.migrationDigest].every(item => matches(HASH, item))) fail();
  checkClock({ bootId: value.bootId, now: value.now });
}
function inspectionFor(state, context) {
  checkContext(context); checkOriginalContinuation(state, { bootId: context.bootId, now: context.now });
  if (state.version !== 4 || state.phase !== "failed-held" || state.revision !== INCIDENT.revision ||
      !LAUNCH_KEYS.every(key => state[key] === null) || hash(state) !== INCIDENT.stateDigest) fail();
  return checkInspection({ version: 1, state: "build-recovery-inspected", operationId: state.operationId, targetSha: context.targetSha,
    previousTargetSha: state.targetSha, expectedOldSha: state.expectedOldSha, revision: state.revision, stateDigest: INCIDENT.stateDigest,
    createdAt: state.createdAt, sourceDiffDigest: context.sourceDiffDigest, migrationDigest: context.migrationDigest,
    recoveryDigest: hash(state.recovery), continuationDigest: hash(state.continuation), ...project(INCIDENT, RUN_KEYS) });
}

export function createMaintenanceBuildRecoveryInspection(rawState, rawContext) {
  return freeze(inspectionFor(bounded(rawState), bounded(rawContext)));
}
export function validateMaintenanceBuildRecoveryInspection(value) {
  return freeze(checkInspection(bounded(value, MAINTENANCE_BUILD_RECOVERY_MAX_EVIDENCE_BYTES)));
}
export function validateMaintenanceBuildRecoveryEvidence(value) {
  return freeze(checkEvidence(bounded(value, MAINTENANCE_BUILD_RECOVERY_MAX_EVIDENCE_BYTES)));
}
export function encodeMaintenanceBuildRecoveryEvidence(value) {
  const encoded = Buffer.from(JSON.stringify(validateMaintenanceBuildRecoveryEvidence(value))).toString("base64url");
  if (encoded.length > MAINTENANCE_BUILD_RECOVERY_MAX_EVIDENCE_BYTES) fail(); return encoded;
}
export function decodeMaintenanceBuildRecoveryEvidence(value) {
  if (typeof value !== "string" || !value || value.length > MAINTENANCE_BUILD_RECOVERY_MAX_EVIDENCE_BYTES || !/^[A-Za-z0-9_-]+$/.test(value) || value.trim() !== value) fail();
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64url"));
    const result = validateMaintenanceBuildRecoveryEvidence(JSON.parse(text));
    if (encodeMaintenanceBuildRecoveryEvidence(result) !== value) fail(); return result;
  } catch { fail(); }
}
export function buildMaintenanceBuildRecoveredState(rawState, rawEvidence, rawContext) {
  const state = bounded(rawState), context = bounded(rawContext);
  const evidence = checkEvidence(bounded(rawEvidence, MAINTENANCE_BUILD_RECOVERY_MAX_EVIDENCE_BYTES));
  const inspection = inspectionFor(state, context);
  if (!isDeepStrictEqual(inspection, project(evidence, INSPECTION_KEYS)) || evidence.historyCheckedAt > context.now ||
      evidence.historyCheckedAt < state.continuation.continuedAt || context.now - evidence.historyCheckedAt > MAINTENANCE_BUILD_RECOVERY_HISTORY_MAX_AGE_MS) fail();
  const next = { ...state, version: 5, revision: state.revision + 1, targetSha: context.targetSha, phase: "held",
    buildRecovery: { version: 1, evidence, recoveredAt: context.now } };
  return validateMaintenanceBuildRecoveryState(next, { bootId: context.bootId, now: context.now });
}
export function validateMaintenanceBuildRecoveryState(rawState, rawClock) {
  const state = bounded(rawState), clock = bounded(rawClock); checkClock(clock);
  if (!record(state) || state.version !== 5 || !exact(state.buildRecovery, ["version", "evidence", "recoveredAt"]) ||
      state.buildRecovery.version !== 1 || !time(state.buildRecovery.recoveredAt)) fail();
  const evidence = checkEvidence(state.buildRecovery.evidence), { recoveredAt } = state.buildRecovery;
  if (state.targetSha !== evidence.targetSha || !integer(state.revision) || state.revision < INCIDENT.revision + 1 || recoveredAt > clock.now ||
      recoveredAt < evidence.historyCheckedAt || recoveredAt - evidence.historyCheckedAt > MAINTENANCE_BUILD_RECOVERY_HISTORY_MAX_AGE_MS ||
      recoveredAt - INCIDENT.createdAt > MAX_AGE_MS) fail();
  // A LOCAL validation view only: never return/store this T3 projection or use
  // it for runtime checks, whose true target remains the new full T4 SHA.
  const original = { ...state, version: 4, targetSha: evidence.previousTargetSha }; delete original.buildRecovery;
  checkOriginalContinuation(original, clock);
  if (hash(state.recovery) !== evidence.recoveryDigest || hash(state.continuation) !== evidence.continuationDigest ||
      evidence.historyCheckedAt < state.continuation.continuedAt ||
      (state.revision === INCIDENT.revision + 1 && (state.phase !== "held" || !LAUNCH_KEYS.every(key => state[key] === null)))) fail();
  return freeze(state);
}

/** Every existing storage writer must use this wrapper, not just recovery.
 * Old v2/v3/v4 writes retain their unchanged guard. Later v5 bookkeeping may
 * append valid ingress metadata, but cannot alter the three historical audits.
 * The caller still enforces real clock, complete proofs, journal transitions,
 * existing operation lock and exact previous bytes/revision at persistence.
 */
export function assertMaintenanceBuildRecoveryProgress(rawPrevious, rawNext) {
  const previous = bounded(rawPrevious), next = bounded(rawNext);
  if (!record(previous) || !record(next)) fail();
  if (previous.version !== 5 && next.version !== 5) {
    if (Object.hasOwn(previous, "buildRecovery") || Object.hasOwn(next, "buildRecovery")) fail();
    return assertMaintenanceContinuationProgress(previous, next);
  }
  if (previous.version === 4 && next.version === 5) {
    if (!exact(next.buildRecovery, ["version", "evidence", "recoveredAt"])) fail();
    const evidence = checkEvidence(next.buildRecovery.evidence);
    const expected = buildMaintenanceBuildRecoveredState(previous, evidence, { operationId: evidence.operationId,
      previousTargetSha: evidence.previousTargetSha, targetSha: evidence.targetSha, expectedOldSha: evidence.expectedOldSha,
      expectedRevision: evidence.revision, expectedDigest: evidence.stateDigest, bootId: previous.bootId, now: next.buildRecovery.recoveredAt,
      sourceDiffDigest: evidence.sourceDiffDigest, migrationDigest: evidence.migrationDigest });
    if (!isDeepStrictEqual(next, expected)) fail(); return;
  }
  if (previous.version !== 5 || next.version !== 5 || !integer(previous.revision) || previous.revision === Number.MAX_SAFE_INTEGER ||
      next.revision !== previous.revision + 1 || FIXED_KEYS.some(key => !isDeepStrictEqual(previous[key], next[key]))) fail();
  const clock = { bootId: previous.bootId, now: previous.buildRecovery?.recoveredAt };
  validateMaintenanceBuildRecoveryState(previous, clock); validateMaintenanceBuildRecoveryState(next, clock);
}
