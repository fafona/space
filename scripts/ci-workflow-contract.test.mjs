import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalTestBatches, discoverLocalTests } from "./run-local-tests.mjs";
import { partitionCiTests } from "./run-ci-tests.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const lockfile = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);

function jobBlock(jobName) {
  const marker = `  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing ${jobName} job`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/\n  [a-zA-Z0-9_-]+:\n/);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

function assertSharedEnvironment(job) {
  assert.match(job, /FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:\s*true/);
  assert.match(job, /NEXT_PUBLIC_SUPABASE_URL:\s*https:\/\/example\.supabase\.co/);
  assert.match(job, /NEXT_PUBLIC_SUPABASE_ANON_KEY:\s*dummy-anon-key/);
}

function stepBlock(job, name) {
  const marker = `      - name: ${name}\n`;
  const start = job.indexOf(marker);
  assert.ok(start >= 0, `missing mandatory step ${name}`);
  const rest = job.slice(start);
  const next = rest.indexOf("\n      - name:", marker.length);
  return (next < 0 ? rest : rest.slice(0, next)).trimEnd() + "\n";
}

test("Quality preserves its required name and rejects every non-success partition result", () => {
  const quality = jobBlock("quality");
  assert.match(quality, /name: Quality\n/);
  assert.match(quality, /needs: \[quality-core, maintenance-contracts\]/);
  assert.match(quality, /if: \$\{\{ always\(\) \}\}/);
  assert.match(quality, /timeout-minutes: 3\n/);
  assert.match(quality, /shell: bash\n/);
  assert.match(quality, /CORE_RESULT: \$\{\{ needs\['quality-core'\]\.result \}\}/);
  assert.match(quality, /MAINTENANCE_RESULT: \$\{\{ needs\['maintenance-contracts'\]\.result \}\}/);
  assert.equal((quality.match(/- name:/g) || []).length, 1);
  assert.doesNotMatch(quality, /continue-on-error|uses:|secrets\.|checkout|download-artifact|\|\|\s*true/);
  const script = quality.split("        run: |\n")[1]?.trimEnd().split("\n")
    .map((line) => line.replace(/^          /, "")).join("\n");
  assert.equal(script, 'set -euo pipefail\ntest "$CORE_RESULT" = success\ntest "$MAINTENANCE_RESULT" = success');
});

const gateBash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
test("actual Quality shell fails on failed, cancelled, skipped, missing or malformed results", {
  skip: process.platform === "win32" && !existsSync(gateBash),
}, () => {
  const script = jobBlock("quality").split("        run: |\n")[1].trimEnd().split("\n")
    .map((line) => line.replace(/^          /, "")).join("\n");
  const outcomes = ["success", "failure", "cancelled", "skipped", "", undefined, "neutral", "timed_out", "success\n"];
  for (const core of outcomes) for (const maintenance of outcomes) {
    const result = spawnSync(gateBash, ["--noprofile", "--norc", "-c", script], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        ...(core === undefined ? {} : { CORE_RESULT: core }),
        ...(maintenance === undefined ? {} : { MAINTENANCE_RESULT: maintenance }) },
      encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status === 0, core === "success" && maintenance === "success",
      JSON.stringify({ core, maintenance, stderr: result.stderr }));
  }
});

test("production-build authentication acceptance runs after build in Linux CI", () => {
  const quality = jobBlock("quality-core");
  assert.ok(quality.indexOf("name: Authentication Build And HTTP Acceptance") > quality.indexOf("name: Build"));
  assert.match(quality, /run: node scripts\/check-auth-middleware-build\.mjs && node scripts\/check-auth-middleware-http\.mjs/);
  assert.doesNotMatch(quality, /continue-on-error/);
});

test("CI keeps quality checks independent from browser system packages", () => {
  const quality = jobBlock("quality-core");

  assert.match(quality, /name:\s*Code, Tests and Build/);
  assert.match(quality, /runs-on:\s*ubuntu-latest/);
  assert.match(quality, /timeout-minutes:\s*45\b/);
  assertSharedEnvironment(quality);
  assert.match(quality, /node --test scripts\/ci-workflow-contract\.test\.mjs/);
  assert.match(quality, /actions\/checkout@v5/);
  assert.match(quality, /actions\/setup-node@v5/);
  assert.match(quality, /run:\s*npm ci/);
  assert.match(quality, /run:\s*npm run check:encoding:strict/);
  assert.match(quality, /run:\s*npm run lint -- --quiet/);
  assert.doesNotMatch(quality, /continue-on-error|\bneeds:|\bif:/);
  assert.match(quality, /run: node scripts\/run-ci-tests\.mjs remaining && npm run check:db-migrations/);
  assert.doesNotMatch(quality, /run:\s*npm test/);
  assert.match(quality, /run:\s*npm run build/);
  assert.doesNotMatch(quality, /playwright install|test:enterprise-browser|apt-get/);
});

