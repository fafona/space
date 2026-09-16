import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// One authorized, unlaunched incident. Callers supply descriptor-captured state
// and independently prove source/history, ingress, daemon ownership, stopped
// writers and quiet DB under the original operation lock and byte/revision CAS.
export const DAEMON_REPAIR = Object.freeze({
  operationId: "78124069-9a5c-4eb5-aaaf-fe80ef1db2b1",
  previousTargetSha: "c4a88cfeba5a27baaa346193330a75aa753be4dd",
  expectedOldSha: "a06a5921e2fad5797e58304b828dfcf16b7ec43b",
  stateDigest: "9a3ef7f22a0712c2a00badd6a0f9e630158a73afda90871504d120ee623191ae",
  daemonDigest: "331fb4c2909faa21f060bfcfd0325bac2655e2980fce703b349e01ad4749fa37",
  revision: 7, createdAt: 1789580413188,
  bootId: "e6531ec9-db4a-4216-b87a-7cc858197eaa",
  failedRunId: "35156337705", backupRunId: "35148085536", readinessRunId: "35156235371",
  appDir: "/www/wwwroot/merchant-space", appName: "merchant-space", appPort: 3000,
  release: "/www/wwwroot/merchant-space.releases/a06a5921e2fa-20260916054114",
});
const P = DAEMON_REPAIR, SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/, ID = /^[1-9][0-9]{0,15}$/;
const LAUNCH = ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
const FIXED = ["version", "operationId", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "tokenHash", "publicSupabaseUrl", "runtime", "database", "recovery"];
const AUDIT = ["version", "predecessor", "targetSha", "repairedAt", "runId", "mainCIrunId", "sourceDigest", "historyDigest", "historyCheckedAt", "migrationDigest"];
const fail = () => { throw new Error("maintenance_daemon_repair_invalid"); };
const hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const exact = (v, keys) => v && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join();
const time = n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
export function validateDaemonRepairPredecessor(state, clock) {
  if (hash(state) !== P.stateDigest || state.version !== 3 || state.phase !== "failed-unknown" || state.revision !== P.revision ||
      state.operationId !== P.operationId || state.targetSha !== P.previousTargetSha || state.expectedOldSha !== P.expectedOldSha ||
      state.bootId !== P.bootId || clock.bootId !== P.bootId || state.createdAt !== P.createdAt ||
      !time(clock.now) || clock.now < P.createdAt || clock.now >= P.createdAt + 43200000 ||
      LAUNCH.some(k => state[k] !== null) || hash(state.runtime.daemon) !== P.daemonDigest) fail();
  return state;
}
export function validateDaemonRepairState(state, clock) {
  const a = state.daemonRepair;
  if (!exact(a, AUDIT) || a.version !== 1) fail();
  validateDaemonRepairPredecessor(a.predecessor, clock);
  if (FIXED.some(k => !isDeepStrictEqual(state[k], a.predecessor[k])) || !SHA.test(a.targetSha) ||
      [P.previousTargetSha, P.expectedOldSha].includes(a.targetSha) || state.targetSha !== a.targetSha ||
      !Number.isSafeInteger(state.revision) || state.revision < P.revision + 1 ||
      !time(a.repairedAt) || !time(a.historyCheckedAt) || a.historyCheckedAt < P.createdAt ||
      a.repairedAt < a.historyCheckedAt || a.repairedAt - a.historyCheckedAt > 300000 || a.repairedAt > clock.now ||
      !ID.test(a.runId) || !ID.test(a.mainCIrunId) || a.runId === a.mainCIrunId ||
      [P.failedRunId, P.backupRunId, P.readinessRunId].includes(a.runId) ||
      ![a.sourceDigest, a.historyDigest, a.migrationDigest].every(v => HASH.test(v)) ||
      (state.revision === P.revision + 1 && (state.phase !== "held" || LAUNCH.some(k => state[k] !== null) || !isDeepStrictEqual(state.ingress, a.predecessor.ingress)))) fail();
  return state;
}
export function buildDaemonRepairedState(previous, audit, clock) {
  validateDaemonRepairPredecessor(previous, clock);
  if (!isDeepStrictEqual(audit.predecessor, previous) || audit.repairedAt !== clock.now) fail();
  const next = { ...previous, revision: previous.revision + 1, targetSha: audit.targetSha, phase: "held", daemonRepair: audit };
  validateDaemonRepairState(next, clock);
  return next;
}
export function assertDaemonRepairProgress(previous, next) {
  if (!Object.hasOwn(previous, "daemonRepair")) {
    const audit = next.daemonRepair;
    if (!audit || !isDeepStrictEqual(next, buildDaemonRepairedState(previous, audit, { bootId: previous.bootId, now: audit.repairedAt }))) fail();
    return;
  }
  if (!isDeepStrictEqual(previous.daemonRepair, next.daemonRepair) || previous.targetSha !== next.targetSha ||
      next.revision !== previous.revision + 1) fail();
  const clock = { bootId: previous.bootId, now: previous.daemonRepair.repairedAt };
  validateDaemonRepairState(previous, clock); validateDaemonRepairState(next, clock);
}
