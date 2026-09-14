import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { isDeepStrictEqual, types } from "node:util";
import { validateMaintenanceLaunchJournal } from "./production-maintenance-launch-journal.mjs";
import { inspectPm2Registry, pm2RegistryDigest, validatePm2Registry } from "./production-maintenance-pm2-adapter.mjs";
import { assertMaintenanceDaemonContinuity } from "./production-maintenance-daemon-continuity.mjs";
import { MAINTENANCE_PREFLIGHT_RECOVERY_AUTHORIZATION as AUTHORIZATION,
  validateMaintenancePreflightRecoveryPredecessor, reconstructMaintenancePreflightRecoveryPredecessor } from "./production-maintenance-preflight-recovery.mjs";

/** Read-only observation of the exact consumed T7 attempt, retaining T6, T5 and O.
 * This is not maintenance authority, a new runtime proof, or a state writer.
 * The caller owns state-byte stability, its lock, ingress/DB checks and the
 * separately authorized deadline. All I/O uses the actual new window clock.
 * The unchanged budget observation backbone is deliberately local: the old
 * budget API and its ordinary deadline are not extended or given an override.
 * The pure preflight validator alone verifies prior audits at their recorded times;
 * no historical clock is passed to a process/filesystem observation.
 *
 * The candidate projection below is ONLY an input to the existing read-only
 * stopped assertion: its real T7 disk/process fields are never relabelled O,
 * persisted as the original runtime, or used to call a process actuator.
 */
