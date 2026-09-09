import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { captureRuntime, validateRuntimeProof, assertRuntimeStopped, stopRuntime, captureCandidate,
  verifyCandidate, stopCandidate, resumeCandidate, verifyResumedCandidate, stopResumedCandidate,
  readRuntimeHandoffEnvironment, readDeploymentHandoffFields, startCandidate, reconcileMaintenanceLaunches,
  persistResumedDump, verifyResumedDump, validateResumedDumpProof } from "./production-maintenance-runtime.mjs";
import { pm2RegistryDigest } from "./production-maintenance-pm2-adapter.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";

const OLD = "a".repeat(40); const TARGET = "b".repeat(40); const SECRET = "PRIVATE_DO_NOT_PERSIST";
const BOOT = "12345678-1234-1234-1234-123456789012";
const input = () => ({ appDir: "/srv/faolla", appName: "faolla", appPort: 3000, expectedOldSha: OLD });
const id = (number) => `1:${number}:10:20:30:1:1000:33152`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture(options = {}) {
  const calls = []; const facts = new Map(); const disks = new Map(); const envs = new Map();
  let entries = []; let currentBuild = OLD; let boot = BOOT; let pause = "1"; let nextPid = 301;
  let journal = null; const launchEnvironments = new Map();
  const runtime = (sha) => `/srv/faolla.releases/${sha.slice(0, 12)}-20260909120000`;
  const process = (pid, cwd, parentPid = 10) => ({ pid, parentPid, startTicks: String(pid + 100), processIdentity: id(pid),
    uid: 1000, cwd, cwdIdentity: [...disks.values()].find((disk) => disk.runtime === cwd)?.runtimeIdentity ?? id(pid + 100), executable: "/usr/bin/node", executableIdentity: id(999), commandLineDigest: hash(String(pid)) });
  const daemon = process(10, "/srv/pm2", 1); facts.set(10, daemon);
  for (const [sha, number] of [[OLD, 1], [TARGET, 2]]) {
    const disk = { runtime: runtime(sha), runtimeIdentity: id(number), environmentIdentity: id(number + 10),
      environmentDigest: hash(sha + "env"), nextBuildIdentity: id(number + 20), nextBuildDigest: hash(sha),
      nextEntryPath: runtime(sha) + "/node_modules/next/dist/bin/next", nextEntryIdentity: id(number + 30) };
    disks.set(sha, disk);
    envs.set(runtime(sha), { buildId: sha, internalUrl: "http://127.0.0.1:8000", publicUrl: "https://supabase.example.test",
      anonKey: SECRET, rolloutStatus: "explicit", staffBusinessRbacMode: "off", staffBusinessRbacSiteIds: "",
      canonicalPortalOrigin: "https://launch.faolla.com", directoryIdentity: "1:2:3:4:1:1000:16832",
      fileIdentity: disk.environmentIdentity, sha256: disk.environmentDigest });
  }
  function add(kind, pid, sha = currentBuild, state = "online") {
    const cwd = runtime(sha); const name = "faolla" + (kind === "web" ? "" : "-enterprise-automation-worker");
    const pmId = kind === "web" ? 1 : 2;
    entries.push({ pid: state === "online" ? pid : 0, pm_id: pmId, name,
      pm2_env: { pm_id: pmId, name, status: state, exec_mode: "fork_mode", node_args: [],
        args: kind === "web" ? ["start", "-p", "3000"] : [cwd + "/scripts/run-merchant-enterprise-automation-worker.ts"],
        pm_cwd: cwd, pm_exec_path: cwd + (kind === "web" ? "/node_modules/next/dist/bin/next" : "/node_modules/tsx/dist/cli.mjs"),
        exec_interpreter: "node", created_at: 100000, pm_uptime: 200000, restart_time: 0, PRIVATE: SECRET,
        watch: false, cron_restart: null, autorestart: true, FAOLLA_BACKGROUND_JOBS_PAUSED: null, nonce: null, envDigest: null } });
    if (state === "online") facts.set(pid, process(pid, cwd));
  }
  add("web", 101);
  if (options.worker !== "absent") add("worker", 201, OLD, options.worker === "inactive" ? "stopped" : "online");
  const flags = { MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: ["absent", "inactive"].includes(options.worker) ? "false" : "true", MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: "false" };
  const environment = (paused) => ({ SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000", NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SECRET, MERCHANT_STAFF_BUSINESS_RBAC_MODE: "off", MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: "",
    FAOLLA_CANONICAL_PORTAL_ORIGIN: "https://launch.faolla.com", FAOLLA_BACKGROUND_JOBS_PAUSED: paused, PORT: "3000", ...flags });
  const envHash = (env) => hash(JSON.stringify(Object.fromEntries(Object.keys(env).sort().map((key) => [key, env[key]]))));
  const binding = () => ({ operationId: "12345678-1234-4234-8234-123456789012", targetSha: TARGET, appName: "faolla", appPort: 3000,
    daemon: { pid: 10, uid: 1000, startTicks: daemon.startTicks, bootId: BOOT, executable: daemon.executable, executableIdentity: daemon.executableIdentity },
    release: { path: runtime(TARGET), identity: disks.get(TARGET).runtimeIdentity, buildDigest: disks.get(TARGET).nextBuildDigest } });
  const journalOps = {
    checkpoint(value) { calls.push({ command: "journal-checkpoint", args: [structuredClone(value)] }); },
    read: (role) => journal ? structuredClone(journal.slots[role]) : null,
    attempt(role, disk, environmentDigest) {
      assert.deepEqual(disk, disks.get(TARGET)); const index = ["paused-web", "resumed-web", "worker"].indexOf(role);
      journal ??= createMaintenanceLaunchJournal(binding());
      if (!journal.slots[role]) journal = planMaintenanceLaunch(journal, binding(), { role, sequence: index + 1,
        nonce: `12345678-1234-4234-8234-12345678901${index}`, environmentDigest });
      journal = transitionMaintenanceLaunch(journal, binding(), { role, sequence: index + 1, nonce: journal.slots[role].nonce, phase: "attempted" });
      calls.push({ command: "journal-attempted", args: [role] }); return journal.slots[role].nonce;
    },
    confirm(role, observation) {
      const slot = journal.slots[role]; journal = transitionMaintenanceLaunch(journal, binding(), {
        role, sequence: slot.sequence, nonce: slot.nonce, phase: "confirmed", observation: { ...binding(), role, sequence: slot.sequence, ...observation } });
    },
    unknown(role) {
      const slot = journal.slots[role]; journal = transitionMaintenanceLaunch(journal, binding(), { role, sequence: slot.sequence, nonce: slot.nonce, phase: "unknown" });
    },
  };
  function spawned(kind, env, nonce) {
    const pid = nextPid++; add(kind, pid); const row = entries.at(-1);
    pause = env.FAOLLA_BACKGROUND_JOBS_PAUSED;
    Object.assign(row.pm2_env, { autorestart: pause !== "1", FAOLLA_BACKGROUND_JOBS_PAUSED: pause, nonce, envDigest: envHash(env) });
    launchEnvironments.set(pid, { ...env, FAOLLA_MAINTENANCE_LAUNCH_NONCE: nonce });
    return row;
  }
  function observation(row) {
    const e = row.pm2_env, p = facts.get(row.pid);
    const metadata = { pmCwd: e.pm_cwd, pmExecPath: e.pm_exec_path, args: e.args, nodeArgs: [], execMode: e.exec_mode,
      execInterpreter: e.exec_interpreter, watch: e.watch, cronRestart: e.cron_restart, autorestart: e.autorestart,
      backgroundPause: e.FAOLLA_BACKGROUND_JOBS_PAUSED, nonce: e.nonce, envDigest: e.envDigest };
    return { observedNonce: e.nonce, environmentDigest: e.envDigest, instance: {
      ...p, pmId: row.pm_id, createdAt: e.created_at, pmUptime: e.pm_uptime, restartTime: e.restart_time, metadataDigest: hash(JSON.stringify(metadata)),
    } };
  }
  const deps = {
    nodePath: "/usr/bin/node", boot: () => boot, sleep: async () => {}, current: () => runtime(currentBuild),
    disk(_dir, sha) { assert.equal(currentBuild, sha); return structuredClone(disks.get(sha)); },
    supervision: async () => {
      const web = entries.find((entry) => entry.name === "faolla");
      return { healthVerified: true, ownership: { state: "owned", mode: "direct", pid: web?.pid, daemonPid: 10 },
        listener: { state: web?.pid ? "single" : "absent", pid: web?.pid || 0, chain: web?.pid ? [facts.get(web.pid), daemon] : [] } };
    },
    readRollback(path, sha) { assert.equal(envs.get(path.slice(0, -11)).buildId, sha); return structuredClone(envs.get(path.slice(0, -11))); },
    readProcessEnvironment(pid, cwd) { return { ...structuredClone(envs.get(cwd)), status: "present", rolloutStatus: "present", startTicks: facts.get(Number(pid)).startTicks }; },
    readProcess: (pid) => facts.has(pid) ? structuredClone(facts.get(pid)) : null,
    ownedProcesses: (pid) => {
      const ids = [pid];
      for (let i = 0; i < ids.length; i++) ids.push(...[...facts.values()].filter((fact) => fact.parentPid === ids[i]).map((fact) => fact.pid));
      return ids.map((id) => structuredClone(facts.get(id)));
    },
    runtimeIdentity: (path) => [...disks.values()].find((disk) => disk.runtime === path).runtimeIdentity,
    file(path) {
      const disk = [...disks.values()].find((disk) => path.startsWith(disk.runtime + "/"));
      return path.endsWith("/BUILD_ID") ? { identity: disk.nextBuildIdentity, hash: disk.nextBuildDigest }
        : { identity: disk.nextEntryIdentity, hash: "c".repeat(64) };
    },
    processesInRuntime: (cwd) => [...facts.values()].filter((fact) => fact.cwd === cwd).map((fact) => fact.pid),
    readPause: () => pause,
    readLaunchEnvironment: (pid) => structuredClone(launchEnvironments.get(pid)), launchJournal: journalOps,
    workerFlags(path) { const e = envs.get(path.slice(0, -11)); return { identity: e.fileIdentity, hash: e.sha256, flags: { ...flags } }; },
    portEmpty: () => !entries.some((entry) => entry.name === "faolla" && entry.pid > 0),
    async pm2Registry(actualDaemon, actualBoot) {
      assert.deepEqual(actualDaemon, facts.get(10)); assert.equal(actualBoot, boot);
      calls.push({ command: "adapter-inspect", args: ["jlist"] });
      return entries.map((entry) => {
        const { PRIVATE, ...env } = entry.pm2_env; assert.equal(PRIVATE, SECRET);
        return { ...structuredClone(entry), pm2_env: { ...structuredClone(env), node_args: [undefined, null, ""].includes(env.node_args) ? [] : env.node_args } };
      });
    },
    async pm2Control(actualDaemon, actualBoot, request) {
      assert.deepEqual(actualDaemon, facts.get(10)); assert.equal(actualBoot, boot);
      if (request.action === "prepare") {
        const launch = request.launch, kind = launch.role === "final-worker" ? "worker" : "web";
        assert.equal(journal.slots[kind === "worker" ? "worker" : launch.role === "candidate-web" ? "paused-web" : "resumed-web"].phase, "attempted");
        calls.push({ command: "adapter-control", args: ["start", launch.release + (kind === "web" ? "/node_modules/next/dist/bin/next" : "/node_modules/tsx/dist/cli.mjs")], environment: launch.env });
        spawned(kind, launch.env, launch.nonce);
        return { version: 1, pm2Version: "6.0.14", peerVerified: true, registry: await deps.pm2Registry(actualDaemon, actualBoot), acknowledged: true };
      }
      assert.equal(request.action, "delete");
      const entry = entries.find((row) => row.pm_id === request.expected.pm_id); assert.ok(entry);
      assert.equal(entry.pid, request.expectedProcess.pid); assert.equal(request.expectedProcess.bootId, BOOT);
      calls.push({ command: "adapter-control", args: ["delete", String(entry.pm_id)], request });
      for (const fact of deps.ownedProcesses(entry.pid)) facts.delete(fact.pid);
      entries = entries.filter((item) => item !== entry);
      return { version: 1, pm2Version: "6.0.14", peerVerified: true, registry: [], acknowledged: true };
    },
    run() { throw new Error("CLI fallback forbidden"); },
  };
  return { deps, calls, facts, envs, disks, runtime, process, flags, journal: () => journal, entries: () => entries,
    setBoot: (value) => { boot = value; }, setPause: (value) => { pause = value; },
    switchCandidate() { currentBuild = TARGET; },
    installCandidate() {
      currentBuild = TARGET; const env = environment("1");
      const nonce = journalOps.attempt("paused-web", disks.get(TARGET), envHash(env));
      const row = spawned("web", env, nonce); journalOps.confirm("paused-web", observation(row));
    } };
}

