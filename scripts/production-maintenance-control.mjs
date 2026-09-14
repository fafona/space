import { validateMaintenanceLeaseState, validateMaintenanceLeasePredecessor, maintenanceLeaseExpiresAt,
  createMaintenanceLeaseInspection, buildMaintenanceLeasedState, decodeMaintenanceLeaseEvidence,
  validateMaintenanceFencePredecessor, createMaintenanceFenceInspection, buildMaintenanceFenceRecoveredState } from "./production-maintenance-lease.mjs";
import { captureLeaseBaseline, verifyLeaseBaseline, assertLeaseStopped, assertLeaseGenerationsStopped } from "./production-maintenance-lease-inspection.mjs";
import { readLeaseHandoffFields } from "./production-maintenance-lease-handoff.mjs";
import { readMaintenanceLeaseSourceProof, validateMaintenanceLeaseMigrationProof, MAINTENANCE_LEASE_MIGRATION_SQL } from "./production-maintenance-lease-evidence.mjs";
import { readMaintenanceFenceSourceProof, validateMaintenanceFenceMigrationProof, MAINTENANCE_FENCE_MIGRATION_SQL } from "./production-maintenance-fence-evidence.mjs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isProxy } from "node:util/types";
import { isDeepStrictEqual } from "node:util";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch, validateMaintenanceLaunchJournal } from "./production-maintenance-launch-journal.mjs";
import { createMaintenanceLaunchJournalStorage } from "./production-maintenance-launch-journal-storage.mjs";
import { diagnoseRuntimeCompatibility, validateRuntimeCompatibilityDiagnostic } from "./production-maintenance-runtime-diagnostic.mjs";
import { diagnosePm2Peer, validatePm2PeerDiagnostic } from "./production-maintenance-pm2-peer-diagnostic.mjs";
import { selectMaintenancePublicGateway } from "./maintenance-effective-public-gateway.mjs";
import { SUPABASE_SCHEDULER_IMAGE, SUPABASE_SCHEDULER_PSQL_SCRIPT, readSupportedSupabaseMaintenanceQuiet } from "./maintenance-supabase-scheduler-profile.mjs";
import { createMaintenanceRecoveryInspection, decodeMaintenanceRecoveryEvidence, buildMaintenanceRecoveredState,
  validateMaintenanceRecoveryState } from "./production-maintenance-recovery.mjs";
import { readMaintenanceRecoverySourceProof, MAINTENANCE_RECOVERY_MIGRATION_SQL,
  validateMaintenanceRecoveryMigrationProof } from "./production-maintenance-recovery-evidence.mjs";
import { createMaintenanceContinuationInspection, decodeMaintenanceContinuationEvidence, buildMaintenanceContinuedState,
  validateMaintenanceContinuationState } from "./production-maintenance-continuation.mjs";
import { readMaintenanceContinuationSourceProof, MAINTENANCE_CONTINUATION_MIGRATION_SQL,
  validateMaintenanceContinuationMigrationProof } from "./production-maintenance-continuation-evidence.mjs";

import { createMaintenanceBuildRecoveryInspection, decodeMaintenanceBuildRecoveryEvidence, buildMaintenanceBuildRecoveredState,
  validateMaintenanceBuildRecoveryState, validateMaintenanceBuildRecoveryPredecessor,
  MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION } from "./production-maintenance-build-recovery.mjs";
import { readMaintenanceBuildRecoverySourceProof, MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL,
  validateMaintenanceBuildRecoveryMigrationProof } from "./production-maintenance-build-recovery-evidence.mjs";
import { createMaintenanceAttemptRecoveryInspection, decodeMaintenanceAttemptRecoveryEvidence, buildMaintenanceAttemptRecoveredState,
  validateMaintenanceAttemptRecoveryState, validateMaintenanceAttemptRecoveryPredecessor,
  MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION } from "./production-maintenance-attempt-recovery.mjs";
import { readMaintenanceAttemptRecoverySourceProof, MAINTENANCE_ATTEMPT_RECOVERY_MIGRATION_SQL,
  validateMaintenanceAttemptRecoveryMigrationProof } from "./production-maintenance-attempt-recovery-evidence.mjs";
import { captureFailedCandidateBaseline, verifyFailedCandidateBaseline, assertFailedCandidateStopped,
  assertFailedCandidateGenerationStopped } from "./production-maintenance-failed-candidate-inspection.mjs";
import { createMaintenanceSecondAttemptRecoveryInspection, decodeMaintenanceSecondAttemptRecoveryEvidence, buildMaintenanceSecondAttemptRecoveredState,
  validateMaintenanceSecondAttemptRecoveryState, validateMaintenanceSecondAttemptRecoveryPredecessor,
  MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION } from "./production-maintenance-second-attempt-recovery.mjs";
import { readMaintenanceSecondAttemptRecoverySourceProof, MAINTENANCE_SECOND_ATTEMPT_RECOVERY_MIGRATION_SQL,
  validateMaintenanceSecondAttemptRecoveryMigrationProof } from "./production-maintenance-second-attempt-recovery-evidence.mjs";
import { captureFailedAttemptBaseline, verifyFailedAttemptBaseline, assertFailedAttemptStopped,
  assertFailedAttemptGenerationsStopped } from "./production-maintenance-failed-attempt-inspection.mjs";
import { readFailedAttemptHandoffFields } from "./production-maintenance-failed-attempt-handoff.mjs";
import { createMaintenanceBudgetRecoveryInspection, decodeMaintenanceBudgetRecoveryEvidence, buildMaintenanceBudgetRecoveredState,
  validateMaintenanceBudgetRecoveryState, validateMaintenanceBudgetRecoveryPredecessor,
  MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION } from "./production-maintenance-budget-recovery.mjs";
import { readMaintenanceBudgetRecoverySourceProof, MAINTENANCE_BUDGET_RECOVERY_MIGRATION_SQL,
  validateMaintenanceBudgetRecoveryMigrationProof } from "./production-maintenance-budget-recovery-evidence.mjs";
import { captureBudgetRecoveryBaseline, verifyBudgetRecoveryBaseline, assertBudgetRecoveryStopped,
  assertBudgetRecoveryGenerationsStopped } from "./production-maintenance-budget-inspection.mjs";
import { readBudgetRecoveryHandoffFields } from "./production-maintenance-budget-handoff.mjs";
import { createMaintenanceWindowRenewalInspection, decodeMaintenanceWindowRenewalEvidence, buildMaintenanceWindowRenewedState,
  validateMaintenanceWindowRenewalState, validateMaintenanceWindowRenewalPredecessor,
  MAINTENANCE_WINDOW_RENEWAL_AUTHORIZATION } from "./production-maintenance-window-renewal.mjs";
import { readMaintenanceWindowRenewalSourceProof, MAINTENANCE_WINDOW_RENEWAL_MIGRATION_SQL,
  validateMaintenanceWindowRenewalMigrationProof } from "./production-maintenance-window-renewal-evidence.mjs";
import { captureWindowRenewalBaseline, verifyWindowRenewalBaseline, assertWindowRenewalStopped,
  assertWindowRenewalGenerationsStopped } from "./production-maintenance-window-inspection.mjs";
import { readWindowRenewalHandoffFields } from "./production-maintenance-window-handoff.mjs";
import { createMaintenancePreflightRecoveryInspection, decodeMaintenancePreflightRecoveryEvidence, buildMaintenancePreflightRecoveredState,
  validateMaintenancePreflightRecoveryState, validateMaintenancePreflightRecoveryPredecessor,
  MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION } from "./production-maintenance-preflight-recovery.mjs";
import { readMaintenancePreflightRecoverySourceProof, MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL,
  validateMaintenancePreflightRecoveryMigrationProof } from "./production-maintenance-preflight-recovery-evidence.mjs";
import { capturePreflightRecoveryBaseline, verifyPreflightRecoveryBaseline, assertPreflightRecoveryStopped,
  assertPreflightRecoveryGenerationsStopped } from "./production-maintenance-preflight-inspection.mjs";
import { readPreflightRecoveryHandoffFields } from "./production-maintenance-preflight-handoff.mjs";
import { assertPreflightDiskHeadroom } from "./production-maintenance-preflight-disk.mjs";
import { createMaintenancePrelaunchRecoveryInspection, decodeMaintenancePrelaunchRecoveryEvidence, buildMaintenancePrelaunchRecoveredState,
  validateMaintenancePrelaunchRecoveryState, validateMaintenancePrelaunchRecoveryPredecessor,
  MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION } from "./production-maintenance-prelaunch-recovery.mjs";
import { readMaintenancePrelaunchRecoverySourceProof, MAINTENANCE_PRELAUNCH_RECOVERY_MIGRATION_SQL,
  validateMaintenancePrelaunchRecoveryMigrationProof } from "./production-maintenance-prelaunch-recovery-evidence.mjs";
import { capturePrelaunchRecoveryBaseline, verifyPrelaunchRecoveryBaseline, assertPrelaunchRecoveryStopped,
  assertPrelaunchRecoveryGenerationsStopped } from "./production-maintenance-prelaunch-inspection.mjs";
import { readPrelaunchRecoveryHandoffFields } from "./production-maintenance-prelaunch-handoff.mjs";
import { assertPrelaunchDiskHeadroom } from "./production-maintenance-prelaunch-disk.mjs";

