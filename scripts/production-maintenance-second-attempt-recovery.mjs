import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { isProxy } from "node:util/types";
import { assertMaintenanceAttemptRecoveryProgress, validateMaintenanceAttemptRecoveryState } from "./production-maintenance-attempt-recovery.mjs";
import { validateMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";

/** Pure, exactly ONE separately authorized second additional attempt. No clock, I/O, launch, stop, persistence or
 * authentication. The caller must independently prove stopped candidate/O,
 * ingress, database, exact source/CI/history, then use the existing operation
 * lock and actual raw-byte/revision CAS. A digest-shaped value proves none of
 * those observations. The original consumed journal remains in predecessor.
 * Version 7 preserves the whole v6 and v5 history. No actuation projection.
 */
export const MAINTENANCE_SECOND_ATTEMPT_RECOVERY_INCIDENT = Object.freeze({
  operationId: "eb81284a-09c4-4514-8f16-38eaf6acc1e4",
  bootId: "e6531ec9-db4a-4216-b87a-7cc858197eaa",
  previousTargetSha: "3af8fa6ba6644593e10bef0a391389b2b34e926a",
  expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6",
  revision: 23, createdAt: 1789236034129,
  stateDigest: "785a4139be1cc78b42fd0a9e2dde619d995f0b2f1be521589ec31fd900c0db75",
  backupRunId: "34789894868", backupRunAttempt: 1,
  migrationRunId: "34721155156", migrationRunAttempt: 1,
  readinessRunId: "34790775352", readinessRunAttempt: 1,
  failedDeployRunId: "34790827235", failedDeployRunAttempt: 1,
});
const INCIDENT = MAINTENANCE_SECOND_ATTEMPT_RECOVERY_INCIDENT;
export const MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION = Object.freeze({
  version: 1, operationId: INCIDENT.operationId, predecessorDigest: INCIDENT.stateDigest,
  // Recorded tool-confirmation time, not a claim about exact user-message time.
  authorizedAt: Date.parse("2026-09-14T02:01:33.000Z"),
  priorAcknowledgedAt: Date.parse("2026-09-14T01:12:17.000Z"),
  expiresAt: Date.parse("2026-09-14T04:00:00.000Z"),
  previousActiveAttempt: 1, activeAttempt: 2, maximumAdditionalAttempts: 1,
});
const AUTHORIZATION = MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION;
export const MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION_DIGEST = createHash("sha256").update(JSON.stringify(AUTHORIZATION)).digest("hex");
export const MAINTENANCE_SECOND_ATTEMPT_RECOVERY_MAX_EVIDENCE_BYTES = 16 * 1024;
export const MAINTENANCE_SECOND_ATTEMPT_RECOVERY_HISTORY_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/, DIGEST = /^[0-9a-f]{64}$/, RUN = /^[1-9][0-9]{0,19}$/;
const IDENTITY = /^(?:0|[1-9][0-9]{0,24})(?::(?:0|[1-9][0-9]{0,24})){7}$/;
const STATE_KEYS = ["version", "revision", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed", "launchDisk", "launchJournal", "finalDump", "recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery"];
const LAUNCH_KEYS = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const RUN_KEYS = ["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt", "failedDeployRunId", "failedDeployRunAttempt"];
const INSPECTION_KEYS = ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha", "revision", "stateDigest", "createdAt", "activeAttempt", "sourceDiffDigest", "migrationDigest", "predecessorJournalDigest", "stoppedBaselineDigest", "stoppedBaseline", "authorizationDigest", ...RUN_KEYS];
const EVIDENCE_KEYS = [...INSPECTION_KEYS, "toolsSha", "secondAttemptRecoveryRunId", "secondAttemptRecoveryRunAttempt", "mainCIrunId", "historyDigest", "historyCheckedAt"];
const CONTEXT_KEYS = ["operationId", "previousTargetSha", "targetSha", "expectedOldSha", "expectedRevision", "expectedDigest", "bootId", "now", "sourceDiffDigest", "migrationDigest", "stoppedBaseline"];
const BASELINE_KEYS = ["version", "stateDigest", "candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "current", "bootId", "pm2RegistryDigest", "observedAt"];
const AUDIT_KEYS = ["version", "predecessor", "evidence", "recoveredAt", "stoppedBaseline", "authorization"];
const FIXED_KEYS = ["operationId", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "runtime", "database", "publicSupabaseUrl", "tokenHash", "recovery", "continuation", "buildRecovery", "deadlineExtension", "attemptRecovery"];
const PHASES = ["held", "candidate", "resuming", "ended", "failed-held", "failed-unknown"];
const PRIOR_RUNS = ["34715768455", "34715352249", "34715932102", "34721155156", "34721256683", "34721317710", "34724808528", "34724337523", "34724943157", "34728212357", "34728263285", "34745334237", "34742540111", "34777790522", "34778424264", "34778579797", "34781336277", "34781392661", "34789133814", "34789744074", "34789894868", "34790775352", "34790827235"];
const OLD_TARGETS = [INCIDENT.previousTargetSha, INCIDENT.expectedOldSha, "f3104de19aa59e527c7b94a99850d151448da8cd", "1b09cdbf25ec1b4164e200486f009500b6551ed4", "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf", "46f007fbd9e417f93c01e398c77cf38ec814547d", "13df917416cf06ce27fce021460b08caf50f6165"];
const fail = () => { throw new Error("maintenance_second_attempt_recovery_invalid"); };
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
function predecessorAudit(state, now) {
  if (!exact(state, STATE_KEYS) || state.version !== 6 || state.activeAttempt !== 1 ||
      state.revision !== INCIDENT.revision || state.phase !== "failed-held" ||
      state.operationId !== INCIDENT.operationId || state.bootId !== INCIDENT.bootId || state.targetSha !== INCIDENT.previousTargetSha ||
      state.expectedOldSha !== INCIDENT.expectedOldSha || state.createdAt !== INCIDENT.createdAt || hash(state) !== INCIDENT.stateDigest ||
      state.resumed !== null || state.finalDump !== null || !record(state.candidate) || !record(state.launchDisk) || !record(state.launchJournal)) fail();
  // The predecessor is STILL within the original v6 04:00 UTC authorization.
  // Validate it with the actual supplied clock. Never relabel v7 as v6, change
  // createdAt, or use an expired-version historical clock to authorize service.
  try { validateMaintenanceAttemptRecoveryState(state, { bootId: INCIDENT.bootId, now }); } catch { fail(); }
  checkLaunchShape(state);
  if (state.candidate.pauseExpected !== "1" || state.launchJournal.slots["paused-web"]?.phase !== "confirmed" ||
      state.launchJournal.slots["resumed-web"] !== null || state.launchJournal.slots.worker !== null) fail();
  return state;
}
function baselineShape(value) {
  if (!exact(value, BASELINE_KEYS) || value.version !== 2 || value.stateDigest !== INCIDENT.stateDigest || value.bootId !== INCIDENT.bootId ||
      !["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "pm2RegistryDigest"].every(key => matches(DIGEST, value[key])) ||
      !time(value.observedAt) || value.observedAt < AUTHORIZATION.authorizedAt || value.observedAt >= AUTHORIZATION.expiresAt ||
      !exact(value.current, ["target", "linkIdentity", "runtimeIdentity"]) || typeof value.current.target !== "string" ||
      value.current.target.length > 500 || !/^\/[A-Za-z0-9._/-]+$/.test(value.current.target) || posix.normalize(value.current.target) !== value.current.target ||
      !posix.dirname(value.current.target).endsWith(".releases") ||
      !new RegExp(`^${INCIDENT.previousTargetSha.slice(0, 12)}-[0-9]{14}$`).test(posix.basename(value.current.target)) ||
      !matches(IDENTITY, value.current.linkIdentity) || !matches(IDENTITY, value.current.runtimeIdentity)) fail();
  return value;
}
function baselineFor(value, state, now) {
  baselineShape(value);
  if (
      value.candidateDigest !== hash(state.candidate) || value.launchDiskDigest !== hash(state.launchDisk) ||
      value.launchJournalDigest !== hash(state.launchJournal) || value.runtimeDigest !== hash(state.runtime) ||
      !matches(DIGEST, value.pm2RegistryDigest) || !time(value.observedAt) || value.observedAt < AUTHORIZATION.authorizedAt ||
      value.observedAt > now || now - value.observedAt > MAINTENANCE_SECOND_ATTEMPT_RECOVERY_HISTORY_MAX_AGE_MS ||
      !exact(value.current, ["target", "linkIdentity", "runtimeIdentity"]) || value.current.target !== state.launchDisk.runtime ||
      typeof value.current.target !== "string" || posix.dirname(value.current.target) !== state.appDir + ".releases" ||
      !matches(IDENTITY, value.current.linkIdentity) || !matches(IDENTITY, value.current.runtimeIdentity) ||
      value.current.runtimeIdentity !== state.launchDisk.runtimeIdentity) fail();
  return value;
}
function checkInspection(value) {
  if (!exact(value, INSPECTION_KEYS) || value.version !== 1 || value.state !== "second-attempt-recovery-inspected" ||
      value.operationId !== INCIDENT.operationId || value.previousTargetSha !== INCIDENT.previousTargetSha ||
      value.expectedOldSha !== INCIDENT.expectedOldSha || value.revision !== INCIDENT.revision || value.stateDigest !== INCIDENT.stateDigest ||
      value.createdAt !== INCIDENT.createdAt || value.activeAttempt !== 2 || !newTarget(value.targetSha) ||
      value.authorizationDigest !== MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION_DIGEST ||
      !["sourceDiffDigest", "migrationDigest", "predecessorJournalDigest", "stoppedBaselineDigest"].every(key => matches(DIGEST, value[key])) ||
      RUN_KEYS.some(key => value[key] !== INCIDENT[key])) fail();
  baselineShape(value.stoppedBaseline);
  if (hash(value.stoppedBaseline) !== value.stoppedBaselineDigest || value.predecessorJournalDigest !== value.stoppedBaseline.launchJournalDigest) fail();
  return project(value, INSPECTION_KEYS);
}
function checkEvidence(value) {
  if (!exact(value, EVIDENCE_KEYS)) fail(); checkInspection(project(value, INSPECTION_KEYS));
  if (value.toolsSha !== value.targetSha || !matches(RUN, value.secondAttemptRecoveryRunId) || value.secondAttemptRecoveryRunAttempt !== 1 ||
      !matches(RUN, value.mainCIrunId) || value.secondAttemptRecoveryRunId === value.mainCIrunId ||
      PRIOR_RUNS.includes(value.secondAttemptRecoveryRunId) || PRIOR_RUNS.includes(value.mainCIrunId) || !matches(DIGEST, value.historyDigest) ||
      !time(value.historyCheckedAt) || value.historyCheckedAt < AUTHORIZATION.authorizedAt || value.historyCheckedAt >= AUTHORIZATION.expiresAt) fail();
  return project(value, EVIDENCE_KEYS);
}
function inspectionFor(state, context) {
  if (!exact(context, CONTEXT_KEYS) || context.operationId !== INCIDENT.operationId || context.previousTargetSha !== INCIDENT.previousTargetSha ||
      context.expectedOldSha !== INCIDENT.expectedOldSha || context.expectedRevision !== INCIDENT.revision || context.expectedDigest !== INCIDENT.stateDigest ||
      !newTarget(context.targetSha) || ![context.sourceDiffDigest, context.migrationDigest].every(value => matches(DIGEST, value))) fail();
  actualClock({ bootId: context.bootId, now: context.now }); predecessorAudit(state, context.now);
  baselineFor(context.stoppedBaseline, state, context.now);
  return checkInspection({ version: 1, state: "second-attempt-recovery-inspected", operationId: INCIDENT.operationId, targetSha: context.targetSha,
    previousTargetSha: INCIDENT.previousTargetSha, expectedOldSha: INCIDENT.expectedOldSha, revision: INCIDENT.revision,
    stateDigest: INCIDENT.stateDigest, createdAt: INCIDENT.createdAt, activeAttempt: 2, sourceDiffDigest: context.sourceDiffDigest,
    migrationDigest: context.migrationDigest, predecessorJournalDigest: hash(state.launchJournal), stoppedBaselineDigest: hash(context.stoppedBaseline),
    stoppedBaseline: context.stoppedBaseline,
    authorizationDigest: MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION_DIGEST, ...project(INCIDENT, RUN_KEYS) });
}

export function validateMaintenanceSecondAttemptRecoveryPredecessor(rawState, rawClock) {
  const state = bounded(rawState), clock = bounded(rawClock); actualClock(clock); predecessorAudit(state, clock.now); return freeze(state);
}
export function createMaintenanceSecondAttemptRecoveryInspection(rawState, rawContext) {
  return freeze(inspectionFor(bounded(rawState), bounded(rawContext)));
}
export function validateMaintenanceSecondAttemptRecoveryInspection(value) {
  return freeze(checkInspection(bounded(value, MAINTENANCE_SECOND_ATTEMPT_RECOVERY_MAX_EVIDENCE_BYTES)));
}
export function validateMaintenanceSecondAttemptRecoveryEvidence(value) {
  return freeze(checkEvidence(bounded(value, MAINTENANCE_SECOND_ATTEMPT_RECOVERY_MAX_EVIDENCE_BYTES)));
}
export function encodeMaintenanceSecondAttemptRecoveryEvidence(value) {
  const encoded = Buffer.from(JSON.stringify(validateMaintenanceSecondAttemptRecoveryEvidence(value))).toString("base64url");
  if (encoded.length > MAINTENANCE_SECOND_ATTEMPT_RECOVERY_MAX_EVIDENCE_BYTES) fail(); return encoded;
}
export function decodeMaintenanceSecondAttemptRecoveryEvidence(value) {
  if (typeof value !== "string" || !value || value.length > MAINTENANCE_SECOND_ATTEMPT_RECOVERY_MAX_EVIDENCE_BYTES || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64url"));
    const result = validateMaintenanceSecondAttemptRecoveryEvidence(JSON.parse(decoded));
    if (encodeMaintenanceSecondAttemptRecoveryEvidence(result) !== value) fail(); return result;
  } catch { fail(); }
}
export function buildMaintenanceSecondAttemptRecoveredState(rawState, rawEvidence, rawContext) {
  const state = bounded(rawState), context = bounded(rawContext), evidence = checkEvidence(bounded(rawEvidence, MAINTENANCE_SECOND_ATTEMPT_RECOVERY_MAX_EVIDENCE_BYTES));
  const inspection = inspectionFor(state, context);
  if (!isDeepStrictEqual(inspection, project(evidence, INSPECTION_KEYS)) || evidence.historyCheckedAt > context.now ||
      context.now - evidence.historyCheckedAt > MAINTENANCE_SECOND_ATTEMPT_RECOVERY_HISTORY_MAX_AGE_MS) fail();
  const next = { ...state, version: 7, revision: state.revision + 1, targetSha: context.targetSha, phase: "held",
    ...Object.fromEntries(LAUNCH_KEYS.map(key => [key, null])), activeAttempt: 2,
    secondAttemptRecovery: { version: 1, predecessor: { stateDigest: INCIDENT.stateDigest, state }, evidence,
      recoveredAt: context.now, stoppedBaseline: context.stoppedBaseline, authorization: { ...AUTHORIZATION } } };
  return validateMaintenanceSecondAttemptRecoveryState(next, { bootId: context.bootId, now: context.now });
}
export function validateMaintenanceSecondAttemptRecoveryState(rawState, rawClock) {
  const state = bounded(rawState), clock = bounded(rawClock); actualClock(clock);
  if (!exact(state, [...STATE_KEYS, "secondAttemptRecovery"]) || state.version !== 7 || state.activeAttempt !== 2 ||
      !integer(state.revision) || state.revision <= INCIDENT.revision || !PHASES.includes(state.phase) ||
      !exact(state.secondAttemptRecovery, AUDIT_KEYS)) fail();
  const audit = state.secondAttemptRecovery;
  if (audit.version !== 1 || !exact(audit.predecessor, ["stateDigest", "state"]) || audit.predecessor.stateDigest !== INCIDENT.stateDigest ||
      !isDeepStrictEqual(audit.authorization, AUTHORIZATION) || !time(audit.recoveredAt) ||
      audit.recoveredAt < AUTHORIZATION.authorizedAt || audit.recoveredAt > clock.now || audit.recoveredAt >= AUTHORIZATION.expiresAt) fail();
  const predecessor = predecessorAudit(audit.predecessor.state, clock.now), evidence = checkEvidence(audit.evidence);
  baselineFor(audit.stoppedBaseline, predecessor, audit.recoveredAt);
  if (FIXED_KEYS.some(key => !isDeepStrictEqual(state[key], predecessor[key])) || !record(state.ingress) ||
      state.targetSha !== evidence.targetSha || evidence.predecessorJournalDigest !== hash(predecessor.launchJournal) ||
      evidence.stoppedBaselineDigest !== hash(audit.stoppedBaseline) || !isDeepStrictEqual(evidence.stoppedBaseline, audit.stoppedBaseline) || evidence.historyCheckedAt > audit.recoveredAt ||
      audit.recoveredAt - evidence.historyCheckedAt > MAINTENANCE_SECOND_ATTEMPT_RECOVERY_HISTORY_MAX_AGE_MS ||
      (state.revision === INCIDENT.revision + 1 && (state.phase !== "held" || !LAUNCH_KEYS.every(key => state[key] === null))) ||
      (["candidate", "resuming", "ended"].includes(state.phase) && state.candidate === null) ||
      (state.phase === "ended" && state.finalDump === null)) fail();
  checkLaunchShape(state, [predecessor.launchJournal, predecessor.attemptRecovery.predecessor.state.launchJournal]
    .flatMap(journal => Object.values(journal.slots).filter(Boolean).map(slot => slot.nonce)));
  return freeze(state);
}
/** No version projection: this view remains v7 with both archived attempts. */
export function readMaintenanceSecondActiveAttempt(state, clock) {
  return validateMaintenanceSecondAttemptRecoveryState(state, clock);
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
export function assertMaintenanceSecondAttemptRecoveryProgress(rawPrevious, rawNext) {
  const previous = bounded(rawPrevious), next = bounded(rawNext);
  if (!record(previous) || !record(next)) fail();
  if (previous.version !== 7 && next.version !== 7) {
    if ([previous, next].some(state => Object.hasOwn(state, "secondAttemptRecovery"))) fail();
    return assertMaintenanceAttemptRecoveryProgress(previous, next);
  }
  if (previous.version === 6 && next.version === 7) {
    if (!exact(next.secondAttemptRecovery, AUDIT_KEYS)) fail();
    const audit = next.secondAttemptRecovery, evidence = checkEvidence(audit.evidence);
    const expected = buildMaintenanceSecondAttemptRecoveredState(previous, evidence, { operationId: evidence.operationId,
      previousTargetSha: evidence.previousTargetSha, targetSha: evidence.targetSha, expectedOldSha: evidence.expectedOldSha,
      expectedRevision: evidence.revision, expectedDigest: evidence.stateDigest, bootId: previous.bootId, now: audit.recoveredAt,
      sourceDiffDigest: evidence.sourceDiffDigest, migrationDigest: evidence.migrationDigest, stoppedBaseline: audit.stoppedBaseline });
    if (!isDeepStrictEqual(next, expected)) fail(); return;
  }
  if (previous.version !== 7 || next.version !== 7 || !integer(previous.revision) || previous.revision === Number.MAX_SAFE_INTEGER ||
      next.revision !== previous.revision + 1 || [...FIXED_KEYS, "targetSha", "activeAttempt", "secondAttemptRecovery"].some(key => !isDeepStrictEqual(previous[key], next[key])) ||
      !( { held: ["held", "candidate", "failed-held", "failed-unknown"], candidate: ["candidate", "resuming", "failed-held", "failed-unknown"],
        resuming: ["resuming", "ended", "failed-held", "failed-unknown"], ended: ["ended", "failed-held", "failed-unknown"],
        "failed-held": ["failed-held", "failed-unknown"], "failed-unknown": ["failed-held", "failed-unknown"] }[previous.phase] || []).includes(next.phase) ||
      (previous.launchDisk !== null && !isDeepStrictEqual(previous.launchDisk, next.launchDisk)) ||
      LAUNCH_KEYS.some(key => previous[key] !== null && next[key] === null)) fail();
  const auditClock = { bootId: INCIDENT.bootId, now: previous.secondAttemptRecovery?.recoveredAt };
  validateMaintenanceSecondAttemptRecoveryState(previous, auditClock); validateMaintenanceSecondAttemptRecoveryState(next, auditClock);
  journalProgress(previous, next);
}

