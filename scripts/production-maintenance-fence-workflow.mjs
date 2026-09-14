import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  validateMaintenanceLeaseInspection, validateMaintenanceLeaseEvidence, encodeMaintenanceLeaseEvidence,
  MAINTENANCE_FENCE_RECOVERY_AUTHORIZATION as AUTHORIZATION,
} from "./production-maintenance-lease.mjs";

const MAX_AGE = 300000;
const REPOSITORY = "fafona/space", PRIOR = "552bfaafea802ee1371329afce0424b096b44453";
const SHA = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]*$/;
const fail = () => { throw new Error("maintenance_fence_workflow_unverified"); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = value => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
// Exact GitHub GET projections observed on 2026-09-14: backup12, readiness12,
// failed deploy12, successful lease12 and CI13. Prior backup is not new authority.
// No payload, archive or log is read. The fixed raw predecessor proves the
// unused launch journal independently; GitHub metadata alone does not prove it.
export const MAINTENANCE_FENCE_PRIOR_RUNS = freeze([{"run":{"conclusion":"success","created_at":"2026-09-14T21:01:13Z","event":"workflow_dispatch","head_branch":"main","head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34896361029,"name":"Encrypted Database Backup","path":".github/workflows/database-backup.yml","run_attempt":1,"run_started_at":"2026-09-14T21:01:13Z","status":"completed","updated_at":"2026-09-14T21:54:47Z"},"jobs":[{"id":104151331247,"name":"backup","run_id":34896361029,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T21:01:17Z","completed_at":"2026-09-14T21:54:46Z","steps":[[1,"Set up job","success","2026-09-14T21:01:19Z","2026-09-14T21:01:20Z"],[2,"Checkout Exact Backup Source","success","2026-09-14T21:01:20Z","2026-09-14T21:01:28Z"],[3,"Verify Current Main And Exact Successful Push CI","success","2026-09-14T21:01:28Z","2026-09-14T21:01:30Z"],[4,"Setup Pinned SSH Host Trust","success","2026-09-14T21:01:30Z","2026-09-14T21:01:32Z"],[5,"Prepare Remote Detached Exact Source","success","2026-09-14T21:01:32Z","2026-09-14T21:01:35Z"],[6,"Verify Held Maintenance Before Backup","success","2026-09-14T21:01:35Z","2026-09-14T21:01:56Z"],[7,"Verify Backup Configuration From Exact Source","success","2026-09-14T21:01:56Z","2026-09-14T21:01:57Z"],[8,"Create Encrypted Database Backup From Exact Source","success","2026-09-14T21:01:57Z","2026-09-14T21:02:25Z"],[9,"Verify Held Maintenance After Backup Capture","success","2026-09-14T21:02:25Z","2026-09-14T21:02:46Z"],[10,"Transfer Complete Encrypted Backup","success","2026-09-14T21:02:46Z","2026-09-14T21:52:35Z"],[11,"Verify Encrypted Backup","success","2026-09-14T21:52:35Z","2026-09-14T21:52:40Z"],[12,"Rehearse Isolated Restore","success","2026-09-14T21:52:40Z","2026-09-14T21:54:03Z"],[13,"Confirm Backup Is Ready For Upload","success","2026-09-14T21:54:03Z","2026-09-14T21:54:04Z"],[14,"Upload Verified Encrypted Backup","success","2026-09-14T21:54:04Z","2026-09-14T21:54:09Z"],[15,"Verify Uploaded Backup Artifact Identity","success","2026-09-14T21:54:09Z","2026-09-14T21:54:09Z"],[16,"Generate Backup Attestation Predicate","success","2026-09-14T21:54:09Z","2026-09-14T21:54:10Z"],[17,"Upload Canonical Backup Attestation Input","success","2026-09-14T21:54:10Z","2026-09-14T21:54:11Z"],[18,"Upload Backup Verification And Attestation Inputs","success","2026-09-14T21:54:11Z","2026-09-14T21:54:12Z"],[19,"Attest Verified Encrypted Backup","success","2026-09-14T21:54:12Z","2026-09-14T21:54:14Z"],[20,"Attest Canonical Backup Attestation Input","success","2026-09-14T21:54:14Z","2026-09-14T21:54:16Z"],[21,"Upload Encrypted Backup Attestation Bundle","success","2026-09-14T21:54:16Z","2026-09-14T21:54:17Z"],[22,"Upload Canonical Backup Attestation Bundle","success","2026-09-14T21:54:17Z","2026-09-14T21:54:18Z"],[23,"Verify Held Maintenance Before Backup Attestation","success","2026-09-14T21:54:18Z","2026-09-14T21:54:39Z"],[24,"Build Canonical Maintenance Binding","success","2026-09-14T21:54:39Z","2026-09-14T21:54:39Z"],[25,"Upload Canonical Maintenance Binding","success","2026-09-14T21:54:39Z","2026-09-14T21:54:40Z"],[26,"Attest Canonical Maintenance Binding","success","2026-09-14T21:54:40Z","2026-09-14T21:54:42Z"],[27,"Upload Backup Failure Diagnostics","skipped","2026-09-14T21:54:42Z","2026-09-14T21:54:42Z"],[28,"Remove Temporary Backup And Exact Source","success","2026-09-14T21:54:42Z","2026-09-14T21:54:43Z"],[56,"Post Checkout Exact Backup Source","success","2026-09-14T21:54:43Z","2026-09-14T21:54:43Z"],[57,"Complete job","success","2026-09-14T21:54:43Z","2026-09-14T21:54:43Z"]]}],"artifacts":[{"id":10371445509,"name":"faolla-maintenance-backup-binding-34896361029-1","size_in_bytes":410,"expired":false,"created_at":"2026-09-14T21:54:40Z","updated_at":"2026-09-14T21:54:40Z","expires_at":"2026-09-21T21:54:40Z","digest":"sha256:84740c274666f90441a2d0e715b127d36100ce5c159679733d81fbb6e339848d","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34896361029,"repository_id":1146364565}},{"id":10371340784,"name":"faolla-production-backup-attestation-bundle-34896361029-1","size_in_bytes":6854,"expired":false,"created_at":"2026-09-14T21:54:18Z","updated_at":"2026-09-14T21:54:18Z","expires_at":"2026-09-21T21:54:17Z","digest":"sha256:b13c89877481492b4092d01480dd1364d4e2d65bb1f86f9370200319d309fde5","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34896361029,"repository_id":1146364565}},{"id":10371305900,"name":"faolla-encrypted-backup-attestation-bundle-34896361029-1","size_in_bytes":7470,"expired":false,"created_at":"2026-09-14T21:54:17Z","updated_at":"2026-09-14T21:54:17Z","expires_at":"2026-09-21T21:54:16Z","digest":"sha256:6e5d5612197562780f3ddaaa107ffb996c6cd1be70489f9a58e26680fc1ba3aa","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34896361029,"repository_id":1146364565}},{"id":10371170439,"name":"faolla-backup-verification-reports-34896361029-1","size_in_bytes":8152,"expired":false,"created_at":"2026-09-14T21:54:12Z","updated_at":"2026-09-14T21:54:12Z","expires_at":"2026-09-21T21:54:11Z","digest":"sha256:bae41239a7528caca4fd7a7da2575f3a2cc9288bc122e968c44f99029749c309","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34896361029,"repository_id":1146364565}},{"id":10370892319,"name":"faolla-encrypted-disaster-recovery-34896361029-1","size_in_bytes":505784526,"expired":false,"created_at":"2026-09-14T21:54:09Z","updated_at":"2026-09-14T21:54:09Z","expires_at":"2026-09-21T21:54:04Z","digest":"sha256:61dc08dae3998b06c965c006e2232f19c62e72888aa7d4840c801bbade19f02f","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34896361029,"repository_id":1146364565}},{"id":10370637061,"name":"faolla-production-backup-attestation-34896361029-1","size_in_bytes":1066,"expired":false,"created_at":"2026-09-14T21:54:11Z","updated_at":"2026-09-14T21:54:11Z","expires_at":"2026-09-21T21:54:10Z","digest":"sha256:baab3c0efa6426fc7776de3f058bca9af4e0cbdfb3c45f57f97d96b5fb37c180","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34896361029,"repository_id":1146364565}}]},{"run":{"conclusion":"success","created_at":"2026-09-14T21:55:58Z","event":"workflow_dispatch","head_branch":"main","head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34901481955,"name":"Ordinary Account Cutover Readiness","path":".github/workflows/ordinary-account-cutover-readiness.yml","run_attempt":1,"run_started_at":"2026-09-14T21:55:58Z","status":"completed","updated_at":"2026-09-14T21:57:41Z"},"jobs":[{"id":104168215959,"name":"readiness","run_id":34901481955,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T21:56:07Z","completed_at":"2026-09-14T21:57:41Z","steps":[[1,"Set up job","success","2026-09-14T21:56:08Z","2026-09-14T21:56:10Z"],[2,"Validate Manual Release Chain","success","2026-09-14T21:56:10Z","2026-09-14T21:56:14Z"],[3,"Checkout Exact Readiness Source","success","2026-09-14T21:56:14Z","2026-09-14T21:56:22Z"],[4,"Verify Exact Current Main Checkout","success","2026-09-14T21:56:22Z","2026-09-14T21:56:23Z"],[5,"Resolve Exact Successful Backup Artifact Inventory","success","2026-09-14T21:56:23Z","2026-09-14T21:56:24Z"],[6,"Verify Recursive Backup Attestation Chain","success","2026-09-14T21:56:24Z","2026-09-14T21:56:29Z"],[7,"Verify Signed Backup Maintenance Binding","success","2026-09-14T21:56:29Z","2026-09-14T21:56:33Z"],[8,"Setup Pinned SSH Host Trust","success","2026-09-14T21:56:33Z","2026-09-14T21:56:33Z"],[9,"Prepare Remote Detached Exact Source","success","2026-09-14T21:56:33Z","2026-09-14T21:56:37Z"],[10,"Verify Held Maintenance Before Readiness","success","2026-09-14T21:56:37Z","2026-09-14T21:56:58Z"],[11,"Inspect Locked Production Readiness From Exact Source","success","2026-09-14T21:56:58Z","2026-09-14T21:57:03Z"],[12,"Upload Canonical Readiness Report","success","2026-09-14T21:57:03Z","2026-09-14T21:57:04Z"],[13,"Verify Uploaded Readiness Report Artifact","success","2026-09-14T21:57:04Z","2026-09-14T21:57:04Z"],[14,"Enforce Ready Cutover State","success","2026-09-14T21:57:04Z","2026-09-14T21:57:04Z"],[15,"Build Canonical Readiness Attestation","success","2026-09-14T21:57:04Z","2026-09-14T21:57:05Z"],[16,"Upload Canonical Readiness Attestation","success","2026-09-14T21:57:05Z","2026-09-14T21:57:06Z"],[17,"Verify Uploaded Readiness Attestation Artifact","success","2026-09-14T21:57:06Z","2026-09-14T21:57:07Z"],[18,"Attest Canonical Readiness Report","success","2026-09-14T21:57:07Z","2026-09-14T21:57:09Z"],[19,"Attest Canonical Readiness Attestation","success","2026-09-14T21:57:09Z","2026-09-14T21:57:11Z"],[20,"Verify Held Maintenance After Readiness","success","2026-09-14T21:57:11Z","2026-09-14T21:57:31Z"],[21,"Build Canonical Maintenance Binding","success","2026-09-14T21:57:31Z","2026-09-14T21:57:31Z"],[22,"Upload Canonical Maintenance Binding","success","2026-09-14T21:57:31Z","2026-09-14T21:57:33Z"],[23,"Attest Canonical Maintenance Binding","success","2026-09-14T21:57:33Z","2026-09-14T21:57:35Z"],[24,"Confirm Exact Successful Readiness Artifact Inventory","success","2026-09-14T21:57:35Z","2026-09-14T21:57:35Z"],[25,"Remove Remote Exact Readiness Source","success","2026-09-14T21:57:35Z","2026-09-14T21:57:38Z"],[50,"Post Checkout Exact Readiness Source","success","2026-09-14T21:57:38Z","2026-09-14T21:57:38Z"],[51,"Complete job","success","2026-09-14T21:57:38Z","2026-09-14T21:57:38Z"]]}],"artifacts":[{"id":10371316311,"name":"faolla-production-readiness-report-34901481955-1","size_in_bytes":1241,"expired":false,"created_at":"2026-09-14T21:57:04Z","updated_at":"2026-09-14T21:57:04Z","expires_at":"2026-09-15T21:57:03Z","digest":"sha256:8300a98e5c26e45268f285b263dd2bc5ded29869b728d89687434aa6b612b000","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34901481955,"repository_id":1146364565}},{"id":10370997231,"name":"faolla-maintenance-readiness-binding-34901481955-1","size_in_bytes":412,"expired":false,"created_at":"2026-09-14T21:57:33Z","updated_at":"2026-09-14T21:57:33Z","expires_at":"2026-09-21T21:57:32Z","digest":"sha256:71b5d3fd14e515727f668d7224404eab5275ee7f66238b5a40382b475eeaf8f4","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34901481955,"repository_id":1146364565}},{"id":10370882841,"name":"faolla-production-readiness-attestation-34901481955-1","size_in_bytes":4573,"expired":false,"created_at":"2026-09-14T21:57:06Z","updated_at":"2026-09-14T21:57:06Z","expires_at":"2026-09-15T21:57:05Z","digest":"sha256:a8f9b48b37e6193611bf2bb6eebc9d185a2cd9e60d7bf097ccf7148fd892226d","workflow_run":{"head_branch":"main","head_repository_id":1146364565,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34901481955,"repository_id":1146364565}}]},{"run":{"conclusion":"failure","created_at":"2026-09-14T21:57:43Z","event":"workflow_run","head_branch":"main","head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34901630408,"name":"Deploy Production","path":".github/workflows/deploy.yml","run_attempt":1,"run_started_at":"2026-09-14T21:57:43Z","status":"completed","updated_at":"2026-09-14T22:08:53Z"},"jobs":[{"id":104168696660,"name":"deploy","run_id":34901630408,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"failure","started_at":"2026-09-14T21:57:46Z","completed_at":"2026-09-14T22:08:53Z","steps":[[1,"Set up job","success","2026-09-14T21:57:47Z","2026-09-14T21:57:48Z"],[2,"Validate Readiness Workflow Run","success","2026-09-14T21:57:48Z","2026-09-14T21:57:54Z"],[3,"Checkout Tested Commit","success","2026-09-14T21:57:54Z","2026-09-14T21:57:58Z"],[4,"Resolve Deploy Commit","success","2026-09-14T21:57:58Z","2026-09-14T21:57:58Z"],[5,"Resolve Readiness Artifacts","success","2026-09-14T21:57:58Z","2026-09-14T21:57:59Z"],[6,"Verify Readiness Evidence","success","2026-09-14T21:57:59Z","2026-09-14T21:58:08Z"],[7,"Revalidate Live Recursive Backup Evidence","success","2026-09-14T21:58:08Z","2026-09-14T21:58:11Z"],[8,"Verify Signed Readiness Maintenance Binding","success","2026-09-14T21:58:11Z","2026-09-14T21:58:15Z"],[9,"Export Verified Maintenance Binding","success","2026-09-14T21:58:15Z","2026-09-14T21:58:15Z"],[10,"Setup SSH","success","2026-09-14T21:58:15Z","2026-09-14T21:58:15Z"],[11,"Deploy To Server","failure","2026-09-14T21:58:15Z","2026-09-14T22:08:50Z"],[12,"Verify Public Release","skipped","2026-09-14T22:08:50Z","2026-09-14T22:08:50Z"],[13,"Verify Candidate While Public Entry Remains Held","skipped","2026-09-14T22:08:50Z","2026-09-14T22:08:50Z"],[14,"Build Canonical Maintenance Binding","skipped","2026-09-14T22:08:50Z","2026-09-14T22:08:50Z"],[15,"Upload Canonical Maintenance Binding","skipped","2026-09-14T22:08:50Z","2026-09-14T22:08:50Z"],[16,"Attest Canonical Maintenance Binding","skipped","2026-09-14T22:08:50Z","2026-09-14T22:08:50Z"],[32,"Post Checkout Tested Commit","success","2026-09-14T22:08:50Z","2026-09-14T22:08:50Z"],[33,"Complete job","success","2026-09-14T22:08:50Z","2026-09-14T22:08:50Z"]]}],"artifacts":[]},{"run":{"conclusion":"success","created_at":"2026-09-14T20:55:25Z","event":"workflow_dispatch","head_branch":"main","head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34895798474,"name":"Production Maintenance","path":".github/workflows/production-maintenance.yml","run_attempt":1,"run_started_at":"2026-09-14T20:55:25Z","status":"completed","updated_at":"2026-09-14T20:59:16Z"},"jobs":[{"id":104149318652,"name":"maintenance","run_id":34895798474,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:55:28Z","completed_at":"2026-09-14T20:59:14Z","steps":[[1,"Set up job","success","2026-09-14T20:55:30Z","2026-09-14T20:55:30Z"],[2,"Validate Fixed Manual Transition","success","2026-09-14T20:55:30Z","2026-09-14T20:55:30Z"],[3,"Checkout Exact Maintenance Source","success","2026-09-14T20:55:30Z","2026-09-14T20:55:35Z"],[4,"Require Current Main And Exact Successful Push CI","success","2026-09-14T20:55:35Z","2026-09-14T20:55:37Z"],[5,"Require Exact Successful Maintenance Deploy Before End","skipped","2026-09-14T20:55:37Z","2026-09-14T20:55:37Z"],[6,"Verify Signed Deploy Maintenance Binding","skipped","2026-09-14T20:55:37Z","2026-09-14T20:55:37Z"],[7,"Setup Pinned SSH Trust","success","2026-09-14T20:55:37Z","2026-09-14T20:55:37Z"],[8,"Prepare Remote Detached Exact Control Source","success","2026-09-14T20:55:37Z","2026-09-14T20:55:42Z"],[9,"Inspect Original Failed Held Recovery State","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[10,"Verify Complete Recovery History Under Production Lock","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[11,"Inspect Migrated Unlaunched Continuation State","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[12,"Verify Original Signed Backup And Readiness Bindings","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[13,"Verify Exact Continuation History Under Production Lock","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[14,"Inspect Failed Unlaunched Build Recovery State","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[15,"Verify Build Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[16,"Verify Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[17,"Verify Exact Build Recovery History Under Production Lock","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[18,"Verify Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[19,"Verify Attempt Recovery Historical Additional Backup","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[20,"Inspect Stopped Launched Candidate Recovery State","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[21,"Verify Exact Single Attempt Recovery History Under Production Lock","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[22,"Verify Second Launched Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[23,"Verify Second Attempt Recovery Historical Additional Backup","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[24,"Inspect Stopped Second Launched Candidate Recovery State","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[25,"Verify Exact Second Attempt Recovery History Under Production Lock","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[26,"Verify Budget Incident Signed Backup And Readiness Bindings","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[27,"Verify Budget Recovery Historical Additional Backup","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[28,"Inspect Stopped Budget Candidate Recovery State","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[29,"Verify Exact Budget Recovery History Under Production Lock","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[30,"Inspect Unused Window Renewal State","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[31,"Verify Exact Window Renewal History Under Production Lock","skipped","2026-09-14T20:55:42Z","2026-09-14T20:55:42Z"],[32,"Inspect Unused Maintenance Lease State","success","2026-09-14T20:55:42Z","2026-09-14T20:56:05Z"],[33,"Verify Exact Lease Renewal History Under Production Lock","success","2026-09-14T20:56:05Z","2026-09-14T20:58:24Z"],[34,"Inspect Failed Unlaunched Preflight Recovery State","skipped","2026-09-14T20:58:24Z","2026-09-14T20:58:24Z"],[35,"Verify Exact Preflight Recovery History Under Production Lock","skipped","2026-09-14T20:58:24Z","2026-09-14T20:58:24Z"],[36,"Inspect Failed Unlaunched Prelaunch Recovery State","skipped","2026-09-14T20:58:24Z","2026-09-14T20:58:24Z"],[37,"Verify Exact Prelaunch Recovery History Under Production Lock","skipped","2026-09-14T20:58:24Z","2026-09-14T20:58:24Z"],[38,"Execute Fixed Maintenance Transition","success","2026-09-14T20:58:24Z","2026-09-14T20:59:09Z"],[39,"Verify Real Public Release After End","skipped","2026-09-14T20:59:09Z","2026-09-14T20:59:09Z"],[40,"Reclose Entry And Fail Held If End Is Unconfirmed","skipped","2026-09-14T20:59:09Z","2026-09-14T20:59:09Z"],[41,"Remove Exact Temporary Control Source","success","2026-09-14T20:59:09Z","2026-09-14T20:59:11Z"],[42,"Remove Runner Recovery Inspection","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[43,"Remove Runner Continuation Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[44,"Remove Runner Build Recovery Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[45,"Remove Fixed Additional Scheduled Backup Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[46,"Remove Runner Attempt Recovery Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[47,"Remove Runner Second Attempt Recovery Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[48,"Remove Runner Budget Recovery Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[49,"Remove Runner Window Renewal Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[50,"Remove Runner Lease Renewal Evidence","success","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[51,"Remove Runner Preflight Recovery Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[52,"Remove Runner Prelaunch Recovery Evidence","skipped","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[53,"Remove Runner SSH Material","success","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[106,"Post Checkout Exact Maintenance Source","success","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"],[107,"Complete job","success","2026-09-14T20:59:11Z","2026-09-14T20:59:11Z"]]}],"artifacts":[]},{"run":{"conclusion":"success","created_at":"2026-09-14T20:24:33Z","event":"push","head_branch":"main","head_sha":"552bfaafea802ee1371329afce0424b096b44453","id":34892730757,"name":"CI","path":".github/workflows/ci.yml","run_attempt":1,"run_started_at":"2026-09-14T20:24:33Z","status":"completed","updated_at":"2026-09-14T20:54:14Z"},"jobs":[{"id":104139126987,"name":"Isolated Supabase Scheduler Acceptance","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:24:36Z","completed_at":"2026-09-14T20:25:59Z"},{"id":104139127291,"name":"Quality","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:24:36Z","completed_at":"2026-09-14T20:51:24Z"},{"id":104139127355,"name":"Isolated Maintenance Ingress Acceptance","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:24:35Z","completed_at":"2026-09-14T20:25:17Z"},{"id":104148038759,"name":"QR Atomic PostgreSQL Acceptance","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:51:29Z","completed_at":"2026-09-14T20:52:01Z"},{"id":104148038797,"name":"Order Membership PostgreSQL Acceptance","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:51:28Z","completed_at":"2026-09-14T20:52:11Z"},{"id":104148038815,"name":"Recovery Content PostgreSQL Acceptance","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:51:32Z","completed_at":"2026-09-14T20:52:11Z"},{"id":104148038827,"name":"Checkout Context PostgreSQL Acceptance","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:51:28Z","completed_at":"2026-09-14T20:52:23Z"},{"id":104148038838,"name":"Pages Client Write ACL PostgreSQL Acceptance","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:51:27Z","completed_at":"2026-09-14T20:51:59Z"},{"id":104148038878,"name":"Enterprise Browser Journeys","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:51:27Z","completed_at":"2026-09-14T20:54:13Z"},{"id":104148038902,"name":"Redemption PostgreSQL Acceptance","run_id":34892730757,"head_sha":"552bfaafea802ee1371329afce0424b096b44453","status":"completed","conclusion":"success","started_at":"2026-09-14T20:51:27Z","completed_at":"2026-09-14T20:52:20Z"}],"artifacts":[]}]);
const [BACKUP, READINESS, DEPLOY, RECOVERY, PRIOR_CI] = MAINTENANCE_FENCE_PRIOR_RUNS;
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
        } else if (Math.max(created, started, updated) >= CUTOFF &&
          !(run.head_sha === checked.targetSha && ["database-backup.yml", "production-maintenance.yml"].includes(file))) fail();
        rows.push({ file, run });
      }
      if (data.workflow_runs.length < 100) { if (seen.size !== total) fail(); ended = true; break; }
    }
    if (!ended) fail();
  }
  if (foundFixed.size !== 4 || !foundCurrent) fail();
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.run.id - b.run.id);
}
export async function inspectMaintenanceFenceHistory(inspection, api, now, currentRunId, observedClock = Date.now) {
  const checked = validateMaintenanceLeaseInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (typeof api !== "function" || !ID.test(currentRunId ?? "") || MAINTENANCE_FENCE_PRIOR_RUNS.some(spec => String(spec.run.id) === currentRunId)) fail();
  const first = await scan(checked, api, now, currentRunId, observedClock);
  const records = [];
  for (const spec of MAINTENANCE_FENCE_PRIOR_RUNS) records.push(await fixedRun(spec, api));
  const second = await scan(checked, api, now, currentRunId, observedClock);
  if (hash(first) !== hash(second)) fail();
  for (let index = 0; index < records.length; index++)
    if (hash(await fixedRun(MAINTENANCE_FENCE_PRIOR_RUNS[index], api)) !== hash(records[index])) fail();
  observationTime(now, observedClock);
  return { predecessorStateDigest: checked.stateDigest, cutoff: CUTOFF, historyPurpose: "fixed-unused-fence-recovery",
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
export async function createMaintenanceFenceWorkflowEvidence(inspection, env, api, now = Date.now(), observedClock = Date.now) {
  const checked = validateMaintenanceLeaseInspection(inspection); clock(now);
  observedClock = orderedClock(now, observedClock);
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_RUN_ATTEMPT !== "1" || !ID.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_SHA !== checked.targetSha ||
      env.TARGET_SHA !== checked.targetSha || env.PREVIOUS_TARGET_SHA !== (env.ACTION === "recover-fence" ? PRIOR : "3614f5bfc85cf72d064732141a9998a0bbaec513") || env.PREVIOUS_TARGET_SHA !== checked.previousTargetSha ||
      env.EXPECTED_OLD_SHA !== checked.expectedOldSha || env.MAINTENANCE_OPERATION_ID !== checked.operationId ||
      !((env.ACTION === "recover-fence" && env.CONFIRMATION === "RECOVER_UNUSED_FENCE_PRODUCTION_MAINTENANCE" && checked.state === "fence-recovery-inspected") ||
        (env.ACTION === "renew-lease" && env.CONFIRMATION === "RENEW_PRODUCTION_MAINTENANCE_LEASE" && checked.state === "lease-renewal-inspected"))) fail();
  if (checked.stoppedBaseline.observedAt > now || now - checked.stoppedBaseline.observedAt > MAX_AGE) fail();
  if ((await api(`repos/${REPOSITORY}/commits/main`))?.sha !== checked.targetSha) fail();
  const ci = await currentCI(checked, api, now);
  if (String(ci.run.id) === env.GITHUB_RUN_ID) fail();
  const history = await inspectMaintenanceFenceHistory(checked, api, now, env.GITHUB_RUN_ID, observedClock);
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
    const evidence = await createMaintenanceFenceWorkflowEvidence(inspection, process.env, api);
    const completedAt = Date.now(); clock(completedAt);
    if (completedAt < evidence.historyCheckedAt || completedAt - evidence.historyCheckedAt > MAX_AGE ||
        completedAt < evidence.stoppedBaseline.observedAt || completedAt - evidence.stoppedBaseline.observedAt > MAX_AGE) fail();
    const encoded = encodeMaintenanceLeaseEvidence(evidence);
    process.stdout.write(`::add-mask::${encoded}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `lease_evidence=${encoded}\n`);
    process.stdout.write("maintenance_fence_history_verified\n");
  } catch { process.stderr.write("maintenance_fence_workflow_unverified\n"); process.exitCode = 1; }
}
