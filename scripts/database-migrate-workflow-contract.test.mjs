import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJsonBytes,
  PRODUCTION_RELEASE_BASELINE_KEYS,
} from "./production-release-attestation.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const workflowPath = path.join(
  repositoryRoot,
  ".github",
  "workflows",
  "database-migrate.yml",
);
const runnerPath = path.join(
  repositoryRoot,
  "scripts",
  "apply-production-database-migrations.mjs",
);
const workflow = await readFile(workflowPath, "utf8");
const migrationRunner = await readFile(runnerPath, "utf8");

const TARGET_SHA = "a".repeat(40);
const LIVE_SHA = "b".repeat(40);
const REPOSITORY = "faolla/merchant-space";
const BACKUP_RUN_ID = "81001";
const BACKUP_RUN_ATTEMPT = "3";
const BACKUP_WORKFLOW_ID = "71";
const THROUGH = "202608200040";
const LATER = "202608200041";
const CONTAINER_NAME = "supabase-db";
const CONTAINER_ID = "c".repeat(64);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractHeredocs(tag) {
  const pattern = new RegExp(
    `<<'${tag}'\\r?\\n([\\s\\S]*?)\\r?\\n          ${tag}(?=\\r?\\n)`,
    "g",
  );
  return [...workflow.matchAll(pattern)].map((match) =>
    match[1]
      .split(/\r?\n/)
      .map((line) => line.startsWith("          ") ? line.slice(10) : line)
      .join("\n"),
  );
}

function heredocContaining(tag, marker) {
  const matches = extractHeredocs(tag).filter((source) => source.includes(marker));
  assert.equal(matches.length, 1, `expected one ${tag} heredoc containing ${marker}`);
  return matches[0];
}

function extractRunBlocks() {
  const lines = workflow.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== "        run: |") continue;
    const body = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line !== "" && !line.startsWith("          ")) {
        index -= 1;
        break;
      }
      body.push(line.startsWith("          ") ? line.slice(10) : line);
    }
    blocks.push(body.join("\n"));
  }
  return blocks;
}

function resolveExecutable(candidates, versionArguments = ["--version"]) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, versionArguments, { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  throw new Error(`required executable was not found: ${candidates.filter(Boolean).join(", ")}`);
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
    const sharedWorkspacePackage = path.join(
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

function runEmbeddedNode(source, arguments_, environment = {}) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-", ...arguments_],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, ...environment },
      input: source,
    },
  );
}

const chainSource = heredocContaining("NODE", "successful_push_ci_missing");
const inventorySource = heredocContaining(
  "NODE",
  "backup_attestation_artifact_size_invalid",
);
const jitInventorySource = heredocContaining(
  "NODE",
  "jit_backup_artifact_binding_invalid",
);
const jitGetSource = heredocContaining(
  "NODE",
  "jit_backup_artifact_get_mismatch",
);
const dryRunSource = heredocContaining(
  "NODE",
  "migration_dry_run_contract_invalid",
);
const preflightSource = heredocContaining(
  "NODE",
  "migration_preflight_report_invalid",
);
const applySource = heredocContaining(
  "NODE",
  "migration_apply_contract_invalid",
);

function validReleaseChain() {
  const repository = { full_name: REPOSITORY };
  return {
    main: { sha: TARGET_SHA },
    ci: {
      workflow_runs: [
        {
          id: 71001,
          run_attempt: 2,
          name: "CI",
          path: ".github/workflows/ci.yml",
          event: "push",
          status: "completed",
          conclusion: "success",
          head_branch: "main",
          head_sha: TARGET_SHA,
          repository,
          head_repository: repository,
        },
      ],
    },
    backup: {
      id: Number(BACKUP_RUN_ID),
      workflow_id: Number(BACKUP_WORKFLOW_ID),
      run_attempt: Number(BACKUP_RUN_ATTEMPT),
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      name: "Encrypted Database Backup",
      path: ".github/workflows/database-backup.yml",
      head_branch: "main",
      head_sha: TARGET_SHA,
      repository,
      head_repository: repository,
    },
    workflow: {
      id: Number(BACKUP_WORKFLOW_ID),
      name: "Encrypted Database Backup",
      path: ".github/workflows/database-backup.yml",
      state: "active",
    },
  };
}