test("real PM2 acceptance follows the unchanged serial proofs in an independent mandatory runner", () => {
  const quality = jobBlock("maintenance-contracts");
  assertSharedEnvironment(quality);
  assert.match(quality, /runs-on: ubuntu-latest/);
  assert.match(quality, /timeout-minutes: 45/);
  assert.match(quality, /actions\/checkout@v5/);
  assert.match(quality, /actions\/setup-node@v5/);
  assert.match(quality, /node-version: 20/);
  assert.match(quality, /run: npm ci/);
  assert.doesNotMatch(quality, /\bneeds:|continue-on-error|\bif:|secrets\.|services:|self-hosted/);
  const startupAt = quality.indexOf("name: Isolated Real Next Startup Attribution Acceptance");
  const topologyAt = quality.indexOf("name: Maintenance Topology Diagnostic Tests");
  const contractAt = quality.indexOf("name: Maintenance Control and Pages ACL Contract Tests");
  const acceptanceAt = quality.indexOf("name: Isolated PM2 6.0.14 Maintenance Transport Acceptance");
  assert.ok(startupAt >= 0 && topologyAt > startupAt && contractAt > topologyAt && acceptanceAt > contractAt);
  const step = stepBlock(quality, "Isolated PM2 6.0.14 Maintenance Transport Acceptance");
  assert.match(step, /timeout-minutes:\s*7/);
  assert.match(step, /FAOLLA_PM2_REAL_ACCEPTANCE:\s*"1"/);
  assert.match(step, /run:\s*node scripts\/production-maintenance-pm2-acceptance\.mjs/);
  assert.doesNotMatch(step, /continue-on-error|\bif:|secrets\.|PM2_HOME:|SUPABASE_SERVICE_ROLE_KEY|\.env\.local/);
  const jobs = [...workflow.slice(workflow.indexOf("jobs:\n")).matchAll(/^  ([a-z0-9-]+):$/gm)].map((match) => match[1]);
  assert.deepEqual(jobs, ["quality", "maintenance-contracts", "quality-core", "browser", "qr-database", "transaction-database", "redemption-database",
    "checkout-database", "pages-acl-database", "recovery-database", "maintenance-ingress", "maintenance-supabase-scheduler"]);
});

test("moving maintenance to its own runner preserves all four reviewed step bodies byte for byte", () => {
  // Captured from deployed main 0004c202, LF normalized and trailing whitespace removed.
  // Do not rebase these hashes to accommodate a changed command or isolation guard.
  const before = {
    "Isolated Real Next Startup Attribution Acceptance": "fff1633bf28f875d47087dd714e2813bbe5e0c554f0e1ba7ff37b7e74abc15b6",
    "Maintenance Topology Diagnostic Tests": "7c313de719b37c3e393800e0244e65faedab65c087ba711267c617bd94d450cc",
    "Maintenance Control and Pages ACL Contract Tests": "72c9ca3514c9b7f89da9d5d27abc9164d7c53572705c9795783464c467288616",
    "Isolated PM2 6.0.14 Maintenance Transport Acceptance": "ae818e6ead972d70a6433f1304bdab3a75394c643c6c441671375fa62325ca33",
  };
  for (const [name, expected] of Object.entries(before)) {
    assert.equal(createHash("sha256").update(stepBlock(jobBlock("maintenance-contracts"), name)).digest("hex"), expected, name);
    assert.equal(workflow.split(`- name: ${name}\n`).length - 1, 1, `duplicated ${name}`);
    assert.equal(jobBlock("quality-core").includes(`name: ${name}`), false);
  }
});

test("independent jobs have no artifact dependency, optional condition or failure suppression", () => {
  for (const name of ["quality-core", "maintenance-contracts", "browser", "qr-database", "transaction-database",
    "redemption-database", "checkout-database", "pages-acl-database", "recovery-database", "maintenance-ingress",
    "maintenance-supabase-scheduler"]) {
    assert.doesNotMatch(jobBlock(name), /\bneeds:|\bif:|continue-on-error|download-artifact|self-hosted/, name);
  }
  assert.doesNotMatch(workflow, /cancel-in-progress|fail-fast|test-skip-pattern|test-name-pattern/);
});

