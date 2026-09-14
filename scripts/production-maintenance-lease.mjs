import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { validateMaintenancePreflightRecoveryState, assertMaintenancePreflightRecoveryProgress,
  captureMaintenancePreflightValue as capture, assertMaintenancePreflightLaunchShape as launchShape,
  assertMaintenancePreflightJournalProgress as journalProgress } from "./production-maintenance-preflight-recovery.mjs";

// The user authorized automatic maintenance-window extensions on 2026-09-14.
// This is a time-only lease: never another launch, failed-state recovery, new
// credentials, data change, rollback re-anchor or waiver of live host checks.
export const MAINTENANCE_LEASE_AUTHORIZATION = Object.freeze({
  version: 1, operationId: "eb81284a-09c4-4514-8f16-38eaf6acc1e4",
  authorizedAt: Date.parse("2026-09-14T19:51:03Z"), automaticRenewal: true,
  maximumLeaseMilliseconds: 12 * 60 * 60 * 1000,
  activeAttempt: 3, maximumAdditionalAttempts: 0,
});
export const MAINTENANCE_LEASE_PREDECESSOR = Object.freeze({
  version: 11, revision: 39, phase: "held", stateBytes: 2099829,
  stateDigest: "728b41efe1e4538c21caa195716214553e51c4cbf56cb14d04f57863fcb82898",
  targetSha: "3614f5bfc85cf72d064732141a9998a0bbaec513",
  expectedOldSha: "cd943076ebda758b70bf2f2270a508c774b726d6",
  bootId: "e6531ec9-db4a-4216-b87a-7cc858197eaa",
  recoveryRunId: "34885715614", mainCIrunId: "34882604766",
});
const AUTH = MAINTENANCE_LEASE_AUTHORIZATION, PIN = MAINTENANCE_LEASE_PREDECESSOR;
// Separate explicit authorization; a time-only lease NEVER grants recovery.
export const MAINTENANCE_FENCE_RECOVERY_AUTHORIZATION = Object.freeze({
  version: 1, operationId: AUTH.operationId, authorizedAt: Date.parse("2026-09-14T22:21:26Z"),
  activeAttempt: 3, maximumAdditionalAttempts: 0,
  predecessorDigest: "76f254773bfcc1c98b23b419c2d94040a438aab2f8c1794d30e0d2528ff9859f",
});
export const MAINTENANCE_FENCE_RECOVERY_PREDECESSOR = Object.freeze({
  version: 12, revision: 42, phase: "failed-held", stateBytes: 2276109,
  stateDigest: MAINTENANCE_FENCE_RECOVERY_AUTHORIZATION.predecessorDigest,
  targetSha: "552bfaafea802ee1371329afce0424b096b44453",
  expectedOldSha: PIN.expectedOldSha, bootId: PIN.bootId,
  failedDeployRunId: "34901630408", backupRunId: "34896361029", readinessRunId: "34901481955",
  leaseRunId: "34895798474", mainCIrunId: "34892730757",
});
const FENCE_AUTH = MAINTENANCE_FENCE_RECOVERY_AUTHORIZATION, FENCE_PIN = MAINTENANCE_FENCE_RECOVERY_PREDECESSOR;
const KEYS = ["version", "revision", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed", "launchDisk", "launchJournal", "finalDump", "recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal", "prelaunchRecovery", "preflightRecovery"];
const LAUNCH = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const INSPECTION = ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha", "revision", "stateDigest", "stateBytes", "activeAttempt", "sourceDiffDigest", "migrationDigest", "stoppedBaseline", "stoppedBaselineDigest", "authorizationDigest"];
const EVIDENCE = [...INSPECTION, "toolsSha", "leaseRunId", "leaseRunAttempt", "mainCIrunId", "historyDigest", "historyCheckedAt"];
const AUDIT = ["version", "predecessor", "evidence", "renewedAt", "expiresAt", "stoppedBaseline", "authorization"];
const EVENT = ["version", "sequence", "previousExpiresAt", "renewedAt", "expiresAt", "evidence"];
const CONTEXT = ["operationId", "targetSha", "previousTargetSha", "expectedOldSha", "expectedRevision", "expectedDigest", "bootId", "now", "sourceDiffDigest", "migrationDigest", "stoppedBaseline"];
const PHASES = ["held", "candidate", "resuming", "ended", "failed-held", "failed-unknown"];
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const equal = isDeepStrictEqual;
const fail = () => { throw new Error("maintenance_lease_unverified"); };
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const number = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const run = value => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
const project = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function clock(value) {
  if (!exact(value, ["bootId", "now"]) || value.bootId !== PIN.bootId || !number(value.now) || value.now < AUTH.authorizedAt) fail();
}
function unused(state) { if (state.phase !== "held" || state.activeAttempt !== 3 || LAUNCH.some(key => state[key] !== null)) fail(); }
function original(state) {
  if (!exact(state, KEYS) || state.version !== 11 || state.revision !== PIN.revision || state.targetSha !== PIN.targetSha ||
      state.expectedOldSha !== PIN.expectedOldSha || state.bootId !== PIN.bootId || state.operationId !== AUTH.operationId ||
      hash(state) !== PIN.stateDigest || Buffer.byteLength(JSON.stringify(state)) !== PIN.stateBytes) fail();
  unused(state);
  // Only immutable, byte-pinned history uses this historical audit time.
  // Every actual filesystem/process/database observation uses the real clock.
  validateMaintenancePreflightRecoveryState(state, { bootId: PIN.bootId, now: AUTH.authorizedAt });
  return state;
}
function reconstruct(state) {
  const predecessor = state.leaseRenewal?.predecessor;
  if (!exact(predecessor, ["version", "revision", "phase", "targetSha", "stateDigest", "stateBytes", "ingress"]) ||
      ["version", "revision", "phase", "targetSha", "stateDigest", "stateBytes"].some(key => predecessor[key] !== PIN[key])) fail();
  return original({ ...project(state, KEYS), version: 11, revision: PIN.revision, phase: "held", targetSha: PIN.targetSha,
    ingress: predecessor.ingress, ...Object.fromEntries(LAUNCH.map(key => [key, null])) });
}
function baseline(value, predecessor, now) {
  const before = predecessor.preflightRecovery.stoppedBaseline;
  if (!value || !number(value.observedAt) || value.observedAt < AUTH.authorizedAt || value.observedAt > now || now - value.observedAt > 300000 ||
      !equal({ ...value, observedAt: before.observedAt }, before)) fail();
}
function inspection(value) {
  const recovering = value?.state === "fence-recovery-inspected";
  if (!exact(value, INSPECTION) || value.version !== 1 || !["lease-renewal-inspected", "fence-recovery-inspected"].includes(value.state) ||
      value.operationId !== AUTH.operationId || !sha(value.targetSha) || [PIN.targetSha, PIN.expectedOldSha].includes(value.targetSha) ||
      value.previousTargetSha !== (recovering ? FENCE_PIN.targetSha : PIN.targetSha) || value.expectedOldSha !== PIN.expectedOldSha || value.activeAttempt !== 3 ||
      !number(value.revision) || value.revision < PIN.revision || !number(value.stateBytes) || value.stateBytes < PIN.stateBytes || value.stateBytes > 4194304 ||
      ![value.stateDigest, value.sourceDiffDigest, value.migrationDigest, value.stoppedBaselineDigest].every(digest) ||
      hash(value.stoppedBaseline) !== value.stoppedBaselineDigest || value.authorizationDigest !== hash(recovering ? FENCE_AUTH : AUTH)) fail();
  if (recovering && (value.revision !== FENCE_PIN.revision || value.stateDigest !== FENCE_PIN.stateDigest ||
      value.stateBytes !== FENCE_PIN.stateBytes || value.targetSha === FENCE_PIN.targetSha)) fail();
  return value;
}
function evidence(value) {
  if (!exact(value, EVIDENCE)) fail(); inspection(project(value, INSPECTION));
  if (value.toolsSha !== value.targetSha || !run(value.leaseRunId) || value.leaseRunAttempt !== 1 || !run(value.mainCIrunId) ||
      value.leaseRunId === value.mainCIrunId || [PIN.recoveryRunId, PIN.mainCIrunId].includes(value.leaseRunId) ||
      !digest(value.historyDigest) || !number(value.historyCheckedAt) || value.historyCheckedAt < AUTH.authorizedAt) fail();
  return value;
}
function checkState(state) {
  const recovered = state?.version === 13;
  if (!exact(state, [...KEYS, "leaseRenewal", "leaseExtensions", ...(recovered ? ["fenceRecovery"] : [])]) || ![12, 13].includes(state.version) || state.activeAttempt !== 3 ||
      !PHASES.includes(state.phase) || !number(state.revision) || !exact(state.leaseRenewal, AUDIT) ||
      !Array.isArray(state.leaseExtensions) || state.leaseExtensions.length > 128 || state.revision < 40 + state.leaseExtensions.length) fail();
  const prior = reconstruct(state), audit = state.leaseRenewal, first = evidence(audit.evidence);
  if (audit.version !== 1 || !equal(audit.authorization, AUTH) || !number(audit.renewedAt) || audit.renewedAt < AUTH.authorizedAt ||
      audit.expiresAt !== audit.renewedAt + AUTH.maximumLeaseMilliseconds || first.revision !== PIN.revision ||
      first.stateDigest !== PIN.stateDigest || first.stateBytes !== PIN.stateBytes || first.targetSha !== (recovered ? FENCE_PIN.targetSha : state.targetSha) ||
      first.historyCheckedAt > audit.renewedAt || audit.renewedAt - first.historyCheckedAt > 300000 ||
      !equal(first.stoppedBaseline, audit.stoppedBaseline)) fail();
  baseline(audit.stoppedBaseline, prior, audit.renewedAt);
  let expiresAt = audit.expiresAt, lastTime = audit.renewedAt, lastRevision = PIN.revision;
  const runs = new Set([first.leaseRunId]);
  for (let index = 0; index < state.leaseExtensions.length; index++) {
    const event = state.leaseExtensions[index]; if (!exact(event, EVENT)) fail(); const item = evidence(event.evidence);
    if (event.version !== 1 || event.sequence !== index + 1 || event.previousExpiresAt !== expiresAt || !number(event.renewedAt) ||
        event.renewedAt < lastTime || event.expiresAt !== event.renewedAt + AUTH.maximumLeaseMilliseconds || event.expiresAt <= expiresAt ||
        item.targetSha !== state.targetSha || item.revision <= lastRevision || item.revision >= state.revision ||
        item.historyCheckedAt > event.renewedAt || event.renewedAt - item.historyCheckedAt > 300000 || runs.has(item.leaseRunId)) fail();
    baseline(item.stoppedBaseline, prior, event.renewedAt);
    runs.add(item.leaseRunId); expiresAt = event.expiresAt; lastTime = event.renewedAt; lastRevision = item.revision;
  }
  if ((state.revision === 40 && (state.phase !== "held" || LAUNCH.some(key => state[key] !== null) || !equal(state.ingress, prior.ingress))) ||
      (["candidate", "resuming", "ended"].includes(state.phase) && state.candidate === null) || (state.phase === "ended" && state.finalDump === null)) fail();
  const archived = prior.budgetRecovery.predecessor.state;
  launchShape(state, [archived.launchJournal, archived.secondAttemptRecovery.predecessor.state.launchJournal, archived.attemptRecovery.predecessor.state.launchJournal]
    .flatMap(journal => Object.values(journal.slots).filter(Boolean).map(slot => slot.nonce)));
  if (recovered) checkFenceRecoveryAudit(state);
  return { prior, expiresAt, lastTime };
}
function fenceOriginal(state) {
  const compact = state.fenceRecovery?.predecessor;
  if (!exact(compact, ["version", "revision", "phase", "targetSha", "stateDigest", "stateBytes", "ingress"]) ||
      ["version", "revision", "phase", "targetSha", "stateDigest", "stateBytes"].some(key => compact[key] !== FENCE_PIN[key])) fail();
  return { ...project(state, [...KEYS, "leaseRenewal", "leaseExtensions"]), version: 12, revision: 42, phase: "failed-held",
    targetSha: FENCE_PIN.targetSha, ingress: compact.ingress, leaseExtensions: [], ...Object.fromEntries(LAUNCH.map(key => [key, null])) };
}
function checkFencePredecessor(state, validateHistory = true) {
  if (state.version !== 12 || state.revision !== 42 || state.phase !== "failed-held" || state.activeAttempt !== 3 ||
      state.targetSha !== FENCE_PIN.targetSha || hash(state) !== FENCE_PIN.stateDigest ||
      Buffer.byteLength(JSON.stringify(state)) !== FENCE_PIN.stateBytes || LAUNCH.some(key => state[key] !== null)) fail();
  if (validateHistory) checkState(state);
}
function checkFenceRecoveryAudit(state) {
  const audit = state.fenceRecovery;
  if (!exact(audit, ["version", "predecessor", "evidence", "recoveredAt", "stoppedBaseline", "authorization"]) ||
      audit.version !== 1 || !equal(audit.authorization, FENCE_AUTH) || !number(audit.recoveredAt) || audit.recoveredAt < FENCE_AUTH.authorizedAt ||
      state.revision < 43 || (state.revision === 43 && (state.phase !== "held" || LAUNCH.some(key => state[key] !== null)))) fail();
  // checkState already verified the shared immutable history above. The raw
  // predecessor digest additionally pins every byte; do not traverse it twice.
  const original = fenceOriginal(state); checkFencePredecessor(original, false);
  const item = evidence(audit.evidence);
  if (item.state !== "fence-recovery-inspected" || item.targetSha !== state.targetSha || item.historyCheckedAt > audit.recoveredAt ||
      item.historyCheckedAt < FENCE_AUTH.authorizedAt || audit.recoveredAt - item.historyCheckedAt > 300000 || !equal(item.stoppedBaseline, audit.stoppedBaseline) ||
      audit.recoveredAt >= original.leaseRenewal.expiresAt || (state.revision === 43 && !equal(state.ingress, original.ingress))) fail();
  baseline(audit.stoppedBaseline, original, audit.recoveredAt);
}
export function validateMaintenanceFencePredecessor(raw, rawClock) {
  const state = capture(raw), time = capture(rawClock); clock(time); checkFencePredecessor(state);
  if (time.now < FENCE_AUTH.authorizedAt || time.now >= maintenanceLeaseExpiresAt(state)) fail(); return freeze(state);
}
export function createMaintenanceFenceInspection(raw, rawContext) {
  const context = capture(rawContext), state = validateMaintenanceFencePredecessor(raw, { bootId: context.bootId, now: context.now });
  if (!exact(context, CONTEXT) || context.operationId !== state.operationId || context.expectedOldSha !== state.expectedOldSha ||
      context.previousTargetSha !== FENCE_PIN.targetSha || context.expectedRevision !== state.revision || context.expectedDigest !== hash(state)) fail();
  baseline(context.stoppedBaseline, reconstruct(state), context.now);
  return freeze(inspection({ version: 1, state: "fence-recovery-inspected", operationId: state.operationId, targetSha: context.targetSha,
    previousTargetSha: FENCE_PIN.targetSha, expectedOldSha: state.expectedOldSha, revision: state.revision, stateDigest: hash(state),
    stateBytes: Buffer.byteLength(JSON.stringify(state)), activeAttempt: 3, sourceDiffDigest: context.sourceDiffDigest, migrationDigest: context.migrationDigest,
    stoppedBaseline: context.stoppedBaseline, stoppedBaselineDigest: hash(context.stoppedBaseline), authorizationDigest: hash(FENCE_AUTH) }));
}
export function buildMaintenanceFenceRecoveredState(raw, rawEvidence, rawContext) {
  const state = capture(raw), context = capture(rawContext), item = validateMaintenanceLeaseEvidence(rawEvidence);
  const inspected = createMaintenanceFenceInspection(state, context);
  if (!equal(inspected, project(item, INSPECTION)) || item.historyCheckedAt > context.now || context.now - item.historyCheckedAt > 300000) fail();
  return validateMaintenanceLeaseState({ ...state, version: 13, revision: 43, phase: "held", targetSha: context.targetSha,
    fenceRecovery: { version: 1, predecessor: { ...project(FENCE_PIN, ["version", "revision", "phase", "targetSha", "stateDigest", "stateBytes"]), ingress: state.ingress },
      evidence: item, recoveredAt: context.now, stoppedBaseline: context.stoppedBaseline, authorization: { ...FENCE_AUTH } } },
  { bootId: context.bootId, now: context.now });
}
export function maintenanceLeaseExpiresAt(raw) { return checkState(capture(raw)).expiresAt; }
export function validateMaintenanceLeaseState(raw, rawClock) {
  const state = capture(raw), time = capture(rawClock); clock(time); const checked = checkState(state);
  if (time.now < checked.lastTime || time.now >= checked.expiresAt || (state.version === 13 && time.now < state.fenceRecovery.recoveredAt)) fail(); return freeze(state);
}
export function validateMaintenanceLeasePredecessor(raw, rawClock) {
  const state = capture(raw), time = capture(rawClock); clock(time); unused(state);
  if (state.version === 11) original(state);
  else if ([12, 13].includes(state.version)) { const checked = checkState(state); if (time.now < checked.lastTime) fail(); }
  else fail();
  return freeze(state);
}
export function reconstructMaintenanceLeasePredecessor(raw, rawClock) {
  const state = validateMaintenanceLeasePredecessor(raw, rawClock);
  return freeze(state.version === 11 ? state : reconstruct(state));
}
export function maintenanceLeaseHistoricalState(raw, rawClock) {
  const state = validateMaintenanceLeaseState(raw, rawClock); return freeze(reconstruct(state));
}
export function createMaintenanceLeaseInspection(raw, rawContext) {
  const state = validateMaintenanceLeasePredecessor(raw, { bootId: rawContext?.bootId, now: rawContext?.now }), context = capture(rawContext);
  if (!exact(context, CONTEXT) || context.operationId !== state.operationId || context.expectedOldSha !== state.expectedOldSha ||
      context.previousTargetSha !== PIN.targetSha || context.expectedRevision !== state.revision || context.expectedDigest !== hash(state) ||
      ([12, 13].includes(state.version) && context.targetSha !== state.targetSha)) fail();
  baseline(context.stoppedBaseline, state.version === 11 ? state : reconstruct(state), context.now);
  return freeze(inspection({ version: 1, state: "lease-renewal-inspected", operationId: state.operationId, targetSha: context.targetSha,
    previousTargetSha: PIN.targetSha, expectedOldSha: state.expectedOldSha, revision: state.revision, stateDigest: hash(state),
    stateBytes: Buffer.byteLength(JSON.stringify(state)), activeAttempt: 3, sourceDiffDigest: context.sourceDiffDigest, migrationDigest: context.migrationDigest,
    stoppedBaseline: context.stoppedBaseline, stoppedBaselineDigest: hash(context.stoppedBaseline), authorizationDigest: hash(AUTH) }));
}
export function validateMaintenanceLeaseInspection(raw) { return freeze(inspection(capture(raw, 16384))); }
export function validateMaintenanceLeaseEvidence(raw) { return freeze(evidence(capture(raw, 16384))); }
export function encodeMaintenanceLeaseEvidence(raw) { const result = Buffer.from(JSON.stringify(validateMaintenanceLeaseEvidence(raw))).toString("base64url"); if (result.length > 22000) fail(); return result; }
export function decodeMaintenanceLeaseEvidence(raw) {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,22000}$/.test(raw)) fail();
  try { const value = validateMaintenanceLeaseEvidence(JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))); if (encodeMaintenanceLeaseEvidence(value) !== raw) fail(); return value; } catch { fail(); }
}
export function buildMaintenanceLeasedState(raw, rawEvidence, rawContext) {
  const state = capture(raw), context = capture(rawContext), item = validateMaintenanceLeaseEvidence(rawEvidence), checked = createMaintenanceLeaseInspection(state, context);
  if (!equal(checked, project(item, INSPECTION)) || item.historyCheckedAt > context.now || context.now - item.historyCheckedAt > 300000) fail();
  let next;
  if (state.version === 11) next = { ...state, version: 12, revision: state.revision + 1, targetSha: context.targetSha,
    leaseRenewal: { version: 1, predecessor: { ...project(PIN, ["version", "revision", "phase", "targetSha", "stateDigest", "stateBytes"]), ingress: state.ingress },
      evidence: item, renewedAt: context.now, expiresAt: context.now + AUTH.maximumLeaseMilliseconds, stoppedBaseline: context.stoppedBaseline, authorization: { ...AUTH } }, leaseExtensions: [] };
  else next = { ...state, revision: state.revision + 1, leaseExtensions: [...state.leaseExtensions, { version: 1, sequence: state.leaseExtensions.length + 1,
    previousExpiresAt: maintenanceLeaseExpiresAt(state), renewedAt: context.now, expiresAt: context.now + AUTH.maximumLeaseMilliseconds, evidence: item }] };
  return validateMaintenanceLeaseState(next, { bootId: context.bootId, now: context.now });
}
export function assertMaintenanceLeaseProgress(rawPrevious, rawNext) {
  const previous = capture(rawPrevious), next = capture(rawNext);
  if (previous.version === 12 && next.version === 13) {
    const audit = next.fenceRecovery, item = audit?.evidence; if (!item) fail();
    const expected = buildMaintenanceFenceRecoveredState(previous, item, { operationId: item.operationId, targetSha: item.targetSha,
      previousTargetSha: item.previousTargetSha, expectedOldSha: item.expectedOldSha, expectedRevision: item.revision, expectedDigest: item.stateDigest,
      bootId: previous.bootId, now: audit.recoveredAt, sourceDiffDigest: item.sourceDiffDigest, migrationDigest: item.migrationDigest, stoppedBaseline: item.stoppedBaseline });
    if (!equal(next, expected)) fail(); return;
  }
  if (![12, 13].includes(previous.version) && ![12, 13].includes(next.version)) {
    if ([previous, next].some(state => Object.hasOwn(state, "leaseRenewal") || Object.hasOwn(state, "leaseExtensions"))) fail();
    return assertMaintenancePreflightRecoveryProgress(previous, next);
  }
  if ((previous.version === 11 && next.version === 12) || ([12, 13].includes(previous.version) && previous.version === next.version && !equal(previous.leaseExtensions, next.leaseExtensions))) {
    const event = previous.version === 11 ? next.leaseRenewal : next.leaseExtensions?.at(-1), item = event?.evidence;
    if (!item) fail(); const expected = buildMaintenanceLeasedState(previous, item, { operationId: item.operationId, targetSha: item.targetSha,
      previousTargetSha: item.previousTargetSha, expectedOldSha: item.expectedOldSha, expectedRevision: item.revision, expectedDigest: item.stateDigest,
      bootId: previous.bootId, now: event.renewedAt, sourceDiffDigest: item.sourceDiffDigest, migrationDigest: item.migrationDigest, stoppedBaseline: item.stoppedBaseline });
    if (!equal(next, expected)) fail(); return;
  }
  if (![12, 13].includes(previous.version) || next.version !== previous.version || !number(previous.revision) || next.revision !== previous.revision + 1 ||
      !equal(previous.fenceRecovery, next.fenceRecovery) ||
      [...KEYS.filter(key => !["revision", "phase", "ingress", ...LAUNCH].includes(key)), "leaseRenewal", "leaseExtensions"].some(key => !equal(previous[key], next[key])) ||
      !({ held: ["held", "candidate", "failed-held", "failed-unknown"], candidate: ["candidate", "resuming", "failed-held", "failed-unknown"],
        resuming: ["resuming", "ended", "failed-held", "failed-unknown"], ended: ["ended", "failed-held", "failed-unknown"],
        "failed-held": ["failed-held", "failed-unknown"], "failed-unknown": ["failed-held", "failed-unknown"] }[previous.phase] || []).includes(next.phase) ||
      (previous.launchDisk !== null && !equal(previous.launchDisk, next.launchDisk)) || LAUNCH.some(key => previous[key] !== null && next[key] === null)) fail();
  checkState(previous); checkState(next); journalProgress(previous, next);
}
