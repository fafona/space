import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { diagnoseRuntimeCompatibility, validateRuntimeCompatibilityDiagnostic } from "./production-maintenance-runtime-diagnostic.mjs";

const SECRET = "DIAGNOSTIC_SECRET_DO_NOT_DISCLOSE";
const DIRECT = "runtime_supervision_direct_next_owned";
const input = () => ({ appDir: "/srv/faolla", appName: "faolla", appPort: 3000, expectedOldSha: "a".repeat(40) });
function fixture() {
  const runtime = "/srv/faolla.releases/aaaaaaaaaaaa-20260909120000";
  const node = "/opt/node/bin/node"; const home = "/srv/pm2"; const selectedReads = []; const processReads = [];
  const facts = new Map(); const environments = new Map(); const paths = new Map();
  const filesystem = new Map(); const regularReads = []; const pythonCalls = []; let inode = 0;
  function putPath(path, type, content = "", changes = {}) {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (path !== "/" && !filesystem.has(parent)) putPath(parent, "directory");
    const info = { type, identity: `inode-${++inode}`, uid: 0, mode: type === "directory" ? 0o40755 : 0o100755,
      nlink: 1, size: Buffer.byteLength(content), ...changes };
    filesystem.set(path, { info, content }); return info;
  }
  putPath(home, "directory", "", { uid: 1000, mode: 0o40700 });
  putPath(home + "/rpc.sock", "socket", "", { uid: 1000, mode: 0o140777 });
  putPath(home + "/pm2.pid", "file", "10\n", { uid: 1000, mode: 0o100600 });
  putPath("/usr/bin/python3", "symlink", "python3.12", { mode: 0o120777 });
  putPath("/usr/bin/python3.12", "file", "synthetic binary"); paths.set("/usr/bin/python3", "/usr/bin/python3.12");
  const fact = (pid, parentPid, cwd = runtime, executable = node) => ({ pid, parentPid, cwd, executable,
    uid: 1000, startTicks: String(pid * 10), commandLineDigest: "b".repeat(64), commandLine: ["node", SECRET] });
  const daemon = fact(10, 1, "/"); daemon.commandLine = [`PM2 v6.0.8: God Daemon (${home})`];
  const web = fact(100, 10); facts.set(10, daemon); facts.set(100, web);
  const values = (name, entry, args) => ({ args, exec_interpreter: node, exec_mode: "fork_mode", name,
    node_args: "", pm_cwd: runtime, pm_exec_path: entry, pm_id: "0", PM2_HOME: null });
  environments.set(100, values("faolla", runtime + "/node_modules/next/dist/bin/next", "start,-p,3000"));
  environments.set(10, { PM2_HOME: home });
  const disk = { runtime, environmentIdentity: "identity", environmentDigest: "digest",
    nextEntryPath: runtime + "/node_modules/next/dist/bin/next" };
  const file = { internalUrl: "http://127.0.0.1:8000", publicUrl: "https://example.test", anonKey: SECRET,
    rolloutStatus: "legacy-off", fileIdentity: disk.environmentIdentity, sha256: disk.environmentDigest };
  const live = { ...file, status: "present", rolloutStatus: "absent", startTicks: web.startTicks };
  const cli = { home, overridesPresent: false };
  const deps = {
    disk: () => structuredClone(disk),
    supervision: async () => ({ listener: { state: "single", pid: 100, chain: [structuredClone(web), structuredClone(daemon)] },
      ownership: { state: "owned", mode: "direct", pid: 100, daemonPid: 10 }, healthVerified: true }),
    classify: (snapshot) => snapshot.ownership.mode === "direct" ? DIRECT : "runtime_supervision_legacy_npm_wrapper_owned",
    readProcess: (pid) => { processReads.push(pid); if (!facts.has(pid)) throw new Error(SECRET); return structuredClone(facts.get(pid)); },
    readSelected: (pid) => { selectedReads.push(pid); if (!environments.has(pid)) throw new Error(SECRET); return structuredClone(environments.get(pid)); },
    scan: () => ({ index: [...facts.values()].map(({ pid, parentPid }) => ({ pid, parentPid })),
      runtimePids: [...facts.values()].filter((entry) => entry.cwd === runtime).map((entry) => entry.pid) }),
    canonical: (value) => paths.get(value) ?? value, nodePath: () => node,
    readRollback: () => structuredClone(file), readProcessEnvironment: () => structuredClone(live),
    cliEnvironment: () => structuredClone(cli), boot: () => "boot",
    pathInfo: (path) => filesystem.has(path) ? structuredClone(filesystem.get(path).info) : null,
    readRegular: (path, limit, expected) => { regularReads.push(path); const file = filesystem.get(path);
      assert.ok(file); assert.equal(file.info.identity, expected.identity); assert.ok(file.info.size <= limit);
      return { bytes: Buffer.from(file.content), digest: file.info.identity }; },
    runPython: (path) => { pythonCalls.push(path); return { status: 0, signal: null, stdout: JSON.stringify({ version: "3.12.3", afUnixApiAvailable: true, soPeercredApiAvailable: true }) }; },
    arch: () => "x64",
    run: () => { throw new Error("ACTUATION_FORBIDDEN"); },
  };
  function addWorker() {
    facts.set(200, fact(200, 10));
    environments.set(200, values("faolla-enterprise-automation-worker", runtime + "/node_modules/tsx/dist/cli.mjs",
      runtime + "/scripts/run-merchant-enterprise-automation-worker.ts"));
  }
  return { deps, disk, file, live, cli, facts, environments, paths, runtime, node, web, daemon, fact, addWorker,
    selectedReads, processReads, filesystem, putPath, regularReads, pythonCalls };
}
const diagnose = (f) => diagnoseRuntimeCompatibility(input(), f.deps);
function assertUnknown(result) {
  assert.equal(result.stability, "unverified"); assert.equal(result.disk, "unverified");
  assert.equal(result.daemonCwdIsRoot, null); assert.equal(result.supervision, null);
  assert.equal(result.worker.state, "unverified"); assert.equal(result.pm2Home, "unverified");
  assert.ok(Object.values(result.webMetadata).every((value) => value === null));
}

