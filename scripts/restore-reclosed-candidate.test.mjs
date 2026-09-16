import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { RESTORATION as R, validateRestorationReceipt, restorationSequence } from "./restore-reclosed-candidate.mjs";
import { CANDIDATE_RECOVERY as P } from "./recover-maintenance-candidate.mjs";
const sha = "a".repeat(40), id = "42", now = P.expiresAt - 3600000;
const receipt = () => ({ version: 1, kind: "faolla-reclosed-candidate-restoration", operationId: R.operationId, predecessorDigest: R.predecessorDigest,
  failedRunId: R.failedRunId, targetSha: P.targetSha, recoverySha: sha, runId: id, checkedAt: now, validUntil: now + 1800000 });
test("restoration has a new operation identity and binds exact failed history and finite authority", () => {
  assert.notEqual(R.operationId, P.operationId); validateRestorationReceipt(receipt(), sha, id, now);
  for (const key of Object.keys(receipt())) {
    const absent = receipt(); delete absent[key]; assert.throws(() => validateRestorationReceipt(absent, sha, id, now));
    assert.throws(() => validateRestorationReceipt({ ...receipt(), [key]: "changed" }, sha, id, now));
  }
  for (const v of [{ ...receipt(), extra: 1 }, { ...receipt(), validUntil: now + 1800001 }, { ...receipt(), operationId: P.operationId }]) assert.throws(() => validateRestorationReceipt(v, sha, id, now));
  assert.throws(() => validateRestorationReceipt(receipt(), sha, id, now - 1));
  assert.throws(() => validateRestorationReceipt(receipt(), sha, id, now + 1800000));
});
const steps = ["startPaused", "verifyPaused", "checkApplication", "checkDatabase", "resume", "verifyResumed", "persistDump", "verifyDump", "verifyHistory", "restoreIngress", "verifyPublic", "verifyResumed", "verifyDump", "verifyHistory", "finish"];
test("only verified runtime, dump, database and application may precede public restoration", async () => {
  const seen = [], ops = Object.fromEntries([...new Set(steps), "failClosed"].map(name => [name, async () => seen.push(name)]));
  await restorationSequence(ops); assert.deepEqual(seen, steps);
});
for (let failedIndex = 0; failedIndex < steps.length; failedIndex++) test(`failed restoration stage ${failedIndex} recloses and never reaches later stages`, async () => {
  const seen = [], ops = Object.fromEntries([...new Set(steps), "failClosed"].map(name => [name, async () => {
    seen.push(name); if (name !== "failClosed" && seen.length - 1 === failedIndex) throw new Error("injected");
  }]));
  await assert.rejects(restorationSequence(ops), /injected/); assert.deepEqual(seen, [...steps.slice(0, failedIndex + 1), "failClosed"]);
});
test("restoration implementation preserves predecessor and verifies exact target before archival", () => {
  const src = readFileSync(new URL("./restore-reclosed-candidate.mjs", import.meta.url), "utf8");
  assert.match(src, /expectedBuildId: P.targetSha/); assert.match(src, /r.buildId !== P.targetSha/);
  assert.match(src, /createPrivate\(R.directory \+ "\/predecessor.json", before.bytes\)/);
  assert.match(src, /mkdirSync\(R.directory, \{ mode: 0o700 \}\)/);
  assert.match(src, /phase: "attempted"[\s\S]*await save\(\); return nonce/);
  assert.match(src, /renameSync\(ROOT, R.archive\)/);
  assert.doesNotMatch(src, /writeFileSync\(ROOT|unlinkSync|rmSync|execSync|pm2 restart|npm ci|migrate-/);
});
test("restoration workflow requires current CI, signed inspection and pinned SSH before its one launch", () => {
  const src = readFileSync(new URL("../.github/workflows/restore-reclosed-candidate.yml", import.meta.url), "utf8");
  const steps = ["Require Confirmation And Exact CI And Failed History", "Verify Original Hosted Backup And Readiness Baseline", "Install Pinned SSH Trust", "Inspect Reclosed Predecessor Without Mutation", "Sign Restoration Inspection", "Verify Hosted Signature And Recheck Workflow Authority", "Restore With New Durable Journal And Full Public Checks", "Retain Completed Restoration Evidence"];
  let at = -1; for (const step of steps) { const next = src.indexOf("- name: " + step); assert.ok(next > at); at = next; }
  assert.match(src, /group: production-deploy\n  cancel-in-progress: false/);
  assert.match(src, /--source-digest "\$GITHUB_SHA" --source-ref refs\/heads\/main/);
  assert.match(src, /--deny-self-hosted-runners/);
  assert.doesNotMatch(src, /ssh-keyscan|StrictHostKeyChecking=(?:no|accept-new)|npm ci|npm run build/);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  const blocks = [...src.matchAll(/        run: \|\n((?:          .*\n|\n)+)/g)]; assert.ok(blocks.length >= 7);
  for (const [, block] of blocks) { const r = spawnSync(bash, ["-n"], { input: block.replace(/^          /gm, ""), encoding: "utf8", timeout: 5000 }); assert.equal(r.status, 0, r.stderr); }
});
