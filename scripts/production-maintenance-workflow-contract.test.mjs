import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { canonicalJsonBytes } from "./production-release-attestation.mjs";
import { createNativeUnknownReasonCounts } from "./production-maintenance-runtime-diagnostic.mjs";
import { emptyPythonLayout, emptyNativeFileLinkEvidence } from "./production-maintenance-runtime-layout.mjs";
import {
  assertProductionMaintenanceProvenance,
  buildProductionMaintenanceBinding,
  validateProductionMaintenanceBinding,
  validateProductionMaintenanceControlReport,
  validateProductionRuntimeDiagnosticReport,
  validateProductionPm2PeerDiagnosticReport,
} from "./production-maintenance-workflow-contract.mjs";

const env = {
  MAINTENANCE_MODE: "maintenance", TARGET_SHA: "a".repeat(40), EXPECTED_OLD_SHA: "b".repeat(40),
  MAINTENANCE_OPERATION_ID: "12345678-1234-4123-8123-123456789abc",
  GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", BACKUP_RUN_ID: "121", BACKUP_RUN_ATTEMPT: "2",
  READINESS_RUN_ID: "122", READINESS_RUN_ATTEMPT: "1",
};
const failure = /production_maintenance_binding_invalid/;
const diagnosticFixture = () => ({
  version: 4, maintenance: "not_verified", stability: "unverified", disk: "unverified", supervision: null, daemonCwdIsRoot: null,
  webMetadata: { cwdLiteralMatch: null, cwdCanonicalMatch: null, entryLiteralMatch: null, entryCanonicalMatch: null,
    interpreterLiteralMatch: null, interpreterCanonicalMatch: null, argsMatch: null, nodeArgsEmpty: null },
  supabaseEnvironment: "unverified", worker: { state: "unverified", nodeDescendantCount: null, nonNodeDescendantCount: null },
  runtimeExtraProcessCount: null, pm2Home: "unverified", pm2PathOverridesPresent: null, pm2Connection: "not_checked",
  pm2Version: null, pm2Endpoint: { home: "unverified", rpcSocket: "unverified", pidFile: "unverified", pidMatches: null },
  workerNative: { esbuildCount: null, otherCount: null, unknownCount: null, controlledIdentityVerified: null, unknownReasons: null },
  python: { version: null, executableVerified: null, afUnixApiAvailable: null, soPeercredApiAvailable: null, rejectionReason: null },
  layoutEvidence: { python: emptyPythonLayout(), nativeFileLinks: null },
});

test("maintenance bindings explicitly identify each phase and exact parent runs", () => {
  for (const phase of ["backup", "readiness", "deploy"]) {
    const value = buildProductionMaintenanceBinding(phase, env);
    assert.equal(value.mode, "maintenance");
    assert.equal(value.targetSha, env.TARGET_SHA);
    assert.equal(value.operationId, env.MAINTENANCE_OPERATION_ID);
    assert.equal(value.backupRunId, phase === "backup" ? env.GITHUB_RUN_ID : env.BACKUP_RUN_ID);
    assert.equal(value.readinessRunId, phase === "backup" ? null : phase === "readiness" ? env.GITHUB_RUN_ID : env.READINESS_RUN_ID);
    assert.equal(Object.isFrozen(value), true);
  }
});

test("off is explicit, has no operation, and cannot hide supplied maintenance inputs", () => {
  const off = { ...env, MAINTENANCE_MODE: "off", EXPECTED_OLD_SHA: "", MAINTENANCE_OPERATION_ID: "" };
  assert.equal(buildProductionMaintenanceBinding("backup", off).operationId, null);
  for (const patch of [{ MAINTENANCE_MODE: undefined }, { MAINTENANCE_MODE: "false" }, { EXPECTED_OLD_SHA: env.EXPECTED_OLD_SHA }, { MAINTENANCE_OPERATION_ID: env.MAINTENANCE_OPERATION_ID }]) {
    assert.throws(() => buildProductionMaintenanceBinding("backup", { ...off, ...patch }), failure);
  }
});

test("binding shape, phase, mode, UUID and run identities fail closed", () => {
  const valid = buildProductionMaintenanceBinding("deploy", env);
  for (const patch of [
    { extra: true }, { version: 2 }, { phase: "end" }, { mode: "unknown" }, { operationId: "not-a-uuid" },
    { expectedOldSha: "" }, { targetSha: "a".repeat(39) }, { runId: "01" }, { runAttempt: "0" },
    { backupRunId: "9007199254740992" }, { readinessRunId: valid.backupRunId }, { runId: valid.readinessRunId },
  ]) assert.throws(() => validateProductionMaintenanceBinding({ ...valid, ...patch }), failure);
  for (const key of Object.keys(valid)) {
    const missing = { ...valid };
    delete missing[key];
    assert.throws(() => validateProductionMaintenanceBinding(missing), failure);
  }
  assert.throws(() => validateProductionMaintenanceBinding(null), failure);
  assert.throws(() => validateProductionMaintenanceBinding([]), failure);
});

test("caller binding detects a different target, operation, old build, run or backup", () => {
  const valid = buildProductionMaintenanceBinding("readiness", env);
  for (const key of ["targetSha", "expectedOldSha", "operationId", "runId", "runAttempt", "backupRunId", "backupRunAttempt", "readinessRunId", "readinessRunAttempt", "mode", "phase"]) {
    assert.throws(() => validateProductionMaintenanceBinding(valid, { [key]: "different" }), failure);
  }
  assert.throws(() => validateProductionMaintenanceBinding(valid, { ignored: true }), failure);
  assert.deepEqual(validateProductionMaintenanceBinding(valid, valid), valid);
});

test("phase self-identities cannot be replaced by parent or unrelated runs", () => {
  const backup = buildProductionMaintenanceBinding("backup", env);
  assert.throws(() => validateProductionMaintenanceBinding({ ...backup, backupRunId: "999" }), failure);
  assert.throws(() => validateProductionMaintenanceBinding({ ...backup, readinessRunId: "999" }), failure);
  const readiness = buildProductionMaintenanceBinding("readiness", env);
  assert.throws(() => validateProductionMaintenanceBinding({ ...readiness, readinessRunAttempt: "999" }), failure);
});

test("verified provenance must identify only the exact canonical binding file and bytes", () => {
  const bytes = canonicalJsonBytes(buildProductionMaintenanceBinding("backup", env));
  const subject = { name: "production-maintenance-binding.json", digest: { sha256: createHash("sha256").update(bytes).digest("hex") } };
  const verified = (subjects) => [{ verificationResult: { statement: { subject: subjects } } }];
  assert.doesNotThrow(() => assertProductionMaintenanceProvenance(verified([subject]), bytes));
  for (const value of [[], {}, [null], verified([]), verified([subject, subject]), verified([{ ...subject, name: "other.json" }]), verified([{ ...subject, digest: { sha256: "0".repeat(64) } }])]) {
    assert.throws(() => assertProductionMaintenanceProvenance(value, bytes), failure);
  }
});

