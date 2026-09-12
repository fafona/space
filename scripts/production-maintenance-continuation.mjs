import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { isProxy } from "node:util/types";
import { assertMaintenanceRecoveryProgress, validateMaintenanceRecoveryState } from "./production-maintenance-recovery.mjs";

/** Pure protocol for ONE reviewed post-migration incident, not a general target
 * override. No I/O, clock, nonce, process control or persistence is performed.
 * The caller must independently verify authenticated GitHub run/attempt history,
 * the exact reviewed source delta, complete frozen migration ledger, ingress,
 * stopped runtime, and database quiet; it must use the existing operation lock
 * and the actual prior bytes/revision CAS. Typed digests never prove those facts.
 * Original recovery and deadline survive unchanged, including after launches.
 */
export const MAINTENANCE_CONTINUATION_INCIDENT = Object.freeze({
  operationId: "eb81284a-09c4-4514-8f16-38eaf6acc1e4",
  originalTargetSha: "1b09cdbf25ec1b4164e200486f009500b6551ed4",
  previousTargetSha: "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf",
  expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6",
  revision: 4,
  createdAt: 1789236034129,
  backupRunId: "34715932102", backupRunAttempt: 1,
  migrationRunId: "34721155156", migrationRunAttempt: 1,
  readinessRunId: "34721256683", readinessRunAttempt: 1,
  failedDeployRunId: "34721317710", failedDeployRunAttempt: 1,
});
export const MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES = 16 * 1024;
export const MAINTENANCE_CONTINUATION_HISTORY_MAX_AGE_MS = 5 * 60 * 1000;
const INCIDENT = MAINTENANCE_CONTINUATION_INCIDENT;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const STATE_BYTES = 4 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const BOOT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN = /^[1-9][0-9]{0,19}$/;
const RUN_KEYS = ["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt", "failedDeployRunId", "failedDeployRunAttempt"];
const INSPECTION_KEYS = ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha", "revision", "stateDigest", "createdAt", "sourceDiffDigest", "migrationDigest", "recoveryDigest", ...RUN_KEYS];
const EVIDENCE_KEYS = [...INSPECTION_KEYS, "toolsSha", "continuationRunId", "continuationRunAttempt", "mainCIrunId", "historyDigest", "historyCheckedAt"];
const CONTEXT_KEYS = ["operationId", "previousTargetSha", "targetSha", "expectedOldSha", "expectedRevision", "expectedDigest", "bootId", "now", "sourceDiffDigest", "migrationDigest"];
const LAUNCH_KEYS = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const FIXED_KEYS = ["operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "tokenHash", "publicSupabaseUrl", "runtime", "database", "recovery", "continuation"];
const fail = () => { throw new Error("maintenance_continuation_invalid"); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const time = value => integer(value) && value <= 8640000000000000;
const matches = (pattern, value) => typeof value === "string" && pattern.test(value);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const project = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const newTarget = value => matches(SHA, value) && ![INCIDENT.originalTargetSha, INCIDENT.previousTargetSha, INCIDENT.expectedOldSha].includes(value);

function capture(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 100000 || depth > 64) fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (!value || typeof value !== "object" || isProxy(value)) fail();
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
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
  const result = capture(value);
  if (Buffer.byteLength(JSON.stringify(result)) > maximum) fail();
  return result;
}
function freeze(value) {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function checkClock(value) {
  if (!exact(value, ["bootId", "now"]) || !matches(BOOT, value.bootId) || !time(value.now)) fail();
}
function checkOriginalRecovery(state, clock) {
  try { validateMaintenanceRecoveryState(state, clock); } catch { fail(); }
  if (state.operationId !== INCIDENT.operationId || state.expectedOldSha !== INCIDENT.expectedOldSha ||
      state.targetSha !== INCIDENT.previousTargetSha || state.createdAt !== INCIDENT.createdAt ||
      state.recovery.evidence.previousTargetSha !== INCIDENT.originalTargetSha ||
      state.recovery.evidence.revision !== INCIDENT.revision - 1) fail();
}
function checkInspection(value) {
  if (!exact(value, INSPECTION_KEYS) || value.version !== 1 || value.state !== "continuation-inspected" ||
      value.operationId !== INCIDENT.operationId || value.previousTargetSha !== INCIDENT.previousTargetSha ||
      value.expectedOldSha !== INCIDENT.expectedOldSha || value.revision !== INCIDENT.revision || value.createdAt !== INCIDENT.createdAt ||
      !newTarget(value.targetSha) || RUN_KEYS.some(key => value[key] !== INCIDENT[key]) ||
      ![value.stateDigest, value.sourceDiffDigest, value.migrationDigest, value.recoveryDigest].every(item => matches(HASH, item))) fail();
  return project(value, INSPECTION_KEYS);
}
function checkEvidence(value) {
  if (!exact(value, EVIDENCE_KEYS)) fail();
  checkInspection(project(value, INSPECTION_KEYS));
  const historicalIds = RUN_KEYS.filter(key => key.endsWith("Id")).map(key => INCIDENT[key]);
  if (value.toolsSha !== value.targetSha || !matches(RUN, value.continuationRunId) || value.continuationRunAttempt !== 1 ||
      !matches(RUN, value.mainCIrunId) || value.continuationRunId === value.mainCIrunId ||
      historicalIds.includes(value.continuationRunId) || historicalIds.includes(value.mainCIrunId) ||
      !matches(HASH, value.historyDigest) || !time(value.historyCheckedAt) ||
      value.historyCheckedAt < INCIDENT.createdAt || value.historyCheckedAt - INCIDENT.createdAt > MAX_AGE_MS) fail();
  return project(value, EVIDENCE_KEYS);
}
function checkContext(value) {
  if (!exact(value, CONTEXT_KEYS) || value.operationId !== INCIDENT.operationId || value.previousTargetSha !== INCIDENT.previousTargetSha ||
      value.expectedOldSha !== INCIDENT.expectedOldSha || value.expectedRevision !== INCIDENT.revision || !newTarget(value.targetSha) ||
      ![value.expectedDigest, value.sourceDiffDigest, value.migrationDigest].every(item => matches(HASH, item))) fail();
  checkClock({ bootId: value.bootId, now: value.now });
}
function inspectionFor(state, context) {
  checkContext(context);
  checkOriginalRecovery(state, { bootId: context.bootId, now: context.now });
  if (state.version !== 3 || state.phase !== "held" || state.revision !== INCIDENT.revision ||
      !LAUNCH_KEYS.every(key => state[key] === null) || hash(state) !== context.expectedDigest) fail();
  return checkInspection({ version: 1, state: "continuation-inspected", operationId: state.operationId, targetSha: context.targetSha,
    previousTargetSha: state.targetSha, expectedOldSha: state.expectedOldSha, revision: state.revision, stateDigest: context.expectedDigest,
    createdAt: state.createdAt, sourceDiffDigest: context.sourceDiffDigest, migrationDigest: context.migrationDigest,
    recoveryDigest: hash(state.recovery), ...project(INCIDENT, RUN_KEYS) });
}

export function createMaintenanceContinuationInspection(rawState, rawContext) {
  return freeze(inspectionFor(bounded(rawState), bounded(rawContext)));
}
export function validateMaintenanceContinuationInspection(value) {
  return freeze(checkInspection(bounded(value, MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES)));
}
export function validateMaintenanceContinuationEvidence(value) {
  return freeze(checkEvidence(bounded(value, MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES)));
}
export function encodeMaintenanceContinuationEvidence(value) {
  const encoded = Buffer.from(JSON.stringify(validateMaintenanceContinuationEvidence(value))).toString("base64url");
  if (encoded.length > MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES) fail();
  return encoded;
}
export function decodeMaintenanceContinuationEvidence(value) {
  if (typeof value !== "string" || !value || value.length > MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64url"));
    const result = validateMaintenanceContinuationEvidence(JSON.parse(text));
    if (encodeMaintenanceContinuationEvidence(result) !== value) fail();
    return result;
  } catch { fail(); }
}
export function buildMaintenanceContinuedState(rawState, rawEvidence, rawContext) {
  const state = bounded(rawState), context = bounded(rawContext);
  const evidence = checkEvidence(bounded(rawEvidence, MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES));
  const inspection = inspectionFor(state, context);
  if (!isDeepStrictEqual(inspection, project(evidence, INSPECTION_KEYS)) || evidence.historyCheckedAt > context.now ||
      evidence.historyCheckedAt < state.recovery.recoveredAt || evidence.continuationRunId === state.recovery.evidence.recoveryRunId ||
      context.now - evidence.historyCheckedAt > MAINTENANCE_CONTINUATION_HISTORY_MAX_AGE_MS) fail();
  const next = { ...state, version: 4, revision: state.revision + 1, targetSha: context.targetSha, phase: "held",
    continuation: { version: 1, evidence, continuedAt: context.now } };
  return validateMaintenanceContinuationState(next, { bootId: context.bootId, now: context.now });
}
export function validateMaintenanceContinuationState(rawState, rawClock) {
  const state = bounded(rawState), clock = bounded(rawClock); checkClock(clock);
  if (!record(state) || state.version !== 4 || !exact(state.continuation, ["version", "evidence", "continuedAt"]) ||
      state.continuation.version !== 1 || !time(state.continuation.continuedAt)) fail();
  const evidence = checkEvidence(state.continuation.evidence), { continuedAt } = state.continuation;
  if (state.targetSha !== evidence.targetSha || !integer(state.revision) || state.revision < INCIDENT.revision + 1 ||
      continuedAt > clock.now || continuedAt < evidence.historyCheckedAt ||
      continuedAt - evidence.historyCheckedAt > MAINTENANCE_CONTINUATION_HISTORY_MAX_AGE_MS ||
      continuedAt - INCIDENT.createdAt > MAX_AGE_MS) fail();
  // Only this local validation view uses T2. Never persist it or rewrite the
  // original T1 -> T2 recovery evidence to pretend that it authorized T3.
  const original = { ...state, version: 3, targetSha: evidence.previousTargetSha };
  delete original.continuation;
  checkOriginalRecovery(original, clock);
  if (hash(state.recovery) !== evidence.recoveryDigest || evidence.historyCheckedAt < state.recovery.recoveredAt ||
      evidence.continuationRunId === state.recovery.evidence.recoveryRunId ||
      (state.revision === INCIDENT.revision + 1 && (state.phase !== "held" || !LAUNCH_KEYS.every(key => state[key] === null)))) fail();
  return freeze(state);
}

/** Use instead of the old guard at EVERY existing storage-write entry point.
 * Existing v2/v3 transitions still go through the unchanged recovery guard.
 * v4 keeps both audits and fixed bindings immutable; original strict ingress
 * validation still governs later legitimate retiring-worker bookkeeping.
 */
export function assertMaintenanceContinuationProgress(rawPrevious, rawNext) {
  const previous = bounded(rawPrevious), next = bounded(rawNext);
  if (!record(previous) || !record(next)) fail();
  if (previous.version !== 4 && next.version !== 4) {
    if (Object.hasOwn(previous, "continuation") || Object.hasOwn(next, "continuation")) fail();
    return assertMaintenanceRecoveryProgress(previous, next);
  }
  if (previous.version === 3 && next.version === 4) {
    if (!exact(next.continuation, ["version", "evidence", "continuedAt"])) fail();
    const evidence = checkEvidence(next.continuation.evidence);
    const expected = buildMaintenanceContinuedState(previous, evidence, { operationId: evidence.operationId,
      previousTargetSha: evidence.previousTargetSha, targetSha: evidence.targetSha, expectedOldSha: evidence.expectedOldSha,
      expectedRevision: evidence.revision, expectedDigest: evidence.stateDigest, bootId: previous.bootId, now: next.continuation.continuedAt,
      sourceDiffDigest: evidence.sourceDiffDigest, migrationDigest: evidence.migrationDigest });
    if (!isDeepStrictEqual(next, expected)) fail();
    return;
  }
  if (previous.version !== 4 || next.version !== 4 || !integer(previous.revision) || previous.revision === Number.MAX_SAFE_INTEGER ||
      next.revision !== previous.revision + 1 || FIXED_KEYS.some(key => !isDeepStrictEqual(previous[key], next[key]))) fail();
  const clock = { bootId: previous.bootId, now: previous.continuation?.continuedAt };
  validateMaintenanceContinuationState(previous, clock); validateMaintenanceContinuationState(next, clock);
}
