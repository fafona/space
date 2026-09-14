import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const source = readFileSync(new URL("../.github/workflows/production-maintenance.yml", import.meta.url), "utf8");
const workflow = yaml.load(source), steps = workflow.jobs.maintenance.steps;
const step = name => { const found = steps.filter(value => value.name === name); assert.equal(found.length, 1); return found[0]; };
const confirmation = "RECOVER_BUDGET_PRODUCTION_MAINTENANCE_UNTIL_20260914T100000Z";
const env = {
  GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_RUN_ATTEMPT: "1",
  ACTION: "recover-budget", CONFIRMATION: confirmation, TARGET_SHA: "a".repeat(40), GITHUB_SHA: "a".repeat(40),
  MAINTENANCE_OPERATION_ID: "eb81284a-09c4-4514-8f16-38eaf6acc1e4",
  PREVIOUS_TARGET_SHA: "d9de5fe689226fcdd13a1e95039901b5d0f39167", EXPECTED_OLD_SHA: "cd943076ebda758b70bf2f2270a508c774b726d6",
  CHECK_STATE: "held", DEPLOY_RUN_ID: "", DEPLOY_RUN_ATTEMPT: "",
};
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const execute = (script, overrides = {}) => spawnSync(bash, ["-c", script], {
  env: { ...process.env, ...env, ...overrides }, encoding: "utf8", timeout: 5000, windowsHide: true,
});

test("one fixed additional attempt requires exact manual authorization and current main", () => {
  const script = step("Validate Fixed Manual Transition").run;
  assert.equal(execute(script).status, 0);
  for (const overrides of [
    { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T220000Z" }, { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/other" }, { GITHUB_REPOSITORY: "other/space" },
    { GITHUB_SHA: "b".repeat(40) }, { PREVIOUS_TARGET_SHA: "b".repeat(40) }, { EXPECTED_OLD_SHA: "b".repeat(40) },
    { MAINTENANCE_OPERATION_ID: "ab81284a-09c4-4514-8f16-38eaf6acc1e4" }, { DEPLOY_RUN_ID: "34802138869" },
    { TARGET_SHA: env.PREVIOUS_TARGET_SHA, GITHUB_SHA: env.PREVIOUS_TARGET_SHA }, { ACTION: "recover-again" },
  ]) assert.notEqual(execute(script, overrides).status, 0, JSON.stringify(overrides));
  assert.equal(workflow.concurrency.group, "production-deploy");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.doesNotMatch(source, /inputs\.(?:ttl|deadline|expires_at|authorized_at|new_operation_id)|--(?:ttl|deadline|expires-at|new-operation-id)\b/);
});

test("historical signed artifacts precede fresh private baseline and fully locked history", () => {
  const names = ["Verify Budget Incident Signed Backup And Readiness Bindings", "Verify Budget Recovery Historical Additional Backup",
    "Inspect Stopped Budget Candidate Recovery State", "Verify Exact Budget Recovery History Under Production Lock", "Execute Fixed Maintenance Transition"];
  const positions = names.map(name => steps.indexOf(step(name)));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  for (const name of names.slice(0, 4)) assert.equal(step(name).if, "inputs.action == 'recover-budget'");
  const bindings = step(names[0]).run;
  for (const value of ["34800653808", "34802075500", "gh attestation verify", '--source-digest "$PREVIOUS_TARGET_SHA"',
    "--source-ref refs/heads/main", "--deny-self-hosted-runners", "--predicate-type https://slsa.dev/provenance/v1"]) assert.ok(bindings.includes(value));
  const historical = step(names[1]).run;
  assert.match(historical, /34745334237/);
  assert.match(historical, /--source-digest 13df917416cf06ce27fce021460b08caf50f6165/);
  assert.match(historical, /validateMaintenanceBudgetRecoveryAdditionalBackup\(readMaintenanceBudgetRecoveryAdditionalBackup\(process\.argv\[2\]\), Date\.now\(\)\)/);
  const inspection = step(names[2]).run;
  assert.match(inspection, /umask 077/);
  assert.match(inspection, /inspect-budget-recovery .*--target-sha .*--previous-target-sha .*--expected-old-sha .*--expected-operation-id/);
  assert.match(inspection, /> "\$capture_dir\/out" 2> "\$capture_dir\/err"/);
  assert.doesNotMatch(inspection, /cat |tee |recover-budget --|fail-held/);
  const history = step(names[3]);
  assert.equal(history.env.INSPECTION_DIR, "${{ steps.budget-recovery-inspection.outputs.capture_dir }}");
  assert.equal(history.env.PRIOR_BINDINGS_DIR, "${{ steps.budget-recovery-prior-bindings.outputs.capture_dir }}");
  assert.equal(history.env.ADDITIONAL_BACKUP_DIR, "${{ steps.budget-recovery-additional-backup.outputs.capture_dir }}");
  assert.match(history.run, /node scripts\/production-maintenance-budget-recovery-workflow\.mjs/);
});