test("public control report admits only fixed metadata and plan cannot serve as held proof", () => {
  const report = { version: 1, operationId: env.MAINTENANCE_OPERATION_ID, targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA, state: "planned" };
  assert.equal(validateProductionMaintenanceControlReport(report, { state: "planned" }).state, "planned");
  assert.throws(() => validateProductionMaintenanceControlReport(report, { state: "held" }), failure);
  assert.throws(() => validateProductionMaintenanceControlReport({ ...report, rawEnvironment: {} }, {}), failure);
  assert.throws(() => validateProductionMaintenanceControlReport({ ...report, operationId: "invalid" }, {}), failure);
  assert.throws(() => validateProductionMaintenanceControlReport({ ...report, state: "failed-unknown" }, { state: "held" }), failure);
  assert.throws(() => validateProductionMaintenanceControlReport({ ...report, state: "runtime-held" }, {}), failure);
});
test("runtime diagnostic report is exact-bound, non-authoritative and never discloses arbitrary content", () => {
  const report = { version: 1, targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA, state: "runtime-diagnosed", diagnostics: diagnosticFixture() };
  const expected = { targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA };
  assert.deepEqual(validateProductionRuntimeDiagnosticReport(report, expected), report);
  assert.throws(() => validateProductionMaintenanceControlReport(report, {}), failure);
  for (const patch of [{ operationId: env.MAINTENANCE_OPERATION_ID }, { state: "held" }, { targetSha: env.EXPECTED_OLD_SHA },
    { expectedOldSha: env.TARGET_SHA }, { diagnostics: { ...diagnosticFixture(), raw: "never-disclose" } },
    { diagnostics: { ...diagnosticFixture(), pm2Home: "/never-disclose" } },
    { diagnostics: { ...diagnosticFixture(), version: 1 } },
    { diagnostics: { ...diagnosticFixture(), pm2Version: "6.0.8\nnever-disclose" } },
    { diagnostics: { ...diagnosticFixture(), python: { ...diagnosticFixture().python, executable: "/never-disclose" } } }]) {
    assert.throws(() => validateProductionRuntimeDiagnosticReport({ ...report, ...patch }, expected), failure);
  }
  const directory = mkdtempSync(join(tmpdir(), "faolla-runtime-diagnostic-contract-"));
  const file = join(directory, "report.json");
  const script = fileURLToPath(new URL("./production-maintenance-workflow-contract.mjs", import.meta.url));
  const execute = (value, additional = []) => {
    writeFileSync(file, JSON.stringify(value));
    return spawnSync(process.execPath, [script, "verify-runtime-diagnostic", "--file", file, "--target-sha", env.TARGET_SHA,
      "--old-sha", env.EXPECTED_OLD_SHA, ...additional], { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot ?? "" } });
  };
  try {
    const good = execute(report); assert.equal(good.status, 0); assert.deepEqual(JSON.parse(good.stdout), report);
    for (const value of [{ ...report, state: "held" }, { ...report, targetSha: env.EXPECTED_OLD_SHA },
      { ...report, diagnostics: { ...diagnosticFixture(), secret: "must-not-disclose" } }]) {
      const result = execute(value); assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
      assert.equal(result.stderr, "production_maintenance_binding_invalid\n");
    }
    for (const extra of [["--state", "held"], ["--operation-id", env.MAINTENANCE_OPERATION_ID], ["--github-output", "must-not-create"]]) {
      const result = execute(report, extra); assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("v4 fixed rejection and layout counts remain bounded and cannot become maintenance authority", () => {
  const reasons = createNativeUnknownReasonCounts();
  for (const key of Object.keys(reasons)) reasons[key] = Math.floor(16384 / Object.keys(reasons).length);
  const count = Object.values(reasons).reduce((sum, value) => sum + value, 0);
  const evidence = emptyNativeFileLinkEvidence();
  evidence.linkCounts.two = reasons.file_links; evidence.outcomes.matched = reasons.file_links;
  const diagnostics = { ...diagnosticFixture(), stability: "stable", disk: "verified",
    worker: { state: "owned", nodeDescendantCount: 1, nonNodeDescendantCount: count },
    workerNative: { esbuildCount: 0, otherCount: 0, unknownCount: count, controlledIdentityVerified: null, unknownReasons: reasons },
    python: { version: null, executableVerified: false, afUnixApiAvailable: null, soPeercredApiAvailable: null,
      rejectionReason: "target_not_executable" },
    layoutEvidence: { python: emptyPythonLayout(), nativeFileLinks: evidence } };
  const report = { version: 1, targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA,
    state: "runtime-diagnosed", diagnostics };
  const expected = { targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA };
  assert.deepEqual(validateProductionRuntimeDiagnosticReport(report, expected), report);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 4096);
  assert.throws(() => validateProductionMaintenanceControlReport(report, {}), failure);
  for (const patch of [
    { version: 3 },
    { layoutEvidence: { ...diagnostics.layoutEvidence, rawPath: "/private/python3" } },
    { layoutEvidence: { ...diagnostics.layoutEvidence, nativeFileLinks: { ...evidence, linkCounts: { ...evidence.linkCounts, two: 0 } } } },
    { python: { ...diagnostics.python, rejectionReason: "/private/executable" } },
    { workerNative: { ...diagnostics.workerNative, unknownReasons: { ...reasons, file_links: count + 1 } } },
    { workerNative: { ...diagnostics.workerNative, unknownReasons: { ...reasons, rawError: "secret" } } },
  ]) assert.throws(() => validateProductionRuntimeDiagnosticReport({ ...report, diagnostics: { ...diagnostics, ...patch } }, expected), failure);
  const directory = mkdtempSync(join(tmpdir(), "faolla-runtime-v4-contract-"));
  try {
    const file = join(directory, "report.json"); writeFileSync(file, JSON.stringify(report));
    const script = fileURLToPath(new URL("./production-maintenance-workflow-contract.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "verify-runtime-diagnostic", "--file", file,
      "--target-sha", env.TARGET_SHA, "--old-sha", env.EXPECTED_OLD_SHA],
    { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot ?? "" } });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), report);
    assert.equal(result.stderr, ""); assert.equal(Object.hasOwn(JSON.parse(result.stdout), "operationId"), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("runtime capability metadata is bounded and cannot grant a verified PM2 connection or held state", () => {
  const diagnostics = { ...diagnosticFixture(), stability: "stable", disk: "verified",
    supervision: "runtime_supervision_direct_next_owned", daemonCwdIsRoot: true,
    worker: { state: "owned", nodeDescendantCount: 1, nonNodeDescendantCount: 2 },
    pm2Version: "6.0.8", pm2Home: "matches", pm2PathOverridesPresent: false,
    pm2Endpoint: { home: "verified", rpcSocket: "verified", pidFile: "verified", pidMatches: true },
    workerNative: { esbuildCount: 2, otherCount: 0, unknownCount: 0, controlledIdentityVerified: true, unknownReasons: createNativeUnknownReasonCounts() },
    python: { version: "3.12.3", executableVerified: true, afUnixApiAvailable: true, soPeercredApiAvailable: true, rejectionReason: null },
    layoutEvidence: { python: emptyPythonLayout(), nativeFileLinks: emptyNativeFileLinkEvidence() } };
  const report = { version: 1, targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA, state: "runtime-diagnosed", diagnostics };
  const expected = { targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA };
  assert.deepEqual(validateProductionRuntimeDiagnosticReport(report, expected), report);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 4096);
  assert.throws(() => validateProductionMaintenanceControlReport(report, { state: "held" }), failure);
  for (const patch of [{ pm2Connection: "verified" }, { maintenance: "held" },
    { pm2Endpoint: { ...diagnostics.pm2Endpoint, home: "/private" } },
    { python: { ...diagnostics.python, version: "private-value" } },
    { workerNative: { ...diagnostics.workerNative, otherCount: 1 } }]) {
    assert.throws(() => validateProductionRuntimeDiagnosticReport({ ...report, diagnostics: { ...diagnostics, ...patch } }, expected), failure);
  }
});

test("PM2 peer public report is exact-bound, redacted and cannot establish held state", () => {
  const diagnostics = { version: 1, maintenance: "not_verified", peerVerified: true, pm2Version: "6.0.8" };
  const report = { version: 1, targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA, state: "pm2-peer-diagnosed", diagnostics };
  const expected = { targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA };
  assert.deepEqual(validateProductionPm2PeerDiagnosticReport(report, expected), report);
  const unknown = { ...report, diagnostics: { version: 1, maintenance: "not_verified", peerVerified: null, pm2Version: null } };
  assert.deepEqual(validateProductionPm2PeerDiagnosticReport(unknown, expected), unknown);
  for (const value of [report, unknown]) assert.throws(() => validateProductionMaintenanceControlReport(value, { state: "held" }), failure);
  for (const patch of [{ operationId: env.MAINTENANCE_OPERATION_ID }, { raw: "must-not-disclose" }, { state: "held" },
    { targetSha: env.EXPECTED_OLD_SHA }, { expectedOldSha: env.TARGET_SHA },
    ...[{ socketPath: "/private/rpc.sock" }, { pid: 123 }, { maintenance: "held" }, { peerVerified: false },
      { peerVerified: null }, { pm2Version: null }, { pm2Version: "6.0.8\nmust-not-disclose" }].map((item) => ({ diagnostics: { ...diagnostics, ...item } }))]) {
    assert.throws(() => validateProductionPm2PeerDiagnosticReport({ ...report, ...patch }, expected), failure);
  }
  for (const invalidExpected of [{ targetSha: env.EXPECTED_OLD_SHA }, { expectedOldSha: env.TARGET_SHA }, { state: "held" }, { operationId: env.MAINTENANCE_OPERATION_ID }]) {
    assert.throws(() => validateProductionPm2PeerDiagnosticReport(report, invalidExpected), failure);
  }
});

test("PM2 peer report CLI admits only bounded exact diagnostic JSON and never emits contaminated content", () => {
  const report = { version: 1, targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA, state: "pm2-peer-diagnosed",
    diagnostics: { version: 1, maintenance: "not_verified", peerVerified: true, pm2Version: "6.0.8" } };
  const directory = mkdtempSync(join(tmpdir(), "faolla-pm2-peer-diagnostic-contract-"));
  const file = join(directory, "report.json");
  const script = fileURLToPath(new URL("./production-maintenance-workflow-contract.mjs", import.meta.url));
  const execute = (bytes, additional = []) => {
    writeFileSync(file, bytes);
    return spawnSync(process.execPath, [script, "verify-pm2-peer-diagnostic", "--file", file,
      "--target-sha", env.TARGET_SHA, "--old-sha", env.EXPECTED_OLD_SHA, ...additional],
    { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot ?? "" } });
  };
  const rejected = (result) => {
    assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "production_maintenance_binding_invalid\n");
  };
  try {
    for (const diagnostics of [report.diagnostics, { version: 1, maintenance: "not_verified", peerVerified: null, pm2Version: null }]) {
      const value = { ...report, diagnostics };
      const result = execute(JSON.stringify(value));
      assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), value); assert.equal(result.stderr, "");
    }
    for (const value of [{ ...report, state: "held" }, { ...report, targetSha: env.EXPECTED_OLD_SHA },
      { ...report, operationId: env.MAINTENANCE_OPERATION_ID }, { ...report, raw: "must-not-disclose" },
      { ...report, diagnostics: { ...report.diagnostics, socketPath: "/must-not-disclose" } }]) rejected(execute(JSON.stringify(value)));
    for (const bytes of ["{must-not-disclose", "x".repeat(4097), "null", "[]"]) rejected(execute(bytes));
    for (const extra of [["--state", "held"], ["--operation-id", env.MAINTENANCE_OPERATION_ID],
      ["--github-output", join(directory, "must-not-create")], ["--target-sha", env.TARGET_SHA], ["--old-sha", env.EXPECTED_OLD_SHA]]) {
      rejected(execute(JSON.stringify(report), extra));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("failed prepare CLI diagnostics disclose only valid exact-bound metadata and never become held proof", () => {
  const directory = mkdtempSync(join(tmpdir(), "faolla-maintenance-diagnostic-"));
  const file = join(directory, "report.json");
  const script = fileURLToPath(new URL("./production-maintenance-workflow-contract.mjs", import.meta.url));
  const report = { version: 1, operationId: env.MAINTENANCE_OPERATION_ID, targetSha: env.TARGET_SHA, expectedOldSha: env.EXPECTED_OLD_SHA, state: "failed-unknown" };
  const execute = (value, state = "failed-unknown") => {
    writeFileSync(file, JSON.stringify(value));
    return spawnSync(process.execPath, [script, "verify-control", "--file", file, "--state", state, "--target-sha", env.TARGET_SHA, "--old-sha", env.EXPECTED_OLD_SHA], {
      encoding: "utf8", env: { SystemRoot: process.env.SystemRoot ?? "" },
    });
  };
  try {
    for (const state of ["failed-held", "failed-unknown"]) {
      const result = execute({ ...report, state }, state);
      assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), { ...report, state });
    }
    for (const value of [{ ...report, targetSha: env.EXPECTED_OLD_SHA }, { ...report, expectedOldSha: env.TARGET_SHA }, { ...report, raw: "must-never-disclose" }, { ...report, operationId: "wrong" }, { ...report, state: "held" }]) {
      const result = execute(value); assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
    }
    assert.notEqual(execute(report, "held").status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const names = ["production-maintenance", "database-backup", "database-migrate", "ordinary-account-cutover-readiness", "deploy", "revoke-legacy-browser-auth-sessions"];
const sources = Object.fromEntries(names.map((name) => [name, readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8")]));
const workflows = Object.fromEntries(names.map((name) => [name, yaml.load(sources[name])]));
const steps = (name) => Object.values(workflows[name].jobs)[0].steps;
const step = (name, label) => {
  const matches = steps(name).filter((item) => item.name === label);
  assert.equal(matches.length, 1, `${name}: ${label}`);
  return matches[0];
};

test("all affected workflow YAML and embedded bash remain syntactically valid", () => {
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  for (const name of names) {
    assert.equal(workflows[name].concurrency.group, "production-deploy");
    assert.equal(workflows[name].concurrency["cancel-in-progress"], false);
    for (const item of steps(name).filter((entry) => entry.run)) {
      const result = spawnSync(bash, ["-n"], { input: item.run, encoding: "utf8" });
      assert.equal(result.status, 0, `${name}: ${item.name}\n${result.stderr}`);
    }
  }
});

test("maintenance control is a fixed manual current-main exact-CI pinned-SSH workflow", () => {
  const source = sources["production-maintenance"];
  assert.deepEqual(workflows["production-maintenance"].on.workflow_dispatch.inputs.action.options, ["diagnose-runtime", "diagnose-pm2-peer", "plan", "prepare", "recover-held", "continue-held", "recover-build", "check", "end"]);
  assert.deepEqual(Object.keys(workflows["production-maintenance"].on), ["workflow_dispatch"]);
  assert.match(source, /CHECK_PRODUCTION_MAINTENANCE_PLAN/);
  assert.match(source, /test "\$TARGET_SHA" = "\$GITHUB_SHA"/);
  assert.match(source, /test "\$GITHUB_RUN_ATTEMPT" = 1/);
  const ci = step("production-maintenance", "Require Current Main And Exact Successful Push CI").run;
  assert.match(ci, /commits\/main/);
  assert.match(ci, /\.event == "push"/);
  assert.match(ci, /\.conclusion == "success"/);
  assert.match(source, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(source, /StrictHostKeyChecking=(?:no|accept-new)|continue-on-error: true|gh workflow run/);
  const control = step("production-maintenance", "Execute Fixed Maintenance Transition").run;
  assert.match(control, /case "\$ACTION" in/);
  assert.match(control, /plan\) command=plan; expected_state=planned/);
  assert.match(control, /prepare\) command=prepare; expected_state=held/);
  assert.match(control, /\*\) exit 1 ;;/);
  const failed = control.slice(control.indexOf('if [ "$status" -ne 0 ]'));
  assert.match(failed, /if \[ "\$ACTION" = prepare \] && \[ -s "\$capture_dir\/out" \]/);
  assert.match(failed, /for failed_state in failed-held failed-unknown/);
  assert.match(failed, /--state "\$failed_state" --target-sha "\$TARGET_SHA"/);
  assert.match(failed, /--old-sha "\$EXPECTED_OLD_SHA"/);
  assert.match(failed, /production_maintenance_transition_unconfirmed'\n\s+exit 1/);
});

test("migrated continuation independently verifies original signed evidence before its single explicit transition", () => {
  const name = "production-maintenance";
  const validation = step(name, "Validate Fixed Manual Transition").run;
  assert.match(validation, /continue-held\)\n\s+test "\$CONFIRMATION" = CONTINUE_MIGRATED_PRODUCTION_MAINTENANCE/);
  for (const fixed of ["eb81284a-09c4-4514-8f16-38eaf6acc1e4", "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf", "cd943076ebda758b70bf2f2270a508c774b726d6"])
    assert.ok(validation.includes(fixed));
  const labels = ["Inspect Migrated Unlaunched Continuation State", "Verify Original Signed Backup And Readiness Bindings",
    "Verify Exact Continuation History Under Production Lock", "Execute Fixed Maintenance Transition"];
  const positions = labels.map((label) => steps(name).findIndex((item) => item.name === label));
  assert.ok(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1])));
  for (const label of labels.slice(0, 3)) assert.equal(step(name, label).if, "inputs.action == 'continue-held'");
  const inspection = step(name, labels[0]).run;
  assert.match(inspection, /inspect-continuation .*--previous-target-sha .*--expected-operation-id/);
  assert.match(inspection, /StrictHostKeyChecking=yes/);
  assert.match(inspection, /production_maintenance_continuation_inspection_unconfirmed/);
  const bindings = step(name, labels[1]).run;
  for (const required of ["34715932102", "34721256683", "gh attestation verify", "--signer-workflow", "--source-digest \"$PREVIOUS_TARGET_SHA\"",
    "--source-ref refs/heads/main", "--predicate-type https://slsa.dev/provenance/v1", "--deny-self-hosted-runners", "--name \"faolla-maintenance-$phase-binding-$run_id-1\""])
    assert.ok(bindings.includes(required), required);
  const history = step(name, labels[2]);
  assert.match(history.run, /production-maintenance-continuation-workflow\.mjs/);
  assert.match(history.run, /--inspection "\$INSPECTION_DIR\/out" --prior-bindings "\$PRIOR_BINDINGS_DIR"/);
  assert.equal(history.env.GH_TOKEN, "${{ github.token }}");
  const transition = step(name, labels[3]);
  assert.equal(transition.env.CONTINUATION_EVIDENCE, "${{ steps.continuation-evidence.outputs.continuation_evidence }}");
  assert.match(transition.run, /continue-held\) command=continue-held; expected_state=held/);
  assert.match(transition.run, /--previous-target-sha "\$PREVIOUS_TARGET_SHA" --continuation-evidence "\$CONTINUATION_EVIDENCE"/);
  assert.match(transition.run, /test "\$\{#CONTINUATION_EVIDENCE\}" -le 16384/);
  assert.match(transition.run, /else\n\s+test -z "\$CONTINUATION_EVIDENCE"/);
  const cleanup = step(name, "Remove Runner Continuation Evidence");
  assert.equal(cleanup.if, "always() && inputs.action == 'continue-held'");
  assert.match(cleanup.run, /maintenance-continuation\.\?\?\?\?\?\?\?\?/);
  assert.match(cleanup.run, /maintenance-prior-bindings\.\?\?\?\?\?\?\?\?/);
  assert.doesNotMatch(cleanup.run, /rm -rf|operation\.json|maintenance\.json/);
});


test("build recovery is a separately confirmed fixed incident with no old-path target override", () => {
  const source = step("production-maintenance", "Validate Fixed Manual Transition").run;
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  const fixed = { GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1", TARGET_SHA: "a".repeat(40), GITHUB_SHA: "a".repeat(40),
    EXPECTED_OLD_SHA: "cd943076ebda758b70bf2f2270a508c774b726d6",
    PREVIOUS_TARGET_SHA: "46f007fbd9e417f93c01e398c77cf38ec814547d",
    MAINTENANCE_OPERATION_ID: "eb81284a-09c4-4514-8f16-38eaf6acc1e4",
    ACTION: "recover-build", CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T100000Z",
    DEPLOY_RUN_ID: "", DEPLOY_RUN_ATTEMPT: "", CHECK_STATE: "held" };
  const execute = patch => spawnSync(bash, ["-s"], { input: source,
    env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "", ...fixed, ...patch }, encoding: "utf8", timeout: 5000, maxBuffer: 4096 });
  assert.equal(execute({}).status, 0);
  for (const patch of [{ CONFIRMATION: "RECOVER_PRODUCTION_MAINTENANCE" }, { CONFIRMATION: "CONTINUE_MIGRATED_PRODUCTION_MAINTENANCE" },
    { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE" }, { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T100034Z" },
    { CONFIRMATION: "RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T120000Z" }, { CONFIRMATION: "" },
    { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_EVENT_NAME: "schedule" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REPOSITORY: "other/space" }, { PREVIOUS_TARGET_SHA: "b".repeat(40) }, { EXPECTED_OLD_SHA: "b".repeat(40) },
    { MAINTENANCE_OPERATION_ID: env.MAINTENANCE_OPERATION_ID }, { GITHUB_SHA: "b".repeat(40) },
    { TARGET_SHA: fixed.PREVIOUS_TARGET_SHA, GITHUB_SHA: fixed.PREVIOUS_TARGET_SHA },
    { TARGET_SHA: fixed.EXPECTED_OLD_SHA, GITHUB_SHA: fixed.EXPECTED_OLD_SHA },
    { DEPLOY_RUN_ID: "123" }, { DEPLOY_RUN_ATTEMPT: "1" }]) {
    const result = execute(patch); assert.notEqual(result.status, 0, JSON.stringify(patch)); assert.equal(result.stdout, "");
  }
  for (const [ACTION, CONFIRMATION, extra] of [
    ["plan", "CHECK_PRODUCTION_MAINTENANCE_PLAN", { MAINTENANCE_OPERATION_ID: "" }],
    ["prepare", "PREPARE_PRODUCTION_MAINTENANCE", { MAINTENANCE_OPERATION_ID: "" }],
    ["check", "CHECK_PRODUCTION_MAINTENANCE", {}],
    ["end", "END_PRODUCTION_MAINTENANCE", { DEPLOY_RUN_ID: "123", DEPLOY_RUN_ATTEMPT: "1" }],
  ]) assert.notEqual(execute({ ACTION, CONFIRMATION, ...extra }).status, 0, ACTION);
  const old = { ACTION: "continue-held", CONFIRMATION: "CONTINUE_MIGRATED_PRODUCTION_MAINTENANCE",
    PREVIOUS_TARGET_SHA: "b7c3d57f4739846fb45f236ef83b97b7ff21a7cf" };
  assert.equal(execute(old).status, 0);
  assert.notEqual(execute({ ...old, TARGET_SHA: old.PREVIOUS_TARGET_SHA, GITHUB_SHA: old.PREVIOUS_TARGET_SHA }).status, 0);
});

