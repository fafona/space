import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { STARTUP_REPAIR as P, validateStartupRepairPredecessor, buildStartupRepairedState } from "./production-maintenance-startup-repair.mjs";
import { validateMaintenanceRecoveryState, assertMaintenanceRecoveryProgress } from "./production-maintenance-recovery.mjs";
import { validateStartupRepairAuthority, readStartupRepairSource, STARTUP_REPAIR_PATHS, runStartupRepair } from "./repair-startup.mjs";
import { validateStartupHistoryRun, validateStartupCiJobs, validateStartupRun, validateStartupProvenance, STARTUP_CI_JOBS } from "./repair-startup-workflow.mjs";

const sha = "e".repeat(40), runId = "35160000000", now = P.createdAt + 25000000;
const authority = () => ({ version: 1, kind: "faolla-startup-repair", targetSha: sha, runId, runAttempt: 1,
  operationId: P.operationId, failedRunId: P.failedRunId, mainCIrunId: "35159000000", historyDigest: "a".repeat(64), checkedAt: now });
const digest = b => createHash("sha256").update(b).digest("hex");

test("real Next acceptance preserves root helper trust in a private hosted-runner copy", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const section = workflow.slice(workflow.indexOf("name: Isolated Real Next Startup Attribution Acceptance"), workflow.indexOf("- name: Tests"));
  for (const token of ['test "$RUNNER_ENVIRONMENT" = github-hosted', 'sudo -n mktemp -d /root/.faolla-next-acceptance.XXXXXXXX',
    'sudo -n cp -R --no-preserve=ownership', 'sudo -n chmod -R go-w "$fixture_root"', 'sudo -n env -i', '0:700',
    '"$npm_package" "$fixture_root/npm"']) assert(section.includes(token), token);
  assert(!section.includes('chown') && !section.includes('rm -rf') && !section.includes('continue-on-error'));
  const fixture = readFileSync(new URL("./production-maintenance-next-startup-acceptance.mjs", import.meta.url), "utf8");
  assert(fixture.includes("process.getuid?.()!==0") && fixture.includes("RUNNER_ENVIRONMENT!=='github-hosted'"));
  assert(fixture.includes("await controlPm2(daemon,boot,") && !fixture.includes("helperProof:"));
  assert(fixture.includes("npm/bin/npm-cli.js") && fixture.includes("spawnSync(realpathSync(process.execPath),[npmCli,"));
  assert(workflow.indexOf("name: Isolated Real Next Startup Attribution Acceptance") < workflow.indexOf("name: Maintenance Control and Pages ACL Contract Tests"));
});