test("only the fixed transition receives the private attempt grant; end retains independent gates", () => {
  const transition = step("Execute Fixed Maintenance Transition");
  assert.equal(transition.env.BUDGET_RECOVERY_EVIDENCE, "${{ steps.budget-recovery-evidence.outputs.budget_recovery_evidence }}");
  assert.match(transition.run, /recover-budget\) command=recover-budget; expected_state=held/);
  assert.match(transition.run, /test "\$\{#BUDGET_RECOVERY_EVIDENCE\}" -le 16384/);
  assert.match(transition.run, /--previous-target-sha "\$PREVIOUS_TARGET_SHA" --budget-recovery-evidence "\$BUDGET_RECOVERY_EVIDENCE"/);
  assert.match(transition.run, /else\n\s+test -z "\$BUDGET_RECOVERY_EVIDENCE"/);
  for (const name of ["Require Exact Successful Maintenance Deploy Before End", "Verify Signed Deploy Maintenance Binding", "Verify Real Public Release After End"])
    assert.equal(step(name).if, "inputs.action == 'end'");
  assert.equal(step("Reclose Entry And Fail Held If End Is Unconfirmed").if,
    "always() && (failure() || cancelled()) && inputs.action == 'end' && steps.transition.outputs.attempted == 'true'");
});

test("attempt cleanup stays within its three exact private runner directories", () => {
  const cleanup = step("Remove Runner Budget Recovery Evidence");
  assert.equal(cleanup.if, "always() && inputs.action == 'recover-budget'");
  assert.deepEqual(Object.keys(cleanup.env), ["INSPECTION_DIR", "PRIOR_BINDINGS_DIR", "ADDITIONAL_BACKUP_DIR"]);
  for (const prefix of ["maintenance-budget-recovery", "maintenance-budget-prior-bindings", "maintenance-budget-additional-backup"])
    assert.ok(cleanup.run.includes('"$RUNNER_TEMP"/' + prefix + '.????????'));
  assert.doesNotMatch(cleanup.run, /rm -rf|sudo|ssh |state\.json|maintenance\.json|fail-held|recover-budget --/);
  assert.equal(execute(cleanup.run, { INSPECTION_DIR: "", PRIOR_BINDINGS_DIR: "", ADDITIONAL_BACKUP_DIR: "" }).status, 0);
  for (const variable of Object.keys(cleanup.env)) {
    const result = execute(cleanup.run, { INSPECTION_DIR: "", PRIOR_BINDINGS_DIR: "", ADDITIONAL_BACKUP_DIR: "", RUNNER_TEMP: "/private", [variable]: "/" });
    assert.notEqual(result.status, 0);
  }
});

test("every new embedded shell block parses without running a deployment", () => {
  for (const item of steps.filter(value => value.if?.includes("recover-budget") || value.name === "Execute Fixed Maintenance Transition" || value.name === "Validate Fixed Manual Transition")) {
    const result = spawnSync(bash, ["-n"], { input: item.run, encoding: "utf8", timeout: 5000, windowsHide: true });
    assert.equal(result.status, 0, item.name + ": " + result.stderr);
  }
});
