import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { assertFailedCandidateGenerationStopped, assertFailedCandidateStopped, captureFailedCandidateBaseline, validateFailedCandidateBaseline, verifyFailedCandidateBaseline } from "./production-maintenance-failed-candidate-inspection.mjs";
import { readFailedCandidateHandoffFields } from "./production-maintenance-attempt-handoff.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";

const PIN = "d8e8abb8926441caef71867c15539fdafcb7cc9dbe0f77bd84ebc9548d39a0f8";
const BOOT = "e6531ec9-db4a-4216-b87a-7cc858197eaa";
const U = "eb81284a-09c4-4514-8f16-38eaf6acc1e4";
const O = "cd943076ebda758b70bf2f2270a508c774b726d6";
const T = "f3104de19aa59e527c7b94a99850d151448da8cd";
const APP = "/www/wwwroot/merchant-space";
const realCreateHash = crypto.createHash;
const hash = value => realCreateHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const id = (inode, kind = "file") => `1:${inode}:64:10:20:${kind === "directory" ? 2 : 1}:0:${kind === "directory" ? 16877 : kind === "link" ? 41471 : 33188}`;
function fixture() {
  const disks = new Map(), environments = new Map(), facts = new Map(), calls = [];
  const config = { internalUrl: "http://fixture.invalid", publicUrl: "https://fixture.invalid", anonKey: "SYNTHETIC_PRIVATE", rolloutStatus: "explicit",
    staffBusinessRbacMode: "off", staffBusinessRbacSiteIds: "", canonicalPortalOrigin: "https://fixture.invalid" };
  for (const [sha, number] of [[O, 10], [T, 20]]) {
    const runtime = `${APP}.releases/${sha.slice(0, 12)}-20260913200000`;
    const disk = { runtime, runtimeIdentity: id(number, "directory"), environmentIdentity: id(number + 1), environmentDigest: hash(sha + "env"),
      nextBuildIdentity: id(number + 2), nextBuildDigest: hash(sha), nextEntryPath: runtime + "/node_modules/next/dist/bin/next", nextEntryIdentity: id(number + 3) };
    const environment = { directoryIdentity: "1:2:10:20:2:0:16877", fileIdentity: disk.environmentIdentity, sha256: disk.environmentDigest, configurationHash: hash(config) };
    disks.set(sha, disk); environments.set(sha, environment);
  }
  const proc = (pid, cwd, cwdIdentity, parentPid = 10) => ({ pid, parentPid, startTicks: String(pid + 100), processIdentity: id(pid, "directory"), uid: 0,
    cwd, cwdIdentity, executable: "/usr/bin/node", executableIdentity: id(500), commandLineDigest: hash(String(pid)) });
  const daemon = proc(10, "/", id(1, "directory"), 1); facts.set(10, daemon);
  const managed = (pid, sha, worker = false) => ({ pm2: { pmId: pid, pid, name: "merchant-space" + (worker ? "-enterprise-automation-worker" : ""),
    status: "online", createdAt: 10000, pmUptime: 10000, restartTime: 0, metadataHash: hash(String(pid) + "metadata") },
    processes: [proc(pid, disks.get(sha).runtime, disks.get(sha).runtimeIdentity)] });
  const runtime = { version: 1, input: { appDir: APP, appName: "merchant-space", appPort: 3000, expectedOldSha: O }, bootId: BOOT,
    disk: disks.get(O), environment: environments.get(O), daemon, web: managed(101, O), worker: { state: "running", managed: managed(102, O, true) } };
  const candidate = { version: 1, targetSha: T, pauseExpected: "1", disk: disks.get(T), environment: environments.get(T), daemon, web: managed(201, T) };
  const binding = { operationId: U, targetSha: T, appName: "merchant-space", appPort: 3000,
    daemon: { pid: 10, uid: 0, startTicks: daemon.startTicks, bootId: BOOT, executable: daemon.executable, executableIdentity: daemon.executableIdentity },
    release: { path: candidate.disk.runtime, identity: candidate.disk.runtimeIdentity, buildDigest: candidate.disk.nextBuildDigest } };
  const nonce = "12345678-1234-4234-8234-123456789012", environmentDigest = hash("launch environment");
  let journal = planMaintenanceLaunch(createMaintenanceLaunchJournal(binding), binding, { role: "paused-web", sequence: 1, nonce, environmentDigest });
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "attempted" });
  const pm = candidate.web.pm2;
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "confirmed", observation: {
    ...binding, role: "paused-web", sequence: 1, observedNonce: nonce, environmentDigest,
    instance: { ...candidate.web.processes[0], pmId: pm.pmId, createdAt: pm.createdAt, pmUptime: pm.pmUptime, restartTime: pm.restartTime, metadataDigest: pm.metadataHash },
  } });
  // No real protected state is copied into this repository. The production
  // predecessor is cryptographically pinned as a whole; only these exact test
  // bytes are mapped below. Audit semantics are the separate pure protocol's
  // responsibility; this suite exercises its real stopped-runtime assertions.
  const state = { version: 5, revision: 15, operationId: U, targetSha: T, expectedOldSha: O, appDir: APP, appName: "merchant-space", appPort: 3000,
    bootId: BOOT, createdAt: 1789236034129, phase: "failed-held", runtime, ingress: {}, database: {}, publicSupabaseUrl: "https://fixture.invalid",
    tokenHash: hash("test-token"), candidate, resumed: null, launchDisk: candidate.disk, launchJournal: journal, finalDump: null,
    recovery: { fixture: 1 }, continuation: { fixture: 2 }, buildRecovery: { fixture: 3 }, deadlineExtension: { fixture: 4 } };
  let current = { target: candidate.disk.runtime, linkIdentity: id(90, "link"), runtimeIdentity: candidate.disk.runtimeIdentity };
  const runtimeIo = {
    boot: () => BOOT,
    runtimeIdentity(path) { calls.push("disk:" + path); return [...disks.values()].find(disk => disk.runtime === path).runtimeIdentity; },
    readRollback(path, sha) {
      assert.equal(path, disks.get(sha).runtime + "/.env.local");
      const environment = environments.get(sha);
      return { ...config, directoryIdentity: environment.directoryIdentity, fileIdentity: environment.fileIdentity, sha256: environment.sha256 };
    },
    file(path) {
      const disk = [...disks.values()].find(value => path.startsWith(value.runtime + "/"));
      return path.endsWith("/BUILD_ID") ? { identity: disk.nextBuildIdentity, hash: disk.nextBuildDigest } : { identity: disk.nextEntryIdentity, hash: hash("entry") };
    },
    readProcess: pid => structuredClone(facts.get(pid) ?? null),
    processesInRuntime(path) { calls.push("scan:" + path); return [...facts.values()].filter(fact => fact.cwd === path).map(fact => fact.pid); },
    portEmpty() { calls.push("port"); return true; },
    pm2Registry: async () => { calls.push("registry"); return []; },
  };
  const io = { runtime: runtimeIo, readCurrent: () => { calls.push("current"); return structuredClone(current); }, now: () => Date.parse("2026-09-13T22:30:00Z") };
  return { state, io, facts, disks, environments, calls, setCurrent: value => { current = value; }, current: () => current };
}