function validArtifacts() {
  const suffix = `${BACKUP_RUN_ID}-${BACKUP_RUN_ATTEMPT}`;
  const names = [
    `faolla-encrypted-disaster-recovery-${suffix}`,
    `faolla-production-backup-attestation-${suffix}`,
    `faolla-backup-verification-reports-${suffix}`,
    `faolla-encrypted-backup-attestation-bundle-${suffix}`,
    `faolla-production-backup-attestation-bundle-${suffix}`,
  ];
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  return names.map((name, index) => ({
    id: 91001 + index,
    name,
    digest: `sha256:${String(index + 1).repeat(64)}`,
    size_in_bytes: index === 1 ? 4096 : 8192 + index,
    expired: false,
    created_at: createdAt,
    expires_at: expiresAt,
    workflow_run: {
      id: Number(BACKUP_RUN_ID),
      head_branch: "main",
      head_sha: TARGET_SHA,
    },
  }));
}

function validArtifactPages() {
  return [{ total_count: 5, artifacts: validArtifacts() }];
}

const baseline = Object.fromEntries(
  PRODUCTION_RELEASE_BASELINE_KEYS.map((key) => [key, "0"]),
);
baseline.merchantRecordCount = "7";
baseline.merchantAuthoritativeBindingCount = "7";
baseline.personalCanonicalBindingCount = "4";
baseline.ordinaryIdentityContentSha256 = "d".repeat(64);

const database = {
  containerName: CONTAINER_NAME,
  containerId: CONTAINER_ID,
  dbName: "postgres",
  dbOid: "16384",
  systemId: "7312345678901234567",
  primary: true,
};