const ROOT = "/var/lib/faolla-maintenance";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const APP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PHASES = ["preparing", "held", "candidate", "resuming", "ended", "failed-held", "failed-unknown"];
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const failure = (code) => { throw new Error(code); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const LAUNCH_ROLES = ["paused-web", "resumed-web", "worker"];
const clone = (value) => structuredClone(value);
const equal = isDeepStrictEqual;

export function maintenanceLaunchBinding(state) {
  const daemon = state.runtime?.daemon, disk = state.launchDisk;
  if (!daemon || !disk) failure("maintenance_launch_binding_invalid");
  return { operationId: state.operationId, targetSha: state.targetSha, appName: state.appName, appPort: state.appPort,
    daemon: { pid: daemon.pid, uid: daemon.uid, startTicks: daemon.startTicks, bootId: state.bootId,
      executable: daemon.executable, executableIdentity: daemon.executableIdentity },
    release: { path: disk.runtime, identity: disk.runtimeIdentity, buildDigest: disk.nextBuildDigest } };
}

export function validateMaintenanceLaunchProofBindings(state) {
  if (state.launchJournal === null) {
    if (state.launchDisk !== null || state.candidate !== null || state.resumed !== null) failure("maintenance_launch_binding_invalid");
    return true;
  }
  const journal = validateMaintenanceLaunchJournal(state.launchJournal, maintenanceLaunchBinding(state));
  const instanceKeys = ["pid", "parentPid", "uid", "startTicks", "processIdentity", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLineDigest"];
  const verifyManaged = (managed, role) => {
    const slot = journal.slots[role], process = managed?.processes?.[0], pm2 = managed?.pm2;
    if (!slot || slot.phase !== "confirmed" || !process || !pm2) failure("maintenance_launch_binding_invalid");
    const observed = { ...Object.fromEntries(instanceKeys.map((key) => [key, process[key]])), pmId: pm2.pmId,
      createdAt: pm2.createdAt, pmUptime: pm2.pmUptime, restartTime: pm2.restartTime, metadataDigest: pm2.metadataHash };
    if (!equal(observed, slot.instance)) failure("maintenance_launch_binding_invalid");
  };
  const verifyCandidate = (candidate, expectedRole = null) => {
    const role = candidate?.pauseExpected === "1" ? "paused-web" : candidate?.pauseExpected === "0" ? "resumed-web" : null;
    if (!role || (expectedRole && role !== expectedRole) || candidate.targetSha !== state.targetSha ||
        !equal(candidate.disk, state.launchDisk) || !equal(candidate.daemon, state.runtime.daemon)) failure("maintenance_launch_binding_invalid");
    verifyManaged(candidate.web, role);
  };
  if (state.candidate) verifyCandidate(state.candidate);
  if (state.resumed) {
    verifyCandidate(state.resumed.candidate, "resumed-web");
    if (state.resumed.worker) verifyManaged(state.resumed.worker, "worker");
    else if (state.runtime.worker?.state === "running" || journal.slots.worker !== null) failure("maintenance_launch_binding_invalid");
  }
  return true;
}

export function parseMaintenanceRequest(argv) {
  const [action, ...values] = argv;
  if (!["diagnose-runtime", "diagnose-pm2-peer", "plan", "prepare", "inspect-recovery", "recover-held", "inspect-continuation", "continue-held", "inspect-build-recovery", "recover-build", "inspect-attempt-recovery", "recover-attempt", "inspect-second-attempt-recovery", "recover-second-attempt", "inspect-budget-recovery", "recover-budget", "inspect-window-renewal", "renew-window", "inspect-prelaunch-recovery", "recover-prelaunch", "inspect-preflight-recovery", "recover-preflight", "inspect-lease-renewal", "renew-lease", "inspect-fence-recovery", "recover-fence", "check-held", "check-runtime-held", "runtime-handoff", "start-candidate", "candidate-handoff", "snapshot-web", "snapshot-worker", "snapshot-pair", "register-candidate", "check-candidate", "end", "fail-held"].includes(action)) failure("maintenance_arguments_invalid");
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (flags.has(key)) failure("maintenance_arguments_invalid");
    if (key === "--json") { flags.set(key, true); continue; }
    if (!["--app-dir", "--app-name", "--app-port", "--target-sha", "--expected-old-sha", "--expected-operation-id", "--previous-target-sha", "--recovery-evidence", "--continuation-evidence", "--build-recovery-evidence", "--attempt-recovery-evidence", "--second-attempt-recovery-evidence", "--budget-recovery-evidence", "--window-renewal-evidence", "--prelaunch-recovery-evidence", "--preflight-recovery-evidence", "--lease-evidence"].includes(key)) failure("maintenance_arguments_invalid");
    const value = values[++index];
    if (typeof value !== "string" || value.startsWith("--")) failure("maintenance_arguments_invalid");
    flags.set(key, value);
  }
  const request = { action, appDir: flags.get("--app-dir"), appName: flags.get("--app-name"), appPort: Number(flags.get("--app-port")),
    targetSha: flags.get("--target-sha"), expectedOldSha: flags.get("--expected-old-sha"), operationId: flags.get("--expected-operation-id") ?? null };
  if (!flags.get("--json") || typeof request.appDir !== "string" || !/^\/[A-Za-z0-9._/-]+$/.test(request.appDir) || request.appDir === "/" ||
      path.posix.normalize(request.appDir) !== request.appDir || request.appDir.endsWith("/") || !APP.test(request.appName ?? "") ||
      !Number.isSafeInteger(request.appPort) || request.appPort < 1024 || request.appPort > 65535 || !SHA.test(request.targetSha ?? "") ||
      !SHA.test(request.expectedOldSha ?? "") || request.targetSha === request.expectedOldSha ||
      (["diagnose-runtime", "diagnose-pm2-peer", "plan", "prepare"].includes(action) ? request.operationId !== null : !UUID.test(request.operationId ?? ""))) failure("maintenance_arguments_invalid");
  if (!["inspect-build-recovery", "recover-build"].includes(action) && flags.has("--build-recovery-evidence")) failure("maintenance_arguments_invalid");
  if (!["inspect-attempt-recovery", "recover-attempt"].includes(action) && flags.has("--attempt-recovery-evidence")) failure("maintenance_arguments_invalid");
  if (!["inspect-second-attempt-recovery", "recover-second-attempt"].includes(action) && flags.has("--second-attempt-recovery-evidence")) failure("maintenance_arguments_invalid");
  if (!["inspect-budget-recovery", "recover-budget"].includes(action) && flags.has("--budget-recovery-evidence")) failure("maintenance_arguments_invalid");
  if (!["inspect-window-renewal", "renew-window"].includes(action) && flags.has("--window-renewal-evidence")) failure("maintenance_arguments_invalid");
  if (!["inspect-prelaunch-recovery", "recover-prelaunch"].includes(action) && flags.has("--prelaunch-recovery-evidence")) failure("maintenance_arguments_invalid");
  if (!["inspect-lease-renewal", "renew-lease", "inspect-fence-recovery", "recover-fence"].includes(action) && flags.has("--lease-evidence")) failure("maintenance_arguments_invalid");
  if (!["inspect-preflight-recovery", "recover-preflight"].includes(action) && flags.has("--preflight-recovery-evidence")) failure("maintenance_arguments_invalid");
  if (["inspect-recovery", "recover-held"].includes(action)) {
    if (flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha) failure("maintenance_arguments_invalid");
    if (action === "inspect-recovery") {
      if (flags.has("--recovery-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--recovery-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.recoveryEvidence = decodeMaintenanceRecoveryEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-continuation", "continue-held"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence")) failure("maintenance_arguments_invalid");
    if (action === "inspect-continuation") {
      if (flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--continuation-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.continuationEvidence = decodeMaintenanceContinuationEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-build-recovery", "recover-build"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    if (action === "inspect-build-recovery") {
      if (flags.has("--build-recovery-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--build-recovery-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.buildRecoveryEvidence = decodeMaintenanceBuildRecoveryEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-attempt-recovery", "recover-attempt"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    if (action === "inspect-attempt-recovery") {
      if (flags.has("--attempt-recovery-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--attempt-recovery-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.attemptRecoveryEvidence = decodeMaintenanceAttemptRecoveryEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-second-attempt-recovery", "recover-second-attempt"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    if (action === "inspect-second-attempt-recovery") {
      if (flags.has("--second-attempt-recovery-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--second-attempt-recovery-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.secondAttemptRecoveryEvidence = decodeMaintenanceSecondAttemptRecoveryEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-budget-recovery", "recover-budget"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    if (action === "inspect-budget-recovery") {
      if (flags.has("--budget-recovery-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--budget-recovery-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.budgetRecoveryEvidence = decodeMaintenanceBudgetRecoveryEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-window-renewal", "renew-window"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    if (action === "inspect-window-renewal") {
      if (flags.has("--window-renewal-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--window-renewal-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.windowRenewalEvidence = decodeMaintenanceWindowRenewalEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-lease-renewal", "renew-lease", "inspect-fence-recovery", "recover-fence"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    if (["inspect-lease-renewal", "inspect-fence-recovery"].includes(action)) {
      if (flags.has("--lease-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--lease-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 22000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.leaseEvidence = decodeMaintenanceLeaseEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-preflight-recovery", "recover-preflight"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    if (action === "inspect-preflight-recovery") {
      if (flags.has("--preflight-recovery-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--preflight-recovery-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.preflightRecoveryEvidence = decodeMaintenancePreflightRecoveryEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (["inspect-prelaunch-recovery", "recover-prelaunch"].includes(action)) {
    request.previousTargetSha = flags.get("--previous-target-sha");
    if (!SHA.test(request.previousTargetSha ?? "") || request.previousTargetSha === request.targetSha ||
        request.previousTargetSha === request.expectedOldSha || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
    if (action === "inspect-prelaunch-recovery") {
      if (flags.has("--prelaunch-recovery-evidence")) failure("maintenance_arguments_invalid");
    } else {
      const encoded = flags.get("--prelaunch-recovery-evidence");
      if (typeof encoded !== "string" || encoded.length < 1 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) failure("maintenance_arguments_invalid");
      try { request.prelaunchRecoveryEvidence = decodeMaintenancePrelaunchRecoveryEvidence(encoded); }
      catch { failure("maintenance_arguments_invalid"); }
    }
  } else if (flags.has("--previous-target-sha") || flags.has("--recovery-evidence") || flags.has("--continuation-evidence")) failure("maintenance_arguments_invalid");
  return request;
}

export async function createRuntimeDiagnosticReport(request, diagnose = diagnoseRuntimeCompatibility) {
  if (request.action !== "diagnose-runtime" || request.operationId !== null) failure("maintenance_arguments_invalid");
  const diagnostics = validateRuntimeCompatibilityDiagnostic(await diagnose({
    appDir: request.appDir, appName: request.appName, appPort: request.appPort, expectedOldSha: request.expectedOldSha,
  }));
  // This report has no operation UUID and is never a held or release proof.
  return { version: 1, targetSha: request.targetSha, expectedOldSha: request.expectedOldSha, state: "runtime-diagnosed", diagnostics };
}

export async function createPm2PeerDiagnosticReport(request, diagnose = diagnosePm2Peer) {
  if (request.action !== "diagnose-pm2-peer" || request.operationId !== null) failure("maintenance_arguments_invalid");
  const diagnostics = validatePm2PeerDiagnostic(await diagnose({
    appDir: request.appDir, appName: request.appName, appPort: request.appPort, expectedOldSha: request.expectedOldSha,
  }));
  return { version: 1, targetSha: request.targetSha, expectedOldSha: request.expectedOldSha, state: "pm2-peer-diagnosed", diagnostics };
}

export function validateMaintenanceState(state, request, bootId, now) {
  const keys = ["version", "revision", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed", "launchDisk", "launchJournal", "finalDump"];
  // Only the fixed, independently audited failed-build predecessor may use
  // the explicitly authorized deadline. All ordinary v2/v3/v4 paths keep TTL.
  const buildPredecessor = state?.version === 4 && ["inspect-build-recovery", "recover-build"].includes(request.action);
  const attemptPredecessor = state?.version === 5 && ["inspect-attempt-recovery", "recover-attempt"].includes(request.action);
  const budgetPredecessor = state?.version === 7 && ["inspect-budget-recovery", "recover-budget"].includes(request.action);
  const windowPredecessor = state?.version === 8 && ["inspect-window-renewal", "renew-window"].includes(request.action);
  const leasePredecessor = [11, 12, 13].includes(state?.version) && ["inspect-lease-renewal", "renew-lease", "inspect-fence-recovery", "recover-fence"].includes(request.action);
  const prelaunchPredecessor = state?.version === 9 && ["inspect-prelaunch-recovery", "recover-prelaunch"].includes(request.action);
  if (state?.version === 3) { validateMaintenanceRecoveryState(state, { bootId, now }); keys.push("recovery"); }
  if (state?.version === 4) {
    if (buildPredecessor) validateMaintenanceBuildRecoveryPredecessor(state, { bootId, now });
    else validateMaintenanceContinuationState(state, { bootId, now });
    keys.push("recovery", "continuation");
  }
  if (state?.version === 5) {
    if (attemptPredecessor) validateMaintenanceAttemptRecoveryPredecessor(state, { bootId, now });
    else validateMaintenanceBuildRecoveryState(state, { bootId, now });
    keys.push("recovery", "continuation", "buildRecovery", "deadlineExtension");
  }
  if (state?.version === 6) {
    validateMaintenanceAttemptRecoveryState(state, { bootId, now });
    keys.push("recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery");
  }
  if (state?.version === 7) {
    if (budgetPredecessor) validateMaintenanceBudgetRecoveryPredecessor(state, { bootId, now });
    else validateMaintenanceSecondAttemptRecoveryState(state, { bootId, now });
    keys.push("recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery");
  }
  if (state?.version === 8) {
    if (windowPredecessor) validateMaintenanceWindowRenewalPredecessor(state, { bootId, now });
    else validateMaintenanceBudgetRecoveryState(state, { bootId, now });
    keys.push("recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery");
  }
  if (state?.version === 9) {
    if (prelaunchPredecessor) validateMaintenancePrelaunchRecoveryPredecessor(state, { bootId, now });
    else validateMaintenanceWindowRenewalState(state, { bootId, now });
    keys.push("recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal");
  }
  if (state?.version === 10) {
    validateMaintenancePrelaunchRecoveryState(state, { bootId, now });
    keys.push("recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal", "prelaunchRecovery");
  }
  if (state?.version === 11) {
    if (leasePredecessor) validateMaintenanceLeasePredecessor(state, { bootId, now });
    else validateMaintenancePreflightRecoveryState(state, { bootId, now });
    keys.push("recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal", "prelaunchRecovery", "preflightRecovery");
  }
  if ([12, 13].includes(state?.version)) {
    if (["inspect-fence-recovery", "recover-fence"].includes(request.action) && state.version === 12) validateMaintenanceFencePredecessor(state, { bootId, now });
    else if (leasePredecessor) validateMaintenanceLeasePredecessor(state, { bootId, now });
    else validateMaintenanceLeaseState(state, { bootId, now });
    keys.push("recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal", "prelaunchRecovery", "preflightRecovery", "leaseRenewal", "leaseExtensions");
    if (state.version === 13) keys.push("fenceRecovery");
  }
  const expired = leasePredecessor ? false : [12, 13].includes(state?.version) ? now >= maintenanceLeaseExpiresAt(state)
    : state?.version === 11 ? now >= MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION.expiresAt
    : prelaunchPredecessor || state?.version === 10
    ? now >= MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION.expiresAt
    : windowPredecessor || state?.version === 9
    ? now >= MAINTENANCE_WINDOW_RENEWAL_AUTHORIZATION.expiresAt
    : budgetPredecessor || state?.version === 8
    ? now >= MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION.expiresAt
    : state?.version === 7
    ? now >= MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION.expiresAt
    : attemptPredecessor || state?.version === 6
    ? now >= MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION.expiresAt
    : buildPredecessor || state?.version === 5
    ? now >= MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION.expiresAt
    : now - state?.createdAt > MAX_AGE_MS;
  if (!exact(state, keys) ||
      ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].includes(state.version) || !Number.isSafeInteger(state.revision) || state.revision < 0 || !UUID.test(state.operationId) || !PHASES.includes(state.phase) || state.bootId !== bootId ||
      !Number.isSafeInteger(state.createdAt) || state.createdAt > now || expired ||
      !/^[0-9a-f]{64}$/.test(state.tokenHash) || typeof state.publicSupabaseUrl !== "string" || !record(state.runtime) || !record(state.ingress) || !record(state.database) ||
      !(state.candidate === null || record(state.candidate)) || !(state.resumed === null || record(state.resumed)) ||
      !(state.finalDump === null || record(state.finalDump)) || !(state.launchDisk === null || record(state.launchDisk)) ||
      (state.launchDisk === null) !== (state.launchJournal === null) ||
      ["targetSha", "expectedOldSha", "appDir", "appName", "appPort", "operationId"].some((key) => state[key] !== request[key])) failure("maintenance_state_binding_invalid");
  if (["candidate", "resuming", "ended"].includes(state.phase) && !state.candidate) failure("maintenance_state_binding_invalid");
  if (state.launchJournal !== null) validateMaintenanceLaunchJournal(state.launchJournal, maintenanceLaunchBinding(state));
  if ((state.candidate && state.launchJournal?.slots["paused-web"]?.phase !== "confirmed") ||
      (state.resumed && state.launchJournal?.slots["resumed-web"]?.phase !== "confirmed") ||
      (state.finalDump && !state.resumed) || (state.phase === "ended" && !state.finalDump)) failure("maintenance_state_binding_invalid");
  return state;
}

// These callbacks supply no process facts: only runtime's exact observations
// may confirm a previously persisted send. Never refresh a stale CAS from disk.
export function createMaintenanceLaunchCallbacks(state, ops) {
  let queue = Promise.resolve(), poisoned = false;
  const serialized = (task) => {
    const result = queue.then(async () => { if (poisoned) failure("maintenance_launch_persistence_unconfirmed"); return task(); });
    queue = result.catch(() => {}); return result;
  };
  const persist = async () => { try { await ops.save(state); } catch (error) { poisoned = true; throw error; } };
  const slot = (role) => {
    if (!LAUNCH_ROLES.includes(role)) failure("maintenance_launch_role_invalid");
    if (state.launchJournal === null) return null;
    return validateMaintenanceLaunchJournal(state.launchJournal, maintenanceLaunchBinding(state)).slots[role];
  };
  return {
    read: (role) => serialized(() => clone(slot(role))),
    attempt: (role, rawDisk, environmentDigest) => serialized(async () => {
      slot(role);
      if (role === "paused-web" ? state.phase !== "held" : state.phase !== "resuming") failure("maintenance_launch_phase_invalid");
      const disk = ops.validateLaunchDisk(rawDisk, state.runtime, state.targetSha);
      if (typeof environmentDigest !== "string" || !/^[0-9a-f]{64}$/.test(environmentDigest)) failure("maintenance_launch_binding_invalid");
      if (state.launchDisk === null) {
        state.launchDisk = clone(disk); state.launchJournal = createMaintenanceLaunchJournal(maintenanceLaunchBinding(state));
        await persist();
      } else if (!equal(state.launchDisk, disk)) failure("maintenance_launch_binding_invalid");
      let current = slot(role);
      const binding = maintenanceLaunchBinding(state), sequence = LAUNCH_ROLES.indexOf(role) + 1;
      if (current === null) {
        state.launchJournal = planMaintenanceLaunch(state.launchJournal, binding, { role, sequence, nonce: ops.uuid(), environmentDigest });
        await persist(); current = slot(role);
      }
      if (current.phase !== "planned" || current.environmentDigest !== environmentDigest) failure("maintenance_launch_already_attempted");
      state.launchJournal = transitionMaintenanceLaunch(state.launchJournal, binding, { role, sequence, nonce: current.nonce, phase: "attempted" });
      await persist();
      return current.nonce;
    }),
    confirm: (role, observation) => serialized(async () => {
      const current = slot(role);
      if (!current || !observation || isProxy(observation) || ![Object.prototype, null].includes(Object.getPrototypeOf(observation))) failure("maintenance_launch_observation_invalid");
      const descriptors = Object.getOwnPropertyDescriptors(observation), keys = ["observedNonce", "environmentDigest", "instance"];
      if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every((key) => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))) failure("maintenance_launch_observation_invalid");
      const binding = maintenanceLaunchBinding(state);
      const next = transitionMaintenanceLaunch(state.launchJournal, binding, { role, sequence: current.sequence, nonce: current.nonce,
        phase: "confirmed", observation: { ...binding, role, sequence: current.sequence, ...observation } });
      if (!equal(next, state.launchJournal)) { state.launchJournal = next; await persist(); }
    }),
    checkpoint: (value) => serialized(async () => {
      if (state.phase !== "resuming" || !value || isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) failure("maintenance_launch_checkpoint_invalid");
      const descriptors = Object.getOwnPropertyDescriptors(value), keys = ["candidate", "resumed"];
      if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every((key) => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value")) ||
          !record(value.candidate) || !(value.resumed === null || record(value.resumed))) failure("maintenance_launch_checkpoint_invalid");
      const next = { ...state, candidate: value.candidate, resumed: value.resumed };
      if (next.candidate.pauseExpected !== "0" || (state.candidate?.pauseExpected === "0" && !equal(state.candidate, next.candidate)) ||
          (state.resumed !== null && !equal(state.resumed, next.resumed))) failure("maintenance_launch_checkpoint_invalid");
      // A checkpoint is private identity evidence, never health or launch ACK.
      // Save the complete actual native-descendant proofs before runtime's
      // catch deletes them, so a later command can verify already-gone facts.
      validateMaintenanceState(next, { ...next }, ops.bootId(), ops.now());
      ops.validateProofs(next); validateMaintenanceLaunchProofBindings(next);
      const candidate = clone(next.candidate), resumed = clone(next.resumed);
      if (!equal(state.candidate, candidate) || !equal(state.resumed, resumed)) {
        state.candidate = candidate; state.resumed = resumed; await persist();
      }
    }),
    unknown: (role) => serialized(async () => {
      const current = slot(role);
      if (!current) failure("maintenance_launch_observation_invalid");
      if (current.phase === "unknown" || current.phase === "confirmed") return;
      state.launchJournal = transitionMaintenanceLaunch(state.launchJournal, maintenanceLaunchBinding(state), {
        role, sequence: current.sequence, nonce: current.nonce, phase: "unknown" });
      await persist();
    }),
  };
}

export function validateMaintenanceSubproofBindings(state) {
  const runtime = state.runtime;
  const ingress = state.ingress;
  const database = ingress?.docker?.containers?.find((container) => container.service === "db");
  if (!runtime?.input || !ingress?.input || !database || runtime.bootId !== state.bootId ||
      ["appDir", "appName", "appPort", "expectedOldSha"].some((key) => runtime.input[key] !== state[key]) ||
      ingress.input.operationId !== state.operationId || ingress.input.appPort !== state.appPort ||
      database.id !== state.database?.id || database.image !== state.database?.image) failure("maintenance_subproof_binding_invalid");
  let publicUrl;
  try { publicUrl = new URL(state.publicSupabaseUrl).href; } catch { failure("maintenance_subproof_binding_invalid"); }
  if (ingress.input.publicSupabaseUrl !== publicUrl) failure("maintenance_subproof_binding_invalid");
  return true;
}

function publicSummary(state, value = state.phase) {
  return { version: 1, operationId: state.operationId, targetSha: state.targetSha, expectedOldSha: state.expectedOldSha, state: value };
}

function needsLaunchReconciliation(state) {
  const slots = state.launchJournal?.slots;
  return Boolean(slots && (Object.values(slots).some((entry) => entry && ["attempted", "unknown"].includes(entry.phase)) ||
    (!state.candidate && slots["paused-web"]?.phase === "confirmed") ||
    (!state.resumed && state.candidate?.pauseExpected !== "0" && slots["resumed-web"]?.phase === "confirmed") ||
    (!state.resumed?.worker && slots.worker?.phase === "confirmed")));
}

/** All effects are injected: unit tests never start a process or contact production. */
export async function runMaintenanceAction(request, ops) {
  const assertHistoricalGenerationStopped = async (state) => {
    if ([12, 13].includes(state.version)) await ops.assertLeaseGenerationsStopped(state);
    if (state.version === 11) await ops.assertPreflightRecoveryGenerationsStopped(state);
    if (state.version === 10) await ops.assertPrelaunchRecoveryGenerationsStopped(state);
    if (state.version === 9) await ops.assertWindowRenewalGenerationsStopped(state);
    if (state.version === 8) await ops.assertBudgetRecoveryGenerationsStopped(state.budgetRecovery.predecessor.state);
    if (state.version === 7) await ops.assertFailedAttemptGenerationsStopped(state.secondAttemptRecovery.predecessor.state);
    if (state.version === 6) await ops.assertFailedCandidateGenerationStopped(state.attemptRecovery.predecessor.state);
  };
  const assertAttemptStopped = async (state) => {
    if ([12, 13].includes(state.version)) await ops.assertLeaseStopped(state);
    else if (state.version === 11) await ops.assertPreflightRecoveryStopped(state);
    else if (state.version === 10) await ops.assertPrelaunchRecoveryStopped(state);
    else if (state.version === 9) await ops.assertWindowRenewalStopped(state);
    else if (state.version === 8) await ops.assertBudgetRecoveryStopped(state.budgetRecovery.predecessor.state);
    else if (state.version === 7) await ops.assertFailedAttemptStopped(state.secondAttemptRecovery.predecessor.state);
    else if (state.version === 6) await ops.assertFailedCandidateStopped(state.attemptRecovery.predecessor.state);
    else await ops.assertRuntimeStopped(state.runtime);
  };
  const assertHeld = async (state, requireDatabase = true) => {
    if (!["held", "failed-held"].includes(state.phase)) failure("maintenance_not_held");
    if (needsLaunchReconciliation(state)) failure("maintenance_launch_reconciliation_unverified");
    await ops.verifyIngress(state.ingress, { probeControlServices: requireDatabase });
    await assertAttemptStopped(state);
    if (requireDatabase) await ops.assertDatabaseQuiet(state.database);
  };
  const assertCandidateIngress = async (state) => {
    if (state.phase !== "candidate" || !state.candidate) failure("maintenance_candidate_unverified");
    await ops.verifyIngress(state.ingress, { probeControlServices: false });
    if (state.candidate.targetSha !== state.targetSha) failure("maintenance_candidate_target_invalid");
    await assertHistoricalGenerationStopped(state);
  };
  const assertCandidate = async (state) => {
    await assertCandidateIngress(state);
    await ops.verifyCandidate(state.runtime, state.candidate, "1");
  };
  const keepFailedClosed = async (state) => {
    let verified = true;
    try {
      state.ingress = [6, 7, 8, 9, 10, 11, 12, 13].includes(state.version)
        ? await ops.recloseAttemptIngress(state)
        : await ops.installIngress(state.ingress, ops.readToken(state), { probeControlServices: false });
      await ops.save(state);
    } catch { verified = false; }
    try {
      if (needsLaunchReconciliation(state)) {
        const recovered = await ops.reconcileMaintenanceLaunches(state.runtime, state.launchDisk, state.targetSha,
          { launchJournal: createMaintenanceLaunchCallbacks(state, ops) });
        if (!exact(recovered, ["candidate", "resumed"])) failure("maintenance_launch_reconciliation_unverified");
        if (recovered.candidate) state.candidate = recovered.candidate;
        if (recovered.resumed) state.resumed = recovered.resumed;
        if (Object.values(state.launchJournal.slots).some((entry) => entry && ["attempted", "unknown"].includes(entry.phase))) failure("maintenance_launch_reconciliation_unverified");
        await ops.save(state);
      }
    } catch { verified = false; }
    try {
      // Even failure cleanup must not act on an unbound, partly returned proof.
      ops.validateProofs(state);
      if (state.resumed) await ops.stopResumedCandidate(state.runtime, state.resumed);
      else if (state.candidate) await ops.stopCandidate(state.runtime, state.candidate);
      else if ([6, 7, 8, 9, 10, 11, 12, 13].includes(state.version)) await assertAttemptStopped(state);
      else await ops.stopRuntime(state.runtime);
    } catch { verified = false; }
    try {
      await ops.verifyIngress(state.ingress, { probeControlServices: false });
      await assertAttemptStopped(state);
      await ops.assertDatabaseQuiet(state.database);
    } catch { verified = false; }
    state.phase = verified ? "failed-held" : "failed-unknown";
    await ops.save(state);
    if (!verified) failure("maintenance_failure_state_unverified");
    return publicSummary(state);
  };

  if (["inspect-lease-renewal", "renew-lease", "inspect-fence-recovery", "recover-fence"].includes(request.action)) {
    // Initial held v11 -> renewable v12, or time-only renewal of held v12.
    // Same unused attempt, all original records and live safety checks retained.
    const snapshot = await ops.readLeaseSnapshot();
    const recovering = ["inspect-fence-recovery", "recover-fence"].includes(request.action);
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: recovering || snapshot.state.version === 11 ? request.previousTargetSha : request.targetSha }, ops.bootId(), ops.now());
    const validatePredecessor = recovering ? validateMaintenanceFencePredecessor : validateMaintenanceLeasePredecessor;
    validatePredecessor(state, { bootId: ops.bootId(), now: ops.now() });
    ops.validateProofs(state);
    const assertPredecessorHeld = async () => {
      await ops.assertPreflightDiskHeadroom(state);
      await ops.verifyIngress(state.ingress);
      await ops.assertLeaseStopped(state);
      await ops.assertDatabaseQuiet(state.database);
    };
    await assertPredecessorHeld();
    const stoppedBaseline = ["renew-lease", "recover-fence"].includes(request.action)
      ? request.leaseEvidence.stoppedBaseline : await ops.captureLeaseBaseline(state);
    await ops.verifyLeaseBaseline(state, stoppedBaseline);
    const source = await ops.readLeaseSourceProof(request, state);
    const migrationDigest = await ops.readLeaseMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest, stoppedBaseline };
    const inspection = (recovering ? createMaintenanceFenceInspection : createMaintenanceLeaseInspection)(state, context);
    if (["inspect-lease-renewal", "inspect-fence-recovery"].includes(request.action)) return inspection;
    await assertPredecessorHeld();
    await ops.verifyLeaseBaseline(state, stoppedBaseline);
    const finalSource = await ops.readLeaseSourceProof(request, state), finalMigration = await ops.readLeaseMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_lease_evidence_changed");
    const next = (recovering ? buildMaintenanceFenceRecoveredState : buildMaintenanceLeasedState)(state, request.leaseEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitLease(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_lease_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-preflight-recovery", "recover-preflight"].includes(request.action)) {
    // Carry only the exact v10 preflight failure into separately authorized
    // v11 within the same window. No process starts or audit resets; attempt stays 3.
    const snapshot = await ops.readPreflightRecoverySnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    validateMaintenancePreflightRecoveryPredecessor(state, { bootId: ops.bootId(), now: ops.now() });
    ops.validateProofs(state);
    const assertPredecessorHeld = async () => {
      await ops.assertPreflightDiskHeadroom(state);
      await ops.verifyIngress(state.ingress);
      await ops.assertPreflightRecoveryStopped(state);
      await ops.assertDatabaseQuiet(state.database);
    };
    await assertPredecessorHeld();
    const stoppedBaseline = request.action === "recover-preflight"
      ? request.preflightRecoveryEvidence.stoppedBaseline : await ops.capturePreflightRecoveryBaseline(state);
    await ops.verifyPreflightRecoveryBaseline(state, stoppedBaseline);
    const source = await ops.readPreflightRecoverySourceProof(request);
    const migrationDigest = await ops.readPreflightRecoveryMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest, stoppedBaseline };
    const inspection = createMaintenancePreflightRecoveryInspection(state, context);
    if (request.action === "inspect-preflight-recovery") return inspection;
    await assertPredecessorHeld();
    await ops.verifyPreflightRecoveryBaseline(state, stoppedBaseline);
    const finalSource = await ops.readPreflightRecoverySourceProof(request), finalMigration = await ops.readPreflightRecoveryMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_preflight_recovery_evidence_changed");
    const next = buildMaintenancePreflightRecoveredState(state, request.preflightRecoveryEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitPreflightRecovery(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_preflight_recovery_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-prelaunch-recovery", "recover-prelaunch"].includes(request.action)) {
    // Carry only the exact v9 prelaunch failure into a separately authorized
    // v10 window. No process starts, no audit is replaced, activeAttempt stays 3.
    const snapshot = await ops.readPrelaunchRecoverySnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    validateMaintenancePrelaunchRecoveryPredecessor(state, { bootId: ops.bootId(), now: ops.now() });
    ops.validateProofs(state);
    const assertPredecessorHeld = async () => {
      await ops.assertPrelaunchDiskHeadroom(state);
      await ops.verifyIngress(state.ingress);
      await ops.assertPrelaunchRecoveryStopped(state);
      await ops.assertDatabaseQuiet(state.database);
    };
    await assertPredecessorHeld();
    const stoppedBaseline = request.action === "recover-prelaunch"
      ? request.prelaunchRecoveryEvidence.stoppedBaseline : await ops.capturePrelaunchRecoveryBaseline(state);
    await ops.verifyPrelaunchRecoveryBaseline(state, stoppedBaseline);
    const source = await ops.readPrelaunchRecoverySourceProof(request);
    const migrationDigest = await ops.readPrelaunchRecoveryMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest, stoppedBaseline };
    const inspection = createMaintenancePrelaunchRecoveryInspection(state, context);
    if (request.action === "inspect-prelaunch-recovery") return inspection;
    await assertPredecessorHeld();
    await ops.verifyPrelaunchRecoveryBaseline(state, stoppedBaseline);
    const finalSource = await ops.readPrelaunchRecoverySourceProof(request), finalMigration = await ops.readPrelaunchRecoveryMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_prelaunch_recovery_evidence_changed");
    const next = buildMaintenancePrelaunchRecoveredState(state, request.prelaunchRecoveryEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitPrelaunchRecovery(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_prelaunch_recovery_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-window-renewal", "renew-window"].includes(request.action)) {
    // Renew only the exact unused v8 held opportunity. No process is started,
    // no prior audit is replaced, and the active attempt remains three.
    const snapshot = await ops.readWindowRenewalSnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    validateMaintenanceWindowRenewalPredecessor(state, { bootId: ops.bootId(), now: ops.now() });
    ops.validateProofs(state);
    const assertPredecessorHeld = async () => {
      await ops.verifyIngress(state.ingress);
      await ops.assertWindowRenewalStopped(state);
      await ops.assertDatabaseQuiet(state.database);
    };
    await assertPredecessorHeld();
    const stoppedBaseline = request.action === "renew-window"
      ? request.windowRenewalEvidence.stoppedBaseline : await ops.captureWindowRenewalBaseline(state);
    await ops.verifyWindowRenewalBaseline(state, stoppedBaseline);
    const source = await ops.readWindowRenewalSourceProof(request);
    const migrationDigest = await ops.readWindowRenewalMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest, stoppedBaseline };
    const inspection = createMaintenanceWindowRenewalInspection(state, context);
    if (request.action === "inspect-window-renewal") return inspection;
    await assertPredecessorHeld();
    await ops.verifyWindowRenewalBaseline(state, stoppedBaseline);
    const finalSource = await ops.readWindowRenewalSourceProof(request), finalMigration = await ops.readWindowRenewalMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_window_renewal_evidence_changed");
    const next = buildMaintenanceWindowRenewedState(state, request.windowRenewalEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitWindowRenewal(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_window_renewal_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-budget-recovery", "recover-budget"].includes(request.action)) {
    // One separately authorized budget-fixed attempt after D7. The entire v7 predecessor,
    // including all consumed histories, is retained by the exact pure builder.
    const snapshot = await ops.readBudgetRecoverySnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    validateMaintenanceBudgetRecoveryPredecessor(state, { bootId: ops.bootId(), now: ops.now() });
    ops.validateProofs(state);
    const assertPredecessorHeld = async () => {
      await ops.verifyIngress(state.ingress);
      await ops.assertBudgetRecoveryStopped(state);
      await ops.assertDatabaseQuiet(state.database);
    };
    await assertPredecessorHeld();
    const stoppedBaseline = request.action === "recover-budget"
      ? request.budgetRecoveryEvidence.stoppedBaseline : await ops.captureBudgetRecoveryBaseline(state);
    await ops.verifyBudgetRecoveryBaseline(state, stoppedBaseline);
    const source = await ops.readBudgetRecoverySourceProof(request);
    const migrationDigest = await ops.readBudgetRecoveryMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest, stoppedBaseline };
    const inspection = createMaintenanceBudgetRecoveryInspection(state, context);
    if (request.action === "inspect-budget-recovery") return inspection;
    await assertPredecessorHeld();
    await ops.verifyBudgetRecoveryBaseline(state, stoppedBaseline);
    const finalSource = await ops.readBudgetRecoverySourceProof(request), finalMigration = await ops.readBudgetRecoveryMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_budget_recovery_evidence_changed");
    const next = buildMaintenanceBudgetRecoveredState(state, request.budgetRecoveryEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitBudgetRecovery(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_budget_recovery_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-second-attempt-recovery", "recover-second-attempt"].includes(request.action)) {
    // One separately authorized attempt after D6. The entire v6 predecessor,
    // including both consumed histories, is retained by the exact pure builder.
    const snapshot = await ops.readSecondAttemptRecoverySnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    validateMaintenanceSecondAttemptRecoveryPredecessor(state, { bootId: ops.bootId(), now: ops.now() });
    ops.validateProofs(state);
    const assertPredecessorHeld = async () => {
      await ops.verifyIngress(state.ingress);
      await ops.assertFailedAttemptStopped(state);
      await ops.assertDatabaseQuiet(state.database);
    };
    await assertPredecessorHeld();
    const stoppedBaseline = request.action === "recover-second-attempt"
      ? request.secondAttemptRecoveryEvidence.stoppedBaseline : await ops.captureFailedAttemptBaseline(state);
    await ops.verifyFailedAttemptBaseline(state, stoppedBaseline);
    const source = await ops.readSecondAttemptRecoverySourceProof(request);
    const migrationDigest = await ops.readSecondAttemptRecoveryMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest, stoppedBaseline };
    const inspection = createMaintenanceSecondAttemptRecoveryInspection(state, context);
    if (request.action === "inspect-second-attempt-recovery") return inspection;
    await assertPredecessorHeld();
    await ops.verifyFailedAttemptBaseline(state, stoppedBaseline);
    const finalSource = await ops.readSecondAttemptRecoverySourceProof(request), finalMigration = await ops.readSecondAttemptRecoveryMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_second_attempt_recovery_evidence_changed");
    const next = buildMaintenanceSecondAttemptRecoveredState(state, request.secondAttemptRecoveryEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitSecondAttemptRecovery(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_second_attempt_recovery_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-attempt-recovery", "recover-attempt"].includes(request.action)) {
    // Append ONE new attempt while retaining the full consumed predecessor.
    // Inspection never mutates. No catch may retry a CAS, clear a journal, or
    // restart either old runtime. The old current pointer is the stopped T5.
    const snapshot = await ops.readAttemptRecoverySnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    validateMaintenanceAttemptRecoveryPredecessor(state, { bootId: ops.bootId(), now: ops.now() });
    ops.validateProofs(state);
    await assertHeld(state);
    const stoppedBaseline = request.action === "recover-attempt"
      ? request.attemptRecoveryEvidence.stoppedBaseline : await ops.captureFailedCandidateBaseline(state);
    await ops.verifyFailedCandidateBaseline(state, stoppedBaseline);
    const source = await ops.readAttemptRecoverySourceProof(request);
    const migrationDigest = await ops.readAttemptRecoveryMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest, stoppedBaseline };
    const inspection = createMaintenanceAttemptRecoveryInspection(state, context);
    if (request.action === "inspect-attempt-recovery") return inspection;
    await assertHeld(state);
    await ops.verifyFailedCandidateBaseline(state, stoppedBaseline);
    const finalSource = await ops.readAttemptRecoverySourceProof(request), finalMigration = await ops.readAttemptRecoveryMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_attempt_recovery_evidence_changed");
    const next = buildMaintenanceAttemptRecoveredState(state, request.attemptRecoveryEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitAttemptRecovery(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_attempt_recovery_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-build-recovery", "recover-build"].includes(request.action)) {
    // This failed, unlaunched T3 build is a separate incident from both earlier
    // transitions. No catch may reset evidence, resume a writer, or retry this CAS.
    const snapshot = await ops.readBuildRecoverySnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    if (state.version !== 4 || state.phase !== "failed-held" || state.revision !== 7 ||
        ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"].some(key => state[key] !== null)) failure("maintenance_build_recovery_state_invalid");
    ops.validateProofs(state);
    await assertHeld(state);
    const source = await ops.readBuildRecoverySourceProof(request);
    const migrationDigest = await ops.readBuildRecoveryMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest };
    const inspection = createMaintenanceBuildRecoveryInspection(state, context);
    if (request.action === "inspect-build-recovery") return inspection;
    await assertHeld(state);
    const finalSource = await ops.readBuildRecoverySourceProof(request), finalMigration = await ops.readBuildRecoveryMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_build_recovery_evidence_changed");
    const next = buildMaintenanceBuildRecoveredState(state, request.buildRecoveryEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitBuildRecovery(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_build_recovery_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-continuation", "continue-held"].includes(request.action)) {
    // Separate post-migration incident, never reuse the pre-migration recovery
    // exemption. No catch may reset evidence, resume a writer, or retry this CAS.
    const snapshot = await ops.readContinuationSnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    if (state.version !== 3 || state.phase !== "held" || state.revision !== 4 ||
        ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"].some(key => state[key] !== null)) failure("maintenance_continuation_state_invalid");
    ops.validateProofs(state);
    await assertHeld(state);
    const source = await ops.readContinuationSourceProof(request);
    const migrationDigest = await ops.readContinuationMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest };
    const inspection = createMaintenanceContinuationInspection(state, context);
    if (request.action === "inspect-continuation") return inspection;
    await assertHeld(state);
    const finalSource = await ops.readContinuationSourceProof(request), finalMigration = await ops.readContinuationMigrationProof(state);
    if (!equal(finalSource, source) || finalMigration !== migrationDigest) failure("maintenance_continuation_evidence_changed");
    const next = buildMaintenanceContinuedState(state, request.continuationEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitContinuation(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_continuation_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["inspect-recovery", "recover-held"].includes(request.action)) {
    // This branch is not a fresh plan, a launch reconciliation, or a general
    // target override. It can consume only the explicit old failed operation.
    const snapshot = await ops.readRecoverySnapshot();
    const state = validateMaintenanceState(snapshot.state, { ...request, targetSha: request.previousTargetSha }, ops.bootId(), ops.now());
    if (state.version !== 2 || state.phase !== "failed-held" ||
        ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"].some(key => state[key] !== null)) failure("maintenance_recovery_state_invalid");
    ops.validateProofs(state);
    await assertHeld(state);
    const source = await ops.readRecoverySourceProof(request);
    const migrationDigest = await ops.readRecoveryMigrationProof(state);
    const context = { operationId: request.operationId, previousTargetSha: request.previousTargetSha, targetSha: request.targetSha,
      expectedOldSha: request.expectedOldSha, expectedRevision: snapshot.revision, expectedDigest: snapshot.digest,
      bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: source.sourceDiffDigest, migrationDigest };
    const inspection = createMaintenanceRecoveryInspection(state, context);
    if (request.action === "inspect-recovery") return inspection;
    // All inspected digests and the runner history grant must still match.
    // No retry, failure cleanup, new process, or ingress mutation is permitted.
    await assertHeld(state);
    // Recheck history freshness AFTER the potentially slow final host checks.
    const next = buildMaintenanceRecoveredState(state, request.recoveryEvidence, { ...context, now: ops.now() });
    validateMaintenanceState(next, request, ops.bootId(), ops.now()); ops.validateProofs(next);
    const saved = await ops.commitRecovery(snapshot, next);
    if (!equal(saved, next)) failure("maintenance_recovery_write_unconfirmed");
    return publicSummary(saved, "held");
  }

  if (["plan", "prepare"].includes(request.action)) {
    const captureStep = async (stage, inspect) => {
      try { return await inspect(); }
      catch (error) {
        // The read-only workflow may publish only these fixed phase codes,
        // never raw host/configuration/transport errors or a success proof.
        if (request.action === "plan") failure(`maintenance_plan_${stage}_unverified`);
        throw error;
      }
    };
    await captureStep("operation_state", () => ops.assertNoActiveOperation());
    const operationId = ops.uuid();
    if (!UUID.test(operationId)) failure("maintenance_operation_invalid");
    const runtime = await captureStep("runtime", () => ops.captureRuntime({ appDir: request.appDir, appName: request.appName, appPort: request.appPort, expectedOldSha: request.expectedOldSha }));
    // Preserve the frozen runtime configuration. Only maintenance probes use
    // the browser-equivalent HTTPS gateway; captureIngress must independently
    // prove that gateway reaches the exact frozen Kong before state is saved.
    const publicSupabaseUrl = await captureStep("public_gateway", async () =>
      selectMaintenancePublicGateway(await ops.readPublicSupabaseUrl(runtime)));
    const capturedIngress = await captureStep("ingress", () => ops.captureIngress({ appPort: request.appPort, publicSupabaseUrl, operationId }));
    const database = await captureStep("database", () => ops.captureDatabase());
    const token = ops.token();
    if (!/^[0-9a-f]{64}$/.test(token)) failure("maintenance_token_invalid");
    const ingress = await captureStep("installation", () => ops.planIngressInstallation(capturedIngress, token));
    if (request.action === "plan") return publicSummary({ ...request, operationId }, "planned");
    const state = { version: 2, revision: 0, operationId, targetSha: request.targetSha, expectedOldSha: request.expectedOldSha,
      appDir: request.appDir, appName: request.appName, appPort: request.appPort, bootId: ops.bootId(), createdAt: ops.now(),
      phase: "preparing", runtime, ingress, database, publicSupabaseUrl, tokenHash: digest(token), candidate: null, resumed: null,
      launchDisk: null, launchJournal: null, finalDump: null };
    validateMaintenanceState(state, { ...request, operationId }, ops.bootId(), ops.now());
    ops.validateProofs(state);
    if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) failure("maintenance_state_size_exceeded");
    // Persist the exact recovery targets before the first network or process mutation.
    await ops.create(state, token);
    try {
      state.ingress = await ops.installIngress(state.ingress, token);
      await ops.save(state);
      await ops.stopRuntime(runtime);
      await ops.assertRuntimeStopped(runtime);
      await ops.verifyIngress(state.ingress);
      await ops.waitDatabaseQuiet(database);
      await ops.verifyIngress(state.ingress);
      state.phase = "held";
      await ops.save(state);
      return publicSummary(state);
    } catch {
      let code = "maintenance_prepare_failed_held";
      let summary;
      try { summary = await keepFailedClosed(state); }
      catch { code = "maintenance_failure_state_unverified"; summary = publicSummary(state, "failed-unknown"); }
      // The command still fails. Preserve only the operation identity so an
      // operator can investigate a partially established maintenance window.
      const error = new Error(code);
      Object.defineProperty(error, "maintenanceReport", { value: summary });
      throw error;
    }
  }

  const state = validateMaintenanceState(await ops.load(), request, ops.bootId(), ops.now());
  // Validation of subordinate proofs is mandatory before they reach an actuator.
  ops.validateProofs(state);
  if (request.action === "fail-held") return keepFailedClosed(state);
  if (request.action === "check-runtime-held") {
    // Internal deploy-only checkpoint while the separately verified readiness
    // fence holds its own transaction. This is NOT a database-quiet certificate.
    await assertHeld(state, false);
    return publicSummary(state, "runtime-held");
  }
  if (["check-held", "runtime-handoff"].includes(request.action)) {
    await assertHeld(state);
    const summary = publicSummary(state, "held");
    if (request.action === "runtime-handoff" && [12, 13].includes(state.version)) {
      const audit = state.leaseExtensions.at(-1)?.evidence ?? state.fenceRecovery ?? state.leaseRenewal;
      await ops.verifyLeaseBaseline(state, audit.stoppedBaseline);
      const fields = await ops.readLeaseHandoffFields(state.runtime, state, audit.stoppedBaseline);
      return { ...summary, version: 3, fields, budgetBaseline: { version: 3,
        predecessorStateDigest: state.budgetRecovery.predecessor.stateDigest,
        previousTargetSha: state.budgetRecovery.predecessor.state.targetSha, stoppedBaseline: audit.stoppedBaseline } };
    }
    if (request.action === "runtime-handoff" && state.version === 11) {
      const audit = state.preflightRecovery;
      await ops.verifyPreflightRecoveryBaseline(state, audit.stoppedBaseline);
      const fields = await ops.readPreflightRecoveryHandoffFields(state.runtime, state, audit.stoppedBaseline);
      return { ...summary, version: 3, fields, budgetBaseline: { version: 3,
        predecessorStateDigest: state.budgetRecovery.predecessor.stateDigest,
        previousTargetSha: state.budgetRecovery.predecessor.state.targetSha, stoppedBaseline: audit.stoppedBaseline } };
    }
    if (request.action === "runtime-handoff" && state.version === 10) {
      const audit = state.prelaunchRecovery;
      await ops.verifyPrelaunchRecoveryBaseline(state, audit.stoppedBaseline);
      const fields = await ops.readPrelaunchRecoveryHandoffFields(state.runtime, state, audit.stoppedBaseline);
      return { ...summary, version: 3, fields, budgetBaseline: { version: 3,
        predecessorStateDigest: state.budgetRecovery.predecessor.stateDigest,
        previousTargetSha: state.budgetRecovery.predecessor.state.targetSha, stoppedBaseline: audit.stoppedBaseline } };
    }
    if (request.action === "runtime-handoff" && state.version === 9) {
      const audit = state.windowRenewal;
      await ops.verifyWindowRenewalBaseline(state, audit.stoppedBaseline);
      const fields = await ops.readWindowRenewalHandoffFields(state.runtime, state, audit.stoppedBaseline);
      return { ...summary, version: 3, fields, budgetBaseline: { version: 3,
        predecessorStateDigest: state.budgetRecovery.predecessor.stateDigest,
        previousTargetSha: state.budgetRecovery.predecessor.state.targetSha, stoppedBaseline: audit.stoppedBaseline } };
    }
    if (request.action === "runtime-handoff" && state.version === 8) {
      const audit = state.budgetRecovery;
      await ops.verifyBudgetRecoveryBaseline(audit.predecessor.state, audit.stoppedBaseline);
      const fields = await ops.readBudgetRecoveryHandoffFields(state.runtime, audit.predecessor.state, audit.stoppedBaseline);
      return { ...summary, version: 3, fields, budgetBaseline: { version: 3,
        predecessorStateDigest: audit.predecessor.stateDigest, previousTargetSha: audit.predecessor.state.targetSha,
        stoppedBaseline: audit.stoppedBaseline } };
    }
    if (request.action === "runtime-handoff" && state.version === 7) {
      const audit = state.secondAttemptRecovery;
      await ops.verifyFailedAttemptBaseline(audit.predecessor.state, audit.stoppedBaseline);
      const fields = await ops.readFailedAttemptHandoffFields(state.runtime, audit.predecessor.state, audit.stoppedBaseline);
      return { ...summary, version: 2, fields, attemptBaseline: { version: 2,
        predecessorStateDigest: audit.predecessor.stateDigest, previousTargetSha: audit.predecessor.state.targetSha,
        stoppedBaseline: audit.stoppedBaseline } };
    }
    if (request.action === "runtime-handoff" && state.version === 6) {
      await ops.verifyFailedCandidateBaseline(state.attemptRecovery.predecessor.state, state.attemptRecovery.stoppedBaseline);
      return { ...summary, runtime: state.runtime, attemptRecovery: { version: 1,
        predecessor: state.attemptRecovery.predecessor.state, stoppedBaseline: state.attemptRecovery.stoppedBaseline } };
    }
    return request.action === "runtime-handoff" ? { ...summary, runtime: state.runtime } : summary;
  }
  if (request.action === "snapshot-pair") {
    await assertCandidateIngress(state);
    const snapshotPair = await ops.readManagedSnapshotPair(state.runtime, state.candidate);
    if (!exact(snapshotPair, ["web", "worker"]) || !/^running:[1-9][0-9]{0,9}$/.test(snapshotPair.web) ||
        !["absent", "inactive"].includes(snapshotPair.worker)) failure("maintenance_snapshot_unverified");
    return { ...publicSummary(state), snapshotPair };
  }
  if (["snapshot-web", "snapshot-worker"].includes(request.action)) {
    // readManagedSnapshot independently performs full candidate verification
    // and a fresh final registry read; do not perform that same work twice.
    if (state.phase === "candidate") await assertCandidateIngress(state);
    else await assertHeld(state, false);
    const snapshot = await ops.readManagedSnapshot(state.runtime, state.candidate,
      request.action === "snapshot-web" ? "web" : "worker");
    if (typeof snapshot !== "string" || !/^(?:absent|inactive|running:[1-9][0-9]{0,9})$/.test(snapshot)) failure("maintenance_snapshot_unverified");
    return { ...publicSummary(state), snapshot };
  }
  if (request.action === "candidate-handoff") {
    await assertCandidate(state);
    const fields = await ops.readCandidateHandoffFields(state.runtime, state.candidate);
    const keys = ["CANDIDATE_WEB_PID", "CANDIDATE_WEB_PROCESS_START_TICKS", "CANDIDATE_WEB_PROCESS_IDENTITY", "CANDIDATE_WEB_CWD_IDENTITY", "CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64"];
    if (!exact(fields, keys) || Object.values(fields).some((value) => typeof value !== "string" || !value || value.length > 65536 || /[\r\n\0]/.test(value))) failure("maintenance_candidate_handoff_unverified");
    return { ...publicSummary(state), fields };
  }
  if (request.action === "start-candidate") {
    if (state.phase !== "held") failure("maintenance_not_held");
    await ops.verifyIngress(state.ingress, { probeControlServices: false });
    if ([6, 7, 8, 9, 10, 11, 12, 13].includes(state.version)) await assertAttemptStopped(state);
    try {
      state.candidate = await ops.startCandidate(state.runtime, state.targetSha, { launchJournal: createMaintenanceLaunchCallbacks(state, ops) });
      if (state.launchJournal?.slots["paused-web"]?.phase !== "confirmed" || state.candidate?.targetSha !== state.targetSha) failure("maintenance_candidate_unverified");
      await ops.verifyCandidate(state.runtime, state.candidate, "1");
      state.phase = "candidate"; await ops.save(state);
      await assertCandidate(state); return publicSummary(state);
    } catch {
      await keepFailedClosed(state); failure("maintenance_candidate_start_failed_held");
    }
  }
  if (["register-candidate", "check-candidate"].includes(request.action)) {
    // Registration cannot adopt an independently started process or launch again.
    await assertCandidate(state);
    return publicSummary(state);
  }
  if (request.action === "end") {
    await assertCandidate(state);
    await ops.assertClientWritesDenied(state.database);
    state.phase = "resuming";
    await ops.save(state);
    try {
      state.resumed = await ops.resumeCandidate(state.runtime, state.candidate, state.targetSha,
        { launchJournal: createMaintenanceLaunchCallbacks(state, ops) });
      if (state.launchJournal?.slots["resumed-web"]?.phase !== "confirmed") failure("maintenance_launch_reconciliation_unverified");
      await ops.save(state);
      await ops.verifyResumedCandidate(state.runtime, state.resumed);
      await assertHistoricalGenerationStopped(state);
      state.finalDump = await ops.persistResumedDump(state.runtime, state.resumed);
      ops.validateResumedDumpProof(state.finalDump, state.runtime, state.resumed);
      await ops.save(state);
      await ops.verifyResumedDump(state.runtime, state.resumed, state.finalDump);
      await ops.verifyIngress(state.ingress);
      await assertHistoricalGenerationStopped(state);
      await ops.restoreIngress(state.ingress);
      await ops.verifyResumedCandidate(state.runtime, state.resumed);
      await ops.verifyResumedDump(state.runtime, state.resumed, state.finalDump);
      await assertHistoricalGenerationStopped(state);
      state.phase = "ended";
      await ops.save(state);
      return publicSummary(state);
    } catch {
      await keepFailedClosed(state);
      failure("maintenance_end_failed_held");
    }
  }
  failure("maintenance_arguments_invalid");
}

function secureDirectory(directory, create = false) {
  if (create) { try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; } }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o077) !== 0 || realpathSync(directory) !== directory) failure("maintenance_private_directory_invalid");
}
function readPrivate(file, maximum = MAX_STATE_BYTES) {
  let fd;
  try {
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0 || (before.mode & 0o077) !== 0 || before.size < 1 || before.size > maximum) failure("maintenance_private_file_invalid");
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    const bytes = readFileSync(fd);
    const after = lstatSync(file);
    if (opened.dev !== before.dev || opened.ino !== before.ino || after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || bytes.length !== opened.size) failure("maintenance_private_file_changed");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { if (fd !== undefined) closeSync(fd); }
}
// Initial creation only. Subsequent state writes MUST use the journal storage's
// real previous revision/digest CAS. Ambiguous temporary files are retained.
function writePrivate(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    try { lstatSync(file); failure("maintenance_private_file_exists"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, content, "utf8"); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, file);
    fd = openSync(path.posix.dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    fsyncSync(fd); closeSync(fd); fd = undefined;
    if (readPrivate(file) !== content) failure("maintenance_private_write_unconfirmed");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function execute(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: "utf8", timeout: 12_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", PGOPTIONS: "" }, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  if (result.error || result.signal || result.status !== 0) failure("maintenance_fixed_command_failed");
  return result.stdout;
}

/** Private host-only authorization for bounded, real public-origin health probes. */
export function readMaintenanceProbeContext(environment = process.env) {
  const names = ["FAOLLA_MAINTENANCE_APP_NAME", "FAOLLA_MAINTENANCE_OPERATION_ID", "FAOLLA_MAINTENANCE_TARGET_SHA"];
  if (names.every((key) => environment[key] === undefined || environment[key] === "")) return null;
  const [appName, operationId, targetSha] = names.map((key) => environment[key]);
  if (!APP.test(appName ?? "") || !UUID.test(operationId ?? "") || !SHA.test(targetSha ?? "") ||
      process.platform !== "linux" || process.getuid?.() !== 0) failure("maintenance_probe_binding_invalid");
  const directory = `${ROOT}/${appName}`;
  secureDirectory(ROOT); secureDirectory(directory);
  const state = JSON.parse(readPrivate(`${directory}/state.json`));
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  validateMaintenanceState(state, { ...state, appName, operationId, targetSha }, bootId, Date.now());
  if (!["held", "candidate", "failed-held"].includes(state.phase)) failure("maintenance_probe_phase_invalid");
  const token = readPrivate(`${directory}/control.token`, 64);
  if (!/^[0-9a-f]{64}$/.test(token) || digest(token) !== state.tokenHash) failure("maintenance_token_identity_invalid");
  return { publicSupabaseUrl: state.publicSupabaseUrl, token };
}

// A stale lock is an explicit operator stop, never automatically broken or stolen.
const ownedOperationLocks = new Map();
async function underExistingOperationLock(appName, action) {
  const expected = ownedOperationLocks.get(appName), file = `${ROOT}/${appName}/operation.lock`;
  const check = () => {
    if (!expected || ownedOperationLocks.get(appName) !== expected) failure("maintenance_operation_lock_not_owned");
    const current = lstatSync(file);
    if (!current.isDirectory() || current.isSymbolicLink() || current.uid !== 0 || (current.mode & 0o077) !== 0 ||
        current.dev !== expected.dev || current.ino !== expected.ino) failure("maintenance_lock_identity_changed");
  };
  check(); const result = await action(); check(); return result;
}
async function withPrivateOperationLock(request, action) {
  if (request.action === "plan") return action();
  secureDirectory(ROOT, true);
  const directory = `${ROOT}/${request.appName}`;
  secureDirectory(directory, true);
  const lock = `${directory}/operation.lock`;
  try { mkdirSync(lock, { mode: 0o700 }); } catch { failure("maintenance_operation_locked"); }
  const identity = lstatSync(lock);
  ownedOperationLocks.set(request.appName, identity);
  try { return await action(); } finally {
    ownedOperationLocks.delete(request.appName);
    const current = lstatSync(lock);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) failure("maintenance_lock_identity_changed");
    rmdirSync(lock);
  }
}
const DOCKER = ["--host", "unix:///var/run/docker.sock"];
const SCHEDULER_SAFE_SQL = "NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname NOT IN ('plpgsql','pgcrypto','uuid-ossp','pg_stat_statements','pgjwt','pg_graphql','pgaudit','pgsodium','pg_trgm','vector','pg_net')) " +
  "AND to_regclass('cron.job') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_subscription WHERE subenabled) " +
  "AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(current_setting('shared_preload_libraries'), ',') AS library WHERE trim(both ' \"' from library) NOT IN ('','pg_stat_statements','pgaudit','pgsodium','pg_net','pg_cron')) " +
  "AND (position('pg_cron' in current_setting('shared_preload_libraries'))=0 OR current_setting('cron.database_name',true)=current_database())";
const QUIET_SQL = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; " +
  "SELECT json_build_object('complete', current_setting('is_superuser')='on' OR pg_has_role(current_user,'pg_read_all_stats','USAGE')," +
  "'schedulerSafe',(" + SCHEDULER_SAFE_SQL + ")," +
  "'transactions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND xact_start IS NOT NULL)," +
  "'prepared',(SELECT count(*) FROM pg_prepared_xacts), 'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()))::text; ROLLBACK;";
const ACL_SQL = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; " +
  "SELECT json_build_object('migration',exists(select 1 from public.faolla_schema_migrations where version=202609090048 and name='pages_client_write_acl')," +
  "'clientsDenied',bool_and(NOT has_table_privilege(r.oid,'public.pages','INSERT') AND NOT has_table_privilege(r.oid,'public.pages','UPDATE') AND NOT has_table_privilege(r.oid,'public.pages','DELETE') AND NOT has_any_column_privilege(r.oid,'public.pages','INSERT') AND NOT has_any_column_privilege(r.oid,'public.pages','UPDATE')) AND count(*)=2," +
  "'serviceWrites',has_table_privilege('service_role','public.pages','INSERT') AND has_table_privilege('service_role','public.pages','UPDATE') AND has_table_privilege('service_role','public.pages','DELETE'))::text FROM pg_roles r WHERE rolname IN ('anon','authenticated'); ROLLBACK;";
// Fixed read-only SQL exported for acceptance on a separately bound disposable PG15 service.
export const PRODUCTION_MAINTENANCE_QUIET_SQL = QUIET_SQL;
export const PRODUCTION_MAINTENANCE_ACL_SQL = ACL_SQL;

// The original profile is unchanged. Only the reviewed, exact Supabase build
// takes the additional cross-database checks, on EVERY quiet observation. An
// unsupported or failed Supabase observation never falls back to the old SQL.
export function queryMaintenanceDatabaseQuiet(proof, query) {
  if (proof?.image === SUPABASE_SCHEDULER_IMAGE) return readSupportedSupabaseMaintenanceQuiet(proof, query);
  return query("postgres", QUIET_SQL);
}

async function productionOperations(request) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) failure("maintenance_host_authority_unavailable");
  if (realpathSync(request.appDir) !== request.appDir) failure("maintenance_app_path_invalid");
  const runtime = await import("./production-maintenance-runtime.mjs");
  const ingress = await import("./production-maintenance-ingress.mjs");
  const { MAINTENANCE_PSQL_CONTAINER_SCRIPT } = await import("./check-production-maintenance-capabilities.mjs");
  const directory = `${ROOT}/${request.appName}`;
  const statePath = `${directory}/state.json`;
  const tokenPath = `${directory}/control.token`;
  const bootId = () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const validateProofs = (state) => {
    runtime.validateRuntimeProof(state.runtime); ingress.validateIngressProof(state.ingress);
    validateMaintenanceSubproofBindings(state);
    if ([8, 9, 10, 11, 12, 13].includes(state.version)) validateProofs(state.budgetRecovery.predecessor.state);
    if (state.version === 7) validateProofs(state.secondAttemptRecovery.predecessor.state);
    if (state.version === 6) {
      // History is independently typed and bound, never adopted as an active
      // process proof. The pure v6 validator separately pins every old byte.
      validateProofs(state.attemptRecovery.predecessor.state);
    }
    if (state.launchDisk) runtime.validateLaunchDisk(state.launchDisk, state.runtime, state.targetSha);
    if (state.candidate) {
      runtime.validateCandidateProof(state.candidate, state.runtime);
      if (state.candidate.targetSha !== state.targetSha) failure("maintenance_candidate_target_invalid");
    }
    if (state.resumed) {
      runtime.validateResumedCandidateProof(state.resumed, state.runtime);
      if (state.resumed.candidate.targetSha !== state.targetSha) failure("maintenance_candidate_target_invalid");
    }
    if (state.finalDump) runtime.validateResumedDumpProof(state.finalDump, state.runtime, state.resumed);
    validateMaintenanceLaunchProofBindings(state);
  };
  const store = createMaintenanceLaunchJournalStorage({ appName: request.appName,
    withExistingOperationLock: (action) => underExistingOperationLock(request.appName, action),
    captureState: (value) => {
      const recovery = ["inspect-recovery", "recover-held"].includes(request.action);
      const continuation = ["inspect-continuation", "continue-held"].includes(request.action);
      const buildRecovery = ["inspect-build-recovery", "recover-build"].includes(request.action);
      const attemptRecovery = ["inspect-attempt-recovery", "recover-attempt"].includes(request.action);
      const secondAttemptRecovery = ["inspect-second-attempt-recovery", "recover-second-attempt"].includes(request.action);
      const budgetRecovery = ["inspect-budget-recovery", "recover-budget"].includes(request.action);
      const windowRenewal = ["inspect-window-renewal", "renew-window"].includes(request.action);
      const prelaunchRecovery = ["inspect-prelaunch-recovery", "recover-prelaunch"].includes(request.action);
      const preflightRecovery = ["inspect-preflight-recovery", "recover-preflight"].includes(request.action);
      const leaseRenewal = ["inspect-lease-renewal", "renew-lease", "inspect-fence-recovery", "recover-fence"].includes(request.action);
      // Reading T1 and acknowledging T2 are separately bound; ordinary callers
      // never inherit this compatibility branch from the contents of a file.
      const targetSha = (recovery && value.version === 2) || (continuation && value.version === 3) || (buildRecovery && value.version === 4) || (attemptRecovery && value.version === 5) || (secondAttemptRecovery && value.version === 6) || (budgetRecovery && value.version === 7) || (windowRenewal && value.version === 8) || (prelaunchRecovery && value.version === 9) || (preflightRecovery && value.version === 10) || (leaseRenewal && value.version === 11) || (["inspect-fence-recovery", "recover-fence"].includes(request.action) && value.version === 12) ? request.previousTargetSha : request.targetSha;
      validateMaintenanceState(value, { ...request, targetSha, operationId: request.operationId ?? value.operationId }, bootId(), Date.now());
      if (recovery && value.version === 3 && (value.recovery.evidence.previousTargetSha !== request.previousTargetSha ||
          value.recovery.evidence.targetSha !== request.targetSha)) failure("maintenance_recovery_state_invalid");
      if (continuation && value.version === 4 && (value.continuation.evidence.previousTargetSha !== request.previousTargetSha ||
          value.continuation.evidence.targetSha !== request.targetSha)) failure("maintenance_continuation_state_invalid");
      if (buildRecovery && value.version === 5 && (value.buildRecovery.evidence.previousTargetSha !== request.previousTargetSha ||
          value.buildRecovery.evidence.targetSha !== request.targetSha)) failure("maintenance_build_recovery_state_invalid");
      if (attemptRecovery && value.version === 6 && (value.attemptRecovery.evidence.previousTargetSha !== request.previousTargetSha ||
          value.attemptRecovery.evidence.targetSha !== request.targetSha)) failure("maintenance_attempt_recovery_invalid");
      if (secondAttemptRecovery && value.version === 7 && (value.secondAttemptRecovery.evidence.previousTargetSha !== request.previousTargetSha ||
          value.secondAttemptRecovery.evidence.targetSha !== request.targetSha)) failure("maintenance_second_attempt_recovery_invalid");
      if (budgetRecovery && value.version === 8 && (value.budgetRecovery.evidence.previousTargetSha !== request.previousTargetSha ||
          value.budgetRecovery.evidence.targetSha !== request.targetSha)) failure("maintenance_budget_recovery_invalid");
      if (windowRenewal && value.version === 9 && (value.windowRenewal.evidence.previousTargetSha !== request.previousTargetSha ||
          value.windowRenewal.evidence.targetSha !== request.targetSha)) failure("maintenance_window_renewal_invalid");
      if (prelaunchRecovery && value.version === 10 && (value.prelaunchRecovery.evidence.previousTargetSha !== request.previousTargetSha ||
          value.prelaunchRecovery.evidence.targetSha !== request.targetSha)) failure("maintenance_prelaunch_recovery_invalid");
      if (preflightRecovery && value.version === 11 && (value.preflightRecovery.evidence.previousTargetSha !== request.previousTargetSha ||
          value.preflightRecovery.evidence.targetSha !== request.targetSha)) failure("maintenance_preflight_recovery_invalid");
      validateProofs(value); return value;
    } });
  // Each loaded object keeps its OWN baseline. A later probe read must never
  // refresh another object's CAS and thereby authorize writing a stale view.
  const baselines = new WeakMap(), poisonedStates = new WeakSet(), attemptedReclosures = new WeakSet();
  const load = async () => {
    const snapshot = await store.readOperationUnderExistingOperationLock();
    const state = clone(snapshot.state); baselines.set(state, snapshot); return state;
  };
  const save = async (state) => {
    const previous = baselines.get(state);
    if (!previous || poisonedStates.has(state)) failure("maintenance_state_write_unconfirmed");
    try {
      const next = { ...state, revision: previous.revision + 1 };
      const snapshot = await store.replaceOperationUnderExistingOperationLock({
        expectedRevision: previous.revision, expectedDigest: previous.digest, next });
      state.revision = snapshot.revision; baselines.set(state, snapshot);
    } catch (error) { poisonedStates.add(state); throw error; }
  };
  const captureDatabase = () => {
    const item = JSON.parse(execute("docker", [...DOCKER, "inspect", "--type=container", "--format", '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"running":{{json .State.Running}}}', "supabase-db"]));
    if (!exact(item, ["id", "name", "image", "running"]) || !/^[0-9a-f]{64}$/.test(item.id) || item.name !== "/supabase-db" || !item.image.startsWith("supabase/postgres:") || item.running !== true) failure("maintenance_database_identity_invalid");
    const proof = { id: item.id, image: item.image, databaseOid: 0 };
    const row = queryMaintenanceDatabaseQuiet(proof, (name, sql) => queryDatabase(proof, sql, name));
    if (!row.complete || !Number.isSafeInteger(row.databaseOid) || row.databaseOid < 1) failure("maintenance_database_visibility_incomplete");
    if (row.schedulerSafe !== true) failure("maintenance_database_scheduler_unsupported");
    proof.databaseOid = row.databaseOid;
    return proof;
  };
  const queryDatabase = (proof, sql, databaseName = "postgres") => {
    if (!exact(proof, ["id", "image", "databaseOid"]) || !/^[0-9a-f]{64}$/.test(proof.id) || !proof.image.startsWith("supabase/postgres:") || !Number.isSafeInteger(proof.databaseOid)) failure("maintenance_database_identity_invalid");
    if (databaseName !== "postgres" && (proof.image !== SUPABASE_SCHEDULER_IMAGE || databaseName !== "_supabase")) failure("maintenance_database_identity_invalid");
    const observed = JSON.parse(execute("docker", [...DOCKER, "inspect", "--type=container", "--format", '{"id":{{json .Id}},"image":{{json .Config.Image}},"running":{{json .State.Running}}}', "supabase-db"]));
    if (observed.id !== proof.id || observed.image !== proof.image || observed.running !== true) failure("maintenance_database_identity_changed");
    const command = databaseName === "postgres" ? [MAINTENANCE_PSQL_CONTAINER_SCRIPT] :
      [SUPABASE_SCHEDULER_PSQL_SCRIPT, "faolla-maintenance-readonly", databaseName];
    return JSON.parse(execute("docker", [...DOCKER, "exec", "-i", proof.id, "sh", "-c", ...command], sql).trim());
  };
  const assertDatabaseQuiet = (proof) => {
    const row = queryMaintenanceDatabaseQuiet(proof, (name, sql) => queryDatabase(proof, sql, name));
    if (!exact(row, ["complete", "schedulerSafe", "transactions", "prepared", "databaseOid"]) || row.schedulerSafe !== true || row.complete !== true || row.transactions !== 0 || row.prepared !== 0 || row.databaseOid !== proof.databaseOid) failure("maintenance_database_not_quiet");
  };
  const privateProbeOptions = async () => {
    const loaded = await load();
    const previous = (["inspect-recovery", "recover-held"].includes(request.action) && loaded.version === 2) ||
      (["inspect-continuation", "continue-held"].includes(request.action) && loaded.version === 3) ||
      (["inspect-build-recovery", "recover-build"].includes(request.action) && loaded.version === 4) ||
      (["inspect-attempt-recovery", "recover-attempt"].includes(request.action) && loaded.version === 5) ||
      (["inspect-second-attempt-recovery", "recover-second-attempt"].includes(request.action) && loaded.version === 6) ||
      (["inspect-budget-recovery", "recover-budget"].includes(request.action) && loaded.version === 7) ||
      (["inspect-window-renewal", "renew-window"].includes(request.action) && loaded.version === 8) ||
      (["inspect-prelaunch-recovery", "recover-prelaunch"].includes(request.action) && loaded.version === 9) ||
      (["inspect-preflight-recovery", "recover-preflight"].includes(request.action) && loaded.version === 10) ||
      (["inspect-lease-renewal", "renew-lease", "inspect-fence-recovery", "recover-fence"].includes(request.action) && loaded.version === 11) || (["inspect-fence-recovery", "recover-fence"].includes(request.action) && loaded.version === 12);
    const targetSha = previous ? request.previousTargetSha : request.targetSha;
    const state = validateMaintenanceState(loaded, { ...request, targetSha, operationId: request.operationId ?? loaded.operationId }, bootId(), Date.now());
    const environment = await runtime.readRuntimeHandoffEnvironment(state.runtime);
    if (typeof environment.anonKey !== "string" || !environment.anonKey || /[\r\n]/.test(environment.anonKey)) failure("maintenance_probe_credentials_invalid");
    return { probeHeaders: { apikey: environment.anonKey, authorization: `Bearer ${environment.anonKey}` } };
  };
  return {
    ...runtime, ...ingress, uuid: randomUUID, token: () => randomBytes(32).toString("hex"), now: Date.now, bootId, load, save,
    captureFailedCandidateBaseline, verifyFailedCandidateBaseline, assertFailedCandidateStopped, assertFailedCandidateGenerationStopped,
    captureFailedAttemptBaseline, verifyFailedAttemptBaseline, assertFailedAttemptStopped, assertFailedAttemptGenerationsStopped,
    readFailedAttemptHandoffFields,
    captureBudgetRecoveryBaseline, verifyBudgetRecoveryBaseline, assertBudgetRecoveryStopped, assertBudgetRecoveryGenerationsStopped,
    readBudgetRecoveryHandoffFields,
    captureWindowRenewalBaseline, verifyWindowRenewalBaseline, assertWindowRenewalStopped, assertWindowRenewalGenerationsStopped,
    readWindowRenewalHandoffFields,
    capturePrelaunchRecoveryBaseline, verifyPrelaunchRecoveryBaseline, assertPrelaunchRecoveryStopped, assertPrelaunchRecoveryGenerationsStopped,
    readPrelaunchRecoveryHandoffFields, assertPrelaunchDiskHeadroom,
    capturePreflightRecoveryBaseline, verifyPreflightRecoveryBaseline, assertPreflightRecoveryStopped, assertPreflightRecoveryGenerationsStopped,
    readPreflightRecoveryHandoffFields, assertPreflightDiskHeadroom,
    captureLeaseBaseline, verifyLeaseBaseline, assertLeaseStopped, assertLeaseGenerationsStopped, readLeaseHandoffFields,
    installIngress: async (proof, token, options = {}) => ingress.installIngress(proof, token, { ...await privateProbeOptions(), probeControlServices: options.probeControlServices !== false }),
    verifyIngress: async (proof, options = {}) => ingress.verifyIngress(proof, { ...await privateProbeOptions(), probeControlServices: options.probeControlServices !== false }),
    restoreIngress: async (proof) => ingress.restoreIngress(proof, await privateProbeOptions()),
    async readLeaseSnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readLeaseSourceProof: (_request, state) => {
      const recovering = ["inspect-fence-recovery", "recover-fence"].includes(request.action) || state.version === 13;
      return (recovering ? readMaintenanceFenceSourceProof : readMaintenanceLeaseSourceProof)({ targetSha: request.targetSha,
        previousTargetSha: recovering ? "552bfaafea802ee1371329afce0424b096b44453" : request.previousTargetSha });
    },
    readLeaseMigrationProof: (state) => {
      const recovering = ["inspect-fence-recovery", "recover-fence"].includes(request.action) || state.version === 13;
      return (recovering ? validateMaintenanceFenceMigrationProof : validateMaintenanceLeaseMigrationProof)(
        queryDatabase(state.database, recovering ? MAINTENANCE_FENCE_MIGRATION_SQL : MAINTENANCE_LEASE_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
        { targetSha: request.targetSha, previousTargetSha: recovering ? "552bfaafea802ee1371329afce0424b096b44453" : request.previousTargetSha });
    },
    async commitLease(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          !["renew-lease", "recover-fence"].includes(request.action) || ![11, 12, 13].includes(snapshot.state.version) ||
          next.version !== (request.action === "recover-fence" || snapshot.state.version === 13 ? 13 : 12) || next.activeAttempt !== 3 ||
          next.revision !== previous.revision + 1) failure("maintenance_lease_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async readPreflightRecoverySnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readPreflightRecoverySourceProof: () => readMaintenancePreflightRecoverySourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readPreflightRecoveryMigrationProof: (state) => validateMaintenancePreflightRecoveryMigrationProof(
      queryDatabase(state.database, MAINTENANCE_PREFLIGHT_RECOVERY_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
      { targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    async commitPreflightRecovery(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "recover-preflight" || snapshot.state.version !== 10 || next.version !== 11 || next.activeAttempt !== 3 ||
          next.revision !== previous.revision + 1) failure("maintenance_preflight_recovery_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async readPrelaunchRecoverySnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readPrelaunchRecoverySourceProof: () => readMaintenancePrelaunchRecoverySourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readPrelaunchRecoveryMigrationProof: (state) => validateMaintenancePrelaunchRecoveryMigrationProof(
      queryDatabase(state.database, MAINTENANCE_PRELAUNCH_RECOVERY_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
      { targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    async commitPrelaunchRecovery(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "recover-prelaunch" || snapshot.state.version !== 9 || next.version !== 10 || next.activeAttempt !== 3 ||
          next.revision !== previous.revision + 1) failure("maintenance_prelaunch_recovery_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async readWindowRenewalSnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readWindowRenewalSourceProof: () => readMaintenanceWindowRenewalSourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readWindowRenewalMigrationProof: (state) => validateMaintenanceWindowRenewalMigrationProof(
      queryDatabase(state.database, MAINTENANCE_WINDOW_RENEWAL_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
      { targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    async commitWindowRenewal(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "renew-window" || snapshot.state.version !== 8 || next.version !== 9 || next.activeAttempt !== 3 ||
          next.revision !== previous.revision + 1) failure("maintenance_window_renewal_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async readBudgetRecoverySnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readBudgetRecoverySourceProof: () => readMaintenanceBudgetRecoverySourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readBudgetRecoveryMigrationProof: (state) => validateMaintenanceBudgetRecoveryMigrationProof(
      queryDatabase(state.database, MAINTENANCE_BUDGET_RECOVERY_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
      { targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    async commitBudgetRecovery(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "recover-budget" || snapshot.state.version !== 7 || next.version !== 8 || next.revision !== previous.revision + 1) failure("maintenance_budget_recovery_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async readSecondAttemptRecoverySnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readSecondAttemptRecoverySourceProof: () => readMaintenanceSecondAttemptRecoverySourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readSecondAttemptRecoveryMigrationProof: (state) => validateMaintenanceSecondAttemptRecoveryMigrationProof(
      queryDatabase(state.database, MAINTENANCE_SECOND_ATTEMPT_RECOVERY_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
      { targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    async commitSecondAttemptRecovery(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "recover-second-attempt" || snapshot.state.version !== 6 || next.version !== 7 || next.revision !== previous.revision + 1) failure("maintenance_second_attempt_recovery_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async recloseAttemptIngress(state) {
      // Only this already-authorized in-memory invocation can fail closed
      // after its deadline. A new expired command still cannot load state.
      // This capability grants NO save, start, restore, new lease or receipt.
      const baseline = baselines.get(state)?.state;
      if (!baseline || ![6, 7, 8, 9, 10, 11, 12, 13].includes(baseline.version) || state.version !== baseline.version || attemptedReclosures.has(state) ||
          !["start-candidate", "end", "fail-held"].includes(request.action) ||
          ["operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "runtime", "tokenHash", "activeAttempt", "attemptRecovery", "secondAttemptRecovery", "budgetRecovery", "windowRenewal", "prelaunchRecovery", "preflightRecovery", "leaseRenewal", "leaseExtensions", "fenceRecovery"]
            .some(key => !equal(state[key], baseline[key])) || baseline.bootId !== bootId()) failure("maintenance_attempt_reclose_unverified");
      // Consume before any effect. A lost result is never an automatic retry.
      attemptedReclosures.add(state);
      return underExistingOperationLock(request.appName, async () => {
        if (baseline.bootId !== bootId()) failure("maintenance_attempt_reclose_unverified");
        validateProofs(baseline);
        const token = readPrivate(tokenPath, 64);
        if (!/^[0-9a-f]{64}$/.test(token) || digest(token) !== baseline.tokenHash) failure("maintenance_token_identity_invalid");
        const environment = await runtime.readRuntimeHandoffEnvironment(baseline.runtime);
        if (typeof environment.anonKey !== "string" || !environment.anonKey || /[\r\n]/.test(environment.anonKey) ||
            baseline.bootId !== bootId()) failure("maintenance_attempt_reclose_unverified");
        // Do not consult poisonedStates: an uncertain/expired save must never
        // prevent protective closure. Every ordinary write still rejects it.
        const closed = await ingress.installIngress(baseline.ingress, token, { probeControlServices: false,
          probeHeaders: { apikey: environment.anonKey, authorization: `Bearer ${environment.anonKey}` } });
        if (baseline.bootId !== bootId()) failure("maintenance_attempt_reclose_unverified");
        return closed;
      });
    },
    async readAttemptRecoverySnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readAttemptRecoverySourceProof: () => readMaintenanceAttemptRecoverySourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readAttemptRecoveryMigrationProof: (state) => validateMaintenanceAttemptRecoveryMigrationProof(
      queryDatabase(state.database, MAINTENANCE_ATTEMPT_RECOVERY_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
      { targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    async commitAttemptRecovery(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "recover-attempt" || snapshot.state.version !== 5 || next.version !== 6 || next.revision !== previous.revision + 1) failure("maintenance_attempt_recovery_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async readBuildRecoverySnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readBuildRecoverySourceProof: () => readMaintenanceBuildRecoverySourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readBuildRecoveryMigrationProof: (state) => validateMaintenanceBuildRecoveryMigrationProof(
      queryDatabase(state.database, MAINTENANCE_BUILD_RECOVERY_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
      { targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    async commitBuildRecovery(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "recover-build" || snapshot.state.version !== 4 || next.version !== 5 || next.revision !== previous.revision + 1) failure("maintenance_build_recovery_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async readContinuationSnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readContinuationSourceProof: () => readMaintenanceContinuationSourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readContinuationMigrationProof: (state) => validateMaintenanceContinuationMigrationProof(
      queryDatabase(state.database, MAINTENANCE_CONTINUATION_MIGRATION_SQL), state.database.databaseOid, state.createdAt,
      { targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    async commitContinuation(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "continue-held" || snapshot.state.version !== 3 || next.version !== 4 || next.revision !== previous.revision + 1) failure("maintenance_continuation_write_unconfirmed");
      try {
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    async readRecoverySnapshot() {
      const state = await load(), previous = baselines.get(state);
      return { state, revision: previous.revision, digest: previous.digest };
    },
    readRecoverySourceProof: () => readMaintenanceRecoverySourceProof({ targetSha: request.targetSha, previousTargetSha: request.previousTargetSha }),
    readRecoveryMigrationProof: (state) => validateMaintenanceRecoveryMigrationProof(
      queryDatabase(state.database, MAINTENANCE_RECOVERY_MIGRATION_SQL), state.database.databaseOid, state.createdAt),
    async commitRecovery(snapshot, next) {
      const previous = baselines.get(snapshot.state);
      if (!previous || poisonedStates.has(snapshot.state) || snapshot.revision !== previous.revision || snapshot.digest !== previous.digest ||
          request.action !== "recover-held" || next.revision !== previous.revision + 1) failure("maintenance_recovery_write_unconfirmed");
      try {
        // buildMaintenanceRecoveredState already advanced revision exactly once.
        const result = await store.replaceOperationUnderExistingOperationLock({
          expectedRevision: previous.revision, expectedDigest: previous.digest, next });
        poisonedStates.add(snapshot.state); return clone(result.state);
      } catch (error) { poisonedStates.add(snapshot.state); throw error; }
    },
    assertNoActiveOperation() {
      try {
        // This is also called by read-only plan, before any operation lock.
        // Presence alone blocks; it never supplies a mutation CAS baseline.
        secureDirectory(ROOT); secureDirectory(directory);
        const previous = JSON.parse(readPrivate(statePath));
        if (previous.phase !== "ended") failure("maintenance_operation_already_active");
        // Retain completed evidence; never automatically replace it on a new request.
        failure("maintenance_previous_operation_requires_archival");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    },
    async create(state, token) {
      await underExistingOperationLock(request.appName, async () => {
        secureDirectory(ROOT, true); secureDirectory(directory, true);
        if (state.revision !== 0 || state.launchDisk !== null || state.launchJournal !== null) failure("maintenance_state_binding_invalid");
        writePrivate(tokenPath, token);
        writePrivate(statePath, JSON.stringify(state));
        const snapshot = await store.readOperationUnderExistingOperationLock();
        if (!equal(state, snapshot.state)) failure("maintenance_state_write_unconfirmed");
        baselines.set(state, snapshot);
      });
    },
    readToken(state) {
      const token = readPrivate(tokenPath, 64);
      if (!/^[0-9a-f]{64}$/.test(token) || digest(token) !== state.tokenHash) failure("maintenance_token_identity_invalid");
      return token;
    },
    validateProofs,
    readPublicSupabaseUrl: async (proof) => (await runtime.readRuntimeHandoffEnvironment(proof)).publicUrl,
    captureDatabase, assertDatabaseQuiet,
    async waitDatabaseQuiet(proof) {
      const deadline = Date.now() + 30_000;
      let matched = 0;
      while (Date.now() < deadline) {
        try { assertDatabaseQuiet(proof); matched += 1; } catch { matched = 0; }
        if (matched >= 3) return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      failure("maintenance_database_drain_timeout");
    },
    assertClientWritesDenied(proof) {
      const row = queryDatabase(proof, ACL_SQL);
      if (!exact(row, ["migration", "clientsDenied", "serviceWrites"]) || Object.values(row).some((value) => value !== true)) failure("maintenance_client_write_cutover_unverified");
    },
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let request;
  try {
    request = parseMaintenanceRequest(process.argv.slice(2));
    let result;
    if (request.action === "diagnose-runtime") {
      // Deliberately bypass the operation-state/actuator factory and lock:
      // diagnosis only reads existing state and cannot start maintenance.
      result = await createRuntimeDiagnosticReport(request);
    } else if (request.action === "diagnose-pm2-peer") {
      result = await createPm2PeerDiagnosticReport(request);
    } else {
      const ops = await productionOperations(request);
      result = await withPrivateOperationLock(request, () => runMaintenanceAction(request, ops));
    }
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const report = Object.getOwnPropertyDescriptor(error ?? {}, "maintenanceReport")?.value;
    if (request?.action === "prepare" && exact(report, ["version", "operationId", "targetSha", "expectedOldSha", "state"]) &&
        report.version === 1 && UUID.test(report.operationId) && report.targetSha === request.targetSha && report.expectedOldSha === request.expectedOldSha &&
        ["failed-held", "failed-unknown"].includes(report.state)) process.stdout.write(JSON.stringify(report) + "\n");
    const code = /^(?:maintenance_|production_maintenance_(?:runtime_|ingress_))[a-z0-9_]+$/.test(error?.message ?? "") ? error.message : "maintenance_operation_failed";
    process.stderr.write(code + "\n"); process.exitCode = 1;
  }
}