test("capture freezes direct owner, environment equality and worker without raw secrets", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps);
  assert.equal(proof.web.pm2.pid, 101); assert.equal(proof.worker.state, "running");
  assert.equal(proof.daemon.pid, 10); assert.equal(proof.bootId, BOOT);
  assert.equal(JSON.stringify(proof).includes(SECRET), false);
  assert.equal(JSON.stringify(proof).includes("commandLine\""), false);
  assert.deepEqual(validateRuntimeProof(proof), proof);
  assert.equal(f.calls.some((call) => call.args[0] !== "jlist"), false);
});

function nativeFixture(kind = "root_pair") {
  const f = fixture(), files = new Map(), fullFacts = new Map(); let ino = 2000;
  const fields = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"];
  const metadata = (type, changes = {}) => {
    const stat = { dev: 1, ino: ++ino, size: type === "directory" ? 4096 : 32, mtimeNs: 4, ctimeNs: 5,
      nlink: type === "directory" ? 2 : 1, uid: 1000, mode: type === "directory" ? 0o040755 : 0o100755, ...changes };
    return { identity: fields.map((key) => String(stat[key])).join(":"), uid: stat.uid, mode: stat.mode,
      size: stat.size, nlink: stat.nlink, type };
  };
  const put = (path, type = "directory", changes = {}, content = "") => {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (path !== "/" && !files.has(parent)) put(parent);
    const info = metadata(type, changes); files.set(path, { info, bytes: Buffer.from(content) }); return info;
  };
  const change = (path, patch) => {
    const row = files.get(path), parts = row.info.identity.split(":");
    row.info = metadata(row.info.type, { ...Object.fromEntries(fields.map((key, i) => [key, Number(parts[i])])), ...patch });
  };
  const nativeReads = [], nativeFileReads = [];
  f.deps.architecture = "x64";
  f.deps.nativeFilesystem = {
    pathInfo(path) { nativeFileReads.push(path); return files.has(path) ? structuredClone(files.get(path).info) : null; },
    canonical: (path) => path,
    readRegular(path, limit, info) {
      assert.ok(path.endsWith("/package.json")); assert.equal(limit, 8192);
      assert.equal(files.get(path).info.identity, info.identity); return { bytes: Buffer.from(files.get(path).bytes) };
    },
  };
  f.deps.readNativeProcess = (pid) => {
    nativeReads.push(pid); assert.ok(f.facts.has(pid)); assert.ok(fullFacts.has(pid));
    return structuredClone(fullFacts.get(pid));
  };
  const addNative = (sha, workerPid, pid, pairKind = kind) => {
    const runtime = f.runtime(sha), modules = runtime + "/node_modules", nested = modules + "/tsx/node_modules";
    const name = "@esbuild/linux-x64", platform = (pairKind.startsWith("nested") ? nested : modules) + "/" + name;
    const wrapper = (pairKind.startsWith("root") ? modules : nested) + "/esbuild", paired = pairKind.endsWith("pair");
    const binary = put(platform + "/bin/esbuild", "file", { nlink: paired ? 2 : 1 });
    if (paired) { put(wrapper + "/bin"); files.set(wrapper + "/bin/esbuild", { info: structuredClone(binary), bytes: Buffer.alloc(0) }); }
    for (const [root, pkg] of [[platform, { name, version: "0.27.3" }], ...(paired ? [[wrapper,
      { name: "esbuild", version: "0.27.3", optionalDependencies: { [name]: "0.27.3" } }]] : [])]) {
      const content = JSON.stringify(pkg); put(root + "/package.json", "file", { size: Buffer.byteLength(content), mode: 0o100644 }, content);
    }
    f.disks.get(sha).runtimeIdentity = files.get(runtime).info.identity;
    const executable = platform + "/bin/esbuild", commandLine = [executable, "--service=0.27.3", "--ping"];
    const fact = { ...f.process(pid, runtime, workerPid), processIdentity: metadata("directory", { mode: 0o040700 }).identity,
      cwdIdentity: files.get(runtime).info.identity, executable, executableIdentity: binary.identity,
      commandLine, commandLineDigest: hash(Buffer.from(commandLine.join("\0") + "\0")) };
    fullFacts.set(pid, fact); const projection = { ...fact }; delete projection.commandLine; f.facts.set(pid, projection);
    return { fact, platform, wrapper, executable };
  };
  const native = addNative(OLD, 201, 202);
  return { ...f, ...native, files, fullFacts, nativeReads, nativeFileReads, change, addNative };
}

