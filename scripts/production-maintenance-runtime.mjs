import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { posix } from "node:path";
import { types } from "node:util";
import { captureNativeProcessProof, validateNativeProcessProof, verifyNativeProcessProof, verifyNativeFiles } from "./production-maintenance-native-proof.mjs";
import { inspectPm2Registry, controlPm2, validatePm2Registry, capturePm2DumpTarget, persistPm2Dump, verifyPm2Dump,
  validatePm2DumpReceipt, pm2RegistryDigest } from "./production-maintenance-pm2-adapter.mjs";
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
const LAUNCH_ENV_KEYS = ["SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "MERCHANT_STAFF_BUSINESS_RBAC_MODE", "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS", "FAOLLA_CANONICAL_PORTAL_ORIGIN",
  "FAOLLA_BACKGROUND_JOBS_PAUSED", "PORT", "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED", "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED"].sort();
const LAUNCH_ROLES = ["paused-web", "resumed-web", "worker"];
const LAUNCH_NONCE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = () => { throw new Error(ERROR); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min && value <= 2_147_483_647;
const text = (value, max = 4096) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\r\n\0]/.test(value);
const absolute = (value) => text(value, 500) && value.startsWith("/") && value !== "/" && posix.normalize(value) === value;
function exact(value, keys) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"));
}
function array(value, check, maximum = 64) {
  return !types.isProxy(value) && Array.isArray(value) && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1 &&
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
    IDENTITY.test(value.executableIdentity) && (absolute(value.cwd) || (allowRootCwd && value.cwd === "/")) && absolute(value.executable) && DIGEST.test(value.commandLineDigest);
}
const validDaemon = (value) => validProcess(value, true);
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
function validManaged(value, name, runtime, allowStopped = false, bootId = null, allowNative = false) {
  const hasNative = exact(value, ["pm2", "processes", "nativeProofs"]);
  if (!(hasNative || exact(value, ["pm2", "processes"])) || !validPm2(value.pm2) || value.pm2.name !== name ||
    !array(value.processes, (item) => validProcess(item)) || new Set(value.processes.map((item) => item.pid)).size !== value.processes.length ||
    !(value.pm2.status === "stopped" ? allowStopped && value.processes.length === 0 :
      value.processes.length > 0 && value.processes[0].pid === value.pm2.pid && value.processes.every((item) => item.cwd === runtime))) return false;
  if (value.processes.some((item, i) => i > 0 && !value.processes.slice(0, i).some((parent) => parent.pid === item.parentPid))) return false;
  const natives = value.processes.filter((item) => item.executable !== value.processes[0]?.executable);
  if (!hasNative) return natives.length === 0;
  if (!allowNative || !UUID.test(bootId ?? "") || !natives.length || !array(value.nativeProofs, (proof) => {
    try {
      if (!exact(proof, ["version", "context", "bootId", "process", "layout", "directories", "binaries", "packages"]) ||
          !exact(proof.context, ["runtime", "owner", "architecture"])) return false;
      const native = validateNativeProcessProof(proof, { runtime, owner: value.processes[0].uid, architecture: proof.context.architecture });
      return native.bootId === bootId && natives.some((item) => equal(item, pick(native.process, PROCESS_KEYS)));
    } catch { return false; }
  }) || value.nativeProofs.length !== natives.length || new Set(value.nativeProofs.map((proof) => proof.process.pid)).size !== natives.length) return false;
  return true;
}
export function validateRuntimeProof(value) {
  if (!exact(value, ["version", "input", "bootId", "disk", "environment", "daemon", "web", "worker"]) || value.version !== 1) fail();
  const input = captureInput(value.input);
  if (!UUID.test(value.bootId) || !validDisk(value.disk, input, input.expectedOldSha) || !validEnvironment(value.environment, value.disk) ||
      !validDaemon(value.daemon) || !validManaged(value.web, input.appName, value.disk.runtime) || value.web.processes.length !== 1 ||
      value.web.processes[0].parentPid !== value.daemon.pid ||
      !exact(value.worker, ["state", "managed"]) || !["running", "inactive", "absent"].includes(value.worker.state)) fail();
  if (value.worker.state === "absent" ? value.worker.managed !== null :
      !validManaged(value.worker.managed, input.appName + "-enterprise-automation-worker", value.disk.runtime, true, value.bootId, true) ||
      (value.worker.state === "running" ? value.worker.managed.pm2.status !== "online" || value.worker.managed.processes[0].parentPid !== value.daemon.pid
        : value.worker.managed.pm2.status !== "stopped")) fail();
  return structuredClone(value);
}
export function validateCandidateProof(value, rawRuntimeProof) {
  const proof = validateRuntimeProof(rawRuntimeProof);
  if (!exact(value, ["version", "targetSha", "pauseExpected", "disk", "environment", "daemon", "web"]) || value.version !== 1 ||
      !SHA.test(value.targetSha) || !["0", "1"].includes(value.pauseExpected) || !validDisk(value.disk, proof.input, value.targetSha) ||
      !validEnvironment(value.environment, value.disk) || !validDaemon(value.daemon) || !equal(value.daemon, proof.daemon) ||
      !validManaged(value.web, proof.input.appName, value.disk.runtime) || value.web.processes.length !== 1 ||
      value.web.processes[0].parentPid !== value.daemon.pid) fail();
  return structuredClone(value);
}
export function validateLaunchDisk(value, rawProof, targetSha) {
  const proof = validateRuntimeProof(rawProof);
  if (!SHA.test(targetSha) || targetSha === proof.input.expectedOldSha || !validDisk(value, proof.input, targetSha)) fail();
  return structuredClone(value);
}