test("real Supabase scheduler acceptance is a required independent job without weakening the previous nine", () => {
  const job = jobBlock("maintenance-supabase-scheduler");
  assert.match(job, /name:\s*Isolated Supabase Scheduler Acceptance/);
  assert.match(job, /runs-on:\s*ubuntu-24\.04/);
  assert.match(job, /timeout-minutes:\s*12/);
  assert.match(job, /FAOLLA_SUPABASE_SCHEDULER_ACCEPTANCE:\s*"1"/);
  assert.match(job, /persist-credentials:\s*false/);
  assert.match(job, /node-version:\s*20/);
  assert.match(job, /node --test scripts\/maintenance-supabase-scheduler-profile\.test\.mjs scripts\/maintenance-supabase-scheduler-acceptance\.test\.mjs/);
  assert.match(job, /run: node scripts\/maintenance-supabase-scheduler-acceptance\.mjs/);
  assert.doesNotMatch(job, /\bneeds:|continue-on-error|\bif:|secrets\.|services:|ports:|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|\.env\.local/);
  assert.equal(discoverLocalTests(fileURLToPath(new URL("../", import.meta.url))).includes("scripts/maintenance-supabase-scheduler-acceptance.mjs"), false);
});

test("CI runs native filesystem proofs once, serially, and full local testing retains exclusive coverage", () => {
  const quality = jobBlock("maintenance-contracts");
  const start = quality.indexOf("name: Maintenance Control and Pages ACL Contract Tests");
  const end = quality.indexOf("name: Isolated PM2 6.0.14 Maintenance Transport Acceptance");
  assert.ok(start >= 0 && end > start);
  const step = quality.slice(start, end);
  assert.match(step, /run: node --test --test-concurrency=1 scripts\/production-maintenance-\*\.test\.mjs scripts\/maintenance-control-probe-headers\.test\.mjs scripts\/pages-client-write-acl-migration-contract\.test\.mjs scripts\/pages-acl-integration\/run\.test\.mjs/);
  assert.doesNotMatch(step, /continue-on-error|\bif:|--test-skip-pattern|\|\|\s*true/);
  const native = "scripts/production-maintenance-native-proof.test.mjs";
  const files = discoverLocalTests(fileURLToPath(new URL("../", import.meta.url)));
  assert.equal(files.filter((file) => file === native).length, 1);
  const batches = createLocalTestBatches(files, ["--test", "--test-concurrency=4"]);
  assert.deepEqual(batches.flat(), files);
  assert.deepEqual(batches.filter((batch) => batch.includes(native)), [[native]]);
  const groups = partitionCiTests(files);
  assert.ok(groups.maintenance.includes(native));
  assert.equal(groups.remaining.includes(native), false);
});

test("mandatory CI test commands cover the entire discovery exactly once with no skipped groups", () => {
  const quality = jobBlock("quality-core");
  const maintenance = jobBlock("maintenance-contracts");
  const scheduler = jobBlock("maintenance-supabase-scheduler");
  const files = discoverLocalTests(fileURLToPath(new URL("../", import.meta.url)));
  const groups = partitionCiTests(files);
  function stepRun(job, name) {
    const start = job.indexOf(`name: ${name}\n`);
    assert.ok(start >= 0, `missing mandatory step ${name}`);
    const rest = job.slice(start);
    const next = rest.indexOf("\n      - name:");
    const block = next < 0 ? rest : rest.slice(0, next);
    assert.doesNotMatch(block, /continue-on-error|\bif:|--test-skip-pattern|--test-name-pattern|\|\|\s*true/);
    return block.match(/\n\s*run: ([^\n]+)/)?.[1];
  }
  const explicit = [
    ["workflow", quality, "CI Workflow Contract"],
    ["topology", maintenance, "Maintenance Topology Diagnostic Tests"],
    ["maintenance", maintenance, "Maintenance Control and Pages ACL Contract Tests"],
    ["scheduler", scheduler, "Scheduler Acceptance Safety Contracts"],
  ];
  const executed = [];
  for (const [group, job, name] of explicit) {
    const command = stepRun(job, name);
    assert.ok(command?.startsWith("node --test "));
    if (group === "maintenance") assert.ok(command.includes("--test-concurrency=1"));
    const members = command.split(/\s+/).filter((part) => part.startsWith("scripts/")).flatMap((part) => {
      if (part === "scripts/production-maintenance-*.test.mjs") {
        return files.filter((file) => file.startsWith("scripts/production-maintenance-")
          && !file.slice("scripts/".length).includes("/") && file.endsWith(".test.mjs"));
      }
      assert.ok(!part.includes("*") && files.includes(part), `uncovered CI test: ${part}`);
      return [part];
    });
    assert.deepEqual(members.sort(), groups[group]);
    executed.push(...members);
  }
  assert.equal(stepRun(quality, "Tests"), "node scripts/run-ci-tests.mjs remaining && npm run check:db-migrations");
  executed.push(...groups.remaining);
  assert.equal(new Set(executed).size, executed.length);
  assert.deepEqual(executed.sort(), files);
  assert.doesNotMatch(quality, /run:\s*npm test|continue-on-error/);
});

