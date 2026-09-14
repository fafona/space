import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { isProxy } from "node:util/types";
import { MAINTENANCE_BUDGET_RECOVERY_INCIDENT as BUDGET } from "./production-maintenance-budget-recovery.mjs";
import { assertMaintenanceWindowRenewalProgress, validateMaintenanceWindowRenewalState } from "./production-maintenance-window-renewal.mjs";
import { validateMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";

/** Pure recovery of ONE fixed prelaunch failure, carrying the SAME unused
 * activeAttempt 3. No I/O, authentication, configuration or actuation occurs.
 * The caller proves current stopped generations, ingress, database and exact
 * main/CI/history, then uses the existing lock and raw-byte/revision CAS.
 * The complete failed v9 is reconstructed byte-for-byte without duplicating
 * its history. Every v9 audit (including its 16:00 deadline) remains untouched.
 * Historical validation never substitutes a clock for live host observations.
 */
export const MAINTENANCE_PRELAUNCH_RECOVERY_INCIDENT = Object.freeze({
  operationId: BUDGET.operationId, bootId: BUDGET.bootId,
  previousTargetSha: "67ddb91bf618e9716b79df6bf97f08d3865919b7",
  expectedOldSha: BUDGET.expectedOldSha, revision: 35, createdAt: BUDGET.createdAt,
  stateBytes: 1746788, stateDigest: "0a2a2e989e9da7e914a181ae27c3468d2f2a455f78404d8b546824ca3346f70c",
  backupRunId: "34852696974", backupRunAttempt: 1,
  migrationRunId: BUDGET.migrationRunId, migrationRunAttempt: 1,
  readinessRunId: "34855754738", readinessRunAttempt: 1,
  failedDeployRunId: "34855913697", failedDeployRunAttempt: 1,
  priorRecoveryRunId: "34852190872", priorRecoveryRunAttempt: 1,
  priorMainCIrunId: "34850320013", priorMainCIrunAttempt: 1,
});
const INCIDENT = MAINTENANCE_PRELAUNCH_RECOVERY_INCIDENT;
export const MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION = Object.freeze({
  version: 1, operationId: INCIDENT.operationId, predecessorDigest: INCIDENT.stateDigest,
  // Recorded tool-confirmation time, not a claim about exact user-message time.
  authorizedAt: Date.parse("2026-09-14T15:00:32.000Z"),
  previousExpiresAt: Date.parse("2026-09-14T16:00:00.000Z"),
  expiresAt: Date.parse("2026-09-14T20:00:00.000Z"),
  previousActiveAttempt: 3, activeAttempt: 3, maximumAdditionalAttempts: 0, maximumRemainingAttempts: 1,
});
const AUTHORIZATION = MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION;
export const MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION_DIGEST = createHash("sha256").update(JSON.stringify(AUTHORIZATION)).digest("hex");
export const MAINTENANCE_PRELAUNCH_RECOVERY_MAX_EVIDENCE_BYTES = 16 * 1024;
export const MAINTENANCE_PRELAUNCH_RECOVERY_HISTORY_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/, DIGEST = /^[0-9a-f]{64}$/, RUN = /^[1-9][0-9]{0,19}$/;
const IDENTITY = /^(?:0|[1-9][0-9]{0,24})(?::(?:0|[1-9][0-9]{0,24})){7}$/;
// This order is the original compact v9 JSON order. Reconstruction must match
// BOTH the entire raw digest and byte count; no canonical rewriting is allowed.
const STATE_KEYS = ["version", "revision", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed", "launchDisk", "launchJournal", "finalDump", "recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal"];
const LAUNCH_KEYS = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const RUN_KEYS = ["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt", "failedDeployRunId", "failedDeployRunAttempt", "priorRecoveryRunId", "priorRecoveryRunAttempt", "priorMainCIrunId", "priorMainCIrunAttempt"];
const INSPECTION_KEYS = ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha", "revision", "stateDigest", "createdAt", "activeAttempt", "sourceDiffDigest", "migrationDigest", "predecessorJournalDigest", "stoppedBaselineDigest", "stoppedBaseline", "authorizationDigest", ...RUN_KEYS];
const EVIDENCE_KEYS = [...INSPECTION_KEYS, "toolsSha", "prelaunchRecoveryRunId", "prelaunchRecoveryRunAttempt", "mainCIrunId", "historyDigest", "historyCheckedAt"];
const CONTEXT_KEYS = ["operationId", "previousTargetSha", "targetSha", "expectedOldSha", "expectedRevision", "expectedDigest", "bootId", "now", "sourceDiffDigest", "migrationDigest", "stoppedBaseline"];
const BASELINE_KEYS = ["version", "stateDigest", "candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "current", "bootId", "pm2RegistryDigest", "observedAt"];
const AUDIT_KEYS = ["version", "predecessor", "evidence", "recoveredAt", "stoppedBaseline", "authorization"];
const PREDECESSOR_KEYS = ["version", "revision", "targetSha", "phase", "stateDigest", "stateBytes", "ingress"];
const FIXED_KEYS = ["operationId", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "runtime", "database", "publicSupabaseUrl", "tokenHash", "recovery", "continuation", "buildRecovery", "deadlineExtension", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal"];
const PHASES = ["held", "candidate", "resuming", "ended", "failed-held", "failed-unknown"];
const PRIOR_RUNS = ["34715768455", "34715352249", "34715932102", "34721155156", "34721256683", "34721317710", "34724808528", "34724337523", "34724943157", "34728212357", "34728263285", "34745334237", "34742540111", "34777790522", "34778424264", "34778579797", "34781336277", "34781392661", "34789133814", "34789744074", "34789894868", "34790775352", "34790827235", "34799821827", "34800461043", "34800653808", "34802075500", "34802138869", "34820083043", "34821029270", "34825984301", "34824742841", "34826545330", "34852190872", "34850320013", "34852696974", "34855754738", "34855913697"];
const OLD_TARGETS = [INCIDENT.previousTargetSha, "3b6c55ea4397c4505e75c59bb3bb56d7dd7d1cc0", BUDGET.previousTargetSha, INCIDENT.expectedOldSha, "3af8fa6ba6644593e10bef0a391389b2b34e926a", "f3104de19aa59e527c7b94a99850d151448da8cd", "1b09cdbf25ec1b4164e200486f009500b6551ed4", "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf", "46f007fbd9e417f93c01e398c77cf38ec814547d", "13df917416cf06ce27fce021460b08caf50f6165", "78ca8104442172baf046b62f9184cf9c7f6a9279"];
const fail = () => { throw new Error("maintenance_prelaunch_recovery_invalid"); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const time = value => integer(value) && value <= 8640000000000000;
const matches = (pattern, value) => typeof value === "string" && pattern.test(value);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const project = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const newTarget = value => matches(SHA, value) && !OLD_TARGETS.includes(value);

function capture(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 100000 || depth > 64) fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (!value || typeof value !== "object" || isProxy(value)) fail();
  const array = Array.isArray(value);
  if (![array ? Array.prototype : Object.prototype, ...(array ? [] : [null])].includes(Object.getPrototypeOf(value))) fail();
  const properties = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(properties);
  if (array && (value.length > 100000 || keys.length !== value.length + 1)) fail();
  const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === "length") continue;
    const property = properties[key];
    if (typeof key !== "string" || !property.enumerable || !Object.hasOwn(property, "value") ||
        (array && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) fail();
    Object.defineProperty(result, key, { value: capture(property.value, budget, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return result;
}
function bounded(value, maximum = MAX_STATE_BYTES) {
  const result = capture(value); if (Buffer.byteLength(JSON.stringify(result)) > maximum) fail(); return result;
}
function freeze(value) {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value;
}
function actualClock(clock) {
  if (!exact(clock, ["bootId", "now"]) || clock.bootId !== INCIDENT.bootId || !time(clock.now) ||
      clock.now < AUTHORIZATION.authorizedAt || clock.now >= AUTHORIZATION.expiresAt) fail();
}
function launchBinding(state) {
  const daemon = state.runtime?.daemon, disk = state.launchDisk;
  if (!record(daemon) || !record(disk)) fail();
  return { operationId: state.operationId, targetSha: state.targetSha, appName: state.appName, appPort: state.appPort,
    daemon: { pid: daemon.pid, uid: daemon.uid, startTicks: daemon.startTicks, bootId: state.bootId,
      executable: daemon.executable, executableIdentity: daemon.executableIdentity },
    release: { path: disk.runtime, identity: disk.runtimeIdentity, buildDigest: disk.nextBuildDigest } };
}
function checkLaunchShape(state, forbiddenNonces = []) {
  if (!LAUNCH_KEYS.every(key => state[key] === null || record(state[key])) ||
      (state.launchDisk === null) !== (state.launchJournal === null) ||
      (state.launchJournal === null && (state.candidate !== null || state.resumed !== null)) ||
      (state.finalDump !== null && state.resumed === null)) fail();
  if (state.launchJournal === null) return;
  let journal;
  try { journal = validateMaintenanceLaunchJournal(state.launchJournal, launchBinding(state)); } catch { fail(); }
  if (!isDeepStrictEqual(journal, state.launchJournal) || Object.values(journal.slots).some(slot => slot && forbiddenNonces.includes(slot.nonce))) fail();
  const verifyCandidate = (candidate, expectedRole = null) => {
    const role = candidate?.pauseExpected === "1" ? "paused-web" : candidate?.pauseExpected === "0" ? "resumed-web" : null;
    const slot = journal.slots[role], process = candidate?.web?.processes?.[0], pm2 = candidate?.web?.pm2;
    if (!role || (expectedRole && role !== expectedRole) || !slot || slot.phase !== "confirmed" ||
        candidate.targetSha !== state.targetSha || !isDeepStrictEqual(candidate.disk, state.launchDisk) ||
        !isDeepStrictEqual(candidate.daemon, state.runtime.daemon) || !record(process) || !record(pm2)) fail();
    const observed = { ...project(process, ["pid", "parentPid", "uid", "startTicks", "processIdentity", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLineDigest"]),
      pmId: pm2.pmId, createdAt: pm2.createdAt, pmUptime: pm2.pmUptime, restartTime: pm2.restartTime, metadataDigest: pm2.metadataHash };
    if (!isDeepStrictEqual(observed, slot.instance)) fail();
  };
  if (state.candidate !== null) verifyCandidate(state.candidate);
  if (state.resumed !== null) {
    verifyCandidate(state.resumed.candidate, "resumed-web");
    // The caller additionally validates the entire worker/native/dump proofs.
    if (state.resumed.worker !== null && journal.slots.worker?.phase !== "confirmed") fail();
  }
}
function predecessorAudit(state) {
  if (!exact(state, STATE_KEYS) || state.version !== 9 || state.activeAttempt !== 3 ||
      state.revision !== INCIDENT.revision || state.phase !== "failed-held" ||
      state.operationId !== INCIDENT.operationId || state.bootId !== INCIDENT.bootId || state.targetSha !== INCIDENT.previousTargetSha ||
      state.expectedOldSha !== INCIDENT.expectedOldSha || state.createdAt !== INCIDENT.createdAt ||
      Buffer.byteLength(JSON.stringify(state)) !== INCIDENT.stateBytes || hash(state) !== INCIDENT.stateDigest ||
      !LAUNCH_KEYS.every(key => state[key] === null)) fail();
  // A FIXED historical audit clock for only this byte-pinned v9. It is inside
  // the immutable original 16:00 window and cannot be supplied by the caller.
  // Actual validation/recovery calls separately enforce the real 15:00..20:00
  // clock. Never pass this historical clock to host I/O, checks or actuation.
  const historicalAuditClock = AUTHORIZATION.authorizedAt;
  if (historicalAuditClock >= AUTHORIZATION.previousExpiresAt ||
      state.windowRenewal?.authorization?.expiresAt !== AUTHORIZATION.previousExpiresAt ||
      state.windowRenewal?.evidence?.windowRenewalRunId !== INCIDENT.priorRecoveryRunId ||
      state.windowRenewal?.evidence?.windowRenewalRunAttempt !== INCIDENT.priorRecoveryRunAttempt ||
      state.windowRenewal?.evidence?.mainCIrunId !== INCIDENT.priorMainCIrunId) fail();
  try { validateMaintenanceWindowRenewalState(state, { bootId: INCIDENT.bootId, now: historicalAuditClock }); } catch { fail(); }
  return state;
}
function compactPredecessor(state) {
  return { version: 9, revision: INCIDENT.revision, targetSha: INCIDENT.previousTargetSha, phase: "failed-held",
    stateDigest: INCIDENT.stateDigest, stateBytes: INCIDENT.stateBytes, ingress: state.ingress };
}
function projectOriginal(state) {
  const compact = state.prelaunchRecovery?.predecessor;
  if (!exact(compact, PREDECESSOR_KEYS) || compact.version !== 9 || compact.revision !== INCIDENT.revision ||
      compact.targetSha !== INCIDENT.previousTargetSha || compact.phase !== "failed-held" || compact.stateDigest !== INCIDENT.stateDigest ||
      compact.stateBytes !== INCIDENT.stateBytes || !record(compact.ingress)) fail();
  // A shallow, read-only view shares unchanged proof objects in memory. Only
  // the original ingress needs an archived copy because live bookkeeping moves.
  // New live launch evidence is NOT discarded: it remains on the actual v10.
  const original = { ...project(state, STATE_KEYS), version: 9, revision: INCIDENT.revision,
    targetSha: INCIDENT.previousTargetSha, phase: "failed-held", ingress: compact.ingress,
    ...Object.fromEntries(LAUNCH_KEYS.map(key => [key, null])) };
  return original;
}
function reconstructPredecessor(state) {
  return predecessorAudit(projectOriginal(state));
}
function baselineShape(value) {
  if (!exact(value, BASELINE_KEYS) || value.version !== 3 || value.stateDigest !== BUDGET.stateDigest || value.bootId !== INCIDENT.bootId ||
      !["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "pm2RegistryDigest"].every(key => matches(DIGEST, value[key])) ||
      !time(value.observedAt) || value.observedAt < AUTHORIZATION.authorizedAt || value.observedAt >= AUTHORIZATION.expiresAt ||
      !exact(value.current, ["target", "linkIdentity", "runtimeIdentity"]) || typeof value.current.target !== "string" ||
      value.current.target.length > 500 || !/^\/[A-Za-z0-9._/-]+$/.test(value.current.target) || posix.normalize(value.current.target) !== value.current.target ||
      !posix.dirname(value.current.target).endsWith(".releases") ||
      !new RegExp(`^${BUDGET.previousTargetSha.slice(0, 12)}-[0-9]{14}$`).test(posix.basename(value.current.target)) ||
      !matches(IDENTITY, value.current.linkIdentity) || !matches(IDENTITY, value.current.runtimeIdentity)) fail();
  return value;
}
function baselineFor(value, predecessor, now) {
  const state = predecessor.budgetRecovery.predecessor.state;
  baselineShape(value);
  // Prelaunch recovery is not permission to re-anchor the unused attempt. Only
  // observation time may advance; the original current link and full registry
  // binding remain as strict as all frozen disk/process fields.
  const stableKeys = BASELINE_KEYS.filter(key => key !== "observedAt");
  if (!isDeepStrictEqual(project(value, stableKeys), project(predecessor.windowRenewal.stoppedBaseline, stableKeys))) fail();
  if (
      value.candidateDigest !== hash(state.candidate) || value.launchDiskDigest !== hash(state.launchDisk) ||
      value.launchJournalDigest !== hash(state.launchJournal) || value.runtimeDigest !== hash(state.runtime) ||
      !matches(DIGEST, value.pm2RegistryDigest) || !time(value.observedAt) || value.observedAt < AUTHORIZATION.authorizedAt ||
      value.observedAt > now || now - value.observedAt > MAINTENANCE_PRELAUNCH_RECOVERY_HISTORY_MAX_AGE_MS ||
      !exact(value.current, ["target", "linkIdentity", "runtimeIdentity"]) || value.current.target !== state.launchDisk.runtime ||
      typeof value.current.target !== "string" || posix.dirname(value.current.target) !== state.appDir + ".releases" ||
      !matches(IDENTITY, value.current.linkIdentity) || !matches(IDENTITY, value.current.runtimeIdentity) ||
      value.current.runtimeIdentity !== state.launchDisk.runtimeIdentity) fail();
  return value;
}
function checkInspection(value) {
  if (!exact(value, INSPECTION_KEYS) || value.version !== 1 || value.state !== "prelaunch-recovery-inspected" ||
      value.operationId !== INCIDENT.operationId || value.previousTargetSha !== INCIDENT.previousTargetSha ||
      value.expectedOldSha !== INCIDENT.expectedOldSha || value.revision !== INCIDENT.revision || value.stateDigest !== INCIDENT.stateDigest ||
      value.createdAt !== INCIDENT.createdAt || value.activeAttempt !== 3 || !newTarget(value.targetSha) ||
      value.authorizationDigest !== MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION_DIGEST ||
      !["sourceDiffDigest", "migrationDigest", "predecessorJournalDigest", "stoppedBaselineDigest"].every(key => matches(DIGEST, value[key])) ||
      RUN_KEYS.some(key => value[key] !== INCIDENT[key])) fail();
  baselineShape(value.stoppedBaseline);
  if (hash(value.stoppedBaseline) !== value.stoppedBaselineDigest || value.predecessorJournalDigest !== hash(null)) fail();
  return project(value, INSPECTION_KEYS);
}
function checkEvidence(value) {
  if (!exact(value, EVIDENCE_KEYS)) fail(); checkInspection(project(value, INSPECTION_KEYS));
  if (value.toolsSha !== value.targetSha || !matches(RUN, value.prelaunchRecoveryRunId) || value.prelaunchRecoveryRunAttempt !== 1 ||
      !matches(RUN, value.mainCIrunId) || value.prelaunchRecoveryRunId === value.mainCIrunId ||
      PRIOR_RUNS.includes(value.prelaunchRecoveryRunId) || PRIOR_RUNS.includes(value.mainCIrunId) || !matches(DIGEST, value.historyDigest) ||
      !time(value.historyCheckedAt) || value.historyCheckedAt < AUTHORIZATION.authorizedAt || value.historyCheckedAt >= AUTHORIZATION.expiresAt) fail();
  return project(value, EVIDENCE_KEYS);
}
function inspectionFor(state, context) {
  if (!exact(context, CONTEXT_KEYS) || context.operationId !== INCIDENT.operationId || context.previousTargetSha !== INCIDENT.previousTargetSha ||
      context.expectedOldSha !== INCIDENT.expectedOldSha || context.expectedRevision !== INCIDENT.revision || context.expectedDigest !== INCIDENT.stateDigest ||
      !newTarget(context.targetSha) || ![context.sourceDiffDigest, context.migrationDigest].every(value => matches(DIGEST, value))) fail();
  actualClock({ bootId: context.bootId, now: context.now }); predecessorAudit(state);
  baselineFor(context.stoppedBaseline, state, context.now);
  return checkInspection({ version: 1, state: "prelaunch-recovery-inspected", operationId: INCIDENT.operationId, targetSha: context.targetSha,
    previousTargetSha: INCIDENT.previousTargetSha, expectedOldSha: INCIDENT.expectedOldSha, revision: INCIDENT.revision,
    stateDigest: INCIDENT.stateDigest, createdAt: INCIDENT.createdAt, activeAttempt: 3, sourceDiffDigest: context.sourceDiffDigest,
    migrationDigest: context.migrationDigest, predecessorJournalDigest: hash(state.launchJournal), stoppedBaselineDigest: hash(context.stoppedBaseline),
    stoppedBaseline: context.stoppedBaseline,
    authorizationDigest: MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION_DIGEST, ...project(INCIDENT, RUN_KEYS) });
}

export function validateMaintenancePrelaunchRecoveryPredecessor(rawState, rawClock) {
  const state = bounded(rawState), clock = bounded(rawClock); actualClock(clock); predecessorAudit(state); return freeze(state);
}
export function createMaintenancePrelaunchRecoveryInspection(rawState, rawContext) {
  return freeze(inspectionFor(bounded(rawState), bounded(rawContext)));
}
export function validateMaintenancePrelaunchRecoveryInspection(value) {
  return freeze(checkInspection(bounded(value, MAINTENANCE_PRELAUNCH_RECOVERY_MAX_EVIDENCE_BYTES)));
}
export function validateMaintenancePrelaunchRecoveryEvidence(value) {
  return freeze(checkEvidence(bounded(value, MAINTENANCE_PRELAUNCH_RECOVERY_MAX_EVIDENCE_BYTES)));
}
export function encodeMaintenancePrelaunchRecoveryEvidence(value) {
  const encoded = Buffer.from(JSON.stringify(validateMaintenancePrelaunchRecoveryEvidence(value))).toString("base64url");
  if (encoded.length > MAINTENANCE_PRELAUNCH_RECOVERY_MAX_EVIDENCE_BYTES) fail(); return encoded;
}
export function decodeMaintenancePrelaunchRecoveryEvidence(value) {
  if (typeof value !== "string" || !value || value.length > MAINTENANCE_PRELAUNCH_RECOVERY_MAX_EVIDENCE_BYTES || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64url"));
    const result = validateMaintenancePrelaunchRecoveryEvidence(JSON.parse(decoded));
    if (encodeMaintenancePrelaunchRecoveryEvidence(result) !== value) fail(); return result;
  } catch { fail(); }
}
export function buildMaintenancePrelaunchRecoveredState(rawState, rawEvidence, rawContext) {
  const state = bounded(rawState), context = bounded(rawContext), evidence = checkEvidence(bounded(rawEvidence, MAINTENANCE_PRELAUNCH_RECOVERY_MAX_EVIDENCE_BYTES));
  const inspection = inspectionFor(state, context);
  if (!isDeepStrictEqual(inspection, project(evidence, INSPECTION_KEYS)) || evidence.historyCheckedAt > context.now ||
      context.now - evidence.historyCheckedAt > MAINTENANCE_PRELAUNCH_RECOVERY_HISTORY_MAX_AGE_MS) fail();
  // No attempt increment and no journal reset: the exact predecessor already
  // has five null active fields. Every old consumed journal stays untouched.
  const next = { ...state, version: 10, revision: state.revision + 1, targetSha: context.targetSha, phase: "held",
    prelaunchRecovery: { version: 1, predecessor: compactPredecessor(state), evidence,
      recoveredAt: context.now, stoppedBaseline: context.stoppedBaseline, authorization: { ...AUTHORIZATION } } };
  return validateMaintenancePrelaunchRecoveryState(next, { bootId: context.bootId, now: context.now });
}
export function validateMaintenancePrelaunchRecoveryState(rawState, rawClock) {
  const state = bounded(rawState), clock = bounded(rawClock); actualClock(clock);
  if (!exact(state, [...STATE_KEYS, "prelaunchRecovery"]) || state.version !== 10 || state.activeAttempt !== 3 ||
      !integer(state.revision) || state.revision <= INCIDENT.revision || !PHASES.includes(state.phase) ||
      !exact(state.prelaunchRecovery, AUDIT_KEYS)) fail();
  const audit = state.prelaunchRecovery;
  if (audit.version !== 1 || !isDeepStrictEqual(audit.authorization, AUTHORIZATION) || !time(audit.recoveredAt) ||
      audit.recoveredAt < AUTHORIZATION.authorizedAt || audit.recoveredAt > clock.now || audit.recoveredAt >= AUTHORIZATION.expiresAt) fail();
  const predecessor = reconstructPredecessor(state), evidence = checkEvidence(audit.evidence);
  baselineFor(audit.stoppedBaseline, predecessor, audit.recoveredAt);
  if (!record(state.ingress) || state.targetSha !== evidence.targetSha ||
      evidence.stoppedBaselineDigest !== hash(audit.stoppedBaseline) || !isDeepStrictEqual(evidence.stoppedBaseline, audit.stoppedBaseline) ||
      evidence.historyCheckedAt > audit.recoveredAt || audit.recoveredAt - evidence.historyCheckedAt > MAINTENANCE_PRELAUNCH_RECOVERY_HISTORY_MAX_AGE_MS ||
      (state.revision === INCIDENT.revision + 1 && (state.phase !== "held" || !LAUNCH_KEYS.every(key => state[key] === null) ||
        !isDeepStrictEqual(state.ingress, predecessor.ingress))) ||
      (["candidate", "resuming", "ended"].includes(state.phase) && state.candidate === null) ||
      (state.phase === "ended" && state.finalDump === null)) fail();
  const archived = predecessor.budgetRecovery.predecessor.state;
  checkLaunchShape(state, [archived.launchJournal, archived.secondAttemptRecovery.predecessor.state.launchJournal,
    archived.attemptRecovery.predecessor.state.launchJournal]
    .flatMap(journal => Object.values(journal.slots).filter(Boolean).map(slot => slot.nonce)));
  return freeze(state);
}
/** Historical reconstruction only. Never use this as an active launch proof. */
export function reconstructMaintenancePrelaunchRecoveryPredecessor(rawState, rawClock) {
  // validateState has just audited this exact projection. Do not traverse the
  // old proof chain twice within this one call; no cross-call cache is used.
  return freeze(projectOriginal(validateMaintenancePrelaunchRecoveryState(rawState, rawClock)));
}
function journalProgress(previous, next) {
  const before = previous.launchJournal, after = next.launchJournal;
  if (before === null && after === null) return;
  if (after === null) fail();
  const binding = launchBinding(next);
  if (before === null) {
    if (Object.values(after.slots).some(slot => slot !== null)) fail();
    return;
  }
  if (isDeepStrictEqual(before, after)) return;
  const changed = ["paused-web", "resumed-web", "worker"].filter(role => !isDeepStrictEqual(before.slots[role], after.slots[role]));
  if (changed.length !== 1) fail();
  const role = changed[0], entry = after.slots[role]; if (!entry) fail();
  let expected;
  try {
    if (before.slots[role] === null) {
      expected = planMaintenanceLaunch(before, binding, { role, sequence: entry.sequence, nonce: entry.nonce, environmentDigest: entry.environmentDigest });
    } else {
      const event = { role, sequence: entry.sequence, nonce: entry.nonce, phase: entry.phase };
      if (entry.phase === "confirmed") event.observation = { ...binding, role, sequence: entry.sequence,
        observedNonce: entry.nonce, environmentDigest: entry.environmentDigest, instance: entry.instance };
      expected = transitionMaintenanceLaunch(before, binding, event);
    }
  } catch { fail(); }
  if (!isDeepStrictEqual(expected, after)) fail();
}
/** Structural guard for EVERY writer. Real-clock/host validation and the
 * existing raw-byte/revision CAS remain caller obligations. Audit-time below
 * only reconstructs a stored transition; it is never an actuation clock. */
export function assertMaintenancePrelaunchRecoveryProgress(rawPrevious, rawNext) {
  const previous = bounded(rawPrevious), next = bounded(rawNext);
  if (!record(previous) || !record(next)) fail();
  if (previous.version !== 10 && next.version !== 10) {
    if ([previous, next].some(state => Object.hasOwn(state, "prelaunchRecovery"))) fail();
    return assertMaintenanceWindowRenewalProgress(previous, next);
  }
  if (previous.version === 9 && next.version === 10) {
    if (!exact(next.prelaunchRecovery, AUDIT_KEYS)) fail();
    const audit = next.prelaunchRecovery, evidence = checkEvidence(audit.evidence);
    const expected = buildMaintenancePrelaunchRecoveredState(previous, evidence, { operationId: evidence.operationId,
      previousTargetSha: evidence.previousTargetSha, targetSha: evidence.targetSha, expectedOldSha: evidence.expectedOldSha,
      expectedRevision: evidence.revision, expectedDigest: evidence.stateDigest, bootId: previous.bootId, now: audit.recoveredAt,
      sourceDiffDigest: evidence.sourceDiffDigest, migrationDigest: evidence.migrationDigest, stoppedBaseline: audit.stoppedBaseline });
    if (!isDeepStrictEqual(next, expected)) fail(); return;
  }
  if (previous.version !== 10 || next.version !== 10 || !integer(previous.revision) || previous.revision === Number.MAX_SAFE_INTEGER ||
      next.revision !== previous.revision + 1 || [...FIXED_KEYS, "targetSha", "activeAttempt", "prelaunchRecovery"].some(key => !isDeepStrictEqual(previous[key], next[key])) ||
      !({ held: ["held", "candidate", "failed-held", "failed-unknown"], candidate: ["candidate", "resuming", "failed-held", "failed-unknown"],
        resuming: ["resuming", "ended", "failed-held", "failed-unknown"], ended: ["ended", "failed-held", "failed-unknown"],
        "failed-held": ["failed-held", "failed-unknown"], "failed-unknown": ["failed-held", "failed-unknown"] }[previous.phase] || []).includes(next.phase) ||
      (previous.launchDisk !== null && !isDeepStrictEqual(previous.launchDisk, next.launchDisk)) ||
      LAUNCH_KEYS.some(key => previous[key] !== null && next[key] === null)) fail();
  const auditClock = { bootId: INCIDENT.bootId, now: previous.prelaunchRecovery?.recoveredAt };
  validateMaintenancePrelaunchRecoveryState(previous, auditClock); validateMaintenancePrelaunchRecoveryState(next, auditClock);
  journalProgress(previous, next);
}
