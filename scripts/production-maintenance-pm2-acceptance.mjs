import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

// CI-only compatibility evidence for a NEW private PM2 6.0.14 daemon. The only
// CLI use is its initial creation. All app control and dump operations use the
// actual connect-only Python transport. Fixtures are NOT Next/business health.
const fail = (code) => { throw new Error(code); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scripts = dirname(fileURLToPath(import.meta.url));
const controlSource = join(scripts, "production-maintenance-pm2-control.py");
const dumpSource = join(scripts, "production-maintenance-pm2-dump.py");
const safeCodes = new Set(["pm2_control_precondition_failed", "pm2_control_outcome_unknown"]);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const compact = (value) => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])));
let stage = "guards";
const bridge = `import importlib.util,json,sys
try:
    value=json.loads(sys.stdin.buffer.read(65537))
    modules=[]
    for index,path in enumerate(sys.argv[1:]):
        spec=importlib.util.spec_from_file_location("acceptance_"+str(index),path)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    control,dump=modules
    action=value["action"]
    if action=="identity": result=control._peer._read_daemon_identity(value["pid"])
    elif action=="inspect": result=control.inspect_pm2_registry(value["socketPath"],value["daemon"])
    elif action=="control": result=control.control_pm2_process(value["socketPath"],value["daemon"],value["request"],timeout_ms=45000)
    elif action=="capture": result=dump.capture_pm2_dump_target(value["socketPath"],value["daemon"])
    elif action=="persist": result=dump.persist_pm2_dump(value["socketPath"],value["daemon"],value["registry"],value["proof"])
    elif action=="verify": result=dump.verify_pm2_dump(value["socketPath"],value["daemon"],value["registry"],value["receipt"])
    else: raise ValueError()
    sys.stdout.write(json.dumps({"ok":True,"result":result},separators=(",",":"))+"\\n")
except BaseException as error:
    code=str(error) if str(error) in ("pm2_control_precondition_failed","pm2_control_outcome_unknown") else "pm2_acceptance_transport_failed"
    sys.stdout.write(json.dumps({"ok":False,"error":code})+"\\n")
    sys.exit(1)
`;

function assertPrivateChain(path, uid) {
  if (!path.startsWith("/") || realpathSync(path) !== path) fail("pm2_acceptance_path_unverified");
  let current = "/";
  for (const part of [null, ...path.split("/").filter(Boolean)]) {
    if (part !== null) current = posix.join(current, part);
    const metadata = lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || ![0, uid].includes(metadata.uid) || (metadata.mode & 0o022) !== 0) {
      fail("pm2_acceptance_path_unverified");
    }
  }
}