test("stable direct diagnostic distinguishes a root-cwd daemon without granting maintenance", async () => {
  const result = await diagnose(fixture());
  assert.equal(result.stability, "stable"); assert.equal(result.disk, "verified"); assert.equal(result.supervision, DIRECT);
  assert.equal(result.daemonCwdIsRoot, true); assert.ok(Object.values(result.webMetadata).every((value) => value === true));
  assert.equal(result.supabaseEnvironment, "matches"); assert.equal(result.worker.state, "not_observed");
  assert.equal(result.runtimeExtraProcessCount, 0); assert.equal(result.pm2Home, "matches");
  assert.equal(result.maintenance, "not_verified"); assert.equal(result.pm2Connection, "not_checked");
  assert.equal(result.version, 2); assert.equal(result.pm2Version, "6.0.8");
  assert.deepEqual(result.pm2Endpoint, { home: "verified", rpcSocket: "verified", pidFile: "verified", pidMatches: true });
  assert.deepEqual(result.python, { version: "3.12.3", executableVerified: true, afUnixApiAvailable: true, soPeercredApiAvailable: true });
  assert.deepEqual(validateRuntimeCompatibilityDiagnostic(result), result);
  assert.equal(JSON.stringify(result).includes(SECRET), false); assert.equal(JSON.stringify(result).includes("/srv/"), false);
});

test("canonical aliases remain distinguishable from strict literal metadata requirements", async () => {
  const f = fixture(); const metadata = f.environments.get(100);
  for (const [key, alias, target] of [["pm_cwd", "/alias/runtime", f.runtime],
    ["pm_exec_path", "/alias/next", f.disk.nextEntryPath], ["exec_interpreter", "/usr/bin/node", f.node]]) {
    metadata[key] = alias; f.paths.set(alias, target);
  }
  const result = await diagnose(f);
  for (const key of ["cwd", "entry", "interpreter"]) {
    assert.equal(result.webMetadata[key + "LiteralMatch"], false);
    assert.equal(result.webMetadata[key + "CanonicalMatch"], true);
  }
});

