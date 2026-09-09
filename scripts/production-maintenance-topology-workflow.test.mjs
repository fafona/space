import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/production-maintenance-topology.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";

function block(name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1);
  const run = lines.findIndex((line, index) => index > start && line === "        run: |");
  assert.ok(run > start);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (!line) { body.push(""); continue; }
    if (!line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return `${body.join("\n")}\n`;
}

test("manual topology workflow cannot enable maintenance or trigger deployment", () => {
  assert.match(workflow, /^name: Production Maintenance Topology$/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  (push|schedule|workflow_run):/m);
  assert.match(workflow, /group: production-deploy/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /(?:actions|contents|id-token|attestations): write/);
  assert.doesNotMatch(deploy, /Production Maintenance Topology/);
  assert.match(deploy, /- Ordinary Account Cutover Readiness/);
  assert.match(workflow, /maintenance is NOT enabled/);
});

test("remote inspection comes only from clean exact current-main source with push CI", () => {
  const preflight = block("Require Current Main And Successful Push CI");
  assert.match(workflow, /persist-credentials: false/);
  assert.match(preflight, /git rev-parse HEAD/);
  assert.match(preflight, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(preflight, /commits\/main/);
  for (const condition of [
    '.name == "CI"', '.path == ".github/workflows/ci.yml"',
    '.event == "push"', '.head_branch == "main"', '.head_sha == $sha',
    '.status == "completed"', '.conclusion == "success"',
    '.repository.full_name == $repository', '.head_repository.full_name == $repository',
  ]) assert.ok(preflight.includes(condition), condition);
  assert.match(block("Inspect Runtime Configuration"), /commits\/main/);
});

test("SSH trust is pre-pinned with no unknown-host fallback or escalation", () => {
  assert.match(workflow, /secrets\.SSH_KNOWN_HOSTS/);
  assert.match(workflow, /ssh-keygen -F/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /UserKnownHostsFile=/);
  assert.match(workflow, /BatchMode=yes/);
  assert.match(workflow, /IdentitiesOnly=yes/);
  assert.doesNotMatch(workflow, /ssh-keyscan|accept-new|StrictHostKeyChecking=no|\bsudo\b/);
});

test("diagnostic is streamed over stdin, no production checkout/env or process mutation", () => {
  const body = block("Inspect Runtime Configuration");
  assert.match(body, /node --input-type=module - %q %q %q %q/);
  assert.match(body, /< scripts\/check-production-maintenance-topology\.mjs/);
  assert.match(body, /NODE_OPTIONS='' NODE_PATH=''/);
  assert.doesNotMatch(body, /git (?:fetch|checkout|reset|worktree)|\bscp\b|\.env|\bpm2\b|\bdocker\b|nginx|maintenance_window_confirmed/);
});

test("raw remote stdout/stderr stay hidden until strict local build-bound validation", () => {
  const body = block("Inspect Runtime Configuration");
  assert.match(body, /ulimit -f 64/);
  assert.match(body, /timeout --signal=TERM --kill-after=5s 180s/);
  assert.match(body, /> "\$stdout_file" 2> "\$stderr_file"/);
  assert.match(body, /\[ "\$remote_status" -ne 0 \] \|\| \[ -s "\$stderr_file" \]/);
  assert.match(body, /--validate-report "\$stdout_file" "\$EXPECTED_LIVE_APP_SHA"/);
  assert.doesNotMatch(body, /\bcat\b|\btee\b|upload-artifact|set -x/);
  assert.ok(body.indexOf("--validate-report") > body.indexOf("maintenance_topology_remote_capture_failed"));
});

test("only explicit temporary files and runner SSH material are removed", () => {
  const body = block("Inspect Runtime Configuration");
  assert.match(body, /mktemp -d "\$RUNNER_TEMP\/faolla-topology\.XXXXXXXX"/);
  assert.match(body, /rm -f -- "\$stdout_file" "\$stderr_file"/);
  assert.match(body, /rmdir -- "\$capture_dir"/);
  assert.doesNotMatch(workflow, /rm -[a-z]*r|rm -rf|rm -fr/);
  assert.match(workflow, /if: always\(\)/);
});

test("diagnostic tests are wired into CI", () => {
  assert.match(ci, /node --test scripts\/check-production-maintenance-topology\.test\.mjs scripts\/production-maintenance-topology-workflow\.test\.mjs/);
});

test("every embedded shell block parses", { skip: !existsSync(bash) }, () => {
  for (const name of [
    "Validate Manual Read-only Request", "Require Current Main And Successful Push CI",
    "Setup Pinned SSH Trust", "Inspect Runtime Configuration", "Remove Runner SSH Material",
  ]) {
    const result = spawnSync(bash, ["-n"], { input: block(name), encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("manual authorization rejects wrong ref, repository, retry, SHA and confirmation", { skip: !existsSync(bash) }, () => {
  const valid = {
    ...process.env,
    GITHUB_REPOSITORY: "fafona/space", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_RUN_ATTEMPT: "1",
    TARGET_SHA: "a".repeat(40), GITHUB_SHA: "a".repeat(40),
    EXPECTED_LIVE_APP_SHA: "b".repeat(40),
    CONFIRMATION: "CHECK_PRODUCTION_MAINTENANCE_TOPOLOGY",
  };
  for (const [change, expected] of [
    [{}, 0], [{ GITHUB_REPOSITORY: "other/space" }, 1],
    [{ GITHUB_EVENT_NAME: "push" }, 1], [{ GITHUB_REF: "refs/heads/feature" }, 1],
    [{ GITHUB_RUN_ATTEMPT: "2" }, 1], [{ TARGET_SHA: "c".repeat(40) }, 1],
    [{ EXPECTED_LIVE_APP_SHA: "../bad" }, 1], [{ CONFIRMATION: "" }, 1],
  ]) {
    const result = spawnSync(bash, ["-s"], {
      input: block("Validate Manual Read-only Request"), env: { ...valid, ...change },
      encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, JSON.stringify(change));
  }
});