async function main() {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || process.env.FAOLLA_PM2_REAL_ACCEPTANCE !== "1" ||
      process.argv.length !== 2 || typeof process.getuid !== "function") fail("pm2_acceptance_opt_in_required");
  const uid = process.getuid(), owner = userInfo(), home = realpathSync(homedir());
  assertPrivateChain(home, uid);
  if (owner.uid !== uid || realpathSync(owner.homedir) !== home) fail("pm2_acceptance_home_unverified");
  const fixture = mkdtempSync(join(home, ".faolla-pm2-"));
  chmodSync(fixture, 0o700);
  const fixtureIdentity = lstatSync(fixture);
  const pm2Home = join(fixture, "pm2"), prefix = join(fixture, "dependencies"), socketPath = join(pm2Home, "rpc.sock");
  const release = join(fixture, "app.releases", "aaaaaaaaaaaa-20260910000000");
  const node = realpathSync(process.execPath);
  const environment = { PATH: `${dirname(node)}:/usr/local/bin:/usr/bin:/bin`, HOME: home, USER: owner.username,
    LOGNAME: owner.username, LANG: "C", LC_ALL: "C", PM2_HOME: pm2Home,
    NODE_OPTIONS: "", NODE_PATH: "", PM2_NODE_OPTIONS: "" };
  const observed = new Map();
  let daemon = null, bootstrapAttempted = false, groups = 0, clean = false;

  function callProgram(command, args, input, timeout = 50000) {
    return spawnSync(command, args, { input, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 2097152,
      cwd: fixture, env: environment, shell: false, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  }
  function python(payload, expectedError = null) {
    const result = callProgram("python3", ["-I", "-S", "-B", "-c", bridge, controlSource, dumpSource], JSON.stringify(payload));
    if (result.error || result.signal || result.stderr !== "" || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 524288) {
      fail("pm2_acceptance_transport_failed");
    }
    let body;
    try { body = JSON.parse(result.stdout); } catch { fail("pm2_acceptance_transport_failed"); }
    if (expectedError !== null) {
      if (!safeCodes.has(expectedError) || result.status !== 1 || body?.ok !== false || body.error !== expectedError) fail("pm2_acceptance_rejection_unverified");
      return null;
    }
    if (result.status !== 0 || body?.ok !== true || !Object.hasOwn(body, "result")) fail("pm2_acceptance_transport_failed");
    return body.result;
  }
  function identity(pid) {
    return python({ action: "identity", pid });
  }
  function parentPid(pid) {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    if (!/^[0-9]+$/.test(fields[1] ?? "")) fail("pm2_acceptance_process_unverified");
    return Number(fields[1]);
  }
  function assertDaemon() {
    if (!daemon || !equal(identity(daemon.pid), daemon)) fail("pm2_acceptance_daemon_changed");
    const title = readFileSync(`/proc/${daemon.pid}/cmdline`).toString("utf8").replace(/\0+$/, "");
    if (title !== `PM2 v6.0.14: God Daemon (${pm2Home})`) fail("pm2_acceptance_daemon_changed");
  }
  function registry() {
    assertDaemon();
    const result = python({ action: "inspect", socketPath, daemon });
    assert.equal(result.pm2Version, "6.0.14");
    assert.equal(result.peerVerified, true);
    assert.ok(!JSON.stringify(result).includes("synthetic-private-key"));
    for (const row of result.registry) {
      if (row.pid > 0) {
        const current = identity(row.pid);
        if (parentPid(row.pid) !== daemon.pid || current.uid !== uid || current.executable !== node ||
            realpathSync(`/proc/${row.pid}/cwd`) !== release) fail("pm2_acceptance_process_unverified");
        const previous = observed.get(row.pid);
        if (previous && !equal(previous, current)) fail("pm2_acceptance_process_replaced");
        observed.set(row.pid, current);
      }
    }
    return result.registry;
  }
  function values(role) {
    return { SUPABASE_INTERNAL_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_URL: "https://database.invalid",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-private-key", MERCHANT_STAFF_BUSINESS_RBAC_MODE: "off",
      MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "", FAOLLA_CANONICAL_PORTAL_ORIGIN: "https://portal.invalid",
      FAOLLA_BACKGROUND_JOBS_PAUSED: role === "candidate-web" ? "1" : "0", PORT: "3000",
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: "true", MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: "false" };
  }
  function launch(role, appName = "faolla-fixture") {
    const env = values(role);
    return { role, appName, appPort: 3000, release, node, nonce: randomUUID(), envDigest: hash(compact(env)), env };
  }
  function control(request, error = null) {
    assertDaemon();
    const answer = python({ action: "control", socketPath, daemon, request }, error);
    assertDaemon();
    return answer;
  }
  function prepare(item) {
    const answer = control({ action: "prepare", launch: item });
    assert.equal(answer.acknowledged, true);
    const name = item.appName + (item.role === "final-worker" ? "-enterprise-automation-worker" : "");
    const row = registry().find((entry) => entry.name === name);
    assert.ok(row);
    assert.equal(row.pm2_env.nonce, item.nonce);
    assert.equal(row.pm2_env.envDigest, item.envDigest);
    assert.equal(row.pm2_env.restart_time, 0);
    const before = identity(row.pid), bytes = readFileSync(`/proc/${row.pid}/environ`);
    assert.ok(bytes.length < 1048576 && bytes.at(-1) === 0);
    const records = bytes.toString("utf8").split("\0");
    for (const [key, value] of Object.entries({ ...item.env, FAOLLA_MAINTENANCE_LAUNCH_NONCE: item.nonce })) {
      assert.deepEqual(records.filter((entry) => entry.startsWith(key + "=")), [key + "=" + value]);
    }
    assert.deepEqual(identity(row.pid), before);
    return row;
  }
  async function assertGone(fact) {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!existsSync(`/proc/${fact.pid}`)) return;
      try { if (!equal(identity(fact.pid), fact)) return; } catch { if (!existsSync(`/proc/${fact.pid}`)) return; throw new Error("pm2_acceptance_process_unverified"); }
      await pause(50);
    }
    fail("pm2_acceptance_process_not_stopped");
  }
  async function remove(row, action = "delete") {
    const fact = row.pid ? identity(row.pid) : null;
    const answer = control({ action, expected: row, expectedProcess: fact });
    assert.equal(answer.acknowledged, true);
    if (fact) await assertGone(fact);
    return registry();
  }
  function ownedDaemonFromPidFile() {
    const pidPath = join(pm2Home, "pm2.pid");
    if (!existsSync(pidPath)) return null;
    const info = lstatSync(pidPath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== uid || info.size > 32) fail("pm2_acceptance_daemon_unverified");
    const text = readFileSync(pidPath, "utf8").trim();
    if (!/^[1-9][0-9]{0,9}$/.test(text)) fail("pm2_acceptance_daemon_unverified");
    const pid = Number(text);
    const title = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").replace(/\0+$/, "");
    if (title !== `PM2 v6.0.14: God Daemon (${pm2Home})`) fail("pm2_acceptance_daemon_unverified");
    const fact = identity(pid);
    if (fact.uid !== uid || fact.executable !== node) fail("pm2_acceptance_daemon_unverified");
    return fact;
  }
  try {
    stage = "isolated-install";
    if (Buffer.byteLength(socketPath) >= 107 || existsSync(pm2Home)) fail("pm2_acceptance_path_unverified");
    mkdirSync(pm2Home, { mode: 0o700 });
    mkdirSync(prefix, { mode: 0o700 });
    const userConfig = join(fixture, "npmrc");
    writeFileSync(userConfig, "", { flag: "wx", mode: 0o600 });
    const npm = callProgram("npm", ["install", "--prefix", prefix, "--cache", join(fixture, "cache"),
      "--userconfig", userConfig, "--registry=https://registry.npmjs.org", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=true", "pm2@6.0.14"], undefined, 180000);
    if (npm.error || npm.signal || npm.status !== 0) fail("pm2_acceptance_install_failed");
    const packageDirectory = join(prefix, "node_modules", "pm2");
    const packageInfo = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
    if (packageInfo.name !== "pm2" || packageInfo.version !== "6.0.14") fail("pm2_acceptance_version_unverified");
    mkdirSync(join(release, "node_modules", "next", "dist", "bin"), { recursive: true, mode: 0o700 });
    mkdirSync(join(release, "node_modules", "tsx", "dist"), { recursive: true, mode: 0o700 });
    mkdirSync(join(release, "scripts"), { recursive: true, mode: 0o700 });
    writeFileSync(join(release, "node_modules", "next", "dist", "bin", "next"),
      "'use strict';if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['start','-p','3000']))process.exit(41);setInterval(()=>{},1000);\n", { flag: "wx", mode: 0o600 });
    writeFileSync(join(release, "node_modules", "tsx", "dist", "cli.mjs"),
      "if(process.argv.length!==3||!process.argv[2].endsWith('/scripts/run-merchant-enterprise-automation-worker.ts'))process.exit(42);if(process.send)process.send('ready');setInterval(()=>{},1000);\n", { flag: "wx", mode: 0o600 });
    writeFileSync(join(release, "scripts", "run-merchant-enterprise-automation-worker.ts"), "// Synthetic argument target; no business code.\n", { flag: "wx", mode: 0o600 });
    if (readdirSync(pm2Home).length !== 0) fail("pm2_acceptance_home_not_empty");
    stage = "private-daemon-bootstrap";
    bootstrapAttempted = true;
    const boot = callProgram(node, [join(packageDirectory, "bin", "pm2"), "ping"], undefined, 20000);
    // Freeze the privately-created daemon even if its bootstrap ACK was lost.
    daemon = ownedDaemonFromPidFile();
    if (boot.error || boot.signal || boot.status !== 0 || !daemon) fail("pm2_acceptance_bootstrap_failed");
    assert.deepEqual(registry(), []); groups++;

    stage = "candidate-prepare";
    const candidatePlan = launch("candidate-web");
    const candidate = prepare(candidatePlan);
    assert.equal(candidate.pm2_env.autorestart, false);
    assert.equal(candidate.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED, "1"); groups++;

    stage = "candidate-stop-delete";
    const stopped = await remove(candidate, "stop");
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0].pid, 0);
    assert.equal(stopped[0].pm2_env.status, "stopped");
    assert.deepEqual(await remove(stopped[0]), []); groups++;

    stage = "final-web-worker-prepare";
    const webPlan = launch("final-web"), workerPlan = launch("final-worker");
    const web = prepare(webPlan), worker = prepare(workerPlan);
    assert.equal(web.pm2_env.autorestart, true);
    assert.equal(worker.pm2_env.autorestart, true);
    assert.equal(worker.pm2_env.FAOLLA_BACKGROUND_JOBS_PAUSED, "0"); groups++;

    stage = "foreign-nonce-rejection";
    const unchanged = registry();
    control({ action: "prepare", launch: { ...webPlan, nonce: randomUUID() } }, "pm2_control_precondition_failed");
    const changedExpected = structuredClone(web);
    changedExpected.pm2_env.nonce = randomUUID();
    control({ action: "delete", expected: changedExpected, expectedProcess: identity(web.pid) }, "pm2_control_precondition_failed");
    assert.deepEqual(registry(), unchanged); groups++;

    stage = "private-dump-save-verify";
    prepare(launch("final-web", "other-synthetic-app"));
    const savedRegistry = registry();
    const proof = python({ action: "capture", socketPath, daemon });
    const receipt = python({ action: "persist", socketPath, daemon, registry: savedRegistry, proof });
    assert.equal(receipt.saved, true);
    assert.equal(receipt.processCount, 3);
    assert.ok(!JSON.stringify(receipt).includes("synthetic-private-key"));
    assert.equal(python({ action: "verify", socketPath, daemon, registry: savedRegistry, receipt }), true);
    const saved = JSON.parse(readFileSync(join(pm2Home, "dump.pm2"), "utf8"));
    assert.deepEqual(saved.map((entry) => entry.name).sort(), savedRegistry.map((entry) => entry.name).sort());
    assert.ok(saved.every((entry) => !Object.hasOwn(entry, "pm_id") && !Object.hasOwn(entry, "instances") && !Object.hasOwn(entry, "prev_restart_delay")));
    assert.equal(lstatSync(join(pm2Home, "dump.pm2")).mode & 0o777, 0o600); groups++;

    stage = "exact-fixture-process-delete";
    for (const name of savedRegistry.map((row) => row.name).reverse()) {
      const row = registry().find((entry) => entry.name === name);
      assert.ok(row);
      await remove(row);
    }
    assert.deepEqual(registry(), []);
    assertDaemon(); groups++;
  } finally {
    // Never use `pm2 kill`: it can create a daemon when one is missing. The one
    // direct signal here addresses only this run's exact privately-created PID.
    if (!daemon && bootstrapAttempted) {
      daemon = ownedDaemonFromPidFile();
      // Missing pid-file evidence does NOT prove the detached daemon never
      // started. Keep this exact fixture and fail, rather than claiming cleanup.
      if (!daemon) fail("pm2_acceptance_cleanup_unverified");
    }
    if (daemon && existsSync(`/proc/${daemon.pid}`)) {
      assertDaemon();
      for (const name of readdirSync("/proc").filter((entry) => /^[1-9][0-9]*$/.test(entry))) {
        const pid = Number(name);
        try {
          if (parentPid(pid) !== daemon.pid) continue;
          const fact = identity(pid);
          if (fact.uid !== uid || fact.executable !== node || realpathSync(`/proc/${pid}/cwd`) !== release) fail("pm2_acceptance_cleanup_unverified");
          observed.set(pid, fact);
        } catch { if (existsSync(`/proc/${pid}`)) fail("pm2_acceptance_cleanup_unverified"); }
      }
      assertDaemon();
      process.kill(daemon.pid, "SIGINT");
      for (let attempt = 0; attempt < 200 && existsSync(`/proc/${daemon.pid}`); attempt++) await pause(50);
      if (existsSync(`/proc/${daemon.pid}`)) fail("pm2_acceptance_cleanup_unverified");
    }
    for (const fact of observed.values()) await assertGone(fact);
    assertPrivateChain(home, uid);
    const metadata = lstatSync(fixture);
    if (dirname(fixture) !== home || !posix.basename(fixture).startsWith(".faolla-pm2-") ||
        realpathSync(fixture) !== fixture || !metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid ||
        metadata.dev !== fixtureIdentity.dev || metadata.ino !== fixtureIdentity.ino) fail("pm2_acceptance_cleanup_unverified");
    rmSync(fixture, { recursive: true });
    clean = !existsSync(fixture);
    if (!clean) fail("pm2_acceptance_cleanup_unverified");
  }
  console.log(JSON.stringify({ version: 1, evidence: "isolated-pm2-protocol-not-business-health", pm2Version: "6.0.14",
    groups, daemonChanged: false, realTransport: true, cleanupVerified: clean }));
}

try { await main(); }
catch (error) {
  const allowed = new Set(["pm2_acceptance_opt_in_required", "pm2_acceptance_path_unverified", "pm2_acceptance_home_unverified",
    "pm2_acceptance_transport_failed", "pm2_acceptance_rejection_unverified", "pm2_acceptance_daemon_changed", "pm2_acceptance_process_unverified",
    "pm2_acceptance_process_replaced", "pm2_acceptance_process_not_stopped", "pm2_acceptance_daemon_unverified", "pm2_acceptance_install_failed",
    "pm2_acceptance_version_unverified", "pm2_acceptance_home_not_empty", "pm2_acceptance_bootstrap_failed", "pm2_acceptance_cleanup_unverified"]);
  console.error(JSON.stringify({ error: allowed.has(error?.message) ? error.message : "pm2_acceptance_unverified", stage }));
  process.exitCode = 1;
}
