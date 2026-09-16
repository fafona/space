import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DAEMON_REPAIR as P, validateDaemonRepairPredecessor, buildDaemonRepairedState } from "./production-maintenance-daemon-repair.mjs";
import { validateMaintenanceRecoveryState, assertMaintenanceRecoveryProgress } from "./production-maintenance-recovery.mjs";
import { validateDaemonRepairAuthority, readDaemonRepairSource, DAEMON_REPAIR_PATHS, runDaemonRepair } from "./repair-daemon.mjs";
import { validateDaemonHistoryRun, validateDaemonCiJobs, validateDaemonRun, validateDaemonProvenance, DAEMON_CI_JOBS } from "./repair-daemon-workflow.mjs";

const sha = "e".repeat(40), runId = "35160000000", now = P.createdAt + 25000000;
const authority = () => ({ version: 1, kind: "faolla-daemon-repair", targetSha: sha, runId, runAttempt: 1,
  operationId: P.operationId, failedRunId: P.failedRunId, mainCIrunId: "35159000000", historyDigest: "a".repeat(64), checkedAt: now });
const digest = b => createHash("sha256").update(b).digest("hex");

test("only exact hosted authority and fresh target/run bindings pass", () => {
  assert.deepEqual(validateDaemonRepairAuthority(authority(), sha, runId, now), authority());
  for (const patch of [{ kind: "faolla-unlaunched-transport-repair" }, { targetSha: "b".repeat(40) }, { runId: "35160000001" },
    { runAttempt: 2 }, { operationId: "other" }, { failedRunId: "35131822753" }, { checkedAt: now + 1 },
    { checkedAt: now - 300001 }, { mainCIrunId: "0" }, { extra: true }, { historyDigest: "bad" }])
    assert.throws(() => validateDaemonRepairAuthority({ ...authority(), ...patch }, sha, runId, now));
});
test("no synthetic state, other incident, resumed launch or caller-created digest authorizes recovery", async () => {
  for (const phase of ["held", "failed-held", "failed-unknown", "ended", "candidate"]) {
    const s = { version: 3, revision: 7, phase, operationId: P.operationId, targetSha: P.previousTargetSha,
      expectedOldSha: P.expectedOldSha, bootId: P.bootId, createdAt: P.createdAt, runtime: { daemon: {} } };
    assert.throws(() => validateDaemonRepairPredecessor(s, { bootId: P.bootId, now }));
    assert.throws(() => buildDaemonRepairedState(s, { predecessor: s, repairedAt: now }, { bootId: P.bootId, now }));
    assert.throws(() => validateMaintenanceRecoveryState({ ...s, daemonRepair: {} }, { bootId: P.bootId, now }));
    assert.throws(() => assertMaintenanceRecoveryProgress(s, { ...s, revision: 8, daemonRepair: {} }));
  }
  let writes = 0;
  await assert.rejects(runDaemonRepair("repair", sha, runId, authority(), { now: () => now, bootId: () => P.bootId,
    readRecoverySnapshot: () => ({ state: {}, revision: 7, digest: P.stateDigest }), commitDaemonRepair: () => { writes++; } }, "b".repeat(64), {}));
  assert.equal(writes, 0);
});
test("unrecognized concurrent production runs and reattempts are rejected", () => {
  validateDaemonHistoryRun({ id: Number(runId) }, runId);
  for (const id of [P.failedRunId, P.backupRunId, P.readinessRunId, "35145761968", "35146223181"])
    validateDaemonHistoryRun({ id: Number(id), status: "completed", created_at: new Date(now).toISOString() }, runId);
  assert.throws(() => validateDaemonHistoryRun({ id: 35160000100, status: "completed", created_at: new Date(now).toISOString() }, runId));
  assert.throws(() => validateDaemonHistoryRun({ id: Number(P.failedRunId), status: "in_progress", created_at: new Date(now).toISOString() }, runId));
  const expected = { id: runId, sha, event: "push", file: "ci.yml", conclusion: "success" };
  const r = { id: Number(runId), run_attempt: 1, head_sha: sha, head_branch: "main", event: "push", path: ".github/workflows/ci.yml",
    status: "completed", conclusion: "success", repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" } };
  validateDaemonRun(r, expected);
  for (const patch of [{ run_attempt: 2 }, { head_sha: P.previousTargetSha }, { conclusion: "skipped" }, { head_branch: "fix" }, { event: "pull_request" }])
    assert.throws(() => validateDaemonRun({ ...r, ...patch }, expected));
});
test("all ten main CI jobs and exact signed authority bytes required", () => {
  const jobs = { total_count: 10, jobs: DAEMON_CI_JOBS.map(name => ({ name, status: "completed", conclusion: "success", head_sha: sha })) };
  validateDaemonCiJobs(jobs, sha);
  for (let i = 0; i < 10; i++) { const bad = structuredClone(jobs); bad.jobs[i].conclusion = "skipped"; assert.throws(() => validateDaemonCiJobs(bad, sha)); }
  const bytes = JSON.stringify(authority()), result = [{ verificationResult: { statement: { subject: [{ name: "daemon-authority.json", digest: { sha256: digest(bytes) } }] } } }];
  validateDaemonProvenance(bytes, result);
  assert.throws(() => validateDaemonProvenance(bytes + " ", result));
  assert.throws(() => validateDaemonProvenance(bytes, [...result, ...result]));
});
test("source proof rejects dirty, unrelated and executable changes", () => {
  const git = args => {
    if (args[0] === "rev-parse") return sha + "\n";
    if (args[0] === "status" || args[0] === "merge-base") return "";
    if (args[0] === "diff") return DAEMON_REPAIR_PATHS.join("\n") + "\n";
    if (args[0] === "show") return readFileSync(new URL("../" + args[1].slice(41), import.meta.url), "utf8").replace(/\r\n/g, "\n");
    if (args[0] === "ls-tree") return args[1] === P.previousTargetSha ? "" : "100644 blob " + "f".repeat(40) + "\t" + args.at(-1) + "\n";
    throw Error("unexpected");
  };
  assert.match(readDaemonRepairSource(sha, git), /^[a-f0-9]{64}$/);
  for (const [command, output] of [["status", " M file\n"], ["diff", "src/proxy.ts\n"], ["rev-parse", "b".repeat(40)], ["ls-tree", "100755 blob a\tfile\n"]])
    assert.throws(() => readDaemonRepairSource(sha, args => args[0] === command ? output : git(args)));
});
test("workflow preserves original locks, signed evidence, independent backup and no runtime launch", () => {
  const y = readFileSync(new URL("../.github/workflows/repair-daemon.yml", import.meta.url), "utf8");
  for (const required of ["REPAIR_DAEMON_35156337705", "group: production-deploy", "flock -n 9", "StrictHostKeyChecking=yes",
    "actions/attest@v4", "--deny-self-hosted-runners", "35148085536", "35156235371", "--mode maintenance", "--state held"])
    assert(y.includes(required), required);
  assert(!/pm2 start|start-candidate|restoreIngress|rm -rf/.test(y));
  const code = readFileSync(new URL("./repair-daemon.mjs", import.meta.url), "utf8");
  assert(code.includes("await verify();")); assert(code.includes("await ops.commitDaemonRepair(snapshot, next)"));
  assert(code.includes('constants.O_EXCL | constants.O_NOFOLLOW')); assert(!code.includes("ops.save("));
});
