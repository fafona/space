import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RUNTIME_SUPERVISION_CODES } from "./check-production-runtime-supervision.mjs";

const workflowUrl = new URL(
  "../.github/workflows/production-runtime-supervision-diagnostic.yml",
  import.meta.url,
);
const workflow = await readFile(workflowUrl, "utf8");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const codePrefix = "[runtime-supervision] ";
const unverifiedCode = "runtime_supervision_result_unverified";
const statusCodePairs = [
  [0, RUNTIME_SUPERVISION_CODES.direct],
  [0, RUNTIME_SUPERVISION_CODES.legacy],
  [20, RUNTIME_SUPERVISION_CODES.initReparented],
  [21, RUNTIME_SUPERVISION_CODES.listenerAbsent],
  [22, RUNTIME_SUPERVISION_CODES.mismatch],
  [23, RUNTIME_SUPERVISION_CODES.unreadable],
];

function extractRunBlock(stepName) {
  const lines = workflow.split(/\r?\n/);
  const stepIndex = lines.indexOf(`      - name: ${stepName}`);
  assert.notEqual(stepIndex, -1, `${stepName} step is missing`);
  const runIndex = lines.findIndex(
    (line, index) => index > stepIndex && line === "        run: |",
  );
  assert.notEqual(runIndex, -1, `${stepName} run block is missing`);
  const body = [];
  for (const line of lines.slice(runIndex + 1)) {
    if (line.startsWith("          ")) {
      body.push(line.slice(10));
      continue;
    }
    if (line === "") {
      body.push("");
      continue;
    }
    break;
  }
  assert.ok(body.length > 0, `${stepName} run block is empty`);
  return `${body.join("\n")}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fixedLine(code) {
  return `${codePrefix}${code}\n`;
}

const diagnosticRun = extractRunBlock("Check Runtime Supervision");

test("runtime supervision diagnostic is manual, exact-SHA bound, and read-only", () => {
  assert.match(workflow, /^name: Production Runtime Supervision Diagnostic$/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\b(?:push|schedule|workflow_run):/);
  assert.match(workflow, /\[ "\$GITHUB_REPOSITORY" = "fafona\/space" \]/);
  assert.match(workflow, /\[ "\$GITHUB_REF" = "refs\/heads\/main" \]/);
  assert.match(workflow, /\[ "\$GITHUB_RUN_ATTEMPT" = "1" \]/);
  assert.match(workflow, /\[ "\$EXPECTED_DIAGNOSTIC_SHA" = "\$GITHUB_SHA" \]/);
  assert.match(diagnosticRun, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(diagnosticRun, /\[ "\$remote_main" = "\$GITHUB_SHA" \]/);
  assert.match(workflow, /CHECK_PRODUCTION_RUNTIME_SUPERVISION/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git status --porcelain --untracked-files=all/);
  assert.match(diagnosticRun, /node --input-type=module -/);
  assert.match(diagnosticRun, /NODE_OPTIONS='' NODE_PATH=''/);
  assert.doesNotMatch(
    workflow,
    /(?:^|\n)\s*(?:pm2\s+(?:delete|stop|restart|start|save)\b|(?:kill|pkill|killall|fuser)\s|git\s+(?:reset|checkout|clean)\b)/,
  );
});

test("runtime supervision workflow validates an exact byte envelope before printing a fixed code", () => {
  assert.match(diagnosticRun, /\(\n\s+ulimit -f 8\n/);
  assert.match(diagnosticRun, /\) > "\$stdout_file" 2> "\$stderr_file"/);
  assert.match(
    diagnosticRun,
    /chmod 600 "\$stdout_file" "\$stderr_file" "\$expected_file"/,
  );
  assert.match(
    diagnosticRun,
    /if \[ -s "\$stderr_file" \]; then\n\s+echo "\[runtime-supervision\] runtime_supervision_result_unverified"\n\s+exit 1\n\s*fi/,
  );

  const statusCaseIndex = diagnosticRun.indexOf('case "$diagnostic_status" in');
  const expectedLinesIndex = diagnosticRun.indexOf("expected_lines=(");
  assert.ok(statusCaseIndex >= 0, "exit status must select the expected fixed line");
  assert.ok(
    expectedLinesIndex > statusCaseIndex,
    "fixed candidates must be selected only after the exit status is known",
  );

  const expectedFileMatch = diagnosticRun.match(
    /printf '%s\\n' "\$expected_line" > "\$([A-Za-z_][A-Za-z0-9_]*)"/,
  );
  assert.ok(expectedFileMatch, "the expected line must be materialized with one final LF");
  const expectedFile = escapeRegExp(expectedFileMatch[1]);
  assert.match(
    diagnosticRun,
    new RegExp(
      `cmp -s(?: --)? (?:"\\$stdout_file" "\\$${expectedFile}"|"\\$${expectedFile}" "\\$stdout_file")`,
    ),
  );
  assert.match(
    diagnosticRun,
    /if cmp -s -- "\$stdout_file" "\$expected_file"; then\n\s+matched_line="\$expected_line"/,
  );
  assert.match(diagnosticRun, /printf '%s\\n' "\$matched_line"\n/);
  assert.doesNotMatch(diagnosticRun, /printf '%s\\n' "\$diagnostic_line"/);
  assert.doesNotMatch(diagnosticRun, /\bmapfile\b/);
  assert.doesNotMatch(diagnosticRun, /\bcat\s+[^\n]*(?:stdout_file|stderr_file)/);
  assert.doesNotMatch(diagnosticRun, /\btee\b/);

  const exposedCodes = new Set(
    diagnosticRun.match(/runtime_supervision_[a-z0-9_]+/g) ?? [],
  );
  assert.deepEqual(
    exposedCodes,
    new Set([...Object.values(RUNTIME_SUPERVISION_CODES), unverifiedCode]),
  );
});

async function createLinuxHarness() {
  const root = await mkdtemp(join(tmpdir(), "faolla-runtime-supervision-workflow-"));
  const fakeBin = join(root, "bin");
  const home = join(root, "home");
  await Promise.all([
    mkdir(fakeBin),
    mkdir(join(home, ".ssh"), { recursive: true }),
  ]);

  const fakeGit = join(fakeBin, "git");
  const fakeSsh = join(fakeBin, "ssh");
  await Promise.all([
    writeFile(
      fakeGit,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf '%s\\0' \"$@\" > \"$FAKE_GIT_ARGV_FILE\"",
        "if [ \"$#\" -ne 4 ] || [ \"$1\" != 'ls-remote' ] || [ \"$2\" != '--exit-code' ] || [ \"$3\" != 'origin' ] || [ \"$4\" != 'refs/heads/main' ]; then",
        "  exit 97",
        "fi",
        "printf '%s\\trefs/heads/main\\n' \"$FAKE_GIT_SHA\"",
        "exit \"$FAKE_GIT_STATUS\"",
        "",
      ].join("\n"),
      { mode: 0o700 },
    ),
    writeFile(
      fakeSsh,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        ": > \"$FAKE_SSH_CALLED_FILE\"",
        "printf '%s\\n' \"$(ulimit -f)\" > \"$FAKE_SSH_ULIMIT_FILE\"",
        "command cat >/dev/null",
        "command cat -- \"$FAKE_SSH_STDOUT_FILE\"",
        "command cat -- \"$FAKE_SSH_STDERR_FILE\" >&2",
        "exit \"$FAKE_SSH_STATUS\"",
        "",
      ].join("\n"),
      { mode: 0o700 },
    ),
  ]);
  await Promise.all([chmod(fakeGit, 0o700), chmod(fakeSsh, 0o700)]);

  let scenarioIndex = 0;
  async function runScenario({ stdout, stderr = Buffer.alloc(0), status }) {
    scenarioIndex += 1;
    const scenario = join(root, `scenario-${scenarioIndex}`);
    const captures = join(scenario, "captures");
    await Promise.all([mkdir(scenario), mkdir(captures)]);
    const stdoutFixture = join(scenario, "ssh.stdout");
    const stderrFixture = join(scenario, "ssh.stderr");
    const ulimitFile = join(scenario, "ssh.ulimit");
    const sshCalledFile = join(scenario, "ssh.called");
    const gitArgvFile = join(scenario, "git.argv");
    await Promise.all([
      writeFile(stdoutFixture, stdout, { mode: 0o600 }),
      writeFile(stderrFixture, stderr, { mode: 0o600 }),
    ]);

    const sha = "a".repeat(40);
    const result = spawnSync("/bin/bash", ["-s"], {
      cwd: repositoryRoot,
      input: diagnosticRun,
      env: {
        ...process.env,
        APP_DIR: "/srv/merchant-space",
        APP_NAME: "merchant-space",
        APP_PORT: "3000",
        EXPECTED_RUNTIME_BUILD_ID: "b".repeat(40),
        FAKE_GIT_ARGV_FILE: gitArgvFile,
        FAKE_GIT_SHA: sha,
        FAKE_GIT_STATUS: "0",
        FAKE_SSH_CALLED_FILE: sshCalledFile,
        FAKE_SSH_STATUS: String(status),
        FAKE_SSH_STDERR_FILE: stderrFixture,
        FAKE_SSH_STDOUT_FILE: stdoutFixture,
        FAKE_SSH_ULIMIT_FILE: ulimitFile,
        GITHUB_SHA: sha,
        HOME: home,
        LC_ALL: "C",
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        SSH_HOST: "runtime-supervision.invalid",
        SSH_PORT: "2222",
        SSH_USER: "deploy",
        TMPDIR: captures,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.deepEqual(
      (await readFile(gitArgvFile)).toString("utf8").split("\0").filter(Boolean),
      ["ls-remote", "--exit-code", "origin", "refs/heads/main"],
    );
    assert.equal((await readFile(ulimitFile, "utf8")).trim(), "8");
    await readFile(sshCalledFile);
    assert.deepEqual(await readdir(captures), [], "capture files were not cleaned up");
    return result;
  }

  return { root, runScenario };
}

function assertPublicResult(result, status, code) {
  assert.equal(result.signal, null);
  assert.equal(result.status, status, result.stderr.toString("utf8"));
  assert.deepEqual(result.stdout, Buffer.from(fixedLine(code)));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
}

test(
  "Linux fake git/ssh matrix preserves every fixed code-to-status mapping",
  { skip: process.platform !== "linux" },
  async (t) => {
    const harness = await createLinuxHarness();
    try {
      const testedStatuses = [0, 1, 20, 21, 22, 23, 124, 255];
      for (const [expectedStatus, code] of statusCodePairs) {
        for (const actualStatus of testedStatuses) {
          const accepted = actualStatus === expectedStatus;
          await t.test(
            `${code} ${accepted ? "accepts" : "rejects"} exit ${actualStatus}`,
            async () => {
              const result = await harness.runScenario({
                stdout: Buffer.from(fixedLine(code)),
                status: actualStatus,
              });
              assertPublicResult(
                result,
                accepted ? actualStatus : 1,
                accepted ? code : unverifiedCode,
              );
            },
          );
        }
      }
    } finally {
      await rm(harness.root, { recursive: true, force: true });
    }
  },
);

test(
  "Linux fake ssh rejects non-canonical bytes without leaking remote output",
  { skip: process.platform !== "linux" },
  async (t) => {
    const harness = await createLinuxHarness();
    const directBytes = Buffer.from(fixedLine(RUNTIME_SUPERVISION_CODES.direct));
    const privateMarker = Buffer.from("private-customer@example.invalid");
    const cases = [
      {
        name: "missing final LF",
        stdout: directBytes.subarray(0, directBytes.length - 1),
        status: 0,
      },
      {
        name: "embedded NUL",
        stdout: Buffer.concat([
          directBytes.subarray(0, directBytes.length - 1),
          Buffer.from([0]),
          Buffer.from("\n"),
        ]),
        status: 0,
      },
      {
        name: "second stdout line",
        stdout: Buffer.concat([directBytes, privateMarker, Buffer.from("\n")]),
        status: 0,
      },
      {
        name: "non-empty stderr",
        stdout: directBytes,
        stderr: Buffer.concat([privateMarker, Buffer.from("\n")]),
        status: 0,
      },
      {
        name: "ssh transport failure with raw output",
        stdout: Buffer.concat([privateMarker, Buffer.from("\n")]),
        stderr: Buffer.concat([privateMarker, Buffer.from("-stderr\n")]),
        status: 255,
      },
      {
        name: "timeout-like exit with raw output",
        stdout: Buffer.concat([privateMarker, Buffer.from("-timeout\n")]),
        status: 124,
      },
      {
        name: "unknown stdout code",
        stdout: Buffer.from(
          `${codePrefix}runtime_supervision_${privateMarker.toString("utf8")}\n`,
        ),
        status: 0,
      },
      {
        name: "stdout beyond the public envelope",
        stdout: Buffer.alloc(1_000, 0x53),
        status: 0,
      },
      {
        name: "stdout beyond the inherited file-size limit",
        stdout: Buffer.concat(
          Array.from({ length: 2_048 }, () =>
            Buffer.from("private-ulimit-output\n"),
          ),
        ),
        status: 0,
      },
    ];
    try {
      for (const scenario of cases) {
        await t.test(scenario.name, async () => {
          const result = await harness.runScenario(scenario);
          assertPublicResult(result, 1, unverifiedCode);
          const publicBytes = Buffer.concat([result.stdout, result.stderr]);
          assert.equal(publicBytes.includes(privateMarker), false);
          assert.equal(publicBytes.includes(Buffer.from("private-ulimit-output")), false);
        });
      }
    } finally {
      await rm(harness.root, { recursive: true, force: true });
    }
  },
);
