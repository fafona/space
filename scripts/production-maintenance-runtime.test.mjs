import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { captureRuntime, validateRuntimeProof, assertRuntimeStopped, stopRuntime, captureCandidate,
  verifyCandidate, stopCandidate, resumeCandidate, verifyResumedCandidate, stopResumedCandidate,
  readRuntimeHandoffEnvironment, readDeploymentHandoffFields } from "./production-maintenance-runtime.mjs";

const OLD = "a".repeat(40); const TARGET = "b".repeat(40); const SECRET = "PRIVATE_DO_NOT_PERSIST";
const BOOT = "12345678-1234-1234-1234-123456789012";
const input = () => ({ appDir: "/srv/faolla", appName: "faolla", appPort: 3000, expectedOldSha: OLD });
const id = (number) => `1:${number}:10:20:30:1:1000:33152`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture(options = {}) {
  const calls = []; const facts = new Map(); const disks = new Map(); const envs = new Map();
  let entries = []; let currentBuild = OLD; let boot = BOOT; let pause = "1"; let nextPid = 301;
  const runtime = (sha) => `/srv/faolla.releases/${sha.slice(0, 12)}-20260909120000`;
  const process = (pid, cwd, parentPid = 10) => ({ pid, parentPid, startTicks: String(pid + 100), processIdentity: id(pid),
    uid: 1000, cwd, cwdIdentity: id(pid + 100), executable: "/usr/bin/node", executableIdentity: id(999), commandLineDigest: hash(String(pid)) });
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
        exec_interpreter: "node", created_at: 100000, pm_uptime: 200000, restart_time: 0, PRIVATE: SECRET } });
    if (state === "online") facts.set(pid, process(pid, cwd));
  }
  add("web", 101);
  if (options.worker !== "absent") add("worker", 201, OLD, options.worker === "inactive" ? "stopped" : "online");
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
    ownedProcesses: (pid) => [structuredClone(facts.get(pid)), ...[...facts.values()].filter((fact) => fact.parentPid === pid)],
    runtimeIdentity: (path) => [...disks.values()].find((disk) => disk.runtime === path).runtimeIdentity,
    file(path) {
      const disk = [...disks.values()].find((disk) => path.startsWith(disk.runtime + "/"));
      return path.endsWith("/BUILD_ID") ? { identity: disk.nextBuildIdentity, hash: disk.nextBuildDigest }
        : { identity: disk.nextEntryIdentity, hash: "c".repeat(64) };
    },
    processesInRuntime: (cwd) => [...facts.values()].filter((fact) => fact.cwd === cwd).map((fact) => fact.pid),
    readPause: () => pause,
    portEmpty: () => !entries.some((entry) => entry.name === "faolla" && entry.pid > 0),
    run(command, args, environment) {
      calls.push({ command, args, environment }); assert.equal(command, "pm2");
      if (args[0] === "jlist") return JSON.stringify(entries);
      if (args[0] === "delete") {
        const entry = entries.find((entry) => entry.pm_id === Number(args[1])); assert.ok(entry);
        facts.delete(entry.pid); entries = entries.filter((item) => item !== entry); return "";
      }
      assert.equal(args[0], "start"); assert.equal(environment.FAOLLA_BACKGROUND_JOBS_PAUSED, "0");
      pause = "0"; add(args[1].endsWith("/next") ? "web" : "worker", nextPid++); return "";
    },
  };
  return { deps, calls, facts, envs, disks, runtime, process, entries: () => entries,
    setBoot: (value) => { boot = value; }, setPause: (value) => { pause = value; },
    installCandidate() { currentBuild = TARGET; pause = "1"; add("web", nextPid++); } };
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
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); const original = f.deps.run;
  f.deps.run = (...args) => { const result = original(...args); if (args[1][0] === "delete") throw new Error(SECRET); return result; };
  await stopRuntime(proof, f.deps);
  assert.equal(f.calls.filter((call) => call.args[0] === "delete").length, 2);
});

test("failed stop never issues unverified PID kill or resumes services", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); const original = f.deps.run;
  f.deps.run = (command, args, env) => args[0] === "delete" ? (() => { f.calls.push({ command, args }); throw new Error(SECRET); })() : original(command, args, env);
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
    const candidate = await captureCandidate(proof, TARGET, "1", f.deps); const original = f.deps.run;
    f.deps.run = (...args) => {
      const result = original(...args);
      if (args[1][0] === "start" && args[1][1].endsWith(failKind === "web" ? "/next" : "/cli.mjs")) throw new Error(SECRET);
      return result;
    };
    await assert.rejects(resumeCandidate(proof, candidate, TARGET, f.deps), { message: "production_maintenance_runtime_resume_failed_stopped" });
    await assertRuntimeStopped(proof, f.deps);
    assert.equal(f.calls.filter((call) => call.args[0] === "start").length, failKind === "web" ? 1 : 2);
  }
});

test("end partial cleanup with ambiguous launched metadata reports unknown and never guesses another target", async () => {
  const f = fixture(); const proof = await captureRuntime(input(), f.deps); await stopRuntime(proof, f.deps); f.installCandidate();
  const candidate = await captureCandidate(proof, TARGET, "1", f.deps); const original = f.deps.run;
  f.deps.run = (...args) => {
    const result = original(...args);
    if (args[1][0] === "start") { f.entries().find((row) => row.name === "faolla").pm2_env.pm_exec_path = "/unowned/next"; throw new Error(SECRET); }
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
    let startupAt = 0; const originalRun = f.deps.run;
    f.deps.run = (...args) => { if (args[1][0] === "start") startupAt = elapsed; return originalRun(...args); };
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