test("real ingress acceptance is an opt-in isolated job and package installation cannot start nginx", () => {
  const job = jobBlock("maintenance-ingress");
  assert.doesNotMatch(job, /\bneeds:/);
  assert.match(job, /runs-on:\s*ubuntu-24\.04/);
  assert.match(job, /FAOLLA_INGRESS_REAL_ACCEPTANCE:\s*"1"/);
  assert.match(job, /test "\$GITHUB_ACTIONS" = true/);
  assert.match(job, /policy=\/usr\/sbin\/policy-rc\.d/);
  assert.match(job, /test ! -e "\$policy" && test ! -L "\$policy" \|\| exit 1/);
  assert.match(job, /exit 101/);
  assert.match(job, /trap cleanup_policy EXIT/);
  assert.ok(job.indexOf("trap cleanup_policy EXIT") < job.indexOf("apt-get install"));
  assert.match(job, /nftables iproute2 iptables ebtables curl openssl nginx kmod/);
  assert.match(job, /test "\$\{actual%% \*\}" = "\$2"; rm -- "\$1"/);
  assert.match(job, /run: node scripts\/production-maintenance-ingress-acceptance\.mjs/);
  assert.doesNotMatch(job, /continue-on-error|secrets\.|\.env\.local|services:|ports:|network host/);
  assert.equal(discoverLocalTests(fileURLToPath(new URL("../", import.meta.url))).includes("scripts/production-maintenance-ingress-acceptance.mjs"), false);
});

const ingressKernelGuard = 'case "$(uname -r)" in 6.*|7.0.0-1017-azure) ;; *) exit 1 ;; esac';

test("bridge module initialization is fixed and confined to the disposable Ubuntu ingress job", () => {
  const job = jobBlock("maintenance-ingress");
  assert.equal((workflow.match(/^\s*sudo -n \/usr\/sbin\/modprobe br_netfilter$/gm) ?? []).length, 1);
  assert.match(job, /test "\$RUNNER_OS" = Linux/);
  assert.match(job, /ubuntu:24\.04/);
  assert.ok(job.includes(ingressKernelGuard));
  assert.match(job, /sudo -n \/usr\/sbin\/modprobe br_netfilter/);
  assert.doesNotMatch(job, /modprobe[^\n]*\$|sysctl|\/proc\/sys\/net\/bridge/);
  assert.ok(job.indexOf("/usr/sbin/modprobe br_netfilter") < job.indexOf("run: node scripts/production-maintenance-ingress-acceptance.mjs"));
});

function ingressPreflightScript() {
  const step = stepBlock(jobBlock("maintenance-ingress"), "Initialize Bridge Netfilter Module on Disposable CI Host Only");
  return step.split("        run: |\n")[1].trimEnd().split("\n")
    .map((line) => line.replace(/^          /, "")).join("\n");
}

