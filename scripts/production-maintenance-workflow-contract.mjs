import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { canonicalJsonBytes } from "./production-release-attestation.mjs";
import { validateRuntimeCompatibilityDiagnostic } from "./production-maintenance-runtime-diagnostic.mjs";
import { validatePm2PeerDiagnostic } from "./production-maintenance-pm2-peer-diagnostic.mjs";

const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const KEYS = ["version", "phase", "mode", "targetSha", "expectedOldSha", "operationId", "runId", "runAttempt", "backupRunId", "backupRunAttempt", "readinessRunId", "readinessRunAttempt"];
const fail = () => { throw new Error("production_maintenance_binding_invalid"); };
const positive = (value) => typeof value === "string" && DECIMAL.test(value) && Number.isSafeInteger(Number(value));

export function validateProductionMaintenanceBinding(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== [...KEYS].sort().join("|") ||
    value.version !== 1 || !["backup", "readiness", "deploy"].includes(value.phase) ||
    !["off", "maintenance"].includes(value.mode) || !SHA.test(value.targetSha ?? "") ||
    !positive(value.runId) || !positive(value.runAttempt) ||
    !positive(value.backupRunId) || !positive(value.backupRunAttempt)) fail();
  if (value.mode === "maintenance") {
    if (!SHA.test(value.expectedOldSha ?? "") || !UUID.test(value.operationId ?? "")) fail();
  } else if (value.expectedOldSha !== null || value.operationId !== null) fail();
  if (value.phase === "backup") {
    if (value.backupRunId !== value.runId || value.backupRunAttempt !== value.runAttempt ||
      value.readinessRunId !== null || value.readinessRunAttempt !== null) fail();
  } else {
    if (!positive(value.readinessRunId) || !positive(value.readinessRunAttempt) || value.backupRunId === value.readinessRunId) fail();
    if (value.phase === "readiness" && (value.readinessRunId !== value.runId || value.readinessRunAttempt !== value.runAttempt)) fail();
    if (value.phase === "deploy" && [value.backupRunId, value.readinessRunId].includes(value.runId)) fail();
  }
  for (const [key, required] of Object.entries(expected)) {
    if (!KEYS.includes(key) || value[key] !== required) fail();
  }
  return Object.freeze({ ...value });
}

export function buildProductionMaintenanceBinding(phase, env) {
  const mode = env.MAINTENANCE_MODE;
  if (mode === "off" && (env.EXPECTED_OLD_SHA || env.MAINTENANCE_OPERATION_ID)) fail();
  return validateProductionMaintenanceBinding({
    version: 1, phase, mode, targetSha: env.TARGET_SHA,
    expectedOldSha: mode === "off" ? null : env.EXPECTED_OLD_SHA,
    operationId: mode === "off" ? null : env.MAINTENANCE_OPERATION_ID,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    backupRunId: phase === "backup" ? env.GITHUB_RUN_ID : env.BACKUP_RUN_ID,
    backupRunAttempt: phase === "backup" ? env.GITHUB_RUN_ATTEMPT : env.BACKUP_RUN_ATTEMPT,
    readinessRunId: phase === "backup" ? null : phase === "readiness" ? env.GITHUB_RUN_ID : env.READINESS_RUN_ID,
    readinessRunAttempt: phase === "backup" ? null : phase === "readiness" ? env.GITHUB_RUN_ATTEMPT : env.READINESS_RUN_ATTEMPT,
  });
}

export function assertProductionMaintenanceProvenance(results, bytes) {
  if (!Array.isArray(results) || results.length !== 1) fail();
  const subjects = results[0]?.verificationResult?.statement?.subject;
  if (!Array.isArray(subjects) || subjects.length !== 1 ||
    subjects[0]?.name !== "production-maintenance-binding.json" ||
    subjects[0]?.digest?.sha256 !== createHash("sha256").update(bytes).digest("hex")) fail();
}

export function validateProductionMaintenanceControlReport(value, expected) {
  const keys = ["version", "operationId", "targetSha", "expectedOldSha", "state"];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== keys.sort().join("|") || value.version !== 1 ||
    !UUID.test(value.operationId ?? "") || !SHA.test(value.targetSha ?? "") || !SHA.test(value.expectedOldSha ?? "") ||
    !["planned", "held", "candidate", "ended", "failed-held", "failed-unknown"].includes(value.state)) fail();
  for (const [key, required] of Object.entries(expected)) if (!keys.includes(key) || value[key] !== required) fail();
  return Object.freeze({ ...value });
}

export function validateProductionRuntimeDiagnosticReport(value, expected) {
  const keys = ["version", "targetSha", "expectedOldSha", "state", "diagnostics"];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("|") !== keys.sort().join("|") || value.version !== 1 ||
      value.state !== "runtime-diagnosed" || !SHA.test(value.targetSha ?? "") || !SHA.test(value.expectedOldSha ?? "") ||
      value.targetSha === value.expectedOldSha) fail();
  for (const [key, required] of Object.entries(expected)) {
    if (!["targetSha", "expectedOldSha"].includes(key) || value[key] !== required) fail();
  }
  let diagnostics;
  try { diagnostics = validateRuntimeCompatibilityDiagnostic(value.diagnostics); } catch { fail(); }
  return Object.freeze({ ...value, diagnostics });
}

