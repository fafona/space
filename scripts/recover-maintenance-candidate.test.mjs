import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { CANDIDATE_RECOVERY as P, RECOVERY_CHECKS, validateCandidateRecoveryReceipt, extractRecoveryShellFunction } from "./recover-maintenance-candidate.mjs";
import { validateRecoveryRun, validateRecoveryProvenance, RECOVERY_SOURCE_PATHS } from "./recover-maintenance-candidate-workflow.mjs";

const sha = "a".repeat(40), runId = "12345", now = P.expiresAt - 3600000;
const receipt = () => ({ version: 1, kind: "faolla-existing-candidate-verification",
  ...Object.fromEntries(["targetSha", "expectedOldSha", "operationId", "stateDigest", "failedDeployRunId", "backupRunId", "readinessRunId"].map(k => [k, P[k]])),
  recoverySha: sha, runId, runAttempt: "1", checkedAt: now, validUntil: now + 1800000, checks: [...RECOVERY_CHECKS] });

test("continuation receipt binds fixed failed history, same candidate, all checks and finite lease", () => {
  assert.deepEqual(validateCandidateRecoveryReceipt(receipt(), sha, runId, now), receipt());
  for (const key of Object.keys(receipt())) {
    const missing = receipt(); delete missing[key]; assert.throws(() => validateCandidateRecoveryReceipt(missing, sha, runId, now));
    const changed = receipt(); changed[key] = key === "checks" ? RECOVERY_CHECKS.slice(1) : "substitution";
    assert.throws(() => validateCandidateRecoveryReceipt(changed, sha, runId, now), key);
  }
  for (const changed of [{ ...receipt(), extra: true }, { ...receipt(), runAttempt: "2" },
    { ...receipt(), checks: [...RECOVERY_CHECKS].reverse() }, { ...receipt(), validUntil: now + 1800001 }]) {
    assert.throws(() => validateCandidateRecoveryReceipt(changed, sha, runId, now));
  }
  assert.throws(() => validateCandidateRecoveryReceipt(receipt(), sha, runId, now - 1));
  assert.throws(() => validateCandidateRecoveryReceipt(receipt(), sha, runId, now + 1800000));
  assert.throws(() => validateCandidateRecoveryReceipt(receipt(), "b".repeat(40), runId, now));
  assert.throws(() => validateCandidateRecoveryReceipt(receipt(), sha, "12346", now));
});

test("failed deployment stays failed: metadata rejects each substituted trust dimension", () => {
  const expected = { id: P.failedDeployRunId, sha: P.targetSha, event: "workflow_run", name: "Deploy Production", file: "deploy.yml", conclusion: "failure" };
  const record = { id: Number(P.failedDeployRunId), run_attempt: 1, head_sha: P.targetSha, head_branch: "main", event: "workflow_run", name: "Deploy Production", path: ".github/workflows/deploy.yml", status: "completed", conclusion: "failure", repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" } };
  assert.equal(validateRecoveryRun(record, expected), true);
  for (const key of Object.keys(record)) {
    assert.throws(() => validateRecoveryRun({ ...record, [key]: "substitution" }, expected), key);
  }
  assert.throws(() => validateRecoveryRun({ ...record, conclusion: "success" }, expected));
});

test("signed continuation subject must be exactly the validated receipt bytes", () => {
  const bytes = Buffer.from(JSON.stringify(receipt()));
  const subject = { name: "candidate-verification.json", digest: { sha256: createHash("sha256").update(bytes).digest("hex") } };
  const proof = subjects => [{ verificationResult: { statement: { subject: subjects } } }];
  validateRecoveryProvenance(bytes, proof([subject]));
  for (const value of [[], proof([]), proof([subject, subject]), proof([{ ...subject, name: "wrong.json" }]), proof([{ ...subject, digest: { sha256: "0".repeat(64) } }])]) {
    assert.throws(() => validateRecoveryProvenance(bytes, value));
  }
  assert.throws(() => validateRecoveryProvenance(Buffer.from(JSON.stringify({ ...receipt(), runId: "8" })), proof([subject])));
});

test("recovery reuses the real immutable gates; arbitrary shell function selection is rejected", () => {
  const source = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8");
  for (const name of ["run_local_release_smoke", "verify_nginx_release_static_access", "verify_booking_persistence"]) {
    const fn = extractRecoveryShellFunction(source, name);
    assert.ok(fn.startsWith(name + "() {")); assert.ok(fn.endsWith("\n}"));
  }
  for (const name of ["start_release", "switch_current_release", "rollback_release", "x;id"]) {
    assert.throws(() => extractRecoveryShellFunction(source, name));
  }
  assert.throws(() => extractRecoveryShellFunction("", "run_local_release_smoke"));
});

test("workflow enforces CI, signed original evidence, new hosted receipt and revalidation before END", () => {
  const source = readFileSync(new URL("../.github/workflows/recover-maintenance-candidate.yml", import.meta.url), "utf8");
  const steps = ["Require Exact Confirmation And Successful CI", "Verify Original Signed Backup And Readiness Bindings", "Install Pinned SSH Trust",
    "Verify Existing Candidate Without Mutation", "Upload Independent Verification Receipt", "Sign Independent Verification Receipt",
    "Verify Hosted Signature Before Resume", "Revalidate And Resume Through Original Controller", "Verify Actual Public Pages And Assets", "Reclose On Unconfirmed Resume"];
  let index = -1; for (const step of steps) { const next = source.indexOf("- name: " + step); assert.ok(next > index, step); index = next; }
  assert.match(source, /group: production-deploy\n  cancel-in-progress: false/);
  assert.match(source, /--source-digest "\$GITHUB_SHA" --source-ref refs\/heads\/main/);
  assert.match(source, /--deny-self-hosted-runners/);
  assert.match(source, /steps\.resume\.outputs\.attempted == 'true'/);
  assert.doesNotMatch(source, /StrictHostKeyChecking=(?:no|accept-new)|ssh-keyscan|npm ci|npm run build/);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  const blocks = [...source.matchAll(/        run: \|\n((?:          .*\n|\n)+)/g)];
  assert.ok(blocks.length >= 8);
  for (const [, block] of blocks) {
    const result = spawnSync(bash, ["-n"], { input: block.replace(/^          /gm, ""), encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(RECOVERY_SOURCE_PATHS.includes("scripts/production-maintenance-control.mjs"), false);
  assert.ok(RECOVERY_SOURCE_PATHS.every(path => !path.startsWith("src/") && !path.includes("migrations") && !path.includes("package")));
  const host = readFileSync(new URL("./recover-maintenance-candidate.mjs", import.meta.url), "utf8");
  assert.ok(RECOVERY_CHECKS.includes("readiness"));
  assert.match(host, /checkOrdinaryAccountCutoverReadiness\(/);
  assert.match(host, /report.status !== "ready"/);
  assert.match(host, /Object.entries\(original.baseline\)/);
  assert.match(host, /await verify\(recoverySha, runId\);[\s\S]+controller\("end"\)/);
  assert.doesNotMatch(host, /controller\("start-candidate"\)|unlinkSync|rmdirSync|renameSync/);
});