test("ingress compatibility trial preserves every guarded command except the explicitly enumerated CI kernel admission", () => {
  const script = ingressPreflightScript();
  const original = [
    "set -euo pipefail",
    'test "$GITHUB_ACTIONS" = true',
    'test "$RUNNER_OS" = Linux',
    'test "$(. /etc/os-release; printf \'%s:%s\' "$ID" "$VERSION_ID")" = ubuntu:24.04',
    ingressKernelGuard,
    "sudo -n /usr/sbin/modprobe br_netfilter",
  ];
  let position = -1;
  for (const command of original) {
    assert.equal(script.split("\n").filter((line) => line === command).length, 1, command);
    const next = script.indexOf(`\n${command}\n`);
    const actual = command === original[0] ? 0 : command === original.at(-1) ? script.lastIndexOf(command) : next + 1;
    assert.ok(actual > position, command);
    position = actual;
  }
  assert.match(script, /trap report_ingress_preflight_result EXIT/);
  assert.match(script, /local preflight_status=\$\?/);
  assert.match(script, /exit "\$preflight_status"/);
  assert.match(script, /printf 'ingress-preflight os=%s kernel=%s\\n'/);
  assert.match(script, /printf 'ingress-preflight failed: status=%s command=%s\\n'/);
  assert.doesNotMatch(script, /set -[a-z]*x|BASH_COMMAND|printenv|\benv\b|secrets\.|\|\|\s*true|set \+e|\/proc\//);
});

test("actual ingress diagnostic shell identifies each guard without leaking values or changing exit status", {
  skip: process.platform === "win32" && !existsSync(gateBash),
}, () => {
  // Stub only host observations and the privileged command. Never load a real
  // module or read credentials while exercising the exact workflow shell body.
  const fixture = `
function . {
  [ "$#" -eq 1 ] && [ "$1" = /etc/os-release ] || return 97
  ID="$FIXTURE_ID"
  VERSION_ID="$FIXTURE_VERSION"
}
function uname {
  [ "$#" -eq 1 ] && [ "$1" = -r ] || return 98
  printf '%s\\n' "$FIXTURE_KERNEL"
}
function sudo {
  [ "$*" = '-n /usr/sbin/modprobe br_netfilter' ] || return 99
  printf 'fixture-privileged-command-reached\\n' >&2
  return "$FIXTURE_MODULE_STATUS"
}
`;
  const cases = [
    { name: "valid host", status: 0, privileged: true },
    { name: "observed new CI kernel", kernel: "7.0.0-1017-azure", status: 0, privileged: true },
    { name: "non-CI", github: "SECRET_CI_VALUE", status: 1, command: 'test "$GITHUB_ACTIONS" = true' },
    { name: "non-Linux", runner: "SECRET_RUNNER_VALUE", status: 1, command: 'test "$RUNNER_OS" = Linux' },
    { name: "other OS", id: "debian", status: 1, command: 'test "$(. /etc/os-release; printf \'%s:%s\' "$ID" "$VERSION_ID")" = ubuntu:24.04' },
    { name: "other OS version", version: "22.04", status: 1, command: 'test "$(. /etc/os-release; printf \'%s:%s\' "$ID" "$VERSION_ID")" = ubuntu:24.04' },
    ...["7.0.0-fixture", "7.0.0-1018-azure", "7.0.1-1017-azure", "7.1.0-1017-azure", "8.0.0-1017-azure", "7.0.0-1017-azure-extra"].map((kernel) =>
      ({ name: `unapproved kernel ${kernel}`, kernel, status: 1, command: ingressKernelGuard })),
    { name: "failed module command", moduleStatus: "42", status: 42, privileged: true, command: "sudo -n /usr/sbin/modprobe br_netfilter" },
    { name: "failed module command on observed new CI kernel", kernel: "7.0.0-1017-azure", moduleStatus: "42", status: 42, privileged: true, command: "sudo -n /usr/sbin/modprobe br_netfilter" },
  ];
  for (const entry of cases) {
    const result = spawnSync(gateBash, ["--noprofile", "--norc", "-c", fixture + ingressPreflightScript()], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        GITHUB_ACTIONS: entry.github ?? "true", RUNNER_OS: entry.runner ?? "Linux",
        FIXTURE_ID: entry.id ?? "ubuntu", FIXTURE_VERSION: entry.version ?? "24.04",
        FIXTURE_KERNEL: entry.kernel ?? "6.17.0-fixture", FIXTURE_MODULE_STATUS: entry.moduleStatus ?? "0",
        PRIVATE_TOKEN: "SECRET_TOKEN_VALUE" },
      encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    assert.equal(result.error, undefined, entry.name);
    assert.equal(result.signal, null, entry.name);
    assert.equal(result.status, entry.status, `${entry.name}: ${result.stderr}`);
    assert.equal(result.stdout, `ingress-preflight os=${entry.id ?? "ubuntu"}:${entry.version ?? "24.04"} kernel=${entry.kernel ?? "6.17.0-fixture"}\n`, entry.name);
    const privileged = entry.privileged ? "fixture-privileged-command-reached\n" : "";
    assert.equal(result.stderr, privileged + (entry.command ? `ingress-preflight failed: status=${entry.status} command=${entry.command}\n` : ""), entry.name);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET_|PRIVATE_TOKEN/, entry.name);
  }
});

test("real PM2 acceptance refuses implicit or non-CI use before installing or creating a fixture", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const script = fileURLToPath(new URL("./production-maintenance-pm2-acceptance.mjs", import.meta.url));
  assert.equal(discoverLocalTests(root).includes("scripts/production-maintenance-pm2-acceptance.mjs"), false);
  for (const env of [{ GITHUB_ACTIONS: "true", FAOLLA_PM2_REAL_ACCEPTANCE: "" },
    { GITHUB_ACTIONS: "false", FAOLLA_PM2_REAL_ACCEPTANCE: "1" }]) {
    const result = spawnSync(process.execPath, [script], { cwd: root, env: { ...env, PATH: "" },
      encoding: "utf8", timeout: 5000, windowsHide: true, shell: false });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), { error: "pm2_acceptance_opt_in_required", stage: "guards" });
  }
});

