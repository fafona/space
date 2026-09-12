import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { isProxy } from "node:util/types";

/** Pure, one-time recovery protocol. No filesystem, network, clock, process or
 * service operation is performed here. Callers MUST authenticate CI/history,
 * recompute source/ledger evidence, verify the ORIGINAL held ingress/runtime/DB,
 * and persist under the existing operation lock with the real bytes/revision CAS.
 * A well-shaped report is NOT proof that those external observations happened.
 * v3 preserves the original deadline and permanently records the T1 -> T2 audit.
 */
const ERROR = "maintenance_recovery_invalid";
const STATE_BYTES = 4 * 1024 * 1024;
export const MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES = 16 * 1024;
export const MAINTENANCE_RECOVERY_HISTORY_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BOOT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN = /^[1-9][0-9]{0,19}$/;
const PHASES = ["preparing", "held", "candidate", "resuming", "ended", "failed-held", "failed-unknown"];
const STATE_KEYS = ["version", "revision", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const EMPTY_LAUNCH_KEYS = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const INSPECTION_KEYS = ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha", "revision", "stateDigest", "createdAt", "sourceDiffDigest", "migrationDigest"];
const EVIDENCE_KEYS = [...INSPECTION_KEYS, "toolsSha", "recoveryRunId", "recoveryRunAttempt", "mainCIrunId", "historyDigest", "historyCheckedAt"];
const CONTEXT_KEYS = ["operationId", "previousTargetSha", "targetSha", "expectedOldSha", "expectedRevision", "expectedDigest", "bootId", "now", "sourceDiffDigest", "migrationDigest"];
const FIXED_KEYS = ["operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "tokenHash", "publicSupabaseUrl", "runtime", "database"];
const fail = () => { throw new Error(ERROR); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const time = value => integer(value) && value <= 8640000000000000;
const matches = (pattern, value) => typeof value === "string" && pattern.test(value);

// Descriptor-only capture: no getters, proxies, toJSON, hidden/symbol fields,
// array holes or silent JSON omissions. The byte bound includes the full state.
function capture(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 100000 || depth > 64) fail();
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
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
function bounded(value, bytes = STATE_BYTES) {
  const result = capture(value);
  if (Buffer.byteLength(JSON.stringify(result)) > bytes) fail();
  return result;
}
function freeze(value) {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const project = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));

function checkClock(value) {
  if (!exact(value, ["bootId", "now"]) || !matches(BOOT, value.bootId) || !time(value.now)) fail();
}
function checkStateBase(state, version, clock) {
  checkClock(clock);
  if (!exact(state, version === 3 ? [...STATE_KEYS, "recovery"] : STATE_KEYS) || state.version !== version ||
      !integer(state.revision) || !matches(UUID, state.operationId) || !matches(SHA, state.targetSha) || !matches(SHA, state.expectedOldSha) ||
      state.targetSha === state.expectedOldSha || !matches(BOOT, state.bootId) || state.bootId !== clock.bootId ||
      !time(state.createdAt) || state.createdAt > clock.now || clock.now - state.createdAt > MAX_AGE_MS ||
      !PHASES.includes(state.phase) || typeof state.appDir !== "string" || state.appDir === "/" || !posix.isAbsolute(state.appDir) ||
      posix.normalize(state.appDir) !== state.appDir || /[\\\u0000-\u001f\u007f]/.test(state.appDir) ||
      !matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, state.appName) || !integer(state.appPort) || state.appPort < 1024 || state.appPort > 65535 ||
      !matches(HASH, state.tokenHash) || typeof state.publicSupabaseUrl !== "string" || !state.publicSupabaseUrl ||
      state.publicSupabaseUrl.length > 2048 || /[\u0000-\u001f\u007f]/.test(state.publicSupabaseUrl) ||
      ![state.runtime, state.ingress, state.database].every(record) ||
      !EMPTY_LAUNCH_KEYS.every(key => state[key] === null || record(state[key]))) fail();
  // Full runtime/ingress/database/launch validators remain mandatory in control.
}
function checkInspection(value) {
  if (!exact(value, INSPECTION_KEYS) || value.version !== 1 || value.state !== "recovery-inspected" ||
      !matches(UUID, value.operationId) || !matches(SHA, value.targetSha) || !matches(SHA, value.previousTargetSha) ||
      !matches(SHA, value.expectedOldSha) || new Set([value.targetSha, value.previousTargetSha, value.expectedOldSha]).size !== 3 ||
      !integer(value.revision) || value.revision === Number.MAX_SAFE_INTEGER || !time(value.createdAt) ||
      ![value.stateDigest, value.sourceDiffDigest, value.migrationDigest].every(item => matches(HASH, item))) fail();
  return project(value, INSPECTION_KEYS);
}
function checkEvidence(value) {
  if (!exact(value, EVIDENCE_KEYS)) fail();
  checkInspection(project(value, INSPECTION_KEYS));
  if (value.toolsSha !== value.targetSha || !matches(RUN, value.recoveryRunId) || value.recoveryRunAttempt !== 1 ||
      !matches(RUN, value.mainCIrunId) || !matches(HASH, value.historyDigest) || !time(value.historyCheckedAt) ||
      value.historyCheckedAt < value.createdAt || value.historyCheckedAt - value.createdAt > MAX_AGE_MS) fail();
  return project(value, EVIDENCE_KEYS);
}
function checkContext(value) {
  if (!exact(value, CONTEXT_KEYS) || !matches(UUID, value.operationId) || !matches(SHA, value.previousTargetSha) ||
      !matches(SHA, value.targetSha) || !matches(SHA, value.expectedOldSha) ||
      new Set([value.previousTargetSha, value.targetSha, value.expectedOldSha]).size !== 3 ||
      !integer(value.expectedRevision) || value.expectedRevision === Number.MAX_SAFE_INTEGER ||
      ![value.expectedDigest, value.sourceDiffDigest, value.migrationDigest].every(item => matches(HASH, item))) fail();
  checkClock({ bootId: value.bootId, now: value.now });
}
function inspectionFor(state, context) {
  checkContext(context);
  checkStateBase(state, 2, { bootId: context.bootId, now: context.now });
  if (state.phase !== "failed-held" || !EMPTY_LAUNCH_KEYS.every(key => state[key] === null) ||
      state.operationId !== context.operationId || state.expectedOldSha !== context.expectedOldSha || state.targetSha !== context.previousTargetSha ||
      state.revision !== context.expectedRevision || hash(state) !== context.expectedDigest) fail();
  return checkInspection({ version: 1, state: "recovery-inspected", operationId: state.operationId, targetSha: context.targetSha,
    previousTargetSha: state.targetSha, expectedOldSha: state.expectedOldSha, revision: state.revision, stateDigest: context.expectedDigest,
    createdAt: state.createdAt, sourceDiffDigest: context.sourceDiffDigest, migrationDigest: context.migrationDigest });
}

export function createMaintenanceRecoveryInspection(rawState, rawContext) {
  return freeze(inspectionFor(bounded(rawState), bounded(rawContext)));
}
export function validateMaintenanceRecoveryInspection(value) {
  return freeze(checkInspection(bounded(value, MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES)));
}
export function validateMaintenanceRecoveryEvidence(value) {
  return freeze(checkEvidence(bounded(value, MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES)));
}
export function encodeMaintenanceRecoveryEvidence(value) {
  const encoded = Buffer.from(JSON.stringify(validateMaintenanceRecoveryEvidence(value))).toString("base64url");
  if (encoded.length > MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES) fail();
  return encoded;
}
export function decodeMaintenanceRecoveryEvidence(value) {
  if (typeof value !== "string" || !value || value.length > MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64url"));
    const evidence = validateMaintenanceRecoveryEvidence(JSON.parse(decoded));
    if (encodeMaintenanceRecoveryEvidence(evidence) !== value) fail();
    return evidence;
  } catch { fail(); }
}

export function buildMaintenanceRecoveredState(rawState, rawEvidence, rawContext) {
  const state = bounded(rawState), evidence = checkEvidence(bounded(rawEvidence, MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES));
  const context = bounded(rawContext), inspection = inspectionFor(state, context);
  if (!isDeepStrictEqual(inspection, project(evidence, INSPECTION_KEYS)) || evidence.historyCheckedAt > context.now ||
      context.now - evidence.historyCheckedAt > MAINTENANCE_RECOVERY_HISTORY_MAX_AGE_MS) fail();
  const next = { ...state, version: 3, revision: state.revision + 1, targetSha: context.targetSha, phase: "held",
    recovery: { version: 1, evidence, recoveredAt: context.now } };
  return validateMaintenanceRecoveryState(next, { bootId: context.bootId, now: context.now });
}

export function validateMaintenanceRecoveryState(rawState, rawClock) {
  const state = bounded(rawState), clock = bounded(rawClock);
  checkStateBase(state, 3, clock);
  const audit = state.recovery;
  if (!exact(audit, ["version", "evidence", "recoveredAt"]) || audit.version !== 1 || !time(audit.recoveredAt)) fail();
  const evidence = checkEvidence(audit.evidence);
  if (evidence.operationId !== state.operationId || evidence.targetSha !== state.targetSha || evidence.expectedOldSha !== state.expectedOldSha ||
      evidence.createdAt !== state.createdAt || state.revision < evidence.revision + 1 ||
      audit.recoveredAt < evidence.historyCheckedAt || audit.recoveredAt - evidence.historyCheckedAt > MAINTENANCE_RECOVERY_HISTORY_MAX_AGE_MS ||
      audit.recoveredAt > clock.now || audit.recoveredAt - state.createdAt > MAX_AGE_MS) fail();
  return freeze(state);
}

/** Add to EVERY existing state-write path, including journal-specific writes.
 * Does not replace that path's exact previous bytes/revision CAS or validators.
 * Live operation bookkeeping (e.g. ingress.retiringWorkers) remains controlled
 * by the original ingress validator; only the recovery transition preserves all
 * original fields. The immutable audit retains the entire pre-recovery digest.
 */
export function assertMaintenanceRecoveryProgress(rawPrevious, rawNext) {
  const previous = bounded(rawPrevious), next = bounded(rawNext);
  if (!record(previous) || !record(next)) fail();
  if (previous.version === 2 && next.version === 2) {
    if (Object.hasOwn(previous, "recovery") || Object.hasOwn(next, "recovery")) fail();
    return;
  }
  if (previous.version === 2 && next.version === 3) {
    if (!exact(next.recovery, ["version", "evidence", "recoveredAt"])) fail();
    const evidence = checkEvidence(next.recovery.evidence);
    const expected = buildMaintenanceRecoveredState(previous, evidence, { operationId: evidence.operationId,
      previousTargetSha: evidence.previousTargetSha, targetSha: evidence.targetSha, expectedOldSha: evidence.expectedOldSha,
      expectedRevision: evidence.revision, expectedDigest: evidence.stateDigest, bootId: previous.bootId, now: next.recovery.recoveredAt,
      sourceDiffDigest: evidence.sourceDiffDigest, migrationDigest: evidence.migrationDigest });
    if (!isDeepStrictEqual(next, expected)) fail();
    return;
  }
  if (previous.version !== 3 || next.version !== 3 || !exact(previous.recovery, ["version", "evidence", "recoveredAt"]) ||
      !isDeepStrictEqual(previous.recovery, next.recovery) ||
      FIXED_KEYS.some(key => !isDeepStrictEqual(previous[key], next[key])) || !integer(previous.revision) ||
      previous.revision === Number.MAX_SAFE_INTEGER || next.revision !== previous.revision + 1) fail();
  const now = previous.recovery.recoveredAt;
  validateMaintenanceRecoveryState(previous, { bootId: previous.bootId, now });
  validateMaintenanceRecoveryState(next, { bootId: previous.bootId, now });
}
