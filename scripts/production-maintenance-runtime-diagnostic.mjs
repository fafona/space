import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { posix } from "node:path";

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
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = () => { throw new Error(ERROR); };
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
  return { version: 1, maintenance: "not_verified", stability: "unverified", disk: "unverified", supervision: null,
    daemonCwdIsRoot: null, webMetadata: Object.fromEntries(META_KEYS.map((key) => [key, null])),
    supabaseEnvironment: "unverified", worker: { state: "unverified", nodeDescendantCount: null, nonNodeDescendantCount: null },
    runtimeExtraProcessCount: null, pm2Home: "unverified", pm2PathOverridesPresent: null, pm2Connection: "not_checked" };
}
export function validateRuntimeCompatibilityDiagnostic(value) {
  if (!exact(value, Object.keys(empty())) || value.version !== 1 || value.maintenance !== "not_verified" ||
      !["stable", "unverified"].includes(value.stability) || !["verified", "unverified"].includes(value.disk) ||
      (value.supervision !== null && !CODES.includes(value.supervision)) || !bool(value.daemonCwdIsRoot) ||
      !exact(value.webMetadata, META_KEYS) || !META_KEYS.every((key) => bool(value.webMetadata[key])) ||
      !["matches", "absent", "differs", "unverified"].includes(value.supabaseEnvironment) ||
      !exact(value.worker, ["state", "nodeDescendantCount", "nonNodeDescendantCount"]) ||
      !["not_observed", "owned", "unverified"].includes(value.worker.state) ||
      !count(value.worker.nodeDescendantCount) || !count(value.worker.nonNodeDescendantCount) ||
      !count(value.runtimeExtraProcessCount) || !["matches", "differs", "absent", "unverified"].includes(value.pm2Home) ||
      !bool(value.pm2PathOverridesPresent) || value.pm2Connection !== "not_checked") fail();
  if (value.worker.state === "unverified" ? value.worker.nodeDescendantCount !== null || value.worker.nonNodeDescendantCount !== null
    : value.worker.nodeDescendantCount === null || value.worker.nonNodeDescendantCount === null ||
      (value.worker.state === "not_observed" && (value.worker.nodeDescendantCount !== 0 || value.worker.nonNodeDescendantCount !== 0))) fail();
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
  if (!equal(d.readProcess(fact.pid), fact)) fail();
  const result = d.readSelected(fact.pid);
  if (!equal(d.readProcess(fact.pid), fact)) fail();
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
    if (fact.parentPid !== daemon.pid) fail();
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
    worker = { state: "owned", nodeDescendantCount: workerFacts.slice(1).filter((entry) => entry.executable === node).length,
      nonNodeDescendantCount: workerFacts.slice(1).filter((entry) => entry.executable !== node).length };
  }
  if (scan.runtimePids.length > 128) fail();
  const runtimeFacts = scan.runtimePids.map((pid) => d.readProcess(pid));
  const allowed = new Set([web.pid, ...workerFacts.map((fact) => fact.pid)]);
  // A child with an unknown executable is observed, not authorized for stopping.
  const extra = scan.runtimePids.filter((pid) => !allowed.has(pid)).length;
  return { worker, extra, witness: { observed, workerFacts, runtimeFacts } };
}
async function observe(input, d) {
  const report = empty(); const disk = d.disk(input.appDir, input.expectedOldSha);
  const snapshot = await d.supervision(input.appName, disk, input.appPort, input.expectedOldSha);
  const witness = { disk, snapshot }; report.disk = "verified";
  report.supervision = d.classify({ ...snapshot, runtime: disk.runtime, stable: true });
  if (!CODES.includes(report.supervision)) fail();
  const web = snapshot.listener?.chain?.find((entry) => entry.pid === snapshot.ownership?.pid);
  const daemon = snapshot.listener?.chain?.find((entry) => entry.pid === snapshot.ownership?.daemonPid);
  if (snapshot.ownership?.state !== "owned" || !web || !daemon) return { report, witness };
  const node = d.nodePath();
  if (!equal(d.readProcess(web.pid), web) || !equal(d.readProcess(daemon.pid), daemon)) fail();
  report.daemonCwdIsRoot = daemon.cwd === "/";
  try { const values = readStableSelected(web, d); report.webMetadata = metadata(values, disk, node, input.appPort, d); witness.webMetadataHash = hash(values); } catch { /* Unknown, not false. */ }
  try {
    const file = d.readRollback(disk.runtime + "/.env.local", input.expectedOldSha);
    const live = d.readProcessEnvironment(String(web.pid), disk.runtime);
    if (live.startTicks !== web.startTicks || file.fileIdentity !== disk.environmentIdentity || file.sha256 !== disk.environmentDigest) fail();
    const matches = ["internalUrl", "publicUrl", "anonKey"].every((key) => live[key] === file[key]) &&
      (live.rolloutStatus === "present" ? ["staffBusinessRbacMode", "staffBusinessRbacSiteIds", "canonicalPortalOrigin"].every((key) => live[key] === file[key])
        : live.rolloutStatus === "absent" && file.rolloutStatus === "legacy-off");
    report.supabaseEnvironment = live.status === "absent" ? "absent" : live.status === "present" ? matches ? "matches" : "differs" : "unverified";
    witness.environmentHash = hash({ file, live });
  } catch { /* A failed read is not an absent configuration. */ }
  try { const result = workerObservation(input, disk, web, daemon, node, d);
    report.worker = result.worker; report.runtimeExtraProcessCount = result.extra; witness.worker = result.witness;
  } catch { /* No PM2 registry read or fallback to another owner. */ }
  try {
    const cli = d.cliEnvironment(); if (typeof cli.overridesPresent !== "boolean") fail();
    report.pm2PathOverridesPresent = cli.overridesPresent;
    const values = readStableSelected(daemon, d);
    const title = daemon.commandLine?.length === 1 ? daemon.commandLine[0].match(/^PM2 v[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9._-]+)?: God Daemon \(([^\0\r\n]{1,4096})\)$/)?.[1] : null;
    const home = values.PM2_HOME || title;
    if (values.PM2_HOME && title && canonical(values.PM2_HOME, d) !== canonical(title, d)) fail();
    const actual = canonical(home, d); const intended = canonical(cli.home, d);
    report.pm2Home = !cli.home || !home ? "absent" : actual === null || intended === null ? "unverified" : actual === intended ? "matches" : "differs";
    witness.home = { metadataHash: hash(values), cliHash: hash(cli) };
  } catch { report.pm2Home = "unverified"; }
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
