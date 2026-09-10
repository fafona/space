import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { captureRuntime, stopRuntime, startCandidate, resumeCandidate, reconcileMaintenanceLaunches, assertRuntimeStopped,
  validateRuntimeProof, validateCandidateProof, validateResumedCandidateProof, validateLaunchDisk } from "./production-maintenance-runtime.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";
import { createMaintenanceLaunchCallbacks, validateMaintenanceState, validateMaintenanceLaunchProofBindings } from "./production-maintenance-control.mjs";

// Independent in-memory host fixture; only the real runtime/callback protocol is
// under test. No process, host file, production credential or socket is accessed.
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
        assert.equal((await deps.launchJournal.read(kind === "worker" ? "worker" : launch.role === "candidate-web" ? "paused-web" : "resumed-web")).phase, "attempted");
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


async function integratedFixture(options = {}) {
  const f = fixture(options), proof = await captureRuntime(input(), f.deps);
  await stopRuntime(proof, f.deps); f.switchCandidate();
  const state = { version: 2, revision: 0, operationId: "12345678-1234-4234-8234-123456789012",
    targetSha: TARGET, expectedOldSha: OLD, ...input(), bootId: BOOT, createdAt: 1, phase: "held",
    runtime: proof, ingress: {}, database: {}, publicSupabaseUrl: "https://database.invalid", tokenHash: "d".repeat(64),
    candidate: null, resumed: null, launchDisk: null, launchJournal: null, finalDump: null };
  const saves = [];
  function validateProofs(s) {
    validateRuntimeProof(s.runtime);
    if(s.launchDisk) validateLaunchDisk(s.launchDisk, s.runtime, s.targetSha);
    if(s.candidate) validateCandidateProof(s.candidate, s.runtime);
    if(s.resumed) validateResumedCandidateProof(s.resumed, s.runtime);
    validateMaintenanceLaunchProofBindings(s);
  }
  const ops = { uuid: randomUUID, bootId: () => BOOT, now: () => 1, validateLaunchDisk, validateProofs,
    async save(s) { validateMaintenanceState(s, s, BOOT, 1); validateProofs(s); s.revision++; saves.push(structuredClone(s)); } };
  f.deps.launchJournal = createMaintenanceLaunchCallbacks(state, ops);
  return { f, proof, state, saves, ops, validateProofs };
}
test("real runtime and control callbacks agree on complete paused and resumed worker identities", async () => {
  const { f, proof, state, saves, validateProofs } = await integratedFixture();
  state.candidate = await startCandidate(proof, TARGET, f.deps); state.phase = "candidate"; validateProofs(state);
  assert.equal(state.launchJournal.slots["paused-web"].phase, "confirmed");
  assert.equal(saves[2].launchJournal.slots["paused-web"].phase, "attempted");
  state.phase = "resuming";
  state.resumed = await resumeCandidate(proof, state.candidate, TARGET, f.deps); validateProofs(state);
  assert.equal(state.launchJournal.slots["resumed-web"].instance.pid, state.resumed.candidate.web.pm2.pid);
  assert.equal(state.launchJournal.slots.worker.instance.pid, state.resumed.worker.pm2.pid);
  assert.equal(JSON.stringify(saves).includes(SECRET), false);
});
test("real callback lost ACK reconciles only the recorded nonce without a second prepare", async () => {
  const { f, proof, state, validateProofs } = await integratedFixture(), original = f.deps.pm2Control;
  f.deps.pm2Control = async (...args) => { const r = await original(...args); if(args[2].action === "prepare") throw new Error(SECRET); return r; };
  await assert.rejects(startCandidate(proof, TARGET, f.deps));
  assert.equal(state.launchJournal.slots["paused-web"].phase, "unknown");
  const recovered = await reconcileMaintenanceLaunches(proof, f.disks.get(TARGET), TARGET, f.deps);
  state.candidate = recovered.candidate; validateProofs(state);
  assert.equal(state.launchJournal.slots["paused-web"].phase, "confirmed");
  assert.equal(f.calls.filter(c => c.command === "adapter-control" && c.args[0] === "start").length, 1);
});
test("real checkpoint retains full final proof before already-gone cleanup", async () => {
  const { f, proof, state, saves, validateProofs } = await integratedFixture({ worker: "absent" });
  state.candidate = await startCandidate(proof, TARGET, f.deps); state.phase = "resuming";
  const original = f.deps.pm2Control;
  f.deps.pm2Control = async (...args) => { const r = await original(...args); if(args[2].action === "prepare") throw new Error(SECRET); return r; };
  await assert.rejects(resumeCandidate(proof, state.candidate, TARGET, f.deps), { message: "production_maintenance_runtime_resume_failed_stopped" });
  assert.equal(state.candidate.pauseExpected, "0"); validateProofs(state);
  assert.ok(saves.some(s => s.candidate?.pauseExpected === "0"));
  await assertRuntimeStopped(proof, f.deps);
});