test("daemon root cwd alone is permitted while Web, worker, and descendants remain scoped to the release", async () => {
  const f = fixture(); f.facts.get(10).cwd = "/";
  const proof = await captureRuntime(input(), f.deps); assert.equal(proof.daemon.cwd, "/");
  await stopRuntime(proof, f.deps); assert.equal(await assertRuntimeStopped(proof, f.deps), true);
  for (const pid of [101, 201]) {
    const g = fixture(); g.facts.get(pid).cwd = "/";
    await assert.rejects(captureRuntime(input(), g.deps)); assert.equal(g.calls.some((c) => c.args[0] === "delete"), false);
  }
  const g = nativeFixture(); g.fact.cwd = "/"; g.facts.get(202).cwd = "/";
  await assert.rejects(captureRuntime(input(), g.deps)); assert.deepEqual(g.nativeReads, []);
});

test("worker captures supported single and paired esbuild full facts, boot and file witnesses", async () => {
  for (const kind of ["root_single", "nested_single", "root_pair", "nested_pair", "hoisted_pair"]) {
    const f = nativeFixture(kind), proof = await captureRuntime(input(), f.deps);
    const natives = proof.worker.managed.nativeProofs;
    assert.equal(natives.length, 1); assert.equal(natives[0].layout, kind); assert.equal(natives[0].bootId, BOOT);
    assert.equal(Object.keys(natives[0].process).length, 11); assert.deepEqual(natives[0].process, f.fact);
    assert.deepEqual(validateRuntimeProof(proof), proof); assert.equal(proof.web.nativeProofs, undefined);
    assert.equal(JSON.stringify(proof).includes(SECRET), false);
    await stopRuntime(proof, f.deps); assert.equal(await assertRuntimeStopped(proof, f.deps), true);
    assert.deepEqual(f.calls.filter((c) => c.args[0] === "delete").map((c) => c.args[1]), ["2", "1"]);
  }
});