test("build recovery exposes one fixed absolute deadline and no TTL or replacement-operation input", () => {
  const inputs = workflows["production-maintenance"].on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs), ["action", "target_sha", "expected_old_sha", "maintenance_operation_id", "previous_target_sha",
    "check_state", "successful_deploy_run_id", "successful_deploy_run_attempt", "confirmation"]);
  assert.match(inputs.confirmation.description, /RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T100000Z/);
  assert.match(inputs.confirmation.description, /absolute deadline 2026-09-13 10:00:00 UTC \/ 12:00 Europe\/Madrid/);
  const validation = step("production-maintenance", "Validate Fixed Manual Transition").run;
  const recovery = validation.slice(validation.indexOf("recover-build)"), validation.indexOf("check|end)"));
  assert.match(recovery, /test "\$MAINTENANCE_OPERATION_ID" = eb81284a-09c4-4514-8f16-38eaf6acc1e4/);
  assert.match(recovery, /test "\$CONFIRMATION" = RECOVER_BUILD_PRODUCTION_MAINTENANCE_UNTIL_20260913T100000Z\n/);
  assert.doesNotMatch(sources["production-maintenance"], /inputs\.(?:ttl|deadline|expires_at|authorized_at|new_operation_id)|--(?:ttl|deadline|expires-at|new-operation-id)\b/);
});

