import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { posix } from "node:path";
import {
  captureProcessFact, captureRuntimeProof, captureSupervisionSnapshot,
  classifyRuntimeSupervision, RUNTIME_SUPERVISION_CODES,
} from "./check-production-runtime-supervision.mjs";
import {
  captureStableProductionProcessSupabaseEnvironment,
  readFrozenProductionSupabaseRollbackEnvironmentSnapshot,
} from "./read-production-supabase-environment.mjs";

// This module owns no state file and grants no maintenance authority. Its caller
// must hold the operation lock and preserve the independent ingress fence.
const ERROR = "production_maintenance_runtime_unverified";
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const IDENTITY = /^\d+(?::\d+){7}$/;
const PROCESS_KEYS = ["pid", "parentPid", "startTicks", "processIdentity", "uid", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLineDigest"];
const PM2_KEYS = ["pmId", "pid", "name", "status", "createdAt", "pmUptime", "restartTime", "metadataHash"];
const DISK_KEYS = ["runtime", "runtimeIdentity", "environmentIdentity", "environmentDigest", "nextBuildIdentity", "nextBuildDigest", "nextEntryPath", "nextEntryIdentity"];
const ENVIRONMENT_KEYS = ["directoryIdentity", "fileIdentity", "sha256", "configurationHash"];
const CONFIG_KEYS = ["internalUrl", "publicUrl", "anonKey", "rolloutStatus", "staffBusinessRbacMode", "staffBusinessRbacSiteIds", "canonicalPortalOrigin"];
const fail = () => { throw new Error(ERROR); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min && value <= 2_147_483_647;
const text = (value, max = 4096) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\r\n\0]/.test(value);
const absolute = (value) => text(value, 500) && value.startsWith("/") && value !== "/" && posix.normalize(value) === value;
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"));
}
function array(value, check, maximum = 64) {
  return Array.isArray(value) && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, index))
      .every((entry) => entry?.enumerable && Object.hasOwn(entry, "value") && check(entry.value));
}
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const pick = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
function captureInput(value) {
  if (!exact(value, ["appDir", "appName", "appPort", "expectedOldSha"]) || !absolute(value.appDir) ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(value.appName) || !integer(value.appPort, 1) || value.appPort > 65535 || !SHA.test(value.expectedOldSha)) fail();
  return { ...value };
}
function validProcess(value, allowRootCwd = false) {
  return exact(value, PROCESS_KEYS) && integer(value.pid, 1) && integer(value.parentPid) && integer(value.uid) &&
    /^[1-9]\d{0,24}$/.test(value.startTicks) && IDENTITY.test(value.processIdentity) && IDENTITY.test(value.cwdIdentity) &&
    IDENTITY.test(value.executableIdentity) && (absolute(value.cwd) || (allowRootCwd && value.cwd === "/")) &&
    absolute(value.executable) && DIGEST.test(value.commandLineDigest);
}
// A verified supervisor can legitimately start from /. This exception applies
// only to its working directory, never application paths or executables. The
// same frozen process/directory identities and ancestry checks still apply.
const validDaemonProcess = (value) => validProcess(value, true);
function validPm2(value) {
  return exact(value, PM2_KEYS) && integer(value.pmId) && integer(value.pid) && text(value.name, 150) &&
    ["online", "stopped"].includes(value.status) && Number.isSafeInteger(value.createdAt) && value.createdAt > 0 &&
    Number.isSafeInteger(value.pmUptime) && value.pmUptime > 0 && integer(value.restartTime) && DIGEST.test(value.metadataHash) &&
    (value.status === "online" ? value.pid > 0 : value.pid === 0);
}
function validDisk(value, input, build) {
  return exact(value, DISK_KEYS) && absolute(value.runtime) && posix.dirname(value.runtime) === input.appDir + ".releases" &&
    new RegExp(`^${build.slice(0, 12)}-[0-9]{14}$`).test(posix.basename(value.runtime)) &&
    ["runtimeIdentity", "environmentIdentity", "nextBuildIdentity", "nextEntryIdentity"].every((key) => IDENTITY.test(value[key])) &&
    DIGEST.test(value.environmentDigest) && DIGEST.test(value.nextBuildDigest) &&
    value.nextEntryPath === value.runtime + "/node_modules/next/dist/bin/next";
}
function validEnvironment(value, disk) {
  return exact(value, ENVIRONMENT_KEYS) && /^\d+(?::\d+){6}$/.test(value.directoryIdentity) &&
    IDENTITY.test(value.fileIdentity) && value.fileIdentity === disk.environmentIdentity &&
    value.sha256 === disk.environmentDigest && DIGEST.test(value.configurationHash);
}
function validManaged(value, name, runtime, allowStopped = false) {
  return exact(value, ["pm2", "processes"]) && validPm2(value.pm2) && value.pm2.name === name &&
    array(value.processes, validProcess) && new Set(value.processes.map((item) => item.pid)).size === value.processes.length &&
    (value.pm2.status === "stopped" ? allowStopped && value.processes.length === 0 :
      value.processes.length > 0 && value.processes[0].pid === value.pm2.pid && value.processes.every((item) => item.cwd === runtime));
}
export function validateRuntimeProof(value) {
  if (!exact(value, ["version", "input", "bootId", "disk", "environment", "daemon", "web", "worker"]) || value.version !== 1) fail();
  const input = captureInput(value.input);
  if (!UUID.test(value.bootId) || !validDisk(value.disk, input, input.expectedOldSha) || !validEnvironment(value.environment, value.disk) ||
      !validDaemonProcess(value.daemon) || !validManaged(value.web, input.appName, value.disk.runtime) || value.web.processes.length !== 1 ||
      value.web.processes[0].parentPid !== value.daemon.pid ||
      !exact(value.worker, ["state", "managed"]) || !["running", "inactive", "absent"].includes(value.worker.state)) fail();
  if (value.worker.state === "absent" ? value.worker.managed !== null :
      !validManaged(value.worker.managed, input.appName + "-enterprise-automation-worker", value.disk.runtime, true) ||
      (value.worker.state === "running" ? value.worker.managed.pm2.status !== "online" || value.worker.managed.processes[0].parentPid !== value.daemon.pid
        : value.worker.managed.pm2.status !== "stopped")) fail();
  return structuredClone(value);
}
export function validateCandidateProof(value, rawRuntimeProof) {
  const proof = validateRuntimeProof(rawRuntimeProof);
  if (!exact(value, ["version", "targetSha", "pauseExpected", "disk", "environment", "daemon", "web"]) || value.version !== 1 ||
      !SHA.test(value.targetSha) || !["0", "1"].includes(value.pauseExpected) || !validDisk(value.disk, proof.input, value.targetSha) ||
      !validEnvironment(value.environment, value.disk) || !validDaemonProcess(value.daemon) ||
      !validManaged(value.web, proof.input.appName, value.disk.runtime) || value.web.processes.length !== 1 ||
      value.web.processes[0].parentPid !== value.daemon.pid) fail();
  return structuredClone(value);
}
function run(command, args, overrides = {}, timeoutMs = 35_000) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 1_048_576,
    windowsHide: true, shell: false, env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", npm_config_node_options: "", ...overrides },
    stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== "string") fail();
  return result.stdout;
}
function processOrNull(pid) {
  try { lstatSync(`/proc/${pid}`); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  return pick(captureProcessFact(pid), PROCESS_KEYS);
}
function processIndex() {
  const names = readdirSync("/proc").filter((name) => /^[1-9]\d*$/.test(name));
  if (names.length > 16384) fail();
  return names.flatMap((name) => {
    try {
      const raw = readFileSync(`/proc/${name}/stat`, "utf8");
      if (raw.length > 16384) fail();
      const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
      if (!/^[0-9]+$/.test(fields[1] ?? "")) fail();
      return [{ pid: Number(name), parentPid: Number(fields[1]) }];
    } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  });
}
function ownedProcesses(pid) {
  const index = processIndex(); const selected = [pid];
  for (let cursor = 0; cursor < selected.length; cursor++) {
    selected.push(...index.filter((row) => row.parentPid === selected[cursor]).map((row) => row.pid));
    if (selected.length > 64 || new Set(selected).size !== selected.length) fail();
  }
  return selected.map((id) => { const fact = processOrNull(id); if (!fact) fail(); return fact; });
}
function fixedEnvironment(pid, name) {
  const bytes = readFileSync(`/proc/${pid}/environ`);
  if (bytes.length > 1_048_576 || bytes.at(-1) !== 0) fail();
  const matches = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0").filter((entry) => entry.startsWith(name + "="));
  if (matches.length !== 1) fail();
  return matches[0].slice(name.length + 1);
}
function pm2List(daemon, d) {
  if (!equal(d.readProcess(daemon.pid), daemon)) fail();
  const entries = JSON.parse(d.run("pm2", ["jlist"], undefined, 5_000));
  if (!Array.isArray(entries) || entries.length > 128 || !equal(d.readProcess(daemon.pid), daemon)) fail();
  return entries;
}
function managedProcess(entries, name, runtime, kind, daemon, d) {
  const matches = entries.filter((entry) => entry?.name === name || entry?.pm2_env?.name === name);
  if (!matches.length) return null;
  if (matches.length !== 1) fail();
  const { pid, pm_id: pmId, pm2_env: env, name: outerName } = matches[0];
  const entry = runtime + (kind === "web" ? "/node_modules/next/dist/bin/next" : "/node_modules/tsx/dist/cli.mjs");
  const args = kind === "web" ? ["start", "-p", String(d.port)] : [runtime + "/scripts/run-merchant-enterprise-automation-worker.ts"];
  // PM2 represents the absence of node flags as omitted/null/empty string or
  // an empty array. Never accept a non-empty argument or parse shell text.
  const nodeArgs = [undefined, null, ""].includes(env?.node_args) ? [] : env.node_args;
  if (outerName !== name || env?.name !== name || env?.pm_id !== pmId || env?.exec_mode !== "fork_mode" ||
      !equal(nodeArgs, []) || !equal(env?.args, args) || env.pm_cwd !== runtime || env.pm_exec_path !== entry ||
      !["node", d.nodePath].includes(env.exec_interpreter)) fail();
  const metadata = { pmCwd: env.pm_cwd, pmExecPath: env.pm_exec_path, args: env.args, nodeArgs,
    execMode: env.exec_mode, execInterpreter: env.exec_interpreter };
  const pm2 = { pmId, pid, name, status: env.status, createdAt: env.created_at, pmUptime: env.pm_uptime,
    restartTime: env.restart_time, metadataHash: hash(JSON.stringify(metadata)) };
  if (!validPm2(pm2)) fail();
  const processes = pid === 0 ? [] : d.ownedProcesses(pid);
  if (!validManaged({ pm2, processes }, name, runtime, true) ||
      (processes.length && (processes[0].parentPid !== daemon.pid || processes[0].uid !== daemon.uid ||
        processes.some((fact) => fact.uid !== daemon.uid || fact.executable !== d.nodePath)))) fail();
  return { pm2, processes };
}
function environmentSnapshot(runtime, build, pid, d) {
  const file = d.readRollback(runtime + "/.env.local", build);
  const live = d.readProcessEnvironment(String(pid), runtime);
  if (live.status !== "present" || !text(live.startTicks) ||
      ["internalUrl", "publicUrl", "anonKey"].some((key) => live[key] !== file[key]) ||
      (live.rolloutStatus === "present" ? ["staffBusinessRbacMode", "staffBusinessRbacSiteIds", "canonicalPortalOrigin"].some((key) => live[key] !== file[key])
        : live.rolloutStatus !== "absent" || file.rolloutStatus !== "legacy-off")) fail();
  return { directoryIdentity: file.directoryIdentity, fileIdentity: file.fileIdentity, sha256: file.sha256,
    configurationHash: hash(JSON.stringify(pick(file, CONFIG_KEYS))) };
}
function dependencies(overrides = {}, port) {
  return { disk: captureRuntimeProof, supervision: captureSupervisionSnapshot, run,
    readRollback: readFrozenProductionSupabaseRollbackEnvironmentSnapshot,
    readProcessEnvironment: captureStableProductionProcessSupabaseEnvironment,
    readProcess: processOrNull, ownedProcesses, readPause: (pid) => fixedEnvironment(pid, "FAOLLA_BACKGROUND_JOBS_PAUSED"),
    boot: () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    current: (appDir) => realpathSync(appDir + ".current"),
    portEmpty: (number) => run("ss", ["-H", "-ltn", `( sport = :${number} )`]).trim() === "",
    file: (path) => {
      const before = lstatSync(path, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || (before.mode & 0o022n) !== 0n || before.size > 1_048_576n) fail();
      const identity = (value) => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"].map((key) => String(value[key])).join(":");
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (identity(before) !== identity(fstatSync(fd, { bigint: true }))) fail();
        const bytes = readFileSync(fd); const after = fstatSync(fd, { bigint: true });
        if (identity(before) !== identity(after) || identity(after) !== identity(lstatSync(path, { bigint: true })) ||
            BigInt(bytes.length) !== after.size || realpathSync(path) !== path) fail();
        return { identity: identity(after), hash: hash(bytes) };
      } finally { closeSync(fd); }
    },
    runtimeIdentity: (path) => {
      const stat = statSync(path, { bigint: true });
      if (!stat.isDirectory() || realpathSync(path) !== path || (stat.mode & 0o022n) !== 0n) fail();
      return ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"].map((key) => String(stat[key])).join(":");
    },
    processesInRuntime: (runtime) => processIndex().flatMap(({ pid }) => {
      try { return realpathSync(`/proc/${pid}/cwd`) === runtime ? [pid] : []; }
      catch (error) { if (error?.code === "ENOENT") return []; throw error; }
    }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: () => Date.now(),
    nodePath: realpathSync(process.execPath), ...overrides, port };
}
async function observe(input, d, pauseExpected = null, workerRuntime = null) {
  const disk = pick(d.disk(input.appDir, input.expectedOldSha), DISK_KEYS);
  if (!validDisk(disk, input, input.expectedOldSha)) fail();
  const supervision = await d.supervision(input.appName, disk, input.appPort, input.expectedOldSha);
  if (classifyRuntimeSupervision({ ...supervision, runtime: disk.runtime, stable: true }) !== RUNTIME_SUPERVISION_CODES.direct) fail();
  const daemon = pick(supervision.listener.chain.find((entry) => entry.pid === supervision.ownership.daemonPid) ?? {}, PROCESS_KEYS);
  if (!validDaemonProcess(daemon)) fail();
  const entries = pm2List(daemon, d);
  const web = managedProcess(entries, input.appName, disk.runtime, "web", daemon, d);
  if (!web || web.pm2.pid !== supervision.listener.pid || web.processes.length !== 1) fail();
  const environment = environmentSnapshot(disk.runtime, input.expectedOldSha, web.pm2.pid, d);
  if (pauseExpected !== null && d.readPause(web.pm2.pid) !== pauseExpected) fail();
  const worker = managedProcess(entries, input.appName + "-enterprise-automation-worker", workerRuntime || disk.runtime, "worker", daemon, d);
  return { disk, environment, daemon, web, worker: { state: worker ? worker.pm2.status === "online" ? "running" : "inactive" : "absent", managed: worker } };
}
async function guarded(callback) {
  try { return await callback(); }
  catch (error) {
    if (["production_maintenance_runtime_resume_failed_stopped", "production_maintenance_runtime_resume_failed_unknown"].includes(error?.message)) throw error;
    fail();
  }
}
export async function captureRuntime(rawInput, overrides = {}) {
  return guarded(async () => {
    const input = captureInput(rawInput); const d = dependencies(overrides, input.appPort); const bootId = d.boot();
    const first = await observe(input, d); await d.sleep(50); const second = await observe(input, d);
    if (!equal(first, second) || d.boot() !== bootId) fail();
    assertNoUnfrozenRuntimeProcess(second.disk.runtime, [...second.web.processes, ...(second.worker.managed?.processes || [])].map((fact) => fact.pid), d);
    return validateRuntimeProof({ version: 1, input, bootId, ...second });
  });
}
function assertFrozenDisk(proof, d) {
  if (d.boot() !== proof.bootId || d.runtimeIdentity(proof.disk.runtime) !== proof.disk.runtimeIdentity) fail();
  const env = d.readRollback(proof.disk.runtime + "/.env.local", proof.input.expectedOldSha);
  const expected = { directoryIdentity: env.directoryIdentity, fileIdentity: env.fileIdentity, sha256: env.sha256,
    configurationHash: hash(JSON.stringify(pick(env, CONFIG_KEYS))) };
  if (!equal(expected, proof.environment)) fail();
  for (const [path, identity, digest] of [[proof.disk.runtime + "/.next/BUILD_ID", proof.disk.nextBuildIdentity, proof.disk.nextBuildDigest],
    [proof.disk.nextEntryPath, proof.disk.nextEntryIdentity, null]]) {
    const actual = d.file(path); if (actual.identity !== identity || (digest && actual.hash !== digest)) fail();
  }
}
function assertNoUnfrozenRuntimeProcess(runtime, allowed, d) {
  const pids = d.processesInRuntime(runtime);
  if (!array(pids, (pid) => integer(pid, 1), 128) || new Set(pids).size !== pids.length || pids.some((pid) => !allowed.includes(pid))) fail();
}
function assertGone(managed, entries, d, allowInactive = false) {
  if (!managed) return;
  if (allowInactive && managed.pm2.status === "stopped") {
    const matches = entries.filter((entry) => entry?.name === managed.pm2.name || entry?.pm_id === managed.pm2.pmId || entry?.pm2_env?.name === managed.pm2.name);
    if (!matches.length) return;
    const current = managedProcess(entries, managed.pm2.name, managed.processes[0]?.cwd || d.oldRuntime, "worker", d.daemon, d);
    if (!equal(current, managed)) fail();
  } else if (entries.some((entry) => entry?.name === managed.pm2.name || entry?.pm_id === managed.pm2.pmId || entry?.pm2_env?.name === managed.pm2.name)) fail();
  for (const fact of managed.processes) {
    const current = d.readProcess(fact.pid);
    if (current !== null && current.startTicks === fact.startTicks) fail();
  }
}
function assertWorkerStopped(proof, d, entries) {
  d.oldRuntime = proof.disk.runtime; d.daemon = proof.daemon;
  if (proof.worker.state === "absent") {
    if (entries.some((entry) => entry?.name === proof.input.appName + "-enterprise-automation-worker" ||
      entry?.pm2_env?.name === proof.input.appName + "-enterprise-automation-worker")) fail();
  } else assertGone(proof.worker.managed, entries, d, true);
}
export async function assertRuntimeStopped(rawProof, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const d = dependencies(overrides, proof.input.appPort);
    assertFrozenDisk(proof, d);
    const entries = pm2List(proof.daemon, d); assertGone(proof.web, entries, d); assertWorkerStopped(proof, d, entries);
    assertNoUnfrozenRuntimeProcess(proof.disk.runtime, [], d);
    if (!d.portEmpty(proof.input.appPort)) fail();
    assertFrozenDisk(proof, d); return true;
  });
}
async function deleteExact(managed, kind, daemon, runtime, d) {
  if (!managed || managed.pm2.status === "stopped") return;
  const entries = pm2List(daemon, d);
  const actual = managedProcess(entries, managed.pm2.name, runtime, kind, daemon, d);
  if (!equal(actual, managed)) fail();
  // Only the frozen PM2 numeric instance is addressed. No name fallback, restart,
  // broad process signal, or automatic repeat after an uncertain acknowledgement.
  try { d.run("pm2", ["delete", String(managed.pm2.pmId)]); } catch { /* Verify actual stopped state below. */ }
  for (let attempt = 0; attempt < 60; attempt++) {
    const after = pm2List(daemon, d);
    try { assertGone(managed, after, d); return; }
    catch { if (attempt === 59) fail(); }
    await d.sleep(250);
  }
}
export async function stopRuntime(rawProof, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const d = dependencies(overrides, proof.input.appPort);
    assertFrozenDisk(proof, d);
    if (d.current(proof.input.appDir) !== proof.disk.runtime) fail();
    await stopFrozenOrAlreadyGone(proof.worker.managed, "worker", proof.daemon, proof.disk.runtime, d);
    assertFrozenDisk(proof, d);
    await stopFrozenOrAlreadyGone(proof.web, "web", proof.daemon, proof.disk.runtime, d);
    return assertRuntimeStopped(proof, overrides);
  });
}
export async function captureCandidate(rawProof, targetSha, pauseExpected = "1", overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); if (!SHA.test(targetSha) || !["0", "1"].includes(pauseExpected)) fail();
    const input = { ...proof.input, expectedOldSha: targetSha }; const d = dependencies(overrides, input.appPort);
    assertFrozenDisk(proof, d);
    const first = await observe(input, d, pauseExpected, proof.disk.runtime); await d.sleep(50); const second = await observe(input, d, pauseExpected, proof.disk.runtime);
    if (!equal(first, second)) fail();
    const entries = pm2List(proof.daemon, d); assertWorkerStopped(proof, d, entries);
    for (const fact of proof.web.processes) {
      const current = d.readProcess(fact.pid); if (current && current.startTicks === fact.startTicks) fail();
    }
    assertNoUnfrozenRuntimeProcess(proof.disk.runtime, [], d);
    assertNoUnfrozenRuntimeProcess(second.disk.runtime, second.web.processes.map((fact) => fact.pid), d);
    return validateCandidateProof({ version: 1, targetSha, pauseExpected, disk: second.disk, environment: second.environment,
      daemon: second.daemon, web: second.web }, proof);
  });
}
export async function verifyCandidate(rawProof, rawCandidate, pauseExpected = "1", overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const candidate = validateCandidateProof(rawCandidate, proof);
    const actual = await captureCandidate(proof, candidate.targetSha, pauseExpected, overrides);
    if (!equal(actual, candidate)) fail(); return true;
  });
}
export async function stopCandidate(rawProof, rawCandidate, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const candidate = validateCandidateProof(rawCandidate, proof);
    const d = dependencies(overrides, proof.input.appPort);
    assertCandidateDisk(proof, candidate, d);
    await stopFrozenOrAlreadyGone(candidate.web, "web", candidate.daemon, candidate.disk.runtime, d);
    assertNoUnfrozenRuntimeProcess(candidate.disk.runtime, [], d);
    return assertRuntimeStopped(proof, overrides);
  });
}

