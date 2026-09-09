import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseRuntimeCompatibility, validateRuntimeCompatibilityDiagnostic } from "./production-maintenance-runtime-diagnostic.mjs";

const ERROR = "production_maintenance_pm2_peer_unverified";
const SEMVER = /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/;
const BOOT = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail = () => { throw new Error(ERROR); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = () => ({ version: 1, maintenance: "not_verified", peerVerified: null, pm2Version: null });
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) =>
    fields[key]?.enumerable && Object.hasOwn(fields[key], "value"));
}
export function validatePm2PeerDiagnostic(value) {
  if (!exact(value, Object.keys(empty())) || value.version !== 1 || value.maintenance !== "not_verified" ||
      (value.peerVerified === true ? typeof value.pm2Version !== "string" || !SEMVER.test(value.pm2Version)
        : value.peerVerified !== null || value.pm2Version !== null)) fail();
  return structuredClone(value);
}
function inputCopy(value) {
  if (!exact(value, ["appDir", "appName", "appPort", "expectedOldSha"]) ||
      typeof value.appDir !== "string" || !/^\/[A-Za-z0-9._/-]+$/.test(value.appDir) || value.appDir === "/" ||
      posix.normalize(value.appDir) !== value.appDir || value.appDir.endsWith("/") ||
      typeof value.appName !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(value.appName) ||
      !Number.isSafeInteger(value.appPort) || value.appPort < 1024 || value.appPort > 65535 ||
      typeof value.expectedOldSha !== "string" || !/^[a-f0-9]{40}$/.test(value.expectedOldSha)) fail();
  return { ...value };
}
const identity = (value) => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"]
  .map((key) => String(value[key])).join(":");
function pythonIdentity() {
  const directories = ["/", "/usr", "/usr/bin"].map((path) => {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0n || (stat.mode & 0o022n) !== 0n || realpathSync(path) !== path) fail();
    return identity(stat);
  });
  const link = lstatSync("/usr/bin/python3", { bigint: true });
  if (link.uid !== 0n || (!link.isSymbolicLink() && !link.isFile())) fail();
  const executable = realpathSync("/usr/bin/python3");
  if (!/^\/usr\/bin\/python3(?:\.\d{1,2})?$/.test(executable)) fail();
  const stat = lstatSync(executable, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0n || (stat.mode & 0o022n) !== 0n ||
      (stat.mode & 0o111n) === 0n || stat.nlink !== 1n || stat.size < 1n) fail();
  return { executable, link: identity(link), file: identity(stat), directories };
}

// Data travels only on private stdin. No arbitrary module, command, RPC method,
// environment, PM2 CLI, fallback interpreter or daemon initialization is allowed.
export const PM2_PEER_BRIDGE_SOURCE = `import importlib.util,json,sys
try:
    raw=sys.stdin.buffer.read(8193)
    if len(raw)>8192: raise ValueError()
    value=json.loads(raw)
    if type(value) is not dict or set(value)!={"socketPath","daemon"}: raise ValueError()
    spec=importlib.util.spec_from_file_location("faolla_pm2_connection",sys.argv[1])
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    result=module.inspect_pm2_connection(value["socketPath"],value["daemon"])
    sys.stdout.write(json.dumps(result,separators=(",",":"))+"\\n")
except BaseException:
    sys.stderr.write("production_maintenance_pm2_peer_unverified\\n")
    sys.exit(1)
`;
function invokePython(python, payload) {
  const helper = fileURLToPath(new URL("./production-maintenance-pm2-connection.py", import.meta.url));
  const result = spawnSync(python.executable, ["-I", "-S", "-B", "-c", PM2_PEER_BRIDGE_SOURCE, helper], {
    input: JSON.stringify(payload), encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 4096, shell: false, windowsHide: true,
    cwd: "/", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== "" ||
      typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 4096) fail();
  return JSON.parse(result.stdout);
}
async function dependencies(overrides) {
  // Keep import-time inspection inert, including when a caller imports stdin.
  if (!process.argv[1] || process.argv[1] === "-") fail();
  const runtime = await import("./check-production-runtime-supervision.mjs");
  return { metadata: diagnoseRuntimeCompatibility, disk: runtime.captureRuntimeProof,
    supervision: runtime.captureSupervisionSnapshot, classify: runtime.classifyRuntimeSupervision,
    process: runtime.captureProcessFact, canonical: realpathSync, python: pythonIdentity, invoke: invokePython,
    boot: () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), ...overrides };
}
async function observation(input, d) {
  const disk = d.disk(input.appDir, input.expectedOldSha);
  const snapshot = await d.supervision(input.appName, disk, input.appPort, input.expectedOldSha);
  if (d.classify({ ...snapshot, runtime: disk.runtime, stable: true }) !== "runtime_supervision_direct_next_owned") fail();
  const daemon = snapshot.listener?.chain?.find((entry) => entry.pid === snapshot.ownership?.daemonPid);
  const web = snapshot.listener?.chain?.find((entry) => entry.pid === snapshot.ownership?.pid);
  if (!daemon || !web || !equal(d.process(daemon.pid), daemon) || !equal(d.process(web.pid), web)) fail();
  const title = daemon.commandLine?.length === 1 ? daemon.commandLine[0]
    .match(/^PM2 v((?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})): God Daemon \(([^\0\r\n]{1,4096})\)$/) : null;
  const home = title?.[2];
  if (!home || !home.startsWith("/") || home === "/" || posix.normalize(home) !== home ||
      home.endsWith("/") || d.canonical(home) !== home) fail();
  return { disk, snapshot, daemon, web, home, pm2Version: title[1] };
}
export async function diagnosePm2Peer(rawInput, overrides = {}) {
  const input = inputCopy(rawInput);
  try {
    const d = await dependencies(overrides);
    const boot = d.boot(); if (!BOOT.test(boot)) fail();
    const metadata = validateRuntimeCompatibilityDiagnostic(await d.metadata(input));
    if (metadata.version !== 3 || metadata.stability !== "stable" || metadata.disk !== "verified" ||
        metadata.supervision !== "runtime_supervision_direct_next_owned" || metadata.pm2Connection !== "not_checked" ||
        !SEMVER.test(metadata.pm2Version ?? "") || metadata.pm2PathOverridesPresent !== false ||
        metadata.pm2Endpoint?.home !== "verified" || metadata.pm2Endpoint?.rpcSocket !== "verified" ||
        metadata.pm2Endpoint?.pidFile !== "verified" || metadata.pm2Endpoint?.pidMatches !== true ||
        metadata.python?.executableVerified !== true || metadata.python?.afUnixApiAvailable !== true ||
        metadata.python?.soPeercredApiAvailable !== true || metadata.python?.rejectionReason !== null) fail();
    const before = await observation(input, d); const python = d.python();
    if (before.pm2Version !== metadata.pm2Version || d.boot() !== boot) fail();
    const daemon = Object.fromEntries(["pid", "uid", "startTicks", "executable", "executableIdentity"]
      .map((key) => [key, before.daemon[key]]));
    const answer = d.invoke(python, { socketPath: before.home + "/rpc.sock", daemon: { ...daemon, bootId: boot } });
    if (!exact(answer, ["version", "pm2Version", "peerVerified"]) || answer.version !== 1 ||
        answer.peerVerified !== true || answer.pm2Version !== before.pm2Version ||
        !equal(d.python(), python) || d.boot() !== boot || !equal(await observation(input, d), before)) fail();
    return validatePm2PeerDiagnostic({ version: 1, maintenance: "not_verified", peerVerified: true, pm2Version: answer.pm2Version });
  } catch { return empty(); }
}