async function withTemporaryDirectory(prefix, task) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await task(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runChainScenario(mutate = () => {}) {
  return withTemporaryDirectory("faolla-migrate-chain-", async (directory) => {
    const value = validReleaseChain();
    mutate(value);
    const files = {
      main: join(directory, "main.json"),
      ci: join(directory, "ci.json"),
      backup: join(directory, "backup.json"),
      workflow: join(directory, "workflow.json"),
      output: join(directory, "output.txt"),
    };
    await Promise.all([
      writeFile(files.main, JSON.stringify(value.main)),
      writeFile(files.ci, JSON.stringify(value.ci)),
      writeFile(files.backup, JSON.stringify(value.backup)),
      writeFile(files.workflow, JSON.stringify(value.workflow)),
      writeFile(files.output, ""),
    ]);
    const result = runEmbeddedNode(
      chainSource,
      [files.main, files.ci, files.backup, files.workflow, BACKUP_WORKFLOW_ID],
      {
        BACKUP_RUN_ID,
        BACKUP_WORKFLOW_NAME: "Encrypted Database Backup",
        BACKUP_WORKFLOW_PATH: ".github/workflows/database-backup.yml",
        GITHUB_OUTPUT: files.output,
        GITHUB_REPOSITORY: REPOSITORY,
        TARGET_SHA,
      },
    );
    return { result, output: await readFile(files.output, "utf8") };
  });
}

async function runInventoryScenario(mutate = () => {}) {
  return withTemporaryDirectory("faolla-migrate-inventory-", async (directory) => {
    const pages = validArtifactPages();
    mutate(pages);
    const input = join(directory, "pages.json");
    const output = join(directory, "output.txt");
    await writeFile(input, JSON.stringify(pages));
    await writeFile(output, "");
    const result = runEmbeddedNode(inventorySource, [input], {
      BACKUP_RUN_ATTEMPT,
      BACKUP_RUN_ID,
      GITHUB_OUTPUT: output,
      TARGET_SHA,
    });
    return { result, output: await readFile(output, "utf8") };
  });
}

async function runJitInventoryScenario(mutate = () => {}, mutateEnvironment = () => {}) {
  return withTemporaryDirectory("faolla-migrate-jit-", async (directory) => {
    const value = validReleaseChain();
    const pages = validArtifactPages();
    mutate({ ...value, pages });
    const files = {
      run: join(directory, "run.json"),
      workflow: join(directory, "workflow.json"),
      pages: join(directory, "pages.json"),
      manifest: join(directory, "manifest.json"),
    };
    await Promise.all([
      writeFile(files.run, JSON.stringify(value.backup)),
      writeFile(files.workflow, JSON.stringify(value.workflow)),
      writeFile(files.pages, JSON.stringify(pages)),
    ]);
    const artifacts = pages[0].artifacts;
    const environment = {
      BACKUP_ATTESTATION_ARTIFACT_DIGEST: artifacts[1]?.digest ?? "",
      BACKUP_ATTESTATION_ARTIFACT_ID: String(artifacts[1]?.id ?? ""),
      BACKUP_PRIMARY_ARTIFACT_DIGEST: artifacts[0]?.digest ?? "",
      BACKUP_PRIMARY_ARTIFACT_ID: String(artifacts[0]?.id ?? ""),
      BACKUP_RUN_ATTEMPT,
      BACKUP_RUN_ID,
      BACKUP_WORKFLOW_ID,
      BACKUP_WORKFLOW_NAME: "Encrypted Database Backup",
      BACKUP_WORKFLOW_PATH: ".github/workflows/database-backup.yml",
      GITHUB_REPOSITORY: REPOSITORY,
      TARGET_SHA,
    };
    mutateEnvironment(environment);
    const result = runEmbeddedNode(
      jitInventorySource,
      [files.run, files.workflow, files.pages, files.manifest],
      environment,
    );
    return { files, result };
  });
}

async function runJitGetScenario(mutate = () => {}) {
  return withTemporaryDirectory("faolla-migrate-jit-get-", async (directory) => {
    const artifacts = validArtifacts();
    const actual = deepClone(artifacts);
    mutate({ listed: artifacts, actual });
    const manifest = join(directory, "manifest.json");
    await writeFile(manifest, JSON.stringify(artifacts));
    await Promise.all(
      actual.map((artifact) =>
        writeFile(join(directory, `artifact-${artifact.id}.json`), JSON.stringify(artifact)),
      ),
    );
    return runEmbeddedNode(jitGetSource, [manifest, directory], {
      BACKUP_RUN_ID,
      TARGET_SHA,
    });
  });
}

function validDryRunReport() {
  return {
    ok: true,
    mode: "dry_run",
    status: "dry_run",
    databaseContainer: CONTAINER_NAME,
    through: THROUGH,
    effectiveThrough: THROUGH,
    discovered: [
      { version: "202608190039" },
      { version: THROUGH },
      { version: LATER },
    ],
    selected: [{ version: "202608190039" }, { version: THROUGH }],
    pending: [{ version: THROUGH }],
    registeredVersions: ["202608190039"],
    executed: [],
  };
}

function validApplyReport() {
  return {
    ...validDryRunReport(),
    mode: "apply",
    status: "applied",
    pending: [{ version: THROUGH }],
    registeredVersions: ["202608190039", THROUGH],
    executed: [{ version: THROUGH }],
  };
}

async function runReportScenario(source, report, mutate = () => {}) {
  return withTemporaryDirectory("faolla-migrate-report-", async (directory) => {
    const value = deepClone(report);
    mutate(value);
    const file = join(directory, "report.json");
    await writeFile(file, JSON.stringify(value));
    return runEmbeddedNode(source, [file, THROUGH, CONTAINER_NAME]);
  });
}

async function runPreflightScenario(mutate = () => {}) {
  return withTemporaryDirectory("faolla-migrate-preflight-", async (directory) => {
    const expectedDatabase = deepClone(database);
    const expectedBaseline = deepClone(baseline);
    const report = {
      ok: true,
      status: "ready",
      mode: "read_only",
      databaseContainer: database.containerName,
      databaseIdentityReady: true,
      baselineReady: true,
      databaseIdentity: {
        dbName: database.dbName,
        dbOid: database.dbOid,
        systemId: database.systemId,
        primary: database.primary,
      },
      readiness: Object.fromEntries(
        Object.entries(baseline).map(([key, value]) => [
          key,
          key === "ordinaryIdentityContentSha256" ? value : Number(value),
        ]),
      ),
    };
    mutate({ expectedDatabase, expectedBaseline, report });
    const reportFile = join(directory, "report.json");
    const databaseFile = join(directory, "database.json");
    const baselineFile = join(directory, "baseline.json");
    await Promise.all([
      writeFile(reportFile, JSON.stringify(report)),
      writeFile(databaseFile, canonicalJsonBytes(expectedDatabase)),
      writeFile(baselineFile, canonicalJsonBytes(expectedBaseline)),
    ]);
    return runEmbeddedNode(
      preflightSource,
      [reportFile, databaseFile, baselineFile],
    );
  });
}

test("workflow YAML, every Bash block, and embedded programs parse", () => {
  const parsed = loadYamlParser().load(workflow);
  assert.equal(parsed.name, "Apply Production Database Migrations");

  const bash = resolveBash();
  const runBlocks = extractRunBlocks();
  assert.ok(runBlocks.length >= 10);
  for (const [index, source] of runBlocks.entries()) {
    const result = spawnSync(bash, ["-n"], { encoding: "utf8", input: source });
    assert.equal(result.status, 0, `bash block ${index + 1}: ${result.stderr}`);
  }

  const nodeSources = extractHeredocs("NODE");
  assert.ok(nodeSources.length >= 14);
  for (const [index, source] of nodeSources.entries()) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--check"],
      { encoding: "utf8", input: source },
    );
    assert.equal(result.status, 0, `NODE heredoc ${index + 1}: ${result.stderr}`);
  }

  const pythonSources = extractHeredocs("PY");
  assert.equal(pythonSources.length, 1);
  const python = resolvePython();
  const arguments_ = python.toLowerCase().endsWith("py.exe")
    ? ["-3", "-c", "import sys; compile(sys.stdin.read(), '<workflow>', 'exec')"]
    : ["-c", "import sys; compile(sys.stdin.read(), '<workflow>', 'exec')"];
  const pythonResult = spawnSync(python, arguments_, {
    encoding: "utf8",
    input: pythonSources[0],
  });
  assert.equal(pythonResult.status, 0, pythonResult.stderr);
});