function launchEnvironmentFromProcess(pid) {
  const bytes = readFileSync(`/proc/${pid}/environ`);
  if (bytes.length > 1048576 || bytes.at(-1) !== 0) fail();
  const rows = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0");
  const selected = {};
  for (const key of [...LAUNCH_ENV_KEYS, "FAOLLA_MAINTENANCE_LAUNCH_NONCE"]) {
    const matches = rows.filter((row) => row.startsWith(key + "="));
    if (matches.length !== 1) fail();
    selected[key] = matches[0].slice(key.length + 1);
  }
  return selected;
}
function workerFlagsFromFile(file) {
  const identity = (s) => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"].map((key) => String(s[key])).join(":");
  const before = lstatSync(file, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || (before.mode & 0o022n) !== 0n || before.size < 1n || before.size > 1048576n || realpathSync(file) !== file) fail();
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (identity(fstatSync(fd, { bigint: true })) !== identity(before)) fail();
    const bytes = readFileSync(fd);
    if (BigInt(bytes.length) !== before.size || identity(fstatSync(fd, { bigint: true })) !== identity(before) || identity(lstatSync(file, { bigint: true })) !== identity(before)) fail();
    const lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(/\r?\n/), flags = {};
    for (const key of ["MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED", "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED"]) {
      const rows = lines.filter((line) => line.startsWith(key + "="));
      if (rows.length !== 1 || !["true", "false"].includes(rows[0].slice(key.length + 1))) fail();
      flags[key] = rows[0].slice(key.length + 1);
    }
    return { identity: identity(before), hash: hash(bytes), flags };
  } finally { closeSync(fd); }
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
async function pm2List(daemon, d) {
  if (!equal(d.readProcess(daemon.pid), daemon)) fail();
  const bootId = d.boot();
  if (d.expectedBootId !== bootId) fail();
  const entries = validatePm2Registry(await d.pm2Registry(daemon, bootId));
  if (d.boot() !== bootId || !equal(d.readProcess(daemon.pid), daemon)) fail();
  return entries;
}
async function managedProcess(entries, name, runtime, kind, daemon, d) {
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
    execMode: env.exec_mode, execInterpreter: env.exec_interpreter, watch: env.watch, cronRestart: env.cron_restart,
    autorestart: env.autorestart, backgroundPause: env.FAOLLA_BACKGROUND_JOBS_PAUSED, nonce: env.nonce, envDigest: env.envDigest };
  const pm2 = { pmId, pid, name, status: env.status, createdAt: env.created_at, pmUptime: env.pm_uptime,
    restartTime: env.restart_time, metadataHash: hash(JSON.stringify(metadata)) };
  if (!validPm2(pm2)) fail();
  const processes = pid === 0 ? [] : d.ownedProcesses(pid);
  if (!array(processes, (fact) => validProcess(fact)) ||
      (processes.length && (processes[0].parentPid !== daemon.pid || processes[0].uid !== daemon.uid ||
        processes[0].executable !== d.nodePath || processes.some((fact) => fact.uid !== daemon.uid || fact.cwd !== runtime) ||
        processes.some((fact, i) => i > 0 && !processes.slice(0, i).some((parent) => parent.pid === fact.parentPid))))) fail();
  const nativeProofs = [];
  for (const fact of processes.filter((item) => item.executable !== d.nodePath)) {
    if (kind !== "worker" || !equal(d.readProcess(fact.pid), fact)) fail();
    const full = await d.readNativeProcess(fact.pid);
    if (!equal(pick(full, PROCESS_KEYS), fact)) fail();
    nativeProofs.push(await captureNativeProcessProof({ fact: full, runtime, owner: daemon.uid, architecture: d.architecture }, nativeDependencies(d)));
  }
  const managed = { pm2, processes, ...(nativeProofs.length ? { nativeProofs } : {}) };
  if (!validManaged(managed, name, runtime, true, d.boot(), kind === "worker") ||
      processes.some((fact) => !equal(d.readProcess(fact.pid), fact))) fail();
  return managed;
}
function nativeDependencies(d) {
  return { ...d.nativeFilesystem, readProcess: d.readNativeProcess, boot: d.boot };
}
async function verifyManagedNative(managed, d, live) {
  for (const native of managed?.nativeProofs ?? []) {
    if (d.boot() !== native.bootId || d.architecture !== native.context.architecture) fail();
    const context = { runtime: managed.processes[0].cwd, owner: managed.processes[0].uid, architecture: d.architecture };
    if (live) await verifyNativeProcessProof(native, context, nativeDependencies(d));
    else await verifyNativeFiles(native, context, nativeDependencies(d));
    if (d.boot() !== native.bootId) fail();
  }
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
function dependencies(overrides = {}, port, expectedBootId = null) {
  return { disk: captureRuntimeProof, supervision: captureSupervisionSnapshot, run,
    pm2Registry: inspectPm2Registry, pm2Control: controlPm2,
    capturePm2DumpTarget, persistPm2Dump, verifyPm2Dump,
    readRollback: readFrozenProductionSupabaseRollbackEnvironmentSnapshot,
    readProcessEnvironment: captureStableProductionProcessSupabaseEnvironment,
    readProcess: processOrNull, readNativeProcess: captureProcessFact, nativeFilesystem: {}, architecture: process.arch,
    ownedProcesses, readPause: (pid) => fixedEnvironment(pid, "FAOLLA_BACKGROUND_JOBS_PAUSED"),
    readLaunchEnvironment: launchEnvironmentFromProcess, workerFlags: workerFlagsFromFile,
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
    nodePath: realpathSync(process.execPath), ...overrides, port, expectedBootId };
}
async function observe(input, d, pauseExpected = null, workerRuntime = null) {
  const disk = pick(d.disk(input.appDir, input.expectedOldSha), DISK_KEYS);
  if (!validDisk(disk, input, input.expectedOldSha)) fail();
  const supervision = await d.supervision(input.appName, disk, input.appPort, input.expectedOldSha);
  if (classifyRuntimeSupervision({ ...supervision, runtime: disk.runtime, stable: true }) !== RUNTIME_SUPERVISION_CODES.direct) fail();
  const daemon = pick(supervision.listener.chain.find((entry) => entry.pid === supervision.ownership.daemonPid) ?? {}, PROCESS_KEYS);
  if (!validDaemon(daemon)) fail();
  const entries = await pm2List(daemon, d);
  const web = await managedProcess(entries, input.appName, disk.runtime, "web", daemon, d);
  if (!web || web.pm2.pid !== supervision.listener.pid || web.processes.length !== 1) fail();
  const environment = environmentSnapshot(disk.runtime, input.expectedOldSha, web.pm2.pid, d);
  if (pauseExpected !== null && d.readPause(web.pm2.pid) !== pauseExpected) fail();
  const worker = await managedProcess(entries, input.appName + "-enterprise-automation-worker", workerRuntime || disk.runtime, "worker", daemon, d);
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
    d.expectedBootId = bootId;
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
async function assertGone(managed, entries, d, allowInactive = false) {
  if (!managed) return;
  await verifyManagedNative(managed, d, false);
  if (allowInactive && managed.pm2.status === "stopped") {
    const matches = entries.filter((entry) => entry?.name === managed.pm2.name || entry?.pm_id === managed.pm2.pmId || entry?.pm2_env?.name === managed.pm2.name);
    if (!matches.length) return;
    const current = await managedProcess(entries, managed.pm2.name, managed.processes[0]?.cwd || d.oldRuntime, "worker", d.daemon, d);
    if (!equal(current, managed)) fail();
  } else if (entries.some((entry) => entry?.name === managed.pm2.name || entry?.pm_id === managed.pm2.pmId || entry?.pm2_env?.name === managed.pm2.name)) fail();
  for (const fact of managed.processes) {
    const current = d.readProcess(fact.pid);
    if (current !== null && current.startTicks === fact.startTicks) fail();
  }
}
async function assertWorkerStopped(proof, d, entries) {
  d.oldRuntime = proof.disk.runtime; d.daemon = proof.daemon;
  if (proof.worker.state === "absent") {
    if (entries.some((entry) => entry?.name === proof.input.appName + "-enterprise-automation-worker" ||
      entry?.pm2_env?.name === proof.input.appName + "-enterprise-automation-worker")) fail();
  } else await assertGone(proof.worker.managed, entries, d, true);
}
export async function assertRuntimeStopped(rawProof, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const d = dependencies(overrides, proof.input.appPort, proof.bootId);
    assertFrozenDisk(proof, d);
    const entries = await pm2List(proof.daemon, d); await assertGone(proof.web, entries, d); await assertWorkerStopped(proof, d, entries);
    assertNoUnfrozenRuntimeProcess(proof.disk.runtime, [], d);
    if (!d.portEmpty(proof.input.appPort)) fail();
    assertFrozenDisk(proof, d); return true;
  });
}
async function deleteExact(managed, kind, daemon, runtime, d) {
  if (!managed || managed.pm2.status === "stopped") return;
  const entries = await pm2List(daemon, d);
  const actual = await managedProcess(entries, managed.pm2.name, runtime, kind, daemon, d);
  if (!equal(actual, managed)) fail();
  await verifyManagedNative(managed, d, true);
  if (!equal(d.ownedProcesses(managed.pm2.pid), managed.processes)) fail();
  // Only the frozen PM2 numeric instance is addressed. No name fallback, restart,
  // broad process signal, or automatic repeat after an uncertain acknowledgement.
  const matches = entries.filter((row) => row.pm_id === managed.pm2.pmId && row.name === managed.pm2.name && row.pid === managed.pm2.pid);
  if (matches.length !== 1) fail();
  const expectedProcess = { ...pick(managed.processes[0], ["pid", "uid", "startTicks", "executable", "executableIdentity"]), bootId: d.boot() };
  if (expectedProcess.bootId !== d.expectedBootId) fail();
  try { await d.pm2Control(daemon, expectedProcess.bootId, { action: "delete", expected: matches[0], expectedProcess }); }
  catch { /* Verify actual stopped state below; never replay the request. */ }
  for (let attempt = 0; attempt < 60; attempt++) {
    const after = await pm2List(daemon, d);
    try { await assertGone(managed, after, d); return; }
    catch { if (attempt === 59) fail(); }
    await d.sleep(250);
  }
}
export async function stopRuntime(rawProof, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const d = dependencies(overrides, proof.input.appPort, proof.bootId);
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
    const input = { ...proof.input, expectedOldSha: targetSha }; const d = dependencies(overrides, input.appPort, proof.bootId);
    assertFrozenDisk(proof, d);
    const first = await observe(input, d, pauseExpected, proof.disk.runtime); await d.sleep(50); const second = await observe(input, d, pauseExpected, proof.disk.runtime);
    if (!equal(first, second)) fail();
    const entries = await pm2List(proof.daemon, d); await assertWorkerStopped(proof, d, entries);
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
    const d = dependencies(overrides, proof.input.appPort, proof.bootId);
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
  const entries = await pm2List(daemon, d);
  if (entries.some((entry) => entry?.name === managed.pm2.name || entry?.pm_id === managed.pm2.pmId || entry?.pm2_env?.name === managed.pm2.name)) {
    await deleteExact(managed, kind, daemon, runtime, d);
  } else await assertGone(managed, entries, d);
}