test("build recovery inspects first, verifies exact T3 B3/R3 hosted signatures, then audits history under the shared lock", () => {
  const name = "production-maintenance", workflow = workflows[name];
  assert.equal(workflow.concurrency.group, "production-deploy"); assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const labels = ["Inspect Failed Unlaunched Build Recovery State", "Verify Build Incident Signed Backup And Readiness Bindings",
    "Verify Exact Build Recovery History Under Production Lock", "Execute Fixed Maintenance Transition"];
  const positions = labels.map(label => steps(name).findIndex(item => item.name === label));
  assert.ok(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1])));
  for (const label of labels.slice(0, 3)) assert.equal(step(name, label).if, "inputs.action == 'recover-build'");
  const inspection = step(name, labels[0]).run;
  assert.match(inspection, /inspect-build-recovery .*--target-sha .*--previous-target-sha .*--expected-old-sha .*--expected-operation-id/);
  assert.match(inspection, /umask 077/); assert.match(inspection, /StrictHostKeyChecking=yes/);
  assert.match(inspection, /ConnectionAttempts=1/); assert.match(inspection, /600s/);
  assert.match(inspection, /> "\$capture_dir\/out" 2> "\$capture_dir\/err" \|\| status=\$\?/);
  assert.match(inspection, /if \[ "\$status" -ne 0 \] \|\| \[ -s "\$capture_dir\/err" \]/);
  assert.doesNotMatch(inspection, /verify-control|--state held|cat "\$capture_dir|fail-held|restoreIngress|start-candidate/);
  const signed = step(name, labels[1]).run;
  for (const value of ['test "$PREVIOUS_TARGET_SHA" = 46f007fbd9e417f93c01e398c77cf38ec814547d',
    "backup) run_id=34724943157; workflow=database-backup.yml", "readiness) run_id=34728212357; workflow=ordinary-account-cutover-readiness.yml",
    'gh run download "$run_id" --repo "$GITHUB_REPOSITORY"', '--name "faolla-maintenance-$phase-binding-$run_id-1"',
    'test ! -L "$binding_dir/$phase/production-maintenance-binding.json"', "gh attestation verify",
    '--signer-workflow "github.com/$GITHUB_REPOSITORY/.github/workflows/$workflow"',
    '--source-digest "$PREVIOUS_TARGET_SHA" --source-ref refs/heads/main',
    "--predicate-type https://slsa.dev/provenance/v1 --deny-self-hosted-runners",
    '--limit 10 --format json > "$binding_dir/$phase/provenance.json"']) assert.ok(signed.includes(value), value);
  assert.doesNotMatch(signed, /--source-digest "\$TARGET_SHA"|encrypted-disaster|tar\.enc|gh workflow|gh run rerun/);
  const history = step(name, labels[2]);
  assert.equal(history.env.INSPECTION_DIR, "${{ steps.build-recovery-inspection.outputs.capture_dir }}");
  assert.equal(history.env.PRIOR_BINDINGS_DIR, "${{ steps.build-recovery-prior-bindings.outputs.capture_dir }}");
  assert.equal(history.env.GH_TOKEN, "${{ github.token }}");
  assert.match(history.run, /node scripts\/production-maintenance-build-recovery-workflow\.mjs/);
  assert.match(history.run, /--inspection "\$INSPECTION_DIR\/out" --prior-bindings "\$PRIOR_BINDINGS_DIR"/);
});