test("real PM2 fixture pins its version, private home, exact daemon cleanup and no business server", () => {
  const source = readFileSync(new URL("./production-maintenance-pm2-acceptance.mjs", import.meta.url), "utf8");
  assert.match(source, /mkdtempSync\(join\(home, "\.faolla-pm2-"\)\)/);
  assert.match(source, /Buffer\.byteLength\(socketPath\) >= 107/);
  assert.match(source, /"pm2@6\.0\.14"/);
  assert.match(source, /"--ignore-scripts"/);
  assert.match(source, /"--userconfig", userConfig/);
  assert.match(source, /packageInfo\.version !== "6\.0\.14"/);
  assert.match(source, /process\.kill\(daemon\.pid, "SIGINT"\)/);
  assert.match(source, /if \(!daemon && bootstrapAttempted\) \{[\s\S]*?if \(!daemon\) fail\("pm2_acceptance_cleanup_unverified"\)/);
  assert.match(source, /metadata\.dev !== fixtureIdentity\.dev \|\| metadata\.ino !== fixtureIdentity\.ino/);
  assert.match(source, /cleanupVerified: clean/);
  assert.doesNotMatch(source, /\.\.\.process\.env|createServer\(|\.listen\(|pm2", "kill"|PM2_HOME: process\.env/);
});

test("browser journeys use the lockfile-matched official Playwright image", () => {
  const browser = jobBlock("browser");
  const lockedVersion = lockfile.packages?.["node_modules/playwright"]?.version;
  const imageVersion = browser.match(
    /image:\s*mcr\.microsoft\.com\/playwright:v([^\s-]+)-noble/,
  )?.[1];

  assert.equal(typeof lockedVersion, "string");
  assert.equal(imageVersion, lockedVersion);
  assert.match(browser, /name:\s*Enterprise Browser Journeys/);
  assert.doesNotMatch(browser, /\bneeds:|\bif:/);
  assert.match(browser, /runs-on:\s*ubuntu-latest/);
  assert.match(browser, /timeout-minutes:\s*[1-9][0-9]*/);
  assert.match(browser, /options:\s*--user 1001/);
  assertSharedEnvironment(browser);
  assert.match(browser, /actions\/checkout@v5/);
  assert.match(browser, /actions\/setup-node@v5/);
  assert.match(browser, /run:\s*npm ci/);
  assert.match(browser, /run:\s*npm run build/);
  assert.match(browser, /run:\s*npm run test:enterprise-browser/);
  assert.doesNotMatch(browser, /continue-on-error|playwright install|apt-get/);
  assert.doesNotMatch(workflow, /playwright install --with-deps/);
  // Only the dedicated isolated ingress job may install its networking tools;
  // browser and every pre-existing quality/database job keep their prohibition.
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("  maintenance-ingress:\n")), /apt-get/);
});

test("QR atomic acceptance is a required CI job against a fresh PostgreSQL service", () => {
  const qr = jobBlock("qr-database");
  assert.doesNotMatch(qr, /\bneeds:|\bif:/);
  assert.match(qr, /image:\s*postgres:15/);
  assert.match(qr, /POSTGRES_DB:\s*faolla_qr_test/);
  assert.match(qr, /POSTGRES_HOST_AUTH_METHOD:\s*trust/);
  assert.match(qr, /QR_TOKEN_INTEGRATION_ALLOW_DISPOSABLE_DATABASE:\s*"1"/);
  assert.match(qr, /QR_TOKEN_TEST_PORT:\s*"5432"/);
  assert.match(qr, /run:\s*node scripts\/qr-token-integration\/run\.mjs/);
  assert.doesNotMatch(qr, /continue-on-error|secrets\.|SUPABASE_SERVICE_ROLE_KEY|\.env\.local/);
});

test("order membership atomic acceptance uses an independent disposable PostgreSQL CI service", () => {
  const transaction = jobBlock("transaction-database");
  assert.doesNotMatch(transaction, /\bneeds:|\bif:|continue-on-error|\|\|\s*true/);
  assert.match(transaction, /image:\s*postgres:15/);
  assert.match(transaction, /POSTGRES_DB:\s*faolla_transaction_test/);
  assert.match(transaction, /POSTGRES_HOST_AUTH_METHOD:\s*trust/);
  assert.match(transaction, /TRANSACTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE:\s*"1"/);
  assert.match(transaction, /TRANSACTION_TEST_PORT:\s*"5432"/);
  assert.match(transaction, /node-version:\s*20/);
  assert.match(transaction, /run:\s*node scripts\/transaction-integration\/run\.mjs/);
  assert.doesNotMatch(transaction, /continue-on-error|secrets\.|SUPABASE_SERVICE_ROLE_KEY|\.env\.local|DATABASE_URL/);
});

test("transaction database acceptance is opt-in and excluded from automatic unit test execution", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  assert.equal(discoverLocalTests(root).includes("scripts/transaction-integration/run.mjs"), false);
  const env = { ...process.env, TRANSACTION_TEST_PSQL: "must-not-start-a-database-client" };
  delete env.TRANSACTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./transaction-integration/run.mjs", import.meta.url))], {
    cwd: root, env, encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set TRANSACTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn must-not-start/);
  assert.doesNotMatch(result.stdout, /\[transaction-postgres\]/);
});

