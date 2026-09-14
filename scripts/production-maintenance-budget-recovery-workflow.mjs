import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateMaintenanceBudgetRecoveryInspection, validateMaintenanceBudgetRecoveryEvidence, encodeMaintenanceBudgetRecoveryEvidence,
  MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION, MAINTENANCE_BUDGET_RECOVERY_HISTORY_MAX_AGE_MS } from "./production-maintenance-budget-recovery.mjs";
import { MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP as ADDITIONAL,
  MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST } from "./production-maintenance-build-recovery.mjs";
import { validateProductionMaintenanceBinding, assertProductionMaintenanceProvenance } from "./production-maintenance-workflow-contract.mjs";
import { canonicalJsonBytes, validateProductionReleaseAttestation } from "./production-release-attestation.mjs";

const REPOSITORY = "fafona/space";
const OLD_TARGET = "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf";
const PREVIOUS_TARGET = "46f007fbd9e417f93c01e398c77cf38ec814547d";
const LAUNCHED_TARGET = "f3104de19aa59e527c7b94a99850d151448da8cd";
const SECOND_LAUNCHED_TARGET = "3af8fa6ba6644593e10bef0a391389b2b34e926a";
const THIRD_LAUNCHED_TARGET = "d9de5fe689226fcdd13a1e95039901b5d0f39167";
const THIRD_RECOVERY_RUN = "34800461043", THIRD_RECOVERY_CI = "34799821827";
const SECOND_RECOVERY_RUN = "34789744074", SECOND_RECOVERY_CI = "34789133814";
const RECOVERY_RUN = "34778424264", RECOVERY_CI = "34777790522";
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]*$/;
const LIMIT = 20;
// Preserve the ORIGINAL operation cutoff. Each later incident is an explicit
// exception, not permission to ignore activity before the latest failed build.
const WORKFLOWS = Object.freeze([
  ["database-backup.yml", "Encrypted Database Backup", "workflow_dispatch",
    [["34715932102", OLD_TARGET, "success"], ["34724943157", PREVIOUS_TARGET, "success"], ["34778579797", LAUNCHED_TARGET, "success"], ["34789894868", SECOND_LAUNCHED_TARGET, "success"], ["34800653808", THIRD_LAUNCHED_TARGET, "success"]]],
  ["database-migrate.yml", "Apply Production Database Migrations", "workflow_dispatch",
    [["34721155156", OLD_TARGET, "success"]]],
  ["ordinary-account-cutover-readiness.yml", "Ordinary Account Cutover Readiness", "workflow_dispatch",
    [["34721256683", OLD_TARGET, "success"], ["34728212357", PREVIOUS_TARGET, "success"], ["34781336277", LAUNCHED_TARGET, "success"], ["34790775352", SECOND_LAUNCHED_TARGET, "success"], ["34802075500", THIRD_LAUNCHED_TARGET, "success"]]],
  ["deploy.yml", "Deploy Production", "workflow_run",
    [["34721317710", OLD_TARGET, "failure"], ["34728263285", PREVIOUS_TARGET, "failure"], ["34781392661", LAUNCHED_TARGET, "failure"], ["34790827235", SECOND_LAUNCHED_TARGET, "failure"], ["34802138869", THIRD_LAUNCHED_TARGET, "failure"]]],
]);
const INCIDENT_ORDER = Object.freeze(["34715932102", "34721155156", "34721256683", "34721317710",
  "34724943157", "34728212357", "34728263285", "34778579797", "34781336277", "34781392661", "34789894868", "34790775352", "34790827235", "34800653808", "34802075500", "34802138869"]);
const LATEST_RUN_TIMES = Object.freeze({"34789894868":["2026-09-13T23:30:29Z","2026-09-13T23:30:29Z","2026-09-13T23:47:14Z"],"34790775352":["2026-09-13T23:48:52Z","2026-09-13T23:48:52Z","2026-09-13T23:49:59Z"],"34790827235":["2026-09-13T23:50:01Z","2026-09-13T23:50:01Z","2026-09-13T23:57:59Z"],"34800653808":["2026-09-14T02:52:25Z","2026-09-14T02:52:25Z","2026-09-14T03:15:43Z"],"34802075500":["2026-09-14T03:16:58Z","2026-09-14T03:16:58Z","2026-09-14T03:18:04Z"],"34802138869":["2026-09-14T03:18:05Z","2026-09-14T03:18:05Z","2026-09-14T03:27:36Z"]});

