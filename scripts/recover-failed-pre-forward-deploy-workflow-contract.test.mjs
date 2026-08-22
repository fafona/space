import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const workflowPath = join(
  repositoryRoot,
  ".github",
  "workflows",
  "recover-failed-pre-forward-deploy.yml",
);
const recoveryScriptPath = join(
  repositoryRoot,
  "scripts",
  "recover-failed-pre-forward-production-runtime.sh",
);
const workflow = await readFile(workflowPath, "utf8");
const recoveryScript = await readFile(recoveryScriptPath, "utf8");

const INCIDENT_DEPLOY_RUN_ID = "32574586077";
const INCIDENT_SHA = "4381e6b555262d7fba696825c125c7793d6515f5";
const READINESS_RUN_ID = "32574534420";
const OLD_BUILD_ID = "2a121454a18a16ae30e356977ca82b24a310e8e5";
const CONFIRMATION = "RECOVER_FAILED_PRE_FORWARD_DEPLOY_32574586077";
const WORKFLOW_PATH = ".github/workflows/recover-failed-pre-forward-deploy.yml";
const DEPLOY_WORKFLOW_PATH = ".github/workflows/deploy.yml";
const READINESS_WORKFLOW_PATH =
  ".github/workflows/ordinary-account-cutover-readiness.yml";

function resolveExecutable(candidates, versionArguments = ["--version"]) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const result = spawnSync(candidate, versionArguments, { stdio: "ignore" });
    if (result.status === 0) return candidate;
  }
  throw new Error(
    `required executable was not found: ${candidates.filter(Boolean).join(", ")}`,
  );
}

function resolveBash() {
  return resolveExecutable(
    process.platform === "win32"
      ? [
          process.env.BASH,
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
        ]
      : [process.env.BASH, "bash"],
  );
}

function resolvePython() {
  return resolveExecutable(
    process.platform === "win32" ? ["python", "py"] : ["python3", "python"],
  );
}

function loadYamlParser() {
  const require = createRequire(import.meta.url);
  try {
    return require("js-yaml");
  } catch (error) {
    const sharedWorkspacePackage = join(
      dirname(repositoryRoot),
      "merchant-space",
      "node_modules",
      "js-yaml",
    );
    try {
      return require(sharedWorkspacePackage);
    } catch {
      throw error;
    }
  }
}

function workflowJobs(parsed) {
  assert.ok(parsed?.jobs && typeof parsed.jobs === "object");
  const jobs = Object.values(parsed.jobs);
  assert.equal(jobs.length, 1, "incident recovery must have exactly one job");
  return jobs;
}

function runBlocks(parsed) {
  return workflowJobs(parsed).flatMap((job) =>
    (job.steps ?? [])
      .map((step) => step?.run)
      .filter((source) => typeof source === "string"),
  );
}

function extractHeredocs(source, tag) {
  const pattern = new RegExp(
    `<<-?["']?${tag}["']?\\r?\\n([\\s\\S]*?)\\r?\\n[\\t ]*${tag}(?=\\r?\\n|$)`,
    "g",
  );
  return [...source.matchAll(pattern)].map((match) =>
    match[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\t/, ""))
      .join("\n"),
  );
}