test("failed-candidate inspection uses actual stopped assertions and never changes current to O", { concurrency: false }, async t => {
  const seed = fixture(), mapped = JSON.stringify(seed.state);
  // Exact one-message SHA256 test substitution, restored after this isolated
  // suite. No production override, private-state fixture, or general fake hash.
  t.mock.method(crypto, "createHash", (algorithm, options) => {
    const actual = realCreateHash(algorithm, options), chunks = [];
    const update = actual.update.bind(actual), digest = actual.digest.bind(actual);
    actual.update = (value, encoding) => { chunks.push(Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, encoding)); update(value, encoding); return actual; };
    actual.digest = encoding => algorithm === "sha256" && encoding === "hex" && Buffer.concat(chunks).equals(Buffer.from(mapped)) ? PIN : digest(encoding);
    return actual;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(crypto.createHash, realCreateHash); });

  await t.test("whole-state pin remains exact and every other hash is real", () => {
    assert.equal(crypto.createHash("sha256").update(mapped).digest("hex"), PIN);
    assert.equal(crypto.createHash("sha256").update(mapped + " ").digest("hex"), hash(mapped + " "));
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(seed.state.candidate)).digest("hex"), hash(seed.state.candidate));
  });
  await t.test("two real stopped assertions verify both frozen disks, generations and empty port", async () => {
    const f = fixture(), before = JSON.stringify(f.state), result = await captureFailedCandidateBaseline(f.state, f.io);
    assert.equal(result.stateDigest, PIN); assert.equal(result.current.target, f.state.candidate.disk.runtime);
    assert.equal(result.current.runtimeIdentity, f.state.candidate.disk.runtimeIdentity);
    assert.equal(result.candidateDigest, hash(f.state.candidate)); assert.equal(result.launchJournalDigest, hash(f.state.launchJournal));
    assert.equal(result.runtimeDigest, hash(f.state.runtime)); assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE"), false);
    assert.equal(f.calls.filter(call => call === "registry").length, 2); assert.equal(f.calls.filter(call => call === "port").length, 2);
    assert.ok(f.calls.includes("scan:" + f.state.runtime.disk.runtime)); assert.ok(f.calls.includes("scan:" + f.state.candidate.disk.runtime));
    assert.equal(JSON.stringify(f.state), before); assert.ok(Object.isFrozen(result.current));
    f.io.now = () => result.observedAt + 1;
    assert.equal(await verifyFailedCandidateBaseline(f.state, result, f.io), true); assert.equal(result.observedAt, Date.parse("2026-09-13T22:30:00Z"));
  });
  await t.test("old web, old worker, candidate generation and extra same-runtime process are each rejected", async () => {
    for (const choose of [f => f.state.runtime.web.processes[0], f => f.state.runtime.worker.managed.processes[0],
      f => f.state.candidate.web.processes[0], f => ({ ...f.state.candidate.web.processes[0], pid: 202, parentPid: 201 })]) {
      const f = fixture(), process = choose(f); f.facts.set(process.pid, process);
      await assert.rejects(captureFailedCandidateBaseline(f.state, f.io), /failed_candidate_unverified/);
    }
  });
  await t.test("later stopped assertion never reads or fabricates the new current target", async () => {
    const f = fixture(); f.io.readCurrent = () => { throw new Error("current must not be consulted"); };
    assert.equal(await assertFailedCandidateStopped(f.state, f.io), true);
    assert.equal(f.calls.includes("current"), false);
    f.facts.set(201, f.state.candidate.web.processes[0]);
    await assert.rejects(assertFailedCandidateStopped(f.state, f.io), /failed_candidate_unverified/);
  });
  await t.test("historical generation check permits synthetic T6 with the same app name without an empty-port assertion", async () => {
    const newRuntime = APP + ".releases/aaaaaaaaaaaa-20260914000000";
    const row = () => ({ name: "merchant-space", pid: 301, pm_id: 301, pm2_env: { name: "merchant-space", pm_id: 301, status: "online",
      created_at: 20000, pm_uptime: 20000, restart_time: 0, pm_cwd: newRuntime, pm_exec_path: newRuntime + "/node_modules/next/dist/bin/next",
      args: ["start", "-p", "3000"], node_args: [], exec_mode: "fork_mode", exec_interpreter: "/usr/bin/node", watch: false, cron_restart: null,
      autorestart: false, FAOLLA_BACKGROUND_JOBS_PAUSED: "1", nonce: "12345678-1234-4234-8234-123456789013", envDigest: "a".repeat(64) } });
    const make = () => {
      const f = fixture(), entry = row();
      f.facts.set(301, { ...f.state.candidate.web.processes[0], pid: 301, startTicks: "999", cwd: newRuntime });
      f.io.runtime.pm2Registry = async () => [structuredClone(entry)];
      f.io.runtime.portEmpty = () => { assert.fail("generation-only check must not assert or fabricate empty port"); };
      f.io.readCurrent = () => { assert.fail("new current must not be relabelled as T5 or O"); };
      return { f, entry };
    };
    const allowed = make();
    assert.equal(await assertFailedCandidateGenerationStopped(allowed.f.state, allowed.f.io), true);
    for (const mutate of [
      ({ f }) => f.facts.set(201, f.state.candidate.web.processes[0]),
      ({ f }) => f.facts.set(202, { ...f.state.candidate.web.processes[0], pid: 202 }),
      ({ f, entry }) => { entry.pm2_env.pm_cwd = f.state.candidate.disk.runtime; },
      ({ f, entry }) => { entry.pm2_env.pm_exec_path = f.state.candidate.disk.nextEntryPath; },
      ({ f, entry }) => { entry.pm_id = entry.pm2_env.pm_id = f.state.candidate.web.pm2.pmId; entry.pm2_env.created_at = f.state.candidate.web.pm2.createdAt; },
      ({ f, entry }) => { let reads = 0; f.io.runtime.pm2Registry = async () => [{ ...entry, pm2_env: { ...entry.pm2_env, restart_time: reads++ } }]; },
    ]) {
      const changed = make(); mutate(changed);
      await assert.rejects(assertFailedCandidateGenerationStopped(changed.f.state, changed.f.io), /failed_candidate_unverified/);
    }
  });
  await t.test("handoff returns T5 physical/configuration fields and O worker policy without rewriting either proof", async () => {
    const f = fixture(), before = JSON.stringify(f.state), baseline = await captureFailedCandidateBaseline(f.state, f.io);
    const fields = await readFailedCandidateHandoffFields(f.state.runtime, { version: 1, predecessor: f.state, stoppedBaseline: baseline }, f.io);
    assert.equal(Object.keys(fields).length, 27);
    assert.equal(fields.PREVIOUS_LINK_TARGET, f.state.candidate.disk.runtime);
    assert.equal(fields.PREVIOUS_RUNTIME_DIR, f.state.candidate.disk.runtime);
    assert.equal(fields.PREVIOUS_BUILD_ID, T);
    assert.equal(fields.PREVIOUS_ENVIRONMENT_FILE_IDENTITY, f.state.candidate.disk.environmentIdentity);
    assert.notEqual(fields.PREVIOUS_ENVIRONMENT_FILE_IDENTITY, f.state.runtime.disk.environmentIdentity);
    assert.equal(fields.PREVIOUS_WEB_PID, "201");
    assert.equal(fields.PREVIOUS_AUTOMATION_WORKER_STATE, "running"); assert.equal(fields.PREVIOUS_AUTOMATION_WORKER_RUNNING, "1");
    assert.equal(JSON.stringify(f.state), before);
  });
  await t.test("handoff rejects a mismatched original proof, extra report field and a pointer change during private reads", async () => {
    const f = fixture(), baseline = await captureFailedCandidateBaseline(f.state, f.io);
    const report = { version: 1, predecessor: f.state, stoppedBaseline: baseline };
    await assert.rejects(readFailedCandidateHandoffFields({ ...f.state.runtime, bootId: "12345678-1234-1234-1234-123456789012" }, report, f.io), /attempt_handoff_unverified/);
    await assert.rejects(readFailedCandidateHandoffFields(f.state.runtime, { ...report, extra: true }, f.io), /attempt_handoff_unverified/);
    let reads = 0; f.io.readCurrent = () => ({ ...f.current(), linkIdentity: id(++reads < 3 ? 90 : 91, "link") });
    await assert.rejects(readFailedCandidateHandoffFields(f.state.runtime, report, f.io), /attempt_handoff_unverified/);
  });
  await t.test("changed boot, nonempty listener, current O, pointer drift and either frozen file drift fail closed", async () => {
    const mutations = [
      f => { f.io.runtime.boot = () => "12345678-1234-1234-1234-123456789012"; },
      f => { f.io.runtime.portEmpty = () => false; },
      f => { f.setCurrent({ ...f.current(), target: f.state.runtime.disk.runtime }); },
      f => { let reads = 0; f.io.readCurrent = () => ({ ...f.current(), linkIdentity: id(++reads === 1 ? 90 : 91, "link") }); },
      f => { const read = f.io.runtime.file; f.io.runtime.file = path => ({ ...read(path), identity: id(999) }); },
      f => { const read = f.io.runtime.readRollback; f.io.runtime.readRollback = (...args) => ({ ...read(...args), anonKey: "DRIFT" }); },
      f => { f.io.runtime.runtimeIdentity = () => id(999, "directory"); },
    ];
    for (const mutate of mutations) { const f = fixture(); mutate(f); await assert.rejects(captureFailedCandidateBaseline(f.state, f.io), /failed_candidate_unverified/); }
  });
  await t.test("state, old audits, nonce and confirmed instance cannot be replaced", async () => {
    for (const mutate of [s => { s.revision++; }, s => { s.runtime.daemon.startTicks = "999"; }, s => { s.recovery.fixture = 2; },
      s => { s.candidate.web.processes[0].pid++; }, s => { s.launchJournal.slots["paused-web"].nonce = "12345678-1234-4234-8234-123456789013"; }]) {
      const f = fixture(), state = structuredClone(f.state); mutate(state);
      await assert.rejects(captureFailedCandidateBaseline(state, f.io), /failed_candidate_unverified/); assert.deepEqual(f.calls, []);
    }
  });
  await t.test("getters, proxies, symbols, unknown fields and mutation seams are never accepted", async () => {
    const f = fixture(); let getters = 0;
    const getter = structuredClone(f.state); Object.defineProperty(getter, "runtime", { enumerable: true, get() { getters++; return f.state.runtime; } });
    for (const state of [getter, new Proxy(f.state, {}), { ...f.state, unknown: 1 }, { ...f.state, [Symbol("x")]: 1 }]) {
      await assert.rejects(captureFailedCandidateBaseline(state, f.io), /failed_candidate_unverified/);
    }
    assert.equal(getters, 0); assert.deepEqual(f.calls, []);
    await assert.rejects(captureFailedCandidateBaseline(f.state, { ...f.io, runtime: { ...f.io.runtime, pm2Control() { throw new Error("must never run"); } } }), /failed_candidate_unverified/);
  });
  await t.test("baseline verification preserves signed timestamp and rejects substituted pointer/digest/backward clock", async () => {
    const f = fixture(), baseline = await captureFailedCandidateBaseline(f.state, f.io);
    for (const changed of [{ ...baseline, runtimeDigest: "f".repeat(64) }, { ...baseline, current: { ...baseline.current, linkIdentity: id(91, "link") } }]) {
      await assert.rejects(verifyFailedCandidateBaseline(f.state, changed, f.io), /failed_candidate_unverified/);
    }
    f.io.now = () => baseline.observedAt - 1;
    await assert.rejects(verifyFailedCandidateBaseline(f.state, baseline, f.io), /failed_candidate_unverified/);
    assert.throws(() => validateFailedCandidateBaseline({ ...baseline, extra: true }), /failed_candidate_unverified/);
    assert.throws(() => validateFailedCandidateBaseline({ ...baseline, current: { ...baseline.current, linkIdentity: id(91) } }), /failed_candidate_unverified/);
  });
  await t.test("source graph is lazy and there is no writer, lock, actuator or stdin entry point", () => {
    const source = readFileSync(new URL("./production-maintenance-failed-candidate-inspection.mjs", import.meta.url), "utf8");
    assert.match(source, /process\.argv\[1\] === "-"/);
    assert.match(source, /await import\("\.\/production-maintenance-runtime\.mjs"\)/);
    assert.doesNotMatch(source, /\b(?:stopRuntime|stopCandidate|controlPm2|writeFileSync|renameSync|unlinkSync|mkdirSync|execSync|spawnSync)\s*\(/);
    assert.doesNotMatch(source, /from "\.\/check-production-runtime-supervision/);
    assert.match(source, /assertRuntimeStopped\(proof, runtimeIo\)/); assert.match(source, /assertRuntimeStopped\(candidateOnly, runtimeIo\)/);
  });
});
