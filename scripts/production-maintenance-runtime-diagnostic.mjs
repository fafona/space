import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { emptyPythonLayout, emptyNativeFileLinkEvidence, validatePythonLayout, validateNativeFileLinkEvidence,
  observePythonLayout, observeNativeFileLink } from "./production-maintenance-runtime-layout.mjs";

// Read-only observations, NOT a runtime proof or permission to use PM2. In
// particular, matching homes does not verify a socket, RPC client or namespace.
const ERROR = "production_maintenance_runtime_diagnostic_invalid";
const CODES = ["runtime_supervision_direct_next_owned", "runtime_supervision_legacy_npm_wrapper_owned",
  "runtime_supervision_runtime_listener_reparented_to_init", "runtime_supervision_listener_absent",
  "runtime_supervision_identity_mismatch", "runtime_supervision_state_unreadable"];
const META_KEYS = ["cwdLiteralMatch", "cwdCanonicalMatch", "entryLiteralMatch", "entryCanonicalMatch",
  "interpreterLiteralMatch", "interpreterCanonicalMatch", "argsMatch", "nodeArgsEmpty"];
const ENV_KEYS = ["args", "exec_interpreter", "exec_mode", "name", "node_args", "pm_cwd", "pm_exec_path", "pm_id", "PM2_HOME"];
const OVERRIDE_KEYS = ["PM2_DAEMON_RPC_PORT", "PM2_DAEMON_PUB_PORT", "PM2_PID_FILE_PATH"];
const VERSION = /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/;
const ENDPOINT_STATES = ["verified", "missing", "unsafe", "unverified"];
export const PYTHON_REJECTION_REASONS = Object.freeze(["directory_path", "directory_missing", "directory_type", "directory_owner",
  "directory_writable", "directory_canonical", "directory_unreadable", "entry_missing", "entry_type", "entry_owner", "entry_unreadable",
  "target_path", "target_missing", "target_type", "target_owner", "target_links", "target_writable", "target_size", "target_not_executable",
  "target_unreadable", "probe_failed", "probe_output"]);
export const NATIVE_UNKNOWN_REASONS = Object.freeze(["process_unreadable", "directory_path", "directory_missing", "directory_type",
  "directory_owner", "directory_writable", "directory_canonical", "directory_unreadable", "file_missing", "file_type", "file_owner",
  "file_links", "file_writable", "file_size", "file_not_executable", "file_canonical", "file_unreadable", "package_missing", "package_type",
  "package_owner", "package_links", "package_writable", "package_size", "package_unreadable", "package_metadata"]);
export const createNativeUnknownReasonCounts = () => Object.fromEntries(NATIVE_UNKNOWN_REASONS.map((key) => [key, 0]));
const DRIFT = Symbol("identity_drift");
const PYTHON_PATH = "/usr/bin/python3";
const PYTHON_SOURCE = 'import json,sys,socket; print(json.dumps({"version":"%d.%d.%d" % sys.version_info[:3],"afUnixApiAvailable":hasattr(socket,"AF_UNIX"),"soPeercredApiAvailable":hasattr(socket,"SO_PEERCRED")}))';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => { throw new Error(ERROR); };
const drift = () => { const error = new Error(ERROR); error[DRIFT] = true; throw error; };
const rethrowDrift = (error) => { if (error?.[DRIFT]) throw error; };
const bool = (value) => value === null || typeof value === "boolean";
const count = (value) => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 16384);
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"));
}
const absolute = (value) => typeof value === "string" && value.length <= 4096 &&
  value.startsWith("/") && !/[\0\r\n]/.test(value) && posix.normalize(value) === value;