const ERROR = "production_maintenance_preflight_inspection_unverified";
const PIN = "a7767b3e1e5a788282c16a57a91ed588821cb0b5894925fcff9d5e544e5d6003";
const BOOT = "e6531ec9-db4a-4216-b87a-7cc858197eaa";
const OPERATION = "eb81284a-09c4-4514-8f16-38eaf6acc1e4";
const OLD = "cd943076ebda758b70bf2f2270a508c774b726d6";
const TARGET = "d9de5fe689226fcdd13a1e95039901b5d0f39167";
const APP = "/www/wwwroot/merchant-space";
const STATE_KEYS = ["version", "revision", "operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "phase", "runtime", "ingress", "database", "publicSupabaseUrl", "tokenHash", "candidate", "resumed", "launchDisk", "launchJournal", "finalDump", "recovery", "continuation", "buildRecovery", "deadlineExtension", "activeAttempt", "attemptRecovery", "secondAttemptRecovery"];
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
      !/^d9de5fe68922-[0-9]{14}$/.test(posix.basename(value.target))) fail();
  identity(value.linkIdentity, "link"); identity(value.runtimeIdentity, "directory");
  return value;
}
export function validatePreflightRecoveryBaseline(raw) {
  const value = bounded(raw);
  if (!exact(value, BASELINE_KEYS) || value.version !== 3 || value.stateDigest !== PIN || value.bootId !== BOOT ||
      !["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest", "pm2RegistryDigest"].every(key => digest(value[key])) ||
      !Number.isSafeInteger(value.observedAt) || value.observedAt < AUTHORIZATION.authorizedAt || value.observedAt >= AUTHORIZATION.expiresAt) fail();
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
function authorizedPredecessor(raw, now) {
  const value = bounded(raw), clock = { bootId: BOOT, now };
  if (value.version === 10) return validateMaintenancePreflightRecoveryPredecessor(value, clock);
  if (value.version === 11) return reconstructMaintenancePreflightRecoveryPredecessor(value, clock);
  fail();
}
async function checkedState(raw, runtimeApi, now) {
  const authorityState = bounded(raw), predecessor = authorizedPredecessor(authorityState, now);
  // This exact T7 substate has already passed the complete immutable history.
  // It is observation input only, not a restored active state or authority.
  const state = predecessor.budgetRecovery.predecessor.state;
  if (!exact(state, STATE_KEYS) || hash(state) !== PIN || state.version !== 7 || state.revision !== 31 || state.activeAttempt !== 2 || state.phase !== "failed-held" ||
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
  const historical = [state.attemptRecovery.predecessor.state, state.secondAttemptRecovery.predecessor.state, state];
  const candidates = historical.map(item => {
    if (!isDeepStrictEqual(item.runtime, proof)) fail();
    const typed = runtimeApi.validateCandidateProof(item.candidate, proof);
    if (typed.targetSha !== item.targetSha || typed.pauseExpected !== "1") fail();
    return typed;
  });
  const projections = candidates.map(typed => ({ version: 1, input: { ...proof.input, expectedOldSha: typed.targetSha }, bootId: BOOT,
    disk: typed.disk, environment: typed.environment, daemon: typed.daemon, web: typed.web,
    worker: { state: "absent", managed: null } }));
  return { state, authorityState, proof, candidate, projections };
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
async function assertAllStopped({ io, runtimeApi, authorityState, proof, projections }) {
  const boot = io.runtime.boot ?? (() => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
  if (boot() !== BOOT) fail();
  const observed = [], inspect = io.runtime.pm2Registry ?? inspectPm2Registry;
  const runtimeIo = { ...io.runtime, pm2Registry: async (daemon, bootId) => {
    const registry = validatePm2Registry(await inspect(daemon, bootId));
    observed.push(pm2RegistryDigest(registry)); return registry;
  } };
  // Frozen original O plus each actual historical candidate disk/process proof.
  // The old version's expired authority is not reused and no actuator is called.
  for (const frozen of [proof, ...projections]) {
    if (await runtimeApi.assertRuntimeStopped(frozen, runtimeIo) !== true) fail();
  }
  if (boot() !== BOOT || observed.length < 4 || observed.some(value => value !== observed[0])) fail();
  authorizedPredecessor(authorityState, io.now());
  return observed[0];
}
export async function assertPreflightRecoveryStopped(rawState, overrides = {}) {
  try { await assertAllStopped(await prepare(rawState, overrides)); return true; }
  catch { fail(); }
}
/** Fresh historical-generation observations while the new candidate owns its
 * listener. Never requires an empty port or changes the current symlink. */
export async function assertPreflightRecoveryGenerationsStopped(rawState, overrides = {}) {
  try {
    const { io, runtimeApi, authorityState, proof, projections } = await prepare(rawState, overrides);
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
    const inspect = io.runtime.pm2Registry ?? inspectPm2Registry;
    if (boot() !== BOOT) fail();
    const daemonBefore = readProcess(proof.daemon.pid);
    assertMaintenanceDaemonContinuity(proof.daemon, daemonBefore, BOOT);
    let registryDigest = null;
    for (let observation = 0; observation < 2; observation++) {
      const frozen = [proof, ...projections];
      for (const item of frozen) {
        await runtimeApi.readRuntimeHandoffEnvironment(item, io.runtime);
        const managed = [item.web, ...(item.worker.managed ? [item.worker.managed] : [])];
        for (const owner of managed) for (const fact of owner.processes) {
          const actual = readProcess(fact.pid); if (actual !== null && actual.startTicks === fact.startTicks) fail();
        }
        const pids = bounded(processesInRuntime(item.disk.runtime));
        if (!Array.isArray(pids) || pids.length !== 0) fail();
      }
      const entries = validatePm2Registry(await inspect(proof.daemon, BOOT));
      if (entries.some(entry => frozen.some(item => entry.pm2_env.pm_cwd === item.disk.runtime ||
          entry.pm2_env.pm_exec_path.startsWith(item.disk.runtime + "/") ||
          [item.web, ...(item.worker.managed ? [item.worker.managed] : [])].some(managed =>
            entry.pm_id === managed.pm2.pmId && entry.pm2_env.created_at === managed.pm2.createdAt)))) fail();
      const actualDigest = pm2RegistryDigest(entries);
      if (registryDigest !== null && registryDigest !== actualDigest) fail();
      registryDigest = actualDigest;
      if (boot() !== BOOT || !isDeepStrictEqual(readProcess(proof.daemon.pid), daemonBefore)) fail();
    }
    authorizedPredecessor(authorityState, io.now());
    return true;
  } catch { fail(); }
}
export async function capturePreflightRecoveryBaseline(rawState, overrides = {}) {
  try {
    const prepared = await prepare(rawState, overrides), { io, state, authorityState, candidate } = prepared;
    const before = current(bounded(io.readCurrent(APP, candidate.disk.runtime)));
    if (before.target !== candidate.disk.runtime || before.runtimeIdentity !== candidate.disk.runtimeIdentity) fail();
    const registryDigest = await assertAllStopped(prepared);
    const after = current(bounded(io.readCurrent(APP, candidate.disk.runtime)));
    if (!isDeepStrictEqual(before, after)) fail();
    const observedAt = io.now(), predecessor = authorizedPredecessor(authorityState, observedAt);
    const baseline = validatePreflightRecoveryBaseline({ version: 3, stateDigest: PIN, candidateDigest: hash(state.candidate),
      launchDiskDigest: hash(state.launchDisk), launchJournalDigest: hash(state.launchJournal), runtimeDigest: hash(state.runtime),
      current: after, bootId: BOOT, pm2RegistryDigest: registryDigest, observedAt });
    // Renewal preserves the SAME unused stopped instance. A fresh timestamp
    // does not permit re-anchoring the current symlink or registry generation.
    const previous = predecessor.prelaunchRecovery.stoppedBaseline;
    if (!isDeepStrictEqual({ ...baseline, observedAt: previous.observedAt }, previous)) fail();
    return baseline;
  } catch { fail(); }
}
export async function verifyPreflightRecoveryBaseline(state, rawBaseline, overrides = {}) {
  try {
    const baseline = validatePreflightRecoveryBaseline(rawBaseline);
    const fresh = await capturePreflightRecoveryBaseline(state, overrides);
    if (fresh.observedAt < baseline.observedAt || !isDeepStrictEqual({ ...fresh, observedAt: baseline.observedAt }, baseline)) fail();
    // Keep the caller's original observedAt/digest for its signed inspection.
    return true;
  } catch { fail(); }
}
