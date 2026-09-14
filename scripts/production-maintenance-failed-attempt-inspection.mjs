import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { isDeepStrictEqual, types } from "node:util";
import { validateMaintenanceLaunchJournal } from "./production-maintenance-launch-journal.mjs";
import { inspectPm2Registry, pm2RegistryDigest, validatePm2Registry } from "./production-maintenance-pm2-adapter.mjs";
import { assertMaintenanceDaemonContinuity } from "./production-maintenance-daemon-continuity.mjs";
import { assertFailedCandidateStopped, assertFailedCandidateGenerationStopped } from "./production-maintenance-failed-candidate-inspection.mjs";
import { validateMaintenanceSecondAttemptRecoveryPredecessor } from "./production-maintenance-second-attempt-recovery.mjs";

/** Read-only observation of the exact consumed T6 attempt, retaining T5 and O.
 * This is not maintenance authority, a new runtime proof, or a state writer.
 * The caller owns state-byte stability, its lock, ingress/DB checks and the
 * separately authorized deadline. No historical clock is used here.
 *
 * The candidate projection below is ONLY an input to the existing read-only
 * stopped assertion: its real T6 disk/process fields are never relabelled O,
 * persisted as the original runtime, or used to call a process actuator.
 */
const ERROR = "production_maintenance_failed_attempt_unverified";
const PIN = "785a4139be1cc78b42fd0a9e2dde619d995f0b2f1be521589ec31fd900c0db75";
const BOOT = "e6531ec9-db4a-4216-b87a-7cc858197eaa";
const OPERATION = "eb81284a-09c4-4514-8f16-38eaf6acc1e4";
const OLD = "cd943076ebda758b70bf2f2270a508c774b726d6";
const TARGET = "3af8fa6ba6644593e10bef0a391389b2b34e926a";
const APP = "/www/wwwroot/merchant-space";
const STATE_KEYS = ["version", "revision", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed", "launchDisk", "launchJournal", "finalDump", "recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery"];
const BASELINE_KEYS = ["version", "stateDigest", "candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "current", "bootId", "pm2RegistryDigest", "observedAt"];
const PROCESS_KEYS = ["pid", "parentPid", "uid", "startTicks", "processIdentity", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLineDigest"];
const RUNTIME_IO = ["readRollback", "readProcess", "readNativeProcess", "nativeFilesystem", "architecture", "boot", "file", "runtimeIdentity", "processesInRuntime", "portEmpty", "nodePath", "pm2Registry"];
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => { throw new Error(ERROR); };
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const digest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function capture(value, budget = { count: 0 }, depth = 0) {
  if (++budget.count > 100000 || depth > 64) fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (!value || typeof value !== "object" || types.isProxy(value)) fail();
  const array = Array.isArray(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (![array ? Array.prototype : Object.prototype, ...(array ? [] : [null])].includes(Object.getPrototypeOf(value)) ||
      (array && (value.length > 100000 || keys.length !== value.length + 1))) fail();
  const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === "length") continue;
    const property = descriptors[key];
    if (typeof key !== "string" || !property.enumerable || !Object.hasOwn(property, "value") ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) fail();
    Object.defineProperty(result, key, { value: capture(property.value, budget, depth + 1), enumerable: true, writable: true });
  }
  return result;
}
function bounded(value) {
  const result = capture(value);
  if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) fail();
  return result;
}
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function identity(value, kind) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,24})(?::(?:0|[1-9][0-9]{0,24})){7}$/.test(value)) fail();
  const fields = value.split(":").map(BigInt), mode = fields[7];
  if (fields[6] !== 0n || fields[5] < 1n || (kind === "link" ?
    fields[5] !== 1n || (mode & 0o170000n) !== 0o120000n :
    (mode & 0o170000n) !== 0o040000n || (mode & 0o022n) !== 0n)) fail();
}
function current(value) {
  if (!exact(value, ["target", "linkIdentity", "runtimeIdentity"]) || typeof value.target !== "string" ||
      posix.dirname(value.target) !== APP + ".releases" ||
      !/^3af8fa6ba664-[0-9]{14}$/.test(posix.basename(value.target))) fail();
  identity(value.linkIdentity, "link"); identity(value.runtimeIdentity, "directory");
  return value;
}
export function validateFailedAttemptBaseline(raw) {
  const value = bounded(raw);
  if (!exact(value, BASELINE_KEYS) || value.version !== 2 || value.stateDigest !== PIN || value.bootId !== BOOT ||
      !["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "pm2RegistryDigest"].every(key => digest(value[key])) ||
      !Number.isSafeInteger(value.observedAt) || value.observedAt <= 0) fail();
  current(value.current);
  return freeze(value);
}

const statIdentity = stat => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"].map(key => String(stat[key])).join(":");
function readCurrent(appDir, runtime) {
  if (appDir !== APP) fail();
  const link = appDir + ".current", before = lstatSync(link, { bigint: true });
  if (!before.isSymbolicLink() || before.nlink !== 1n || before.uid !== 0n || realpathSync(posix.dirname(link)) !== posix.dirname(link)) fail();
  const rawTarget = readlinkSync(link), actual = realpathSync(link), directory = lstatSync(runtime, { bigint: true });
  if (rawTarget !== runtime || actual !== runtime || !directory.isDirectory() || directory.isSymbolicLink() || realpathSync(runtime) !== runtime) fail();
  const result = current({ target: actual, linkIdentity: statIdentity(before), runtimeIdentity: statIdentity(directory) });
  if (statIdentity(lstatSync(link, { bigint: true })) !== result.linkIdentity || readlinkSync(link) !== rawTarget ||
      realpathSync(link) !== actual || statIdentity(lstatSync(runtime, { bigint: true })) !== result.runtimeIdentity) fail();
  return result;
}
function ioOptions(raw) {
  // Test seams are filesystem/process observations, never an assertion, hash,
  // current fallback, process-control operation, or arbitrary module loader.
  if (!raw || typeof raw !== "object" || types.isProxy(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail();
  const out = {};
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!["runtime", "readCurrent", "now"].includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    out[key] = descriptor.value;
  }
  const runtime = out.runtime ?? {};
  if (!runtime || typeof runtime !== "object" || types.isProxy(runtime) || ![Object.prototype, null].includes(Object.getPrototypeOf(runtime))) fail();
  const captured = {};
  for (const key of Reflect.ownKeys(runtime)) {
    const descriptor = Object.getOwnPropertyDescriptor(runtime, key);
    if (!RUNTIME_IO.includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    captured[key] = descriptor.value;
  }
  return { runtime: captured, readCurrent: out.readCurrent ?? readCurrent, now: out.now ?? Date.now };
}
async function checkedState(raw, runtimeApi, now) {
  const state = validateMaintenanceSecondAttemptRecoveryPredecessor(bounded(raw), { bootId: BOOT, now });
  if (!exact(state, STATE_KEYS) || hash(state) !== PIN || state.version !== 6 || state.revision !== 23 || state.activeAttempt !== 1 || state.phase !== "failed-held" ||
      state.operationId !== OPERATION || state.targetSha !== TARGET || state.expectedOldSha !== OLD || state.bootId !== BOOT ||
      state.createdAt !== 1789236034129 || state.appDir !== APP || state.appName !== "merchant-space" || state.appPort !== 3000 ||
      state.candidate === null || state.launchDisk === null || state.launchJournal === null || state.resumed !== null || state.finalDump !== null) fail();
  if (!isDeepStrictEqual(state.runtime, state.attemptRecovery.predecessor.state.runtime)) fail();
  const proof = runtimeApi.validateRuntimeProof(state.runtime);
  const candidate = runtimeApi.validateCandidateProof(state.candidate, proof);
  runtimeApi.validateLaunchDisk(state.launchDisk, proof, TARGET);
  if (!isDeepStrictEqual(proof.input, { appDir: APP, appName: state.appName, appPort: state.appPort, expectedOldSha: OLD }) || proof.bootId !== BOOT ||
      proof.worker.state !== "running" || candidate.targetSha !== TARGET || candidate.pauseExpected !== "1" || !isDeepStrictEqual(candidate.disk, state.launchDisk)) fail();
  const daemon = proof.daemon, disk = state.launchDisk;
  const journal = validateMaintenanceLaunchJournal(state.launchJournal, {
    operationId: OPERATION, targetSha: TARGET, appName: state.appName, appPort: state.appPort,
    daemon: { pid: daemon.pid, uid: daemon.uid, startTicks: daemon.startTicks, bootId: BOOT, executable: daemon.executable, executableIdentity: daemon.executableIdentity },
    release: { path: disk.runtime, identity: disk.runtimeIdentity, buildDigest: disk.nextBuildDigest },
  });
  const slot = journal.slots["paused-web"], process = candidate.web.processes[0], pm2 = candidate.web.pm2;
  if (slot?.phase !== "confirmed" || slot.sequence !== 1 || journal.slots["resumed-web"] !== null || journal.slots.worker !== null ||
      !isDeepStrictEqual(slot.instance, { ...Object.fromEntries(PROCESS_KEYS.map(key => [key, process[key]])), pmId: pm2.pmId,
        createdAt: pm2.createdAt, pmUptime: pm2.pmUptime, restartTime: pm2.restartTime, metadataDigest: pm2.metadataHash })) fail();
  return { state, proof, candidate };
}
async function prepare(rawState, overrides) {
  const io = ioOptions(overrides);
  // runtime imports an old supervision executable that treats stdin as main.
  // Never load that graph from a stdin/eval invocation; the real caller uses
  // its checked file CLI. Importing THIS module alone has no such side effect.
  if (!process.argv[1] || process.argv[1] === "-") fail();
  const runtimeApi = await import("./production-maintenance-runtime.mjs");
  return { io, runtimeApi, ...await checkedState(rawState, runtimeApi, io.now()) };
}
async function assertAllStopped({ io, runtimeApi, state, proof, candidate }) {
  const boot = io.runtime.boot ?? (() => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
  if (boot() !== BOOT) fail();
  const observed = [], inspect = io.runtime.pm2Registry ?? inspectPm2Registry;
  const runtimeIo = { ...io.runtime, pm2Registry: async (daemon, bootId) => {
    const registry = validatePm2Registry(await inspect(daemon, bootId));
    observed.push(pm2RegistryDigest(registry)); return registry;
  } };
  // This independently verifies O and the archived T5; it never inspects or
  // rewrites current. T6 below is a real candidate-only read assertion input.
  if (await assertFailedCandidateStopped(state.attemptRecovery.predecessor.state, { runtime: runtimeIo }) !== true) fail();
  const candidateOnly = { version: 1, input: { ...proof.input, expectedOldSha: TARGET }, bootId: BOOT,
    disk: candidate.disk, environment: candidate.environment, daemon: candidate.daemon, web: candidate.web,
    worker: { state: "absent", managed: null } };
  if (await runtimeApi.assertRuntimeStopped(candidateOnly, runtimeIo) !== true) fail();
  if (boot() !== BOOT || observed.length < 3 || observed.some(value => value !== observed[0])) fail();
  validateMaintenanceSecondAttemptRecoveryPredecessor(state, { bootId: BOOT, now: io.now() });
  return observed[0];
}
/** For a later active attempt whose current link has legitimately moved. This
 * still proves O, T5 and T6 generations stopped, frozen files and no port
 * listener. It does not attest the new current target, ingress or permission. */
export async function assertFailedAttemptStopped(rawState, overrides = {}) {
  try { await assertAllStopped(await prepare(rawState, overrides)); return true; }
  catch { fail(); }
}
/** During a NEW candidate's lifetime only. This verifies the historical T5 and T6
 * generation remains absent; it intentionally makes NO empty-port assertion.
 * The caller must separately verify the new candidate, listener and ingress. */
export async function assertFailedAttemptGenerationsStopped(rawState, overrides = {}) {
  try {
    const { io, runtimeApi, state, proof, candidate } = await prepare(rawState, overrides);
    const { captureProcessFact } = await import("./check-production-runtime-supervision.mjs");
    const readProcess = io.runtime.readProcess ?? (pid => {
      try { lstatSync(`/proc/${pid}`); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
      const fact = captureProcessFact(pid); return Object.fromEntries(PROCESS_KEYS.map(key => [key, fact[key]]));
    });
    const processesInRuntime = io.runtime.processesInRuntime ?? (runtime => {
      const names = readdirSync("/proc").filter(name => /^[1-9][0-9]*$/.test(name));
      if (names.length > 16384) fail();
      return names.flatMap(name => {
        try { const cwd = realpathSync(`/proc/${name}/cwd`); return cwd === runtime || cwd.startsWith(runtime + "/") ? [Number(name)] : []; }
        catch (error) { if (error?.code === "ENOENT") return []; throw error; }
      });
    });
    const boot = io.runtime.boot ?? (() => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
    const originalInspect = io.runtime.pm2Registry ?? inspectPm2Registry, observed = [];
    const inspect = async (daemon, bootId) => {
      const rows = validatePm2Registry(await originalInspect(daemon, bootId)); observed.push(pm2RegistryDigest(rows)); return rows;
    };
    const runtimeIo = { ...io.runtime, pm2Registry: inspect };
    const candidateOnly = { version: 1, input: { ...proof.input, expectedOldSha: TARGET }, bootId: BOOT,
      disk: candidate.disk, environment: candidate.environment, daemon: candidate.daemon, web: candidate.web,
      worker: { state: "absent", managed: null } };
    if (boot() !== BOOT) fail();
    const daemonBefore = readProcess(proof.daemon.pid);
    assertMaintenanceDaemonContinuity(proof.daemon, daemonBefore, BOOT);
    let registryDigest = null;
    for (let observation = 0; observation < 2; observation++) {
      // The archived T5 is checked on both rounds, without inventing an empty
      // port while the legitimate new candidate may own that listener.
      await assertFailedCandidateGenerationStopped(state.attemptRecovery.predecessor.state, { runtime: runtimeIo });
      await runtimeApi.readRuntimeHandoffEnvironment(candidateOnly, io.runtime);
      for (const fact of candidate.web.processes) {
        const actual = readProcess(fact.pid); if (actual !== null && actual.startTicks === fact.startTicks) fail();
      }
      const pids = bounded(processesInRuntime(candidate.disk.runtime));
      if (!Array.isArray(pids) || pids.length !== 0) fail();
      const entries = validatePm2Registry(await inspect(proof.daemon, BOOT));
      if (entries.some(entry => entry.pm2_env.pm_cwd === candidate.disk.runtime ||
          entry.pm2_env.pm_exec_path.startsWith(candidate.disk.runtime + "/") ||
          (entry.pm_id === candidate.web.pm2.pmId && entry.pm2_env.created_at === candidate.web.pm2.createdAt))) fail();
      const actualDigest = pm2RegistryDigest(entries);
      if (registryDigest !== null && registryDigest !== actualDigest) fail();
      registryDigest = actualDigest;
      if (boot() !== BOOT || !isDeepStrictEqual(readProcess(proof.daemon.pid), daemonBefore)) fail();
    }
    if (observed.length < 6 || observed.some(value => value !== observed[0])) fail();
    validateMaintenanceSecondAttemptRecoveryPredecessor(state, { bootId: BOOT, now: io.now() });
    return true;
  } catch { fail(); }
}
export async function captureFailedAttemptBaseline(rawState, overrides = {}) {
  try {
    const prepared = await prepare(rawState, overrides), { io, state, candidate } = prepared;
    const before = current(bounded(io.readCurrent(APP, candidate.disk.runtime)));
    if (before.target !== candidate.disk.runtime || before.runtimeIdentity !== candidate.disk.runtimeIdentity) fail();
    const registryDigest = await assertAllStopped(prepared);
    const after = current(bounded(io.readCurrent(APP, candidate.disk.runtime)));
    if (!isDeepStrictEqual(before, after)) fail();
    return validateFailedAttemptBaseline({ version: 2, stateDigest: PIN, candidateDigest: hash(state.candidate),
      launchDiskDigest: hash(state.launchDisk), launchJournalDigest: hash(state.launchJournal), runtimeDigest: hash(state.runtime),
      current: after, bootId: BOOT, pm2RegistryDigest: registryDigest, observedAt: io.now() });
  } catch { fail(); }
}
export async function verifyFailedAttemptBaseline(state, rawBaseline, overrides = {}) {
  try {
    const baseline = validateFailedAttemptBaseline(rawBaseline);
    const fresh = await captureFailedAttemptBaseline(state, overrides);
    if (fresh.observedAt < baseline.observedAt || !isDeepStrictEqual({ ...fresh, observedAt: baseline.observedAt }, baseline)) fail();
    // Keep the caller's original observedAt/digest for its signed inspection.
    return true;
  } catch { fail(); }
}