test("order attention is an additional mandatory acceptance on the existing transaction service", () => {
  const transaction = jobBlock("transaction-database");
  const previous = transaction.indexOf("run: node scripts/transaction-integration/run.mjs");
  const bind = transaction.indexOf("run: node scripts/ci-postgres-service-identity.mjs");
  const current = transaction.indexOf("run: node scripts/order-attention-integration/run.mjs");
  assert.ok(previous >= 0 && bind > previous && current > bind);
  assert.match(transaction, /ORDER_ATTENTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE:\s*"1"/);
  assert.equal((transaction.match(/FAOLLA_CI_POSTGRES_SERVICE_CONTAINER_ID:\s*\$\{\{ job\.services\.postgres\.id \}\}/g) || []).length, 2);
  assert.match(transaction, /image:\s*postgres:15/);
  assert.match(transaction, /POSTGRES_DB:\s*faolla_transaction_test/);
  assert.doesNotMatch(transaction, /continue-on-error|\bif:|\|\|\s*true|secrets\.|DATABASE_URL|\.env\.local|FAOLLA_CI_POSTGRES_SERVER_IPV4:\s*\S/);
});

test("redemption atomic acceptance uses an independent disposable PostgreSQL CI service", () => {
  const redemption = jobBlock("redemption-database");
  assert.doesNotMatch(redemption, /\bneeds:|\bif:/);
  assert.match(redemption, /image:\s*postgres:15/);
  assert.match(redemption, /POSTGRES_DB:\s*faolla_redemption_test/);
  assert.match(redemption, /POSTGRES_HOST_AUTH_METHOD:\s*trust/);
  assert.match(redemption, /REDEMPTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE:\s*"1"/);
  assert.match(redemption, /REDEMPTION_TEST_PORT:\s*"5432"/);
  assert.match(redemption, /node-version:\s*20/);
  assert.match(redemption, /run:\s*node scripts\/redemption-integration\/run\.mjs/);
  assert.doesNotMatch(redemption, /continue-on-error|secrets\.|SUPABASE_SERVICE_ROLE_KEY|\.env\.local|DATABASE_URL/);
});

test("redemption database acceptance cannot run implicitly or without disposable-database opt-in", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  assert.equal(discoverLocalTests(root).includes("scripts/redemption-integration/run.mjs"), false);
  const env = { ...process.env, REDEMPTION_TEST_PSQL: "must-not-start-a-database-client" };
  delete env.REDEMPTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./redemption-integration/run.mjs", import.meta.url))], {
    cwd: root, env, encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set REDEMPTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn must-not-start/);
  assert.doesNotMatch(result.stdout, /\[redemption-postgres\]/);
});

test("checkout context acceptance has an independent fresh PostgreSQL CI service", () => {
  const checkout = jobBlock("checkout-database");
  assert.doesNotMatch(checkout, /\bneeds:|\bif:/);
  assert.match(checkout, /image:\s*postgres:15/);
  assert.match(checkout, /POSTGRES_DB:\s*faolla_checkout_test/);
  assert.match(checkout, /POSTGRES_HOST_AUTH_METHOD:\s*trust/);
  assert.match(checkout, /CHECKOUT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE:\s*"1"/);
  assert.match(checkout, /CHECKOUT_TEST_PORT:\s*"5432"/);
  assert.match(checkout, /node-version:\s*20/);
  assert.match(checkout, /persist-credentials:\s*false/);
  assert.match(checkout, /run:\s*node scripts\/checkout-integration\/run\.mjs/);
  assert.doesNotMatch(checkout, /continue-on-error|secrets\.|SUPABASE_SERVICE_ROLE_KEY|\.env\.local|DATABASE_URL/);
});

test("checkout database acceptance cannot run implicitly or without disposable-database opt-in", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  assert.equal(discoverLocalTests(root).includes("scripts/checkout-integration/run.mjs"), false);
  const env = { ...process.env, CHECKOUT_TEST_PSQL: "must-not-start-a-database-client" };
  delete env.CHECKOUT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./checkout-integration/run.mjs", import.meta.url))], {
    cwd: root, env, encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set CHECKOUT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn must-not-start/);
  assert.doesNotMatch(result.stdout, /\[checkout-postgres\]/);
});