test("native Web descendants and unknown or disconnected worker processes never reach stop", async () => {
  for (const mode of ["web", "unknown", "reparented", "root-native"]) {
    const f = nativeFixture();
    if (mode === "web") { f.fact.parentPid = 101; f.facts.get(202).parentPid = 101; }
    if (mode === "unknown") {
      f.fact.executable = f.runtime(OLD) + "/unknown/esbuild"; f.fact.commandLine[0] = f.fact.executable;
      f.fact.commandLineDigest = hash(Buffer.from(f.fact.commandLine.join("\0") + "\0"));
      Object.assign(f.facts.get(202), { executable: f.fact.executable, commandLineDigest: f.fact.commandLineDigest });
    }
    if (mode === "reparented") f.fact.parentPid = 999;
    if (mode === "root-native") Object.assign(f.facts.get(201), { executable: f.fact.executable, executableIdentity: f.fact.executableIdentity });
    await assert.rejects(captureRuntime(input(), f.deps)); assert.equal(f.calls.some((c) => c.args[0] === "delete"), false);
  }
});

test("native optional schema cannot lose, duplicate, cross-bind or forge its proof", async () => {
  const f = nativeFixture(), proof = await captureRuntime(input(), f.deps);
  for (const mutate of [
    (p) => { delete p.worker.managed.nativeProofs; },
    (p) => { p.worker.managed.nativeProofs.push(p.worker.managed.nativeProofs[0]); },
    (p) => { p.worker.managed.nativeProofs[0].bootId = "87654321-1234-1234-1234-123456789012"; },
    (p) => { p.worker.managed.nativeProofs[0].context.runtime = f.runtime(TARGET); },
    (p) => { p.worker.managed.nativeProofs[0].process.parentPid = 999; },
    (p) => { p.worker.managed.nativeProofs[0].process.startTicks = "999"; },
    (p) => { p.web.nativeProofs = p.worker.managed.nativeProofs; },
    (p) => { p.worker.managed.nativeProofs[0].raw = SECRET; },
  ]) { const copy = structuredClone(proof); mutate(copy); assert.throws(() => validateRuntimeProof(copy)); }
  let invoked = 0;
  const accessor = structuredClone(proof);
  Object.defineProperty(accessor.worker.managed.nativeProofs[0], "context", { enumerable: true, get() { invoked++; } });
  assert.throws(() => validateRuntimeProof(accessor)); assert.equal(invoked, 0);
});

test("native live, package, paired-file and boot drift reject before the first delete", async () => {
  for (const kind of ["process", "pair", "package", "boot", "extra-child"]) {
    const f = nativeFixture(), proof = await captureRuntime(input(), f.deps);
    if (kind === "process") { f.fact.startTicks = "999"; f.facts.get(202).startTicks = "999"; }
    if (kind === "pair") f.change(f.wrapper + "/bin/esbuild", { ino: 777 });
    if (kind === "package") f.files.get(f.platform + "/package.json").bytes = Buffer.from("{}".padEnd(f.files.get(f.platform + "/package.json").bytes.length));
    if (kind === "boot") f.setBoot("87654321-1234-1234-1234-123456789012");
    if (kind === "extra-child") f.facts.set(999, f.process(999, f.runtime(OLD), 202));
    await assert.rejects(stopRuntime(proof, f.deps)); assert.equal(f.calls.some((c) => c.args[0] === "delete"), false);
  }
});

test("native file witnesses remain required after PID exit, including repeated stop and candidate cleanup", async () => {
  for (const action of ["held", "stop-again", "candidate"]) {
    const f = nativeFixture(), proof = await captureRuntime(input(), f.deps);
    await stopRuntime(proof, f.deps); const liveReads = f.nativeReads.length;
    assert.equal(await assertRuntimeStopped(proof, f.deps), true); assert.equal(f.nativeReads.length, liveReads);
    if (action === "candidate") f.installCandidate();
    f.change(f.wrapper + "/bin/esbuild", { ino: 888 });
    const deletes = f.calls.filter((c) => c.args[0] === "delete").length;
    await assert.rejects(action === "held" ? assertRuntimeStopped(proof, f.deps) : action === "stop-again"
      ? stopRuntime(proof, f.deps) : captureCandidate(proof, TARGET, "1", f.deps));
    assert.equal(f.calls.filter((c) => c.args[0] === "delete").length, deletes);
  }
});

test("native changes between whole-runtime observations invalidate capture without mutations", async () => {
  const f = nativeFixture(); f.deps.sleep = async () => f.change(f.wrapper + "/bin/esbuild", { ino: 999 });
  await assert.rejects(captureRuntime(input(), f.deps)); assert.equal(f.calls.some((c) => c.args[0] === "delete"), false);
});

test("registry and delete use only bound adapter methods with no CLI fallback", async () => {
  const f = fixture(); f.deps.run = () => { throw new Error("CLI_FORBIDDEN"); };
  const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps);
  assert.ok(f.calls.every((call) => ["adapter-inspect", "adapter-control"].includes(call.command)));
  for (const call of f.calls.filter((item) => item.command === "adapter-control")) {
    assert.equal(call.request.expectedProcess.bootId, BOOT);
    assert.equal(Object.keys(call.request.expectedProcess).length, 6);
    assert.equal(call.request.expected.pid, call.request.expectedProcess.pid);
    assert.equal(call.request.expected.pm_id, Number(call.args[1]));
    assert.equal(JSON.stringify(call.request).includes(SECRET), false);
  }
  const g = fixture(); g.deps.pm2Registry = async () => { throw new Error(SECRET); };
  g.deps.run = () => { assert.fail("adapter failure must never start an ambient CLI"); };
  await assert.rejects(captureRuntime(input(), g.deps)); assert.deepEqual(g.calls, []);
});