function assertCandidateDisk(proof, candidate, d) {
  assertFrozenDisk(proof, d);
  assertFrozenDisk({ ...proof, input: { ...proof.input, expectedOldSha: candidate.targetSha },
    disk: candidate.disk, environment: candidate.environment }, d);
  if (d.current(proof.input.appDir) !== candidate.disk.runtime) fail();
}
async function stopFrozenOrAlreadyGone(managed, kind, daemon, runtime, d) {
  if (!managed) return;
  const entries = pm2List(daemon, d);
  if (entries.some((entry) => entry?.name === managed.pm2.name || entry?.pm_id === managed.pm2.pmId || entry?.pm2_env?.name === managed.pm2.name)) {
    await deleteExact(managed, kind, daemon, runtime, d);
  } else assertGone(managed, entries, d);
}

function startEnvironment(candidate, d) {
  const environment = d.readRollback(candidate.disk.runtime + "/.env.local", candidate.targetSha);
  if (environment.sha256 !== candidate.environment.sha256 || hash(JSON.stringify(pick(environment, CONFIG_KEYS))) !== candidate.environment.configurationHash) fail();
  return { SUPABASE_INTERNAL_URL: environment.internalUrl, NEXT_PUBLIC_SUPABASE_URL: environment.publicUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.anonKey, MERCHANT_STAFF_BUSINESS_RBAC_MODE: environment.staffBusinessRbacMode,
    MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: environment.staffBusinessRbacSiteIds,
    FAOLLA_CANONICAL_PORTAL_ORIGIN: environment.canonicalPortalOrigin, FAOLLA_BACKGROUND_JOBS_PAUSED: "0", PORT: String(d.port) };
}

