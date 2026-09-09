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
    run: () => { throw new Error("ACTUATION_FORBIDDEN"); },
  };
  function addWorker() {
    facts.set(200, fact(200, 10));
    environments.set(200, values("faolla-enterprise-automation-worker", runtime + "/node_modules/tsx/dist/cli.mjs",
      runtime + "/scripts/run-merchant-enterprise-automation-worker.ts"));
  }
  return { deps, disk, file, live, cli, facts, environments, paths, runtime, node, web, daemon, fact, addWorker, selectedReads, processReads };
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

test("diagnostic module has no PM2 actuation dependency and importing from stdin has no host effects", () => {
  const url = new URL("./production-maintenance-runtime-diagnostic.mjs", import.meta.url);
  const source = readFileSync(url, "utf8");
  assert.doesNotMatch(source, /from\s+["'](?:pm2|node:child_process)|import\(["']pm2|\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(/);
  assert.doesNotMatch(source, /(?:dump\.pm2|\.pm2\/logs|production-maintenance-runtime\.mjs)/);
  const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `await import(${JSON.stringify(url.href)});`, encoding: "utf8", timeout: 10_000, windowsHide: true,
  });
  assert.equal(child.status, 0); assert.equal(child.stdout, ""); assert.equal(child.stderr, "");
});