test("checkout runner rejects another local integration port before starting a client", () => {
  const env = { ...process.env, CI: "false", CHECKOUT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE: "1",
    CHECKOUT_TEST_PORT: "56450", CHECKOUT_TEST_PSQL: "must-not-start-a-database-client" };
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./checkout-integration/run.mjs", import.meta.url))], {
    env, encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid_test_port/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn must-not-start/);
});

test("recovery acceptance uses isolated source and restore databases with explicit opt-in", () => {
  const recovery = jobBlock("recovery-database");
  assert.doesNotMatch(recovery, /\bneeds:|\bif:/);
  assert.match(recovery, /image:\s*postgres:15/);
  assert.match(recovery, /runs-on:\s*ubuntu-24\.04/);
  assert.match(recovery, /RECOVERY_TEST_PG_DUMP:\s*\/usr\/lib\/postgresql\/16\/bin\/pg_dump/);
  assert.match(recovery, /RECOVERY_TEST_PG_RESTORE:\s*\/usr\/lib\/postgresql\/16\/bin\/pg_restore/);
  assert.match(recovery, /POSTGRES_DB:\s*faolla_recovery_source_test/);
  assert.match(recovery, /createdb[^\n]+faolla_recovery_target_test/);
  assert.match(recovery, /RECOVERY_INTEGRATION_ALLOW_DISPOSABLE_DATABASE:\s*"1"/);
  assert.match(recovery, /RECOVERY_TEST_PORT:\s*"5432"/);
  assert.match(recovery, /persist-credentials:\s*false/);
  assert.match(recovery, /node scripts\/recovery-integration\/run\.mjs/);
  assert.doesNotMatch(recovery, /continue-on-error|secrets\.|DATABASE_URL|\.env\.local|SUPABASE_SERVICE_ROLE_KEY/);
});

test("recovery runner cannot start a client by default or against another test port", () => {
  assert.equal(discoverLocalTests(fileURLToPath(new URL("../", import.meta.url))).includes("scripts/recovery-integration/run.mjs"), false);
  for (const optedIn of [false, true]) {
    const env = { ...process.env, CI: "false", RECOVERY_TEST_PORT: "56451", RECOVERY_TEST_PSQL: "must-not-start-a-database-client" };
    delete env.RECOVERY_INTEGRATION_ALLOW_DISPOSABLE_DATABASE;
    if (optedIn) env.RECOVERY_INTEGRATION_ALLOW_DISPOSABLE_DATABASE = "1";
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./recovery-integration/run.mjs", import.meta.url))], {
      env, encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, optedIn ? /invalid_test_port/ : /disposable_database_opt_in_required/);
    assert.doesNotMatch(result.stderr, /ENOENT|spawn must-not-start/);
  }
});

test("pages ACL acceptance uses isolated PostgreSQL 15 with bound identity and no application credentials", () => {
  const acl = jobBlock("pages-acl-database");
  assert.doesNotMatch(acl, /\bneeds:|\bif:/);
  assert.match(acl, /image:\s*postgres:15/);
  assert.match(acl, /POSTGRES_DB:\s*faolla_pages_acl_test/);
  assert.match(acl, /PAGES_ACL_INTEGRATION_ALLOW_DISPOSABLE_DATABASE:\s*"1"/);
  assert.match(acl, /persist-credentials:\s*false/);
  assert.match(acl, /run:\s*node scripts\/pages-acl-integration\/run\.mjs/);
  assert.doesNotMatch(acl, /continue-on-error|secrets\.|DATABASE_URL|\.env\.local|SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(discoverLocalTests(fileURLToPath(new URL("../", import.meta.url))).includes("scripts/pages-acl-integration/run.mjs"), false);
});

test("container-network PostgreSQL jobs bind their exact trusted service identity before database acceptance", () => {
  for (const jobName of ["checkout-database", "recovery-database", "pages-acl-database"]) {
    const job = jobBlock(jobName);
    assert.equal((job.match(/FAOLLA_CI_POSTGRES_SERVICE_CONTAINER_ID:\s*\$\{\{ job\.services\.postgres\.id \}\}/g) || []).length, 2);
    const bindAt = job.indexOf("node scripts/ci-postgres-service-identity.mjs");
    const runAt = job.indexOf(`node scripts/${jobName.replace("-database", "")}-integration/run.mjs`);
    assert.ok(bindAt >= 0 && runAt > bindAt);
    assert.doesNotMatch(job, /FAOLLA_CI_POSTGRES_SERVER_IPV4:\s*\S|continue-on-error/);
  }
});
