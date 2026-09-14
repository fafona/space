import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  validateMaintenancePrelaunchRecoveryInspection, validateMaintenancePrelaunchRecoveryEvidence, encodeMaintenancePrelaunchRecoveryEvidence,
  MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION as AUTHORIZATION,
  MAINTENANCE_PRELAUNCH_RECOVERY_HISTORY_MAX_AGE_MS as MAX_AGE,
} from "./production-maintenance-prelaunch-recovery.mjs";

const REPOSITORY = "fafona/space", PRIOR = "67ddb91bf618e9716b79df6bf97f08d3865919b7";
const SHA = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]*$/;
const fail = () => { throw new Error("maintenance_prelaunch_recovery_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
// Exact GitHub GET projections observed on 2026-09-14. B9/R9 and the
// failed D9 are historical records, never evidence of a new successful deploy.
// No payload, archive or log is read. The fixed raw predecessor proves the
// unused launch journal independently; GitHub metadata alone does not prove it.
export const MAINTENANCE_PRELAUNCH_RECOVERY_PRIOR_RUNS = freeze([{"run":{"id":34852696974,"name":"Encrypted Database Backup","path":".github/workflows/database-backup.yml","event":"workflow_dispatch","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T13:59:38Z","run_started_at":"2026-09-14T13:59:38Z","updated_at":"2026-09-14T14:26:09Z"},"jobs":[{"id":104004368454,"name":"backup","run_id":34852696974,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:59:42Z","completed_at":"2026-09-14T14:26:08Z","steps":[[1,"Set up job","success","2026-09-14T13:59:42Z","2026-09-14T13:59:43Z"],[2,"Checkout Exact Backup Source","success","2026-09-14T13:59:43Z","2026-09-14T13:59:51Z"],[3,"Verify Current Main And Exact Successful Push CI","success","2026-09-14T13:59:51Z","2026-09-14T13:59:51Z"],[4,"Setup Pinned SSH Host Trust","success","2026-09-14T13:59:51Z","2026-09-14T13:59:54Z"],[5,"Prepare Remote Detached Exact Source","success","2026-09-14T13:59:54Z","2026-09-14T13:59:56Z"],[6,"Verify Held Maintenance Before Backup","success","2026-09-14T13:59:56Z","2026-09-14T14:00:11Z"],[7,"Verify Backup Configuration From Exact Source","success","2026-09-14T14:00:11Z","2026-09-14T14:00:12Z"],[8,"Create Encrypted Database Backup From Exact Source","success","2026-09-14T14:00:12Z","2026-09-14T14:00:41Z"],[9,"Verify Held Maintenance After Backup Capture","success","2026-09-14T14:00:41Z","2026-09-14T14:00:56Z"],[10,"Transfer Complete Encrypted Backup","success","2026-09-14T14:00:56Z","2026-09-14T14:24:09Z"],[11,"Verify Encrypted Backup","success","2026-09-14T14:24:09Z","2026-09-14T14:24:15Z"],[12,"Rehearse Isolated Restore","success","2026-09-14T14:24:15Z","2026-09-14T14:25:37Z"],[13,"Confirm Backup Is Ready For Upload","success","2026-09-14T14:25:37Z","2026-09-14T14:25:38Z"],[14,"Upload Verified Encrypted Backup","success","2026-09-14T14:25:38Z","2026-09-14T14:25:41Z"],[15,"Verify Uploaded Backup Artifact Identity","success","2026-09-14T14:25:41Z","2026-09-14T14:25:41Z"],[16,"Generate Backup Attestation Predicate","success","2026-09-14T14:25:41Z","2026-09-14T14:25:42Z"],[17,"Upload Canonical Backup Attestation Input","success","2026-09-14T14:25:42Z","2026-09-14T14:25:42Z"],[18,"Upload Backup Verification And Attestation Inputs","success","2026-09-14T14:25:42Z","2026-09-14T14:25:43Z"],[19,"Attest Verified Encrypted Backup","success","2026-09-14T14:25:43Z","2026-09-14T14:25:45Z"],[20,"Attest Canonical Backup Attestation Input","success","2026-09-14T14:25:45Z","2026-09-14T14:25:46Z"],[21,"Upload Encrypted Backup Attestation Bundle","success","2026-09-14T14:25:46Z","2026-09-14T14:25:47Z"],[22,"Upload Canonical Backup Attestation Bundle","success","2026-09-14T14:25:47Z","2026-09-14T14:25:48Z"],[23,"Verify Held Maintenance Before Backup Attestation","success","2026-09-14T14:25:48Z","2026-09-14T14:26:03Z"],[24,"Build Canonical Maintenance Binding","success","2026-09-14T14:26:03Z","2026-09-14T14:26:03Z"],[25,"Upload Canonical Maintenance Binding","success","2026-09-14T14:26:03Z","2026-09-14T14:26:04Z"],[26,"Attest Canonical Maintenance Binding","success","2026-09-14T14:26:04Z","2026-09-14T14:26:05Z"],[27,"Upload Backup Failure Diagnostics","skipped","2026-09-14T14:26:05Z","2026-09-14T14:26:05Z"],[28,"Remove Temporary Backup And Exact Source","success","2026-09-14T14:26:05Z","2026-09-14T14:26:06Z"],[56,"Post Checkout Exact Backup Source","success","2026-09-14T14:26:06Z","2026-09-14T14:26:06Z"],[57,"Complete job","success","2026-09-14T14:26:06Z","2026-09-14T14:26:06Z"]]}],"artifacts":[{"id":10353140052,"name":"faolla-maintenance-backup-binding-34852696974-1","size_in_bytes":411,"digest":"sha256:8b025ca93ddd095356c0aa6c8766081877e62555ef7eac034a975cf7f8122337","expired":false,"created_at":"2026-09-14T14:26:04Z","updated_at":"2026-09-14T14:26:04Z","expires_at":"2026-09-21T14:26:04Z","workflow_run":{"id":34852696974,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}},{"id":10353045147,"name":"faolla-encrypted-backup-attestation-bundle-34852696974-1","size_in_bytes":7519,"digest":"sha256:16fc57949fcf8788e398d7597a4c85605e75d41817979b88d09008fc78c80ad2","expired":false,"created_at":"2026-09-14T14:25:47Z","updated_at":"2026-09-14T14:25:47Z","expires_at":"2026-09-21T14:25:47Z","workflow_run":{"id":34852696974,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}},{"id":10353006038,"name":"faolla-backup-verification-reports-34852696974-1","size_in_bytes":8155,"digest":"sha256:70b65677b19bdb181f0c4968bd941be7198c4267a889fb97b0adffd18b013a2f","expired":false,"created_at":"2026-09-14T14:25:43Z","updated_at":"2026-09-14T14:25:43Z","expires_at":"2026-09-21T14:25:43Z","workflow_run":{"id":34852696974,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}},{"id":10352684487,"name":"faolla-encrypted-disaster-recovery-34852696974-1","size_in_bytes":505784526,"digest":"sha256:d9c363696db666127c457709e709f2f7981121c6ee3629726aa3bce097e36546","expired":false,"created_at":"2026-09-14T14:25:41Z","updated_at":"2026-09-14T14:25:41Z","expires_at":"2026-09-21T14:25:38Z","workflow_run":{"id":34852696974,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}},{"id":10351839950,"name":"faolla-production-backup-attestation-bundle-34852696974-1","size_in_bytes":6805,"digest":"sha256:d3d4a8843548e231a8da96c2c0ab5e42326bce07a242ca2d11be0f0149ec7459","expired":false,"created_at":"2026-09-14T14:25:48Z","updated_at":"2026-09-14T14:25:48Z","expires_at":"2026-09-21T14:25:47Z","workflow_run":{"id":34852696974,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}},{"id":10351834945,"name":"faolla-production-backup-attestation-34852696974-1","size_in_bytes":1066,"digest":"sha256:9a968a34ab255f65b2239bbd0ae9ac70c9723d983ffb4b17ae1ceb7168dc0aea","expired":false,"created_at":"2026-09-14T14:25:42Z","updated_at":"2026-09-14T14:25:42Z","expires_at":"2026-09-21T14:25:42Z","workflow_run":{"id":34852696974,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}}]},{"run":{"id":34855754738,"name":"Ordinary Account Cutover Readiness","path":".github/workflows/ordinary-account-cutover-readiness.yml","event":"workflow_dispatch","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T14:27:43Z","run_started_at":"2026-09-14T14:27:43Z","updated_at":"2026-09-14T14:29:10Z"},"jobs":[{"id":104014757544,"name":"readiness","run_id":34855754738,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T14:27:47Z","completed_at":"2026-09-14T14:29:09Z","steps":[[1,"Set up job","success","2026-09-14T14:27:48Z","2026-09-14T14:27:50Z"],[2,"Validate Manual Release Chain","success","2026-09-14T14:27:50Z","2026-09-14T14:27:54Z"],[3,"Checkout Exact Readiness Source","success","2026-09-14T14:27:54Z","2026-09-14T14:28:01Z"],[4,"Verify Exact Current Main Checkout","success","2026-09-14T14:28:01Z","2026-09-14T14:28:01Z"],[5,"Resolve Exact Successful Backup Artifact Inventory","success","2026-09-14T14:28:01Z","2026-09-14T14:28:02Z"],[6,"Verify Recursive Backup Attestation Chain","success","2026-09-14T14:28:02Z","2026-09-14T14:28:07Z"],[7,"Verify Signed Backup Maintenance Binding","success","2026-09-14T14:28:07Z","2026-09-14T14:28:11Z"],[8,"Setup Pinned SSH Host Trust","success","2026-09-14T14:28:11Z","2026-09-14T14:28:11Z"],[9,"Prepare Remote Detached Exact Source","success","2026-09-14T14:28:11Z","2026-09-14T14:28:16Z"],[10,"Verify Held Maintenance Before Readiness","success","2026-09-14T14:28:16Z","2026-09-14T14:28:32Z"],[11,"Inspect Locked Production Readiness From Exact Source","success","2026-09-14T14:28:32Z","2026-09-14T14:28:36Z"],[12,"Upload Canonical Readiness Report","success","2026-09-14T14:28:36Z","2026-09-14T14:28:37Z"],[13,"Verify Uploaded Readiness Report Artifact","success","2026-09-14T14:28:37Z","2026-09-14T14:28:37Z"],[14,"Enforce Ready Cutover State","success","2026-09-14T14:28:37Z","2026-09-14T14:28:37Z"],[15,"Build Canonical Readiness Attestation","success","2026-09-14T14:28:37Z","2026-09-14T14:28:38Z"],[16,"Upload Canonical Readiness Attestation","success","2026-09-14T14:28:38Z","2026-09-14T14:28:39Z"],[17,"Verify Uploaded Readiness Attestation Artifact","success","2026-09-14T14:28:39Z","2026-09-14T14:28:39Z"],[18,"Attest Canonical Readiness Report","success","2026-09-14T14:28:39Z","2026-09-14T14:28:42Z"],[19,"Attest Canonical Readiness Attestation","success","2026-09-14T14:28:42Z","2026-09-14T14:28:44Z"],[20,"Verify Held Maintenance After Readiness","success","2026-09-14T14:28:44Z","2026-09-14T14:28:59Z"],[21,"Build Canonical Maintenance Binding","success","2026-09-14T14:28:59Z","2026-09-14T14:28:59Z"],[22,"Upload Canonical Maintenance Binding","success","2026-09-14T14:28:59Z","2026-09-14T14:29:01Z"],[23,"Attest Canonical Maintenance Binding","success","2026-09-14T14:29:01Z","2026-09-14T14:29:03Z"],[24,"Confirm Exact Successful Readiness Artifact Inventory","success","2026-09-14T14:29:03Z","2026-09-14T14:29:03Z"],[25,"Remove Remote Exact Readiness Source","success","2026-09-14T14:29:03Z","2026-09-14T14:29:06Z"],[50,"Post Checkout Exact Readiness Source","success","2026-09-14T14:29:06Z","2026-09-14T14:29:06Z"],[51,"Complete job","success","2026-09-14T14:29:06Z","2026-09-14T14:29:06Z"]]}],"artifacts":[{"id":10353335417,"name":"faolla-maintenance-readiness-binding-34855754738-1","size_in_bytes":412,"digest":"sha256:438fd5e5902e5afbb63a4c0a9511970faac362192f9a23ed7bf32e30372ea46b","expired":false,"created_at":"2026-09-14T14:29:01Z","updated_at":"2026-09-14T14:29:01Z","expires_at":"2026-09-21T14:29:00Z","workflow_run":{"id":34855754738,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}},{"id":10353195462,"name":"faolla-production-readiness-attestation-34855754738-1","size_in_bytes":4573,"digest":"sha256:64fec2d2607e67d835852473ef4a32a50450d21a356e52ab231da4efd01b6df1","expired":false,"created_at":"2026-09-14T14:28:39Z","updated_at":"2026-09-14T14:28:39Z","expires_at":"2026-09-15T14:28:38Z","workflow_run":{"id":34855754738,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}},{"id":10353130563,"name":"faolla-production-readiness-report-34855754738-1","size_in_bytes":1241,"digest":"sha256:e6aa5c78fbef694fe0ead98f862cbe2f8f8be5869258b9093b638c465993ce9b","expired":false,"created_at":"2026-09-14T14:28:37Z","updated_at":"2026-09-14T14:28:37Z","expires_at":"2026-09-15T14:28:36Z","workflow_run":{"id":34855754738,"repository_id":1146364565,"head_repository_id":1146364565,"head_branch":"main","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7"}}]},{"run":{"id":34855913697,"name":"Deploy Production","path":".github/workflows/deploy.yml","event":"workflow_run","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"failure","created_at":"2026-09-14T14:29:12Z","run_started_at":"2026-09-14T14:29:12Z","updated_at":"2026-09-14T14:38:53Z"},"jobs":[{"id":104015308425,"name":"deploy","run_id":34855913697,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"failure","started_at":"2026-09-14T14:29:15Z","completed_at":"2026-09-14T14:38:52Z","steps":[[1,"Set up job","success","2026-09-14T14:29:16Z","2026-09-14T14:29:17Z"],[2,"Validate Readiness Workflow Run","success","2026-09-14T14:29:17Z","2026-09-14T14:29:18Z"],[3,"Checkout Tested Commit","success","2026-09-14T14:29:18Z","2026-09-14T14:29:21Z"],[4,"Resolve Deploy Commit","success","2026-09-14T14:29:21Z","2026-09-14T14:29:21Z"],[5,"Resolve Readiness Artifacts","success","2026-09-14T14:29:21Z","2026-09-14T14:29:22Z"],[6,"Verify Readiness Evidence","success","2026-09-14T14:29:22Z","2026-09-14T14:29:29Z"],[7,"Revalidate Live Recursive Backup Evidence","success","2026-09-14T14:29:29Z","2026-09-14T14:29:31Z"],[8,"Verify Signed Readiness Maintenance Binding","success","2026-09-14T14:29:31Z","2026-09-14T14:29:35Z"],[9,"Export Verified Maintenance Binding","success","2026-09-14T14:29:35Z","2026-09-14T14:29:35Z"],[10,"Setup SSH","success","2026-09-14T14:29:35Z","2026-09-14T14:29:35Z"],[11,"Deploy To Server","failure","2026-09-14T14:29:35Z","2026-09-14T14:38:50Z"],[12,"Verify Public Release","skipped","2026-09-14T14:38:50Z","2026-09-14T14:38:50Z"],[13,"Verify Candidate While Public Entry Remains Held","skipped","2026-09-14T14:38:50Z","2026-09-14T14:38:50Z"],[14,"Build Canonical Maintenance Binding","skipped","2026-09-14T14:38:50Z","2026-09-14T14:38:50Z"],[15,"Upload Canonical Maintenance Binding","skipped","2026-09-14T14:38:50Z","2026-09-14T14:38:50Z"],[16,"Attest Canonical Maintenance Binding","skipped","2026-09-14T14:38:50Z","2026-09-14T14:38:50Z"],[32,"Post Checkout Tested Commit","success","2026-09-14T14:38:50Z","2026-09-14T14:38:50Z"],[33,"Complete job","success","2026-09-14T14:38:50Z","2026-09-14T14:38:50Z"]]}],"artifacts":[]},{"run":{"id":34852190872,"name":"Production Maintenance","path":".github/workflows/production-maintenance.yml","event":"workflow_dispatch","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T13:54:41Z","run_started_at":"2026-09-14T13:54:41Z","updated_at":"2026-09-14T13:58:10Z"},"jobs":[{"id":104002643576,"name":"maintenance","run_id":34852190872,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:54:45Z","completed_at":"2026-09-14T13:58:09Z","steps":[[1,"Set up job","success","2026-09-14T13:54:46Z","2026-09-14T13:54:47Z"],[2,"Validate Fixed Manual Transition","success","2026-09-14T13:54:47Z","2026-09-14T13:54:47Z"],[3,"Checkout Exact Maintenance Source","success","2026-09-14T13:54:47Z","2026-09-14T13:54:52Z"],[4,"Require Current Main And Exact Successful Push CI","success","2026-09-14T13:54:52Z","2026-09-14T13:54:53Z"],[5,"Require Exact Successful Maintenance Deploy Before End","skipped","2026-09-14T13:54:53Z","2026-09-14T13:54:53Z"],[6,"Verify Signed Deploy Maintenance Binding","skipped","2026-09-14T13:54:53Z","2026-09-14T13:54:53Z"],[7,"Setup Pinned SSH Trust","success","2026-09-14T13:54:53Z","2026-09-14T13:54:53Z"],[8,"Prepare Remote Detached Exact Control Source","success","2026-09-14T13:54:53Z","2026-09-14T13:54:58Z"],[9,"Inspect Original Failed Held Recovery State","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[10,"Verify Complete Recovery History Under Production Lock","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[11,"Inspect Migrated Unlaunched Continuation State","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[12,"Verify Original Signed Backup And Readiness Bindings","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[13,"Verify Exact Continuation History Under Production Lock","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[14,"Inspect Failed Unlaunched Build Recovery State","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[15,"Verify Build Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[16,"Verify Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[17,"Verify Exact Build Recovery History Under Production Lock","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[18,"Verify Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[19,"Verify Attempt Recovery Historical Additional Backup","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[20,"Inspect Stopped Launched Candidate Recovery State","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[21,"Verify Exact Single Attempt Recovery History Under Production Lock","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[22,"Verify Second Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[23,"Verify Second Attempt Recovery Historical Additional Backup","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[24,"Inspect Stopped Second Launched Candidate Recovery State","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[25,"Verify Exact Second Attempt Recovery History Under Production Lock","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[26,"Verify Budget Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[27,"Verify Budget Recovery Historical Additional Backup","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[28,"Inspect Stopped Budget Candidate Recovery State","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[29,"Verify Exact Budget Recovery History Under Production Lock","skipped","2026-09-14T13:54:58Z","2026-09-14T13:54:58Z"],[30,"Inspect Unused Window Renewal State","success","2026-09-14T13:54:58Z","2026-09-14T13:55:17Z"],[31,"Verify Exact Window Renewal History Under Production Lock","success","2026-09-14T13:55:17Z","2026-09-14T13:57:30Z"],[32,"Execute Fixed Maintenance Transition","success","2026-09-14T13:57:30Z","2026-09-14T13:58:05Z"],[33,"Verify Real Public Release After End","skipped","2026-09-14T13:58:05Z","2026-09-14T13:58:05Z"],[34,"Reclose Entry And Fail Held If End Is Unconfirmed","skipped","2026-09-14T13:58:05Z","2026-09-14T13:58:05Z"],[35,"Remove Exact Temporary Control Source","success","2026-09-14T13:58:05Z","2026-09-14T13:58:07Z"],[36,"Remove Runner Recovery Inspection","skipped","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[37,"Remove Runner Continuation Evidence","skipped","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[38,"Remove Runner Build Recovery Evidence","skipped","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[39,"Remove Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[40,"Remove Runner Attempt Recovery Evidence","skipped","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[41,"Remove Runner Second Attempt Recovery Evidence","skipped","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[42,"Remove Runner Budget Recovery Evidence","skipped","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[43,"Remove Runner Window Renewal Evidence","success","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[44,"Remove Runner SSH Material","success","2026-09-14T13:58:07Z","2026-09-14T13:58:07Z"],[88,"Post Checkout Exact Maintenance Source","success","2026-09-14T13:58:07Z","2026-09-14T13:58:08Z"],[89,"Complete job","success","2026-09-14T13:58:08Z","2026-09-14T13:58:08Z"]]}],"artifacts":[]},{"run":{"id":34850320013,"name":"CI","path":".github/workflows/ci.yml","event":"push","head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","head_branch":"main","run_attempt":1,"status":"completed","conclusion":"success","created_at":"2026-09-14T13:36:48Z","run_started_at":"2026-09-14T13:36:48Z","updated_at":"2026-09-14T13:54:08Z"},"jobs":[{"id":103996313952,"name":"Isolated Supabase Scheduler Acceptance","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:36:51Z","completed_at":"2026-09-14T13:38:39Z"},{"id":103996314412,"name":"Isolated Maintenance Ingress Acceptance","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:36:51Z","completed_at":"2026-09-14T13:37:33Z"},{"id":103996314432,"name":"Quality","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:36:52Z","completed_at":"2026-09-14T13:51:06Z"},{"id":104001378042,"name":"Order Membership PostgreSQL Acceptance","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:51:09Z","completed_at":"2026-09-14T13:51:55Z"},{"id":104001378181,"name":"Pages Client Write ACL PostgreSQL Acceptance","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:51:09Z","completed_at":"2026-09-14T13:51:38Z"},{"id":104001378184,"name":"Redemption PostgreSQL Acceptance","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:51:09Z","completed_at":"2026-09-14T13:51:57Z"},{"id":104001378249,"name":"QR Atomic PostgreSQL Acceptance","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:51:10Z","completed_at":"2026-09-14T13:51:42Z"},{"id":104001378258,"name":"Recovery Content PostgreSQL Acceptance","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:51:09Z","completed_at":"2026-09-14T13:51:38Z"},{"id":104001378390,"name":"Checkout Context PostgreSQL Acceptance","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:51:09Z","completed_at":"2026-09-14T13:52:08Z"},{"id":104001378394,"name":"Enterprise Browser Journeys","run_id":34850320013,"head_sha":"67ddb91bf618e9716b79df6bf97f08d3865919b7","status":"completed","conclusion":"success","started_at":"2026-09-14T13:51:09Z","completed_at":"2026-09-14T13:54:07Z"}],"artifacts":[]}]);
const [BACKUP, READINESS, DEPLOY, RECOVERY, PRIOR_CI] = MAINTENANCE_PRELAUNCH_RECOVERY_PRIOR_RUNS;
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
export async function inspectMaintenancePrelaunchRecoveryHistory(inspection, api, now, currentRunId, observedClock = Date.now) {
  const checked = validateMaintenancePrelaunchRecoveryInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (typeof api !== "function" || !ID.test(currentRunId ?? "") || MAINTENANCE_PRELAUNCH_RECOVERY_PRIOR_RUNS.some(spec => String(spec.run.id) === currentRunId)) fail();
  const first = await scan(checked, api, now, currentRunId, observedClock);
  const records = [];
  for (const spec of MAINTENANCE_PRELAUNCH_RECOVERY_PRIOR_RUNS) records.push(await fixedRun(spec, api));
  const second = await scan(checked, api, now, currentRunId, observedClock);
  if (hash(first) !== hash(second)) fail();
  for (let index = 0; index < records.length; index++)
    if (hash(await fixedRun(MAINTENANCE_PRELAUNCH_RECOVERY_PRIOR_RUNS[index], api)) !== hash(records[index])) fail();
  observationTime(now, observedClock);
  return { predecessorStateDigest: checked.stateDigest, cutoff: CUTOFF, historyPurpose: "prelaunch-recovery-only",
    failedDeployPurpose: "historical-prelaunch-failure-not-successful-deploy", rows: first, records };
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
export async function createMaintenancePrelaunchRecoveryWorkflowEvidence(inspection, env, api, now = Date.now(), observedClock = Date.now) {
  const checked = validateMaintenancePrelaunchRecoveryInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_SHA !== checked.targetSha ||
      env.TARGET_SHA !== checked.targetSha || env.PREVIOUS_TARGET_SHA !== PRIOR || env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha ||
      env.EXPECTED_OLD_SHA !== checked.expectedOldSha || env.MAINTENANCE_OPERATION_ID !== checked.operationId ||
      env.ACTION !== "recover-prelaunch" || env.CONFIRMATION !== "RECOVER_PRELAUNCH_PRODUCTION_MAINTENANCE_UNTIL_20260914T200000Z") fail();
  if (checked.stoppedBaseline.observedAt > now || now - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const ci = await currentCI(checked, api, now);
  if (String(ci.run.id) === env.GITHUB_RUN_ID) fail();
  const history = await inspectMaintenancePrelaunchRecoveryHistory(checked, api, now, env.GITHUB_RUN_ID, observedClock);
  const current = checkCurrent(await api(`repos/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`), checked, env.GITHUB_RUN_ID, observationTime(now, observedClock));
  if (hash(current) !== hash(history.rows.find(row => String(row.run.id) === env.GITHUB_RUN_ID)?.run)) fail();
  if (timestamp(current.created_at) < timestamp(ci.run.updated_at)) fail();
  if (hash(await currentCI(checked, api, now)) !== hash(ci) || (await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const completedAt = observationTime(now, observedClock);
  if (completedAt - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  return validateMaintenancePrelaunchRecoveryEvidence({ ...checked, toolsSha: checked.targetSha,
    prelaunchRecoveryRunId: env.GITHUB_RUN_ID, prelaunchRecoveryRunAttempt: 1, mainCIrunId: String(ci.run.id),
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
    const evidence = await createMaintenancePrelaunchRecoveryWorkflowEvidence(inspection, process.env, api);
    const completedAt = Date.now(); clock(completedAt);
    if (completedAt < evidence.historyCheckedAt || completedAt - evidence.historyCheckedAt > MAX_AGE ||
        completedAt < evidence.stoppedBaseline.observedAt || completedAt - evidence.stoppedBaseline.observedAt > MAX_AGE) fail();
    const encoded = encodeMaintenancePrelaunchRecoveryEvidence(evidence);
    process.stdout.write(`::add-mask::${encoded}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `prelaunch_recovery_evidence=${encoded}\n`);
    process.stdout.write("maintenance_prelaunch_recovery_history_verified\n");
  } catch { process.stderr.write("maintenance_prelaunch_recovery_workflow_unverified\n"); process.exitCode = 1; }
}