function startEnvironment(candidate, d, paused = "0") {
  const environment = d.readRollback(candidate.disk.runtime + "/.env.local", candidate.targetSha);
  if (environment.sha256 !== candidate.environment.sha256 || hash(JSON.stringify(pick(environment, CONFIG_KEYS))) !== candidate.environment.configurationHash) fail();
  const flags = d.workerFlags(candidate.disk.runtime + "/.env.local");
  if (flags.identity !== candidate.disk.environmentIdentity || flags.hash !== candidate.disk.environmentDigest ||
      !exact(flags.flags, ["MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED", "MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED"]) ||
      !Object.values(flags.flags).every((value) => ["true", "false"].includes(value))) fail();
  return { SUPABASE_INTERNAL_URL: environment.internalUrl, NEXT_PUBLIC_SUPABASE_URL: environment.publicUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.anonKey, MERCHANT_STAFF_BUSINESS_RBAC_MODE: environment.staffBusinessRbacMode,
    MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS: environment.staffBusinessRbacSiteIds,
    FAOLLA_CANONICAL_PORTAL_ORIGIN: environment.canonicalPortalOrigin, FAOLLA_BACKGROUND_JOBS_PAUSED: paused, PORT: String(d.port), ...flags.flags };
}

function launchAuthority(d) {
  const journal = d.launchJournal;
  if (!journal || ["attempt", "confirm", "unknown", "read", "checkpoint"].some((key) => typeof journal[key] !== "function")) fail();
  return journal;
}
function launchDigest(environment) {
  if (!exact(environment, LAUNCH_ENV_KEYS) || Object.values(environment).some((value) => typeof value !== "string" || value.length > 8192 || /[\0\r\n]/.test(value))) fail();
  return hash(JSON.stringify(pick(environment, LAUNCH_ENV_KEYS)));
}
function launchDescriptor(proof, disk, targetSha, d) {
  validateLaunchDisk(disk, proof, targetSha);
  const file = d.readRollback(disk.runtime + "/.env.local", targetSha);
  const descriptor = { targetSha, disk, daemon: proof.daemon, environment: { directoryIdentity: file.directoryIdentity,
    fileIdentity: file.fileIdentity, sha256: file.sha256, configurationHash: hash(JSON.stringify(pick(file, CONFIG_KEYS))) } };
  if (!validEnvironment(descriptor.environment, disk)) fail();
  assertCandidateDisk(proof, descriptor, d);
  return descriptor;
}
function journalInstance(managed) {
  return { ...pick(managed.processes[0], ["pid", "parentPid", "uid", "startTicks", "processIdentity", "cwd", "cwdIdentity",
    "executable", "executableIdentity", "commandLineDigest"]), pmId: managed.pm2.pmId, createdAt: managed.pm2.createdAt,
  pmUptime: managed.pm2.pmUptime, restartTime: managed.pm2.restartTime, metadataDigest: managed.pm2.metadataHash };
}
async function readLaunched(proof, descriptor, role, slot, d) {
  if (!LAUNCH_ROLES.includes(role) || !slot || slot.role !== role || !["attempted", "unknown", "confirmed"].includes(slot.phase) ||
      typeof slot.nonce !== "string" || !LAUNCH_NONCE.test(slot.nonce) || !DIGEST.test(slot.environmentDigest)) fail();
  const kind = role === "worker" ? "worker" : "web", name = proof.input.appName + (kind === "worker" ? "-enterprise-automation-worker" : "");
  assertCandidateDisk(proof, descriptor, d);
  const entries = await pm2List(proof.daemon, d);
  const managed = await managedProcess(entries, name, descriptor.disk.runtime, kind, proof.daemon, d);
  const row = entries.find((entry) => entry.name === name);
  if (!managed || managed.pm2.status !== "online" || managed.pm2.restartTime !== 0 || row.pm2_env.nonce !== slot.nonce ||
      row.pm2_env.envDigest !== slot.environmentDigest || row.pm2_env.autorestart !== (role !== "paused-web") ||
      managed.processes[0].executableIdentity !== proof.daemon.executableIdentity) fail();
  const initial = managed.processes[0], values = d.readLaunchEnvironment(initial.pid);
  if (!exact(values, [...LAUNCH_ENV_KEYS, "FAOLLA_MAINTENANCE_LAUNCH_NONCE"]) || values.FAOLLA_MAINTENANCE_LAUNCH_NONCE !== slot.nonce ||
      launchDigest(pick(values, LAUNCH_ENV_KEYS)) !== slot.environmentDigest || !equal(d.readProcess(initial.pid), initial)) fail();
  if (slot.phase === "confirmed") {
    // Idempotent confirmation compares the already frozen generation, including
    // its settled command line. It cannot adopt a later automatic restart.
    const actual = journalInstance(managed);
    if (Object.keys(actual).some((key) => actual[key] !== slot.instance?.[key])) fail();
  }
  assertCandidateDisk(proof, descriptor, d);
  return managed;
}
async function confirmLaunched(role, slot, managed, d) {
  await launchAuthority(d).confirm(role, { observedNonce: slot.nonce, environmentDigest: slot.environmentDigest, instance: journalInstance(managed) });
}
async function launchOnce(proof, descriptor, role, d) {
  const journal = launchAuthority(d), paused = role === "paused-web" ? "1" : "0";
  const environment = startEnvironment(descriptor, d, paused), environmentDigest = launchDigest(environment);
  const enabled = environment.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED === "true" || environment.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED === "true";
  if (enabled !== (proof.worker.state === "running")) fail();
  let slot = await journal.read(role);
  if (slot && !["planned", "attempted", "unknown", "confirmed"].includes(slot.phase)) fail();
  if (!slot || slot.phase === "planned") {
    const name = proof.input.appName + (role === "worker" ? "-enterprise-automation-worker" : "");
    const before = await pm2List(proof.daemon, d);
    if (before.some((row) => row.name === name) || role !== "worker" && !d.portEmpty(d.port)) fail();
    if (role === "worker") {
      d.file(descriptor.disk.runtime + "/node_modules/tsx/dist/cli.mjs");
      d.file(descriptor.disk.runtime + "/scripts/run-merchant-enterprise-automation-worker.ts");
    }
    assertCandidateDisk(proof, descriptor, d);
    // Durable planned -> attempted completion is the only path to one send.
    const nonce = await journal.attempt(role, descriptor.disk, environmentDigest);
    if (!LAUNCH_NONCE.test(nonce)) fail();
    slot = await journal.read(role);
    if (!slot || slot.phase !== "attempted" || slot.nonce !== nonce || slot.environmentDigest !== environmentDigest) fail();
    try {
      assertCandidateDisk(proof, descriptor, d);
      if (launchDigest(startEnvironment(descriptor, d, paused)) !== environmentDigest) fail();
      await d.pm2Control(proof.daemon, proof.bootId, { action: "prepare", launch: {
        role: role === "paused-web" ? "candidate-web" : role === "resumed-web" ? "final-web" : "final-worker",
        appName: proof.input.appName, appPort: d.port, release: descriptor.disk.runtime, node: d.nodePath,
        nonce, envDigest: environmentDigest, env: environment,
      } });
    } catch {
      await journal.unknown(role);
      throw new Error("production_maintenance_launch_outcome_unknown");
    }
  }
  if (slot.environmentDigest !== environmentDigest) fail();
  // Existing attempted/unknown/confirmed records are reconciled by observation,
  // never by resending a launch under the same or a newly invented nonce.
  return { role, slot, managed: await readLaunched(proof, descriptor, role, slot, d) };
}