async function waitForStartedCandidate(proof, candidate, d, overrides, freezeLaunch) {
  const deadline = d.now() + 60_000;
  const launched = managedProcess(pm2List(candidate.daemon, d), proof.input.appName, candidate.disk.runtime, "web", candidate.daemon, d);
  if (!launched || launched.pm2.status !== "online") fail();
  freezeLaunch(launched);
  const identity = (managed) => ({ pm2: managed.pm2, processes: managed.processes.map((fact) => pick(fact, PROCESS_KEYS.filter((key) => key !== "commandLineDigest"))) });
  const assertLaunch = () => {
    const current = managedProcess(pm2List(candidate.daemon, d), proof.input.appName, candidate.disk.runtime, "web", candidate.daemon, d);
    if (!current || !equal(identity(current), identity(launched)) || d.now() >= deadline) fail();
  };
  // Only read-only observations are bounded here. A timeout does not replay a
  // start, and it never authorizes accepting a same-name replacement instance.
  const bounded = async (callback) => {
    const remaining = deadline - d.now(); if (remaining <= 0) fail();
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(callback), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(ERROR)), remaining);
      })]);
    } finally { clearTimeout(timer); }
  };
  const readOverrides = { ...overrides, run: (command, args, env, max = 5_000) => {
    const remaining = deadline - d.now(); if (remaining <= 0) fail();
    return d.run(command, args, env, Math.min(max, remaining));
  } };
  for (let attempt = 0; attempt < 240; attempt++) {
    assertLaunch();
    const observation = await bounded(() => d.supervision(proof.input.appName, candidate.disk, proof.input.appPort, candidate.targetSha));
    assertLaunch();
    if (observation.listener.state !== "absent" &&
        (observation.listener.state !== "single" || observation.listener.pid !== launched.pm2.pid ||
          observation.ownership.state !== "owned" || observation.ownership.mode !== "direct")) fail();
    if (observation.healthVerified && observation.listener.state === "single") {
      const result = await bounded(() => captureCandidate(proof, candidate.targetSha, "0", readOverrides));
      assertLaunch(); return result;
    }
    if (deadline - d.now() < 250) fail();
    await d.sleep(250);
  }
  fail();
}
export function validateResumedCandidateProof(value, rawProof) {
  const proof = validateRuntimeProof(rawProof);
  if (!exact(value, ["version", "candidate", "worker"]) || value.version !== 1) fail();
  const candidate = validateCandidateProof(value.candidate, proof);
  if (candidate.pauseExpected !== "0" || (proof.worker.state === "running"
    ? !validManaged(value.worker, proof.input.appName + "-enterprise-automation-worker", candidate.disk.runtime) : value.worker !== null)) fail();
  return structuredClone(value);
}
export async function resumeCandidate(rawProof, rawCandidate, targetSha, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const candidate = validateCandidateProof(rawCandidate, proof);
    if (candidate.targetSha !== targetSha || candidate.pauseExpected !== "1") fail();
    await verifyCandidate(proof, candidate, "1", overrides);
    const d = dependencies(overrides, proof.input.appPort); const environment = startEnvironment(candidate, d);
    await deleteExact(candidate.web, "web", candidate.daemon, candidate.disk.runtime, d);
    await assertRuntimeStopped(proof, overrides);
    if (d.current(proof.input.appDir) !== candidate.disk.runtime) fail();
    // No reload/update-env of an unknown same-name replacement, and never resume
    // the old release. Only the exact already-verified candidate is restarted.
    let launchedWeb = null;
    try {
      d.run("pm2", ["start", candidate.disk.nextEntryPath, "--name", proof.input.appName,
      "--interpreter", d.nodePath, "--cwd", candidate.disk.runtime, "--", "start", "-p", String(proof.input.appPort)], environment);
    const resumed = await waitForStartedCandidate(proof, candidate, d, overrides, (value) => { launchedWeb = value; });
    launchedWeb = resumed.web;
    let worker = null;
    if (proof.worker.state === "running") {
      const runtime = candidate.disk.runtime;
      d.file(runtime + "/node_modules/tsx/dist/cli.mjs");
      d.file(runtime + "/scripts/run-merchant-enterprise-automation-worker.ts");
      assertWorkerStopped(proof, d, pm2List(resumed.daemon, d));
      d.run("pm2", ["start", runtime + "/node_modules/tsx/dist/cli.mjs", "--name", proof.input.appName + "-enterprise-automation-worker",
        "--interpreter", d.nodePath, "--cwd", runtime, "--kill-timeout", "30000", "--restart-delay", "5000",
        "--wait-ready", "--listen-timeout", "20000", "--", runtime + "/scripts/run-merchant-enterprise-automation-worker.ts"], environment);
      worker = managedProcess(pm2List(resumed.daemon, d), proof.input.appName + "-enterprise-automation-worker", runtime, "worker", resumed.daemon, d);
      if (!worker || worker.pm2.status !== "online") fail();
    }
    const result = validateResumedCandidateProof({ version: 1, candidate: resumed, worker }, proof);
      await verifyResumedCandidate(proof, result, overrides); return result;
    } catch {
      let stopped = false;
      try {
        // Capture only the fixed candidate launch entries after this invocation's
        // start attempt. A replacement/ambiguous/unreadable instance is not killed.
        const entries = pm2List(candidate.daemon, d);
        const worker = managedProcess(entries, proof.input.appName + "-enterprise-automation-worker",
          proof.worker.state === "running" ? candidate.disk.runtime : proof.disk.runtime, "worker", candidate.daemon, d);
        if (proof.worker.state === "running") await deleteExact(worker, "worker", candidate.daemon, candidate.disk.runtime, d);
        const web = launchedWeb || managedProcess(pm2List(candidate.daemon, d), proof.input.appName, candidate.disk.runtime, "web", candidate.daemon, d);
        await deleteExact(web, "web", candidate.daemon, candidate.disk.runtime, d);
        assertNoUnfrozenRuntimeProcess(candidate.disk.runtime, [], d);
        await assertRuntimeStopped(proof, overrides); stopped = true;
      } catch { /* Keep the caller's ingress fence closed and expose only certainty. */ }
      throw new Error(stopped ? "production_maintenance_runtime_resume_failed_stopped" : "production_maintenance_runtime_resume_failed_unknown");
    }
  });
}
export async function verifyResumedCandidate(rawProof, rawResumed, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const resumed = validateResumedCandidateProof(rawResumed, proof);
    const candidate = resumed.candidate; const d = dependencies(overrides, proof.input.appPort);
    assertFrozenDisk(proof, d);
    const first = await observe({ ...proof.input, expectedOldSha: candidate.targetSha }, d, "0",
      proof.worker.state === "running" ? candidate.disk.runtime : proof.disk.runtime);
    await d.sleep(50);
    const actual = await observe({ ...proof.input, expectedOldSha: candidate.targetSha }, d, "0",
      proof.worker.state === "running" ? candidate.disk.runtime : proof.disk.runtime);
    if (!equal(first, actual) || !equal(actual.disk, candidate.disk) || !equal(actual.environment, candidate.environment) ||
        !equal(actual.daemon, candidate.daemon) || !equal(actual.web, candidate.web) ||
        (resumed.worker ? !equal(actual.worker.managed, resumed.worker) : actual.worker.state === "running")) fail();
    assertNoUnfrozenRuntimeProcess(proof.disk.runtime, [], d);
    assertNoUnfrozenRuntimeProcess(candidate.disk.runtime, [...candidate.web.processes, ...(resumed.worker?.processes || [])].map((fact) => fact.pid), d);
    return true;
  });
}
export async function stopResumedCandidate(rawProof, rawResumed, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const resumed = validateResumedCandidateProof(rawResumed, proof);
    const d = dependencies(overrides, proof.input.appPort);
    assertCandidateDisk(proof, resumed.candidate, d);
    await stopFrozenOrAlreadyGone(resumed.worker, "worker", resumed.candidate.daemon, resumed.candidate.disk.runtime, d);
    await stopFrozenOrAlreadyGone(resumed.candidate.web, "web", resumed.candidate.daemon, resumed.candidate.disk.runtime, d);
    assertNoUnfrozenRuntimeProcess(resumed.candidate.disk.runtime, [], d);
    return assertRuntimeStopped(proof, overrides);
  });
}
export async function readRuntimeHandoffEnvironment(rawProof, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const d = dependencies(overrides, proof.input.appPort);
    assertFrozenDisk(proof, d);
    // Private shell consumption only. The persistent proof contains none of
    // these values; the existing deployment uses this same six-key projection.
    return d.readRollback(proof.disk.runtime + "/.env.local", proof.input.expectedOldSha);
  });
}