test("build recovery sends one bounded grant only to its explicit action and never auto-retries or cleanup-mutates it", () => {
  const transition = step("production-maintenance", "Execute Fixed Maintenance Transition");
  assert.equal(transition.env.BUILD_RECOVERY_EVIDENCE, "${{ steps.build-recovery-evidence.outputs.build_recovery_evidence }}");
  assert.match(transition.run, /recover-build\) command=recover-build; expected_state=held/);
  const endOfPrefix = transition.run.indexOf('capture_dir="$(mktemp -d "$RUNNER_TEMP/maintenance-transition.');
  assert.ok(endOfPrefix > 0);
  const prefix = transition.run.slice(0, endOfPrefix) + '\nprintf "%s\\n" "$command" "$expected_state" "${operation_args[@]}"\n';
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  const fixed = { ACTION: "recover-build", APP_NAME: "merchant-space", APP_PORT: "3000", CHECK_STATE: "held",
    MAINTENANCE_OPERATION_ID: env.MAINTENANCE_OPERATION_ID, PREVIOUS_TARGET_SHA: "a".repeat(40),
    RECOVERY_EVIDENCE: "", CONTINUATION_EVIDENCE: "", BUILD_RECOVERY_EVIDENCE: "YQ" };
  const execute = patch => spawnSync(bash, ["-s"], { input: prefix,
    env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "", ...fixed, ...patch }, encoding: "utf8", timeout: 5000, maxBuffer: 20480 });
  assert.deepEqual(execute({}).stdout.trim().split("\n"), ["recover-build", "held", "--expected-operation-id",
    fixed.MAINTENANCE_OPERATION_ID, "--previous-target-sha", fixed.PREVIOUS_TARGET_SHA, "--build-recovery-evidence", "YQ"]);
  for (const patch of [{ BUILD_RECOVERY_EVIDENCE: "" }, { BUILD_RECOVERY_EVIDENCE: "YQ==" }, { BUILD_RECOVERY_EVIDENCE: "a".repeat(16385) },
    { BUILD_RECOVERY_EVIDENCE: "YQ\n" }, { RECOVERY_EVIDENCE: "YQ" }, { CONTINUATION_EVIDENCE: "YQ" },
    ...["plan", "prepare", "recover-held", "continue-held", "check", "end"].map(ACTION => ({ ACTION }))]) {
    const result = execute(patch); assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
  }
  assert.equal((transition.run.match(/ssh -T /g) ?? []).length, 1);
  assert.doesNotMatch(transition.run, /while |for .*attempt|gh run rerun|restoreIngress|start-candidate/);
  assert.equal(step("production-maintenance", "Reclose Entry And Fail Held If End Is Unconfirmed").if,
    "always() && (failure() || cancelled()) && inputs.action == 'end' && steps.transition.outputs.attempted == 'true'");
});

