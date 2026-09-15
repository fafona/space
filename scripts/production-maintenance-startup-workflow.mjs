import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  validateMaintenanceLeaseInspection, validateMaintenanceLeaseEvidence, encodeMaintenanceLeaseEvidence,
  
} from "./production-maintenance-lease.mjs";
import { MAINTENANCE_STARTUP_AUTHORIZATION as AUTHORIZATION } from "./production-maintenance-startup-recovery.mjs";

const MAX_AGE = 300000;
const REPOSITORY = "fafona/space", PRIOR = "e83c91abbf8e0d327708bd0b04c3a33ed423ab91";
const SHA = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]*$/;
const fail = () => { throw new Error("maintenance_startup_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
// Exact completed B13/R13/D13/recovery/CI records. The consumed predecessor
// and all earlier immutable audit records stay in private state. Historical
// backup metadata does not authorize a new deployment or restore.
export const MAINTENANCE_STARTUP_PRIOR_RUNS = freeze([{"run":{"conclusion":"success","created_at":"2026-09-15T00:19:24Z","event":"workflow_dispatch","head_branch":"main","head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34912699233,"name":"Encrypted Database Backup","path":".github/workflows/database-backup.yml","run_attempt":1,"run_started_at":"2026-09-15T00:19:24Z","status":"completed","updated_at":"2026-09-15T00:36:51Z"},"jobs":[{"id":104203500676,"name":"backup","run_id":34912699233,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:19:27Z","completed_at":"2026-09-15T00:36:49Z","steps":[[1,"Set up job","success","2026-09-15T00:19:28Z","2026-09-15T00:19:29Z"],[2,"Checkout Exact Backup Source","success","2026-09-15T00:19:29Z","2026-09-15T00:19:36Z"],[3,"Verify Current Main And Exact Successful Push CI","success","2026-09-15T00:19:36Z","2026-09-15T00:19:36Z"],[4,"Setup Pinned SSH Host Trust","success","2026-09-15T00:19:36Z","2026-09-15T00:19:38Z"],[5,"Prepare Remote Detached Exact Source","success","2026-09-15T00:19:38Z","2026-09-15T00:19:40Z"],[6,"Verify Held Maintenance Before Backup","success","2026-09-15T00:19:40Z","2026-09-15T00:20:01Z"],[7,"Verify Backup Configuration From Exact Source","success","2026-09-15T00:20:01Z","2026-09-15T00:20:02Z"],[8,"Create Encrypted Database Backup From Exact Source","success","2026-09-15T00:20:02Z","2026-09-15T00:20:31Z"],[9,"Verify Held Maintenance After Backup Capture","success","2026-09-15T00:20:31Z","2026-09-15T00:20:51Z"],[10,"Transfer Complete Encrypted Backup","success","2026-09-15T00:20:51Z","2026-09-15T00:34:45Z"],[11,"Verify Encrypted Backup","success","2026-09-15T00:34:45Z","2026-09-15T00:34:51Z"],[12,"Rehearse Isolated Restore","success","2026-09-15T00:34:51Z","2026-09-15T00:36:09Z"],[13,"Confirm Backup Is Ready For Upload","success","2026-09-15T00:36:09Z","2026-09-15T00:36:10Z"],[14,"Upload Verified Encrypted Backup","success","2026-09-15T00:36:10Z","2026-09-15T00:36:14Z"],[15,"Verify Uploaded Backup Artifact Identity","success","2026-09-15T00:36:14Z","2026-09-15T00:36:14Z"],[16,"Generate Backup Attestation Predicate","success","2026-09-15T00:36:14Z","2026-09-15T00:36:15Z"],[17,"Upload Canonical Backup Attestation Input","success","2026-09-15T00:36:15Z","2026-09-15T00:36:16Z"],[18,"Upload Backup Verification And Attestation Inputs","success","2026-09-15T00:36:16Z","2026-09-15T00:36:16Z"],[19,"Attest Verified Encrypted Backup","success","2026-09-15T00:36:16Z","2026-09-15T00:36:19Z"],[20,"Attest Canonical Backup Attestation Input","success","2026-09-15T00:36:19Z","2026-09-15T00:36:20Z"],[21,"Upload Encrypted Backup Attestation Bundle","success","2026-09-15T00:36:20Z","2026-09-15T00:36:21Z"],[22,"Upload Canonical Backup Attestation Bundle","success","2026-09-15T00:36:21Z","2026-09-15T00:36:22Z"],[23,"Verify Held Maintenance Before Backup Attestation","success","2026-09-15T00:36:22Z","2026-09-15T00:36:42Z"],[24,"Build Canonical Maintenance Binding","success","2026-09-15T00:36:42Z","2026-09-15T00:36:43Z"],[25,"Upload Canonical Maintenance Binding","success","2026-09-15T00:36:43Z","2026-09-15T00:36:43Z"],[26,"Attest Canonical Maintenance Binding","success","2026-09-15T00:36:43Z","2026-09-15T00:36:47Z"],[27,"Upload Backup Failure Diagnostics","skipped","2026-09-15T00:36:47Z","2026-09-15T00:36:47Z"],[28,"Remove Temporary Backup And Exact Source","success","2026-09-15T00:36:47Z","2026-09-15T00:36:47Z"],[56,"Post Checkout Exact Backup Source","success","2026-09-15T00:36:47Z","2026-09-15T00:36:47Z"],[57,"Complete job","success","2026-09-15T00:36:47Z","2026-09-15T00:36:47Z"]]}],"artifacts":[{"id":10375910137,"name":"faolla-production-backup-attestation-34912699233-1","size_in_bytes":1065,"expired":false,"created_at":"2026-09-15T00:36:16Z","updated_at":"2026-09-15T00:36:16Z","expires_at":"2026-09-22T00:36:15Z","digest":"sha256:dc52c1874737d8d377f821eb40ab06ef9408109445311ea6903ea3e7b993611b","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34912699233,"repository_id":1146364565}},{"id":10375811835,"name":"faolla-production-backup-attestation-bundle-34912699233-1","size_in_bytes":6904,"expired":false,"created_at":"2026-09-15T00:36:21Z","updated_at":"2026-09-15T00:36:21Z","expires_at":"2026-09-22T00:36:21Z","digest":"sha256:9958bbb39f719814f694f5a3b61b46544eabb807cb56fe41c01c5ca6393569a3","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34912699233,"repository_id":1146364565}},{"id":10375672107,"name":"faolla-encrypted-backup-attestation-bundle-34912699233-1","size_in_bytes":7702,"expired":false,"created_at":"2026-09-15T00:36:21Z","updated_at":"2026-09-15T00:36:21Z","expires_at":"2026-09-22T00:36:20Z","digest":"sha256:76cecbd79956ea965d97043e383734457d79a843fb00950649ddc5c5abb90897","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34912699233,"repository_id":1146364565}},{"id":10375667217,"name":"faolla-encrypted-disaster-recovery-34912699233-1","size_in_bytes":505784526,"expired":false,"created_at":"2026-09-15T00:36:14Z","updated_at":"2026-09-15T00:36:14Z","expires_at":"2026-09-22T00:36:10Z","digest":"sha256:35faa80bbe4c03940898def2507fe24d80a10ad6e378f48181e9d2b5a8125cd2","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34912699233,"repository_id":1146364565}},{"id":10375537604,"name":"faolla-backup-verification-reports-34912699233-1","size_in_bytes":8150,"expired":false,"created_at":"2026-09-15T00:36:16Z","updated_at":"2026-09-15T00:36:16Z","expires_at":"2026-09-22T00:36:16Z","digest":"sha256:404c06f6677b08a95c234460b5eb0b7ebcbe80352c3440567fcdbc2fbaa7282d","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34912699233,"repository_id":1146364565}},{"id":10375084127,"name":"faolla-maintenance-backup-binding-34912699233-1","size_in_bytes":410,"expired":false,"created_at":"2026-09-15T00:36:43Z","updated_at":"2026-09-15T00:36:43Z","expires_at":"2026-09-22T00:36:43Z","digest":"sha256:010fbb11dc44e5f0570258235e476a0c4cf9a30b6fe8e5c768eaf9ad996afb06","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34912699233,"repository_id":1146364565}}]},{"run":{"conclusion":"success","created_at":"2026-09-15T00:37:47Z","event":"workflow_dispatch","head_branch":"main","head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34913966644,"name":"Ordinary Account Cutover Readiness","path":".github/workflows/ordinary-account-cutover-readiness.yml","run_attempt":1,"run_started_at":"2026-09-15T00:37:47Z","status":"completed","updated_at":"2026-09-15T00:39:21Z"},"jobs":[{"id":104207420911,"name":"readiness","run_id":34913966644,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:37:51Z","completed_at":"2026-09-15T00:39:20Z","steps":[[1,"Set up job","success","2026-09-15T00:37:52Z","2026-09-15T00:37:53Z"],[2,"Validate Manual Release Chain","success","2026-09-15T00:37:53Z","2026-09-15T00:37:55Z"],[3,"Checkout Exact Readiness Source","success","2026-09-15T00:37:55Z","2026-09-15T00:38:02Z"],[4,"Verify Exact Current Main Checkout","success","2026-09-15T00:38:02Z","2026-09-15T00:38:03Z"],[5,"Resolve Exact Successful Backup Artifact Inventory","success","2026-09-15T00:38:03Z","2026-09-15T00:38:04Z"],[6,"Verify Recursive Backup Attestation Chain","success","2026-09-15T00:38:04Z","2026-09-15T00:38:08Z"],[7,"Verify Signed Backup Maintenance Binding","success","2026-09-15T00:38:08Z","2026-09-15T00:38:13Z"],[8,"Setup Pinned SSH Host Trust","success","2026-09-15T00:38:13Z","2026-09-15T00:38:13Z"],[9,"Prepare Remote Detached Exact Source","success","2026-09-15T00:38:13Z","2026-09-15T00:38:18Z"],[10,"Verify Held Maintenance Before Readiness","success","2026-09-15T00:38:18Z","2026-09-15T00:38:38Z"],[11,"Inspect Locked Production Readiness From Exact Source","success","2026-09-15T00:38:38Z","2026-09-15T00:38:42Z"],[12,"Upload Canonical Readiness Report","success","2026-09-15T00:38:42Z","2026-09-15T00:38:43Z"],[13,"Verify Uploaded Readiness Report Artifact","success","2026-09-15T00:38:43Z","2026-09-15T00:38:43Z"],[14,"Enforce Ready Cutover State","success","2026-09-15T00:38:43Z","2026-09-15T00:38:43Z"],[15,"Build Canonical Readiness Attestation","success","2026-09-15T00:38:43Z","2026-09-15T00:38:44Z"],[16,"Upload Canonical Readiness Attestation","success","2026-09-15T00:38:44Z","2026-09-15T00:38:45Z"],[17,"Verify Uploaded Readiness Attestation Artifact","success","2026-09-15T00:38:45Z","2026-09-15T00:38:45Z"],[18,"Attest Canonical Readiness Report","success","2026-09-15T00:38:45Z","2026-09-15T00:38:48Z"],[19,"Attest Canonical Readiness Attestation","success","2026-09-15T00:38:48Z","2026-09-15T00:38:52Z"],[20,"Verify Held Maintenance After Readiness","success","2026-09-15T00:38:52Z","2026-09-15T00:39:12Z"],[21,"Build Canonical Maintenance Binding","success","2026-09-15T00:39:12Z","2026-09-15T00:39:12Z"],[22,"Upload Canonical Maintenance Binding","success","2026-09-15T00:39:12Z","2026-09-15T00:39:13Z"],[23,"Attest Canonical Maintenance Binding","success","2026-09-15T00:39:13Z","2026-09-15T00:39:15Z"],[24,"Confirm Exact Successful Readiness Artifact Inventory","success","2026-09-15T00:39:15Z","2026-09-15T00:39:16Z"],[25,"Remove Remote Exact Readiness Source","success","2026-09-15T00:39:16Z","2026-09-15T00:39:18Z"],[50,"Post Checkout Exact Readiness Source","success","2026-09-15T00:39:18Z","2026-09-15T00:39:18Z"],[51,"Complete job","success","2026-09-15T00:39:18Z","2026-09-15T00:39:18Z"]]}],"artifacts":[{"id":10375712534,"name":"faolla-production-readiness-attestation-34913966644-1","size_in_bytes":4573,"expired":false,"created_at":"2026-09-15T00:38:45Z","updated_at":"2026-09-15T00:38:45Z","expires_at":"2026-09-16T00:38:44Z","digest":"sha256:c6baf2f399eff9948a022fddb94d4a6d59dc04fdd35fbb15c551720dff7d42cb","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34913966644,"repository_id":1146364565}},{"id":10375712532,"name":"faolla-production-readiness-report-34913966644-1","size_in_bytes":1241,"expired":false,"created_at":"2026-09-15T00:38:43Z","updated_at":"2026-09-15T00:38:43Z","expires_at":"2026-09-16T00:38:42Z","digest":"sha256:9f99a7547e27c483448c18143f78e8e6ed0f9111e6b8d74031eb5ee3f64df22e","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34913966644,"repository_id":1146364565}},{"id":10375373478,"name":"faolla-maintenance-readiness-binding-34913966644-1","size_in_bytes":411,"expired":false,"created_at":"2026-09-15T00:39:13Z","updated_at":"2026-09-15T00:39:13Z","expires_at":"2026-09-22T00:39:12Z","digest":"sha256:1c51a07a8c608ebaf955b33d9a0098b444f682c65968bdc42101eb292ed999e2","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34913966644,"repository_id":1146364565}}]},{"run":{"conclusion":"failure","created_at":"2026-09-15T00:39:22Z","event":"workflow_run","head_branch":"main","head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34914073158,"name":"Deploy Production","path":".github/workflows/deploy.yml","run_attempt":1,"run_started_at":"2026-09-15T00:39:22Z","status":"completed","updated_at":"2026-09-15T00:51:51Z"},"jobs":[{"id":104207749251,"name":"deploy","run_id":34914073158,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"failure","started_at":"2026-09-15T00:39:25Z","completed_at":"2026-09-15T00:51:50Z","steps":[[1,"Set up job","success","2026-09-15T00:39:26Z","2026-09-15T00:39:28Z"],[2,"Validate Readiness Workflow Run","success","2026-09-15T00:39:28Z","2026-09-15T00:39:29Z"],[3,"Checkout Tested Commit","success","2026-09-15T00:39:29Z","2026-09-15T00:39:34Z"],[4,"Resolve Deploy Commit","success","2026-09-15T00:39:34Z","2026-09-15T00:39:35Z"],[5,"Resolve Readiness Artifacts","success","2026-09-15T00:39:35Z","2026-09-15T00:39:35Z"],[6,"Verify Readiness Evidence","success","2026-09-15T00:39:35Z","2026-09-15T00:39:44Z"],[7,"Revalidate Live Recursive Backup Evidence","success","2026-09-15T00:39:44Z","2026-09-15T00:39:47Z"],[8,"Verify Signed Readiness Maintenance Binding","success","2026-09-15T00:39:47Z","2026-09-15T00:39:52Z"],[9,"Export Verified Maintenance Binding","success","2026-09-15T00:39:52Z","2026-09-15T00:39:52Z"],[10,"Setup SSH","success","2026-09-15T00:39:52Z","2026-09-15T00:39:52Z"],[11,"Deploy To Server","failure","2026-09-15T00:39:52Z","2026-09-15T00:51:48Z"],[12,"Verify Public Release","skipped","2026-09-15T00:51:48Z","2026-09-15T00:51:48Z"],[13,"Verify Candidate While Public Entry Remains Held","skipped","2026-09-15T00:51:48Z","2026-09-15T00:51:48Z"],[14,"Build Canonical Maintenance Binding","skipped","2026-09-15T00:51:48Z","2026-09-15T00:51:48Z"],[15,"Upload Canonical Maintenance Binding","skipped","2026-09-15T00:51:48Z","2026-09-15T00:51:48Z"],[16,"Attest Canonical Maintenance Binding","skipped","2026-09-15T00:51:48Z","2026-09-15T00:51:48Z"],[32,"Post Checkout Tested Commit","success","2026-09-15T00:51:48Z","2026-09-15T00:51:48Z"],[33,"Complete job","success","2026-09-15T00:51:48Z","2026-09-15T00:51:48Z"]]}],"artifacts":[]},{"run":{"conclusion":"success","created_at":"2026-09-15T00:13:03Z","event":"workflow_dispatch","head_branch":"main","head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34912253952,"name":"Production Maintenance","path":".github/workflows/production-maintenance.yml","run_attempt":1,"run_started_at":"2026-09-15T00:13:03Z","status":"completed","updated_at":"2026-09-15T00:17:22Z"},"jobs":[{"id":104202114290,"name":"maintenance","run_id":34912253952,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:13:07Z","completed_at":"2026-09-15T00:17:21Z","steps":[[1,"Set up job","success","2026-09-15T00:13:08Z","2026-09-15T00:13:08Z"],[2,"Validate Fixed Manual Transition","success","2026-09-15T00:13:08Z","2026-09-15T00:13:08Z"],[3,"Checkout Exact Maintenance Source","success","2026-09-15T00:13:08Z","2026-09-15T00:13:13Z"],[4,"Require Current Main And Exact Successful Push CI","success","2026-09-15T00:13:13Z","2026-09-15T00:13:15Z"],[5,"Require Exact Successful Maintenance Deploy Before End","skipped","2026-09-15T00:13:15Z","2026-09-15T00:13:15Z"],[6,"Verify Signed Deploy Maintenance Binding","skipped","2026-09-15T00:13:15Z","2026-09-15T00:13:15Z"],[7,"Setup Pinned SSH Trust","success","2026-09-15T00:13:15Z","2026-09-15T00:13:15Z"],[8,"Prepare Remote Detached Exact Control Source","success","2026-09-15T00:13:15Z","2026-09-15T00:13:20Z"],[9,"Inspect Original Failed Held Recovery State","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[10,"Verify Complete Recovery History Under Production Lock","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[11,"Inspect Migrated Unlaunched Continuation State","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[12,"Verify Original Signed Backup And Readiness Bindings","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[13,"Verify Exact Continuation History Under Production Lock","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[14,"Inspect Failed Unlaunched Build Recovery State","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[15,"Verify Build Incident Signed Backup And Readiness Bindings","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[16,"Verify Fixed Additional Scheduled Backup Evidence","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[17,"Verify Exact Build Recovery History Under Production Lock","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[18,"Verify Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[19,"Verify Attempt Recovery Historical Additional Backup","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[20,"Inspect Stopped Launched Candidate Recovery State","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[21,"Verify Exact Single Attempt Recovery History Under Production Lock","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[22,"Verify Second Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[23,"Verify Second Attempt Recovery Historical Additional Backup","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[24,"Inspect Stopped Second Launched Candidate Recovery State","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[25,"Verify Exact Second Attempt Recovery History Under Production Lock","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[26,"Verify Budget Incident Signed Backup And Readiness Bindings","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[27,"Verify Budget Recovery Historical Additional Backup","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[28,"Inspect Stopped Budget Candidate Recovery State","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[29,"Verify Exact Budget Recovery History Under Production Lock","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[30,"Inspect Unused Window Renewal State","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[31,"Verify Exact Window Renewal History Under Production Lock","skipped","2026-09-15T00:13:20Z","2026-09-15T00:13:20Z"],[32,"Inspect Unused Maintenance Lease State","success","2026-09-15T00:13:20Z","2026-09-15T00:13:54Z"],[33,"Verify Exact Lease Renewal History Under Production Lock","success","2026-09-15T00:13:54Z","2026-09-15T00:16:14Z"],[34,"Inspect Failed Unlaunched Preflight Recovery State","skipped","2026-09-15T00:16:14Z","2026-09-15T00:16:14Z"],[35,"Verify Exact Preflight Recovery History Under Production Lock","skipped","2026-09-15T00:16:14Z","2026-09-15T00:16:14Z"],[36,"Inspect Failed Unlaunched Prelaunch Recovery State","skipped","2026-09-15T00:16:14Z","2026-09-15T00:16:14Z"],[37,"Verify Exact Prelaunch Recovery History Under Production Lock","skipped","2026-09-15T00:16:14Z","2026-09-15T00:16:14Z"],[38,"Execute Fixed Maintenance Transition","success","2026-09-15T00:16:14Z","2026-09-15T00:17:16Z"],[39,"Verify Real Public Release After End","skipped","2026-09-15T00:17:16Z","2026-09-15T00:17:16Z"],[40,"Reclose Entry And Fail Held If End Is Unconfirmed","skipped","2026-09-15T00:17:16Z","2026-09-15T00:17:16Z"],[41,"Remove Exact Temporary Control Source","success","2026-09-15T00:17:16Z","2026-09-15T00:17:18Z"],[42,"Remove Runner Recovery Inspection","skipped","2026-09-15T00:17:18Z","2026-09-15T00:17:18Z"],[43,"Remove Runner Continuation Evidence","skipped","2026-09-15T00:17:18Z","2026-09-15T00:17:18Z"],[44,"Remove Runner Build Recovery Evidence","skipped","2026-09-15T00:17:18Z","2026-09-15T00:17:18Z"],[45,"Remove Fixed Additional Scheduled Backup Evidence","skipped","2026-09-15T00:17:18Z","2026-09-15T00:17:18Z"],[46,"Remove Runner Attempt Recovery Evidence","skipped","2026-09-15T00:17:18Z","2026-09-15T00:17:18Z"],[47,"Remove Runner Second Attempt Recovery Evidence","skipped","2026-09-15T00:17:18Z","2026-09-15T00:17:18Z"],[48,"Remove Runner Budget Recovery Evidence","skipped","2026-09-15T00:17:18Z","2026-09-15T00:17:18Z"],[49,"Remove Runner Window Renewal Evidence","skipped","2026-09-15T00:17:18Z","2026-09-15T00:17:18Z"],[50,"Remove Runner Lease Renewal Evidence","success","2026-09-15T00:17:18Z","2026-09-15T00:17:19Z"],[51,"Remove Runner Preflight Recovery Evidence","skipped","2026-09-15T00:17:19Z","2026-09-15T00:17:19Z"],[52,"Remove Runner Prelaunch Recovery Evidence","skipped","2026-09-15T00:17:19Z","2026-09-15T00:17:19Z"],[53,"Remove Runner SSH Material","success","2026-09-15T00:17:19Z","2026-09-15T00:17:19Z"],[106,"Post Checkout Exact Maintenance Source","success","2026-09-15T00:17:19Z","2026-09-15T00:17:19Z"],[107,"Complete job","success","2026-09-15T00:17:19Z","2026-09-15T00:17:19Z"]]}],"artifacts":[]},{"run":{"conclusion":"success","created_at":"2026-09-14T23:42:17Z","event":"push","head_branch":"main","head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","id":34910049238,"name":"CI","path":".github/workflows/ci.yml","run_attempt":1,"run_started_at":"2026-09-14T23:42:17Z","status":"completed","updated_at":"2026-09-15T00:12:27Z"},"jobs":[{"id":104195302271,"name":"Isolated Supabase Scheduler Acceptance","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-14T23:42:19Z","completed_at":"2026-09-14T23:43:43Z"},{"id":104195302482,"name":"Quality","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-14T23:42:19Z","completed_at":"2026-09-15T00:09:31Z"},{"id":104195302502,"name":"Isolated Maintenance Ingress Acceptance","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-14T23:42:20Z","completed_at":"2026-09-14T23:43:10Z"},{"id":104201314756,"name":"QR Atomic PostgreSQL Acceptance","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:09:33Z","completed_at":"2026-09-15T00:10:02Z"},{"id":104201314763,"name":"Pages Client Write ACL PostgreSQL Acceptance","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:09:33Z","completed_at":"2026-09-15T00:10:00Z"},{"id":104201314781,"name":"Recovery Content PostgreSQL Acceptance","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:09:34Z","completed_at":"2026-09-15T00:10:11Z"},{"id":104201314783,"name":"Checkout Context PostgreSQL Acceptance","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:09:34Z","completed_at":"2026-09-15T00:10:30Z"},{"id":104201314784,"name":"Enterprise Browser Journeys","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:09:34Z","completed_at":"2026-09-15T00:12:26Z"},{"id":104201314814,"name":"Order Membership PostgreSQL Acceptance","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:09:34Z","completed_at":"2026-09-15T00:10:19Z"},{"id":104201314849,"name":"Redemption PostgreSQL Acceptance","run_id":34910049238,"head_sha":"e83c91abbf8e0d327708bd0b04c3a33ed423ab91","status":"completed","conclusion":"success","started_at":"2026-09-15T00:09:33Z","completed_at":"2026-09-15T00:10:15Z"}]}]);
const [BACKUP, , , RECOVERY, PRIOR_CI] = MAINTENANCE_STARTUP_PRIOR_RUNS;
const RUN_KEYS = Object.keys(BACKUP.run);
const JOB_KEYS = Object.keys(BACKUP.jobs[0]).filter(key => key !== "steps");
const ARTIFACT_KEYS = ["id","name","size_in_bytes","expired","created_at","updated_at","expires_at","digest","workflow_run"];
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
function clock(now) { if (!Number.isSafeInteger(now) || now < AUTHORIZATION.authorizedAt) fail(); }
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
    artifacts = data.artifacts.map(value => ({ ...project(value, ARTIFACT_KEYS), workflow_run: project(value.workflow_run, ["head_branch", "head_repository_id", "head_sha", "id", "repository_id"]) })).sort((a, b) => a.id - b.id);
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
        const expected = MAINTENANCE_STARTUP_PRIOR_RUNS.filter(spec => spec.run.name !== "CI").find(spec => String(spec.run.id) === runId);
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
  if (foundFixed.size !== MAINTENANCE_STARTUP_PRIOR_RUNS.length - 1 || !foundCurrent) fail();
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.run.id - b.run.id);
}
export async function inspectMaintenanceStartupHistory(inspection, api, now, currentRunId, observedClock = Date.now) {
  const checked = validateMaintenanceLeaseInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (typeof api !== "function" || !ID.test(currentRunId ?? "") || MAINTENANCE_STARTUP_PRIOR_RUNS.some(spec => String(spec.run.id) === currentRunId)) fail();
  const first = await scan(checked, api, now, currentRunId, observedClock);
  const records = [];
  for (const spec of MAINTENANCE_STARTUP_PRIOR_RUNS) records.push(await fixedRun(spec, api));
  const second = await scan(checked, api, now, currentRunId, observedClock);
  if (hash(first) !== hash(second)) fail();
  for (let index = 0; index < records.length; index++)
    if (hash(await fixedRun(MAINTENANCE_STARTUP_PRIOR_RUNS[index], api)) !== hash(records[index])) fail();
  observationTime(now, observedClock);
  return { predecessorStateDigest: checked.stateDigest, cutoff: CUTOFF, historyPurpose: "fixed-consumed-startup-recovery",
    historicalBackupPurpose: "previous-target-only-not-new-deployment-evidence", rows: first, records };
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
export async function createMaintenanceStartupWorkflowEvidence(inspection, env, api, now = Date.now(), observedClock = Date.now) {
  const checked = validateMaintenanceLeaseInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_SHA !== checked.targetSha ||
      env.TARGET_SHA !== checked.targetSha || env.PREVIOUS_TARGET_SHA !== PRIOR || env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha ||
      env.EXPECTED_OLD_SHA !== checked.expectedOldSha || env.MAINTENANCE_OPERATION_ID !== checked.operationId ||
      !(env.ACTION === "recover-startup" && env.CONFIRMATION === "RECOVER_STOPPED_STARTUP_PRODUCTION_MAINTENANCE" && checked.state === "startup-recovery-inspected")) fail();
  if (checked.stoppedBaseline.observedAt > now || now - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const ci = await currentCI(checked, api, now);
  if (String(ci.run.id) === env.GITHUB_RUN_ID) fail();
  const history = await inspectMaintenanceStartupHistory(checked, api, now, env.GITHUB_RUN_ID, observedClock);
  const current = checkCurrent(await api(`repos/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`), checked, env.GITHUB_RUN_ID, observationTime(now, observedClock));
  if (hash(current) !== hash(history.rows.find(row => String(row.run.id) === env.GITHUB_RUN_ID)?.run)) fail();
  if (timestamp(current.created_at) < timestamp(ci.run.updated_at)) fail();
  if (hash(await currentCI(checked, api, now)) !== hash(ci) || (await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const completedAt = observationTime(now, observedClock);
  if (completedAt - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  return validateMaintenanceLeaseEvidence({ ...checked, toolsSha: checked.targetSha,
    leaseRunId: env.GITHUB_RUN_ID, leaseRunAttempt: 1, mainCIrunId: String(ci.run.id),
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
    const evidence = await createMaintenanceStartupWorkflowEvidence(inspection, process.env, api);
    const completedAt = Date.now(); clock(completedAt);
    if (completedAt < evidence.historyCheckedAt || completedAt - evidence.historyCheckedAt > MAX_AGE ||
        completedAt < evidence.stoppedBaseline.observedAt || completedAt - evidence.stoppedBaseline.observedAt > MAX_AGE) fail();
    const encoded = encodeMaintenanceLeaseEvidence(evidence);
    process.stdout.write(`::add-mask::${encoded}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `lease_evidence=${encoded}\n`);
    process.stdout.write("maintenance_startup_history_verified\n");
  } catch { process.stderr.write("maintenance_startup_workflow_unverified\n"); process.exitCode = 1; }
}