async function waitForStartedCandidate(proof, candidate, d, overrides, launch) {
  const deadline = d.now() + 60_000;
  const launched = launch.managed;
  const identity = (managed) => ({ pm2: managed.pm2, processes: managed.processes.map((fact) => pick(fact, PROCESS_KEYS.filter((key) => key !== "commandLineDigest"))) });
  const assertLaunch = async () => {
    const current = await readLaunched(proof, candidate, launch.role, launch.slot, d);
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
    await assertLaunch();
    const observation = await bounded(() => d.supervision(proof.input.appName, candidate.disk, proof.input.appPort, candidate.targetSha));
    await assertLaunch();
    if (observation.listener.state !== "absent" &&
        (observation.listener.state !== "single" || observation.listener.pid !== launched.pm2.pid ||
          observation.ownership.state !== "owned" || observation.ownership.mode !== "direct")) fail();
    if (observation.healthVerified && observation.listener.state === "single") {
      const result = await bounded(() => captureCandidate(proof, candidate.targetSha, launch.role === "paused-web" ? "1" : "0", readOverrides));
      await assertLaunch(); await confirmLaunched(launch.role, launch.slot, result.web, d); return result;
    }
    if (deadline - d.now() < 250) fail();
    await d.sleep(250);
  }
  fail();
}
export async function startCandidate(rawProof, targetSha, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof), d = dependencies(overrides, proof.input.appPort, proof.bootId);
    if (!SHA.test(targetSha) || targetSha === proof.input.expectedOldSha) fail();
    launchAuthority(d);
    const disk = pick(d.disk(proof.input.appDir, targetSha), DISK_KEYS), descriptor = launchDescriptor(proof, disk, targetSha, d);
    const slot = await d.launchJournal.read("paused-web");
    if (!slot || slot.phase === "planned") await assertRuntimeStopped(proof, overrides);
    const launch = await launchOnce(proof, descriptor, "paused-web", d);
    return waitForStartedCandidate(proof, descriptor, d, overrides, launch);
  });
}
export function validateResumedCandidateProof(value, rawProof) {
  const proof = validateRuntimeProof(rawProof);
  if (!exact(value, ["version", "candidate", "worker"]) || value.version !== 1) fail();
  const candidate = validateCandidateProof(value.candidate, proof);
  if (candidate.pauseExpected !== "0" || (proof.worker.state === "running"
    ? !validManaged(value.worker, proof.input.appName + "-enterprise-automation-worker", candidate.disk.runtime, false, proof.bootId, true) : value.worker !== null)) fail();
  return structuredClone(value);
}
export async function resumeCandidate(rawProof, rawCandidate, targetSha, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const candidate = validateCandidateProof(rawCandidate, proof);
    if (candidate.targetSha !== targetSha || candidate.pauseExpected !== "1") fail();
    const d = dependencies(overrides, proof.input.appPort, proof.bootId);
    const journal = launchAuthority(d);
    await verifyCandidate(proof, candidate, "1", overrides);
    const paused = await journal.read("paused-web");
    if (!paused || paused.phase !== "confirmed" || !equal(await readLaunched(proof, candidate, "paused-web", paused, d), candidate.web)) fail();
    // No stop may precede the durable launch authority/configuration checks.
    startEnvironment(candidate, d);
    await deleteExact(candidate.web, "web", candidate.daemon, candidate.disk.runtime, d);
    await assertRuntimeStopped(proof, overrides);
    if (d.current(proof.input.appDir) !== candidate.disk.runtime) fail();
    // No reload/update-env of an unknown same-name replacement, and never resume
    // the old release. Only the exact already-verified candidate is restarted.
    let launchedWeb = null, launchedWorker = null;
    try {
      const launch = await launchOnce(proof, candidate, "resumed-web", d); launchedWeb = launch.managed;
      const resumed = await waitForStartedCandidate(proof, candidate, d, overrides, launch);
      launchedWeb = resumed.web;
      let worker = null;
      if (proof.worker.state === "running") {
        await assertWorkerStopped(proof, d, await pm2List(resumed.daemon, d));
        const workerLaunch = await launchOnce(proof, candidate, "worker", d); launchedWorker = workerLaunch.managed;
        await d.sleep(100);
        worker = await readLaunched(proof, candidate, "worker", workerLaunch.slot, d);
        if (!equal(worker, launchedWorker)) fail();
        await confirmLaunched("worker", workerLaunch.slot, worker, d);
      }
      const result = validateResumedCandidateProof({ version: 1, candidate: resumed, worker }, proof);
      await verifyResumedCandidate(proof, result, overrides); return result;
    } catch {
      let stopped = false;
      try {
        // Only nonce-bound launches from this operation can be adopted after a
        // lost ACK. Local observations additionally pin the pre-error generation.
        const workerSlot = await journal.read("worker");
        let worker = null;
        if (workerSlot && workerSlot.phase !== "planned") {
          worker = await readLaunched(proof, candidate, "worker", workerSlot, d);
          if (launchedWorker && !equal(worker, launchedWorker)) fail();
          await confirmLaunched("worker", workerSlot, worker, d);
        }
        const webSlot = await journal.read("resumed-web");
        if (webSlot && webSlot.phase !== "planned") {
          const web = await readLaunched(proof, candidate, "resumed-web", webSlot, d);
          const identity = (managed) => ({ pm2: managed.pm2, processes: managed.processes.map((p) => pick(p, PROCESS_KEYS.filter((key) => key !== "commandLineDigest"))) });
          if (launchedWeb && !equal(identity(web), identity(launchedWeb))) fail();
          await confirmLaunched("resumed-web", webSlot, web, d);
          const recoveryCandidate = validateCandidateProof({ ...candidate, pauseExpected: "0", web }, proof);
          const recoveryResumed = worker ? validateResumedCandidateProof({ version: 1, candidate: recoveryCandidate, worker }, proof) : null;
          // Persist the complete actual process tree before deleting it. A caller
          // can subsequently prove already-gone without inventing missing facts.
          await journal.checkpoint({ candidate: recoveryCandidate, resumed: recoveryResumed });
          if (worker) await deleteExact(worker, "worker", candidate.daemon, candidate.disk.runtime, d);
          await deleteExact(web, "web", candidate.daemon, candidate.disk.runtime, d);
        } else if (worker) fail();
        assertNoUnfrozenRuntimeProcess(candidate.disk.runtime, [], d);
        await assertRuntimeStopped(proof, overrides); stopped = true;
      } catch { /* Keep the caller's ingress fence closed and expose only certainty. */ }
      throw new Error(stopped ? "production_maintenance_runtime_resume_failed_stopped" : "production_maintenance_runtime_resume_failed_unknown");
    }
  });
}
export async function reconcileMaintenanceLaunches(rawProof, rawDisk, targetSha, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof), d = dependencies(overrides, proof.input.appPort, proof.bootId), journal = launchAuthority(d);
    const descriptor = launchDescriptor(proof, validateLaunchDisk(rawDisk, proof, targetSha), targetSha, d);
    const resumedSlot = await journal.read("resumed-web"), role = resumedSlot ? "resumed-web" : "paused-web";
    const webSlot = resumedSlot || await journal.read("paused-web");
    if (!webSlot || webSlot.phase === "planned") {
      assertNoUnfrozenRuntimeProcess(descriptor.disk.runtime, [], d);
      await assertRuntimeStopped(proof, overrides); return { candidate: null, resumed: null };
    }
    const web = await readLaunched(proof, descriptor, role, webSlot, d);
    await d.sleep(50);
    if (!equal(web, await readLaunched(proof, descriptor, role, webSlot, d))) fail();
    await confirmLaunched(role, webSlot, web, d);
    const candidate = validateCandidateProof({ version: 1, ...descriptor, pauseExpected: role === "paused-web" ? "1" : "0", web }, proof);
    const workerSlot = await journal.read("worker");
    if (!workerSlot || workerSlot.phase === "planned") {
      assertNoUnfrozenRuntimeProcess(descriptor.disk.runtime, web.processes.map((fact) => fact.pid), d);
      return { candidate, resumed: null };
    }
    if (role !== "resumed-web" || proof.worker.state !== "running") fail();
    const worker = await readLaunched(proof, descriptor, "worker", workerSlot, d);
    await d.sleep(50);
    if (!equal(worker, await readLaunched(proof, descriptor, "worker", workerSlot, d))) fail();
    await confirmLaunched("worker", workerSlot, worker, d);
    assertNoUnfrozenRuntimeProcess(descriptor.disk.runtime, [...web.processes, ...worker.processes].map((fact) => fact.pid), d);
    return { candidate, resumed: validateResumedCandidateProof({ version: 1, candidate, worker }, proof) };
  });
}
export async function verifyResumedCandidate(rawProof, rawResumed, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const resumed = validateResumedCandidateProof(rawResumed, proof);
    const candidate = resumed.candidate; const d = dependencies(overrides, proof.input.appPort, proof.bootId);
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
export function validateResumedDumpProof(value, rawProof, rawResumed) {
  const proof = validateRuntimeProof(rawProof), resumed = validateResumedCandidateProof(rawResumed, proof);
  if (!exact(value, ["version", "resumed", "registry", "receipt"]) || value.version !== 1 || !equal(value.resumed, resumed)) fail();
  const registry = validatePm2Registry(value.registry);
  const receipt = validatePm2DumpReceipt(value.receipt, proof.daemon, proof.bootId, registry);
  for (const managed of [resumed.candidate.web, resumed.worker].filter(Boolean)) {
    const row = registry.find((entry) => entry.name === managed.pm2.name);
    if (!row || row.pid !== managed.pm2.pid || row.pm_id !== managed.pm2.pmId || row.pm2_env.status !== "online" ||
        row.pm2_env.created_at !== managed.pm2.createdAt || row.pm2_env.pm_uptime !== managed.pm2.pmUptime ||
        row.pm2_env.restart_time !== managed.pm2.restartTime || row.pm2_env.pm_cwd !== resumed.candidate.disk.runtime) fail();
  }
  return { version: 1, resumed, registry, receipt };
}
export async function persistResumedDump(rawProof, rawResumed, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof), resumed = validateResumedCandidateProof(rawResumed, proof);
    const d = dependencies(overrides, proof.input.appPort, proof.bootId);
    await verifyResumedCandidate(proof, resumed, overrides);
    const registry = await pm2List(proof.daemon, d);
    const target = await d.capturePm2DumpTarget(proof.daemon, proof.bootId);
    await verifyResumedCandidate(proof, resumed, overrides);
    if (pm2RegistryDigest(await pm2List(proof.daemon, d)) !== pm2RegistryDigest(registry)) fail();
    const receipt = await d.persistPm2Dump(proof.daemon, proof.bootId, registry, target);
    const result = validateResumedDumpProof({ version: 1, resumed, registry, receipt }, proof, resumed);
    await verifyResumedDump(proof, resumed, result, overrides);
    return result;
  });
}
export async function verifyResumedDump(rawProof, rawResumed, rawDump, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof), resumed = validateResumedCandidateProof(rawResumed, proof);
    const dump = validateResumedDumpProof(rawDump, proof, resumed), d = dependencies(overrides, proof.input.appPort, proof.bootId);
    await verifyResumedCandidate(proof, resumed, overrides);
    if (pm2RegistryDigest(await pm2List(proof.daemon, d)) !== pm2RegistryDigest(dump.registry) ||
        await d.verifyPm2Dump(proof.daemon, proof.bootId, dump.registry, dump.receipt) !== true) fail();
    await verifyResumedCandidate(proof, resumed, overrides);
    if (pm2RegistryDigest(await pm2List(proof.daemon, d)) !== pm2RegistryDigest(dump.registry)) fail();
    return true;
  });
}
export async function stopResumedCandidate(rawProof, rawResumed, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const resumed = validateResumedCandidateProof(rawResumed, proof);
    const d = dependencies(overrides, proof.input.appPort, proof.bootId);
    assertCandidateDisk(proof, resumed.candidate, d);
    await stopFrozenOrAlreadyGone(resumed.worker, "worker", resumed.candidate.daemon, resumed.candidate.disk.runtime, d);
    await stopFrozenOrAlreadyGone(resumed.candidate.web, "web", resumed.candidate.daemon, resumed.candidate.disk.runtime, d);
    assertNoUnfrozenRuntimeProcess(resumed.candidate.disk.runtime, [], d);
    return assertRuntimeStopped(proof, overrides);
  });
}
export async function readRuntimeHandoffEnvironment(rawProof, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof); const d = dependencies(overrides, proof.input.appPort, proof.bootId);
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