test("safe registry metadata and boot are bound across native work and before control", async () => {
  const f = fixture(), proof = await captureRuntime(input(), f.deps);
  f.entries().find((entry) => entry.pm_id === 2).pm2_env.autorestart = false;
  await assert.rejects(stopRuntime(proof, f.deps)); assert.equal(f.calls.some((c) => c.command === "adapter-control"), false);
  const g = fixture(), old = await captureRuntime(input(), g.deps), read = g.deps.pm2Registry;
  g.deps.pm2Registry = async (...args) => { const result = await read(...args); g.setBoot("87654321-1234-1234-1234-123456789012"); return result; };
  await assert.rejects(stopRuntime(old, g.deps)); assert.equal(g.calls.some((c) => c.command === "adapter-control"), false);
});

test("resumed worker captures a new release's own native proof and cleanup still requires its files", async () => {
  for (const changed of [false, true]) {
    const f = nativeFixture(), proof = await captureRuntime(input(), f.deps);
    await stopRuntime(proof, f.deps);
    f.addNative(TARGET, 999, 9999); f.facts.delete(9999); f.fullFacts.delete(9999);
    f.installCandidate(); const candidate = await captureCandidate(proof, TARGET, "1", f.deps), start = f.deps.pm2Control;
    let newNative;
    f.deps.pm2Control = async (...args) => {
      const result = await start(...args);
      if (args[2].action === "prepare" && args[2].launch.role === "final-worker") {
        const worker = f.entries().find((entry) => entry.name.endsWith("-worker"));
        newNative = f.addNative(TARGET, worker.pid, 400);
      }
      return result;
    };
    const resumed = await resumeCandidate(proof, candidate, TARGET, f.deps);
    assert.equal(resumed.worker.nativeProofs[0].context.runtime, f.runtime(TARGET));
    assert.equal(resumed.worker.nativeProofs[0].process.pid, 400);
    assert.notDeepEqual(resumed.worker.nativeProofs, proof.worker.managed.nativeProofs);
    await verifyResumedCandidate(proof, resumed, f.deps);
    if (changed) {
      f.change(newNative.wrapper + "/bin/esbuild", { ino: 8888 });
      const deletes = f.calls.filter((c) => c.command === "adapter-control").length;
      await assert.rejects(verifyResumedCandidate(proof, resumed, f.deps));
      await assert.rejects(stopResumedCandidate(proof, resumed, f.deps));
      assert.equal(f.calls.filter((c) => c.command === "adapter-control").length, deletes);
    } else {
      await stopResumedCandidate(proof, resumed, f.deps); await assertRuntimeStopped(proof, f.deps);
    }
  }
});

test("capture rejects legacy topology, environment mismatch, duplicate PM2 and unstable observations", async () => {
  for (const change of [
    (f) => { const previous = f.deps.supervision; f.deps.supervision = async () => { const value = await previous(); value.ownership.mode = "legacy"; return value; }; },
    (f) => { const previous = f.deps.readProcessEnvironment; f.deps.readProcessEnvironment = (...args) => ({ ...previous(...args), anonKey: "different" }); },
    (f) => { f.entries().push(structuredClone(f.entries()[0])); },
    (f) => { f.facts.set(555, f.process(555, f.runtime(OLD), 1)); },
    (f) => { f.deps.sleep = async () => { f.entries()[0].pm2_env.restart_time++; }; },
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(captureRuntime(input(), f.deps), { message: "production_maintenance_runtime_unverified" });
    assert.equal(f.calls.some((call) => call.args[0] === "delete"), false);
  }
});

test("PM2 empty node flags have one semantic representation but executable flags fail closed", async () => {
  for (const nodeArgs of [undefined, null, "", []]) {
    const f = fixture(); for (const row of f.entries()) row.pm2_env.node_args = nodeArgs;
    const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps);
  }
  for (const nodeArgs of ["--require /unowned.js", ["--require", "/unowned.js"], {}]) {
    const f = fixture(); f.entries()[0].pm2_env.node_args = nodeArgs;
    await assert.rejects(captureRuntime(input(), f.deps));
    assert.equal(f.calls.some((call) => call.args[0] === "delete"), false);
  }
});

test("stop deletes only frozen numeric worker then web and held remains independently verified", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps);
  await stopRuntime(proof, f.deps); assert.equal(await assertRuntimeStopped(proof, f.deps), true);
  await stopRuntime(proof, f.deps); // a fail-held recheck cannot recreate or re-delete the old instances
  assert.deepEqual(f.calls.filter((call) => call.args[0] === "delete").map((call) => call.args), [["delete", "2"], ["delete", "1"]]);
  assert.equal(f.calls.some((call) => call.args[0] === "start"), false);
});

test("missing and inactive worker are preserved without fabricated running state", async () => {
  for (const worker of ["absent", "inactive"]) {
    const f = fixture({ worker }); const proof = await captureRuntime(input(), f.deps);
    await stopRuntime(proof, f.deps); await assertRuntimeStopped(proof, f.deps);
    assert.deepEqual(f.calls.filter((call) => call.args[0] === "delete").map((call) => call.args), [["delete", "1"]]);
    f.installCandidate(); const candidate = await captureCandidate(proof, TARGET, "1", f.deps);
    assert.equal(await verifyCandidate(proof, candidate, "1", f.deps), true);
  }
});

test("replaced PM2 instance cannot be stopped using stale proof", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps);
  f.entries().find((entry) => entry.pm_id === 2).pm2_env.restart_time++;
  await assert.rejects(stopRuntime(proof, f.deps), { message: "production_maintenance_runtime_unverified" });
  assert.equal(f.calls.some((call) => call.args[0] === "delete"), false);
});

test("lost delete acknowledgement is not retried and only actual disappearance confirms stop", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); const original = f.deps.pm2Control;
  f.deps.pm2Control = async (...args) => { await original(...args); throw new Error(SECRET); };
  await stopRuntime(proof, f.deps);
  assert.equal(f.calls.filter((call) => call.args[0] === "delete").length, 2);
});