function empty() {
  return { version: 4, maintenance: "not_verified", stability: "unverified", disk: "unverified", supervision: null,
    daemonCwdIsRoot: null, webMetadata: Object.fromEntries(META_KEYS.map((key) => [key, null])),
    supabaseEnvironment: "unverified", worker: { state: "unverified", nodeDescendantCount: null, nonNodeDescendantCount: null },
    runtimeExtraProcessCount: null, pm2Home: "unverified", pm2PathOverridesPresent: null, pm2Connection: "not_checked",
    pm2Version: null, pm2Endpoint: { home: "unverified", rpcSocket: "unverified", pidFile: "unverified", pidMatches: null },
    workerNative: { esbuildCount: null, otherCount: null, unknownCount: null, controlledIdentityVerified: null, unknownReasons: null },
    python: { version: null, executableVerified: null, afUnixApiAvailable: null, soPeercredApiAvailable: null, rejectionReason: null },
    layoutEvidence: { python: emptyPythonLayout(), nativeFileLinks: null } };
}
export function validateRuntimeCompatibilityDiagnostic(value) {
  if (!exact(value, Object.keys(empty())) || value.version !== 4 || value.maintenance !== "not_verified" ||
      !["stable", "unverified"].includes(value.stability) || !["verified", "unverified"].includes(value.disk) ||
      (value.supervision !== null && !CODES.includes(value.supervision)) || !bool(value.daemonCwdIsRoot) ||
      !exact(value.webMetadata, META_KEYS) || !META_KEYS.every((key) => bool(value.webMetadata[key])) ||
      !["matches", "absent", "differs", "unverified"].includes(value.supabaseEnvironment) ||
      !exact(value.worker, ["state", "nodeDescendantCount", "nonNodeDescendantCount"]) ||
      !["not_observed", "owned", "unverified"].includes(value.worker.state) ||
      !count(value.worker.nodeDescendantCount) || !count(value.worker.nonNodeDescendantCount) ||
      !count(value.runtimeExtraProcessCount) || !["matches", "differs", "absent", "unverified"].includes(value.pm2Home) ||
      !bool(value.pm2PathOverridesPresent) || value.pm2Connection !== "not_checked" ||
      !(value.pm2Version === null || (typeof value.pm2Version === "string" && VERSION.test(value.pm2Version))) ||
      !exact(value.pm2Endpoint, ["home", "rpcSocket", "pidFile", "pidMatches"]) ||
      !["home", "rpcSocket", "pidFile"].every((key) => ENDPOINT_STATES.includes(value.pm2Endpoint[key])) || !bool(value.pm2Endpoint.pidMatches) ||
      !exact(value.workerNative, ["esbuildCount", "otherCount", "unknownCount", "controlledIdentityVerified", "unknownReasons"]) ||
      !["esbuildCount", "otherCount", "unknownCount"].every((key) => count(value.workerNative[key])) || !bool(value.workerNative.controlledIdentityVerified) ||
      !(value.workerNative.unknownReasons === null || (exact(value.workerNative.unknownReasons, NATIVE_UNKNOWN_REASONS) &&
        NATIVE_UNKNOWN_REASONS.every((key) => value.workerNative.unknownReasons[key] !== null && count(value.workerNative.unknownReasons[key])))) ||
      !exact(value.python, ["version", "executableVerified", "afUnixApiAvailable", "soPeercredApiAvailable", "rejectionReason"]) ||
      !(value.python.rejectionReason === null || PYTHON_REJECTION_REASONS.includes(value.python.rejectionReason)) ||
      !(value.python.version === null || (typeof value.python.version === "string" && value.python.version.startsWith("3.") && VERSION.test(value.python.version))) ||
      !["executableVerified", "afUnixApiAvailable", "soPeercredApiAvailable"].every((key) => bool(value.python[key])) ||
      !exact(value.layoutEvidence, ["python", "nativeFileLinks"])) fail();
  validatePythonLayout(value.layoutEvidence.python);
  if (value.worker.state === "unverified") {
    if (value.layoutEvidence.nativeFileLinks !== null) fail();
  } else {
    validateNativeFileLinkEvidence(value.layoutEvidence.nativeFileLinks, value.workerNative.unknownReasons?.file_links);
  }
  if (value.python.rejectionReason !== "target_path" && !equal(value.layoutEvidence.python, emptyPythonLayout())) fail();
  if (value.worker.state === "unverified" ? value.worker.nodeDescendantCount !== null || value.worker.nonNodeDescendantCount !== null
    : value.worker.nodeDescendantCount === null || value.worker.nonNodeDescendantCount === null ||
      (value.worker.state === "not_observed" && (value.worker.nodeDescendantCount !== 0 || value.worker.nonNodeDescendantCount !== 0))) fail();
  const native = value.workerNative;
  if (value.worker.state === "unverified" ? !equal(native, empty().workerNative) :
    [native.esbuildCount, native.otherCount, native.unknownCount].some((n) => n === null) || native.unknownReasons === null ||
      Object.values(native.unknownReasons).reduce((sum, n) => sum + n, 0) !== native.unknownCount ||
      native.esbuildCount + native.otherCount + native.unknownCount !== value.worker.nonNodeDescendantCount ||
      (value.worker.nonNodeDescendantCount === 0 ? native.controlledIdentityVerified !== null :
        native.unknownCount > 0 ? native.controlledIdentityVerified !== null : native.controlledIdentityVerified === null)) fail();
  if ((value.pm2Endpoint.home !== "verified" && (value.pm2Endpoint.rpcSocket !== "unverified" || value.pm2Endpoint.pidFile !== "unverified")) ||
      (value.pm2Endpoint.pidFile !== "verified" && value.pm2Endpoint.pidMatches !== null) ||
      (value.pm2Version === null && !equal(value.pm2Endpoint, empty().pm2Endpoint)) ||
      (value.python.executableVerified !== true && (value.python.version !== null || value.python.afUnixApiAvailable !== null || value.python.soPeercredApiAvailable !== null)) ||
      (value.python.version !== null && (typeof value.python.afUnixApiAvailable !== "boolean" || typeof value.python.soPeercredApiAvailable !== "boolean")) ||
      (value.python.version === null && (value.python.afUnixApiAvailable !== null || value.python.soPeercredApiAvailable !== null))) fail();
  const python = value.python;
  if (python.rejectionReason !== null) {
    const executable = python.rejectionReason.startsWith("probe_") ? true :
      python.rejectionReason.startsWith("target_") && python.rejectionReason !== "target_unreadable" ? false : null;
    if (python.version !== null || python.executableVerified !== executable) fail();
  } else if (python.version === null && !equal(python, empty().python)) fail();
  if (value.stability === "unverified" && !equal(value, empty())) fail();
  if (value.stability === "stable" && value.disk !== "verified") fail();
  return structuredClone(value);
}
function captureInput(value) {
  if (!exact(value, ["appDir", "appName", "appPort", "expectedOldSha"]) || !absolute(value.appDir) || value.appDir === "/" ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(value.appName) || !Number.isInteger(value.appPort) || value.appPort < 1 || value.appPort > 65535 ||
      !/^[a-f0-9]{40}$/.test(value.expectedOldSha)) fail();
  return { ...value };
}
function boundedFile(path, limit) {
  const fd = openSync(path, "r");
  try {
    const result = Buffer.alloc(limit + 1); let size = 0;
    while (size < result.length) { const read = readSync(fd, result, size, result.length - size, null); if (!read) break; size += read; }
    if (size > limit) fail();
    return result.subarray(0, size);
  } finally { closeSync(fd); }
}
const statIdentity = (stat) => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"].map((key) => String(stat[key])).join(":");
function pathInfo(path) {
  try {
    const stat = lstatSync(path, { bigint: true });
    return { identity: statIdentity(stat), uid: Number(stat.uid), mode: Number(stat.mode), size: Number(stat.size), nlink: Number(stat.nlink),
      type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isSocket() ? "socket" : stat.isFile() ? "file" : "other" };
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function regular(info, owner, limit) {
  return info?.type === "file" && info.nlink === 1 && [0, owner].includes(info.uid) && (info.mode & 0o022) === 0 &&
    Number.isSafeInteger(info.size) && info.size > 0 && info.size <= limit;
}
function regularRejection(info, owner, limit, prefix) {
  if (!info) return prefix + "_missing";
  if (info.type !== "file") return prefix + "_type";
  if (info.nlink !== 1) return prefix + "_links";
  if (![0, owner].includes(info.uid)) return prefix + "_owner";
  if ((info.mode & 0o022) !== 0) return prefix + "_writable";
  if (!Number.isSafeInteger(info.size) || info.size <= 0 || info.size > limit) return prefix + "_size";
  return null;
}
function readRegular(path, limit, expected) {
  // Used only after type/owner/size checks; no-follow and nonblocking also
  // prevent a concurrent FIFO/symlink substitution from hanging this probe.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (statIdentity(fstatSync(fd, { bigint: true })) !== expected.identity) drift();
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, null); if (!n) break; size += n; }
    if (size > limit || size !== expected.size || statIdentity(fstatSync(fd, { bigint: true })) !== expected.identity ||
        pathInfo(path)?.identity !== expected.identity) drift();
    const result = bytes.subarray(0, size);
    return { bytes: result, digest: createHash("sha256").update(result).digest("hex") };
  } finally { closeSync(fd); }
}
function directoryChain(path, owner, d) {
  if (!absolute(path) || path.split("/").length > 64) return { state: "unsafe", entries: [] };
  const entries = []; const paths = ["/"]; let current = "";
  for (const segment of path.split("/").filter(Boolean)) { current += "/" + segment; paths.push(current); }
  for (const item of paths) {
    const info = d.pathInfo(item); entries.push({ path: item, info });
    if (!info) return { state: "missing", entries };
    if (info.type !== "directory" || ![0, owner].includes(info.uid) || (info.mode & 0o022) !== 0 || d.canonical(item) !== item) return { state: "unsafe", entries };
  }
  return { state: "verified", entries };
}
function diagnosticDirectoryChain(path, owner, d) {
  const entries = [];
  if (!absolute(path) || path.split("/").length > 64) return { entries, reason: "directory_path" };
  const paths = ["/"]; let current = "";
  for (const segment of path.split("/").filter(Boolean)) { current += "/" + segment; paths.push(current); }
  try {
    for (const item of paths) {
      const info = d.pathInfo(item); entries.push({ path: item, info });
      if (!info) return { entries, reason: "directory_missing" };
      if (info.type !== "directory") return { entries, reason: "directory_type" };
      if (![0, owner].includes(info.uid)) return { entries, reason: "directory_owner" };
      if ((info.mode & 0o022) !== 0) return { entries, reason: "directory_writable" };
      if (d.canonical(item) !== item) return { entries, reason: "directory_canonical" };
    }
  } catch (error) { rethrowDrift(error); return { entries, reason: "directory_unreadable" }; }
  return { entries, reason: null };
}
function revalidatePaths(entries, d) {
  for (const { path, info } of entries) if (!equal(d.pathInfo(path), info)) drift();
}
function endpointObservation(home, daemon, d) {
  const result = { home: "unverified", rpcSocket: "unverified", pidFile: "unverified", pidMatches: null };
  const witness = []; const chain = directoryChain(home, daemon.uid, d); witness.push(...chain.entries); result.home = chain.state;
  if (chain.state !== "verified") { revalidatePaths(witness, d); return { result, witness }; }
  for (const [key, suffix, type] of [["rpcSocket", "rpc.sock", "socket"], ["pidFile", "pm2.pid", "file"]]) {
    const path = home + "/" + suffix; const info = d.pathInfo(path); witness.push({ path, info });
    // Socket permissions alone do not prove peer identity or exposure. This is
    // metadata only, under the verified directory chain; NO socket is opened.
    result[key] = !info ? "missing" : info.type !== type || info.uid !== daemon.uid || info.nlink !== 1 ||
      (type === "file" && !regular(info, daemon.uid, 32)) ? "unsafe" : "verified";
    if (key === "pidFile" && result[key] === "verified") {
      try {
        const read = d.readRegular(path, 32, info); const text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
        if (/^[1-9]\d{0,9}\n?$/.test(text) && Number(text.trim()) <= 2_147_483_647) result.pidMatches = Number(text.trim()) === daemon.pid;
      } catch (error) { rethrowDrift(error); result.pidFile = "unverified"; }
    }
  }
  revalidatePaths(witness, d); return { result, witness };
}
function nativeObservation(facts, runtime, node, owner, d) {
  const native = facts.slice(1).filter((fact) => fact.executable !== node);
  const result = { esbuildCount: 0, otherCount: 0, unknownCount: 0, controlledIdentityVerified: null,
    unknownReasons: createNativeUnknownReasonCounts() }; const witness = []; const layout = emptyNativeFileLinkEvidence();
  const architecture = d.arch();
  const suffix = ["x64", "arm64"].includes(architecture) ? `@esbuild/linux-${architecture}` : null;
  const packages = suffix ? [runtime + "/node_modules/" + suffix, runtime + "/node_modules/tsx/node_modules/" + suffix] : [];
  let controlled = true;
  for (const fact of native) {
    let reason = "process_unreadable"; const entries = []; witness.push(entries);
    try {
      if (!equal(d.readProcess(fact.pid), fact)) drift();
      reason = "directory_path";
      const chain = diagnosticDirectoryChain(posix.dirname(fact.executable), owner, d); entries.push(...chain.entries);
      if (chain.reason) { reason = chain.reason; fail(); }
      reason = "file_unreadable";
      const binary = d.pathInfo(fact.executable); entries.push({ path: fact.executable, info: binary });
      if (binary && binary.identity !== fact.executableIdentity) drift();
      const rejected = regularRejection(binary, owner, 64 * 1024 * 1024, "file");
      if (rejected) {
        reason = rejected;
        if (rejected === "file_links") {
          const evidence = observeNativeFileLink({ fact, runtime, owner, architecture, binary }, { ...d, drift, rethrowDrift });
          layout.linkCounts[evidence.linkCount]++; layout.outcomes[evidence.outcome]++;
          entries.push(...evidence.witness);
        }
        fail();
      }
      if ((binary.mode & 0o111) === 0) { reason = "file_not_executable"; fail(); }
      if (d.canonical(fact.executable) !== fact.executable) { reason = "file_canonical"; fail(); }
      const packageRoot = packages.find((base) => fact.executable === base + "/bin/esbuild"); let recognized = false;
      if (packageRoot) {
        reason = "package_unreadable";
        const path = packageRoot + "/package.json"; const info = d.pathInfo(path); entries.push({ path, info });
        const rejected = regularRejection(info, owner, 8192, "package");
        if (rejected) { reason = rejected; fail(); }
        const read = d.readRegular(path, 8192, info); reason = "package_metadata";
        const pkg = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes));
        if (pkg?.name !== suffix || typeof pkg?.version !== "string" || !VERSION.test(pkg.version)) fail();
        recognized = equal(fact.commandLine, [fact.executable, `--service=${pkg.version}`, "--ping"]);
      }
      reason = "file_unreadable"; revalidatePaths(entries, d);
      reason = "process_unreadable"; if (!equal(d.readProcess(fact.pid), fact)) drift();
      if (recognized) result.esbuildCount++; else result.otherCount++;
    } catch (error) { rethrowDrift(error); result.unknownCount++; result.unknownReasons[reason]++; controlled = false; }
  }
  if (native.length && result.unknownCount === 0) result.controlledIdentityVerified = controlled;
  return { result, witness, layout };
}
function runPython(executable) {
  return spawnSync(executable, ["-I", "-S", "-B", "-c", PYTHON_SOURCE], { encoding: "utf8", timeout: 3000, maxBuffer: 4096, killSignal: "SIGKILL",
    cwd: "/", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
}
function pythonObservation(d) {
  const result = { version: null, executableVerified: null, afUnixApiAvailable: null, soPeercredApiAvailable: null, rejectionReason: null };
  const witness = []; let layout = emptyPythonLayout();
  let reason = "directory_unreadable";
  try {
    const chain = diagnosticDirectoryChain("/usr/bin", 0, d); witness.push(...chain.entries);
    if (chain.reason) { result.rejectionReason = chain.reason; return { result, witness }; }
    reason = "entry_unreadable";
    const original = d.pathInfo(PYTHON_PATH); witness.push({ path: PYTHON_PATH, info: original });
    if (!original || original.uid !== 0 || !["symlink", "file"].includes(original.type)) {
      result.rejectionReason = !original ? "entry_missing" : original.uid !== 0 ? "entry_owner" : "entry_type";
      return { result, witness };
    }
    reason = "target_unreadable";
    const executable = d.canonical(PYTHON_PATH);
    if (!/^\/usr\/bin\/python3(?:\.(?:0|[1-9]\d{0,3}))?$/.test(executable)) {
      result.executableVerified = false; result.rejectionReason = "target_path";
      const evidence = observePythonLayout(executable, { ...d, drift, rethrowDrift });
      layout = evidence.result; witness.push(...evidence.witness);
      return { result, witness, layout, layoutTarget: executable };
    }
    const target = d.pathInfo(executable); witness.push({ path: executable, info: target });
    const rejected = regularRejection(target, 0, 64 * 1024 * 1024, "target") || ((target.mode & 0o111) === 0 ? "target_not_executable" : null);
    if (rejected) { result.executableVerified = false; result.rejectionReason = rejected; return { result, witness }; }
    result.executableVerified = true;
    reason = "probe_failed";
    const output = d.runPython(executable);
    revalidatePaths(witness, d); if (d.canonical(PYTHON_PATH) !== executable) drift();
    if (output.error || output.signal || output.status !== 0) { result.rejectionReason = reason; return { result, witness }; }
    reason = "probe_output";
    if (typeof output.stdout !== "string" || output.stdout.length > 4096) { result.rejectionReason = reason; return { result, witness }; }
    const data = JSON.parse(output.stdout);
    if (!exact(data, ["version", "afUnixApiAvailable", "soPeercredApiAvailable"]) || typeof data.version !== "string" ||
        !data.version.startsWith("3.") || !VERSION.test(data.version) || typeof data.afUnixApiAvailable !== "boolean" || typeof data.soPeercredApiAvailable !== "boolean") {
      result.rejectionReason = reason; return { result, witness };
    }
    Object.assign(result, data);
  } catch (error) { rethrowDrift(error); result.rejectionReason = reason; }
  return { result, witness, layout };
}
function selectedEnvironment(pid) {
  const bytes = boundedFile(`/proc/${pid}/environ`, 1_048_576);
  if (bytes.at(-1) !== 0) fail();
  const selected = Object.fromEntries(ENV_KEYS.map((key) => [key, null]));
  const seen = new Set(); let start = 0;
  for (let end = 0; end < bytes.length; end++) {
    if (bytes[end] !== 0) continue;
    const record = bytes.subarray(start, end); start = end + 1;
    const separator = record.indexOf(61); if (separator <= 0) fail();
    const key = record.subarray(0, separator).toString("ascii");
    if (!ENV_KEYS.includes(key)) continue;
    if (seen.has(key)) fail(); seen.add(key);
    const value = new TextDecoder("utf-8", { fatal: true }).decode(record.subarray(separator + 1));
    if (value.length > 4096 || /[\r\n\0]/.test(value)) fail();
    selected[key] = value;
  }
  return selected;
}
function scanProcesses(runtime) {
  const names = readdirSync("/proc").filter((name) => /^[1-9]\d*$/.test(name)).sort((a, b) => Number(a) - Number(b));
  if (names.length > 16384) fail();
  const index = []; const runtimePids = [];
  for (const name of names) {
    try {
      const stat = boundedFile(`/proc/${name}/stat`, 16384).toString("utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
      if (!/^\d+$/.test(fields[1] ?? "")) fail();
      index.push({ pid: Number(name), parentPid: Number(fields[1]) });
      try { if (realpathSync(`/proc/${name}/cwd`) === runtime) runtimePids.push(Number(name)); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return { index, runtimePids };
}
async function dependencies(overrides) {
  // Existing standalone diagnostic APIs have stdin CLI entry guards. Do not
  // import them from a stdin host; this module itself has NO import-time I/O.
  if (!process.argv[1] || process.argv[1] === "-") fail();
  const runtime = await import("./check-production-runtime-supervision.mjs");
  const environment = await import("./read-production-supabase-environment.mjs");
  return { disk: runtime.captureRuntimeProof, supervision: runtime.captureSupervisionSnapshot,
    classify: runtime.classifyRuntimeSupervision, readProcess: runtime.captureProcessFact,
    readSelected: selectedEnvironment, scan: scanProcesses, canonical: realpathSync,
    pathInfo, readRegular, runPython, arch: () => process.arch,
    nodePath: () => realpathSync(process.execPath),
    readRollback: environment.readFrozenProductionSupabaseRollbackEnvironmentSnapshot,
    readProcessEnvironment: environment.captureStableProductionProcessSupabaseEnvironment,
    cliEnvironment: () => ({ home: process.env.PM2_HOME || (process.env.HOME ? posix.join(process.env.HOME, ".pm2") : null),
      overridesPresent: OVERRIDE_KEYS.some((key) => Object.hasOwn(process.env, key)) }),
    boot: () => boundedFile("/proc/sys/kernel/random/boot_id", 64).toString("utf8").trim(),
    ...overrides };
}
function canonical(value, d) {
  if (!absolute(value)) return null;
  try { const result = d.canonical(value); return absolute(result) ? result : null; } catch { return null; }
}
function metadata(values, disk, node, port, d) {
  const pair = (value, target) => ({ literal: typeof value === "string" ? value === target : null,
    canonical: canonical(value, d) === null ? null : canonical(value, d) === target });
  const cwd = pair(values.pm_cwd, disk.runtime); const entry = pair(values.pm_exec_path, disk.nextEntryPath);
  const interpreter = values.exec_interpreter === "node" ? { literal: true, canonical: true } : pair(values.exec_interpreter, node);
  return { cwdLiteralMatch: cwd.literal, cwdCanonicalMatch: cwd.canonical, entryLiteralMatch: entry.literal,
    entryCanonicalMatch: entry.canonical, interpreterLiteralMatch: interpreter.literal, interpreterCanonicalMatch: interpreter.canonical,
    argsMatch: typeof values.args === "string" ? values.args === `start,-p,${port}` : null,
    nodeArgsEmpty: values.node_args === null || values.node_args === "" };
}
function readStableSelected(fact, d) {
  if (!equal(d.readProcess(fact.pid), fact)) drift();
  const result = d.readSelected(fact.pid);
  if (!equal(d.readProcess(fact.pid), fact)) drift();
  return result;
}
function descendants(index, root) {
  const selected = [root];
  for (let i = 0; i < selected.length; i++) {
    selected.push(...index.filter((row) => row.parentPid === selected[i]).map((row) => row.pid));
    if (selected.length > 64 || new Set(selected).size !== selected.length) fail();
  }
  return selected;
}
function workerObservation(input, disk, web, daemon, node, d) {
  const scan = d.scan(disk.runtime); const candidates = []; const observed = [];
  const children = scan.index.filter((row) => row.parentPid === daemon.pid && row.pid !== web.pid && scan.runtimePids.includes(row.pid));
  if (children.length > 64) fail();
  for (const child of children) {
    const fact = d.readProcess(child.pid);
    if (fact.parentPid !== daemon.pid) drift();
    // Do not inspect another PM2 application's environment. The frozen
    // runtime directory and daemon ancestry bound this application's scope.
    if (fact.cwd !== disk.runtime || fact.uid !== daemon.uid) continue;
    const values = readStableSelected(fact, d);
    observed.push({ fact, metadataHash: hash(values) });
    if (values.name === input.appName + "-enterprise-automation-worker") candidates.push({ fact, values });
  }
  if (candidates.length > 1) fail();
  let worker = { state: "not_observed", nodeDescendantCount: 0, nonNodeDescendantCount: 0 }; const workerFacts = [];
  if (candidates.length) {
    const { fact, values } = candidates[0];
    if (fact.uid !== daemon.uid || fact.cwd !== disk.runtime || fact.executable !== node ||
        values.exec_mode !== "fork_mode" || !/^\d+$/.test(values.pm_id ?? "") ||
        canonical(values.pm_cwd, d) !== disk.runtime ||
        canonical(values.pm_exec_path, d) !== disk.runtime + "/node_modules/tsx/dist/cli.mjs" ||
        values.args !== disk.runtime + "/scripts/run-merchant-enterprise-automation-worker.ts" ||
        ![null, ""].includes(values.node_args) ||
        (values.exec_interpreter !== "node" && canonical(values.exec_interpreter, d) !== node)) fail();
    workerFacts.push(...descendants(scan.index, fact.pid).map((pid) => d.readProcess(pid)));
    if (workerFacts.some((entry) => entry.uid !== daemon.uid || entry.cwd !== disk.runtime)) fail();
    if (workerFacts.some((entry) => entry.parentPid !== scan.index.find((row) => row.pid === entry.pid)?.parentPid)) drift();
    worker = { state: "owned", nodeDescendantCount: workerFacts.slice(1).filter((entry) => entry.executable === node).length,
      nonNodeDescendantCount: workerFacts.slice(1).filter((entry) => entry.executable !== node).length };
  }
  if (scan.runtimePids.length > 128) fail();
  const runtimeFacts = scan.runtimePids.map((pid) => d.readProcess(pid));
  const allowed = new Set([web.pid, ...workerFacts.map((fact) => fact.pid)]);
  // A child with an unknown executable is observed, not authorized for stopping.
  const extra = scan.runtimePids.filter((pid) => !allowed.has(pid)).length;
  const native = nativeObservation(workerFacts, disk.runtime, node, daemon.uid, d);
  return { worker, extra, native: native.result, nativeLayout: native.layout,
    witness: { observed, workerFacts, runtimeFacts, native: native.witness } };
}
async function observe(input, d) {
  const report = empty(); const disk = d.disk(input.appDir, input.expectedOldSha);
  const snapshot = await d.supervision(input.appName, disk, input.appPort, input.expectedOldSha);
  const witness = { disk, snapshot }; report.disk = "verified";
  const python = pythonObservation(d); report.python = python.result; witness.python = python.witness;
  report.layoutEvidence.python = python.layout ?? emptyPythonLayout();
  witness.pythonLayoutTarget = python.layoutTarget ?? null;
  report.supervision = d.classify({ ...snapshot, runtime: disk.runtime, stable: true });
  if (!CODES.includes(report.supervision)) fail();
  const web = snapshot.listener?.chain?.find((entry) => entry.pid === snapshot.ownership?.pid);
  const daemon = snapshot.listener?.chain?.find((entry) => entry.pid === snapshot.ownership?.daemonPid);
  if (snapshot.ownership?.state !== "owned" || !web || !daemon) return { report, witness };
  const node = d.nodePath();
  if (!equal(d.readProcess(web.pid), web) || !equal(d.readProcess(daemon.pid), daemon)) fail();
  report.daemonCwdIsRoot = daemon.cwd === "/";
  const daemonTitle = daemon.commandLine?.length === 1 ? daemon.commandLine[0].match(/^PM2 v([^\s:]{1,64}): God Daemon \(([^\0\r\n]{1,4096})\)$/) : null;
  report.pm2Version = daemonTitle && VERSION.test(daemonTitle[1]) ? daemonTitle[1] : null;
  try { const values = readStableSelected(web, d); report.webMetadata = metadata(values, disk, node, input.appPort, d); witness.webMetadataHash = hash(values); } catch (error) { rethrowDrift(error); /* Unknown, not false. */ }
  try {
    const file = d.readRollback(disk.runtime + "/.env.local", input.expectedOldSha);
    const live = d.readProcessEnvironment(String(web.pid), disk.runtime);
    if (live.startTicks !== web.startTicks || file.fileIdentity !== disk.environmentIdentity || file.sha256 !== disk.environmentDigest) drift();
    const matches = ["internalUrl", "publicUrl", "anonKey"].every((key) => live[key] === file[key]) &&
      (live.rolloutStatus === "present" ? ["staffBusinessRbacMode", "staffBusinessRbacSiteIds", "canonicalPortalOrigin"].every((key) => live[key] === file[key])
        : live.rolloutStatus === "absent" && file.rolloutStatus === "legacy-off");
    report.supabaseEnvironment = live.status === "absent" ? "absent" : live.status === "present" ? matches ? "matches" : "differs" : "unverified";
    witness.environmentHash = hash({ file, live });
  } catch (error) { rethrowDrift(error); /* A failed read is not an absent configuration. */ }
  try { const result = workerObservation(input, disk, web, daemon, node, d);
    report.worker = result.worker; report.workerNative = result.native; report.runtimeExtraProcessCount = result.extra; witness.worker = result.witness;
    report.layoutEvidence.nativeFileLinks = result.nativeLayout;
  } catch (error) { rethrowDrift(error); /* No PM2 registry read or fallback to another owner. */ }
  try {
    const cli = d.cliEnvironment(); if (typeof cli.overridesPresent !== "boolean") fail();
    report.pm2PathOverridesPresent = cli.overridesPresent;
    const values = readStableSelected(daemon, d);
    const title = report.pm2Version !== null ? daemonTitle[2] : null;
    const home = values.PM2_HOME || title;
    if (values.PM2_HOME && title && canonical(values.PM2_HOME, d) !== canonical(title, d)) fail();
    const actual = canonical(home, d); const intended = canonical(cli.home, d);
    report.pm2Home = !cli.home || !home ? "absent" : actual === null || intended === null ? "unverified" : actual === intended ? "matches" : "differs";
    witness.home = { metadataHash: hash(values), cliHash: hash(cli) };
    if (title && absolute(home)) {
      const endpoint = endpointObservation(home, daemon, d); report.pm2Endpoint = endpoint.result; witness.endpoint = endpoint.witness;
    }
  } catch (error) { rethrowDrift(error); report.pm2Home = "unverified"; }
  if (!equal(d.readProcess(web.pid), web) || !equal(d.readProcess(daemon.pid), daemon)) fail();
  return { report, witness };
}
export async function diagnoseRuntimeCompatibility(rawInput, overrides = {}) {
  const input = captureInput(rawInput);
  try {
    const d = await dependencies(overrides); const boot = d.boot();
    const first = await observe(input, d); const second = await observe(input, d);
    // Any observed identity/configuration change invalidates ALL sampled facts.
    if (!equal(first, second) || d.boot() !== boot) return empty();
    second.report.stability = "stable";
    return validateRuntimeCompatibilityDiagnostic(second.report);
  } catch { return empty(); }
}
