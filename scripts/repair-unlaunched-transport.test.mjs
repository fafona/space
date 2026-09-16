import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { TRANSPORT_REPAIR as P, TRANSPORT_REPAIR_PATHS, validateTransportRepairEdits, validateTransportRepairPredecessor,
  validateTransportRepairLedger, validateTransportRepairAuthority, runTransportRepair } from "./repair-unlaunched-transport.mjs";
import { TRANSPORT_CI_JOBS, validateTransportRun, validateTransportCiJobs, validateTransportHistoryRun, validateTransportProvenance } from "./repair-unlaunched-transport-workflow.mjs";
const sha = "c".repeat(40), runId = "35140000000", now = P.createdAt + 3600000;
const read = name => readFileSync(new URL("../" + name, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const authority = () => ({ version: 1, kind: "faolla-unlaunched-transport-repair", targetSha: sha, runId, runAttempt: 1,
  operationId: P.operationId, failedRunId: P.failedRunId, mainCIrunId: "35139999999", historyDigest: "e".repeat(64), checkedAt: now });
const catalog = readdirSync(new URL("./supabase-migrations/", import.meta.url)).filter(n => /^\d{12}_.*\.sql$/.test(n)).sort();
const ledger = () => ({ readOnly: true, databaseOid: 5, rows: catalog.map(n => ({ version: n.slice(0, 12), name: n.slice(13, -4), appliedAt: "2026-09-16T16:00:00.000000Z" })) });
test("exactly seven paths; only keepalive and exports touch existing implementation", () => {
  assert.equal(TRANSPORT_REPAIR_PATHS.length, 7);
  const deploy = read(".github/workflows/deploy.yml");
  const line = "            -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -o TCPKeepAlive=yes \\\n";
  const before = deploy.replace(line, "");
  validateTransportRepairEdits(".github/workflows/deploy.yml", before, deploy);
  for (const change of [deploy + "\n", deploy.replace("CountMax=10", "CountMax=100"), deploy.replace("StrictHostKeyChecking=yes", "StrictHostKeyChecking=no")])
    assert.throws(() => validateTransportRepairEdits(".github/workflows/deploy.yml", before, change));
  const control = read("scripts/production-maintenance-control.mjs");
  const original = control.replace("\nexport { withPrivateOperationLock, productionOperations };\n", "");
  validateTransportRepairEdits("scripts/production-maintenance-control.mjs", original, control);
  assert.throws(() => validateTransportRepairEdits("scripts/production-maintenance-control.mjs", original, control + "\n"));
  assert.throws(() => validateTransportRepairEdits("src/proxy.ts", "", "changed"));
});
test("fresh authority binds operation, failed run, exact target, attempt and clock", () => {
  validateTransportRepairAuthority(authority(), sha, runId, now);
  for (const patch of [{ targetSha: "d".repeat(40) }, { runAttempt: 2 }, { operationId: "wrong" }, { failedRunId: "1" },
    { checkedAt: now + 1 }, { checkedAt: now - 300001 }, { historyDigest: "" }, { extra: true }])
    assert.throws(() => validateTransportRepairAuthority({ ...authority(), ...patch }, sha, runId, now));
});
test("ledger requires all 56 exact pre-operation entries, including previously applied migration 048", () => {
  assert.equal(catalog.length, 56);
  const value = ledger();
  assert.match(validateTransportRepairLedger(value, 5, catalog), /^[a-f0-9]{64}$/);
  assert(value.rows.some(r => r.version === "202609090048"));
  for (const modify of [v => v.readOnly = false, v => v.databaseOid = 6, v => v.rows.pop(), v => v.rows[0].name = "wrong",
    v => v.rows[0].appliedAt = "2026-09-17T00:00:00.000000Z", v => v.rows[0].appliedAt = "2026-02-31T00:00:00.000000Z",
    v => v.rows[1] = v.rows[0]]) {
    const changed = structuredClone(value); modify(changed); assert.throws(() => validateTransportRepairLedger(changed, 5, catalog));
  }
});
test("unrecognized predecessor and replay cannot reach verification or writes", async () => {
  const state = { version: 2, revision: P.revision, operationId: P.operationId, targetSha: P.previousTargetSha,
    expectedOldSha: P.expectedOldSha, bootId: P.bootId, createdAt: P.createdAt, phase: "failed-held",
    candidate: null, resumed: null, launchDisk: null, launchJournal: null, finalDump: null };
  assert.throws(() => validateTransportRepairPredecessor(state, now)); // digest cannot be forged by copying public fields
  for (const phase of ["failed-held", "held", "failed-unknown", "ended"]) {
    let writes = 0;
    await assert.rejects(runTransportRepair("repair", sha, runId, authority(), { now: () => now,
      readRecoverySnapshot: async () => ({ state: { ...state, phase }, revision: P.revision, digest: P.stateDigest }),
      commitRecovery: () => writes++, archiveTransportPredecessor: () => writes++ }, "e".repeat(64), {}));
    assert.equal(writes, 0);
  }
});
test("CI requires all ten exact successful main jobs", () => {
  const jobs = { total_count: 10, jobs: TRANSPORT_CI_JOBS.map(name => ({ name, status: "completed", conclusion: "success", head_sha: sha })) };
  validateTransportCiJobs(jobs, sha);
  for (const modify of [v => v.jobs.pop(), v => v.jobs[0].conclusion = "skipped", v => v.jobs[0].head_sha = P.previousTargetSha,
    v => v.jobs[0].name = v.jobs[1].name]) {
    const changed = structuredClone(jobs); modify(changed); assert.throws(() => validateTransportCiJobs(changed, sha));
  }
});
test("authenticated run rejects forks, attempts and mismatched sources", () => {
  const expected = { id: P.failedRunId, sha: P.previousTargetSha, event: "workflow_run", file: "deploy.yml", conclusion: "failure" };
  const value = { id: Number(P.failedRunId), run_attempt: 1, head_sha: P.previousTargetSha, head_branch: "main", event: "workflow_run",
    path: ".github/workflows/deploy.yml", status: "completed", conclusion: "failure", repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" } };
  validateTransportRun(value, expected);
  for (const patch of [{ run_attempt: 2 }, { head_sha: sha }, { status: "in_progress" }, { head_repository: { full_name: "other/repo" } }])
    assert.throws(() => validateTransportRun({ ...value, ...patch }, expected));
});
test("history prohibits concurrent operations and unrelated post-prepare mutations", () => {
  validateTransportHistoryRun({ id: Number(P.failedRunId), status: "completed", created_at: new Date(now).toISOString() }, runId);
  assert.throws(() => validateTransportHistoryRun({ id: 123, status: "in_progress", created_at: new Date(P.createdAt - 1000).toISOString() }, runId));
  assert.throws(() => validateTransportHistoryRun({ id: 123, status: "completed", created_at: new Date(now).toISOString() }, runId));
});
test("hosted subject signature must cover the exact authority bytes", () => {
  const bytes = Buffer.from(JSON.stringify(authority()));
  const result = [{ verificationResult: { statement: { subject: [{ name: "transport-authority.json", digest: { sha256: createHash("sha256").update(bytes).digest("hex") } }] } } }];
  validateTransportProvenance(bytes, result);
  assert.throws(() => validateTransportProvenance(Buffer.from(bytes + " "), result));
  assert.throws(() => validateTransportProvenance(bytes, [...result, ...result]));
});
test("workflow maintains signed gates, original locks and never opens ingress", () => {
  const source = read(".github/workflows/repair-unlaunched-transport.yml");
  for (const part of ["group: production-deploy", "cancel-in-progress: false", "--deny-self-hosted-runners", "flock -n 9",
    "Sign Hosted Repair Authority", "--state held", "REPAIR_UNLAUNCHED_TRANSPORT_35131822753"]) assert(source.includes(part));
  for (const part of ["continue-on-error", "pm2 start", "pm2 restart", "systemctl restart", "--state ended", "deploy.production.sh"]) assert(!source.includes(part));
});