test("build recovery cleanup is always scoped to its private runner captures, not operation state or another path", () => {
  const cleanup = step("production-maintenance", "Remove Runner Build Recovery Evidence");
  assert.equal(cleanup.if, "always() && inputs.action == 'recover-build'");
  assert.equal(cleanup.env.INSPECTION_DIR, "${{ steps.build-recovery-inspection.outputs.capture_dir }}");
  assert.equal(cleanup.env.PRIOR_BINDINGS_DIR, "${{ steps.build-recovery-prior-bindings.outputs.capture_dir }}");
  for (const value of ['"$RUNNER_TEMP"/maintenance-build-recovery.????????', '"$RUNNER_TEMP"/maintenance-build-prior-bindings.????????',
    'rm -f -- "$INSPECTION_DIR/out" "$INSPECTION_DIR/err"',
    'rm -f -- "$PRIOR_BINDINGS_DIR/$phase/production-maintenance-binding.json" "$PRIOR_BINDINGS_DIR/$phase/provenance.json"',
    'for phase in backup readiness', 'test ! -L "$INSPECTION_DIR"', 'test ! -L "$PRIOR_BINDINGS_DIR"'])
    assert.ok(cleanup.run.includes(value), value);
  assert.doesNotMatch(cleanup.run, /rm -rf|sudo|ssh |operation\.json|maintenance\.json|fail-held|--build-recovery-evidence/);
});

test("the daily scheduled backup remains off-mode and is not implicitly a maintenance backup or an ignored history exception", () => {
  const backup = workflows["database-backup"], job = Object.values(backup.jobs)[0];
  assert.deepEqual(backup.on.schedule, [{ cron: "17 2 * * *" }]);
  assert.equal(backup.concurrency.group, "production-deploy");
  assert.equal(job.if, undefined);
  assert.equal(job.env.MAINTENANCE_MODE, "${{ inputs.maintenance_mode && 'maintenance' || 'off' }}");
  assert.equal(job.env.MAINTENANCE_OPERATION_ID, "${{ inputs.maintenance_operation_id }}");
  for (const name of ["Verify Held Maintenance Before Backup", "Verify Held Maintenance After Backup Capture", "Verify Held Maintenance Before Backup Attestation"])
    assert.equal(step("database-backup", name).if, "env.MAINTENANCE_MODE == 'maintenance'");
});


test("runtime diagnostic workflow is a separately confirmed read-only action without release outputs", () => {
  const validation = step("production-maintenance", "Validate Fixed Manual Transition").run;
  assert.match(validation, /diagnose-runtime\)\n\s+test "\$CONFIRMATION" = CHECK_PRODUCTION_RUNTIME_COMPATIBILITY\n\s+test -z "\$MAINTENANCE_OPERATION_ID"/);
  const control = step("production-maintenance", "Execute Fixed Maintenance Transition").run;
  assert.match(control, /diagnose-runtime\) command=diagnose-runtime; expected_state=runtime-diagnosed/);
  assert.match(control, /\[ "\$command" != diagnose-runtime \]/);
  assert.match(control, /if \[ "\$command" = diagnose-runtime \]; then\n\s+node scripts\/production-maintenance-workflow-contract\.mjs verify-runtime-diagnostic[\s\S]+?exit 0\n[ \t]*fi/);
  const source = readFileSync(new URL("./production-maintenance-control.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(request\.action === "diagnose-runtime"\) \{[^}]+createRuntimeDiagnosticReport\(request\);\n\s+\} else if \(request\.action === "diagnose-pm2-peer"\) \{\n\s+result = await createPm2PeerDiagnosticReport\(request\);\n\s+\} else \{\n\s+const ops = await productionOperations\(request\);/);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  const base = { SystemRoot: process.env.SystemRoot ?? "", GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: env.TARGET_SHA, TARGET_SHA: env.TARGET_SHA,
    EXPECTED_OLD_SHA: env.EXPECTED_OLD_SHA, ACTION: "diagnose-runtime", CONFIRMATION: "CHECK_PRODUCTION_RUNTIME_COMPATIBILITY",
    MAINTENANCE_OPERATION_ID: "", DEPLOY_RUN_ID: "", DEPLOY_RUN_ATTEMPT: "", CHECK_STATE: "held" };
  const execute = (patch) => spawnSync(bash, ["-s"], { input: validation, encoding: "utf8", env: { ...base, ...patch } });
  assert.equal(execute({}).status, 0);
  for (const patch of [{ CONFIRMATION: "CHECK_PRODUCTION_MAINTENANCE_PLAN" }, { MAINTENANCE_OPERATION_ID: env.MAINTENANCE_OPERATION_ID },
    { DEPLOY_RUN_ID: "123" }, { DEPLOY_RUN_ATTEMPT: "1" }, { GITHUB_REF: "refs/heads/other" }, { GITHUB_SHA: env.EXPECTED_OLD_SHA }]) {
    assert.notEqual(execute(patch).status, 0);
  }
});