// These two exactly observed failed runs neither produced a usable backup nor
// executed a maintenance transition. They are history evidence only, not a
// generic exception for schedules/failures. All projected steps are immutable.
// Recorded confirmation time for THIS history exception, not a rewrite of the
// original 07:13:57 budget authorization or an extension of its 10:00 deadline.
export const MAINTENANCE_BUDGET_RECOVERY_FAILED_HISTORY_AUTHORIZATION = Object.freeze({
  version: 1, authorizedAt: Date.parse("2026-09-14T08:24:49.000Z"),
});
export const MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS = Object.freeze([
  { run: Object.freeze({"id":34820083043,"name":"Encrypted Database Backup","path":".github/workflows/database-backup.yml","event":"schedule","head_sha":"78ca8104442172baf046b62f9184cf9c7f6a9279","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"failure","created_at":"2026-09-14T07:55:00Z","run_started_at":"2026-09-14T07:55:00Z","updated_at":"2026-09-14T07:55:16Z"}),
    job: Object.freeze({"id":103899432902,"name":"backup","run_id":34820083043,"head_sha":"78ca8104442172baf046b62f9184cf9c7f6a9279","status":"completed","conclusion":"failure","started_at":"2026-09-14T07:55:02Z","completed_at":"2026-09-14T07:55:15Z"}),
    steps: Object.freeze([
      Object.freeze([1,"Set up job","success","2026-09-14T07:55:03Z","2026-09-14T07:55:04Z"]),
      Object.freeze([2,"Checkout Exact Backup Source","success","2026-09-14T07:55:04Z","2026-09-14T07:55:11Z"]),
      Object.freeze([3,"Verify Current Main And Exact Successful Push CI","failure","2026-09-14T07:55:11Z","2026-09-14T07:55:14Z"]),
      Object.freeze([4,"Setup Pinned SSH Host Trust","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([5,"Prepare Remote Detached Exact Source","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([6,"Verify Held Maintenance Before Backup","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([7,"Verify Backup Configuration From Exact Source","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([8,"Create Encrypted Database Backup From Exact Source","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([9,"Verify Held Maintenance After Backup Capture","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([10,"Transfer Complete Encrypted Backup","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([11,"Verify Encrypted Backup","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([12,"Rehearse Isolated Restore","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([13,"Confirm Backup Is Ready For Upload","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([14,"Upload Verified Encrypted Backup","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([15,"Verify Uploaded Backup Artifact Identity","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([16,"Generate Backup Attestation Predicate","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([17,"Upload Canonical Backup Attestation Input","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([18,"Upload Backup Verification And Attestation Inputs","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([19,"Attest Verified Encrypted Backup","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([20,"Attest Canonical Backup Attestation Input","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([21,"Upload Encrypted Backup Attestation Bundle","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([22,"Upload Canonical Backup Attestation Bundle","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([23,"Verify Held Maintenance Before Backup Attestation","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([24,"Build Canonical Maintenance Binding","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([25,"Upload Canonical Maintenance Binding","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([26,"Attest Canonical Maintenance Binding","skipped","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([27,"Upload Backup Failure Diagnostics","success","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([28,"Remove Temporary Backup And Exact Source","success","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([56,"Post Checkout Exact Backup Source","success","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
      Object.freeze([57,"Complete job","success","2026-09-14T07:55:14Z","2026-09-14T07:55:14Z"]),
    ]),
  },
  { run: Object.freeze({"id":34821029270,"name":"Production Maintenance","path":".github/workflows/production-maintenance.yml","event":"workflow_dispatch","head_sha":"78ca8104442172baf046b62f9184cf9c7f6a9279","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"failure","created_at":"2026-09-14T08:06:34Z","run_started_at":"2026-09-14T08:06:34Z","updated_at":"2026-09-14T08:07:28Z"}),
    job: Object.freeze({"id":103902411547,"name":"maintenance","run_id":34821029270,"head_sha":"78ca8104442172baf046b62f9184cf9c7f6a9279","status":"completed","conclusion":"failure","started_at":"2026-09-14T08:06:38Z","completed_at":"2026-09-14T08:07:28Z"}),
    steps: Object.freeze([
      Object.freeze([1,"Set up job","success","2026-09-14T08:06:39Z","2026-09-14T08:06:39Z"]),
      Object.freeze([2,"Validate Fixed Manual Transition","success","2026-09-14T08:06:39Z","2026-09-14T08:06:39Z"]),
      Object.freeze([3,"Checkout Exact Maintenance Source","success","2026-09-14T08:06:39Z","2026-09-14T08:06:44Z"]),
      Object.freeze([4,"Require Current Main And Exact Successful Push CI","success","2026-09-14T08:06:44Z","2026-09-14T08:06:45Z"]),
      Object.freeze([5,"Require Exact Successful Maintenance Deploy Before End","skipped","2026-09-14T08:06:45Z","2026-09-14T08:06:45Z"]),
      Object.freeze([6,"Verify Signed Deploy Maintenance Binding","skipped","2026-09-14T08:06:45Z","2026-09-14T08:06:45Z"]),
      Object.freeze([7,"Setup Pinned SSH Trust","success","2026-09-14T08:06:45Z","2026-09-14T08:06:45Z"]),
      Object.freeze([8,"Prepare Remote Detached Exact Control Source","success","2026-09-14T08:06:45Z","2026-09-14T08:06:50Z"]),
      Object.freeze([9,"Inspect Original Failed Held Recovery State","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([10,"Verify Complete Recovery History Under Production Lock","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([11,"Inspect Migrated Unlaunched Continuation State","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([12,"Verify Original Signed Backup And Readiness Bindings","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([13,"Verify Exact Continuation History Under Production Lock","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([14,"Inspect Failed Unlaunched Build Recovery State","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([15,"Verify Build Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([16,"Verify Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([17,"Verify Exact Build Recovery History Under Production Lock","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([18,"Verify Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([19,"Verify Attempt Recovery Historical Additional Backup","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([20,"Inspect Stopped Launched Candidate Recovery State","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([21,"Verify Exact Single Attempt Recovery History Under Production Lock","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([22,"Verify Second Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([23,"Verify Second Attempt Recovery Historical Additional Backup","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([24,"Inspect Stopped Second Launched Candidate Recovery State","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([25,"Verify Exact Second Attempt Recovery History Under Production Lock","skipped","2026-09-14T08:06:50Z","2026-09-14T08:06:50Z"]),
      Object.freeze([26,"Verify Budget Incident Signed Backup And Readiness Bindings","success","2026-09-14T08:06:50Z","2026-09-14T08:06:58Z"]),
      Object.freeze([27,"Verify Budget Recovery Historical Additional Backup","success","2026-09-14T08:06:58Z","2026-09-14T08:07:06Z"]),
      Object.freeze([28,"Inspect Stopped Budget Candidate Recovery State","success","2026-09-14T08:07:06Z","2026-09-14T08:07:21Z"]),
      Object.freeze([29,"Verify Exact Budget Recovery History Under Production Lock","failure","2026-09-14T08:07:21Z","2026-09-14T08:07:24Z"]),
      Object.freeze([30,"Execute Fixed Maintenance Transition","skipped","2026-09-14T08:07:24Z","2026-09-14T08:07:24Z"]),
      Object.freeze([31,"Verify Real Public Release After End","skipped","2026-09-14T08:07:24Z","2026-09-14T08:07:24Z"]),
      Object.freeze([32,"Reclose Entry And Fail Held If End Is Unconfirmed","skipped","2026-09-14T08:07:24Z","2026-09-14T08:07:24Z"]),
      Object.freeze([33,"Remove Exact Temporary Control Source","success","2026-09-14T08:07:24Z","2026-09-14T08:07:26Z"]),
      Object.freeze([34,"Remove Runner Recovery Inspection","skipped","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([35,"Remove Runner Continuation Evidence","skipped","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([36,"Remove Runner Build Recovery Evidence","skipped","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([37,"Remove Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([38,"Remove Runner Attempt Recovery Evidence","skipped","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([39,"Remove Runner Second Attempt Recovery Evidence","skipped","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([40,"Remove Runner Budget Recovery Evidence","success","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([41,"Remove Runner SSH Material","success","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([82,"Post Checkout Exact Maintenance Source","success","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
      Object.freeze([83,"Complete job","success","2026-09-14T08:07:26Z","2026-09-14T08:07:26Z"]),
    ]),
  },
].map(Object.freeze));

const fail = () => { throw new Error("maintenance_budget_recovery_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bytesHash = value => createHash("sha256").update(value).digest("hex");
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
// Observed from ONLY these three immutable GitHub ZIP artifacts. Their ZIP
// digests and every extracted byte were checked independently on 2026-09-13.
// No encrypted database payload or encrypted-backup bundle is downloaded here.
export const MAINTENANCE_ADDITIONAL_BACKUP_SMALL_ARTIFACTS = Object.freeze([
  { directory: "binding", id: "10314133495", name: "faolla-maintenance-backup-binding-34745334237-1", bytes: 352, sha256: "85e4c348e1e44fee3f0ccb5c191e39e6b019fb560f551ae7f66a5bc87afed35d" },
  { directory: "predicate", id: "10314103659", name: "faolla-production-backup-attestation-34745334237-1", bytes: 1060, sha256: "4ef9447b0884481e6cfab3c687acb50c5a194fc3d611167e854707c119a71140" },
  { directory: "reports", id: "10313854153", name: "faolla-backup-verification-reports-34745334237-1", bytes: 8147, sha256: "950cb19a5911ffe6d1e84313b394d28316a5045328d782d6a886a3ec30be6140" },
].map(Object.freeze));
const SMALL_FILES = Object.freeze([
  ["binding", "production-maintenance-binding.json", 279, "807630c3212eb95b6e1d00d0c8c27443779cd6b5c31eea1bead76d903f20a985"],
  ["predicate", "production-backup-attestation.json", 1885, "3c78896a3b0c823787f83050bf1ecc51f8c0c853a9772ac9bfa19dc422928508"],
  ["reports", "database-backup-readiness-report.log", 2832, "fbc3052e62e2bdfe64d56dbea7c41c7d2277e403817f0b5389252254b757f67c"],
  ["reports", "database-backup-create-report.log", 3410, "51329bf3a3c6b97f285738440d9e815db2123d72690a1170be16f999a036bba5"],
  ["reports", "database-backup-transfer-report.log", 231, "400af95f9769534d657fa1f6a3cbafbf70481ae2cf768f4153bec1993d726e7c"],
  ["reports", "database-backup-verify-report.log", 3529, "b55ec288cb4dab6635ca92d235daa61fdcfc089795dfa0d32ce6009d1bbed8a0"],
  ["reports", "database-backup-restore-report.log", 4509, "5c8710604fc9e045684b96ff5a658c92f215ac903410d964c87f83f365ac2ca2"],
  ["reports", "database-backup-subject.json", 4371, "0add6174f548f7059ca34beeacb73dfb65153c67999b0ce9a350c9cd0f40fd4a"],
]);
const id = value => Number.isSafeInteger(value) && value > 0 ? String(value) : fail();
// The extension authorizes this exact new grant only. Actual request/history
// time is never replaced with the historical clock used to validate old audits.
function checkWorkflowClock(now) {
  if (!Number.isSafeInteger(now) || now < MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION.authorizedAt ||
      now >= MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION.expiresAt || now < ADDITIONAL.authorizedAt ||
      now < MAINTENANCE_BUDGET_RECOVERY_FAILED_HISTORY_AUTHORIZATION.authorizedAt) fail();
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) fail();
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || new Date(result).toISOString() !== value.slice(0, -1) + ".000Z") fail();
  return result;
}

function assertAdditionalProvenance(results, bytes, name, spec = ADDITIONAL) {
  if (!Array.isArray(results) || results.length !== 1) fail();
  const statement = results[0]?.verificationResult?.statement, predicate = statement?.predicate;
  if (statement?._type !== "https://in-toto.io/Statement/v1" || statement.predicateType !== "https://slsa.dev/provenance/v1" ||
      !Array.isArray(statement.subject) || statement.subject.length !== 1 || statement.subject[0].name !== name ||
      !exact(statement.subject[0].digest, ["sha256"]) || statement.subject[0].digest.sha256 !== bytesHash(bytes) ||
      predicate?.buildDefinition?.buildType !== "https://actions.github.io/buildtypes/workflow/v1" ||
      hash(predicate.buildDefinition.externalParameters?.workflow) !== hash({ path: spec.workflowPath, ref: "refs/heads/main", repository: "https://github.com/fafona/space" }) ||
      predicate.buildDefinition.internalParameters?.github?.event_name !== spec.event ||
      predicate.buildDefinition.internalParameters.github.runner_environment !== "github-hosted" ||
      !Array.isArray(predicate.buildDefinition.resolvedDependencies) || predicate.buildDefinition.resolvedDependencies.length !== 1 ||
      predicate.buildDefinition.resolvedDependencies[0].uri !== "git+https://github.com/fafona/space@refs/heads/main" ||
      !exact(predicate.buildDefinition.resolvedDependencies[0].digest, ["gitCommit"]) ||
      predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit !== spec.sourceSha ||
      predicate.runDetails?.builder?.id !== `https://github.com/fafona/space/${spec.workflowPath}@refs/heads/main` ||
      predicate.runDetails.metadata?.invocationId !== `https://github.com/fafona/space/actions/runs/${spec.runId}/attempts/1`) fail();
}

/** Cryptographic signature verification is performed by the fixed gh command;
 * this parser binds its result, reports and off-mode subject to THIS exception.
 * The production loader additionally checks all eight hard-pinned file hashes.
 * This backup never replaces the original maintenance B7/R7 subjects. */
export function validateMaintenanceBudgetRecoveryAdditionalBackup(records, now) {
  checkWorkflowClock(now);
  if (!exact(records, ["binding", "predicate", "reports"]) || !exact(records.reports, ["readiness", "create", "transfer", "verify", "restore", "subject"])) fail();
  for (const key of ["binding", "predicate"]) {
    if (!exact(records[key], ["bytes", "provenance"]) || !Buffer.isBuffer(records[key].bytes) || records[key].bytes.length < 1 || records[key].bytes.length > 16384) fail();
    assertAdditionalProvenance(records[key].provenance, records[key].bytes, key === "binding" ? "production-maintenance-binding.json" : "production-backup-attestation.json");
  }
  const binding = validateProductionMaintenanceBinding(JSON.parse(records.binding.bytes), { phase: "backup", mode: "off", targetSha: ADDITIONAL.sourceSha,
    expectedOldSha: null, operationId: null, runId: ADDITIONAL.runId, runAttempt: "1", backupRunId: ADDITIONAL.runId, backupRunAttempt: "1", readinessRunId: null, readinessRunAttempt: null });
  if (!records.binding.bytes.equals(canonicalJsonBytes(binding))) fail();
  // Only this hash-pinned, independently signed historical exception is audited
  // at its real fixed run completion. It is NOT usable as a current backup.
  // The current authorization above and all fresh B/R/D validators keep now.
  const historicalValidationAt = timestamp(ADDITIONAL.updatedAt);
  const historicalPredicate = JSON.parse(records.predicate.bytes), historicalIssuedAt = Date.parse(historicalPredicate?.issuedAt);
  if (!Number.isSafeInteger(historicalIssuedAt) || historicalIssuedAt > historicalValidationAt) fail();
  const parsed = validateProductionReleaseAttestation(historicalPredicate, { nowMs: historicalValidationAt, expectedKind: "backup", expectedRepository: REPOSITORY,
    expectedTargetSha: ADDITIONAL.sourceSha, expectedRunId: ADDITIONAL.runId, expectedRunAttempt: "1" });
  if (!parsed.valid || !records.predicate.bytes.equals(parsed.canonicalBytes) || parsed.attestation.run.event !== "schedule") fail();
  const values = {}, reportDigests = {};
  for (const [key, bytes] of Object.entries(records.reports)) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 65536) fail();
    reportDigests[key] = { bytes: bytes.length, sha256: bytesHash(bytes) };
    if (key !== "transfer") values[key] = JSON.parse(key === "subject" ? bytes.toString("utf8") : bytes.toString("utf8").trim().split(/\r?\n/).at(-1));
  }
  const { subject, readiness, create, verify, restore } = values, predicate = parsed.attestation;
  if (!subject || subject.schemaVersion !== 1 || hash(subject.backupWorkflow) !== hash({ repository: REPOSITORY, runId: ADDITIONAL.runId, runAttempt: "1", event: "schedule" }) ||
      subject.source?.sha !== ADDITIONAL.sourceSha || subject.source.repository !== REPOSITORY || subject.source.originMainSha !== ADDITIONAL.sourceSha ||
      subject.source.detached !== true || subject.source.treeState !== "clean" || subject.source.stability?.source !== "matched_before_after" || subject.source.stability?.database !== "matched_before_after" ||
      !exact(subject.reports, ["readiness", "create", "transfer", "verify", "restore"]) ||
      ["readiness", "create", "transfer", "verify", "restore"].some(key => hash(subject.reports[key]) !== hash(reportDigests[key])) ||
      subject.subject?.digest !== "sha256:" + predicate.backupArtifact.file.sha256 || String(subject.subject.bytes) !== predicate.backupArtifact.file.sizeBytes ||
      readiness.backupReady !== true || readiness.recoveryRehearsalReady !== true || !Array.isArray(readiness.blockers) || readiness.blockers.length ||
      !Array.isArray(readiness.recoveryBlockers) || readiness.recoveryBlockers.length || create.schemaVersion !== 2 || create.status !== "created" ||
      create.outputBytes !== subject.subject.bytes || create.outputSha256 !== predicate.backupArtifact.file.sha256 ||
      verify.schemaVersion !== 2 || verify.status !== "verified" || verify.inputBytes !== subject.subject.bytes ||
      restore.schemaVersion !== 2 || restore.status !== "restored" || restore.backupStatus !== "verified" || restore.inputBytes !== subject.subject.bytes ||
      restore.isolation !== "ephemeral_docker_no_network" || restore.recoveryContentStatus !== "verified" ||
      [create, verify, restore].some(value => !value.source || !canonicalJsonBytes(Object.fromEntries(Object.keys(subject.source).map(key => [key, value.source[key]]))).equals(canonicalJsonBytes(subject.source))) ||
      !canonicalJsonBytes(create.source).equals(canonicalJsonBytes(verify.source)) || !canonicalJsonBytes(create.source).equals(canonicalJsonBytes(restore.source)) ||
      hash(restore.restoredRecoveryContent) !== hash(subject.source.database?.recoveryContent) ||
      hash(restore.restoredBaseline) !== hash(subject.source.database?.baseline)) fail();
  return { specDigest: MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST, validationPurpose: "historical-only", historicalValidationAt, bindingDigest: bytesHash(records.binding.bytes),
    predicateDigest: bytesHash(records.predicate.bytes), reports: reportDigests, provenanceDigest: hash([records.binding.provenance, records.predicate.provenance]) };
}

export function readMaintenanceBudgetRecoveryAdditionalBackup(directory) {
  const rootStat = lstatSync(directory); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail();
  const read = (file, maximum) => { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) fail();
    const bytes = readFileSync(file); if (bytes.length !== stat.size) fail(); return bytes; };
  const files = new Map();
  for (const [sub, name, size, sha] of SMALL_FILES) { const bytes = read(join(directory, sub, name), 65536);
    if (bytes.length !== size || bytesHash(bytes) !== sha) fail(); files.set(name, bytes); }
  for (const sub of ["binding", "predicate", "reports"]) {
    const stat = lstatSync(join(directory, sub)); if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    const expected = SMALL_FILES.filter(row => row[0] === sub).map(row => row[1]).concat(sub === "reports" ? [] : ["provenance.json"]);
    if (hash(readdirSync(join(directory, sub)).sort()) !== hash(expected.sort())) fail();
  }
  return { binding: { bytes: files.get("production-maintenance-binding.json"), provenance: JSON.parse(read(join(directory, "binding", "provenance.json"), 1048576)) },
    predicate: { bytes: files.get("production-backup-attestation.json"), provenance: JSON.parse(read(join(directory, "predicate", "provenance.json"), 1048576)) },
    reports: Object.fromEntries(["readiness", "create", "transfer", "verify", "restore", "subject"].map(key => [key, files.get(key === "subject" ? "database-backup-subject.json" : `database-backup-${key}-report.log`)])) };
}

/** These bytes must also be verified cryptographically by gh attestation verify
 * using the fixed old workflow, source SHA/ref and hosted-runner restriction.
 * This function binds the verified subjects to the original operation and the fixed T7 backup/readiness runs;
 * it never relabels old backup/readiness evidence for the new target.
 */
export function validateMaintenanceBudgetRecoveryPriorBindings(inspection, records) {
  const checked = validateMaintenanceBudgetRecoveryInspection(inspection);
  if (!records || Object.keys(records).sort().join(",") !== "backup,readiness") fail();
  const result = {};
  for (const phase of ["backup", "readiness"]) {
    const record = records[phase];
    if (!record || Object.keys(record).sort().join(",") !== "bytes,provenance" || !Buffer.isBuffer(record.bytes) ||
        record.bytes.length < 1 || record.bytes.length > 4096) fail();
    const runId = phase === "backup" ? checked.backupRunId : checked.readinessRunId;
    const expected = { phase, mode: "maintenance", targetSha: checked.previousTargetSha, expectedOldSha: checked.expectedOldSha,
      operationId: checked.operationId, runId, runAttempt: "1", backupRunId: checked.backupRunId, backupRunAttempt: "1",
      readinessRunId: phase === "backup" ? null : checked.readinessRunId, readinessRunAttempt: phase === "backup" ? null : "1" };
    const binding = validateProductionMaintenanceBinding(JSON.parse(record.bytes.toString("utf8")), expected);
    if (!record.bytes.equals(canonicalJsonBytes(binding))) fail();
    assertProductionMaintenanceProvenance(record.provenance, record.bytes);
    assertAdditionalProvenance(record.provenance, record.bytes, "production-maintenance-binding.json", {
      workflowPath: phase === "backup" ? ".github/workflows/database-backup.yml" : ".github/workflows/ordinary-account-cutover-readiness.yml",
      sourceSha: THIRD_LAUNCHED_TARGET, event: "workflow_dispatch", runId,
    });
    result[phase] = { binding, subjectDigest: createHash("sha256").update(record.bytes).digest("hex"), provenanceDigest: hash(record.provenance) };
  }
  return result;
}


function fixedFailedRunProjection(value, spec, now) {
  if (!value || value.repository?.full_name !== REPOSITORY || value.head_repository?.full_name !== REPOSITORY) fail();
  const projected = Object.fromEntries(Object.keys(spec.run).map(key => [key, value[key]]));
  if (hash(projected) !== hash(spec.run) || timestamp(projected.updated_at) > now) fail();
  return projected;
}
async function inspectFixedFailedRun(spec, api, now, listedRun = null) {
  const prefix = `repos/${REPOSITORY}/actions/runs/${spec.run.id}`;
  const run = fixedFailedRunProjection(await api(prefix), spec, now);
  if (listedRun && hash(fixedFailedRunProjection(listedRun, spec, now)) !== hash(run)) fail();
  const response = await api(prefix + "/attempts/1/jobs?per_page=100");
  if (response?.total_count !== 1 || !Array.isArray(response.jobs) || response.jobs.length !== 1) fail();
  const actual = response.jobs[0], job = Object.fromEntries(Object.keys(spec.job).map(key => [key, actual?.[key]]));
  if (hash(job) !== hash(spec.job) || !Array.isArray(actual.steps) || actual.steps.length !== spec.steps.length ||
      actual.steps.some(step => step.status !== "completed")) fail();
  const steps = actual.steps.map(step => [step.number, step.name, step.conclusion, step.started_at, step.completed_at]);
  if (hash(steps) !== hash(spec.steps)) fail();
  const artifacts = await api(prefix + "/artifacts?per_page=100");
  if (artifacts?.total_count !== 0 || !Array.isArray(artifacts.artifacts) || artifacts.artifacts.length !== 0) fail();
  return { run, job: { ...job, steps }, artifacts: { total_count: 0, artifacts: [] } };
}

async function inspectIncidentJob(file, run, api) {
  const response = await api(`repos/${REPOSITORY}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`);
  if (response?.total_count !== 1 || !Array.isArray(response.jobs) || response.jobs.length !== 1) fail();
  const job = response.jobs[0];
  if (job.run_id !== run.id || job.head_sha !== run.head_sha || job.status !== "completed" || job.conclusion !== run.conclusion ||
      !Array.isArray(job.steps) || job.steps.length < 1 || job.steps.length > 100 || new Set(job.steps.map(step => step.name)).size !== job.steps.length) fail();
  const started = timestamp(job.started_at), completed = timestamp(job.completed_at);
  if (started < timestamp(run.run_started_at) || completed < started || completed > timestamp(run.updated_at)) fail();
  if (String(run.id) === "34790827235") {
    const step = job.steps.find(value => value.name === "Deploy To Server");
    if (id(job.id) !== "103814590377" || job.started_at !== "2026-09-13T23:50:04Z" || job.completed_at !== "2026-09-13T23:57:58Z" ||
        step?.started_at !== "2026-09-13T23:50:26Z" || step.completed_at !== "2026-09-13T23:57:57Z") fail();
  }
  if (String(run.id) === "34802138869") {
    const step = job.steps.find(value => value.name === "Deploy To Server");
    if (id(job.id) !== "103846763201" || job.started_at !== "2026-09-14T03:18:09Z" || job.completed_at !== "2026-09-14T03:27:35Z" ||
        step?.started_at !== "2026-09-14T03:18:30Z" || step.completed_at !== "2026-09-14T03:27:33Z") fail();
  }
  const additional = String(run.id) === ADDITIONAL.runId;
  if (additional && (id(job.id) !== ADDITIONAL.jobId || job.started_at !== ADDITIONAL.jobStartedAt || job.completed_at !== ADDITIONAL.jobCompletedAt)) fail();
  const required = additional ? ["Verify Current Main And Exact Successful Push CI", "Create Encrypted Database Backup From Exact Source", "Transfer Complete Encrypted Backup",
    "Verify Backup Configuration From Exact Source", "Generate Backup Attestation Predicate", "Upload Canonical Backup Attestation Input",
    "Verify Encrypted Backup", "Rehearse Isolated Restore", "Confirm Backup Is Ready For Upload", "Verify Uploaded Backup Artifact Identity",
    "Attest Verified Encrypted Backup", "Attest Canonical Backup Attestation Input", "Upload Backup Verification And Attestation Inputs",
    "Build Canonical Maintenance Binding", "Upload Canonical Maintenance Binding", "Attest Canonical Maintenance Binding", "Remove Temporary Backup And Exact Source"] : {
    "database-backup.yml": ["Verify Held Maintenance Before Backup", "Verify Encrypted Backup", "Rehearse Isolated Restore", "Attest Canonical Maintenance Binding", "Verify Held Maintenance Before Backup Attestation"],
    "database-migrate.yml": ["Verify Recursive Backup Attestation Chain", "Verify Signed Backup Maintenance Binding", "Verify Held Maintenance Before Migration", "Revalidate Evidence And Apply Exact Through", "Verify Held Maintenance After Migration"],
    "ordinary-account-cutover-readiness.yml": ["Verify Signed Backup Maintenance Binding", "Inspect Locked Production Readiness From Exact Source", "Enforce Ready Cutover State", "Verify Held Maintenance After Readiness", "Attest Canonical Maintenance Binding", "Confirm Exact Successful Readiness Artifact Inventory"],
    "deploy.yml": ["Validate Readiness Workflow Run", "Verify Readiness Evidence", "Revalidate Live Recursive Backup Evidence", "Verify Signed Readiness Maintenance Binding", "Export Verified Maintenance Binding", "Setup SSH"],
  }[file];
  for (const name of required) if (job.steps.find(step => step.name === name)?.conclusion !== "success") fail();
  if (additional) for (const name of ["Verify Held Maintenance Before Backup", "Verify Held Maintenance After Backup Capture", "Verify Held Maintenance Before Backup Attestation"])
    if (job.steps.find(step => step.name === name)?.conclusion !== "skipped") fail();
  const failures = job.steps.filter(step => step.conclusion === "failure");
  if (file === "deploy.yml") {
    if (failures.length !== 1 || failures[0].name !== "Deploy To Server") fail();
    for (const name of ["Verify Public Release", "Verify Candidate While Public Entry Remains Held", "Build Canonical Maintenance Binding", "Upload Canonical Maintenance Binding", "Attest Canonical Maintenance Binding"])
      if (job.steps.find(step => step.name === name)?.conclusion !== "skipped") fail();
  } else if (failures.length !== 0) fail();
  for (const step of job.steps) {
    if (step.status !== "completed" || !["success", "skipped", "failure"].includes(step.conclusion)) fail();
    if (step.conclusion !== "skipped") {
      const start = timestamp(step.started_at), end = timestamp(step.completed_at);
      if (start < started || end < start || end > completed) fail();
    }
  }
  if (file === "database-migrate.yml") {
    const apply = job.steps.find(step => step.name === "Revalidate Evidence And Apply Exact Through");
    if (apply.started_at !== "2026-09-12T21:52:38Z" || apply.completed_at !== "2026-09-12T21:52:45Z") fail();
  }
  return { id: id(job.id), started, completed, steps: job.steps };
}

export async function inspectMaintenanceBudgetRecoveryHistory(inspection, api, now) {
  const checked = validateMaintenanceBudgetRecoveryInspection(inspection);
  checkWorkflowClock(now);
  if (typeof api !== "function") fail();
  const cutoff = Math.floor(checked.createdAt / 1000) * 1000;
  const all = [], incidents = []; let additionalBackup = null, failedScheduledBackup = null;
  for (const [file, name, event, allowed] of WORKFLOWS) {
    const seen = new Set(); let ended = false; let total = null; const found = new Map();
    for (let page = 1; page <= LIMIT; page++) {
      const response = await api(`repos/${REPOSITORY}/actions/workflows/${file}/runs?per_page=100&page=${page}`);
      if (!response || !Number.isSafeInteger(response.total_count) || response.total_count < 0 || response.total_count > LIMIT * 100 ||
          !Array.isArray(response.workflow_runs) || response.workflow_runs.length > 100) fail();
      if (total === null) total = response.total_count;
      if (response.total_count !== total) fail();
      for (const run of response.workflow_runs) {
        if (!run || run.name !== name || run.path !== `.github/workflows/${file}` || run.repository?.full_name !== REPOSITORY ||
            run.head_repository?.full_name !== REPOSITORY || !SHA.test(run.head_sha ?? "") || run.head_branch !== "main") fail();
        const runId = id(run.id), attempt = id(run.run_attempt);
        if (seen.has(runId)) fail(); seen.add(runId);
        const created = timestamp(run.created_at), updated = timestamp(run.updated_at);
        const started = run.run_started_at === null ? created : timestamp(run.run_started_at);
        if (created > updated || started < created || started > updated || updated > now || run.status !== "completed" ||
            !["success", "failure", "cancelled", "skipped", "timed_out", "neutral", "action_required", "stale", "startup_failure"].includes(run.conclusion)) fail();
        const allowedRun = allowed.find(([expectedId]) => expectedId === runId);
        if (allowedRun) {
          const times = LATEST_RUN_TIMES[runId];
          if (times && (run.created_at !== times[0] || run.run_started_at !== times[1] || run.updated_at !== times[2])) fail();
          if (attempt !== "1" || run.head_sha !== allowedRun[1] || run.event !== event ||
              run.conclusion !== allowedRun[2] || created <= checked.createdAt) fail();
          found.set(runId, { ...run, created, updated, started, job: await inspectIncidentJob(file, run, api) });
        } else if (file === "database-backup.yml" && runId === String(MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS[0].run.id)) {
          if (failedScheduledBackup) fail();
          failedScheduledBackup = await inspectFixedFailedRun(MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS[0], api, now, run);
        } else if (file === "database-backup.yml" && runId === ADDITIONAL.runId) {
          if (additionalBackup || attempt !== "1" || run.head_sha !== ADDITIONAL.sourceSha || run.event !== ADDITIONAL.event || run.conclusion !== "success" ||
              run.created_at !== ADDITIONAL.createdAt || run.run_started_at !== ADDITIONAL.runStartedAt || run.updated_at !== ADDITIONAL.updatedAt) fail();
          additionalBackup = { id: runId, sha: run.head_sha, event: run.event, attempt, created, started, updated, job: await inspectIncidentJob(file, run, api) };
        } else if (Math.max(created, started, updated) >= cutoff) fail();
        all.push({ workflow: file, id: runId, attempt, created, started, updated, sha: run.head_sha, conclusion: run.conclusion });
      }
      if (response.workflow_runs.length < 100) { if (seen.size !== total) fail(); ended = true; break; }
    }
    if (!ended || found.size !== allowed.length) fail();
    for (const [expectedId] of allowed) {
      const incident = found.get(expectedId); if (!incident) fail();
      incidents.push({ workflow: file, id: expectedId, created: incident.created, updated: incident.updated, job: incident.job });
    }
  }
  incidents.sort((a, b) => INCIDENT_ORDER.indexOf(a.id) - INCIDENT_ORDER.indexOf(b.id));
  if (incidents.length !== INCIDENT_ORDER.length || incidents.some((incident, index) => incident.id !== INCIDENT_ORDER[index])) fail();
  for (let index = 1; index < incidents.length; index++) if (incidents[index].created < incidents[index - 1].updated) fail();
  all.sort((a, b) => a.workflow.localeCompare(b.workflow) || Number(a.id) - Number(b.id));
  if (!additionalBackup || additionalBackup.created < incidents[6].updated || additionalBackup.updated > incidents[7].created) fail();
  if (!failedScheduledBackup) fail();
  const failedBudgetRecovery = await inspectFixedFailedRun(MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS[1], api, now);
  // Both observations remain exact and fresh; a retry, new artifact, changed
  // conclusion, missing/extra step or any transition/remote work cannot pass.
  if (hash(await inspectFixedFailedRun(MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS[0], api, now)) !== hash(failedScheduledBackup) ||
      hash(await inspectFixedFailedRun(MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS[1], api, now)) !== hash(failedBudgetRecovery)) fail();
  return { all, incidents, additionalBackup, failedHistoryAuthorization: MAINTENANCE_BUDGET_RECOVERY_FAILED_HISTORY_AUTHORIZATION,
    failedScheduledBackup, failedBudgetRecovery };
}

// This is the prior successful CAS, not authority to replay it. Re-read its
// actual run/job and exact original main CI alongside the complete B/M/R/D history.
async function inspectPriorRecovery(api, now) {
  const readRun = async (runId, name, file, event) => {
    const run = await api(`repos/${REPOSITORY}/actions/runs/${runId}`);
    if (!run || id(run.id) !== runId || run.run_attempt !== 1 || run.name !== name || run.path !== `.github/workflows/${file}` ||
        run.event !== event || run.head_sha !== LAUNCHED_TARGET || run.head_branch !== "main" ||
        run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY ||
        run.status !== "completed" || run.conclusion !== "success") fail();
    const created = timestamp(run.created_at), started = timestamp(run.run_started_at), completed = timestamp(run.updated_at);
    if (created > started || started > completed || completed > now) fail();
    return { run, created, started, completed };
  };
  const recovery = await readRun(RECOVERY_RUN, "Production Maintenance", "production-maintenance.yml", "workflow_dispatch");
  if (recovery.run.created_at !== "2026-09-13T19:40:42Z" || recovery.run.updated_at !== "2026-09-13T19:42:59Z") fail();
  const response = await api(`repos/${REPOSITORY}/actions/runs/${RECOVERY_RUN}/attempts/1/jobs?per_page=100`);
  if (response?.total_count !== 1 || !Array.isArray(response.jobs) || response.jobs.length !== 1) fail();
  const job = response.jobs[0];
  if (id(job.id) !== "103780842827" || job.run_id !== Number(RECOVERY_RUN) || job.head_sha !== LAUNCHED_TARGET ||
      job.started_at !== "2026-09-13T19:40:46Z" || job.completed_at !== "2026-09-13T19:42:58Z" ||
      job.status !== "completed" || job.conclusion !== "success" || !Array.isArray(job.steps) || job.steps.length > 100 ||
      new Set(job.steps.map(step => step.name)).size !== job.steps.length) fail();
  const required = ["Validate Fixed Manual Transition", "Checkout Exact Maintenance Source", "Require Current Main And Exact Successful Push CI",
    "Setup Pinned SSH Trust", "Prepare Remote Detached Exact Control Source", "Inspect Failed Unlaunched Build Recovery State",
    "Verify Build Incident Signed Backup And Readiness Bindings", "Verify Fixed Additional Scheduled Backup Evidence",
    "Verify Exact Build Recovery History Under Production Lock", "Execute Fixed Maintenance Transition", "Remove Exact Temporary Control Source",
    "Remove Runner Build Recovery Evidence", "Remove Fixed Additional Scheduled Backup Evidence", "Remove Runner SSH Material"];
  const skipped = ["Require Exact Successful Maintenance Deploy Before End", "Verify Signed Deploy Maintenance Binding",
    "Inspect Original Failed Held Recovery State", "Verify Complete Recovery History Under Production Lock",
    "Inspect Migrated Unlaunched Continuation State", "Verify Original Signed Backup And Readiness Bindings",
    "Verify Exact Continuation History Under Production Lock", "Verify Real Public Release After End", "Reclose Entry And Fail Held If End Is Unconfirmed"];
  for (const name of required) if (job.steps.find(step => step.name === name)?.conclusion !== "success") fail();
  for (const name of skipped) if (job.steps.find(step => step.name === name)?.conclusion !== "skipped") fail();
  for (const step of job.steps) {
    if (step.status !== "completed" || !["success", "skipped"].includes(step.conclusion)) fail();
    if (step.conclusion === "success" && (timestamp(step.started_at) < timestamp(job.started_at) ||
        timestamp(step.completed_at) < timestamp(step.started_at) || timestamp(step.completed_at) > timestamp(job.completed_at))) fail();
  }
  const ci = await readRun(RECOVERY_CI, "CI", "ci.yml", "push");
  if (ci.completed > recovery.created) fail();
  const jobs = await api(`repos/${REPOSITORY}/actions/runs/${RECOVERY_CI}/attempts/1/jobs?per_page=100`);
  if (jobs?.total_count !== 10 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 10 ||
      new Set(jobs.jobs.map(value => id(value.id))).size !== 10 || new Set(jobs.jobs.map(value => value.name)).size !== 10 ||
      jobs.jobs.some(value => value.run_id !== Number(RECOVERY_CI) || value.head_sha !== LAUNCHED_TARGET ||
        value.status !== "completed" || value.conclusion !== "success" || timestamp(value.started_at) < ci.started ||
        timestamp(value.completed_at) < timestamp(value.started_at) || timestamp(value.completed_at) > ci.completed)) fail();
  return { runId: RECOVERY_RUN, created: recovery.created, started: recovery.started, completed: recovery.completed,
    run: recovery.run, job, ci: { run: ci.run, jobs: jobs.jobs } };
}

async function inspectPriorAttemptRecovery(api, now) {
  const readRun = async (runId, name, file, event) => {
    const run = await api(`repos/${REPOSITORY}/actions/runs/${runId}`);
    if (!run || id(run.id) !== runId || run.run_attempt !== 1 || run.name !== name || run.path !== `.github/workflows/${file}` ||
        run.event !== event || run.head_sha !== SECOND_LAUNCHED_TARGET || run.head_branch !== "main" ||
        run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY ||
        run.status !== "completed" || run.conclusion !== "success") fail();
    const created = timestamp(run.created_at), started = timestamp(run.run_started_at), completed = timestamp(run.updated_at);
    if (created > started || started > completed || completed > now) fail();
    return { run, created, started, completed };
  };
  const recovery = await readRun(SECOND_RECOVERY_RUN, "Production Maintenance", "production-maintenance.yml", "workflow_dispatch");
  if (recovery.run.created_at !== "2026-09-13T23:27:15Z" || recovery.run.updated_at !== "2026-09-13T23:29:37Z") fail();
  const response = await api(`repos/${REPOSITORY}/actions/runs/${SECOND_RECOVERY_RUN}/attempts/1/jobs?per_page=100`);
  if (response?.total_count !== 1 || !Array.isArray(response.jobs) || response.jobs.length !== 1) fail();
  const job = response.jobs[0];
  if (id(job.id) !== "103811645002" || job.run_id !== Number(SECOND_RECOVERY_RUN) || job.head_sha !== SECOND_LAUNCHED_TARGET ||
      job.started_at !== "2026-09-13T23:27:20Z" || job.completed_at !== "2026-09-13T23:29:36Z" ||
      job.status !== "completed" || job.conclusion !== "success" || !Array.isArray(job.steps) || job.steps.length > 100 ||
      new Set(job.steps.map(step => step.name)).size !== job.steps.length) fail();
  const required = ["Validate Fixed Manual Transition","Checkout Exact Maintenance Source","Require Current Main And Exact Successful Push CI","Setup Pinned SSH Trust","Prepare Remote Detached Exact Control Source","Verify Launched Incident Signed Backup And Readiness Bindings","Verify Attempt Recovery Historical Additional Backup","Inspect Stopped Launched Candidate Recovery State","Verify Exact Single Attempt Recovery History Under Production Lock","Execute Fixed Maintenance Transition","Remove Exact Temporary Control Source","Remove Runner Attempt Recovery Evidence","Remove Runner SSH Material"];
  const skipped = ["Require Exact Successful Maintenance Deploy Before End","Verify Signed Deploy Maintenance Binding","Inspect Original Failed Held Recovery State","Verify Complete Recovery History Under Production Lock","Inspect Migrated Unlaunched Continuation State","Verify Original Signed Backup And Readiness Bindings","Verify Exact Continuation History Under Production Lock","Inspect Failed Unlaunched Build Recovery State","Verify Build Incident Signed Backup And Readiness Bindings","Verify Fixed Additional Scheduled Backup Evidence","Verify Exact Build Recovery History Under Production Lock","Verify Real Public Release After End","Reclose Entry And Fail Held If End Is Unconfirmed","Remove Runner Recovery Inspection","Remove Runner Continuation Evidence","Remove Runner Build Recovery Evidence","Remove Fixed Additional Scheduled Backup Evidence"];
  for (const name of required) if (job.steps.find(step => step.name === name)?.conclusion !== "success") fail();
  for (const name of skipped) if (job.steps.find(step => step.name === name)?.conclusion !== "skipped") fail();
  for (const step of job.steps) {
    if (step.status !== "completed" || !["success", "skipped"].includes(step.conclusion)) fail();
    if (step.conclusion === "success" && (timestamp(step.started_at) < timestamp(job.started_at) ||
        timestamp(step.completed_at) < timestamp(step.started_at) || timestamp(step.completed_at) > timestamp(job.completed_at))) fail();
  }
  const ci = await readRun(SECOND_RECOVERY_CI, "CI", "ci.yml", "push");
  if (ci.completed > recovery.created) fail();
  const jobs = await api(`repos/${REPOSITORY}/actions/runs/${SECOND_RECOVERY_CI}/attempts/1/jobs?per_page=100`);
  if (jobs?.total_count !== 10 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 10 ||
      new Set(jobs.jobs.map(value => id(value.id))).size !== 10 || new Set(jobs.jobs.map(value => value.name)).size !== 10 ||
      jobs.jobs.some(value => value.run_id !== Number(SECOND_RECOVERY_CI) || value.head_sha !== SECOND_LAUNCHED_TARGET ||
        value.status !== "completed" || value.conclusion !== "success" || timestamp(value.started_at) < ci.started ||
        timestamp(value.completed_at) < timestamp(value.started_at) || timestamp(value.completed_at) > ci.completed)) fail();
  return { runId: SECOND_RECOVERY_RUN, created: recovery.created, started: recovery.started, completed: recovery.completed,
    run: recovery.run, job, ci: { run: ci.run, jobs: jobs.jobs } };
}


async function inspectPriorSecondAttemptRecovery(api, now) {
  const readRun = async (runId, name, file, event) => {
    const run = await api(`repos/${REPOSITORY}/actions/runs/${runId}`);
    if (!run || id(run.id) !== runId || run.run_attempt !== 1 || run.name !== name || run.path !== `.github/workflows/${file}` ||
        run.event !== event || run.head_sha !== THIRD_LAUNCHED_TARGET || run.head_branch !== "main" ||
        run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY ||
        run.status !== "completed" || run.conclusion !== "success") fail();
    const created = timestamp(run.created_at), started = timestamp(run.run_started_at), completed = timestamp(run.updated_at);
    if (created > started || started > completed || completed > now) fail();
    return { run, created, started, completed };
  };
  const recovery = await readRun(THIRD_RECOVERY_RUN, "Production Maintenance", "production-maintenance.yml", "workflow_dispatch");
  if (recovery.run.created_at !== "2026-09-14T02:48:54Z" || recovery.run.updated_at !== "2026-09-14T02:51:21Z") fail();
  const response = await api(`repos/${REPOSITORY}/actions/runs/${THIRD_RECOVERY_RUN}/attempts/1/jobs?per_page=100`);
  if (response?.total_count !== 1 || !Array.isArray(response.jobs) || response.jobs.length !== 1) fail();
  const job = response.jobs[0];
  if (id(job.id) !== "103841938845" || job.run_id !== Number(THIRD_RECOVERY_RUN) || job.head_sha !== THIRD_LAUNCHED_TARGET ||
      job.started_at !== "2026-09-14T02:48:58Z" || job.completed_at !== "2026-09-14T02:51:20Z" ||
      job.status !== "completed" || job.conclusion !== "success" || !Array.isArray(job.steps) || job.steps.length > 100 ||
      new Set(job.steps.map(step => step.name)).size !== job.steps.length) fail();
  const required = ["Validate Fixed Manual Transition","Checkout Exact Maintenance Source","Require Current Main And Exact Successful Push CI","Setup Pinned SSH Trust","Prepare Remote Detached Exact Control Source","Verify Second Launched Incident Signed Backup And Readiness Bindings","Verify Second Attempt Recovery Historical Additional Backup","Inspect Stopped Second Launched Candidate Recovery State","Verify Exact Second Attempt Recovery History Under Production Lock","Execute Fixed Maintenance Transition","Remove Exact Temporary Control Source","Remove Runner Second Attempt Recovery Evidence","Remove Runner SSH Material"];
  const skipped = ["Require Exact Successful Maintenance Deploy Before End","Verify Signed Deploy Maintenance Binding","Inspect Original Failed Held Recovery State","Verify Complete Recovery History Under Production Lock","Inspect Migrated Unlaunched Continuation State","Verify Original Signed Backup And Readiness Bindings","Verify Exact Continuation History Under Production Lock","Inspect Failed Unlaunched Build Recovery State","Verify Build Incident Signed Backup And Readiness Bindings","Verify Fixed Additional Scheduled Backup Evidence","Verify Exact Build Recovery History Under Production Lock","Verify Launched Incident Signed Backup And Readiness Bindings","Verify Attempt Recovery Historical Additional Backup","Inspect Stopped Launched Candidate Recovery State","Verify Exact Single Attempt Recovery History Under Production Lock","Verify Real Public Release After End","Reclose Entry And Fail Held If End Is Unconfirmed","Remove Runner Recovery Inspection","Remove Runner Continuation Evidence","Remove Runner Build Recovery Evidence","Remove Fixed Additional Scheduled Backup Evidence","Remove Runner Attempt Recovery Evidence"];
  for (const name of required) if (job.steps.find(step => step.name === name)?.conclusion !== "success") fail();
  for (const name of skipped) if (job.steps.find(step => step.name === name)?.conclusion !== "skipped") fail();
  for (const step of job.steps) {
    if (step.status !== "completed" || !["success", "skipped"].includes(step.conclusion)) fail();
    if (step.conclusion === "success" && (timestamp(step.started_at) < timestamp(job.started_at) ||
        timestamp(step.completed_at) < timestamp(step.started_at) || timestamp(step.completed_at) > timestamp(job.completed_at))) fail();
  }
  const ci = await readRun(THIRD_RECOVERY_CI, "CI", "ci.yml", "push");
  if (ci.completed > recovery.created) fail();
  const jobs = await api(`repos/${REPOSITORY}/actions/runs/${THIRD_RECOVERY_CI}/attempts/1/jobs?per_page=100`);
  if (jobs?.total_count !== 10 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 10 ||
      new Set(jobs.jobs.map(value => id(value.id))).size !== 10 || new Set(jobs.jobs.map(value => value.name)).size !== 10 ||
      jobs.jobs.some(value => value.run_id !== Number(THIRD_RECOVERY_CI) || value.head_sha !== THIRD_LAUNCHED_TARGET ||
        value.status !== "completed" || value.conclusion !== "success" || timestamp(value.started_at) < ci.started ||
        timestamp(value.completed_at) < timestamp(value.started_at) || timestamp(value.completed_at) > ci.completed)) fail();
  return { runId: THIRD_RECOVERY_RUN, created: recovery.created, started: recovery.started, completed: recovery.completed,
    run: recovery.run, job, ci: { run: ci.run, jobs: jobs.jobs } };
}


export async function createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, env, api, priorBindings, now = Date.now(), additionalRecords) {
  const checked = validateMaintenanceBudgetRecoveryInspection(inspection);
  checkWorkflowClock(now);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") || MAINTENANCE_BUDGET_RECOVERY_FIXED_FAILED_RUNS.some(spec => String(spec.run.id) === env.GITHUB_RUN_ID) || env.GITHUB_SHA !== checked.targetSha ||
      env.TARGET_SHA !== checked.targetSha || env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha || env.EXPECTED_OLD_SHA !== checked.expectedOldSha ||
      env.MAINTENANCE_OPERATION_ID !== checked.operationId || env.ACTION !== "recover-budget" || env.CONFIRMATION !== "RECOVER_BUDGET_PRODUCTION_MAINTENANCE_UNTIL_20260914T100000Z") fail();
  if (checked.stoppedBaseline.observedAt > now || now - checked.stoppedBaseline.observedAt > MAINTENANCE_BUDGET_RECOVERY_HISTORY_MAX_AGE_MS) fail();
  const bindings = validateMaintenanceBudgetRecoveryPriorBindings(checked, priorBindings);
  const additionalBackup = validateMaintenanceBudgetRecoveryAdditionalBackup(additionalRecords, now);
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const ci = await api(`repos/${REPOSITORY}/actions/workflows/ci.yml/runs?event=push&branch=main&status=success&head_sha=${checked.targetSha}&per_page=100`);
  if (!Array.isArray(ci?.workflow_runs)) fail();
  const matched = ci.workflow_runs.filter(run => run.name === "CI" && run.path === ".github/workflows/ci.yml" && run.event === "push" &&
    run.head_branch === "main" && run.head_sha === checked.targetSha && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 && run.status === "completed" && run.conclusion === "success" &&
    run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY);
  if (!matched.length) fail();
  const mainCIrunId = id(matched[0].id);
  const history = await inspectMaintenanceBudgetRecoveryHistory(checked, api, now);
  const priorRecovery = await inspectPriorRecovery(api, now);
  const priorAttemptRecovery = await inspectPriorAttemptRecovery(api, now);
  const priorSecondAttemptRecovery = await inspectPriorSecondAttemptRecovery(api, now);
  if (priorSecondAttemptRecovery.started < history.incidents[12].updated || priorSecondAttemptRecovery.completed > history.incidents[13].created) fail();
  if (priorAttemptRecovery.started < history.incidents[9].updated || priorAttemptRecovery.completed > history.incidents[10].created) fail();
  if (priorRecovery.completed > history.incidents[7].created || priorRecovery.started < history.additionalBackup.updated) fail();
  const inventory = await api(`repos/${REPOSITORY}/actions/runs/${ADDITIONAL.runId}/artifacts?per_page=100`);
  const expectedNames = MAINTENANCE_ADDITIONAL_BACKUP_SMALL_ARTIFACTS.map(value => value.name).concat([
    "faolla-encrypted-backup-attestation-bundle-34745334237-1", "faolla-encrypted-disaster-recovery-34745334237-1",
    "faolla-production-backup-attestation-bundle-34745334237-1"]);
  if (inventory?.total_count !== 6 || !Array.isArray(inventory.artifacts) || inventory.artifacts.length !== 6 ||
      new Set(inventory.artifacts.map(value => id(value.id))).size !== 6 || new Set(inventory.artifacts.map(value => value.name)).size !== 6 ||
      inventory.artifacts.some(value => !expectedNames.includes(value.name))) fail();
  const artifacts = [];
  for (const expected of MAINTENANCE_ADDITIONAL_BACKUP_SMALL_ARTIFACTS) {
    const actual = inventory.artifacts.find(value => String(value.id) === expected.id);
    if (!actual || id(actual.id) !== expected.id || actual.name !== expected.name || actual.size_in_bytes !== expected.bytes ||
        actual.digest !== "sha256:" + expected.sha256 || actual.expired !== false || actual.workflow_run?.id !== Number(ADDITIONAL.runId) ||
        actual.workflow_run.head_sha !== ADDITIONAL.sourceSha || actual.workflow_run.head_branch !== "main") fail();
    artifacts.push({ id: expected.id, name: actual.name, sizeBytes: actual.size_in_bytes, digest: actual.digest, expired: actual.expired,
      runId: String(actual.workflow_run.id), headSha: actual.workflow_run.head_sha, headBranch: actual.workflow_run.head_branch });
  }
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  return validateMaintenanceBudgetRecoveryEvidence({ ...checked, toolsSha: checked.targetSha,
    budgetRecoveryRunId: env.GITHUB_RUN_ID, budgetRecoveryRunAttempt: 1, mainCIrunId,
    historyDigest: hash({ history, bindings, additionalBackup, artifacts, priorRecovery, priorAttemptRecovery, priorSecondAttemptRecovery }), historyCheckedAt: now });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.platform !== "linux" || process.argv.length !== 8 || process.argv[2] !== "--inspection" || process.argv[4] !== "--prior-bindings" || process.argv[6] !== "--additional-backup" ||
        !process.env.GITHUB_OUTPUT || !process.env.GH_TOKEN) fail();
    const readBounded = (file, maximum) => {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) fail();
      const bytes = readFileSync(file); if (bytes.length !== stat.size) fail(); return bytes;
    };
    const inspection = JSON.parse(readBounded(process.argv[3], 16384));
    const priorBindings = Object.fromEntries(["backup", "readiness"].map(phase => [phase, {
      bytes: readBounded(join(process.argv[5], phase, "production-maintenance-binding.json"), 4096),
      provenance: JSON.parse(readBounded(join(process.argv[5], phase, "provenance.json"), 1048576)),
    }]));
    const api = async endpoint => {
      if (!endpoint.startsWith(`repos/${REPOSITORY}/`) || endpoint.length > 512) fail();
      const result = spawnSync("/usr/bin/gh", ["api", "--method", "GET", endpoint], {
        encoding: "utf8", timeout: 15000, maxBuffer: 8 * 1024 * 1024,
        env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GH_TOKEN: process.env.GH_TOKEN, GH_HOST: "github.com" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.status !== 0 || result.error || result.signal) fail();
      return JSON.parse(result.stdout);
    };
    const additionalBackup = readMaintenanceBudgetRecoveryAdditionalBackup(process.argv[7]);
    const evidence = await createMaintenanceBudgetRecoveryWorkflowEvidence(inspection, process.env, api, priorBindings, Date.now(), additionalBackup);
    const completedAt = Date.now(); checkWorkflowClock(completedAt);
    if (completedAt < evidence.historyCheckedAt || completedAt - evidence.historyCheckedAt > MAINTENANCE_BUDGET_RECOVERY_HISTORY_MAX_AGE_MS) fail();
    if (completedAt < evidence.stoppedBaseline.observedAt || completedAt - evidence.stoppedBaseline.observedAt > MAINTENANCE_BUDGET_RECOVERY_HISTORY_MAX_AGE_MS) fail();
    const encoded = encodeMaintenanceBudgetRecoveryEvidence(evidence);
    process.stdout.write(`::add-mask::${encoded}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `budget_recovery_evidence=${encoded}\n`);
    process.stdout.write("maintenance_budget_recovery_history_verified\n");
  } catch { process.stderr.write("maintenance_budget_recovery_workflow_unverified\n"); process.exitCode = 1; }
}