test("missing, different and unreadable initial Supabase values are distinct and redacted", async () => {
  for (const [change, expected] of [
    [(f) => { f.live.status = "absent"; }, "absent"],
    [(f) => { f.live.anonKey = SECRET + "_different"; }, "differs"],
    [(f) => { f.deps.readRollback = () => { throw new Error(SECRET); }; }, "unverified"],
    [(f) => { f.file.fileIdentity = "changed"; }, "unverified"],
  ]) {
    const f = fixture(); change(f); const result = await diagnose(f);
    assert.equal(result.supabaseEnvironment, expected); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test("worker ownership reports Node and native descendants without authorizing native termination", async () => {
  const f = fixture(); f.addWorker();
  f.facts.set(201, f.fact(201, 200)); f.facts.set(202, f.fact(202, 201, f.runtime, "/native/esbuild"));
  const result = await diagnose(f);
  assert.deepEqual(result.worker, { state: "owned", nodeDescendantCount: 1, nonNodeDescendantCount: 1 });
  assert.equal(result.runtimeExtraProcessCount, 0); assert.equal(result.maintenance, "not_verified");
});

test("unknown runtime processes and extra Web descendants are counted", async () => {
  const f = fixture(); f.facts.set(201, f.fact(201, 100)); f.facts.set(300, f.fact(300, 1));
  const result = await diagnose(f); assert.equal(result.runtimeExtraProcessCount, 2);
  assert.equal(f.selectedReads.includes(201), false); assert.equal(f.selectedReads.includes(300), false);
});

test("other applications' environments are never read when identifying the worker", async () => {
  const f = fixture(); f.facts.set(400, f.fact(400, 10, "/srv/unrelated"));
  const result = await diagnose(f); assert.equal(result.worker.state, "not_observed");
  assert.equal(f.selectedReads.includes(400), false); assert.equal(f.processReads.includes(400), false);
});

test("a worker reparented after the index scan is not read as this daemon's managed environment", async () => {
  const f = fixture(); f.addWorker(); const original = f.deps.scan;
  f.deps.scan = (...args) => { const value = original(...args); value.index.find((entry) => entry.pid === 200).parentPid = 10; return value; };
  f.facts.get(200).parentPid = 50;
  const result = await diagnose(f); assert.equal(result.worker.state, "unverified");
  assert.equal(f.selectedReads.includes(200), false);
});

test("ambiguous, foreign and unreadable worker details remain unknown, not zero", async () => {
  for (const change of [
    (f) => { f.facts.set(250, f.fact(250, 10)); f.environments.set(250, structuredClone(f.environments.get(200))); },
    (f) => { f.environments.get(200).exec_mode = "cluster_mode"; },
    (f) => { f.facts.set(201, { ...f.fact(201, 200), uid: 2000 }); },
    (f) => { f.deps.scan = () => { throw new Error(SECRET); }; },
  ]) {
    const f = fixture(); f.addWorker(); change(f); const result = await diagnose(f);
    assert.deepEqual(result.worker, { state: "unverified", nodeDescendantCount: null, nonNodeDescendantCount: null });
    assert.equal(result.runtimeExtraProcessCount, null); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test("PM2 home is only a directory comparison, including when socket overrides are present", async () => {
  for (const [home, expected] of [["/other/home", "differs"], [null, "absent"], ["/srv/pm2", "matches"]]) {
    const f = fixture(); f.cli.home = home; f.cli.overridesPresent = true;
    const result = await diagnose(f); assert.equal(result.pm2Home, expected);
    assert.equal(result.pm2PathOverridesPresent, true); assert.equal(result.pm2Connection, "not_checked");
  }
  const f = fixture(); f.environments.get(10).PM2_HOME = "/contradicts-title";
  assert.equal((await diagnose(f)).pm2Home, "unverified");
});

test("metadata flags, noncanonical paths and unreadable metadata are not guessed", async () => {
  const f = fixture(); f.environments.get(100).args = "start,-p,1234";
  f.environments.get(100).node_args = "--require " + SECRET;
  f.environments.get(100).exec_interpreter = "relative-node";
  const result = await diagnose(f); assert.equal(result.webMetadata.argsMatch, false);
  assert.equal(result.webMetadata.nodeArgsEmpty, false); assert.equal(result.webMetadata.interpreterCanonicalMatch, null);
  f.deps.readSelected = () => { throw new Error(SECRET); };
  const unreadable = await diagnose(f); assert.ok(Object.values(unreadable.webMetadata).every((value) => value === null));
  assert.equal(unreadable.pm2Home, "unverified");
});

test("runtime, Web, daemon, worker and boot drift discard every sampled success", async () => {
  for (const change of [
    (f) => { f.disk.environmentDigest += "changed"; },
    (f) => { f.web.startTicks = "99999"; },
    (f) => { f.daemon.cwd = "/changed"; },
    (f) => { f.facts.get(200).startTicks = "99999"; },
  ]) {
    const f = fixture(); f.addWorker(); const original = f.deps.disk; let reads = 0;
    f.deps.disk = (...args) => { if (++reads === 2) change(f); return original(...args); };
    assertUnknown(await diagnose(f));
  }
  const f = fixture(); let count = 0; f.deps.boot = () => String(count++); assertUnknown(await diagnose(f));
});

test("failed core observations produce no diagnostic detail or raw errors", async () => {
  for (const key of ["disk", "supervision", "boot", "readProcess"]) {
    const f = fixture(); f.deps[key] = () => { throw new Error(SECRET); };
    const result = await diagnose(f); assertUnknown(result); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test("input is exact, captured before awaiting, and getters are not evaluated", async () => {
  const f = fixture(); let invoked = false; const bad = input();
  Object.defineProperty(bad, "appDir", { enumerable: true, get() { invoked = true; return SECRET; } });
  await assert.rejects(diagnoseRuntimeCompatibility(bad, f.deps), { message: "production_maintenance_runtime_diagnostic_invalid" });
  assert.equal(invoked, false);
  await assert.rejects(diagnoseRuntimeCompatibility({ ...input(), secret: SECRET }, f.deps));
  const value = input(); const pending = diagnoseRuntimeCompatibility(value, f.deps); value.appPort = 1;
  assert.equal((await pending).webMetadata.argsMatch, true);
});

test("strict report validator rejects extensions, secret strings, accessors and contradictory shapes", async () => {
  const result = await diagnose(fixture());
  for (const change of [
    (v) => { v.rawEnvironment = SECRET; }, (v) => { v.pm2Home = SECRET; },
    (v) => { v.maintenance = "held"; }, (v) => { v.pm2Connection = "verified"; },
    (v) => { v.runtimeExtraProcessCount = 16385; }, (v) => { v.runtimeExtraProcessCount = -1; },
    (v) => { v.worker.state = "unverified"; }, (v) => { v.worker.nodeDescendantCount = 1; },
    (v) => { v.stability = "unverified"; }, (v) => { v.webMetadata.secret = SECRET; },
  ]) { const value = structuredClone(result); change(value); assert.throws(() => validateRuntimeCompatibilityDiagnostic(value), { message: "production_maintenance_runtime_diagnostic_invalid" }); }
  const value = structuredClone(result); let invoked = false;
  Object.defineProperty(value, "disk", { enumerable: true, get() { invoked = true; return "verified"; } });
  assert.throws(() => validateRuntimeCompatibilityDiagnostic(value)); assert.equal(invoked, false);
  const copy = validateRuntimeCompatibilityDiagnostic(result); copy.webMetadata.argsMatch = false;
  assert.equal(result.webMetadata.argsMatch, true);
});

test("PM2 version is extracted only from the bound daemon's exact stable release title", async () => {
  for (const version of ["6.0", "06.0.8", "6.0.8.1", "6.0.8-beta", "6.0.8+" + SECRET, SECRET]) {
    const f = fixture(); f.daemon.commandLine = [`PM2 v${version}: God Daemon (/srv/pm2)`];
    const result = await diagnose(f); assert.equal(result.pm2Version, null);
    assert.equal(result.pm2Endpoint.home, "unverified"); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test("fixed socket metadata does not equate broad socket mode with a verified connection", async () => {
  const f = fixture(); f.cli.overridesPresent = true;
  const result = await diagnose(f); assert.equal(result.pm2Endpoint.rpcSocket, "verified");
  assert.equal(result.pm2Connection, "not_checked"); assert.equal(result.pm2PathOverridesPresent, true);
  assert.ok(f.regularReads.every((path) => path === "/srv/pm2/pm2.pid"));
  assert.equal(f.regularReads.includes("/srv/pm2/rpc.sock"), false);
});

test("missing, symlinked, wrong-owner or unsafe endpoint ancestors never get followed", async () => {
  for (const [change, key, expected] of [
    [(f) => { f.filesystem.delete("/srv/pm2"); }, "home", "missing"],
    [(f) => { f.filesystem.get("/srv/pm2").info.type = "symlink"; }, "home", "unsafe"],
    [(f) => { f.filesystem.get("/srv").info.mode = 0o40777; }, "home", "unsafe"],
    [(f) => { f.filesystem.delete("/srv/pm2/rpc.sock"); }, "rpcSocket", "missing"],
    [(f) => { f.filesystem.get("/srv/pm2/rpc.sock").info.type = "symlink"; }, "rpcSocket", "unsafe"],
    [(f) => { f.filesystem.get("/srv/pm2/rpc.sock").info.uid = 2000; }, "rpcSocket", "unsafe"],
    [(f) => { f.filesystem.get("/srv/pm2/pm2.pid").info.type = "other"; }, "pidFile", "unsafe"],
    [(f) => { f.filesystem.get("/srv/pm2/pm2.pid").info.nlink = 2; }, "pidFile", "unsafe"],
  ]) {
    const f = fixture(); change(f); const result = await diagnose(f); assert.equal(result.pm2Endpoint[key], expected);
    if (key === "home" || key === "pidFile") assert.equal(f.regularReads.includes("/srv/pm2/pm2.pid"), false);
  }
});

test("pid file content is bounded, strictly parsed and never disclosed", async () => {
  for (const [content, expected] of [["11\n", false], [SECRET, null], ["10 extra", null], ["10\n11\n", null], ["010", null], ["2147483648", null]]) {
    const f = fixture(); f.putPath("/srv/pm2/pm2.pid", "file", content, { uid: 1000, mode: 0o100600 });
    const result = await diagnose(f); assert.equal(result.pm2Endpoint.pidMatches, expected);
    assert.equal(JSON.stringify(result).includes(content.trim()), false);
  }
  const f = fixture(); f.deps.readRegular = () => { throw new Error(SECRET); };
  const result = await diagnose(f); assert.equal(result.pm2Endpoint.pidFile, "unverified"); assert.equal(result.pm2Endpoint.pidMatches, null);
});

function nativeFixture(nested = false) {
  const f = fixture(); f.addWorker();
  const base = f.runtime + (nested ? "/node_modules/tsx" : "") + "/node_modules/@esbuild/linux-x64";
  const executable = base + "/bin/esbuild";
  const info = f.putPath(executable, "file", "synthetic esbuild", { uid: 1000 });
  f.putPath(base + "/package.json", "file", JSON.stringify({ name: "@esbuild/linux-x64", version: "0.27.3" }), { uid: 1000 });
  const child = { ...f.fact(201, 200, f.runtime, executable), executableIdentity: info.identity,
    commandLine: [executable, "--service=0.27.3", "--ping"] };
  f.facts.set(201, child); return { ...f, base, executable, child };
}

test("esbuild classification requires fixed root or nested runtime package, identity, version and exact argv", async () => {
  for (const nested of [false, true]) {
    const f = nativeFixture(nested); const result = await diagnose(f);
    assert.deepEqual(result.workerNative, { esbuildCount: 1, otherCount: 0, unknownCount: 0, controlledIdentityVerified: true });
    assert.equal(result.maintenance, "not_verified"); assert.equal(result.pm2Connection, "not_checked");
    assert.ok(f.regularReads.includes(f.base + "/package.json"));
  }
});

test("unsupported stable native invocations are other, unreadable or uncontrolled files are unknown", async () => {
  for (const change of [
    (f) => { f.child.commandLine.push("--extra"); },
    (f) => { f.child.commandLine[1] = "--service=0.26.0"; },
    (f) => { f.child.commandLine = [SECRET]; },
  ]) {
    const f = nativeFixture(); change(f); const result = await diagnose(f);
    assert.deepEqual(result.workerNative, { esbuildCount: 0, otherCount: 1, unknownCount: 0, controlledIdentityVerified: true });
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
  for (const change of [
    (f) => { f.filesystem.delete(f.base + "/package.json"); },
    (f) => { f.filesystem.get(f.base + "/package.json").info.type = "symlink"; },
    (f) => { f.filesystem.get(f.base + "/bin").info.mode = 0o40777; },
    (f) => { f.filesystem.get(f.executable).info.mode = 0o100777; },
  ]) {
    const f = nativeFixture(); change(f); const result = await diagnose(f);
    assert.deepEqual(result.workerNative, { esbuildCount: 0, otherCount: 0, unknownCount: 1, controlledIdentityVerified: null });
  }
});

test("esbuild-looking names outside fixed packages are not recognized as supported esbuild", async () => {
  const f = nativeFixture(); const executable = f.runtime + "/unrecognized/esbuild";
  const info = f.putPath(executable, "file", "different native", { uid: 1000 });
  f.child.executable = executable; f.child.executableIdentity = info.identity; f.child.commandLine[0] = executable;
  const result = await diagnose(f); assert.equal(result.workerNative.esbuildCount, 0); assert.equal(result.workerNative.otherCount, 1);
});

test("Python uses only the verified fixed system executable; no PATH or unsafe symlink fallback", async () => {
  for (const change of [
    (f) => { f.paths.set("/usr/bin/python3", "/tmp/python3"); },
    (f) => { f.filesystem.get("/usr/bin/python3.12").info.uid = 1000; },
    (f) => { f.filesystem.get("/usr/bin").info.mode = 0o40777; },
    (f) => { f.filesystem.get("/usr/bin/python3").info.type = "other"; },
    (f) => { f.filesystem.delete("/usr/bin/python3"); },
  ]) {
    const f = fixture(); change(f); const result = await diagnose(f);
    assert.equal(f.pythonCalls.length, 0); assert.equal(result.python.version, null); assert.equal(result.python.afUnixApiAvailable, null);
  }
});

test("Python failures, malformed output and missing symbols stay bounded unknown or factual false", async () => {
  for (const output of [
    { status: 1, stdout: SECRET, stderr: SECRET }, { status: null, signal: "SIGKILL", stdout: "", stderr: SECRET },
    { status: 0, stdout: "x".repeat(4097) }, { status: 0, stdout: SECRET },
    { status: 0, stdout: JSON.stringify({ version: "3.12.3", afUnixApiAvailable: true, soPeercredApiAvailable: true, secret: SECRET }) },
  ]) {
    const f = fixture(); f.deps.runPython = () => output; const result = await diagnose(f);
    assert.equal(result.python.version, null); assert.equal(result.python.afUnixApiAvailable, null); assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
  const f = fixture(); f.deps.runPython = () => ({ status: 0, stdout: JSON.stringify({ version: "3.12.3", afUnixApiAvailable: true, soPeercredApiAvailable: false }) });
  assert.equal((await diagnose(f)).python.soPeercredApiAvailable, false);
});

test("endpoint, Python and native identity changes invalidate the entire diagnostic", async () => {
  for (const path of ["/srv/pm2", "/srv/pm2/rpc.sock", "/srv/pm2/pm2.pid", "/usr/bin/python3.12"]) {
    const f = fixture(); const original = f.deps.pathInfo; let reads = 0;
    f.deps.pathInfo = (value) => { const info = original(value); if (value === path && ++reads > 1) info.identity += "changed"; return info; };
    assertUnknown(await diagnose(f));
  }
  const f = nativeFixture(); f.child.executableIdentity = "different-process-inode"; assertUnknown(await diagnose(f));
  const g = fixture(); g.deps.runPython = () => { g.filesystem.get("/usr/bin/python3.12").info.identity += "changed";
    return { status: 0, stdout: JSON.stringify({ version: "3.12.3", afUnixApiAvailable: true, soPeercredApiAvailable: true }) }; };
  assertUnknown(await diagnose(g));
});

test("v2 validator rejects false authorization, version injection and contradictory new evidence", async () => {
  const result = await diagnose(fixture());
  for (const change of [
    (v) => { v.version = 1; }, (v) => { v.pm2Version = "6.0.8+" + SECRET; },
    (v) => { v.pm2Endpoint.home = "missing"; }, (v) => { v.pm2Endpoint.pidFile = "unsafe"; },
    (v) => { v.workerNative.esbuildCount = 1; }, (v) => { v.workerNative.controlledIdentityVerified = true; },
    (v) => { v.python.executableVerified = false; }, (v) => { v.python.version = null; },
    (v) => { v.python.socketConnected = true; }, (v) => { v.pm2Endpoint.pid = 10; },
  ]) { const value = structuredClone(result); change(value); assert.throws(() => validateRuntimeCompatibilityDiagnostic(value)); }
});

test("diagnostic module has no PM2 actuation dependency and importing from stdin has no host effects", () => {
  const url = new URL("./production-maintenance-runtime-diagnostic.mjs", import.meta.url);
  const source = readFileSync(url, "utf8");
  assert.doesNotMatch(source, /from\s+["']pm2|import\(["']pm2|\b(?:spawn|exec|execSync|execFile|execFileSync)\s*\(/);
  assert.equal([...source.matchAll(/\bspawnSync\s*\(/g)].length, 1);
  assert.match(source, /spawnSync\(executable, \["-I", "-S", "-B", "-c", PYTHON_SOURCE\]/);
  assert.match(source, /timeout: 3000, maxBuffer: 4096/);
  assert.doesNotMatch(source, /socket\.(?:socket|socketpair|connect|create_connection)\(/);
  assert.doesNotMatch(source, /(?:dump\.pm2|\.pm2\/logs|production-maintenance-runtime\.mjs)/);
  const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `await import(${JSON.stringify(url.href)});`, encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  assert.equal(child.status, 0); assert.equal(child.stdout, ""); assert.equal(child.stderr, "");
});
