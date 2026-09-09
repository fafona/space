import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";
import { captureTrustedPython, verifyTrustedPython } from "./production-maintenance-trusted-python.mjs";

// Connect-only transport, not maintenance authority. The caller owns the lock,
// durable launch journal, frozen release, ingress fence and terminal checks.
const ERROR = "production_maintenance_pm2_unverified";
const UNKNOWN = "production_maintenance_pm2_outcome_unknown";
const PROCESS_KEYS = ["pid", "parentPid", "startTicks", "processIdentity", "uid", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLineDigest"];
const PEER_KEYS = ["pid", "uid", "startTicks", "bootId", "executable", "executableIdentity"];
const META_KEYS = ["name", "pm_id", "status", "created_at", "pm_uptime", "restart_time", "pm_cwd", "pm_exec_path", "args", "node_args", "exec_mode", "exec_interpreter", "watch", "cron_restart", "autorestart", "FAOLLA_BACKGROUND_JOBS_PAUSED", "nonce", "envDigest"];
const BOOT = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const IDENTITY = /^\d{1,25}(?::\d{1,25}){7}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pick = (a, keys) => Object.fromEntries(keys.map((key) => [key, a[key]]));
const fail = () => { throw new Error(ERROR); };
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const text = (value, maximum = 4096) => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value);
const absolute = (value) => text(value) && value.startsWith("/") && value !== "/" && !value.endsWith("/") && posix.normalize(value) === value;
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function plain(value, depth = 0) {
  if (depth > 20) fail();
  if (value === null || typeof value === "boolean" || typeof value === "string" || Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || types.isProxy(value)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 128 || Reflect.ownKeys(descriptors).length !== value.length + 1) fail();
    return Array.from({ length: value.length }, (_, i) => {
      if (!descriptors[i]?.enumerable || !Object.hasOwn(descriptors[i], "value")) fail();
      return plain(descriptors[i].value, depth + 1);
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(descriptors).length > 64) fail();
  return Object.fromEntries(Reflect.ownKeys(descriptors).map((key) => {
    if (typeof key !== "string" || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value")) fail();
    return [key, plain(descriptors[key].value, depth + 1)];
  }));
}
function daemonCopy(value, bootId) {
  const daemon = plain(value);
  if (!exact(daemon, PROCESS_KEYS) || !BOOT.test(bootId) || !integer(daemon.pid, 1, 2147483647) ||
      !integer(daemon.parentPid, 0, 2147483647) || !integer(daemon.uid, 0, 4294967295) ||
      typeof daemon.startTicks !== "string" || !/^[1-9]\d{0,24}$/.test(daemon.startTicks) ||
      !["processIdentity", "cwdIdentity", "executableIdentity"].every((key) => typeof daemon[key] === "string" && IDENTITY.test(daemon[key])) ||
      !(daemon.cwd === "/" || absolute(daemon.cwd)) || !absolute(daemon.executable) || !DIGEST.test(daemon.commandLineDigest)) fail();
  return pick(daemon, PROCESS_KEYS);
}
export function validatePm2Registry(value) {
  const registry = plain(value);
  if (!Array.isArray(registry) || registry.length > 128) fail();
  for (const row of registry) {
    if (!exact(row, ["name", "pid", "pm_id", "pm2_env"]) || !text(row.name, 150) || !/^[A-Za-z0-9._-]+$/.test(row.name) ||
        !integer(row.pid, 0, 2147483647) || !integer(row.pm_id, 0, 2147483647) || !exact(row.pm2_env, META_KEYS)) fail();
    const e = row.pm2_env;
    if (e.name !== row.name || e.pm_id !== row.pm_id || !["online", "stopped", "stopping", "launching", "errored", "one-launch-status", "waiting restart"].includes(e.status) ||
        !integer(e.created_at, 1) || !integer(e.pm_uptime, 1) || !integer(e.restart_time, 0, 2147483647) ||
        !absolute(e.pm_cwd) || !absolute(e.pm_exec_path) || !text(e.exec_mode, 40) || !text(e.exec_interpreter) ||
        ![e.args, e.node_args].every((args) => Array.isArray(args) && args.length <= 16 && args.every((arg) => text(arg))) ||
        e.watch !== false || e.cron_restart !== null || typeof e.autorestart !== "boolean" ||
        ![null, "0", "1"].includes(e.FAOLLA_BACKGROUND_JOBS_PAUSED) ||
        !(e.nonce === null || typeof e.nonce === "string" && UUID.test(e.nonce)) ||
        !(e.envDigest === null || typeof e.envDigest === "string" && DIGEST.test(e.envDigest))) fail();
  }
  if (new Set(registry.map((row) => row.pm_id)).size !== registry.length || new Set(registry.map((row) => row.name)).size !== registry.length ||
      Buffer.byteLength(JSON.stringify(registry)) > 524288) fail();
  return registry;
}

const helperNames = ["production-maintenance-pm2-control.py", "production-maintenance-pm2-connection.py", "production-maintenance-pm2-dump.py"];
function daemonEnvironment(pid, home) {
  const bytes = readFileSync(`/proc/${pid}/environ`);
  if (bytes.length > 1048576 || bytes.at(-1) !== 0) fail();
  const rows = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0");
  const keys = ["PM2_HOME", "PM2_NODE_OPTIONS", "NODE_OPTIONS", "NODE_PATH", "PM2_DAEMON_RPC_PORT", "PM2_DAEMON_PUB_PORT", "PM2_PID_FILE_PATH"];
  for (const key of keys) {
    const values = rows.filter((row) => row.startsWith(key + "=")).map((row) => row.slice(key.length + 1));
    if (values.length > 1 || (key === "PM2_HOME" ? values.some((value) => value !== home) : values.some((value) => value !== ""))) fail();
  }
  return true;
}
function helperProof() {
  const paths = helperNames.map((name) => fileURLToPath(new URL("./" + name, import.meta.url)));
  const identity = (s) => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"].map((key) => String(s[key])).join(":");
  const directories = new Set(paths.flatMap((file) => {
    const all = ["/"]; for (const part of posix.dirname(file).split("/").filter(Boolean)) all.push(posix.join(all.at(-1), part)); return all;
  }));
  const chain = [...directories].map((directory) => {
    const s = lstatSync(directory, { bigint: true });
    if (!s.isDirectory() || s.uid !== 0n || (s.mode & 0o022n) !== 0n || realpathSync(directory) !== directory) fail();
    return { path: directory, identity: identity(s) };
  });
  const files = paths.map((file) => {
    const s = lstatSync(file, { bigint: true });
    if (!s.isFile() || s.nlink !== 1n || s.uid !== 0n || (s.mode & 0o022n) !== 0n || s.size < 1n || s.size > 131072n || realpathSync(file) !== file) fail();
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (identity(fstatSync(fd, { bigint: true })) !== identity(s)) fail();
      const bytes = readFileSync(fd);
      if (BigInt(bytes.length) !== s.size || identity(fstatSync(fd, { bigint: true })) !== identity(s) || identity(lstatSync(file, { bigint: true })) !== identity(s)) fail();
      return { path: file, identity: identity(s), digest: createHash("sha256").update(bytes).digest("hex") };
    } finally { closeSync(fd); }
  });
  return { files, chain };
}

export const PM2_CONTROL_BRIDGE_SOURCE = `import importlib.util,json,sys
try:
    raw=sys.stdin.buffer.read(65537)
    if len(raw)>65536: raise ValueError()
    value=json.loads(raw)
    if type(value) is not dict or set(value)!={"socketPath","daemon","request"}: raise ValueError()
    spec=importlib.util.spec_from_file_location("faolla_pm2_control",sys.argv[1])
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    if value["request"] is None:
        result=module.inspect_pm2_registry(value["socketPath"],value["daemon"],timeout_ms=5000)
    else:
        result=module.control_pm2_process(value["socketPath"],value["daemon"],value["request"],timeout_ms=45000)
    sys.stdout.write(json.dumps(result,separators=(",",":"))+"\\n")
except BaseException:
    sys.stderr.write("production_maintenance_pm2_unverified\\n")
    sys.exit(1)
`;
function invoke(python, payload) {
  return spawnSync(python.target.path, ["-I", "-S", "-B", "-c", PM2_CONTROL_BRIDGE_SOURCE,
    fileURLToPath(new URL("./production-maintenance-pm2-control.py", import.meta.url))], {
    input: JSON.stringify(payload), encoding: "utf8", timeout: payload.request === null ? 7000 : 50000,
    killSignal: "SIGKILL", maxBuffer: 524288, shell: false, windowsHide: true, cwd: "/",
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"],
  });
}
export const PM2_DUMP_BRIDGE_SOURCE = `import importlib.util,json,sys
try:
    raw=sys.stdin.buffer.read(524289)
    if len(raw)>524288: raise ValueError()
    value=json.loads(raw)
    if type(value) is not dict or set(value)!={"socketPath","daemon","request"}: raise ValueError()
    request=value["request"]
    if type(request) is not dict or set(request)!={"action","registry","proof"}: raise ValueError()
    spec=importlib.util.spec_from_file_location("faolla_pm2_dump",sys.argv[1])
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    if request["action"]=="capture" and request["registry"] is None and request["proof"] is None:
        result=module.capture_pm2_dump_target(value["socketPath"],value["daemon"],timeout_ms=15000)
    elif request["action"]=="persist":
        result=module.persist_pm2_dump(value["socketPath"],value["daemon"],request["registry"],request["proof"],timeout_ms=15000)
    elif request["action"]=="verify":
        result=module.verify_pm2_dump(value["socketPath"],value["daemon"],request["registry"],request["proof"],timeout_ms=15000)
    else: raise ValueError()
    sys.stdout.write(json.dumps(result,separators=(",",":"))+"\\n")
except BaseException:
    sys.stderr.write("production_maintenance_pm2_unverified\\n")
    sys.exit(1)
`;
function invokeDump(python, payload) {
  return spawnSync(python.target.path, ["-I", "-S", "-B", "-c", PM2_DUMP_BRIDGE_SOURCE,
    fileURLToPath(new URL("./production-maintenance-pm2-dump.py", import.meta.url))], {
    input: JSON.stringify(payload), encoding: "utf8", timeout: 20000, killSignal: "SIGKILL", maxBuffer: 524288,
    shell: false, windowsHide: true, cwd: "/", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"],
  });
}
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export function pm2RegistryDigest(value) {
  const rows = validatePm2Registry(value).sort((a, b) => a.pm_id - b.pm_id);
  return createHash("sha256").update(JSON.stringify(canonical(rows))).digest("hex");
}
export function validatePm2DumpTarget(value, rawDaemon, bootId, socketPath = null) {
  const daemon = daemonCopy(rawDaemon, bootId), target = plain(value);
  if (!exact(target, ["version", "socketPath", "daemon", "chain", "dump", "backup"]) || target.version !== 1 ||
      !absolute(target.socketPath) || posix.basename(target.socketPath) !== "rpc.sock" || (socketPath !== null && target.socketPath !== socketPath) ||
      !exact(target.daemon, PEER_KEYS) || !equal(canonical(target.daemon), canonical(pick({ ...daemon, bootId }, PEER_KEYS))) ||
      !Array.isArray(target.chain) || target.chain.length < 2 || !target.chain.every((row) => Array.isArray(row) && row.length === 5 &&
        row.every((part) => typeof part === "string" && /^(0|[1-9]\d{0,24})$/.test(part))) ||
      ![target.dump, target.backup].every((file) => file === null || exact(file, ["identity", "sha256"]) &&
        typeof file.identity === "string" && IDENTITY.test(file.identity) && typeof file.sha256 === "string" && DIGEST.test(file.sha256))) fail();
  return target;
}
export function validatePm2DumpReceipt(value, daemon, bootId, registry, socketPath = null) {
  const receipt = plain(value);
  if (!exact(receipt, ["version", "pm2Version", "peerVerified", "saved", "processCount", "registryHash", "target"]) ||
      receipt.version !== 1 || receipt.pm2Version !== "6.0.14" || receipt.peerVerified !== true || receipt.saved !== true ||
      !integer(receipt.processCount, 1, registry.length) || receipt.registryHash !== pm2RegistryDigest(registry)) fail();
  receipt.target = validatePm2DumpTarget(receipt.target, daemon, bootId, socketPath);
  if (!receipt.target.dump) fail();
  return receipt;
}
async function dependencies(overrides) {
  let readProcess = overrides.readProcess;
  if (!readProcess) {
    // The legacy supervision module has a stdin entry point. Never import it
    // through that entry point merely to inspect this transport.
    if (!process.argv[1] || process.argv[1] === "-") fail();
    readProcess = (await import("./check-production-runtime-supervision.mjs")).captureProcessFact;
  }
  return { readProcess, boot: () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    canonical: realpathSync, daemonEnvironment, python: captureTrustedPython, verifyPython: verifyTrustedPython, helperProof, invoke, invokeDump, ...overrides };
}
async function exchange(rawDaemon, bootId, rawRequest, overrides, dump = false) {
  let attempted = false;
  try {
    const daemon = daemonCopy(rawDaemon, bootId), request = plain(rawRequest);
    if (dump) {
      if (!exact(request, ["action", "registry", "proof"]) || !["capture", "persist", "verify"].includes(request.action)) fail();
      if (request.action === "capture") { if (request.registry !== null || request.proof !== null) fail(); }
      else {
        request.registry = validatePm2Registry(request.registry);
        if (!request.registry.length) fail();
        request.proof = request.action === "persist" ? validatePm2DumpTarget(request.proof, daemon, bootId)
          : validatePm2DumpReceipt(request.proof, daemon, bootId, request.registry);
      }
    } else if (request !== null && !(exact(request, ["action", "launch"]) && request.action === "prepare") &&
        !(exact(request, ["action", "expected", "expectedProcess"]) && ["stop", "delete"].includes(request.action))) fail();
    const d = await dependencies(overrides);
    const observe = () => {
      if (d.boot() !== bootId) fail();
      const current = plain(d.readProcess(daemon.pid));
      if (!exact(current, [...PROCESS_KEYS, "commandLine"]) || !equal(pick(current, PROCESS_KEYS), daemon)) fail();
      const title = current.commandLine?.length === 1 && typeof current.commandLine[0] === "string"
        ? current.commandLine[0].match(/^PM2 v6\.0\.14: God Daemon \(([^\0\r\n]+)\)$/) : null;
      if (!title || !absolute(title[1]) || d.canonical(title[1]) !== title[1]) fail();
      if (d.daemonEnvironment(daemon.pid, title[1]) !== true || !equal(pick(plain(d.readProcess(daemon.pid)), PROCESS_KEYS), daemon)) fail();
      return title[1] + "/rpc.sock";
    };
    const socketPath = observe(), python = d.python(), code = d.helperProof();
    d.verifyPython(python);
    if (observe() !== socketPath || !equal(d.helperProof(), code)) fail();
    const payload = { socketPath, daemon: pick({ ...daemon, bootId }, PEER_KEYS), request };
    if (Buffer.byteLength(JSON.stringify(payload)) > (dump ? 524288 : 65536)) fail();
    if (dump && request.action !== "capture" && (request.action === "persist" ? request.proof.socketPath : request.proof.target.socketPath) !== socketPath) fail();
    attempted = dump ? request.action === "persist" : request !== null;
    const result = dump ? d.invokeDump(python, payload) : d.invoke(python, payload);
    d.verifyPython(python);
    if (observe() !== socketPath || !equal(d.helperProof(), code) || result.error || result.signal || result.status !== 0 ||
        result.stderr !== "" || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 524288) fail();
    const answer = plain(JSON.parse(result.stdout));
    if (dump) {
      if (request.action === "capture") return validatePm2DumpTarget(answer, daemon, bootId, socketPath);
      if (request.action === "persist") return validatePm2DumpReceipt(answer, daemon, bootId, request.registry, socketPath);
      if (answer !== true) fail();
      return true;
    }
    if (!exact(answer, ["version", "pm2Version", "peerVerified", "registry", ...(request === null ? [] : ["acknowledged"])]) ||
        answer.version !== 1 || answer.pm2Version !== "6.0.14" || answer.peerVerified !== true ||
        (request !== null && answer.acknowledged !== true)) fail();
    answer.registry = validatePm2Registry(answer.registry);
    return answer;
  } catch { throw new Error(attempted ? UNKNOWN : ERROR); }
}
export async function inspectPm2Registry(daemon, bootId, overrides = {}) {
  return (await exchange(daemon, bootId, null, overrides)).registry;
}
export async function controlPm2(daemon, bootId, request, overrides = {}) {
  return exchange(daemon, bootId, request, overrides);
}
export async function capturePm2DumpTarget(daemon, bootId, overrides = {}) {
  return exchange(daemon, bootId, { action: "capture", registry: null, proof: null }, overrides, true);
}
export async function persistPm2Dump(daemon, bootId, registry, proof, overrides = {}) {
  return exchange(daemon, bootId, { action: "persist", registry, proof }, overrides, true);
}
export async function verifyPm2Dump(daemon, bootId, registry, proof, overrides = {}) {
  return exchange(daemon, bootId, { action: "verify", registry, proof }, overrides, true);
}