test("failed stop never issues unverified PID kill or resumes services", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps);
  f.deps.pm2Control = async (_daemon, _boot, request) => {
    f.calls.push({ command: "adapter-control", args: ["delete", String(request.expected.pm_id)] }); throw new Error(SECRET);
  };
  await assert.rejects(stopRuntime(proof, f.deps), { message: "production_maintenance_runtime_unverified" });
  assert.equal(f.calls.filter((call) => call.args[0] === "delete").length, 1);
  assert.equal(f.calls.some((call) => call.args[0] === "start"), false);
});

test("held rejects boot change, original process, foreign listener and unsupervised new runtime process", async () => {
  for (const change of [
    (f) => f.setBoot("87654321-1234-1234-1234-123456789012"),
    (f) => f.facts.set(101, f.process(101, f.runtime(OLD))),
    (f) => { f.deps.portEmpty = () => false; },
    (f) => f.facts.set(500, f.process(500, f.runtime(OLD), 1)),
    (f) => { f.envs.get(f.runtime(OLD)).sha256 = "d".repeat(64); },
  ]) {
    const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); change(f);
    await assert.rejects(assertRuntimeStopped(proof, f.deps), { message: "production_maintenance_runtime_unverified" });
  }
});

test("proof validation rejects secret fields, malformed identities and mutation after capture", async () => {
  const f = fixture(); const raw = input(); const proof = await captureRuntime(raw, f.deps); raw.appName = "other";
  assert.equal(proof.input.appName, "faolla");
  for (const change of [(copy) => { copy.secret = SECRET; }, (copy) => { copy.web.processes[0].startTicks = "0"; },
    (copy) => { copy.disk.runtime = "/srv/other"; }, (copy) => { copy.worker.state = "ready"; }]) {
    const copy = structuredClone(proof); change(copy); assert.throws(() => validateRuntimeProof(copy));
  }
});

test("candidate must be exact new build with pause1 and no resumed worker", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
  const candidate = await captureCandidate(proof, TARGET, "1", f.deps);
  assert.equal(candidate.targetSha, TARGET); assert.equal(candidate.pauseExpected, "1");
  await verifyCandidate(proof, candidate, "1", f.deps);
  f.setPause("0"); await assert.rejects(verifyCandidate(proof, candidate, "1", f.deps));
});

test("candidate failure cleanup stops only registered candidate and never old runtime", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
  const candidate = await captureCandidate(proof, TARGET, "1", f.deps); await stopCandidate(proof, candidate, f.deps);
  await assertRuntimeStopped(proof, f.deps); assert.equal(f.calls.some((call) => call.args[0] === "start"), false);
});

test("registered unhealthy candidate may be stopped by exact identity and repeated cleanup is read-only", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
  const candidate = await captureCandidate(proof, TARGET, "1", f.deps);
  f.deps.supervision = async () => { throw new Error(SECRET); };
  await stopCandidate(proof, candidate, f.deps);
  const deletes = f.calls.filter((call) => call.args[0] === "delete").length;
  await stopCandidate(proof, candidate, f.deps);
  assert.equal(f.calls.filter((call) => call.args[0] === "delete").length, deletes);
});

test("registered candidate cleanup refuses a replacement instance", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
  const candidate = await captureCandidate(proof, TARGET, "1", f.deps);
  f.entries().find((entry) => entry.name === "faolla").pm2_env.restart_time++;
  const deletes = f.calls.filter((call) => call.args[0] === "delete").length;
  await assert.rejects(stopCandidate(proof, candidate, f.deps));
  assert.equal(f.calls.filter((call) => call.args[0] === "delete").length, deletes);
});

test("explicit end restarts frozen candidate pause0 and restores only previously running worker", async () => {
  for (const worker of ["running", "inactive", "absent"]) {
    const f = fixture({ worker }); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
    const candidate = await captureCandidate(proof, TARGET, "1", f.deps);
    const resumed = await resumeCandidate(proof, candidate, TARGET, f.deps);
    assert.notEqual(resumed.candidate.web.pm2.pid, candidate.web.pm2.pid);
    assert.equal(resumed.candidate.pauseExpected, "0"); assert.equal(Boolean(resumed.worker), worker === "running");
    await verifyResumedCandidate(proof, resumed, f.deps);
    assert.ok(f.calls.filter((call) => call.args[0] === "start").every((call) => call.args[1].startsWith(f.runtime(TARGET))));
    assert.equal(f.calls.filter((call) => call.args[0] === "start").length, worker === "running" ? 2 : 1);
    await stopResumedCandidate(proof, resumed, f.deps); await assertRuntimeStopped(proof, f.deps);
  }
});

test("private handoff environment rechecks immutable disk and is never placed in persistent proof", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps);
  assert.equal((await readRuntimeHandoffEnvironment(proof, f.deps)).anonKey, SECRET);
  assert.equal(JSON.stringify(proof).includes(SECRET), false);
  f.envs.get(f.runtime(OLD)).anonKey = "changed";
  await assert.rejects(readRuntimeHandoffEnvironment(proof, f.deps));
});

test("end losing a start acknowledgement stops the newly launched fixed instance without retry", async () => {
  for (const failKind of ["web", "worker"]) {
    const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
    const candidate = await captureCandidate(proof, TARGET, "1", f.deps); const original = f.deps.pm2Control;
    f.deps.pm2Control = async (...args) => {
      const result = await original(...args);
      if (args[2].action === "prepare" && args[2].launch.role === (failKind === "web" ? "final-web" : "final-worker")) throw new Error(SECRET);
      return result;
    };
    await assert.rejects(resumeCandidate(proof, candidate, TARGET, f.deps), { message: "production_maintenance_runtime_resume_failed_stopped" });
    await assertRuntimeStopped(proof, f.deps);
    assert.equal(f.calls.filter((call) => call.args[0] === "start").length, failKind === "web" ? 1 : 2);
  }
});

test("end partial cleanup with ambiguous launched metadata reports unknown and never guesses another target", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
  const candidate = await captureCandidate(proof, TARGET, "1", f.deps); const original = f.deps.pm2Control;
  f.deps.pm2Control = async (...args) => {
    const result = await original(...args);
    if (args[2].action === "prepare") { f.entries().find((row) => row.name === "faolla").pm2_env.pm_exec_path = "/unowned/next"; throw new Error(SECRET); }
    return result;
  };
  await assert.rejects(resumeCandidate(proof, candidate, TARGET, f.deps), { message: "production_maintenance_runtime_resume_failed_unknown" });
  assert.equal(f.calls.filter((call) => call.args[0] === "start").length, 1);
  assert.equal(f.calls.filter((call) => call.args[0] === "delete").length, 3); // two old + original paused candidate
});