function heredocs(parsed, tag) {
  return runBlocks(parsed).flatMap((source) => extractHeredocs(source, tag));
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function stepContaining(job, marker) {
  const matches = (job.steps ?? []).filter(
    (step) => typeof step?.run === "string" && step.run.includes(marker),
  );
  assert.equal(matches.length, 1, `expected one step containing ${marker}`);
  return matches[0];
}

function stepMatching(job, predicate, label) {
  const matches = (job.steps ?? []).filter(predicate);
  assert.equal(matches.length, 1, `expected one ${label} step`);
  return matches[0];
}

function assertContainsAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} is missing ${value}`);
  }
}

const parsed = loadYamlParser().load(workflow);
const [job] = workflowJobs(parsed);
const allRunSource = runBlocks(parsed).join("\n");

test("workflow YAML, Bash, recovery Bash, and embedded Node and Python parse", () => {
  assert.equal(parsed.name, "Recover Failed Pre-Forward Production Runtime");

  const bash = resolveBash();
  const blocks = runBlocks(parsed);
  assert.ok(blocks.length >= 7, "recovery workflow must keep its phases explicit");
  for (const [index, source] of blocks.entries()) {
    const result = spawnSync(bash, ["-n"], { encoding: "utf8", input: source });
    assert.equal(result.status, 0, `Bash block ${index + 1}: ${result.stderr}`);
  }
  const recoveryResult = spawnSync(bash, ["-n"], {
    encoding: "utf8",
    input: recoveryScript,
  });
  assert.equal(recoveryResult.status, 0, recoveryResult.stderr);

  const nodeSources = heredocs(parsed, "NODE");
  assert.ok(nodeSources.length >= 3, "expected embedded Node validators and framing");
  for (const [index, source] of nodeSources.entries()) {
    const result = spawnSync(
      process.execPath,
      ["--check", "--input-type=module", "-"],
      { encoding: "utf8", input: source },
    );
    assert.equal(result.status, 0, `embedded Node ${index + 1}: ${result.stderr}`);
  }

  const pythonSources = heredocs(parsed, "PYTHON");
  assert.ok(pythonSources.length >= 1, "expected a bounded remote Python receiver");
  const python = resolvePython();
  for (const [index, source] of pythonSources.entries()) {
    const result = spawnSync(
      python,
      ["-c", "import sys; compile(sys.stdin.read(), '<embedded-python>', 'exec')"],
      { encoding: "utf8", input: source },
    );
    assert.equal(result.status, 0, `embedded Python ${index + 1}: ${result.stderr}`);
  }
});

test("manual entry is main-only, incident-bound, unique, and serialized with deploy", () => {
  const trigger = parsed.on ?? parsed.true;
  assert.deepEqual(Object.keys(trigger).sort(), ["workflow_dispatch"]);
  const inputs = trigger.workflow_dispatch?.inputs;
  assert.deepEqual(Object.keys(inputs ?? {}).sort(), ["confirmation", "recovery_source_sha"]);
  for (const input of Object.values(inputs)) {
    assert.equal(input.required, true);
    assert.equal(input.type, "string");
  }

  assert.deepEqual(parsed.concurrency, {
    group: "production-deploy",
    "cancel-in-progress": false,
  });
  assert.deepEqual(parsed.permissions, {
    actions: "read",
    attestations: "read",
    contents: "read",
  });
  assert.ok(
    job.if === undefined || job.if === true || job.if === "true" || job.if === "${{ true }}",
    "event/ref rejection must fail inside the job rather than skip the recovery job",
  );
  const firstRun = (job.steps ?? []).find(
    (step) => typeof step?.run === "string",
  )?.run;
  assert.equal(typeof firstRun, "string");
  assert.match(firstRun, /test "\$GITHUB_EVENT_NAME" = "workflow_dispatch"/);
  assert.match(firstRun, /test "\$GITHUB_REF" = "refs\/heads\/main"/);

  assertContainsAll(
    workflow,
    [
      INCIDENT_DEPLOY_RUN_ID,
      INCIDENT_SHA,
      READINESS_RUN_ID,
      OLD_BUILD_ID,
      CONFIRMATION,
      WORKFLOW_PATH,
      DEPLOY_WORKFLOW_PATH,
      READINESS_WORKFLOW_PATH,
    ],
    "incident workflow",
  );
  assert.match(workflow, /RECOVERY_SOURCE_SHA:\s*\$\{\{ inputs\.recovery_source_sha \}\}/);
  assert.match(workflow, /RECOVERY_CONFIRMATION:\s*\$\{\{ inputs\.confirmation \}\}/);
  assert.match(workflow, /test "\$RECOVERY_CONFIRMATION" = "\$EXPECTED_CONFIRMATION"/);
  assert.match(workflow, /\[\[ "\$RECOVERY_SOURCE_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);

  assert.match(workflow, /GITHUB_RUN_ATTEMPT[^\n]*(?:=|!==?)\s*["']?1/);
  assert.match(workflow, /GITHUB_RUN_ID/);
  assert.match(workflow, /actions\/workflows\/(?:\$RECOVERY_WORKFLOW_PATH|recover-failed-pre-forward-deploy\.yml)\/runs/);
  assert.match(workflow, /event=workflow_dispatch|event:\s*"workflow_dispatch"/);
  assert.match(allRunSource, /workflow_runs/);
  assert.match(allRunSource, /total_count\s*!==\s*1/);
  assert.match(allRunSource, /workflow_runs\.length\s*!==\s*1/);
  assert.match(allRunSource, /run_attempt\s*!==\s*1/);
  assert.match(allRunSource, /Number\(process\.env\.GITHUB_RUN_ID\)/);

  assert.doesNotMatch(workflow, /^\s*workflow_run:/m);
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/);
});

test("runner-scoped SSH path is defined only on the two steps that use it", () => {
  assert.doesNotMatch(
    JSON.stringify(job.env ?? {}),
    /\$\{\{\s*runner\./,
    "job-level env cannot use the runner context",
  );
  assert.equal(job.env?.SSH_CONFIG_PATH, undefined);

  const expectedPath = "${{ runner.temp }}/faolla-incident-recovery-ssh-config";
  const setup = stepContaining(job, "KnownHostsCommand none");
  const recover = stepMatching(
    job,
    (step) => typeof step?.run === "string" &&
      /\bssh\b/.test(step.run) &&
      step.run.includes("fence_cleanup_verified"),
    "hidden recovery transport",
  );
  assert.equal(setup.env?.SSH_CONFIG_PATH, expectedPath);
  assert.equal(recover.env?.SSH_CONFIG_PATH, expectedPath);

  const otherDefinitions = (job.steps ?? [])
    .filter((step) => step !== setup && step !== recover)
    .filter((step) => step?.env?.SSH_CONFIG_PATH !== undefined);
  assert.deepEqual(otherDefinitions, []);
});

test("checkout is the exact current main SHA with one successful push CI attempt", () => {
  const checkout = (job.steps ?? []).find((step) => step?.uses?.startsWith("actions/checkout@"));
  assert.ok(checkout, "missing exact checkout");
  assert.equal(checkout.with?.ref, "${{ inputs.recovery_source_sha }}");
  assert.equal(checkout.with?.["persist-credentials"], false);

  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /origin\/main|refs\/remotes\/origin\/main/);
  assert.ok(
    countMatches(workflow, /(?:origin\/main|refs\/remotes\/origin\/main)/g) >= 2,
    "origin/main must be revalidated across the recovery boundary",
  );
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
  assert.match(workflow, /head_sha[^\n]+RECOVERY_SOURCE_SHA|RECOVERY_SOURCE_SHA[^\n]+head_sha/);
  assertContainsAll(
    allRunSource,
    [
      'name !== "CI"',
      'path !== ".github/workflows/ci.yml"',
      'event !== "push"',
      'status !== "completed"',
      'conclusion !== "success"',
      'head_branch !== "main"',
    ],
    "CI validator",
  );
  assert.match(allRunSource, /run_attempt\s*!==\s*1/);
  assert.match(allRunSource, /total_count\s*!==\s*1/);
  assert.match(workflow, /status --porcelain=v1 --untracked-files=all/);
  assert.match(workflow, /symbolic-ref -q HEAD/);
});

test("CI and recovery uniqueness use exact SHA-filtered single API pages", () => {
  const initialGate = stepContaining(job, "current-recovery-workflow-runs.json");
  const finalGate = stepContaining(job, "final-recovery-workflow-runs.json");
  const ciQuery = /actions\/workflows\/ci\.yml\/runs\?branch=main&event=push&head_sha=\$RECOVERY_SOURCE_SHA&per_page=2&page=1/;
  const recoveryQuery = /actions\/workflows\/recover-failed-pre-forward-deploy\.yml\/runs\?branch=main&event=workflow_dispatch&head_sha=\$RECOVERY_SOURCE_SHA&per_page=2&page=1/;

  for (const [label, source] of [
    ["initial recovery gate", initialGate.run],
    ["final recovery gate", finalGate.run],
  ]) {
    assert.match(source, ciQuery, label + " must server-filter the CI SHA");
    assert.match(source, recoveryQuery, label + " must server-filter the recovery SHA");
    assert.doesNotMatch(source, /--paginate|--slurp/, label + " must not scan mutable history");
    assert.match(source, /total_count\s*!==\s*1/);
    assert.match(source, /workflow_runs\.length\s*!==\s*1/);
    assert.match(
      source,
      /head_sha\s*!==\s*process\.env\.RECOVERY_SOURCE_SHA/,
      label + " must revalidate the returned object's SHA",
    );
  }

  assertContainsAll(
    initialGate.run,
    [
      "Number.isSafeInteger(page.total_count)",
      "recovery_workflow_runs_invalid",
      "recovery_dispatch_not_unique",
      "recovery_ci_runs_invalid",
      "recovery_ci_not_unique",
      "Number.isSafeInteger(ciWorkflow?.id)",
      "ciWorkflow.id <= 0",
      "Number.isSafeInteger(ci?.id)",
      "ci.id <= 0",
      "ci.workflow_id !== ciWorkflow.id",
      "candidate.workflow_id !== workflowId",
      "candidate?.id !== Number(process.env.GITHUB_RUN_ID)",
      "candidate.run_attempt !== 1",
      'candidate.event !== "workflow_dispatch"',
      'candidate.head_branch !== "main"',
      "candidate.head_sha !== process.env.RECOVERY_SOURCE_SHA",
      'ci.name !== "CI"',
      'ci.path !== ".github/workflows/ci.yml"',
      'ci.event !== "push"',
      "ci.head_sha !== process.env.RECOVERY_SOURCE_SHA",
      'ci.status !== "completed"',
      'ci.conclusion !== "success"',
      'ci.head_branch !== "main"',
      "ci.run_attempt !== 1",
      "ci.repository?.full_name !== process.env.GITHUB_REPOSITORY",
      "ci.head_repository?.full_name !== process.env.GITHUB_REPOSITORY",
    ],
    "initial exact-page validator",
  );
  assertContainsAll(
    finalGate.run,
    [
      "Number.isSafeInteger(run?.id)",
      "run.id <= 0",
      "Number.isSafeInteger(run.workflow_id)",
      "run.workflow_id <= 0",
      'run.name !== "CI"',
      'run.path !== ".github/workflows/ci.yml"',
      'run.event !== "push"',
      'run.status !== "completed"',
      'run.conclusion !== "success"',
      'run.head_branch !== "main"',
      "run.head_sha !== process.env.RECOVERY_SOURCE_SHA",
      "run.run_attempt !== 1",
      "run.repository?.full_name !== process.env.GITHUB_REPOSITORY",
      "run.head_repository?.full_name !== process.env.GITHUB_REPOSITORY",
      "recoveryRun?.id !== Number(process.env.GITHUB_RUN_ID)",
      "Number.isSafeInteger(recoveryRun.workflow_id)",
      "recoveryRun.workflow_id <= 0",
      "recoveryRun.run_attempt !== 1",
      'recoveryRun.event !== "workflow_dispatch"',
      'recoveryRun.head_branch !== "main"',
      "recoveryRun.head_sha !== process.env.RECOVERY_SOURCE_SHA",
      'recoveryRun.status !== "in_progress"',
      "recoveryRun.conclusion !== null",
      "recoveryRun.repository?.full_name !== process.env.GITHUB_REPOSITORY",
      "recoveryRun.head_repository?.full_name !== process.env.GITHUB_REPOSITORY",
    ],
    "final exact-page validator",
  );
});

test("the failed deploy and its pre-forward step boundary are validated historically", () => {
  assert.match(workflow, /actions\/runs\/\$INCIDENT_DEPLOY_RUN_ID(?:"|\s|$)/);
  assert.match(workflow, /actions\/runs\/\$INCIDENT_DEPLOY_RUN_ID\/attempts\/1\/jobs/);
  assertContainsAll(
    allRunSource,
    [
      "Deploy Production",
      DEPLOY_WORKFLOW_PATH,
      "workflow_run",
      "completed",
      "failure",
      "main",
      INCIDENT_SHA,
      "Validate Readiness Workflow Run",
      "Checkout Tested Commit",
      "Resolve Deploy Commit",
      "Resolve Readiness Artifacts",
      "Verify Readiness Evidence",
      "Revalidate Live Recursive Backup Evidence",
      "Setup SSH",
      "Deploy To Server",
      "Verify Public Release",
      "success",
      "skipped",
    ],
    "failed deploy validator",
  );
  assert.match(allRunSource, /run_attempt\s*!==\s*1/);
  assert.match(allRunSource, /(?:jobs|deployJobs)\.length\s*!==\s*1/);
  assert.match(allRunSource, /(?:job|deployJob)\.steps\.length\s*!==\s*12/);
  assert.match(
    allRunSource,
    /(?:businessSteps|business_steps|deployBusinessSteps)\.length\s*!==\s*9/,
  );
  assert.match(allRunSource, /Deploy To Server[^\n]+failure|failure[^\n]+Deploy To Server/);
  assert.match(allRunSource, /Verify Public Release[^\n]+skipped|skipped[^\n]+Verify Public Release/);
  assert.match(allRunSource, /started_at/);
  assert.match(allRunSource, /completed_at/);
});

test("Readiness is exact, unexpired, canonical, provenance-verified evidence", () => {
  assert.match(workflow, /actions\/runs\/\$READINESS_RUN_ID(?:"|\s|$)/);
  assert.match(workflow, /actions\/runs\/\$READINESS_RUN_ID\/artifacts\?per_page=100/);
  assert.match(
    workflow,
    /actions\/workflows\/ordinary-account-cutover-readiness\.yml\/runs\?branch=main&event=workflow_dispatch/,
  );
  assertContainsAll(
    allRunSource,
    [
      "Ordinary Account Cutover Readiness",
      READINESS_WORKFLOW_PATH,
      "workflow_dispatch",
      "completed",
      "success",
      "main",
      "faolla-production-readiness-report-",
      "faolla-production-readiness-attestation-",
      "readiness_artifact_inventory_invalid",
    ],
    "Readiness validator",
  );
  assert.match(allRunSource, /run_attempt\s*!==\s*1/);
  assert.match(allRunSource, /matchingReadinessRuns\.length\s*!==\s*1/);
  assert.match(
    allRunSource,
    /matchingReadinessRuns\[0\]\.id\s*!==\s*Number\(process\.env\.READINESS_RUN_ID\)/,
  );
  assert.match(allRunSource, /artifacts\.length\s*!==\s*2/);
  assert.match(allRunSource, /total_count\s*!==\s*artifacts\.length|total_count\s*!==\s*2/);
  assert.match(allRunSource, /artifact\.expired\s*!==\s*false/);
  assert.match(allRunSource, /\^sha256:\[0-9a-f\]\{64\}\$/);
  assert.match(allRunSource, /artifact\.workflow_run\?\.id/);
  assert.match(allRunSource, /artifact\.workflow_run\?\.head_branch/);
  assert.match(allRunSource, /artifact\.workflow_run\?\.head_sha/);
  assert.match(allRunSource, /Date\.parse\(artifact\.expires_at\)/);

  assert.ok(countMatches(workflow, /gh attestation verify/g) >= 1);
  assert.ok(
    countMatches(workflow, /--predicate-type "https:\/\/slsa\.dev\/provenance\/v1"/g) >= 1,
  );
  assert.ok(
    countMatches(workflow, /verify_provenance\s+/g) >= 2 ||
      countMatches(workflow, /gh attestation verify/g) >= 2,
    "both Readiness artifacts must receive provenance verification",
  );
  assert.match(workflow, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /--signer-workflow/);
  assert.match(workflow, /parseProductionReleaseAttestation/);
  assert.match(workflow, /nowMs:\s*Date\.parse\(issuedAt\)/);
  assert.match(workflow, /canonicalJsonBytes|JSON\.stringify\(Object\.fromEntries/);
  assert.doesNotMatch(
    workflow,
    /parseProductionReleaseAttestation\([\s\S]{0,500}nowMs:\s*Date\.now\(\)/,
  );
  assert.doesNotMatch(workflow, /actions\/download-artifact@/);
});

test("the canonical stdin envelope carries the complete validated database identity", () => {
  const payloadKeys = [
    "APP_DIR",
    "APP_NAME",
    "APP_PORT",
    "CONFIRMATION",
    "DATABASE_CONTAINER_ID",
    "DATABASE_CONTAINER_NAME",
    "DATABASE_NAME",
    "DATABASE_OID",
    "DATABASE_PRIMARY",
    "DATABASE_SYSTEM_ID",
    "FAILED_RUN_COMPLETED_EPOCH",
    "FAILED_RUN_STARTED_EPOCH",
    "INCIDENT_DEPLOY_RUN_ID",
    "INCIDENT_SHA",
    "READINESS_RUN_ATTEMPT",
    "READINESS_RUN_ID",
  ];
  assertContainsAll(allRunSource, payloadKeys, "canonical recovery payload");
  assert.match(allRunSource, /Object\.keys\([^)]*\)\.sort\(\)/);
  assert.match(allRunSource, /JSON\.stringify\(Object\.fromEntries/);
  assert.match(allRunSource, /createHash\(["']sha256["']\)/);
  assert.match(
    allRunSource,
    /FAILED_RUN_COMPLETED_EPOCH:\s*process\.env\.FAILED_RUN_COMPLETED_EPOCH/,
  );
  assert.match(
    allRunSource,
    /FAILED_RUN_STARTED_EPOCH:\s*process\.env\.FAILED_RUN_STARTED_EPOCH/,
  );
  assert.doesNotMatch(allRunSource, /process\.env\.FAOLLA_FAILED_RUN_/);
  assertContainsAll(
    allRunSource,
    [
      "payloadBytes",
      "payloadSha256",
      "scriptBytes",
      "scriptSha256",
      "FAOLLA_FAILED_PRE_FORWARD_RECOVERY_ENVELOPE_V1",
      "recover-failed-pre-forward-production-runtime.sh",
    ],
    "recovery envelope",
  );
  assert.match(workflow, /git (?:-C "\$GITHUB_WORKSPACE" )?hash-object/);
  assert.match(workflow, /rev-parse[^\n]+RECOVERY_SOURCE_SHA/);
  assert.match(allRunSource, /(?:Buffer\.byteLength|\.length)/);
  assert.match(workflow, /payloadBytes" -le 65536/);
  assert.match(workflow, /scriptBytes" -le 131072/);
  assert.match(workflow, /expected_payload_bytes" -le 65536/);
  assert.match(workflow, /expected_script_bytes" -le 131072/);

  for (const [payloadKey, evidenceField] of [
    ["DATABASE_CONTAINER_ID", "containerId"],
    ["DATABASE_CONTAINER_NAME", "containerName"],
    ["DATABASE_NAME", "dbName"],
    ["DATABASE_OID", "dbOid"],
    ["DATABASE_PRIMARY", "primary"],
    ["DATABASE_SYSTEM_ID", "systemId"],
  ]) {
    assert.match(
      allRunSource,
      new RegExp(`${payloadKey}[\\s\\S]{0,100}${evidenceField}|${evidenceField}[\\s\\S]{0,100}${payloadKey}`),
      `${payloadKey} is not bound to ${evidenceField}`,
    );
  }
});

test("SSH uses one pinned alias and keeps the bounded remote result hidden", () => {
  const setup = stepContaining(job, "KnownHostsCommand none");
  assertContainsAll(
    setup.run,
    [
      "HostName",
      "User ",
      "IdentityFile",
      "BatchMode yes",
      "IdentitiesOnly yes",
      "StrictHostKeyChecking yes",
      "UserKnownHostsFile",
      "GlobalKnownHostsFile /dev/null",
      "KnownHostsCommand none",
      "UpdateHostKeys no",
      "VerifyHostKeyDNS no",
    ],
    "pinned SSH config",
  );
  const alias = setup.run.match(/^Host ([A-Za-z0-9._-]+)$/m)?.[1];
  assert.ok(alias && alias !== "*", "SSH config must define one fixed alias");
  assert.doesNotMatch(workflow, /ssh-keyscan/);
  assert.match(setup.run, /chmod 600/);

  const recover = stepMatching(
    job,
    (step) => typeof step?.run === "string" &&
      /\bssh\b/.test(step.run) &&
      step.run.includes("fence_cleanup_verified"),
    "hidden recovery transport",
  );
  assert.match(recover.run, /timeout --signal=TERM --kill-after=[^\n]+\s+[^\n]*ssh\b/s);
  assert.match(recover.run, /ssh\s+-T\s+-F\s+"\$SSH_CONFIG_PATH"\s+"\$SSH_ALIAS"/);
  assert.match(recover.run, />\s*"\$RECOVERY_STDOUT_PATH"\s+2>\s*"\$RECOVERY_STDERR_PATH"/);
  assert.match(
    recover.run,
    /(?:\)\s*\|\s*(?:timeout[^\n]+\s+)?ssh\b|ssh[\s\S]{0,300}<\s*"\$RECOVERY_ENVELOPE_PATH")/s,
  );
  assert.doesNotMatch(recover.run, /ssh[^\n]*(?:\$SSH_USER@\$SSH_HOST|\$SSH_HOST|\$APP_DIR|\$APP_NAME|\$APP_PORT)/);
  assert.doesNotMatch(recover.run, /bash -s --\s+\S/);

  assertContainsAll(
    recover.run,
    [
      "fence_cleanup_verified",
      "frozen_runtime_restored",
      "worker_state_restored",
      "recovery_complete",
      "remote_recovery_failed_phase_pre_runtime_input",
      "remote_recovery_failed_phase_pre_runtime_repository",
      "remote_recovery_failed_phase_pre_runtime_deploy_lock",
      "remote_recovery_failed_phase_pre_runtime_helpers",
      "remote_recovery_failed_phase_pre_runtime_legacy_release",
      "remote_recovery_failed_phase_pre_runtime_legacy_environment",
      "remote_recovery_failed_phase_pre_runtime_database_preflight",
      "remote_recovery_failed_phase_web_restore",
      "remote_recovery_failed_phase_worker_restore_preflight",
      "remote_recovery_failed_phase_worker_restore_start",
      "remote_recovery_failed_phase_worker_restore_stability",
      "remote_recovery_failed_phase_worker_restore_identity",
      "remote_recovery_failed_phase_worker_restore_environment",
      "remote_recovery_failed_phase_worker_restore_flags",
      "remote_recovery_failed_phase_worker_restore_launch_contract",
      "remote_recovery_failed_phase_worker_restore_disabled_absence",
      "remote_recovery_failed_phase_persist_and_verify",
      "recovery_output_invalid",
    ],
    "fixed remote result parser",
  );
  assert.doesNotMatch(recover.run, /\btee\b/);
  assert.doesNotMatch(recover.run, /(?:cat|head|tail)\s+"?\$RECOVERY_STD(?:OUT|ERR)_PATH/);
  assert.doesNotMatch(recover.run, /set\s+-[A-Za-z]*x[A-Za-z]*(?:\s|;|$)/);
  assert.doesNotMatch(
    recover.run,
    /process\.stdout\.write\("remote_recovery_failed"\)/,
  );

  const finalGate = stepContaining(job, "final-recovery-workflow-runs.json");
  assert.match(
    finalGate.run,
    /actions\/workflows\/recover-failed-pre-forward-deploy\.yml\/runs\?branch=main&event=workflow_dispatch&head_sha=\$RECOVERY_SOURCE_SHA&per_page=2&page=1/,
  );
  assert.match(finalGate.run, /const recoveryRun = exactSingleRun\(recoveryPage\)/);
  assert.match(
    finalGate.run,
    /recoveryRun\?\.id\s*!==\s*Number\(process\.env\.GITHUB_RUN_ID\)/,
  );
});

test("remote recovery result classifier exposes only fixed safe failure phases", async () => {
  const recover = stepMatching(
    job,
    (step) => typeof step?.run === "string" &&
      step.run.includes("const expectedLines") &&
      step.run.includes("recovery_output_invalid"),
    "remote recovery result classifier",
  );
  const classifiers = extractHeredocs(recover.run, "NODE").filter(
    (source) => source.includes("const expectedLines") &&
      source.includes("preRuntimeFailureCodes"),
  );
  assert.equal(classifiers.length, 1);
  const classifier = classifiers[0];
  const directory = await mkdtemp(join(tmpdir(), "faolla-recovery-classifier-"));
  const stdoutPath = join(directory, "stdout.bin");
  const stderrPath = join(directory, "stderr.bin");
  const markers = [
    "fence_cleanup_verified",
    "frozen_runtime_restored",
    "worker_state_restored",
    "recovery_complete",
  ];
  const preRuntimeRemoteCodes = [
    "recovery_failed_pre_runtime_input",
    "recovery_failed_pre_runtime_repository",
    "recovery_failed_pre_runtime_deploy_lock",
    "recovery_failed_pre_runtime_helpers",
    "recovery_failed_pre_runtime_legacy_release",
    "recovery_failed_pre_runtime_legacy_environment",
    "recovery_failed_pre_runtime_database_preflight",
  ];
  const preRuntimePublicCodes = [
    "remote_recovery_failed_phase_pre_runtime_input",
    "remote_recovery_failed_phase_pre_runtime_repository",
    "remote_recovery_failed_phase_pre_runtime_deploy_lock",
    "remote_recovery_failed_phase_pre_runtime_helpers",
    "remote_recovery_failed_phase_pre_runtime_legacy_release",
    "remote_recovery_failed_phase_pre_runtime_legacy_environment",
    "remote_recovery_failed_phase_pre_runtime_database_preflight",
  ];
  const runtimeFailureCases = [
    [1, "remote_recovery_failed_phase_web_restore"],
    [3, "remote_recovery_failed_phase_persist_and_verify"],
  ];
  const workerRemoteCodes = [
    "recovery_failed_runtime_worker_preflight",
    "recovery_failed_runtime_worker_start",
    "recovery_failed_runtime_worker_stability",
    "recovery_failed_runtime_worker_identity",
    "recovery_failed_runtime_worker_environment",
    "recovery_failed_runtime_worker_flags",
    "recovery_failed_runtime_worker_launch_contract",
    "recovery_failed_runtime_worker_disabled_absence",
  ];
  const workerPublicCodes = [
    "remote_recovery_failed_phase_worker_restore_preflight",
    "remote_recovery_failed_phase_worker_restore_start",
    "remote_recovery_failed_phase_worker_restore_stability",
    "remote_recovery_failed_phase_worker_restore_identity",
    "remote_recovery_failed_phase_worker_restore_environment",
    "remote_recovery_failed_phase_worker_restore_flags",
    "remote_recovery_failed_phase_worker_restore_launch_contract",
    "remote_recovery_failed_phase_worker_restore_disabled_absence",
  ];
  const transcript = (length) =>
    length === 0 ? "" : markers.slice(0, length).join("\n") + "\n";
  const classify = async (stdout, stderr, status) => {
    await Promise.all([
      writeFile(stdoutPath, Buffer.from(stdout, "utf8")),
      writeFile(stderrPath, Buffer.from(stderr, "utf8")),
    ]);
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-",
        stdoutPath,
        stderrPath,
        String(status),
      ],
      { encoding: "utf8", input: classifier },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    return result.stdout;
  };

  try {
    assert.equal(await classify(transcript(4), "", 0), "success");
    for (const status of [1, 124, 255]) {
      for (let index = 0; index < preRuntimeRemoteCodes.length; index += 1) {
        assert.equal(
          await classify("", preRuntimeRemoteCodes[index] + "\n", status),
          preRuntimePublicCodes[index],
          "pre-runtime failure phase " + index + " at status " + status,
        );
      }
      for (const [length, publicCode] of runtimeFailureCases) {
        assert.equal(
          await classify(transcript(length), "recovery_failed\n", status),
          publicCode,
          "runtime failure phase " + length + " at status " + status,
        );
      }
      for (let index = 0; index < workerRemoteCodes.length; index += 1) {
        assert.equal(
          await classify(transcript(2), workerRemoteCodes[index] + "\n", status),
          workerPublicCodes[index],
          "worker failure phase " + index + " at status " + status,
        );
      }
      assert.equal(
        await classify(transcript(2), "recovery_failed\n", status),
        "recovery_output_invalid",
        "legacy worker phase must be invalid at status " + status,
      );
      for (let length = 0; length < 4; length += 1) {
        assert.equal(
          await classify(transcript(length), "cleanup_unverified\n", status),
          "remote_cleanup_unverified",
          "cleanup classification at phase " + length + " and status " + status,
        );
      }
    }

    for (const remoteCode of preRuntimeRemoteCodes) {
      assert.equal(
        await classify("", remoteCode + "\n", 0),
        "recovery_output_invalid",
        "successful status cannot carry pre-runtime failure " + remoteCode,
      );
      for (let length = 1; length <= 4; length += 1) {
        assert.equal(
          await classify(transcript(length), remoteCode + "\n", 1),
          "recovery_output_invalid",
          "pre-runtime failure cannot follow marker prefix " + length,
        );
      }
    }

    const canary = "PRIVATE_RECOVERY_CANARY";
    for (const remoteCode of workerRemoteCodes) {
      assert.equal(
        await classify(transcript(2), remoteCode + "\n", 0),
        "recovery_output_invalid",
        "successful status cannot carry worker failure " + remoteCode,
      );
      for (const status of [1, 124, 255]) {
        for (const length of [0, 1, 3, 4]) {
          assert.equal(
            await classify(transcript(length), remoteCode + "\n", status),
            "recovery_output_invalid",
            remoteCode + " cannot follow marker prefix " + length +
              " at status " + status,
          );
        }
        for (const stderr of [
          remoteCode,
          remoteCode + "\r\n",
          remoteCode + "\n\n",
          remoteCode + canary + "\n",
        ]) {
          assert.equal(
            await classify(transcript(2), stderr, status),
            "recovery_output_invalid",
            remoteCode + " malformed stderr at status " + status,
          );
        }
        for (const stdout of [
          transcript(2) + canary,
          markers[1] + "\n",
          markers[0] + "\n" + markers[2] + "\n",
          transcript(2).slice(0, -1),
        ]) {
          assert.equal(
            await classify(stdout, remoteCode + "\n", status),
            "recovery_output_invalid",
            remoteCode + " malformed stdout at status " + status,
          );
        }
      }
    }

    const invalidCases = [
      [transcript(4), "recovery_failed\n", 1],
      [transcript(4), "cleanup_unverified\n", 1],
      ["", "recovery_failed\n", 1],
      [transcript(2), "recovery_failed\n", 1],
      [transcript(2), "recovery_failed\n", 124],
      [transcript(2), "recovery_failed\n", 255],
      [transcript(1), preRuntimeRemoteCodes[0] + "\n", 1],
      ["", "recovery_failed_stage_invalid\n", 1],
      ["", preRuntimeRemoteCodes[0], 1],
      ["", preRuntimeRemoteCodes[0] + "\r\n", 1],
      ["", preRuntimeRemoteCodes[0] + "\n\n", 1],
      [transcript(3) + canary, "recovery_failed\n", 1],
      [markers[1] + "\n", "recovery_failed\n", 1],
      [markers[0], "recovery_failed\n", 1],
      [transcript(1), "recovery_failed", 1],
      [transcript(1), "recovery_failed\n" + canary, 1],
      ["", preRuntimeRemoteCodes[0] + canary + "\n", 1],
      [transcript(1), "cleanup_unverified\n\n", 1],
      [transcript(1), "cleanup_unverified", 1],
      [transcript(1), "", 1],
      ["", "", 1],
      [transcript(3), "", 0],
      [transcript(4), "recovery_failed\n", 0],
      [transcript(4), "", -1],
      [transcript(4), "", 256],
      [transcript(4), "", "not-a-status"],
    ];
    for (const [stdout, stderr, status] of invalidCases) {
      const classification = await classify(stdout, stderr, status);
      assert.equal(classification, "recovery_output_invalid");
      assert.equal(classification.includes(canary), false);
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("public verification expects the frozen build on every required route", () => {
  const recoveryIndex = (job.steps ?? []).findIndex(
    (step) => typeof step?.run === "string" &&
      /\bssh\b/.test(step.run) &&
      step.run.includes("fence_cleanup_verified"),
  );
  const smokeIndex = (job.steps ?? []).findIndex(
    (step) => typeof step?.run === "string" &&
      step.run.includes("scripts/check-production-smoke.mjs"),
  );
  assert.ok(recoveryIndex >= 0 && smokeIndex > recoveryIndex);
  const smoke = job.steps[smokeIndex].run;
  assert.match(smoke, /--origin https:\/\/faolla\.com/);
  assert.match(smoke, /--paths \/,\/login,\/10909094,\/admin/);
  assert.match(smoke, /--expected-build "\$INCIDENT_OLD_BUILD_ID"/);
  assert.match(smoke, /--attempts 8/);
  assert.match(smoke, /--delay-ms 2000/);
  assert.match(smoke, /--timeout-ms 12000/);
  assert.match(smoke, /public_smoke_verified/);
  assert.match(smoke, /public_smoke_failed/);
});

test("incident recovery cannot dispatch, rerun, deploy, upload logs, or mutate broadly", () => {
  assert.doesNotMatch(workflow, /actions\/workflows\/deploy\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /actions\/runs\/[^\s"']+\/rerun/);
  assert.doesNotMatch(workflow, /\bgh\s+workflow\s+run\b|\bgh\s+run\s+rerun\b/);
  assert.doesNotMatch(workflow, /\bgh\s+api\b[^\n]*(?:--method|-X)\s+POST\b/);
  assert.doesNotMatch(workflow, /\bgit\s+push\b/);
  assert.doesNotMatch(workflow, /scripts\/deploy\.production\.sh/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact@/);
  assert.doesNotMatch(workflow, /\bgh\s+run\s+view\b[^\n]*--log/);
  assert.doesNotMatch(workflow, /\brm\s+(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)(?:\s|$)/);
  assert.doesNotMatch(workflow, /\bgit\s+(?:reset|clean)\b/);
  assert.doesNotMatch(workflow, /\bdocker\s+(?:rm|stop|kill|restart)\b/);
  assert.doesNotMatch(workflow, /\b(?:kill|pkill|killall)\s+/);
  assert.doesNotMatch(workflow, /pg_(?:cancel|terminate)_backend/);
  assert.doesNotMatch(workflow, /\b(?:ln\s+-s|mv)\b/);
  assert.doesNotMatch(workflow, /\bprintenv\b/);
});