export async function readDeploymentHandoffFields(rawProof, overrides = {}) {
  const proof = validateRuntimeProof(rawProof); const env = await readRuntimeHandoffEnvironment(proof, overrides);
  const directoryIdentity = proof.disk.runtimeIdentity.split(":");
  const oldRuntimeIdentity = `${directoryIdentity[0]}:${directoryIdentity[1]}:${BigInt(directoryIdentity[4]) / 1_000_000_000n}`;
  const encoded = (value) => Buffer.from(value, "utf8").toString("base64");
  return {
    PREVIOUS_LINK_TARGET: proof.disk.runtime, PREVIOUS_RUNTIME_DIR: proof.disk.runtime,
    PREVIOUS_RUNTIME_PARENT: posix.dirname(proof.disk.runtime), PREVIOUS_RELEASE_NAME: posix.basename(proof.disk.runtime),
    PREVIOUS_BUILD_PREFIX: proof.input.expectedOldSha.slice(0, 12), PREVIOUS_BUILD_ID: proof.input.expectedOldSha,
    PREVIOUS_RUNTIME_IDENTITY: oldRuntimeIdentity, PREVIOUS_WEB_CWD_IDENTITY: oldRuntimeIdentity,
    PREVIOUS_WEB_PID: String(proof.web.pm2.pid), PREVIOUS_WEB_PROCESS_START_TICKS: proof.web.processes[0].startTicks,
    PREVIOUS_WEB_PROCESS_IDENTITY: proof.web.processes[0].processIdentity.split(":").slice(0, 2).join(":"),
    PREVIOUS_ENVIRONMENT_DIRECTORY_IDENTITY: env.directoryIdentity, PREVIOUS_ENVIRONMENT_FILE_IDENTITY: env.fileIdentity,
    PREVIOUS_ENVIRONMENT_SHA256: env.sha256, PREVIOUS_SUPABASE_INTERNAL_URL: env.internalUrl,
    PREVIOUS_NEXT_PUBLIC_SUPABASE_URL: env.publicUrl, PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY: env.anonKey,
    PREVIOUS_SUPABASE_INTERNAL_URL_B64: encoded(env.internalUrl), PREVIOUS_NEXT_PUBLIC_SUPABASE_URL_B64: encoded(env.publicUrl),
    PREVIOUS_NEXT_PUBLIC_SUPABASE_ANON_KEY_B64: encoded(env.anonKey), PREVIOUS_STAFF_ROLLOUT_STATUS: env.rolloutStatus,
    PREVIOUS_STAFF_ALLOW_LEGACY_EMPTY_ORIGIN: env.rolloutStatus === "legacy-off" ? "1" : "0",
    PREVIOUS_MERCHANT_STAFF_BUSINESS_RBAC_MODE: env.staffBusinessRbacMode,
    PREVIOUS_MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: env.staffBusinessRbacSiteIds,
    PREVIOUS_FAOLLA_CANONICAL_PORTAL_ORIGIN: env.canonicalPortalOrigin,
    PREVIOUS_AUTOMATION_WORKER_STATE: proof.worker.state, PREVIOUS_AUTOMATION_WORKER_RUNNING: proof.worker.state === "running" ? "1" : "0",
  };
}