test("only exact hosted authority and fresh target/run bindings pass", () => {
  assert.deepEqual(validateStartupRepairAuthority(authority(), sha, runId, now), authority());
  for (const patch of [{ kind: "faolla-unlaunched-transport-repair" }, { targetSha: "b".repeat(40) }, { runId: "35160000001" },
    { runAttempt: 2 }, { operationId: "other" }, { failedRunId: "35131822753" }, { checkedAt: now + 1 },
    { checkedAt: now - 300001 }, { mainCIrunId: "0" }, { extra: true }, { historyDigest: "bad" }])
    assert.throws(() => validateStartupRepairAuthority({ ...authority(), ...patch }, sha, runId, now));
});
test("no synthetic state, other incident, resumed launch or caller-created digest authorizes recovery", async () => {
  for (const phase of ["held", "failed-held", "failed-unknown", "ended", "candidate"]) {
    const s = { version: 3, revision: 7, phase, operationId: P.operationId, targetSha: P.previousTargetSha,
      expectedOldSha: P.expectedOldSha, bootId: P.bootId, createdAt: P.createdAt, runtime: { startup: {} } };
    assert.throws(() => validateStartupRepairPredecessor(s, { bootId: P.bootId, now }));
    assert.throws(() => buildStartupRepairedState(s, { predecessor: s, repairedAt: now }, { bootId: P.bootId, now }));
    assert.throws(() => validateMaintenanceRecoveryState({ ...s, startupRepair: {} }, { bootId: P.bootId, now }));
    assert.throws(() => assertMaintenanceRecoveryProgress(s, { ...s, revision: 8, startupRepair: {} }));
  }
  let writes = 0;
  await assert.rejects(runStartupRepair("repair", sha, runId, authority(), { now: () => now, bootId: () => P.bootId,
    readRecoverySnapshot: () => ({ state: {}, revision: 7, digest: P.stateDigest }), commitStartupRepair: () => { writes++; } }, "b".repeat(64), {}));
  assert.equal(writes, 0);
});
test("unrecognized concurrent production runs and reattempts are rejected", () => {
  validateStartupHistoryRun({ id: Number(runId) }, runId);
  for (const id of [P.failedRunId, P.backupRunId, P.readinessRunId, "35145761968", "35146223181"])
    validateStartupHistoryRun({ id: Number(id), status: "completed", created_at: new Date(now).toISOString() }, runId);
  assert.throws(() => validateStartupHistoryRun({ id: 35160000100, status: "completed", created_at: new Date(now).toISOString() }, runId));
  assert.throws(() => validateStartupHistoryRun({ id: Number(P.failedRunId), status: "in_progress", created_at: new Date(now).toISOString() }, runId));
  const expected = { id: runId, sha, event: "push", file: "ci.yml", conclusion: "success" };
  const r = { id: Number(runId), run_attempt: 1, head_sha: sha, head_branch: "main", event: "push", path: ".github/workflows/ci.yml",
    status: "completed", conclusion: "success", repository: { full_name: "fafona/space" }, head_repository: { full_name: "fafona/space" } };
  validateStartupRun(r, expected);
  for (const patch of [{ run_attempt: 2 }, { head_sha: P.previousTargetSha }, { conclusion: "skipped" }, { head_branch: "fix" }, { event: "pull_request" }])
    assert.throws(() => validateStartupRun({ ...r, ...patch }, expected));
});
test("all ten main CI jobs and exact signed authority bytes required", () => {
  const jobs = { total_count: 10, jobs: STARTUP_CI_JOBS.map(name => ({ name, status: "completed", conclusion: "success", head_sha: sha })) };
  validateStartupCiJobs(jobs, sha);
  for (let i = 0; i < 10; i++) { const bad = structuredClone(jobs); bad.jobs[i].conclusion = "skipped"; assert.throws(() => validateStartupCiJobs(bad, sha)); }
  const bytes = JSON.stringify(authority()), result = [{ verificationResult: { statement: { subject: [{ name: "startup-authority.json", digest: { sha256: digest(bytes) } }] } } }];
  validateStartupProvenance(bytes, result);
  assert.throws(() => validateStartupProvenance(bytes + " ", result));
  assert.throws(() => validateStartupProvenance(bytes, [...result, ...result]));
});
test("source proof accepts exact reviewed files and rejects dirty or executable changes", () => {
  const git = args => {
    if (args[0] === "rev-parse") return sha + "\n";
    if (args[0] === "status" || args[0] === "merge-base") return "";
    if (args[0] === "diff") return STARTUP_REPAIR_PATHS.join("\n") + "\n";
    if (args[0] === "show") return readFileSync(new URL("../" + args[1].slice(41), import.meta.url), "utf8").replace(/\r\n/g, "\n");
    if (args[0] === "ls-tree") return args[1] === P.previousTargetSha ? "" : "100644 blob " + "f".repeat(40) + "\t" + args.at(-1) + "\n";
    throw Error("unexpected");
  };
  assert.match(readStartupRepairSource(sha, git), /^[a-f0-9]{64}$/);
  for (const [command, output] of [["status", " M file\n"], ["diff", "src/proxy.ts\n"], ["rev-parse", "b".repeat(40)], ["ls-tree", "100755 blob a\tfile\n"]])
    assert.throws(() => readStartupRepairSource(sha, args => args[0] === command ? output : git(args)));
});
test("workflow preserves original locks, signed evidence, independent backup and no runtime launch", () => {
  const y = readFileSync(new URL("../.github/workflows/repair-startup.yml", import.meta.url), "utf8");
  for (const required of ["REPAIR_STARTUP_35165126333", "group: production-deploy", "flock -n 9", "StrictHostKeyChecking=yes",
    "actions/attest@v4", "--deny-self-hosted-runners", "35163641695", "35165044304", "--mode maintenance", "--state held"])
    assert(y.includes(required), required);
  assert(!/pm2 start|start-candidate|restoreIngress|rm -rf/.test(y));
  const code = readFileSync(new URL("./repair-startup.mjs", import.meta.url), "utf8");
  assert(code.includes("await verify();")); assert(code.includes("await ops.commitStartupRepair(snapshot, next)"));
  assert(code.includes('constants.O_EXCL | constants.O_NOFOLLOW')); assert(!code.includes("ops.save("));
});
