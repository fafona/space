import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalTestBatches, discoverLocalTests } from "./run-local-tests.mjs";

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

test("CI keeps quality checks independent from browser system packages", () => {
  const quality = jobBlock("quality");

  assert.match(quality, /name:\s*Quality/);
  assert.match(quality, /runs-on:\s*ubuntu-latest/);
  assert.match(quality, /timeout-minutes:\s*[1-9][0-9]*/);
  assertSharedEnvironment(quality);
  assert.match(quality, /node --test scripts\/ci-workflow-contract\.test\.mjs/);
  assert.match(quality, /actions\/checkout@v5/);
  assert.match(quality, /actions\/setup-node@v5/);
  assert.match(quality, /run:\s*npm ci/);
  assert.match(quality, /run:\s*npm run check:encoding:strict/);
  assert.match(quality, /run:\s*npm run lint -- --quiet/);
  assert.doesNotMatch(quality, /continue-on-error/);
  assert.match(quality, /run:\s*npm test/);
  assert.match(quality, /run:\s*npm run build/);
  assert.doesNotMatch(quality, /playwright install|test:enterprise-browser|apt-get/);
});

test("real PM2 transport acceptance is mandatory inside Quality without adding or weakening approval jobs", () => {
  const quality = jobBlock("quality");
  const contractAt = quality.indexOf("name: Maintenance Control and Pages ACL Contract Tests");
  const acceptanceAt = quality.indexOf("name: Isolated PM2 6.0.14 Maintenance Transport Acceptance");
  const lintAt = quality.indexOf("name: Lint");
  assert.ok(contractAt >= 0 && acceptanceAt > contractAt && lintAt > acceptanceAt);
  const step = quality.slice(acceptanceAt, lintAt);
  assert.match(step, /timeout-minutes:\s*7/);
  assert.match(step, /FAOLLA_PM2_REAL_ACCEPTANCE:\s*"1"/);
  assert.match(step, /run:\s*node scripts\/production-maintenance-pm2-acceptance\.mjs/);
  assert.doesNotMatch(step, /continue-on-error|\bif:|secrets\.|PM2_HOME:|SUPABASE_SERVICE_ROLE_KEY|\.env\.local/);
  const jobs = [...workflow.slice(workflow.indexOf("jobs:\n")).matchAll(/^  ([a-z0-9-]+):$/gm)].map((match) => match[1]);
  assert.deepEqual(jobs, ["quality", "browser", "qr-database", "transaction-database", "redemption-database",
    "checkout-database", "pages-acl-database", "recovery-database", "maintenance-ingress"]);
});

test("both CI test entrypoints retain native filesystem coverage without concurrent sibling fixtures", () => {
  const quality = jobBlock("quality");
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

test("bridge module initialization is fixed and confined to the disposable Ubuntu ingress job", () => {
  const job = jobBlock("maintenance-ingress");
  assert.equal((workflow.match(/modprobe/g) ?? []).length, 1);
  assert.match(job, /test "\$RUNNER_OS" = Linux/);
  assert.match(job, /ubuntu:24\.04/);
  assert.match(job, /case "\$\(uname -r\)" in 6\.\*\) ;; \*\) exit 1 ;; esac/);
  assert.match(job, /sudo -n \/usr\/sbin\/modprobe br_netfilter/);
  assert.doesNotMatch(job, /modprobe[^\n]*\$|sysctl|\/proc\/sys\/net\/bridge/);
  assert.ok(job.indexOf("/usr/sbin/modprobe br_netfilter") < job.indexOf("run: node scripts/production-maintenance-ingress-acceptance.mjs"));
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
  assert.match(browser, /needs:\s*quality/);
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
  assert.match(qr, /needs:\s*quality/);
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
  assert.match(transaction, /needs:\s*quality/);
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

test("redemption atomic acceptance uses an independent disposable PostgreSQL CI service", () => {
  const redemption = jobBlock("redemption-database");
  assert.match(redemption, /needs:\s*quality/);
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
  assert.match(checkout, /needs:\s*quality/);
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
  assert.match(recovery, /needs:\s*quality/);
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
  assert.match(acl, /needs:\s*quality/);
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