test("PM2 peer workflow requires its fixed confirmation and bypasses maintenance state and locks", () => {
  const validation = step("production-maintenance", "Validate Fixed Manual Transition").run;
  assert.match(validation, /diagnose-pm2-peer\)\n\s+test "\$CONFIRMATION" = CHECK_PRODUCTION_PM2_PEER\n\s+test -z "\$MAINTENANCE_OPERATION_ID"\n\s+test -z "\$DEPLOY_RUN_ID" && test -z "\$DEPLOY_RUN_ATTEMPT"/);
  const control = step("production-maintenance", "Execute Fixed Maintenance Transition").run;
  assert.match(control, /diagnose-pm2-peer\) command=diagnose-pm2-peer; expected_state=pm2-peer-diagnosed/);
  assert.match(control, /\[ "\$command" != diagnose-pm2-peer \]/);
  const branch = control.match(/if \[ "\$command" = diagnose-pm2-peer \]; then\n[\s\S]+?\n[ \t]*fi/)?.[0];
  assert.ok(branch);
  assert.match(branch, /verify-pm2-peer-diagnostic[\s\S]+--file "\$capture_dir\/out"[\s\S]+--target-sha "\$TARGET_SHA"[\s\S]+--old-sha "\$EXPECTED_OLD_SHA"[\s\S]+exit 0/);
  assert.doesNotMatch(branch, /verify-control|GITHUB_OUTPUT|operation-id/);
  const successVerification = control.indexOf("\nnode scripts/production-maintenance-workflow-contract.mjs verify-control");
  assert.ok(successVerification > control.indexOf(branch));
  const source = readFileSync(new URL("./production-maintenance-control.mjs", import.meta.url), "utf8");
  assert.match(source, /else if \(request\.action === "diagnose-pm2-peer"\) \{\n\s+result = await createPm2PeerDiagnosticReport\(request\);\n\s+\} else \{\n\s+const ops = await productionOperations\(request\);\n\s+result = await withPrivateOperationLock\(request, \(\) => runMaintenanceAction\(request, ops\)\);/);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  const base = { SystemRoot: process.env.SystemRoot ?? "", GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: env.TARGET_SHA, TARGET_SHA: env.TARGET_SHA,
    EXPECTED_OLD_SHA: env.EXPECTED_OLD_SHA, ACTION: "diagnose-pm2-peer", CONFIRMATION: "CHECK_PRODUCTION_PM2_PEER",
    MAINTENANCE_OPERATION_ID: "", DEPLOY_RUN_ID: "", DEPLOY_RUN_ATTEMPT: "", CHECK_STATE: "held" };
  const execute = (patch) => spawnSync(bash, ["-s"], { input: validation, encoding: "utf8", env: { ...base, ...patch } });
  assert.equal(execute({}).status, 0);
  for (const patch of [{ CONFIRMATION: "CHECK_PRODUCTION_RUNTIME_COMPATIBILITY" }, { CONFIRMATION: "CHECK_PRODUCTION_PM2_PEER\nextra" },
    { MAINTENANCE_OPERATION_ID: env.MAINTENANCE_OPERATION_ID }, { DEPLOY_RUN_ID: "123" }, { DEPLOY_RUN_ATTEMPT: "1" },
    { GITHUB_REF: "refs/heads/other" }, { GITHUB_SHA: env.EXPECTED_OLD_SHA }, { GITHUB_RUN_ATTEMPT: "2" }]) {
    assert.notEqual(execute(patch).status, 0);
  }
});