export async function readManagedSnapshot(rawProof, rawCandidate, kind, overrides = {}) {
  return guarded(async () => {
    const proof = validateRuntimeProof(rawProof), d = dependencies(overrides, proof.input.appPort, proof.bootId);
    if (!["web", "worker"].includes(kind)) fail();
    const candidate = rawCandidate === null ? null : validateCandidateProof(rawCandidate, proof);
    if (candidate) await verifyCandidate(proof, candidate, "1", overrides);
    else await assertRuntimeStopped(proof, overrides);
    const name = proof.input.appName + (kind === "worker" ? "-enterprise-automation-worker" : "");
    const managed = await managedProcess(await pm2List(proof.daemon, d), name,
      kind === "web" && candidate ? candidate.disk.runtime : proof.disk.runtime, kind, proof.daemon, d);
    if (kind === "web" && candidate && !equal(managed, candidate.web)) fail();
    if (!managed) return "absent";
    if (managed.pm2.status === "stopped") {
      if (kind !== "worker" || !equal(managed, proof.worker.managed)) fail();
      return "inactive";
    }
    if (kind !== "web" || !candidate) fail();
    return `running:${managed.pm2.pid}`;
  });
}

export async function readCandidateHandoffFields(rawProof, rawCandidate, overrides = {}) {
  const proof = validateRuntimeProof(rawProof), candidate = validateCandidateProof(rawCandidate, proof);
  await verifyCandidate(proof, candidate, "1", overrides);
  const fact = candidate.web.processes[0], directory = fact.cwdIdentity.split(":");
  return {
    CANDIDATE_WEB_PID: String(fact.pid), CANDIDATE_WEB_PROCESS_START_TICKS: fact.startTicks,
    CANDIDATE_WEB_PROCESS_IDENTITY: fact.processIdentity.split(":").slice(0, 2).join(":"),
    CANDIDATE_WEB_CWD_IDENTITY: `${directory[0]}:${directory[1]}:${BigInt(directory[4]) / 1000000000n}`,
    // Genuine typed candidate evidence, never a stand-in for the legacy CLI proof.
    CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64: Buffer.from(JSON.stringify(candidate), "utf8").toString("base64"),
  };
}