test("end waits for the same launched PID to become healthy without reissuing start", async () => {
  const f = fixture({ worker: "absent" }); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
  const candidate = await captureCandidate(proof, TARGET, "1", f.deps); const original = f.deps.supervision; let pending = 3; let elapsed = 0;
  f.deps.now = () => elapsed; f.deps.sleep = async (ms) => { elapsed += ms; };
  f.deps.supervision = async (...args) => {
    if (f.calls.some((call) => call.args[0] === "start") && pending-- > 0) {
      return { listener: { state: "absent", pid: 0, chain: [] }, ownership: { state: "unknown", mode: "unknown", pid: 0 }, healthVerified: false };
    }
    return original(...args);
  };
  const resumed = await resumeCandidate(proof, candidate, TARGET, f.deps);
  assert.equal(resumed.candidate.pauseExpected, "0"); assert.ok(elapsed >= 750);
  assert.equal(f.calls.filter((call) => call.args[0] === "start").length, 1);
});

test("end startup timeout cleans up and a same-name PID replacement never becomes verified", async () => {
  for (const replace of [false, true]) {
    const f = fixture({ worker: "absent" }); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
    const candidate = await captureCandidate(proof, TARGET, "1", f.deps); const original = f.deps.supervision; let elapsed = 0;
    let startupAt = 0; const originalControl = f.deps.pm2Control;
    f.deps.pm2Control = (...args) => { if (args[2].action === "prepare") startupAt = elapsed; return originalControl(...args); };
    f.deps.now = () => elapsed; f.deps.sleep = async (ms) => { elapsed += ms; };
    f.deps.supervision = async (...args) => {
      if (!f.calls.some((call) => call.args[0] === "start")) return original(...args);
      if (replace) {
        const row = f.entries().find((entry) => entry.name === "faolla");
        f.facts.delete(row.pid); row.pid = 700; row.pm2_env.pm_uptime++;
        f.facts.set(700, f.process(700, f.runtime(TARGET)));
      }
      return { listener: { state: "absent", pid: 0, chain: [] }, ownership: { state: "unknown", mode: "unknown", pid: 0 }, healthVerified: false };
    };
    await assert.rejects(resumeCandidate(proof, candidate, TARGET, f.deps), { message: replace
      ? "production_maintenance_runtime_resume_failed_unknown" : "production_maintenance_runtime_resume_failed_stopped" });
    assert.equal(f.calls.filter((call) => call.args[0] === "start").length, 1);
    assert.ok(elapsed - startupAt <= 60_000);
    if (replace) assert.equal(f.facts.has(700), true);
  }
});

test("offline shell handoff exposes exactly the frozen 27 fields without fabricating a live process", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps);
  const fields = await readDeploymentHandoffFields(proof, f.deps);
  assert.equal(Object.keys(fields).length, 27); assert.ok(Object.values(fields).every((value) => typeof value === "string"));
  assert.equal(fields.PREVIOUS_WEB_PID, "101"); assert.equal(f.facts.has(101), false);
  assert.equal(fields.PREVIOUS_BUILD_ID, OLD); assert.equal(fields.PREVIOUS_RUNTIME_DIR, f.runtime(OLD));
  assert.equal(fields.PREVIOUS_AUTOMATION_WORKER_RUNNING, "1");
  assert.equal(Buffer.from(fields.PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64, "base64").toString(), SECRET);
  assert.equal(JSON.stringify(proof).includes(SECRET), false);
});

test("candidate launch requires a persisted attempted slot and repeats only read-only confirmation", async () => {
  const f = fixture(), proof = await captureRuntime(input(), f.deps);
  await stopRuntime(proof, f.deps); f.switchCandidate();
  const candidate = await startCandidate(proof, TARGET, f.deps);
  assert.equal(candidate.pauseExpected, "1"); assert.equal(f.journal().slots["paused-web"].phase, "confirmed");
  const sends = f.calls.filter((call) => call.args[0] === "start"); assert.equal(sends.length, 1);
  assert.equal(sends[0].environment.FAOLLA_BACKGROUND_JOBS_PAUSED, "1");
  assert.deepEqual(await startCandidate(proof, TARGET, f.deps), candidate);
  assert.equal(f.calls.filter((call) => call.args[0] === "start").length, 1);
});

test("failed journal persistence or missing authority prevents every new launch", async () => {
  for (const mode of ["absent", "failed-save"]) {
    const f = fixture(), proof = await captureRuntime(input(), f.deps);
    await stopRuntime(proof, f.deps); f.switchCandidate();
    if (mode === "absent") delete f.deps.launchJournal;
    else f.deps.launchJournal.attempt = () => { throw new Error(SECRET); };
    await assert.rejects(startCandidate(proof, TARGET, f.deps));
    assert.equal(f.calls.filter((call) => call.args[0] === "start").length, 0);
  }
  const f = fixture(), proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
  const candidate = await captureCandidate(proof, TARGET, "1", f.deps), before = f.calls.length;
  delete f.deps.launchJournal; await assert.rejects(resumeCandidate(proof, candidate, TARGET, f.deps));
  assert.equal(f.calls.slice(before).some((call) => call.command === "adapter-control"), false);
});

test("lost candidate ACK is reconciled with nonce/proc evidence without resending", async () => {
  const f = fixture(), proof = await captureRuntime(input(), f.deps);
  await stopRuntime(proof, f.deps); f.switchCandidate(); const original = f.deps.pm2Control;
  f.deps.pm2Control = async (...args) => { const answer = await original(...args); if (args[2].action === "prepare") throw new Error(SECRET); return answer; };
  await assert.rejects(startCandidate(proof, TARGET, f.deps));
  assert.equal(f.journal().slots["paused-web"].phase, "unknown");
  const result = await reconcileMaintenanceLaunches(proof, f.disks.get(TARGET), TARGET, f.deps);
  assert.equal(result.candidate.pauseExpected, "1"); assert.equal(result.resumed, null);
  assert.equal(f.journal().slots["paused-web"].phase, "confirmed");
  assert.equal(f.calls.filter((call) => call.args[0] === "start").length, 1);
  await stopCandidate(proof, result.candidate, f.deps); await assertRuntimeStopped(proof, f.deps);
});

