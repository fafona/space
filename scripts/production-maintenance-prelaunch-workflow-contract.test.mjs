import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
const require = createRequire(import.meta.url), yaml = require("js-yaml");
const source = readFileSync(new URL("../.github/workflows/production-maintenance.yml", import.meta.url), "utf8");
const workflow = yaml.load(source), steps = workflow.jobs.maintenance.steps;
const step = name => { const items = steps.filter(value => value.name === name); assert.equal(items.length, 1); return items[0]; };
const env = { GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_RUN_ATTEMPT: "1",
  ACTION: "recover-prelaunch", CONFIRMATION: "RECOVER_PRELAUNCH_PRODUCTION_MAINTENANCE_UNTIL_20260914T200000Z", TARGET_SHA: "a".repeat(40), GITHUB_SHA: "a".repeat(40),
  MAINTENANCE_OPERATION_ID: "eb81284a-09c4-4514-8f16-38eaf6acc1e4", PREVIOUS_TARGET_SHA: "67ddb91bf618e9716b79df6bf97f08d3865919b7",
  EXPECTED_OLD_SHA: "cd943076ebda758b70bf2f2270a508c774b726d6", CHECK_STATE: "held", DEPLOY_RUN_ID: "", DEPLOY_RUN_ATTEMPT: "" };
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const run = (script, changes = {}) => spawnSync(bash, ["-c", script], { env: { ...process.env, ...env, ...changes }, encoding: "utf8", timeout: 5000, windowsHide: true });
test("fixed prelaunch recovery confirmation retains one current-main attempt and rejects alternate authority", () => {
  const script = step("Validate Fixed Manual Transition").run;
  assert.equal(run(script).status, 0);
  for (const changes of [{ CONFIRMATION: "RECOVER_BUDGET_PRODUCTION_MAINTENANCE_UNTIL_20260914T100000Z" }, { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/other" }, { GITHUB_REPOSITORY: "other/space" }, { GITHUB_SHA: "b".repeat(40) },
    { PREVIOUS_TARGET_SHA: "d9de5fe689226fcdd13a1e95039901b5d0f39167" }, { EXPECTED_OLD_SHA: "b".repeat(40) },
    { MAINTENANCE_OPERATION_ID: "ab81284a-09c4-4514-8f16-38eaf6acc1e4" }, { DEPLOY_RUN_ID: "34802138869" },
    { TARGET_SHA: env.PREVIOUS_TARGET_SHA, GITHUB_SHA: env.PREVIOUS_TARGET_SHA }, { ACTION: "renew-again" }])
    assert.notEqual(run(script, changes).status, 0, JSON.stringify(changes));
  assert.equal(workflow.concurrency.group, "production-deploy"); assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.doesNotMatch(source, /inputs\.(?:ttl|deadline|expires_at|authorized_at|new_operation_id)|--(?:ttl|deadline|expires-at|new-operation-id)\b/);
});
test("unlaunched-state inspection precedes fixed whole-history verification and only then the transition", () => {
  const names = ["Inspect Failed Unlaunched Prelaunch Recovery State", "Verify Exact Prelaunch Recovery History Under Production Lock", "Execute Fixed Maintenance Transition"];
  const positions = names.map(name => steps.indexOf(step(name))); assert.deepEqual([...positions].sort((a,b) => a-b), positions);
  for (const name of names.slice(0,2)) assert.equal(step(name).if, "inputs.action == 'recover-prelaunch'");
  const inspection = step(names[0]).run;
  assert.match(inspection, /umask 077/); assert.match(inspection, /inspect-prelaunch-recovery .*--target-sha .*--previous-target-sha .*--expected-old-sha .*--expected-operation-id/);
  assert.match(inspection, /> "\$capture_dir\/out" 2> "\$capture_dir\/err"/); assert.doesNotMatch(inspection, /cat |tee |recover-prelaunch --|fail-held/);
  assert.equal(step(names[1]).env.INSPECTION_DIR, "${{ steps.prelaunch-recovery-inspection.outputs.capture_dir }}");
  assert.match(step(names[1]).run, /node scripts\/production-maintenance-prelaunch-recovery-workflow\.mjs/);
});
test("renewal evidence is isolated; end still requires signed successful deployment and public verification", () => {
  const transition = step("Execute Fixed Maintenance Transition");
  assert.equal(transition.env.PRELAUNCH_RECOVERY_EVIDENCE, "${{ steps.prelaunch-recovery-evidence.outputs.prelaunch_recovery_evidence }}");
  assert.match(transition.run, /recover-prelaunch\) command=recover-prelaunch; expected_state=held/);
  assert.match(transition.run, /test "\$\{#PRELAUNCH_RECOVERY_EVIDENCE\}" -le 16384/);
  assert.match(transition.run, /--previous-target-sha "\$PREVIOUS_TARGET_SHA" --prelaunch-recovery-evidence "\$PRELAUNCH_RECOVERY_EVIDENCE"/);
  assert.match(transition.run, /else\n\s+test -z "\$PRELAUNCH_RECOVERY_EVIDENCE"/);
  for (const name of ["Require Exact Successful Maintenance Deploy Before End", "Verify Signed Deploy Maintenance Binding", "Verify Real Public Release After End"])
    assert.equal(step(name).if, "inputs.action == 'end'");
  assert.equal(step("Reclose Entry And Fail Held If End Is Unconfirmed").if, "always() && (failure() || cancelled()) && inputs.action == 'end' && steps.transition.outputs.attempted == 'true'");
});
test("private cleanup stays scoped and every new shell block parses without any deployment", () => {
  const cleanup = step("Remove Runner Prelaunch Recovery Evidence");
  assert.equal(cleanup.if, "always() && inputs.action == 'recover-prelaunch'"); assert.deepEqual(Object.keys(cleanup.env), ["INSPECTION_DIR"]);
  assert.ok(cleanup.run.includes('"$RUNNER_TEMP"/maintenance-prelaunch-recovery.????????'));
  assert.doesNotMatch(cleanup.run, /rm -rf|sudo|ssh |state\.json|fail-held|recover-prelaunch --/);
  assert.equal(run(cleanup.run, { INSPECTION_DIR: "" }).status, 0);
  assert.notEqual(run(cleanup.run, { RUNNER_TEMP: "/private", INSPECTION_DIR: "/" }).status, 0);
  for (const item of steps.filter(value => value.if?.includes("recover-prelaunch") || ["Execute Fixed Maintenance Transition", "Validate Fixed Manual Transition"].includes(value.name)))
    assert.equal(spawnSync(bash, ["-n"], { input: item.run, encoding: "utf8", timeout: 5000, windowsHide: true }).status, 0, item.name);
});
