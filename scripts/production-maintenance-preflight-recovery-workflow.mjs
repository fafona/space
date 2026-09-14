import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  validateMaintenancePreflightRecoveryInspection, validateMaintenancePreflightRecoveryEvidence, encodeMaintenancePreflightRecoveryEvidence,
  MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION as AUTHORIZATION,
  MAINTENANCE_PREFLIGHT_RECOVERY_HISTORY_MAX_AGE_MS as MAX_AGE,
} from "./production-maintenance-preflight-recovery.mjs";

const REPOSITORY = "fafona/space", PRIOR = "5c1130adf37308e30e5c656f3d894e096cd65b7f";
const SHA = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]*$/;
const fail = () => { throw new Error("maintenance_preflight_recovery_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
// Exact GitHub GET projections observed on 2026-09-14. B10/R10 and the
// failed D10 are historical records, never evidence of a new successful deploy.
// No payload, archive or log is read. The fixed raw predecessor proves the
// unused launch journal independently; GitHub metadata alone does not prove it.
export const MAINTENANCE_PREFLIGHT_RECOVERY_PRIOR_RUNS = freeze([{"run":{"id":34868191767,"name":"Encrypted Database Backup","path":".github/workflows/database-backup.yml","event":"workflow_dispatch","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T16:22:20Z","run_started_at":"2026-09-14T16:22:20Z","updated_at":"2026-09-14T17:08:45Z"},"jobs":[{"id":104057241111,"name":"backup","run_id":34868191767,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:22:26Z","completed_at":"2026-09-14T17:08:44Z","steps":[[1,"Set up job","success","2026-09-14T16:22:27Z","2026-09-14T16:22:29Z"],[2,"Checkout Exact Backup Source","success","2026-09-14T16:22:29Z","2026-09-14T16:22:36Z"],[3,"Verify Current Main And Exact Successful Push CI","success","2026-09-14T16:22:36Z","2026-09-14T16:22:40Z"],[4,"Setup Pinned SSH Host Trust","success","2026-09-14T16:22:40Z","2026-09-14T16:22:41Z"],[5,"Prepare Remote Detached Exact Source","success","2026-09-14T16:22:41Z","2026-09-14T16:22:44Z"],[6,"Verify Held Maintenance Before Backup","success","2026-09-14T16:22:44Z","2026-09-14T16:22:53Z"],[7,"Verify Backup Configuration From Exact Source","success","2026-09-14T16:22:53Z","2026-09-14T16:22:54Z"],[8,"Create Encrypted Database Backup From Exact Source","success","2026-09-14T16:22:54Z","2026-09-14T16:23:23Z"],[9,"Verify Held Maintenance After Backup Capture","success","2026-09-14T16:23:23Z","2026-09-14T16:23:30Z"],[10,"Transfer Complete Encrypted Backup","success","2026-09-14T16:23:30Z","2026-09-14T17:06:34Z"],[11,"Verify Encrypted Backup","success","2026-09-14T17:06:34Z","2026-09-14T17:06:40Z"],[12,"Rehearse Isolated Restore","success","2026-09-14T17:06:40Z","2026-09-14T17:08:13Z"],[13,"Confirm Backup Is Ready For Upload","success","2026-09-14T17:08:13Z","2026-09-14T17:08:14Z"],[14,"Upload Verified Encrypted Backup","success","2026-09-14T17:08:14Z","2026-09-14T17:08:18Z"],[15,"Verify Uploaded Backup Artifact Identity","success","2026-09-14T17:08:18Z","2026-09-14T17:08:18Z"],[16,"Generate Backup Attestation Predicate","success","2026-09-14T17:08:18Z","2026-09-14T17:08:18Z"],[17,"Upload Canonical Backup Attestation Input","success","2026-09-14T17:08:18Z","2026-09-14T17:08:19Z"],[18,"Upload Backup Verification And Attestation Inputs","success","2026-09-14T17:08:19Z","2026-09-14T17:08:20Z"],[19,"Attest Verified Encrypted Backup","success","2026-09-14T17:08:20Z","2026-09-14T17:08:22Z"],[20,"Attest Canonical Backup Attestation Input","success","2026-09-14T17:08:22Z","2026-09-14T17:08:23Z"],[21,"Upload Encrypted Backup Attestation Bundle","success","2026-09-14T17:08:23Z","2026-09-14T17:08:23Z"],[22,"Upload Canonical Backup Attestation Bundle","success","2026-09-14T17:08:23Z","2026-09-14T17:08:24Z"],[23,"Verify Held Maintenance Before Backup Attestation","success","2026-09-14T17:08:24Z","2026-09-14T17:08:40Z"],[24,"Build Canonical Maintenance Binding","success","2026-09-14T17:08:40Z","2026-09-14T17:08:40Z"],[25,"Upload Canonical Maintenance Binding","success","2026-09-14T17:08:40Z","2026-09-14T17:08:41Z"],[26,"Attest Canonical Maintenance Binding","success","2026-09-14T17:08:41Z","2026-09-14T17:08:42Z"],[27,"Upload Backup Failure Diagnostics","skipped","2026-09-14T17:08:42Z","2026-09-14T17:08:42Z"],[28,"Remove Temporary Backup And Exact Source","success","2026-09-14T17:08:42Z","2026-09-14T17:08:43Z"],[56,"Post Checkout Exact Backup Source","success","2026-09-14T17:08:43Z","2026-09-14T17:08:43Z"],[57,"Complete job","success","2026-09-14T17:08:43Z","2026-09-14T17:08:43Z"]]}],"artifacts":[{"id":10360070018,"name":"faolla-encrypted-disaster-recovery-34868191767-1","size_in_bytes":505784526,"expired":false,"created_at":"2026-09-14T17:08:18Z","updated_at":"2026-09-14T17:08:18Z","expires_at":"2026-09-21T17:08:14Z","digest":"sha256:31fef9a56cf90bb35003808b3e6e00d3f2462225769b1aaa7fc5c90471d5aef6","workflow_run":{"id":34868191767,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}},{"id":10359493317,"name":"faolla-production-backup-attestation-bundle-34868191767-1","size_in_bytes":7008,"expired":false,"created_at":"2026-09-14T17:08:24Z","updated_at":"2026-09-14T17:08:24Z","expires_at":"2026-09-21T17:08:23Z","digest":"sha256:1032c527a20c9f399ef4aad11ae3fba9fd2524061088b41fd04d4f73393a5c22","workflow_run":{"id":34868191767,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}},{"id":10359398817,"name":"faolla-encrypted-backup-attestation-bundle-34868191767-1","size_in_bytes":7692,"expired":false,"created_at":"2026-09-14T17:08:23Z","updated_at":"2026-09-14T17:08:23Z","expires_at":"2026-09-21T17:08:23Z","digest":"sha256:3e762fdac42d2037788695336ab86aeeb969f9367fb5576f652f93c9be32ab9f","workflow_run":{"id":34868191767,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}},{"id":10359379094,"name":"faolla-maintenance-backup-binding-34868191767-1","size_in_bytes":410,"expired":false,"created_at":"2026-09-14T17:08:41Z","updated_at":"2026-09-14T17:08:41Z","expires_at":"2026-09-21T17:08:40Z","digest":"sha256:c9243f3011e3945c542f355158d67e34c969743b9f554c2d2cb3526c1c5d7e7b","workflow_run":{"id":34868191767,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}},{"id":10359342823,"name":"faolla-backup-verification-reports-34868191767-1","size_in_bytes":8158,"expired":false,"created_at":"2026-09-14T17:08:20Z","updated_at":"2026-09-14T17:08:20Z","expires_at":"2026-09-21T17:08:19Z","digest":"sha256:93342344acd479a27e98b7acdb77979e05baf67c091659cff1d955ce218765d3","workflow_run":{"id":34868191767,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}},{"id":10359003491,"name":"faolla-production-backup-attestation-34868191767-1","size_in_bytes":1060,"expired":false,"created_at":"2026-09-14T17:08:19Z","updated_at":"2026-09-14T17:08:19Z","expires_at":"2026-09-21T17:08:19Z","digest":"sha256:f9f9317a28fc429662be16476196a8791066d2dda73985ce0ac2d8759808eaab","workflow_run":{"id":34868191767,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}}]},{"run":{"id":34873107909,"name":"Ordinary Account Cutover Readiness","path":".github/workflows/ordinary-account-cutover-readiness.yml","event":"workflow_dispatch","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T17:10:18Z","run_started_at":"2026-09-14T17:10:18Z","updated_at":"2026-09-14T17:11:36Z"},"jobs":[{"id":104073618326,"name":"readiness","run_id":34873107909,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T17:10:22Z","completed_at":"2026-09-14T17:11:35Z","steps":[[1,"Set up job","success","2026-09-14T17:10:23Z","2026-09-14T17:10:24Z"],[2,"Validate Manual Release Chain","success","2026-09-14T17:10:24Z","2026-09-14T17:10:25Z"],[3,"Checkout Exact Readiness Source","success","2026-09-14T17:10:25Z","2026-09-14T17:10:32Z"],[4,"Verify Exact Current Main Checkout","success","2026-09-14T17:10:32Z","2026-09-14T17:10:33Z"],[5,"Resolve Exact Successful Backup Artifact Inventory","success","2026-09-14T17:10:33Z","2026-09-14T17:10:33Z"],[6,"Verify Recursive Backup Attestation Chain","success","2026-09-14T17:10:33Z","2026-09-14T17:10:37Z"],[7,"Verify Signed Backup Maintenance Binding","success","2026-09-14T17:10:37Z","2026-09-14T17:10:41Z"],[8,"Setup Pinned SSH Host Trust","success","2026-09-14T17:10:41Z","2026-09-14T17:10:41Z"],[9,"Prepare Remote Detached Exact Source","success","2026-09-14T17:10:41Z","2026-09-14T17:10:45Z"],[10,"Verify Held Maintenance Before Readiness","success","2026-09-14T17:10:45Z","2026-09-14T17:11:02Z"],[11,"Inspect Locked Production Readiness From Exact Source","success","2026-09-14T17:11:02Z","2026-09-14T17:11:05Z"],[12,"Upload Canonical Readiness Report","success","2026-09-14T17:11:05Z","2026-09-14T17:11:06Z"],[13,"Verify Uploaded Readiness Report Artifact","success","2026-09-14T17:11:06Z","2026-09-14T17:11:06Z"],[14,"Enforce Ready Cutover State","success","2026-09-14T17:11:06Z","2026-09-14T17:11:06Z"],[15,"Build Canonical Readiness Attestation","success","2026-09-14T17:11:06Z","2026-09-14T17:11:06Z"],[16,"Upload Canonical Readiness Attestation","success","2026-09-14T17:11:06Z","2026-09-14T17:11:07Z"],[17,"Verify Uploaded Readiness Attestation Artifact","success","2026-09-14T17:11:07Z","2026-09-14T17:11:07Z"],[18,"Attest Canonical Readiness Report","success","2026-09-14T17:11:07Z","2026-09-14T17:11:08Z"],[19,"Attest Canonical Readiness Attestation","success","2026-09-14T17:11:08Z","2026-09-14T17:11:10Z"],[20,"Verify Held Maintenance After Readiness","success","2026-09-14T17:11:10Z","2026-09-14T17:11:30Z"],[21,"Build Canonical Maintenance Binding","success","2026-09-14T17:11:30Z","2026-09-14T17:11:30Z"],[22,"Upload Canonical Maintenance Binding","success","2026-09-14T17:11:30Z","2026-09-14T17:11:30Z"],[23,"Attest Canonical Maintenance Binding","success","2026-09-14T17:11:30Z","2026-09-14T17:11:32Z"],[24,"Confirm Exact Successful Readiness Artifact Inventory","success","2026-09-14T17:11:32Z","2026-09-14T17:11:32Z"],[25,"Remove Remote Exact Readiness Source","success","2026-09-14T17:11:32Z","2026-09-14T17:11:34Z"],[50,"Post Checkout Exact Readiness Source","success","2026-09-14T17:11:34Z","2026-09-14T17:11:34Z"],[51,"Complete job","success","2026-09-14T17:11:34Z","2026-09-14T17:11:34Z"]]}],"artifacts":[{"id":10359808583,"name":"faolla-production-readiness-report-34873107909-1","size_in_bytes":1241,"expired":false,"created_at":"2026-09-14T17:11:06Z","updated_at":"2026-09-14T17:11:06Z","expires_at":"2026-09-15T17:11:05Z","digest":"sha256:e1b08984a257d3e08c34ba080ead5bc69eb7d6f937c9f34dc96044f0ca99e9bf","workflow_run":{"id":34873107909,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}},{"id":10359683573,"name":"faolla-production-readiness-attestation-34873107909-1","size_in_bytes":4573,"expired":false,"created_at":"2026-09-14T17:11:07Z","updated_at":"2026-09-14T17:11:07Z","expires_at":"2026-09-15T17:11:06Z","digest":"sha256:57dbe94cd299fa39d23814ce5a18b0a6cc1d7a71c331fd9fe2785628f44aefff","workflow_run":{"id":34873107909,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}},{"id":10358969000,"name":"faolla-maintenance-readiness-binding-34873107909-1","size_in_bytes":412,"expired":false,"created_at":"2026-09-14T17:11:30Z","updated_at":"2026-09-14T17:11:30Z","expires_at":"2026-09-21T17:11:30Z","digest":"sha256:3933312a11427697b4d5f1fd2d58b054313db515aff9ef8ff9e3925e50c9b5b0","workflow_run":{"id":34873107909,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f"}}]},{"run":{"id":34873244708,"name":"Deploy Production","path":".github/workflows/deploy.yml","event":"workflow_run","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"failure","created_at":"2026-09-14T17:11:39Z","run_started_at":"2026-09-14T17:11:39Z","updated_at":"2026-09-14T17:21:18Z"},"jobs":[{"id":104074064273,"name":"deploy","run_id":34873244708,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"failure","started_at":"2026-09-14T17:11:42Z","completed_at":"2026-09-14T17:21:18Z","steps":[[1,"Set up job","success","2026-09-14T17:11:43Z","2026-09-14T17:11:45Z"],[2,"Validate Readiness Workflow Run","success","2026-09-14T17:11:45Z","2026-09-14T17:11:46Z"],[3,"Checkout Tested Commit","success","2026-09-14T17:11:46Z","2026-09-14T17:11:50Z"],[4,"Resolve Deploy Commit","success","2026-09-14T17:11:50Z","2026-09-14T17:11:51Z"],[5,"Resolve Readiness Artifacts","success","2026-09-14T17:11:51Z","2026-09-14T17:11:51Z"],[6,"Verify Readiness Evidence","success","2026-09-14T17:11:51Z","2026-09-14T17:11:59Z"],[7,"Revalidate Live Recursive Backup Evidence","success","2026-09-14T17:11:59Z","2026-09-14T17:12:03Z"],[8,"Verify Signed Readiness Maintenance Binding","success","2026-09-14T17:12:03Z","2026-09-14T17:12:06Z"],[9,"Export Verified Maintenance Binding","success","2026-09-14T17:12:06Z","2026-09-14T17:12:06Z"],[10,"Setup SSH","success","2026-09-14T17:12:06Z","2026-09-14T17:12:06Z"],[11,"Deploy To Server","failure","2026-09-14T17:12:06Z","2026-09-14T17:21:15Z"],[12,"Verify Public Release","skipped","2026-09-14T17:21:15Z","2026-09-14T17:21:15Z"],[13,"Verify Candidate While Public Entry Remains Held","skipped","2026-09-14T17:21:15Z","2026-09-14T17:21:15Z"],[14,"Build Canonical Maintenance Binding","skipped","2026-09-14T17:21:15Z","2026-09-14T17:21:15Z"],[15,"Upload Canonical Maintenance Binding","skipped","2026-09-14T17:21:15Z","2026-09-14T17:21:15Z"],[16,"Attest Canonical Maintenance Binding","skipped","2026-09-14T17:21:15Z","2026-09-14T17:21:15Z"],[32,"Post Checkout Tested Commit","success","2026-09-14T17:21:15Z","2026-09-14T17:21:15Z"],[33,"Complete job","success","2026-09-14T17:21:15Z","2026-09-14T17:21:15Z"]]}],"artifacts":[]},{"run":{"id":34867675835,"name":"Production Maintenance","path":".github/workflows/production-maintenance.yml","event":"workflow_dispatch","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T16:17:32Z","run_started_at":"2026-09-14T16:17:32Z","updated_at":"2026-09-14T16:21:16Z"},"jobs":[{"id":104055511675,"name":"maintenance","run_id":34867675835,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:17:37Z","completed_at":"2026-09-14T16:21:15Z","steps":[[1,"Set up job","success","2026-09-14T16:17:38Z","2026-09-14T16:17:38Z"],[2,"Validate Fixed Manual Transition","success","2026-09-14T16:17:38Z","2026-09-14T16:17:38Z"],[3,"Checkout Exact Maintenance Source","success","2026-09-14T16:17:38Z","2026-09-14T16:17:43Z"],[4,"Require Current Main And Exact Successful Push CI","success","2026-09-14T16:17:43Z","2026-09-14T16:17:47Z"],[5,"Require Exact Successful Maintenance Deploy Before End","skipped","2026-09-14T16:17:47Z","2026-09-14T16:17:47Z"],[6,"Verify Signed Deploy Maintenance Binding","skipped","2026-09-14T16:17:47Z","2026-09-14T16:17:47Z"],[7,"Setup Pinned SSH Trust","success","2026-09-14T16:17:47Z","2026-09-14T16:17:47Z"],[8,"Prepare Remote Detached Exact Control Source","success","2026-09-14T16:17:47Z","2026-09-14T16:17:52Z"],[9,"Inspect Original Failed Held Recovery State","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[10,"Verify Complete Recovery History Under Production Lock","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[11,"Inspect Migrated Unlaunched Continuation State","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[12,"Verify Original Signed Backup And Readiness Bindings","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[13,"Verify Exact Continuation History Under Production Lock","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[14,"Inspect Failed Unlaunched Build Recovery State","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[15,"Verify Build Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[16,"Verify Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[17,"Verify Exact Build Recovery History Under Production Lock","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[18,"Verify Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[19,"Verify Attempt Recovery Historical Additional Backup","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[20,"Inspect Stopped Launched Candidate Recovery State","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[21,"Verify Exact Single Attempt Recovery History Under Production Lock","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[22,"Verify Second Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[23,"Verify Second Attempt Recovery Historical Additional Backup","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[24,"Inspect Stopped Second Launched Candidate Recovery State","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[25,"Verify Exact Second Attempt Recovery History Under Production Lock","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[26,"Verify Budget Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[27,"Verify Budget Recovery Historical Additional Backup","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[28,"Inspect Stopped Budget Candidate Recovery State","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[29,"Verify Exact Budget Recovery History Under Production Lock","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[30,"Inspect Unused Window Renewal State","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[31,"Verify Exact Window Renewal History Under Production Lock","skipped","2026-09-14T16:17:52Z","2026-09-14T16:17:52Z"],[32,"Inspect Failed Unlaunched Prelaunch Recovery State","success","2026-09-14T16:17:52Z","2026-09-14T16:18:13Z"],[33,"Verify Exact Prelaunch Recovery History Under Production Lock","success","2026-09-14T16:18:13Z","2026-09-14T16:20:33Z"],[34,"Execute Fixed Maintenance Transition","success","2026-09-14T16:20:33Z","2026-09-14T16:21:11Z"],[35,"Verify Real Public Release After End","skipped","2026-09-14T16:21:11Z","2026-09-14T16:21:11Z"],[36,"Reclose Entry And Fail Held If End Is Unconfirmed","skipped","2026-09-14T16:21:11Z","2026-09-14T16:21:11Z"],[37,"Remove Exact Temporary Control Source","success","2026-09-14T16:21:11Z","2026-09-14T16:21:13Z"],[38,"Remove Runner Recovery Inspection","skipped","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[39,"Remove Runner Continuation Evidence","skipped","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[40,"Remove Runner Build Recovery Evidence","skipped","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[41,"Remove Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[42,"Remove Runner Attempt Recovery Evidence","skipped","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[43,"Remove Runner Second Attempt Recovery Evidence","skipped","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[44,"Remove Runner Budget Recovery Evidence","skipped","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[45,"Remove Runner Window Renewal Evidence","skipped","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[46,"Remove Runner Prelaunch Recovery Evidence","success","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[47,"Remove Runner SSH Material","success","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[94,"Post Checkout Exact Maintenance Source","success","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"],[95,"Complete job","success","2026-09-14T16:21:13Z","2026-09-14T16:21:13Z"]]}],"artifacts":[]},{"run":{"id":34865334166,"name":"CI","path":".github/workflows/ci.yml","event":"push","head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T15:55:29Z","run_started_at":"2026-09-14T15:55:29Z","updated_at":"2026-09-14T16:16:10Z"},"jobs":[{"id":104047617767,"name":"Isolated Supabase Scheduler Acceptance","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T15:55:33Z","completed_at":"2026-09-14T15:57:03Z"},{"id":104047618067,"name":"Isolated Maintenance Ingress Acceptance","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T15:55:32Z","completed_at":"2026-09-14T15:56:14Z"},{"id":104047618634,"name":"Quality","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T15:55:32Z","completed_at":"2026-09-14T16:12:26Z"},{"id":104053711848,"name":"Enterprise Browser Journeys","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:12:28Z","completed_at":"2026-09-14T16:16:10Z"},{"id":104053711915,"name":"Checkout Context PostgreSQL Acceptance","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:12:29Z","completed_at":"2026-09-14T16:13:25Z"},{"id":104053711921,"name":"QR Atomic PostgreSQL Acceptance","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:12:28Z","completed_at":"2026-09-14T16:13:00Z"},{"id":104053711925,"name":"Order Membership PostgreSQL Acceptance","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:12:28Z","completed_at":"2026-09-14T16:13:24Z"},{"id":104053711952,"name":"Redemption PostgreSQL Acceptance","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:12:30Z","completed_at":"2026-09-14T16:13:16Z"},{"id":104053711999,"name":"Pages Client Write ACL PostgreSQL Acceptance","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:12:29Z","completed_at":"2026-09-14T16:13:02Z"},{"id":104053712007,"name":"Recovery Content PostgreSQL Acceptance","run_id":34865334166,"head_sha":"5c1130adf37308e30e5c656f3d894e096cd65b7f","status":"completed","conclusion":"success","started_at":"2026-09-14T16:12:28Z","completed_at":"2026-09-14T16:12:56Z"}],"artifacts":[]}]);
const [BACKUP, READINESS, DEPLOY, RECOVERY, PRIOR_CI] = MAINTENANCE_PREFLIGHT_RECOVERY_PRIOR_RUNS;
const RUN_KEYS = Object.keys(BACKUP.run);
const JOB_KEYS = Object.keys(BACKUP.jobs[0]).filter(key => key !== "steps");
const ARTIFACT_KEYS = Object.keys(BACKUP.artifacts[0]);
const WORKFLOWS = freeze([
  ["database-backup.yml", "Encrypted Database Backup"],
  ["database-migrate.yml", "Apply Production Database Migrations"],
  ["ordinary-account-cutover-readiness.yml", "Ordinary Account Cutover Readiness"],
  ["deploy.yml", "Deploy Production"],
  ["production-maintenance.yml", "Production Maintenance"],
]);
const CI_NAMES = PRIOR_CI.jobs.map(job => job.name).sort();
// The prior state contains its full immutable earlier audit. We chain from its
// actual successful recovery, never erase/reinterpret earlier history or use an
// expired authorization clock. Older runs updated/retried after this anchor are
// still detected because every page is enumerated without a created-date filter.
const CUTOFF = Date.parse(RECOVERY.run.created_at);
const id = value => { const result = String(value); if (!ID.test(result) || !Number.isSafeInteger(Number(result))) fail(); return result; };
const timestamp = value => { if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) fail(); const time = Date.parse(value); if (!Number.isSafeInteger(time)) fail(); return time; };
function clock(now) { if (!Number.isSafeInteger(now) || now < AUTHORIZATION.authorizedAt || now >= AUTHORIZATION.expiresAt) fail(); }
function observationTime(startedAt, observedClock) {
  if (typeof observedClock !== "function") fail();
  const observedAt = observedClock(); clock(observedAt);
  if (observedAt < startedAt || observedAt - startedAt > MAX_AGE) fail();
  return observedAt;
}
function orderedClock(startedAt, source) {
  if (typeof source !== "function") fail();
  let previous = startedAt;
  return () => { const observed = observationTime(startedAt, source); if (observed < previous) fail(); previous = observed; return observed; };
}
function project(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const out = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(); out[key] = descriptor.value; }
  return out;
}
function runProjection(run) {
  if (run?.repository?.full_name !== REPOSITORY || run?.head_repository?.full_name !== REPOSITORY) fail();
  return project(run, RUN_KEYS);
}
function jobProjection(job, steps) {
  const out = project(job, JOB_KEYS);
  if (steps) {
    if (!Array.isArray(job.steps) || job.steps.length > 100 || job.steps.some(step => step.status !== "completed")) fail();
    out.steps = job.steps.map(step => [step.number, step.name, step.conclusion, step.started_at, step.completed_at]);
  }
  return out;
}
async function fixedRun(spec, api) {
  const run = runProjection(await api(`repos/${REPOSITORY}/actions/runs/${spec.run.id}`));
  if (hash(run) !== hash(spec.run)) fail();
  const data = await api(`repos/${REPOSITORY}/actions/runs/${spec.run.id}/attempts/1/jobs?per_page=100`);
  if (data?.total_count !== spec.jobs.length || !Array.isArray(data.jobs) || data.jobs.length !== spec.jobs.length) fail();
  const jobs = data.jobs.map(job => jobProjection(job, Boolean(spec.jobs[0].steps))).sort((a, b) => a.id - b.id);
  if (hash(jobs) !== hash([...spec.jobs].sort((a, b) => a.id - b.id))) fail();
  let artifacts;
  if (spec.artifacts) {
    const data = await api(`repos/${REPOSITORY}/actions/runs/${spec.run.id}/artifacts?per_page=100`);
    if (data?.total_count !== spec.artifacts.length || !Array.isArray(data.artifacts) || data.artifacts.length !== spec.artifacts.length) fail();
    artifacts = data.artifacts.map(value => project(value, ARTIFACT_KEYS)).sort((a, b) => a.id - b.id);
    if (hash(artifacts) !== hash([...spec.artifacts].sort((a, b) => a.id - b.id))) fail();
  }
  return { run, jobs, ...(artifacts ? { artifacts } : {}) };
}
function checkCurrent(run, checked, currentRunId, now) {
  const value = runProjection(run);
  if (id(value.id) !== currentRunId || value.name !== "Production Maintenance" || value.path !== ".github/workflows/production-maintenance.yml" ||
      value.event !== "workflow_dispatch" || value.head_branch !== "main" || value.head_sha !== checked.targetSha ||
      value.run_attempt !== 1 || value.status !== "in_progress" || value.conclusion !== null) fail();
  const created = timestamp(value.created_at), started = timestamp(value.run_started_at), updated = timestamp(value.updated_at);
  if (created < AUTHORIZATION.authorizedAt || started < created || updated < started || updated > now) fail();
  // The current step's updated_at may advance legitimately. No terminal or
  // attempt/generation change is ignored; all other current identity is bound.
  return project(value, RUN_KEYS.filter(key => key !== "updated_at"));
}
async function scan(checked, api, now, currentRunId, observedClock) {
  const rows = [];
  const foundFixed = new Set(); let foundCurrent = false;
  for (const [file, name] of WORKFLOWS) {
    const seen = new Set(); let total = null, ended = false;
    for (let page = 1; page <= 20; page++) {
      const data = await api(`repos/${REPOSITORY}/actions/workflows/${file}/runs?per_page=100&page=${page}`);
      if (!Number.isSafeInteger(data?.total_count) || data.total_count < 0 || data.total_count > 2000 ||
          !Array.isArray(data.workflow_runs) || data.workflow_runs.length > 100) fail();
      if (total === null) total = data.total_count;
      if (total !== data.total_count) fail();
      for (const raw of data.workflow_runs) {
        const run = runProjection(raw), runId = id(run.id);
        if (seen.has(runId) || run.name !== name || run.path !== ".github/workflows/" + file ||
            run.head_branch !== "main" || !SHA.test(run.head_sha ?? "")) fail();
        seen.add(runId);
        if (runId === currentRunId) {
          if (file !== "production-maintenance.yml" || foundCurrent) fail();
          rows.push({ file, run: checkCurrent(raw, checked, currentRunId, observationTime(now, observedClock)) }); foundCurrent = true; continue;
        }
        const created = timestamp(run.created_at), started = run.run_started_at === null ? created : timestamp(run.run_started_at), updated = timestamp(run.updated_at);
        if (created > started || started > updated || updated > now || run.status !== "completed" ||
            !["success", "failure", "cancelled", "skipped", "timed_out", "neutral", "action_required", "stale", "startup_failure"].includes(run.conclusion)) fail();
        id(run.run_attempt);
        const expected = [BACKUP, READINESS, DEPLOY, RECOVERY].find(spec => String(spec.run.id) === runId);
        if (expected) {
          if (hash(run) !== hash(expected.run)) fail();
          foundFixed.add(runId);
        } else if (Math.max(created, started, updated) >= CUTOFF) fail();
        rows.push({ file, run });
      }
      if (data.workflow_runs.length < 100) { if (seen.size !== total) fail(); ended = true; break; }
    }
    if (!ended) fail();
  }
  if (foundFixed.size !== 4 || !foundCurrent) fail();
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.run.id - b.run.id);
}
export async function inspectMaintenancePreflightRecoveryHistory(inspection, api, now, currentRunId, observedClock = Date.now) {
  const checked = validateMaintenancePreflightRecoveryInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (typeof api !== "function" || !ID.test(currentRunId ?? "") || MAINTENANCE_PREFLIGHT_RECOVERY_PRIOR_RUNS.some(spec => String(spec.run.id) === currentRunId)) fail();
  const first = await scan(checked, api, now, currentRunId, observedClock);
  const records = [];
  for (const spec of MAINTENANCE_PREFLIGHT_RECOVERY_PRIOR_RUNS) records.push(await fixedRun(spec, api));
  const second = await scan(checked, api, now, currentRunId, observedClock);
  if (hash(first) !== hash(second)) fail();
  for (let index = 0; index < records.length; index++)
    if (hash(await fixedRun(MAINTENANCE_PREFLIGHT_RECOVERY_PRIOR_RUNS[index], api)) !== hash(records[index])) fail();
  observationTime(now, observedClock);
  return { predecessorStateDigest: checked.stateDigest, cutoff: CUTOFF, historyPurpose: "preflight-recovery-only",
    failedDeployPurpose: "historical-preflight-failure-not-successful-deploy", rows: first, records };
}
async function currentCI(checked, api, now) {
  const data = await api(`repos/${REPOSITORY}/actions/workflows/ci.yml/runs?event=push&branch=main&status=success&head_sha=${checked.targetSha}&per_page=100`);
  if (!Array.isArray(data?.workflow_runs) || data.total_count !== data.workflow_runs.length || data.workflow_runs.length !== 1) fail();
  const run = runProjection(data.workflow_runs[0]);
  if (run.name !== "CI" || run.path !== ".github/workflows/ci.yml" || run.event !== "push" || run.head_branch !== "main" ||
      run.head_sha !== checked.targetSha || run.run_attempt !== 1 || run.status !== "completed" || run.conclusion !== "success" ||
      timestamp(run.created_at) < AUTHORIZATION.authorizedAt || timestamp(run.run_started_at) < timestamp(run.created_at) ||
      timestamp(run.updated_at) < timestamp(run.run_started_at) || timestamp(run.updated_at) > now) fail();
  const runId = id(run.id), jobs = await api(`repos/${REPOSITORY}/actions/runs/${runId}/attempts/1/jobs?per_page=100`);
  if (jobs?.total_count !== 10 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 10) fail();
  const projected = jobs.jobs.map(job => jobProjection(job, false)).sort((a, b) => a.id - b.id);
  if (new Set(projected.map(job => id(job.id))).size !== 10 || hash(projected.map(job => job.name).sort()) !== hash(CI_NAMES) ||
      projected.some(job => job.run_id !== run.id || job.head_sha !== checked.targetSha || job.status !== "completed" || job.conclusion !== "success" ||
        timestamp(job.started_at) < timestamp(run.run_started_at) || timestamp(job.completed_at) < timestamp(job.started_at) ||
        timestamp(job.completed_at) > timestamp(run.updated_at))) fail();
  return { run, jobs: projected };
}
export async function createMaintenancePreflightRecoveryWorkflowEvidence(inspection, env, api, now = Date.now(), observedClock = Date.now) {
  const checked = validateMaintenancePreflightRecoveryInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_SHA !== checked.targetSha ||
      env.TARGET_SHA !== checked.targetSha || env.PREVIOUS_TARGET_SHA !== PRIOR || env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha ||
      env.EXPECTED_OLD_SHA !== checked.expectedOldSha || env.MAINTENANCE_OPERATION_ID !== checked.operationId ||
      env.ACTION !== "recover-preflight" || env.CONFIRMATION !== "RECOVER_PREFLIGHT_PRODUCTION_MAINTENANCE_UNTIL_20260914T200000Z") fail();
  if (checked.stoppedBaseline.observedAt > now || now - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const ci = await currentCI(checked, api, now);
  if (String(ci.run.id) === env.GITHUB_RUN_ID) fail();
  const history = await inspectMaintenancePreflightRecoveryHistory(checked, api, now, env.GITHUB_RUN_ID, observedClock);
  const current = checkCurrent(await api(`repos/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`), checked, env.GITHUB_RUN_ID, observationTime(now, observedClock));
  if (hash(current) !== hash(history.rows.find(row => String(row.run.id) === env.GITHUB_RUN_ID)?.run)) fail();
  if (timestamp(current.created_at) < timestamp(ci.run.updated_at)) fail();
  if (hash(await currentCI(checked, api, now)) !== hash(ci) || (await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const completedAt = observationTime(now, observedClock);
  if (completedAt - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  return validateMaintenancePreflightRecoveryEvidence({ ...checked, toolsSha: checked.targetSha,
    preflightRecoveryRunId: env.GITHUB_RUN_ID, preflightRecoveryRunAttempt: 1, mainCIrunId: String(ci.run.id),
    historyDigest: hash({ history, ci, current }), historyCheckedAt: now });
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.platform !== "linux" || process.argv.length !== 4 || process.argv[2] !== "--inspection" ||
        !process.env.GITHUB_OUTPUT || !process.env.GH_TOKEN) fail();
    const stat = lstatSync(process.argv[3]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 16384 || (stat.mode & 0o022)) fail();
    const bytes = readFileSync(process.argv[3]); if (bytes.length !== stat.size) fail();
    const inspection = JSON.parse(bytes);
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
    const evidence = await createMaintenancePreflightRecoveryWorkflowEvidence(inspection, process.env, api);
    const completedAt = Date.now(); clock(completedAt);
    if (completedAt < evidence.historyCheckedAt || completedAt - evidence.historyCheckedAt > MAX_AGE ||
        completedAt < evidence.stoppedBaseline.observedAt || completedAt - evidence.stoppedBaseline.observedAt > MAX_AGE) fail();
    const encoded = encodeMaintenancePreflightRecoveryEvidence(evidence);
    process.stdout.write(`::add-mask::${encoded}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `preflight_recovery_evidence=${encoded}\n`);
    process.stdout.write("maintenance_preflight_recovery_history_verified\n");
  } catch { process.stderr.write("maintenance_preflight_recovery_workflow_unverified\n"); process.exitCode = 1; }
}
