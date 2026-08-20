import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/ordinary-account-cutover-readiness.yml", import.meta.url),
  "utf8",
);

const TARGET_SHA = "a".repeat(40);
const REPOSITORY = "faolla/merchant-space";
const BACKUP_RUN_ID = "81001";
const BACKUP_RUN_ATTEMPT = "3";
const BACKUP_WORKFLOW_ID = "71";

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

function runEmbeddedNode(source, arguments_, environment) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-", ...arguments_],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, ...environment },
      input: source,
    },
  );
}

const chainSource = heredocContaining("NODE", "successful_push_ci_missing");
const artifactInventorySource = heredocContaining(
  "NODE",
  "backup_artifact_inventory_count_invalid",
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
    backupWorkflow: {
      id: Number(BACKUP_WORKFLOW_ID),
      name: "Encrypted Database Backup",
      path: ".github/workflows/database-backup.yml",
      state: "active",
    },
  };
}

async function runReleaseChainScenario(mutate = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "faolla-readiness-chain-"));
  try {
    const value = validReleaseChain();
    mutate(value);
    const paths = {
      main: join(directory, "main.json"),
      ci: join(directory, "ci.json"),
      backup: join(directory, "backup.json"),
      backupWorkflow: join(directory, "workflow.json"),
      output: join(directory, "output.txt"),
    };
    await Promise.all([
      writeFile(paths.main, JSON.stringify(value.main)),
      writeFile(paths.ci, JSON.stringify(value.ci)),
      writeFile(paths.backup, JSON.stringify(value.backup)),
      writeFile(paths.backupWorkflow, JSON.stringify(value.backupWorkflow)),
      writeFile(paths.output, ""),
    ]);
    const result = runEmbeddedNode(
      chainSource,
      [paths.main, paths.ci, paths.backup, paths.backupWorkflow, BACKUP_WORKFLOW_ID],
      {
        BACKUP_RUN_ID,
        BACKUP_WORKFLOW_NAME: "Encrypted Database Backup",
        BACKUP_WORKFLOW_PATH: ".github/workflows/database-backup.yml",
        GITHUB_OUTPUT: paths.output,
        GITHUB_REPOSITORY: REPOSITORY,
        TARGET_SHA,
      },
    );
    const output = await readFile(paths.output, "utf8");
    return { output, result };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validBackupArtifactInventory() {
  const suffix = `${BACKUP_RUN_ID}-${BACKUP_RUN_ATTEMPT}`;
  const names = [
    `faolla-encrypted-disaster-recovery-${suffix}`,
    `faolla-production-backup-attestation-${suffix}`,
    `faolla-backup-verification-reports-${suffix}`,
    `faolla-encrypted-backup-attestation-bundle-${suffix}`,
    `faolla-production-backup-attestation-bundle-${suffix}`,
  ];
  const createdAt = new Date(Date.now() - 60_000).toISOString().replace(".000Z", "Z");
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
    .toISOString()
    .replace(".000Z", "Z");
  return [
    {
      total_count: 5,
      artifacts: names.map((name, index) => ({
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
      })),
    },
  ];
}

async function runArtifactInventoryScenario(mutate = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "faolla-readiness-artifacts-"));
  try {
    const pages = validBackupArtifactInventory();
    mutate(pages);
    const inventoryPath = join(directory, "inventory.json");
    const outputPath = join(directory, "output.txt");
    await writeFile(inventoryPath, JSON.stringify(pages));
    await writeFile(outputPath, "");
    const result = runEmbeddedNode(
      artifactInventorySource,
      [inventoryPath],
      {
        BACKUP_RUN_ATTEMPT,
        BACKUP_RUN_ID,
        GITHUB_OUTPUT: outputPath,
        TARGET_SHA,
      },
    );
    const output = await readFile(outputPath, "utf8");
    return { output, result };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("workflow is an exact manual main release-chain gate", () => {
  assert.match(workflow, /^on:\r?\n  workflow_dispatch:\r?\n/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule|workflow_run):\s*$/m);
  for (const input of [
    "target_sha",
    "backup_run_id",
    "confirmation",
    "maintenance_window_confirmed",
  ]) {
    assert.match(workflow, new RegExp(`^      ${input}:`, "m"));
  }
  assert.match(workflow, /group: production-deploy/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /test "\$GITHUB_EVENT_NAME" = "workflow_dispatch"/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$TARGET_SHA"/);
  assert.match(workflow, /CHECK_ORDINARY_ACCOUNT_CUTOVER/);
  assert.match(workflow, /test "\$MAINTENANCE_WINDOW_CONFIRMED" = "true"/);
  assert.match(workflow, /\[\[ "\$TARGET_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflow, /permissions:\r?\n  actions: read\r?\n  attestations: write\r?\n  contents: read\r?\n  id-token: write/);
});

test("every workflow bash block and embedded program is syntactically real", () => {
  const bash = resolveBash();
  const runBlocks = extractRunBlocks();
  assert.ok(runBlocks.length >= 10);
  for (const [index, source] of runBlocks.entries()) {
    const result = spawnSync(bash, ["-n"], { encoding: "utf8", input: source });
    assert.equal(result.status, 0, `bash block ${index + 1}: ${result.stderr}`);
  }
  const nodeSources = extractHeredocs("NODE");
  assert.ok(nodeSources.length >= 10);
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
  const pythonArguments = python.toLowerCase().endsWith("py.exe")
    ? ["-3", "-c", "import sys; compile(sys.stdin.read(), '<workflow>', 'exec')"]
    : ["-c", "import sys; compile(sys.stdin.read(), '<workflow>', 'exec')"];
  const pythonResult = spawnSync(python, pythonArguments, {
    encoding: "utf8",
    input: pythonSources[0],
  });
  assert.equal(pythonResult.status, 0, pythonResult.stderr);
});

test("valid main, push CI, and manual backup run chain is accepted", async () => {
  const { output, result } = await runReleaseChainScenario();
  assert.equal(result.status, 0, result.stderr);
  assert.match(output, new RegExp(`target_sha=${TARGET_SHA}`));
  assert.match(output, new RegExp(`backup_run_id=${BACKUP_RUN_ID}`));
  assert.match(output, new RegExp(`backup_run_attempt=${BACKUP_RUN_ATTEMPT}`));
  assert.match(output, /ci_run_id=71001/);
  assert.match(output, /ci_run_attempt=2/);
});

test("main, CI, backup run, and backup workflow mismatches fail closed", async () => {
  const mutations = [
    (value) => { value.main.sha = "b".repeat(40); },
    (value) => { value.ci.workflow_runs[0].event = "workflow_dispatch"; },
    (value) => { value.ci.workflow_runs[0].status = "in_progress"; },
    (value) => { value.ci.workflow_runs[0].conclusion = "failure"; },
    (value) => { value.ci.workflow_runs[0].path = ".github/workflows/other.yml"; },
    (value) => { value.ci.workflow_runs[0].head_sha = "b".repeat(40); },
    (value) => { value.ci.workflow_runs[0].repository.full_name = "fork/merchant-space"; },
    (value) => { value.backup.event = "push"; },
    (value) => { value.backup.status = "in_progress"; },
    (value) => { value.backup.conclusion = "failure"; },
    (value) => { value.backup.run_attempt = 0; },
    (value) => { value.backup.path = ".github/workflows/other.yml"; },
    (value) => { value.backup.head_branch = "release"; },
    (value) => { value.backup.head_sha = "b".repeat(40); },
    (value) => { value.backup.head_repository.full_name = "fork/merchant-space"; },
    (value) => { value.backupWorkflow.state = "disabled_manually"; },
    (value) => { value.backupWorkflow.path = ".github/workflows/other.yml"; },
  ];
  for (const mutate of mutations) {
    const { result } = await runReleaseChainScenario(mutate);
    assert.notEqual(result.status, 0, "a hostile release-chain mutation was accepted");
  }
});

test("valid exact-five backup artifact inventory is accepted and normalized", async () => {
  const { output, result } = await runArtifactInventoryScenario();
  assert.equal(result.status, 0, result.stderr);
  assert.match(output, /id=91002/);
  assert.match(output, new RegExp(`name=faolla-production-backup-attestation-${BACKUP_RUN_ID}-${BACKUP_RUN_ATTEMPT}`));
  assert.match(output, /digest=sha256:2{64}/);
  assert.match(output, /primary_id=91001/);
  assert.match(output, /primary_digest=sha256:1{64}/);
  assert.match(output, /created_at=.*\.\d{3}Z/);
  assert.match(output, /expires_at=.*\.\d{3}Z/);
});

test("backup artifact inventory count, identity, digest, size, expiry, and run bindings fail closed", async () => {
  const mutations = [
    (pages) => { pages[0].artifacts.pop(); pages[0].total_count = 4; },
    (pages) => { pages[0].artifacts.push(deepClone(pages[0].artifacts[0])); pages[0].total_count = 6; },
    (pages) => { pages[0].total_count = 4; },
    (pages) => { pages[0].artifacts[4].name = "faolla-unexpected-artifact"; },
    (pages) => { pages[0].artifacts[4].id = pages[0].artifacts[0].id; },
    (pages) => { pages[0].artifacts[4].size_in_bytes = 0; },
    (pages) => { pages[0].artifacts[4].digest = "sha256:not-a-digest"; },
    (pages) => { pages[0].artifacts[4].expired = true; },
    (pages) => { pages[0].artifacts[4].expires_at = new Date(Date.now() - 1_000).toISOString(); },
    (pages) => { pages[0].artifacts[4].created_at = new Date(Date.now() + 10 * 60_000).toISOString(); },
    (pages) => { pages[0].artifacts[4].created_at = pages[0].artifacts[4].expires_at; },
    (pages) => { pages[0].artifacts[4].workflow_run.id += 1; },
    (pages) => { pages[0].artifacts[4].workflow_run.head_branch = "release"; },
    (pages) => { pages[0].artifacts[4].workflow_run.head_sha = "b".repeat(40); },
    (pages) => { pages[0].artifacts[1].size_in_bytes = 2 * 1024 * 1024 + 1; },
  ];
  for (const mutate of mutations) {
    const { result } = await runArtifactInventoryScenario(mutate);
    assert.notEqual(result.status, 0, "a hostile backup artifact mutation was accepted");
  }
});

test("backup artifact ZIP is digest-bound, traversal-safe, and single-file canonical", () => {
  assert.match(workflow, /archive_digest="sha256:\$\(sha256sum "\$archive_path"/);
  assert.match(workflow, /test "\$archive_digest" = "\$BACKUP_ATTESTATION_ARTIFACT_DIGEST"/);
  assert.match(workflow, /expected_name = "production-backup-attestation\.json"/);
  assert.match(workflow, /if len\(entries\) != 1:/);
  assert.match(workflow, /entry\.filename != expected_name/);
  assert.match(workflow, /entry\.is_dir\(\)/);
  assert.match(workflow, /entry\.flag_bits & 0x1/);
  assert.match(workflow, /stat\.S_ISLNK\(mode\)/);
  assert.match(workflow, /entry\.compress_type not in \(zipfile\.ZIP_STORED, zipfile\.ZIP_DEFLATED\)/);
  assert.match(workflow, /os\.O_EXCL/);
  assert.match(workflow, /os\.O_NOFOLLOW/);
  assert.doesNotMatch(workflow, /extractall|\.extract\(/);
});

test("GitHub SLSA verification is exact and keeps public-good enabled", () => {
  assert.match(workflow, /gh attestation verify "\$BACKUP_ATTESTATION_PATH"/);
  assert.match(workflow, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /--signer-workflow "github\.com\/\$GITHUB_REPOSITORY\/\$BACKUP_WORKFLOW_PATH"/);
  assert.match(workflow, /--source-digest "\$TARGET_SHA"/);
  assert.match(workflow, /--source-ref "refs\/heads\/main"/);
  assert.match(workflow, /--predicate-type "https:\/\/slsa\.dev\/provenance\/v1"/);
  assert.match(workflow, /--deny-self-hosted-runners/);
  assert.doesNotMatch(workflow, /--no-public-good/);
  assert.match(workflow, /results\.length !== 1/);
  assert.match(workflow, /subject\?\.name === "production-backup-attestation\.json"/);
  assert.match(workflow, /subject\?\.digest\?\.sha256 === expectedSha/);
});

test("shared validation recursively binds backup run, canonical artifact, and primary artifact", () => {
  assert.match(workflow, /production-release-attestation\.mjs validate[\s\S]*?--kind backup/);
  for (const argument of [
    "--expected-repository \"$GITHUB_REPOSITORY\"",
    "--expected-target-sha \"$TARGET_SHA\"",
    "--expected-run-id \"$BACKUP_RUN_ID\"",
    "--expected-run-attempt \"$BACKUP_RUN_ATTEMPT\"",
    "--expected-backup-run-id \"$BACKUP_RUN_ID\"",
    "--minimum-remaining-seconds 5700",
    "--expected-artifact-id \"$primary_artifact_id\"",
    "--expected-artifact-digest \"$primary_artifact_digest\"",
    "--expected-backup-artifact-id \"$primary_artifact_id\"",
    "--expected-backup-artifact-digest \"$primary_artifact_digest\"",
  ]) {
    assert.ok(workflow.includes(argument), `missing shared validation binding: ${argument}`);
  }
  assert.match(workflow, /test "\$primary_artifact_id" = "\$INVENTORY_PRIMARY_ARTIFACT_ID"/);
  assert.match(workflow, /test "\$primary_artifact_digest" = "\$INVENTORY_PRIMARY_ARTIFACT_DIGEST"/);
  assert.match(workflow, /primary\?\.id !== Number\(embedded\.id\)/);
  assert.match(workflow, /primary\.digest !== embedded\.digest/);
  assert.match(workflow, /normalizeTimestamp\(primary\.created_at\) !== embedded\.createdAt/);
  assert.match(workflow, /normalizeTimestamp\(primary\.expires_at\) !== embedded\.expiresAt/);
});

test("SSH trust and exact remote source are pinned without live-tree execution", () => {
  assert.match(workflow, /SSH_KNOWN_HOSTS: \$\{\{ secrets\.SSH_KNOWN_HOSTS \}\}/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /UserKnownHostsFile="\$HOME\/\.ssh\/known_hosts"/);
  assert.match(workflow, /ConnectionAttempts=1/);
  assert.doesNotMatch(workflow, /ssh-keyscan|accept-new|StrictHostKeyChecking=no/);
  assert.match(workflow, /git -C "\$repository_dir" worktree add --detach/);
  assert.match(workflow, /git -C "\$FAOLLA_READINESS_WORKTREE" rev-parse HEAD/);
  assert.match(workflow, /git -C "\$FAOLLA_READINESS_WORKTREE" symbolic-ref -q HEAD/);
  assert.match(workflow, /status --porcelain=v1 --untracked-files=all/);
  assert.match(workflow, /cd "\$FAOLLA_READINESS_WORKTREE"/);
  assert.match(workflow, /node --env-file="\$repository_dir\/\.env\.local"[\s\S]*?scripts\/check-ordinary-account-cutover-readiness\.mjs/);
  assert.doesNotMatch(workflow, /node[^\n]*"?\$APP_DIR[^\n]*scripts\//);
  assert.doesNotMatch(workflow, /cd "\$APP_DIR"/);
});

test("remote worktree guards accept attempt one and reject unsafe paths", () => {
  const guard =
    '[[ "$FAOLLA_READINESS_WORKTREE" =~ ^/tmp/faolla-ordinary-readiness-[1-9][0-9]*-[1-9][0-9]*$ ]]';
  assert.equal(workflow.split(guard).length - 1, 2);

  const bash = resolveBash();
  for (const [candidate, accepted] of [
    ["/tmp/faolla-ordinary-readiness-32383310388-1", true],
    ["/tmp/faolla-ordinary-readiness-1-10", true],
    ["/tmp/faolla-ordinary-readiness-0-1", false],
    ["/tmp/faolla-ordinary-readiness-1-01", false],
    ["/tmp/faolla-ordinary-readiness-1-1-extra", false],
    ["/tmp/faolla-ordinary-readiness-1-a", false],
  ]) {
    const result = spawnSync(
      bash,
      ["-c", `set -euo pipefail\n${guard}`, "readiness-guard", candidate],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          FAOLLA_READINESS_WORKTREE: candidate,
        },
      },
    );
    assert.equal(
      result.status === 0,
      accepted,
      `${candidate}: ${result.stderr}`,
    );
  }
});

test("backup database identity, all baselines, and container stability gate the checker", () => {
  assert.match(workflow, /database\?\.containerName/);
  assert.match(workflow, /database\.containerId/);
  assert.match(workflow, /database\.dbName/);
  assert.match(workflow, /database\.systemId/);
  assert.match(workflow, /baseline\?\.merchantRecordCount/);
  assert.match(workflow, /baseline\?\.personalCanonicalBindingCount/);
  assert.match(workflow, /baseline\?\.ordinaryIdentityContentSha256/);
  for (const variable of [
    "FAOLLA_EXPECTED_DATABASE_NAME",
    "FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER",
    "FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT",
    "FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT",
    "FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256",
  ]) {
    assert.match(workflow, new RegExp(`${variable}=`));
  }
  assert.match(workflow, /container_id_before="\$\(docker inspect/);
  assert.match(workflow, /test "\$container_id_before" = "\$FAOLLA_EXPECTED_CONTAINER_ID"/);
  assert.match(workflow, /test "\$container_id_after" = "\$container_id_before"/);
  assert.match(workflow, /test "\$container_id_after" = "\$FAOLLA_EXPECTED_CONTAINER_ID"/);
  assert.match(workflow, /--json --fail-on-blocked/);
});

test("readiness report and remote proof are aggregate-only canonical JSON", () => {
  assert.match(workflow, /FAOLLA_ORDINARY_READINESS_FRAME_V1/);
  assert.match(workflow, /lines\.length !== 4/);
  assert.match(workflow, /const expectedReportKeys = \[/);
  assert.match(workflow, /const expectedRemoteKeys = \[/);
  assert.match(workflow, /canonicalJsonBytes\(report\)/);
  assert.match(workflow, /canonicalJsonBytes\(remoteSource\)/);
  assert.match(workflow, /cleanBefore: true/);
  assert.match(workflow, /cleanAfter: true/);
  assert.match(workflow, /detached: true/);
  assert.doesNotMatch(
    workflow,
    /auth_user_id|personal_account_id|owner_email|customer_email|merchant_email/i,
  );
});

test("builder and readiness validator bind every upstream ID, digest, TTL, and source proof", () => {
  assert.match(workflow, /create-database-readiness-attestation\.mjs create/);
  for (const argument of [
    "--backup-attestation \"$BACKUP_ATTESTATION_PATH\"",
    "--backup-attestation-artifact \"$BACKUP_ATTESTATION_ARTIFACT_METADATA_PATH\"",
    "--checker-report \"$READINESS_REPORT_PATH\"",
    "--readiness-artifact \"$READINESS_ARTIFACT_METADATA_PATH\"",
    "--run \"$READINESS_RUN_METADATA_PATH\"",
    "--remote-source \"$READINESS_REMOTE_SOURCE_PATH\"",
    "--container-id \"$EXPECTED_CONTAINER_ID\"",
    "--output \"$READINESS_ATTESTATION_PATH\"",
    "--expected-backup-artifact-id \"$BACKUP_PRIMARY_ARTIFACT_ID\"",
    "--expected-backup-artifact-digest \"$BACKUP_PRIMARY_ARTIFACT_DIGEST\"",
    "--expected-backup-attestation-artifact-id \"$BACKUP_ATTESTATION_ARTIFACT_ID\"",
    "--expected-backup-attestation-artifact-digest \"$BACKUP_ATTESTATION_ARTIFACT_DIGEST\"",
    "--expected-readiness-artifact-id \"$READINESS_REPORT_ARTIFACT_ID\"",
    "--expected-readiness-artifact-digest \"$READINESS_REPORT_ARTIFACT_DIGEST\"",
    "--minimum-remaining-seconds 5100",
  ]) {
    assert.ok(workflow.includes(argument), `missing readiness binding: ${argument}`);
  }
  assert.match(workflow, /120 \* 60 \* 1000/);
  assert.doesNotMatch(workflow, /90 \* 60 \* 1000/);
  assert.match(workflow, /validUntil > backupValidUntil/);
  assert.match(workflow, /new Date\(timestamp\)\.toISOString\(\)/);
});

test("success publishes exactly the two canonical readiness artifacts and native attestations", () => {
  const uploadActions = workflow.match(/uses: actions\/upload-artifact@v4/g) ?? [];
  assert.equal(uploadActions.length, 2);
  assert.match(workflow, /name: faolla-production-readiness-report-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]*?path: \$\{\{ env\.READINESS_REPORT_PATH \}\}/);
  assert.match(workflow, /name: faolla-production-readiness-attestation-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]*?path: \$\{\{ env\.READINESS_ATTESTATION_PATH \}\}/);
  assert.match(workflow, /READINESS_REPORT_PATH: production-readiness-report\.json/);
  assert.match(workflow, /READINESS_ATTESTATION_PATH: production-readiness-attestation\.json/);
  const attestActions = workflow.match(/uses: actions\/attest@v4/g) ?? [];
  assert.equal(attestActions.length, 2);
  assert.match(workflow, /subject-path: \$\{\{ env\.READINESS_REPORT_PATH \}\}/);
  assert.match(workflow, /subject-path: \$\{\{ env\.READINESS_ATTESTATION_PATH \}\}/);
  assert.match(workflow, /artifacts\.length !== 2/);
  assert.match(workflow, /page\.total_count !== 2/);
  assert.doesNotMatch(workflow, /if:\s*failure\(\)[\s\S]{0,300}upload-artifact/);
  assert.doesNotMatch(workflow, /diagnostic[^\n]*artifact/i);
});

test("readiness artifact REST checks fail on identity, digest, expiry, and run mismatch", () => {
  assert.match(workflow, /artifact\?\.id !== Number\(process\.env\.ACTION_ARTIFACT_ID\)/);
  assert.match(workflow, /artifact\.name !== expectedName/);
  assert.match(workflow, /artifact\.digest !== `sha256:\$\{process\.env\.ACTION_ARTIFACT_DIGEST\}`/);
  assert.match(workflow, /artifact\.size_in_bytes <= 0/);
  assert.match(workflow, /artifact\.expired !== false/);
  assert.match(workflow, /artifact\.workflow_run\?\.id !== Number\(process\.env\.GITHUB_RUN_ID\)/);
  assert.match(workflow, /artifact\.workflow_run\?\.head_sha !== process\.env\.TARGET_SHA/);
  assert.match(workflow, /Date\.parse\(expiresAt\) - Date\.now\(\) < 5_700_000/);
  assert.match(workflow, /const artifactIds = new Set\(\)/);
  assert.match(workflow, /artifactIds\.has\(artifact\.id\)/);
});

test("remote exact worktree is always removed without a broad recursive delete", () => {
  assert.match(workflow, /- name: Remove Remote Exact Readiness Source\r?\n        if: always\(\)/);
  assert.match(workflow, /git -C "\$repository_dir" worktree remove --force "\$FAOLLA_READINESS_WORKTREE"/);
  assert.match(workflow, /test ! -e "\$FAOLLA_READINESS_WORKTREE"/);
  assert.doesNotMatch(workflow, /rm\s+-rf|rm\s+-fr/);
});

test("workflow has no public-live probe, arbitrary SQL, or dynamic evaluation surface", () => {
  assert.doesNotMatch(workflow, /inputs\.(?:sql|query|function|container|host|url)/i);
  assert.doesNotMatch(workflow, /\bpsql\b|docker\s+exec|\.sql\b/i);
  assert.doesNotMatch(workflow, /\beval\b/);
  assert.doesNotMatch(workflow, /\bcurl\b|\bwget\b|verify public|smoke test|healthz/i);
  assert.doesNotMatch(workflow, /APP_URL|PUBLIC_URL|NEXT_PUBLIC_APP_URL/);
});