test("unknown launch cannot adopt a foreign nonce, changed environment or restarted generation", async () => {
  for (const change of [(f) => { f.entries()[0].pm2_env.nonce = "12345678-1234-4234-8234-000000000000"; },
    (f) => { f.entries()[0].pm2_env.envDigest = "f".repeat(64); },
    (f) => { f.entries()[0].pm2_env.restart_time = 1; },
    (f) => { const original = f.deps.readLaunchEnvironment; f.deps.readLaunchEnvironment = (pid) => ({ ...original(pid), PORT: "3001" }); }]) {
    const f = fixture(), proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.switchCandidate();
    const original = f.deps.pm2Control;
    f.deps.pm2Control = async (...args) => { const answer = await original(...args); if (args[2].action === "prepare") throw new Error(SECRET); return answer; };
    await assert.rejects(startCandidate(proof, TARGET, f.deps)); change(f);
    const mutations = f.calls.filter((call) => call.command === "adapter-control").length;
    await assert.rejects(reconcileMaintenanceLaunches(proof, f.disks.get(TARGET), TARGET, f.deps));
    await assert.rejects(startCandidate(proof, TARGET, f.deps));
    assert.equal(f.calls.filter((call) => call.command === "adapter-control").length, mutations);
  }
});

async function resumedFixture() {
  const f = fixture(), proof = await captureRuntime(input(), f.deps);
  await stopRuntime(proof, f.deps); f.switchCandidate();
  const candidate = await startCandidate(proof, TARGET, f.deps), resumed = await resumeCandidate(proof, candidate, TARGET, f.deps);
  const target = { version: 1, socketPath: "/srv/pm2/rpc.sock",
    daemon: { pid: proof.daemon.pid, uid: proof.daemon.uid, startTicks: proof.daemon.startTicks, bootId: BOOT,
      executable: proof.daemon.executable, executableIdentity: proof.daemon.executableIdentity },
    chain: [["1", "2", "16832", "1000", "1000"], ["1", "3", "16832", "1000", "1000"]], dump: null, backup: null };
  let saved = null;
  f.deps.capturePm2DumpTarget = async () => structuredClone(target);
  f.deps.persistPm2Dump = async (daemon, boot, registry, actualTarget) => {
    assert.deepEqual(daemon, proof.daemon); assert.equal(boot, BOOT); assert.deepEqual(actualTarget, target);
    f.calls.push({ command: "dump-save", args: [] });
    saved = { version: 1, pm2Version: "6.0.14", peerVerified: true, saved: true, processCount: registry.length,
      registryHash: pm2RegistryDigest(registry), target: { ...target, dump: { identity: id(1234), sha256: hash("private dump") } } };
    return structuredClone(saved);
  };
  f.deps.verifyPm2Dump = async (_daemon, _boot, registry, actualReceipt) => {
    assert.deepEqual(actualReceipt, saved); assert.equal(actualReceipt.registryHash, pm2RegistryDigest(registry)); return true;
  };
  return { f, proof, resumed };
}
test("final dump binds healthy resumed processes and full filtered registry with private receipt", async () => {
  const { f, proof, resumed } = await resumedFixture();
  const dump = await persistResumedDump(proof, resumed, f.deps);
  assert.equal(f.calls.filter((call) => call.command === "dump-save").length, 1);
  assert.deepEqual(validateResumedDumpProof(dump, proof, resumed), dump);
  assert.equal(await verifyResumedDump(proof, resumed, dump, f.deps), true);
  assert.equal(JSON.stringify(dump).includes(SECRET), false);
  for (const change of [(d) => { d.resumed.candidate.web.pm2.pid++; }, (d) => { d.receipt.registryHash = "f".repeat(64); },
    (d) => { d.registry[0].pid++; }, (d) => { d.receipt.target.daemon.startTicks = "1"; }]) {
    const wrong = structuredClone(dump); change(wrong); assert.throws(() => validateResumedDumpProof(wrong, proof, resumed));
  }
});
test("dump registry drift and failed verification never become a verified final dump", async () => {
  const { f, proof, resumed } = await resumedFixture();
  const original = f.deps.capturePm2DumpTarget;
  f.deps.capturePm2DumpTarget = async () => { const t = await original(); f.entries()[0].pm2_env.restart_time++; return t; };
  await assert.rejects(persistResumedDump(proof, resumed, f.deps));
  assert.equal(f.calls.some((call) => call.command === "dump-save"), false);
  const second = await resumedFixture(); second.f.deps.verifyPm2Dump = async () => false;
  await assert.rejects(persistResumedDump(second.proof, second.resumed, second.f.deps));
  assert.equal(second.f.calls.filter((call) => call.command === "dump-save").length, 1);
});
test("failed resume checkpoints complete evidence before cleanup; checkpoint failure never deletes final PID", async () => {
  for (const failed of [false, true]) {
    const f = fixture({ worker: "absent" }), proof = await captureRuntime(input(), f.deps);
    await stopRuntime(proof, f.deps); f.switchCandidate();
    const candidate = await startCandidate(proof, TARGET, f.deps), original = f.deps.pm2Control;
    f.deps.pm2Control = async (...args) => { const result = await original(...args); if (args[2].action === "prepare") throw new Error(SECRET); return result; };
    if (failed) f.deps.launchJournal.checkpoint = () => { throw new Error(SECRET); };
    const before = f.calls.length;
    await assert.rejects(resumeCandidate(proof, candidate, TARGET, f.deps), { message: failed
      ? "production_maintenance_runtime_resume_failed_unknown" : "production_maintenance_runtime_resume_failed_stopped" });
    const calls = f.calls.slice(before), checkpoint = calls.findIndex((call) => call.command === "journal-checkpoint");
    if (failed) assert.equal(f.entries().filter((row) => row.pid > 0).length, 1);
    else {
      assert.ok(checkpoint > 0); assert.equal(calls[checkpoint].args[0].candidate.pauseExpected, "0");
      assert.ok(calls.slice(checkpoint + 1).some((call) => call.command === "adapter-control" && call.args[0] === "delete"));
      await assertRuntimeStopped(proof, f.deps);
    }
  }
});