export function validateProductionPm2PeerDiagnosticReport(value, expected) {
  const keys = ["version", "targetSha", "expectedOldSha", "state", "diagnostics"];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("|") !== keys.sort().join("|") || value.version !== 1 ||
      value.state !== "pm2-peer-diagnosed" || !SHA.test(value.targetSha ?? "") || !SHA.test(value.expectedOldSha ?? "") ||
      value.targetSha === value.expectedOldSha) fail();
  for (const [key, required] of Object.entries(expected)) {
    if (!["targetSha", "expectedOldSha"].includes(key) || value[key] !== required) fail();
  }
  let diagnostics;
  try { diagnostics = validatePm2PeerDiagnostic(value.diagnostics); } catch { fail(); }
  return Object.freeze({ ...value, diagnostics });
}

const FLAGS = {
  "--phase": "phase", "--target-sha": "targetSha", "--mode": "mode",
  "--operation-id": "operationId", "--old-sha": "expectedOldSha",
  "--run-id": "runId", "--run-attempt": "runAttempt",
  "--backup-run-id": "backupRunId", "--backup-run-attempt": "backupRunAttempt",
  "--readiness-run-id": "readinessRunId", "--readiness-run-attempt": "readinessRunAttempt",
};

async function main(args, env) {
  const [command, ...rest] = args;
  if (!["build", "verify", "verify-control", "verify-runtime-diagnostic", "verify-pm2-peer-diagnostic"].includes(command) || rest.length % 2) fail();
  const options = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    if ((!Object.hasOwn(FLAGS, rest[i]) && !["--file", "--github-output", "--provenance", "--state"].includes(rest[i])) || options.has(rest[i])) fail();
    options.set(rest[i], rest[i + 1]);
  }
  const file = options.get("--file");
  if (!file) fail();
  if (["verify-runtime-diagnostic", "verify-pm2-peer-diagnostic"].includes(command)) {
    if ([...options.keys()].some((key) => !["--file", "--target-sha", "--old-sha"].includes(key))) fail();
    for (const flag of ["--target-sha", "--old-sha"]) if (!options.get(flag)) fail();
    const bytes = await readFile(file);
    if (bytes.length > 4096) fail();
    const validate = command === "verify-runtime-diagnostic" ? validateProductionRuntimeDiagnosticReport : validateProductionPm2PeerDiagnosticReport;
    const report = validate(JSON.parse(bytes.toString("utf8")), {
      targetSha: options.get("--target-sha"), expectedOldSha: options.get("--old-sha"),
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  if (command === "verify-control") {
    if ([...options.keys()].some((key) => !["--file", "--state", "--target-sha", "--old-sha", "--operation-id"].includes(key))) fail();
    for (const flag of ["--state", "--target-sha", "--old-sha"]) if (!options.get(flag)) fail();
    const bytes = await readFile(file);
    if (bytes.length > 4096) fail();
    const expected = { state: options.get("--state"), targetSha: options.get("--target-sha"), expectedOldSha: options.get("--old-sha") };
    if (options.has("--operation-id")) expected.operationId = options.get("--operation-id");
    process.stdout.write(`${JSON.stringify(validateProductionMaintenanceControlReport(JSON.parse(bytes.toString("utf8")), expected))}\n`);
    return;
  }
  let binding;
  if (command === "build") {
    if ([...options.keys()].some((key) => !["--phase", "--file"].includes(key))) fail();
    binding = buildProductionMaintenanceBinding(options.get("--phase"), env);
    await writeFile(file, canonicalJsonBytes(binding), { flag: "wx", mode: 0o600 });
  } else {
    if (options.has("--state")) fail();
    for (const key of ["--phase", "--target-sha", "--run-id", "--run-attempt", "--provenance"]) if (!options.has(key)) fail();
    const bytes = await readFile(file);
    if (bytes.length > 4096) fail();
    const expected = {};
    for (const [flag, key] of Object.entries(FLAGS)) {
      if (options.has(flag)) expected[key] = ["operationId", "expectedOldSha"].includes(key) && !options.get(flag) ? null : options.get(flag);
    }
    binding = validateProductionMaintenanceBinding(JSON.parse(bytes.toString("utf8")), expected);
    if (!bytes.equals(canonicalJsonBytes(binding))) fail();
    const provenance = await readFile(options.get("--provenance"));
    if (provenance.length > 1024 * 1024) fail();
    assertProductionMaintenanceProvenance(JSON.parse(provenance.toString("utf8")), bytes);
    if (options.has("--github-output")) {
      await appendFile(options.get("--github-output"), [
        `mode=${binding.mode}`, `operation_id=${binding.operationId ?? ""}`, `old_sha=${binding.expectedOldSha ?? ""}`,
        `backup_run_id=${binding.backupRunId}`, `backup_run_attempt=${binding.backupRunAttempt}`,
        `readiness_run_id=${binding.readinessRunId ?? ""}`, `readiness_run_attempt=${binding.readinessRunAttempt ?? ""}`,
      ].join("\n") + "\n");
    }
  }
  process.stdout.write(`${JSON.stringify(binding)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).catch(() => {
    process.stderr.write("production_maintenance_binding_invalid\n");
    process.exitCode = 1;
  });
}