test("migration is an exact manual serialized request with an independent live build", () => {
  assert.match(workflow, /^on:\r?\n  workflow_dispatch:\r?\n/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_run):/m);
  for (const input of [
    "target_sha",
    "expected_live_app_sha",
    "through",
    "backup_run_id",
    "confirmation",
    "maintenance_window_confirmed",
  ]) assert.match(workflow, new RegExp(`^      ${input}:`, "m"));
  assert.match(workflow, /group: production-deploy/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /APPLY_PRODUCTION_MIGRATIONS/);
  assert.match(workflow, /test "\$MAINTENANCE_WINDOW_CONFIRMED" = "true"/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$TARGET_SHA"/);
  assert.match(workflow, /\[\[ "\$EXPECTED_LIVE_APP_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.equal(
    (workflow.match(/--expected-build "\$EXPECTED_LIVE_APP_SHA"/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(workflow, /--expected-build "\$TARGET_SHA"/);
  assert.doesNotMatch(workflow, /test "\$EXPECTED_LIVE_APP_SHA" = "\$TARGET_SHA"/);
});

test("valid current main, push CI, and exact manual backup chain is accepted", async () => {
  const { result, output } = await runChainScenario();
  assert.equal(result.status, 0, result.stderr);
  assert.match(output, new RegExp(`target_sha=${TARGET_SHA}`));
  assert.match(output, new RegExp(`backup_run_attempt=${BACKUP_RUN_ATTEMPT}`));
  assert.match(output, new RegExp(`backup_workflow_id=${BACKUP_WORKFLOW_ID}`));
  assert.match(output, /ci_run_id=71001/);
});

test("hostile main, CI, backup run, and workflow substitutions fail closed", async () => {
  const mutations = [
    (value) => { value.main.sha = LIVE_SHA; },
    (value) => { value.ci.workflow_runs = []; },
    (value) => { value.ci.workflow_runs[0].event = "workflow_dispatch"; },
    (value) => { value.ci.workflow_runs[0].status = "in_progress"; },
    (value) => { value.ci.workflow_runs[0].conclusion = "failure"; },
    (value) => { value.ci.workflow_runs[0].path = ".github/workflows/other.yml"; },
    (value) => { value.ci.workflow_runs[0].head_sha = LIVE_SHA; },
    (value) => { value.ci.workflow_runs[0].repository.full_name = "fork/repo"; },
    (value) => { value.backup.event = "schedule"; },
    (value) => { value.backup.status = "in_progress"; },
    (value) => { value.backup.conclusion = "failure"; },
    (value) => { value.backup.run_attempt = 0; },
    (value) => { value.backup.path = ".github/workflows/other.yml"; },
    (value) => { value.backup.head_branch = "release"; },
    (value) => { value.backup.head_sha = LIVE_SHA; },
    (value) => { value.backup.head_repository.full_name = "fork/repo"; },
    (value) => { value.workflow.state = "disabled_manually"; },
    (value) => { value.workflow.path = ".github/workflows/other.yml"; },
  ];
  for (const mutate of mutations) {
    const { result } = await runChainScenario(mutate);
    assert.notEqual(result.status, 0, "a hostile release-chain substitution passed");
  }
});

test("exact-five backup artifact inventory accepts only run-attempt-qualified artifacts", async () => {
  const { result, output } = await runInventoryScenario();
  assert.equal(result.status, 0, result.stderr);
  assert.match(output, /id=91002/);
  assert.match(output, new RegExp(`name=faolla-production-backup-attestation-${BACKUP_RUN_ID}-${BACKUP_RUN_ATTEMPT}`));
  assert.match(output, /primary_id=91001/);
});

test("hostile initial artifact count, identity, digest, size, expiry, and run bindings fail", async () => {
  const mutations = [
    (pages) => { pages[0].artifacts.pop(); pages[0].total_count = 4; },
    (pages) => { pages[0].total_count = 4; },
    (pages) => { pages[0].artifacts[4].name = "unexpected"; },
    (pages) => { pages[0].artifacts[4].id = pages[0].artifacts[0].id; },
    (pages) => { pages[0].artifacts[4].size_in_bytes = 0; },
    (pages) => { pages[0].artifacts[4].digest = "sha256:bad"; },
    (pages) => { pages[0].artifacts[4].expired = true; },
    (pages) => { pages[0].artifacts[4].expires_at = new Date().toISOString(); },
    (pages) => { pages[0].artifacts[4].workflow_run.id += 1; },
    (pages) => { pages[0].artifacts[4].workflow_run.head_branch = "release"; },
    (pages) => { pages[0].artifacts[4].workflow_run.head_sha = LIVE_SHA; },
    (pages) => { pages[0].artifacts[1].size_in_bytes = 2 * 1024 * 1024 + 1; },
  ];
  for (const mutate of mutations) {
    const { result } = await runInventoryScenario(mutate);
    assert.notEqual(result.status, 0, "a hostile initial artifact substitution passed");
  }
});

test("just-in-time backup run, workflow, exact-five list, and canonical bindings are dynamic", async () => {
  const { result } = await runJitInventoryScenario();
  assert.equal(result.status, 0, result.stderr);
  const mutations = [
    ({ backup }) => { backup.run_attempt += 1; },
    ({ backup }) => { backup.event = "schedule"; },
    ({ backup }) => { backup.head_sha = LIVE_SHA; },
    ({ workflow: value }) => { value.state = "disabled_manually"; },
    ({ pages }) => { pages[0].artifacts.pop(); pages[0].total_count = 4; },
    ({ pages }) => { pages[0].artifacts[3].name = "unexpected"; },
    ({ pages }) => { pages[0].artifacts[3].expired = true; },
    ({ pages }) => { pages[0].artifacts[3].workflow_run.id += 1; },
  ];
  for (const mutate of mutations) {
    const scenario = await runJitInventoryScenario(mutate);
    assert.notEqual(scenario.result.status, 0, "a hostile JIT inventory substitution passed");
  }
  const wrongCanonical = await runJitInventoryScenario(
    () => {},
    (environment) => { environment.BACKUP_ATTESTATION_ARTIFACT_ID = "99999"; },
  );
  assert.notEqual(wrongCanonical.result.status, 0);
  const wrongPrimary = await runJitInventoryScenario(
    () => {},
    (environment) => { environment.BACKUP_PRIMARY_ARTIFACT_DIGEST = `sha256:${"f".repeat(64)}`; },
  );
  assert.notEqual(wrongPrimary.result.status, 0);
});

test("each JIT artifact GET must still exactly match the listed object", async () => {
  const valid = await runJitGetScenario();
  assert.equal(valid.status, 0, valid.stderr);
  const mutations = [
    ({ actual }) => { actual[4].name = "substituted"; },
    ({ actual }) => { actual[4].digest = `sha256:${"f".repeat(64)}`; },
    ({ actual }) => { actual[4].size_in_bytes += 1; },
    ({ actual }) => { actual[4].expired = true; },
    ({ actual }) => { actual[4].workflow_run.id += 1; },
    ({ actual }) => { actual[4].workflow_run.head_sha = LIVE_SHA; },
  ];
  for (const mutate of mutations) {
    const result = await runJitGetScenario(mutate);
    assert.notEqual(result.status, 0, "a hostile per-ID artifact GET passed");
  }
});

test("canonical artifact ZIP and native provenance are digest, path, subject, and public-good bound", () => {
  assert.match(workflow, /archive_digest="sha256:\$\(sha256sum "\$archive_path"/);
  assert.match(workflow, /test "\$archive_digest" = "\$BACKUP_ATTESTATION_ARTIFACT_DIGEST"/);
  assert.doesNotMatch(
    workflow,
    /stat -c '%s' "\$BACKUP_ATTESTATION_PATH"[^\n]*BACKUP_ATTESTATION_ARTIFACT_SIZE_BYTES/,
  );
  assert.match(workflow, /expected_name = "production-backup-attestation\.json"/);
  assert.match(workflow, /if len\(entries\) != 1:/);
  assert.match(workflow, /entry\.filename != expected_name/);
  assert.match(workflow, /entry\.is_dir\(\)/);
  assert.match(workflow, /entry\.flag_bits & 0x1/);
  assert.match(workflow, /stat\.S_ISLNK\(mode\)/);
  assert.match(workflow, /os\.O_EXCL/);
  assert.match(workflow, /os\.O_NOFOLLOW/);
  assert.doesNotMatch(workflow, /extractall|\.extract\(/);
  assert.match(workflow, /gh attestation verify "\$BACKUP_ATTESTATION_PATH"/);
  assert.match(workflow, /--signer-workflow "github\.com\/\$GITHUB_REPOSITORY\/\$BACKUP_WORKFLOW_PATH"/);
  assert.match(workflow, /--source-digest "\$TARGET_SHA"/);
  assert.match(workflow, /--source-ref "refs\/heads\/main"/);
  assert.match(workflow, /--predicate-type "https:\/\/slsa\.dev\/provenance\/v1"/);
  assert.match(workflow, /--deny-self-hosted-runners/);
  assert.doesNotMatch(workflow, /--no-public-good/);
  assert.match(workflow, /results\.length !== 1/);
  assert.match(workflow, /subject\?\.name === "production-backup-attestation\.json"/);
});

test("shared validation binds recursive primary evidence and has initial plus JIT TTL", () => {
  assert.equal(
    (workflow.match(/production-release-attestation\.mjs validate/g) ?? []).length,
    3,
  );
  for (const binding of [
    "--expected-repository \"$GITHUB_REPOSITORY\"",
    "--expected-target-sha \"$TARGET_SHA\"",
    "--expected-run-id \"$BACKUP_RUN_ID\"",
    "--expected-run-attempt \"$BACKUP_RUN_ATTEMPT\"",
    "--expected-backup-run-id \"$BACKUP_RUN_ID\"",
    "--expected-artifact-id \"$primary_artifact_id\"",
    "--expected-artifact-digest \"$primary_artifact_digest\"",
    "--expected-backup-artifact-id \"$primary_artifact_id\"",
    "--expected-backup-artifact-digest \"$primary_artifact_digest\"",
    "--minimum-remaining-seconds 5700",
    "--minimum-remaining-seconds 3600",
  ]) assert.ok(workflow.includes(binding), `missing shared binding: ${binding}`);
  assert.match(workflow, /cmp --silent "\$BACKUP_SUMMARY_PATH" "\$just_in_time_summary"/);
  assert.match(workflow, /jit_backup_artifact_inventory_count_invalid/);
  assert.match(workflow, /for artifact_id in "\$\{jit_artifact_ids\[@\]\}"/);
  assert.match(workflow, /actions\/artifacts\/\$artifact_id/);
  assert.match(workflow, /actual\.digest !== expected\.digest/);
  assert.match(workflow, /Date\.parse\(actual\.expires_at\) - now < 3_600_000/);
});

test("pinned SSH creates and executes only a clean detached target worktree", () => {
  assert.match(workflow, /SSH_KNOWN_HOSTS: \$\{\{ secrets\.SSH_KNOWN_HOSTS \}\}/);
  assert.match(workflow, /BatchMode=yes/);
  assert.match(workflow, /IdentitiesOnly=yes/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /UserKnownHostsFile="\$HOME\/\.ssh\/known_hosts"/);
  assert.match(workflow, /ConnectionAttempts=1/);
  assert.doesNotMatch(workflow, /ssh-keyscan|accept-new|StrictHostKeyChecking=no/);
  assert.match(workflow, /git -C "\$repository_dir" worktree add --detach/);
  assert.match(workflow, /git -C "\$FAOLLA_MIGRATION_WORKTREE" symbolic-ref -q HEAD/);
  assert.match(workflow, /status --porcelain=v1 --untracked-files=all/);
  assert.match(workflow, /cd "\$FAOLLA_MIGRATION_WORKTREE"/);
  assert.doesNotMatch(workflow, /cd "\$APP_DIR"/);
  assert.doesNotMatch(workflow, /node[^\n]*"?\$APP_DIR[^\n]*scripts\//);
});

test("all attested DB identity fields and all baseline fields gate the live preflight", async () => {
  const valid = await runPreflightScenario();
  assert.equal(valid.status, 0, valid.stderr);
  const databaseMutations = [
    ({ report }) => { report.databaseContainer = "other-db"; },
    ({ report }) => { report.databaseIdentity.dbName = "other"; },
    ({ report }) => { report.databaseIdentity.dbOid = "999"; },
    ({ report }) => { report.databaseIdentity.systemId = "999"; },
    ({ report }) => { report.databaseIdentity.primary = false; },
    ({ report }) => { report.databaseIdentityReady = false; },
    ({ report }) => { report.baselineReady = false; },
  ];
  for (const mutate of databaseMutations) {
    const result = await runPreflightScenario(mutate);
    assert.notEqual(result.status, 0, "a hostile database identity mutation passed");
  }
  for (const key of PRODUCTION_RELEASE_BASELINE_KEYS) {
    const result = await runPreflightScenario(({ report }) => {
      report.readiness[key] = key === "ordinaryIdentityContentSha256"
        ? "e".repeat(64)
        : report.readiness[key] + 1;
    });
    assert.notEqual(result.status, 0, `baseline substitution passed: ${key}`);
  }
  assert.match(workflow, /test "\$\(docker inspect --format '\{\{\.Id\}\}' "\$expected_container_name"\)" = "\$FAOLLA_EXPECTED_CONTAINER_ID"/);
  assert.match(workflow, /scripts\/check-ordinary-account-cutover-readiness\.mjs/);
  assert.match(workflow, /PRODUCTION_RELEASE_BASELINE_KEYS\.map/);
  assert.match(workflow, /canonicalJsonBytes\(actualDatabase\)\.equals/);
  assert.match(workflow, /canonicalJsonBytes\(actualBaseline\)\.equals/);
});

test("through can stop before a later target migration and no report may cross it", async () => {
  assert.match(workflow, /discoverProductionDatabaseMigrations/);
  assert.match(workflow, /discovery\.selected\.at\(-1\)\?\.version !== through/);
  assert.doesNotMatch(workflow, /latest_migration|tail -n 1/);
  assert.match(workflow, /--dry-run --through="\$FAOLLA_THROUGH" --json/);
  assert.match(workflow, /--apply --through="\$FAOLLA_THROUGH" --json/);

  const dryValid = await runReportScenario(dryRunSource, validDryRunReport());
  assert.equal(dryValid.status, 0, dryValid.stderr);
  const applyValid = await runReportScenario(applySource, validApplyReport());
  assert.equal(applyValid.status, 0, applyValid.stderr);
  const dryMutations = [
    (report) => { report.effectiveThrough = LATER; },
    (report) => { report.selected.push({ version: LATER }); },
    (report) => { report.pending.push({ version: LATER }); },
    (report) => { report.registeredVersions.push(LATER); },
    (report) => { report.executed.push({ version: THROUGH }); },
    (report) => { report.databaseContainer = "other-db"; },
  ];
  for (const mutate of dryMutations) {
    const result = await runReportScenario(dryRunSource, validDryRunReport(), mutate);
    assert.notEqual(result.status, 0, "a hostile dry-run boundary mutation passed");
  }
  const applyMutations = [
    (report) => { report.effectiveThrough = LATER; },
    (report) => { report.selected.push({ version: LATER }); },
    (report) => { report.executed.push({ version: LATER }); },
    (report) => { report.registeredVersions.push(LATER); },
    (report) => { report.status = "dry_run"; },
  ];
  for (const mutate of applyMutations) {
    const result = await runReportScenario(applySource, validApplyReport(), mutate);
    assert.notEqual(result.status, 0, "a hostile apply boundary mutation passed");
  }
});

test("the trusted existing runner supplies migration serialization and advisory locking", () => {
  assert.match(workflow, /scripts\/apply-production-database-migrations\.mjs/);
  assert.doesNotMatch(workflow, /\bpsql\b|docker\s+exec|inputs\.(?:sql|query)/i);
  assert.match(migrationRunner, /SELECT pg_advisory_lock\(20260731, 1\);/);
  assert.match(migrationRunner, /SELECT pg_advisory_unlock\(20260731, 1\);/);
  assert.match(migrationRunner, /wrapMigrationWithAdvisoryLock\(migration\.source\)/);
  assert.match(migrationRunner, /acquireProductionMigrationLock/);
});

test("the preflight-to-apply DML TOCTOU boundary is explicitly maintenance-controlled", () => {
  assert.match(workflow, /Confirm application writes, DDL, and other migrations are paused/);
  assert.match(workflow, /existing advisory lock serializes migration runners, not arbitrary DML/);
  assert.match(workflow, /preflight-to-apply DML exclusion boundary is the operator-confirmed maintenance window/);
  assert.match(workflow, /preflight-to-apply DML exclusion depends on the confirmed maintenance window/);
  const preflightIndex = workflow.indexOf("scripts/check-ordinary-account-cutover-readiness.mjs");
  const applyIndex = workflow.indexOf("--apply --through=\"$FAOLLA_THROUGH\"");
  assert.ok(preflightIndex >= 0 && applyIndex > preflightIndex);
});

test("remote worktree and local evidence are always cleaned without broad deletion", () => {
  assert.match(workflow, /- name: Remove Remote Exact Migration Source\r?\n        if: always\(\)/);
  assert.match(workflow, /git -C "\$repository_dir" worktree remove --force "\$FAOLLA_MIGRATION_WORKTREE"/);
  assert.match(workflow, /test ! -e "\$FAOLLA_MIGRATION_WORKTREE"/);
  assert.match(workflow, /rm -f -- "\$BACKUP_ATTESTATION_PATH" "\$BACKUP_SUMMARY_PATH" "\$MIGRATION_REPORT_PATH"/);
  assert.doesNotMatch(workflow, /rm\s+-rf|rm\s+-fr/);
  assert.doesNotMatch(workflow, /\beval\b/);
});