test("plan failure prints only one exact allowlisted stage code and always fails", () => {
  const control = step("production-maintenance", "Execute Fixed Maintenance Transition").run;
  const start = control.indexOf('if [ "$status" -ne 0 ]');
  const end = control.indexOf('\nnode scripts/production-maintenance-workflow-contract.mjs verify-control', start);
  assert.ok(start >= 0 && end > start);
  const failed = control.slice(start, end);
  const directory = mkdtempSync(join(tmpdir(), "faolla-maintenance-plan-diagnostic-"));
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  const codes = [
    "maintenance_plan_operation_state_unverified",
    "maintenance_plan_runtime_unverified",
    "maintenance_plan_public_gateway_unverified",
    "maintenance_plan_ingress_unverified",
    "maintenance_plan_database_unverified",
    "maintenance_plan_installation_unverified",
  ];
  const execute = (stderr, action = "plan", status = "1") => {
    writeFileSync(join(directory, "err"), stderr);
    writeFileSync(join(directory, "out"), "");
    return spawnSync(bash, ["-s"], {
      input: `set -euo pipefail\nnode() { "$NODE_BINARY" "$@"; }\n${failed}\nexit 0\n`,
      encoding: "utf8",
      env: {
        SystemRoot: process.env.SystemRoot ?? "", NODE_BINARY: process.execPath.replaceAll("\\", "/"),
        capture_dir: directory.replaceAll("\\", "/"), ACTION: action, status,
      },
    });
  };
  try {
    for (const code of codes) {
      for (const ending of ["", "\n"]) {
        const result = execute(code + ending);
        assert.equal(result.status, 1, code);
        assert.equal(result.stdout, code + "\n");
        assert.equal(result.stderr, "");
      }
    }
    const code = codes[0];
    for (const invalid of [
      "", "unknown_error\n", "must-never-disclose-secret\n", `${code}\n\n`,
      `${code}\nmust-never-disclose-secret\n`, `warning\n${code}\n`,
      `${code}\n${codes[1]}\n`, `${code}\r\n`, `${code} `, ` ${code}`,
      `${code}\0`, "x".repeat(256),
    ]) {
      const result = execute(invalid);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "production_maintenance_transition_unconfirmed\n");
      assert.equal(result.stderr, "");
    }
    for (const action of ["prepare", "check", "end"]) {
      const result = execute(code + "\n", action);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "production_maintenance_transition_unconfirmed\n");
      assert.equal(result.stderr, "");
    }
    const unconfirmed = execute(code + "\n", "plan", "0");
    assert.equal(unconfirmed.status, 1);
    assert.equal(unconfirmed.stdout, code + "\n");
    assert.equal(unconfirmed.stderr, "");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("end requires a successful exact deploy and its signed matching operation before opening", () => {
  const meta = step("production-maintenance", "Require Exact Successful Maintenance Deploy Before End");
  assert.match(meta.run, /\.conclusion == "success"/);
  assert.match(meta.run, /\.path == "\.github\/workflows\/deploy.yml"/);
  const binding = step("production-maintenance", "Verify Signed Deploy Maintenance Binding");
  assert.match(binding.run, /--old-sha "\$EXPECTED_OLD_SHA"/);
  assert.match(binding.run, /--operation-id "\$MAINTENANCE_OPERATION_ID"/);
  assert.match(binding.run, /--source-digest "\$BINDING_TARGET_SHA"/);
  assert.ok(steps("production-maintenance").indexOf(binding) < steps("production-maintenance").indexOf(step("production-maintenance", "Execute Fixed Maintenance Transition")));
  assert.equal(step("production-maintenance", "Verify Real Public Release After End").if, "inputs.action == 'end'");
  const rollback = step("production-maintenance", "Reclose Entry And Fail Held If End Is Unconfirmed");
  assert.match(rollback.if, /always\(\) && \(failure\(\) \|\| cancelled\(\)\)/);
  assert.match(rollback.if, /failure\(\).*inputs.action == 'end'.*attempted == 'true'/);
  assert.match(rollback.run, /node %q fail-held/);
});

test("new backup/readiness/deploy always sign their binding even when maintenance is off", () => {
  for (const name of ["database-backup", "ordinary-account-cutover-readiness", "deploy"]) {
    assert.equal(step(name, "Build Canonical Maintenance Binding").if, undefined);
    assert.equal(step(name, "Attest Canonical Maintenance Binding").uses, "actions/attest@v4");
    assert.equal(step(name, "Upload Canonical Maintenance Binding").with["if-no-files-found"], "error");
  }
  for (const name of ["database-migrate", "ordinary-account-cutover-readiness"]) {
    const binding = step(name, "Verify Signed Backup Maintenance Binding");
    assert.equal(binding.if, undefined);
    assert.match(binding.run, /--mode "\$MAINTENANCE_MODE" --operation-id "\$MAINTENANCE_OPERATION_ID" --old-sha "\$EXPECTED_OLD_SHA"/);
  }
  assert.match(step("deploy", "Verify Signed Readiness Maintenance Binding").run, /--backup-run-id "\$EXPECTED_BACKUP_RUN_ID"/);
});

test("maintenance gates bracket capture/migration/readiness without pretending live old smoke passed", () => {
  const order = (name, before, during, after) => {
    const all = steps(name);
    assert.ok(all.indexOf(step(name, before)) < all.indexOf(step(name, during)));
    assert.ok(all.indexOf(step(name, during)) < all.indexOf(step(name, after)));
  };
  order("database-backup", "Verify Held Maintenance Before Backup", "Create Encrypted Database Backup From Exact Source", "Verify Held Maintenance After Backup Capture");
  order("database-migrate", "Verify Held Maintenance Before Migration", "Revalidate Evidence And Apply Exact Through", "Verify Held Maintenance After Migration");
  order("ordinary-account-cutover-readiness", "Verify Held Maintenance Before Readiness", "Inspect Locked Production Readiness From Exact Source", "Verify Held Maintenance After Readiness");
  assert.equal(step("database-migrate", "Verify Expected Live Application Build Exactly").if, "env.MAINTENANCE_MODE == 'off'");
  assert.equal(step("database-migrate", "Verify Expected Live Application Build Remains Exact").if, "env.MAINTENANCE_MODE == 'off'");
});

test("deployment uses verified metadata and maintenance completion still leaves public access held", () => {
  const deployment = step("deploy", "Deploy To Server");
  for (const key of ["PRODUCTION_MAINTENANCE_MODE", "PRODUCTION_MAINTENANCE_OPERATION_ID", "PRODUCTION_MAINTENANCE_EXPECTED_OLD_SHA"]) {
    assert.match(deployment.env[key], /steps\.maintenance-binding\.outputs\./);
    assert.ok(deployment.run.includes(`"${key}"`));
  }
  assert.equal(step("deploy", "Verify Public Release").if, "steps.maintenance-binding.outputs.mode == 'off'");
  assert.match(step("deploy", "Verify Candidate While Public Entry Remains Held").run, /node %q check-candidate/);
  assert.doesNotMatch(sources.deploy, /node %q end|production-maintenance-control\.mjs end/);
});

test("readiness final inventory binds the raw upload digest with the API sha256 prefix", () => {
  const inventory = step("ordinary-account-cutover-readiness", "Confirm Exact Successful Readiness Artifact Inventory");
  assert.equal(inventory.env.MAINTENANCE_BINDING_ARTIFACT_DIGEST, "sha256:${{ steps.maintenance-binding-upload.outputs.artifact-digest }}");
  const code = inventory.run.match(/<<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
  assert.ok(code);
  const directory = mkdtempSync(join(tmpdir(), "faolla-readiness-binding-"));
  const file = join(directory, "inventory.json");
  const run = "123", attempt = "1", sha = "a".repeat(40);
  const artifacts = ["faolla-production-readiness-report", "faolla-production-readiness-attestation", "faolla-maintenance-readiness-binding"].map((name, index) => ({
    name: `${name}-${run}-${attempt}`, id: index + 1, digest: `sha256:${String(index).repeat(64)}`, expired: false, size_in_bytes: 100,
    created_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
    workflow_run: { id: Number(run), head_branch: "main", head_sha: sha },
  }));
  const fixtureEnv = { SystemRoot: process.env.SystemRoot ?? "", GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt, TARGET_SHA: sha,
    REPORT_ARTIFACT_ID: "1", REPORT_ARTIFACT_DIGEST: artifacts[0].digest,
    ATTESTATION_ARTIFACT_ID: "2", ATTESTATION_ARTIFACT_DIGEST: artifacts[1].digest,
    MAINTENANCE_BINDING_ARTIFACT_ID: "3", MAINTENANCE_BINDING_ARTIFACT_DIGEST: artifacts[2].digest };
  try {
    writeFileSync(file, JSON.stringify([{ total_count: 3, artifacts }]));
    const execute = (patch) => spawnSync(process.execPath, ["--input-type=module", "-", file], { input: code, encoding: "utf8", env: { ...fixtureEnv, ...patch } }).status;
    assert.equal(execute({}), 0);
    assert.notEqual(execute({ MAINTENANCE_BINDING_ARTIFACT_DIGEST: "2".repeat(64) }), 0);
    assert.notEqual(execute({ MAINTENANCE_BINDING_ARTIFACT_ID: "9" }), 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("historical recovery workflows remain fixed incidents and cannot accept a new maintenance run", () => {
  for (const [name, incident, sha] of [
    ["recover-failed-pre-forward-deploy", "32657417536", "f7ef0c0793be2c41d981fabae5ee44af35654904"],
    ["recover-failed-post-switch-deploy", "33141616176", "5867f1d5186e0068df8fb0d5e811e8287bc28ac4"],
  ]) {
    const source = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    const workflow = yaml.load(source);
    const job = Object.values(workflow.jobs)[0];
    assert.equal(String(job.env.INCIDENT_DEPLOY_RUN_ID), incident);
    assert.equal(job.env.INCIDENT_SHA, sha);
    assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ["recovery_source_sha", "confirmation"]);
    assert.match(source, /deploy\.head_sha !== process\.env\.INCIDENT_SHA/);
    assert.match(source, /readiness\.head_sha !== process\.env\.INCIDENT_SHA/);
    assert.match(source, /artifacts\.length !== 2/);
  }
});

test("maintenance controller executable worktrees require a root-only canonical code root, never writable tmp", () => {
  const source = sources["production-maintenance"];
  assert.match(source, /REMOTE_MAINTENANCE_WORKTREE: \/var\/lib\/faolla-maintenance-code\/faolla-maintenance-control-/);
  const guard = '[[ "$worktree" =~ ^/var/lib/faolla-maintenance-code/faolla-maintenance-control-[1-9][0-9]*-[1-9][0-9]*$ ]]';
  assert.equal(source.split(guard).length - 1, 2);
  assert.equal((source.match(/verify_source_directory\(\) \{/g) ?? []).length, 2);
  for (const token of ["test \"$(id -u)\" = 0", "for source_parent in / /var /var/lib", "test -d \"$source_dir\" && test ! -L \"$source_dir\"",
    "test \"$(stat -c '%u' -- \"$source_dir\")\" = 0", "test \"$(readlink -f -- \"$source_dir\")\" = \"$source_dir\"", "(( (8#$source_mode & 8#22) == 0 ))",
    "test \"$(stat -c '%a' -- \"$source_root\")\" = 700", "test \"$(stat -c '%a' -- \"$worktree\")\" = 700"]) assert.ok(source.includes(token), token);
  assert.match(source, /if \[ ! -e "\$source_root" \] && \[ ! -L "\$source_root" \]; then mkdir -m 700 -- "\$source_root"; fi/);
  assert.ok(source.includes('test -d "$app_dir" && test ! -e "$worktree" && test ! -L "$worktree" || exit 1'));
  assert.equal((source.match(/test -d "\$source_dir" && test ! -L "\$source_dir" \|\| exit 1/g) ?? []).length, 2);
  assert.equal((source.match(/source_status="\$\(git -C "\$worktree" status --porcelain=v1 --untracked-files=all\)"\r?\n\s+test -z "\$source_status"/g) ?? []).length, 2);
  const add = source.indexOf('worktree add --detach "$worktree"');
  assert.ok(source.lastIndexOf("umask 077", add) > 0);
  assert.ok(source.indexOf('verify_source_directory "$source_root"') < add);
  assert.ok(source.indexOf('verify_source_directory "$worktree"', add) > add);
  assert.doesNotMatch(source, /chmod[^\n]*(?:source_root|source_parent|worktree|app_dir)/);
  const cleanup = source.slice(source.indexOf("# The operation state lives outside this temporary checkout"));
  assert.match(cleanup, /verify_source_directory "\$worktree"/);
  assert.match(cleanup, /rev-parse HEAD\)" = "\$target"/);
  assert.match(cleanup, /status --porcelain=v1 --untracked-files=all/);
  assert.match(cleanup, /git -C "\$app_dir" worktree remove "\$worktree"/);
  assert.doesNotMatch(cleanup, /worktree remove --force|rm -rf/);
});
